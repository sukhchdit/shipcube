/**
 * `compose.env` holds local-only values only (platform.md §1, §2.7; ADR-0018 amendment item 4; SEC-P3-08):
 * every secret is a visible `local-only-*` marker, the file starts the API and the worker with APP_ENV=local, and
 * the same values are refused with APP_ENV=staging (SEC-TC-51).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { ConfigValidationError, LOCAL_ONLY_PREFIX, loadConfig, parseSecretRef, SECRET_KEY_NAMES, SERVICES } from '@platform/config';
import { loadWebBuildConfig } from '@platform/config/web';

import { findRepoRoot } from '../test-support/process.js';
import { ALL_CONFIG_KEYS, parseEnvFile } from './env-file.js';

const compose = parseEnvFile(readFileSync(join(findRepoRoot(), 'compose.env'), 'utf8'));
const env = Object.fromEntries(compose.entries);

/** Variables named by the file's own `env:` secret references (the local values those references resolve to). */
const envRefTargets = [...compose.entries]
  .filter(([key]) => key.endsWith('_REF'))
  .map(([, value]) => parseSecretRef(value))
  .flatMap((result) => (result.ok && result.value.provider === 'env' ? [result.value.locator] : []));

describe('compose.env (local-only defaults)', () => {
  it('is well formed and holds only schema keys and the targets of its env references', () => {
    expect(compose.duplicates).toEqual([]);
    expect(compose.malformedLines).toEqual([]);
    const allowed = new Set([...ALL_CONFIG_KEYS, ...envRefTargets]);
    expect([...compose.entries.keys()].filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('[SEC-TC-51] every secret value is visibly marked local-only', () => {
    const secrets = [...SECRET_KEY_NAMES.filter((key) => !key.endsWith('_REF')), ...envRefTargets];
    for (const key of secrets) {
      const value = compose.entries.get(key);
      if (value !== undefined) expect({ key, marked: value.includes(LOCAL_ONLY_PREFIX) }).toEqual({ key, marked: true });
    }
  });

  it('never holds carrier-sandbox or Stripe credentials (platform.md §2.7)', () => {
    expect([...compose.entries.keys()].filter((key) => /^(?:STRIPE_|CARRIER_[A-Z]+_SECRET)/.test(key))).toEqual([]);
  });

  it.each(SERVICES)('[AT-US-002-01] starts %s with APP_ENV=local', (service) => {
    const config = loadConfig(env, { service });
    expect(config.APP_ENV).toBe('local');
    expect(config.MOCK_CARRIER_ENABLED).toBe(true);
    expect(config.CSRF_KEY?.localOnly).toBe(true);
  });

  it('[AT-US-002-04] the web build loads its public subset from the same file', () => {
    expect(loadWebBuildConfig(env).BRAND_NAME).toBe('Shipqube');
  });

  it('[SEC-TC-51] the same values are refused with APP_ENV=staging', () => {
    let error: unknown;
    try {
      loadConfig({ ...env, APP_ENV: 'staging' }, { service: 'worker' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    const placeholders = (error as ConfigValidationError).issues.filter((issue) => issue.code === 'placeholder').map((issue) => issue.key);
    expect(placeholders).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'JWT_SIGNING_KEYS', 'AUDIT_ANCHOR_SIGNING_KEY', 'SEED_SUPERADMIN_PASSWORD']),
    );
  });
});
