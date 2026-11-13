import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { createLogger, DROPPED_ATTRIBUTES_KEY, MANDATORY_KEYS, SERIALIZATION_FAILED, toSnakeCase } from './logger.js';
import { outboundCallFields } from './outbound.js';
import { OMITTED, REDACTED } from './redaction.js';
import { createSecurityEventSink } from './security-event.js';
import type { CreateLoggerOptions, LogContext } from './types.js';

const sentinel = (): string => `sentinel-${randomBytes(8).toString('hex')}`;
const FIXED_NOW = new Date(Date.UTC(2026, 10, 13, 9, 30, 0, 123));
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Harness {
  readonly raw: string[];
  readonly lines: () => Record<string, unknown>[];
  readonly last: () => Record<string, unknown>;
}

function harness(): Harness {
  const raw: string[] = [];
  const lines = (): Record<string, unknown>[] => raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    raw,
    lines,
    last: () => {
      const all = lines();
      const line = all.at(-1);
      if (line === undefined) throw new Error('no line written');
      return line;
    },
  };
}

function setup(overrides: Partial<CreateLoggerOptions> = {}, context?: LogContext): Harness & { logger: ReturnType<typeof createLogger> } {
  const sink = harness();
  const logger = createLogger({
    service: 'api',
    version: '1.2.3',
    destination: { write: (line: string) => sink.raw.push(line) },
    now: () => FIXED_NOW,
    ...(context === undefined ? {} : { context: () => context }),
    ...overrides,
  });
  return { ...sink, logger };
}

