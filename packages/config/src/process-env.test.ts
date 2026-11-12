import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { CONFIG_KEY_NAMES, SECRET_KEY_NAMES } from './schema.js';
import { CONFIG_EXIT_CODE, loadConfigOrExit, LOCAL_ENV_FILE, readStartupEnv, type StartupIo } from './process-env.js';
import { createTestEnv } from './testing/index.js';

// Jest runs from the repository root (rootDir of jest.config.ts).
const repoRoot = resolve(process.cwd());
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const fixture = join(repoRoot, 'packages', 'config', 'src', 'fixtures', 'start-service.ts');

/** Starts the fixture like a service entry point: `node <tsx> start-service.ts <service>`, no shell. */
function runService(service: string, env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
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

/** The parent environment without any configuration key, so only the test's values reach the child. */
function childEnv(config: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFIG_KEY_NAMES) delete env[name];
  for (const [name, value] of Object.entries(config)) if (value !== undefined) env[name] = value;
  return env;
}

describe('process start-up edge (US-002, NFR-OPS-005)', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'config-env-'));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('[AT-US-002-01] returns the typed config when the environment is valid', () => {
    const io = captureIo();
    const config = loadConfigOrExit('api', { env: createTestEnv(), cwd: tempDir(), io });
    expect(config.APP_ENV).toBe('test');
    expect(io.written).toEqual([]);
  });

  it('[AT-US-002-02] prints names only to stderr and exits with EX_CONFIG within the 5 s budget', () => {
    const io = captureIo();
    const secret = `v${randomBytes(16).toString('hex')}`;
    const env = { ...createTestEnv(), DATABASE_URL: undefined, AUTH_ACCESS_TOKEN_TTL_SECONDS: 'abc', JWT_SECRET: secret };
    const started = performance.now();
    expect(() => loadConfigOrExit('api', { env, cwd: tempDir(), io })).toThrow(new ExitCalled(CONFIG_EXIT_CODE));
    expect(performance.now() - started).toBeLessThan(5_000);
    const stderr = io.written.join('');
    expect(stderr).toContain('DATABASE_URL: missing');
    expect(stderr).toContain('AUTH_ACCESS_TOKEN_TTL_SECONDS: invalid: number.base');
    expect(stderr).not.toContain(secret);
    expect(stderr).not.toContain('abc');
  });

  it('rethrows errors that are not configuration errors', () => {
    const io = captureIo();
    const env = new Proxy(
      {},
      {
        get: () => {
          throw new RangeError('broken environment');
        },
      },
    );
    expect(() => loadConfigOrExit('api', { env, cwd: tempDir(), io })).toThrow(RangeError);
  });

  it('reads .env.local only with APP_ENV=local; the process environment wins', () => {
    const dir = tempDir();
    const fromFile = `aws-secrets-manager:${randomBytes(6).toString('hex')}`;
    writeFileSync(join(dir, LOCAL_ENV_FILE), `STRIPE_SECRET_KEY_REF=${fromFile}\nBRAND_NAME=From File\nREGION=from-file\n`);
    const local = readStartupEnv({ APP_ENV: 'local', BRAND_NAME: 'From Process', REGION: '' }, dir);
    expect(local).toEqual({ APP_ENV: 'local', BRAND_NAME: 'From Process', REGION: 'from-file', STRIPE_SECRET_KEY_REF: fromFile });
    expect(readStartupEnv({ APP_ENV: 'staging' }, dir)).toEqual({ APP_ENV: 'staging' });
    const withoutFile = { APP_ENV: 'local' };
    expect(readStartupEnv(withoutFile, tempDir())).toBe(withoutFile);
  });

  describe('child process (as the api/worker entry points start)', () => {
    it('[AT-US-002-02] the process exits non-zero listing the names and printing no value', () => {
      const secret = `v${randomBytes(16).toString('hex')}`;
      const config: Record<string, string | undefined> = {
        ...createTestEnv(),
        DATABASE_URL: undefined,
        AUTH_ACCESS_TOKEN_TTL_SECONDS: 'abc',
        JWT_SECRET: secret,
      };
      const result = runService('api', childEnv(config));
      expect(result.status).toBe(CONFIG_EXIT_CODE);
      expect(result.stdout).not.toContain('ready');
      expect(result.stderr).toContain('DATABASE_URL');
      expect(result.stderr).toContain('ACCESS_TOKEN_TTL_SECONDS');
      const output = result.stdout + result.stderr;
      for (const value of [secret, ...SECRET_KEY_NAMES.map((name) => config[name])])
        if (value !== undefined) expect(output).not.toContain(value);
    });

    it('[AT-US-002-04] the worker process fails listing the missing key; a valid worker reaches ready', () => {
      const env = createTestEnv();
      const failed = runService('worker', childEnv({ ...env, AUDIT_ANCHOR_SINK: undefined }));
      expect(failed.status).toBe(CONFIG_EXIT_CODE);
      expect(failed.stderr).toContain('AUDIT_ANCHOR_SINK: missing');
      const ready = runService('worker', childEnv(env));
      expect(ready.stderr).toBe('');
      expect(ready.stdout.trim()).toBe('ready worker test');
      expect(ready.status).toBe(0);
    });
  });
});
