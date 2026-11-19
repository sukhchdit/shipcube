/**
 * The database cases of organisations.int.test.ts (TASK-037; US-061, US-062; REQ-ORG-001..004, DR-A05, DR-A06,
 * DR-A14; data-model §3.1, §3.2, §4.3, §4.7, §7.6; PR26-SEC-03/04, D-ARCH-123, D-ARCH-151, D-ARCH-154..156; SEC-TC-74;
 * code review PR #65 R1-M2, R1-m1..m3, R1-n4). Each case takes a superuser client that is already inside a
 * transaction the caller rolls back, and returns what it observed; the test file asserts. Kept apart from Jest so the
 * same statements can be replayed on another PostgreSQL engine (D-TASK037-21).
 *
 * Every statement is a single command (`pg` sends a parameterised query as one prepared statement) and every
 * parameter is used with one type. Synthetic fixture rows go in as the superuser with `session_replication_role =
 * replica` (no trigger, no foreign key); the case itself runs as `platform_app` with the production context statement
 * of withTenantTx, so RLS, the standard-columns guard and the domain triggers decide exactly as at runtime.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';

import { CONTEXT_STATEMENT_SQL } from '../../../apps/api/src/platform/db/with-tenant-tx.js';

export const APP_ROLE = 'platform_app';
export const SYSTEM = '00000000-0000-7000-8000-000000000001';
export const ANONYMOUS = '00000000-0000-7000-8000-000000000002';
/**
 * The reserved operator organisation (D-ARCH-151). prisma/tests may not import @platform/shared, so the literal is
 * repeated here; apps/api/src/modules/organisations/tests/organisations.test.ts proves the migration row equals
 * `OPERATOR_ORG_ID`, and the AT-US-061-01 case proves the migrated row equals the migration row.
 */
export const OPERATOR_ORG = '00000000-0000-7000-8000-000000000010';

export type Row = Record<string, unknown>;
type Client = pg.ClientBase;
type Statement = readonly [sql: string, params: readonly unknown[]];

export const rows = async <T extends Row>(client: Client, sql: string, params: readonly unknown[] = []): Promise<T[]> =>
  (await client.query<T>(sql, [...params])).rows;

/** `SQLSTATE message` of `sql` run in a savepoint, or 'ok'. */
export async function outcome(client: Client, sql: string, params: readonly unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT o');
  try {
    await client.query(sql, [...params]);
    await client.query('RELEASE SAVEPOINT o');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT o');
    const { code, message } = error as { code?: unknown; message?: unknown };
    return `${String(code)} ${String(message)}`;
  }
}

/** As platform_app with the given tenant context (the production statement of withTenantTx). */
export async function asApp(client: Client, orgId: string, actorId: string, scope = 'TENANT'): Promise<void> {
  await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
  await client.query(CONTEXT_STATEMENT_SQL, [orgId, actorId, scope, '', 'org-it', '10000', '2000', '10000']);
}

export async function asSuperuser(client: Client): Promise<void> {
  await client.query('RESET ROLE');
}

export async function roleId(client: Client, key: string): Promise<string> {
  const [row] = await rows<{ id: string }>(client, 'SELECT id FROM public.roles WHERE key = $1::text', [key]);
  if (row === undefined) throw new Error(`role ${key} is not seeded`);
  return row.id;
}

/** Synthetic fixture rows as the superuser, triggers and foreign keys off (rolled back with the case). */
export async function fixture(client: Client, statements: readonly Statement[]): Promise<void> {
  await asSuperuser(client);
  await client.query('SET LOCAL session_replication_role = replica');
  for (const [sql, params] of statements) await client.query(sql, [...params]);
  await client.query('SET LOCAL session_replication_role = origin');
}

const insertUser = (id: string, label: string, status = 'ACTIVE', personalOrgId: string | null = null): Statement => [
  `INSERT INTO public.users (id, email, display_name, status, personal_org_id, created_by, updated_by)
   VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::uuid, $6::uuid, $6::uuid)`,
  [id, `${label.toLowerCase()}-${id}@example.com`, label, status, personalOrgId, SYSTEM],
];
const insertOrganisation = (id: string, type: string, name: string, owner: string | null = null): Statement => [
  `INSERT INTO public.organisations (id, type, display_name, personal_owner_user_id, created_by, updated_by)
   VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $5::uuid)`,
  [id, type, name, owner, SYSTEM],
];
const insertMembership = (id: string, orgId: string, userId: string, status: string): Statement => [
  `INSERT INTO public.memberships (id, org_id, user_id, status, created_by, updated_by)
   VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $5::uuid)`,
  [id, orgId, userId, status, SYSTEM],
];

