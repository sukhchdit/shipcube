/**
 * PR #9 code review R3-m1 + PR #11 code review R3-m2 (orchestrator ruling; TASK-014): a DatabaseConfigError or a
 * TenantTxConfigError thrown while the runtime services are built exits 78 with a structured log line naming the
 * variable (DATABASE_URL / PGOPTIONS), never exit 1 with a raw stack. Unit level plus both entry points (main.ts of the
 * api and the worker, run through tsx like `npm run dev:*`).
 */
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';
import { CONFIG_EXIT_CODE, CONFIG_KEY_NAMES } from '@platform/config';
import { createTestEnv } from '@platform/config/testing';

import { DatabaseConfigError, toPoolConfig } from './client.js';
import { assertNoSessionOptions, TenantTxConfigError } from './with-tenant-tx.js';
import { configErrorVariable, createOrExitOnConfigError } from './config-exit.js';

const captured = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
};

describe('configErrorVariable', () => {
  it('names DATABASE_URL for a DatabaseConfigError from the pool settings', () => {
    const error = captured(() =>
      toPoolConfig({
        connectionString: 'postgresql://u:p@db:5432/x?sslrootcert=/nonexistent/t014/ca.pem',
        poolMax: 1,
        applicationName: 'api',
      }),
    );
    expect(error).toBeInstanceOf(DatabaseConfigError);
    expect(configErrorVariable(error)).toBe('DATABASE_URL');
  });

  it('names PGOPTIONS for the session-options refusal and DB_TX_* for the other TenantTxConfigErrors', () => {
    expect(configErrorVariable(captured(() => assertNoSessionOptions({ PGOPTIONS: '-c x=y' })))).toBe('PGOPTIONS');
    expect(configErrorVariable(new TenantTxConfigError('timeoutMs must be at least statementTimeoutMs'))).toBe('DB_TX_*');
  });

  it('returns undefined for any other error', () => {
    expect(configErrorVariable(new Error('x'))).toBeUndefined();
    expect(configErrorVariable('x')).toBeUndefined();
  });
});

describe('createOrExitOnConfigError', () => {
  it('returns the services when nothing throws', async () => {
    const exit = jest.fn<(code: number) => void>();
    await expect(createOrExitOnConfigError(() => 42, { log: { error: jest.fn() }, exit })).resolves.toBe(42);
    expect(exit).not.toHaveBeenCalled();
  });

  it('logs the variable and the class only, requests exit 78 and never settles', async () => {
    const error = jest.fn();
    const exit = jest.fn<(code: number) => void>();
    const pending = createOrExitOnConfigError(
      () => {
        throw new DatabaseConfigError('connectionString sslrootcert could not be read');
      },
      { log: { error }, exit },
    );
    const settled = await Promise.race([pending.then(() => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 50))]);
    expect(settled).toBe('pending');
    expect(exit).toHaveBeenCalledWith(CONFIG_EXIT_CODE);
    expect(error).toHaveBeenCalledWith('runtime.config_rejected', { variable: 'DATABASE_URL', error: 'DatabaseConfigError', exitCode: 78 });
  });

  it('rethrows any other error unchanged (the fatal process-error handler takes it)', async () => {
    const boom = new RangeError('boom');
    await expect(
      createOrExitOnConfigError(
        () => {
          throw boom;
        },
        { log: { error: jest.fn() }, exit: jest.fn() },
      ),
    ).rejects.toBe(boom);
  });
});

/**
 * R1-n7 (PR #39): each case spawns tsx over a whole main.ts and took more than the 5 s default once on a loaded host;
 * the explicit limit sits above the spawn timeout below.
 */
const ENTRY_POINT_TIMEOUT_MS = 120_000;

describe('entry points (main.ts) exit 78 naming the variable @security', () => {
  const root = resolve(process.cwd());
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const start = (service: 'api' | 'worker', extra: Record<string, string>) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of [...CONFIG_KEY_NAMES, 'PGOPTIONS']) delete env[name];
    // The pool connects lazily, so the default connection timeout (floor 2 s since PR #38) never comes into play.
    Object.assign(env, createTestEnv({ service }), extra);
    const main = join(root, 'apps', service, 'src', 'main.ts');
    const result = spawnSync(process.execPath, [tsx, '--conditions=@platform/source', main], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 90_000,
      windowsHide: true,
    });
    if (result.error !== undefined) throw result.error;
    return result;
  };

  it.each(['api', 'worker'] as const)(
    '[R3-m2] %s: PGOPTIONS set exits 78 with runtime.config_rejected naming PGOPTIONS',
    (service) => {
      const marker = 'statement_timeout=424242';
      const result = start(service, { PGOPTIONS: `-c ${marker}` });
      expect(result.status).toBe(CONFIG_EXIT_CODE);
      expect(result.stdout).toContain('"runtime.config_rejected"');
      expect(result.stdout).toContain('"variable":"PGOPTIONS"');
      expect(result.stdout + result.stderr).not.toContain(marker);
    },
    ENTRY_POINT_TIMEOUT_MS,
  );

  it(
    '[R3-m1] api: an unreadable sslrootcert exits 78 naming DATABASE_URL, never the path',
    () => {
      const path = '/nonexistent/t014-ca-bundle.pem';
      const url = new URL(createTestEnv({ service: 'api' }).DATABASE_URL ?? '');
      url.search = `?sslmode=verify-full&sslrootcert=${encodeURIComponent(path)}`;
      const result = start('api', { DATABASE_URL: url.href });
      expect(result.status).toBe(CONFIG_EXIT_CODE);
      expect(result.stdout).toContain('"variable":"DATABASE_URL"');
      expect(result.stdout + result.stderr).not.toContain('t014-ca-bundle');
    },
    ENTRY_POINT_TIMEOUT_MS,
  );
});
