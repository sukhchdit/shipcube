/**
 * The bootstrap runner's privileged connection (TASK-014; PR13-SEC-09, PR9-SEC-16/-17, PR3-SEC-14, PR #13 code review
 * R2-n2/-n3/m1): the platform's one TLS implementation, bounded queries, keep-alive, the value-free `'error'` line and
 * the tooling environment check of the CLI. The PostgreSQL runs are in prisma/tests/bootstrap.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import pg from 'pg';

import {
  BootstrapError,
  CONNECT_TIMEOUT_MS,
  connectionErrorLine,
  connectPrivileged,
  main,
  PRIVILEGED_SESSION_OPTIONS,
  privilegedClientConfig,
  QUERY_TIMEOUT_MS,
  STATEMENT_TIMEOUT_MS,
} from './bootstrap.js';

/** Generated at run time: no credential-shaped literal is committed. */
const PASSWORD = randomBytes(12).toString('hex');
const BASE = `postgresql://postgres:${PASSWORD}@db.internal:5432/postgres`;
/** PEM-shaped dummy text (not a certificate or a key). */
const DUMMY_CA = '-----BEGIN CERTIFICATE-----\nZHVtbXktdGVzdC1jYQ==\n-----END CERTIFICATE-----\n';

function bootstrapFailure(run: () => unknown): BootstrapError {
  try {
    run();
  } catch (error) {
    if (error instanceof BootstrapError) return error;
    throw error;
  }
  throw new Error('expected a BootstrapError');
}

describe('privilegedClientConfig (PR13-SEC-09, R2-n2)', () => {
  const OVERRIDES = ['NODE_TLS_REJECT_UNAUTHORIZED', 'PGSSLMODE'] as const;
  const saved = new Map<string, string | undefined>();
  let ca: string;

  beforeEach(() => {
    for (const key of OVERRIDES) saved.set(key, process.env[key]);
    ca = mkdtempSync(join(tmpdir(), 'bootstrap-ca-'));
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(ca, { recursive: true, force: true });
  });

  it('pins the session, bounds every query 10 s past the file statement timeout and keeps TCP alive', () => {
    expect(QUERY_TIMEOUT_MS).toBe(STATEMENT_TIMEOUT_MS + 10_000);
    expect(STATEMENT_TIMEOUT_MS).toBe(5 * 60_000);
    expect(privilegedClientConfig({ connectionString: `${BASE}?sslmode=verify-full&sslnegotiation=direct` }, [ca])).toEqual({
      connectionString: BASE,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'direct',
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      keepAlive: true,
      options: PRIVILEGED_SESSION_OPTIONS,
    });
  });

  it('makes ssl explicit for an object without a URL, overriding an ssl value smuggled past the type', () => {
    const connection = { host: 'h', port: 5432, user: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } };
    expect(privilegedClientConfig(connection, [ca])).toEqual({
      host: 'h',
      port: 5432,
      user: 'postgres',
      database: 'postgres',
      ssl: false,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      keepAlive: true,
      options: PRIVILEGED_SESSION_OPTIONS,
    });
  });

  it('reads sslrootcert from a CA directory into ssl.ca', () => {
    const path = join(ca, 'root.pem');
    writeFileSync(path, DUMMY_CA);
    expect(privilegedClientConfig({ connectionString: `${BASE}?sslrootcert=${encodeURIComponent(path)}` }, [ca]).ssl).toEqual({
      rejectUnauthorized: true,
      ca: DUMMY_CA,
    });
  });

  it('ignores PGSSLMODE and NODE_TLS_REJECT_UNAUTHORIZED: pg sees the explicit ssl only', () => {
    process.env['PGSSLMODE'] = 'no-verify';
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    const pgSsl = (connectionString: string): unknown =>
      (new pg.Client(privilegedClientConfig({ connectionString }, [ca])) as unknown as { connectionParameters: { ssl: unknown } })
        .connectionParameters.ssl;
    expect(pgSsl(BASE)).toBe(false);
    expect(pgSsl(`${BASE}?sslmode=disable`)).toBe(false);
    expect(pgSsl(`${BASE}?sslmode=prefer`)).toEqual({ rejectUnauthorized: true });
  });

  it.each([
    ['sslmode=no-verify', () => 'sslmode=no-verify', /must not disable certificate verification/],
    ['sslmode=bogus', () => 'sslmode=bogus', /sslmode is not a supported value/],
    ['sslrootcert=system', () => 'sslmode=verify-full&sslrootcert=system', /must name a CA bundle file/],
    ['a relative sslrootcert', () => 'sslmode=verify-full&sslrootcert=root.pem', /must be an absolute path/],
    [
      'a directory sslrootcert',
      (dir: string) => {
        mkdirSync(join(dir, 'bundle.d'));
        return `sslmode=verify-full&sslrootcert=${encodeURIComponent(join(dir, 'bundle.d'))}`;
      },
      /must be a regular file of at most 1 MiB/,
    ],
    [
      'a missing sslrootcert',
      (dir: string) => `sslmode=verify-full&sslrootcert=${encodeURIComponent(join(dir, 'missing-root.pem'))}`,
      /could not be read/,
    ],
    ['a parameter outside the TLS allow-list', () => 'sslmode=verify-full&host=/tmp', /outside the TLS allow-list/],
  ])('refuses %s naming DATABASE_BOOTSTRAP_URL only', (_label, query, message) => {
    const q = query(ca);
    const error = bootstrapFailure(() => privilegedClientConfig({ connectionString: `${BASE}?${q}` }, [ca]));
    expect(error.message).toMatch(/^DATABASE_BOOTSTRAP_URL: connectionString /);
    expect(error.message).toMatch(message);
    expect(error.message).not.toContain(ca);
    expect(error.message).not.toContain(PASSWORD);
    expect(error).not.toHaveProperty('cause');
  });

  it('keeps the options refusal and refuses a string that is not a URL, without echoing it', () => {
    expect(() => privilegedClientConfig({ connectionString: `${BASE}?options=-c%20search_path%3Dpublic` })).toThrow(
      /must not carry an options parameter/,
    );
    const dsn = `host=db.internal password=${PASSWORD}`;
    const error = bootstrapFailure(() => privilegedClientConfig({ connectionString: dsn }));
    expect(error.message).toBe('DATABASE_BOOTSTRAP_URL: connectionString is not a valid URL');
  });

  it('uses DATABASE_CA_DIRECTORIES by default, so a temporary CA file is refused', () => {
    const path = join(ca, 'root.pem');
    writeFileSync(path, DUMMY_CA);
    expect(() => privilegedClientConfig({ connectionString: `${BASE}?sslrootcert=${encodeURIComponent(path)}` })).toThrow(
      /must lie inside a CA directory/,
    );
  });
});

