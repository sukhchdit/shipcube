/**
 * SPK-03 (TASK-008; risk R-ARCH-03; NFR-TENANT-001; ADR-0005; data-model.md §4.1-§4.3): row-level security with
 * Prisma 7 interactive transactions over `@prisma/adapter-pg` and a pooled `pg` connection set.
 *
 * Throwaway spike code. Nothing here is a versioned migration: the spike tables, the helper functions and the policies
 * are created inside the test, as `platform_migrator`, with `spk03_` names on a clone of the bootstrapped template
 * database. The runtime connections use `platform_app` (NOBYPASSRLS) through the production client factory.
 * The record of results is docs/04-plan/spikes/SPK-03.md. Set `SPK03_REPORT=<file>` to write the measured values.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PlatformPostgres } from '../harness/postgres.js';

type Tx = Prisma.TransactionClient;
type RawTx = Pick<Tx, '$queryRaw' | '$executeRaw'>;

interface TenantContext {
  readonly orgId: string;
  readonly actorId: string;
  readonly actorScope: 'TENANT' | 'OPERATOR';
  readonly guestTokenHash: string;
  /** data-model §4.1 setting 5; defaults to {@link DEFAULT_CORRELATION_ID}. */
  readonly correlationId?: string;
  /** data-model §4.1 setting 6 (transaction-local `statement_timeout`, ms); defaults to {@link DEFAULT_STATEMENT_TIMEOUT_MS}. */
  readonly statementTimeoutMs?: number;
}

interface TxOptions {
  maxWait?: number;
  timeout?: number;
}

interface Probe {
  pid: number;
  org: string | null;
  rows: string[];
}

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();
const OPERATOR_USER = randomUUID();
const NOT_OPERATOR_USER = randomUUID();

const DEFAULT_CORRELATION_ID = 'spk03';
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;

const NO_CONTEXT: TenantContext = { orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '' };
const tenant = (orgId: string, actorId = USER_A, guestTokenHash = ''): TenantContext => ({
  orgId,
  actorId,
  actorScope: 'TENANT',
  guestTokenHash,
});
const guest = (guestTokenHash: string): TenantContext => ({ ...NO_CONTEXT, guestTokenHash });
const tokenHash = (): string => createHash('sha256').update(randomBytes(32)).digest('hex');

const report: Record<string, unknown> = {};

let db: PlatformPostgres;
let database: string;
let client: PrismaClient;
let single: PrismaClient;

/** Bind values of the data-model §4.1 context statement, in `$1..$6` order (all strings; `is_local` stays a literal). */
function contextValues(ctx: TenantContext): [string, string, string, string, string, string] {
  return [
    ctx.orgId,
    ctx.actorId,
    ctx.actorScope,
    ctx.guestTokenHash,
    ctx.correlationId ?? DEFAULT_CORRELATION_ID,
    String(ctx.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS),
  ];
}

/** The same statement for raw `pg` (benchmark variants). */
const CONTEXT_SQL = `SELECT set_config('app.org_id', $1, true), set_config('app.actor_id', $2, true),
                            set_config('app.actor_scope', $3, true), set_config('app.guest_token_hash', $4, true),
                            set_config('app.correlation_id', $5, true), set_config('statement_timeout', $6, true)`;

/** The data-model §4.1 context statement: one parameterised round trip, six transaction-local settings. */
async function setContext(tx: RawTx, ctx: TenantContext): Promise<void> {
  const [orgId, actorId, actorScope, guestTokenHash, correlationId, statementTimeout] = contextValues(ctx);
  await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true) AS org_id,
                              set_config('app.actor_id', ${actorId}, true) AS actor_id,
                              set_config('app.actor_scope', ${actorScope}, true) AS actor_scope,
                              set_config('app.guest_token_hash', ${guestTokenHash}, true) AS guest_token_hash,
                              set_config('app.correlation_id', ${correlationId}, true) AS correlation_id,
                              set_config('statement_timeout', ${statementTimeout}, true) AS statement_timeout`;
}

/** Prototype of TASK-016's `withTenantTx`: a Prisma 7 interactive transaction whose first statement sets the context. */
async function withTenantTx<T>(prisma: PrismaClient, ctx: TenantContext, fn: (tx: Tx) => Promise<T>, options?: TxOptions): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  }, options);
}

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected exactly one row, got ${String(rows.length)}`);
  return row;
}

async function probe(tx: Pick<Tx, '$queryRaw'>): Promise<Probe> {
  const session = one(
    await tx.$queryRaw<
      Array<{ pid: number; org: string | null }>
    >`SELECT pg_backend_pid() AS pid, current_setting('app.org_id', true) AS org`,
  );
  const rows = await tx.$queryRaw<Array<{ org_id: string }>>`SELECT org_id::text AS org_id FROM public.spk03_shipments ORDER BY ref`;
  return { pid: session.pid, org: session.org, rows: rows.map((row) => row.org_id) };
}

async function count(tx: Pick<Tx, '$queryRaw'>, table: 'shipments' | 'quotes'): Promise<number> {
  const rows =
    table === 'shipments'
      ? await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.spk03_shipments`
      : await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.spk03_quotes`;
  return one(rows).n;
}

