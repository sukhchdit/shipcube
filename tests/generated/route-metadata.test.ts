/**
 * Build-time route test (US-067 AT-US-067-01..04, REQ-RBAC-005, NFR-AUDIT-004; api/README.md §15 assertions 1-11;
 * PR8-SEC-05 (a)-(d); PR20-SEC-12; TASK-020). Walks the composed app exactly as main.ts builds it, pairs every mounted
 * route with its `defineRoute` descriptor and compares the metadata with openapi.yaml; then one seeded defect per rule.
 */
import type { AddressInfo } from 'node:net';

import { beforeAll, describe, expect, it } from '@jest/globals';
import { ERROR_CATALOGUE } from '@platform/shared';
import type { Express } from 'express';
import Joi from 'joi';

import { allowedMethods } from '../../apps/api/src/platform/http/fallback.js';
import { defineRoute, type RouteDescriptor, type RouteSpec } from '../../apps/api/src/platform/routing/define-route.js';
import { assertRouteBindings, ROUTE_PIPELINE, RouteBindingError } from '../../apps/api/src/platform/routing/pipeline.js';
import { descriptorOf } from '../../apps/api/src/platform/routing/route-registry.js';
import { fixtureRoute } from '../../apps/api/src/platform/routing/tests/fixture-route.js';
import { preparedSchemasOf } from '../../apps/api/src/platform/validate/slot.js';
import { SAFE_MESSAGES, VALUE_REFERENCE } from '../../apps/api/src/platform/validate/validate.js';
import { type ContractOperation, listOperations, loadContract, type OpenApiDocument } from '../../tools/openapi/contract.js';
import { listMountedRoutes, readLedger } from '../../tools/openapi/drift.js';
import { type ApiMounts, loadApiMounts } from './api-mounts.js';
import { checkRouteMetadata, formatMetadataFinding, type MetadataFinding, schemaProblems } from './route-metadata.js';

type Loose = Readonly<Record<string, unknown>>;

/** A descriptor that declares exactly what openapi.yaml says about `op` (the "complete route" of AT-US-067-01). */
function descriptorFor(op: ContractOperation, overrides: Partial<RouteSpec> = {}): RouteDescriptor {
  const x = (name: string): unknown => op.operation[name];
  const params = Object.fromEntries(
    ((op.operation['parameters'] as Loose[] | undefined) ?? [])
      .filter((parameter) => parameter['in'] === 'path')
      .map((parameter) => [String(parameter['name']), Joi.string().required()]),
  );
  const spec = {
    operationId: op.operationId,
    method: op.method.toLowerCase(),
    path: op.path.replaceAll(/\{([^}]+)\}/g, ':$1'),
    permission: x('x-permission'),
    ...(typeof x('x-permission-justification') === 'string' ? { permissionJustification: x('x-permission-justification') } : {}),
    audit: x('x-audit'),
    schema: Object.keys(params).length === 0 ? {} : { params: Joi.object(params) },
    rateLimit: x('x-rate-limit-class'),
    ...(typeof x('x-rate-limit-route') === 'string' ? { rateLimitRoute: x('x-rate-limit-route') } : {}),
    idempotency: x('x-idempotency'),
    tenancy: x('x-tenancy'),
    auth: 'session',
    handler: () => ({ status: 204 }),
    ...overrides,
  } as unknown as RouteSpec;
  return defineRoute(spec);
}

