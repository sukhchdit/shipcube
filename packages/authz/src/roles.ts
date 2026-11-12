/**
 * The seeded roles (REQ-RBAC-002/003, ADR-0008 §2, data-model §3.3): 8 operator, 5 customer and 4 partner roles, the
 * single source for the seed migration and the generated role-permission matrix document. Grants come from the
 * REQ-ACCT scope note (customer roles), the ADR-0008 amendment (`carrier:status:read`) and DR-A07; where the
 * requirements are silent the role gets the least privilege that serves its job in this run. A grant change bumps
 * CATALOGUE_VERSION and ships as a new seed migration (applied migrations are immutable).
 */
import { PERMISSION_DEFINITIONS, type Permission } from './permissions/index.js';

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

/** Every permission a role can hold: the catalogue minus the signature-authenticated webhook permissions. */
const ROLE_ASSIGNABLE: readonly Permission[] = PERMISSION_DEFINITIONS.filter((permission) => permission.signatureOnly !== true).map(
  (permission) => permission.key,
);

/** What a customer organisation can be granted: no operator-only, reserved or webhook permission. */
const CUSTOMER_GRANTABLE: readonly Permission[] = PERMISSION_DEFINITIONS.filter(
  (permission) => !permission.operatorOnly && permission.reserved !== true && permission.signatureOnly !== true,
).map((permission) => permission.key);

/** Own sessions, notification log and preferences: what every member needs to look after their own account. */
const OWN_ACCOUNT: readonly Permission[] = ['session:manage', 'notification:read', 'notification_pref:manage'];

const without = (base: readonly Permission[], ...removed: readonly Permission[]): Permission[] =>
  base.filter((permission) => !removed.includes(permission));

/** Grants in catalogue order, without duplicates, so the seed and the matrix document are stable. */
const grants = (...sets: ReadonlyArray<readonly Permission[]>): readonly Permission[] => {
  const wanted = new Set(sets.flat());
  return PERMISSION_DEFINITIONS.map((permission) => permission.key).filter((key) => wanted.has(key));
};

const CUSTOMER_OWNER: readonly Permission[] = CUSTOMER_GRANTABLE;

export const ROLES: readonly RoleDefinition<Permission, RoleKey>[] = [
  // --- Operator (8) -------------------------------------------------------------------------------------------
  {
    key: 'OPERATOR_SUPER_ADMIN',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.super_admin',
    description: 'Full platform administration; holds every role-assignable permission (REQ-RBAC-004).',
    permissions: grants(ROLE_ASSIGNABLE),
  },
  {
    key: 'OPERATOR_ADMIN',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.admin',
    description: 'Platform administration: feature flags, carrier health and the operator organisation profile.',
    permissions: grants(['featureflag:manage', 'carrier:status:read', 'org:read'], OWN_ACCOUNT),
  },
  {
    key: 'OPERATOR_OPERATIONS',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.operations',
    description: 'Shipping operations: carrier health.',
    permissions: grants(['carrier:status:read'], OWN_ACCOUNT),
  },
  {
    key: 'OPERATOR_FINANCE',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.finance',
    description: 'Platform finance; refunds and reconciliation arrive in M2.',
    permissions: grants(OWN_ACCOUNT),
  },
  {
    key: 'OPERATOR_SUPPORT',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.support',
    description: 'Customer support: carrier health.',
    permissions: grants(['carrier:status:read'], OWN_ACCOUNT),
  },
  {
    key: 'OPERATOR_SALES',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.sales',
    description: 'Sales; customer account tooling arrives in a later milestone.',
    permissions: grants(OWN_ACCOUNT),
  },
  {
    key: 'OPERATOR_COMPLIANCE_AUDITOR',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.compliance_auditor',
    description: 'Read-only compliance review of the audit trail (REQ-RBAC-004: read and audit permissions only).',
    permissions: grants(['audit:read', 'carrier:status:read', 'notification:read']),
  },
  {
    key: 'OPERATOR_CONTENT_MANAGER',
    scope: 'OPERATOR',
    nameKey: 'roles.operator.content_manager',
    description: 'Content and templates; the content tooling arrives in a later milestone.',
    permissions: grants(OWN_ACCOUNT),
  },
  // --- Customer (5), REQ-ACCT scope note --------------------------------------------------------------------------
  {
    key: 'CUSTOMER_OWNER',
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.owner',
    description: 'Owns the customer organisation; holds every customer permission.',
    permissions: grants(CUSTOMER_OWNER),
  },
  {
    key: 'CUSTOMER_ADMIN',
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.admin',
    description: 'Administers the customer organisation; everything the owner holds except account deletion.',
    permissions: grants(without(CUSTOMER_OWNER, 'privacy:delete')),
  },
  {
    key: 'CUSTOMER_SHIPPER',
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.shipper',
    description: 'Quotes, books, pays for and tracks shipments; no member, profile, payment-method or payment-history access.',
    permissions: grants(
      without(CUSTOMER_OWNER, 'org:update', 'org:member:invite', 'org:member:manage', 'payment_method:manage', 'payment:read'),
    ),
  },
  {
    key: 'CUSTOMER_FINANCE',
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.finance',
    description: 'Views payments, shipments and documents and downloads documents.',
    permissions: grants(['payment:read', 'shipment:read', 'document:read', 'document:download', 'session:manage', 'notification:read']),
  },
  {
    key: 'CUSTOMER_VIEWER',
    scope: 'CUSTOMER',
    nameKey: 'roles.customer.viewer',
    description: 'Read-only; never downloads, e-mails or exports (D-051).',
    permissions: grants([
      'quote:read',
      'shipment:read',
      'order:read',
      'pickup:read',
      'tracking:read',
      'document:read',
      'org:read',
      'address_book:read',
      'notification:read',
    ]),
  },
  // --- Partner (4), data only in this run (REQ-RBAC-003) ----------------------------------------------------------
  {
    key: 'PARTNER_OWNER',
    scope: 'PARTNER',
    nameKey: 'roles.partner.owner',
    description: 'Owns the partner organisation (M3 seam).',
    permissions: grants(['org:read', 'org:update', 'org:member:invite', 'org:member:manage'], OWN_ACCOUNT),
  },
  {
    key: 'PARTNER_DEVELOPER',
    scope: 'PARTNER',
    nameKey: 'roles.partner.developer',
    description: 'Integrates with the partner API (M3 seam).',
    permissions: grants(['org:read'], OWN_ACCOUNT),
  },
  {
    key: 'PARTNER_OPERATIONS',
    scope: 'PARTNER',
    nameKey: 'roles.partner.operations',
    description: 'Partner shipping operations (M3 seam).',
    permissions: grants(['org:read'], OWN_ACCOUNT),
  },
  {
    key: 'PARTNER_FINANCE',
    scope: 'PARTNER',
    nameKey: 'roles.partner.finance',
    description: 'Partner finance (M3 seam).',
    permissions: grants(['org:read'], OWN_ACCOUNT),
  },
];

/** Roles an organisation Owner or Admin may assign by invitation (REQ-ACCT-014); partner roles are never offered. */
export const ASSIGNABLE_CUSTOMER_ROLES: readonly RoleKey[] = ROLES.filter((role) => role.scope === 'CUSTOMER').map((role) => role.key);
