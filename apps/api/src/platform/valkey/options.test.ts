import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { createValkeyCheck } from './client.js';
import { buildValkeyOptions, reconnectDelayMs, VALKEY_DEFAULTS, ValkeyConfigError } from './options.js';

const password = (): string => randomBytes(12).toString('hex');

describe('Valkey connection options (ADR-0013; PR3-SEC-02/-12 consumer half)', () => {
  it('[PR3-SEC-02] rediss: sets explicit TLS with SNI and a TLS 1.2 floor, from parsed parts only @security', () => {
    const secret = password();
    const options = buildValkeyOptions({ url: `rediss://api:${secret}@cache.staging.test:6380/2`, connectionName: 'api' });
    expect(options).toMatchObject({
      host: 'cache.staging.test',
      port: 6380,
      db: 2,
      username: 'api',
      password: secret,
      connectionName: 'api',
      tls: { servername: 'cache.staging.test', minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectTimeout: VALKEY_DEFAULTS.connectTimeoutMs,
      commandTimeout: VALKEY_DEFAULTS.commandTimeoutMs,
      maxRetriesPerRequest: 1,
      // TASK-014: no INFO-based ready check (the api ACL user is denied INFO); readiness is the PING probe.
      enableReadyCheck: false,
    });
    expect(JSON.stringify(options)).not.toContain('rediss://');
  });

  it('redis: has no TLS; defaults port 6379 and db 0; decodes credentials', () => {
    const options = buildValkeyOptions({ url: 'redis://user%40x:p%3Aw@valkey', connectionName: 'worker' });
    expect(options).toMatchObject({ host: 'valkey', port: 6379, db: 0, username: 'user@x', password: 'p:w' });
    expect(options.tls).toBeUndefined();
    expect(buildValkeyOptions({ url: 'redis://valkey/', connectionName: 'api' })).not.toHaveProperty('username');
  });

  it('an IP literal gets TLS without SNI (the certificate IP SAN is verified instead)', () => {
    expect(buildValkeyOptions({ url: 'rediss://10.0.0.5', connectionName: 'api' }).tls).toEqual({
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    });
    expect(buildValkeyOptions({ url: 'rediss://[::1]:6379', connectionName: 'api' })).toMatchObject({
      host: '::1',
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
  });

  it.each(['rediss://cache.staging.test:6380', 'rediss://10.0.0.5', 'rediss://[::1]:6379'])(
    '[PR9-SEC-04] %s pins tls.rejectUnauthorized to true, whatever NODE_TLS_REJECT_UNAUTHORIZED says @security',
    (url) => {
      const previous = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
      process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
      try {
        expect(buildValkeyOptions({ url, connectionName: 'api' }).tls?.rejectUnauthorized).toBe(true);
      } finally {
        if (previous === undefined) delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
        else process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = previous;
      }
    },
  );

  it.each([
    ['not a URL', 'valkey 6379', /not a valid URL/],
    ['another scheme', 'http://valkey', /redis:\/\/ or rediss:\/\//],
    ['a ?tls= query that would downgrade ioredis', 'rediss://valkey?tls=false', /query string/],
    ['a fragment', 'redis://valkey#x', /query string or fragment/],
    ['a non-numeric path', 'redis://valkey/cache', /database number/],
  ])('rejects %s without echoing the URL', (_label, url, message) => {
    const call = (): unknown => buildValkeyOptions({ url, connectionName: 'api' });
    expect(call).toThrow(ValkeyConfigError);
    expect(call).toThrow(message);
    expect(call).not.toThrow(url);
  });

  it.each([
    ['connectionName', { connectionName: 'API' }],
    ['connectTimeoutMs', { connectTimeoutMs: 0 }],
    ['commandTimeoutMs', { commandTimeoutMs: 60_001 }],
  ])('rejects an invalid %s', (_label, override) => {
    expect(() => buildValkeyOptions({ url: 'redis://valkey', connectionName: 'api', ...override })).toThrow(ValkeyConfigError);
  });

  it('reconnects with capped exponential backoff and equal jitter, and never gives up', () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(50);
    expect(reconnectDelayMs(1, () => 0.999_999)).toBe(100);
    expect(reconnectDelayMs(4, () => 0.5)).toBe(600);
    expect(reconnectDelayMs(1_000, () => 0.999_999)).toBe(VALKEY_DEFAULTS.reconnectCapMs);
    expect(reconnectDelayMs(0, () => 0)).toBe(50);
    const { retryStrategy } = buildValkeyOptions({ url: 'redis://valkey', connectionName: 'api', random: () => 0 });
    expect(retryStrategy(2)).toBe(100);
  });

  it('the readiness check needs PONG and honours an aborted signal', async () => {
    await expect(createValkeyCheck({ ping: () => Promise.resolve('PONG') }).check(new AbortController().signal)).resolves.toBeUndefined();
    await expect(createValkeyCheck({ ping: () => Promise.resolve('LOADING') }).check(new AbortController().signal)).rejects.toThrow();
    await expect(createValkeyCheck({ ping: () => Promise.resolve('PONG') }).check(AbortSignal.abort())).rejects.toThrow();
  });
});
