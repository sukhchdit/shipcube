/**
 * Composition of the rate limiter (TASK-041): the Valkey store over the runtime's client, the limiter with its
 * per-instance fallback, the outage report (once a minute per scope) and the counter. createApp calls it from the
 * `rateLimit` dependency startApi passes; the denial budget is composed separately by the pipeline (it travels with the
 * audit capture, D-SECT39-01 item 6).
 */
import type { SecurityEventSink } from '@platform/shared/logging';

import { createRateLimitCounter, type RateLimitCounter } from './counter.js';
import { createOutageReporter, createRateLimiter } from './limiter.js';
import type { RateLimitKit } from './limits.js';
import type { RateLimitSettings } from './policy.js';
import { createMemoryStore, createValkeyStore, type ScriptClient } from './store.js';

/** What createApp needs to build the limiters (startApi passes the process's Valkey client and configuration). */
export interface RateLimitDependencies {
  readonly settings: RateLimitSettings & { readonly AUTHZ_DENIAL_BUDGET_PER_MIN: number };
  /** The shared Valkey client; absent (tests) the counters are per instance. */
  readonly valkey?: ScriptClient | undefined;
  /** The refusal counter (tests read it); default a fresh one. The export owner is TASK-214. */
  readonly counter?: RateLimitCounter | undefined;
}

export function createRateLimitKit(
  deps: RateLimitDependencies,
  events: SecurityEventSink,
  counter: RateLimitCounter = deps.counter ?? createRateLimitCounter(),
): RateLimitKit {
  const report = createOutageReporter((scope) => events.emit('rate_limit_store_unavailable', { store: 'valkey', scope }));
  return {
    limiter: createRateLimiter({
      store: deps.valkey === undefined ? createMemoryStore() : createValkeyStore(deps.valkey),
      onStoreUnavailable: report,
    }),
    settings: deps.settings,
    counter,
    events,
  };
}

/** The outage reporter of the denial budget (same event, scope `authz-denial`, same once-a-minute rule). */
export function denialOutageReporter(events: SecurityEventSink): (scope: string) => void {
  return createOutageReporter((scope) => events.emit('rate_limit_store_unavailable', { store: 'valkey', scope }));
}
