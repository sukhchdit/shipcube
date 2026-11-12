/**
 * Shape of one permission catalogue entry (ADR-0008 §1, REQ-RBAC-001). The catalogue modules in this folder declare
 * their entries `as const satisfies readonly PermissionDefinition[]`, so the key stays a string literal and the
 * aggregated `Permission` union (./index.ts) is exact.
 */
/** Categories of the catalogue (the `permissions.category` column); the catalogue guard rejects any other value. */
export const PERMISSION_CATEGORIES = [
  'address_book',
  'audit',
  'carrier',
  'customs',
  'document',
  'featureflag',
  'notification',
  'order',
  'org',
  'payment',
  'pickup',
  'privacy',
  'quote',
  'refund',
  'session',
  'shipment',
  'tracking',
  'webhook',
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/**
 * A permission's category is its resource segment (`quote:read` -> `quote`), except for these sub-resources filed under
 * their parent context. The catalogue guard enforces it, so a category is never chosen freely; no authorisation
 * decision reads `category`, which is grouping metadata only (code review PR #8 M1).
 */
export const CATEGORY_EXCEPTIONS: ReadonlyMap<string, PermissionCategory> = new Map<string, PermissionCategory>([
  ['payment_method', 'payment'],
  ['notification_pref', 'notification'],
]);

export interface PermissionDefinition<K extends string = string> {
  /** `resource:action` or `resource:action:qualifier`, lower-case `[a-z_]` segments. */
  readonly key: K;
  readonly description: string;
  readonly category: PermissionCategory;
  /** Never held by a CUSTOMER or PARTNER role (DR-A07); must equal `isOperatorOnlyKey(key)`. */
  readonly operatorOnly: boolean;
  /** Seam for a later milestone (ADR-0008 §3, §6): catalogued now, held by Super Admin only. */
  readonly reserved?: boolean;
  /** Signature-authenticated webhook permission (ADR-0008 amendment): held by no role, not even Super Admin. */
  readonly signatureOnly?: boolean;
  /**
   * Own-account self-service permission (D-058): guards only `user`-tenancy `/me/*` routes over the caller's own rows,
   * is held by every role and is carved out of the Viewer and Compliance Auditor read-only invariants. The catalogue
   * guard requires the flagged set to equal `SELF_SERVICE_PERMISSIONS` exactly.
   */
  readonly selfService?: true;
}
