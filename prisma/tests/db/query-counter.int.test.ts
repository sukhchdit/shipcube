/**
 * The query counter (TASK-276; NFR-PERF-006, NT-PERF-006-b) through the production path: the generated Prisma 7 client
 * over `@prisma/adapter-pg` and PostgreSQL 18, extended with the counter and run through `withTenantTx` with
 * `scopeClient = withStandardColumns`. It proves what the unit suite cannot: that the top-level `$allOperations` hook
 * sees model AND raw queries, that AsyncLocalStorage scoping survives an interactive transaction and the extension
 * stack, and that two concurrent scopes stay apart. The client connects as the migrator (the only readable model on
 * main is `ReferenceDatasetVersion`; it is SYSTEM-class, so inside a tenant transaction it is reached through
 * `systemDelegates(tx)` (PR19-SEC-01, D-ARCH-080), as in the standard-columns suite).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { assertQueryBudget, createQueryCounter, withQueryCounter } from '../../../apps/api/src/platform/db/query-counter.js';
import { withStandardColumns } from '../../../apps/api/src/platform/db/index.js';
import { systemDelegates } from '../../../apps/api/src/platform/db/system-db.js';
import { createWithTenantTx, type TenantContext, type TenantTxRunner } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

const context: TenantContext = {
  orgId: '',
  actorId: '00000000-0000-7000-8000-000000000001',
  actorScope: 'OPERATOR',
  guestTokenHash: '',
  correlationId: 'query-counter-it',
};

const counter = createQueryCounter();
/**
 * Connection, statement, lock and idle budgets of this suite (W0-FLAKE, FU-PR34-1). The 5 s / 2 s values timed out when the
 * host was loaded by parallel suites; no case here asserts a timeout, so a wide budget costs nothing but a hung query.
 */
const HOST_LOAD_DB_TIMEOUT_MS = 30_000;

let db: PlatformPostgres;
let client: PrismaClient;
let counted: PrismaClient;
let runner: TenantTxRunner<Prisma.TransactionClient>;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  const database = await db.clone(await db.template({ migrated: true }));
  const { PrismaClient: PrismaCtor } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaCtor, {
    connectionString: db.migratorUrl(database),
    poolMax: 3,
    connectionTimeoutMs: HOST_LOAD_DB_TIMEOUT_MS,
    applicationName: 'qc-it',
  });
  counted = withQueryCounter(client, counter);
  runner = createWithTenantTx(
    counted,
    {
      statementTimeoutMs: HOST_LOAD_DB_TIMEOUT_MS,
      lockTimeoutMs: HOST_LOAD_DB_TIMEOUT_MS,
      idleInTransactionTimeoutMs: HOST_LOAD_DB_TIMEOUT_MS,
      poolConnectionTimeoutMs: HOST_LOAD_DB_TIMEOUT_MS,
    },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      env: {},
      scopeClient: (stamp) => withStandardColumns(counted, stamp),
    },
  );
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  await db?.stop();
}, 60_000);

describe('[NT-PERF-006-b] query counter against the real Prisma 7 client', () => {
  it('counts raw and model operations of the root client, in order, with names only', async () => {
    const { result, report } = await counter.measure(async () => {
      await counted.$queryRaw`SELECT 1 AS one`;
      await counted.referenceDatasetVersion.findMany();
      return counted.referenceDatasetVersion.count();
    });
    expect(result).toBe(0);
    expect(report.queries.map((q) => `${q.model ?? ''}.${q.operation}`)).toEqual([
      '.$queryRaw',
      'ReferenceDatasetVersion.findMany',
      'ReferenceDatasetVersion.count',
    ]);
    expect(report.rawCount).toBe(1);
    expect(report.modelCount).toBe(2);
  });

  it('counts inside withTenantTx: the context statement plus the repository query, and fits a budget', async () => {
    const { report } = await counter.measure(() =>
      runner.withTenantTx(context, (tenantDb) => systemDelegates(tenantDb).referenceDatasetVersion.findMany()),
    );
    expect(report.rawCount).toBe(1);
    expect(report.queries.filter((q) => q.model === 'ReferenceDatasetVersion').map((q) => q.operation)).toEqual(['findMany']);
    expect(() => assertQueryBudget(report, 2)).not.toThrow();
    expect(() => assertQueryBudget(report, 1)).toThrow('2 queries, budget 1');
    expect(() => assertQueryBudget(report, 1, { excludeRaw: true })).not.toThrow();
  });

  it('keeps two concurrent scopes apart', async () => {
    const [one, three] = await Promise.all([
      counter.measure(() => counted.referenceDatasetVersion.count()),
      counter.measure(async () => {
        await counted.referenceDatasetVersion.count();
        await counted.referenceDatasetVersion.count();
        await counted.referenceDatasetVersion.count();
      }),
    ]);
    expect(one.report.count).toBe(1);
    expect(three.report.count).toBe(3);
  });

  it('records nothing outside a scope and a failing query is still counted', async () => {
    await expect(counted.referenceDatasetVersion.count()).resolves.toBe(0);
    const { report } = await counter.measure(async () => {
      await counted.$queryRawUnsafe('SELECT * FROM public.no_such_table').catch(() => undefined);
    });
    expect(report.count).toBe(1);
  });
});
