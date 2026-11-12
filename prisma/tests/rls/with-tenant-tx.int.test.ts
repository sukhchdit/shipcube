/**
 * `withTenantTx` against PostgreSQL 18 with Prisma 7 over `@prisma/adapter-pg` (US-075; ADR-0005 amendment 10 items 2-4,
 * 6, 12, 15, 16; data-model §4.1; TASK-016). The permanent port of SPK-03's exit items (a) and (b) and of the (d)
 * server-side cost check, run through the production runner instead of the spike prototype.
 *
 * The probe tables are created in the test as `platform_migrator` (spike F-13 pattern: DDL, seed before FORCE, policies
 * from the data-model §4.3 TENANT template over the §4.2 helpers shipped by migration 20261112020000). Runtime clients
 * connect as `platform_app` (NOBYPASSRLS) through the production client factory.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { expectAffected } from '../../../apps/api/src/platform/db/expect-affected.js';
import { DbError, type DbSecurityEvent } from '../../../apps/api/src/platform/db/map-db-error.js';
import type { TenantDb } from '../../../apps/api/src/platform/db/tenant-db.js';
import {
  CONTEXT_STATEMENT_SQL,
  contextValues,
  createWithTenantTx,
  type SecurityEventDetail,
  type TenantContext,
  type WithTenantTxOptions,
} from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

type Db = TenantDb<Prisma.TransactionClient>;
type Raw = Pick<Prisma.TransactionClient, '$queryRaw'>;

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();

const BASE_OPTIONS: WithTenantTxOptions = {
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 2_000,
  idleInTransactionTimeoutMs: 15_000,
  poolConnectionTimeoutMs: 5_000,
};

const tenant = (orgId: string, actorId = USER_A): TenantContext => ({
  orgId,
  actorId,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: `rls-${orgId.slice(0, 8)}`,
});
const NO_CONTEXT: TenantContext = { orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: 'rls-none' };

let db: PlatformPostgres;
let database: string;
let PrismaCtor: typeof PrismaClient;
let pooled: PrismaClient;
let single: PrismaClient;

const SETUP_SQL = `
CREATE TABLE public.rls_probe_shipments (id uuid PRIMARY KEY, org_id uuid NOT NULL, ref text NOT NULL);
CREATE TABLE public.rls_probe_ledger (id uuid PRIMARY KEY, org_id uuid NOT NULL);
-- seed before FORCE: the owner (migrator) has no policy afterwards
INSERT INTO public.rls_probe_shipments (id, org_id, ref) VALUES
  (gen_random_uuid(), '${ORG_A}', 'A1'), (gen_random_uuid(), '${ORG_A}', 'A2'), (gen_random_uuid(), '${ORG_A}', 'A3'),
  (gen_random_uuid(), '${ORG_B}', 'B1'), (gen_random_uuid(), '${ORG_B}', 'B2');
INSERT INTO public.rls_probe_ledger (id, org_id) VALUES (gen_random_uuid(), '${ORG_A}');
ALTER TABLE public.rls_probe_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rls_probe_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY p_rls_probe_shipments__tenant ON public.rls_probe_shipments FOR ALL TO platform_app
  USING (org_id = platform.app_org_id()) WITH CHECK (org_id = platform.app_org_id());
ALTER TABLE public.rls_probe_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rls_probe_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY p_rls_probe_ledger__tenant ON public.rls_probe_ledger FOR ALL TO platform_app
  USING (org_id = platform.app_org_id()) WITH CHECK (org_id = platform.app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rls_probe_shipments TO platform_app;
-- append-only shape: no UPDATE/DELETE grant, so a DELETE is a privilege 42501, not an RLS one
GRANT SELECT, INSERT ON public.rls_probe_ledger TO platform_app;
`;

interface Recorder {
  readonly events: Array<[DbSecurityEvent, SecurityEventDetail]>;
  readonly notReady: string[];
  leaks: number;
}

function runner(client: PrismaClient, overrides: Partial<WithTenantTxOptions> = {}) {
  const recorder: Recorder = { events: [], notReady: [], leaks: 0 };
  const built = createWithTenantTx(
    client,
    { ...BASE_OPTIONS, ...overrides },
    {
      onSecurityEvent: (event, detail) => {
        recorder.events.push([event, detail]);
      },
      countSessionContextLeak: () => {
        recorder.leaks += 1;
      },
      markNotReady: (reason) => {
        recorder.notReady.push(reason);
      },
    },
  );
  return { ...built, recorder };
}

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected exactly one row, got ${String(rows.length)}`);
  return row;
}

interface Probe {
  pid: number;
  org: string | null;
  actor: string | null;
  rows: string[];
}

async function probe(tx: Raw): Promise<Probe> {
  const session = one(
    await tx.$queryRaw<Array<{ pid: number; org: string | null; actor: string | null }>>`
      SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org, current_setting('app.actor_id', true) AS actor`,
  );
  const rows = await tx.$queryRaw<Array<{ org_id: string }>>`SELECT org_id::text AS org_id FROM public.rls_probe_shipments ORDER BY ref`;
  return { ...session, rows: rows.map((row) => row.org_id) };
}

interface Timeouts {
  pid: number;
  statement: string;
  lock: string;
  idle: string;
  correlation: string | null;
}

async function timeouts(tx: Raw): Promise<Timeouts> {
  return one(
    await tx.$queryRaw<Timeouts[]>`SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement,
                                          current_setting('lock_timeout') AS lock,
                                          current_setting('idle_in_transaction_session_timeout') AS idle,
                                          current_setting('app.correlation_id', true) AS correlation`,
  );
}

const insertShipment = (tx: Db | PrismaClient, orgId: string): Promise<number> =>
  tx.$executeRaw`INSERT INTO public.rls_probe_shipments (id, org_id, ref) VALUES (${randomUUID()}::uuid, ${orgId}::uuid, 'x')`;

const countShipments = async (tx: Raw): Promise<number> =>
  one(await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.rls_probe_shipments`).n;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((x, y) => x - y);
  const value = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  if (value === undefined) throw new Error('no samples');
  return Math.round(value * 1000) / 1000;
}

const appClient = (poolMax: number, applicationName: string, connectionTimeoutMs?: number): PrismaClient =>
  createDatabaseClient(PrismaCtor, {
    connectionString: db.appUrl(database),
    poolMax,
    applicationName,
    ...(connectionTimeoutMs === undefined ? {} : { connectionTimeoutMs }),
  });

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
  const migrator = new pg.Client(db.migratorConnection(database));
  await migrator.connect();
  try {
    await migrator.query(SETUP_SQL);
  } finally {
    await migrator.end();
  }
  ({ PrismaClient: PrismaCtor } = await withFileLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js')));
  pooled = appClient(2, 'rls-pooled');
  single = appClient(1, 'rls-single');
}, 300_000);

afterAll(async () => {
  await pooled?.$disconnect();
  await single?.$disconnect();
  await db?.stop();
});

describe('US-075 per-transaction tenant context', () => {
  it('ADR-0005 am.10 item 4: the fresh-connection probe passes: no app.* setting carries a value on a new backend', async () => {
    const fresh = appClient(1, 'rls-fresh');
    try {
      await expect(runner(fresh).probeFreshConnection()).resolves.toBeUndefined();
    } finally {
      await fresh.$disconnect();
    }
  });

  it("AT-US-075-01: on a pool of one, org A then org B each see only their own rows; app.org_id/app.actor_id are '' after commit and rollback", async () => {
    const { withTenantTx } = runner(single);
    const a = await withTenantTx(tenant(ORG_A), probe);
    const afterA = await single.$transaction(probe);
    const b = await withTenantTx(tenant(ORG_B, USER_B), probe);
    const afterB = await single.$transaction(probe);
    const rolledBack = await rejection(
      withTenantTx(tenant(ORG_B, USER_B), async (tx) => {
        expect((await probe(tx)).rows).toEqual([ORG_B, ORG_B]);
        throw new Error('rls rollback');
      }),
    );
    const afterRollback = await single.$transaction(probe);

    expect(a).toEqual({ pid: a.pid, org: ORG_A, actor: USER_A, rows: [ORG_A, ORG_A, ORG_A] });
    expect(b).toEqual({ pid: a.pid, org: ORG_B, actor: USER_B, rows: [ORG_B, ORG_B] });
    expect(rolledBack).toEqual(new Error('rls rollback'));
    for (const after of [afterA, afterB, afterRollback]) expect(after).toEqual({ pid: a.pid, org: '', actor: '', rows: [] });
  });

  it("AT-US-075-02: a raw connection that sets nothing sees 0 rows and every INSERT fails (42501); '' and 'not-a-uuid' behave identically", async () => {
    const raw = new pg.Client(db.appConnection(database));
    await raw.connect();
    const observe = async (): Promise<{ rows: number; insert: unknown }> => {
      const rows = (await raw.query<{ n: number }>('SELECT count(*)::int AS n FROM public.rls_probe_shipments')).rows[0]?.n ?? -1;
      await raw.query('SAVEPOINT probe');
      const insert = await rejection(
        raw.query('INSERT INTO public.rls_probe_shipments (id, org_id, ref) VALUES ($1, $2, $3)', [randomUUID(), ORG_A, 'x']),
      );
      await raw.query('ROLLBACK TO SAVEPOINT probe');
      return { rows, insert: (insert as { code?: unknown }).code };
    };
    try {
      const outcomes: Array<{ rows: number; insert: unknown }> = [];
      for (const value of [undefined, '', 'not-a-uuid']) {
        await raw.query('BEGIN');
        if (value !== undefined) await raw.query("SELECT set_config('app.org_id', $1, true)", [value]);
        outcomes.push(await observe());
        await raw.query('ROLLBACK');
      }
      expect(outcomes).toEqual([
        { rows: 0, insert: '42501' },
        { rows: 0, insert: '42501' },
        { rows: 0, insert: '42501' },
      ]);
    } finally {
      await raw.end();
    }
    // through the runner: '' is a valid guest/public context (0 rows), 'not-a-uuid' never reaches the database
    const { withTenantTx } = runner(pooled);
    expect(await withTenantTx(NO_CONTEXT, countShipments)).toBe(0);
    expect(await rejection(withTenantTx({ ...NO_CONTEXT, orgId: 'not-a-uuid' }, countShipments))).toMatchObject({
      reason: 'INVALID_TENANT_CONTEXT',
    });
  });

  it('ADR-0005 am.10 item 15 (F-02): outside the context INSERT: 42501; UPDATE/DELETE: 0 rows silently', async () => {
    // the root client is what a callback would reach by mistake: no context, no error for UPDATE/DELETE
    const insert = await rejection(insertShipment(pooled, ORG_A));
    expect(insert).toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42501' } } } });
    const updated = await pooled.$executeRaw`UPDATE public.rls_probe_shipments SET ref = ref || '!' WHERE org_id = ${ORG_A}::uuid`;
    const deleted = await pooled.$executeRaw`DELETE FROM public.rls_probe_shipments WHERE org_id = ${ORG_A}::uuid`;
    expect({ updated, deleted }).toEqual({ updated: 0, deleted: 0 });
    // the repository convention turns the silent 0 into an error
    expect(() => expectAffected(updated)).toThrow('Database error: NOT_FOUND');
    expect(await runner(pooled).withTenantTx(tenant(ORG_A), countShipments)).toBe(3);
  });

  it('AT-US-075-04: a nested withTenantTx throws NESTED_TENANT_TX before reaching the database (pool of one: no maxWait stall)', async () => {
    const { withTenantTx } = runner(single);
    const outcome = await withTenantTx(tenant(ORG_A), async (tx) => {
      const started = performance.now();
      const nested = await rejection(withTenantTx(tenant(ORG_B, USER_B), probe));
      const elapsedMs = performance.now() - started;
      return { nested, elapsedMs, after: await probe(tx) };
    });
    expect(outcome.nested).toBeInstanceOf(DbError);
    expect(outcome.nested).toMatchObject({ status: 500, reason: 'NESTED_TENANT_TX' });
    // a checkout attempt on the busy single connection would have waited maxWait (2 s) and failed with P2028
    expect(outcome.elapsedMs).toBeLessThan(500);
    expect(outcome.after.rows).toEqual([ORG_A, ORG_A, ORG_A]);
  });

  it('ADR-0005 am.10 item 1: the callback gets the TenantDb guard: $transaction and the *Unsafe methods throw on the real client', async () => {
    const { withTenantTx } = runner(pooled);
    const blocked = await withTenantTx(tenant(ORG_A), (tx) => {
      const record = tx as unknown as Record<string, unknown>;
      const thrown = ['$transaction', '$queryRawUnsafe', '$executeRawUnsafe', '$extends'].map((member) => {
        try {
          return record[member] === undefined ? 'undefined' : 'exposed';
        } catch (error) {
          return (error as Error).name;
        }
      });
      return Promise.resolve(thrown);
    });
    expect(blocked).toEqual(['TenantDbAccessError', 'TenantDbAccessError', 'TenantDbAccessError', 'TenantDbAccessError']);
  });

  it('SPK-03 (a) port: 50 parallel transactions over a pool of two never leak context', async () => {
    const wide = appClient(2, 'rls-parallel', 20_000);
    try {
      const { withTenantTx } = runner(wide, { maxWaitMs: 20_000, poolConnectionTimeoutMs: 20_000, timeoutMs: 20_000 });
      const contexts = [tenant(ORG_A), tenant(ORG_B, USER_B), NO_CONTEXT];
      const runs = await Promise.all(
        Array.from({ length: 50 }, (_, i) => {
          const ctx = contexts[i % 3] ?? NO_CONTEXT;
          return withTenantTx(ctx, async (tx) => {
            const first = await probe(tx);
            await tx.$executeRaw`SELECT pg_sleep(0.002)`;
            return { ctx, first, second: await probe(tx) };
          });
        }),
      );
      const expected = (orgId: string): string[] => (orgId === ORG_A ? [ORG_A, ORG_A, ORG_A] : orgId === ORG_B ? [ORG_B, ORG_B] : []);
      for (const run of runs) {
        expect(run.first.rows).toEqual(expected(run.ctx.orgId));
        expect(run.second).toEqual(run.first);
        expect(run.first.org).toBe(run.ctx.orgId);
        expect(run.first.actor).toBe(run.ctx.actorId);
      }
      expect(new Set(runs.map((run) => run.first.pid)).size).toBeLessThanOrEqual(2);
    } finally {
      await wide.$disconnect();
    }
  }, 60_000);
});

describe('ADR-0005 am.10 items 3 and 6: error mapping on real PostgreSQL errors', () => {
  it('ADR-0005 am.10 item 6: a foreign org_id INSERT (RLS WITH CHECK 42501) maps to 403 AUTHZ_DENIED and emits rls_write_rejected', async () => {
    const { withTenantTx, recorder } = runner(pooled);
    const error = await rejection(withTenantTx(tenant(ORG_B, USER_B), (tx) => insertShipment(tx, ORG_A)));
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).toJSON()).toEqual({
      status: 403,
      code: 'AUTHZ_DENIED',
      reason: 'RLS_WRITE_REJECTED',
      retryable: false,
      securityEvent: 'rls_write_rejected',
      sqlState: '42501',
      prismaCode: 'P2010',
    });
    expect(JSON.stringify(error)).not.toContain('rls_probe_shipments');
    expect(recorder.events).toEqual([['rls_write_rejected', { correlationId: tenant(ORG_B).correlationId, sqlState: '42501' }]]);
  });

  it('ADR-0005 am.10 item 6: a privilege 42501 (DELETE without grant) maps to 500 with db_privilege_denied', async () => {
    const { withTenantTx, recorder } = runner(pooled);
    const error = await rejection(withTenantTx(tenant(ORG_A), (tx) => tx.$executeRaw`DELETE FROM public.rls_probe_ledger`));
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', reason: 'DB_PRIVILEGE_DENIED', sqlState: '42501' });
    expect(JSON.stringify(error)).not.toContain('rls_probe_ledger');
    expect(recorder.events.map(([event]) => event)).toEqual(['db_privilege_denied']);
  });

  it('ADR-0005 am.10 item 6: a lock wait beyond the transaction lock_timeout (55P03) maps to a retryable 503 with Retry-After', async () => {
    const holder = runner(pooled, { timeoutMs: 10_000 });
    const loser = runner(pooled, { lockTimeoutMs: 300, timeoutMs: 10_000 });
    const locked = deferred();
    const loserDone = deferred();
    const [held, lost] = await Promise.all([
      holder.withTenantTx(tenant(ORG_A), async (tx) => {
        const rows = await tx.$queryRaw<Array<{ ref: string }>>`SELECT ref FROM public.rls_probe_shipments WHERE ref = 'A1' FOR UPDATE`;
        locked.resolve();
        await loserDone.promise;
        return rows.length;
      }),
      (async () => {
        await locked.promise;
        try {
          return await rejection(
            loser.withTenantTx(tenant(ORG_A), (tx) => tx.$executeRaw`UPDATE public.rls_probe_shipments SET ref = ref WHERE ref = 'A1'`),
          );
        } finally {
          loserDone.resolve();
        }
      })(),
    ]);
    expect(held).toBe(1);
    expect((lost as DbError).toJSON()).toEqual({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      reason: 'LOCK_TIMEOUT',
      retryable: true,
      retryAfterSeconds: 1,
      sqlState: '55P03',
      prismaCode: 'P2010',
    });
  }, 30_000);

  it('ADR-0005 am.10 item 3: P2028 (pool of one held, maxWait exceeded) maps to a retryable 503, never 500', async () => {
    const holder = runner(single, { timeoutMs: 10_000 });
    const contender = runner(single, { maxWaitMs: 300 });
    const started = deferred();
    const release = deferred();
    const held = holder.withTenantTx(tenant(ORG_A), async (tx) => {
      started.resolve();
      await release.promise;
      return countShipments(tx);
    });
    await started.promise;
    try {
      const error = await rejection(contender.withTenantTx(tenant(ORG_B, USER_B), countShipments));
      expect((error as DbError).toJSON()).toEqual({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        reason: 'TRANSACTION_UNAVAILABLE',
        retryable: true,
        retryAfterSeconds: 1,
        prismaCode: 'P2028',
      });
    } finally {
      release.resolve();
    }
    expect(await held).toBe(3);
  }, 30_000);
});

describe('ADR-0005 am.10 item 12: per-transaction timeouts', () => {
  it('ADR-0005 am.10 item 12: statement, lock and idle timeouts come from the options per transaction and revert after commit and rollback', async () => {
    const baseline = await timeouts(single);
    const { withTenantTx } = runner(single, {
      statementTimeoutMs: 250,
      lockTimeoutMs: 300,
      idleInTransactionTimeoutMs: 1_500,
      timeoutMs: 10_000,
    });
    const inside = await withTenantTx({ ...tenant(ORG_A), correlationId: 'rls-timeouts' }, timeouts);
    expect(inside).toEqual({ pid: baseline.pid, statement: '250ms', lock: '300ms', idle: '1500ms', correlation: 'rls-timeouts' });
    expect(await timeouts(single)).toEqual({ ...baseline, correlation: '' });

    // honoured: a longer statement is cancelled (57014) and maps to a retryable 503
    const cancelled = await rejection(withTenantTx(tenant(ORG_A), (tx) => tx.$executeRaw`SELECT pg_sleep(1)`));
    expect(cancelled).toMatchObject({ status: 503, reason: 'STATEMENT_TIMEOUT', sqlState: '57014', retryable: true });
    expect(await timeouts(single)).toEqual({ ...baseline, correlation: '' });
  }, 30_000);

  it('ADR-0005 am.10 item 12: after platform_app RESETs its own role lock_timeout, withTenantTx still runs with lock_timeout 2s', async () => {
    const roleSettings = async (admin: pg.Client): Promise<string[]> =>
      (
        await admin.query<{ setting: string }>(
          `SELECT unnest(setconfig) AS setting FROM pg_catalog.pg_db_role_setting
            WHERE setrole = 'platform_app'::regrole AND setdatabase = 0 ORDER BY 1`,
        )
      ).rows.map((row) => row.setting);
    const admin = await db.superuser(database);
    const before = await roleSettings(admin);
    expect(before).toContain('lock_timeout=2s');
    const app = new pg.Client(db.appConnection(database));
    await app.connect();
    let drifted: PrismaClient | undefined;
    try {
      await app.query('ALTER ROLE platform_app RESET lock_timeout'); // the drift: any role may rewrite its own USERSET defaults
      expect(await roleSettings(admin)).not.toContain('lock_timeout=2s');
      drifted = appClient(1, 'rls-drifted'); // role settings apply at session start: new backends only
      expect(one(await drifted.$queryRaw<Array<{ lock: string }>>`SELECT current_setting('lock_timeout') AS lock`).lock).toBe('0');
      const inside = await runner(drifted).withTenantTx(tenant(ORG_A), timeouts);
      expect(inside.lock).toBe('2s');
      expect(inside.statement).toBe('5s');
      expect(inside.idle).toBe('15s');
    } finally {
      await drifted?.$disconnect();
      await app.end();
      await admin.query("ALTER ROLE platform_app SET lock_timeout = '2s'");
      try {
        expect(await roleSettings(admin)).toEqual(before);
      } finally {
        await admin.end();
      }
    }
  });
});

describe('W-1: context statement cost', () => {
  it('ADR-0005 am.10 W-1: the eight-setting context statement costs <= 1 ms p95 server-side (EXPLAIN ANALYZE); client-observed figure logged only', async () => {
    const pool = new pg.Pool({ ...db.appConnection(database), max: 1 });
    const values = [...contextValues(tenant(ORG_A), BASE_OPTIONS)];
    const server: number[] = [];
    try {
      for (let i = 0; i < 220; i += 1) {
        // autocommit: the implicit transaction ends with the statement, so the is_local settings do not persist
        const plan = await pool.query<{ 'QUERY PLAN': Array<{ 'Planning Time': number; 'Execution Time': number }> }>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${CONTEXT_STATEMENT_SQL}`,
          values,
        );
        const node = plan.rows[0]?.['QUERY PLAN'][0];
        if (node === undefined) throw new Error('EXPLAIN returned no plan');
        if (i >= 20) server.push(node['Planning Time'] + node['Execution Time']);
      }
    } finally {
      await pool.end();
    }

    // client-observed (recorded, never asserted: one extra round trip plus host jitter, condition C-1)
    const { withTenantTx } = runner(pooled);
    const withContext: number[] = [];
    const without: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      let start = performance.now();
      await withTenantTx(tenant(ORG_A), countShipments);
      withContext.push(performance.now() - start);
      start = performance.now();
      await pooled.$transaction(countShipments);
      without.push(performance.now() - start);
    }
    process.stdout.write(
      `${JSON.stringify({
        w1ServerSideP95Ms: percentile(server, 95),
        w1ClientP95WithContextMs: percentile(withContext, 95),
        w1ClientP95WithoutContextMs: percentile(without, 95),
      })}\n`,
    );
    expect(percentile(server, 95)).toBeLessThanOrEqual(1);
  }, 120_000);
});
