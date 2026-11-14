/**
 * PR #9 code review R3-m1 + PR #11 code review R3-m2 (orchestrator ruling; TASK-014): a DatabaseConfigError or a
 * TenantTxConfigError thrown while the runtime services are built exits 78 with a structured log line naming the
 * variable (DATABASE_URL / PGOPTIONS), never exit 1 with a raw stack. The process-error handlers take it (D-TASK014-24):
 * unit level plus both entry points (main.ts of the api and the worker, run through tsx like `npm run dev:*`).
 */
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { CONFIG_EXIT_CODE, CONFIG_KEY_NAMES } from '@platform/config';
import { createTestEnv } from '@platform/config/testing';

import { DatabaseConfigError, toPoolConfig } from './client.js';
import { assertNoSessionOptions, TenantTxConfigError } from './with-tenant-tx.js';
import { createRuntimeLog } from '../runtime/log.js';
import { installProcessErrorHandlers } from '../runtime/process-errors.js';
import { configErrorVariable } from './config-exit.js';

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

describe('installProcessErrorHandlers with a runtime configuration error (D-TASK014-24)', () => {
  function setup(): { readonly source: EventEmitter; readonly lines: () => Record<string, unknown>[]; readonly exits: number[] } {
    const raw: string[] = [];
    const exits: number[] = [];
    const source = new EventEmitter();
    const log = createRuntimeLog('api', { write: (line: string) => raw.push(line) });
    installProcessErrorHandlers({ log, exit: (code) => exits.push(code), source });
    return { source, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>), exits };
  }

  it('an uncaught DatabaseConfigError is one runtime.config_rejected line with the variable and the class only, exit 78', () => {
    const { source, lines, exits } = setup();
    source.emit(
      'uncaughtException',
      new DatabaseConfigError('connectionString sslrootcert /secret/t014 could not be read'),
      'uncaughtException',
    );
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      level: 'error',
      event: 'runtime.config_rejected',
      variable: 'DATABASE_URL',
      error: 'DatabaseConfigError',
      exitCode: CONFIG_EXIT_CODE,
    });
    expect(JSON.stringify(lines())).not.toContain('/secret/t014');
    expect(lines()[0]).not.toHaveProperty('err');
    expect(exits).toEqual([CONFIG_EXIT_CODE]);
  });

  it('an unhandled rejection with the PGOPTIONS refusal names PGOPTIONS, never the value, exit 78', () => {
    const { source, lines, exits } = setup();
    source.emit(
      'unhandledRejection',
      captured(() => assertNoSessionOptions({ PGOPTIONS: '-c statement_timeout=424242' })),
    );
    expect(lines()).toEqual([
      expect.objectContaining({ event: 'runtime.config_rejected', variable: 'PGOPTIONS', error: 'TenantTxConfigError' }),
    ]);
    expect(JSON.stringify(lines())).not.toContain('424242');
    expect(exits).toEqual([CONFIG_EXIT_CODE]);
  });

  it('the first error decides the exit code; any other error stays a fatal line with exit 1', () => {
    const first = setup();
    first.source.emit('uncaughtException', new RangeError('boom'), 'uncaughtException');
    first.source.emit('uncaughtException', new DatabaseConfigError('late'), 'uncaughtException');
    expect(first.lines().map((line) => [line['level'], line['event']])).toEqual([
      ['fatal', 'process.uncaught_exception'],
      ['error', 'runtime.config_rejected'],
    ]);
    expect(first.exits).toEqual([1]);

    const second = setup();
    second.source.emit('unhandledRejection', new TenantTxConfigError('timeoutMs must be at least statementTimeoutMs'));
    second.source.emit('unhandledRejection', new Error('later'));
    expect(second.lines().map((line) => line['event'])).toEqual(['runtime.config_rejected', 'process.unhandled_rejection']);
    expect(second.exits).toEqual([CONFIG_EXIT_CODE]);
  });

  it('requests exit 78 even when the logger throws', () => {
    const exits: number[] = [];
    const source = new EventEmitter();
    const fail = (): void => {
      throw new Error('destination failed');
    };
    installProcessErrorHandlers({ log: { fatal: fail, error: fail }, exit: (code) => exits.push(code), source });
    expect(() => source.emit('uncaughtException', new DatabaseConfigError('x'), 'uncaughtException')).toThrow('destination failed');
    expect(exits).toEqual([CONFIG_EXIT_CODE]);
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
