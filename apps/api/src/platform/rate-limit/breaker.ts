/**
 * The breaker of the rate-limit store (R1-m4, S4; ADR-0016 amendment 12 item 7; D-ARCH-177; rulings B3; TASK-041 part
 * 041-B). One per process: createRateLimitKit builds it and createApp hands it to the denial budget, so the limiter
 * (step 0, step 5, the stream slots, the failed-authentication budget) and the denial budget share it.
 *
 * - Closed: every call runs. A call that ends in a {@link RateLimitStoreError} (a timeout of the 250 ms bound, an
 *   unreachable store, a malformed reply) opens the breaker.
 * - Open: for `cooldownMs` (5 s) every call fails at once with `RateLimitStoreError('unavailable')` and the client is not
 *   touched, so each caller takes its fallback or fail-open path without a wait.
 * - After the cool-down exactly one call goes through as the probe; the others keep failing fast while it is in flight.
 *   Success closes the breaker; failure opens it for another cool-down.
 *
 * A brownout therefore costs one bounded wait per instance and cool-down, not one per request. The outage event is
 * unchanged (once a minute per scope, by the callers). The state becomes a gauge when TASK-214 exports the counters.
 */
import { RateLimitStoreError } from './store.js';

/** The cool-down of an open breaker (ADR-0016 amendment 12 item 7). */
export const BREAKER_COOLDOWN_MS = 5_000;

export type BreakerState = 'closed' | 'open' | 'probing';

export interface StoreBreaker {
  /** Runs one store call through the breaker; rejects at once with `RateLimitStoreError('unavailable')` while open. */
  run<T>(call: () => Promise<T>): Promise<T>;
  state(): BreakerState;
}

export interface StoreBreakerOptions {
  readonly now?: () => number;
  readonly cooldownMs?: number;
}

export function createStoreBreaker(options: StoreBreakerOptions = {}): StoreBreaker {
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? BREAKER_COOLDOWN_MS;
  let openedAt: number | undefined;
  let probing = false;

  /** Only a store failure opens the breaker; a late answer of a call that started before it opened does not close it. */
  const opening = (error: unknown): never => {
    if (error instanceof RateLimitStoreError) openedAt = now();
    throw error;
  };

  return {
    state: () => (openedAt === undefined ? 'closed' : probing ? 'probing' : 'open'),
    async run(call) {
      if (openedAt === undefined) return call().catch(opening);
      if (probing || now() - openedAt < cooldownMs) throw new RateLimitStoreError('unavailable');
      probing = true;
      try {
        const value = await call();
        openedAt = undefined;
        return value;
      } catch (error) {
        // Any failure of the probe opens the breaker for another cool-down.
        openedAt = now();
        throw error;
      } finally {
        probing = false;
      }
    },
  };
}
