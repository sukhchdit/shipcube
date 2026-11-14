/**
 * Build-time route test (US-067 AT-US-067-01..04, REQ-RBAC-005, NFR-AUDIT-004; api/README.md §15 assertions 1-11;
 * PR8-SEC-05 (a)-(d); PR20-SEC-12; TASK-020). Walks the composed app exactly as main.ts builds it, pairs every mounted
 * route with its `defineRoute` descriptor and compares the metadata with openapi.yaml; then one seeded defect per rule.
 */
import type { AddressInfo } from 'node:net';

import { beforeAll, describe, expect, it } from '@jest/globals';
import { type BoundRoute, findRouteBindingViolations, formatRouteAuth, type RouteAuth } from '@platform/authz';
import { CREDENTIAL_HEADER_NAMES, ERROR_CATALOGUE, REFRESH_COOKIE_NAMES } from '@platform/shared';
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
import { type ApiMounts, loadApiMounts, metadataFixtureSlots } from './api-mounts.js';
import {
  checkRouteMetadata,
  contractAuth,
  contractBoundRoutes,
  formatMetadataFinding,
  type MetadataFinding,
  permissionStatusProblems,
  reauthProblems,
  schemaProblems,
  securityListsQuoteToken,
  TRANSACTION_NONE_OPERATIONS,
  transactionProblems,
} from './route-metadata.js';

type Loose = Readonly<Record<string, unknown>>;