const insertShipment = (tx: RawTx, orgId: string, ref: string): Promise<number> =>
  tx.$executeRaw`INSERT INTO public.spk03_shipments (id, org_id, ref) VALUES (${randomUUID()}::uuid, ${orgId}::uuid, ${ref})`;

const claim = (tx: RawTx, quoteId: string): Promise<number> =>
  tx.$executeRaw`UPDATE public.spk03_quotes
                    SET org_id = platform.spk03_app_org_id(), claimed_by_user_id = platform.spk03_app_actor_id(),
                        claimed_at = now(), guest_token_hash = NULL
                  WHERE id = ${quoteId}::uuid AND org_id IS NULL`;

async function createGuestQuote(hash: string): Promise<string> {
  const id = randomUUID();
  const inserted = await withTenantTx(
    client,
    guest(hash),
    (tx) =>
      tx.$executeRaw`INSERT INTO public.spk03_quotes (id, org_id, guest_token_hash, ref) VALUES (${id}::uuid, NULL, decode(${hash}, 'hex'), 'guest')`,
  );
  expect(inserted).toBe(1);
  return id;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

/** SQLSTATE of a Prisma/driver-adapter error (Prisma wraps raw-query failures as P2010 and keeps the code in `meta`). */
function sqlState(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | undefined => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return undefined;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ['meta', 'cause', 'driverAdapterError']) {
      const nested = visit(record[key]);
      if (nested !== undefined) return nested;
    }
    for (const key of ['code', 'originalCode']) {
      const code = record[key];
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P[1-6]\d{3}$/.test(code)) return code;
    }
    return undefined;
  };
  const message = error instanceof Error ? error.message : '';
  return visit(error) ?? /\b(42501|42601|40001|55P03|57014|25P02)\b/.exec(message)?.[1];
}

function describeError(error: unknown): Record<string, unknown> {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  return {
    name: error instanceof Error ? error.name : typeof error,
    code: record['code'],
    meta: record['meta'],
    sqlState: sqlState(error),
    message: (error instanceof Error ? error.message : String(error)).split('\n').slice(-3).join(' | '),
  };
}

/**
 * Pinned shape of a PostgreSQL error raised by a raw query (F-06 / m1): `P2010`, and the adapter's default (`postgres`)
 * kind keeps the SQLSTATE in both `code` and `originalCode`. Mapped kinds (40001, 23505, …) carry `originalCode` only
 * (PR7-SEC-03), so TASK-016's mapper keys on `originalCode`.
 */
const rawPgError = (sqlstate: string): Record<string, unknown> => ({
  code: 'P2010',
  meta: { driverAdapterError: { cause: { kind: 'postgres', code: sqlstate, originalCode: sqlstate } } },
});

interface SessionSettings {
  pid: number;
  timeout: string;
  correlation: string | null;
}

async function sessionSettings(tx: Pick<Tx, '$queryRaw'>): Promise<SessionSettings> {
  return one(
    await tx.$queryRaw<SessionSettings[]>`SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS timeout,
                                                  current_setting('app.correlation_id', true) AS correlation`,
  );
}

/**
 * Polls `pg_stat_activity` until a `spk03` backend waits on a lock. Deadline 1.5 s on purpose: `platform_app` has
 * `lock_timeout = 2s` (prisma/bootstrap/00-roles.sql), so the waiter must be seen before the loser's lock wait can
 * expire with 55P03. Lengthening this deadline past 2 s would turn the 0-row race test into a 55P03 failure.
 */
