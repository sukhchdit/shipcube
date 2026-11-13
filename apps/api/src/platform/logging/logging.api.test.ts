// US-008 acceptance tests at the HTTP seam (AT-US-008-01/02/03/06), SEC-TC-31 (app part: Cookie, Set-Cookie and
// Authorization never reach the API log), AT-US-007-03 at the logging sink (PR #9 r1 m5: the full error is in the
// server log, redacted) and the security-event routing of runtime `security.*` events (PR #11 R3-m1). The real
// createApp with the real platform logger (level `debug`, so the health-probe access lines are visible) writing to an
// in-memory sink; no database needed.
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import request from 'supertest';

import { createApp } from '../../app.js';
import { CORRELATION_ID_PATTERN } from '../context/request-context.js';
import { defaultPipelineSlots, type PipelineSlots } from '../routing/pipeline.js';
import { ANONYMOUS, setPrincipal } from '../routing/route-state.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { createRuntimeLog } from '../runtime/log.js';
import { requestLogContext } from './correlation.js';
import { securityEventSinkFrom } from './security-events.js';

type Line = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sentinel = (label: string): string => `${label}-${randomBytes(12).toString('hex')}`;

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly raw: string[];
  lines(): Line[];
  setThrown(value: unknown): void;
}

/** HAR-style `{ name, value }` records of a raw header list (PR20-SEC-19). */
function headerRecords(raw: readonly string[]): { name: string; value: string }[] {
  const records: { name: string; value: string }[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) records.push({ name: raw[index] ?? '', value: raw[index + 1] ?? '' });
  return records;
}

/** The `__Host-` cookies of a Cookie header as parsed `{ name, value }` records (PR20-SEC-19). */
function hostCookies(header: string | undefined): { name: string; value: string }[] {
  return (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('__Host-'))
    .map((part) => ({ name: part.slice(0, part.indexOf('=')), value: part.slice(part.indexOf('=') + 1) }));
}

