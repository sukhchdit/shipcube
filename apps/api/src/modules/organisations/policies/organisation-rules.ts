/**
 * Organisation and membership rules (REQ-ORG-001..004, DR-A05, DR-A06; US-061, US-062; TASK-037). Pure: no I/O. The
 * database repeats every rule as a backstop (CHECK constraints, `ux_organisations__single_operator`,
 * `trg_organisations__type_immutable`, `trg_membership_roles__scope_matches_org`, `ux_memberships__org_user_live`),
 * so a service bug cannot bypass them; the service checks first so the caller gets a catalogue code, not a database
 * error.
 *
 * Refusals are `OrganisationRuleError` with the catalogue code the route returns (ORG_TYPE_NOT_ALLOWED and
 * ROLE_NOT_ALLOWED_FOR_ORG_TYPE are 422 in the error catalogue, TASK-036); the routes that expose these operations
 * (createOrganisation TASK-224, updateMember TASK-231, register TASK-049) map it to the problem response through
 * `organisationRuleProblemCode`. MEMBERSHIP_STATUS_NOT_WRITABLE is internal-only and answers 500 INTERNAL_ERROR.
 */
import { isRoleKey, ROLES, type RoleKey, type RoleScope } from '@platform/authz';
import type { ErrorCode } from '@platform/shared';