async function waitForLockWaiter(observer: pg.Client): Promise<boolean> {
  const deadline = performance.now() + 1_500;
  while (performance.now() < deadline) {
    const rows = await observer.query(
      `SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname = $1 AND application_name = 'spk03' AND wait_event_type = 'Lock'`,
      [database],
    );
    if ((rows.rowCount ?? 0) > 0) return true;
    await delay(25);
  }
  return false;
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

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

const SETUP_SQL = `
CREATE FUNCTION platform.spk03_app_org_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.org_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN current_setting('app.org_id', true)::uuid END
$$;
CREATE FUNCTION platform.spk03_app_actor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.actor_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN current_setting('app.actor_id', true)::uuid END
$$;
CREATE FUNCTION platform.spk03_app_guest_token_hash() RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.guest_token_hash', true) ~ '^[0-9a-f]{64}$'
              THEN decode(current_setting('app.guest_token_hash', true), 'hex') END
$$;

CREATE TABLE public.spk03_operator_members (user_id uuid PRIMARY KEY);
CREATE TABLE public.spk03_shipments (id uuid PRIMARY KEY, org_id uuid NOT NULL, ref text NOT NULL);
CREATE TABLE public.spk03_quotes (
  id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, claimed_by_user_id uuid, claimed_at timestamptz,
  ref text NOT NULL,
  CONSTRAINT spk03_quotes_owner_ck CHECK ((org_id IS NULL) <> (guest_token_hash IS NULL)));

-- seed rows before RLS: FORCE leaves the owner (migrator) without any policy
INSERT INTO public.spk03_operator_members (user_id) VALUES ('${OPERATOR_USER}');
INSERT INTO public.spk03_shipments (id, org_id, ref) VALUES
  (gen_random_uuid(), '${ORG_A}', 'A1'), (gen_random_uuid(), '${ORG_A}', 'A2'), (gen_random_uuid(), '${ORG_A}', 'A3'),
  (gen_random_uuid(), '${ORG_B}', 'B1'), (gen_random_uuid(), '${ORG_B}', 'B2');

-- ADR-0005 amendment 2 / data-model §4.2: SECURITY DEFINER, owned by platform_definer, reads through a definer policy
CREATE FUNCTION platform.spk03_app_is_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.current_setting('app.actor_scope', true) = 'OPERATOR'
     AND EXISTS (SELECT 1 FROM public.spk03_operator_members m WHERE m.user_id = platform.spk03_app_actor_id())
$$;
-- grant before the owner change: the migrator holds platform_definer WITH INHERIT FALSE, so a grant after the owner change
-- is expected to fail (not exercised; F-10)
GRANT EXECUTE ON FUNCTION platform.spk03_app_is_operator() TO platform_app;
ALTER FUNCTION platform.spk03_app_is_operator() OWNER TO platform_definer;
ALTER TABLE public.spk03_operator_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spk03_operator_members FORCE ROW LEVEL SECURITY;
CREATE POLICY p_spk03_operator_members__definer_read ON public.spk03_operator_members FOR SELECT TO platform_definer USING (true);
GRANT SELECT ON public.spk03_operator_members TO platform_definer;

-- TENANT template (data-model §4.3)
ALTER TABLE public.spk03_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spk03_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY p_spk03_shipments__tenant ON public.spk03_shipments FOR ALL TO platform_app
  USING (org_id = platform.spk03_app_org_id()) WITH CHECK (org_id = platform.spk03_app_org_id());
CREATE POLICY p_spk03_shipments__operator ON public.spk03_shipments FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.spk03_app_is_operator());

-- GUEST_CAPABLE = TENANT template + guest branch
ALTER TABLE public.spk03_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spk03_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY p_spk03_quotes__tenant ON public.spk03_quotes FOR ALL TO platform_app
  USING (org_id = platform.spk03_app_org_id()) WITH CHECK (org_id = platform.spk03_app_org_id());
CREATE POLICY p_spk03_quotes__operator ON public.spk03_quotes FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.spk03_app_is_operator());
CREATE POLICY p_spk03_quotes__guest ON public.spk03_quotes FOR ALL TO platform_app
  USING (org_id IS NULL AND guest_token_hash = platform.spk03_app_guest_token_hash())
  WITH CHECK (org_id IS NULL AND guest_token_hash = platform.spk03_app_guest_token_hash());

-- runtime grants: SELECT/INSERT/UPDATE only (no DELETE); EXECUTE is explicit (default privileges revoke it from PUBLIC)
GRANT SELECT, INSERT, UPDATE ON public.spk03_shipments, public.spk03_quotes TO platform_app;
GRANT EXECUTE ON FUNCTION platform.spk03_app_org_id(), platform.spk03_app_actor_id(), platform.spk03_app_guest_token_hash()
  TO platform_app, platform_definer;
`;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: false }));
  const migrator = new pg.Client(db.migratorConnection(database));
  await migrator.connect();
  try {
    await migrator.query(SETUP_SQL);
    const version = await migrator.query<{ version: string }>('SELECT version()');
    report['server'] = version.rows[0]?.version;
    // C-1 (TASK-015 part 015-B): the hosted measurement needs the client host next to the figures (no host name or path).
    report['client'] = {
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model,
      node: process.version,
    };
  } finally {
    await migrator.end();
  }
  const { PrismaClient } = await withFileLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaClient, { connectionString: db.appUrl(database), poolMax: 2, applicationName: 'spk03' });
  single = createDatabaseClient(PrismaClient, { connectionString: db.appUrl(database), poolMax: 1, applicationName: 'spk03-single' });
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  await single?.$disconnect();
  await db?.stop();
  const target = process.env['SPK03_REPORT'];
  if (target) writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}, 60_000);

