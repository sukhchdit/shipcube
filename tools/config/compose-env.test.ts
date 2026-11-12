/**
 * `compose.env` holds local-only values only (platform.md §1, §2.7; ADR-0018 amendment item 4; SEC-P3-08):
 * every secret is a visible `local-only-*` marker, the file starts the API and the worker with APP_ENV=local, and
 * the same values are refused with APP_ENV=staging (SEC-TC-51).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  ConfigValidationError,
  LOCAL_ONLY_PREFIX,
  loadConfig,
  parseSecretRef,
  SECRET_KEY_NAMES,
  SERVICES,
  TOOLING_KEY_NAMES,
} from '@platform/config';
import { loadWebBuildConfig } from '@platform/config/web';

import { ROLE_PASSWORD_MIN_LENGTH, scramSha256Verifier } from '../db/scram.js';
import { findRepoRoot } from '../test-support/process.js';
import { ALL_CONFIG_KEYS, parseEnvFile, TOOLING_SECRET_KEYS } from './env-file.js';

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
    const secrets = [...SECRET_KEY_NAMES.filter((key) => !key.endsWith('_REF')), ...TOOLING_SECRET_KEYS, ...envRefTargets];
    for (const key of secrets) {
      const value = compose.entries.get(key);
      if (value !== undefined) expect({ key, marked: value.includes(LOCAL_ONLY_PREFIX) }).toEqual({ key, marked: true });
    }
  });

  it('[m9] the bootstrap passwords match the role passwords in the runtime and migrator URLs (PR-0005 §4 item 5)', () => {
    const passwordOf = (key: string): string => decodeURIComponent(new URL(compose.entries.get(key) ?? 'x://h').password);
    expect(compose.entries.get('BOOTSTRAP_APP_PASSWORD')).toBe(passwordOf('DATABASE_URL'));
    expect(compose.entries.get('BOOTSTRAP_MIGRATOR_PASSWORD')).toBe(passwordOf('DATABASE_MIGRATOR_URL'));
  });

  it('[TASK-003] the bootstrap passwords pass the SCRAM role-password rules that db:bootstrap enforces', () => {
    for (const key of ['BOOTSTRAP_MIGRATOR_PASSWORD', 'BOOTSTRAP_APP_PASSWORD']) {
      const password = compose.entries.get(key) ?? '';
      expect({ key, long: password.length >= ROLE_PASSWORD_MIN_LENGTH }).toEqual({ key, long: true });
      expect(() => scramSha256Verifier(password)).not.toThrow();
    }
  });

  it('[m9] api and worker start without the tooling keys and never expose them', () => {
    for (const service of SERVICES) {
      const config = loadConfig(env, { service });
      expect(TOOLING_KEY_NAMES.filter((key) => key in config)).toEqual([]);
      expect(config.DB_POOL_MAX).toBe(service === 'api' ? 10 : 5);
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
