// defineRoute refuses incomplete or inconsistent metadata at module load (US-067, REQ-RBAC-005; TASK-020).
import { describe, expect, it } from '@jest/globals';
import Joi from 'joi';

import { CREDENTIAL_HEADER_NAMES } from '@platform/shared';

import {
  defineRoute,
  extensionProblems,
  isDefinedRoute,
  pathParameters,
  RouteDefinitionError,
  routeDefinitionProblems,
  type RouteSpec,
} from './define-route.js';
import { prepareSchemas, validateRequest } from '../validate/validate.js';
import { fixtureRoute } from './tests/fixture-route.js';

const base = {
  ...fixtureRoute({
    operationId: 'getThing',
    path: '/things/:thingId',
    schema: { params: Joi.object({ thingId: Joi.string() }) },
    handler: () => ({ status: 204 }),
  }),
} as unknown as RouteSpec;
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

describe('[R2-m1] [PR32-SEC-13] schema-level preferences, Joi.link and Joi.extend cannot re-open a request schema', () => {
  // Joi.extend returns an untyped root; each probe names only the factory it calls.
  const extended: unknown = Joi.extend({ type: 'loose', base: Joi.object().unknown(true) });
  const loose = extended as { loose: () => Joi.ObjectSchema; string: () => Joi.StringSchema };
  // An extension that keeps the built-in name and hides its behaviour from describe(): it adds a field after validation.
  const sneakyRoot: unknown = Joi.extend({
    type: 'object',
    base: Joi.object(),
    validate: (value: Record<string, unknown>) => ({ value: { ...value, role: 'admin' } }),
  });
  const sneaky = sneakyRoot as { object: (keys: Joi.PartialSchemaMap) => Joi.ObjectSchema };
  const top = { name: 'n', role: 'admin' };
  const nested = { name: 'x', address: { city: 'c', role: 'admin' } };
  const city = Joi.object({ city: Joi.string() });
  // [label, body schema, probe body, where the smuggled role lands, expected problem]
  const shapes: [string, Joi.ObjectSchema, Record<string, unknown>, 'top' | 'address', string][] = [
    [
      'prefs({ allowUnknown: true }) at the top level',
      Joi.object({ name: Joi.string() }).prefs({ allowUnknown: true }),
      top,
      'top',
      'schema.body re-opens unknown keys with prefs/options allowUnknown',
    ],
    [
      'options({ allowUnknown: true }) on a nested object',
      Joi.object({ name: Joi.string(), address: city.options({ allowUnknown: true }) }),
      nested,
      'address',
      'schema.body.address re-opens unknown keys with prefs/options allowUnknown',
    ],
    [
      'prefs({ allowUnknown: true }) inside a when branch',
      Joi.object({ name: Joi.string(), address: city.when('name', { is: 'x', then: city.prefs({ allowUnknown: true }) }) }),
      nested,
      'address',
      'schema.body.address re-opens unknown keys with prefs/options allowUnknown',
    ],
    [
      'a Joi.link to a shared open object',
      Joi.object({ name: Joi.string(), address: Joi.link('#open') }).shared(Joi.object().unknown(true).id('open')),
      nested,
      'address',
      'schema.body.address is a Joi.link (indirection is not walked; declare the schema inline)',
    ],
    [
      'a Joi.extend type based on an open object',
      Joi.object({ name: Joi.string(), address: loose.loose() }),
      nested,
      'address',
      'schema.body.address has the non-built-in Joi type "loose" (Joi.extend types are not allow-listed)',
    ],
    [
      'a Joi.extend type that reuses the built-in name object',
      Joi.object({ name: Joi.string(), address: sneaky.object({ city: Joi.string() }) }),
      { name: 'x', address: { city: 'c' } },
      'address',
      'schema.body uses the Joi extension type "object" (Joi.extend types are not allow-listed)',
    ],
  ];

  it.each(shapes)('refuses %s', (_label, body, probe, lands, expected) => {
    // Without defineRoute's walk the validate slot hands an extra `role` to the handler (the open form is real) ...
    const input = validateRequest(prepareSchemas({ body }), { params: {}, query: {}, body: probe, headers: {} });
    const received: unknown = lands === 'top' ? input.body : input.body?.['address'];
    expect(received).toEqual(expect.objectContaining({ role: 'admin' }));
    // ... and defineRoute refuses the declaration, so no handler is ever mounted behind it.
    const spec = { ...base, method: 'post' as const, schema: { ...base.schema, body } };
    expect(routeDefinitionProblems(spec)).toContain(expected);
    expect(() => defineRoute(spec)).toThrow(RouteDefinitionError);
  });

  it('accepts harmless schema-level preferences and built-in types from an extended root', () => {
    const body = Joi.object({
      name: loose.string(),
      address: Joi.object({ city: Joi.string() }).prefs({ allowUnknown: false, convert: true }),
      tags: Joi.object({ a: Joi.string() }).prefs({ stripUnknown: true }),
    });
    expect(problemsOf({ method: 'post', schema: { ...base.schema, body } })).toEqual([]);
  });

  // PR32-SEC-17 (code review R3-n1): the three defensive branches of the walk are what a Joi upgrade leans on; each test
  // fails when its branch is deleted. Tampered instances stand in for changed Joi internals; they break Joi's own
  // describe(), so the walk is exercised directly.
  const tampered = (property: string, value: unknown, schema: Joi.Schema = Joi.object({ name: Joi.string() })): Joi.Schema =>
    Object.defineProperty<Joi.Schema>(schema, property, { value, configurable: true });

  it('[PR32-SEC-17] fails closed on a schema without $_terms (its children could not be inspected)', () => {
    for (const terms of [undefined, null, 'renamed']) {
      expect(extensionProblems(tampered('$_terms', terms), 'schema.body')).toEqual([
        'schema.body has a Joi schema without $_terms; its children cannot be inspected (Joi internals changed)',
      ]);
    }
    // A nested schema without $_terms is refused as well (the walk reaches it through its parent's terms).
    const parent = Joi.object({ name: Joi.string(), address: tampered('$_terms', undefined, Joi.object({ city: Joi.string() })) });
    expect(extensionProblems(parent, 'schema.body')).toContainEqual(expect.stringContaining('without $_terms'));
    expect(extensionProblems(Joi.object({ name: Joi.string() }), 'schema.body')).toEqual([]);
  });

  it('[PR32-SEC-17] refuses a schema without _definition even when its type has no built-in definition either', () => {
    // Without the `definition === undefined` clause, undefined === BUILT_IN_DEFINITIONS.get('custom') would pass it.
    const schema = tampered('type', 'custom', tampered('_definition', undefined));
    expect(extensionProblems(schema, 'schema.body')).toContain(
      'schema.body uses the Joi extension type "custom" (Joi.extend types are not allow-listed)',
    );
  });

  it('[PR32-SEC-17] bounds the $_terms walk: a term chain deeper than the bound is refused, not followed', () => {
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 200; level += 1) deep = { next: deep };
    expect(extensionProblems(tampered('$_terms', { keys: null, deep }), 'schema.body')).toEqual([
      'schema.body is nested too deeply to inspect',
    ]);
  });

  it('[PR32-SEC-17] visits each $_terms object once: a cycle among the terms is accepted, not reported as too deep', () => {
    const cycle: Record<string, unknown> = { keys: null };
    cycle['self'] = cycle;
    expect(extensionProblems(tampered('$_terms', cycle), 'schema.body')).toEqual([]);
  });
});

