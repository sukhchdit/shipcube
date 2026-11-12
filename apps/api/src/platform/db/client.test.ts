import { PrismaPg } from '@prisma/adapter-pg';
import { describe, expect, it } from '@jest/globals';

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

describe('runtime database client factory (data-model §7.1)', () => {
  it('maps the typed options onto the pg pool with the documented defaults', () => {
    expect(toPoolConfig(options)).toEqual({
      connectionString: options.connectionString,
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
    'uselibpqcompat=true&sslmode=verify-full',
  ])('[PR5-SEC-08] accepts the TLS query parameters %s @security', (query) => {
    expect(toPoolConfig({ ...options, connectionString: `postgresql://u@h/db?${query}` }).connectionString).toContain(query);
  });

  it.each([
    ['lock_timeout', 'lock_timeout=0'],
    ['idle_in_transaction_session_timeout', 'idle_in_transaction_session_timeout=0'],
    ['application_name', 'application_name=other'],
    ['statement_timeout', 'statement_timeout=0'],
    ['connect_timeout', 'connect_timeout=600'],
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
