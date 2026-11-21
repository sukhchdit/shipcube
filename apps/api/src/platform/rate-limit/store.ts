/**
 * Counter stores of the rate limiter (api/README §7, ADR-0016 §8, ADR-0013; TASK-041). Two implementations of one port:
 * the Valkey store (shared by every API replica, one atomic Lua script per call, every call bounded by a timeout and
 * guarded by the process breaker) and the in-memory store (the per-instance fallback of the fallback set during a Valkey
 * outage, ADR-0016 am. 12 item 8, README §7, and the store of test compositions). Keys and values hold internal identifiers, counts and the IPv4 address or the IPv6 /64
 * of a client, kept for one window at most: no e-mail address, user agent, route or correlation id (D-SECT39-01 item 4).
 */

import { BoundedMap } from './bounded-map.js';
import type { StoreBreaker } from './breaker.js';

/** One fixed-window hit: the count including this hit, and the milliseconds until the window closes. */
export interface WindowHit {
  readonly count: number;
  readonly resetMs: number;
}

/** A window read without a hit: count 0 and resetMs 0 when the key has no live window. */
export type WindowPeek = WindowHit;

export interface RateLimitStore {
  /** Counts one hit in the fixed window of `key` (the window opens at the first hit and is anchored by the key's TTL). */
  hit(key: string, windowMs: number): Promise<WindowHit>;
  /**
   * Counts one hit under `key` and reads the window of `peekKey` without counting, in ONE store call (step 0 of a
   * credentialed request: the credentialed hit and the IP's failed-authentication count; ADR-0016 am. 12 item 4).
   */
  hitAndPeek(
    key: string,
    windowMs: number,
    peekKey: string,
    peekWindowMs: number,
  ): Promise<{ readonly hit: WindowHit; readonly peek: WindowPeek }>;
  /** Reads the window of `key` without counting (the per-instance fallback answers the step-0 gate during an outage). */
  peek(key: string, windowMs: number): Promise<WindowPeek>;
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

/**
 * HIT_SCRIPT on KEYS[1], then a read of KEYS[2] (GET + PTTL) that counts nothing. A live KEYS[2] without a TTL (never
 * expected) gets one, as in HIT_SCRIPT. Returns {count, ttl, peeked count, peeked ttl}; 0, 0 for a missing KEYS[2].
 */
export const HIT_AND_PEEK_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local peeked = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
local pttl = 0
if peeked > 0 then
  pttl = redis.call('PTTL', KEYS[2])
  if pttl < 0 then
    redis.call('PEXPIRE', KEYS[2], ARGV[2])
    pttl = tonumber(ARGV[2])
  end
end
return {count, ttl, peeked, pttl}
`;

/**
 * The read half of HIT_AND_PEEK_SCRIPT alone. No production path calls the Valkey `peek` today (the step-0 gate reads
 * through `hitAndPeek`; during an outage the limiter peeks the in-memory fallback). It is kept deliberately (n5 of the
 * part-B review): `peek` is part of the one store port both stores implement, so the fallback can be any store, and
 * its script is proved against a real Valkey in rate-limit.int.test.ts.
 */
export const PEEK_SCRIPT = `
local peeked = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
local pttl = 0
if peeked > 0 then
  pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    pttl = tonumber(ARGV[1])
  end
end
return {peeked, pttl}
`;

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isTtl = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A checked {count, ttl} pair of a reply: the reset stays inside the window; a peek of a missing window reads 0, 0. */
function windowOf(count: unknown, ttl: unknown, windowMs: number): WindowHit {
  if (!isCount(count) || !isTtl(ttl)) throw new RateLimitStoreError('malformed-reply');
  if (count === 0) return { count: 0, resetMs: 0 };
  return { count, resetMs: Math.min(Math.max(ttl, 1), windowMs) };
}

const replyItems = (reply: unknown): unknown[] => (Array.isArray(reply) ? (reply as unknown[]) : []);

/** A pass-through guard: a store composed without the process breaker (unit compositions). */
const UNGUARDED: Pick<StoreBreaker, 'run'> = { run: (call) => call() };

export interface ValkeyStoreOptions {
  /** Bound of one call (default {@link STORE_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** The process breaker (createRateLimitKit); absent, calls are not guarded. */
  readonly breaker?: Pick<StoreBreaker, 'run'> | undefined;
}

/**
 * The Valkey-backed store; `timeoutMs` bounds every call (CLAUDE.md §9). The breaker sees the bounded call together with
 * its reply check, so a timeout, an unreachable store or a malformed reply opens it (ADR-0016 am. 12 item 7).
 */
export function createValkeyStore(client: ScriptClient, options: ValkeyStoreOptions = {}): RateLimitStore {
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  const breaker = options.breaker ?? UNGUARDED;
  const run = <T>(parse: (reply: unknown) => T, script: string, keys: readonly string[], ...args: string[]): Promise<T> =>
    breaker.run(async () => parse(await withStoreTimeout(client.eval(script, keys.length, ...keys, ...args), timeoutMs)));
  return {
    hit: (key, windowMs) =>
      run(
        (reply) => {
          const [count, ttl] = replyItems(reply);
          if (count === 0) throw new RateLimitStoreError('malformed-reply');
          return windowOf(count, ttl, windowMs);
        },
        HIT_SCRIPT,
        [key],
        String(windowMs),
      ),
    hitAndPeek: (key, windowMs, peekKey, peekWindowMs) =>
      run(
        (reply) => {
          const [count, ttl, peeked, peekTtl] = replyItems(reply);
          if (count === 0) throw new RateLimitStoreError('malformed-reply');
          return { hit: windowOf(count, ttl, windowMs), peek: windowOf(peeked, peekTtl, peekWindowMs) };
        },
        HIT_AND_PEEK_SCRIPT,
        [key, peekKey],
        String(windowMs),
        String(peekWindowMs),
      ),
    peek: (key, windowMs) =>
      run(
        (reply) => {
          const [peeked, ttl] = replyItems(reply);
          return windowOf(peeked, ttl, windowMs);
        },
        PEEK_SCRIPT,
        [key],
        String(windowMs),
      ),
    acquire: (key, holder, max, ttlMs) =>
      run(
        (reply) => {
          if (reply !== 0 && reply !== 1) throw new RateLimitStoreError('malformed-reply');
          return reply === 1;
        },
        ACQUIRE_SCRIPT,
        [key],
        holder,
        String(max),
        String(ttlMs),
      ),
    release: (key, holder) => run(() => undefined, RELEASE_SCRIPT, [key], holder),
  };
}

/** Upper bound of the entries each in-memory map keeps (memory safety under a key flood; oldest-inserted entries go first). */
export const MEMORY_MAX_ENTRIES = 50_000;

/** The in-memory store: per instance, bounded (O(1) per new key, PR041-SEC-01), with the same window and slot semantics. */
export function createMemoryStore(now: () => number = Date.now, maxEntries: number = MEMORY_MAX_ENTRIES): RateLimitStore {
  const windows = new BoundedMap<string, { count: number; endsAt: number }>(maxEntries, (window) => window.endsAt <= now());
  const slots = new BoundedMap<string, Map<string, number>>(maxEntries, (held) => [...held.values()].every((at) => at <= now()));

  const count = (key: string, windowMs: number): WindowHit => {
    const t = now();
    let window = windows.get(key);
    if (window === undefined || window.endsAt <= t) {
      window = { count: 0, endsAt: t + windowMs };
      windows.set(key, window);
    }
    window.count += 1;
    return { count: window.count, resetMs: Math.max(window.endsAt - t, 1) };
  };
  const read = (key: string): WindowPeek => {
    const t = now();
    const window = windows.get(key);
    return window === undefined || window.endsAt <= t
      ? { count: 0, resetMs: 0 }
      : { count: window.count, resetMs: Math.max(window.endsAt - t, 1) };
  };

  return {
    hit: (key, windowMs) => Promise.resolve(count(key, windowMs)),
    hitAndPeek: (key, windowMs, peekKey) => Promise.resolve({ hit: count(key, windowMs), peek: read(peekKey) }),
    peek: (key) => Promise.resolve(read(key)),
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
