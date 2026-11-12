/**
 * The authorisation decision (REQ-RBAC-006, ADR-0008 §4) as a pure function of the caller's effective permission set.
 * Resolving that set per request from the active membership (database + 5 s cache, REQ-RBAC-008) is the job of the
 * API middleware (US-068); this module only answers allow or deny and unions role grants.
 */
import type { Permission } from './permissions/index.js';
import type { RoleDefinition } from './roles.js';

export type AuthzDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly code: 'AUTHZ_DENIED'; readonly requiredPermission: Permission };

export function authorise(granted: ReadonlySet<Permission>, required: Permission): AuthzDecision {
  return granted.has(required) ? { allowed: true } : { allowed: false, code: 'AUTHZ_DENIED', requiredPermission: required };
}

export class UnknownRoleError extends Error {
  constructor(readonly roleKey: string) {
    super(`unknown role "${roleKey}" (not in the seeded catalogue)`);
    this.name = 'UnknownRoleError';
  }
}

/**
 * Union of the grants of `roleKeys` resolved against `roles`; an unknown role key is a catalogue/database drift and
 * fails fast. `roles` is required on purpose (PR #8 n2): the API passes the role grants loaded from the database for
 * the active membership (REQ-RBAC-008), never the in-code seed `ROLES`, which only build-time tests use.
 */
export function effectivePermissions(
  roleKeys: readonly string[],
  roles: readonly RoleDefinition<Permission, string>[],
): ReadonlySet<Permission> {
  const byKey = new Map(roles.map((role) => [role.key, role]));
  const permissions = new Set<Permission>();
  for (const key of roleKeys) {
    const role = byKey.get(key);
    if (role === undefined) throw new UnknownRoleError(key);
    role.permissions.forEach((permission) => permissions.add(permission));
  }
  return permissions;
}
