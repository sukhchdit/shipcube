// Credential gate then permission gate (D-ARCH-107 (6), PR32-SEC-02 = security condition C2, ADR-0008 am. 4; TASK-020).
// Real createApp over loopback with the `pipeline` seam replacing the authn slot; no database (transaction: none).
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';
import type { Express, NextFunction, Request, Response } from 'express';

import { createApp } from '../../app.js';
import type { Principal, RouteDescriptor } from '../routing/define-route.js';
import { defaultPipelineSlots } from '../routing/pipeline.js';
import { ANONYMOUS, setPrincipal } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { fixtureRoute, type FixtureRouteSpec } from '../routing/tests/fixture-route.js';

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };
const PRIVATE = 'private, no-store';

interface Answer {
  readonly status: number;
  readonly code: unknown;
  readonly cacheControl: string | null;
}

async function call(app: Express, path: string): Promise<Answer> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}${path}`);
    const text = await response.text();
    const code = text === '' ? undefined : (JSON.parse(text) as { code?: unknown }).code;
    return { status: response.status, code, cacheControl: response.headers.get('cache-control') };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** An authn slot that sets `principal` (or, when undefined, calls `next()` without setting any: the leaky seam). */
const authnSetting =
  (principal: Principal | undefined): RouteSlot =>
  () =>
  (_req: Request, res: Response, next: NextFunction) => {
    if (principal !== undefined) setPrincipal(res, principal);
    next();
  };

const route = (spec: Partial<FixtureRouteSpec>): RouteDescriptor =>
  fixtureRoute({ operationId: 'probeAuth', path: '/probe', handler: () => ({ status: 200, body: {} }), ...spec });

function appWith(target: RouteDescriptor, principal: Principal | undefined): Express {
  const pipeline = { ...defaultPipelineSlots({ tenantTx: undefined }), authenticate: authnSetting(principal) };
  return createApp({ health: [], modules: [{ name: 'probe', routes: [target] }], logger: silent, pipeline });
}

const session = (permissions: readonly string[]): Principal => ({
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId: '0193a5b2-7c1e-7d4a-9f3b-0000000000a1',
  orgId: '0193a5b2-7c1e-7d4a-9f3b-0000000000b1',
  permissions: new Set(permissions),
});

const DUAL_CREATE = { auth: ['anonymous', 'session'], permissionAuthenticated: 'quote:create' } as const;

describe('[PR32-SEC-02] credential gate: the public marker waives the permission, never the declared authentication', () => {
  it.each<[string, Partial<FixtureRouteSpec>]>([
    ['public + [signature] (receiveCarrierPush)', { auth: 'signature' }],
    ['public + [refresh-cookie] (refreshSession, getCsrfToken)', { auth: 'refresh-cookie' }],
    ['public + [session, quote-token] (getQuote)', { auth: ['session', 'quote-token'], permissionAuthenticated: 'quote:read' }],
    ['public + [session]', { auth: 'session' }],
  ])('[PR32-SEC-02] the leaky-authn seam (next() without a principal) on %s is 401 AUTH_REQUIRED, private', async (_label, spec) => {
    expect(await call(appWith(route(spec), undefined), '/api/v1/probe')).toEqual({
      status: 401,
      code: 'AUTH_REQUIRED',
      cacheControl: PRIVATE,
    });
  });

  it.each<[string, Partial<FixtureRouteSpec>, Principal]>([
    [
      'a guest-token principal on [session]',
      { auth: 'session' },
      { ...ANONYMOUS, credential: 'quote-token', guestTokenHash: 'a'.repeat(64) },
    ],
    ['a signature principal on [refresh-cookie]', { auth: 'refresh-cookie' }, { ...ANONYMOUS, credential: 'signature' }],
    ['a session principal on [signature]', { auth: 'signature' }, session([])],
    ['a refresh-cookie principal on a dual-mode route', DUAL_CREATE, { ...ANONYMOUS, credential: 'refresh-cookie' }],
    [
      'a principal with an unknown credential (treated as anonymous) on [session, quote-token]',
      { auth: ['session', 'quote-token'], permissionAuthenticated: 'quote:read' },
      { ...session(['quote:read']), credential: 'bearer' as Principal['credential'] },
    ],
  ])('[PR32-SEC-02] %s is 401 AUTH_REQUIRED', async (_label, spec, principal) => {
    expect(await call(appWith(route(spec), principal), '/api/v1/probe')).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
  });

  it('[PR32-SEC-02] a principal whose credential is in the set passes the credential gate (public + [signature])', async () => {
    const provider: Principal = { ...ANONYMOUS, credential: 'signature' };
    expect(await call(appWith(route({ auth: 'signature' }), provider), '/api/v1/probe')).toEqual({
      status: 200,
      code: undefined,
      cacheControl: PRIVATE,
    });
  });
});

describe('[PR32-SEC-02] permission gate on a dual-mode route (permissionAuthenticated, D-ARCH-107 (2))', () => {
  it('[PR32-SEC-02] the anonymous branch passes and stays cacheable by the route (no private mark)', async () => {
    expect(await call(appWith(route(DUAL_CREATE), ANONYMOUS), '/api/v1/probe')).toEqual({
      status: 200,
      code: undefined,
      cacheControl: null,
    });
  });

  it('[PR32-SEC-02] a session principal without permissionAuthenticated is 403 AUTHZ_DENIED, private', async () => {
    expect(await call(appWith(route(DUAL_CREATE), session(['quote:read'])), '/api/v1/probe')).toEqual({
      status: 403,
      code: 'AUTHZ_DENIED',
      cacheControl: PRIVATE,
    });
  });

  it('[PR32-SEC-02] a session principal holding permissionAuthenticated is 200, private', async () => {
    expect(await call(appWith(route(DUAL_CREATE), session(['quote:create'])), '/api/v1/probe')).toEqual({
      status: 200,
      code: undefined,
      cacheControl: PRIVATE,
    });
  });

  it('[PR32-SEC-02] a guest-token principal on [session, quote-token] passes without the tenant permission', async () => {
    const guest: Principal = { ...ANONYMOUS, credential: 'quote-token', guestTokenHash: 'b'.repeat(64) };
    const getQuote = route({ auth: ['session', 'quote-token'], permissionAuthenticated: 'quote:read' });
    expect(await call(appWith(getQuote, guest), '/api/v1/probe')).toMatchObject({ status: 200, cacheControl: PRIVATE });
    expect(await call(appWith(getQuote, session([])), '/api/v1/probe')).toMatchObject({ status: 403, code: 'AUTHZ_DENIED' });
  });
});
