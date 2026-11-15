import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import {
  APP_ROLE_CONNECTION_LIMIT,
  DatabaseConfigError,
  QUERY_TIMEOUT_MARGIN_MS,
  createDatabaseAdapter,
  createDatabaseClient,
  toPoolConfig,
} from './client.js';

const options = {
  connectionString: 'postgresql://platform_app:placeholder@127.0.0.1:5432/platform',
  poolMax: 10,
  applicationName: 'api',
};

/** Writes a CA bundle just above the 1 MiB cap into `dir` and returns its path. */
function oversized(dir: string): string {
  const path = join(dir, 'huge.pem');
  writeFileSync(path, Buffer.alloc(1_048_577, 0x41));
  return path;
}

/** A directory inside `dir` (refused: not a regular file). */
function subdirectory(dir: string): string {
  const path = join(dir, 'bundle.d');
  mkdirSync(path);
  return path;
}

/** A readable file in a fresh temporary directory that is not a CA directory (PR9-SEC-17). */
function outsideFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pg-outside-')), 'root.pem');
  writeFileSync(path, DUMMY_CA);
  return path;
}

/** PEM-shaped dummy text (not a certificate or a key): enough to prove the file is read into `ssl.ca`. */
const DUMMY_CA = '-----BEGIN CERTIFICATE-----\nZHVtbXktdGVzdC1jYQ==\n-----END CERTIFICATE-----\n';

