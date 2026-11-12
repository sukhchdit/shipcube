/**
 * Session-scope negative control and the in-statement leak detector (ADR-0005 amendment 10 items 4 and 16,
 * PR7-SEC-02/-14; SPK-03 (a) negative control ported; TASK-016).
 *
 * This is the ONLY file allowed to issue a session-level `set_config(…, false)` (exact-file lint exemption): it proves
 * that such a value issued by `platform_app` leaks to the next checkout on the same pooled backend (`@prisma/adapter-pg`
 * releases connections without a reset), that a transaction-local set masks it only for its own transaction, and that
 * `withTenantTx`'s detector refuses to run on that backend. Pool of one, backend pid asserted at every step, RESET in
 * `finally`.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { DbError, type DbSecurityEvent } from '../../../apps/api/src/platform/db/map-db-error.js';
import { createWithTenantTx, type SecurityEventDetail, type TenantContext } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

type Raw = Pick<Prisma.TransactionClient, '$queryRaw'>;

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const USER = randomUUID();

const tenant = (orgId: string): TenantContext => ({
  orgId,
  actorId: USER,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: 'rls-leak',
});

const SETUP_SQL = `
CREATE TABLE public.rls_leak_shipments (id uuid PRIMARY KEY, org_id uuid NOT NULL, ref text NOT NULL);
INSERT INTO public.rls_leak_shipments (id, org_id, ref) VALUES
  (gen_random_uuid(), '${ORG_A}', 'A1'), (gen_random_uuid(), '${ORG_A}', 'A2'), (gen_random_uuid(), '${ORG_B}', 'B1');
ALTER TABLE public.rls_leak_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rls_leak_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY p_rls_leak_shipments__tenant ON public.rls_leak_shipments FOR ALL TO platform_app
  USING (org_id = platform.app_org_id()) WITH CHECK (org_id = platform.app_org_id());
GRANT SELECT ON public.rls_leak_shipments TO platform_app;
`;

let db: PlatformPostgres;
let database: string;
let single: PrismaClient;

interface Probe {
  pid: number;
  org: string | null;
  rows: string[];
}

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected exactly one row, got ${String(rows.length)}`);
  return row;
}

async function probe(tx: Raw): Promise<Probe> {
  const session = one(
    await tx.$queryRaw<
      Array<{ pid: number; org: string | null }>
    >`SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org`,
  );
  const rows = await tx.$queryRaw<Array<{ org_id: string }>>`SELECT org_id::text AS org_id FROM public.rls_leak_shipments ORDER BY ref`;
  return { ...session, rows: rows.map((row) => row.org_id) };
}

function runner() {
  const events: Array<[DbSecurityEvent, SecurityEventDetail]> = [];
  const notReady: string[] = [];
  const counter = { leaks: 0 };
  const built = createWithTenantTx(
    single,
    { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    {
      onSecurityEvent: (event, detail) => {
        events.push([event, detail]);
      },
      countSessionContextLeak: () => {
        counter.leaks += 1;
      },
      markNotReady: (reason) => {
        notReady.push(reason);
      },
    },
  );
  return { ...built, events, notReady, counter };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

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
  const { PrismaClient } = await withFileLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  single = createDatabaseClient(PrismaClient, { connectionString: db.appUrl(database), poolMax: 1, applicationName: 'rls-leak' });
}, 300_000);

afterAll(async () => {
  await single?.$disconnect();
  await db?.stop();
});

describe('ADR-0005 am.10 items 4 and 16: session-scope leak (negative control) and detector', () => {
  it("ADR-0005 am.10 item 16: a clean backend passes the detector with NULL (fresh) and '' (after a transaction) prior values", async () => {
    const run = runner();
    // fresh backend: the first statement ever on this connection sees NULL prior values
    await run.probeFreshConnection();
    const fresh = one(
      await single.$queryRaw<Array<{ pid: number; org: string | null }>>`
      SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org`,
    );
    expect(fresh.org).toBeNull();
    const first = await run.withTenantTx(tenant(ORG_A), probe);
    expect(first).toEqual({ pid: fresh.pid, org: ORG_A, rows: [ORG_A, ORG_A] });
    // reused backend: F-07 reset value ''
    const between = await single.$transaction(probe);
    expect(between).toEqual({ pid: fresh.pid, org: '', rows: [] });
    expect(await run.withTenantTx(tenant(ORG_B), probe)).toEqual({ pid: fresh.pid, org: ORG_B, rows: [ORG_B] });
    expect({ events: run.events, notReady: run.notReady, leaks: run.counter.leaks }).toEqual({ events: [], notReady: [], leaks: 0 });
  });

  it('ADR-0005 am.10 item 4: a session-level set_config(…, false) by platform_app LEAKS to the next checkout; a transaction-local set masks it only for its own transaction; withTenantTx refuses the backend', async () => {
    const run = runner();
    const clean = await single.$transaction(probe);
    expect(clean.org === '' || clean.org === null).toBe(true);

    const leaked = await single.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, false)`; // the hazard (F-04): is_local = false
      return probe(tx);
    });
    expect(leaked.pid).toBe(clean.pid);
    try {
      // the leak: no context-setting transaction at all, yet the reused backend still carries org A
      const nextTx = await single.$transaction(probe);
      const nextAutocommit = await probe(single);
      for (const seen of [nextTx, nextAutocommit]) expect(seen).toEqual({ pid: clean.pid, org: ORG_A, rows: [ORG_A, ORG_A] });

      // a plain transaction-local set masks the leaked value for its own transaction only
      const masked = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_B}, true)`;
        return probe(tx);
      });
      expect(masked).toEqual({ pid: clean.pid, org: ORG_B, rows: [ORG_B] });
      expect(await single.$transaction(probe)).toEqual({ pid: clean.pid, org: ORG_A, rows: [ORG_A, ORG_A] });

      // the detector: DB_SESSION_CONTEXT_LEAK before fn, security event, counter, not-ready
      let fnRan = false;
      const error = await rejection(
        run.withTenantTx(tenant(ORG_B), (tx) => {
          fnRan = true;
          return probe(tx);
        }),
      );
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).toJSON()).toEqual({
        status: 500,
        code: 'INTERNAL_ERROR',
        reason: 'DB_SESSION_CONTEXT_LEAK',
        retryable: false,
        securityEvent: 'db_session_context_leak',
      });
      expect(JSON.stringify(error)).not.toContain(ORG_A);
      expect(fnRan).toBe(false);
      expect(run.events).toEqual([['db_session_context_leak', { correlationId: 'rls-leak' }]]);
      expect(run.counter.leaks).toBe(1);
      expect(run.notReady).toEqual(['db_session_context_leak']);
      // the refused transaction rolled back: the backend is unchanged (still leaked, same pid)
      expect(await single.$transaction(probe)).toEqual({ pid: clean.pid, org: ORG_A, rows: [ORG_A, ORG_A] });

      // the start-up probe sees it too (any app.* value on the connection)
      expect(await rejection(run.probeFreshConnection())).toMatchObject({ reason: 'DB_SESSION_CONTEXT_LEAK' });
      expect(run.counter.leaks).toBe(2);
    } finally {
      await single.$executeRaw`RESET app.org_id`; // clean the leaked session value so later tests start clean
    }
    const reset = await single.$transaction(probe);
    expect(reset.pid).toBe(clean.pid);
    expect(reset.rows).toEqual([]);
    expect(reset.org === '' || reset.org === null).toBe(true);
    expect((await runner().withTenantTx(tenant(ORG_B), probe)).rows).toEqual([ORG_B]);
  });
});
