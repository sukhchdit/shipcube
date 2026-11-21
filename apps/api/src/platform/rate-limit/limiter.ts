/**
 * The rate-limit engine (REQ-API-014, REQ-SEC-005, REQ-SEC-006, DR-A22, api/README §7; TASK-041): fixed-window rules
 * over a {@link RateLimitStore}. One request may consume several rules at once (a class with a minute and an hour
 * window); the headers describe the rule closest to exhaustion, a refusal the rule that was exceeded.
 *
 * Valkey outage (README §7, ADR-0016 amendment 12 item 8): the fallback set (`auth`, `email-send`, `public-quote`,
 * `public-tracking`, the `quote-create` service rules and the failed-authentication budget) falls back to the
 * per-instance in-memory store with the same limits, the others fail open. Either way the outage is reported once a
 * minute per scope as the runtime security event `rate_limit_store_unavailable` (class-only fields, no host).
 *
 * The failed-authentication budget (ADR-0016 amendment 12 item 4, amendment 13; TASK-041 part 041-B) uses two calls:
 * {@link RateLimiter.spend} counts a refused credential, and {@link RateLimiter.consumeGated} counts a step-0 hit and
 * reads that budget in the same store call.
 */
import { createMemoryStore, type RateLimitStore, type WindowPeek } from './store.js';

/** A fixed-window rule: `limit` hits per `windowMs` under `name` and `key` (an identifier, never personal data). */
export interface RateRule {
  /** The counter family, e.g. `public:ip`; part of the Valkey key. */
  readonly name: string;
  /** The counted subject: a coarse IP key (IPv6 /64), a user, organisation or account identifier. */
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}

/** What a rule reading says about one request. */
export interface RateReading {
  readonly rule: string;
  readonly limit: number;
  readonly remaining: number;
  /** Whole seconds until the window closes (at least 1). */
  readonly resetSeconds: number;
}

export type RateDecision =
  | { readonly allowed: true; readonly reading: RateReading | undefined }
  | {
      readonly allowed: false;
      readonly reading: RateReading;
      readonly retryAfterSeconds: number;
      /** The first refusal of this key and window (the hit whose count is the limit plus one; ADR-0016 am. 12 item 6). */
      readonly first: boolean;
    };

export type StoreFailureMode = 'fail-open' | 'fallback';

export interface ConsumeOptions {
  readonly onStoreFailure: StoreFailureMode;
  /** The outage event's `scope` (a short allow-listed label such as `rate-limit`). */
  readonly scope: string;
}

/** The result of one spend: `reached` is true for the spend whose count equals the limit (the event's moment). */
export interface SpendResult {
  readonly count: number;
  readonly reached: boolean;
}

export interface RateLimiter {
  consume(rules: readonly RateRule[], options: ConsumeOptions): Promise<RateDecision>;
  /**
   * Counts one hit of `rule` and reads `gate` in ONE store call. While the gate's count is at or above its limit the
   * request is refused with the gate's reading and the rest of the gate's window (`first` is false: the gate's event is
   * emitted by the spend that reaches its limit). Otherwise `rule` decides. On a store failure `rule` follows
   * `options.onStoreFailure` and the gate is read from the per-instance fallback, where the spends of the outage went.
   */
  consumeGated(rule: RateRule, gate: RateRule, options: ConsumeOptions): Promise<RateDecision>;
  /** Spends one unit of `rule` (never refused here); on a store failure the per-instance fallback counts it. Never rejects. */
  spend(rule: RateRule, scope: string): Promise<SpendResult>;
  /** A concurrency slot (SSE streams, README §7): false when `max` holders already hold one. Fails open on a store error. */
  acquire(
    rule: { readonly name: string; readonly key: string; readonly max: number; readonly ttlMs: number },
    holder: string,
  ): Promise<boolean>;
  /** Frees the slot; never throws. */
  release(rule: { readonly name: string; readonly key: string }, holder: string): Promise<void>;
}

export interface RateLimiterOptions {
  readonly store: RateLimitStore;
  /** The per-instance store used while `store` fails (the fallback set); default a bounded in-memory store. */
  readonly fallback?: RateLimitStore;
  /** Reports an outage (already rate limited to once a minute per scope by {@link createOutageReporter}). */
  readonly onStoreUnavailable: (scope: string) => void;
}