describe('[R2-n1] [PR32-SEC-15] the descriptor is deep-frozen', () => {
  it('freezes audit (with additional), reauth and deprecated as copies', () => {
    const audit = {
      action: 'UPDATE',
      entity: 'quote',
      sensitivity: 'NORMAL',
      reasonRequired: false,
      additional: [{ action: 'CREATE', entity: 'quote_share', sensitivity: 'NORMAL', when: 'shared' }],
    };
    const reauth = { scope: 'account.delete', maxAgeSeconds: 300 };
    const deprecated = { since: '2026-01-01', sunset: '2027-01-01', link: 'https://docs.example.test/migrate' };
    const route = defineRoute({
      ...base,
      permission: 'shipment:read',
      permissionJustification: undefined,
      tenancy: 'tenant',
      auth: 'session',
      transaction: 'tenant',
      audit,
      reauth,
      deprecated,
    } as unknown as RouteSpec);
    expect(Object.isFrozen(route.audit)).toBe(true);
    expect(Object.isFrozen(route.audit.additional)).toBe(true);
    expect(Object.isFrozen(route.audit.additional?.[0])).toBe(true);
    expect(Object.isFrozen(route.reauth)).toBe(true);
    expect(Object.isFrozen(route.deprecated)).toBe(true);
    expect(() => {
      (route.audit as { action: string }).action = 'NONE';
    }).toThrow(TypeError);
    // A later change to the caller's objects does not reach the checked descriptor.
    audit.action = 'NONE';
    reauth.scope = 'x';
    expect(route.audit.action).toBe('UPDATE');
    expect(route.reauth?.scope).toBe('account.delete');
    expect(route).toEqual(expect.objectContaining({ deprecated }));
  });

  it('adds no reauth or deprecated key when the declaration has none', () => {
    const route = defineRoute(base);
    expect('reauth' in route).toBe(false);
    expect('deprecated' in route).toBe(false);
  });
});