export interface World {
  readonly orgA: string;
  readonly orgB: string;
  /** ACTIVE in A and in B. */
  readonly userA: string;
  /** ACTIVE in B only. */
  readonly userB: string;
  /** userA's membership of A. */
  readonly membershipA: string;
  /** userA's membership of B. */
  readonly membershipAinB: string;
  /** userB's membership of B. */
  readonly membershipB: string;
  /** The REMOVED membership of A (its user is a member of nothing else). */
  readonly membershipRemoved: string;
}

/** Two BUSINESS_CUSTOMER organisations; userA ACTIVE in A and B, userB ACTIVE in B only, a REMOVED member of A. */
export async function world(client: Client): Promise<World> {
  const [orgA, orgB, userA, userB, removed, membershipA, membershipAinB, membershipB, membershipRemoved] = Array.from({ length: 9 }, () =>
    randomUUID(),
  ) as [string, string, string, string, string, string, string, string, string];
  await fixture(client, [
    insertUser(userA, 'A'),
    insertUser(userB, 'B'),
    insertUser(removed, 'Removed'),
    insertOrganisation(orgA, 'BUSINESS_CUSTOMER', 'Org A'),
    insertOrganisation(orgB, 'BUSINESS_CUSTOMER', 'Org B'),
    insertMembership(membershipA, orgA, userA, 'ACTIVE'),
    insertMembership(membershipB, orgB, userB, 'ACTIVE'),
    insertMembership(membershipRemoved, orgA, removed, 'REMOVED'),
    insertMembership(membershipAinB, orgB, userA, 'ACTIVE'),
  ]);
  return { orgA, orgB, userA, userB, membershipA, membershipAinB, membershipB, membershipRemoved };
}

const insertInvitation = (id: string, orgId: string, roleId: string, email: string): Statement => [
  `INSERT INTO public.invitations (id, org_id, email, role_id, locale, token_hash, status, expires_at, last_sent_at, created_by, updated_by)
   VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, 'en', $5::bytea, 'PENDING', now() + interval '7 days', now(), $6::uuid, $6::uuid)`,
  [id, orgId, email, roleId, randomBytes(32), SYSTEM],
];

/** A user with no membership yet (fixture), who will act for the own membership insert. */
async function freshUser(client: Client, label: string): Promise<string> {
  const id = randomUUID();
  await fixture(client, [insertUser(id, label)]);
  return id;
}

const MEMBERSHIP_INSERT = `INSERT INTO public.memberships (org_id, user_id, status, invitation_id, created_by, updated_by)
                           VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $5::uuid)`;
const ROLE_INSERT = `INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by)
                     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid, $4::uuid)`;
const INVITATION_INSERT = `INSERT INTO public.invitations (org_id, email, role_id, locale, token_hash, status, expires_at, last_sent_at, created_by, updated_by)
                           VALUES ($1::uuid, $2::text, $3::uuid, 'en', $4::bytea, 'PENDING', now() + interval '7 days', now(), $5::uuid, $5::uuid)`;

/**
 * [D-ARCH-154] T1: a role row of A naming B's membership, an unknown membership, A's own membership. The composite key
 * (org_id, membership_id) -> memberships(org_id, id) binds the reference to the row's organisation; the role-scope
 * trigger and WITH CHECK pass (org A, a CUSTOMER role), so the key is what refuses.
 */
export async function tenantBoundRoleReference(client: Client): Promise<{ foreign: string; unknown: string; own: string }> {
  const viewer = await roleId(client, 'CUSTOMER_VIEWER');
  const { orgA, userA, membershipA, membershipB } = await world(client);
  await asApp(client, orgA, userA);
  return {
    foreign: await outcome(client, ROLE_INSERT, [orgA, membershipB, viewer, userA]),
    unknown: await outcome(client, ROLE_INSERT, [orgA, randomUUID(), viewer, userA]),
    own: await outcome(client, ROLE_INSERT, [orgA, membershipA, viewer, userA]),
  };
}

/**
 * PR65-SEC-01: with B's membership already holding a live grant of a role, a role row of A naming that membership and
 * role fails the tenant-bound key (23503), not the live-grant unique index (23505), because the index leads with
 * org_id; within A the index still refuses a duplicate live grant (23505).
 */
export async function liveGrantIndexScope(client: Client): Promise<{ foreignWithLiveGrant: string; ownDuplicate: string }> {
  const viewer = await roleId(client, 'CUSTOMER_VIEWER');
  const { orgA, orgB, userA, userB, membershipA, membershipB } = await world(client);
  const grant = (orgId: string, membershipId: string, grantedBy: string): Statement => [
    `INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid, $4::uuid)`,
    [orgId, membershipId, viewer, grantedBy],
  ];
  await fixture(client, [grant(orgB, membershipB, userB), grant(orgA, membershipA, userA)]);
  await asApp(client, orgA, userA);
  return {
    foreignWithLiveGrant: await outcome(client, ROLE_INSERT, [orgA, membershipB, viewer, userA]),
    ownDuplicate: await outcome(client, ROLE_INSERT, [orgA, membershipA, viewer, userA]),
  };
}

