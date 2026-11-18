/**
 * Organisations and users against PostgreSQL 18 with the committed migrations (TASK-037; US-061, US-062; REQ-ORG-001..
 * 004, DR-A05, DR-A06, DR-A14; data-model §3.1, §3.2, §4.3, §7.6; PR26-SEC-03/04, D-ARCH-123; SEC-TC-74). Every case
 * runs in a rolled-back transaction: synthetic fixture rows go in as the superuser with `session_replication_role =
 * replica` (no guard, no FK), the case itself as `platform_app` with the production context statement of withTenantTx,
 * so RLS, the standard-columns guard and the domain triggers decide exactly as at runtime. The one OPERATOR
 * organisation is the reserved row of the migration (D-ARCH-151): no case plants one.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { CONTEXT_STATEMENT_SQL } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import type { ConfigChangeSink, SeedLogger } from '../../seed/framework/contracts.js';
import { runReferenceSeed } from '../../seed/framework/runner.js';
import { REFERENCE_DATASETS, REFERENCE_STEPS } from '../../seed/reference/index.js';
import { APP_ROLE, PlatformPostgres } from '../harness/postgres.js';

const SYSTEM = '00000000-0000-7000-8000-000000000001';
const ANONYMOUS = '00000000-0000-7000-8000-000000000002';
/**
 * The reserved operator organisation (D-ARCH-151). prisma/tests may not import @platform/shared, so the literal is
 * repeated here; apps/api/src/modules/organisations/tests/organisations.test.ts proves the migration row equals
 * `OPERATOR_ORG_ID`, and this suite proves the migrated row equals the migration row.
 */
const OPERATOR_ORG = '00000000-0000-7000-8000-000000000010';
const SILENT: SeedLogger = { info: () => undefined, warn: () => undefined };
const NO_CONFIG_SINK: ConfigChangeSink = { configChanged: () => Promise.resolve() };

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
}, 60_000);

type Row = Record<string, unknown>;

async function rolledBack<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await db.superuser(database);
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

const rows = async <T extends Row>(client: pg.ClientBase, sql: string, params: unknown[] = []): Promise<T[]> =>
  (await client.query<T>(sql, params)).rows;

/** `SQLSTATE message` of `sql` run in a savepoint, or 'ok'. */
async function outcome(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT o');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT o');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT o');
    const { code, message } = error as { code?: unknown; message?: unknown };
    return `${String(code)} ${String(message)}`;
  }
}

/** As platform_app with the given tenant context (the production statement of withTenantTx). */
async function asApp(client: pg.Client, orgId: string, actorId: string, scope = 'TENANT'): Promise<void> {
  await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
  await client.query(CONTEXT_STATEMENT_SQL, [orgId, actorId, scope, '', 'org-it', '10000', '2000', '10000']);
}

async function asSuperuser(client: pg.Client): Promise<void> {
  await client.query('RESET ROLE');
}

async function roleId(client: pg.Client, key: string): Promise<string> {
  const [row] = await rows<{ id: string }>(client, 'SELECT id FROM public.roles WHERE key = $1', [key]);
  if (row === undefined) throw new Error(`role ${key} is not seeded`);
  return row.id;
}

/** Synthetic fixture rows as the superuser, guard and foreign keys off (rolled back with the case). */
async function fixture(client: pg.Client, sql: string, params: unknown[] = []): Promise<void> {
  await asSuperuser(client);
  await client.query('SET LOCAL session_replication_role = replica');
  await client.query(sql, params);
  await client.query('SET LOCAL session_replication_role = origin');
}

interface World {
  readonly orgA: string;
  readonly orgB: string;
  readonly userA: string;
  readonly userB: string;
  readonly membershipA: string;
}

