/**
 * US-065 typed permission catalogue (REQ-RBAC-001, REQ-RBAC-014, ADR-0008 §1). This file is inside the package's
 * tsconfig `include`, so `tsc -b packages/authz` type-checks it: the `@ts-expect-error` of AT-US-065-03 fails the
 * build the day "shipment:fly" type-checks as a Permission.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { checkCatalogue } from '../guard.js';
import { assertRoutePermissions, findUnknownRoutePermissions, UnknownRoutePermissionError } from '../routes.js';
import { readRepoFile } from '../tests/repo.js';
import {
  CATEGORY_EXCEPTIONS,
  expectedCategory,
  isAuditPermission,
  isOperatorOnlyKey,
  isPermission,
  isReadPermission,
  isRouteMarker,
  OPERATOR_ONLY_PERMISSIONS,
  type Permission,
  PERMISSION_DEFINITIONS,
  type PermissionDefinition,
  PERMISSION_KEY_FORMAT,
  PERMISSIONS,
  permissionVerb,
  ROUTE_MARKERS,
  SELF_SERVICE_PERMISSIONS,
} from './index.js';

const keys = PERMISSIONS.map((permission) => permission.key);

/** The shipped catalogue with one entry changed. */
const replace = (key: string, change: Partial<PermissionDefinition>): PermissionDefinition[] =>
  PERMISSION_DEFINITIONS.map((definition) => (definition.key === key ? { ...definition, ...change } : definition));
/** The shipped catalogue with every optional flag (here: `selfService`) dropped from one entry. */
const unflag = (key: string): PermissionDefinition[] =>
  PERMISSION_DEFINITIONS.map((d) =>
    d.key === key ? { key: d.key, description: d.description, category: d.category, operatorOnly: d.operatorOnly } : d,
  );
const entry = (key: string, category: PermissionDefinition['category']): PermissionDefinition => ({
  key,
  description: 'mutated',
  category,
  operatorOnly: false,
});
const openapi = readRepoFile('docs/03-architecture/api/openapi.yaml');
const contractPermissions = [...new Set([...openapi.matchAll(/x-permission:\s*([a-z_:]+)/g)].map((match) => String(match[1])))].sort();

