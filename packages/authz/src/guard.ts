/**
 * Build-time guards of the catalogue and the role seed (REQ-RBAC-001, REQ-RBAC-004, DR-A07, ADR-0008 §3). Pure
 * functions over plain data, so a test can feed a mutated seed and assert the violation names the role and the
 * permission; an empty result means the seed cannot silently escalate privileges.
 */
import {
  isOperatorOnlyKey,
  isReadPermission,
  PERMISSION_CATEGORIES,
  PERMISSION_KEY_FORMAT,
  type PermissionDefinition,
} from './permissions/index.js';
import { COMPLIANCE_AUDITOR_ROLE, CUSTOMER_VIEWER_ROLE, type RoleDefinition, type RoleScope, SUPER_ADMIN_ROLE } from './roles.js';

export type ViolationCode =
  | 'PERMISSION_FORMAT'
  | 'PERMISSION_DUPLICATE'
  | 'PERMISSION_OPERATOR_ONLY_MISMATCH'
  | 'PERMISSION_CATEGORY_UNKNOWN'
  | 'PERMISSION_UNHELD'
  | 'ROLE_COUNT'
  | 'ROLE_DUPLICATE'
  | 'ROLE_MISSING'
  | 'GRANT_UNKNOWN'
  | 'GRANT_DUPLICATE'
  | 'SIGNATURE_PERMISSION_HELD'
  | 'RESERVED_HELD'
  | 'OPERATOR_ONLY_ESCALATION'
  | 'SUPER_ADMIN_INCOMPLETE'
  | 'AUDITOR_NOT_READ_ONLY'
  | 'VIEWER_NOT_READ_ONLY'
  | 'VIEWER_EXFILTRATION'
  | 'TRACKING_READ_MISSING';

export interface Violation {
  readonly code: ViolationCode;
  readonly message: string;
  readonly role?: string;
  readonly permission?: string;
}

/** Seeded role count per scope (REQ-RBAC-002/003). */
export const EXPECTED_ROLE_COUNTS: Readonly<Record<RoleScope, number>> = { OPERATOR: 8, CUSTOMER: 5, PARTNER: 4 };

/** Permissions the customer Viewer never holds although it may see the metadata (D-051, SEC-P3-09 item 3). */
export const VIEWER_FORBIDDEN: readonly string[] = ['document:download', 'document:email', 'privacy:export'];

/** A holder of the first permission must also hold the second (ADR-0008 amendment, A-074). */
export const IMPLIED_GRANTS: ReadonlyArray<readonly [string, string]> = [['shipment:create', 'tracking:read']];

type AnyRole = RoleDefinition<string, string>;

const violation = (code: ViolationCode, message: string, role?: string, permission?: string): Violation => ({
  code,
  message,
  ...(role === undefined ? {} : { role }),
  ...(permission === undefined ? {} : { permission }),
});

/** Format, uniqueness and operator-only consistency of the catalogue (AT-US-065-02). */
export function checkCatalogue(catalogue: readonly PermissionDefinition[]): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  const categories: ReadonlySet<string> = new Set(PERMISSION_CATEGORIES);
  for (const { key, operatorOnly, category } of catalogue) {
    if (!categories.has(category)) {
      violations.push(violation('PERMISSION_CATEGORY_UNKNOWN', `"${key}" has the unknown category "${category}"`, undefined, key));
    }
    if (!PERMISSION_KEY_FORMAT.test(key)) {
      violations.push(violation('PERMISSION_FORMAT', `"${key}" is not resource:action[:qualifier] with [a-z_] segments`, undefined, key));
    }
    if (seen.has(key)) violations.push(violation('PERMISSION_DUPLICATE', `"${key}" is declared more than once`, undefined, key));
    seen.add(key);
    if (operatorOnly !== isOperatorOnlyKey(key)) {
      violations.push(
        violation(
          'PERMISSION_OPERATOR_ONLY_MISMATCH',
          `"${key}" has operatorOnly=${String(operatorOnly)}, DR-A07 says ${String(!operatorOnly)}`,
          undefined,
          key,
        ),
      );
    }
  }
  return violations;
}

