/**
 * The seed CLI's migrator connection (TASK-023; PR13-SEC-01/-03, code review PR #13 m1-m3): `_FILE` refusal, URL
 * allow-list, session pin read-back and connection cleanup. A fake client stands in for `pg.Client`; the real driver
 * paths (fake server, dropped socket) are in cli.test.ts and prisma/tests/seed/seed.int.test.ts.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import { SeedRefusedError, type SeedSql } from './framework/contracts.js';
import {
  CONNECT_TIMEOUT_MS,
  readMigratorUrl,
  refuseFileVariants,
  STATEMENT_TIMEOUT_MS,
  withMigratorConnection,
  type MigratorClient,
} from './migrator-connection.js';

/** Test secrets are generated at run time: no credential-shaped literal is committed (gitleaks, CLAUDE.md §5). */
const randomHex = (): string => randomBytes(12).toString('hex');
const PASSWORD = randomHex();
const BASE = `postgresql://platform_migrator:${PASSWORD}@db.internal:5432/platform`;

function refusal(run: () => unknown): SeedRefusedError {
  try {
    run();
  } catch (error) {
    if (error instanceof SeedRefusedError) return error;
    throw error;
  }
  throw new Error('expected a SeedRefusedError');
}

describe('refuseFileVariants (PR13-SEC-01)', () => {
  it.each(['DATABASE_MIGRATOR_URL_FILE', 'SEED_SUPERADMIN_PASSWORD_FILE', 'SEED_CUSTOMER_PASSWORD_FILE', 'APP_ENV_FILE', 'NODE_ENV_FILE'])(
    'refuses %s naming the variable only',
    (name) => {
      const path = '/run/secrets/never-opened';
      const error = refusal(() => {
        refuseFileVariants({ [name]: path, DATABASE_MIGRATOR_URL: BASE });
      });
      expect(error).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects: [name] });
      expect(error.message).not.toContain(path);
    },
  );

  it('names every present variant and ignores empty ones and unrelated *_FILE variables', () => {
    const error = refusal(() => {
      refuseFileVariants({ DATABASE_MIGRATOR_URL_FILE: 'a', SEED_CUSTOMER_PASSWORD_FILE: 'b', APP_ENV_FILE: '' });
    });
    expect(error.subjects).toEqual(['DATABASE_MIGRATOR_URL_FILE', 'SEED_CUSTOMER_PASSWORD_FILE']);
    expect(() => {
      refuseFileVariants({ APP_ENV_FILE: '', BOOTSTRAP_ADMIN_PASSWORD_FILE: '/run/secrets/x' });
    }).not.toThrow();
  });
});

describe('readMigratorUrl (PR13-SEC-03, code review m2)', () => {
  it('returns the URL with its raw and decoded password as redaction secrets', () => {
    const [head, tail] = [randomHex(), randomHex()];
    const raw = `${head}%40${tail}%2F`;
    const url = `postgresql://platform_migrator:${raw}@db.internal:5432/platform?sslmode=verify-full&application_name=seed`;
    expect(readMigratorUrl({ DATABASE_MIGRATOR_URL: url })).toEqual({ url, secrets: [url, raw, `${head}@${tail}/`] });
  });

  it('keeps only the raw password when it holds a malformed escape', () => {
    const raw = `${randomHex()}%zz`;
    const url = `postgresql://platform_migrator:${raw}@db.internal/platform`;
    expect(readMigratorUrl({ DATABASE_MIGRATOR_URL: url }).secrets).toEqual([url, raw]);
  });

  it('refuses a missing or empty URL with SEED_VARIABLE_MISSING', () => {
    for (const env of [{}, { DATABASE_MIGRATOR_URL: '' }]) {
      expect(refusal(() => readMigratorUrl(env))).toMatchObject({ code: 'SEED_VARIABLE_MISSING', subjects: ['DATABASE_MIGRATOR_URL'] });
    }
  });

  it.each([
    ['options (search_path override)', `${BASE}?options=-c%20search_path%3Dpublic,pg_catalog`],
    ['statement_timeout', `${BASE}?statement_timeout=0`],
    ['idle_in_transaction_session_timeout', `${BASE}?idle_in_transaction_session_timeout=0`],
    ['host (another host or a socket)', `${BASE}?host=/tmp`],
    ['hostaddr', `${BASE}?hostaddr=10.0.0.9`],
    ['search_path', `${BASE}?search_path=public`],
    ['ssl override', `${BASE}?ssl=0`],
    ['a repeated parameter', `${BASE}?sslmode=verify-full&sslmode=disable`],
    ['a percent-encoded socket host', `postgresql://platform_migrator:${PASSWORD}@%2Ftmp/platform`],
    ['a non-postgres scheme', `mysql://platform_migrator:${PASSWORD}@db.internal/platform`],
    ['a socket: URL', `socket://platform_migrator:${PASSWORD}@/tmp?db=platform`],
    ['a libpq key/value DSN', `host=db.internal user=platform_migrator password=${PASSWORD}`],
  ])('refuses %s (exit-1 refusal naming the variable, value never in the message)', (_label, url) => {
    const error = refusal(() => readMigratorUrl({ DATABASE_MIGRATOR_URL: url }));
    expect(error).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects: ['DATABASE_MIGRATOR_URL'] });
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain(url);
  });
});

