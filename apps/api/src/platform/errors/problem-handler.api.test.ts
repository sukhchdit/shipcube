// US-007 acceptance tests (AT-US-007-01..05) against the real createApp with stub routers; no database needed.
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';
import express, { type Express } from 'express';
import fc from 'fast-check';
import request, { type Response as TestResponse } from 'supertest';

import { createApp, type AppLogger } from '../../app.js';
import { CORRELATION_ID_PATTERN, currentRequestContext } from '../context/request-context.js';
import { isAuditableMutationResponse } from './error-response.js';
import { GENERIC_SERVER_DETAIL } from './problem.js';

interface LoggedError {
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
  readonly thrown: unknown;
}

const rejectWith = (reason: unknown) =>
  new Promise<never>(() => {
    throw reason;
  });

interface Harness {
  readonly app: Express;
  readonly logged: LoggedError[];
  /** Per request: whether the audit-capture seam would record the response as a mutation. */
  readonly auditable: boolean[];
  /** Bodies the echo handler received (proves a refused request never reached it). */
  readonly echoed: unknown[];
  setThrown(value: unknown): void;
}

function harness(): Harness {
  const logged: LoggedError[] = [];
  const auditable: boolean[] = [];
  const echoed: unknown[] = [];
  let thrown: unknown;
  const logger: AppLogger = {
    info: () => undefined,
    error: (event, fields, value) => logged.push({ event, fields, thrown: value }),
  };

  const health = express.Router();
  // Stands in for audit capture (TASK-029): it observes every finished response through the public predicate.
  health.use((_req, res, next) => {
    res.on('finish', () => auditable.push(isAuditableMutationResponse(res)));
    next();
  });
  health.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const widgets = express.Router();
  widgets.get('/widgets', (_req, res) => {
    res.json([]);
  });
  widgets.get('/widgets/:id', (req, res) => {
    res.json({ id: req.params['id'] });
  });
  widgets.post('/echo', (req, res) => {
    echoed.push(req.body);
    res.status(201).json({ body: req.body as unknown, correlationId: currentRequestContext()?.correlationId });
  });
  widgets.get('/boom', () => {
    throw new Error('boom at /srv/app/dist/modules/widgets/service.js');
  });
  widgets.get('/throws', () => rejectWith(thrown));
  widgets.get('/download', (_req, res) => {
    res.set({ ETag: '"v1"', 'Last-Modified': 'Wed, 11 Nov 2026 10:00:00 GMT', 'Cache-Control': 'public, max-age=3600' });
    res.set({ 'Content-Disposition': 'attachment; filename="label.pdf"', 'Content-Language': 'en' });
    throw new AppError('NOT_FOUND');
  });
  widgets.get('/unserialisable', () => {
    throw new AppError('VALIDATION_ERROR', { errors: [{ pointer: '/body/a', code: 'X', message: 10n as unknown as string }] });
  });
  widgets.get('/private', () => {
    throw new AppError('AUTH_REQUIRED');
  });

  const app = createApp({ healthRouter: health, modules: [{ name: 'widgets', router: widgets }], logger });
  return {
    app,
    logged,
    auditable,
    echoed,
    setThrown: (value) => {
      thrown = value;
    },
  };
}

const PROBLEM_KEYS = ['code', 'correlation_id', 'detail', 'instance', 'status', 'title', 'type'];

function problemOf(res: TestResponse): Record<string, unknown> {
  return res.body as Record<string, unknown>;
}

function expectProblem(res: TestResponse, status: number, code: string): Record<string, unknown> {
  const body = problemOf(res);
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json(;|$)/);
  expect(Object.keys(body).sort()).toEqual(PROBLEM_KEYS);
  expect(body).toMatchObject({ status, code, type: `https://docs.platform.invalid/problems/${code}` });
  expect(body['correlation_id']).toMatch(CORRELATION_ID_PATTERN);
  expect(res.headers['x-correlation-id']).toBe(body['correlation_id']);
  // PR-0009 m4: a problem document is never stored by a cache.
  expect(res.headers['cache-control']).toBe('no-store');
  return body;
}