describe('US-065 permission catalogue (REQ-RBAC-001, REQ-RBAC-014)', () => {
  it('[AT-US-065-01] the catalogue contains the required permissions and the "public" marker', () => {
    const required = [
      'shipment:create',
      'shipment:create:on_behalf',
      'refund:approve',
      'audit:read',
      'audit:export',
      'org:update',
      'org:member:invite',
      'org:member:manage',
      'featureflag:manage',
      'quote:create',
      'document:download',
      'pickup:schedule',
      'session:manage',
    ];
    expect(required.filter((key) => !isPermission(key))).toEqual([]);
    expect(isRouteMarker('public')).toBe(true);
    expect(ROUTE_MARKERS).toEqual(['public', 'authenticated']);
    expect(ROUTE_MARKERS.filter((marker) => isPermission(marker))).toEqual([]);
  });

  it('[AT-US-065-01] the catalogue holds every REQ-RBAC-014 permission and every x-permission of the API contract', () => {
    const reqRbac014 =
      'quote:create quote:read quote:share quote:delete shipment:create shipment:read shipment:cancel order:read customs:manage payment:create payment:read payment_method:manage webhook:stripe:receive document:read document:download document:email pickup:schedule pickup:cancel pickup:read tracking:read address_book:read address_book:manage org:read org:member:manage notification:read notification_pref:manage privacy:export privacy:delete audit:read session:manage';
    expect(reqRbac014.split(' ').filter((key) => !isPermission(key))).toEqual([]);
    expect(contractPermissions.length).toBeGreaterThan(30);
    expect(contractPermissions.filter((key) => !isPermission(key) && !isRouteMarker(key))).toEqual([]);
    expect(isPermission('carrier:status:read') && isPermission('webhook:mock_gateway:receive')).toBe(true);
  });

  it('[AT-US-065-02] every catalogue key is unique and matches resource:action[:qualifier] with [a-z_] segments', () => {
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => !PERMISSION_KEY_FORMAT.test(key))).toEqual([]);
    expect(checkCatalogue(PERMISSION_DEFINITIONS)).toEqual([]);
    expect(PERMISSION_DEFINITIONS.filter((definition) => definition.description.trim() === '')).toEqual([]);
  });

  it.each([
    ['upper case', 'Shipment:Create'],
    ['a digit', 'shipment:create2'],
    ['a hyphen', 'shipment:create-draft'],
    ['one segment', 'shipment'],
    ['four segments', 'shipment:create:on_behalf:now'],
  ])('[AT-US-065-02] a permission with %s ("%s") fails the catalogue guard', (_label, key) => {
    const catalogue = [...PERMISSION_DEFINITIONS, { key, description: 'mutated', category: 'shipment' as const, operatorOnly: false }];
    expect(checkCatalogue(catalogue)).toEqual([expect.objectContaining({ code: 'PERMISSION_FORMAT', permission: key })]);
  });

  it('[AT-US-065-02] a duplicated permission fails the catalogue guard', () => {
    const duplicate = PERMISSION_DEFINITIONS.find((definition) => definition.key === 'quote:create');
    expect(checkCatalogue([...PERMISSION_DEFINITIONS, ...(duplicate ? [duplicate] : [])])).toEqual([
      expect.objectContaining({ code: 'PERMISSION_DUPLICATE', permission: 'quote:create' }),
    ]);
  });

  it('[AT-US-065-02] property: any key with a character outside [a-z_:] fails the format check', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((value) => /[^a-z_:]/.test(value)),
        (noise) =>
          checkCatalogue([{ key: `shipment:${noise}`, description: 'x', category: 'shipment', operatorOnly: false }]).some(
            (v) => v.code === 'PERMISSION_FORMAT',
          ),
      ),
    );
  });

  it('[AT-US-065-03] an unknown permission string fails the TypeScript compile (tsc -b type-checks this file)', () => {
    // @ts-expect-error -- TASK-013 "shipment:fly" is not in the catalogue; tsc -b fails if this assignment ever type-checks.
    const unknownPermission: Permission = 'shipment:fly';
    const known: Permission = 'shipment:create';
    expect(isPermission(unknownPermission)).toBe(false);
    expect(isPermission(known)).toBe(true);
  });

  it('[AT-US-065-04] a route declaring a permission absent from the catalogue fails, naming the method and path', () => {
    const routes = [
      { method: 'post', path: '/api/v1/shipments', permission: 'shipment:create' },
      { method: 'get', path: '/api/v1/health', permission: 'public' },
      { method: 'get', path: '/api/v1/me', permission: 'authenticated' },
      { method: 'post', path: '/api/v1/shipments/{shipmentId}/fly', permission: 'shipment:fly' },
      { method: 'delete', path: '/api/v1/quotes/{quoteId}', permission: 'Quote:Delete' },
    ];
    expect(findUnknownRoutePermissions(routes).map((route) => route.permission)).toEqual(['shipment:fly', 'Quote:Delete']);
    expect(() => assertRoutePermissions(routes)).toThrow(UnknownRoutePermissionError);
    expect(() => assertRoutePermissions(routes)).toThrow(
      'POST /api/v1/shipments/{shipmentId}/fly -> "shipment:fly"; DELETE /api/v1/quotes/{quoteId} -> "Quote:Delete"',
    );
    expect(() => assertRoutePermissions(routes.slice(0, 3))).not.toThrow();
  });

  it('[AT-US-065-05] no API lists permission definitions: the contract declares no /permissions, /roles or /role-permissions path (HTTP 404 asserted with the route registry, TASK-020)', () => {
    const pathKeys = [...openapi.matchAll(/^ {2}(\/[^\s:]*):\s*$/gm)].map((match) => String(match[1]));
    expect(pathKeys.length).toBeGreaterThan(30);
    expect(pathKeys.filter((path) => /(^|\/)(permissions|roles|role[-_]permissions)(\/|$)/.test(path))).toEqual([]);
  });
});

