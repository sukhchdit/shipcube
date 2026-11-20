/**
 * The rate-limit counter metric (T-39, D-SECT39-01 item 4; README §7): refusals per rate class, kept in process until
 * the metrics pipeline exports it (the same pattern as `sessionContextLeaks()` of the database runtime). Its ONLY label
 * is the class or budget name: never an organisation, actor, IP or route, so an attacker cannot grow the series.
 * The export owner is TASK-214 (metrics pipeline). `authz-denial` is the denial budget's name; it is not a route rate class (no `x-rate-limit-class` value).
 */
import type { RateLimitClass } from '../routing/define-route.js';

export const AUTHZ_DENIAL_BUDGET = 'authz-denial';
export type RateLimitLabel = RateLimitClass | typeof AUTHZ_DENIAL_BUDGET | 'unauthenticated' | 'step0-credentialed';

export interface RateLimitCounter {
  /** Counts one refused request (429) under `label`. */
  refused(label: RateLimitLabel): void;
  /** A copy of the counts, by label. */
  snapshot(): Readonly<Record<string, number>>;
}

export function createRateLimitCounter(): RateLimitCounter {
  const counts = new Map<string, number>();
  return {
    refused(label) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    },
    snapshot: () => Object.fromEntries(counts),
  };
}
