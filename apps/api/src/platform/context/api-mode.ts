// ApiMode seam (US-035 AT-US-035-06, REQ-API-020; ADR-0016 §9). Every request context carries `apiMode`: `test` in
// every non-production environment, `live` only in production. M3 (API keys with `test_`/`live_` prefixes) will
// derive it from the key; until then it is a constant per process, chosen from APP_ENV at start-up.
import type { AppEnv } from '@platform/config';

export const API_MODES = ['test', 'live'] as const;
export type ApiMode = (typeof API_MODES)[number];

export function resolveApiMode(appEnv: AppEnv): ApiMode {
  return appEnv === 'production' ? 'live' : 'test';
}
