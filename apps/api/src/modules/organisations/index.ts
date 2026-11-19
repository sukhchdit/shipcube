// Organisations module public surface (data-model §3.2; REQ-ORG-001..004; TASK-037). No HTTP routes yet: the
// organisation and member routes arrive with TASK-224 (createOrganisation, updateOrganisation) and TASK-231
// (updateMember); registration (TASK-049) and the demo seed (TASK-089) call the service in their own transaction.
export {
  assertCreatableOrgType,
  assertRoleAllowed,
  assertWritableMembershipStatus,
  CREATABLE_ORG_TYPE,
  isOrganisationRefusalCode,
  isOrgType,
  membershipChange,
  ORG_TYPES,
  ORGANISATION_INTERNAL_CODES,
  ORGANISATION_REFUSAL_CODES,
  ORGANISATION_RULE_CODES,
  OrganisationRuleError,
  organisationDisplayName,
  ORGANISATION_NAME_MAX,
  organisationRuleProblemCode,
  PERSONAL_ORG_OWNER_ROLE,
  personalOrganisationName,
  roleScopeForOrgType,
  WRITABLE_MEMBERSHIP_STATUSES,
  type MembershipChange,
  type MembershipSnapshot,
  type MembershipStatus,
  type OrganisationInternalCode,
  type OrganisationRefusalCode,
  type OrganisationRuleCode,
  type OrgType,
} from './policies/organisation-rules.js';
export {
  createOrganisationRepository,
  type NewOrganisation,
  type OrganisationRepository,
  type OrganisationsDb,
} from './repository/organisation-repository.js';
export {
  assignRole,
  createOrganisation,
  createPersonalOrganisation,
  MembershipNotFoundError,
  OrganisationNotFoundError,
  type AssignRoleInput,
  type BusinessOrganisationInput,
  type CreatedOrganisation,
  type PersonalOrganisationInput,
} from './service/organisation-service.js';
