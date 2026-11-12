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
}
