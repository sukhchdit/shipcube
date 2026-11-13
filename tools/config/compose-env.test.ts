/**
 * The Compose environment holds local-only values only (platform.md §1, §2.7; ADR-0018 amendment item 4; SEC-P3-08):
 * every secret is a visible `local-only-*` marker, the merged api and worker environments start with APP_ENV=local,
 * and the same values are refused with APP_ENV=staging (SEC-TC-51).
 *
 * TASK-014 (PR13-SEC-08 / PR13-SEC-06 + PR3-SEC-06; WAVE-00 sheet line 534): the environment is partitioned per
 * service. compose.env is the shared api/worker runtime base, and compose.yaml gives every other value only to the
 * service that needs it (infra/local/env/<service>.env). The environments below are those compose.yaml builds for
 * each container (env files in order, then `environment`, host variables unset).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  ConfigValidationError,
  keysNotHeldBy,
  LOCAL_ONLY_PREFIX,
  loadConfig,
  parseSecretRef,
  SECRET_KEY_NAMES,
  SERVICES,
  TOOLING_KEY_NAMES,
} from '@platform/config';
import { loadWebBuildConfig } from '@platform/config/web';

import { environmentOf, envFilesOf, readCompose, readEnvFile, serviceEnvironment } from '../compose/compose-file.js';
import { ROLE_PASSWORD_MIN_LENGTH, scramSha256Verifier } from '../db/scram.js';
import { findRepoRoot } from '../test-support/process.js';
import { ALL_CONFIG_KEYS, parseEnvFile, TOOLING_SECRET_KEYS } from './env-file.js';

const root = findRepoRoot();
const composeFile = readCompose(root);
const serviceNames = Object.keys(composeFile.services);
const envOf = (service: string): Record<string, string> => serviceEnvironment(root, composeFile, service);

/** compose.env plus every infra/local/env/*.env file. */
const ENV_FILES = [
  'compose.env',
  ...readdirSync(join(root, 'infra/local/env'))
    .filter((name) => name.endsWith('.env'))
    .map((name) => `infra/local/env/${name}`),
];
const parsedFiles = new Map(ENV_FILES.map((file) => [file, parseEnvFile(readFileSync(join(root, file), 'utf8'))]));

/** Files read by a third-party image (not by packages/config) and the only keys each may hold. */
const IMAGE_ENV_KEYS: Readonly<Record<string, readonly string[]>> = {
  'infra/local/env/postgres.env': ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'],
  'infra/local/env/redis.env': ['REDIS_HEALTHCHECK_PASSWORD'],
  'infra/local/env/rustfs.env': ['RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY'],
};
const IMAGE_SECRET_KEYS = ['POSTGRES_PASSWORD', 'REDIS_HEALTHCHECK_PASSWORD', 'RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY'];

/** Variables named by the files' own `env:` secret references (the local values those references resolve to). */
const envRefTargets = [...parsedFiles.values()]
  .flatMap((file) => [...file.entries])
  .filter(([key]) => key.endsWith('_REF'))
  .map(([, value]) => parseSecretRef(value))
  .flatMap((result) => (result.ok && result.value.provider === 'env' ? [result.value.locator] : []));

const apiEnv = envOf('api');
const workerEnv = envOf('worker');
const runtimeEnv: Readonly<Record<string, Record<string, string>>> = { api: apiEnv, worker: workerEnv };

/** Services whose container environment holds a non-empty `key`, sorted. */
const holdersOf = (key: string): string[] => serviceNames.filter((service) => (envOf(service)[key] ?? '') !== '').sort();

const passwordOf = (url: string | undefined): string => decodeURIComponent(new URL(url ?? 'x://h').password);