/** [D-ARCH-154] T2: a member's own membership of A naming B's invitation, A's invitation, none. */
export async function tenantBoundInvitationReference(client: Client): Promise<{ foreign: string; own: string; none: string }> {
  const viewer = await roleId(client, 'CUSTOMER_VIEWER');
  const { orgA, orgB } = await world(client);
  const [invitationA, invitationB] = [randomUUID(), randomUUID()];
  await fixture(client, [
    insertInvitation(invitationA, orgA, viewer, 'invited-a@example.com'),
    insertInvitation(invitationB, orgB, viewer, 'invited-b@example.com'),
  ]);
  const [x1, x2, x3] = [await freshUser(client, 'X1'), await freshUser(client, 'X2'), await freshUser(client, 'X3')];
  const own = async (user: string, invitation: string | null): Promise<string> => {
    await asApp(client, orgA, user);
    return outcome(client, MEMBERSHIP_INSERT, [orgA, user, 'ACTIVE', invitation, user]);
  };
  return { foreign: await own(x1, invitationB), own: await own(x2, invitationA), none: await own(x3, null) };
}

/**
 * [D-ARCH-155] T3: invitations exist only in BUSINESS_CUSTOMER organisations (operator organisation with an operator
 * role, INDIVIDUAL with CUSTOMER_VIEWER, BUSINESS_CUSTOMER with CUSTOMER_VIEWER); an operator role link on an operator
 * membership is unaffected.
 */
export async function invitationOrgType(
  client: Client,
): Promise<{ operatorOrg: string; individualOrg: string; businessOrg: string; operatorRoleLink: string }> {
  const [support, viewer] = [await roleId(client, 'OPERATOR_SUPPORT'), await roleId(client, 'CUSTOMER_VIEWER')];
  const { orgA, userA } = await world(client);
  const [staff, staffMembership, person, personalOrg] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await fixture(client, [
    insertUser(staff, 'Staff'),
    insertMembership(staffMembership, OPERATOR_ORG, staff, 'ACTIVE'),
    insertUser(person, 'Person', 'ACTIVE', personalOrg),
    insertOrganisation(personalOrg, 'INDIVIDUAL', 'Person', person),
    insertMembership(randomUUID(), personalOrg, person, 'ACTIVE'),
  ]);
  const invite = async (org: string, actor: string, role: string): Promise<string> => {
    await asApp(client, org, actor);
    return outcome(client, INVITATION_INSERT, [org, `invitee-${randomUUID()}@example.com`, role, randomBytes(32), actor]);
  };
  const operatorOrg = await invite(OPERATOR_ORG, staff, support);
  const individualOrg = await invite(personalOrg, person, viewer);
  const businessOrg = await invite(orgA, userA, viewer);
  await asApp(client, OPERATOR_ORG, staff);
  const operatorRoleLink = await outcome(client, ROLE_INSERT, [OPERATOR_ORG, staffMembership, support, staff]);
  return { operatorOrg, individualOrg, businessOrg, operatorRoleLink };
}

/**
 * [D-ARCH-156] T4 and T5: actor A inserting an ACTIVE membership for user B is refused and B's profile stays invisible to
 * A; a user inserting the own ACTIVE membership succeeds and a fellow member then reads that user's row.
 */
export async function membershipMemberIsActor(
  client: Client,
): Promise<{ foreignMember: string; foreignProfileRows: number; ownMember: string; fellowReadsRows: number }> {
  const { orgA, userA, userB } = await world(client);
  await asApp(client, orgA, userA);
  const foreignMember = await outcome(client, MEMBERSHIP_INSERT, [orgA, userB, 'ACTIVE', null, userA]);
  const foreignProfileRows = (await rows(client, 'SELECT id FROM public.users WHERE id = $1::uuid', [userB])).length;
  const joiner = await freshUser(client, 'Joiner');
  await asApp(client, orgA, joiner);
  const ownMember = await outcome(client, MEMBERSHIP_INSERT, [orgA, joiner, 'ACTIVE', null, joiner]);
  await asApp(client, orgA, userA);
  const fellowReadsRows = (await rows(client, 'SELECT id FROM public.users WHERE id = $1::uuid', [joiner])).length;
  return { foreignMember, foreignProfileRows, ownMember, fellowReadsRows };
}

/**
 * [D-ARCH-156] T6, T7 and T8: creation only ACTIVE, user_id fixed, REMOVED terminal; the ACTIVE -> SUSPENDED -> ACTIVE
 * -> REMOVED lifecycle passes; a re-parent is refused by WITH CHECK as platform_app and by the guard as the superuser.
 */