/** Two BUSINESS_CUSTOMER organisations, one ACTIVE member each, and a REMOVED member of A. */
async function world(client: pg.Client): Promise<World> {
  const [orgA, orgB, userA, userB, removed, membershipA] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await fixture(
    client,
    `INSERT INTO public.users (id, email, display_name, status, created_by, updated_by) VALUES
       ($3, 'a-' || $3 || '@example.com', 'User A', 'ACTIVE', $6, $6),
       ($4, 'b-' || $4 || '@example.com', 'User B', 'ACTIVE', $6, $6),
       ($5, 'r-' || $5 || '@example.com', 'Removed', 'ACTIVE', $6, $6);
     INSERT INTO public.organisations (id, type, display_name, created_by, updated_by) VALUES
       ($1, 'BUSINESS_CUSTOMER', 'Org A', $6, $6), ($2, 'BUSINESS_CUSTOMER', 'Org B', $6, $6);
     INSERT INTO public.memberships (id, org_id, user_id, status, created_by, updated_by) VALUES
       ($7, $1, $3, 'ACTIVE', $6, $6), (gen_random_uuid(), $2, $4, 'ACTIVE', $6, $6), (gen_random_uuid(), $1, $5, 'REMOVED', $6, $6),
       (gen_random_uuid(), $2, $3, 'ACTIVE', $6, $6);`,
    [orgA, orgB, userA, userB, removed, SYSTEM, membershipA],
  );
  return { orgA, orgB, userA, userB, membershipA };
}

