// Composition guards of the request pipeline (TASK-020, PR #32 fix cycle 1): slot stubs refuse at mount what they
// cannot honour (PR32-SEC-03, condition C3), the boot checks run inside createApp and only defineRoute descriptors
// mount (PR32-SEC-05 (a)/(b), code review m2), handlers see a frozen transport view instead of the live request
// (PR32-SEC-05 (c), n4), an authenticated response stays `private, no-store` whatever the handler sets (SEC-TC-29,
// code review m1 (a)), and the boot log line names each refusal (n1). Real createApp over loopback; no database.
import type { AddressInfo } from 'node:net';

import { describe, expect, it, jest } from '@jest/globals';
import type { Express, NextFunction, Request, Response } from 'express';

import { createApp } from '../../app.js';
import type { TenantContext, TenantTxRunner } from '../db/index.js';
import { RequestContextError, tenantContextOf, executeSlot } from '../tx/execute.js';
import { defineRoute, type Principal, type RouteDescriptor, type RouteHandler, type RouteSpec } from './define-route.js';
import {
  bootFailureOf,
  defaultPipelineSlots,
  PipelineNotReadyError,
  type PipelineSlots,
  RouteBindingError,
  UndefinedRouteError,
} from './pipeline.js';
import { ANONYMOUS, markPrivateResponse, PRIVATE_CACHE_CONTROL, setPrincipal } from './route-state.js';
import { SlotNotImplementedError } from './slot.js';
import { fixtureRoute } from './tests/fixture-route.js';
import { closeLoopbackServer, fetchOnce, LOOPBACK_TEST_TIMEOUT_MS } from './tests/loopback.js';

// Real createApp over loopback: the 5 s Jest default timed out under parallel host load (W0-FLAKE, PR #38 R1-n1).
jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };
const ACTOR = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000b2';