export async function membershipLifecycle(client: Client): Promise<Record<string, string>> {
  const { orgA, orgB, userA, userB, membershipA, membershipRemoved } = await world(client);
  const [suspendedUser, invitedUser] = [await freshUser(client, 'S'), await freshUser(client, 'I')];
  await asApp(client, orgA, suspendedUser);
  const createdSuspended = await outcome(client, MEMBERSHIP_INSERT, [orgA, suspendedUser, 'SUSPENDED', null, suspendedUser]);
  await asApp(client, orgA, invitedUser);
  const createdInvited = await outcome(client, MEMBERSHIP_INSERT, [orgA, invitedUser, 'INVITED', null, invitedUser]);
  await asApp(client, orgA, userA);
  const setStatus = `UPDATE public.memberships SET status = $2::text, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`;
  const repoint = await outcome(
    client,
    `UPDATE public.memberships SET user_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`,
    [membershipA, userB, userA],
  );
  const removedToActive = await outcome(client, setStatus, [membershipRemoved, 'ACTIVE', userA]);
  const lifecycle = [
    await outcome(client, setStatus, [membershipA, 'SUSPENDED', userA]),
    await outcome(client, setStatus, [membershipA, 'ACTIVE', userA]),
    await outcome(client, setStatus, [membershipA, 'REMOVED', userA]),
  ].join(',');
  const reparent = `UPDATE public.memberships SET org_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`;
  const reparentAsApp = await outcome(client, reparent, [membershipRemoved, orgB, userA]);
  // The superuser bypasses RLS; origin mode, the context actor stays userA, so the standard-columns guard passes.
  await asSuperuser(client);
  const reparentAsSuperuser = await outcome(client, reparent, [membershipRemoved, orgB, userA]);
  return { createdSuspended, createdInvited, repoint, removedToActive, lifecycle, reparentAsApp, reparentAsSuperuser };
}

/** [PR26-SEC-04] the reserved actors, and a forged is_system row. */
export async function reservedActors(client: Client): Promise<{ reserved: Row[]; forged: string }> {
  const reserved = await rows(client, 'SELECT id, is_system FROM public.users WHERE is_system ORDER BY id');
  // No tenant context is set, so the standard-columns guard expects the ANONYMOUS actor in the stamps (it runs before
  // the CHECK); with valid stamps the CHECK ck_users__is_system is what refuses the forged flag.
  const forged = await outcome(
    client,
    `INSERT INTO public.users (id, email, display_name, is_system, created_by, updated_by)
     VALUES ($1::uuid, 'x@example.com', 'X', true, $2::uuid, $2::uuid)`,
    [randomUUID(), ANONYMOUS],
  );
  return { reserved, forged };
}

/** [AT-US-062-01] registration as platform_app, then a forced failure of a second registration. */
export async function registration(client: Client): Promise<{ steps: string[]; visible: Row[]; failed: string; leftovers: Row[] }> {
  const owner = await roleId(client, 'CUSTOMER_OWNER');
  const [user, org] = [randomUUID(), randomUUID()];
  await asApp(client, org, user);
  const steps = [
    await outcome(
      client,
      `INSERT INTO public.users (id, email, display_name, status, personal_org_id, created_by, updated_by)
       VALUES ($1::uuid, 'asha@example.com', 'Asha Rao', 'PENDING_VERIFICATION', $2::uuid, $1::uuid, $1::uuid)`,
      [user, org],
    ),
    await outcome(
      client,
      `INSERT INTO public.organisations (id, type, display_name, personal_owner_user_id, created_by, updated_by)
       VALUES ($2::uuid, 'INDIVIDUAL', 'Asha Rao', $1::uuid, $1::uuid, $1::uuid)`,
      [user, org],
    ),
    await outcome(
      client,
      `WITH m AS (INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by)
                  VALUES ($2::uuid, $1::uuid, 'ACTIVE', $1::uuid, $1::uuid) RETURNING id)
       INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by)
       SELECT $2::uuid, m.id, $3::uuid, $1::uuid, $1::uuid, $1::uuid FROM m`,
      [user, org, owner],
    ),
  ];
  await client.query('SET CONSTRAINTS ALL IMMEDIATE'); // the deferred users.personal_org_id check, as at COMMIT
  const visible = await rows(client, 'SELECT type, display_name, personal_owner_user_id FROM public.organisations');
  await asSuperuser(client);
  // Forced failure: the user insert fails, the unit is rolled back to its savepoint, nothing of it persists.
  const [user2, org2] = [randomUUID(), randomUUID()];
  await asApp(client, org2, user2);
  await client.query('SAVEPOINT unit');
  let failed = 'no failure';
  try {
    await client.query(
      `INSERT INTO public.users (id, email, display_name, created_by, updated_by)
       VALUES ($1::uuid, 'NOT-LOWER@Example.com', 'B', $1::uuid, $1::uuid)`,
      [user2],
    );
    await client.query(
      `INSERT INTO public.organisations (id, type, display_name, personal_owner_user_id, created_by, updated_by)
       VALUES ($2::uuid, 'INDIVIDUAL', 'B', $1::uuid, $1::uuid, $1::uuid)`,
      [user2, org2],
    );
  } catch (error) {
    failed = String((error as { code?: unknown }).code);
    await client.query('ROLLBACK TO SAVEPOINT unit');
  }
  await asSuperuser(client);
  const leftovers = await rows(client, 'SELECT id FROM public.organisations WHERE id = $1::uuid', [org2]);
  return { steps, visible, failed, leftovers };
}

