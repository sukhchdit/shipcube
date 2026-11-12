import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { holderIssues, keysNotHeldBy } from './holders.js';
import { CONFIG_EXIT_CODE, loadRuntimeConfigOrExit, type StartupIo } from './process-env.js';
import { CONFIG_KEY_NAMES } from './schema.js';
import type { SecretProvider } from './secret-refs.js';
import { createTestEnv } from './testing/index.js';

const repoRoot = resolve(process.cwd());
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const fixture = join(repoRoot, 'packages', 'config', 'src', 'fixtures', 'start-runtime-service.ts');

/** Starts the fixture like a service entry point, without a shell and with only the test's configuration keys. */
function runService(
  service: string,
  config: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFIG_KEY_NAMES) delete env[name];
  for (const [name, value] of Object.entries(config)) if (value !== undefined) env[name] = value;
  const result = spawnSync(process.execPath, [tsxCli, fixture, service], {
    cwd: dirname(fixture),
    env,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

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
const randomVar = (): string => `RUNTIME_SECRET_${randomBytes(4).toString('hex').toUpperCase()}`;

describe('loadRuntimeConfigOrExit (PR3-SEC-05, PR3-SEC-06)', () => {
  const dirs: string[] = [];
  const cwd = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'config-runtime-'));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('returns the config and the resolved secrets of every *_REF key', async () => {
    const variable = randomVar();
    const value = `rk_test_${randomBytes(12).toString('hex')}`;
    const env = { ...createTestEnv({ service: 'api' }), STRIPE_SECRET_KEY_REF: `env:${variable}`, [variable]: value };
    const io = captureIo();
    const { config, secrets } = await loadRuntimeConfigOrExit('api', { env, cwd: cwd(), io, runtime });
    expect(config.APP_ENV).toBe('test');
    expect(secrets.get('STRIPE_SECRET_KEY_REF')?.reveal()).toBe(value);
    expect(io.written).toEqual([]);
  });

  it('[PR3-SEC-05] a live Stripe key behind a reference exits 78 naming the key, never the value @security', async () => {
    const variable = randomVar();
    const value = `sk_live_${randomBytes(12).toString('hex')}`;
    const env = { ...createTestEnv({ appEnv: 'staging', service: 'api' }), STRIPE_SECRET_KEY_REF: `env:${variable}`, [variable]: value };
    const io = captureIo();
    await expect(loadRuntimeConfigOrExit('api', { env, cwd: cwd(), io, runtime })).rejects.toThrow(new ExitCalled(CONFIG_EXIT_CODE));
    expect(io.written.join('')).toContain('STRIPE_SECRET_KEY_REF: live-key-forbidden');
    expect(io.written.join('')).not.toContain(value);
  });

  it('[PR3-SEC-05] an unresolvable reference exits 78 with the failure class', async () => {
    const env = { ...createTestEnv({ service: 'worker' }), STORAGE_ACCESS_KEY_ID_REF: `env:${randomVar()}` };
    const io = captureIo();
    await expect(loadRuntimeConfigOrExit('worker', { env, cwd: cwd(), io, runtime })).rejects.toThrow(new ExitCalled(CONFIG_EXIT_CODE));
    expect(io.written.join('')).toContain('STORAGE_ACCESS_KEY_ID_REF: unresolvable: ref.notFound');
  });

  it('uses the injected providers and resolve budgets', async () => {
    const provider: SecretProvider = {
      kind: 'aws-secrets-manager',
      resolve: () => Promise.resolve(`rk_test_${randomBytes(6).toString('hex')}`),
    };
    const env = { ...createTestEnv({ service: 'api' }), STRIPE_SECRET_KEY_REF: 'aws-secrets-manager:stripe/restricted-key' };
    const result = await loadRuntimeConfigOrExit('api', {
      env,
      cwd: cwd(),
      io: captureIo(),
      runtime,
      providers: [provider],
      resolve: { timeoutMs: 50 },
    });
    expect(result.secrets.size).toBe(1);
  });

  it('rejects a schema failure before resolving anything', async () => {
    const io = captureIo();
    const env = { ...createTestEnv(), DB_STATEMENT_TIMEOUT_MS: '0' };
    await expect(loadRuntimeConfigOrExit('api', { env, cwd: cwd(), io, runtime })).rejects.toThrow(new ExitCalled(CONFIG_EXIT_CODE));
    expect(io.written.join('')).toContain('DB_STATEMENT_TIMEOUT_MS: invalid: number.min');
  });

  it('rethrows errors that are not configuration errors', async () => {
    const provider: SecretProvider = { kind: 'env', resolve: () => Promise.resolve('x') };
    const env = createTestEnv({ service: 'api' });
    const io: StartupIo = {
      stderr: { write: () => true },
      exit: () => {
        throw new RangeError('exit seam');
      },
    };
    await expect(
      loadRuntimeConfigOrExit('api', { env: { ...env, APP_ENV: 'nope' }, cwd: cwd(), io, runtime, providers: [provider] }),
    ).rejects.toThrow(RangeError);
  });

  describe('register holders (PR3-SEC-06, PR-0003 code review m5)', () => {
    it('lists the register keys a service does not hold', () => {
      const env = createTestEnv();
      expect(keysNotHeldBy(env, 'api')).toEqual(['AUDIT_ANCHOR_SIGNING_KEY']);
      expect(keysNotHeldBy(env, 'worker')).toEqual(expect.arrayContaining(['CSRF_KEY', 'LOGIN_COUNTER_KEY', 'MFA_ENCRYPTION_KEY']));
      expect(keysNotHeldBy({ ...env, CSRF_KEY_PREVIOUS: env.CSRF_KEY, CSRF_KEY: '' }, 'worker')).toContain('CSRF_KEY_PREVIOUS');
      expect(keysNotHeldBy(createTestEnv({ service: 'worker' }), 'worker')).toEqual([]);
      expect(holderIssues(env, 'api', 'test')).toEqual([]);
    });

    it.each([
      ['api', 'AUDIT_ANCHOR_SIGNING_KEY'],
      ['worker', 'CSRF_KEY'],
    ] as const)('[PR3-SEC-06] staging %s refuses %s (exit 78, name only) @security', async (service, key) => {
      const io = captureIo();
      const env = { ...createTestEnv({ appEnv: 'staging', service }), [key]: createTestEnv()[key] };
      await expect(loadRuntimeConfigOrExit(service, { env, cwd: cwd(), io, runtime })).rejects.toThrow(new ExitCalled(CONFIG_EXIT_CODE));
      const stderr = io.written.join('');
      expect(stderr).toContain(`${key}: forbidden-for-service: holders.${service}`);
      expect(stderr).not.toContain(String(env[key]));
    });

    it.each(['DATABASE_MIGRATOR_URL', 'SHADOW_DATABASE_URL'])('[PR3-SEC-06] staging api and worker refuse %s @security', async (key) => {
      for (const service of ['api', 'worker'] as const) {
        const io = captureIo();
        const env = { ...createTestEnv({ appEnv: 'staging', service }), [key]: `postgresql://m:${randomBytes(6).toString('hex')}@db/x` };
        await expect(loadRuntimeConfigOrExit(service, { env, cwd: cwd(), io, runtime })).rejects.toThrow(new ExitCalled(CONFIG_EXIT_CODE));
        expect(io.written.join('')).toContain(`${key}: forbidden-in-environment: toolingKey`);
      }
    });

    it('local warns with names only and starts; test stays silent', async () => {
      const local = captureIo();
      await loadRuntimeConfigOrExit('api', { env: createTestEnv({ appEnv: 'local' }), cwd: cwd(), io: local, runtime });
      expect(local.written.join('')).toBe(
        'Configuration warning: api does not hold AUDIT_ANCHOR_SIGNING_KEY (refused in staging/production)\n',
      );
      const test = captureIo();
      await loadRuntimeConfigOrExit('worker', { env: createTestEnv(), cwd: cwd(), io: test, runtime });
      expect(test.written).toEqual([]);
    });
  });

  describe('child process (as the api/worker entry points start)', () => {
    it('[PR3-SEC-05] staging with STRIPE_SECRET_KEY_REF=env:X and X=sk_live_… exits 78, names the key, prints no value @security', () => {
      const variable = randomVar();
      const value = `sk_live_${randomBytes(16).toString('hex')}`;
      const result = runService('api', {
        ...createTestEnv({ appEnv: 'staging', service: 'api' }),
        STRIPE_SECRET_KEY_REF: `env:${variable}`,
        [variable]: value,
      });
      expect(result.status).toBe(CONFIG_EXIT_CODE);
      expect(result.stdout).not.toContain('ready');
      expect(result.stderr).toContain('STRIPE_SECRET_KEY_REF');
      expect(result.stdout + result.stderr).not.toContain(value.slice('sk_live_'.length));
    });

    it('[PR3-SEC-05] staging with a placeholder behind a *_REF exits 78 naming the key @security', () => {
      const variable = randomVar();
      const result = runService('worker', {
        ...createTestEnv({ appEnv: 'staging', service: 'worker' }),
        STORAGE_SECRET_ACCESS_KEY_REF: `env:${variable}`,
        [variable]: 'change-me',
      });
      expect(result.status).toBe(CONFIG_EXIT_CODE);
      expect(result.stdout).not.toContain('ready');
      expect(result.stderr).toContain('STORAGE_SECRET_ACCESS_KEY_REF: placeholder');
    });

    it('a valid worker resolves its references and reaches ready', () => {
      const variable = randomVar();
      const result = runService('worker', {
        ...createTestEnv({ service: 'worker' }),
        MAIL_SMTP_PASSWORD_REF: variable,
        [variable]: randomBytes(12).toString('hex'),
      });
      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe('ready worker test secrets=1');
      expect(result.status).toBe(0);
    });
  });
});
