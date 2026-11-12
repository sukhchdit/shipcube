/**
 * US-066 seeded roles and the privilege-escalation guard (REQ-RBAC-002/003/004, DR-A07, ADR-0008 §2-§3, D-058).
 * Mutated seeds are built here and fed to the pure guard, so every invariant is shown to fail CI on a bad seed edit.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { checkRoleInvariants, type Violation } from './guard.js';
import {
  isAuditPermission,
  isReadPermission,
  OPERATOR_ONLY_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  type PermissionDefinition,
  SELF_SERVICE_PERMISSIONS,
} from './permissions/index.js';
import { ASSIGNABLE_CUSTOMER_ROLES, ROLE_KEYS, ROLES, type RoleDefinition } from './roles.js';
import { readText, repoRoot } from './tests/repo.js';

type Seed = readonly RoleDefinition<string, string>[];

const role = (key: string): RoleDefinition<string, string> => {
  const found = ROLES.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`no role ${key}`);
  return found;
};
const grantsOf = (key: string): readonly string[] => role(key).permissions;
const mutate = (key: string, change: (permissions: readonly string[]) => readonly string[], seed: Seed = ROLES): Seed =>
  seed.map((candidate) => (candidate.key === key ? { ...candidate, permissions: change(candidate.permissions) } : candidate));
const withGrant = (key: string, permission: string, seed: Seed = ROLES): Seed =>
  mutate(key, (permissions) => [...permissions, permission], seed);
const withoutGrant = (key: string, permission: string): Seed => mutate(key, (permissions) => permissions.filter((p) => p !== permission));
const check = (seed: Seed, catalogue: readonly PermissionDefinition[] = PERMISSION_DEFINITIONS): Violation[] =>
  checkRoleInvariants(catalogue, seed);
const codes = (violations: readonly Violation[]): string[] => [...new Set(violations.map((v) => v.code))].sort();
const recatalogue = (key: string, change: Partial<PermissionDefinition>): PermissionDefinition[] =>
  PERMISSION_DEFINITIONS.map((definition) => (definition.key === key ? { ...definition, ...change } : definition));

const CUSTOMER_AND_PARTNER = ROLES.filter((candidate) => candidate.scope !== 'OPERATOR').map((candidate) => candidate.key);
const PARTNER_ROLES = ROLES.filter((candidate) => candidate.scope === 'PARTNER').map((candidate) => candidate.key);
const SELF_SERVICE: readonly string[] = SELF_SERVICE_PERMISSIONS;

/** Workspace directories (`apps/*`, `packages/*` without authz, `prisma/seed` once it exists) for the AT-US-066-07 scan. */
function scannedWorkspaces(): string[] {
  const root = repoRoot();
  const children = (top: string): string[] =>
    readdirSync(join(root, top), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${top}/${entry.name}`);
  const seed = existsSync(join(root, 'prisma', 'seed')) ? ['prisma/seed'] : [];
  return [...children('apps'), ...children('packages').filter((dir) => dir !== 'packages/authz'), ...seed];
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.react-router', '.turbo']);

/** Source files under a repository directory; generated and dependency folders are pruned, not walked. */
function sourcesUnder(relativeDir: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(join(dir, entry.name));
      return /\.(tsx?|m?js)$/.test(entry.name) ? [join(dir, entry.name)] : [];
    });
  return walk(join(repoRoot(), relativeDir));
}

describe('US-066 seeded roles (REQ-RBAC-002, REQ-RBAC-003)', () => {
  it('seeds 8 operator, 5 customer and 4 partner roles with unique keys, and the shipped seed has no violation', () => {
    const count = (scope: string) => ROLES.filter((candidate) => candidate.scope === scope).length;
    expect([count('OPERATOR'), count('CUSTOMER'), count('PARTNER')]).toEqual([8, 5, 4]);
    expect(new Set(ROLES.map((candidate) => candidate.key)).size).toBe(17);
    expect(ROLES.map((candidate) => candidate.key)).toEqual([...ROLE_KEYS]);
    expect(check(ROLES)).toEqual([]);
  });

  it('holds the D-058 per-role grant counts (189 role-permission links)', () => {
    expect(Object.fromEntries(ROLES.map((candidate) => [candidate.key, candidate.permissions.length]))).toEqual({
      OPERATOR_SUPER_ADMIN: 38,
      OPERATOR_ADMIN: 6,
      OPERATOR_OPERATIONS: 4,
      OPERATOR_FINANCE: 3,
      OPERATOR_SUPPORT: 4,
      OPERATOR_SALES: 3,
      OPERATOR_COMPLIANCE_AUDITOR: 5,
      OPERATOR_CONTENT_MANAGER: 3,
      CUSTOMER_OWNER: 30,
      CUSTOMER_ADMIN: 30,
      CUSTOMER_SHIPPER: 25,
      CUSTOMER_FINANCE: 8,
      CUSTOMER_VIEWER: 11,
      PARTNER_OWNER: 7,
      PARTNER_DEVELOPER: 4,
      PARTNER_OPERATIONS: 4,
      PARTNER_FINANCE: 4,
    });
    expect(ROLES.reduce((total, candidate) => total + candidate.permissions.length, 0)).toBe(189);
  });

  it('grants the customer roles per the REQ-ACCT scope note and D-058', () => {
    const owner = grantsOf('CUSTOMER_OWNER');
    const area = ['shipment:read', 'shipment:create', 'shipment:cancel', 'quote:read', 'address_book:read', 'address_book:manage'];
    expect(area.filter((key) => !owner.includes(key))).toEqual([]);
    expect(grantsOf('CUSTOMER_ADMIN')).toEqual(owner);
    expect(grantsOf('CUSTOMER_ADMIN')).toContain('privacy:delete');
    for (const excluded of ['org:update', 'org:member:invite', 'org:member:manage', 'payment_method:manage', 'payment:read'])
      expect(grantsOf('CUSTOMER_SHIPPER')).not.toContain(excluded);
    expect(grantsOf('CUSTOMER_SHIPPER')).toEqual(
      expect.arrayContaining(['shipment:create', 'tracking:read', 'privacy:delete', 'payment:create']),
    );
    expect(grantsOf('CUSTOMER_FINANCE')).toEqual([
      'shipment:read',
      'order:read',
      'document:read',
      'document:download',
      'payment:read',
      'session:manage',
      'notification:read',
      'notification_pref:manage',
    ]);
    expect(grantsOf('CUSTOMER_VIEWER')).not.toContain('payment:read');
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

  it('partner roles hold org:* plus the self-service set only (D-058)', () => {
    for (const key of PARTNER_ROLES) {
      expect(grantsOf(key).filter((permission) => !permission.startsWith('org:') && !SELF_SERVICE.includes(permission))).toEqual([]);
    }
  });
});

describe('US-066 privilege-escalation guard (REQ-RBAC-004, DR-A07)', () => {
  it('[AT-US-066-03] Super Admin holds every role-assignable permission, Compliance Auditor only read, audit and self-service, customer Viewer no create/update/delete/manage outside the self-service set, every role the self-service set', () => {
    const assignable = PERMISSION_DEFINITIONS.filter((definition) => definition.signatureOnly !== true).map((definition) => definition.key);
    expect(grantsOf('OPERATOR_SUPER_ADMIN')).toEqual(assignable);
    expect(
      grantsOf('OPERATOR_COMPLIANCE_AUDITOR').filter(
        (key) => !isReadPermission(key) && !isAuditPermission(key) && !SELF_SERVICE.includes(key),
      ),
    ).toEqual([]);
    expect(
      grantsOf('CUSTOMER_VIEWER').filter(
        (key) =>
          !SELF_SERVICE.includes(key) &&
          /:(create|update|delete|manage|cancel|schedule|share|invite|approve|export|email|download)(:|$)/.test(key),
      ),
    ).toEqual([]);
    expect(ROLES.filter((candidate) => SELF_SERVICE_PERMISSIONS.some((key) => !candidate.permissions.includes(key)))).toEqual([]);
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

  // US-066 D-058 Scenario Outline "Self-service permission removed from a seeded role" (no AT ID in the map yet).
  it.each([
    ['CUSTOMER_VIEWER', 'session:manage'],
    ['CUSTOMER_VIEWER', 'notification_pref:manage'],
    ['OPERATOR_COMPLIANCE_AUDITOR', 'session:manage'],
    ['CUSTOMER_FINANCE', 'notification_pref:manage'],
  ])('D-058 outline: removing self-service from %s ("%s") fails the guard naming the role and the permission', (roleKey, permission) => {
    const violations = check(withoutGrant(roleKey, permission));
    expect(violations).toEqual([expect.objectContaining({ code: 'SELF_SERVICE_MISSING', role: roleKey, permission })]);
    expect(violations[0]?.message).toContain(roleKey);
    expect(violations[0]?.message).toContain(permission);
  });

  it('property: removing any self-service permission from any seeded role yields SELF_SERVICE_MISSING (D-058)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLE_KEYS), fc.constantFrom(...SELF_SERVICE_PERMISSIONS), (roleKey, permission) =>
        check(withoutGrant(roleKey, permission)).some(
          (v) => v.code === 'SELF_SERVICE_MISSING' && v.role === roleKey && v.permission === permission,
        ),
      ),
    );
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
    ['4', 'privacy:delete'],
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

  it('[AT-US-066-07] partner roles are unused: no app, package or seed source references a partner role, and invitations offer customer roles only', () => {
    const workspaces = scannedWorkspaces();
    expect(workspaces).toEqual(expect.arrayContaining(['apps/api', 'apps/web', 'packages/shared']));
    expect(workspaces).not.toContain('packages/authz');
    const files = workspaces.flatMap((dir) => sourcesUnder(dir));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => PARTNER_ROLES.some((key) => readText(file).includes(key)))).toEqual([]);
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
      expect.objectContaining({ code: 'IMPLIED_GRANT_MISSING', role: 'CUSTOMER_SHIPPER', permission: 'tracking:read' }),
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

describe('Compliance Auditor rule is keyed on the permission key, not the category (PR #8 M1)', () => {
  it('P1: a new "retention:purge" filed under category audit and granted to Super Admin and the Auditor fails', () => {
    const purge: PermissionDefinition = { key: 'retention:purge', description: 'x', category: 'audit', operatorOnly: false };
    const seed = withGrant('OPERATOR_COMPLIANCE_AUDITOR', 'retention:purge', withGrant('OPERATOR_SUPER_ADMIN', 'retention:purge'));
    const violations = check(seed, [...PERMISSION_DEFINITIONS, purge]);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PERMISSION_CATEGORY_MISMATCH', permission: 'retention:purge' }),
        expect.objectContaining({ code: 'AUDITOR_NOT_READ_ONLY', role: 'OPERATOR_COMPLIANCE_AUDITOR', permission: 'retention:purge' }),
      ]),
    );
  });

  it('P1b: featureflag:manage re-categorised as audit and granted to the Auditor fails', () => {
    const violations = check(
      withGrant('OPERATOR_COMPLIANCE_AUDITOR', 'featureflag:manage'),
      recatalogue('featureflag:manage', { category: 'audit' }),
    );
    expect(codes(violations)).toEqual(['AUDITOR_NOT_READ_ONLY', 'PERMISSION_CATEGORY_MISMATCH']);
  });
});

describe('D-058 self-service carve-out is flag-only and the flag is pinned (PR8-SEC-04)', () => {
  it('selfService on document:download is a catalogue violation, and the Viewer still trips VIEWER_EXFILTRATION', () => {
    const violations = check(withGrant('CUSTOMER_VIEWER', 'document:download'), recatalogue('document:download', { selfService: true }));
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SELF_SERVICE_FLAG_MISMATCH', permission: 'document:download' }),
        expect.objectContaining({ code: 'SELF_SERVICE_INVALID', permission: 'document:download' }),
        expect.objectContaining({ code: 'VIEWER_EXFILTRATION', role: 'CUSTOMER_VIEWER', permission: 'document:download' }),
      ]),
    );
  });

  it('selfService on address_book:manage cannot carve a Viewer write out silently', () => {
    const violations = check(
      withGrant('CUSTOMER_VIEWER', 'address_book:manage'),
      recatalogue('address_book:manage', { selfService: true }),
    );
    expect(codes(violations)).toEqual(['SELF_SERVICE_FLAG_MISMATCH', 'SELF_SERVICE_INVALID']);
  });

  it('removing session:manage from the Viewer yields SELF_SERVICE_MISSING', () => {
    expect(check(withoutGrant('CUSTOMER_VIEWER', 'session:manage'))).toEqual([
      expect.objectContaining({ code: 'SELF_SERVICE_MISSING', role: 'CUSTOMER_VIEWER', permission: 'session:manage' }),
    ]);
  });
});

describe('role scope agrees with the key prefix (PR8-SEC-02, PR #8 n3)', () => {
  it('swapping the scopes of customer Shipper and operator Sales fails, even when the "operator" Shipper gains audit:read', () => {
    const swap = (seed: Seed): Seed =>
      seed.map((candidate) => {
        if (candidate.key === 'CUSTOMER_SHIPPER') return { ...candidate, scope: 'OPERATOR' as const };
        if (candidate.key === 'OPERATOR_SALES') return { ...candidate, scope: 'CUSTOMER' as const };
        return candidate;
      });
    const violations = check(swap(withGrant('CUSTOMER_SHIPPER', 'audit:read')));
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ROLE_SCOPE_MISMATCH', role: 'CUSTOMER_SHIPPER' }),
        expect.objectContaining({ code: 'ROLE_SCOPE_MISMATCH', role: 'OPERATOR_SALES' }),
      ]),
    );
    expect(violations.filter((v) => v.code === 'ROLE_COUNT')).toEqual([]);
  });

  it.each([
    ['shipment:any_org:read', 'CUSTOMER_VIEWER'],
    ['org:any_org', 'CUSTOMER_SHIPPER'],
  ])('a mis-placed scope qualifier "%s" held by %s fails (operator-only by rule, format rejected)', (key, roleKey) => {
    const category = key.split(':')[0] as PermissionDefinition['category'];
    const catalogue: PermissionDefinition[] = [...PERMISSION_DEFINITIONS, { key, description: 'x', category, operatorOnly: false }];
    const violations = check(withGrant('OPERATOR_SUPER_ADMIN', key, withGrant(roleKey, key)), catalogue);
    expect(codes(violations)).toEqual(expect.arrayContaining(['PERMISSION_FORMAT', 'PERMISSION_OPERATOR_ONLY_MISMATCH']));
  });

  it('audit_trail:read filed under category audit and held by the Viewer fails', () => {
    const trail: PermissionDefinition = { key: 'audit_trail:read', description: 'x', category: 'audit', operatorOnly: false };
    const violations = check(withGrant('OPERATOR_SUPER_ADMIN', trail.key, withGrant('CUSTOMER_VIEWER', trail.key)), [
      ...PERMISSION_DEFINITIONS,
      trail,
    ]);
    expect(violations).toEqual([expect.objectContaining({ code: 'PERMISSION_CATEGORY_MISMATCH', permission: 'audit_trail:read' })]);
  });
});
