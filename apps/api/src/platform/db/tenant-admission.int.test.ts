/**
 * Per-tenant admission bulkhead against a real PostgreSQL 18 (ADR-0007 am. 10 item 3, D-ARCH-086, data-model §7.7;
 * TASK-025). The runtime is built by `databaseRuntimeFromConfig`, as both entry points get it, with a pool of cap + 2
 * connections, connected as `platform_app` with the bootstrap role settings. Org A saturates its permits with parked
 * transactions that hold connections; org B is still admitted and commits at once; org A's overflow is refused with the
 * retryable 503 after the bounded admission wait; once the parked transactions roll back, no permit and no connection
 * is left behind.
 *
 * Deterministic: deferreds and barriers, never sleeps; the only timed wait is the bounded admission wait itself.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { createRuntimeLog } from '../runtime/log.js';
import type { AppDb, AppTransactionClient } from './index.js';
import { DbError } from './map-db-error.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from './runtime.js';
import { EXPECTED_ROLE_SETTINGS } from './session-integrity.js';
import { EMPTY_ADMISSION_SNAPSHOT } from './tenant-admission.js';
import type { TenantContext } from './with-tenant-tx.js';

/** Same pinned image as prisma/tests/harness/postgres.ts. */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const CAP = 2;
const POOL_MAX = CAP + 2;
const ADMISSION_WAIT_MS = 250;

/** Creates `platform_app` with the bootstrap role settings and returns its connection URL (as health.int.test.ts). */
async function createAppRole(adminUrl: string): Promise<string> {
  const password = randomBytes(24).toString('hex');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    for (const setting of EXPECTED_ROLE_SETTINGS) {
      const [name, value] = setting.split('=') as [string, string];
      await admin.query(`ALTER ROLE platform_app SET ${name} = ${name === 'search_path' ? value : `'${value}'`}`);
    }
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.username = 'platform_app';
  url.password = password;
  return url.toString();
}

const configFor = (url: string): Config =>
  ({
    DATABASE_URL: { reveal: () => url },
    DB_POOL_MAX: POOL_MAX,
    DB_IDLE_TIMEOUT_MS: 60_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
    DB_TX_LOCK_TIMEOUT_MS: 2_000,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
    DB_TENANT_MAX_CONCURRENT_TX: CAP,
    DB_TENANT_ADMISSION_WAIT_MS: ADMISSION_WAIT_MS,
  }) as unknown as Config;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Resolves once `parties` callers have arrived. */
function barrier(parties: number): { arrive(): Promise<void> } {
  const all = deferred();
  let arrived = 0;
  return {
    arrive() {
      arrived += 1;
      if (arrived === parties) all.resolve();
      return all.promise;
    },
  };
}

class ParkedRollback extends Error {
  constructor() {
    super('parked transaction rolls back');
    this.name = 'ParkedRollback';
  }
}

const contextFor = (orgId: string): TenantContext => ({
  orgId,
  actorId: randomUUID(),
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: 'it-admission',
});

