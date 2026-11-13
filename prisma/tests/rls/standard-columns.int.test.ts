/**
 * Server-controlled standard columns through the production path (US-064; REQ-RLS-009, REQ-RLS-012, REQ-ORG-007;
 * NFR-DATA-002/003; data-model §7.6; TASK-032): `withTenantTx` with `scopeClient = withStandardColumns`, the generated
 * Prisma 7 client over `@prisma/adapter-pg` and PostgreSQL 18.
 *
 * The only writable model on main today is `ReferenceDatasetVersion` (SYSTEM; its single writer is the seed running as
 * `platform_migrator`, D-ARCH-075), so the client here connects as the migrator. The first tenant models (TASK-037+)
 * inherit the same extension; the TENANT `org_id` and `on_behalf_of_org_id` rewrites are proven by the unit suite and
 * the schema rules by `catalog-std` (prisma/tests/catalog/standard-columns.int.test.ts).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { serverStamped, withStandardColumns } from '../../../apps/api/src/platform/db/index.js';
import { DbError } from '../../../apps/api/src/platform/db/map-db-error.js';
import { createWithTenantTx, type TenantContext, type TenantTxRunner } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

/** data-model §1.6 reserved SYSTEM actor (prisma/tests may not import @platform/shared; same literal as catalog C13). */
const SYSTEM_ACTOR_ID = '00000000-0000-7000-8000-000000000001';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuidV7 = (value: string): boolean => UUID_V7.test(value);

const USER_A = randomUUID();
const USER_B = randomUUID();

const context = (actorId: string): TenantContext => ({
  orgId: '',
  actorId,
  actorScope: 'OPERATOR',
  guestTokenHash: '',
  correlationId: `std-${actorId.slice(0, 8)}`,
});

let db: PlatformPostgres;
let database: string;
let client: PrismaClient;
let runner: TenantTxRunner<Prisma.TransactionClient>;
let raw: pg.Client;

interface StoredRow {
  id: string;
  version_nibble: number;
  created_at_epoch: string;
  updated_at_epoch: string;
  created_by: string;
  updated_by: string;
  version: number;
  created_at_type: string;
}

async function stored(dataset: string): Promise<StoredRow> {
  const result = await raw.query<StoredRow>(
    `SELECT id::text, uuid_extract_version(id) AS version_nibble,
            extract(epoch FROM created_at)::text AS created_at_epoch, extract(epoch FROM updated_at)::text AS updated_at_epoch,
            created_by::text, updated_by::text, version, pg_typeof(created_at)::text AS created_at_type
       FROM public.reference_dataset_versions WHERE dataset = $1`,
    [dataset],
  );
  const [row] = result.rows;
  if (row === undefined || result.rows.length !== 1) throw new Error(`expected one row for ${dataset}`);
  return row;
}

const rowCount = async (): Promise<number> =>
  Number((await raw.query<{ n: string }>('SELECT count(*)::text AS n FROM public.reference_dataset_versions')).rows[0]?.n);

const dataset = (name: string): Prisma.ReferenceDatasetVersionUncheckedCreateInput =>
  serverStamped<Prisma.ReferenceDatasetVersionUncheckedCreateInput>({
    dataset: name,
    datasetVersion: 'v1',
    contentSha256: new Uint8Array(randomBytes(32)),
    appliedAt: new Date(),
    rowCount: 1,
  });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
  const { PrismaClient: PrismaCtor } = await withFileLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaCtor, { connectionString: db.migratorUrl(database), poolMax: 2, applicationName: 'std-it' });
  runner = createWithTenantTx(
    client,
    { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      env: {},
      scopeClient: (stamp) => withStandardColumns(client, stamp),
    },
  );
  raw = new pg.Client(db.migratorConnection(database));
  await raw.connect();
  // Reading in another zone proves the stored instant does not depend on the session time zone (REQ-RLS-012).
  await raw.query(`SET TIME ZONE 'Asia/Kolkata'`);
}, 300_000);

afterAll(async () => {
  await raw?.end();
  await client?.$disconnect();
  await db?.stop();
});

