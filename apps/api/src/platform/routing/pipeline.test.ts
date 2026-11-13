// Request-pipeline skeleton (DR-A08, api/README.md §15 assertion 11, PR11-SEC-09, SEC-TC-29, PR #20 n6; TASK-020):
// slot order, authentication and authorisation outcomes, the tenant transaction around handler + audit, the DbError
// problem answer, the route template and the boot checks. Real createApp over loopback; no database.
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import Joi from 'joi';

import { ANONYMOUS_ACTOR_ID, SYSTEM_ACTOR_ID } from '@platform/shared';

import { createApp } from '../../app.js';
import { AUTHENTICATED_CACHE_CONTROL } from '../authn/authenticate.js';
import { authorise } from '../authz/authorise.js';
import { DbError, type TenantContext, type TenantTxRunner } from '../db/index.js';
import { dbErrorMapping } from '../db/map-db-error.js';
import { GENERIC_SERVER_DETAIL } from '../errors/problem.js';
import type { Principal, RouteContext, RouteDescriptor } from './define-route.js';
import {
  assertPipelineReady,
  defaultPipelineSlots,
  PipelineNotReadyError,
  type PipelineSlots,
  ROUTE_PIPELINE,
  routeHandlers,
} from './pipeline.js';
import { RequestContextError, tenantContextOf } from '../tx/execute.js';
import { ANONYMOUS, routeTemplateOf, setPrincipal } from './route-state.js';
import { fixtureRoute } from './tests/fixture-route.js';

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };

