/**
 * PR19-SEC-01 / D-ARCH-080 on the real client and database: the SYSTEM-class `referenceDatasetVersion` delegate is
 * absent from `TenantDb` (compile time: the conditional type below; run time: a read throws `TenantDbAccessError`
 * naming the `systemDelegates` port), while `systemDelegates(tx)` reaches it INSIDE the same tenant transaction.
 *
 * "Same transaction" is proven with a one-connection pool and a short pool wait: the transaction holds the only
 * connection, so a delegate that ran on the root client (outside the transaction) could not get a connection and
 * would fail; and a delegate kept past the callback throws `TENANT_TX_CLOSED`. GLOBAL catalogue delegates stay in
 * `TenantDb` (read-only by grant).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { type SystemDelegates, systemDelegates } from '../../../apps/api/src/platform/db/system-db.js';
import { SYSTEM_MODEL_HINT, type TenantDb, TenantDbAccessError } from '../../../apps/api/src/platform/db/tenant-db.js';
import { createWithTenantTx, type TenantContext } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

type Tx = Prisma.TransactionClient;
type Db = TenantDb<Tx>;

// Compile-time half (a conditional type, not a ts-expect-error comment): the SYSTEM delegate is not a key of TenantDb,
// the GLOBAL catalogue delegate is, and systemDelegates offers the SYSTEM delegate.
type Absent<T, K extends PropertyKey> = K extends keyof T ? false : true;
type Present<T, K extends PropertyKey> = K extends keyof T ? true : false;
const TYPE_CHECKS: readonly [
  Absent<Db, 'referenceDatasetVersion'>,
  Present<Db, 'role'>,
  Present<SystemDelegates<Tx>, 'referenceDatasetVersion'>,
  Absent<SystemDelegates<Tx>, 'role'>,
] = [true, true, true, true];

const DATASET = `system-delegates-${randomUUID().slice(0, 8)}`;
const ACTOR = randomUUID();
const CONTEXT: TenantContext = {
  orgId: randomUUID(),
  actorId: ACTOR,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: 'rls-system-delegates',
};

let postgres: PlatformPostgres;
let database: string;
let single: PrismaClient;

const read = (value: unknown, key: PropertyKey): unknown => (value as Record<PropertyKey, unknown>)[key];

beforeAll(async () => {
  postgres = await PlatformPostgres.start();
  database = await postgres.clone(await postgres.template({ migrated: true }));
  const migrator = new pg.Client(postgres.migratorConnection(database));
  await migrator.connect();
  try {
    // The table's single writer is the seed as its owner (D-ARCH-075); platform_app holds SELECT only.
    await migrator.query(
      `INSERT INTO public.reference_dataset_versions (created_by, updated_by, dataset, dataset_version, content_sha256, applied_at, row_count)
       VALUES ($1, $1, $2, 'v1', $3, now(), 0)`,
      [ACTOR, DATASET, randomBytes(32)],
    );
  } finally {
    await migrator.end();
  }
  const { PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  single = createDatabaseClient(PrismaCtor, {
    connectionString: postgres.appUrl(database),
    poolMax: 1,
    applicationName: 'rls-system-delegates',
    connectionTimeoutMs: 2_000,
  });
}, 300_000);

afterAll(async () => {
  await single?.$disconnect();
  await postgres?.stop();
});

describe('PR19-SEC-01 SYSTEM delegates (D-ARCH-080)', () => {
  it('[PR19-SEC-01] referenceDatasetVersion is absent from TenantDb while systemDelegates(tx) reaches it in the same transaction', async () => {
    expect(TYPE_CHECKS).toEqual([true, true, true, true]);
    const { withTenantTx } = createWithTenantTx(
      single,
      { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 2_000 },
      {
        onSecurityEvent: () => undefined,
        countSessionContextLeak: () => undefined,
        markNotReady: () => undefined,
        // The plain client: this test is about the SYSTEM port, not the standard columns (PR #26 union).
        scopeClient: () => single,
      },
    );
    let kept: SystemDelegates<Tx>['referenceDatasetVersion'] | undefined;
    const outcome = await withTenantTx(CONTEXT, async (db) => {
      expect(() => read(db, 'referenceDatasetVersion')).toThrow(new TenantDbAccessError('referenceDatasetVersion', SYSTEM_MODEL_HINT));
      expect('referenceDatasetVersion' in db).toBe(false);
      expect(Reflect.ownKeys(db)).not.toContain('referenceDatasetVersion');
      // GLOBAL catalogue delegates stay in TenantDb.
      expect(Reflect.ownKeys(db)).toContain('role');
      const delegate = systemDelegates(db).referenceDatasetVersion;
      kept = delegate;
      const rows = await delegate.findMany({ where: { dataset: DATASET }, select: { dataset: true, datasetVersion: true } });
      // The same connection is still inside the transaction afterwards (one-connection pool).
      const [state] = await db.$queryRaw<{ in_tx: boolean }[]>`SELECT now() = statement_timestamp() AS in_tx`;
      return { rows, inTx: state?.in_tx };
    });
    expect(outcome).toEqual({ rows: [{ dataset: DATASET, datasetVersion: 'v1' }], inTx: false });
    expect(() => kept?.findMany).toThrow('Database error: TENANT_TX_CLOSED');
  });
});