describe('[D-ARCH-113] [PR38-SEC-03] schema.headers never names a credential header', () => {
  const credentialProblems = (overrides: Record<string, unknown>): string[] =>
    problemsOf(overrides).filter((problem) => problem.includes('credential header'));
  const headers = (name: string): Record<string, unknown> => ({
    schema: { ...base.schema, headers: Joi.object({ [name]: Joi.string() }) },
  });
  const SESSION = { auth: 'session', permission: 'authenticated', permissionJustification: 'Own account.', tenancy: 'user' };

  it.each([...CREDENTIAL_HEADER_NAMES, 'Authorization', 'COOKIE', 'X-Csrf-Token', 'Stripe-Signature'])(
    '[D-ARCH-113] refuses "%s" in schema.headers at module load, naming D-ARCH-113',
    (name) => {
      expect(credentialProblems(headers(name))).toEqual([expect.stringContaining(`credential header "${name}"`)]);
      expect(credentialProblems(headers(name))[0]).toContain('D-ARCH-113');
      expect(() => defineRoute({ ...base, ...headers(name) })).toThrow(RouteDefinitionError);
    },
  );

  it('[D-ARCH-113] accepts ordinary headers (accept-language, x-mock-scenario)', () => {
    expect(problemsOf(headers('accept-language'))).toEqual([]);
    expect(problemsOf(headers('x-mock-scenario'))).toEqual([]);
  });

  it('[D-ARCH-113] x-quote-token is accepted only as the companion of exactly [session] (ADR-0008 am. 5 item 1)', () => {
    expect(credentialProblems({ ...SESSION, ...headers('x-quote-token') })).toEqual([]);
    expect(credentialProblems({ ...SESSION, auth: ['session'], ...headers('X-Quote-Token') })).toEqual([]);
    for (const auth of [['anonymous'], ['anonymous', 'session'], ['session', 'quote-token'], ['refresh-cookie'], ['signature']]) {
      expect([auth, credentialProblems({ ...SESSION, auth, ...headers('x-quote-token') })]).toEqual([
        auth,
        [expect.stringContaining('credential header "x-quote-token"')],
      ]);
    }
    // The carve-out is x-quote-token only: [session] still refuses every other credential header.
    expect(credentialProblems({ ...SESSION, ...headers('authorization') })).toHaveLength(1);
  });

  it('[D-ARCH-113] the PR #38 P3 probe: three [anonymous] routes declaring cookie, authorization and x-quote-token throw', () => {
    for (const name of ['cookie', 'authorization', 'x-quote-token']) {
      expect(() =>
        fixtureRoute({
          operationId: 'probeCredential',
          path: '/probe',
          schema: { headers: Joi.object({ [name]: Joi.string() }) },
          handler: () => ({ status: 204 }),
        }),
      ).toThrow(/credential header .*D-ARCH-113/);
    }
  });
});

