// Route permission and binding checks (REQ-RBAC-005, PR8-SEC-05 (a)-(d), ADR-0008 am. 3 item 3, D-ARCH-069): one
// negative fixture per rule plus the positive controls; the route-metadata test runs the same functions over the
// mounted routes.
import { describe, expect, it } from '@jest/globals';

import {
  assertRoutePermissions,
  type BoundRoute,
  findRouteBindingViolations,
  findUnknownRoutePermissions,
  MOCK_GATEWAY_PERMISSION,
  UnknownRoutePermissionError,
} from './routes.js';

const route = (permission: string, tenancy: BoundRoute['tenancy'], auth: BoundRoute['auth'], path = '/api/v1/x'): BoundRoute => ({
  method: 'get',
  path,
  permission,
  tenancy,
  auth,
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

describe('PR8-SEC-05 route bindings (findRouteBindingViolations)', () => {
  it('the shipped bindings of the contract shapes pass: user self-service, operator any_org, signature webhook, tenant read', () => {
    const routes = [
      route('session:manage', 'user', 'session', '/api/v1/me/sessions'),
      route('shipment:read:any_org', 'operator-cross-tenant', 'session', '/api/v1/admin/shipments'),
      route('audit:read', 'operator-cross-tenant', 'session', '/api/v1/audit/entries'),
      route('webhook:stripe:receive', 'public', 'signature', '/api/v1/webhooks/stripe'),
      route(MOCK_GATEWAY_PERMISSION, 'public', 'signature', '/api/v1/webhooks/mock-gateway'),
      route('quote:read', 'tenant', 'session'),
      route('public', 'guest', 'quote-token'),
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

  it('[PR8-SEC-05 (c)] a signature-only permission on a session, anonymous or guest route, and a session permission or authenticated on a signature route, are SIGNATURE_AUTH', () => {
    expect(rulesOf([route('webhook:stripe:receive', 'public', 'session')])).toEqual(['SIGNATURE_AUTH']);
    expect(rulesOf([route('webhook:stripe:receive', 'public', 'anonymous')])).toEqual(['SIGNATURE_AUTH']);
    expect(rulesOf([route('webhook:stripe:receive', 'guest', 'quote-token')])).toEqual(['SIGNATURE_AUTH']);
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

  it('reports every violated rule of one route, upper-casing the method', () => {
    const violations = findRouteBindingViolations([{ ...route('webhook:mock_gateway:receive', 'user', 'session'), method: 'post' }], {
      production: true,
    });
    expect(violations.map((v) => v.rule)).toEqual(['SIGNATURE_AUTH', 'MOCK_WEBHOOK_IN_PRODUCTION']);
    expect(violations.every((v) => v.route === 'POST /api/v1/x')).toBe(true);
  });
});