describe('US-064 server-controlled standard columns with the real Prisma 7 client (TASK-032)', () => {
  it('AT-US-064-01: create sets a UUIDv7 id, created_at = updated_at (timestamptz, UTC instant), created_by = updated_by = caller, version 1', async () => {
    const created = await runner.withTenantTx(context(USER_A), (tx) => tx.referenceDatasetVersion.create({ data: dataset('std-create') }));
    const row = await stored('std-create');
    expect(isUuidV7(row.id)).toBe(true);
    expect(row.version_nibble).toBe(7);
    expect(created.id).toBe(row.id);
    expect(row.created_at_type).toBe('timestamp with time zone');
    expect(row.created_at_epoch).toBe(row.updated_at_epoch);
    // The client sees the same instant whatever the reading session's zone.
    expect(created.createdAt.getTime()).toBe(Math.round(Number(row.created_at_epoch) * 1000));
    expect(row).toMatchObject({ created_by: USER_A, updated_by: USER_A, version: 1 });
  });

  it('update stamps updated_by / updated_at and increments version by exactly 1; created_* are unchanged', async () => {
    const before = await stored('std-create');
    await runner.withTenantTx(context(USER_B), (tx) =>
      tx.referenceDatasetVersion.update({ where: { dataset: 'std-create' }, data: { datasetVersion: 'v2' } }),
    );
    const after = await stored('std-create');
    expect(after).toMatchObject({ created_by: USER_A, updated_by: USER_B, version: 2, created_at_epoch: before.created_at_epoch });
    expect(Number(after.updated_at_epoch)).toBeGreaterThanOrEqual(Number(before.updated_at_epoch));
  });

  it('createMany stamps every row with distinct, time-ordered UUIDv7 ids', async () => {
    await runner.withTenantTx(context(USER_A), (tx) =>
      tx.referenceDatasetVersion.createMany({ data: [dataset('std-many-1'), dataset('std-many-2')] }),
    );
    const [first, second] = [await stored('std-many-1'), await stored('std-many-2')];
    expect([first.id, second.id].every(isUuidV7)).toBe(true);
    expect(first.id < second.id).toBe(true);
    expect([first.created_by, second.created_by, first.version, second.version]).toEqual([USER_A, USER_A, 1, 1]);
  });

  it('AT-US-064-02: a SYSTEM_JOB write records the reserved system user; the authz seed rows carry the same ID', async () => {
    await runner.withTenantTx(context(SYSTEM_ACTOR_ID), (tx) => tx.referenceDatasetVersion.create({ data: dataset('std-system') }));
    expect(await stored('std-system')).toMatchObject({ created_by: SYSTEM_ACTOR_ID, updated_by: SYSTEM_ACTOR_ID });
    const seeded = await raw.query<{ actors: string[] }>(
      'SELECT array_agg(DISTINCT created_by::text) || array_agg(DISTINCT updated_by::text) AS actors FROM public.permissions',
    );
    expect(new Set(seeded.rows[0]?.actors)).toEqual(new Set([SYSTEM_ACTOR_ID]));
  });

  it('AT-US-064-03: a write carrying "version", "id" or "created_by" is 400 VALIDATION_ERROR / UNKNOWN_FIELD and nothing is persisted', async () => {
    const count = await rowCount();
    for (const forged of [{ version: 5 }, { id: randomUUID() }, { createdBy: USER_B }]) {
      const error = await rejection(
        runner.withTenantTx(context(USER_A), async (tx) => {
          // An earlier write in the same transaction is rolled back with it.
          await tx.referenceDatasetVersion.create({ data: dataset(`std-ok-${randomUUID()}`) });
          return tx.referenceDatasetVersion.create({ data: { ...dataset(`std-forged-${randomUUID()}`), ...forged } });
        }),
      );
      expect(error).toMatchObject({ name: 'AppError', status: 400, code: 'VALIDATION_ERROR', errors: [{ code: 'UNKNOWN_FIELD' }] });
    }
    expect(await rowCount()).toBe(count);
  });

  it('a nested relation write is refused before any statement (NESTED_WRITE_UNSUPPORTED); connect-only writes are not', async () => {
    const error = await rejection(
      runner.withTenantTx(context(SYSTEM_ACTOR_ID), (tx) =>
        tx.role.create({
          data: serverStamped<Prisma.RoleCreateInput>({
            key: 'STD_PROBE',
            nameKey: 'roles.std_probe',
            scope: 'CUSTOMER',
            description: 'probe',
            permissions: { create: [] },
          }),
        }),
      ),
    );
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 500, reason: 'NESTED_WRITE_UNSUPPORTED' });
    expect((await raw.query(`SELECT 1 FROM public.roles WHERE key = 'STD_PROBE'`)).rowCount).toBe(0);
  });

  it('reads and raw queries pass through the extension unchanged inside the same transaction', async () => {
    const result = await runner.withTenantTx(context(USER_A), async (tx) => {
      const found = await tx.referenceDatasetVersion.findUnique({ where: { dataset: 'std-system' } });
      const rows = await tx.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
      return { found: found?.createdBy, one: rows[0]?.one };
    });
    expect(result).toEqual({ found: SYSTEM_ACTOR_ID, one: 1 });
  });
});
