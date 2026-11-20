/**
 * TASK-075 (ADR-0010 am. 11 item 6, CLAUDE.md §5): `packages/config` refuses a carrier account with
 * environment = production unless APP_ENV = production. Before G4 the schema is stricter still: `CARRIER_*_ENVIRONMENT`
 * admits `sandbox` only, so production is refused in every APP_ENV (relaxed only by a G4-approved change, OI-24).
 */
import { describe, expect, it } from '@jest/globals';

import type { AppEnv } from './environment.js';
import { ConfigValidationError } from './errors.js';
import { loadConfig } from './load-config.js';
import { createTestEnv } from './testing/test-env.js';

const CARRIERS = ['DHL', 'FEDEX', 'UPS'] as const;
const APP_ENVS: readonly AppEnv[] = ['local', 'test', 'staging', 'production'];

function issuesOf(env: Record<string, string | undefined>): readonly { key: string; code: string }[] {
  try {
    loadConfig(env, { service: 'api' });
    return [];
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) throw error;
    return error.issues;
  }
}

describe('carrier account environment (CLAUDE.md §5)', () => {
  it.each(APP_ENVS.flatMap((appEnv) => CARRIERS.map((carrier) => [appEnv, carrier] as const)))(
    'APP_ENV=%s refuses CARRIER_%s_ENVIRONMENT=production',
    (appEnv, carrier) => {
      const env = {
        ...createTestEnv({ appEnv }),
        [`CARRIER_${carrier}_ENABLED`]: 'true',
        [`CARRIER_${carrier}_SECRET_REF`]: `env:CARRIER_${carrier}_SANDBOX`,
        [`CARRIER_${carrier}_ENVIRONMENT`]: 'production',
      };
      expect(issuesOf(env)).toContainEqual(expect.objectContaining({ key: `CARRIER_${carrier}_ENVIRONMENT`, code: 'invalid' }));
    },
  );

  it.each(CARRIERS)('a sandbox account of %s raises no environment issue', (carrier) => {
    const env = {
      ...createTestEnv(),
      [`CARRIER_${carrier}_ENABLED`]: 'true',
      [`CARRIER_${carrier}_SECRET_REF`]: `env:CARRIER_${carrier}_SANDBOX`,
      [`CARRIER_${carrier}_ENVIRONMENT`]: 'sandbox',
    };
    expect(issuesOf(env).filter(({ key }) => key === `CARRIER_${carrier}_ENVIRONMENT`)).toEqual([]);
  });
});