describe('[D-ARCH-106 (4)] route I/O phases at module load (ADR-0003 amendment 2026-11-13)', () => {
  const TENANT = { transaction: 'tenant', tenancy: 'guest' };
  const load = (): { id: string } => ({ id: 'a' });
  const call = (): string => 'key';

  it('accepts load + call + handler + afterCommit on a tenant route and keeps the phases on the frozen descriptor', () => {
    const afterCommit = (): void => undefined;
    const route = defineRoute({ ...base, ...TENANT, load, call, afterCommit } as unknown as RouteSpec);
    expect([route.load, route.call, route.afterCommit]).toEqual([load, call, afterCommit]);
    expect(Object.isFrozen(route)).toBe(true);
    expect(problemsOf({ ...TENANT, call })).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['load without call', { ...TENANT, load }, 'load without call is refused: the handler transaction can read (D-ARCH-106)'],
    ['load on transaction none', { load, call }, 'transaction none allows only handler and afterCommit (D-ARCH-106)'],
    ['call on transaction none', { call }, 'transaction none allows only handler and afterCommit (D-ARCH-106)'],
    ['a non-function load', { ...TENANT, load: 'x', call }, 'load is not a function'],
    ['a non-function call', { ...TENANT, call: {} }, 'call is not a function'],
    ['a non-function afterCommit', { afterCommit: 1 }, 'afterCommit is not a function'],
    ['a missing handler', { handler: undefined }, 'handler is not a function'],
  ])('refuses %s', (_label, overrides, expected) => {
    expect(problemsOf(overrides)).toContain(expected);
    expect(() => defineRoute({ ...base, ...overrides })).toThrow(RouteDefinitionError);
  });

  it('allows afterCommit on transaction none (health-like routes)', () => {
    expect(problemsOf({ afterCommit: () => undefined })).toEqual([]);
  });

  it('infers the loaded and called types from load and call (compile-time check)', () => {
    const route = fixtureRoute({
      operationId: 'typedPhases',
      path: '/typed',
      transaction: 'tenant',
      tenancy: 'guest',
      load: () => ({ orderId: 'o-1', attempt: 2 }),
      call: (ctx, loaded) => ({ key: `auth:${loaded.orderId}:${String(loaded.attempt)}`, aborted: ctx.signal.aborted }),
      handler: (_ctx, { loaded, called }) => ({ status: 200, body: { id: loaded.orderId, key: called.key } }),
    });
    expect(route.operationId).toBe('typedPhases');
  });
});

describe('[D-ARCH-113 (4)] [PR38-SEC-04] the $_terms walk fails closed on containers it cannot inspect', () => {
  const extendedRoot: unknown = Joi.extend({ type: 'shout', base: Joi.string() });
  const custom = (extendedRoot as { shout: () => Joi.Schema }).shout();
  const withTerms = (terms: unknown): Joi.Schema =>
    Object.defineProperty<Joi.Schema>(Joi.object({ name: Joi.string() }), '$_terms', { value: terms, configurable: true });
  /** The real `$_terms` of a parent holding the extension type, copied into other container shapes. */
  const parent = Joi.object({ name: Joi.string(), nested: custom });
  const realTerms = (parent as unknown as { $_terms: Record<string, unknown> }).$_terms;
  const EXTENSION = 'schema.body uses the Joi extension type "shout" (Joi.extend types are not allow-listed)';
  const CONTAINER = 'schema.body has a Joi schema whose $_terms cannot be inspected (Joi internals changed)';
  const NESTED = 'schema.body holds a non-plain object inside $_terms that cannot be inspected (Joi internals changed)';

  it('control: the untampered parent (and a plain copy of its terms) reports the nested extension type', () => {
    expect(extensionProblems(parent, 'schema.body')).toEqual([EXTENSION]);
    expect(extensionProblems(withTerms({ ...realTerms }), 'schema.body')).toEqual([EXTENSION]);
  });

  class Holder {
    constructor(readonly keys: unknown) {}
  }

  it.each<[string, unknown]>([
    ['a null-prototype copy', Object.assign(Object.create(null) as object, realTerms)],
    ['a Map', new Map(Object.entries(realTerms))],
    ['a class instance', new Holder(realTerms['keys'])],
  ])('reports a $_terms that is %s and does not walk it', (_label, terms) => {
    expect(extensionProblems(withTerms(terms), 'schema.body')).toEqual([CONTAINER]);
  });

  it.each<[string, unknown]>([
    ['a Map', new Map([['schema', custom]])],
    ['a class instance', new Holder(custom)],
    ['a null-prototype object', Object.assign(Object.create(null) as object, { schema: custom })],
  ])('reports %s met inside $_terms instead of skipping it', (_label, inner) => {
    expect(extensionProblems(withTerms({ keys: null, inner }), 'schema.body')).toEqual([NESTED]);
  });

  it('keeps RegExp, Joi references and Joi object dependencies legal (and walks the dependencies)', () => {
    const schema = Joi.object({
      a: Joi.string().pattern(/^[a-z]+$/),
      b: Joi.number().min(Joi.ref('c')),
      c: Joi.number(),
      d: Joi.alternatives().conditional('c', { is: 1, then: Joi.string(), otherwise: Joi.number() }),
    })
      .with('a', 'b')
      .xor('c', 'd')
      .pattern(/^x-/, Joi.string());
    expect(extensionProblems(schema, 'schema.body')).toEqual([]);
  });
});