/** [AT-US-061-02] an OPERATOR insert with nothing planted, as platform_app and as the superuser. */
export async function secondOperator(client: Client): Promise<{ app: string; superuser: string; operators: Row[] }> {
  const [org, actor] = [randomUUID(), randomUUID()];
  // platform_app in the context of a fresh organisation id: RLS WITH CHECK (id = app_org_id()) admits the row, the
  // occupied unique index refuses it (D-ARCH-151).
  await asApp(client, org, actor);
  const insert = `INSERT INTO public.organisations (id, type, display_name, created_by, updated_by)
                  VALUES ($1::uuid, 'OPERATOR', 'Second', $2::uuid, $2::uuid)`;
  const app = await outcome(client, insert, [org, actor]);
  // The superuser with triggers and foreign keys off (replica): only the unique index can refuse the row.
  await asSuperuser(client);
  await client.query('SET LOCAL session_replication_role = replica');
  const superuser = await outcome(client, insert, [randomUUID(), SYSTEM]);
  await client.query('SET LOCAL session_replication_role = origin');
  const operators = await rows(client, `SELECT id FROM public.organisations WHERE type = 'OPERATOR'`);
  return { app, superuser, operators };
}

/**
 * [AT-US-061-03] (R1-M2) type changes that satisfy every CHECK reach trg_organisations__type_immutable: a business
 * organisation becoming PARTNER, and the reserved OPERATOR row becoming BUSINESS_CUSTOMER. INDIVIDUAL without an owner
 * is refused earlier by ck_organisations__personal_owner. Mutant: without the trigger the PARTNER change succeeds.
 */
export async function typeImmutable(
  client: Client,
): Promise<{ partner: string; individual: string; operatorRow: string; withoutTrigger: string }> {
  const { orgA, userA } = await world(client);
  const change = `UPDATE public.organisations SET type = $3::text, updated_by = $2::uuid, version = version + 1 WHERE id = $1::uuid`;
  await asApp(client, orgA, userA);
  const partner = await outcome(client, change, [orgA, userA, 'PARTNER']);
  const individual = await outcome(client, change, [orgA, userA, 'INDIVIDUAL']);
  // The reserved row is not writable by platform_app (no member); the superuser (RLS bypassed) keeps the context actor
  // of the transaction, so the standard-columns guard passes and the AFTER trigger decides.
  await asSuperuser(client);
  const operatorRow = await outcome(client, change, [OPERATOR_ORG, userA, 'BUSINESS_CUSTOMER']);
  await client.query('SAVEPOINT mutant');
  await client.query('DROP TRIGGER trg_organisations__type_immutable ON public.organisations');
  await asApp(client, orgA, userA);
  const withoutTrigger = await outcome(client, change, [orgA, userA, 'PARTNER']);
  await asSuperuser(client);
  await client.query('ROLLBACK TO SAVEPOINT mutant');
  return { partner, individual, operatorRow, withoutTrigger };
}

/** [AT-US-062-02] an operator role on a BUSINESS_CUSTOMER membership, and a customer role. */
export async function roleScopeBackstop(client: Client): Promise<{ operator: string; customer: string }> {
  const [support, viewer] = [await roleId(client, 'OPERATOR_SUPPORT'), await roleId(client, 'CUSTOMER_VIEWER')];
  const { orgA, userA, membershipA } = await world(client);
  await asApp(client, orgA, userA);
  const insert = (role: string): Promise<string> =>
    outcome(
      client,
      `INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid, $4::uuid)`,
      [orgA, membershipA, role, userA],
    );
  return { operator: await insert(support), customer: await insert(viewer) };
}

