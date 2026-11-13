// Route permission and binding checks (REQ-RBAC-005, PR8-SEC-05 (a)-(d), ADR-0008 am. 3 item 3 and am. 4, D-ARCH-069,
// D-ARCH-107): one negative fixture per rule plus the positive controls; the route-metadata test runs the same
// functions over the mounted routes and the whole contract.
import { describe, expect, it } from '@jest/globals';

import {
  assertRoutePermissions,
  type BoundRoute,
  findRouteAuthSet,
  findRouteBindingViolations,
  findUnknownRoutePermissions,
  formatRouteAuth,
  isDualModeRoute,
  isRouteAuth,
  MOCK_GATEWAY_PERMISSION,
  permissionAuthenticatedProblems,
  ROUTE_AUTH_SETS,
  type RouteAuth,
  UnknownRoutePermissionError,
} from './routes.js';

const route = (
  permission: string,
  tenancy: BoundRoute['tenancy'],
  auth: RouteAuth | readonly RouteAuth[],
  path = '/api/v1/x',
  extra: Partial<BoundRoute> = {},
): BoundRoute => ({
  method: 'get',
  path,
  permission,
  tenancy,
  auth: typeof auth === 'string' ? [auth] : auth,
  ...extra,
});

const dev = { production: false };
const rulesOf = (routes: readonly BoundRoute[], env = dev): string[] => findRouteBindingViolations(routes, env).map((v) => v.rule);

describe('route permissions are catalogued or markers (REQ-RBAC-005)', () => {
  it('accepts catalogued permissions and the public/authenticated markers', () => {
    const routes = [
      route('quote:read', 'tenant', 'session'),
      route('public', 'public', 'anonymous'),
      route('authenticated', 'user', 'session'),
    ];
    expect(findUnknownRoutePermissions(routes)).toEqual([]);
    expect(() => assertRoutePermissions(routes)).not.toThrow();
  });

  it('names every offending METHOD path', () => {
    const routes = [route('shipment:fly', 'tenant', 'session', '/api/v1/a'), route('quote:read', 'tenant', 'session')];
    expect(() => assertRoutePermissions(routes)).toThrow(UnknownRoutePermissionError);
    expect(() => assertRoutePermissions(routes)).toThrow('GET /api/v1/a -> "shipment:fly"');
  });
});

describe('[D-ARCH-107] route authentication sets', () => {
  it('[D-ARCH-107] the closed list is exactly the six sets, each frozen and in canonical order', () => {
    expect(ROUTE_AUTH_SETS.map(formatRouteAuth)).toEqual([
      '[anonymous]',
      '[session]',
      '[refresh-cookie]',
      '[signature]',
      '[anonymous, session]',
      '[session, quote-token]',
    ]);
    expect(Object.isFrozen(ROUTE_AUTH_SETS)).toBe(true);
    expect(ROUTE_AUTH_SETS.every((set) => Object.isFrozen(set))).toBe(true);
  });

  it('[D-ARCH-107] findRouteAuthSet matches order-insensitively and returns the canonical set', () => {
    expect(findRouteAuthSet(['quote-token', 'session'])).toBe(ROUTE_AUTH_SETS[5]);
    expect(findRouteAuthSet(['session', 'anonymous'])).toEqual(['anonymous', 'session']);
    expect(findRouteAuthSet(['signature'])).toEqual(['signature']);
  });

  it.each<[string, readonly unknown[]]>([
    ['an unlisted combination', ['anonymous', 'signature']],
    ['quote-token alone', ['quote-token']],
    ['a repeated kind', ['session', 'session']],
    ['an unknown kind', ['cookie']],
    ['two unknown kinds', ['zeta', 'alpha']],
    ['the empty set', []],
  ])('[D-ARCH-107] findRouteAuthSet refuses %s', (_label, kinds) => {
    expect(findRouteAuthSet(kinds)).toBeUndefined();
  });

  it('[D-ARCH-107] isRouteAuth and isDualModeRoute', () => {
    expect(isRouteAuth('refresh-cookie')).toBe(true);
    expect(isRouteAuth('bearer')).toBe(false);
    expect(isDualModeRoute('public', ['session', 'anonymous'])).toBe(true);
    expect(isDualModeRoute('public', ['quote-token', 'session'])).toBe(true);
    expect(isDualModeRoute('public', ['session'])).toBe(false);
    expect(isDualModeRoute('quote:create', ['anonymous', 'session'])).toBe(false);
  });

  it('[D-ARCH-107] permissionAuthenticatedProblems accepts a catalogued tenant permission on a dual-mode route only', () => {
    expect(permissionAuthenticatedProblems('public', ['anonymous', 'session'], 'quote:create')).toEqual([]);
    expect(permissionAuthenticatedProblems('public', ['anonymous'], undefined)).toEqual([]);
    expect(permissionAuthenticatedProblems('public', ['anonymous', 'session'], 42)).toEqual([
      'permissionAuthenticated number is not in the catalogue',
    ]);
  });
});