/** A descriptor that declares exactly what openapi.yaml says about `op` (the "complete route" of AT-US-067-01). */
function descriptorFor(
  doc: OpenApiDocument,
  op: ContractOperation,
  overrides: { readonly [K in keyof RouteSpec]?: RouteSpec[K] | undefined } = {},
): RouteDescriptor {
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
    auth: contractAuth(op, doc),
    ...(typeof x('x-permission-authenticated') === 'string' ? { permissionAuthenticated: x('x-permission-authenticated') } : {}),
    ...(x('x-csrf') === true ? { csrf: true } : {}),
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
  const withModule = (routes: readonly RouteDescriptor[]): ApiMounts =>
    loadApiMounts([{ name: 'fixture', routes }], metadataFixtureSlots());

  it('[AT-US-034-01] every mounted route has defineRoute metadata equal to openapi.yaml; count equals the implemented operations', () => {
    expect(check().map(formatMetadataFinding)).toEqual([]);
    const mounted = listMountedRoutes(api.mounts, api.walk).filter((route) => descriptorOf(route.handler) !== undefined);
    expect(mounted.map((route) => descriptorOf(route.handler)?.operationId).sort()).toEqual([...ledger].sort());
    expect(api.descriptors.map((route) => route.operationId).sort()).toEqual([...ledger].sort());
  });

  it('[AT-US-067-01] a complete route (permission shipment:read, audit descriptor, schema) mounts and the build test passes', () => {
    const route = descriptorFor(doc, getShipment);
    expect(route.permission).toBe('shipment:read');
    // getShipment's module codes (ACCESS_TOKEN_EXPIRED, RATE_LIMITED, ...) join the error catalogue with their modules
    // (TASK-036 and later); the catalogue rule itself is proven on the mounted routes above and seeded below.
    const findings = check(withModule([route]), [...ledger, 'getShipment']).filter((finding) => finding.rule !== 'error-codes');
    expect(findings.map(formatMetadataFinding)).toEqual([]);
  });

  it('[assertion 6] a mounted route whose x-error-codes are not all catalogued is named', () => {
    expect(check(withModule([descriptorFor(doc, getShipment)]), [...ledger, 'getShipment'])).toContainEqual(
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
    expect(() => defineRoute({ ...spec, permissionJustification: ' ' } as unknown as RouteSpec)).toThrow(
      'marker "public" needs a permissionJustification',
    );
    const publicOp = listOperations(doc).find((op) => op.operation['x-permission'] === 'public' && op.fullPath.startsWith(api.apiPrefix));
    if (publicOp === undefined) throw new Error('no public /api/v1 operation');
    const route = descriptorFor(doc, publicOp, { permissionJustification: 'Something else.' });
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
  ])('a seeded %s defect is named with METHOD path', (_label, overrides, rule, text) => {
    const findings = check(withModule([descriptorFor(doc, getShipment, overrides)]), [...ledger, 'getShipment']);
    expect(findings).toContainEqual(
      expect.objectContaining({ rule, route: 'GET /api/v1/shipments/:shipmentId', message: expect.stringContaining(text) }),
    );
  });

  it('[assertion 5] Joi and OpenAPI disagreeing on a part, a required key, a closed object or a constraint is named', () => {
    const extra = descriptorFor(doc, getShipment, {
      schema: { params: Joi.object({ shipmentId: Joi.string().required() }), body: Joi.object({ x: Joi.string().required() }) },
    });
    expect(schemaProblems(extra, getShipment)).toEqual([
      expect.stringContaining('body: Joi declares [x], OpenAPI []'),
      expect.stringContaining('body: Joi requires [x], OpenAPI []'),
    ]);
    const optional = descriptorFor(doc, getShipment, { schema: { params: Joi.object({ shipmentId: Joi.string() }) } });
    expect(schemaProblems(optional, getShipment)).toEqual([expect.stringContaining('params: Joi requires []')]);
    const query = descriptorFor(doc, getShipment, {
      schema: { params: Joi.object({ shipmentId: Joi.string().required() }), query: Joi.object({ q: Joi.string().max(3) }) },
    });
    expect(schemaProblems(query, getShipment)).toEqual([expect.stringContaining('query: Joi declares [q], OpenAPI []')]);
  });

  describe('[D-ARCH-113] credential headers: the shared list and the contract', () => {
    const operation = (operationId: string): ContractOperation => {
      const found = listOperations(doc).find((op) => op.operationId === operationId);
      if (found === undefined) throw new Error(`${operationId} missing from openapi.yaml`);
      return found;
    };
    const components = (): Loose => (doc as unknown as { components: Loose }).components;

    it('[D-ARCH-113] CREDENTIAL_HEADER_NAMES lists every header the securitySchemes derive, and nothing else', () => {
      const schemes = components()['securitySchemes'] as Readonly<Record<string, Loose>>;
      const derived = new Set<string>();
      for (const [name, scheme] of Object.entries(schemes)) {
        if (scheme['type'] === 'http' && scheme['scheme'] === 'bearer') derived.add('authorization');
        else if (scheme['type'] === 'apiKey' && scheme['in'] === 'header') derived.add(String(scheme['name']).toLowerCase());
        else if (scheme['type'] === 'apiKey' && scheme['in'] === 'cookie') {
          derived.add('cookie');
          // A cookie scheme is a credential only when the shared presence test reads it as a refresh cookie.
          expect([name, REFRESH_COOKIE_NAMES.includes(String(scheme['name']))]).toEqual([name, true]);
        } else throw new Error(`securityScheme ${name} has a shape this parity test does not derive: ${JSON.stringify(scheme)}`);
      }
      // Header PARAMETERS rather than schemes, listed by hand: the re-authentication proof (ReauthProof and
      // ReauthProofConditional, ADR-0006 am. 3). x-csrf-token is the csrfToken scheme, so it is derived above.
      const parameters = components()['parameters'] as Readonly<Record<string, Loose>>;
      const proofs = Object.values(parameters).filter((parameter) => String(parameter['name']).toLowerCase() === 'x-reauth-proof');
      expect(proofs.length).toBeGreaterThan(0);
      const expected = [...derived, 'x-reauth-proof'].sort();
      expect([...CREDENTIAL_HEADER_NAMES].sort()).toEqual(expected);
      expect(Object.isFrozen(CREDENTIAL_HEADER_NAMES)).toBe(true);
    });

    it('[D-ARCH-113] x-quote-token companion parity: declared on claimQuote ([session] + QuoteToken parameter), skipped on getQuote', () => {
      const claimQuote = operation('claimQuote');
      expect(contractAuth(claimQuote, doc)).toEqual(['session']);
      const headerProblems = (route: RouteDescriptor, op: ContractOperation) =>
        schemaProblems(route, op, doc).filter((problem) => problem.startsWith('headers'));
      // Without the companion in schema.headers the contract's QuoteToken parameter is named (no blanket exclusion).
      const without = descriptorFor(doc, claimQuote);
      expect(headerProblems(without, claimQuote)).toEqual([expect.stringContaining('headers: Joi declares [], OpenAPI [x-quote-token]')]);
      const companion = descriptorFor(doc, claimQuote, {
        schema: {
          ...descriptorFor(doc, claimQuote).schema,
          headers: Joi.object({ 'x-quote-token': Joi.string().pattern(/^[A-Za-z0-9_-]{43}$/) }),
        },
      });
      expect(headerProblems(companion, claimQuote).filter((problem) => problem.includes('declares'))).toEqual([]);
      // getQuote lists quoteToken in its security: the slot reads the header, so the comparison skips it either way.
      const getQuote = operation('getQuote');
      expect(securityListsQuoteToken(getQuote, doc)).toBe(true);
      expect(securityListsQuoteToken(claimQuote, doc)).toBe(false);
      expect(headerProblems(descriptorFor(doc, getQuote), getQuote)).toEqual([]);
    });
  });

  it('[assertion 6, assertion 9] every x-error-codes entry is catalogued with a response; one-time-secret routes are not-applicable', () => {
    expect(Object.keys(ERROR_CATALOGUE).length).toBeGreaterThan(0);
    const contractWide = check().filter((finding) => finding.rule === 'one-time-secret' || finding.rule === 'error-codes');
    expect(contractWide).toEqual([]);
  });

  describe('[R2-m2] the transaction, permission-status and reauth rules are wired into checkRouteMetadata', () => {
    /** A copy of the contract with one operation changed (the shared document is never mutated). */
    const docWith = (change: (operation: Record<string, unknown>) => boolean): OpenApiDocument => {
      const copy = structuredClone(doc);
      const changed = listOperations(copy).some((op) => change(op.operation));
      if (!changed) throw new Error('no operation of openapi.yaml fits the seeded defect');
      return copy;
    };
    const checkDoc = (seeded: OpenApiDocument): MetadataFinding[] =>
      checkRouteMetadata({ doc: seeded, mounted: listMountedRoutes(api.mounts, api.walk), descriptorOf, implemented: ledger });

    it('[D-ARCH-106 (6)] a seeded transaction none route outside the pin is named through the composed check', () => {
      const candidate = listOperations(doc).find(
        (op) =>
          op.fullPath.startsWith(api.apiPrefix) &&
          op.operation['x-tenancy'] === 'public' &&
          (op.operation['x-audit'] as Loose | undefined)?.['action'] === 'NONE' &&
          !TRANSACTION_NONE_OPERATIONS.has(op.operationId),
      );
      if (candidate === undefined) throw new Error('no public, unaudited /api/v1 operation in openapi.yaml');
      const route = descriptorFor(doc, candidate, { transaction: 'none' });
      expect(check(withModule([route]), [...ledger, candidate.operationId])).toContainEqual(
        expect.objectContaining({ rule: 'transaction', message: expect.stringContaining('outside TRANSACTION_NONE_OPERATIONS') }),
      );
    });

    it('[assertion 2] a seeded x-permission-status: proposed is named through the composed check', () => {
      const seeded = docWith((operation) => {
        operation['x-permission-status'] = 'proposed';
        return true;
      });
      expect(checkDoc(seeded)).toContainEqual(
        expect.objectContaining({ rule: 'permission-status', message: expect.stringContaining('x-permission-status "proposed" remains') }),
      );
    });

    it('[assertion 4] a seeded x-reauth-max-age without a scope is named through the composed check', () => {
      const seeded = docWith((operation) => {
        if (operation['x-reauth-scope'] !== undefined) return false;
        operation['x-reauth-max-age'] = 600;
        return true;
      });
      expect(checkDoc(seeded)).toContainEqual(
        expect.objectContaining({ rule: 'reauth', message: expect.stringContaining('x-reauth-max-age without x-reauth-scope') }),
      );
    });
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
    } as unknown as RouteSpec);
    expect(() => assertRouteBindings([route], { production })).toThrow(RouteBindingError);
    expect(() => assertRouteBindings([route], { production })).toThrow(
      rule === 'MOCK_WEBHOOK_IN_PRODUCTION' ? 'must not be mounted' : 'GET /binding',
    );
  });

  describe('[D-ARCH-107] route authentication sets versus the contract', () => {
    const AUTH_RULES: readonly string[] = ['AUTH_SET', 'PERMISSION_AUTH', 'DUAL_MODE', 'CSRF_COOKIE'];
    const authViolations = (routes: readonly BoundRoute[]) =>
      findRouteBindingViolations(routes, { production: false }).filter((violation) => AUTH_RULES.includes(violation.rule));
    const opNamed = (operationId: string): ContractOperation => {
      const found = listOperations(doc).find((op) => op.operationId === operationId);
      if (found === undefined) throw new Error(`${operationId} missing from openapi.yaml`);
      return found;
    };
    /** The contract's routes with one operation's bound route changed (a seeded defect). */
    const contractWith = (operationId: string, change: (route: BoundRoute) => BoundRoute): BoundRoute[] =>
      contractBoundRoutes(doc).map((entry) => (entry.operationId === operationId ? change(entry.route) : entry.route));
    const syntheticOp = (security: unknown): ContractOperation => ({
      operationId: 'syntheticOp',
      method: 'GET',
      path: '/x',
      fullPath: '/api/v1/x',
      operation: { security },
    });

    it('[D-ARCH-107] contractAuth reads each security list as a set: 29/95/3/3/1/2 over the 133 operations', () => {
      const counts: Record<string, number> = {};
      for (const op of listOperations(doc)) {
        const key = formatRouteAuth(contractAuth(op, doc));
        counts[key] = (counts[key] ?? 0) + 1;
      }
      expect(counts).toEqual({
        '[anonymous]': 29,
        '[session]': 95,
        '[refresh-cookie]': 3,
        '[signature]': 3,
        '[anonymous, session]': 1,
        '[session, quote-token]': 2,
      });
      expect(contractAuth(opNamed('createQuote'), doc)).toEqual(['anonymous', 'session']);
      expect(contractAuth(opNamed('getQuote'), doc)).toEqual(['session', 'quote-token']);
      expect(contractAuth(opNamed('refreshSession'), doc)).toEqual(['refresh-cookie']);
    });

    it('[D-ARCH-107] AUTH_SET, PERMISSION_AUTH, DUAL_MODE and CSRF_COOKIE report nothing on the whole contract', () => {
      const routes = contractBoundRoutes(doc).map(({ route }) => route);
      expect(routes).toHaveLength(133);
      expect(authViolations(routes)).toEqual([]);
    });

    it('[D-ARCH-107] contractAuth maps every scheme, keeps csrfToken a companion and names what no kind covers', () => {
      expect(contractAuth(syntheticOp([]), doc)).toEqual(['anonymous']);
      expect(contractAuth(syntheticOp(undefined), doc)).toEqual(['session']); // the document-level bearerAuth
      expect(
        contractAuth(
          syntheticOp([
            { refreshCookieWeb: [], csrfToken: [] },
            { refreshCookieAdmin: [], csrfToken: [] },
          ]),
          doc,
        ),
      ).toEqual(['refresh-cookie']);
      expect(contractAuth(syntheticOp([{ carrierSignature: [] }]), doc)).toEqual(['signature']);
      expect(contractAuth(syntheticOp([{ quoteToken: [] }, { bearerAuth: [] }]), doc)).toEqual(['session', 'quote-token']);
      expect(contractAuth(syntheticOp([{ bearerAuth: [], quoteToken: [] }]), doc)).toEqual(['session+quote-token']);
      expect(contractAuth(syntheticOp([{ csrfToken: [] }]), doc)).toEqual(['csrfToken']);
      expect(contractAuth(syntheticOp([{ apiKey: [] }, {}, { zKey: [] }]), doc)).toEqual(['anonymous', 'apiKey', 'zKey']);
    });

    it('[D-ARCH-107] a seeded dropped quote-token alternative is named by set parity and x-permission-authenticated', () => {
      const route = descriptorFor(doc, opNamed('getQuote'), { auth: 'session', permissionAuthenticated: undefined });
      const findings = check(withModule([route]), [...ledger, 'getQuote']).filter((finding) => finding.rule === 'auth');
      expect(findings).toEqual([
        expect.objectContaining({
          route: expect.stringMatching(/^GET \/api\/v1\/quotes\//),
          message: expect.stringContaining('auth [session] in metadata, [session, quote-token] from the openapi.yaml security'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('permissionAuthenticated null in metadata, x-permission-authenticated "quote:read"'),
        }),
      ]);
    });

    it('[D-ARCH-107] a seeded refresh route declared session is named by set parity', () => {
      const route = descriptorFor(doc, opNamed('refreshSession'), { auth: 'session' });
      expect(check(withModule([route]), [...ledger, 'refreshSession'])).toContainEqual(
        expect.objectContaining({
          rule: 'auth',
          message: expect.stringContaining('auth [session] in metadata, [refresh-cookie] from the openapi.yaml security'),
        }),
      );
    });

    it('[D-ARCH-107] a seeded x-permission-authenticated mismatch is named', () => {
      const route = descriptorFor(doc, opNamed('createQuote'), { permissionAuthenticated: 'quote:read' });
      expect(check(withModule([route]), [...ledger, 'createQuote'])).toContainEqual(
        expect.objectContaining({
          rule: 'auth',
          message: expect.stringContaining('permissionAuthenticated "quote:read" in metadata, x-permission-authenticated "quote:create"'),
        }),
      );
    });

    it('[D-ARCH-107] a seeded missing permissionAuthenticated is refused by defineRoute and by DUAL_MODE', () => {
      expect(() => descriptorFor(doc, opNamed('createQuote'), { permissionAuthenticated: undefined })).toThrow(
        'needs permissionAuthenticated',
      );
      const violations = authViolations(contractWith('createQuote', (route) => ({ ...route, permissionAuthenticated: undefined })));
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'DUAL_MODE', message: expect.stringContaining('needs permissionAuthenticated') }),
      ]);
    });

    it('[D-ARCH-107] a seeded permissionAuthenticated on a non-dual route is refused by defineRoute and by DUAL_MODE', () => {
      expect(() => descriptorFor(doc, getShipment, { permissionAuthenticated: 'quote:read' })).toThrow('only allowed on a dual-mode route');
      const violations = authViolations(contractWith('getShipment', (route) => ({ ...route, permissionAuthenticated: 'quote:read' })));
      expect(violations).toEqual([expect.objectContaining({ rule: 'DUAL_MODE', route: 'GET /api/v1/shipments/{shipmentId}' })]);
    });

    it('[D-ARCH-107] a seeded unlisted combination is refused by defineRoute and by AUTH_SET', () => {
      expect(() =>
        fixtureRoute({ operationId: 'oddAuth', path: '/odd', auth: ['anonymous', 'quote-token'], handler: () => ({ status: 204 }) }),
      ).toThrow('auth [anonymous, quote-token] is not an accepted set');
      const odd = contractAuth(syntheticOp([{}, { quoteToken: [] }]), doc) as readonly RouteAuth[];
      const violations = authViolations(contractWith('getQuote', (route) => ({ ...route, auth: odd })));
      expect(violations).toContainEqual(
        expect.objectContaining({
          rule: 'AUTH_SET',
          message: expect.stringContaining('auth [anonymous, quote-token] is not an accepted set'),
        }),
      );
    });
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

