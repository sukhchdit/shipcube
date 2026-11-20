/**
 * Catalog C15, the standard-columns guard (data-model §4.6 C15 and §7.6 "Database guard", amendment of 2026-11-13;
 * ADR-0009 am. 1; PR26-SEC-03, D-ARCH-091; SEC-TC-74 (proposed, D-SEC-TM-01); TASK-024 mechanism, TASK-037 first
 * application). On `main` no runtime-writable STD table exists yet (the authz catalogue and reference_dataset_versions
 * are runtimeReadOnly, the audit tables are owned by platform_audit_owner), so the committed-state assertions pin the
 * empty scope and every property of the mechanism is proven on a rolled-back probe built exactly as TASK-037 will:
 * the function from prisma/sql/function-templates/std-columns-guard.sql and the trigger from the renderer.
 *
 * The per-row cost (10 000-row INSERT and UPDATE with and without the trigger, PostgreSQL 18) is measured and written
 * to reports/std-columns-guard-cost.json for the PR report: recorded, not asserted (more than 25 µs per row reopens the
 * choice, D-ARCH-091 (3)).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import { CONTEXT_STATEMENT_SQL } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { renderStdColumnsGuard, renderStdColumnsGuardFunction } from '../../../tools/db/render-rls.js';
import { AUDIT_MODULE, loadTableClasses, stdColumnsTables, type TableClassEntry } from '../../../tools/db/table-classes.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres } from '../harness/postgres.js';

const ENTRIES = loadTableClasses();
const READ_ONLY = ENTRIES.filter((entry) => entry.runtimeReadOnly === true).map((entry) => entry.name);
const AUDIT_TABLES = ENTRIES.filter((entry) => entry.module === AUDIT_MODULE).map((entry) => entry.name);
/**
 * C15 (a) exemptions: exact table name -> stated reason; looked up with a Map, never the `in` operator (PR26-SEC-06).
 * Empty: every in-scope table carries the guard.
 */
const EXEMPTIONS = new Map<string, string>();

const ACTOR = '0193a5f0-0000-7000-8000-00000000c015';
const OTHER = '0193a5f0-0000-7000-8000-00000000c016';
const ANONYMOUS = '00000000-0000-7000-8000-000000000002';
const SYSTEM = '00000000-0000-7000-8000-000000000001';
const ROW = '0193a5f0-0000-7000-8000-0000000c0001';
const PROBE: TableClassEntry = { module: 'probe', name: 'c15_probe', class: 'GLOBAL', stdColumns: true };

/** The in-scope set derived from the catalogue: full STD set, not runtimeReadOnly, not owned by the audit owner. */
const SCOPE_SQL = `
  SELECT c.relname FROM pg_catalog.pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     AND pg_catalog.pg_get_userbyid(c.relowner) <> 'platform_audit_owner' AND c.relname <> ALL ($1::text[])
     AND (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND NOT a.attisdropped
            AND a.attname IN ('id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version')) = 6
   ORDER BY 1`;

/** Every trigger calling platform.std_columns_guard(), with its shape. */
const GUARD_TRIGGERS_SQL = `
  SELECT c.relname AS "table", t.tgname AS trigger, t.tgenabled AS enabled,
         (t.tgtype::int & 1) = 1 AS row_level, (t.tgtype::int & 2) = 2 AS before,
         (t.tgtype::int & 4) = 4 AS on_insert, (t.tgtype::int & 16) = 16 AS on_update,
         (t.tgtype::int & 8) = 8 AS on_delete, (t.tgtype::int & 32) = 32 AS on_truncate
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND t.tgfoid = pg_catalog.to_regprocedure('platform.std_columns_guard()')
   ORDER BY 1, 2`;

/** A row of GUARD_TRIGGERS_SQL. */
interface GuardTrigger extends pg.QueryResultRow {
  readonly table: string;
  readonly trigger: string;
  readonly enabled: string;
  readonly row_level: boolean;
  readonly before: boolean;
  readonly on_insert: boolean;
  readonly on_update: boolean;
  readonly on_delete: boolean;
  readonly on_truncate: boolean;
}