describe('PR8-SEC-05 and D-ARCH-107 route bindings (findRouteBindingViolations)', () => {
  it('the shipped bindings of the contract shapes pass: user self-service, operator any_org, signature webhooks, refresh cookie, dual mode', () => {
    const routes = [
      route('session:manage', 'user', 'session', '/api/v1/me/sessions'),
      route('shipment:read:any_org', 'operator-cross-tenant', 'session', '/api/v1/admin/shipments'),
      route('audit:read', 'operator-cross-tenant', 'session', '/api/v1/audit/entries'),
      route('webhook:stripe:receive', 'public', 'signature', '/api/v1/webhooks/stripe'),
      route(MOCK_GATEWAY_PERMISSION, 'public', 'signature', '/api/v1/webhooks/mock-gateway'),
      route('quote:read', 'tenant', 'session'),
      route('public', 'public', 'anonymous'),
      route('public', 'public', 'refresh-cookie', '/api/v1/auth/csrf'),
      { ...route('public', 'public', 'refresh-cookie', '/api/v1/auth/refresh'), method: 'post', csrf: true },
      route('public', 'guest', ['quote-token', 'session'], '/api/v1/quotes/:quoteId', { permissionAuthenticated: 'quote:read' }),
      {
        ...route('public', 'guest', ['anonymous', 'session'], '/api/v1/quotes', { permissionAuthenticated: 'quote:create' }),
        method: 'post',
      },
    ];
    expect(findRouteBindingViolations(routes, dev)).toEqual([]);
  });

  it('[PR8-SEC-05 (a)] a self-service permission on a tenant route is SELF_SERVICE_TENANCY', () => {
    const violations = findRouteBindingViolations(
      [route('session:manage', 'tenant', 'session', '/api/v1/organisations/:orgId/sessions')],
      dev,
    );
    expect(violations).toEqual([
      {
        rule: 'SELF_SERVICE_TENANCY',
        route: 'GET /api/v1/organisations/:orgId/sessions',
        message: expect.stringContaining('GET /api/v1/organisations/:orgId/sessions: self-service permission "session:manage"'),
      },
    ]);
  });

  it('[PR8-SEC-05 (b)] operator-cross-tenant with a non-operator permission, and :any_org on a tenant route, are OPERATOR_CROSS_TENANT', () => {
    expect(rulesOf([route('shipment:read', 'operator-cross-tenant', 'session')])).toEqual(['OPERATOR_CROSS_TENANT']);
    expect(rulesOf([route('shipment:read:any_org', 'tenant', 'session')])).toEqual(['OPERATOR_CROSS_TENANT']);
  });

  it('[PR8-SEC-05 (c), D-TASK020-03] a signature-only permission off [signature], and a session permission or authenticated on a signature route, are SIGNATURE_AUTH', () => {
    expect(rulesOf([route('webhook:stripe:receive', 'public', 'session')])).toEqual(['SIGNATURE_AUTH']);
    expect(rulesOf([route('webhook:stripe:receive', 'public', 'anonymous')])).toEqual(['SIGNATURE_AUTH']);
    expect(rulesOf([route('webhook:stripe:receive', 'guest', ['session', 'quote-token'])])).toEqual(['SIGNATURE_AUTH']);
    expect(rulesOf([route('authenticated', 'public', 'signature')])).toEqual(['SIGNATURE_AUTH']);
    // receiveCarrierPush: public marker, carrier signature (D-TASK020-03).
    expect(rulesOf([route('public', 'public', 'signature')])).toEqual([]);
    expect(rulesOf([route('quote:read', 'tenant', 'signature')])).toEqual(['SIGNATURE_AUTH']);
  });

  it('[PR8-SEC-05 (d)] webhook:mock_gateway:receive mounted in production is MOCK_WEBHOOK_IN_PRODUCTION', () => {
    const mock = route(MOCK_GATEWAY_PERMISSION, 'public', 'signature', '/api/v1/webhooks/mock-gateway');
    expect(rulesOf([mock], { production: true })).toEqual(['MOCK_WEBHOOK_IN_PRODUCTION']);
    expect(rulesOf([mock], { production: false })).toEqual([]);
  });

  it('[D-ARCH-107 AUTH_SET] an unlisted combination, a lone quote-token and an unknown kind are AUTH_SET', () => {
    const violations = findRouteBindingViolations([route('public', 'public', ['anonymous', 'signature'], '/api/v1/odd')], dev);
    expect(violations).toEqual([
      {
        rule: 'AUTH_SET',
        route: 'GET /api/v1/odd',
        message: expect.stringContaining('GET /api/v1/odd: auth [anonymous, signature] is not an accepted set'),
      },
    ]);
    expect(rulesOf([route('public', 'guest', 'quote-token')])).toEqual(['AUTH_SET']);
    const unknownKind: unknown = ['cookie'];
    expect(rulesOf([route('public', 'public', unknownKind as readonly RouteAuth[])])).toEqual(['AUTH_SET']);
  });

  it('[D-ARCH-107 PERMISSION_AUTH, PR #32 m7] a catalogued or authenticated permission off [session] is PERMISSION_AUTH', () => {
    // m7: `auth: 'anonymous'` with a permission other than `public` can never succeed.
    const violations = findRouteBindingViolations([route('quote:read', 'tenant', 'anonymous', '/api/v1/quotes')], dev);
    expect(violations).toEqual([
      {
        rule: 'PERMISSION_AUTH',
        route: 'GET /api/v1/quotes',
        message: 'GET /api/v1/quotes: "quote:read" needs auth [session], not [anonymous]',
      },
    ]);
    expect(rulesOf([route('authenticated', 'user', 'anonymous')])).toEqual(['PERMISSION_AUTH']);
    expect(rulesOf([route('authenticated', 'public', 'refresh-cookie')])).toEqual(['PERMISSION_AUTH']);
    expect(rulesOf([route('quote:create', 'tenant', ['anonymous', 'session'])])).toEqual(['PERMISSION_AUTH']);
    expect(rulesOf([route('quote:read', 'tenant', ['session', 'quote-token'])])).toEqual(['PERMISSION_AUTH']);
  });

  it('[D-ARCH-107 DUAL_MODE] permissionAuthenticated missing on a dual-mode route, present elsewhere, or not a tenant permission is DUAL_MODE', () => {
    const missing = findRouteBindingViolations([route('public', 'guest', ['anonymous', 'session'], '/api/v1/quotes')], dev);
    expect(missing).toEqual([
      {
        rule: 'DUAL_MODE',
        route: 'GET /api/v1/quotes',
        message: 'GET /api/v1/quotes: dual-mode route ("public", [anonymous, session]) needs permissionAuthenticated',
      },
    ]);
    expect(rulesOf([route('public', 'guest', ['session', 'quote-token'])])).toEqual(['DUAL_MODE']);
    expect(rulesOf([route('public', 'public', 'session', '/api/v1/x', { permissionAuthenticated: 'quote:read' })])).toEqual(['DUAL_MODE']);
    expect(rulesOf([route('quote:read', 'tenant', 'session', '/api/v1/x', { permissionAuthenticated: 'quote:read' })])).toEqual([
      'DUAL_MODE',
    ]);
    const dual = (permissionAuthenticated: string): BoundRoute =>
      route('public', 'guest', ['anonymous', 'session'], '/api/v1/quotes', { permissionAuthenticated });
    expect(rulesOf([dual('shipment:fly')])).toEqual(['DUAL_MODE']);
    expect(findRouteBindingViolations([dual('session:manage')], dev)[0]?.message).toContain('neither self-service nor signature-only');
    expect(rulesOf([dual('webhook:stripe:receive')])).toEqual(['DUAL_MODE']);
  });

  it('[D-ARCH-107 CSRF_COOKIE] a non-GET refresh-cookie route without csrf: true is CSRF_COOKIE', () => {
    const post = { ...route('public', 'public', 'refresh-cookie', '/api/v1/auth/logout'), method: 'post' };
    expect(findRouteBindingViolations([post], dev)).toEqual([
      {
        rule: 'CSRF_COOKIE',
        route: 'POST /api/v1/auth/logout',
        message: 'POST /api/v1/auth/logout: a POST route accepting the refresh cookie needs csrf: true',
      },
    ]);
    expect(rulesOf([{ ...post, csrf: false }])).toEqual(['CSRF_COOKIE']);
    expect(rulesOf([{ ...post, csrf: true }])).toEqual([]);
    expect(rulesOf([{ ...post, method: 'GET' }])).toEqual([]);
  });

  it('reports every violated rule of one route, upper-casing the method', () => {
    const violations = findRouteBindingViolations([{ ...route('webhook:mock_gateway:receive', 'user', 'session'), method: 'post' }], {
      production: true,
    });
    expect(violations.map((v) => v.rule)).toEqual(['SIGNATURE_AUTH', 'MOCK_WEBHOOK_IN_PRODUCTION']);
    expect(violations.every((v) => v.route === 'POST /api/v1/x')).toBe(true);
  });
});