describe('US-007 central error handler and framework error mapping', () => {
  const { app } = harness();

  it('AT-US-007-01-1: GET /api/v1/does-not-exist -> 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/does-not-exist?token=abc');
    const body = expectProblem(res, 404, 'NOT_FOUND');
    expect(body).toMatchObject({ title: 'Not found', detail: 'Not found.', instance: '/api/v1/does-not-exist' });
  });

  it('AT-US-007-01-2: DELETE on a GET-only route -> 405 METHOD_NOT_ALLOWED', async () => {
    expectProblem(await request(app).delete('/api/v1/widgets'), 405, 'METHOD_NOT_ALLOWED');
  });

  it('AT-US-007-01-3: POST with body "{bad json" -> 400 MALFORMED_REQUEST', async () => {
    const res = await request(app).post('/api/v1/echo').set('Content-Type', 'application/json').send('{bad json');
    expectProblem(res, 400, 'MALFORMED_REQUEST');
  });

  it('AT-US-007-01-4: POST with a 2 MB body -> 413 PAYLOAD_TOO_LARGE', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) });
    const res = await request(app).post('/api/v1/echo').set('Content-Type', 'application/json').send(big);
    expectProblem(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('AT-US-007-01-5: POST with Content-Type text/plain -> 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app).post('/api/v1/echo').set('Content-Type', 'text/plain').send('hello');
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('AT-US-007-01-6: route handler throws an uncaught error -> 500 INTERNAL_ERROR', async () => {
    const body = expectProblem(await request(app).get('/api/v1/boom'), 500, 'INTERNAL_ERROR');
    expect(body['detail']).toBe(GENERIC_SERVER_DETAIL);
  });

  it('AT-US-007-02: 405 includes the Allow header ("GET, HEAD" for a GET-only route)', async () => {
    const health = await request(app).delete('/health/live');
    expectProblem(health, 405, 'METHOD_NOT_ALLOWED');
    expect(health.headers['allow']).toBe('GET, HEAD');
    const widget = await request(app).delete('/api/v1/widgets/42');
    expect(widget.headers['allow']).toBe('GET, HEAD');
    expect((await request(app).get('/api/v1/echo')).headers['allow']).toBe('POST');
  });

  it('maps an undecodable path parameter to 400 MALFORMED_REQUEST', async () => {
    expectProblem(await request(app).get('/api/v1/widgets/%E0%A4%A'), 400, 'MALFORMED_REQUEST');
  });

  it('serves successful requests normally, parses JSON and keeps the request context after body parsing', async () => {
    const res = await request(app).post('/api/v1/echo').send({ a: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ body: { a: 1 }, correlationId: res.headers['x-correlation-id'] });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect((await request(app).get('/health/live')).status).toBe(200);
    expect((await request(app).post('/api/v1/echo')).status).toBe(201);
  });

  it('echoes a valid inbound X-Correlation-Id on errors and replaces an invalid one with a UUID', async () => {
    const valid = await request(app).get('/api/v1/nope').set('X-Correlation-Id', 'abc-12345678');
    expect(valid.headers['x-correlation-id']).toBe('abc-12345678');
    expect(problemOf(valid)['correlation_id']).toBe('abc-12345678');
    const invalid = await request(app).get('/api/v1/nope').set('X-Correlation-Id', 'bad id!');
    expect(invalid.headers['x-correlation-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('AT-US-007-03: 5xx never leaks internals', () => {
  const SECRET = 'secret-token-123';
  const FORBIDDEN = [SECRET, 'SELECT', 'users', 'stack', ' at ', '/srv/', '.ts', '.js', 'DatabaseError', 'node_modules'];

  function expectGeneric500(res: TestResponse): void {
    const body = expectProblem(res, 500, 'INTERNAL_ERROR');
    expect(body['detail']).toBe(GENERIC_SERVER_DETAIL);
    for (const fragment of FORBIDDEN) expect(res.text).not.toContain(fragment);
  }

  class DatabaseError extends Error {
    readonly code = '42P01';
    readonly where = `SQL statement "SELECT * FROM users WHERE token = '${SECRET}'"`;
    readonly file = '/srv/app/node_modules/pg/lib/client.js';
  }

  it('AT-US-007-03: a database error with SQL text and a thrown string answer the generic detail; the full error is logged', async () => {
    const { app, logged, setThrown } = harness();
    for (const value of [new DatabaseError(`relation "users" does not exist: SELECT * FROM users -- ${SECRET}`), SECRET]) {
      setThrown(value);
      const res = await request(app).get('/api/v1/throws');
      expectGeneric500(res);
      const entry = logged.at(-1);
      expect(entry?.thrown).toBe(value);
      expect(entry?.fields).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, correlation_id: res.headers['x-correlation-id'] });
    }
    expect(logged.map((entry) => entry.fields?.['error_class'])).toEqual(['DatabaseError', 'string']);
  });

  it('[PR7-SEC-03 item 2] a Prisma driver-adapter error never contributes message, originalMessage, detail, hint or meta', async () => {
    const { app, setThrown } = harness();
    class PrismaClientKnownRequestError extends Error {
      readonly code = 'P2039';
      readonly clientVersion = '7.10.1';
      readonly meta = {
        modelName: 'users',
        driverAdapterError: {
          cause: {
            originalCode: '42501',
            originalMessage: `new row violates row-level security policy for table "users" (${SECRET})`,
            kind: 'postgres',
            detail: `Failing row contains (${SECRET})`,
            hint: 'SELECT set_config(...)',
          },
        },
      };
    }
    setThrown(new PrismaClientKnownRequestError(`Invalid \`prisma.users.create()\` invocation: ${SECRET}`));
    expectGeneric500(await request(app).get('/api/v1/throws'));
  });

  it('AT-US-007-03: a 5xx AppError carrying a secret detail still answers the generic detail', async () => {
    const { app, setThrown } = harness();
    setThrown(new AppError('SERVICE_UNAVAILABLE', { detail: `pool exhausted for ${SECRET}`, cause: new Error(SECRET) }));
    const res = await request(app).get('/api/v1/throws');
    expect(res.status).toBe(503);
    expect(problemOf(res)['detail']).toBe(GENERIC_SERVER_DETAIL);
    expect(res.text).not.toContain(SECRET);
  });

  it('AT-US-007-03: property: any thrown value (non-Errors, throwing getters, hostile Proxies) answers the same generic 500', async () => {
    const { app, setThrown } = harness();
    const throwing = (): never => {
      throw new Error(SECRET);
    };
    const hostile = fc.constantFrom<unknown>(
      Object.defineProperties(new Error(SECRET), {
        type: { get: throwing },
        status: { get: throwing },
        message: { get: throwing },
        stack: { get: throwing },
      }),
      Object.defineProperty({}, 'toString', { get: throwing }),
      new Proxy(new Error(SECRET), { getPrototypeOf: throwing, get: throwing, getOwnPropertyDescriptor: throwing }),
      new Proxy({}, { getPrototypeOf: throwing, ownKeys: throwing, get: throwing }),
      Object.assign(new Error(SECRET), { type: 'entity.parse.failed.not', status: 400, expose: true }),
      { type: 'entity.parse.failed', status: 400, message: SECRET },
      Object.create(null) as unknown,
    );
    const values = fc.oneof(
      fc.anything(),
      fc.string().map((text) => `${SECRET} ${text}`),
      fc.string().map((text) => new Error(`${SECRET} SELECT ${text}`)),
      hostile,
    );
    await fc.assert(
      fc.asyncProperty(values, async (value) => {
        setThrown(value);
        expectGeneric500(await request(app).get('/api/v1/throws'));
      }),
      { numRuns: 60 },
    );
  });
});

describe('AT-US-007-04: unauthenticated caller still receives problem+json', () => {
  const { app } = harness();

  it('AT-US-007-04: an unknown route answers the same 404 problem+json with or without credentials', async () => {
    const anonymous = expectProblem(await request(app).get('/api/v1/unknown'), 404, 'NOT_FOUND');
    const bearer = expectProblem(await request(app).get('/api/v1/unknown').set('Authorization', 'Bearer not-a-token'), 404, 'NOT_FOUND');
    expect({ ...bearer, correlation_id: 'x' }).toEqual({ ...anonymous, correlation_id: 'x' });
  });

  it('AT-US-007-04 (seam until authn, TASK-020): a route rejecting the caller with AUTH_REQUIRED answers 401 problem+json', async () => {
    const body = expectProblem(await request(app).get('/api/v1/private'), 401, 'AUTH_REQUIRED');
    expect(body['detail']).toBe('Authentication required.');
  });
});

describe('AT-US-007-05: error response is not audited as a mutation', () => {
  it('AT-US-007-05: a 404 for an unknown route is marked as an error response, so the audit-capture seam (TASK-029) records no mutation', async () => {
    const { app, auditable } = harness();
    expect((await request(app).post('/api/v1/echo').send({ a: 1 })).status).toBe(201);
    expectProblem(await request(app).post('/api/v1/unknown').send({ a: 1 }), 404, 'NOT_FOUND');
    expect(auditable).toEqual([true, false]);
  });
});

describe('[PR-0009 m4, PR9-SEC-07] problem responses are not cacheable and never fall back to HTML', () => {
  it('drops representation headers a handler set before throwing and sends Cache-Control: no-store', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/v1/download');
    expectProblem(res, 404, 'NOT_FOUND');
    for (const header of ['last-modified', 'content-disposition', 'content-language']) expect(res.headers[header]).toBeUndefined();
    // Express may add its own weak ETag of the problem body; the handler's representation ETag is gone.
    expect(res.headers['etag']).not.toBe('"v1"');
  });

  it('a failure while building the problem (unserialisable errors entry) still answers a generic 500 problem+json', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/v1/unserialisable');
    const body = expectProblem(res, 500, 'INTERNAL_ERROR');
    expect(body['detail']).toBe(GENERIC_SERVER_DETAIL);
    expect(body['instance']).toBe('/api/v1/unserialisable');
    expect(res.text).not.toMatch(/<html|BigInt|TypeError| at /u);
  });
});