describe('SPK-03 (a) context isolation across pooled connections', () => {
  it('SPK-03 (a) interleaved org A and org B transactions on two pooled connections each see only their own rows', async () => {
    const aOpened = deferred();
    const bDone = deferred();
    const [a, b] = await Promise.all([
      withTenantTx(client, tenant(ORG_A), async (tx) => {
        const first = await probe(tx);
        aOpened.resolve();
        await bDone.promise;
        return { first, second: await probe(tx) };
      }),
      (async () => {
        await aOpened.promise;
        return withTenantTx(client, tenant(ORG_B, USER_B), async (tx) => {
          const seen = await probe(tx);
          bDone.resolve();
          return seen;
        });
      })(),
    ]);
    expect(a.first.rows).toEqual([ORG_A, ORG_A, ORG_A]);
    expect(a.second).toEqual(a.first);
    expect(b.rows).toEqual([ORG_B, ORG_B]);
    expect(a.first.org).toBe(ORG_A);
    expect(b.org).toBe(ORG_B);
    expect(b.pid).not.toBe(a.first.pid);
  });

  it('SPK-03 (a) after COMMIT and after ROLLBACK the reused connection carries no context', async () => {
    const committed = await withTenantTx(single, tenant(ORG_A), probe);
    const afterCommit = await single.$transaction(probe);
    const thrown = await rejection(
      withTenantTx(single, tenant(ORG_B, USER_B), async (tx) => {
        expect((await probe(tx)).rows).toEqual([ORG_B, ORG_B]);
        throw new Error('spk03 rollback');
      }),
    );
    const afterRollback = await single.$transaction(probe);
    const autocommit = await probe(single);

    expect(thrown).toEqual(new Error('spk03 rollback'));
    expect(committed.rows).toEqual([ORG_A, ORG_A, ORG_A]);
    for (const seen of [afterCommit, afterRollback, autocommit]) {
      expect(seen.pid).toBe(committed.pid);
      expect(['', null]).toContain(seen.org);
      expect(seen.rows).toEqual([]);
    }
    // F-07 pinned: on a reused backend the placeholder reads '' (not NULL) once a transaction has set it.
    expect(afterCommit.org).toBe('');
    report['a_reset_value'] = { afterCommit: afterCommit.org, afterRollback: afterRollback.org, pid: committed.pid };
  });

  it('SPK-03 (a) the transaction-local statement_timeout and app.correlation_id are honoured inside the transaction and revert on the pooled connection', async () => {
    const baseline = await sessionSettings(single);
    expect(baseline.timeout).not.toBe('250ms');

    const inside = await withTenantTx(single, { ...tenant(ORG_A), correlationId: 'spk03-m2', statementTimeoutMs: 250 }, sessionSettings);
    expect(inside).toEqual({ pid: baseline.pid, timeout: '250ms', correlation: 'spk03-m2' });
    const afterCommit = await sessionSettings(single);
    expect(afterCommit).toEqual({ pid: baseline.pid, timeout: baseline.timeout, correlation: '' });

    // honoured: a statement longer than the transaction-local timeout is cancelled (57014) and the transaction rolls back
    const cancelled = await rejection(
      withTenantTx(
        single,
        { ...tenant(ORG_A), correlationId: 'spk03-m2-cancel', statementTimeoutMs: 200 },
        (tx) => tx.$executeRaw`SELECT pg_sleep(1)`,
      ),
    );
    report['a_statement_timeout_error'] = describeError(cancelled);
    expect(cancelled).toMatchObject(rawPgError('57014'));
    const afterRollback = await sessionSettings(single);
    expect(afterRollback).toEqual({ pid: baseline.pid, timeout: baseline.timeout, correlation: '' });
    // reverted: the same backend now runs the same-length sleep without a context (role default, no 200 ms limit)
    expect(await single.$executeRaw`SELECT pg_sleep(0.3)`).toBeGreaterThanOrEqual(0);
    report['a_statement_timeout'] = { baseline: baseline.timeout, inside: inside.timeout, pid: baseline.pid };
  });

  it('SPK-03 (a) negative control: a session-level set_config(..., false) leaks into the next transaction on the same backend; the transaction-local form does not', async () => {
    const local = await withTenantTx(single, tenant(ORG_A), probe);
    const afterLocal = await single.$transaction(probe);
    expect(afterLocal).toEqual({ pid: local.pid, org: '', rows: [] });

    const sessionLevel = await single.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, false)`; // the hazard (F-04): is_local = false
      return probe(tx);
    });
    try {
      const nextTx = await single.$transaction(probe);
      const nextAutocommit = await probe(single);
      // the leak: no withTenantTx at all, yet the reused backend still carries org A and RLS admits its rows
      for (const seen of [nextTx, nextAutocommit]) {
        expect(seen).toEqual({ pid: sessionLevel.pid, org: ORG_A, rows: [ORG_A, ORG_A, ORG_A] });
      }
      // withTenantTx overrides it for its own transaction, but SET LOCAL reverts to the session value, not to ''
      expect((await withTenantTx(single, tenant(ORG_B, USER_B), probe)).rows).toEqual([ORG_B, ORG_B]);
      expect(await single.$transaction(probe)).toEqual({ pid: sessionLevel.pid, org: ORG_A, rows: [ORG_A, ORG_A, ORG_A] });
    } finally {
      await single.$executeRaw`RESET app.org_id`; // clean the leaked session value so later tests start clean
    }
    expect(await single.$transaction(probe)).toEqual({ pid: sessionLevel.pid, org: '', rows: [] });
  });

  it('SPK-03 (a) 50 parallel transactions over a pool of two never leak context', async () => {
    const contexts = [tenant(ORG_A), tenant(ORG_B, USER_B), NO_CONTEXT];
    const runs = await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const ctx = contexts[i % 3] ?? NO_CONTEXT;
        // explicit maxWait: 50 transactions queue ~25 deep on 2 connections; the default 2000 ms is not what is tested
        return withTenantTx(
          client,
          ctx,
          async (tx) => {
            const first = await probe(tx);
            await tx.$executeRaw`SELECT pg_sleep(0.002)`; // $queryRaw cannot deserialize a void column
            return { ctx, first, second: await probe(tx) };
          },
          { maxWait: 20_000, timeout: 20_000 },
        );
      }),
    );
    const expected = (orgId: string): string[] => (orgId === ORG_A ? [ORG_A, ORG_A, ORG_A] : orgId === ORG_B ? [ORG_B, ORG_B] : []);
    for (const run of runs) {
      expect(run.first.rows).toEqual(expected(run.ctx.orgId));
      expect(run.second.rows).toEqual(expected(run.ctx.orgId));
      expect(run.first.org).toBe(run.ctx.orgId);
    }
    const pids = new Set(runs.map((run) => run.first.pid));
    expect(pids.size).toBeLessThanOrEqual(2);
    report['a_parallel'] = { transactions: runs.length, distinctBackendPids: pids.size };
  }, 60_000);
});

describe('SPK-03 (b) fail-closed without a valid context', () => {
  it('SPK-03 (b) unset context returns 0 rows and every INSERT is rejected by WITH CHECK (42501)', async () => {
    expect(await withTenantTx(client, NO_CONTEXT, (tx) => count(tx, 'shipments'))).toBe(0);
    expect(await withTenantTx(client, NO_CONTEXT, (tx) => count(tx, 'quotes'))).toBe(0);
    expect(await count(client, 'shipments')).toBe(0); // no wrapper at all: autocommit statement on the pool
    for (const orgId of [ORG_A, ORG_B]) {
      const error = await rejection(withTenantTx(client, NO_CONTEXT, (tx) => insertShipment(tx, orgId, 'x')));
      expect(error).toMatchObject(rawPgError('42501')); // F-06 shape pinned (m1)
      report['b_insert_error'] = describeError(error);
    }
    // GUEST_CAPABLE: a guest-shaped quote (org_id NULL + a hash) fails the guest WITH CHECK without a guest context
    const guestShaped = await rejection(
      withTenantTx(
        client,
        NO_CONTEXT,
        (tx) =>
          tx.$executeRaw`INSERT INTO public.spk03_quotes (id, org_id, guest_token_hash, ref) VALUES (${randomUUID()}::uuid, NULL, decode(${tokenHash()}, 'hex'), 'x')`,
      ),
    );
    expect(guestShaped).toMatchObject(rawPgError('42501'));
  });

  it('SPK-03 (b) a malformed app.org_id yields 0 rows without raising (ADR-0005 am. 6)', async () => {
    const malformed = ['not-a-uuid', `${ORG_A} `, `${ORG_A.slice(0, -1)}g`, "' OR true --", `${ORG_A},${ORG_B}`];
    for (const orgId of malformed) {
      const ctx = { ...NO_CONTEXT, orgId };
      expect(await withTenantTx(client, ctx, (tx) => count(tx, 'shipments'))).toBe(0);
      expect(await withTenantTx(client, ctx, (tx) => count(tx, 'quotes'))).toBe(0);
      expect(sqlState(await rejection(withTenantTx(client, ctx, (tx) => insertShipment(tx, ORG_A, 'x'))))).toBe('42501');
    }
  });

  it('SPK-03 (b) a foreign org_id is rejected by WITH CHECK and a foreign UPDATE touches 0 rows', async () => {
    const foreignInsert = await rejection(withTenantTx(client, tenant(ORG_B, USER_B), (tx) => insertShipment(tx, ORG_A, 'x')));
    expect(sqlState(foreignInsert)).toBe('42501');
    const foreignUpdate = await withTenantTx(
      client,
      tenant(ORG_B, USER_B),
      (tx) => tx.$executeRaw`UPDATE public.spk03_shipments SET ref = ref WHERE org_id = ${ORG_A}::uuid`,
    );
    expect(foreignUpdate).toBe(0);
    const reassign = await rejection(
      withTenantTx(client, tenant(ORG_B, USER_B), (tx) => tx.$executeRaw`UPDATE public.spk03_shipments SET org_id = ${ORG_A}::uuid`),
    );
    expect(sqlState(reassign)).toBe('42501');
    expect(await withTenantTx(client, tenant(ORG_A), (tx) => count(tx, 'shipments'))).toBe(3);
  });

  it('SPK-03 (b) a raw pg connection as platform_app outside any wrapper sees 0 rows', async () => {
    const raw = new pg.Client(db.appConnection(database));
    await raw.connect();
    try {
      const role = await raw.query<{ user: string; bypass: boolean }>(
        'SELECT current_user::text AS user, r.rolbypassrls AS bypass FROM pg_catalog.pg_roles r WHERE r.rolname = current_user',
      );
      expect(role.rows).toEqual([{ user: 'platform_app', bypass: false }]);
      const counts = await raw.query<{ shipments: number; quotes: number }>(
        'SELECT (SELECT count(*)::int FROM public.spk03_shipments) AS shipments, (SELECT count(*)::int FROM public.spk03_quotes) AS quotes',
      );
      expect(counts.rows).toEqual([{ shipments: 0, quotes: 0 }]);
    } finally {
      await raw.end();
    }
  });
});

describe('SPK-03 (c) guest claim under the guest and tenant policies', () => {
  it('SPK-03 (c) a guest creates a quote with org_id NULL; the claim UPDATE with both settings succeeds and ends guest access', async () => {
    const hash = tokenHash();
    const id = await createGuestQuote(hash);
    expect(await withTenantTx(client, guest(hash), (tx) => count(tx, 'quotes'))).toBe(1);
    expect(await withTenantTx(client, guest(tokenHash()), (tx) => count(tx, 'quotes'))).toBe(0);
    expect(await withTenantTx(client, tenant(ORG_A), (tx) => count(tx, 'quotes'))).toBe(0);

    expect(await withTenantTx(client, tenant(ORG_A, USER_A, hash), (tx) => claim(tx, id))).toBe(1);

    expect(await withTenantTx(client, guest(hash), (tx) => count(tx, 'quotes'))).toBe(0);
    const claimed = await withTenantTx(
      client,
      tenant(ORG_A),
      (tx) => tx.$queryRaw<Array<Record<string, unknown>>>`
        SELECT org_id::text AS org_id, claimed_by_user_id::text AS claimed_by, guest_token_hash IS NULL AS hash_cleared
          FROM public.spk03_quotes WHERE id = ${id}::uuid`,
    );
    expect(claimed).toEqual([{ org_id: ORG_A, claimed_by: USER_A, hash_cleared: true }]);
    // A second claim (retry) updates 0 rows; the service then re-reads under its own scope (idempotent 200).
    expect(await withTenantTx(client, tenant(ORG_A, USER_A, hash), (tx) => claim(tx, id))).toBe(0);
  });

  it('SPK-03 (c) a wrong, missing or malformed guest token hash claims 0 rows', async () => {
    const hash = tokenHash();
    const id = await createGuestQuote(hash);
    for (const presented of [tokenHash(), '', hash.toUpperCase(), hash.slice(1)]) {
      expect(await withTenantTx(client, tenant(ORG_A, USER_A, presented), (tx) => claim(tx, id))).toBe(0);
    }
    expect(await withTenantTx(client, tenant(ORG_B, USER_B, hash), (tx) => claim(tx, id))).toBe(1);
  });

  it('SPK-03 (c) two concurrent claims by different organisations: exactly one wins, the other updates 0 rows', async () => {
    const hash = tokenHash();
    const id = await createGuestQuote(hash);
    const firstUpdated = deferred();
    const observer = await db.superuser(database);
    try {
      const [first, second] = await Promise.all([
        withTenantTx(
          client,
          tenant(ORG_A, USER_A, hash),
          async (tx) => {
            const updated = await claim(tx, id);
            firstUpdated.resolve();
            return { updated, waiter: await waitForLockWaiter(observer) }; // returns within 1.5 s < lock_timeout 2 s
          },
          { timeout: 10_000 },
        ),
        (async () => {
          await firstUpdated.promise;
          return withTenantTx(client, tenant(ORG_B, USER_B, hash), (tx) => claim(tx, id), { timeout: 10_000 });
        })(),
      ]);
      expect(first).toEqual({ updated: 1, waiter: true });
      expect(second).toBe(0);
    } finally {
      await observer.end();
    }
    const owners = await withTenantTx(
      client,
      tenant(ORG_A),
      (tx) => tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM public.spk03_quotes WHERE id = ${id}::uuid`,
    );
    expect(owners).toEqual([{ n: 1 }]);
  }, 30_000);

  it('SPK-03 (c) a claim loser that waits longer than lock_timeout (2 s) fails with 55P03 instead of updating 0 rows', async () => {
    const hash = tokenHash();
    const id = await createGuestQuote(hash);
    const firstUpdated = deferred();
    const loserSettled = deferred();
    const observer = await db.superuser(database);
    try {
      const [first, lost] = await Promise.all([
        withTenantTx(
          client,
          tenant(ORG_A, USER_A, hash),
          async (tx) => {
            const updated = await claim(tx, id);
            firstUpdated.resolve();
            const waiter = await waitForLockWaiter(observer);
            await loserSettled.promise; // hold the row lock until the loser's lock wait has expired
            return { updated, waiter };
          },
          { timeout: 10_000 },
        ),
        (async () => {
          await firstUpdated.promise;
          try {
            return await rejection(withTenantTx(client, tenant(ORG_B, USER_B, hash), (tx) => claim(tx, id), { timeout: 10_000 }));
          } finally {
            loserSettled.resolve();
          }
        })(),
      ]);
      report['c_claim_lock_timeout_error'] = describeError(lost);
      expect(first).toEqual({ updated: 1, waiter: true });
      expect(lost).toMatchObject(rawPgError('55P03'));
    } finally {
      await observer.end();
    }
    const claimed = await withTenantTx(
      client,
      tenant(ORG_A),
      (tx) => tx.$queryRaw<Array<{ claimed_by: string }>>`
      SELECT claimed_by_user_id::text AS claimed_by FROM public.spk03_quotes WHERE id = ${id}::uuid`,
    );
    expect(claimed).toEqual([{ claimed_by: USER_A }]);
  }, 30_000);

  it('SPK-03 (c) the operator branch reads across tenants but cannot write', async () => {
    const operator: TenantContext = { orgId: '', actorId: OPERATOR_USER, actorScope: 'OPERATOR', guestTokenHash: '' };
    expect(await withTenantTx(client, operator, (tx) => count(tx, 'shipments'))).toBe(5);
    expect(await withTenantTx(client, operator, (tx) => tx.$executeRaw`UPDATE public.spk03_shipments SET ref = ref`)).toBe(0);
    expect(await withTenantTx(client, operator, (tx) => tx.$executeRaw`UPDATE public.spk03_quotes SET ref = ref`)).toBe(0);
    expect(sqlState(await rejection(withTenantTx(client, operator, (tx) => insertShipment(tx, ORG_A, 'op'))))).toBe('42501');
    // amendment 2: the scope alone is not enough, the actor must be an operator member; a member needs the scope.
    const notMember: TenantContext = { ...operator, actorId: NOT_OPERATOR_USER };
    expect(await withTenantTx(client, notMember, (tx) => count(tx, 'shipments'))).toBe(0);
    expect(await withTenantTx(client, { ...operator, actorScope: 'TENANT' }, (tx) => count(tx, 'shipments'))).toBe(0);
  });
});

