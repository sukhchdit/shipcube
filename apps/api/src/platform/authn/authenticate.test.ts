// Authn stub (D-ARCH-107 (5), SEC-TC-29, PR32-SEC-02; TASK-020): the anonymous principal only when the route's set
// contains `anonymous` and the request presents no credential; 401 AUTH_REQUIRED with `private, no-store` otherwise.
// Real createApp over loopback with the production slots; no database (transaction: none).
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';

import { createApp } from '../../app.js';
import { PRIVATE_CACHE_CONTROL } from '../routing/route-state.js';
import { fixtureRoute, type FixtureRouteSpec } from '../routing/tests/fixture-route.js';
import { AUTHENTICATED_CACHE_CONTROL } from './authenticate.js';

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };

async function probe(spec: Partial<FixtureRouteSpec>, headers: Record<string, string> = {}) {
  const route = fixtureRoute({ operationId: 'probeAuthn', path: '/probe', handler: () => ({ status: 200, body: {} }), ...spec });
  const app = createApp({ health: [], modules: [{ name: 'probe', routes: [route] }], logger: silent });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/probe`, { headers });
    const text = await response.text();
    return {
      status: response.status,
      code: text === '' ? undefined : (JSON.parse(text) as { code?: unknown }).code,
      cacheControl: response.headers.get('cache-control'),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const DUAL = { auth: ['anonymous', 'session'], permissionAuthenticated: 'quote:create' } as const;
const DENIED = { status: 401, code: 'AUTH_REQUIRED', cacheControl: PRIVATE_CACHE_CONTROL };

describe('[D-ARCH-107] authn stub', () => {
  it('[SEC-TC-29] AUTHENTICATED_CACHE_CONTROL stays the private, no-store value', () => {
    expect(AUTHENTICATED_CACHE_CONTROL).toBe('private, no-store');
  });

  it('[D-ARCH-107] [anonymous] and [anonymous, session] without a credential get the anonymous principal, no private mark', async () => {
    expect(await probe({})).toEqual({ status: 200, code: undefined, cacheControl: null });
    expect(await probe(DUAL)).toEqual({ status: 200, code: undefined, cacheControl: null });
  });

  it.each<[string, Record<string, string>]>([
    ['an Authorization header', { Authorization: 'Bearer x' }],
    ['an X-Quote-Token header', { 'X-Quote-Token': 'c'.repeat(64) }],
    ['the web refresh cookie', { Cookie: 'theme=dark; __Host-rt_web=x' }],
    ['the admin refresh cookie', { Cookie: '__Host-rt_admin=x' }],
  ])('[D-ARCH-107] a credential (%s) on an anonymous-capable route is never ignored: 401 private', async (_label, headers) => {
    expect(await probe({}, headers)).toEqual(DENIED);
    expect(await probe(DUAL, headers)).toEqual(DENIED);
  });

  it('[D-ARCH-107] an unrelated cookie is not a credential', async () => {
    expect(await probe({}, { Cookie: 'rt_web=x; theme=dark' })).toMatchObject({ status: 200 });
  });

  it.each<[string, Partial<FixtureRouteSpec>]>([
    ['[session]', { auth: 'session' }],
    ['[refresh-cookie]', { auth: 'refresh-cookie' }],
    ['[signature]', { auth: 'signature' }],
    ['[session, quote-token]', { auth: ['session', 'quote-token'], permissionAuthenticated: 'quote:read' }],
  ])(
    '[SEC-TC-29] a route without anonymous (%s) fails closed with 401 private, no-store, with or without a credential',
    async (_label, spec) => {
      expect(await probe(spec)).toEqual(DENIED);
      expect(await probe(spec, { Authorization: 'Bearer x' })).toEqual(DENIED);
    },
  );
});
