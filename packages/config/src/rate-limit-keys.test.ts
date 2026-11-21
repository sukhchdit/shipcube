import { describe, expect, it } from '@jest/globals';

import { SERVICES } from './environment.js';
import { ConfigValidationError } from './errors.js';
import { loadConfig } from './load-config.js';
import type { CONFIG_SCHEMA } from './schema.js';
import { RATE_LIMIT_DEFAULTS } from './schema.js';
import { createTestEnv } from './testing/test-env.js';

/** The key of each entry of RATE_LIMIT_DEFAULTS (DR-A22, api/README §7, D-ARCH-142). */
const KEYS = {
  public: 'RATE_LIMIT_PUBLIC_PER_MIN',
  authIp: 'RATE_LIMIT_AUTH_PER_IP_PER_MIN',
  authAccount: 'RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN',
  authenticated: 'RATE_LIMIT_AUTHENTICATED_PER_MIN',
  webhook: 'RATE_LIMIT_WEBHOOK_PER_MIN',
  cspReport: 'RATE_LIMIT_CSP_REPORT_PER_MIN',
  publicQuoteMin: 'RATE_LIMIT_PUBLIC_QUOTE_PER_MIN',
  publicQuoteHour: 'RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR',
  publicTrackingMin: 'RATE_LIMIT_PUBLIC_TRACKING_PER_MIN',
  publicTrackingHour: 'RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR',
  emailAddress: 'RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR',
  emailIp: 'RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR',
  quoteUserMin: 'RATE_QUOTE_CREATE_PER_USER_PER_MIN',
  quoteUserHour: 'RATE_QUOTE_CREATE_PER_USER_PER_HOUR',
  quoteOrgHour: 'RATE_QUOTE_CREATE_PER_ORG_PER_HOUR',
  streamsIp: 'SSE_MAX_STREAMS_PER_IP',
  streamsUser: 'SSE_MAX_STREAMS_PER_USER',
  authzDenial: 'AUTHZ_DENIAL_BUDGET_PER_MIN',
} as const satisfies Record<keyof typeof RATE_LIMIT_DEFAULTS, keyof typeof CONFIG_SCHEMA>;

const entries = Object.entries(KEYS) as [keyof typeof RATE_LIMIT_DEFAULTS, (typeof KEYS)[keyof typeof KEYS]][];

describe('[US-040] [D-ARCH-142] rate-limit configuration keys', () => {
  it('every default of RATE_LIMIT_DEFAULTS has exactly one schema key, and the DR-A22 values are the defaults', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(Object.keys(RATE_LIMIT_DEFAULTS).sort());
    for (const service of SERVICES) {
      const config = loadConfig(createTestEnv(), { service });
      for (const [name, key] of entries) expect(config[key]).toBe(RATE_LIMIT_DEFAULTS[name].value);
    }
    expect(Object.fromEntries(entries.map(([name, key]) => [key, RATE_LIMIT_DEFAULTS[name].value]))).toMatchObject({
      RATE_LIMIT_PUBLIC_PER_MIN: 120,
      RATE_LIMIT_AUTH_PER_IP_PER_MIN: 10,
      RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN: 5,
      RATE_LIMIT_AUTHENTICATED_PER_MIN: 600,
      RATE_LIMIT_CSP_REPORT_PER_MIN: 20,
      RATE_QUOTE_CREATE_PER_USER_PER_MIN: 30,
      RATE_QUOTE_CREATE_PER_USER_PER_HOUR: 300,
      RATE_QUOTE_CREATE_PER_ORG_PER_HOUR: 1_000,
      SSE_MAX_STREAMS_PER_IP: 2,
      SSE_MAX_STREAMS_PER_USER: 5,
      AUTHZ_DENIAL_BUDGET_PER_MIN: 20,
    });
  });

  it('AUTHZ_DENIAL_BUDGET_PER_MIN accepts 1 and 600 (D-ARCH-142: validated 1..600)', () => {
    for (const value of ['1', '600']) {
      const config = loadConfig({ ...createTestEnv(), AUTHZ_DENIAL_BUDGET_PER_MIN: value }, { service: 'api' });
      expect(config.AUTHZ_DENIAL_BUDGET_PER_MIN).toBe(Number(value));
    }
  });

  it.each([
    ['0', 'number.min'],
    ['601', 'number.max'],
    ['-1', 'number.min'],
    ['2.5', 'number.integer'],
    ['twenty', 'number.base'],
  ])('AUTHZ_DENIAL_BUDGET_PER_MIN=%s is rejected (%s)', (value, rule) => {
    const run = (): unknown => loadConfig({ ...createTestEnv(), AUTHZ_DENIAL_BUDGET_PER_MIN: value }, { service: 'api' });
    expect(run).toThrow(ConfigValidationError);
    try {
      run();
    } catch (error) {
      expect((error as ConfigValidationError).issues).toEqual([{ key: 'AUTHZ_DENIAL_BUDGET_PER_MIN', code: 'invalid', rule }]);
    }
  });

  it.each(entries.map(([name, key]) => [key, RATE_LIMIT_DEFAULTS[name].max] as const))(
    '%s rejects 0 and a value above its bound %i',
    (key, max) => {
      for (const value of ['0', String(max + 1)]) {
        expect(() => loadConfig({ ...createTestEnv(), [key]: value }, { service: 'api' })).toThrow(ConfigValidationError);
      }
      expect(loadConfig({ ...createTestEnv(), [key]: String(max) }, { service: 'api' })[key]).toBe(max);
    },
  );
});
