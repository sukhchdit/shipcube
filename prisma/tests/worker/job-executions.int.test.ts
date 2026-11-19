/**
 * `job_executions` on the real client and database (REQ-PLAT-014, NFR-RES-004; ADR-0013 §4; TASK-039): the claim
 * statement of the worker ledger (`createMany` with `skipDuplicates` through `systemDelegates(tx).jobExecution`, inside
 * a tenant transaction opened SYSTEM-scope) and the table it relies on.
 * - A second claim of a committed key inserts nothing (count 0): the duplicate delivery runs no second effect.
 * - Two concurrent claims of one key: the second waits on `ux_job_executions__job_key` until the first commits, then
 *   inserts nothing; after a rollback it claims the key (the effect's retry runs).
 * - The standard-columns guard holds the row to the SYSTEM actor, and platform_app may not UPDATE or DELETE it.
 * The claim-then-effect logic of `idempotentProcessor` is unit-tested in apps/worker (jobs.test.ts); prisma/tests may
 * import only the api database platform, so the worker module itself is not imported here.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { systemDelegates } from '../../../apps/api/src/platform/db/system-db.js';
import type { TenantDb } from '../../../apps/api/src/platform/db/tenant-db.js';
import { createWithTenantTx, type TenantContext } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { APP_ROLE, PlatformPostgres } from '../harness/postgres.js';

type Tx = Prisma.TransactionClient;

/** The reserved SYSTEM actor (data-model §1.6; `SYSTEM_ACTOR_ID` of @platform/shared). */
const SYSTEM = '00000000-0000-7000-8000-000000000001';
const SYSTEM_JOB: TenantContext = {
  orgId: '',
  actorId: SYSTEM,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: 'job-executions-it',
};

let postgres: PlatformPostgres;
let database: string;
let client: PrismaClient;
let withTenantTx: <R>(ctx: TenantContext, fn: (db: TenantDb<Tx>) => Promise<R>) => Promise<R>;

/** The worker ledger's claim: true when this transaction inserted the key. */
async function claim(db: TenantDb<Tx>, jobKey: string): Promise<boolean> {
  const { count } = await systemDelegates(db).jobExecution.createMany({
    data: [{ jobKey, queue: 'outbox-relay', status: 'completed', createdBy: SYSTEM, updatedBy: SYSTEM }],
    skipDuplicates: true,
  });
  return count === 1;
}

async function rows(jobKey: string): Promise<Record<string, unknown>[]> {
  const admin = await postgres.superuser(database);
  try {
    const result = await admin.query(
      'SELECT job_key, queue, status, created_by, updated_by, version FROM public.job_executions WHERE job_key = $1',
      [jobKey],
    );
    return result.rows as Record<string, unknown>[];
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  postgres = await PlatformPostgres.start();
  database = await postgres.clone(await postgres.template({ migrated: true }));
  const { PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaCtor, {
    connectionString: postgres.appUrl(database),
    poolMax: 3,
    applicationName: 'job-executions-it',
    connectionTimeoutMs: 5_000,
  });
  ({ withTenantTx } = createWithTenantTx(
    client,
    { statementTimeoutMs: 5_000, lockTimeoutMs: 4_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      // The plain client: the claim names the SYSTEM actor itself, as the standard-columns extension would stamp it.
      scopeClient: () => client,
    },
  ));
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  await postgres?.stop();
});

describe('[REQ-PLAT-014] job_executions claims (PostgreSQL 18)', () => {
  it('a second claim of a committed job key inserts nothing; the row carries the SYSTEM actor', async () => {
    const key = 'outbox_event.0193a5b2-7c1e-7d4a-9f3b-0000000e0001';
    expect(await withTenantTx(SYSTEM_JOB, (db) => claim(db, key))).toBe(true);
    expect(await withTenantTx(SYSTEM_JOB, (db) => claim(db, key))).toBe(false);
    expect(await rows(key)).toEqual([
      { job_key: key, queue: 'outbox-relay', status: 'completed', created_by: SYSTEM, updated_by: SYSTEM, version: 1 },
    ]);
  });

  it('two concurrent claims of one key: exactly one wins, the other waits for its commit and inserts nothing', async () => {
    const key = 'outbox_event.0193a5b2-7c1e-7d4a-9f3b-0000000e0002';
    const effect = async (db: TenantDb<Tx>): Promise<boolean> => {
      const won = await claim(db, key);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return won;
    };
    const results = await Promise.all([withTenantTx(SYSTEM_JOB, effect), withTenantTx(SYSTEM_JOB, effect)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rows(key)).toHaveLength(1);
  });

  it('a claim whose transaction rolls back (the effect threw) leaves the key free for the retry', async () => {
    const key = 'outbox_event.0193a5b2-7c1e-7d4a-9f3b-0000000e0003';
    await expect(
      withTenantTx(SYSTEM_JOB, async (db) => {
        await claim(db, key);
        throw new Error('carrier timeout');
      }),
    ).rejects.toThrow('carrier timeout');
    expect(await rows(key)).toEqual([]);
    expect(await withTenantTx(SYSTEM_JOB, (db) => claim(db, key))).toBe(true);
  });

  it('platform_app holds SELECT and INSERT only: UPDATE and DELETE are refused', async () => {
    const app = new pg.Client({ connectionString: postgres.appUrl(database) });
    await app.connect();
    try {
      await expect(app.query("UPDATE public.job_executions SET status = 'completed'")).rejects.toMatchObject({ code: '42501' });
      await expect(app.query('DELETE FROM public.job_executions')).rejects.toMatchObject({ code: '42501' });
      const { rows: grants } = await app.query(
        "SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'job_executions' AND grantee = $1 ORDER BY 1",
        [APP_ROLE],
      );
      expect(grants.map((row: { privilege_type: string }) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
    } finally {
      await app.end();
    }
  });
});
