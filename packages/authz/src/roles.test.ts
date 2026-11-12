/**
 * US-066 seeded roles and the privilege-escalation guard (REQ-RBAC-002/003/004, DR-A07, ADR-0008 §2-§3). Mutated
 * seeds are built here and fed to the pure guard, so every invariant is shown to fail CI on a bad seed edit.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { checkRoleInvariants, type Violation } from './guard.js';
import { OPERATOR_ONLY_PERMISSIONS, PERMISSION_DEFINITIONS, type PermissionDefinition } from './permissions/index.js';
import { ASSIGNABLE_CUSTOMER_ROLES, ROLES, type RoleDefinition } from './roles.js';
import { listSources, readText } from './tests/repo.js';

type Seed = readonly RoleDefinition<string, string>[];

const role = (key: string): RoleDefinition<string, string> => {
  const found = ROLES.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`no role ${key}`);
  return found;
};
const grantsOf = (key: string): readonly string[] => role(key).permissions;
const mutate = (key: string, change: (permissions: readonly string[]) => readonly string[], seed: Seed = ROLES): Seed =>
  seed.map((candidate) => (candidate.key === key ? { ...candidate, permissions: change(candidate.permissions) } : candidate));
const withGrant = (key: string, permission: string): Seed => mutate(key, (permissions) => [...permissions, permission]);
const withoutGrant = (key: string, permission: string): Seed => mutate(key, (permissions) => permissions.filter((p) => p !== permission));
const check = (seed: Seed, catalogue: readonly PermissionDefinition[] = PERMISSION_DEFINITIONS): Violation[] =>
  checkRoleInvariants(catalogue, seed);

const CUSTOMER_AND_PARTNER = ROLES.filter((candidate) => candidate.scope !== 'OPERATOR').map((candidate) => candidate.key);
const PARTNER_ROLES = ROLES.filter((candidate) => candidate.scope === 'PARTNER').map((candidate) => candidate.key);

describe('US-066 seeded roles (REQ-RBAC-002, REQ-RBAC-003)', () => {
  it('seeds 8 operator, 5 customer and 4 partner roles with unique keys, and the shipped seed has no violation', () => {
    const count = (scope: string) => ROLES.filter((candidate) => candidate.scope === scope).length;
    expect([count('OPERATOR'), count('CUSTOMER'), count('PARTNER')]).toEqual([8, 5, 4]);
    expect(new Set(ROLES.map((candidate) => candidate.key)).size).toBe(17);
    expect(check(ROLES)).toEqual([]);
  });

  it('grants the customer roles per the REQ-ACCT scope note', () => {
    const owner = grantsOf('CUSTOMER_OWNER');
    const area = ['shipment:read', 'shipment:create', 'shipment:cancel', 'quote:read', 'address_book:read', 'address_book:manage'];
    expect(area.filter((key) => !owner.includes(key))).toEqual([]);
    expect(owner.filter((key) => !grantsOf('CUSTOMER_ADMIN').includes(key))).toEqual(['privacy:delete']);
    for (const excluded of ['org:member:manage', 'payment_method:manage', 'payment:read'])
      expect(grantsOf('CUSTOMER_SHIPPER')).not.toContain(excluded);
    expect(grantsOf('CUSTOMER_SHIPPER')).toEqual(
      expect.arrayContaining(['shipment:create', 'tracking:read', 'privacy:delete', 'payment:create']),
    );
    expect(grantsOf('CUSTOMER_FINANCE')).toEqual(
      expect.arrayContaining(['payment:read', 'shipment:read', 'document:read', 'document:download']),
    );
    expect(grantsOf('CUSTOMER_FINANCE')).not.toContain('shipment:create');
  });

  it('grants carrier:status:read to Super Admin, Admin, Operations, Support and Compliance Auditor only (ADR-0008 amendment)', () => {
    expect(ROLES.filter((candidate) => candidate.permissions.includes('carrier:status:read')).map((candidate) => candidate.key)).toEqual([
      'OPERATOR_SUPER_ADMIN',
      'OPERATOR_ADMIN',
      'OPERATOR_OPERATIONS',
      'OPERATOR_SUPPORT',
      'OPERATOR_COMPLIANCE_AUDITOR',
    ]);
    expect(ROLES.filter((candidate) => candidate.permissions.some((key) => key.startsWith('webhook:')))).toEqual([]);
  });
});

describe('US-066 privilege-escalation guard (REQ-RBAC-004, DR-A07)', () => {
  it('[AT-US-066-03] Super Admin holds every catalogue permission, Compliance Auditor only read and audit, customer Viewer no create/update/delete/manage', () => {
    const assignable = PERMISSION_DEFINITIONS.filter((definition) => definition.signatureOnly !== true).map((definition) => definition.key);
    expect(grantsOf('OPERATOR_SUPER_ADMIN')).toEqual(assignable);
    expect(grantsOf('OPERATOR_COMPLIANCE_AUDITOR').filter((key) => !key.endsWith(':read') && !key.startsWith('audit:'))).toEqual([]);
    expect(
      grantsOf('CUSTOMER_VIEWER').filter((key) =>
        /:(create|update|delete|manage|cancel|schedule|share|invite|approve|export|email|download)(:|$)/.test(key),
      ),
    ).toEqual([]);
    expect(check(withoutGrant('OPERATOR_SUPER_ADMIN', 'quote:share'))).toEqual([
      expect.objectContaining({ code: 'SUPER_ADMIN_INCOMPLETE', role: 'OPERATOR_SUPER_ADMIN', permission: 'quote:share' }),
    ]);
    expect(check(withGrant('OPERATOR_COMPLIANCE_AUDITOR', 'featureflag:manage'))).toEqual([
      expect.objectContaining({ code: 'AUDITOR_NOT_READ_ONLY', role: 'OPERATOR_COMPLIANCE_AUDITOR', permission: 'featureflag:manage' }),
    ]);
    expect(check(withGrant('CUSTOMER_VIEWER', 'address_book:manage'))).toEqual([
      expect.objectContaining({ code: 'VIEWER_NOT_READ_ONLY', role: 'CUSTOMER_VIEWER', permission: 'address_book:manage' }),
    ]);
  });

  it.each([
    ['audit:read', 'CUSTOMER_ADMIN'],
    ['shipment:read:any_org', 'CUSTOMER_ADMIN'],
    ['org:read:any_org', 'CUSTOMER_ADMIN'],
    ['featureflag:manage', 'PARTNER_OWNER'],
  ])('[AT-US-066-04] a seed edit giving "%s" to %s fails the build-time guard', (permission, roleKey) => {
    expect(check(withGrant(roleKey, permission))).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OPERATOR_ONLY_ESCALATION', role: roleKey, permission })]),
    );
  });

  it('[AT-US-066-04] property: adding any operator-only permission to any customer or partner role always yields a violation', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CUSTOMER_AND_PARTNER), fc.constantFrom(...OPERATOR_ONLY_PERMISSIONS), (roleKey, permission) =>
        check(withGrant(roleKey, permission)).some(
          (v) => v.code === 'OPERATOR_ONLY_ESCALATION' && v.role === roleKey && v.permission === permission,
        ),
      ),
    );
  });

  it.each([
    ['1', 'document:download'],
    ['2', 'document:email'],
    ['3', 'privacy:export'],
  ])(
    '[AT-US-066-05-%s] a seed edit giving customer Viewer "%s" fails the guard, naming role "Viewer" and the permission',
    (_row, permission) => {
      expect(grantsOf('CUSTOMER_VIEWER')).not.toContain(permission);
      const violations = check(withGrant('CUSTOMER_VIEWER', permission));
      const exfiltration = violations.find((v) => v.code === 'VIEWER_EXFILTRATION');
      expect(exfiltration).toEqual(expect.objectContaining({ role: 'CUSTOMER_VIEWER', permission }));
      expect(exfiltration?.message).toContain('Viewer');
      expect(exfiltration?.message).toContain(permission);
    },
  );

  it('[AT-US-066-07] partner roles are unused: no app or package source references a partner role, and invitations offer customer roles only', () => {
    const sources = ['apps', 'packages'].flatMap((top) =>
      [
        'api/src',
        'worker/src',
        'web/src',
        'web/app',
        'admin/src',
        'admin/app',
        'audit/src',
        'carriers/src',
        'config/src',
        'pricing/src',
        'shared/src',
        'ui/src',
      ].map((sub) => `${top}/${sub}`),
    );
    const offenders = sources
      .flatMap((dir) => listSources(dir))
      .filter((file) => PARTNER_ROLES.some((key) => readText(file).includes(key)));
    expect(offenders).toEqual([]);
    expect(ASSIGNABLE_CUSTOMER_ROLES).toEqual([
      'CUSTOMER_OWNER',
      'CUSTOMER_ADMIN',
      'CUSTOMER_SHIPPER',
      'CUSTOMER_FINANCE',
      'CUSTOMER_VIEWER',
    ]);
    expect(PARTNER_ROLES).toHaveLength(4);
  });

  it('every holder of shipment:create holds tracking:read (ADR-0008 amendment)', () => {
    expect(check(withoutGrant('CUSTOMER_SHIPPER', 'tracking:read'))).toEqual([
      expect.objectContaining({ code: 'TRACKING_READ_MISSING', role: 'CUSTOMER_SHIPPER', permission: 'tracking:read' }),
    ]);
  });

  it.each<[string, () => Violation[], Partial<Violation>]>([
    [
      'an unknown permission',
      () => check(withGrant('CUSTOMER_OWNER', 'shipment:fly')),
      { code: 'GRANT_UNKNOWN', role: 'CUSTOMER_OWNER', permission: 'shipment:fly' },
    ],
    [
      'a duplicate grant',
      () => check(withGrant('CUSTOMER_OWNER', 'quote:read')),
      { code: 'GRANT_DUPLICATE', role: 'CUSTOMER_OWNER', permission: 'quote:read' },
    ],
    [
      'a webhook permission',
      () => check(withGrant('OPERATOR_ADMIN', 'webhook:stripe:receive')),
      { code: 'SIGNATURE_PERMISSION_HELD', permission: 'webhook:stripe:receive' },
    ],
    [
      'a reserved seam outside Super Admin',
      () => check(withGrant('OPERATOR_FINANCE', 'refund:approve')),
      { code: 'RESERVED_HELD', role: 'OPERATOR_FINANCE' },
    ],
    ['a duplicated role', () => check([...ROLES, role('OPERATOR_SALES')]), { code: 'ROLE_DUPLICATE', role: 'OPERATOR_SALES' }],
    ['a missing role', () => check(ROLES.filter((r) => r.key !== 'CUSTOMER_VIEWER')), { code: 'ROLE_MISSING', role: 'CUSTOMER_VIEWER' }],
    ['a wrong role count', () => check(ROLES.filter((r) => r.key !== 'PARTNER_FINANCE')), { code: 'ROLE_COUNT' }],
    [
      'a dead permission',
      () => check(withoutGrant('OPERATOR_ADMIN', 'featureflag:manage')),
      { code: 'PERMISSION_UNHELD', permission: 'featureflag:manage' },
    ],
    [
      'no Super Admin',
      () => check(ROLES.filter((r) => r.key !== 'OPERATOR_SUPER_ADMIN')),
      { code: 'SUPER_ADMIN_INCOMPLETE', permission: 'audit:export' },
    ],
  ])('the guard reports %s', (_label, run, expected) => {
    expect(run()).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
  });
});