describe('[D-ARCH-086] per-tenant admission bulkhead on PostgreSQL 18 as platform_app', () => {
  let container: StartedPostgreSqlContainer;
  let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
  const log = createRuntimeLog('api', { write: () => true });

  /** `POOL_MAX` concurrent transactions for distinct organisations, all holding a connection at the same time. */
  async function fillPoolWithDistinctOrgs(): Promise<number[]> {
    const together = barrier(POOL_MAX);
    return Promise.all(
      Array.from({ length: POOL_MAX }, () =>
        runtime.tenantTx.withTenantTx(contextFor(randomUUID()), async (db) => {
          const rows = await (db as AppDb).$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          await together.arrive();
          return rows[0]?.pid ?? -1;
        }),
      ),
    );
  }

  async function busyAppBackends(): Promise<number> {
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ n: string }>(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE usename = 'platform_app' AND state <> 'idle'",
      );
      return Number(rows[0]?.n ?? '-1');
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    delete process.env['PGOPTIONS'];
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const appUrl = await createAppRole(container.getConnectionUri());
    runtime = databaseRuntimeFromConfig(configFor(appUrl), 'api', log);
    await runtime.startup();
    // Warm-up: every pool connection is open, so org B never pays a connection set-up below.
    expect(new Set(await fillPoolWithDistinctOrgs()).size).toBe(POOL_MAX);
  }, 180_000);

  afterAll(async () => {
    for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
    await (container as StartedPostgreSqlContainer | undefined)?.stop();
  }, 60_000);

  it('[D-ARCH-086] org A saturated: org B commits within 100 ms, A overflow gets the retryable 503 after the wait, no permit or connection leaks', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const parkedIn = barrier(CAP + 1);
    const rollback = deferred();
    const parked = Array.from({ length: CAP }, () =>
      runtime.tenantTx.withTenantTx(contextFor(orgA), async (db) => {
        await (db as AppDb).$queryRaw`SELECT 1`;
        void parkedIn.arrive();
        await rollback.promise;
        throw new ParkedRollback();
      }),
    );
    await parkedIn.arrive();
    expect(runtime.tenantAdmission()).toMatchObject({ inflight: { tenant: CAP }, queued: 0, keys: 1 });

    // Org A's two overflow transactions queue for a permit; their callbacks must never run.
    let overflowRan = 0;
    const overflowStart = performance.now();
    const overflow = [1, 2].map(() =>
      runtime.tenantTx
        .withTenantTx(contextFor(orgA.toUpperCase()), () => {
          overflowRan += 1;
          return Promise.resolve('admitted');
        })
        .then(
          () => undefined,
          (error: unknown) => ({ error, afterMs: performance.now() - overflowStart }),
        ),
    );
    expect(runtime.tenantAdmission()).toMatchObject({ queued: 2 });

    // Org B is admitted at once and commits on a free pool connection.
    const startB = performance.now();
    const committed = await runtime.tenantTx.withTenantTx(contextFor(orgB), async (db) => {
      const rows = await (db as AppDb).$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
      return rows[0]?.one;
    });
    const elapsedB = performance.now() - startB;
    expect(committed).toBe(1);
    expect(elapsedB).toBeLessThan(100);

    for (const outcome of await Promise.all(overflow)) {
      expect(outcome?.error).toBeInstanceOf(DbError);
      expect(outcome?.error).toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        reason: 'TENANT_CONCURRENCY_LIMIT',
        retryable: true,
        retryAfterSeconds: 1,
      });
      // Timers may fire up to 1 ms early after rounding; the wait is bounded by DB_TENANT_ADMISSION_WAIT_MS.
      expect(outcome?.afterMs).toBeGreaterThanOrEqual(ADMISSION_WAIT_MS - 1);
    }
    expect(overflowRan).toBe(0);
    expect(runtime.tenantAdmission()).toMatchObject({ rejectedTotal: { wait: 2, depth: 0 }, inflight: { tenant: CAP }, queued: 0 });

    // The parked transactions roll back: the callback error passes through unchanged and every permit is released.
    rollback.resolve();
    for (const result of await Promise.allSettled(parked)) {
      expect(result).toMatchObject({ status: 'rejected', reason: expect.any(ParkedRollback) });
    }
    expect(runtime.tenantAdmission()).toEqual({ ...EMPTY_ADMISSION_SNAPSHOT, rejectedTotal: { wait: 2, depth: 0 } });

    // No connection leak: no backend is left in a transaction, and POOL_MAX transactions hold a connection each at once.
    expect(await busyAppBackends()).toBe(0);
    expect(new Set(await fillPoolWithDistinctOrgs()).size).toBe(POOL_MAX);
    expect(runtime.tenantAdmission()).toEqual({ ...EMPTY_ADMISSION_SNAPSHOT, rejectedTotal: { wait: 2, depth: 0 } });
  }, 60_000);
});