describe('Compose environment files (local-only defaults)', () => {
  it('every env file is well formed and every one of them is used by compose.yaml', () => {
    for (const [file, parsed] of parsedFiles) {
      expect({ file, duplicates: parsed.duplicates, malformed: parsed.malformedLines }).toEqual({ file, duplicates: [], malformed: [] });
    }
    const used = new Set(Object.values(composeFile.services).flatMap((service) => envFilesOf(service)));
    expect(ENV_FILES.filter((file) => !used.has(file))).toEqual([]);
  });

  it('configuration files hold only schema keys and reference targets; image files only their own keys', () => {
    const allowed = new Set([...ALL_CONFIG_KEYS, ...envRefTargets]);
    for (const [file, parsed] of parsedFiles) {
      const keys = [...parsed.entries.keys()];
      const own = IMAGE_ENV_KEYS[file];
      const unknown = own === undefined ? keys.filter((key) => !allowed.has(key)) : keys.filter((key) => !own.includes(key));
      expect({ file, unknown }).toEqual({ file, unknown: [] });
    }
  });

  it('[SEC-TC-51] every secret value is visibly marked local-only', () => {
    const secrets = new Set([
      ...SECRET_KEY_NAMES.filter((key) => !key.endsWith('_REF')),
      ...TOOLING_SECRET_KEYS,
      ...envRefTargets,
      ...IMAGE_SECRET_KEYS,
    ]);
    for (const [file, parsed] of parsedFiles) {
      for (const [key, value] of parsed.entries) {
        if (secrets.has(key)) expect({ file, key, marked: value.includes(LOCAL_ONLY_PREFIX) }).toEqual({ file, key, marked: true });
        if (/^[a-z]+:\/\/[^/@]*:[^/@]*@/.test(value)) {
          expect({ file, key, marked: passwordOf(value).startsWith(LOCAL_ONLY_PREFIX) }).toEqual({ file, key, marked: true });
        }
      }
    }
  });

  it('[m9] the bootstrap passwords match the role passwords in the runtime and migrator URLs (PR-0005 §4 item 5)', () => {
    const bootstrap = envOf('bootstrap');
    expect(bootstrap['BOOTSTRAP_APP_PASSWORD']).toBe(passwordOf(apiEnv['DATABASE_URL']));
    expect(bootstrap['BOOTSTRAP_APP_PASSWORD']).toBe(passwordOf(workerEnv['DATABASE_URL']));
    expect(bootstrap['BOOTSTRAP_MIGRATOR_PASSWORD']).toBe(passwordOf(envOf('migrate')['DATABASE_MIGRATOR_URL']));
    expect(bootstrap['BOOTSTRAP_MIGRATOR_PASSWORD']).toBe(passwordOf(envOf('seed')['DATABASE_MIGRATOR_URL']));
  });

  it('[TASK-014] the bootstrap URL is the postgres superuser on the database the image creates', () => {
    const postgres = envOf('postgres');
    const url = new URL(envOf('bootstrap')['DATABASE_BOOTSTRAP_URL'] ?? 'x://h');
    expect(decodeURIComponent(url.username)).toBe(postgres['POSTGRES_USER']);
    expect(passwordOf(url.href)).toBe(postgres['POSTGRES_PASSWORD']);
    expect(url.pathname).toBe(`/${postgres['POSTGRES_DB'] ?? ''}`);
    expect(new URL(apiEnv['DATABASE_URL'] ?? 'x://h').pathname).toBe(url.pathname);
  });

  it('[TASK-003] the bootstrap passwords pass the SCRAM role-password rules that db:bootstrap enforces', () => {
    const bootstrap = envOf('bootstrap');
    for (const key of ['BOOTSTRAP_MIGRATOR_PASSWORD', 'BOOTSTRAP_APP_PASSWORD']) {
      const password = bootstrap[key] ?? '';
      expect({ key, long: password.length >= ROLE_PASSWORD_MIN_LENGTH }).toEqual({ key, long: true });
      expect(() => scramSha256Verifier(password)).not.toThrow();
    }
  });

  it('[m9] api and worker start without the tooling keys and never receive them', () => {
    for (const service of SERVICES) {
      const env = runtimeEnv[service] ?? {};
      expect(TOOLING_KEY_NAMES.filter((key) => key in env)).toEqual([]);
      const config = loadConfig(env, { service });
      expect(TOOLING_KEY_NAMES.filter((key) => key in config)).toEqual([]);
      expect(config.DB_POOL_MAX).toBe(service === 'api' ? 10 : 5);
    }
  });

  it('never holds carrier-sandbox or Stripe credentials; compose.yaml passes them by name only (platform.md §2.7)', () => {
    for (const [file, parsed] of parsedFiles) {
      const keys = [...parsed.entries.keys()].filter((key) => /^(?:STRIPE_|CARRIER_[A-Z]+_(?:CLIENT_)?SECRET)/.test(key));
      expect({ file, keys }).toEqual({ file, keys: [] });
    }
    for (const [name, service] of Object.entries(composeFile.services)) {
      for (const [key, value] of Object.entries(environmentOf(service))) {
        if (/^(?:STRIPE_|CARRIER_)/.test(key)) expect({ name, key, value }).toEqual({ name, key, value: `\${${key}:-}` });
      }
    }
  });

  it.each(SERVICES)('[AT-US-002-01] starts %s with APP_ENV=local from its merged Compose environment', (service) => {
    const config = loadConfig(runtimeEnv[service] ?? {}, { service });
    expect(config.APP_ENV).toBe('local');
    expect(config.MOCK_CARRIER_ENABLED).toBe(true);
    if (service === 'api') expect(config.CSRF_KEY?.localOnly).toBe(true);
  });

  it('[AT-US-002-04] the web build loads its public subset from compose.env', () => {
    expect(loadWebBuildConfig(Object.fromEntries(readEnvFile(root, 'compose.env'))).BRAND_NAME).toBe('Shipqube');
  });

  it('[SEC-TC-51] the same values are refused with APP_ENV=staging', () => {
    const placeholdersOf = (service: 'api' | 'worker'): string[] => {
      try {
        loadConfig({ ...runtimeEnv[service], APP_ENV: 'staging' }, { service });
      } catch (caught) {
        expect(caught).toBeInstanceOf(ConfigValidationError);
        return (caught as ConfigValidationError).issues.filter((issue) => issue.code === 'placeholder').map((issue) => issue.key);
      }
      throw new Error(`${service} loaded with APP_ENV=staging`);
    };
    expect(placeholdersOf('worker')).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'AUDIT_ANCHOR_SIGNING_KEY']));
    expect(placeholdersOf('api')).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'JWT_SIGNING_KEYS', 'CSRF_KEY']));
  });
});

