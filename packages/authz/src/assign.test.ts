/** Role-assignment rank (REQ-ORG-010, REQ-ACCT-014, threat model AC-05, PR8-SEC-06). */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { ASSIGNABLE_BY, canAssignRole } from './assign.js';
import { ROLE_KEYS, ROLES } from './roles.js';

const OUTSIDE_CUSTOMER = ROLES.filter((role) => role.scope !== 'CUSTOMER').map((role) => role.key);

describe('canAssignRole (REQ-ORG-010)', () => {
  it('only an Owner assigns Owner, although Owner and Admin hold the same permission set (D-058)', () => {
    expect(ROLES.find((r) => r.key === 'CUSTOMER_ADMIN')?.permissions).toEqual(ROLES.find((r) => r.key === 'CUSTOMER_OWNER')?.permissions);
    expect(canAssignRole(['CUSTOMER_ADMIN'], 'CUSTOMER_OWNER')).toBe(false);
    expect(canAssignRole(['CUSTOMER_OWNER'], 'CUSTOMER_OWNER')).toBe(true);
  });

  it.each(['CUSTOMER_ADMIN', 'CUSTOMER_SHIPPER', 'CUSTOMER_FINANCE', 'CUSTOMER_VIEWER'])('Owner and Admin may assign %s', (target) => {
    expect(canAssignRole(['CUSTOMER_OWNER'], target)).toBe(true);
    expect(canAssignRole(['CUSTOMER_ADMIN'], target)).toBe(true);
  });

  it.each(['CUSTOMER_SHIPPER', 'CUSTOMER_FINANCE', 'CUSTOMER_VIEWER'])('%s cannot assign any role', (assigner) => {
    expect(ROLE_KEYS.filter((target) => canAssignRole([assigner], target))).toEqual([]);
  });

  it('no role may assign a partner or operator role in this run', () => {
    fc.assert(
      fc.property(
        fc.subarray([...ROLE_KEYS]),
        fc.constantFrom(...OUTSIDE_CUSTOMER),
        (assigners, target) => !canAssignRole(assigners, target),
      ),
    );
    expect(OUTSIDE_CUSTOMER.filter((target) => ASSIGNABLE_BY[target].length > 0)).toEqual([]);
  });

  it('fails closed on unknown or prototype keys and on an empty assigner set', () => {
    expect(canAssignRole(['CUSTOMER_OWNER'], 'CUSTOMER_GHOST')).toBe(false);
    expect(canAssignRole(['CUSTOMER_OWNER'], 'constructor')).toBe(false);
    expect(canAssignRole(['constructor'], 'CUSTOMER_VIEWER')).toBe(false);
    expect(canAssignRole([], 'CUSTOMER_VIEWER')).toBe(false);
  });
});
