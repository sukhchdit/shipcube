// US-007 acceptance tests (AT-US-007-01..05) against the real createApp with defineRoute fixture routes; no database.
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';
import { AppError, ERROR_CATALOGUE } from '@platform/shared';
import express, { type Express } from 'express';
import fc from 'fast-check';
import Joi from 'joi';
import request, { type Response as TestResponse } from 'supertest';

import { createApp, type AppDependencies, type AppLogger } from '../../app.js';
import { CORRELATION_ID_PATTERN, currentRequestContext } from '../context/request-context.js';
import { DbError } from '../db/index.js';
import { dbErrorMapping } from '../db/map-db-error.js';
import { defaultPipelineSlots } from '../routing/pipeline.js';
import type { RouteSlot } from '../routing/slot.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
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

function harness(options: Pick<AppDependencies, 'problemTypeBase'> = {}): Harness {
  const logged: LoggedError[] = [];
  const auditable: boolean[] = [];
  const echoed: unknown[] = [];
  let thrown: unknown;
  const logger: AppLogger = {
    info: () => undefined,
    debug: () => undefined,
    error: (event, fields, value) => logged.push({ event, fields, thrown: value }),
  };

  const health = [
    fixtureRoute({ operationId: 'getLiveness', path: '/health/live', handler: () => ({ status: 200, body: { status: 'ok' } }) }),
  ];
  const widgets = [
    fixtureRoute({ operationId: 'listWidgets', path: '/widgets', handler: () => ({ status: 200, body: [] }) }),
    fixtureRoute({
      operationId: 'getWidget',
      path: '/widgets/:id',
      schema: { params: Joi.object({ id: Joi.string() }) },
      handler: ({ input }) => ({ status: 200, body: { id: input.params['id'] } }),
    }),
    fixtureRoute({
      operationId: 'echo',
      method: 'post',
      path: '/echo',
      schema: { body: Joi.object({ a: Joi.number() }) },
      handler: ({ input }) => {
        echoed.push(input.body);
        return { status: 201, body: { body: input.body, correlationId: currentRequestContext()?.correlationId } };
      },
    }),
    fixtureRoute({
      operationId: 'boom',
      path: '/boom',
      handler: () => {
        throw new Error('boom at /srv/app/dist/modules/widgets/service.js');
      },
    }),
    fixtureRoute({ operationId: 'throws', path: '/throws', handler: () => rejectWith(thrown) }),
    fixtureRoute({
      operationId: 'download',
      path: '/download',
      handler: () => {
        throw new AppError('NOT_FOUND');
      },
    }),
    fixtureRoute({
      operationId: 'unserialisable',
      path: '/unserialisable',
      handler: () => {
        throw new AppError('VALIDATION_ERROR', { errors: [{ pointer: '/body/a', code: 'X', message: 10n as unknown as string }] });
      },
    }),
    fixtureRoute({
      operationId: 'private',
      path: '/private',
      handler: () => {
        throw new AppError('AUTH_REQUIRED');
      },
    }),
  ];
  const slots = defaultPipelineSlots({ tenantTx: undefined });
  // The download fixture's success headers are set before the handler throws (a pipeline step stands in for a handler
  // that had started a response), so the problem handler must strip them (AT-US-007 header hygiene).
  const etag: RouteSlot = (route) => (_req, res, next) => {
    if (route.operationId === 'download') {
      res.set({ ETag: '"v1"', 'Last-Modified': 'Wed, 11 Nov 2026 10:00:00 GMT', 'Cache-Control': 'public, max-age=3600' });
      res.set({ 'Content-Disposition': 'attachment; filename="label.pdf"', 'Content-Language': 'en' });
    }
    next();
  };
  const inner = createApp({ health, modules: [{ name: 'widgets', routes: widgets }], logger, pipeline: { ...slots, etag }, ...options });
  // Stands in for audit capture (TASK-029): it observes every finished response, 404s included, through the public
  // predicate; mounted in front of the real app so the composition under test is unchanged.
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.on('finish', () => auditable.push(isAuditableMutationResponse(res)));
    next();
  });
  app.use(inner);
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

