// defineRoute refuses incomplete or inconsistent metadata at module load (US-067, REQ-RBAC-005; TASK-020).
import { describe, expect, it } from '@jest/globals';
import Joi from 'joi';

import { defineRoute, pathParameters, RouteDefinitionError, routeDefinitionProblems, type RouteSpec } from './define-route.js';
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
