// defineRoute refuses incomplete or inconsistent metadata at module load (US-067, REQ-RBAC-005; TASK-020).
import { describe, expect, it } from '@jest/globals';
import Joi from 'joi';

import {
  defineRoute,
  isDefinedRoute,
  pathParameters,
  RouteDefinitionError,
  routeDefinitionProblems,
  type RouteSpec,
} from './define-route.js';
import { fixtureRoute } from './tests/fixture-route.js';

const base: RouteSpec = {
  ...fixtureRoute({
    operationId: 'getThing',
    path: '/things/:thingId',
    schema: { params: Joi.object({ thingId: Joi.string() }) },
    handler: () => ({ status: 204 }),
  }),
};
const problemsOf = (overrides: Record<string, unknown>): string[] => routeDefinitionProblems({ ...base, ...overrides });

describe('defineRoute (US-067)', () => {
  it('[AT-US-067-01] accepts a complete declaration and returns a frozen descriptor with defaults', () => {
    const route = defineRoute({
      ...base,
      permission: 'shipment:read',
      permissionJustification: undefined,
      transaction: undefined,
      tenancy: 'tenant',
      auth: 'session',
    } as unknown as RouteSpec);
    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.schema)).toBe(true);
    expect(route.transaction).toBe('tenant');
    expect(route.pathParams).toEqual(['thingId']);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['a missing permission', { permission: undefined }, 'is not in the catalogue'],
    [
      'an uncatalogued permission',
      { permission: 'shipment:fly', permissionJustification: undefined },
      'permission "shipment:fly" is not in the catalogue',
    ],
    ['[AT-US-067-03] a marker without justification', { permissionJustification: '' }, 'needs a permissionJustification'],
    [
      'a justification on a catalogued permission',
      { permission: 'shipment:read', tenancy: 'tenant', transaction: 'tenant' },
      'only allowed on a public/authenticated marker',
    ],
    ['a missing audit descriptor', { audit: undefined }, 'audit descriptor is missing'],
    [
      'an unknown audit action',
      { audit: { action: 'PURGE', entity: 'x', sensitivity: 'NORMAL', reasonRequired: false } },
      'audit action "PURGE" is unknown',
    ],
    [
      'NONE without justification',
      { audit: { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false } },
      'needs a justification',
    ],
    [
      'NONE with an entity',
      { audit: { action: 'NONE', entity: 'x', sensitivity: 'NONE', reasonRequired: false, justification: 'j' } },
      'sensitivity NONE and entity null',
    ],
    [
      'an audited action with sensitivity NONE',
      { audit: { action: 'VIEW', entity: 'x', sensitivity: 'NONE', reasonRequired: false } },
      'cannot have sensitivity NONE',
    ],
    ['a missing schema', { schema: undefined }, 'schema is missing'],
    ['a non-object schema', { schema: { query: Joi.string() } }, 'schema.query must be a Joi object schema'],
    ['an open schema', { schema: { params: Joi.object({ thingId: Joi.string() }).unknown(true) } }, 'schema.params allows unknown keys'],
    ['params keys differing from the path', { schema: {} }, 'differ from the path parameters [thingId]'],
    ['an unknown method', { method: 'trace' }, 'method "trace"'],
    ['a wildcard path', { path: '/things/*rest' }, 'are not literal or :param'],
    ['an optional group', { path: '/things{/:x}' }, 'are not literal or :param'],
    ['a relative path', { path: 'things' }, 'absolute string path'],
    ['a repeated parameter', { path: '/a/:id/b/:id', schema: { params: Joi.object({ id: Joi.string() }) } }, 'repeats a parameter name'],
    ['a non-camelCase operationId', { operationId: 'Get-thing' }, 'operationId must be camelCase'],
    ['an unknown rate-limit class', { rateLimit: 'turbo' }, 'rateLimit "turbo"'],
    ['an unknown idempotency mode', { idempotency: 'maybe' }, 'idempotency "maybe"'],
    ['an unknown tenancy', { tenancy: 'org' }, 'tenancy "org"'],
    ['an unknown authentication', { auth: 'cookie' }, 'auth "cookie"'],
    ['an invalid reauth scope', { reauth: { scope: 'Privacy' } }, 'reauth scope "Privacy"'],
    [
      'a non-positive reauth max age',
      { reauth: { scope: 'privacy.export', maxAgeSeconds: 0 } },
      'maxAgeSeconds must be a positive integer',
    ],
    [
      'an invalid deprecation',
      { deprecated: { since: '2026-02-30', sunset: '2027-01-01', link: 'https://x.invalid' } },
      'since must be an RFC 3339 date',
    ],
    ['transaction none on a tenant route', { tenancy: 'tenant', transaction: 'none' }, 'only allowed on public-tenancy routes'],
    ['an unknown transaction mode', { transaction: 'auto' }, 'transaction must be tenant or none'],
    ['an empty rateLimitRoute', { rateLimitRoute: ' ' }, 'rateLimitRoute must be non-empty'],
    ['a missing handler', { handler: undefined }, 'handler is not a function'],
  ])('refuses %s', (_label, overrides, expected) => {
    expect(problemsOf(overrides)).toContainEqual(expect.stringContaining(expected));
  });

  it('[AT-US-067-02] throws one RouteDefinitionError naming METHOD path, operationId and every problem', () => {
    const spec = { ...base, permission: undefined, audit: undefined } as unknown as RouteSpec;
    expect(() => defineRoute(spec)).toThrow(RouteDefinitionError);
    expect(() => defineRoute(spec)).toThrow(/^defineRoute GET \/things\/:thingId \(getThing\): .*catalogue.*audit descriptor is missing/);
  });

  it('lists the path parameters in order', () => {
    expect(pathParameters('/a/:first/b/:second')).toEqual(['first', 'second']);
    expect(pathParameters('/')).toEqual([]);
  });
});