/** `rl:<name>:<key>`: the key of a rule's counter (the failed-authentication budget is `rl:step0:authn-failed:<ip>`). */
export const counterKey = (name: string, key: string): string => `rl:${name}:${key}`;

const closer = (a: RateReading, b: RateReading): boolean =>
  b.remaining < a.remaining || (b.remaining === a.remaining && b.resetSeconds < a.resetSeconds);

const seconds = (ms: number): number => Math.max(Math.ceil(ms / 1000), 1);

function judge(rule: RateRule, count: number, resetMs: number): RateDecision {
  const reading: RateReading = {
    rule: rule.name,
    limit: rule.limit,
    remaining: Math.max(rule.limit - count, 0),
    resetSeconds: seconds(resetMs),
  };
  if (count > rule.limit) return { allowed: false, reading, retryAfterSeconds: reading.resetSeconds, first: count === rule.limit + 1 };
  return { allowed: true, reading };
}

async function evaluate(store: RateLimitStore, rules: readonly RateRule[]): Promise<RateDecision> {
  let closest: RateReading | undefined;
  for (const rule of rules) {
    const { count, resetMs } = await store.hit(counterKey(rule.name, rule.key), rule.windowMs);
    const decision = judge(rule, count, resetMs);
    if (!decision.allowed) return decision;
    if (decision.reading !== undefined && (closest === undefined || closer(closest, decision.reading))) closest = decision.reading;
  }
  return { allowed: true, reading: closest };
}

/** The refusal of a spent gate (failed count at or above the limit), or undefined while the gate is open. */
function gateRefusal(gate: RateRule, peek: WindowPeek): RateDecision | undefined {
  if (peek.count < gate.limit) return undefined;
  const resetSeconds = seconds(peek.resetMs);
  return {
    allowed: false,
    reading: { rule: gate.name, limit: gate.limit, remaining: 0, resetSeconds },
    retryAfterSeconds: resetSeconds,
    first: false,
  };
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const fallback = options.fallback ?? createMemoryStore();
  return {
    async consume(rules, { onStoreFailure, scope }) {
      try {
        return await evaluate(options.store, rules);
      } catch {
        options.onStoreUnavailable(scope);
        // Fail open: allowed, no reading (the response carries no RateLimit-* headers it cannot back).
        return onStoreFailure === 'fallback' ? evaluate(fallback, rules) : { allowed: true, reading: undefined };
      }
    },
    async consumeGated(rule, gate, { onStoreFailure, scope }) {
      try {
        const { hit, peek } = await options.store.hitAndPeek(
          counterKey(rule.name, rule.key),
          rule.windowMs,
          counterKey(gate.name, gate.key),
          gate.windowMs,
        );
        return gateRefusal(gate, peek) ?? judge(rule, hit.count, hit.resetMs);
      } catch {
        options.onStoreUnavailable(scope);
        const refused = gateRefusal(gate, await fallback.peek(counterKey(gate.name, gate.key), gate.windowMs));
        if (refused !== undefined) return refused;
        return onStoreFailure === 'fallback' ? evaluate(fallback, [rule]) : { allowed: true, reading: undefined };
      }
    },
    async spend(rule, scope) {
      const key = counterKey(rule.name, rule.key);
      let count: number;
      try {
        ({ count } = await options.store.hit(key, rule.windowMs));
      } catch {
        options.onStoreUnavailable(scope);
        ({ count } = await fallback.hit(key, rule.windowMs));
      }
      return { count, reached: count === rule.limit };
    },
    async acquire(rule, holder) {
      try {
        return await options.store.acquire(counterKey(rule.name, rule.key), holder, rule.max, rule.ttlMs);
      } catch {
        options.onStoreUnavailable('rate-limit');
        return true;
      }
    },
    async release(rule, holder) {
      try {
        await options.store.release(counterKey(rule.name, rule.key), holder);
      } catch {
        // The slot expires by itself (ttl); nothing to do for the client that already got its answer.
      }
    },
  };
}

/** Wraps `emit` so that each scope reports at most once per `intervalMs` (default 60 s) per instance. */
export function createOutageReporter(
  emit: (scope: string) => void,
  options: { readonly now?: () => number; readonly intervalMs?: number } = {},
): (scope: string) => void {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 60_000;
  const last = new Map<string, number>();
  return (scope) => {
    const t = now();
    const previous = last.get(scope);
    if (previous !== undefined && t - previous < intervalMs) return;
    last.set(scope, t);
    emit(scope);
  };
}
