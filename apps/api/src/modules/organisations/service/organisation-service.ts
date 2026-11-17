/**
 * Organisations service (REQ-ORG-001..004; US-061, US-062; TASK-037). Every operation runs inside ONE tenant
 * transaction opened by the caller, whose context organisation is the organisation being written (RLS `WITH CHECK
 * id = app_org_id()`, D-TASK037-05), so a failure anywhere rolls the whole unit back (AT-US-062-01: no organisation
 * without its user, no user without its organisation).
 *
 * Consumers: registration (TASK-049) calls `createPersonalOrganisation` in the transaction that inserts the user; the
 * demo seed (TASK-089) and createOrganisation (TASK-224) call `createOrganisation`; member management (TASK-231)
 * calls `assignRole`. Routes map `OrganisationRuleError.code` to the catalogue problem (422).
 */
import {
  assertCreatableOrgType,
  assertRoleAllowed,
  isOrgType,
  OrganisationRuleError,
  PERSONAL_ORG_OWNER_ROLE,
  personalOrganisationName,
} from '../policies/organisation-rules.js';
import type { OrganisationRepository } from '../repository/organisation-repository.js';

export class OrganisationNotFoundError extends Error {
  override readonly name = 'OrganisationNotFoundError';
}

export interface CreatedOrganisation {
  readonly organisationId: string;
  readonly membershipId: string;
}

async function grant(repo: OrganisationRepository, membershipId: string, roleKey: string, grantedBy: string): Promise<string> {
  const roleId = await repo.roleIdByKey(roleKey);
  if (roleId === undefined) throw new OrganisationRuleError('ROLE_NOT_ALLOWED_FOR_ORG_TYPE', 'the role is not in the catalogue');
  return repo.insertMembershipRole(membershipId, roleId, grantedBy);
}

export interface PersonalOrganisationInput {
  readonly userId: string;
  readonly displayName: string;
  readonly locale: string;
  readonly now?: Date;
}

/** REQ-ORG-002: the INDIVIDUAL organisation named after the user, with one ACTIVE membership holding Owner. */
export async function createPersonalOrganisation(
  repo: OrganisationRepository,
  input: PersonalOrganisationInput,
): Promise<CreatedOrganisation> {
  const organisationId = await repo.insertOrganisation({
    type: 'INDIVIDUAL',
    displayName: personalOrganisationName(input.displayName),
    defaultLocale: input.locale,
    personalOwnerUserId: input.userId,
  });
  const membershipId = await repo.insertActiveMembership(input.userId, input.now ?? new Date());
  await grant(repo, membershipId, assertRoleAllowed('INDIVIDUAL', PERSONAL_ORG_OWNER_ROLE), input.userId);
  return { organisationId, membershipId };
}

export interface BusinessOrganisationInput {
  /** The requested type: anything but BUSINESS_CUSTOMER is refused (AT-US-061-02). */
  readonly type: unknown;
  readonly displayName: string;
  readonly locale: string;
  /** The creating user, who becomes its Owner (REQ-ORG-009). */
  readonly ownerUserId: string;
  readonly now?: Date;
}

/** REQ-ORG-001/009: a BUSINESS_CUSTOMER organisation with its creator as Owner; nothing is written on a refusal. */
export async function createOrganisation(repo: OrganisationRepository, input: BusinessOrganisationInput): Promise<CreatedOrganisation> {
  assertCreatableOrgType(input.type);
  const organisationId = await repo.insertOrganisation({
    type: input.type,
    displayName: input.displayName.trim(),
    defaultLocale: input.locale,
  });
  const membershipId = await repo.insertActiveMembership(input.ownerUserId, input.now ?? new Date());
  await grant(repo, membershipId, assertRoleAllowed(input.type, 'CUSTOMER_OWNER'), input.ownerUserId);
  return { organisationId, membershipId };
}

export interface AssignRoleInput {
  /** The context organisation of the transaction. */
  readonly orgId: string;
  readonly membershipId: string;
  readonly roleKey: string;
  readonly grantedBy: string;
}

/** REQ-ORG-004 (AT-US-062-02): the role's scope must match the organisation type; nothing is written otherwise. */
export async function assignRole(repo: OrganisationRepository, input: AssignRoleInput): Promise<string> {
  const type = await repo.organisationType(input.orgId);
  if (type === undefined || !isOrgType(type)) throw new OrganisationNotFoundError('organisation not found');
  return grant(repo, input.membershipId, assertRoleAllowed(type, input.roleKey), input.grantedBy);
}
