// D-ARCH-109 / ADR-0008 am. 5 (TASK-020 part 020-B): a route reads only the credential kinds it declares. With the authn
// stub, a foreign credential is ignored (the no-credential result, the contract Cache-Control untouched) and a declared
// one fails closed. Real createApp with defineRoute fixtures standing in for the contract operations (listCountries,
// loginUser, getShipment and getCsrfToken are not mounted yet); every response is validated against openapi.yaml,
// SEC-TC-29 cache check included, through api(app). No database: authn answers before the transaction runner.
import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';
import Joi from 'joi';

import { createApp } from '../../apps/api/src/app.js';
import type { TenantTxRunner } from '../../apps/api/src/platform/db/index.js';
import type { RouteDescriptor } from '../../apps/api/src/platform/routing/define-route.js';
import { fixtureRoute } from '../../apps/api/src/platform/routing/tests/fixture-route.js';
import { api } from './helpers/expect-contract.js';

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };
/** openapi.yaml CacheControl: public reference data is `public, max-age=3600` (REQ-DATA-016). */
const PUBLIC_CACHE = 'public, max-age=3600';
const PRIVATE = 'private, no-store';

const COUNTRIES = {
  items: [
    {
      code: 'IN',
      alpha3: 'IND',
      numeric: '356',
      name: 'India',
      currency: 'INR',
      unit_system: 'METRIC',
      location_type: 'POSTCODE_REQUIRED',
      postcode: { pattern: '^[1-9][0-9]{5}$', example: '560001' },
      region_required: true,
      shipping_enabled: true,
      launch_country: true,
    },
  ],
  next_cursor: null,
  has_more: false,
};

const routes: RouteDescriptor[] = [
  // [anonymous]: public reference data with its contract Cache-Control.
  fixtureRoute({
    operationId: 'listCountries',
    path: '/reference/countries',
    handler: () => ({ status: 200, body: COUNTRIES, headers: { 'Cache-Control': PUBLIC_CACHE } }),
  }),
  // [anonymous]: the credential exchange (createSession of the sheet line); the fixture handler refuses every body.
  fixtureRoute({
    operationId: 'loginUser',
    method: 'post',
    path: '/auth/login',
    handler: () => {
      throw new AppError('VALIDATION_ERROR');
    },
  }),
  // [refresh-cookie]
  fixtureRoute({ operationId: 'getCsrfToken', path: '/auth/csrf', auth: 'refresh-cookie', handler: () => ({ status: 200, body: {} }) }),
  // [session]
  fixtureRoute({
    operationId: 'getShipment',
    path: '/shipments/:shipmentId',
    permission: 'shipment:read',
    permissionJustification: undefined,
    tenancy: 'tenant',
    auth: 'session',
    transaction: 'tenant',
    schema: { params: Joi.object({ shipmentId: Joi.string().guid().required() }) },
    handler: () => ({ status: 200, body: {} }),
  } as Parameters<typeof fixtureRoute>[0]),
];

const tenantTx: TenantTxRunner<unknown> = {
  transactionOptions: { maxWait: 1, timeout: 1 },
  probeFreshConnection: () => Promise.resolve(),
  withTenantTx: <R>(): Promise<R> => Promise.reject(new Error('authn answers first')),
};
const app = createApp({ health: [], modules: [{ name: 'credentials', routes }], logger: silent, tenantTx });

const SHIPMENT = '/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01';
const REFRESH_COOKIE = { Cookie: 'theme=dark; __Host-rt_web=opaque' };
const EXPIRED_BEARER = { Authorization: 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJleHAiOjF9.expired' };
const MALFORMED_BEARER = { Authorization: 'not-a-bearer' };
const QUOTE_TOKEN = { 'X-Quote-Token': 'c'.repeat(64) };

const FOREIGN: [string, Record<string, string>][] = [
  ['only a refresh cookie', REFRESH_COOKIE],
  ['only an expired bearer', EXPIRED_BEARER],
  ['only a malformed bearer', MALFORMED_BEARER],
  ['only an X-Quote-Token', QUOTE_TOKEN],
];

describe('[D-ARCH-109] a route reads only the credential kinds it declares (authn stub)', () => {
  it.each(FOREIGN)(
    '[SEC-TC-29] [D-ARCH-109] listCountries with %s gives the no-credential result and its contract Cache-Control',
    async (_l, h) => {
      const client = await api(app);
      const response = await client.get('/api/v1/reference/countries').set(h).expect(200);
      expect(response.headers['cache-control']).toBe(PUBLIC_CACHE);
      expect(response.body).toEqual(COUNTRIES);
    },
  );

  it.each(FOREIGN)(
    '[SEC-TC-29] [D-ARCH-109] loginUser with %s reaches the handler; its problem is no-store, not private',
    async (_l, h) => {
      const client = await api(app);
      const response = await client.post('/api/v1/auth/login').set(h).expect(400);
      expect((response.body as { code?: unknown }).code).toBe('VALIDATION_ERROR');
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it('[SEC-TC-29] [D-ARCH-109] without any credential both [anonymous] routes answer the same', async () => {
    const client = await api(app);
    expect((await client.get('/api/v1/reference/countries').expect(200)).headers['cache-control']).toBe(PUBLIC_CACHE);
    expect((await client.post('/api/v1/auth/login').expect(400)).headers['cache-control']).toBe('no-store');
  });

  it('[SEC-TC-29] [D-ARCH-109] a [session] route with only a refresh cookie is 401 AUTH_REQUIRED, private', async () => {
    const client = await api(app);
    const response = await client.get(SHIPMENT).set(REFRESH_COOKIE).expect(401);
    expect((response.body as { code?: unknown }).code).toBe('AUTH_REQUIRED');
    expect(response.headers['cache-control']).toBe(PRIVATE);
  });

  it('[SEC-TC-29] [D-ARCH-109] a [refresh-cookie] route with only a bearer is 401 AUTH_REQUIRED, private', async () => {
    const client = await api(app);
    const response = await client.get('/api/v1/auth/csrf').set(EXPIRED_BEARER).expect(401);
    expect((response.body as { code?: unknown }).code).toBe('AUTH_REQUIRED');
    expect(response.headers['cache-control']).toBe(PRIVATE);
  });
});
