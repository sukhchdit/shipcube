/**
 * The per-actor authorisation-denial budget (threat model T-39, PR56-SEC-03, D-SEC-PR56-01, D-ORCH-109, D-ARCH-142,
 * D-SECT39-01; TASK-041). Authorisation runs before the route limiter (DR-A08), so a caller who holds no permission
 * could otherwise write one PERMISSION_DENIED audit transaction per request. The authorise slot takes one unit of this
 * budget BEFORE it writes the entry:
 *  - denials 1..N of a 60 s window are audited one by one and answer 403 (D-TASK029-06 unchanged);
 *  - denial N+1 writes ONE aggregated entry and answers 429 RATE_LIMITED;
 *  - every further denial of the window writes nothing and answers 429;
 *  - the number of denials answered without an entry is carried under a second key (24 h) and written as
 *    `suppressed_in_previous_window` on the first denial of a later window (claimed by that denial, restored when its
 *    entry is not written, omitted when 0). One actor therefore costs at most N+1 audit transactions a minute.
 *
 * Valkey holds UUIDs and integers only. One Lua script per denial does the whole step atomically (INCR; on 1 PEXPIRE and
 * GETDEL of the carry; above N+1 INCR + EXPIRE of the carry) and the window is anchored by the budget key's own TTL, so
 * two replicas never split a window and no key is ever left without a TTL. A store failure uses a per-instance
 * in-memory counter with the same threshold, shape and carry (K replicas allow K·(N+1) entries a minute, never
 * unlimited writes) and reports `rate_limit_store_unavailable` at most once a minute.
 */
import type { DenialMark } from '../audit/capture.js';
import { BoundedMap } from './bounded-map.js';
import { AUTHZ_DENIAL_BUDGET, type RateLimitCounter } from './counter.js';
import { MEMORY_MAX_ENTRIES, type ScriptClient, STORE_TIMEOUT_MS, withStoreTimeout } from './store.js';

export const DENIAL_WINDOW_SECONDS = 60;
const WINDOW_MS = DENIAL_WINDOW_SECONDS * 1000;
const CARRY_TTL_SECONDS = 24 * 60 * 60;
const MAX_CARRY = 2 ** 31 - 1;

export const DENIAL_KEY_PREFIX = 'rl:authz-denial:';
export const DENIAL_CARRY_KEY_PREFIX = 'rl:authz-denial-carry:';

/** The principal facts the budget key is built from (never an IP, user agent or route). */
export interface DenialSubject {
  readonly orgId: string;
  readonly actorId: string;
  /** The credential kind of the principal (`session`, `signature`, ...). */
  readonly credential: string;
  /** True for a user actor: its id is the actor segment. */
  readonly authenticated: boolean;
}

export type DenialVerdict =
  /** Denial 1..N: write the entry (carrying `mark.suppressed` when this denial opens a window) and answer 403. */
  | {
      readonly kind: 'individual';
      readonly mark: Extract<DenialMark, { kind: 'individual' }>;
      /** Puts the claimed carry back after the entry was not written; never rejects. Absent when nothing was claimed. */
      readonly restoreCarry?: () => Promise<void>;
    }
  /** Denial N+1: write the ONE aggregated entry, then answer 429 with these seconds. */
  | { readonly kind: 'aggregated'; readonly mark: Extract<DenialMark, { kind: 'aggregated' }>; readonly retryAfterSeconds: number }
  /** Denial above N+1: write nothing and answer 429. */
  | { readonly kind: 'suppressed'; readonly retryAfterSeconds: number };

export interface DenialBudget {
  /** The N in force (`AUTHZ_DENIAL_BUDGET_PER_MIN`): the `RateLimit-Limit` of the 429 answers. */
  readonly threshold: number;
  /** Takes one unit for this denial. Never rejects: a store failure uses the per-instance fallback. */
  take(subject: DenialSubject): Promise<DenialVerdict>;
}

/** The result of the atomic step. */
interface TakeResult {
  readonly count: number;
  readonly pttlMs: number;
  /** The carry claimed by a window-opening denial (0 when none); an unvalidated store value. */
  readonly claimed: number;
}

