// Authn stub (D-ARCH-107 (5), D-ARCH-109, SEC-TC-29, PR32-SEC-02; TASK-020): the slot reads only the credential kinds
// the route declares. The anonymous principal when the set contains `anonymous` and no declared credential is present;
// 401 AUTH_REQUIRED with `private, no-store` otherwise; a foreign credential is ignored and changes no header.
// Real createApp over loopback with the production slots; no database (transaction: none).
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import { createApp } from '../../app.js';
import { PRIVATE_CACHE_CONTROL } from '../routing/route-state.js';
import { fixtureRoute, type FixtureRouteSpec } from '../routing/tests/fixture-route.js';
import { AUTHENTICATED_CACHE_CONTROL } from './authenticate.js';

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };
/** The contract's public reference-data value (openapi.yaml CacheControl header, REQ-DATA-016). */
const PUBLIC_CACHE = 'public, max-age=3600';

async function probe(spec: Partial<FixtureRouteSpec>, headers: Record<string, string> = {}) {
  const route = fixtureRoute({
    operationId: 'probeAuthn',
    path: '/probe',
    handler: () => ({ status: 200, body: {}, headers: { 'Cache-Control': PUBLIC_CACHE } }),
    ...spec,
  });
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
/** The no-credential result of an anonymous route: the handler ran, its contract Cache-Control is untouched. */
const ANONYMOUS_RESULT = { status: 200, code: undefined, cacheControl: PUBLIC_CACHE };

const BEARER = { Authorization: 'Bearer x' };
const EXPIRED_BEARER = { Authorization: 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJleHAiOjF9.expired' };
const MALFORMED_BEARER = { Authorization: 'not a token' };
const WEB_COOKIE = { Cookie: 'theme=dark; __Host-rt_web=x' };
const ADMIN_COOKIE = { Cookie: '__Host-rt_admin=x' };
const QUOTE_TOKEN = { 'X-Quote-Token': 'c'.repeat(64) };

describe('[D-ARCH-107] [D-ARCH-109] authn stub', () => {
  it('[SEC-TC-29] AUTHENTICATED_CACHE_CONTROL stays the private, no-store value', () => {
    expect(AUTHENTICATED_CACHE_CONTROL).toBe('private, no-store');
  });

  it('[D-ARCH-107] [anonymous] and [anonymous, session] without a credential get the anonymous principal, no private mark', async () => {
    expect(await probe({})).toEqual(ANONYMOUS_RESULT);
    expect(await probe(DUAL)).toEqual(ANONYMOUS_RESULT);
  });

  it.each<[string, Record<string, string>]>([
    ['a bearer Authorization header', BEARER],
    ['an expired bearer', EXPIRED_BEARER],
    ['a malformed Authorization header', MALFORMED_BEARER],
    ['an X-Quote-Token header', QUOTE_TOKEN],
    ['the web refresh cookie', WEB_COOKIE],
    ['the admin refresh cookie', ADMIN_COOKIE],
  ])('[SEC-TC-29] [D-ARCH-109] a foreign credential (%s) on [anonymous] is ignored: the no-credential result', async (_label, headers) => {
    expect(await probe({}, headers)).toEqual(ANONYMOUS_RESULT);
  });

  it.each<[string, Record<string, string>]>([
    ['the web refresh cookie', WEB_COOKIE],
    ['the admin refresh cookie', ADMIN_COOKIE],
    ['an X-Quote-Token header', QUOTE_TOKEN],
  ])('[SEC-TC-29] [D-ARCH-109] [anonymous, session] with only a foreign %s takes the anonymous branch', async (_label, headers) => {
    expect(await probe(DUAL, headers)).toEqual(ANONYMOUS_RESULT);
  });

  it.each<[string, Record<string, string>]>([
    ['a bearer', BEARER],
    ['an expired bearer', EXPIRED_BEARER],
    ['a bearer next to a refresh cookie', { ...BEARER, ...WEB_COOKIE }],
  ])('[D-ARCH-109] [anonymous, session] with %s (a declared kind) fails closed: 401 private (the stub verifies nothing)', async (_l, h) => {
    expect(await probe(DUAL, h)).toEqual(DENIED);
  });

  it('[D-ARCH-107] an unrelated cookie is not a credential', async () => {
    expect(await probe({}, { Cookie: 'rt_web=x; theme=dark' })).toEqual(ANONYMOUS_RESULT);
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
      expect(await probe(spec, BEARER)).toEqual(DENIED);
    },
  );

  it('[SEC-TC-29] [D-ARCH-109] a [session] route with only a refresh cookie is 401 AUTH_REQUIRED, private', async () => {
    expect(await probe({ auth: 'session' }, WEB_COOKIE)).toEqual(DENIED);
  });

  it('[SEC-TC-29] [D-ARCH-109] a [refresh-cookie] route with only a bearer, or with its own cookie, is 401 AUTH_REQUIRED', async () => {
    expect(await probe({ auth: 'refresh-cookie' }, BEARER)).toEqual(DENIED);
    expect(await probe({ auth: 'refresh-cookie' }, ADMIN_COOKIE)).toEqual(DENIED);
  });

  it('[SEC-TC-29] [D-ARCH-109] an error after the slot ignored a foreign credential is no-store, not private', async () => {
    const failing = {
      handler: () => {
        throw new AppError('NOT_FOUND');
      },
    };
    expect(await probe(failing, WEB_COOKIE)).toEqual({ status: 404, code: 'NOT_FOUND', cacheControl: 'no-store' });
    expect(await probe({ ...failing, ...DUAL }, QUOTE_TOKEN)).toEqual({ status: 404, code: 'NOT_FOUND', cacheControl: 'no-store' });
  });
});
