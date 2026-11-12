import { PrismaPg } from '@prisma/adapter-pg';
import { describe, expect, it } from '@jest/globals';

import { APP_ROLE_CONNECTION_LIMIT, DatabaseConfigError, createDatabaseAdapter, createDatabaseClient, toPoolConfig } from './client.js';

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
      /options/,
    ],
    ['an invalid application name', { applicationName: 'API Server' }, /applicationName/],
  ])('fails fast on %s', (_label, override, message) => {
    expect(() => toPoolConfig({ ...options, ...override })).toThrow(DatabaseConfigError);
    expect(() => toPoolConfig({ ...options, ...override })).toThrow(message);
  });

  it('builds the Prisma pg driver adapter without connecting', () => {
    const adapter = createDatabaseAdapter(options);
    expect(adapter).toBeInstanceOf(PrismaPg);
    expect(adapter.provider).toBe('postgres');
  });

  it('constructs the injected Prisma client class with the adapter', () => {
    class FakeClient {
      constructor(readonly init: { adapter: PrismaPg }) {}
    }
    const client = createDatabaseClient(FakeClient, options);
    expect(client).toBeInstanceOf(FakeClient);
    expect(client.init.adapter).toBeInstanceOf(PrismaPg);
  });
});
