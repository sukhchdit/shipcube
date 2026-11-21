/**
 * The rate-limit engine (REQ-API-014, REQ-SEC-005, REQ-SEC-006, DR-A22, api/README §7; TASK-041): fixed-window rules
 * over a {@link RateLimitStore}. One request may consume several rules at once (a class with a minute and an hour
 * window); the headers describe the rule closest to exhaustion, a refusal the rule that was exceeded.
 *
 * Valkey outage (README §7, ADR-0016 §8 item 8): the security classes (`auth`, `email-send`) fall back to the
 * per-instance in-memory store with the same limits, the others fail open. Either way the outage is reported once a
 * minute per scope as the runtime security event `rate_limit_store_unavailable` (class-only fields, no host).
 */
import { createMemoryStore, type RateLimitStore } from './store.js';

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

export interface RateLimiter {
  consume(rules: readonly RateRule[], options: ConsumeOptions): Promise<RateDecision>;
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
  /** The per-instance store used while `store` fails (security classes); default a bounded in-memory store. */
  readonly fallback?: RateLimitStore;
  /** Reports an outage (already rate limited to once a minute per scope by {@link createOutageReporter}). */
  readonly onStoreUnavailable: (scope: string) => void;
}

const counterKey = (name: string, key: string): string => `rl:${name}:${key}`;

const closer = (a: RateReading, b: RateReading): boolean =>
  b.remaining < a.remaining || (b.remaining === a.remaining && b.resetSeconds < a.resetSeconds);

async function evaluate(store: RateLimitStore, rules: readonly RateRule[]): Promise<RateDecision> {
  let closest: RateReading | undefined;
  for (const rule of rules) {
    const { count, resetMs } = await store.hit(counterKey(rule.name, rule.key), rule.windowMs);
    const reading: RateReading = {
      rule: rule.name,
      limit: rule.limit,
      remaining: Math.max(rule.limit - count, 0),
      resetSeconds: Math.max(Math.ceil(resetMs / 1000), 1),
    };
    if (count > rule.limit) return { allowed: false, reading, retryAfterSeconds: reading.resetSeconds, first: count === rule.limit + 1 };
    if (closest === undefined || closer(closest, reading)) closest = reading;
  }
  return { allowed: true, reading: closest };
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
