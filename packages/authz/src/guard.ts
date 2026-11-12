/**
 * Build-time guards of the catalogue and the role seed (REQ-RBAC-001, REQ-RBAC-004, DR-A07, ADR-0008 §3, D-058). Pure
 * functions over plain data, so a test can feed a mutated seed and assert the violation names the role and the
 * permission; an empty result means the seed cannot silently escalate privileges. Every rule is keyed on the
 * permission key or on a flag the catalogue guard ties to the key; the free-text `category` never decides access.
 */
import {
  expectedCategory,
  isAuditPermission,
  isOperatorOnlyKey,
  isReadPermission,
  type Permission,
  PERMISSION_CATEGORIES,
  PERMISSION_KEY_FORMAT,
  type PermissionDefinition,
  permissionVerb,
  SCOPE_QUALIFIERS,
  SELF_SERVICE_CATEGORIES,
  SELF_SERVICE_PERMISSIONS,
} from './permissions/index.js';
import { COMPLIANCE_AUDITOR_ROLE, CUSTOMER_VIEWER_ROLE, type RoleDefinition, type RoleScope, SUPER_ADMIN_ROLE } from './roles.js';

export type ViolationCode =
  | 'PERMISSION_FORMAT'
  | 'PERMISSION_DUPLICATE'
  | 'PERMISSION_OPERATOR_ONLY_MISMATCH'
  | 'PERMISSION_CATEGORY_UNKNOWN'
  | 'PERMISSION_CATEGORY_MISMATCH'
  | 'PERMISSION_UNHELD'
  | 'SIGNATURE_FLAG_MISMATCH'
  | 'SELF_SERVICE_FLAG_MISMATCH'
  | 'SELF_SERVICE_INVALID'
  | 'ROLE_COUNT'
  | 'ROLE_DUPLICATE'
  | 'ROLE_MISSING'
  | 'ROLE_SCOPE_MISMATCH'
  | 'GRANT_UNKNOWN'
  | 'GRANT_DUPLICATE'
  | 'SIGNATURE_PERMISSION_HELD'
  | 'RESERVED_HELD'
  | 'OPERATOR_ONLY_ESCALATION'
  | 'SUPER_ADMIN_INCOMPLETE'
  | 'AUDITOR_NOT_READ_ONLY'
  | 'VIEWER_NOT_READ_ONLY'
  | 'VIEWER_EXFILTRATION'
  | 'SELF_SERVICE_MISSING'
  | 'IMPLIED_GRANT_MISSING';

export interface Violation {
  readonly code: ViolationCode;
  readonly message: string;
  readonly role?: string;
  readonly permission?: string;
}

/** Seeded role count per scope (REQ-RBAC-002/003). */
export const EXPECTED_ROLE_COUNTS: Readonly<Record<RoleScope, number>> = { OPERATOR: 8, CUSTOMER: 5, PARTNER: 4 };

/** Permissions the customer Viewer never holds although it may see the metadata (D-051, SEC-P3-09 item 3, D-058). */
export const VIEWER_FORBIDDEN: readonly Permission[] = ['document:download', 'document:email', 'privacy:export', 'privacy:delete'];

/** A holder of the first permission must also hold the second (ADR-0008 amendment, A-074). */
export const IMPLIED_GRANTS: readonly (readonly [Permission, Permission])[] = [['shipment:create', 'tracking:read']];

type AnyRole = RoleDefinition<string, string>;

const SELF_SERVICE: ReadonlySet<string> = new Set(SELF_SERVICE_PERMISSIONS);
const VIEWER_FORBIDDEN_KEYS: ReadonlySet<string> = new Set(VIEWER_FORBIDDEN);

const violation = (code: ViolationCode, message: string, role?: string, permission?: string): Violation => ({
  code,
  message,
  ...(role === undefined ? {} : { role }),
  ...(permission === undefined ? {} : { permission }),
});

/** Key shape: the format, no scope qualifier outside the third segment, no verb in both action and qualifier (n5). */
function checkKeyShape(key: string, verbs: ReadonlySet<string>): string | undefined {
  if (!PERMISSION_KEY_FORMAT.test(key)) return 'is not resource:action[:qualifier] with [a-z_] segments';
  const segments = key.split(':');
  const [, action = '', qualifier] = segments;
  if (segments.slice(0, 2).some((segment) => SCOPE_QUALIFIERS.has(segment))) {
    return 'uses a scope qualifier outside the third segment';
  }
  if (qualifier !== undefined && !SCOPE_QUALIFIERS.has(qualifier) && verbs.has(action)) {
    return `names the verb "${action}" as its action and "${qualifier}" as its qualifier`;
  }
  return undefined;
}

/** The D-058 constraints on a `selfService` entry: own-account only, never operator-only, reserved or signature-only. */
function selfServiceProblem({ operatorOnly, reserved, signatureOnly, category }: PermissionDefinition): string | undefined {
  if (operatorOnly || reserved === true || signatureOnly === true) return 'is self-service and operator-only, reserved or signature-only';
  if (!SELF_SERVICE_CATEGORIES.has(category)) return `is self-service but its category "${category}" is not session or notification`;
  return undefined;
}

/**
 * Format, uniqueness and flag consistency of the catalogue (AT-US-065-02, PR8-SEC-02, PR8-SEC-04): `operatorOnly`
 * equals the DR-A07 rule, `category` equals the resource (or its `CATEGORY_EXCEPTIONS` entry), `signatureOnly` holds
 * exactly for `webhook:*`, and the `selfService` flags are exactly `SELF_SERVICE_PERMISSIONS`.
 */