/**
 * PR43-SEC-05 (b): the shape every guard trigger must have, on the probe and on every committed in-scope table alike:
 * enabled in origin mode (`O`; `R` = replica-only and `A` = always also change when it fires, `D` = off), row level,
 * BEFORE, INSERT and UPDATE, never DELETE or TRUNCATE. One finding per deviating trigger, naming it.
 */
const GUARD_SHAPE = { enabled: 'O', row_level: true, before: true, on_insert: true, on_update: true, on_delete: false, on_truncate: false };

/** The one guard trigger row expected on an in-scope table (name from the renderer, shape {@link GUARD_SHAPE}). */
const expectedGuard = (table: string): GuardTrigger => ({ table, trigger: `trg_${table}__std_columns`, ...GUARD_SHAPE });

function guardShapeFindings(triggers: readonly GuardTrigger[]): string[] {
  return triggers.flatMap((row) => {
    const wrong = Object.entries(GUARD_SHAPE)
      .filter(([key, value]) => row[key as keyof GuardTrigger] !== value)
      .map(([key]) => `${key}=${String(row[key as keyof GuardTrigger])}`);
    return wrong.length === 0 ? [] : [`${row.table}.${row.trigger}: ${wrong.join(', ')}`];
  });
}

/**
 * PR43-SEC-05 (c): BEFORE ROW triggers fire in name order (byte order of tgname), so an enabled BEFORE INSERT/UPDATE
 * ROW trigger whose name sorts after the guard's could rewrite NEW after the guard checked it. On every table carrying
 * a guard trigger, list every other such trigger (any enabled mode other than `D`) that sorts after it (`COLLATE "C"`).
 */
const AFTER_GUARD_SQL = `
  SELECT c.relname || '.' || o.tgname AS trigger
    FROM pg_catalog.pg_trigger g
    JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
    JOIN pg_catalog.pg_trigger o ON o.tgrelid = g.tgrelid AND o.oid <> g.oid AND NOT o.tgisinternal AND o.tgenabled <> 'D'
                                AND (o.tgtype::int & 1) = 1 AND (o.tgtype::int & 2) = 2 AND (o.tgtype::int & 20) <> 0
                                AND o.tgname COLLATE "C" > g.tgname COLLATE "C"
   WHERE NOT g.tgisinternal AND g.tgfoid = pg_catalog.to_regprocedure('platform.std_columns_guard()')
   ORDER BY 1`;

/** A settings read or write in a function body (C15 (b)); the actor is read through platform.app_actor_id() only. */
const SETTINGS_CALL = /\b(?:current_setting|set_config)\s*\(/i;

const FUNCTION_SQL = `
  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, l.lanname, p.prosrc
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid = pg_catalog.to_regprocedure('platform.std_columns_guard()')`;

/** C15 (c), best effort: trigger functions other than the guard that assign an STD column of NEW. */
const ASSIGNERS_SQL = `
  SELECT p.oid::regprocedure::text AS fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prorettype = 'pg_catalog.trigger'::regtype AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('platform.std_columns_guard()')
     AND p.prosrc OPERATOR(pg_catalog.~*) 'new\\s*\\.\\s*"?(id|created_at|created_by|updated_by|version)"?\\s*:?='
   ORDER BY 1`;

interface Row extends pg.QueryResultRow {
  [key: string]: unknown;
}

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

const rows = async <T extends Row>(client: pg.ClientBase, sql: string, params: unknown[] = []): Promise<T[]> =>
  (await client.query<T>(sql, params)).rows;

/** As the migrator (inside the caller's transaction): the guard function, the probe table, its rendered trigger. */
async function plantGuard(client: pg.Client, withTrigger = true, table = PROBE.name): Promise<void> {
  await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
  if (
    (await rows<{ fn: string | null }>(client, "SELECT pg_catalog.to_regprocedure('platform.std_columns_guard()')::text AS fn"))[0]?.fn ===
    null
  ) {
    await client.query(renderStdColumnsGuardFunction());
  }
  await client.query(`CREATE TABLE public.${table} (id uuid PRIMARY KEY, note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1)`);
  if (withTrigger) await client.query(renderStdColumnsGuard({ ...PROBE, name: table }));
  await client.query(`GRANT SELECT, INSERT, UPDATE ON public.${table} TO ${APP_ROLE}`);
  await client.query(`INSERT INTO public.${table} (id, created_by, updated_by) VALUES ($1, $2, $2)`, [ROW, OTHER]);
  await client.query('RESET ROLE');
}

/** As platform_app with `actor` in the transaction-local context (the production statement of withTenantTx). */
async function asApp(client: pg.Client, actor: string): Promise<void> {
  await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
  await client.query(CONTEXT_STATEMENT_SQL, ['', actor, 'TENANT', '', 'c15', '10000', '2000', '10000']);
}

/** The error message of `sql` in a savepoint, or 'ok'. */
async function outcome(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT c15');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT c15');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT c15');
    const { code, message } = error as { code?: unknown; message?: unknown };
    return `${String(code)} ${String(message)}`;
  }
}

