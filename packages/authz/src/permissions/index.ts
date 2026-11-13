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
import { CATEGORY_EXCEPTIONS, type PermissionCategory, type PermissionDefinition } from './types.js';

export { CATEGORY_EXCEPTIONS, PERMISSION_CATEGORIES, type PermissionCategory, type PermissionDefinition } from './types.js';

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

/**
 * Sub-resources a three-segment key may name in its middle segment (`org:member:invite`, `carrier:status:read`;
 * ADR-0008 am. 3 item 2, PR #8 R2-m1). With `WEBHOOK_PROVIDERS` this is the CLOSED set of middle segments of a key
 * whose last segment is not a scope qualifier: anything else (`shipment:void:read`) hides a verb in the action
 * segment and would classify a destructive permission as `read`, so the catalogue guard rejects it (PERMISSION_FORMAT).
 */
export const SUB_RESOURCES: ReadonlySet<string> = new Set(['member', 'status']);

/** Signature-authenticated webhook providers: the middle segment of `webhook:<provider>:receive`, and only there. */
export const WEBHOOK_PROVIDERS: ReadonlySet<string> = new Set(['stripe', 'mock_gateway']);

/**
 * The only non-read permissions the Compliance Auditor may hold besides the self-service set (ADR-0008 am. 3 item 1,
 * PR #8 R2-n1): exporting the trail it reviews. Any other `audit:*` verb (a future `audit:purge`) is a violation; the
 * read-only rule no longer trusts the whole `audit:*` resource.
 */
export const AUDITOR_NON_READ_PERMISSIONS: ReadonlySet<string> = new Set(['audit:export']);

const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((permission) => permission.key));
const ROUTE_MARKER_KEYS: ReadonlySet<string> = new Set(ROUTE_MARKERS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_KEYS.has(value);
}

export function isRouteMarker(value: string): value is RouteMarker {
  return ROUTE_MARKER_KEYS.has(value);
}

/**
 * The D-058 self-service set: own sessions, own notification preferences and own notification log. Every role holds
 * it, and it is the only carve-out of the Viewer and Compliance Auditor read-only invariants. The catalogue guard
 * requires the entries flagged `selfService` to be exactly these keys; `satisfies` keeps each one catalogued.
 */
export const SELF_SERVICE_PERMISSIONS = [
  'session:manage',
  'notification_pref:manage',
  'notification:read',
] as const satisfies readonly Permission[];

/** The only categories a self-service permission may carry (own sessions, own notifications). */
export const SELF_SERVICE_CATEGORIES: ReadonlySet<PermissionCategory> = new Set<PermissionCategory>(['session', 'notification']);

/**
 * An `audit:*` permission, decided by the resource segment of the key, never by the free-text `category` (PR #8 M1).
 * The single predicate behind both the operator-only rule and the Compliance Auditor invariant.
 */
export function isAuditPermission(key: string): boolean {
  return key.split(':')[0] === 'audit';
}

/**
 * The operator-only rule of DR-A07 and ADR-0008 §1: `any_org` in any segment, `audit:*`, `featureflag:manage` and
 * `carrier:status:read`. Each catalogue entry's `operatorOnly` flag must equal this (catalogue guard), and the guard
 * also rejects a scope qualifier outside the third segment, so no key placement escapes the rule (PR8-SEC-02).
 */
export function isOperatorOnlyKey(key: string): boolean {
  return key.split(':').includes('any_org') || isAuditPermission(key) || key === 'featureflag:manage' || key === 'carrier:status:read';
}

/** The category the catalogue guard requires for a key: its resource segment, unless `CATEGORY_EXCEPTIONS` maps it. */
export function expectedCategory(key: string): string {
  const resource = String(key.split(':')[0]);
  return CATEGORY_EXCEPTIONS.get(resource) ?? resource;
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