describe('runtime database client factory (data-model §7.1)', () => {
  it('maps the typed options onto the pg pool with the documented defaults', () => {
    expect(toPoolConfig(options)).toEqual({
      connectionString: options.connectionString,
      ssl: false,
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'api',
      statement_timeout: 25_000,
      query_timeout: 25_000 + QUERY_TIMEOUT_MARGIN_MS,
    });
    expect(
      toPoolConfig({ ...options, idleTimeoutMs: 30_000, connectionTimeoutMs: 2_000, connectionString: 'postgres://h/db' }),
    ).toMatchObject({
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
  });

  it.each([
    ['poolMax 0', { poolMax: 0 }, /poolMax must be an integer between 1 and 200/],
    ['poolMax above the platform_app connection limit', { poolMax: APP_ROLE_CONNECTION_LIMIT + 1 }, /poolMax/],
    ['fractional poolMax', { poolMax: 2.5 }, /poolMax/],
    ['negative idle timeout', { idleTimeoutMs: -1 }, /idleTimeoutMs/],
    ['zero connection timeout', { connectionTimeoutMs: 0 }, /connectionTimeoutMs/],
    ['not a URL', { connectionString: 'platform_app@localhost' }, /not a valid URL/],
    ['another protocol', { connectionString: 'mysql://u@h/db' }, /postgres:\/\/ or postgresql:\/\//],
    [
      'an options parameter overriding role settings',
      { connectionString: 'postgresql://u@h/db?options=-c%20search_path%3Dpublic' },
      /outside the TLS allow-list/,
    ],
    ['an invalid application name', { applicationName: 'API Server' }, /applicationName/],
    ['a zero statement timeout', { statementTimeoutMs: 0 }, /statementTimeoutMs/],
    ['a statement timeout above 300 s', { statementTimeoutMs: 300_001 }, /statementTimeoutMs/],
  ])('fails fast on %s', (_label, override, message) => {
    expect(() => toPoolConfig({ ...options, ...override })).toThrow(DatabaseConfigError);
    expect(() => toPoolConfig({ ...options, ...override })).toThrow(message);
  });

  it('[CR m7] sets statement_timeout and a slightly larger client query_timeout', () => {
    expect(toPoolConfig({ ...options, statementTimeoutMs: 5_000 })).toMatchObject({
      statement_timeout: 5_000,
      query_timeout: 5_000 + QUERY_TIMEOUT_MARGIN_MS,
    });
  });

  it.each([
    'sslmode=verify-full',
    'sslmode=verify-full&sslrootcert=/etc/ssl/rds.pem',
    'sslnegotiation=direct&sslmode=require',
    'sslmode=disable',
  ])('[PR5-SEC-08] accepts the TLS query parameters %s @security', (query) => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-ca-'));
    try {
      writeFileSync(join(dir, 'rds.pem'), DUMMY_CA);
      const connectionString = `postgresql://u@h/db?${query.replace('/etc/ssl/rds.pem', encodeURIComponent(join(dir, 'rds.pem')))}`;
      expect(toPoolConfig({ ...options, connectionString }, [dir]).connectionString).toBe('postgresql://u@h/db');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('[PR9-SEC-04] TLS is pinned by toPoolConfig, not by the URL, PGSSLMODE or NODE_TLS_REJECT_UNAUTHORIZED', () => {
    const OVERRIDES = ['NODE_TLS_REJECT_UNAUTHORIZED', 'PGSSLMODE'] as const;
    const saved = new Map<string, string | undefined>();
    let dir: string;

    beforeEach(() => {
      for (const key of OVERRIDES) saved.set(key, process.env[key]);
      dir = mkdtempSync(join(tmpdir(), 'pg-ca-'));
    });

    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    });

    /** The `ssl` setting pg itself derives for a client built from the pool config (the TLS socket options). */
    const pgSsl = (connectionString: string): unknown =>
      (new pg.Client(toPoolConfig({ ...options, connectionString }, [dir])) as unknown as { connectionParameters: { ssl: unknown } })
        .connectionParameters.ssl;

    it('sslmode=verify-full yields ssl.rejectUnauthorized true and a connectionString without a query @security', () => {
      const config = toPoolConfig({ ...options, connectionString: 'postgresql://u:p@db.internal:5432/platform?sslmode=verify-full' });
      expect(config.ssl).toEqual({ rejectUnauthorized: true });
      expect(config.connectionString).toBe('postgresql://u:p@db.internal:5432/platform');
      expect(config).not.toHaveProperty('sslnegotiation');
    });

    it('keeps verification on under NODE_TLS_REJECT_UNAUTHORIZED=0 and PGSSLMODE=no-verify, and plain TCP stays off TLS @security', () => {
      process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
      process.env['PGSSLMODE'] = 'no-verify';
      expect(pgSsl('postgresql://u@h/db?sslmode=verify-full')).toEqual({ rejectUnauthorized: true });
      expect(pgSsl('postgresql://u@h/db')).toBe(false);
      expect(pgSsl('postgresql://u@h/db?sslmode=disable')).toBe(false);
    });

    it.each(['require', 'verify-ca', 'prefer', 'allow'])('treats sslmode=%s as verify-full @security', (mode) => {
      expect(pgSsl(`postgresql://u@h/db?sslmode=${mode}`)).toEqual({ rejectUnauthorized: true });
    });

    it.each([
      ['sslmode=no-verify', /must not disable certificate verification/],
      ['sslmode=no%2Dverify', /must not disable certificate verification/],
      ['sslmode=insecure', /sslmode is not a supported value/],
      ['sslnegotiation=fast', /sslnegotiation must be postgres or direct/],
      ['sslmode=disable&sslnegotiation=direct', /sslnegotiation=direct requires TLS/],
    ])('refuses %s without echoing it @security', (query, message) => {
      const call = (): unknown => toPoolConfig({ ...options, connectionString: `postgresql://u@h/db?${query}` });
      expect(call).toThrow(DatabaseConfigError);
      expect(call).toThrow(message);
      expect(call).not.toThrow(query);
    });

    it('passes sslnegotiation through and enables verified TLS for direct negotiation without sslmode @security', () => {
      expect(toPoolConfig({ ...options, connectionString: 'postgresql://u@h/db?sslnegotiation=direct' })).toMatchObject({
        ssl: { rejectUnauthorized: true },
        sslnegotiation: 'direct',
      });
      expect(toPoolConfig({ ...options, connectionString: 'postgresql://u@h/db?sslnegotiation=postgres' })).toMatchObject({
        ssl: false,
        sslnegotiation: 'postgres',
      });
    });

    it('reads sslrootcert into ssl.ca (no sslmode still means verified TLS, as pg reads it) @security', () => {
      const path = join(dir, 'root.pem');
      writeFileSync(path, DUMMY_CA);
      for (const query of [`sslmode=verify-full&sslrootcert=${encodeURIComponent(path)}`, `sslrootcert=${encodeURIComponent(path)}`]) {
        expect(toPoolConfig({ ...options, connectionString: `postgresql://u@h/db?${query}` }, [dir]).ssl).toEqual({
          rejectUnauthorized: true,
          ca: DUMMY_CA,
        });
      }
    });

    it('fails on an unreadable sslrootcert without naming the path @security', () => {
      const path = join(dir, 'missing-root.pem');
      const call = (): unknown =>
        toPoolConfig({ ...options, connectionString: `postgresql://u@h/db?sslmode=verify-full&sslrootcert=${encodeURIComponent(path)}` }, [
          dir,
        ]);
      expect(call).toThrow(DatabaseConfigError);
      expect(call).toThrow('connectionString sslrootcert could not be read');
      try {
        call();
      } catch (error) {
        expect(String(error)).not.toContain('missing-root');
        expect(error).not.toHaveProperty('cause');
      }
    });

    it.each([
      ['the libpq system keyword', () => 'system', /sslrootcert must name a CA bundle file/],
      ['a relative path', () => 'root.pem', /sslrootcert must be an absolute path/],
      ['a directory', (base: string) => subdirectory(base), /sslrootcert must be a regular file of at most 1 MiB/],
      ['a file outside every CA directory', () => outsideFile(), /sslrootcert must lie inside a CA directory/],
      ['a file above 1 MiB', (base: string) => oversized(base), /sslrootcert must be a regular file of at most 1 MiB/],
    ])('[PR9-SEC-16] refuses %s as sslrootcert without naming it @security', (_label, pathIn, message) => {
      const path = pathIn(dir);
      const call = (): unknown =>
        toPoolConfig({ ...options, connectionString: `postgresql://u@h/db?sslmode=verify-full&sslrootcert=${encodeURIComponent(path)}` }, [
          dir,
        ]);
      expect(call).toThrow(DatabaseConfigError);
      expect(call).toThrow(message);
      expect(call).not.toThrow(path);
    });
  });

  it.each([
    ['lock_timeout', 'lock_timeout=0'],
    ['idle_in_transaction_session_timeout', 'idle_in_transaction_session_timeout=0'],
    ['application_name', 'application_name=other'],
    ['statement_timeout', 'statement_timeout=0'],
    ['connect_timeout', 'connect_timeout=600'],
    ['uselibpqcompat (no effect since PR9-SEC-04, R2-m2)', 'uselibpqcompat=true&sslmode=verify-full'],
    ['options', 'options=-c%20search_path%3Dpublic'],
    ['percent-encoded options', '%6Fptions=-c%20search_path%3Dpublic'],
    ['percent-encoded lock_timeout', 'lock%5Ftimeout=0'],
    ['a host override', 'sslmode=verify-full&host=/tmp'],
    ['an ssl override', 'ssl=0'],
    ['a repeated sslmode', 'sslmode=verify-full&sslmode=disable'],
    ['a repeated percent-encoded sslmode', 'sslmode=verify-full&ssl%6Dode=disable'],
  ])('[PR5-SEC-08] rejects %s in the URL, without echoing it @security', (_label, query) => {
    const connectionString = `postgresql://u@h/db?${query}`;
    expect(() => toPoolConfig({ ...options, connectionString })).toThrow(DatabaseConfigError);
    try {
      toPoolConfig({ ...options, connectionString });
    } catch (error) {
      expect(String(error)).not.toContain(query);
    }
  });

  it('builds the Prisma pg driver adapter without connecting', () => {
    const adapter = createDatabaseAdapter(options);
    expect(adapter).toBeInstanceOf(PrismaPg);
    expect(adapter.provider).toBe('postgres');
  });

  it('[PR7-SEC-03 item 4] constructs the injected Prisma client class with the adapter and errorFormat minimal', () => {
    class FakeClient {
      constructor(readonly init: { adapter: PrismaPg; errorFormat: 'minimal' }) {}
    }
    const client = createDatabaseClient(FakeClient, options);
    expect(client).toBeInstanceOf(FakeClient);
    expect(client.init.adapter).toBeInstanceOf(PrismaPg);
    expect(client.init.errorFormat).toBe('minimal');
  });
});
