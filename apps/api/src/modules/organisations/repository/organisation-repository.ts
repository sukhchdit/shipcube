/**
 * Organisations repository (data-model §3.2; TASK-037). Runs inside the caller's tenant transaction (`TenantDb`): RLS
 * decides what is visible, and the standard-columns extension and the database guard stamp `id`, `created_by`,
 * `updated_by`, `version` and `org_id`, so the inputs here carry business columns only (`serverStamped`,
 * D-TASK032-02). A new organisation's `id` is the transaction's organisation (tenant-key model, D-TASK037-05): the
 * caller opens the transaction with the id it wants and `p_organisations__active` admits exactly that row. The service
 * depends on the `OrganisationRepository` port, so it is exercised with a fake.
 */
import { type AppTransactionClient, type Prisma, serverStamped, type TenantDb } from '../../../platform/db/index.js';
import type { OrgType } from '../policies/organisation-rules.js';

/** The delegates the repository uses, of the caller's tenant transaction client. */
export type OrganisationsDb = Pick<TenantDb<AppTransactionClient>, 'organisation' | 'membership' | 'membershipRole' | 'role'>;

export interface NewOrganisation {
  readonly type: OrgType;
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly personalOwnerUserId?: string;
}

export interface OrganisationRepository {
  /** Inserts the organisation of the transaction's context; returns its id (= the context organisation). */
  insertOrganisation(organisation: NewOrganisation): Promise<string>;
  /** The type of a visible organisation, or undefined (absent or hidden by RLS: indistinguishable, REQ-RLS-007). */
  organisationType(orgId: string): Promise<string | undefined>;
  /** An ACTIVE membership of the context organisation (the only status written on creation, D-ARCH-123). */
  insertActiveMembership(userId: string, at: Date): Promise<string>;
  roleIdByKey(roleKey: string): Promise<string | undefined>;
  /** A role of a membership of the context organisation. */
  insertMembershipRole(membershipId: string, roleId: string, grantedBy: string): Promise<string>;
}

export function createOrganisationRepository(db: OrganisationsDb): OrganisationRepository {
  return {
    async insertOrganisation(organisation) {
      const { id } = await db.organisation.create({
        data: serverStamped<Prisma.OrganisationUncheckedCreateInput>({
          type: organisation.type,
          displayName: organisation.displayName,
          defaultLocale: organisation.defaultLocale,
          ...(organisation.personalOwnerUserId === undefined ? {} : { personalOwnerUserId: organisation.personalOwnerUserId }),
        }),
        select: { id: true },
      });
      return id;
    },
    async organisationType(orgId) {
      return (await db.organisation.findUnique({ where: { id: orgId }, select: { type: true } }))?.type;
    },
    async insertActiveMembership(userId, at) {
      const { id } = await db.membership.create({
        data: serverStamped<Prisma.MembershipUncheckedCreateInput>({ userId, status: 'ACTIVE', activatedAt: at }),
        select: { id: true },
      });
      return id;
    },
    async roleIdByKey(roleKey) {
      return (await db.role.findUnique({ where: { key: roleKey }, select: { id: true } }))?.id;
    },
    async insertMembershipRole(membershipId, roleId, grantedBy) {
      const { id } = await db.membershipRole.create({
        data: serverStamped<Prisma.MembershipRoleUncheckedCreateInput>({ membershipId, roleId, grantedBy }),
        select: { id: true },
      });
      return id;
    },
  };
}