interface DenialStore {
  take(budgetKey: string, carryKey: string, threshold: number): Promise<TakeResult>;
  restore(carryKey: string, suppressed: number): Promise<void>;
}

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const segment = (value: string, fallback: string): string => (value === '' ? fallback : SEGMENT.test(value) ? value : 'unknown');

/**
 * `{org}:{actor}` (D-SECT39-01 item 3): the organisation id or the literal `system`; the actor id of a user actor, else
 * the credential kind. No segment is ever empty, and none can carry a `:` or a pattern character.
 */
export function denialKeys(subject: DenialSubject): { readonly budget: string; readonly carry: string } {
  const org = segment(subject.orgId, 'system');
  const actor = subject.authenticated ? segment(subject.actorId, 'unknown') : segment(subject.credential, 'unknown');
  return { budget: `${DENIAL_KEY_PREFIX}${org}:${actor}`, carry: `${DENIAL_CARRY_KEY_PREFIX}${org}:${actor}` };
}

/** One atomic step per denial; returns {count, PTTL, claimed carry}. Never leaves the budget key without a TTL. */
export const TAKE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local claimed = 0
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  local carry = redis.call('GETDEL', KEYS[2])
  if carry then claimed = tonumber(carry) or -1 end
elseif count > tonumber(ARGV[2]) + 1 then
  redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl, claimed}
`;

export const RESTORE_SCRIPT = `
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

function valkeyDenialStore(client: ScriptClient, timeoutMs: number): DenialStore {
  return {
    async take(budgetKey, carryKey, threshold) {
      const reply = await withStoreTimeout(
        client.eval(TAKE_SCRIPT, 2, budgetKey, carryKey, String(WINDOW_MS), String(threshold), String(CARRY_TTL_SECONDS)),
        timeoutMs,
      );
      const [count, pttlMs, claimed] = Array.isArray(reply) ? (reply as unknown[]) : [];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new Error('malformed reply');
      if (typeof pttlMs !== 'number' || !Number.isFinite(pttlMs)) throw new Error('malformed reply');
      return { count, pttlMs: Math.min(Math.max(pttlMs, 1), WINDOW_MS), claimed: typeof claimed === 'number' ? claimed : -1 };
    },
    async restore(carryKey, suppressed) {
      await withStoreTimeout(client.eval(RESTORE_SCRIPT, 1, carryKey, String(suppressed), String(CARRY_TTL_SECONDS)), timeoutMs);
    },
  };
}

/** The per-instance fallback: the same atomic step over two bounded maps (O(1) per new actor, PR041-SEC-01). */
export function memoryDenialStore(now: () => number = Date.now, maxEntries: number = MEMORY_MAX_ENTRIES): DenialStore {
  const windows = new BoundedMap<string, { count: number; endsAt: number }>(maxEntries, (window) => window.endsAt <= now());
  const carries = new BoundedMap<string, { suppressed: number; expiresAt: number }>(maxEntries, (carry) => carry.expiresAt <= now());
  const carryOf = (key: string, t: number): { suppressed: number; expiresAt: number } | undefined => {
    const carry = carries.get(key);
    if (carry !== undefined && carry.expiresAt <= t) {
      carries.delete(key);
      return undefined;
    }
    return carry;
  };
  return {
    take(budgetKey, carryKey, threshold) {
      const t = now();
      let window = windows.get(budgetKey);
      if (window !== undefined && window.endsAt <= t) window = undefined;
      let claimed = 0;
      if (window === undefined) {
        window = { count: 0, endsAt: t + WINDOW_MS };
        claimed = carryOf(carryKey, t)?.suppressed ?? 0;
        carries.delete(carryKey);
      }
      window.count += 1;
      windows.set(budgetKey, window);
      if (window.count > threshold + 1) {
        const carry = carryOf(carryKey, t);
        carries.set(carryKey, { suppressed: (carry?.suppressed ?? 0) + 1, expiresAt: t + CARRY_TTL_SECONDS * 1000 });
      }
      return Promise.resolve({ count: window.count, pttlMs: Math.max(window.endsAt - t, 1), claimed });
    },
    restore(carryKey, suppressed) {
      const t = now();
      const carry = carryOf(carryKey, t);
      carries.set(carryKey, { suppressed: (carry?.suppressed ?? 0) + suppressed, expiresAt: t + CARRY_TTL_SECONDS * 1000 });
      return Promise.resolve();
    },
  };
}

