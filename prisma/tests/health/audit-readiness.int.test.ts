/**
 * The audit readiness checks against the real bootstrap lane (US-012 part, REQ-AUDIT-017; data-model §5.3 amendment
 * 2026-11-13 item 3, PR12-SEC-02, D-ARCH-076; PR #9 m2 / D-ARCH-074; TASK-021).
 *
 * The checks are built by the API/worker database runtime (`createDatabaseRuntime(...).auditChecks`) over its own
 * `platform_app` pool, exactly as in production. Each tampering case runs on its own clone of the migrated template:
 * the readiness query reads COMMITTED catalogue state through another connection, so the plant is committed there
 * (the superuser disables the guard around it; the guard itself is proved by c11-c14-audit and the audit suite).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { createDatabaseRuntime, type DatabaseRuntime } from '../../../apps/api/src/platform/db/runtime.js';
import { PlatformPostgres } from '../harness/postgres.js';

const STARTUP_TIMEOUT_MS = 240_000;
const TX = { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 };
const SYSTEM_ACTOR = '00000000-0000-7000-8000-000000000001';

let db: PlatformPostgres;
let template: string;
const runtimes: DatabaseRuntime<never>[] = [];

/** UTC month `offset` months from now as `YYYY_MM`. */
function monthSuffix(offset: number): string {
  const now = new Date();
  const index = now.getUTCFullYear() * 12 + now.getUTCMonth() + offset;
  return `${String(Math.floor(index / 12))}_${String((index % 12) + 1).padStart(2, '0')}`;
}

/** A runtime over a fresh clone, with its log lines captured. */
async function runtimeOnClone(): Promise<{ runtime: DatabaseRuntime<never>; database: string; lines: Record<string, unknown>[] }> {
  const database = await db.clone(template);
  const lines: Record<string, unknown>[] = [];
  const runtime = createDatabaseRuntime<never, never>({
    database: { connectionString: db.appUrl(database), poolMax: 2, applicationName: 'audit-readiness-it' },
    tx: TX,
    // The runtime log's shape (platform/runtime/log.ts is outside the prisma/tests import allow-list).
    log: {
      info: (event, fields = {}) => void lines.push({ ...fields, level: 'info', event }),
      warn: (event, fields = {}) => void lines.push({ ...fields, level: 'warn', event }),
      error: (event, fields = {}) => void lines.push({ ...fields, level: 'error', event }),
    },
  });
  runtimes.push(runtime);
  return { runtime, database, lines };
}

/** Runs `sql` as the superuser with both guard event triggers disabled around it (committed). */
async function asSuperuserUnguarded(database: string, sql: string): Promise<void> {
  const client = await db.superuser(database);
  try {
    await client.query('BEGIN');
    await client.query('ALTER EVENT TRIGGER platform_audit_ddl_guard_end DISABLE');
    await client.query('ALTER EVENT TRIGGER platform_audit_ddl_guard_drop DISABLE');
    await client.query(sql);
    await client.query('ALTER EVENT TRIGGER platform_audit_ddl_guard_end ENABLE ALWAYS');
    await client.query('ALTER EVENT TRIGGER platform_audit_ddl_guard_drop ENABLE ALWAYS');
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

const settle = (promise: Promise<unknown>): Promise<'ok' | 'degraded' | 'failed'> =>
  promise.then(
    (outcome) => (outcome === 'degraded' ? 'degraded' : 'ok'),
    () => 'failed',
  );
const signal = () => new AbortController().signal;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  template = await db.template({ migrated: true });
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  for (const runtime of runtimes) for (const resource of runtime.resources) await resource.close().catch(() => undefined);
  await db.stop();
}, STARTUP_TIMEOUT_MS);

