/**
 * TASK-014 configuration items:
 *  - CONFIG HALF OF PR30-SEC-04 AND PR30-SEC-11 (D-ARCH-100 item 1): credentialPairGuard over CREDENTIAL_PAIRS and the
 *    STORAGE_PUBLIC_ENDPOINT companion rule, through loadConfig and loadRuntimeConfigOrExit (exit 78, keys only);
 *  - PR20-SEC-04 item 2: APP_LOG_LEVEL floor in staging and production;
 *  - PR #9 code review R3-m1 / PR #11 code review R3-m2: the DATABASE_URL TLS-selector value predicate.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { afterAll, describe, expect, it } from '@jest/globals';

import type { AppEnv } from './environment.js';
import { ConfigValidationError } from './errors.js';
import { CREDENTIAL_PAIRS, credentialPairGuard, hasValidDatabaseUrlParamValues, logLevelGuard } from './guards.js';
import { loadConfig } from './load-config.js';
import { CONFIG_EXIT_CODE, loadRuntimeConfigOrExit, type StartupIo } from './process-env.js';
import { createTestEnv } from './testing/index.js';

const ACCESS = 'STORAGE_ACCESS_KEY_ID_REF';
const SECRET = 'STORAGE_SECRET_ACCESS_KEY_REF';

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function captureIo(): StartupIo & { readonly written: string[] } {
  const written: string[] = [];
  return {
    written,
    stderr: { write: (chunk: string) => written.push(chunk) },
    exit: (code: number) => {
      throw new ExitCalled(code);
    },
  };
}

const runtime = { execArgv: [], inspectorActive: () => false };

const issuesOf = (env: Record<string, string>, service: 'api' | 'worker' = 'api') => {
  try {
    loadConfig(env, { service });
    return [];
  } catch (error) {
    if (error instanceof ConfigValidationError) return error.issues;
    throw error;
  }
};

describe('credentialPairGuard (D-ARCH-100 item 1)', () => {
  const pair = (appEnv: AppEnv, raw: Record<string, string>) => credentialPairGuard({ raw, values: raw, appEnv });

  it('holds the storage pair; TASK-116 appends the anchor-sink pair', () => {
    expect(CREDENTIAL_PAIRS.map(({ keys }) => keys)).toEqual([[ACCESS, SECRET]]);
  });

  it.each(['local', 'test'] as const)('%s: both or neither are consistent; exactly one is inconsistent on that key', (appEnv) => {
    expect(pair(appEnv, {})).toEqual([]);
    expect(pair(appEnv, { [ACCESS]: 'env:A', [SECRET]: 'env:B' })).toEqual([]);
    expect(pair(appEnv, { [ACCESS]: 'env:A' })).toEqual([{ key: ACCESS, code: 'inconsistent', rule: 'storage.credentialPair' }]);
    expect(pair(appEnv, { [SECRET]: 'env:B' })).toEqual([{ key: SECRET, code: 'inconsistent', rule: 'storage.credentialPair' }]);
  });

  it.each(['staging', 'production'] as const)('%s: every configured reference is forbidden (no override switch)', (appEnv) => {
    expect(pair(appEnv, {})).toEqual([]);
    expect(pair(appEnv, { [ACCESS]: 'file:a', [SECRET]: 'file:b' })).toEqual([
      { key: ACCESS, code: 'forbidden-in-environment', rule: 'storage.staticCredentials' },
      { key: SECRET, code: 'forbidden-in-environment', rule: 'storage.staticCredentials' },
    ]);
    expect(pair(appEnv, { [SECRET]: 'file:b' })).toEqual([
      { key: SECRET, code: 'forbidden-in-environment', rule: 'storage.staticCredentials' },
    ]);
  });
});

describe('STORAGE_PUBLIC_ENDPOINT companion (D-ARCH-100 item 1)', () => {
  it.each(['test', 'staging'] as const)('%s: STORAGE_ENDPOINT without STORAGE_PUBLIC_ENDPOINT is missing', (appEnv) => {
    const scheme = appEnv === 'test' ? 'http' : 'https';
    const env = { ...createTestEnv({ appEnv, service: 'api' }), STORAGE_ENDPOINT: `${scheme}://store.internal:9000` };
    expect(issuesOf(env)).toEqual([{ key: 'STORAGE_PUBLIC_ENDPOINT', code: 'missing' }]);
    expect(issuesOf({ ...env, STORAGE_PUBLIC_ENDPOINT: `${scheme}://store.example.test` })).toEqual([]);
  });
});

describe('logLevelGuard (PR20-SEC-04 item 2)', () => {
  it.each(['error', 'fatal', 'silent'])('[PR20-SEC-04] refuses APP_LOG_LEVEL=%s in production, keeps it in local and test', (level) => {
    const guard = (appEnv: AppEnv) => logLevelGuard({ raw: {}, values: { APP_LOG_LEVEL: level }, appEnv });
    expect(guard('production')).toEqual([{ key: 'APP_LOG_LEVEL', code: 'forbidden-in-environment', rule: 'logLevel.floor' }]);
    expect(guard('staging')).toHaveLength(1);
    expect(guard('local')).toEqual([]);
    expect(guard('test')).toEqual([]);
  });

  it('[PR20-SEC-04] APP_LOG_LEVEL=silent with APP_ENV=production is refused by loadConfig; warn is accepted', () => {
    const env = createTestEnv({ appEnv: 'production', service: 'api' });
    expect(issuesOf({ ...env, APP_LOG_LEVEL: 'silent' })).toEqual([
      { key: 'APP_LOG_LEVEL', code: 'forbidden-in-environment', rule: 'logLevel.floor' },
    ]);
    expect(issuesOf({ ...env, APP_LOG_LEVEL: 'warn' })).toEqual([]);
  });
});

describe('DATABASE_URL TLS-selector values (PR #9 R3-m1, PR #11 R3-m2)', () => {
  const url = (query: string) => new URL(`postgresql://u:p@db.test:5432/platform${query}`);

  it.each([
    '',
    '?sslmode=disable',
    '?sslmode=verify-full',
    '?sslmode=require&sslnegotiation=direct',
    '?sslnegotiation=direct',
    '?sslrootcert=/etc/ssl/rds/global-bundle.pem',
    '?sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Fca.pem&sslnegotiation=postgres',
  ])('accepts %p', (query) => {
    expect(hasValidDatabaseUrlParamValues(url(query))).toBe(true);
  });

  it.each([
    '?sslmode=no-verify',
    '?sslmode=bogus',
    '?sslmode=VERIFY-FULL',
    '?sslnegotiation=fast',
    '?sslmode=disable&sslnegotiation=direct',
    '?sslrootcert=system',
    '?sslrootcert=relative/ca.pem',
    '?sslrootcert=',
    '?sslmode=%6Eo-verify',
  ])('refuses %p', (query) => {
    expect(hasValidDatabaseUrlParamValues(url(query))).toBe(false);
  });

  it('loadConfig names DATABASE_URL with the value rule, never the value', () => {
    const env = createTestEnv({ service: 'api' });
    const value = env.DATABASE_URL?.replace('sslmode=disable', 'sslmode=no-verify') ?? '';
    const issues = issuesOf({ ...env, DATABASE_URL: value });
    expect(issues).toEqual([{ key: 'DATABASE_URL', code: 'invalid', rule: 'databaseUrl.parameterValue' }]);
    expect(JSON.stringify(issues)).not.toContain('no-verify');
  });
});

describe('loadConfig / loadRuntimeConfigOrExit with the TASK-014 rules (exit 78, keys only)', () => {
  const dirs: string[] = [];
  const cwd = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'config-t014-'));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const expectExit78 = async (
    service: 'api' | 'worker',
    env: Record<string, string>,
    lines: readonly string[],
    hidden: readonly string[],
  ) => {
    const io = captureIo();
    await expect(loadRuntimeConfigOrExit(service, { env, cwd: cwd(), io, runtime })).rejects.toThrow(new ExitCalled(CONFIG_EXIT_CODE));
    const stderr = io.written.join('');
    for (const line of lines) expect(stderr).toContain(line);
    for (const value of hidden) expect(stderr).not.toContain(value);
  };

  it('[PR30-SEC-11] one storage reference exits 78 with the key name and no value @security', async () => {
    const variable = `T014_${randomBytes(4).toString('hex').toUpperCase()}`;
    const env = { ...createTestEnv({ service: 'worker' }), [ACCESS]: `env:${variable}`, [variable]: `v-${randomBytes(8).toString('hex')}` };
    await expectExit78('worker', env, [`${ACCESS}: inconsistent: storage.credentialPair`], [variable, env[variable] ?? '']);
  });

  it('[PR30-SEC-04] both references with APP_ENV=production exit 78 @security', async () => {
    const env = {
      ...createTestEnv({ appEnv: 'production', service: 'api' }),
      [ACCESS]: 'file:storage/id',
      [SECRET]: 'file:storage/secret',
    };
    await expectExit78(
      'api',
      env,
      [`${ACCESS}: forbidden-in-environment: storage.staticCredentials`, `${SECRET}: forbidden-in-environment: storage.staticCredentials`],
      ['storage/id', 'storage/secret'],
    );
  });

  it('[D-ARCH-100] STORAGE_ENDPOINT without STORAGE_PUBLIC_ENDPOINT exits 78', async () => {
    const env = { ...createTestEnv({ service: 'api' }), STORAGE_ENDPOINT: 'http://rustfs:9000' };
    await expectExit78('api', env, ['STORAGE_PUBLIC_ENDPOINT: missing'], ['rustfs:9000']);
  });

  it('[D-ARCH-100] the Compose environment (both endpoints, both references, local-only values) loads cleanly', async () => {
    // The api container's environment: the shared runtime base plus the api's own file (TASK-014 per-service split;
    // compose.yaml api env_file order).
    const compose = ['compose.env', 'infra/local/env/api.env'].reduce<Record<string, string | undefined>>(
      (merged, file) => ({ ...merged, ...parseEnv(readFileSync(join(resolve(process.cwd()), file), 'utf8')) }),
      {},
    );
    const env = Object.fromEntries(Object.entries(compose).filter((entry): entry is [string, string] => entry[1] !== undefined));
    expect(env.STORAGE_ENDPOINT).toBeDefined();
    expect(env.STORAGE_PUBLIC_ENDPOINT).toBeDefined();
    expect(env[ACCESS]).toBeDefined();
    expect(env[SECRET]).toBeDefined();
    const io = captureIo();
    const { config, secrets } = await loadRuntimeConfigOrExit('api', { env, cwd: cwd(), io, runtime });
    expect(config.STORAGE_PUBLIC_ENDPOINT).toBe(env.STORAGE_PUBLIC_ENDPOINT);
    expect([...secrets.keys()].filter((key) => key.startsWith('STORAGE_')).sort()).toEqual([ACCESS, SECRET]);
  });

  it('[D-ARCH-100] an AWS-shaped environment (neither endpoint, neither reference) loads cleanly', () => {
    const env = createTestEnv({ appEnv: 'production', service: 'worker' });
    expect(
      Object.keys(env).filter(
        (key) => key.startsWith('STORAGE_') && key !== 'STORAGE_BUCKET_DOCUMENTS' && key !== 'STORAGE_BUCKET_RAW_CARRIER_PAYLOADS',
      ),
    ).toEqual([]);
    // loadConfig: the production Stripe references point at AWS Secrets Manager, which has no provider in a unit test.
    expect(issuesOf(env, 'worker')).toEqual([]);
  });
});