/**
 * Exit (d) is a one-time measurement recorded in SPK-03.md §4, not a regression guard (code review M1): it is wall-clock
 * sensitive and adds ~10 s, so it runs only with `SPK03_BENCH=1` (condition C-1 re-run, TASK-016).
 */
const benchmark = process.env['SPK03_BENCH'] === '1' ? describe : describe.skip;

benchmark('SPK-03 (d) set_config overhead', () => {
  it('SPK-03 (d) set_config server-side cost <= 1 ms p95; client-observed deltas recorded (N=400 per variant, rotating order, after warm-up)', async () => {
    const query = (tx: Pick<Tx, '$queryRaw'>): Promise<unknown> => tx.$queryRaw`SELECT count(*)::int AS n FROM public.spk03_shipments`;
    const statement: number[] = [];
    const withContext = (): Promise<unknown> =>
      client.$transaction(async (tx) => {
        statement.push(await timed(() => setContext(tx, tenant(ORG_A))));
        return query(tx);
      });
    const withoutContext = (): Promise<unknown> => client.$transaction(query);

    const pool = new pg.Pool({ ...db.appConnection(database), max: 1 });
    const rawTx = async (setCtx: boolean): Promise<void> => {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        if (setCtx) await conn.query(CONTEXT_SQL, contextValues(tenant(ORG_A)));
        await conn.query('SELECT count(*)::int AS n FROM public.spk03_shipments');
        await conn.query('COMMIT');
      } finally {
        conn.release();
      }
    };

    // Control: the same transaction shape with a trivial first statement (one round trip, no set_config).
    const roundTrip: number[] = [];
    const withControl = (): Promise<unknown> =>
      client.$transaction(async (tx) => {
        roundTrip.push(await timed(() => tx.$executeRaw`SELECT 1`));
        return query(tx);
      });
    // Server-side cost of the statement, from the executor itself (no network).
    const serverSide = async (): Promise<number> => {
      const conn = await pool.connect();
      try {
        // autocommit: the implicit transaction ends with the statement, so the is_local settings do not persist
        const plan = await conn.query<{ 'QUERY PLAN': Array<{ 'Planning Time': number; 'Execution Time': number }> }>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${CONTEXT_SQL}`,
          contextValues(tenant(ORG_A)),
        );
        const node = plan.rows[0]?.['QUERY PLAN'][0];
        if (node === undefined) throw new Error('EXPLAIN returned no plan');
        return node['Planning Time'] + node['Execution Time'];
      } finally {
        conn.release();
      }
    };

    const N = 400;
    const samples = {
      with: [] as number[],
      control: [] as number[],
      without: [] as number[],
      rawWith: [] as number[],
      rawWithout: [] as number[],
      server: [] as number[],
    };
    const measure = (into: number[], fn: () => Promise<number>) => async (): Promise<void> => {
      into.push(await fn());
    };
    const variants: Array<() => Promise<void>> = [
      measure(samples.with, () => timed(withContext)),
      measure(samples.control, () => timed(withControl)),
      measure(samples.without, () => timed(withoutContext)),
      measure(samples.rawWith, () => timed(() => rawTx(true))),
      measure(samples.rawWithout, () => timed(() => rawTx(false))),
      measure(samples.server, serverSide),
    ];
    try {
      for (let i = 0; i < 50; i += 1) for (const variant of variants) await variant();
      for (const list of Object.values(samples)) list.length = 0;
      statement.length = 0;
      roundTrip.length = 0;
      for (let i = 0; i < N; i += 1) {
        // rotate the order every iteration so drift and GC pauses spread evenly over the variants
        for (let k = 0; k < variants.length; k += 1) await variants[(i + k) % variants.length]?.();
      }
    } finally {
      await pool.end();
    }

    const summary = (xs: number[]): { p50: number; p95: number; p99: number } => ({
      p50: percentile(xs, 50),
      p95: percentile(xs, 95),
      p99: percentile(xs, 99),
    });
    const delta = (a: number[], b: number[], p: number): number => Math.round((percentile(a, p) - percentile(b, p)) * 1000) / 1000;
    const result = {
      n: N,
      prismaWithSetConfig: summary(samples.with),
      prismaWithSelect1: summary(samples.control),
      prismaWithoutContext: summary(samples.without),
      setConfigStatement: summary(statement),
      select1Statement: summary(roundTrip),
      serverSideSetConfig: summary(samples.server),
      rawPgWith: summary(samples.rawWith),
      rawPgWithout: summary(samples.rawWithout),
      p95DeltaVsNoStatement: delta(samples.with, samples.without, 95),
      p50DeltaVsNoStatement: delta(samples.with, samples.without, 50),
      p95DeltaVsSelect1: delta(samples.with, samples.control, 95),
      p95StatementVsSelect1: delta(statement, roundTrip, 95),
      p95DeltaRawPg: delta(samples.rawWith, samples.rawWithout, 95),
    };
    report['d_overhead_ms'] = result;
    // Asserted: only set_config's server-side cost (executor, no network). Recorded, not asserted: every client-observed
    // figure, including p95(set_config statement) - p95(SELECT 1 statement) and the per-transaction differences of p95s,
    // which are one extra round trip plus host jitter. On Docker Desktop for Windows one round trip alone is ~1.4-1.7 ms
    // p50, and p95(tx with) - p95(tx without) moved between 1.9 and 3.6 ms across runs (SPK-03.md §4).
    expect(result.serverSideSetConfig.p95).toBeLessThanOrEqual(1);
  }, 300_000);
});

describe('SPK-03 (e) findings for consumers', () => {
  it('SPK-03 (e1) a nested $transaction inside an interactive transaction is a SAVEPOINT on the same connection and keeps the context', async () => {
    const outcome = await withTenantTx(client, tenant(ORG_A), async (tx) => {
      const outer = await probe(tx);
      const inner = await tx.$transaction(probe);
      const failed = await rejection(
        tx.$transaction(async (nested) => {
          await insertShipment(nested, ORG_A, 'nested');
          throw new Error('spk03 inner rollback');
        }),
      );
      const nestedRows = await tx.$queryRaw<
        Array<{ n: number }>
      >`SELECT count(*)::int AS n FROM public.spk03_shipments WHERE ref = 'nested'`;
      return { outer, inner, failed, nestedRows: one(nestedRows).n, after: await probe(tx) };
    });
    expect(outcome.inner).toEqual(outcome.outer);
    expect(outcome.failed).toEqual(new Error('spk03 inner rollback'));
    expect(outcome.nestedRows).toBe(0);
    expect(outcome.after).toEqual(outcome.outer);
  });

  it('SPK-03 (e2) the root client inside withTenantTx runs on another connection without context; with poolMax 1 it cannot start', async () => {
    const seen = await withTenantTx(client, tenant(ORG_A), async (tx) => ({ inside: await probe(tx), root: await probe(client) }));
    expect(seen.root.pid).not.toBe(seen.inside.pid);
    expect(seen.root.rows).toEqual([]);
    expect(['', null]).toContain(seen.root.org);

    const started = performance.now();
    const error = await rejection(
      withTenantTx(single, tenant(ORG_A), () => single.$transaction(probe, { maxWait: 500 }), { timeout: 10_000 }),
    );
    report['e2_root_tx_in_tx_pool1'] = { ...describeError(error), afterMs: Math.round(performance.now() - started) };
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: 'P2028' }); // F-03 shape pinned (m1)
    expect((error as Error).message).toMatch(/Unable to start a transaction in the given time/);
  }, 30_000);

  it('SPK-03 (e3) interactive-transaction defaults are maxWait 2000 ms and timeout 5000 ms; an expired transaction leaves no context', async () => {
    const expired = await rejection(
      withTenantTx(single, tenant(ORG_A), async (tx) => {
        await delay(5_300);
        return probe(tx);
      }),
    );
    report['e3_timeout_error'] = describeError(expired);
    expect(expired).toMatchObject({ code: 'P2028', meta: { operation: 'query', timeout: 5000 } }); // F-03 shape pinned (m1)
    expect((expired as Error).message).toMatch(/A query cannot be executed on an expired transaction/);
    const after = await single.$transaction(probe);
    expect(after.rows).toEqual([]);
    expect(['', null]).toContain(after.org);

    const holder = withTenantTx(
      single,
      tenant(ORG_A),
      async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(2.6)`;
        return probe(tx);
      },
      { timeout: 10_000 },
    );
    await delay(100);
    const started = performance.now();
    const waited = await rejection(single.$transaction(probe));
    const waitedMs = Math.round(performance.now() - started);
    report['e3_maxwait_error'] = { ...describeError(waited), afterMs: waitedMs };
    expect(waited).toMatchObject({ code: 'P2028' }); // F-03 shape pinned (m1)
    expect((waited as Error).message).toMatch(/Unable to start a transaction in the given time/);
    expect(waitedMs).toBeGreaterThanOrEqual(1_900);
    expect((await holder).rows).toEqual([ORG_A, ORG_A, ORG_A]);
  }, 60_000);

  it('SPK-03 (e4) SET LOCAL cannot take a bind parameter through the adapter; set_config can', async () => {
    const bound = await rejection(single.$transaction((tx) => tx.$executeRaw`SET LOCAL app.org_id = ${ORG_A}`));
    report['e4_set_local_bound'] = describeError(bound);
    expect(bound).toMatchObject(rawPgError('42601'));
    const literal = await single.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${ORG_A}'`);
      return probe(tx);
    });
    expect(literal.rows).toEqual([ORG_A, ORG_A, ORG_A]);
    expect((await single.$transaction(probe)).rows).toEqual([]);
  });

  it('SPK-03 (e5) a query extension stays out of RLS: transactions of an extended client keep the withTenantTx context', async () => {
    let calls = 0;
    const extended = client.$extends({
      query: {
        $allOperations({ args, query }) {
          calls += 1;
          return query(args);
        },
      },
    });
    const seen = await extended.$transaction(async (tx) => {
      await setContext(tx, tenant(ORG_B, USER_B));
      return probe(tx);
    });
    expect(seen.rows).toEqual([ORG_B, ORG_B]);
    report['e5_extension_calls'] = calls;
  });
});