describe('operator-only rule and verbs (DR-A07, ADR-0008 §1)', () => {
  it('derives operator-only from :any_org, audit:*, featureflag:manage and carrier:status:read, and every flag agrees', () => {
    expect(PERMISSION_DEFINITIONS.filter((definition) => definition.operatorOnly !== isOperatorOnlyKey(definition.key))).toEqual([]);
    expect([...OPERATOR_ONLY_PERMISSIONS].sort()).toEqual(
      ['audit:export', 'audit:read', 'carrier:status:read', 'featureflag:manage', 'org:read:any_org', 'shipment:read:any_org'].sort(),
    );
    expect(checkCatalogue(replace('audit:read', { operatorOnly: false }))).toEqual([
      expect.objectContaining({ code: 'PERMISSION_OPERATOR_ONLY_MISMATCH', permission: 'audit:read' }),
    ]);
  });

  it('rejects a category outside PERMISSION_CATEGORIES', () => {
    const stray = { category: 'quotes' } as unknown as Partial<PermissionDefinition>;
    expect(checkCatalogue(replace('quote:read', stray))).toEqual([
      expect.objectContaining({ code: 'PERMISSION_CATEGORY_UNKNOWN', permission: 'quote:read' }),
    ]);
  });

  it('isAuditPermission and isOperatorOnlyKey decide by key segments, never by category (PR #8 M1, PR8-SEC-02)', () => {
    expect(['audit:read', 'audit:export', 'audit_trail:read', 'retention:purge'].map(isAuditPermission)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(['shipment:any_org:read', 'org:any_org', 'any_org:read', 'audit:anything'].every(isOperatorOnlyKey)).toBe(true);
    expect(['audit_trail:read', 'org:read', 'featureflag:read'].some(isOperatorOnlyKey)).toBe(false);
  });

  it('the positive control: the shipped catalogue has no violation and only the documented category exceptions', () => {
    expect(checkCatalogue(PERMISSION_DEFINITIONS)).toEqual([]);
    expect([...CATEGORY_EXCEPTIONS]).toEqual([
      ['payment_method', 'payment'],
      ['notification_pref', 'notification'],
    ]);
    expect(
      PERMISSION_DEFINITIONS.filter((definition) => definition.category !== expectedCategory(definition.key)).map((d) => d.key),
    ).toEqual([]);
  });

  it.each<[string, PermissionDefinition, string[]]>([
    [
      'a scope qualifier in the action segment',
      entry('shipment:any_org:read', 'shipment'),
      ['PERMISSION_FORMAT', 'PERMISSION_OPERATOR_ONLY_MISMATCH'],
    ],
    ['a two-segment any_org key', entry('org:any_org', 'org'), ['PERMISSION_FORMAT', 'PERMISSION_OPERATOR_ONLY_MISMATCH']],
    ['an audit-looking resource filed under audit', entry('audit_trail:read', 'audit'), ['PERMISSION_CATEGORY_MISMATCH']],
    ['a non-audit resource filed under audit', entry('retention:purge', 'audit'), ['PERMISSION_CATEGORY_MISMATCH']],
    ['a verb as action and a read qualifier (n5)', entry('document:download:read', 'document'), ['PERMISSION_FORMAT']],
    [
      'a webhook key without the signature-only flag',
      entry('webhook:paypal:receive', 'webhook'),
      ['PERMISSION_FORMAT', 'SIGNATURE_FLAG_MISMATCH'],
    ], // undeclared provider (R2-m1)
  ])('PR8-SEC-02: %s fails the catalogue guard', (_label, added, expected) => {
    const found = checkCatalogue([...PERMISSION_DEFINITIONS, added]);
    expect(found.every((v) => v.permission === added.key)).toBe(true);
    expect([...new Set(found.map((v) => v.code))].sort()).toEqual(expected);
  });

  it('PR8-SEC-02: signatureOnly on payment:create fails the catalogue guard', () => {
    expect(checkCatalogue(replace('payment:create', { signatureOnly: true }))).toEqual([
      expect.objectContaining({ code: 'SIGNATURE_FLAG_MISMATCH', permission: 'payment:create' }),
    ]);
  });

  it.each([
    ['carrier:status:read', 'read', true],
    ['shipment:read:any_org', 'read', true],
    ['org:member:invite', 'invite', false],
    ['shipment:create:on_behalf', 'create', false],
    ['document:download', 'download', false],
    ['public', 'undefined', false],
  ])('the verb of %s is %s (read-only: %s)', (key, verb, read) => {
    expect(permissionVerb(key)).toBe(verb);
    expect(isReadPermission(key)).toBe(read);
  });
});

describe('D-058 self-service flag (PR8-SEC-04)', () => {
  it('flags exactly SELF_SERVICE_PERMISSIONS, all non-operator, non-reserved, non-signature, session or notification', () => {
    const flagged = PERMISSION_DEFINITIONS.filter((definition) => definition.selfService === true);
    expect(flagged.map((definition) => definition.key).sort()).toEqual([...SELF_SERVICE_PERMISSIONS].sort());
    expect(SELF_SERVICE_PERMISSIONS).toEqual(['session:manage', 'notification_pref:manage', 'notification:read']);
    expect(
      flagged.filter(
        (d) => d.operatorOnly || d.reserved === true || d.signatureOnly === true || !['session', 'notification'].includes(d.category),
      ),
    ).toEqual([]);
  });

  it.each<[string, PermissionDefinition[], string, string[]]>([
    [
      'selfService on document:download',
      replace('document:download', { selfService: true }),
      'document:download',
      ['SELF_SERVICE_FLAG_MISMATCH', 'SELF_SERVICE_INVALID'],
    ],
    ['selfService dropped from session:manage', unflag('session:manage'), 'session:manage', ['SELF_SERVICE_FLAG_MISMATCH']],
    [
      'session:manage removed from the catalogue',
      PERMISSION_DEFINITIONS.filter((d) => d.key !== 'session:manage'),
      'session:manage',
      ['SELF_SERVICE_FLAG_MISMATCH'],
    ],
    ['a reserved self-service entry', replace('notification:read', { reserved: true }), 'notification:read', ['SELF_SERVICE_INVALID']],
    [
      'an operator-only self-service entry',
      replace('session:manage', { operatorOnly: true }),
      'session:manage',
      ['PERMISSION_OPERATOR_ONLY_MISMATCH', 'SELF_SERVICE_INVALID'],
    ],
  ])('%s fails the catalogue guard', (_label, catalogue, key, expected) => {
    const found = checkCatalogue(catalogue);
    expect(found.every((v) => v.permission === key)).toBe(true);
    expect([...new Set(found.map((v) => v.code))].sort()).toEqual(expected);
  });
});