describe('organisations and users (TASK-037) against the committed schema', () => {
  it('[PR26-SEC-04] exactly the two reserved actors exist as system users; no other row may claim is_system', async () => {
    const result = await rolledBack(async (client) => {
      const reserved = await rows(client, 'SELECT id, is_system FROM public.users WHERE is_system ORDER BY id');
      const forged = await outcome(
        client,
        `INSERT INTO public.users (id, email, display_name, is_system, created_by, updated_by) VALUES ($1, 'x@example.com', 'X', true, $2, $2)`,
        [randomUUID(), SYSTEM],
      );
      return { reserved, forged };
    });
    expect(result.reserved).toEqual([
      { id: SYSTEM, is_system: true },
      { id: ANONYMOUS, is_system: true },
    ]);
    expect(result.forged).toMatch(/^23514 .*ck_users__is_system/);
  });

  it('[AT-US-062-01] registration as platform_app: user, INDIVIDUAL organisation, ACTIVE membership and Owner role in one transaction; a forced failure leaves no organisation', async () => {
    const result = await rolledBack(async (client) => {
      const owner = await roleId(client, 'CUSTOMER_OWNER');
      const [user, org] = [randomUUID(), randomUUID()];
      await asApp(client, org, user);
      const steps = [
        await outcome(
          client,
          `INSERT INTO public.users (id, email, display_name, status, personal_org_id, created_by, updated_by) VALUES ($1, 'asha@example.com', 'Asha Rao', 'PENDING_VERIFICATION', $2, $1, $1)`,
          [user, org],
        ),
        await outcome(
          client,
          `INSERT INTO public.organisations (id, type, display_name, personal_owner_user_id, created_by, updated_by) VALUES ($2, 'INDIVIDUAL', 'Asha Rao', $1, $1, $1)`,
          [user, org],
        ),
        await outcome(
          client,
          `WITH m AS (INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by) VALUES ($2, $1, 'ACTIVE', $1, $1) RETURNING id)
           INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by) SELECT $2, m.id, $3, $1, $1, $1 FROM m`,
          [user, org, owner],
        ),
      ];
      await client.query('SET CONSTRAINTS ALL IMMEDIATE'); // the deferred users.personal_org_id check, as at COMMIT
      const visible = await rows(client, 'SELECT type, display_name, personal_owner_user_id FROM public.organisations');
      await asSuperuser(client);
      // Forced failure: the user insert fails, the transaction is rolled back, nothing of the unit persists.
      const [user2, org2] = [randomUUID(), randomUUID()];
      await asApp(client, org2, user2);
      await client.query('SAVEPOINT unit');
      let failed = 'no failure';
      try {
        await client.query(
          `INSERT INTO public.users (id, email, display_name, created_by, updated_by) VALUES ($1, 'NOT-LOWER@Example.com', 'B', $1, $1)`,
          [user2],
        );
        await client.query(
          `INSERT INTO public.organisations (id, type, display_name, personal_owner_user_id, created_by, updated_by) VALUES ($2, 'INDIVIDUAL', 'B', $1, $1, $1)`,
          [user2, org2],
        );
      } catch (error) {
        failed = String((error as { code?: unknown }).code);
        await client.query('ROLLBACK TO SAVEPOINT unit');
      }
      await asSuperuser(client);
      const leftovers = await rows(client, 'SELECT id FROM public.organisations WHERE id = $1', [org2]);
      return { steps, visible, failed, leftovers };
    });
    expect(result.steps).toEqual(['ok', 'ok', 'ok']);
    expect(result.visible).toEqual([{ type: 'INDIVIDUAL', display_name: 'Asha Rao', personal_owner_user_id: expect.any(String) }]);
    expect(result.failed).toBe('23514');
    expect(result.leftovers).toEqual([]);
  });

  it('[AT-US-061-01] the migration creates exactly one OPERATOR organisation (reserved id, SYSTEM actor, version 1, no member); the reference seed run twice leaves it unchanged', async () => {
    // Its own clone: the reference seed commits, and the other cases share `database`.
    const seeded = await db.clone(await db.template({ migrated: true }));
    const snapshot = async (): Promise<{ count: Row[]; operators: Row[]; members: Row[] }> => {
      const client = await db.superuser(seeded);
      try {
        return {
          count: await rows(client, 'SELECT count(*)::int AS n FROM public.organisations'),
          operators: await rows(
            client,
            `SELECT id, type, display_name, created_by, updated_by, version, deleted_at, personal_owner_user_id, xmin::text AS xmin
               FROM public.organisations WHERE type = 'OPERATOR'`,
          ),
          members: await rows(client, 'SELECT count(*)::int AS n FROM public.memberships WHERE org_id = $1', [OPERATOR_ORG]),
        };
      } finally {
        await client.end();
      }
    };
    const seed = async (): Promise<void> => {
      const client = new pg.Client(db.migratorConnection(seeded));
      await client.connect();
      try {
        await runReferenceSeed({
          sql: client,
          datasets: REFERENCE_DATASETS,
          steps: REFERENCE_STEPS,
          logger: SILENT,
          configChanges: NO_CONFIG_SINK,
        });
      } finally {
        await client.end();
      }
    };
    const migrated = await snapshot();
    await seed();
    await seed();
    const reseeded = await snapshot();
    expect(migrated.operators).toEqual([
      {
        id: OPERATOR_ORG,
        type: 'OPERATOR',
        display_name: 'Operator',
        created_by: SYSTEM,
        updated_by: SYSTEM,
        version: 1,
        deleted_at: null,
        personal_owner_user_id: null,
        xmin: expect.any(String),
      },
    ]);
    expect(migrated.members).toEqual([{ n: 0 }]);
    // Unchanged by two seed runs: same row count and the same physical row (xmin), so the seed neither wrote nor
    // re-created it.
    expect(reseeded).toEqual(migrated);
  });

  it('[AT-US-061-02] with nothing planted, an OPERATOR organisation insert fails on ux_organisations__single_operator as platform_app and as the superuser', async () => {
    const result = await rolledBack(async (client) => {
      const [org, actor] = [randomUUID(), randomUUID()];
      // platform_app in the context of a fresh organisation id: RLS WITH CHECK (id = app_org_id()) admits the row, the
      // occupied unique index refuses it (D-ARCH-151).
      await asApp(client, org, actor);
      const app = await outcome(
        client,
        `INSERT INTO public.organisations (id, type, display_name, created_by, updated_by) VALUES ($1, 'OPERATOR', 'Second', $2, $2)`,
        [org, actor],
      );
      // The superuser with triggers and foreign keys off (replica): only the unique index can refuse the row.
      await asSuperuser(client);
      await client.query('SET LOCAL session_replication_role = replica');
      const superuser = await outcome(
        client,
        `INSERT INTO public.organisations (id, type, display_name, created_by, updated_by) VALUES ($1, 'OPERATOR', 'Second', $2, $2)`,
        [randomUUID(), SYSTEM],
      );
      await client.query('SET LOCAL session_replication_role = origin');
      const operators = await rows(client, `SELECT id FROM public.organisations WHERE type = 'OPERATOR'`);
      return { app, superuser, operators };
    });
    expect(result.app).toMatch(/^23505 .*ux_organisations__single_operator/);
    expect(result.superuser).toMatch(/^23505 .*ux_organisations__single_operator/);
    expect(result.operators).toEqual([{ id: OPERATOR_ORG }]);
  });

  it('[AT-US-061-03] a direct SQL update of type is rejected by the database (trg_organisations__type_immutable)', async () => {
    const result = await rolledBack(async (client) => {
      const { orgA, userA } = await world(client);
      await asApp(client, orgA, userA);
      return outcome(client, `UPDATE public.organisations SET type = 'INDIVIDUAL', updated_by = $2, version = version + 1 WHERE id = $1`, [
        orgA,
        userA,
      ]);
    });
    expect(result).toMatch(/^P0001 ORG_TYPE_IMMUTABLE/);
  });

  it('[AT-US-062-02] the database backstop refuses an operator role on a BUSINESS_CUSTOMER membership; a customer role passes', async () => {
    const result = await rolledBack(async (client) => {
      const [support, viewer] = [await roleId(client, 'OPERATOR_SUPPORT'), await roleId(client, 'CUSTOMER_VIEWER')];
      const { orgA, userA, membershipA } = await world(client);
      await asApp(client, orgA, userA);
      const insert = (role: string): Promise<string> =>
        outcome(
          client,
          `INSERT INTO public.membership_roles (org_id, membership_id, role_id, granted_by, created_by, updated_by) VALUES ($1, $2, $3, $4, $4, $4)`,
          [orgA, membershipA, role, userA],
        );
      return { operator: await insert(support), customer: await insert(viewer) };
    });
    expect(result.operator).toMatch(/^P0001 ROLE_NOT_ALLOWED_FOR_ORG_TYPE/);
    expect(result.customer).toBe('ok');
  });

  it('[AT-US-062-03] a second non-removed membership for (user, org) is refused; after REMOVED a new row is accepted and the old one remains', async () => {
    const result = await rolledBack(async (client) => {
      const { orgA, userA, membershipA } = await world(client);
      await asApp(client, orgA, userA);
      const insert = (): Promise<string> =>
        outcome(
          client,
          `INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by) VALUES ($1, $2, 'ACTIVE', $2, $2)`,
          [orgA, userA],
        );
      const duplicate = await insert();
      const removed = await outcome(
        client,
        `UPDATE public.memberships SET status = 'REMOVED', removed_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
        [membershipA, userA],
      );
      const readded = await insert();
      const history = await rows(client, `SELECT status FROM public.memberships WHERE org_id = $1 AND user_id = $2 ORDER BY status`, [
        orgA,
        userA,
      ]);
      return { duplicate, removed, readded, history };
    });
    expect(result.duplicate).toMatch(/^23505 .*ux_memberships__org_user_live/);
    expect([result.removed, result.readded]).toEqual(['ok', 'ok']);
    expect(result.history).toEqual([{ status: 'ACTIVE' }, { status: 'REMOVED' }]);
  });

  it('[AT-US-062-04] a personal organisation is not deleted while its user is active: soft delete raises, hard delete has no privilege', async () => {
    const result = await rolledBack(async (client) => {
      const [user, org] = [randomUUID(), randomUUID()];
      await fixture(
        client,
        `INSERT INTO public.users (id, email, display_name, status, personal_org_id, created_by, updated_by) VALUES ($1, 'p-' || $1 || '@example.com', 'P', 'ACTIVE', $2, $3, $3);
         INSERT INTO public.organisations (id, type, display_name, personal_owner_user_id, created_by, updated_by) VALUES ($2, 'INDIVIDUAL', 'P', $1, $3, $3)`,
        [user, org, SYSTEM],
      );
      await asApp(client, org, user);
      const soft = await outcome(
        client,
        `UPDATE public.organisations SET deleted_at = now(), deleted_by = $2, updated_by = $2, version = version + 1 WHERE id = $1`,
        [org, user],
      );
      const hard = await outcome(client, 'DELETE FROM public.organisations WHERE id = $1', [org]);
      await asSuperuser(client);
      const remaining = await rows(client, 'SELECT deleted_at FROM public.organisations WHERE id = $1', [org]);
      return { soft, hard, remaining };
    });
    expect(result.soft).toMatch(/^P0001 PERSONAL_ORG_OWNER_ACTIVE/);
    expect(result.hard).toMatch(/^42501 /);
    expect(result.remaining).toEqual([{ deleted_at: null }]);
  });

  it('[C12] DR-A14: org A sees its organisation and memberships; an actor sees its own memberships across organisations; a forced OPERATOR scope shows a customer nothing of org B', async () => {
    const result = await rolledBack(async (client) => {
      const { orgA, orgB, userA, userB } = await world(client);
      await asApp(client, orgA, userA);
      const orgs = (await rows<{ id: string }>(client, 'SELECT id FROM public.organisations')).map((row) => row.id).sort();
      const memberships = (await rows<{ org_id: string; status: string }>(client, 'SELECT org_id, status FROM public.memberships'))
        .map((row) => `${row.org_id === orgA ? 'A' : row.org_id === orgB ? 'B' : '?'} ${row.status}`)
        .sort();
      const users = (await rows<{ id: string }>(client, 'SELECT id FROM public.users')).map((row) => row.id);
      await asSuperuser(client);
      // A customer of no organisation forcing app.actor_scope = OPERATOR: app_is_operator() is false, nothing of B.
      await asApp(client, orgA, randomUUID(), 'OPERATOR');
      const forced = {
        orgB: await rows(client, 'SELECT id FROM public.organisations WHERE id = $1', [orgB]),
        membershipsB: await rows(client, 'SELECT id FROM public.memberships WHERE org_id = $1', [orgB]),
        users: await rows(client, 'SELECT id FROM public.users WHERE id = $1', [userB]),
      };
      return { orgA, orgB, userA, orgs, memberships, users, forced };
    });
    // userA is an ACTIVE member of A and of B: the active organisation plus member_read.
    expect(result.orgs).toEqual([result.orgA, result.orgB].sort());
    // Every membership of A (tenant branch, the REMOVED one included) plus userA's own membership of B (own_read).
    expect(result.memberships).toEqual(['A ACTIVE', 'A REMOVED', 'B ACTIVE']);
    // Own row only: the REMOVED member of A is never visible (positive status list, D-ARCH-123); B's members are not.
    expect(result.users).toEqual([result.userA]);
    expect(result.forced).toEqual({ orgB: [], membershipsB: [], users: [] });
  });

  it('[D-ARCH-123] no membership row and no seed or fixture source writes the reserved status INVITED', async () => {
    const live = await rolledBack((client) => rows(client, `SELECT count(*)::int AS n FROM public.memberships WHERE status = 'INVITED'`));
    expect(live).toEqual([{ n: 0 }]);
    const root = findRepoRoot();
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
      );
    const writers = sources(join(root, 'prisma', 'seed')).filter((file) => /'INVITED'/.test(readFileSync(file, 'utf8')));
    expect(writers).toEqual([]);
  });

  it('[SEC-TC-74] [PR26-SEC-03] the standard-columns guard on the real tables: a forged stamp raises, a re-parenting UPDATE is refused by RLS WITH CHECK', async () => {
    const result = await rolledBack(async (client) => {
      const { orgA, orgB, userA, membershipA } = await world(client);
      await asApp(client, orgA, userA);
      const forgedCreator = await outcome(
        client,
        `INSERT INTO public.memberships (org_id, user_id, status, created_by, updated_by) VALUES ($1, $2, 'SUSPENDED', $3, $2)`,
        [orgA, randomUUID(), SYSTEM],
      );
      const forgedVersion = await outcome(
        client,
        `UPDATE public.organisations SET display_name = 'X', updated_by = $2, version = 7 WHERE id = $1`,
        [orgA, userA],
      );
      const reparent = await outcome(
        client,
        `UPDATE public.memberships SET org_id = $2, updated_by = $3, version = version + 1 WHERE id = $1`,
        [membershipA, orgB, userA],
      );
      const correct = await outcome(
        client,
        `UPDATE public.organisations SET display_name = 'Org A2', updated_by = $2, version = version + 1 WHERE id = $1`,
        [orgA, userA],
      );
      return { forgedCreator, forgedVersion, reparent, correct };
    });
    expect(result.forgedCreator).toMatch(/^P0001 STD_COLUMNS_VIOLATION: created_by on public\.memberships \(INSERT\)$/);
    expect(result.forgedVersion).toMatch(/^P0001 STD_COLUMNS_VIOLATION: version on public\.organisations \(UPDATE\)$/);
    expect(result.reparent).toMatch(/^42501 /);
    expect(result.correct).toBe('ok');
  });
});