function checkRoleSet(roles: readonly AnyRole[]): Violation[] {
  const violations: Violation[] = [];
  const keys = new Set<string>();
  for (const role of roles) {
    if (keys.has(role.key)) violations.push(violation('ROLE_DUPLICATE', `role ${role.key} is declared more than once`, role.key));
    keys.add(role.key);
  }
  for (const [scope, expected] of Object.entries(EXPECTED_ROLE_COUNTS)) {
    const actual = roles.filter((role) => role.scope === scope).length;
    if (actual !== expected) violations.push(violation('ROLE_COUNT', `${scope} has ${String(actual)} roles, expected ${String(expected)}`));
  }
  for (const required of [SUPER_ADMIN_ROLE, COMPLIANCE_AUDITOR_ROLE, CUSTOMER_VIEWER_ROLE]) {
    if (!keys.has(required)) violations.push(violation('ROLE_MISSING', `role ${required} is missing`, required));
  }
  return violations;
}

function checkGrants(role: AnyRole, byKey: ReadonlyMap<string, PermissionDefinition>): Violation[] {
  const violations: Violation[] = [];
  const held = new Set<string>();
  const name = `${role.scope} role ${role.key}`;
  for (const key of role.permissions) {
    if (held.has(key)) violations.push(violation('GRANT_DUPLICATE', `${name} lists "${key}" twice`, role.key, key));
    held.add(key);
    const definition = byKey.get(key);
    if (definition === undefined) {
      violations.push(violation('GRANT_UNKNOWN', `${name} holds "${key}", which is not in the catalogue`, role.key, key));
      continue;
    }
    if (definition.signatureOnly === true) {
      violations.push(violation('SIGNATURE_PERMISSION_HELD', `${name} holds the signature-only permission "${key}"`, role.key, key));
    }
    if (definition.reserved === true && role.key !== SUPER_ADMIN_ROLE) {
      violations.push(violation('RESERVED_HELD', `${name} holds the reserved seam "${key}" (Super Admin only)`, role.key, key));
    }
    if (definition.operatorOnly && role.scope !== 'OPERATOR') {
      violations.push(violation('OPERATOR_ONLY_ESCALATION', `${name} holds the operator-only permission "${key}" (DR-A07)`, role.key, key));
    }
    if (role.key === COMPLIANCE_AUDITOR_ROLE && !isReadPermission(key) && definition.category !== 'audit') {
      violations.push(
        violation('AUDITOR_NOT_READ_ONLY', `Compliance Auditor holds "${key}", which is neither read nor audit`, role.key, key),
      );
    }
    if (role.key === CUSTOMER_VIEWER_ROLE && !isReadPermission(key)) {
      violations.push(violation('VIEWER_NOT_READ_ONLY', `Viewer (${role.key}) holds the non-read permission "${key}"`, role.key, key));
    }
    if (role.key === CUSTOMER_VIEWER_ROLE && VIEWER_FORBIDDEN.includes(key)) {
      violations.push(violation('VIEWER_EXFILTRATION', `Viewer (${role.key}) must never hold "${key}" (D-051)`, role.key, key));
    }
  }
  for (const [holder, implied] of IMPLIED_GRANTS) {
    if (held.has(holder) && !held.has(implied)) {
      violations.push(violation('TRACKING_READ_MISSING', `${name} holds "${holder}" but not "${implied}"`, role.key, implied));
    }
  }
  return violations;
}

/**
 * Every invariant of REQ-RBAC-004, DR-A07 and ADR-0008 §3 over a catalogue and a role seed. Super Admin holds every
 * role-assignable permission; every other non-reserved, role-assignable permission is held by at least one role
 * besides Super Admin (otherwise it is dead or should be marked reserved).
 */
export function checkRoleInvariants(catalogue: readonly PermissionDefinition[], roles: readonly AnyRole[]): Violation[] {
  const byKey = new Map(catalogue.map((definition) => [definition.key, definition]));
  const violations = [...checkRoleSet(roles), ...roles.flatMap((role) => checkGrants(role, byKey))];
  const superAdmin = new Set(roles.find((role) => role.key === SUPER_ADMIN_ROLE)?.permissions);
  const heldElsewhere = new Set(roles.filter((role) => role.key !== SUPER_ADMIN_ROLE).flatMap((role) => role.permissions));
  for (const { key, reserved, signatureOnly } of catalogue) {
    if (signatureOnly === true) continue;
    if (!superAdmin.has(key))
      violations.push(violation('SUPER_ADMIN_INCOMPLETE', `Super Admin does not hold "${key}"`, SUPER_ADMIN_ROLE, key));
    if (reserved !== true && !heldElsewhere.has(key)) {
      violations.push(
        violation('PERMISSION_UNHELD', `"${key}" is held by no role besides Super Admin; grant it or mark it reserved`, undefined, key),
      );
    }
  }
  return violations;
}
