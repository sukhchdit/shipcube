/**
 * TRUST_PROXY_HOPS (ADR-0016 am. 12 item 9; D-ARCH-179; PR041-SEC-05; TASK-041): the default is 0 (trust no proxy), and
 * the API refuses to start in staging and production unless the value is set and at least 1. Local and test accept an
 * unset value and 0; the worker does not read the key.
 */
import { describe, expect, it } from '@jest/globals';

import { ConfigValidationError } from './errors.js';
import { loadConfig } from './load-config.js';
import { createTestEnv } from './testing/index.js';

const without = (env: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([name]) => name !== key));

function issuesOf(env: Record<string, string>, service: 'api' | 'worker' = 'api'): unknown {
  try {
    loadConfig(env, { service });
    return [];
  } catch (error) {
    if (error instanceof ConfigValidationError) return error.issues;
    throw error;
  }
}

describe('[PR041-SEC-05] TRUST_PROXY_HOPS', () => {
  it('defaults to 0 (the socket peer is the client)', () => {
    expect(
      loadConfig(without(createTestEnv({ appEnv: 'local', service: 'api' }), 'TRUST_PROXY_HOPS'), { service: 'api' }).TRUST_PROXY_HOPS,
    ).toBe(0);
  });

  it.each(['staging', 'production'] as const)('%s: an unset value is missing for the api', (appEnv) => {
    const env = createTestEnv({ appEnv, service: 'api' });
    expect(issuesOf(without(env, 'TRUST_PROXY_HOPS'))).toEqual([{ key: 'TRUST_PROXY_HOPS', code: 'missing' }]);
  });

  it.each(['staging', 'production'] as const)('%s: 0 is forbidden-in-environment (rule trustProxy.hops) for the api', (appEnv) => {
    const env = { ...createTestEnv({ appEnv, service: 'api' }), TRUST_PROXY_HOPS: '0' };
    expect(issuesOf(env)).toEqual([{ key: 'TRUST_PROXY_HOPS', code: 'forbidden-in-environment', rule: 'trustProxy.hops' }]);
  });

  it.each(['1', '2', '5'])('staging accepts %s hops', (hops) => {
    const env = { ...createTestEnv({ appEnv: 'staging', service: 'api' }), TRUST_PROXY_HOPS: hops };
    expect(issuesOf(env)).toEqual([]);
    expect(loadConfig(env, { service: 'api' }).TRUST_PROXY_HOPS).toBe(Number(hops));
  });

  it.each(['local', 'test'] as const)('%s accepts an unset value and 0', (appEnv) => {
    const env = createTestEnv({ appEnv, service: 'api' });
    expect(issuesOf(without(env, 'TRUST_PROXY_HOPS'))).toEqual([]);
    expect(issuesOf({ ...env, TRUST_PROXY_HOPS: '0' })).toEqual([]);
  });

  it('the worker does not need the key in staging', () => {
    const env = without(createTestEnv({ appEnv: 'staging', service: 'worker' }), 'TRUST_PROXY_HOPS');
    expect(issuesOf(env, 'worker')).toEqual([]);
  });

  it('a value above 5 is invalid in every environment', () => {
    expect(issuesOf({ ...createTestEnv(), TRUST_PROXY_HOPS: '6' })).toEqual([
      { key: 'TRUST_PROXY_HOPS', code: 'invalid', rule: 'number.max' },
    ]);
  });
});