function expectProblem(res: TestResponse, status: number, code: string, cacheControl = 'no-store'): Record<string, unknown> {
  const body = problemOf(res);
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json(;|$)/);
  expect(Object.keys(body).sort()).toEqual(PROBLEM_KEYS);
  expect(body).toMatchObject({ status, code, type: `https://docs.platform.invalid/problems/${code}` });
  expect(body['correlation_id']).toMatch(CORRELATION_ID_PATTERN);
  expect(res.headers['x-correlation-id']).toBe(body['correlation_id']);
  // PR-0009 m4: a problem document is never stored by a cache (private too when the request carried a credential).
  expect(res.headers['cache-control']).toBe(cacheControl);
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

  // RFC 9110 §15.5.6 (PR #21 R1-m3): Allow lists every supported method, and OPTIONS is answered on every known path
  // (204 + Allow), so a GET-only route's 405 lists "GET, HEAD, OPTIONS"; the AT-US-007-02 text update is routed to PM.
  it('AT-US-007-02: 405 includes the Allow header ("GET, HEAD" plus OPTIONS for a GET-only route)', async () => {
    const health = await request(app).delete('/health/live');
    expectProblem(health, 405, 'METHOD_NOT_ALLOWED');
    expect(health.headers['allow']).toBe('GET, HEAD, OPTIONS');
    const widget = await request(app).delete('/api/v1/widgets/42');
    expect(widget.headers['allow']).toBe('GET, HEAD, OPTIONS');
    expect((await request(app).get('/api/v1/echo')).headers['allow']).toBe('POST, OPTIONS');
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
            hint: 'SELECT relrowsecurity FROM pg_catalog.pg_class WHERE relname = $1',
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

describe('[PR11-SEC-09 item 6] a DbError answers its catalogue problem; reason, SQLSTATE and Prisma code are log-only', () => {
  /** Text a DbError holds that must never reach the client (its message, reason, SQLSTATE, Prisma code, event). */
  const LOG_ONLY = [
    'Database error',
    'RLS_WRITE_REJECTED',
    'rls_write_rejected',
    'LOCK_TIMEOUT',
    '42501',
    '55P03',
    '23505',
    'P2010',
    'P2002',
  ];

  function expectNoLogOnlyText(res: TestResponse): void {
    for (const fragment of LOG_ONLY) expect(res.text).not.toContain(fragment);
  }

  it('an RLS write rejection answers 403 AUTHZ_DENIED with the generic catalogue text and is not logged', async () => {
    const { app, logged, setThrown } = harness();
    setThrown(
      new DbError({
        ...dbErrorMapping(403, 'RLS_WRITE_REJECTED', { securityEvent: 'rls_write_rejected' }),
        sqlState: '42501',
        prismaCode: 'P2010',
      }),
    );
    const res = await request(app).get('/api/v1/throws');
    const body = expectProblem(res, 403, 'AUTHZ_DENIED');
    expect(body).toMatchObject({ title: 'Permission denied', detail: 'Permission denied.' });
    expect(res.headers['retry-after']).toBeUndefined();
    expectNoLogOnlyText(res);
    expect(logged).toEqual([]);
  });

  it('a retryable lock timeout answers 503 SERVICE_UNAVAILABLE, Retry-After: 1 and the generic server detail', async () => {
    const { app, logged, setThrown } = harness();
    const thrown = new DbError({ ...dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true }), sqlState: '55P03', prismaCode: 'P2010' });
    setThrown(thrown);
    const res = await request(app).get('/api/v1/throws');
    const body = expectProblem(res, 503, 'SERVICE_UNAVAILABLE');
    expect(body).toMatchObject({ title: 'Service unavailable', detail: GENERIC_SERVER_DETAIL });
    expect(res.headers['retry-after']).toBe('1');
    expectNoLogOnlyText(res);
    expect(logged.at(-1)?.fields).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, error_class: 'DbError' });
    expect(logged.at(-1)?.thrown).toBe(thrown);
  });

  it.each([
    [409, 'CONFLICT', 'Conflict'],
    [404, 'NOT_FOUND', 'Not found'],
  ] as const)('a %i DbError answers %s with "<title>." and no Retry-After', async (status, code, title) => {
    const { app, logged, setThrown } = harness();
    setThrown(
      new DbError({ ...dbErrorMapping(status, status === 409 ? 'CONFLICT' : 'NOT_FOUND'), sqlState: '23505', prismaCode: 'P2002' }),
    );
    const res = await request(app).get('/api/v1/throws');
    expect(expectProblem(res, status, code)).toMatchObject({ title, detail: `${title}.` });
    expect(res.headers['retry-after']).toBeUndefined();
    expectNoLogOnlyText(res);
    expect(logged).toEqual([]);
  });

  it('a 500 DbError answers the generic 500 and is logged with error_class DbError', async () => {
    const { app, logged, setThrown } = harness();
    setThrown(new DbError({ ...dbErrorMapping(500, 'DB_PRIVILEGE_DENIED', { securityEvent: 'db_privilege_denied' }), sqlState: '42501' }));
    const res = await request(app).get('/api/v1/throws');
    expect(expectProblem(res, 500, 'INTERNAL_ERROR')['detail']).toBe(GENERIC_SERVER_DETAIL);
    expect(res.text).not.toMatch(/DB_PRIVILEGE_DENIED|db_privilege_denied|42501|Database error/u);
    expect(logged.at(-1)?.fields).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      error_class: 'DbError',
      correlation_id: res.headers['x-correlation-id'],
    });
  });

  it('a DbError whose status disagrees with the catalogue fails safe to a generic 500 without Retry-After', async () => {
    const { app, logged, setThrown } = harness();
    const forged = Object.assign(new DbError(dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true })), { status: 403 });
    setThrown(forged);
    const res = await request(app).get('/api/v1/throws');
    expect(expectProblem(res, 500, 'INTERNAL_ERROR')['detail']).toBe(GENERIC_SERVER_DETAIL);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(logged.at(-1)?.fields).toMatchObject({ code: 'INTERNAL_ERROR', error_class: 'DbError' });
  });
});