describe('[PR #32 m8] [PR32-SEC-04] request schemas are closed at every depth', () => {
  const bodyProblems = (body: Joi.ObjectSchema): string[] => problemsOf({ method: 'post', schema: { ...base.schema, body } });

  it.each<[string, Joi.ObjectSchema, string]>([
    ['B1 a top-level object without keys', Joi.object(), 'schema.body declares no keys (an open object)'],
    ['B2 a nested object without keys', Joi.object({ address: Joi.object() }), 'schema.body.address declares no keys (an open object)'],
    [
      'B3 a nested object allowing unknown keys',
      Joi.object({ address: Joi.object({ city: Joi.string() }).unknown(true) }),
      'schema.body.address allows unknown keys',
    ],
    ['B4 key patterns', Joi.object({ tags: Joi.object({}).pattern(/^x/, Joi.string()) }), 'schema.body.tags has key patterns'],
    [
      'B5 array items that are open objects',
      Joi.object({ items: Joi.array().items(Joi.object()) }),
      'schema.body.items[] declares no keys (an open object)',
    ],
    ['B6 Joi.any() without an allow-list', Joi.object({ extra: Joi.any() }), 'schema.body.extra is Joi.any() without an allow-list'],
    ['B7 an array without items', Joi.object({ items: Joi.array() }), 'schema.body.items declares no items'],
    [
      'an open object inside an alternative',
      Joi.object({ v: Joi.alternatives().try(Joi.string(), Joi.object()) }),
      'schema.body.v declares no keys (an open object)',
    ],
  ])('refuses %s', (_label, body, expected) => {
    expect(bodyProblems(body)).toContain(expected);
  });

  it('accepts closed nested objects, arrays of closed items, an empty-keys object and an allow-listed any', () => {
    const body = Joi.object({
      address: Joi.object({ city: Joi.string(), lines: Joi.array().items(Joi.string()) }),
      parcels: Joi.array().items(Joi.object({ weight: Joi.number() })),
      none: Joi.object({}),
      mode: Joi.any().valid('a', 'b'),
      v: Joi.alternatives().try(Joi.string(), Joi.object({ code: Joi.string() })),
    });
    expect(bodyProblems(body)).toEqual([]);
  });

  it('refuses a schema nested deeper than the walk bound instead of walking it', () => {
    let schema: Joi.ObjectSchema = Joi.object({ leaf: Joi.string() });
    for (let level = 0; level < 40; level += 1) schema = Joi.object({ child: schema });
    expect(bodyProblems(schema).some((problem) => problem.includes('nested deeper than 32 levels'))).toBe(true);
  });
});

