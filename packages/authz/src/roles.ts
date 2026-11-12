/**
 * The seeded roles (REQ-RBAC-002/003, ADR-0008 §2, data-model §3.3): 8 operator, 5 customer and 4 partner roles, the
 * single source for the seed migration and the generated role-permission matrix document. Grants come from the
 * REQ-ACCT scope note (customer roles), the ADR-0008 amendment (`carrier:status:read`), DR-A07 and the D-058 ruling
 * (the self-service set on every role); where the requirements are silent the role gets the least privilege that
 * serves its job in this run. A grant change bumps CATALOGUE_VERSION and ships as a new seed migration (applied
 * migrations are immutable).
 */
import { type Permission, PERMISSION_DEFINITIONS, SELF_SERVICE_PERMISSIONS } from './permissions/index.js';

export type RoleScope = 'OPERATOR' | 'CUSTOMER' | 'PARTNER';

export const ROLE_SCOPES: readonly RoleScope[] = ['OPERATOR', 'CUSTOMER', 'PARTNER'];

/** Version of the catalogue and role grants; the seed migration and the matrix document carry it. */
export const CATALOGUE_VERSION = 1;

export interface RoleDefinition<P extends string = Permission, K extends string = string> {
  readonly key: K;
  readonly scope: RoleScope;
  /** i18n key of the display name (`roles.<scope>.<name>`). */
  readonly nameKey: string;
  readonly description: string;
  readonly permissions: readonly P[];
}