function harness(): Harness {
  const raw: string[] = [];
  let thrown: unknown = new Error('unset');
  const logger = createRuntimeLog(
    'api',
    { write: (line: string) => raw.push(line) },
    {
      version: '1.2.3',
      level: 'debug',
      context: requestLogContext,
    },
  );

  // Careless code holding the live request and response, keyed by operationId. Route handlers see the validated input
  // only (TASK-020), so the careless code runs in a test slot just before the handler: what it logs goes through the
  // same logging seam that a careless slot or handler would use.
  const careless: Readonly<Record<string, (req: Request, res: Response) => void>> = {
    widgetSession: (_req, res) => {
      res.cookie('session', sentinelCookie, { httpOnly: true });
    },
    widgetHeaders: (req) => {
      // A careless handler logging the whole header object: redaction at the logging seam still holds.
      logger.info('test.headers', { headers: req.headers });
    },
    widgetRaw: (req, res) => {
      // PR20-SEC-01: a careless handler logging the live request, its socket and the raw header forms.
      logger.info('test.raw', {
        req,
        socket: req.socket,
        raw: req.rawHeaders,
        trailers: req.rawTrailers,
        entries: Object.entries(req.headers),
        note: `Cookie: ${String(req.headers.cookie)}`,
        // PR20-SEC-19: HAR / HTTP-trace header records, a parsed Set-Cookie record and a tough-cookie record.
        har: headerRecords(req.rawHeaders),
        parsed: hostCookies(req.headers.cookie).map((cookie) => ({ ...cookie, path: '/', secure: true })),
        jar: hostCookies(req.headers.cookie).map(({ name, value }) => ({ key: name, value })),
      });
      res.once('finish', () => logger.info('test.res', { res }));
    },
    widgetText: (req) => {
      // PR20-SEC-13: a careless handler that turns the raw header list or the live request into text first, echoes the
      // refresh cookie as a Set-Cookie value under a neutral key, and puts the request target into a message.
      const refreshPair = /__Host-rt_[0-9a-f]+=[^;]+/.exec(String(req.headers.cookie))?.[0] ?? '';
      const parsed: unknown = Reflect.get(req, '_parsedUrl');
      logger.info('test.text', {
        detail: JSON.stringify(req.rawHeaders),
        escaped: JSON.stringify({ raw: JSON.stringify(req.rawHeaders) }),
        listed: inspect(req.rawHeaders),
        listedWide: inspect(req.rawHeaders, { breakLength: Infinity }),
        // The full rendering is cut at 8 KiB before its URL and header parts; the shallow ones reach them.
        inspected: inspect(req),
        inspectedShallow: inspect(req, { depth: 0 }),
        inspectedParts: inspect({ url: req.url, originalUrl: req.originalUrl, headers: req.headers, parsed }),
        value: `${refreshPair}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      });
      logger.error('test.text_failed', { note: `GET ${req.originalUrl} failed` }, new Error(`upstream failed for ${req.originalUrl}`));
    },
  };
  const defaults = defaultPipelineSlots({ tenantTx: undefined });
  const pipeline: PipelineSlots = {
    ...defaults,
    // The requests carry credential sentinels, which the authn stub refuses until TASK-052 (D-ARCH-107 (5)); this
    // stand-in accepts them as anonymous so the careless code below runs with them (what is logged is under test).
    authenticate: () => (_req: Request, res: Response, next: NextFunction) => {
      setPrincipal(res, ANONYMOUS);
      next();
    },
    etag: (route) => (req: Request, res: Response, next: NextFunction) => {
      careless[route.operationId]?.(req, res);
      next();
    },
  };
  const ok = (): { status: number; body: unknown } => ({ status: 200, body: { ok: true } });
  const query = Joi.object({ q: Joi.string(), page: Joi.string() });

  const health = [fixtureRoute({ operationId: 'getLive', path: '/health/live', handler: () => ({ status: 200, body: { status: 'ok' } }) })];
  const widgets = [
    fixtureRoute({
      operationId: 'widgetEcho',
      method: 'post',
      path: '/widgets/:widgetId/echo',
      schema: {
        params: Joi.object({ widgetId: Joi.string() }),
        query: Joi.object({ token: Joi.string() }),
        body: Joi.object({ note: Joi.string(), email: Joi.string() }),
      },
      handler: ({ input }) => ({ status: 201, body: { received: typeof input.body } }),
    }),
    fixtureRoute({ operationId: 'widgetSession', path: '/widgets/session', handler: ok }),
    fixtureRoute({ operationId: 'widgetHeaders', path: '/widgets/headers', handler: ok }),
    fixtureRoute({ operationId: 'widgetRaw', path: '/widgets/raw', schema: { query }, handler: ok }),
    fixtureRoute({ operationId: 'widgetText', path: '/widgets/text', schema: { query }, handler: ok }),
    fixtureRoute({
      operationId: 'widgetThrows',
      path: '/widgets/throws',
      handler: () => {
        throw thrown;
      },
    }),
  ];

  const app = createApp({ health, modules: [{ name: 'widgets', routes: widgets }], logger, pipeline });
  return {
    app,
    raw,
    lines: () => raw.map((line) => JSON.parse(line) as Line),
    setThrown: (value) => {
      thrown = value;
    },
  };
}

const sentinelCookie = sentinel('cookie');

function accessLines(lines: readonly Line[]): Line[] {
  return lines.filter((line) => line['event'] === 'http.request');
}

describe('US-008 correlation IDs in the API log', () => {
  it('[AT-US-008-01] a valid inbound correlation ID is echoed and carried by every line of the request', async () => {
    const h = harness();
    const res = await request(h.app).get('/health/live').set('X-Correlation-Id', 'abc-12345678');
    expect(res.headers['x-correlation-id']).toBe('abc-12345678');
    const [access] = accessLines(h.lines());
    expect(access).toMatchObject({ correlation_id: 'abc-12345678', client_correlation_id: 'abc-12345678' });
    // PR9-SEC-10: the server always generates its own request ID; the client value is never the only key.
    expect(access?.['request_id']).toMatch(UUID);
  });

  it('[AT-US-008-02] an invalid inbound value is replaced by a generated UUID and never logged', async () => {
    const h = harness();
    const res = await request(h.app).get('/health/live').set('X-Correlation-Id', 'bad id!');
    const echoed = String(res.headers['x-correlation-id']);
    expect(echoed).toMatch(UUID);
    expect(echoed).toMatch(CORRELATION_ID_PATTERN);
    const [access] = accessLines(h.lines());
    expect(access?.['correlation_id']).toBe(echoed);
    expect(access).not.toHaveProperty('client_correlation_id');
    expect(access?.['request_id']).not.toBe(echoed);
    expect(h.raw.join('')).not.toContain('bad id!');
  });

  it('[AT-US-008-03] the booking correlation ID is on the api lines of the request and on its error line (api and worker log lines; end to end in TASK-092)', async () => {
    const h = harness();
    h.setThrown(new Error('carrier timeout'));
    await request(h.app).get('/api/v1/widgets/throws').set('X-Correlation-Id', 'demo-booking-0001');
    const lines = h.lines().filter((line) => line['event'] === 'http.request' || line['event'] === 'http.request_failed');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line['correlation_id']).toBe('demo-booking-0001');
  });
});

describe('US-008 access log content', () => {
  it('[AT-US-008-06] a POST with a JSON body logs method, route template, status and duration and no body content', async () => {
    const h = harness();
    const bodySecret = sentinel('body');
    const querySecret = sentinel('query');
    await request(h.app)
      .post(`/api/v1/widgets/w-42/echo?token=${querySecret}`)
      .set('Content-Type', 'application/json')
      .send({ note: bodySecret, email: 'alice@example.com' });
    const [access] = accessLines(h.lines());
    expect(access).toMatchObject({ level: 'info', method: 'POST', route: '/api/v1/widgets/:widgetId/echo', status: 201 });
    expect(typeof access?.['duration_ms']).toBe('number');
    for (const key of ['body', 'url', 'path', 'query', 'headers']) expect(access).not.toHaveProperty(key);
    const all = h.raw.join('');
    for (const leaked of [bodySecret, querySecret, 'w-42', 'alice@example.com']) expect(all).not.toContain(leaked);
  });

  it('every line carries the mandatory keys (AT-US-008-05 at the HTTP seam)', async () => {
    const h = harness();
    await request(h.app).get('/health/live');
    for (const line of h.lines()) {
      for (const key of ['timestamp', 'level', 'message', 'service', 'version', 'correlation_id', 'org_id', 'actor_id']) {
        expect(line).toHaveProperty(key);
      }
      expect(line).toMatchObject({ service: 'api', version: '1.2.3', org_id: null, actor_id: null });
      expect(String(line['timestamp'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('records the route template on the error path and null when no route matched', async () => {
    const h = harness();
    await request(h.app).get('/api/v1/widgets/throws');
    await request(h.app).get('/api/v1/nowhere/at-all');
    await request(h.app).delete('/health/live');
    expect(accessLines(h.lines()).map((line) => [line['route'], line['status']])).toEqual([
      ['/api/v1/widgets/throws', 500],
      [null, 404],
      [null, 405],
    ]);
  });
});

describe('[SEC-TC-31] Cookie, Set-Cookie and Authorization never reach the API log', () => {
  it('[SEC-TC-31] header sentinels are absent from every line, including a handler that logs the raw headers', async () => {
    const h = harness();
    const cookie = sentinel('cookie');
    const bearer = sentinel('bearer');
    const basic = Buffer.from(`user:${sentinel('basic')}`).toString('base64');
    const res = await request(h.app)
      .get('/api/v1/widgets/headers')
      .set('Cookie', `session=${cookie}; theme=dark`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('Proxy-Authorization', `Basic ${basic}`);
    expect(res.status).toBe(200);
    await request(h.app).get('/api/v1/widgets/session');
    const all = h.raw.join('');
    for (const leaked of [cookie, bearer, basic, sentinelCookie]) expect(all).not.toContain(leaked);
    const logged = h.lines().find((line) => line['event'] === 'test.headers');
    expect(logged?.['headers']).toMatchObject({ cookie: '[REDACTED]', authorization: '[REDACTED]', 'proxy-authorization': '[REDACTED]' });
  });

  it('[SEC-TC-31] [PR20-SEC-01] [PR20-SEC-19] req, res, socket, rawHeaders, header entries and records, Cookie text never leak', async () => {
    const h = harness();
    const theme = sentinel('theme');
    const refresh = sentinel('refresh');
    const proof = sentinel('proof');
    const quote = sentinel('quote');
    const apiKey = sentinel('apikey');
    const dpop = sentinel('dpop');
    const query = sentinel('query');
    const res = await request(h.app)
      .get(`/api/v1/widgets/raw?q=${query}`)
      .set('Cookie', `theme=${theme}; __Host-rt_${randomBytes(4).toString('hex')}=${refresh}`)
      .set('X-Reauth-Proof', proof)
      .set('X-Quote-Token', quote)
      .set('X-Api-Key', apiKey)
      .set('Authorization', `DPoP ${dpop}`);
    expect(res.status).toBe(200);
    const all = h.raw.join('');
    for (const leaked of [theme, refresh, proof, quote, apiKey, dpop, query]) expect(all).not.toContain(leaked);
    // Positive controls: the lines were written, live objects summarised, the raw forms redacted pair by pair.
    const raw = h.lines().find((line) => line['event'] === 'test.raw');
    expect(raw).toMatchObject({ req: '[Unsupported]', socket: '[Unsupported]', note: 'Cookie: [REDACTED]' });
    // Header names that contain a keyword (X-Quote-Token, X-Reauth-Proof) are redacted as words too (fails closed).
    expect(raw?.['raw']).toEqual(expect.arrayContaining(['Cookie', 'X-Api-Key', '[REDACTED]']));
    expect(raw?.['entries']).toEqual(
      expect.arrayContaining([
        ['cookie', '[REDACTED]'],
        ['x-api-key', '[REDACTED]'],
      ]),
    );
    // PR20-SEC-19: the records were written and only their credential values redacted (the Host value stays readable).
    expect(raw?.['har']).toEqual(
      expect.arrayContaining([
        { name: '[REDACTED]', value: '[REDACTED]' },
        { name: '[REDACTED]', value: expect.stringContaining('127.0.0.1') },
      ]),
    );
    expect((raw?.['har'] as unknown[] | undefined)?.length).toBeGreaterThanOrEqual(6);
    expect(raw?.['parsed']).toEqual([{ name: '[REDACTED]', value: '[REDACTED]', path: '/', secure: true }]);
    expect(raw?.['jar']).toEqual([{ key: expect.stringMatching(/^__Host-rt_[0-9a-f]+$/), value: '[REDACTED]' }]);
    expect(h.lines().find((line) => line['event'] === 'test.res')).toMatchObject({ res: '[Unsupported]' });
  });
});

describe('[SEC-TC-31] [PR20-SEC-13] free-text renderings of the raw header list and the live request', () => {
  it('[SEC-TC-31] [PR20-SEC-13] JSON.stringify(rawHeaders), util.inspect(req), a Set-Cookie value and req.originalUrl never leak', async () => {
    const h = harness();
    const theme = sentinel('theme');
    const refresh = sentinel('refresh');
    const proof = sentinel('proof');
    const quote = sentinel('quote');
    const apiKey = sentinel('apikey');
    const csrf = sentinel('csrf');
    const dpop = sentinel('dpop');
    const query = sentinel('query');
    const res = await request(h.app)
      .get(`/api/v1/widgets/text?q=${query}&page=2`)
      .set('Cookie', `theme=${theme}; __Host-rt_${randomBytes(4).toString('hex')}=${refresh}`)
      .set('X-Reauth-Proof', proof)
      .set('X-Quote-Token', quote)
      .set('X-Api-Key', apiKey)
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `DPoP ${dpop}`);
    expect(res.status).toBe(200);
    const all = h.raw.join('');
    for (const leaked of [theme, refresh, proof, quote, apiKey, csrf, dpop, query]) expect(all).not.toContain(leaked);
    // Positive controls: the lines were written and keep the non-sensitive parts readable.
    const text = h.lines().find((line) => line['event'] === 'test.text');
    expect(String(text?.['detail'])).toContain('"Cookie",[REDACTED]');
    expect(String(text?.['detail'])).toContain('"X-Api-Key",[REDACTED]');
    expect(String(text?.['listed'])).toContain("'X-Api-Key',");
    expect(String(text?.['inspectedShallow'])).toContain('originalUrl: [OMITTED]');
    expect(String(text?.['inspectedShallow'])).toContain("method: 'GET'");
    expect(String(text?.['inspectedParts'])).toContain('search: [OMITTED]');
    expect(String(text?.['inspectedParts'])).toContain('query: [OMITTED]');
    expect(String(text?.['inspectedParts'])).toContain("host: '127.0.0.1:");
    expect(String(text?.['value'])).toMatch(/^__Host-rt_[0-9a-f]+=\[REDACTED\]; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
    const failed = h.lines().find((line) => line['event'] === 'test.text_failed');
    expect(failed?.['note']).toBe('GET /api/v1/widgets/text?[OMITTED] failed');
    expect(String((failed?.['err'] as Record<string, unknown> | undefined)?.['message'])).toBe(
      'upstream failed for /api/v1/widgets/text?[OMITTED]',
    );
  });
});

describe('AT-US-007-03 at the logging sink (PR #9 r1 m5)', () => {
  it('[AT-US-007-03] the full error is in the server log: class, redacted message and stack; the body stays generic', async () => {
    const h = harness();
    // n9: a secret with no keyword in it, reachable only by the key=value pair rule.
    const pairValue = sentinel('value');
    const error = new Error(`relation "users" failed for secret-token-123 while loading; password=${pairValue}`);
    h.setThrown(error);
    const res = await request(h.app).get('/api/v1/widgets/throws');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secret-token-123');
    const failed = h.lines().find((line) => line['event'] === 'http.request_failed');
    expect(failed).toMatchObject({ level: 'error', code: 'INTERNAL_ERROR', status: 500, error_class: 'Error' });
    const err = failed?.['err'] as Record<string, unknown> | undefined;
    expect(err?.['name']).toBe('Error');
    expect(String(err?.['message'])).toContain('while loading');
    expect(String(err?.['stack'])).toContain('logging.api.test');
    expect(h.raw.join('')).not.toContain('secret-token-123');
    expect(h.raw.join('')).not.toContain(pairValue);
    expect(String(err?.['message'])).toContain('password=[REDACTED]');
  });

  it('[PR7-SEC-03 item 3] a database error reaches the log as { name, code, originalCode, kind } only', async () => {
    const h = harness();
    const secret = sentinel('row');
    class PrismaClientKnownRequestError extends Error {
      override readonly name = 'PrismaClientKnownRequestError';
      readonly code = 'P2039';
      readonly clientVersion = '7.10.1';
      readonly meta = {
        modelName: 'users',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: { kind: 'postgres', originalCode: '42501', originalMessage: `policy for table "users" (${secret})`, detail: secret },
        },
      };
    }
    h.setThrown(new PrismaClientKnownRequestError(`Database error. Code: 42501. Message: table "users" (${secret})`));
    await request(h.app).get('/api/v1/widgets/throws');
    const failed = h.lines().find((line) => line['event'] === 'http.request_failed');
    expect(failed?.['err']).toEqual({ name: 'PrismaClientKnownRequestError', code: 'P2039', originalCode: '42501', kind: 'postgres' });
    expect(h.raw.join('')).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain('users');
  });
});

describe('security events from the runtime log (PR #11 R3-m1)', () => {
  it('runtime events written through the sink are security events with only allow-listed scalar attributes', () => {
    const raw: string[] = [];
    const log = createRuntimeLog('api', { write: (line: string) => raw.push(line) }, { level: 'silent' });
    securityEventSinkFrom(log).emit('db_role_setting_drift', { component: 'database', sqlState: '42501' });
    const [line] = raw.map((entry) => JSON.parse(entry) as Line);
    expect(line).toMatchObject({
      level: 'error',
      event_type: 'security',
      event: 'db_role_setting_drift',
      message: 'security.db_role_setting_drift',
      sql_state: '42501',
      dropped_attributes: 1,
    });
    expect(line).not.toHaveProperty('component');
  });

  it('[PR20-SEC-08] a plain log call named security.<x> is an ordinary line, not a security event', () => {
    const raw: string[] = [];
    const log = createRuntimeLog('api', { write: (line: string) => raw.push(line) });
    log.warn('security.db_role_setting_drift', { component: 'database' });
    const [line] = raw.map((entry) => JSON.parse(entry) as Line);
    expect(line).toMatchObject({ level: 'warn', event: 'security.db_role_setting_drift', component: 'database' });
    expect(line).not.toHaveProperty('event_type');
  });
});