describe('AT-US-007-04: unauthenticated caller still receives problem+json', () => {
  const { app } = harness();

  it('AT-US-007-04: an unknown route answers the same 404 problem+json with or without credentials', async () => {
    const anonymous = expectProblem(await request(app).get('/api/v1/unknown'), 404, 'NOT_FOUND');
    // D-ARCH-107 (5), SEC-TC-29: a request that presented a credential gets a private answer, errors included.
    const bearerResponse = await request(app).get('/api/v1/unknown').set('Authorization', 'Bearer not-a-token');
    const bearer = expectProblem(bearerResponse, 404, 'NOT_FOUND', 'private, no-store');
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
    expect(body['title']).toBe(ERROR_CATALOGUE.INTERNAL_ERROR.title);
    expect(res.text).not.toMatch(/<html|BigInt|TypeError| at /u);
  });

  it('[PR-0009 R2-n1] the fallback 500 uses the configured problem type base, like every other problem', async () => {
    const typeBase = 'https://docs.example.test/problems/';
    const { app } = harness({ problemTypeBase: typeBase });
    const fallback = await request(app).get('/api/v1/unserialisable');
    const regular = await request(app).get('/api/v1/boom');
    for (const res of [fallback, regular]) {
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ type: `${typeBase}INTERNAL_ERROR`, title: 'Internal error', code: 'INTERNAL_ERROR' });
    }
    expect(Object.keys(problemOf(fallback)).sort()).toEqual(Object.keys(problemOf(regular)).sort());
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

describe('[PR9-SEC-14] a crafted Content-Type cannot stall the process', () => {
  it.each([
    // 97 bytes, below the length bound: the grammar itself must be linear (the round-2 grammar needed about 4 days).
    ['40 empty parameters', `application/json${'; '.repeat(40)}!`],
    ['an over-long header', `application/json${'; '.repeat(5_000)}!`],
  ])('%s on an unknown path, without credentials: 415 at once, and liveness answers right after', async (_label, contentType) => {
    const { app, echoed } = harness();
    const started = performance.now();
    const res = await request(app).post('/api/v1/does-not-exist').set('Content-Type', contentType).send('x');
    expect(performance.now() - started).toBeLessThan(1_000);
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(echoed).toEqual([]);

    const liveStarted = performance.now();
    expect((await request(app).get('/health/live')).status).toBe(200);
    expect(performance.now() - liveStarted).toBeLessThan(1_000);
  });
});

describe('[SEC-TC-29] [PR #32 m1 (b)] the problem handler decides "private" from the request, not from header text', () => {
  const { app } = harness();

  it.each<[string, Record<string, string>]>([
    ['an Authorization header', { Authorization: 'Bearer not-a-token' }],
    ['a web refresh cookie', { Cookie: 'theme=dark; __Host-rt_web=opaque' }],
    ['an admin refresh cookie', { Cookie: '__Host-rt_admin=opaque' }],
    ['a guest quote token', { 'X-Quote-Token': 'opaque' }],
  ])('a framework error before the route is known (malformed JSON) is private with %s', async (_label, headers) => {
    const res = await request(app).post('/api/v1/echo').set(headers).set('Content-Type', 'application/json').send('{"a":');
    expectProblem(res, 400, 'MALFORMED_REQUEST', 'private, no-store');
  });

  it('the same framework error without a credential is no-store only (no other cookie counts)', async () => {
    const res = await request(app)
      .post('/api/v1/echo')
      .set('Cookie', 'theme=dark; rt_web=x')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expectProblem(res, 400, 'MALFORMED_REQUEST');
  });
});
