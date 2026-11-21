/**
 * `db:reset` main (PR5-SEC-14, TASK-034): the validated target is the only source of every URL main uses, and a
 * missing or refused DATABASE_BOOTSTRAP_URL stops main before any connection. The resetTarget guard rows are in
 * bootstrap.test.ts; the PostgreSQL run is prisma/tests/bootstrap.
 */
import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { BootstrapResult, connectPrivileged } from './bootstrap.js';
import { RESET_DEPENDENCIES, main, type ResetDependencies } from './reset.js';

/** Yields once, as a real database or process call would. */
const tick = (): Promise<void> => Promise.resolve();

/** Random test-only role passwords (never committed values). */
const password = () => randomBytes(32).toString('base64url');
const BOOTSTRAP = 'postgresql://admin@127.0.0.1:5432/platform';
const MIGRATOR = 'postgresql://platform_migrator@127.0.0.1:5432/platform';

function fakes(deployStatus: number | null = 0) {
  const queries: string[] = [];
  const admin = {
    query: jest.fn(async (sql: string) => {
      await tick();
      queries.push(sql);
      return { rows: [] };
    }),
    end: jest.fn(() => Promise.resolve()),
  };
  const connect = jest.fn(() => Promise.resolve(admin)) as unknown as jest.MockedFunction<typeof connectPrivileged>;
  const bootstrap = jest.fn((): Promise<BootstrapResult> =>
    Promise.resolve({ database: 'platform', applied: ['00-roles.sql'], skipped: [] }),
  ) as unknown as jest.MockedFunction<ResetDependencies['runBootstrap']>;
  const deploy = jest.fn<ResetDependencies['deploy']>(() => deployStatus);
  const deps: ResetDependencies = { connectPrivileged: connect, runBootstrap: bootstrap, deploy };
  return { deps, connect, bootstrap, deploy, queries };
}

describe('db:reset main (PR5-SEC-14)', () => {
  let stderr: string[];
  beforeEach(() => {
    stderr = [];
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    DATABASE_BOOTSTRAP_URL: BOOTSTRAP,
    DATABASE_MIGRATOR_URL: MIGRATOR,
    BOOTSTRAP_MIGRATOR_PASSWORD: password(),
    BOOTSTRAP_APP_PASSWORD: password(),
    ...overrides,
  });

  it('[PR5-SEC-14] DATABASE_BOOTSTRAP_URL unset: main returns 1 and connectPrivileged is never called', async () => {
    const run = fakes();
    const unset = env();
    delete unset['DATABASE_BOOTSTRAP_URL'];
    expect(await main(['--yes'], unset, run.deps)).toBe(1);
    expect(run.connect).not.toHaveBeenCalled();
    expect(run.bootstrap).not.toHaveBeenCalled();
    expect(run.deploy).not.toHaveBeenCalled();
    expect(stderr.join('')).toBe('[db:reset] DATABASE_BOOTSTRAP_URL is not set\n');
  });

  it('[PR5-SEC-14] an empty or non-loopback DATABASE_BOOTSTRAP_URL and a missing --yes stop main before any connection', async () => {
    for (const [argv, overrides] of [
      [['--yes'], { DATABASE_BOOTSTRAP_URL: '' }],
      [['--yes'], { DATABASE_BOOTSTRAP_URL: 'postgresql://admin@db.example.com/platform' }],
      [[], {}],
    ] as const) {
      const run = fakes();
      expect(await main([...argv], env(overrides), run.deps)).toBe(1);
      expect(run.connect).not.toHaveBeenCalled();
    }
  });

  it('uses the validated maintenance URL for the drop and the validated bootstrap URL for the bootstrap, then deploys', async () => {
    const run = fakes();
    const variables = env();
    expect(await main(['--yes'], variables, run.deps)).toBe(0);
    expect(run.connect).toHaveBeenCalledTimes(1);
    expect(run.connect.mock.calls[0]?.[0]).toEqual({ connectionString: 'postgresql://admin@127.0.0.1:5432/postgres' });
    expect(run.queries).toEqual([
      "SET statement_timeout = '60s'",
      'DROP DATABASE IF EXISTS "platform" WITH (FORCE)',
      'CREATE DATABASE "platform"',
    ]);
    expect(run.bootstrap.mock.calls[0]?.[0].connection).toEqual({ connectionString: BOOTSTRAP });
    expect(run.deploy).toHaveBeenCalledWith(variables);
  });

  it('returns 1 when the deploy fails or times out (status null)', async () => {
    expect(await main(['--yes'], env(), fakes(1).deps)).toBe(1);
    expect(await main(['--yes'], env(), fakes(null).deps)).toBe(1);
  });

  it('the production dependencies are the real connector, bootstrap runner and deploy wrapper', () => {
    expect(Object.keys(RESET_DEPENDENCIES).sort()).toEqual(['connectPrivileged', 'deploy', 'runBootstrap']);
    expect(typeof RESET_DEPENDENCIES.deploy).toBe('function');
  });
});