export function checkCatalogue(catalogue: readonly PermissionDefinition[]): Violation[] {
  const violations: Violation[] = [];
  const add = (code: ViolationCode, key: string, message: string): void => {
    violations.push(violation(code, `"${key}" ${message}`, undefined, key));
  };
  const seen = new Set<string>();
  const categories: ReadonlySet<string> = new Set(PERMISSION_CATEGORIES);
  const verbs: ReadonlySet<string> = new Set(catalogue.map(({ key }) => permissionVerb(key)));
  for (const definition of catalogue) {
    const { key, operatorOnly, category, signatureOnly, selfService } = definition;
    const shape = checkKeyShape(key, verbs);
    if (shape !== undefined) add('PERMISSION_FORMAT', key, shape);
    if (!categories.has(category)) add('PERMISSION_CATEGORY_UNKNOWN', key, `has the unknown category "${category}"`);
    else if (shape === undefined && category !== expectedCategory(key)) {
      add('PERMISSION_CATEGORY_MISMATCH', key, `has the category "${category}", its resource requires "${expectedCategory(key)}"`);
    }
    if (seen.has(key)) add('PERMISSION_DUPLICATE', key, 'is declared more than once');
    seen.add(key);
    if (operatorOnly !== isOperatorOnlyKey(key)) {
      add('PERMISSION_OPERATOR_ONLY_MISMATCH', key, `has operatorOnly=${String(operatorOnly)}, DR-A07 says ${String(!operatorOnly)}`);
    }
    if ((signatureOnly === true) !== (category === 'webhook' && key.startsWith('webhook:'))) {
      add('SIGNATURE_FLAG_MISMATCH', key, 'must be signature-only exactly when it is a webhook:* permission of category webhook');
    }
    if ((selfService === true) !== SELF_SERVICE.has(key)) {
      add('SELF_SERVICE_FLAG_MISMATCH', key, 'must be flagged selfService exactly when it is in SELF_SERVICE_PERMISSIONS (D-058)');
    }
    const problem = selfService === true ? selfServiceProblem(definition) : undefined;
    if (problem !== undefined) add('SELF_SERVICE_INVALID', key, problem);
  }
  for (const key of SELF_SERVICE_PERMISSIONS) {
    if (!seen.has(key)) add('SELF_SERVICE_FLAG_MISMATCH', key, 'is in SELF_SERVICE_PERMISSIONS but not in the catalogue');
  }
  return violations;
}

function checkRoleSet(roles: readonly AnyRole[]): Violation[] {
  const violations: Violation[] = [];
  const keys = new Set<string>();
  for (const role of roles) {
    if (keys.has(role.key)) violations.push(violation('ROLE_DUPLICATE', `role ${role.key} is declared more than once`, role.key));
    keys.add(role.key);
    if (!role.key.startsWith(`${role.scope}_`)) {
      violations.push(
        violation('ROLE_SCOPE_MISMATCH', `role ${role.key} declares scope ${role.scope}, its key prefix disagrees`, role.key),
      );
    }
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

/** The read-only rules of REQ-RBAC-004; the carve-out is the catalogue's `selfService` flag only (D-058 (c)). */
function readOnlyViolations(role: AnyRole, definition: PermissionDefinition): Violation[] {
  const { key } = definition;
  const exempt = definition.selfService === true;
  const violations: Violation[] = [];
  if (role.key === COMPLIANCE_AUDITOR_ROLE && !exempt && !isReadPermission(key) && !isAuditPermission(key)) {
    violations.push(
      violation('AUDITOR_NOT_READ_ONLY', `Compliance Auditor holds "${key}", which is neither read, audit nor self-service`, role.key, key),
    );
  }
  if (role.key === CUSTOMER_VIEWER_ROLE && !exempt && !isReadPermission(key)) {
    violations.push(violation('VIEWER_NOT_READ_ONLY', `Viewer (${role.key}) holds the non-read permission "${key}"`, role.key, key));
  }
  if (role.key === CUSTOMER_VIEWER_ROLE && VIEWER_FORBIDDEN_KEYS.has(key)) {
    violations.push(violation('VIEWER_EXFILTRATION', `Viewer (${role.key}) must never hold "${key}" (D-051)`, role.key, key));
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
    violations.push(...readOnlyViolations(role, definition));
  }
  for (const key of SELF_SERVICE_PERMISSIONS) {
    if (!held.has(key)) {
      violations.push(
        violation('SELF_SERVICE_MISSING', `${name} does not hold the self-service permission "${key}" (D-058)`, role.key, key),
      );
    }
  }
  for (const [holder, implied] of IMPLIED_GRANTS) {
    if (held.has(holder) && !held.has(implied)) {
      violations.push(violation('IMPLIED_GRANT_MISSING', `${name} holds "${holder}" but not "${implied}"`, role.key, implied));
    }
  }
  return violations;
}

/**
 * Every invariant of REQ-RBAC-004, DR-A07, ADR-0008 §3 and D-058 over a catalogue and a role seed, including the
 * catalogue checks (so a `selfService` or `category` edit is never trusted unchecked). Super Admin holds every
 * role-assignable permission; every role holds the self-service set; every other non-reserved, role-assignable
 * permission is held by at least one role besides Super Admin (otherwise it is dead or should be marked reserved).
 */
export function checkRoleInvariants(catalogue: readonly PermissionDefinition[], roles: readonly AnyRole[]): Violation[] {
  const byKey = new Map(catalogue.map((definition) => [definition.key, definition]));
  const violations = [...checkCatalogue(catalogue), ...checkRoleSet(roles), ...roles.flatMap((role) => checkGrants(role, byKey))];
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