export const ORG_TYPES = ['OPERATOR', 'BUSINESS_CUSTOMER', 'PARTNER', 'INDIVIDUAL'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** Membership statuses the platform writes. INVITED is a reserved CHECK value only (D-ARCH-123, data-model §1.7). */
export const WRITABLE_MEMBERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'] as const;
export type MembershipStatus = (typeof WRITABLE_MEMBERSHIP_STATUSES)[number];

/** The only type a user may create through the API (REQ-ORG-001, REQ-ORG-009): never PARTNER or a second OPERATOR. */
export const CREATABLE_ORG_TYPE: OrgType = 'BUSINESS_CUSTOMER';

/** The role every personal organisation's owner holds (REQ-ORG-002). */
export const PERSONAL_ORG_OWNER_ROLE: RoleKey = 'CUSTOMER_OWNER';

/**
 * Refusals a route returns as the problem response of the same code (422 in the error catalogue). Typed against
 * `ErrorCode` (PR #63 code review R1-m2): a code that is not catalogued, or a typo, fails the type check here.
 */
export const ORGANISATION_REFUSAL_CODES = ['ORG_TYPE_NOT_ALLOWED', 'ROLE_NOT_ALLOWED_FOR_ORG_TYPE'] as const satisfies readonly ErrorCode[];
export type OrganisationRefusalCode = Extract<ErrorCode, (typeof ORGANISATION_REFUSAL_CODES)[number]>;

/**
 * Internal-only codes (api/README.md §11 "Internal / start-up only"; D-TASK037-08). MEMBERSHIP_STATUS_NOT_WRITABLE
 * cannot be caused by a valid request: `MembershipPatch.status` is the closed enum ACTIVE | SUSPENDED (any other value
 * is 400 VALIDATION_ERROR at the route), REMOVED is written only by `removeMember`, which takes no status, and INVITED
 * is never written (D-ARCH-123). It therefore marks a programming error, never a client error, and surfaces as 500
 * INTERNAL_ERROR (see {@link organisationRuleProblemCode}). It is not in the error catalogue on purpose.
 */
export const ORGANISATION_INTERNAL_CODES = ['MEMBERSHIP_STATUS_NOT_WRITABLE'] as const;
export type OrganisationInternalCode = (typeof ORGANISATION_INTERNAL_CODES)[number];

export const ORGANISATION_RULE_CODES = [...ORGANISATION_REFUSAL_CODES, ...ORGANISATION_INTERNAL_CODES] as const;
export type OrganisationRuleCode = OrganisationRefusalCode | OrganisationInternalCode;

export class OrganisationRuleError extends Error {
  override readonly name = 'OrganisationRuleError';
  readonly code: OrganisationRuleCode;

  constructor(code: OrganisationRuleCode, message: string = code) {
    super(message);
    this.code = code;
  }
}

/** True for a refusal code a route returns as is; false for an internal-only code. */
export function isOrganisationRefusalCode(code: OrganisationRuleCode): code is OrganisationRefusalCode {
  return (ORGANISATION_REFUSAL_CODES as readonly string[]).includes(code);
}

/**
 * The catalogue code a route answers for an `OrganisationRuleError`: the refusal code itself, or INTERNAL_ERROR for an
 * internal-only code (generic 500 detail; the rule code goes to the log, never to the client).
 */
export function organisationRuleProblemCode(code: OrganisationRuleCode): ErrorCode {
  return isOrganisationRefusalCode(code) ? code : 'INTERNAL_ERROR';
}

export function isOrgType(value: unknown): value is OrgType {
  return typeof value === 'string' && (ORG_TYPES as readonly string[]).includes(value);
}

/** The role scope an organisation type admits (data-model §3.2 `membership_roles`). */
export function roleScopeForOrgType(type: OrgType): RoleScope {
  if (type === 'OPERATOR') return 'OPERATOR';
  if (type === 'PARTNER') return 'PARTNER';
  return 'CUSTOMER';
}

/** AT-US-061-02: only BUSINESS_CUSTOMER can be created on request; PARTNER (M3) and OPERATOR (exactly one) never. */
export function assertCreatableOrgType(type: unknown): asserts type is typeof CREATABLE_ORG_TYPE {
  if (type !== CREATABLE_ORG_TYPE)
    throw new OrganisationRuleError('ORG_TYPE_NOT_ALLOWED', 'only BUSINESS_CUSTOMER organisations can be created');
}

/** AT-US-062-02: a role is assignable in an organisation only when its scope matches the organisation type. */
export function assertRoleAllowed(orgType: OrgType, roleKey: string): RoleKey {
  const role = isRoleKey(roleKey) ? ROLES.find((candidate) => candidate.key === roleKey) : undefined;
  if (role === undefined || role.scope !== roleScopeForOrgType(orgType)) {
    throw new OrganisationRuleError('ROLE_NOT_ALLOWED_FOR_ORG_TYPE', 'the role does not belong to the organisation type');
  }
  return role.key;
}

/** No code writes INVITED (D-ARCH-123); the pending state of an invitation is the invitations row. */
export function assertWritableMembershipStatus(status: unknown): asserts status is MembershipStatus {
  if (typeof status !== 'string' || !(WRITABLE_MEMBERSHIP_STATUSES as readonly string[]).includes(status)) {
    throw new OrganisationRuleError('MEMBERSHIP_STATUS_NOT_WRITABLE', 'membership status must be ACTIVE, SUSPENDED or REMOVED');
  }
}

/** `ck_organisations__display_name`: 1..120 characters (PostgreSQL counts code points). */
export const ORGANISATION_NAME_MAX = 120;

/**
 * An organisation display name as stored: NFC, trimmed, at most 120 code points (never a split surrogate pair, which
 * PostgreSQL would store as U+FFFD), trimmed again after the cut (code review R1-n2). Both create paths use it.
 */
export function organisationDisplayName(displayName: string): string {
  const name = Array.from(displayName.normalize('NFC').trim()).slice(0, ORGANISATION_NAME_MAX).join('').trim();
  if (name.length === 0) throw new TypeError('an organisation needs a non-empty display name');
  return name;
}

/** The display name of a personal organisation: the user's display name (REQ-ORG-002), normalised as above. */
export function personalOrganisationName(displayName: string): string {
  return organisationDisplayName(displayName);
}

export interface MembershipSnapshot {
  readonly status: MembershipStatus;
  readonly roles: readonly RoleKey[];
}

export interface MembershipChange {
  readonly old_status: MembershipStatus | null;
  readonly new_status: MembershipStatus;
  readonly roles_added: readonly RoleKey[];
  readonly roles_removed: readonly RoleKey[];
}

/**
 * AT-US-062-06: the audit detail of a membership change (old/new status and the role-set diff), recorded by the audit
 * descriptor of the route that changes it. `before` is null for a new membership. Sorted, so equal changes compare.
 */
export function membershipChange(before: MembershipSnapshot | null, after: MembershipSnapshot): MembershipChange {
  const previous = new Set(before?.roles ?? []);
  const next = new Set(after.roles);
  return {
    old_status: before?.status ?? null,
    new_status: after.status,
    roles_added: [...next].filter((role) => !previous.has(role)).sort(),
    roles_removed: [...previous].filter((role) => !next.has(role)).sort(),
  };
}