async function withServer<T>(app: Express, run: (base: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('build-time route test (US-067, api/README.md §15)', () => {
  let doc: OpenApiDocument;
  let ledger: string[];
  let api: ApiMounts;
  let getShipment: ContractOperation;

  beforeAll(async () => {
    [doc, ledger] = await Promise.all([loadContract(), readLedger()]);
    api = loadApiMounts();
    const found = listOperations(doc).find((op) => op.operationId === 'getShipment');
    if (found === undefined) throw new Error('getShipment missing from openapi.yaml');
    getShipment = found;
  });

  const check = (target: ApiMounts = api, implemented: readonly string[] = ledger): MetadataFinding[] =>
    checkRouteMetadata({ doc, mounted: listMountedRoutes(target.mounts, target.walk), descriptorOf, implemented });
  const withModule = (routes: readonly RouteDescriptor[]): ApiMounts => loadApiMounts([{ name: 'fixture', routes }]);

  it('[AT-US-034-01] every mounted route has defineRoute metadata equal to openapi.yaml; count equals the implemented operations', () => {
    expect(check().map(formatMetadataFinding)).toEqual([]);
    const mounted = listMountedRoutes(api.mounts, api.walk).filter((route) => descriptorOf(route.handler) !== undefined);
    expect(mounted.map((route) => descriptorOf(route.handler)?.operationId).sort()).toEqual([...ledger].sort());
    expect(api.descriptors.map((route) => route.operationId).sort()).toEqual([...ledger].sort());
  });

  it('[AT-US-067-01] a complete route (permission shipment:read, audit descriptor, schema) mounts and the build test passes', () => {
    const route = descriptorFor(getShipment);
    expect(route.permission).toBe('shipment:read');
    // getShipment's module codes (ACCESS_TOKEN_EXPIRED, RATE_LIMITED, ...) join the error catalogue with their modules
    // (TASK-036 and later); the catalogue rule itself is proven on the mounted routes above and seeded below.
    const findings = check(withModule([route]), [...ledger, 'getShipment']).filter((finding) => finding.rule !== 'error-codes');
    expect(findings.map(formatMetadataFinding)).toEqual([]);
  });

  it('[assertion 6] a mounted route whose x-error-codes are not all catalogued is named', () => {
    expect(check(withModule([descriptorFor(getShipment)]), [...ledger, 'getShipment'])).toContainEqual(
      expect.objectContaining({ rule: 'error-codes', message: expect.stringContaining('is not in the error catalogue') }),
    );
  });

  it('[AT-US-067-02] a route lacking its permission, audit descriptor or schema is refused at start-up', () => {
    const base = { ...fixtureRoute({ operationId: 'example', path: '/example', handler: () => ({ status: 204 }) }) };
    for (const missing of ['permission', 'audit', 'schema'] as const) {
      const spec = { ...base, [missing]: undefined } as unknown as RouteSpec;
      expect(() => defineRoute(spec)).toThrow(/defineRoute GET \/example \(example\)/);
    }
  });

  it('[AT-US-067-02] a handler mounted without defineRoute fails the router-enumeration test naming GET /api/v1/example', () => {
    const target = loadApiMounts();
    target.app.get('/api/v1/example', (_req, res) => {
      res.end();
    });
    expect(check(target)).toContainEqual(expect.objectContaining({ rule: 'raw-handler', route: 'GET /api/v1/example' }));
  });

  it('[AT-US-067-03] a "public" marker with an empty justification fails; one differing from the contract fails too', () => {
    const spec = { ...fixtureRoute({ operationId: 'getLiveness', path: '/x', handler: () => ({ status: 204 }) }) };
    expect(() => defineRoute({ ...spec, permissionJustification: ' ' } as RouteSpec)).toThrow(
      'marker "public" needs a permissionJustification',
    );
    const publicOp = listOperations(doc).find((op) => op.operation['x-permission'] === 'public' && op.fullPath.startsWith(api.apiPrefix));
    if (publicOp === undefined) throw new Error('no public /api/v1 operation');
    const route = descriptorFor(publicOp, { permissionJustification: 'Something else.' });
    expect(check(withModule([route]), [...ledger, publicOp.operationId])).toContainEqual(
      expect.objectContaining({ rule: 'permission', message: expect.stringContaining('permissionJustification differs') }),
    );
  });

  it('[AT-US-067-04] an undeclared query parameter is 400 VALIDATION_ERROR with sub-code UNKNOWN_FIELD', async () => {
    await withServer(api.app, async (base) => {
      const response = await fetch(`${base}/health/live?debug=1`);
      expect(response.status).toBe(400);
      const body = (await response.json()) as Loose;
      expect(body['code']).toBe('VALIDATION_ERROR');
      expect(body['errors']).toEqual([{ pointer: '/query/debug', code: 'UNKNOWN_FIELD', message: 'Field is not allowed.' }]);
    });
  });

  it.each<[string, Partial<RouteSpec>, MetadataFinding['rule'], string]>([
    ['permission (assertion 2)', { permission: 'shipment:create' }, 'permission', 'permission shipment:create in metadata, shipment:read'],
    [
      'audit (assertion 3)',
      { audit: { action: 'VIEW', entity: 'order', sensitivity: 'NORMAL', reasonRequired: false } },
      'audit',
      '"entity":"order"',
    ],
    ['idempotency (assertion 4)', { idempotency: 'required' }, 'extension', 'x-idempotency "required" in metadata'],
    ['tenancy (assertion 4)', { tenancy: 'user' }, 'extension', 'x-tenancy "user" in metadata'],
    ['rate-limit class (assertion 4)', { rateLimit: 'public' }, 'extension', 'x-rate-limit-class "public"'],
    ['reauth (assertion 4)', { reauth: { scope: 'privacy.export' } }, 'extension', 'x-reauth-scope "privacy.export"'],
    ['authentication', { auth: 'anonymous' }, 'auth', 'auth anonymous in metadata, session'],
  ])('a seeded %s defect is named with METHOD path', (_label, overrides, rule, text) => {
    const findings = check(withModule([descriptorFor(getShipment, overrides)]), [...ledger, 'getShipment']);
    expect(findings).toContainEqual(
      expect.objectContaining({ rule, route: 'GET /api/v1/shipments/:shipmentId', message: expect.stringContaining(text) }),
    );
  });

  it('[assertion 5] Joi and OpenAPI disagreeing on a part, a required key, a closed object or a constraint is named', () => {
    const extra = descriptorFor(getShipment, {
      schema: { params: Joi.object({ shipmentId: Joi.string().required() }), body: Joi.object({ x: Joi.string().required() }) },
    });
    expect(schemaProblems(extra, getShipment)).toEqual([
      expect.stringContaining('body: Joi declares [x], OpenAPI []'),
      expect.stringContaining('body: Joi requires [x], OpenAPI []'),
    ]);
    const optional = descriptorFor(getShipment, { schema: { params: Joi.object({ shipmentId: Joi.string() }) } });
    expect(schemaProblems(optional, getShipment)).toEqual([expect.stringContaining('params: Joi requires []')]);
    const query = descriptorFor(getShipment, {
      schema: { params: Joi.object({ shipmentId: Joi.string().required() }), query: Joi.object({ q: Joi.string().max(3) }) },
    });
    expect(schemaProblems(query, getShipment)).toEqual([expect.stringContaining('query: Joi declares [q], OpenAPI []')]);
  });

  it('[assertion 6, assertion 9] every x-error-codes entry is catalogued with a response; one-time-secret routes are not-applicable', () => {
    expect(Object.keys(ERROR_CATALOGUE).length).toBeGreaterThan(0);
    const contractWide = check().filter((finding) => finding.rule === 'one-time-secret' || finding.rule === 'error-codes');
    expect(contractWide).toEqual([]);
  });

  it('[PR8-SEC-05] the mounted routes hold every binding rule, in development and in production', () => {
    expect(() => assertRouteBindings(api.descriptors, { production: false })).not.toThrow();
    expect(() => assertRouteBindings(api.descriptors, { production: true })).not.toThrow();
  });

  it.each<[string, Partial<RouteSpec>, boolean, string]>([
    [
      '(a) self-service on a tenant route',
      { permission: 'session:manage', tenancy: 'tenant', auth: 'session' },
      false,
      'SELF_SERVICE_TENANCY',
    ],
    [
      '(b) operator-cross-tenant without an operator permission',
      { permission: 'shipment:read', tenancy: 'operator-cross-tenant', auth: 'session' },
      false,
      'OPERATOR_CROSS_TENANT',
    ],
    [
      '(c) a signature-only permission on a session route',
      { permission: 'webhook:stripe:receive', tenancy: 'public', auth: 'session' },
      false,
      'SIGNATURE_AUTH',
    ],
    [
      '(d) the mock gateway webhook in production',
      { permission: 'webhook:mock_gateway:receive', tenancy: 'public', auth: 'signature' },
      true,
      'MOCK_WEBHOOK_IN_PRODUCTION',
    ],
  ])('[PR8-SEC-05 %s] start-up refuses the route', (_label, overrides, production, rule) => {
    const route = defineRoute({
      ...fixtureRoute({ operationId: 'bindingFixture', path: '/binding', handler: () => ({ status: 204 }) }),
      permissionJustification: undefined,
      transaction: 'tenant',
      ...overrides,
    } as RouteSpec);
    expect(() => assertRouteBindings([route], { production })).toThrow(RouteBindingError);
    expect(() => assertRouteBindings([route], { production })).toThrow(
      rule === 'MOCK_WEBHOOK_IN_PRODUCTION' ? 'must not be mounted' : 'GET /binding',
    );
  });

  it('[PR20-SEC-12] no mounted schema message template interpolates the value, and a rejected value never reaches the body', async () => {
    expect(Object.values(SAFE_MESSAGES).filter((template) => VALUE_REFERENCE.test(template))).toEqual([]);
    const probe = fixtureRoute({
      operationId: 'probe',
      path: '/probe',
      schema: { query: Joi.object({ q: Joi.string().pattern(/^x$/).messages({ 'string.pattern.base': 'bad {{#value}}' }) }) },
      handler: () => ({ status: 204 }),
    });
    for (const route of [...api.descriptors, probe]) {
      const templates = JSON.stringify(Object.values(preparedSchemasOf(route)).map((schema) => schema?.describe()));
      if (route !== probe)
        expect({ route: route.operationId, leaks: VALUE_REFERENCE.test(templates) }).toEqual({ route: route.operationId, leaks: false });
    }
    expect(VALUE_REFERENCE.test(JSON.stringify(preparedSchemasOf(probe).query?.describe()))).toBe(true); // the walk sees a module's own message
    await withServer(withModule([probe]).app, async (base) => {
      const response = await fetch(`${base}/api/v1/probe?q=zzSentinelValue`);
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(text).not.toContain('zzSentinelValue');
      expect((JSON.parse(text) as Loose)['errors']).toEqual([
        { pointer: '/query/q', code: 'INVALID_FORMAT', message: 'Field has an invalid format.' },
      ]);
    });
  });

  it('[assertion 10] the excluded /api/docs mount answers GET and HEAD only on its paths, 405 otherwise and 404 elsewhere', async () => {
    const docsRoutes = listMountedRoutes(api.mounts, { mountPaths: api.walk.mountPaths }).filter((route) =>
      route.path.startsWith(api.docsPath),
    );
    expect(docsRoutes.length).toBeGreaterThan(1);
    for (const route of docsRoutes) {
      expect({ path: route.path, allowed: allowedMethods(api.app.router, route.path) }).toEqual({
        path: route.path,
        allowed: ['GET', 'HEAD'],
      });
    }
    await withServer(api.app, async (base) => {
      for (const route of docsRoutes) {
        const post = await fetch(`${base}${route.path}`, { method: 'POST' });
        expect({ path: route.path, status: post.status, allow: post.headers.get('allow') }).toEqual({
          path: route.path,
          status: 405,
          allow: 'GET, HEAD, OPTIONS',
        });
        const options = await fetch(`${base}${route.path}`, { method: 'OPTIONS' });
        expect({ path: route.path, status: options.status, allow: options.headers.get('allow') }).toEqual({
          path: route.path,
          status: 204,
          allow: 'GET, HEAD, OPTIONS',
        });
      }
      expect((await fetch(`${base}/api/docs/oauth2-redirect.html`)).status).toBe(404);
    });
  });

  it('[assertion 11] pipeline order: step-0 limiter and CORS preflight are path-less and precede the routes (OPTIONS responder, docs)', () => {
    const top = (api.app.router as unknown as { stack: { name: string; slash?: boolean }[] }).stack;
    const names = top.map((layer) => layer.name);
    const index = (name: string): number => names.indexOf(name);
    expect(index('ipLimiter')).toBeGreaterThan(-1);
    expect(top[index('ipLimiter')]?.slash).toBe(true);
    expect(top[index('corsPreflight')]?.slash).toBe(true);
    expect(index('ipLimiter')).toBeLessThan(index('corsPreflight'));
    const routesIndex = names.indexOf('router');
    expect(index('corsPreflight')).toBeLessThan(routesIndex);
    const routes = (top[routesIndex] as unknown as { handle: { stack: { name: string; matchers?: unknown[] }[] } }).handle.stack;
    expect(routes[0]?.name).toBe('optionsResponder');
    // Every mounted route runs the per-route slots in the fixed order.
    const live = routes.find((layer) => (layer as unknown as { route?: { path?: string } }).route?.path === '/health/live') as unknown as {
      route: { stack: { name: string }[] };
    };
    expect(live.route.stack.map((layer) => layer.name)).toEqual(ROUTE_PIPELINE.map((step) => `route:${step}`));
  });
});