/** [AT-US-062-03] a second live membership, REMOVED, and a re-add. */
export async function secondMembership(client: Client): Promise<{ duplicate: string; removed: string; readded: string; history: Row[] }> {
  const { orgA, userA, membershipA } = await world(client);
  await asApp(client, orgA, userA);
  const insert = (): Promise<string> =>
    outcome(
      client,
      `INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by)
       VALUES ($1::uuid, $2::uuid, 'ACTIVE', $2::uuid, $2::uuid)`,
      [orgA, userA],
    );
  const duplicate = await insert();
  const removed = await outcome(
    client,
    `UPDATE public.memberships SET status = 'REMOVED', removed_at = now(), updated_by = $2::uuid, version = version + 1 WHERE id = $1::uuid`,
    [membershipA, userA],
  );
  const readded = await insert();
  const history = await rows(
    client,
    'SELECT status FROM public.memberships WHERE org_id = $1::uuid AND user_id = $2::uuid ORDER BY status',
    [orgA, userA],
  );
  return { duplicate, removed, readded, history };
}

interface PersonalWorld {
  readonly user: string;
  readonly org: string;
  /** A DEACTIVATED user, member of the personal organisation, so platform_app can see the row. */
  readonly deactivated: string;
}

async function personalWorld(client: Client): Promise<PersonalWorld> {
  const [user, org, deactivated] = [randomUUID(), randomUUID(), randomUUID()];
  await fixture(client, [
    insertUser(user, 'P', 'ACTIVE', org),
    insertUser(deactivated, 'D', 'DEACTIVATED'),
    insertOrganisation(org, 'INDIVIDUAL', 'P', user),
    insertMembership(randomUUID(), org, user, 'ACTIVE'),
    insertMembership(randomUUID(), org, deactivated, 'ACTIVE'),
  ]);
  return { user, org, deactivated };
}

/** [AT-US-062-04] soft delete of the personal organisation of an active user; hard delete. */
export async function personalDelete(client: Client): Promise<{ soft: string; hard: string; remaining: Row[] }> {
  const { user, org } = await personalWorld(client);
  await asApp(client, org, user);
  const soft = await outcome(
    client,
    `UPDATE public.organisations SET deleted_at = now(), deleted_by = $2::uuid, updated_by = $2::uuid, version = version + 1
      WHERE id = $1::uuid`,
    [org, user],
  );
  const hard = await outcome(client, 'DELETE FROM public.organisations WHERE id = $1::uuid', [org]);
  await asSuperuser(client);
  const remaining = await rows(client, 'SELECT deleted_at FROM public.organisations WHERE id = $1::uuid', [org]);
  return { soft, hard, remaining };
}

/**
 * [R1-m3] re-pointing the owner to a visible DEACTIVATED user and deleting in ONE UPDATE is refused by the delete guard
 * (it reads OLD); re-pointing alone is refused by trg_organisations__personal_owner_immutable.
 */
export async function personalOwnerRepoint(
  client: Client,
): Promise<{ deactivatedVisible: number; repointAndDelete: string; repoint: string; remaining: Row[] }> {
  const { user, org, deactivated } = await personalWorld(client);
  await asApp(client, org, user);
  const deactivatedVisible = (await rows(client, 'SELECT id FROM public.users WHERE id = $1::uuid', [deactivated])).length;
  const repointAndDelete = await outcome(
    client,
    `UPDATE public.organisations SET personal_owner_user_id = $2::uuid, deleted_at = now(), deleted_by = $3::uuid,
            updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`,
    [org, deactivated, user],
  );
  const repoint = await outcome(
    client,
    `UPDATE public.organisations SET personal_owner_user_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`,
    [org, deactivated, user],
  );
  await asSuperuser(client);
  const remaining = await rows(client, 'SELECT personal_owner_user_id, deleted_at FROM public.organisations WHERE id = $1::uuid', [org]);
  return { deactivatedVisible, repointAndDelete, repoint, remaining };
}

/**
 * [R1-m2] WITH CHECK on the role-scope guarded tables, proven directly: userA is ACTIVE in A and B, so from A's context
 * the guard sees B (member_read) and passes, and the RLS policy is what refuses org_id = B on INSERT and on a
 * re-parenting UPDATE. (For a single-organisation actor the guard refuses first: the generated suite, D-TASK037-14.)
 */