describe('[PR-0009 m1] corrupt compressed bodies are client errors', () => {
  /** Sends raw bytes over a real listener (superagent would JSON-serialise a Buffer sent as application/json). */
  async function postRaw(app: Express, headers: Record<string, string>, body: Buffer) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${String(port)}/api/v1/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      const text = await response.text();
      return { status: response.status, headers: Object.fromEntries(response.headers), text, body: JSON.parse(text) as unknown };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const json = Buffer.from('{"a":1}');

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)('a corrupt %s body answers 400 MALFORMED_REQUEST, nothing is logged and no handler runs', async (encoding, compress) => {
    const { app, echoed, logged } = harness();
    const valid = compress(json);
    const corrupt = Buffer.concat([valid.subarray(0, 4), Buffer.from('corrupted stream bytes'), valid.subarray(4)]);
    const res = await postRaw(app, { 'Content-Encoding': encoding }, corrupt);
    expectProblem(res as unknown as TestResponse, 400, 'MALFORMED_REQUEST');
    expect(echoed).toEqual([]);
    expect(logged).toEqual([]);
  });

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)('a valid %s body is parsed', async (encoding, compress) => {
    const { app } = harness();
    const res = await postRaw(app, { 'Content-Encoding': encoding }, compress(json));
    expect(res.status).toBe(201);
    expect((res.body as { body: unknown }).body).toEqual({ a: 1 });
  });
});