async function call(app: Express, path: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers; body: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetchOnce(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}${path}`, init);
    return { status: response.status, headers: response.headers, body: await response.text() };
  } finally {
    await closeLoopbackServer(server);
  }
}

const runner: TenantTxRunner<unknown> = {
  transactionOptions: { maxWait: 1, timeout: 1 },
  probeFreshConnection: () => Promise.resolve(),
  withTenantTx: async <R>(_ctx: TenantContext, fn: (db: never) => Promise<R>): Promise<R> => fn('tenant-db' as never),
};

const sessionPrincipal = (actorScope: Principal['actorScope']): Principal => ({
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: ACTOR,
  orgId: ORG,
  actorScope,
});

/** An authn slot standing in for TASK-052: sets `principal` and marks the response private, like the real one will. */
const signedIn =
  (principal: Principal): PipelineSlots['authenticate'] =>
  () =>
  (_req: Request, res: Response, next: NextFunction) => {
    setPrincipal(res, principal);
    markPrivateResponse(res);
    next();
  };

const sessionRoute = (handler: RouteHandler, extra: Partial<RouteSpec> = {}): RouteDescriptor =>
  defineRoute({
    operationId: 'getMe',
    method: 'get',
    path: '/me',
    permission: 'authenticated',
    permissionJustification: 'Framework test fixture.',
    audit: { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false, justification: 'Framework test fixture.' },
    schema: {},
    rateLimit: 'authenticated',
    idempotency: 'not-applicable',
    tenancy: 'public',
    auth: 'session',
    transaction: 'none',
    handler,
    ...extra,
  } as RouteSpec);

const appWith = (routes: readonly RouteDescriptor[], pipeline?: PipelineSlots): Express =>
  createApp({
    health: [],
    modules: [{ name: 'm', routes }],
    logger: silent,
    tenantTx: runner,
    ...(pipeline === undefined ? {} : { pipeline }),
  });

describe('[PR32-SEC-03] slot stubs refuse at mount what they cannot honour (condition C3)', () => {
  const tenantRoute = (extra: Partial<RouteSpec>): RouteDescriptor =>
    fixtureRoute({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      tenancy: 'guest',
      transaction: 'tenant',
      handler: () => ({ status: 201 }),
      ...extra,
    });

  it('the audit stub refuses an audited route, naming TASK-029; an injected audit hook (TASK-029) mounts it', () => {
    const route = tenantRoute({ audit: { action: 'CREATE', entity: 'thing', sensitivity: 'NORMAL', reasonRequired: false } });
    expect(() => appWith([route])).toThrow(SlotNotImplementedError);
    expect(() => appWith([route])).toThrow(/audit slot stub cannot honour audit action CREATE on createThing; TASK-029/);
    const execute = executeSlot({ tenantTx: runner, audit: () => Promise.resolve() });
    expect(() => appWith([route], { ...defaultPipelineSlots({ tenantTx: runner }), execute })).not.toThrow();
  });

  it.each(['required', 'optional'] as const)('the idempotency stub refuses idempotency %s, naming TASK-040', (mode) => {
    expect(() => appWith([tenantRoute({ idempotency: mode })])).toThrow(/idempotency slot stub cannot honour idempotency .* TASK-040/);
  });

  it.each(['auth', 'email-send'] as const)('the rate-limit stub refuses class %s, naming TASK-041', (rateLimit) => {
    expect(() => appWith([tenantRoute({ rateLimit })])).toThrow(/rate-limit slot stub cannot honour rate-limit class .* TASK-041/);
  });

  it('capacity rate-limit classes and not-applicable idempotency still mount', () => {
    expect(() => appWith([tenantRoute({ rateLimit: 'public', idempotency: 'not-applicable' })])).not.toThrow();
  });

  it('the MFA stub answers 403 to an OPERATOR principal on a route without mfaGateExempt; tenant and exempt pass', async () => {
    const ok: RouteHandler = () => ({ status: 200, body: { ok: true } });
    const slots = (scope: Principal['actorScope']): PipelineSlots => ({
      ...defaultPipelineSlots({ tenantTx: runner }),
      authenticate: signedIn(sessionPrincipal(scope)),
    });
    const denied = await call(appWith([sessionRoute(ok)], slots('OPERATOR')), '/api/v1/me');
    expect(denied.status).toBe(403);
    expect(JSON.parse(denied.body)).toMatchObject({ code: 'AUTHZ_DENIED' });
    expect((await call(appWith([sessionRoute(ok, { mfaGateExempt: true })], slots('OPERATOR')), '/api/v1/me')).status).toBe(200);
    expect((await call(appWith([sessionRoute(ok)], slots('TENANT')), '/api/v1/me')).status).toBe(200);
  });
});

describe('[SEC-TC-29] [PR #32 m1 (a)] a handler cannot make an authenticated response cacheable', () => {
  const slots: PipelineSlots = { ...defaultPipelineSlots({ tenantTx: runner }), authenticate: signedIn(sessionPrincipal('TENANT')) };

  it('re-asserts private, no-store after the handler headers', async () => {
    const route = sessionRoute(() => ({ status: 200, body: {}, headers: { 'Cache-Control': 'public, max-age=3600', ETag: '"v1"' } }));
    const response = await call(appWith([route], slots), '/api/v1/me');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PRIVATE_CACHE_CONTROL);
    expect(response.headers.get('etag')).toBe('"v1"');
  });

  it('a handler that throws after the mark answers a private problem', async () => {
    const route = sessionRoute(() => {
      throw new Error('boom');
    });
    const response = await call(appWith([route], slots), '/api/v1/me');
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('an anonymous response keeps the handler Cache-Control', async () => {
    const route = fixtureRoute({
      operationId: 'getThing',
      path: '/thing',
      handler: () => ({ status: 200, body: {}, headers: { 'Cache-Control': 'public, max-age=60' } }),
    });
    expect((await call(appWith([route]), '/api/v1/thing')).headers.get('cache-control')).toBe('public, max-age=60');
  });
});

describe('[PR #32 m2] [PR32-SEC-05 (a)/(b)] composition invariants live in createApp', () => {
  const route = fixtureRoute({ operationId: 'getThing', path: '/thing', handler: () => ({ status: 200, body: {} }) });

  it('refuses a spread or hand-built descriptor before mounting anything', () => {
    const spread = { ...route, tenancy: 'tenant', transaction: 'none' } as RouteDescriptor;
    expect(() => appWith([route, spread])).toThrow(UndefinedRouteError);
    expect(() => appWith([spread])).toThrow('route getThing was not returned by defineRoute');
    expect(() => createApp({ health: [{ ...route }], modules: [], logger: silent })).toThrow(UndefinedRouteError);
  });

  it('runs the route-binding check of the mode: the mock gateway webhook is refused in live mode only', () => {
    const webhook = defineRoute({
      operationId: 'receiveMockGatewayWebhook',
      method: 'post',
      path: '/webhooks/mock-gateway',
      permission: 'webhook:mock_gateway:receive',
      audit: { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false, justification: 'Framework test fixture.' },
      schema: {},
      rateLimit: 'webhook',
      idempotency: 'not-applicable',
      tenancy: 'public',
      auth: 'signature',
      transaction: 'none',
      handler: () => ({ status: 204 }),
    });
    const compose = (apiMode: 'test' | 'live') => () =>
      createApp({ health: [], modules: [{ name: 'w', routes: [webhook] }], logger: silent, apiMode });
    expect(compose('test')).not.toThrow();
    expect(compose('live')).toThrow(RouteBindingError);
  });

  it('runs the runner check for the default slots', () => {
    const tenant = fixtureRoute({
      operationId: 'listThings',
      path: '/things',
      tenancy: 'guest',
      transaction: 'tenant',
      handler: () => ({ status: 200 }),
    });
    expect(() => createApp({ health: [], modules: [{ name: 't', routes: [tenant] }], logger: silent })).toThrow(PipelineNotReadyError);
  });
});

describe('[PR32-SEC-05 (c)] [PR #32 n4] handlers see a frozen transport view, never the live request', () => {
  it('passes ip and user agent only', async () => {
    let seen: unknown;
    const route = fixtureRoute({
      operationId: 'getThing',
      path: '/thing',
      handler: (ctx) => {
        seen = ctx;
        return { status: 204 };
      },
    });
    await call(appWith([route]), '/api/v1/thing', { headers: { 'User-Agent': 'probe/1.0' } });
    const ctx = seen as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('req');
    expect(ctx['transport']).toEqual({ ip: expect.stringContaining('127.0.0.1'), userAgent: 'probe/1.0' });
    expect(Object.isFrozen(ctx['transport'])).toBe(true);
  });
});

describe('[PR #32 n3] request context builder: an authenticated TENANT principal needs an organisation', () => {
  it('refuses an authenticated TENANT principal without an organisation and accepts it with one', () => {
    expect(() => tenantContextOf({ ...sessionPrincipal('TENANT'), orgId: '' }, 'corr-12345678')).toThrow(RequestContextError);
    expect(tenantContextOf(sessionPrincipal('TENANT'), 'corr-12345678')).toMatchObject({ orgId: ORG, actorId: ACTOR });
    expect(tenantContextOf({ ...sessionPrincipal('OPERATOR'), orgId: '' }, 'corr-12345678')).toMatchObject({ actorScope: 'OPERATOR' });
  });
});

describe('[PR #32 n1] boot failures have their own log event with route identities', () => {
  it('maps every composition error and nothing else', () => {
    const binding = new RouteBindingError([{ rule: 'AUTH_SET', route: 'GET /x', message: 'GET /x: bad' }]);
    expect(bootFailureOf(binding)).toEqual({
      event: 'api.route_bindings_refused',
      fields: { error: 'RouteBindingError', violations: 'AUTH_SET GET /x' },
    });
    expect(bootFailureOf(new PipelineNotReadyError(['a', 'b']))).toEqual({
      event: 'api.pipeline_not_ready',
      fields: { error: 'PipelineNotReadyError', operations: 'a, b' },
    });
    expect(bootFailureOf(new SlotNotImplementedError('audit', 'createThing', 'audit action CREATE', 'TASK-029'))).toEqual({
      event: 'api.slot_not_implemented',
      fields: {
        error: 'SlotNotImplementedError',
        slot: 'audit',
        operation: 'createThing',
        requirement: 'audit action CREATE',
        owner: 'TASK-029',
      },
    });
    expect(bootFailureOf(new UndefinedRouteError('getThing'))).toEqual({
      event: 'api.route_not_defined',
      fields: { error: 'UndefinedRouteError', operation: 'getThing' },
    });
    expect(bootFailureOf(new Error('other'))).toBeUndefined();
  });
});