export async function withCheckGuardedTables(client: Client): Promise<Record<string, string>> {
  const viewer = await roleId(client, 'CUSTOMER_VIEWER');
  const { orgA, orgB, userA, membershipA, membershipAinB } = await world(client);
  await asApp(client, orgA, userA);
  const role = `INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid, $4::uuid) RETURNING id`;
  const invitation = `INSERT INTO public.invitations (org_id, email, role_id, locale, token_hash, status, expires_at, last_sent_at, created_by, updated_by)
                      VALUES ($1::uuid, $2::text, $3::uuid, 'en', $4::bytea, 'PENDING', now() + interval '7 days', now(), $5::uuid, $5::uuid)
                      RETURNING id`;
  const reparent = (table: string): string =>
    `UPDATE public.${table} SET org_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`;
  const membershipRoleInsertB = await outcome(client, role, [orgB, membershipAinB, viewer, userA]);
  const [ownRole] = await rows<{ id: string }>(client, role, [orgA, membershipA, viewer, userA]);
  const membershipRoleReparent = await outcome(client, reparent('membership_roles'), [ownRole?.id, orgB, userA]);
  const invitationInsertB = await outcome(client, invitation, [orgB, 'invitee-b@example.com', viewer, randomBytes(32), userA]);
  const [ownInvitation] = await rows<{ id: string }>(client, invitation, [orgA, 'invitee-a@example.com', viewer, randomBytes(32), userA]);
  const invitationReparent = await outcome(client, reparent('invitations'), [ownInvitation?.id, orgB, userA]);
  return {
    ownRows: ownRole !== undefined && ownInvitation !== undefined ? 'inserted' : 'missing',
    membershipRoleInsertB,
    membershipRoleReparent,
    invitationInsertB,
    invitationReparent,
  };
}

/**
 * [R1-m1] the membership lookup of the organisations repository: `p_memberships__own_read` shows the actor's own
 * membership of B in A's context, so only the explicit organisation filter keeps it out.
 */
export async function membershipLookup(
  client: Client,
): Promise<{ withoutFilter: number; foreignWithFilter: number; ownWithFilter: number }> {
  const { orgA, userA, membershipA, membershipAinB } = await world(client);
  await asApp(client, orgA, userA);
  const count = async (sql: string, params: readonly unknown[]): Promise<number> => (await rows(client, sql, params)).length;
  return {
    withoutFilter: await count('SELECT id FROM public.memberships WHERE id = $1::uuid', [membershipAinB]),
    foreignWithFilter: await count('SELECT id FROM public.memberships WHERE id = $1::uuid AND org_id = $2::uuid', [membershipAinB, orgA]),
    ownWithFilter: await count('SELECT id FROM public.memberships WHERE id = $1::uuid AND org_id = $2::uuid', [membershipA, orgA]),
  };
}

/** Visible ids of the three DR-A14 tables in the current context. */
async function visibleIds(client: Client): Promise<{ organisations: string[]; memberships: string[]; users: string[] }> {
  const ids = async (table: string): Promise<string[]> =>
    (await rows<{ id: string }>(client, `SELECT id FROM public.${table} ORDER BY id`)).map((row) => row.id);
  return { organisations: await ids('organisations'), memberships: await ids('memberships'), users: await ids('users') };
}

/**
 * [C12] DR-A14 in org A's context (userA is in A and B), and (R1-n4) a real customer, ACTIVE in B only, who forces
 * app.actor_scope = OPERATOR: app_is_operator() is false, so the forced scope shows exactly what the TENANT scope shows.
 */
export async function drA14(client: Client): Promise<{
  world: World;
  orgs: string[];
  memberships: string[];
  users: string[];
  tenantScope: Awaited<ReturnType<typeof visibleIds>>;
  forcedOperator: Awaited<ReturnType<typeof visibleIds>>;
  forcedSeesA: { organisation: boolean; memberships: boolean };
}> {
  const w = await world(client);
  const { orgA, orgB, userB } = w;
  await asApp(client, orgA, w.userA);
  const orgs = (await rows<{ id: string }>(client, 'SELECT id FROM public.organisations')).map((row) => row.id).sort();
  const memberships = (await rows<{ org_id: string; status: string }>(client, 'SELECT org_id, status FROM public.memberships'))
    .map((row) => `${row.org_id === orgA ? 'A' : row.org_id === orgB ? 'B' : '?'} ${row.status}`)
    .sort();
  const users = (await rows<{ id: string }>(client, 'SELECT id FROM public.users')).map((row) => row.id);
  await asApp(client, orgB, userB);
  const tenantScope = await visibleIds(client);
  await asApp(client, orgB, userB, 'OPERATOR');
  const forcedOperator = await visibleIds(client);
  const forcedSeesA = {
    organisation: (await rows(client, 'SELECT id FROM public.organisations WHERE id = $1::uuid', [orgA])).length > 0,
    memberships: (await rows(client, 'SELECT id FROM public.memberships WHERE org_id = $1::uuid', [orgA])).length > 0,
  };
  return { world: w, orgs, memberships, users, tenantScope, forcedOperator, forcedSeesA };
}

/** [D-ARCH-123] the reserved status INVITED is never stored. */
export async function invitedMemberships(client: Client): Promise<Row[]> {
  return rows(client, `SELECT count(*)::int AS n FROM public.memberships WHERE status = 'INVITED'`);
}