async function call(app: Express, path: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers; body: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}${path}`, init);
    return { status: response.status, headers: response.headers, body: await response.text() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A runner that records each context and the order of events, then runs `fn` (or fails with `failure`). */
function fakeRunner(events: string[], failure?: Error): TenantTxRunner<unknown> & { readonly contexts: TenantContext[] } {
  const contexts: TenantContext[] = [];
  return {
    contexts,
    transactionOptions: { maxWait: 1, timeout: 1 },
    probeFreshConnection: () => Promise.resolve(),
    withTenantTx: async <R>(ctx: TenantContext, fn: (db: never) => Promise<R>): Promise<R> => {
      contexts.push(ctx);
      events.push('begin');
      if (failure !== undefined) throw failure;
      const result = await fn('tenant-db' as never);
      events.push('commit');
      return result;
    },
  };
}

const tenantRoute = (handler: RouteDescriptor['handler'], path = '/things'): RouteDescriptor =>
  fixtureRoute({ operationId: 'listThings', path, transaction: 'tenant', tenancy: 'guest', handler });

describe('per-route pipeline order (api/README.md §15 assertion 11)', () => {
  it('runs context, authn, MFA, authz, rate limit, validate, idempotency, ETag, execute - in that order', async () => {
    const seen: string[] = [];
    const base = defaultPipelineSlots({ tenantTx: undefined });
    const tap = (name: keyof PipelineSlots) => (route: RouteDescriptor) => {
      const inner = base[name](route);
      return (req: Request, res: Response, next: NextFunction) => {
        seen.push(name);
        return inner(req, res, next);
      };
    };
    const slots = Object.fromEntries(Object.keys(base).map((name) => [name, tap(name as keyof PipelineSlots)])) as unknown as PipelineSlots;
    const route = fixtureRoute({ operationId: 'getThing', path: '/thing', handler: () => ({ status: 204 }) });
    expect(routeHandlers(route, slots).map((handler) => handler.name)).toEqual(ROUTE_PIPELINE.map((step) => `route:${step}`));
    expect((await call(createApp({ health: [route], modules: [], logger: silent, pipeline: slots }), '/thing')).status).toBe(204);
    expect(seen).toEqual(['authenticate', 'mfaGate', 'authorise', 'rateLimit', 'validate', 'idempotency', 'etag', 'execute']);
  });
});

describe('authentication and authorisation skeleton', () => {
  it('[SEC-TC-29] a non-anonymous route fails closed with 401 AUTH_REQUIRED and Cache-Control: private, no-store', async () => {
    const route = fixtureRoute({
      operationId: 'getMe',
      path: '/me',
      auth: 'session',
      tenancy: 'user',
      transaction: 'tenant',
      handler: () => ({ status: 200, body: {} }),
    });
    const response = await call(createApp({ health: [], modules: [{ name: 'me', routes: [route] }], logger: silent }), '/api/v1/me');
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(response.headers.get('cache-control')).toBe(AUTHENTICATED_CACHE_CONTROL);
  });

  it('an anonymous public route carries no private cache directive', async () => {
    const route = fixtureRoute({ operationId: 'getThing', path: '/thing', handler: () => ({ status: 200, body: {} }) });
    const response = await call(createApp({ health: [route], modules: [], logger: silent }), '/thing');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it.each<[string, Principal, string, string | undefined]>([
    ['public passes anyone', ANONYMOUS, 'public', undefined],
    ['authenticated needs a principal', ANONYMOUS, 'authenticated', 'AUTH_REQUIRED'],
    ['a permission needs a principal', ANONYMOUS, 'shipment:read', 'AUTH_REQUIRED'],
    [
      'a permission the principal lacks is 403',
      { ...ANONYMOUS, authenticated: true, permissions: new Set(['quote:read']) },
      'shipment:read',
      'AUTHZ_DENIED',
    ],
    [
      'a held permission passes',
      { ...ANONYMOUS, authenticated: true, permissions: new Set(['shipment:read']) },
      'shipment:read',
      undefined,
    ],
    ['authenticated passes an authenticated principal', { ...ANONYMOUS, authenticated: true }, 'authenticated', undefined],
  ])('authorise: %s', (_label, principal, permission, expected) => {
    const route = { ...fixtureRoute({ operationId: 'x', path: '/x', handler: () => ({ status: 204 }) }), permission } as RouteDescriptor;
    const res = { locals: {} } as unknown as Response;
    setPrincipal(res, principal);
    let passed: unknown = 'not called';
    authorise(route)({} as Request, res, (error?: unknown) => {
      passed = error;
    });
    expect(passed === undefined ? undefined : (passed as { code?: string }).code).toBe(expected);
  });
});

describe('tx slot: one tenant transaction per request (PR11-SEC-09 verification point)', () => {
  it('runs handler and audit inside the transaction, with the request context, and sends the result after COMMIT', async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    const route = tenantRoute(({ db, input }) => {
      events.push(`handler db=${String(db)} limit=${String(input.query['limit'])}`);
      return { status: 200, body: { ok: true } };
    });
    const withSchema = { ...route, schema: { query: Joi.object({ limit: Joi.number() }) } } as RouteDescriptor;
    const slots = { ...defaultPipelineSlots({ tenantTx: runner }) };
    const audit = (ctx: RouteContext) => {
      events.push(`audit ${ctx.route.operationId}`);
      return Promise.resolve();
    };
    const app = createApp({
      health: [],
      modules: [{ name: 't', routes: [withSchema] }],
      logger: silent,
      pipeline: { ...slots, execute: (await import('../tx/execute.js')).executeSlot({ tenantTx: runner, audit }) },
    });
    const response = await call(app, '/api/v1/things?limit=3', { headers: { 'X-Correlation-Id': 'corr-12345678' } });
    expect(response.status).toBe(200);
    expect(events).toEqual(['begin', 'handler db=tenant-db limit=3', 'audit listThings', 'commit']);
    expect(runner.contexts).toEqual([{ orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: 'corr-12345678' }]);
  });

  it('a failing audit write rolls the request back: no 2xx is sent', async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    const { executeSlot } = await import('../tx/execute.js');
    const route = tenantRoute(() => ({ status: 201, body: {} }));
    const execute = executeSlot({ tenantTx: runner, audit: () => Promise.reject(new Error('audit insert failed')) });
    const app = createApp({
      health: [],
      modules: [{ name: 't', routes: [route] }],
      logger: silent,
      pipeline: { ...defaultPipelineSlots({ tenantTx: runner }), execute },
    });
    const response = await call(app, '/api/v1/things');
    expect(response.status).toBe(500);
    expect(events).toEqual(['begin']);
  });

  it('[PR11-SEC-09] a retryable DbError is problem+json with status, catalogue code, Retry-After and generic text only', async () => {
    const failure = new DbError({ ...dbErrorMapping(503, 'LOCK_TIMEOUT', { retryable: true }), sqlState: '55P03', prismaCode: 'P2010' });
    const runner = fakeRunner([], failure);
    const app = createApp({
      health: [],
      modules: [{ name: 't', routes: [tenantRoute(() => ({ status: 200, body: {} }))] }],
      logger: silent,
      tenantTx: runner,
    });
    const response = await call(app, '/api/v1/things');
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(response.headers.get('retry-after')).toBe('1');
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', detail: GENERIC_SERVER_DETAIL });
    for (const leaked of ['LOCK_TIMEOUT', '55P03', 'P2010', 'Database error', 'reason', 'sqlState', 'prismaCode']) {
      expect(response.body).not.toContain(leaked);
    }
  });

  it('a non-retryable DbError has no Retry-After', async () => {
    const runner = fakeRunner([], new DbError(dbErrorMapping(409, 'CONFLICT')));
    const app = createApp({
      health: [],
      modules: [{ name: 't', routes: [tenantRoute(() => ({ status: 200, body: {} }))] }],
      logger: silent,
      tenantTx: runner,
    });
    const response = await call(app, '/api/v1/things');
    expect(response.status).toBe(409);
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('a tenant route without a runner answers 503 and the boot check refuses such an app', async () => {
    const route = tenantRoute(() => ({ status: 200, body: {} }));
    const response = await call(createApp({ health: [], modules: [{ name: 't', routes: [route] }], logger: silent }), '/api/v1/things');
    expect(response.status).toBe(503);
    expect(() => assertPipelineReady([route], undefined)).toThrow(PipelineNotReadyError);
    expect(() => assertPipelineReady([route], undefined)).toThrow('listThings');
    expect(() => assertPipelineReady([route], fakeRunner([]))).not.toThrow();
    expect(() =>
      assertPipelineReady([fixtureRoute({ operationId: 'getLiveness', path: '/l', handler: () => ({ status: 204 }) })], undefined),
    ).not.toThrow();
  });
});

describe('route template (PR #20 code review n6, R2.5 4(i))', () => {
  it('records mount prefix + full template for routes and for OPTIONS 204, never the raw path', async () => {
    const templates: (string | undefined)[] = [];
    const routes = [
      fixtureRoute({
        operationId: 'getWidget',
        path: '/widgets/:widgetId',
        schema: { params: Joi.object({ widgetId: Joi.string() }) },
        handler: () => ({ status: 204 }),
      }),
    ];
    const inner = createApp({
      health: [fixtureRoute({ operationId: 'getLiveness', path: '/health/live', handler: () => ({ status: 204 }) })],
      modules: [{ name: 'w', routes }],
      logger: silent,
    });
    const outer = express();
    outer.use((_req, res, next) => {
      res.on('finish', () => templates.push(routeTemplateOf(res)));
      next();
    });
    outer.use(inner);
    await call(outer, '/api/v1/widgets/42');
    await call(outer, '/health/live');
    expect((await call(outer, '/api/v1/widgets/43', { method: 'OPTIONS' })).status).toBe(204);
    await call(outer, '/api/v1/nowhere');
    expect(templates).toEqual(['/api/v1/widgets/:widgetId', '/health/live', '/api/v1/widgets/:widgetId', undefined]);
  });
});

describe('request context builder (PR26-SEC-04)', () => {
  const actor = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';

  it('builds the tenant context of an anonymous or an authenticated principal', () => {
    expect(tenantContextOf(ANONYMOUS, 'corr-12345678')).toEqual({
      orgId: '',
      actorId: '',
      actorScope: 'TENANT',
      guestTokenHash: '',
      correlationId: 'corr-12345678',
    });
    const user = { ...ANONYMOUS, authenticated: true, actorId: actor, actorScope: 'OPERATOR' as const };
    expect(tenantContextOf(user, 'corr-12345678')).toMatchObject({ actorId: actor, actorScope: 'OPERATOR' });
  });

  it.each<[string, Principal]>([
    ['the SYSTEM actor', { ...ANONYMOUS, authenticated: true, actorId: SYSTEM_ACTOR_ID }],
    ['the reserved ANONYMOUS actor', { ...ANONYMOUS, authenticated: true, actorId: ANONYMOUS_ACTOR_ID }],
    ['an authenticated principal without an actor', { ...ANONYMOUS, authenticated: true }],
    ['an actor on an anonymous principal', { ...ANONYMOUS, actorId: actor }],
    ['an OPERATOR context without an actor', { ...ANONYMOUS, actorScope: 'OPERATOR' }],
  ])('refuses %s', (_label, principal) => {
    expect(() => tenantContextOf(principal, 'corr-12345678')).toThrow(RequestContextError);
  });
});