describe('[PR #32 m6] README §15 assertion 2 and 4 sub-rules over every operation', () => {
  const op = (operation: Record<string, unknown>): ContractOperation => ({
    operationId: 'seededOp',
    method: 'POST',
    path: '/x',
    fullPath: '/api/v1/x',
    operation,
  });
  const proof = (required: boolean): Record<string, unknown> => ({ name: 'X-Reauth-Proof', in: 'header', required });

  it('[assertion 2] a remaining x-permission-status is named', () => {
    expect(permissionStatusProblems(op({ 'x-permission-status': 'proposed' }))).toEqual([
      'x-permission-status "proposed" remains (every permission is decided before main)',
    ]);
    expect(permissionStatusProblems(op({}))).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['max-age without a scope', { 'x-reauth-max-age': 600 }, 'x-reauth-max-age without x-reauth-scope'],
    [
      'a scope without the proof header',
      { 'x-reauth-scope': 'org.member_invite', 'x-error-codes': ['REAUTH_REQUIRED'] },
      'x-reauth-scope without the X-Reauth-Proof header (ReauthProof or ReauthProofConditional)',
    ],
    [
      'a scope without max-age referencing the conditional proof',
      { 'x-reauth-scope': 'a.b', parameters: [proof(false)], 'x-error-codes': ['REAUTH_REQUIRED'] },
      'x-reauth-scope without x-reauth-max-age needs ReauthProof (required)',
    ],
    [
      'a max-age route referencing the required proof',
      { 'x-reauth-scope': 'a.b', 'x-reauth-max-age': 600, parameters: [proof(true)], 'x-error-codes': ['REAUTH_REQUIRED'] },
      'x-reauth-max-age needs ReauthProofConditional (not required)',
    ],
    [
      'a scope without REAUTH_REQUIRED',
      { 'x-reauth-scope': 'a.b', parameters: [proof(true)], 'x-error-codes': ['AUTH_REQUIRED'] },
      'x-reauth-scope without REAUTH_REQUIRED in x-error-codes',
    ],
  ])('[assertion 4] seeded defect: %s is named', (_label, operation, expected) => {
    expect(reauthProblems(op(operation))).toEqual([expected]);
  });

  it('[assertion 4] the two accepted shapes pass, and the whole contract has no finding of either rule', async () => {
    const codes = { 'x-error-codes': ['REAUTH_REQUIRED'] };
    expect(reauthProblems(op({ 'x-reauth-scope': 'a.b', parameters: [proof(true)], ...codes }))).toEqual([]);
    expect(reauthProblems(op({ 'x-reauth-scope': 'a.b', 'x-reauth-max-age': 600, parameters: [proof(false)], ...codes }))).toEqual([]);
    const operations = listOperations(await loadContract());
    expect(operations.filter((candidate) => candidate.operation['x-reauth-max-age'] !== undefined).length).toBeGreaterThan(0);
    expect(operations.flatMap((candidate) => [...permissionStatusProblems(candidate), ...reauthProblems(candidate)])).toEqual([]);
  });
});

describe('[D-ARCH-106 (6)] the transaction none operations are pinned', () => {
  it('pins the health operations and names a route outside the pin, or a pinned route with a transaction', () => {
    expect([...TRANSACTION_NONE_OPERATIONS].sort()).toEqual(['getLiveness', 'getReadiness']);
    const none = fixtureRoute({ operationId: 'listThings', path: '/things', handler: () => ({ status: 204 }) });
    expect(transactionProblems(none)).toEqual(['transaction none on an operation outside TRANSACTION_NONE_OPERATIONS (D-ARCH-106)']);
    const tenant = fixtureRoute({
      operationId: 'getLiveness',
      path: '/l',
      tenancy: 'guest',
      transaction: 'tenant',
      handler: () => ({ status: 204 }),
    });
    expect(transactionProblems(tenant)).toEqual(['pinned in TRANSACTION_NONE_OPERATIONS but mounted with a transaction']);
    expect(transactionProblems(fixtureRoute({ operationId: 'getReadiness', path: '/r', handler: () => ({ status: 204 }) }))).toEqual([]);
  });
});