interface FakeClient extends MigratorClient {
  readonly config: pg.ClientConfig;
  readonly listeners: ((error: Error) => void)[];
  readonly statements: string[];
  ended: number;
}

function fakeClient(settings: Record<string, string>, endFails = false): (config: pg.ClientConfig) => FakeClient {
  return (config) => {
    const client: FakeClient = {
      config,
      listeners: [],
      statements: [],
      ended: 0,
      connect: () => Promise.resolve(),
      end: () => {
        client.ended += 1;
        return endFails ? Promise.reject(new Error('already closed')) : Promise.resolve();
      },
      on: (_event, listener) => client.listeners.push(listener),
      query<R extends Record<string, unknown>>(text: string) {
        client.statements.push(text);
        const rows = text.includes('pg_settings') ? Object.entries(settings).map(([name, setting]) => ({ name, setting })) : [];
        return Promise.resolve({ rows: rows as unknown as R[], rowCount: rows.length });
      },
    };
    return client;
  };
}

const PINNED = {
  search_path: 'pg_catalog, pg_temp',
  statement_timeout: String(STATEMENT_TIMEOUT_MS),
  idle_in_transaction_session_timeout: String(STATEMENT_TIMEOUT_MS),
};

describe('withMigratorConnection', () => {
  it('pins the session in the client config, attaches an error listener, checks the pin, runs and closes', async () => {
    let created: FakeClient | undefined;
    const factory = fakeClient(PINNED);
    const result = await withMigratorConnection(
      BASE,
      async (sql: SeedSql) => {
        await sql.query('SELECT 1');
        return 'done';
      },
      (config) => (created = factory(config)),
    );
    expect(result).toBe('done');
    expect(created?.config).toMatchObject({
      connectionString: BASE,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: STATEMENT_TIMEOUT_MS,
      options: '-c search_path=pg_catalog,pg_temp',
    });
    expect(created?.listeners).toHaveLength(1);
    // The listener only absorbs: the pending query's rejection carries the error.
    expect(() => created?.listeners[0]?.(new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(created?.statements).toEqual([expect.stringContaining('pg_catalog.pg_settings'), 'SELECT 1']);
    expect(created?.ended).toBe(1);
  });

  it.each([
    ['search_path', { ...PINNED, search_path: 'public, pg_catalog' }],
    ['statement_timeout', { ...PINNED, statement_timeout: '0' }],
    ['idle_in_transaction_session_timeout', { ...PINNED, idle_in_transaction_session_timeout: '0' }],
    ['search_path', { statement_timeout: PINNED.statement_timeout, idle_in_transaction_session_timeout: PINNED.statement_timeout }],
  ])('refuses an unpinned session (%s) before running anything, and closes the connection', async (setting, settings) => {
    let created: FakeClient | undefined;
    const factory = fakeClient(settings);
    let ran = false;
    const error = await withMigratorConnection(
      BASE,
      () => {
        ran = true;
        return Promise.resolve();
      },
      (config) => (created = factory(config)),
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SeedRefusedError);
    expect(error).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects: ['DATABASE_MIGRATOR_URL'] });
    expect((error as Error).message).toContain(setting);
    expect(ran).toBe(false);
    expect(created?.ended).toBe(1);
  });

  it('reports the run error, not a failing end() after a lost connection', async () => {
    const failure = new Error('Connection terminated unexpectedly');
    await expect(withMigratorConnection(BASE, () => Promise.reject(failure), fakeClient(PINNED, true))).rejects.toBe(failure);
  });
});
