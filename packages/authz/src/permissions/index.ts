/**
 * The permission catalogue (ADR-0008 §1, REQ-RBAC-001, REQ-RBAC-014): one typed list aggregated from the
 * per-context modules of this folder. `Permission` is the union of every catalogued key, so a reference to an
 * unknown string fails type-check. `public` and `authenticated` are route markers (ADR-0008 §1), not permissions.
 */
import { ACCOUNT_PERMISSIONS } from './account.js';
import { BOOKING_PERMISSIONS } from './booking.js';
import { ORGANISATION_PERMISSIONS } from './organisation.js';
import { PAYMENTS_PERMISSIONS } from './payments.js';
import { PLATFORM_PERMISSIONS } from './platform.js';
import { QUOTING_PERMISSIONS } from './quoting.js';
import type { PermissionDefinition } from './types.js';

export { PERMISSION_CATEGORIES, type PermissionCategory, type PermissionDefinition } from './types.js';

export const PERMISSIONS = [
  ...QUOTING_PERMISSIONS,
  ...BOOKING_PERMISSIONS,
  ...PAYMENTS_PERMISSIONS,
  ...ORGANISATION_PERMISSIONS,
  ...ACCOUNT_PERMISSIONS,
  ...PLATFORM_PERMISSIONS,
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];

/** The catalogue viewed through the common entry shape (optional flags readable on every entry). */
export const PERMISSION_DEFINITIONS: readonly PermissionDefinition<Permission>[] = PERMISSIONS;

/** Route metadata markers that stand in for a permission (ADR-0008 §1, REQ-RBAC-005); never granted to a role. */
export const ROUTE_MARKERS = ['public', 'authenticated'] as const;
export type RouteMarker = (typeof ROUTE_MARKERS)[number];

/** `resource:action` or `resource:action:qualifier`, lower-case `[a-z_]` segments (REQ-RBAC-001). */
export const PERMISSION_KEY_FORMAT = /^[a-z_]+:[a-z_]+(:[a-z_]+)?$/;

/** Qualifiers that scope an action instead of naming one (`shipment:read:any_org`, `shipment:create:on_behalf`). */
export const SCOPE_QUALIFIERS: ReadonlySet<string> = new Set(['any_org', 'on_behalf']);

const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((permission) => permission.key));
const ROUTE_MARKER_KEYS: ReadonlySet<string> = new Set(ROUTE_MARKERS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_KEYS.has(value);
}

export function isRouteMarker(value: string): value is RouteMarker {
  return ROUTE_MARKER_KEYS.has(value);
}

/**
 * The operator-only rule of DR-A07 and ADR-0008 §1: any `:any_org` qualifier, `audit:*`, `featureflag:manage` and
 * `carrier:status:read`. Each catalogue entry's `operatorOnly` flag must equal this (catalogue guard).
 */
export function isOperatorOnlyKey(key: string): boolean {
  const [resource, , qualifier] = key.split(':');
  return qualifier === 'any_org' || resource === 'audit' || key === 'featureflag:manage' || key === 'carrier:status:read';
}

/**
 * The verb of a permission: the last segment, unless that is a scope qualifier, in which case the action segment
 * (`carrier:status:read` -> `read`, `org:member:invite` -> `invite`, `shipment:read:any_org` -> `read`).
 */
export function permissionVerb(key: string): string {
  const [, action, qualifier] = key.split(':');
  if (qualifier !== undefined && !SCOPE_QUALIFIERS.has(qualifier)) return qualifier;
  return String(action);
}

/** The read-only verbs: a read-only role (customer Viewer, Compliance Auditor) holds nothing else (REQ-RBAC-004). */
export const READ_ONLY_VERBS: ReadonlySet<string> = new Set(['read']);

export function isReadPermission(key: string): boolean {
  return READ_ONLY_VERBS.has(permissionVerb(key));
}

export const OPERATOR_ONLY_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((permission) => permission.operatorOnly).map(
  (permission) => permission.key,
);