describe('[D-ARCH-106 (6)] [PR32-SEC-05 (d)] transaction none is the only T-83 hatch and never audits', () => {
  const audited = { action: 'VIEW', entity: 'shipment', sensitivity: 'NORMAL', reasonRequired: false };

  it('refuses transaction none with an audited action', () => {
    expect(problemsOf({ transaction: 'none', audit: audited })).toContain('transaction none is only allowed with audit action NONE');
  });

  it('accepts the audited action inside a tenant transaction', () => {
    expect(problemsOf({ transaction: 'tenant', audit: audited })).not.toContain('transaction none is only allowed with audit action NONE');
  });
});

describe('[PR #32 m2] [PR32-SEC-05 (a)] descriptors are branded by defineRoute', () => {
  it('brands what defineRoute returns and nothing else', () => {
    const route = defineRoute(base);
    expect(isDefinedRoute(route)).toBe(true);
    expect(isDefinedRoute({ ...route })).toBe(false);
    expect(isDefinedRoute({ ...route, transaction: 'none' })).toBe(false);
    expect(isDefinedRoute(undefined)).toBe(false);
    expect(isDefinedRoute('route')).toBe(false);
  });
});

describe('[D-ARCH-107] route authentication set and permissionAuthenticated', () => {
  const dual = { auth: ['session', 'anonymous'], permissionAuthenticated: 'quote:create' };

  it('[D-ARCH-107] a scalar kind is sugar for a set of one; a set is normalised to the frozen canonical accepted set', () => {
    const scalar = defineRoute(base);
    expect(scalar.auth).toEqual(['anonymous']);
    expect(Object.isFrozen(scalar.auth)).toBe(true);
    const set = defineRoute({ ...base, ...dual } as RouteSpec);
    expect(set.auth).toEqual(['anonymous', 'session']);
    expect(Object.isFrozen(set.auth)).toBe(true);
    expect(set.permissionAuthenticated).toBe('quote:create');
    expect(defineRoute({ ...base, auth: ['quote-token', 'session'], permissionAuthenticated: 'quote:read' }).auth).toEqual([
      'session',
      'quote-token',
    ]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['an unknown kind inside a set', { auth: ['session', 'cookie'] }, 'auth "cookie" is unknown'],
    ['a missing auth', { auth: undefined }, 'auth "undefined" is unknown'],
    ['an unlisted combination', { auth: ['anonymous', 'signature'] }, 'auth [anonymous, signature] is not an accepted set'],
    ['a lone quote-token', { auth: 'quote-token' }, 'auth [quote-token] is not an accepted set'],
    ['a repeated kind', { auth: ['session', 'session'] }, 'auth [session, session] is not an accepted set'],
    ['the empty set', { auth: [] }, 'auth [] is not an accepted set'],
    [
      '[PR #32 m7] auth anonymous with a catalogued permission',
      { permission: 'shipment:read', permissionJustification: undefined },
      '"shipment:read" needs auth [session], not [anonymous]',
    ],
    [
      '[PR #32 m7] auth anonymous with the authenticated marker',
      { permission: 'authenticated' },
      '"authenticated" needs auth [session], not [anonymous]',
    ],
    ['a dual-mode route without permissionAuthenticated', { auth: dual.auth }, 'needs permissionAuthenticated'],
    ['permissionAuthenticated on a non-dual route', { permissionAuthenticated: 'quote:read' }, 'only allowed on a dual-mode route'],
    ['an uncatalogued permissionAuthenticated', { ...dual, permissionAuthenticated: 'quote:fly' }, '"quote:fly" is not in the catalogue'],
    [
      'a self-service permissionAuthenticated',
      { ...dual, permissionAuthenticated: 'session:manage' },
      'neither self-service nor signature-only',
    ],
    [
      'a signature-only permissionAuthenticated',
      { ...dual, permissionAuthenticated: 'webhook:stripe:receive' },
      'neither self-service nor signature-only',
    ],
    ['an unsafe refresh-cookie route without csrf', { auth: 'refresh-cookie', method: 'post' }, 'needs csrf: true'],
  ])('[D-ARCH-107] refuses %s', (_label, overrides, expected) => {
    expect(problemsOf(overrides)).toContainEqual(expect.stringContaining(expected));
    expect(() => defineRoute({ ...base, ...overrides })).toThrow(RouteDefinitionError);
  });

  it('[D-ARCH-107] accepts the refresh-cookie routes of the contract (GET, and POST with csrf)', () => {
    expect(problemsOf({ auth: 'refresh-cookie' })).toEqual([]);
    expect(problemsOf({ auth: 'refresh-cookie', method: 'post', csrf: true })).toEqual([]);
  });
});