/**
 * [SEC-TC-74] PR43-SEC-07 remainder on the real tables (PR65-SEC-05 (d), D-SEC-PR47-01 (3); security record PR-0065
 * §5.4; TASK-293): a version reset to 1 after a correct bump; back-dated timestamps (unconstrained, RR-18) on UPDATE and
 * INSERT; wrong stamps plus a foreign organisation (the BEFORE guard answers before WITH CHECK) against right stamps
 * plus a foreign organisation (RLS); both MERGE forms. The member inserts act as a fresh user, as the lifecycle guard
 * requires (D-ARCH-156).
 */
export async function stdColumnsRemainder(client: Client): Promise<Record<string, string>> {
  const { orgA, orgB, userA, membershipA } = await world(client);
  const fresh = await freshUser(client, 'Fresh');
  const merger = await freshUser(client, 'Merger');
  await asApp(client, orgA, userA);
  const bumped = await outcome(
    client,
    `UPDATE public.organisations SET display_name = 'Org A2', updated_by = $2::uuid, version = version + 1 WHERE id = $1::uuid`,
    [orgA, userA],
  );
  const resetToOne = await outcome(
    client,
    `UPDATE public.organisations SET display_name = 'Org A3', updated_by = $2::uuid, version = 1 WHERE id = $1::uuid`,
    [orgA, userA],
  );
  const backdatedUpdate = await outcome(
    client,
    `UPDATE public.organisations SET display_name = 'Org A4', updated_by = $2::uuid, version = version + 1,
            updated_at = '2000-01-01T00:00:00Z'::timestamptz WHERE id = $1::uuid`,
    [orgA, userA],
  );
  const wrongStampsForeignOrg = await outcome(
    client,
    `UPDATE public.memberships SET org_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`,
    [membershipA, orgB, SYSTEM],
  );
  const rightStampsForeignOrg = await outcome(
    client,
    `UPDATE public.memberships SET org_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`,
    [membershipA, orgB, userA],
  );
  // The fixture organisation was created by SYSTEM, so the forged creator is the actor (any other value than the stored).
  const mergeMatchedForgedCreator = await outcome(
    client,
    `MERGE INTO public.organisations o USING (SELECT $1::uuid AS id) s ON o.id = s.id
      WHEN MATCHED THEN UPDATE SET display_name = 'Org A5', updated_by = $2::uuid, version = o.version + 1, created_by = $2::uuid`,
    [orgA, userA],
  );
  await asApp(client, orgA, fresh);
  const backdatedInsert = await outcome(
    client,
    `INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 'ACTIVE', $2::uuid, $2::uuid, '2000-01-01T00:00:00Z'::timestamptz, '2000-01-01T00:00:00Z'::timestamptz)`,
    [orgA, fresh],
  );
  await asApp(client, orgA, merger);
  const mergeNotMatchedVersion = await outcome(
    client,
    `MERGE INTO public.memberships m USING (SELECT $1::uuid AS org_id, $2::uuid AS user_id) s
        ON m.org_id = s.org_id AND m.user_id = s.user_id
      WHEN NOT MATCHED THEN INSERT (org_id, user_id, status, created_by, updated_by, version)
           VALUES (s.org_id, s.user_id, 'ACTIVE', s.user_id, s.user_id, 7)`,
    [orgA, merger],
  );
  return {
    bumped,
    resetToOne,
    backdatedUpdate,
    backdatedInsert,
    wrongStampsForeignOrg,
    rightStampsForeignOrg,
    mergeMatchedForgedCreator,
    mergeNotMatchedVersion,
  };
}

/** [SEC-TC-74] [PR26-SEC-03] the standard-columns guard on the real tables, and a re-parenting UPDATE. */
export async function stdColumns(client: Client): Promise<Record<string, string>> {
  const { orgA, orgB, userA, membershipA } = await world(client);
  await asApp(client, orgA, userA);
  return {
    forgedCreator: await outcome(
      client,
      `INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by)
       VALUES ($1::uuid, $2::uuid, 'SUSPENDED', $3::uuid, $4::uuid)`,
      [orgA, randomUUID(), SYSTEM, userA],
    ),
    forgedVersion: await outcome(
      client,
      `UPDATE public.organisations SET display_name = 'X', updated_by = $2::uuid, version = 7 WHERE id = $1::uuid`,
      [orgA, userA],
    ),
    reparent: await outcome(
      client,
      `UPDATE public.memberships SET org_id = $2::uuid, updated_by = $3::uuid, version = version + 1 WHERE id = $1::uuid`,
      [membershipA, orgB, userA],
    ),
    correct: await outcome(
      client,
      `UPDATE public.organisations SET display_name = 'Org A2', updated_by = $2::uuid, version = version + 1 WHERE id = $1::uuid`,
      [orgA, userA],
    ),
  };
}
