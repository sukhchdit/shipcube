/** The pure authorisation decision over seeded role grants (REQ-RBAC-006, ADR-0008 §4; US-066 permission path). */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { authorise, effectivePermissions, UnknownRoleError } from './authorise.js';
import { OPERATOR_ONLY_PERMISSIONS } from './permissions/index.js';
import { ROLES } from './roles.js';

/** The seed stands in for the database-loaded grants the API passes (REQ-RBAC-008). */
const resolve = (roleKeys: readonly string[]) => effectivePermissions(roleKeys, ROLES);

describe('authorise (REQ-RBAC-006)', () => {
  it('[AT-US-066-08] a customer Shipper calling a route that requires an operator-only permission is denied with AUTHZ_DENIED', () => {
    const shipper = resolve(['CUSTOMER_SHIPPER']);
    for (const required of OPERATOR_ONLY_PERMISSIONS) {
      expect(authorise(shipper, required)).toEqual({ allowed: false, code: 'AUTHZ_DENIED', requiredPermission: required });
    }
    expect(authorise(shipper, 'shipment:create')).toEqual({ allowed: true });
  });

  // The scenario itself (HTTP 403 + PERMISSION_DENIED audit entry) is owned by the generated rbac-matrix/audit suites.
  it('authz decision behind AT-US-066-06 (HTTP 403 + PERMISSION_DENIED owned by TASK-027/TASK-033): the customer Viewer holds document:read but is denied document:download', () => {
    const viewer = resolve(['CUSTOMER_VIEWER']);
    expect(authorise(viewer, 'document:read')).toEqual({ allowed: true });
    expect(authorise(viewer, 'document:download')).toEqual({
      allowed: false,
      code: 'AUTHZ_DENIED',
      requiredPermission: 'document:download',
    });
  });

  it('the customer Viewer and the Compliance Auditor are allowed the self-service set (D-058)', () => {
    for (const roleKey of ['CUSTOMER_VIEWER', 'OPERATOR_COMPLIANCE_AUDITOR']) {
      const granted = resolve([roleKey]);
      expect(authorise(granted, 'session:manage')).toEqual({ allowed: true });
      expect(authorise(granted, 'notification_pref:manage')).toEqual({ allowed: true });
    }
  });

  it('property: no customer or partner role combination is ever allowed an operator-only permission', () => {
    const outsiders = ROLES.filter((role) => role.scope !== 'OPERATOR').map((role) => role.key);
    fc.assert(
      fc.property(
        fc.subarray(outsiders, { minLength: 1 }),
        fc.constantFrom(...OPERATOR_ONLY_PERMISSIONS),
        (roleKeys, required) => authorise(resolve(roleKeys), required).allowed === false,
      ),
    );
  });
});

describe('effectivePermissions', () => {
  it('unions the grants of several roles and is empty for none', () => {
    const union = resolve(['CUSTOMER_FINANCE', 'CUSTOMER_VIEWER']);
    expect(union.has('payment:read') && union.has('quote:read')).toBe(true);
    expect(resolve([]).size).toBe(0);
  });

  it('resolves against the roles it is given, not the in-code seed', () => {
    const loaded = [
      { key: 'CUSTOMER_VIEWER', scope: 'CUSTOMER' as const, nameKey: 'x', description: 'x', permissions: ['quote:read' as const] },
    ];
    expect([...effectivePermissions(['CUSTOMER_VIEWER'], loaded)]).toEqual(['quote:read']);
  });

  it('fails fast on a role key that is not seeded (catalogue/database drift)', () => {
    expect(() => resolve(['CUSTOMER_GHOST'])).toThrow(UnknownRoleError);
    expect(() => resolve(['CUSTOMER_GHOST'])).toThrow('unknown role "CUSTOMER_GHOST"');
  });
});