describe('audit readiness against the bootstrapped catalogue (TASK-021)', () => {
  it('[AT-US-012-01] [AT-US-095-01] a freshly bootstrapped database: audit_partitions ok (current .. +3 exist), audit_chain degraded until a verification passed', async () => {
    const { runtime, lines } = await runtimeOnClone();
    await expect(settle(runtime.auditChecks.partitions.check(signal()))).resolves.toBe('ok');
    await expect(settle(runtime.auditChecks.chain.check(signal()))).resolves.toBe('degraded');
    expect(lines.filter((line) => String(line['event']).startsWith('security.'))).toEqual([]);
  });

  it('[PR #9 m2] audit_chain is ok once the latest finished verification passed, degraded after a failed one', async () => {
    const { runtime, database } = await runtimeOnClone();
    const client = await db.superuser(database);
    try {
      await client.query(
        `INSERT INTO public.audit_chain_verifications (created_by, updated_by, run_kind, status, started_at, finished_at)
         VALUES ($1, $1, 'INCREMENTAL', 'PASSED', now() - interval '2 hours', now() - interval '2 hours'),
                ($1, $1, 'INCREMENTAL', 'RUNNING', now(), NULL)`,
        [SYSTEM_ACTOR],
      );
    } finally {
      await client.end();
    }
    await expect(settle(runtime.auditChecks.chain.check(signal()))).resolves.toBe('ok');
    const failed = await runtimeOnClone();
    const second = await db.superuser(failed.database);
    try {
      await second.query(
        `INSERT INTO public.audit_chain_verifications (created_by, updated_by, run_kind, status, started_at, finished_at, failure_kind)
         VALUES ($1, $1, 'FULL', 'PASSED', now() - interval '3 hours', now() - interval '3 hours', NULL),
                ($1, $1, 'FULL', 'FAILED', now() - interval '1 hour', now() - interval '1 hour', 'HASH_MISMATCH')`,
        [SYSTEM_ACTOR],
      );
    } finally {
      await second.end();
    }
    await expect(settle(failed.runtime.auditChecks.chain.check(signal()))).resolves.toBe('degraded');
  });

  it.each([
    ['an enum (pg_type)', (name: string) => `CREATE TYPE public.${name} AS ENUM ('x')`, 'type'],
    ['an index on a non-audit table', (name: string) => `CREATE INDEX ${name} ON public.bootstrap_migrations (file_name)`, 'i'],
    ['a view', (name: string) => `CREATE VIEW public.${name} AS SELECT 1 AS x`, 'v'],
  ])(
    '[PR12-SEC-02 item 3] %s squatting a far-future partition name → unavailable + security event audit_partition_squatted',
    async (_label, plant, kind) => {
      const { runtime, database, lines } = await runtimeOnClone();
      const name = `audit_entries_${monthSuffix(40)}`;
      await asSuperuserUnguarded(database, plant(name));
      await expect(settle(runtime.auditChecks.partitions.check(signal()))).resolves.toBe('failed');
      expect(lines.filter((line) => line['event'] === 'security.audit_partition_squatted')).toEqual([
        expect.objectContaining({ level: 'warn', component: 'audit_partitions', name, kind }),
      ]);
    },
  );

  it('[PR12-SEC-02 item 3] a detached required month → unavailable (missing and reported as not attached)', async () => {
    const { runtime, database, lines } = await runtimeOnClone();
    const name = `audit_entries_${monthSuffix(1)}`;
    await asSuperuserUnguarded(database, `ALTER TABLE public.audit_entries DETACH PARTITION public.${name}`);
    await expect(settle(runtime.auditChecks.partitions.check(signal()))).resolves.toBe('failed');
    expect(lines.filter((line) => line['event'] === 'security.audit_partition_squatted')).toEqual([
      expect.objectContaining({ name, kind: 'r', reason: 'not_attached' }),
    ]);
  });

  it('[AT-US-012-04] month current + 3 missing (the daily job is late) → degraded, not unavailable', async () => {
    const { runtime, database } = await runtimeOnClone();
    const name = `audit_entries_${monthSuffix(3)}`;
    await asSuperuserUnguarded(database, `ALTER TABLE public.audit_entries DETACH PARTITION public.${name}; DROP TABLE public.${name}`);
    await expect(settle(runtime.auditChecks.partitions.check(signal()))).resolves.toBe('degraded');
  });

  it('platform_app reads the catalogue only: the registry table is not the source (a forged registry row changes nothing)', async () => {
    const { runtime, database } = await runtimeOnClone();
    const name = `audit_entries_${monthSuffix(2)}`;
    await asSuperuserUnguarded(database, `ALTER TABLE public.audit_entries DETACH PARTITION public.${name}; DROP TABLE public.${name}`);
    const app = new pg.Client(db.appConnection(database));
    await app.connect();
    try {
      // The registry row for the dropped month is still there (or re-inserted): readiness must not trust it.
      const rows = await app.query<{ n: string }>('SELECT count(*)::text AS n FROM public.audit_partitions WHERE partition_name = $1', [
        name,
      ]);
      expect(rows.rows[0]?.n).toBe('1');
    } finally {
      await app.end();
    }
    await expect(settle(runtime.auditChecks.partitions.check(signal()))).resolves.toBe('failed');
  });
});