export const ROLE_KEYS = [
  'OPERATOR_SUPER_ADMIN',
  'OPERATOR_ADMIN',
  'OPERATOR_OPERATIONS',
  'OPERATOR_FINANCE',
  'OPERATOR_SUPPORT',
  'OPERATOR_SALES',
  'OPERATOR_COMPLIANCE_AUDITOR',
  'OPERATOR_CONTENT_MANAGER',
  'CUSTOMER_OWNER',
  'CUSTOMER_ADMIN',
  'CUSTOMER_SHIPPER',
  'CUSTOMER_FINANCE',
  'CUSTOMER_VIEWER',
  'PARTNER_OWNER',
  'PARTNER_DEVELOPER',
  'PARTNER_OPERATIONS',
  'PARTNER_FINANCE',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const SUPER_ADMIN_ROLE: RoleKey = 'OPERATOR_SUPER_ADMIN';
export const COMPLIANCE_AUDITOR_ROLE: RoleKey = 'OPERATOR_COMPLIANCE_AUDITOR';
export const CUSTOMER_VIEWER_ROLE: RoleKey = 'CUSTOMER_VIEWER';

const ROLE_KEY_SET: ReadonlySet<string> = new Set(ROLE_KEYS);

export function isRoleKey(value: string): value is RoleKey {
  return ROLE_KEY_SET.has(value);
}

/** Every permission a role can hold: the catalogue minus the signature-authenticated webhook permissions. */
const ROLE_ASSIGNABLE: readonly Permission[] = PERMISSION_DEFINITIONS.filter((permission) => permission.signatureOnly !== true).map(
  (permission) => permission.key,
);

/** What a customer organisation can be granted: no operator-only, reserved or webhook permission. */
const CUSTOMER_GRANTABLE: readonly Permission[] = PERMISSION_DEFINITIONS.filter(
  (permission) => !permission.operatorOnly && permission.reserved !== true && permission.signatureOnly !== true,
).map((permission) => permission.key);

/** Own sessions, notification preferences and notification log: held by every role (D-058). */
const SELF_SERVICE: readonly Permission[] = SELF_SERVICE_PERMISSIONS;

const without = (base: readonly Permission[], ...removed: readonly Permission[]): Permission[] =>
  base.filter((permission) => !removed.includes(permission));

/** Grants in catalogue order, without duplicates, plus the self-service set, so the seed and the matrix are stable. */
const grants = (...sets: readonly (readonly Permission[])[]): readonly Permission[] => {
  const wanted = new Set([...sets.flat(), ...SELF_SERVICE]);
  return PERMISSION_DEFINITIONS.map((permission) => permission.key).filter((key) => wanted.has(key));
};

const CUSTOMER_OWNER: readonly Permission[] = CUSTOMER_GRANTABLE;

/** One entry per role key: a `Record` over `RoleKey`, so a missing or an extra role fails type-check (PR #8 n3). */
const ROLE_SPECS: { readonly [K in RoleKey]: Omit<RoleDefinition<Permission, K>, 'key'> } = {
  // --- Operator (8) -------------------------------------------------------------------------------------------
  OPERATOR_SUPER_ADMIN: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.super_admin',
    description: 'Full platform administration; holds every role-assignable permission (REQ-RBAC-004).',
    permissions: grants(ROLE_ASSIGNABLE),
  },
  OPERATOR_ADMIN: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.admin',
    description: 'Platform administration: feature flags, carrier health and the operator organisation profile.',
    permissions: grants(['featureflag:manage', 'carrier:status:read', 'org:read']),
  },
  OPERATOR_OPERATIONS: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.operations',
    description: 'Shipping operations: carrier health.',
    permissions: grants(['carrier:status:read']),
  },
  OPERATOR_FINANCE: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.finance',
    description: 'Platform finance; refunds and reconciliation arrive in M2.',
    permissions: grants(),
  },
  OPERATOR_SUPPORT: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.support',
    description: 'Customer support: carrier health.',
    permissions: grants(['carrier:status:read']),
  },
  OPERATOR_SALES: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.sales',
    description: 'Sales; customer account tooling arrives in a later milestone.',
    permissions: grants(),
  },
  OPERATOR_COMPLIANCE_AUDITOR: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.compliance_auditor',
    description: 'Read-only compliance review of the audit trail (REQ-RBAC-004: read, audit and self-service permissions only).',
    permissions: grants(['audit:read', 'carrier:status:read']),
  },
  OPERATOR_CONTENT_MANAGER: {
    scope: 'OPERATOR',
    nameKey: 'roles.operator.content_manager',
    description: 'Content and templates; the content tooling arrives in a later milestone.',
    permissions: grants(),
  },
  // --- Customer (5), REQ-ACCT scope note and D-058 --------------------------------------------------------------
  CUSTOMER_OWNER: {
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.owner',
    description: 'Owns the customer organisation; holds every customer permission.',
    permissions: grants(CUSTOMER_OWNER),
  },
  CUSTOMER_ADMIN: {
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.admin',
    description: 'Administers the customer organisation; holds every customer permission but cannot assign the Owner role (REQ-ORG-010).',
    permissions: grants(CUSTOMER_OWNER),
  },
  CUSTOMER_SHIPPER: {
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.shipper',
    description: 'Quotes, books, pays for and tracks shipments; no member, profile, payment-method or payment-history access.',
    permissions: grants(
      without(CUSTOMER_OWNER, 'org:update', 'org:member:invite', 'org:member:manage', 'payment_method:manage', 'payment:read'),
    ),
  },
  CUSTOMER_FINANCE: {
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.finance',
    description: 'Views payments, orders, shipments and documents and downloads documents.',
    permissions: grants(['payment:read', 'shipment:read', 'order:read', 'document:read', 'document:download']),
  },
  CUSTOMER_VIEWER: {
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.viewer',
    description: 'Read-only plus own-account self-service; never downloads, e-mails, exports or deletes (D-051, D-058).',
    permissions: grants([
      'quote:read',
      'shipment:read',
      'order:read',
      'pickup:read',
      'tracking:read',
      'document:read',
      'org:read',
      'address_book:read',
    ]),
  },
  // --- Partner (4), data only in this run (REQ-RBAC-003) ----------------------------------------------------------
  PARTNER_OWNER: {
    scope: 'PARTNER',
    nameKey: 'roles.partner.owner',
    description: 'Owns the partner organisation (M3 seam).',
    permissions: grants(['org:read', 'org:update', 'org:member:invite', 'org:member:manage']),
  },
  PARTNER_DEVELOPER: {
    scope: 'PARTNER',
    nameKey: 'roles.partner.developer',
    description: 'Integrates with the partner API (M3 seam).',
    permissions: grants(['org:read']),
  },
  PARTNER_OPERATIONS: {
    scope: 'PARTNER',
    nameKey: 'roles.partner.operations',
    description: 'Partner shipping operations (M3 seam).',
    permissions: grants(['org:read']),
  },
  PARTNER_FINANCE: {
    scope: 'PARTNER',
    nameKey: 'roles.partner.finance',
    description: 'Partner finance (M3 seam).',
    permissions: grants(['org:read']),
  },
};

/** The seeded roles in `ROLE_KEYS` order (operator, customer, partner). */
export const ROLES: readonly RoleDefinition<Permission, RoleKey>[] = ROLE_KEYS.map((key) => ({ key, ...ROLE_SPECS[key] }));

/**
 * The roles a customer organisation membership can hold (REQ-ACCT-014); partner roles are never offered. Who may
 * assign which of them is `canAssignRole` (REQ-ORG-010: Owner only by an Owner).
 */
export const ASSIGNABLE_CUSTOMER_ROLES: readonly RoleKey[] = ROLES.filter((role) => role.scope === 'CUSTOMER').map((role) => role.key);