describe('[PR9-SEC-01] JSON bodies are UTF-8 only', () => {
  // Raw UTF-7 bytes contain neither "role" nor "<script"; decoded they add both (security review probe).
  const utf7 = '{"a":"x+ACI-,+ACI-role+ACI-:+ACI-admin+ACI-,+ACI-n+ACI-:+ACI-+ADw-script+AD4-"}';

  it('a UTF-7 body that smuggles keys and markup answers 415 and the handler never runs', async () => {
    const { app, echoed } = harness();
    const res = await request(app).post('/api/v1/echo').set('Content-Type', 'application/json; charset=utf-7').send(utf7);
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(echoed).toEqual([]);
  });

  it.each([
    'application/json; charset=utf-16le',
    'application/json; charset=UTF-16',
    'application/json; charset=utf-32',
    'application/json; charset="utf-7"',
    'application/json; charset=utf-8; charset=utf-7',
    'application/json; charset',
    'application/json; charset=utf-8;;=x',
    'application/json; charset="utf-8',
  ])('refuses Content-Type %s with 415 before reading', async (contentType) => {
    const { app, echoed } = harness();
    const res = await request(app).post('/api/v1/echo').set('Content-Type', contentType).send('{"a":1}');
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(echoed).toEqual([]);
  });

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
    'application/json; charset="utf-8"',
    'application/merge-patch+json; charset=utf-8',
    'application/json; foo=bar',
  ])('accepts Content-Type %s', async (contentType) => {
    const { app, echoed } = harness();
    const res = await request(app).post('/api/v1/echo').set('Content-Type', contentType).send('{"a":1}');
    expect(res.status).toBe(201);
    expect(echoed).toEqual([{ a: 1 }]);
  });
});
