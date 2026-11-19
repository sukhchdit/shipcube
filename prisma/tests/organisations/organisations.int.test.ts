/**
 * Organisations and users against PostgreSQL 18 with the committed migrations (TASK-037; US-061, US-062; REQ-ORG-001..
 * 004, DR-A05, DR-A06, DR-A14; data-model §3.1, §3.2, §4.3, §7.6; PR26-SEC-03/04, D-ARCH-123; SEC-TC-74). Every case
 * runs in a rolled-back transaction; the statements live in `cases.ts` (fixture rows as the superuser with
 * `session_replication_role = replica`, the case itself as `platform_app` with the production context statement of
 * withTenantTx), so RLS, the standard-columns guard and the domain triggers decide exactly as at runtime. The one
 * OPERATOR organisation is the reserved row of the migration (D-ARCH-151): no case plants one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { findRepoRoot } from '../../../tools/test-support/process.js';
import type { ConfigChangeSink, SeedLogger } from '../../seed/framework/contracts.js';
import { runReferenceSeed } from '../../seed/framework/runner.js';
import { REFERENCE_DATASETS, REFERENCE_STEPS } from '../../seed/reference/index.js';
import { PlatformPostgres } from '../harness/postgres.js';
import {
  ANONYMOUS,
  drA14,
  invitedMemberships,
  membershipLookup,
  OPERATOR_ORG,
  personalDelete,
  personalOwnerRepoint,
  registration,
  reservedActors,
  roleScopeBackstop,
  type Row,
  rows,
  secondMembership,
  secondOperator,
  stdColumns,
  SYSTEM,
  typeImmutable,
  withCheckGuardedTables,
} from './cases.js';

const SILENT: SeedLogger = { info: () => undefined, warn: () => undefined };
const NO_CONFIG_SINK: ConfigChangeSink = { configChanged: () => Promise.resolve() };
const RLS_REFUSED = /^42501 new row violates row-level security policy/;

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
}, 60_000);

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

describe('organisations and users (TASK-037) against the committed schema', () => {
  it('[PR26-SEC-04] exactly the two reserved actors exist as system users; no other row may claim is_system', async () => {
    const result = await rolledBack(reservedActors);
    expect(result.reserved).toEqual([
      { id: SYSTEM, is_system: true },
      { id: ANONYMOUS, is_system: true },
    ]);
    expect(result.forged).toMatch(/^23514 .*ck_users__is_system/);
  });

  it('[AT-US-062-01] registration as platform_app: user, INDIVIDUAL organisation, ACTIVE membership and Owner role in one transaction; a forced failure leaves no organisation', async () => {
    const result = await rolledBack(registration);
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
          members: await rows(client, 'SELECT count(*)::int AS n FROM public.memberships WHERE org_id = $1::uuid', [OPERATOR_ORG]),
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
    const result = await rolledBack(secondOperator);
    expect(result.app).toMatch(/^23505 .*ux_organisations__single_operator/);
    expect(result.superuser).toMatch(/^23505 .*ux_organisations__single_operator/);
    expect(result.operators).toEqual([{ id: OPERATOR_ORG }]);
  });

  it('[AT-US-061-03] a direct SQL update of type is rejected by trg_organisations__type_immutable (BUSINESS_CUSTOMER -> PARTNER, the reserved OPERATOR row -> BUSINESS_CUSTOMER); without the trigger the change would pass', async () => {
    const result = await rolledBack(typeImmutable);
    expect(result.partner).toMatch(/^P0001 ORG_TYPE_IMMUTABLE/);
    expect(result.operatorRow).toMatch(/^P0001 ORG_TYPE_IMMUTABLE/);
    // INDIVIDUAL without a personal owner never reaches the trigger: the CHECK refuses it first (R1-M2).
    expect(result.individual).toMatch(/^23514 .*ck_organisations__personal_owner/);
    // Mutant control: the trigger is what refuses the PARTNER change.
    expect(result.withoutTrigger).toBe('ok');
  });

  it('[AT-US-062-02] the database backstop refuses an operator role on a BUSINESS_CUSTOMER membership; a customer role passes', async () => {
    const result = await rolledBack(roleScopeBackstop);
    expect(result.operator).toMatch(/^P0001 ROLE_NOT_ALLOWED_FOR_ORG_TYPE/);
    expect(result.customer).toBe('ok');
  });

  it('[AT-US-062-03] a second non-removed membership for (user, org) is refused; after REMOVED a new row is accepted and the old one remains', async () => {
    const result = await rolledBack(secondMembership);
    expect(result.duplicate).toMatch(/^23505 .*ux_memberships__org_user_live/);
    expect([result.removed, result.readded]).toEqual(['ok', 'ok']);
    expect(result.history).toEqual([{ status: 'ACTIVE' }, { status: 'REMOVED' }]);
  });

  it('[AT-US-062-04] a personal organisation is not deleted while its user is active: soft delete raises, hard delete has no privilege', async () => {
    const result = await rolledBack(personalDelete);
    expect(result.soft).toMatch(/^P0001 PERSONAL_ORG_OWNER_ACTIVE/);
    expect(result.hard).toMatch(/^42501 /);
    expect(result.remaining).toEqual([{ deleted_at: null }]);
  });

  it('[R1-m3] [AT-US-062-04] re-pointing the owner to a visible DEACTIVATED user and deleting in one UPDATE is refused (the guard reads OLD); the owner cannot be re-pointed at all', async () => {
    const result = await rolledBack(personalOwnerRepoint);
    expect(result.deactivatedVisible).toBe(1); // the attack's precondition holds: the target user is visible
    expect(result.repointAndDelete).toMatch(/^P0001 PERSONAL_ORG_OWNER_ACTIVE/);
    expect(result.repoint).toMatch(/^P0001 PERSONAL_OWNER_IMMUTABLE/);
    expect(result.remaining).toEqual([{ personal_owner_user_id: expect.any(String), deleted_at: null }]);
  });

  it('[R1-m2] membership_roles and invitations: for an actor who is a member of A and B, WITH CHECK (not the role-scope guard) refuses org_id = B on INSERT and on a re-parenting UPDATE', async () => {
    const result = await rolledBack(withCheckGuardedTables);
    expect(result['ownRows']).toBe('inserted'); // positive control: the same statements succeed for org A
    for (const key of ['membershipRoleInsertB', 'membershipRoleReparent', 'invitationInsertB', 'invitationReparent']) {
      expect([key, result[key]]).toEqual([key, expect.stringMatching(RLS_REFUSED)]);
    }
  });

  it('[R1-m1] a membership of another organisation is visible through own_read and found only without the organisation filter the repository applies', async () => {
    expect(await rolledBack(membershipLookup)).toEqual({ withoutFilter: 1, foreignWithFilter: 0, ownWithFilter: 1 });
  });

  it('[C12] DR-A14: org A sees its organisation and memberships; an actor sees its own memberships across organisations; a customer forcing the OPERATOR scope sees nothing more than in TENANT scope', async () => {
    const result = await rolledBack(drA14);
    // userA is an ACTIVE member of A and of B: the active organisation plus member_read.
    expect(result.orgs).toEqual([result.world.orgA, result.world.orgB].sort());
    // Every membership of A (tenant branch, the REMOVED one included) plus userA's own membership of B (own_read).
    expect(result.memberships).toEqual(['A ACTIVE', 'A REMOVED', 'B ACTIVE']);
    // Own row only: the REMOVED member of A is never visible (positive status list, D-ARCH-123); B's members are not.
    expect(result.users).toEqual([result.world.userA]);
    // R1-n4: userB is a real customer, ACTIVE in B only. Forcing OPERATOR adds nothing (app_is_operator() is false).
    expect(result.forcedOperator).toEqual(result.tenantScope);
    expect(result.tenantScope.organisations).toEqual([result.world.orgB]);
    expect(result.forcedSeesA).toEqual({ organisation: false, memberships: false });
  });

  it('[D-ARCH-123] no membership row and no seed or fixture source writes the reserved status INVITED', async () => {
    expect(await rolledBack(invitedMemberships)).toEqual([{ n: 0 }]);
    const root = findRepoRoot();
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
      );
    const writers = sources(join(root, 'prisma', 'seed')).filter((file) => /'INVITED'/.test(readFileSync(file, 'utf8')));
    expect(writers).toEqual([]);
  });

  it('[SEC-TC-74] [PR26-SEC-03] the standard-columns guard on the real tables: a forged stamp raises, a re-parenting UPDATE is refused by RLS WITH CHECK', async () => {
    const result = await rolledBack(stdColumns);
    expect(result['forgedCreator']).toMatch(/^P0001 STD_COLUMNS_VIOLATION: created_by on public\.memberships \(INSERT\)$/);
    expect(result['forgedVersion']).toMatch(/^P0001 STD_COLUMNS_VIOLATION: version on public\.organisations \(UPDATE\)$/);
    expect(result['reparent']).toMatch(/^42501 /);
    expect(result['correct']).toBe('ok');
  });
});
