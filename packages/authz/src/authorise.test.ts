/** The pure authorisation decision over seeded role grants (REQ-RBAC-006, ADR-0008 §4; US-066 permission path). */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { authorise, effectivePermissions, UnknownRoleError } from './authorise.js';
import { OPERATOR_ONLY_PERMISSIONS } from './permissions/index.js';
import { ROLES } from './roles.js';

describe('authorise (REQ-RBAC-006)', () => {
  it('[AT-US-066-08] a customer Shipper calling a route that requires an operator-only permission is denied with AUTHZ_DENIED', () => {
    const shipper = effectivePermissions(['CUSTOMER_SHIPPER']);
    for (const required of OPERATOR_ONLY_PERMISSIONS) {
      expect(authorise(shipper, required)).toEqual({ allowed: false, code: 'AUTHZ_DENIED', requiredPermission: required });
    }
    expect(authorise(shipper, 'shipment:create')).toEqual({ allowed: true });
  });

  it('[AT-US-066-06 (authz decision; HTTP 403 + PERMISSION_DENIED audit asserted by the generated rbac-matrix/audit suites, TASK-027/TASK-033)] the customer Viewer holds document:read but is denied document:download', () => {
    const viewer = effectivePermissions(['CUSTOMER_VIEWER']);
    expect(authorise(viewer, 'document:read')).toEqual({ allowed: true });
    expect(authorise(viewer, 'document:download')).toEqual({
      allowed: false,
      code: 'AUTHZ_DENIED',
      requiredPermission: 'document:download',
    });
  });

  it('property: no customer or partner role combination is ever allowed an operator-only permission', () => {
    const outsiders = ROLES.filter((role) => role.scope !== 'OPERATOR').map((role) => role.key);
    fc.assert(
      fc.property(
        fc.subarray(outsiders, { minLength: 1 }),
        fc.constantFrom(...OPERATOR_ONLY_PERMISSIONS),
        (roleKeys, required) => authorise(effectivePermissions(roleKeys), required).allowed === false,
      ),
    );
  });
});

describe('effectivePermissions', () => {
  it('unions the grants of several roles and is empty for none', () => {
    const union = effectivePermissions(['CUSTOMER_FINANCE', 'CUSTOMER_VIEWER']);
    expect(union.has('payment:read') && union.has('quote:read')).toBe(true);
    expect(effectivePermissions([]).size).toBe(0);
  });

  it('fails fast on a role key that is not seeded (catalogue/database drift)', () => {
    expect(() => effectivePermissions(['CUSTOMER_GHOST'])).toThrow(UnknownRoleError);
    expect(() => effectivePermissions(['CUSTOMER_GHOST'])).toThrow('unknown role "CUSTOMER_GHOST"');
  });
});
