/**
 * Counter stores of the rate limiter (api/README §7, ADR-0016 §8, ADR-0013; TASK-041). Two implementations of one port:
 * the Valkey store (shared by every API replica, one atomic Lua script per call, every call bounded by a timeout) and
 * the in-memory store (the per-instance fallback of the security classes during a Valkey outage, README §7, and the
 * store of test compositions). Keys and values hold internal identifiers, counts and coarse network prefixes only: no
 * e-mail address, user agent, route or correlation id (D-SECT39-01 item 4).
 */

/** One fixed-window hit: the count including this hit, and the milliseconds until the window closes. */
export interface WindowHit {
  readonly count: number;
  readonly resetMs: number;
}

export interface RateLimitStore {
  /** Counts one hit in the fixed window of `key` (the window opens at the first hit and is anchored by the key's TTL). */
  hit(key: string, windowMs: number): Promise<WindowHit>;
  /** Takes one of `max` concurrent slots under `key` for `holder`; false when all are taken. A crashed holder's slot expires after `ttlMs`. */
  acquire(key: string, holder: string, max: number, ttlMs: number): Promise<boolean>;
  /** Frees `holder`'s slot (idempotent). */
  release(key: string, holder: string): Promise<void>;
}

/** The store could not answer in time or at all (the cause is never copied into a log: it can name the host). */
export class RateLimitStoreError extends Error {
  override readonly name = 'RateLimitStoreError';
  constructor(readonly reason: 'timeout' | 'unavailable' | 'malformed-reply') {
    super(`rate-limit store: ${reason}`);
  }
}

/** The part of the ioredis client the Valkey store uses (`eval` runs one script atomically). */
export interface ScriptClient {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

/** Default bound of one store call; the shared client's own command timeout (2 s) stays as the backstop. */
export const STORE_TIMEOUT_MS = 250;

/** Rejects with `RateLimitStoreError('timeout')` when `work` has not settled in `timeoutMs`; the timer never keeps the process alive. */
export async function withStoreTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RateLimitStoreError('timeout')), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (error instanceof RateLimitStoreError) throw error;
    throw new RateLimitStoreError('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/** INCR, PEXPIRE on the first hit, PTTL; a key without a TTL (never expected) gets one, so no counter can stay for good. */
export const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** Concurrent slots in a sorted set scored by expiry (server clock), so a crashed holder frees its slot by itself. */
export const ACQUIRE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

export const RELEASE_SCRIPT = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** The Valkey-backed store; `timeoutMs` bounds every call (CLAUDE.md §9). */
export function createValkeyStore(client: ScriptClient, options: { readonly timeoutMs?: number } = {}): RateLimitStore {
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const run = (script: string, key: string, ...args: string[]): Promise<unknown> =>
    withStoreTimeout(client.eval(script, 1, key, ...args), timeoutMs);
  return {
    async hit(key, windowMs) {
      const reply = await run(HIT_SCRIPT, key, String(windowMs));
      const [count, ttl] = Array.isArray(reply) ? (reply as unknown[]) : [];
      if (!isCount(count) || typeof ttl !== 'number' || !Number.isFinite(ttl)) throw new RateLimitStoreError('malformed-reply');
      return { count, resetMs: Math.min(Math.max(ttl, 1), windowMs) };
    },
    async acquire(key, holder, max, ttlMs) {
      const reply = await run(ACQUIRE_SCRIPT, key, holder, String(max), String(ttlMs));
      if (reply !== 0 && reply !== 1) throw new RateLimitStoreError('malformed-reply');
      return reply === 1;
    },
    async release(key, holder) {
      await run(RELEASE_SCRIPT, key, holder);
    },
  };
}

/** Upper bound of the entries one in-memory store keeps (memory safety under a key flood; oldest windows go first). */
const MEMORY_MAX_ENTRIES = 50_000;

/** The in-memory store: per instance, bounded, with the same window and slot semantics. */
export function createMemoryStore(now: () => number = Date.now): RateLimitStore {
  const windows = new Map<string, { count: number; endsAt: number }>();
  const slots = new Map<string, Map<string, number>>();

  function prune(): void {
    const t = now();
    for (const [key, window] of windows) if (window.endsAt <= t) windows.delete(key);
    // Still over the bound (a flood inside one window): drop the oldest-inserted windows.
    for (const key of windows.keys()) {
      if (windows.size <= MEMORY_MAX_ENTRIES) break;
      windows.delete(key);
    }
  }

  return {
    hit(key, windowMs) {
      const t = now();
      let window = windows.get(key);
      if (window === undefined || window.endsAt <= t) {
        if (windows.size >= MEMORY_MAX_ENTRIES) prune();
        window = { count: 0, endsAt: t + windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      return Promise.resolve({ count: window.count, resetMs: Math.max(window.endsAt - t, 1) });
    },
    acquire(key, holder, max, ttlMs) {
      const t = now();
      const held = slots.get(key) ?? new Map<string, number>();
      for (const [id, expiresAt] of held) if (expiresAt <= t) held.delete(id);
      if (held.size >= max) {
        slots.set(key, held);
        return Promise.resolve(false);
      }
      held.set(holder, t + ttlMs);
      slots.set(key, held);
      return Promise.resolve(true);
    },
    release(key, holder) {
      const held = slots.get(key);
      held?.delete(holder);
      if (held?.size === 0) slots.delete(key);
      return Promise.resolve();
    },
  };
}