const violation = (column: string, op: 'INSERT' | 'UPDATE'): string => `P0001 STD_COLUMNS_VIOLATION: ${column} on public.c15_probe (${op})`;

describe('catalog C15: standard-columns guard (D-ARCH-091; PR26-SEC-03)', () => {
  it('[SEC-TC-74] C15 (a) committed: the in-scope set equals the manifest stdColumns set, each with exactly one enabled guard trigger, and no other table has one', async () => {
    const client = await db.superuser(database);
    try {
      const scope = (await rows<{ relname: string }>(client, SCOPE_SQL, [[...READ_ONLY]])).map((row) => row.relname);
      const flagged = stdColumnsTables(ENTRIES);
      expect(scope.filter((table) => !EXEMPTIONS.has(table))).toEqual([...flagged].sort());
      const triggers = await rows<GuardTrigger>(client, GUARD_TRIGGERS_SQL);
      expect(triggers.map((row) => row['table'])).toEqual(scope.filter((table) => !EXEMPTIONS.has(table)));
      // PR43-SEC-05 (b): per in-scope table, its one trigger has the full shape (the probe test proves this check).
      for (const table of scope.filter((name) => !EXEMPTIONS.has(name))) {
        expect(triggers.filter((row) => row.table === table)).toEqual([expectedGuard(table)]);
      }
      expect(guardShapeFindings(triggers)).toEqual([]);
      // PR43-SEC-05 (c): no enabled BEFORE INSERT/UPDATE ROW trigger sorts after a guard on its table.
      expect(await rows(client, AFTER_GUARD_SQL)).toEqual([]);
      // TASK-037 applied the guard to the first runtime-writable STD tables (the organisations and identity manifests);
      // TASK-039 added job_executions (the worker manifest, the first SYSTEM table in scope). A committed-state pin: a
      // task that adds a guarded table extends it, beside its manifest entry.
      expect(scope).toEqual(['invitations', 'job_executions', 'membership_roles', 'memberships', 'organisations', 'users']);
      expect(READ_ONLY.length + AUDIT_TABLES.length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  }, 60_000);

  it('[SEC-TC-74] C15 (a) probe: the rendered trigger is the one enabled (O) row-level BEFORE INSERT OR UPDATE trigger on the function; an unguarded STD table and a second trigger are named', async () => {
    // The probe observes only the tables it plants. Since TASK-037 the committed schema has in-scope tables of its own,
    // each with its guard; those are the committed test's subject (above), so including them here would make this
    // probe depend on the committed state it is meant to be independent of (PR #65 lane B, fix cycle 3).
    const PLANTED: ReadonlySet<string> = new Set([PROBE.name, 'c15_unguarded']);
    const result = await rolledBack(async (client) => {
      await plantGuard(client);
      const guarded = (await rows(client, GUARD_TRIGGERS_SQL)).filter((row) => PLANTED.has(String(row['table'])));
      const scope = (await rows<{ relname: string }>(client, SCOPE_SQL, [[...READ_ONLY]]))
        .map((row) => row.relname)
        .filter((table) => PLANTED.has(table));
      await plantGuard(client, false, 'c15_unguarded');
      const unguarded = (await rows<{ relname: string }>(client, SCOPE_SQL, [[...READ_ONLY]]))
        .map((row) => row.relname)
        .filter((table) => PLANTED.has(table) && !guarded.some((row) => row['table'] === table));
      await client.query(
        `CREATE TRIGGER trg_c15_probe__second BEFORE UPDATE ON public.c15_probe FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard()`,
      );
      const doubled = await rows(client, GUARD_TRIGGERS_SQL);
      return { guarded, scope, unguarded, doubled };
    });
    expect(result.scope).toEqual(['c15_probe']);
    expect(result.guarded).toEqual([
      {
        table: 'c15_probe',
        trigger: 'trg_c15_probe__std_columns',
        enabled: 'O',
        row_level: true,
        before: true,
        on_insert: true,
        on_update: true,
        on_delete: false,
        on_truncate: false,
      },
    ]);
    expect(result.guarded).toEqual([expectedGuard('c15_probe')]); // the committed per-table expectation holds on the probe
    expect(result.unguarded).toEqual(['c15_unguarded']);
    expect(result.doubled.filter((row) => row['table'] === 'c15_probe')).toHaveLength(2);
  }, 60_000);

  it('[SEC-TC-74] PR43-SEC-05 (b): a guard switched to REPLICA, ALWAYS or DISABLE mode is named by the shape check the committed state runs', async () => {
    const result = await rolledBack(async (client) => {
      await plantGuard(client);
      const clean = guardShapeFindings(await rows<GuardTrigger>(client, GUARD_TRIGGERS_SQL));
      const modes: Record<string, string[]> = {};
      for (const mode of ['ENABLE REPLICA TRIGGER', 'ENABLE ALWAYS TRIGGER', 'DISABLE TRIGGER']) {
        await client.query(`ALTER TABLE public.c15_probe ${mode} trg_c15_probe__std_columns`);
        modes[mode] = guardShapeFindings(await rows<GuardTrigger>(client, GUARD_TRIGGERS_SQL));
      }
      return { clean, modes };
    });
    expect(result.clean).toEqual([]);
    expect(result.modes).toEqual({
      'ENABLE REPLICA TRIGGER': ['c15_probe.trg_c15_probe__std_columns: enabled=R'],
      'ENABLE ALWAYS TRIGGER': ['c15_probe.trg_c15_probe__std_columns: enabled=A'],
      'DISABLE TRIGGER': ['c15_probe.trg_c15_probe__std_columns: enabled=D'],
    });
  }, 60_000);

  it('[SEC-TC-74] PR43-SEC-05 (c): an enabled BEFORE INSERT/UPDATE ROW trigger sorting after the guard (byte order) is named; one sorting before, an AFTER trigger and a disabled one are not', async () => {
    const result = await rolledBack(async (client) => {
      await plantGuard(client);
      const clean = await rows(client, AFTER_GUARD_SQL);
      await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
      await client.query(`
        CREATE FUNCTION public.c15_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER trg_c15_probe__aa BEFORE INSERT ON public.c15_probe FOR EACH ROW EXECUTE FUNCTION public.c15_noop();
        CREATE TRIGGER trg_c15_probe__zz_after AFTER UPDATE ON public.c15_probe FOR EACH ROW EXECUTE FUNCTION public.c15_noop();
        CREATE TRIGGER trg_c15_probe__zz_off BEFORE UPDATE ON public.c15_probe FOR EACH ROW EXECUTE FUNCTION public.c15_noop();
        ALTER TABLE public.c15_probe DISABLE TRIGGER trg_c15_probe__zz_off;
        CREATE TRIGGER trg_c15_probe__zz BEFORE UPDATE ON public.c15_probe FOR EACH ROW EXECUTE FUNCTION public.c15_noop();
        CREATE TRIGGER "trg_c15_probe__std_columnsZ" BEFORE INSERT ON public.c15_probe FOR EACH ROW EXECUTE FUNCTION public.c15_noop();`);
      await client.query('RESET ROLE');
      return { clean, planted: await rows(client, AFTER_GUARD_SQL) };
    });
    expect(result.clean).toEqual([]);
    expect(result.planted).toEqual([{ trigger: 'c15_probe.trg_c15_probe__std_columnsZ' }, { trigger: 'c15_probe.trg_c15_probe__zz' }]);
  }, 60_000);

  it('[SEC-TC-74] C15 (b): the function is owned by platform_migrator, plpgsql, not SECURITY DEFINER, proconfig {search_path=pg_catalog, pg_temp}, the body neither reads nor writes a setting', async () => {
    const fn = await rolledBack(async (client) => {
      await plantGuard(client);
      return (await rows<{ prosrc: string }>(client, FUNCTION_SQL)).map(({ prosrc, ...rest }) => ({
        ...rest,
        settings: SETTINGS_CALL.test(prosrc),
      }));
    });
    expect(fn).toEqual([
      { owner: MIGRATOR, prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'], lanname: 'plpgsql', settings: false },
    ]);
  }, 60_000);

  it('[SEC-TC-74] C15 (c): no other trigger function assigns NEW.id/created_at/created_by/updated_by/version; a planted assigner is named', async () => {
    const client = await db.superuser(database);
    try {
      expect(await rows(client, ASSIGNERS_SQL)).toEqual([]);
    } finally {
      await client.end();
    }
    const planted = await rolledBack(async (client) => {
      await plantGuard(client);
      await client.query(
        `CREATE FUNCTION public.c15_stamper() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.version := 1; RETURN NEW; END $$`,
      );
      return rows(client, ASSIGNERS_SQL);
    });
    expect(planted).toEqual([{ fn: 'public.c15_stamper()' }]);
  }, 60_000);

  it.each([
    [
      'INSERT forged created_by',
      'INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES (gen_random_uuid(), $2, $1)',
      [ACTOR, OTHER],
      violation('created_by', 'INSERT'),
    ],
    [
      'INSERT forged updated_by',
      'INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES (gen_random_uuid(), $1, $2)',
      [ACTOR, OTHER],
      violation('updated_by', 'INSERT'),
    ],
    [
      'INSERT forged version',
      'INSERT INTO public.c15_probe (id, created_by, updated_by, version) VALUES (gen_random_uuid(), $1, $1, 7)',
      [ACTOR],
      violation('version', 'INSERT'),
    ],
    [
      'UPDATE version unchanged',
      "UPDATE public.c15_probe SET note = 'x', updated_by = $1 WHERE id = $2",
      [ACTOR, ROW],
      violation('version', 'UPDATE'),
    ],
    [
      'UPDATE version + 2',
      'UPDATE public.c15_probe SET updated_by = $1, version = version + 2 WHERE id = $2',
      [ACTOR, ROW],
      violation('version', 'UPDATE'),
    ],
    [
      'UPDATE forged updated_by',
      'UPDATE public.c15_probe SET updated_by = $1, version = version + 1 WHERE id = $2',
      [OTHER, ROW],
      violation('updated_by', 'UPDATE'),
    ],
    [
      'UPDATE changed created_by',
      'UPDATE public.c15_probe SET created_by = $1, updated_by = $1, version = version + 1 WHERE id = $2',
      [ACTOR, ROW],
      violation('created_by', 'UPDATE'),
    ],
    [
      'UPDATE changed id',
      'UPDATE public.c15_probe SET id = gen_random_uuid(), updated_by = $1, version = version + 1 WHERE id = $2',
      [ACTOR, ROW],
      violation('id', 'UPDATE'),
    ],
    [
      'UPDATE changed created_at',
      "UPDATE public.c15_probe SET created_at = created_at - interval '1 day', updated_by = $1, version = version + 1 WHERE id = $2",
      [ACTOR, ROW],
      violation('created_at', 'UPDATE'),
    ],
  ] as const)(
    '[SEC-TC-74] C15 (d) forgery matrix as platform_app: %s raises STD_COLUMNS_VIOLATION naming column and table, never a value',
    async (_label, sql, params, expected) => {
      const result = await rolledBack(async (client) => {
        await plantGuard(client);
        await asApp(client, ACTOR);
        return outcome(client, sql, [...params]);
      });
      expect(result).toBe(expected);
      expect(result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    },
    60_000,
  );

  it('[SEC-TC-74] C15 (d) positive controls: a correct raw INSERT and UPDATE, the ANONYMOUS and SYSTEM contexts, ON CONFLICT DO UPDATE, the migrator exemption', async () => {
    const results = await rolledBack(async (client) => {
      await plantGuard(client);
      await asApp(client, ACTOR);
      const insert = await outcome(client, 'INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES (gen_random_uuid(), $1, $1)', [
        ACTOR,
      ]);
      const update = await outcome(client, 'UPDATE public.c15_probe SET note = $2, updated_by = $1, version = version + 1 WHERE id = $3', [
        ACTOR,
        'ok',
        ROW,
      ]);
      const upsert = await outcome(
        client,
        `INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES ($2, $1, $1)
           ON CONFLICT (id) DO UPDATE SET note = 'merged', updated_by = $1, version = c15_probe.version + 1`,
        [ACTOR, ROW],
      );
      await client.query('RESET ROLE');
      await asApp(client, '');
      const anonymous = await outcome(
        client,
        'INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES (gen_random_uuid(), $1, $1)',
        [ANONYMOUS],
      );
      const anonymousForged = await outcome(
        client,
        'INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES (gen_random_uuid(), $1, $1)',
        [ACTOR],
      );
      await client.query('RESET ROLE');
      await asApp(client, SYSTEM);
      const system = await outcome(client, 'INSERT INTO public.c15_probe (id, created_by, updated_by) VALUES (gen_random_uuid(), $1, $1)', [
        SYSTEM,
      ]);
      await client.query('RESET ROLE');
      await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
      const migrator = await outcome(client, 'UPDATE public.c15_probe SET created_by = $1, version = 99 WHERE id = $2', [ACTOR, ROW]);
      return { insert, update, upsert, anonymous, anonymousForged, system, migrator };
    });
    expect(results).toEqual({
      insert: 'ok',
      update: 'ok',
      upsert: 'ok',
      anonymous: 'ok',
      anonymousForged: violation('created_by', 'INSERT'),
      system: 'ok',
      migrator: 'ok',
    });
  }, 60_000);

  it('C15 cost (recorded, not asserted; D-ARCH-091 (3)): 10 000-row INSERT and UPDATE as platform_app with and without the guard on PostgreSQL 18', async () => {
    const N = 10_000;
    const measure = async (client: pg.Client, sql: string, params: unknown[]): Promise<number> => {
      let best = Number.POSITIVE_INFINITY;
      for (let round = 0; round < 3; round += 1) {
        await client.query('SAVEPOINT cost');
        const start = performance.now();
        await client.query(sql, params);
        best = Math.min(best, performance.now() - start);
        await client.query('ROLLBACK TO SAVEPOINT cost');
      }
      return best;
    };
    const report = await rolledBack(async (client) => {
      await plantGuard(client, true, 'c15_cost_guarded');
      await plantGuard(client, false, 'c15_cost_plain');
      await asApp(client, ACTOR);
      const result: Record<string, number> = {};
      for (const table of ['c15_cost_guarded', 'c15_cost_plain']) {
        result[`${table}_insert_ms`] = await measure(
          client,
          `INSERT INTO public.${table} (id, created_by, updated_by) SELECT gen_random_uuid(), $1, $1 FROM generate_series(1, ${String(N)})`,
          [ACTOR],
        );
        await client.query(
          `INSERT INTO public.${table} (id, created_by, updated_by) SELECT gen_random_uuid(), $1, $1 FROM generate_series(1, ${String(N)})`,
          [ACTOR],
        );
        result[`${table}_update_ms`] = await measure(
          client,
          `UPDATE public.${table} SET updated_by = $1, version = version + 1 WHERE created_by = $1`,
          [ACTOR],
        );
      }
      return result;
    });
    const perRowUs = (guarded: number, plain: number): number => Math.round(((guarded - plain) * 1000 * 100) / N) / 100;
    const summary = {
      rows: N,
      ...report,
      insert_overhead_us_per_row: perRowUs(report['c15_cost_guarded_insert_ms'] ?? 0, report['c15_cost_plain_insert_ms'] ?? 0),
      update_overhead_us_per_row: perRowUs(report['c15_cost_guarded_update_ms'] ?? 0, report['c15_cost_plain_update_ms'] ?? 0),
      reopen_threshold_us_per_row: 25,
    };
    const dir = join(findRepoRoot(), 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'std-columns-guard-cost.json'), `${JSON.stringify(summary, null, 2)}\n`);
    expect(Object.values(report).every((ms) => Number.isFinite(ms) && ms > 0)).toBe(true);
  }, 120_000);
});