describe('createLogger', () => {
  it('[AT-US-008-04] a log call with keys password, token, authorization, cookie, set-cookie, secret, apiKey, totpCode, recoveryCode and cardNumber logs each value as "[REDACTED]"', () => {
    const { logger, last, raw } = setup();
    const keys = [
      'password',
      'token',
      'authorization',
      'cookie',
      'set-cookie',
      'secret',
      'apiKey',
      'totpCode',
      'recoveryCode',
      'cardNumber',
    ];
    const values = Object.fromEntries(keys.map((key) => [key, sentinel()]));
    logger.info('auth.attempt', values);
    const line = last();
    for (const key of keys) expect(line[key]).toBe(REDACTED);
    for (const value of Object.values(values)) expect(raw.join('')).not.toContain(value);
  });

  it('[AT-US-008-05] a line containing alice@example.com shows a***@example.com and every line has timestamp (UTC ISO 8601), level, message, service, version, correlation_id, org_id, actor_id', () => {
    const { logger, lines, raw } = setup({ now: () => new Date() });
    logger.info('user.lookup', { note: 'lookup for alice@example.com' });
    logger.warn('user.lookup_failed', {}, new Error('no row for alice@example.com'));
    logger.error('plain');
    expect(raw.join('')).not.toContain('alice@example.com');
    expect(lines()[0]?.['note']).toBe('lookup for a***@example.com');
    for (const line of lines()) {
      for (const key of MANDATORY_KEYS) expect(line).toHaveProperty(key);
      expect(line['timestamp']).toMatch(ISO_UTC);
      expect(line['correlation_id']).toBeNull();
      expect(line['org_id']).toBeNull();
      expect(line['actor_id']).toBeNull();
    }
  });

  it('writes the documented line shape with context values read per line', () => {
    let context: LogContext = { correlationId: 'c-1', requestId: 'r-1', orgId: 'o-1', actorId: 'a-1' };
    const { logger, lines } = setup({ context: () => context });
    logger.info('http.request', { status: 200 });
    context = { correlationId: 'c-2', clientCorrelationId: 'client-2' };
    logger.info('http.request');
    expect(lines()).toEqual([
      {
        level: 'info',
        timestamp: '2026-11-13T09:30:00.123Z',
        service: 'api',
        version: '1.2.3',
        correlation_id: 'c-1',
        org_id: 'o-1',
        actor_id: 'a-1',
        request_id: 'r-1',
        event: 'http.request',
        status: 200,
        message: 'http.request',
      },
      {
        level: 'info',
        timestamp: '2026-11-13T09:30:00.123Z',
        service: 'api',
        version: '1.2.3',
        correlation_id: 'c-2',
        org_id: null,
        actor_id: null,
        client_correlation_id: 'client-2',
        event: 'http.request',
        message: 'http.request',
      },
    ]);
  });

  it('fields and bindings never overwrite mandatory keys, event, event_type or err', () => {
    const { logger, last } = setup({}, { correlationId: 'c-1' });
    const forged = {
      timestamp: 'x',
      level: 'x',
      message: 'x',
      service: 'x',
      version: 'x',
      correlation_id: 'x',
      org_id: 'x',
      actor_id: 'x',
      request_id: 'x',
      client_correlation_id: 'x',
      event: 'x',
      event_type: 'x',
      err: 'x',
      kept: 1,
    };
    logger.child(forged).info('evt', forged);
    expect(last()).toEqual({
      level: 'info',
      timestamp: '2026-11-13T09:30:00.123Z',
      service: 'api',
      version: '1.2.3',
      correlation_id: 'c-1',
      org_id: null,
      actor_id: null,
      event: 'evt',
      kept: 1,
      message: 'evt',
    });
  });

  it('[SEC-TC-31] header objects nested in fields never leak the runtime-generated sentinels', () => {
    const { logger, raw } = setup({ level: 'trace' });
    const secrets = [sentinel(), sentinel(), sentinel(), sentinel(), sentinel()];
    const headers = {
      cookie: `sid=${secrets[0] ?? ''}`,
      'set-cookie': [`sid=${secrets[1] ?? ''}; HttpOnly`, `csrf=${secrets[2] ?? ''}`],
      authorization: `Bearer ${secrets[3] ?? ''}`,
      'proxy-authorization': `Basic ${secrets[4] ?? ''}`,
      accept: 'application/json',
    };
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      logger[level]('http.request', { req: { headers }, nested: { deeper: { headers } } });
    }
    const output = raw.join('');
    for (const value of secrets) expect(output).not.toContain(value);
    expect(output).toContain('application/json');
  });

  it('[PR6-SEC-02 item 3] carrier request/response bodies and url.full/url.path/url.query never appear at any level; form secrets and token responses are redacted', () => {
    const { logger, raw, lines } = setup({ level: 'trace' });
    const body = sentinel();
    const formSecret = sentinel();
    const childSecret = sentinel();
    const accessToken = sentinel();
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      logger[level]('carrier.call', {
        body: { shipment: body },
        requestBody: `grant_type=client_credentials&client_secret=${formSecret}`,
        responseBody: body,
        'url.full': `https://carrier.example/rates?account=${body}`,
        'url.path': `/rates/${body}`,
        'url.query': `account=${body}`,
        form: { client_secret: formSecret, child_secret: childSecret, grant_type: 'client_credentials' },
        carrierReply: { access_token: accessToken, token_type: 'Bearer', expires_in: 3600 },
        text: `client_secret=${formSecret}&child_secret=${childSecret}`,
      });
    }
    const output = raw.join('');
    for (const value of [body, formSecret, childSecret, accessToken]) expect(output).not.toContain(value);
    const first = lines()[0] ?? {};
    expect(first['body']).toBe(OMITTED);
    expect(first['url.full']).toBe(OMITTED);
    expect(first['carrierReply']).toEqual({ access_token: REDACTED, token_type: REDACTED, expires_in: 3600 });
    // The grant type value contains a sensitive keyword and is longer than it: the word rule redacts it too.
    expect(first['form']).toEqual({ client_secret: REDACTED, child_secret: REDACTED, grant_type: REDACTED });
  });

  it('serialises the thrown value into err', () => {
    const { logger, last } = setup();
    logger.error('job.failed', { job: 'x' }, 'secret-token-123');
    expect(last()['err']).toEqual({ name: 'string', value: REDACTED });
  });

  it('child bindings appear on every line, redacted at bind time, and nest', () => {
    const value = sentinel();
    const { logger, last } = setup();
    const child = logger.child({ component: 'carrier', password: value }).child({ carrier_code: 'DHL' });
    child.info('carrier.call', { component: 'override' });
    expect(last()).toMatchObject({ component: 'override', password: REDACTED, carrier_code: 'DHL' });
  });

  it('filters by level', () => {
    const { logger, raw } = setup({ level: 'warn' });
    logger.info('dropped');
    logger.debug('dropped');
    logger.trace('dropped');
    logger.warn('kept');
    expect(raw).toHaveLength(1);
    expect(logger.isLevelEnabled('warn')).toBe(true);
    expect(logger.isLevelEnabled('info')).toBe(false);
    const silent = setup({ level: 'silent' });
    silent.logger.fatal('dropped');
    expect(silent.raw).toHaveLength(0);
  });

  it('writes sink events with event_type, the bare event name and only the allow-listed snake_case attributes (PR #20 m2)', () => {
    const { logger, last, raw } = setup();
    const email = 'alice@example.com';
    createSecurityEventSink(logger).emit('login_failed', {
      sqlState: '42501',
      identifierHash: 'h-1',
      email,
      userEmail: email,
      ip: '203.0.113.7',
      name: 'Alice',
      username: 'alice',
      clientIp: '203.0.113.7',
      phoneNumber: '+15550100',
      shippingAddress: 'x',
      postcode: 'x',
      zip: 'x',
      firstName: 'Alice',
      lastName: 'Smith',
      fullName: 'Alice Smith',
      emailAccount: 'x',
      reason: `wrong password for ${email}`,
      correlationId: 'from-attr',
    });
    expect(last()).toEqual({
      level: 'warn',
      timestamp: '2026-11-13T09:30:00.123Z',
      service: 'api',
      version: '1.2.3',
      correlation_id: 'from-attr',
      org_id: null,
      actor_id: null,
      event_type: 'security',
      event: 'login_failed',
      identifier_hash: 'h-1',
      reason: 'wrong password for a***@example.com',
      [DROPPED_ATTRIBUTES_KEY]: 15,
      message: 'security.login_failed',
    });
    expect(raw.join('')).not.toContain('203.0.113.7');
    expect(raw.join('')).not.toContain('alice');
  });

  it('drops child-logger bindings that are not allow-listed for the event', () => {
    const { logger, last } = setup();
    createSecurityEventSink(logger.child({ component: 'database', host: 'db' })).emit('ssrf_blocked', {
      host: 'x.example',
      reason: 'PRIVATE',
    });
    expect(last()).toMatchObject({ event: 'ssrf_blocked', host: 'x.example', reason: 'PRIVATE', [DROPPED_ATTRIBUTES_KEY]: 1 });
    expect(last()).not.toHaveProperty('component');
  });

  it('keeps a coarse IP (an IPv4 /24 or IPv6 /48 prefix) and drops a precise one', () => {
    const { logger, lines } = setup();
    const sink = createSecurityEventSink(logger);
    sink.emit('registration_probe', { ipCoarse: '203.0.113.0/24', distinct_address_count: 6 });
    sink.emit('registration_probe', { ipCoarse: '2001:db8:1::/48' });
    sink.emit('registration_probe', { ipCoarse: '203.0.113.7' });
    expect(lines().map((line) => [line['ip_coarse'], line[DROPPED_ATTRIBUTES_KEY]])).toEqual([
      ['203.0.113.0/24', undefined],
      ['2001:db8:1::/48', undefined],
      [undefined, 1],
    ]);
  });

  it('[PR20-SEC-04] writes security events whatever the configured level, at their catalogue level', () => {
    for (const level of ['silent', 'fatal', 'error'] as const) {
      const { logger, lines } = setup({ level });
      const sink = createSecurityEventSink(logger);
      sink.emit('login_failed', { reason: 'BAD_PASSWORD' });
      sink.emit('db_session_default_tampered');
      logger.warn('ordinary.warning');
      expect(lines().map((line) => [line['level'], line['event']])).toEqual([
        ['warn', 'login_failed'],
        ['error', 'db_session_default_tampered'],
      ]);
    }
  });

  it('[PR20-SEC-08] a plain call named security.<x> is an ordinary line: no event_type, no level bypass', () => {
    const { logger, last, lines } = setup({ level: 'error' });
    logger.warn('security.login_failed', { username: 'x' });
    expect(lines()).toHaveLength(0);
    logger.error('security.login_failed', { note: 'n' });
    expect(last()).toMatchObject({ level: 'error', event: 'security.login_failed', note: 'n' });
    expect(last()).not.toHaveProperty('event_type');
  });

  it('lifts a valid correlation ID from security attributes when the context has none', () => {
    const { logger, last } = setup();
    createSecurityEventSink(logger).emit('csrf_rejected', { correlationId: 'attr-0001' });
    expect(last()['correlation_id']).toBe('attr-0001');
    createSecurityEventSink(logger).emit('csrf_rejected', { correlationId: 'bad id!' });
    expect(last()['correlation_id']).toBeNull();
  });

  it('prefers the context correlation id over a security attribute and never duplicates it', () => {
    const { logger, raw, last } = setup({}, { correlationId: 'ctx-1' });
    createSecurityEventSink(logger).emit('csrf_rejected', { correlationId: 'attr-0001', route: '/x' });
    expect(last()['correlation_id']).toBe('ctx-1');
    expect(raw.join('')).not.toContain('attr-0001');
  });

  it('[PR20-SEC-10] an outbound call line without context carries the call correlation ID', () => {
    const { logger, last } = setup();
    const fields = outboundCallFields({
      carrierCode: 'MOCK',
      accountId: 'a-1',
      operation: 'rates',
      routeTemplate: '/rates',
      durationMs: 5,
      correlationId: 'demo-booking-0001',
    });
    logger.info('carrier.call', fields);
    expect(last()).toMatchObject({ correlation_id: 'demo-booking-0001', carrier_code: 'MOCK' });
  });

  it('[PR20-SEC-08] reserved keys are compared in normalised form', () => {
    const { logger, last } = setup({}, { correlationId: 'ctx-1' });
    logger.info('evt', { 'Correlation-Id': 'forged', correlationId: 'forged', Event_Type: 'security', Level: 'fatal', kept: 1 });
    expect(last()).toMatchObject({ correlation_id: 'ctx-1', level: 'info', event: 'evt', kept: 1 });
    expect(Object.keys(last()).filter((key) => key !== 'correlation_id' && /correlation/i.test(key))).toEqual([]);
    expect(last()).not.toHaveProperty('event_type');
  });

  it('[PR20-SEC-08] escapes C1 controls and line separators in the event name and context values', () => {
    const { logger, raw } = setup({}, { orgId: 'org x', actorId: 'ab' });
    logger.info('evt name');
    const text = raw.join('');
    for (const character of [' ', ' ', '']) expect(text).not.toContain(character);
  });

  it('never throws: a failing destination or context degrades to a fallback line or nothing', () => {
    let calls = 0;
    const written: string[] = [];
    const flaky = createLogger({
      service: 'api',
      version: '1',
      now: () => FIXED_NOW,
      destination: {
        write: (line: string) => {
          calls += 1;
          if (calls === 1) throw new Error('disk full');
          written.push(line);
        },
      },
      context: () => {
        throw new Error('context broken');
      },
    });
    expect(() => {
      flaky.error('evt');
    }).not.toThrow();
    expect(written.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        level: 'error',
        timestamp: '2026-11-13T09:30:00.123Z',
        message: SERIALIZATION_FAILED,
        service: 'api',
        version: '1',
        correlation_id: null,
        org_id: null,
        actor_id: null,
        event: 'evt',
      },
    ]);
    const dead = createLogger({
      service: 'api',
      version: '1',
      destination: {
        write: () => {
          throw new Error('closed');
        },
      },
    });
    expect(() => {
      dead.info('evt');
    }).not.toThrow();
  });

  it('defaults to info, the system clock and no context', () => {
    const raw: string[] = [];
    const logger = createLogger({ service: 'worker', version: '0', destination: { write: (line: string) => raw.push(line) } });
    logger.debug('dropped');
    logger.info('kept', 'not an object' as unknown as Record<string, unknown>);
    const line = JSON.parse(raw[0] ?? '{}') as Record<string, unknown>;
    expect(raw).toHaveLength(1);
    expect(line['timestamp']).toMatch(ISO_UTC);
    expect(line['service']).toBe('worker');
  });
});

describe('toSnakeCase', () => {
  it.each([
    ['sqlState', 'sql_state'],
    ['HTTPStatus', 'http_status'],
    ['already_snake', 'already_snake'],
    ['url.path', 'url_path'],
    ['account-id', 'account_id'],
  ])('%s -> %s', (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});