/** The log seam (class-only fields): the platform logger satisfies it. */
export interface DenialBudgetLog {
  warn(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}

export interface DenialBudgetOptions {
  /** `AUTHZ_DENIAL_BUDGET_PER_MIN` (N, validated 1..600 by the configuration). */
  readonly threshold: number;
  /** The runtime's Valkey client; absent (test compositions) the budget is per instance only. */
  readonly valkey?: ScriptClient | undefined;
  readonly counter?: RateLimitCounter | undefined;
  /** Receives the outage scope, already limited to once a minute per instance by the caller (createOutageReporter). */
  readonly onStoreUnavailable?: ((scope: string) => void) | undefined;
  readonly log?: DenialBudgetLog | undefined;
  readonly now?: (() => number) | undefined;
  readonly timeoutMs?: number | undefined;
}

/** RFC 3339 UTC, rounded UP to the second (the budget key's expiry). */
export function windowEndsAt(nowMs: number, pttlMs: number): string {
  return new Date(Math.ceil((nowMs + pttlMs) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/** A claimed carry the entry may carry: a safe integer in 1..2^31-1; anything else is dropped (and reported by class). */
function validCarry(claimed: number): number | 'none' | 'invalid' {
  if (claimed === 0) return 'none';
  return Number.isSafeInteger(claimed) && claimed >= 1 && claimed <= MAX_CARRY ? claimed : 'invalid';
}

export function createDenialBudget(options: DenialBudgetOptions): DenialBudget {
  if (!Number.isInteger(options.threshold) || options.threshold < 1)
    throw new RangeError('AUTHZ_DENIAL_BUDGET_PER_MIN must be a positive integer');
  const { threshold } = options;
  const now = options.now ?? Date.now;
  const memory = memoryDenialStore(now);
  const valkey = options.valkey === undefined ? undefined : valkeyDenialStore(options.valkey, options.timeoutMs ?? STORE_TIMEOUT_MS);

  async function step(budgetKey: string, carryKey: string): Promise<{ result: TakeResult; store: DenialStore }> {
    if (valkey !== undefined) {
      try {
        return { result: await valkey.take(budgetKey, carryKey, threshold), store: valkey };
      } catch {
        options.onStoreUnavailable?.(AUTHZ_DENIAL_BUDGET);
      }
    }
    return { result: await memory.take(budgetKey, carryKey, threshold), store: memory };
  }

  return {
    threshold,
    async take(subject) {
      const keys = denialKeys(subject);
      const { result, store } = await step(keys.budget, keys.carry);
      const { count, pttlMs, claimed } = result;
      if (count <= threshold) {
        const carry = count === 1 ? validCarry(claimed) : 'none';
        if (carry === 'invalid') options.log?.warn('rate_limit.carry_dropped', { class: AUTHZ_DENIAL_BUDGET });
        if (typeof carry !== 'number') return { kind: 'individual', mark: { kind: 'individual' } };
        const restoreCarry = async (): Promise<void> => {
          try {
            await store.restore(keys.carry, carry);
          } catch {
            options.log?.warn('rate_limit.carry_restore_failed', { class: AUTHZ_DENIAL_BUDGET });
          }
        };
        return { kind: 'individual', mark: { kind: 'individual', suppressed: carry }, restoreCarry };
      }
      options.counter?.refused(AUTHZ_DENIAL_BUDGET);
      const retryAfterSeconds = Math.max(Math.ceil(pttlMs / 1000), 1);
      if (count === threshold + 1) {
        return {
          kind: 'aggregated',
          retryAfterSeconds,
          mark: { kind: 'aggregated', threshold, windowSeconds: DENIAL_WINDOW_SECONDS, windowEndsAt: windowEndsAt(now(), pttlMs) },
        };
      }
      return { kind: 'suppressed', retryAfterSeconds };
    },
  };
}