describe('[PR13-SEC-08] [PR13-SEC-06] [PR3-SEC-06] per-service Compose environment partition (TASK-014)', () => {
  it.each([
    ['DATABASE_MIGRATOR_URL', ['migrate', 'seed']],
    ['DATABASE_BOOTSTRAP_URL', ['bootstrap']],
    ['BOOTSTRAP_MIGRATOR_PASSWORD', ['bootstrap']],
    ['BOOTSTRAP_APP_PASSWORD', ['bootstrap']],
    ['SEED_SUPERADMIN_PASSWORD', ['seed']],
    ['SEED_CUSTOMER_PASSWORD', ['seed']],
    ['AUDIT_ANCHOR_SIGNING_KEY', ['worker']],
    ['JWT_SIGNING_KEYS', ['api']],
    ['CSRF_KEY', ['api']],
    ['DATABASE_URL', ['api', 'worker']],
    ['POSTGRES_PASSWORD', ['postgres']],
    ['REDIS_HEALTHCHECK_PASSWORD', ['redis']],
    ['RUSTFS_SECRET_KEY', ['rustfs', 'storage-init']],
  ])('%s reaches exactly %j', (key, holders) => {
    expect(holdersOf(key)).toEqual([...holders].sort());
  });

  it('compose.env (the shared runtime base) is given to the api and the worker only', () => {
    const users = serviceNames.filter((service) => envFilesOf(composeFile.services[service] ?? {}).includes('compose.env'));
    expect(users.sort()).toEqual(['api', 'worker']);
  });

  it('compose.env holds no tooling key, no SEED_* key and no key the register gives to one runtime service only', () => {
    const base = Object.fromEntries(readEnvFile(root, 'compose.env'));
    expect(TOOLING_KEY_NAMES.filter((key) => key in base)).toEqual([]);
    expect(Object.keys(base).filter((key) => key.startsWith('SEED_'))).toEqual([]);
    expect([...keysNotHeldBy(base, 'api'), ...keysNotHeldBy(base, 'worker')]).toEqual([]);
    expect(['JWT_SIGNING_KEYS', 'REDIS_URL'].filter((key) => key in base)).toEqual([]);
  });

  it.each(SERVICES)(
    'the merged %s environment holds no key the register gives to another service (no "does not hold" warning)',
    (service) => {
      expect(keysNotHeldBy(runtimeEnv[service] ?? {}, service)).toEqual([]);
    },
  );

  it('api and worker connect to Valkey as their own ACL users (platform.md §2.2)', () => {
    expect(decodeURIComponent(new URL(apiEnv['REDIS_URL'] ?? 'x://h').username)).toBe('api');
    expect(decodeURIComponent(new URL(workerEnv['REDIS_URL'] ?? 'x://h').username)).toBe('worker');
  });

  it('the tooling one-shots run with APP_ENV=local, migrate and seed with NODE_ENV=development (D-TASK023-01 (02))', () => {
    for (const service of ['migrate', 'seed'])
      expect([envOf(service)['NODE_ENV'], envOf(service)['APP_ENV']]).toEqual(['development', 'local']);
    expect(envOf('bootstrap')['APP_ENV']).toBe('local');
  });
});