describe("connection-level 'error' events (R2-n3, R2 m1)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the error class and a safe code only', () => {
    expect(connectionErrorLine(Object.assign(new Error(`lost ${BASE}`), { code: 'ECONNRESET' }))).toBe(
      '[bootstrap] connection error (Error ECONNRESET)',
    );
    expect(connectionErrorLine(Object.assign(new Error('x'), { code: '57P01' }))).toBe('[bootstrap] connection error (Error 57P01)');
    expect(connectionErrorLine(Object.assign(new Error('x'), { code: `x ${PASSWORD}` }))).toBe('[bootstrap] connection error (Error)');
    expect(connectionErrorLine('text')).toBe('[bootstrap] connection error (non-error)');
    expect(connectionErrorLine(undefined)).toBe('[bootstrap] connection error (non-error)');
  });

  it('connectPrivileged attaches the listener before connecting', async () => {
    const on = jest.spyOn(pg.Client.prototype, 'on');
    // The promise overload of `connect` (the callback overload returns void).
    jest
      .spyOn(pg.Client.prototype as unknown as { connect(): Promise<void> }, 'connect')
      .mockRejectedValue(new Error('no server in unit tests'));
    const lines: string[] = [];
    await expect(
      connectPrivileged({ connectionString: 'postgresql://u@127.0.0.1:1/d' }, { writeError: (line) => lines.push(line) }),
    ).rejects.toThrow('no server in unit tests');
    const listener = on.mock.calls.find(([event]) => event === 'error')?.[1] as ((error: Error) => void) | undefined;
    expect(listener).toBeDefined();
    listener?.(Object.assign(new Error(PASSWORD), { code: 'EPIPE' }));
    expect(lines).toEqual(['[bootstrap] connection error (Error EPIPE)']);
  });

  it('[PR5-SEC-14] connectPrivileged refuses a config without a non-empty connectionString before creating a client (no libpq environment defaults)', async () => {
    const connect = jest.spyOn(pg.Client.prototype, 'connect');
    const refusal = /a privileged connection needs a non-empty connectionString; libpq environment defaults are never used/;
    for (const connection of [{}, { connectionString: '' }, { host: '127.0.0.1', user: 'u', database: 'd' }]) {
      await expect(connectPrivileged(connection as { connectionString: string })).rejects.toThrow(refusal);
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('connectPrivileged refuses a TLS problem before creating a client', async () => {
    const connect = jest.spyOn(pg.Client.prototype, 'connect');
    await expect(connectPrivileged({ connectionString: `${BASE}?sslmode=no-verify` })).rejects.toThrow(BootstrapError);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('bootstrap CLI environment check (PR3-SEC-14)', () => {
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const passwords = {
    BOOTSTRAP_MIGRATOR_PASSWORD: randomBytes(32).toString('base64url'),
    BOOTSTRAP_APP_PASSWORD: randomBytes(32).toString('base64url'),
  };

  it.each([
    ['plain TCP in staging', { APP_ENV: 'staging', DATABASE_BOOTSTRAP_URL: BASE }, 'DATABASE_BOOTSTRAP_URL (insecure-transport)'],
    [
      'NODE_TLS_REJECT_UNAUTHORIZED=0 in production',
      { APP_ENV: 'production', DATABASE_BOOTSTRAP_URL: `${BASE}?sslmode=verify-full`, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      'NODE_TLS_REJECT_UNAUTHORIZED (forbidden-in-environment: tls.rejectUnauthorized)',
    ],
    [
      'sslmode=no-verify locally',
      { APP_ENV: 'local', DATABASE_BOOTSTRAP_URL: `${BASE}?sslmode=no-verify` },
      'DATABASE_BOOTSTRAP_URL (invalid',
    ],
    ['a missing APP_ENV', { DATABASE_BOOTSTRAP_URL: BASE }, 'APP_ENV (missing)'],
  ])('exits 1 before connecting on %s, naming variables only', async (_label, env, named) => {
    const connect = jest.spyOn(pg.Client.prototype, 'connect');
    await expect(main({ ...env, ...passwords })).resolves.toBe(1);
    expect(connect).not.toHaveBeenCalled();
    const printed = stderr.join('');
    expect(printed).toMatch(/^\[bootstrap\] environment refused: /);
    expect(printed).toContain(named);
    expect(printed).not.toContain(PASSWORD);
    expect(printed).not.toContain('no-verify');
  });

  it('exits 1 naming the variable when DATABASE_BOOTSTRAP_URL is unset', async () => {
    await expect(main({ APP_ENV: 'local', ...passwords })).resolves.toBe(1);
    expect(stderr.join('')).toBe('[bootstrap] DATABASE_BOOTSTRAP_URL is not set\n');
  });
});
