/**
 * SPK-08 (TASK-012; ADR-0007 amendments 7 and 8; data-model.md §4.4 amendments, §4.6 C13/C14, §5.1-§5.3 amendments,
 * §7.3; batch-0.2 rulings): audit ownership separation on PostgreSQL 18.
 *
 * Throwaway spike code. The audit prototype (prisma/tests/spikes/spk08/10-audit.sql, 90-audit-ddl-guard.sql) is applied
 * by the test superuser after the real bootstrap lane (prisma/bootstrap/*.sql); it is never a bootstrap or migration
 * file (the real audit DDL is TASK-021's). Every tamper attempt runs inside a transaction that is rolled back.
 * The record of results is docs/04-plan/spikes/SPK-08.md. Set `SPK08_REPORT=<file>` to write the observed outcomes.
 *
 * Databases: `spk08_audit` (bootstrap + audit prototype + guard, then `migrate deploy`; exit checks 1, 2, 3a and the
 * `migrate dev` target of 4), `spk08_ddl` (bootstrap + prototype + guard; the Prisma-style DDL set of 3b) and
 * `spk08_shadow` (an empty database owned by the migrator; the shadow database of 4).
 *
 * Only the pre-audit part of the bootstrap lane (`0N-*.sql`) is applied, so TASK-021's real `10-audit.sql` / `90-*.sql`
 * never meet the prototype in one database. Lifecycle (SPK-08 §8): TASK-021's PR ports these assertions and deletes this
 * file together with `spk08/{10-audit.sql, 90-audit-ddl-guard.sql, prisma.config.ts}`.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { normalise, quoteLiteral, splitStatements } from '../../../tools/db/sql-text.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import { findRepoRoot, runNode, type RunResult } from '../../../tools/test-support/process.js';
import { MIGRATOR, PlatformPostgres } from '../harness/postgres.js';

const repoRoot = findRepoRoot();
const spikeDir = join(repoRoot, 'prisma', 'tests', 'spikes', 'spk08');
const prismaCli = join(repoRoot, 'tools', 'deps', 'prisma-cli.mjs');
const FIXTURE_CONFIG = join(spikeDir, 'prisma.config.ts');
const AUDIT_SQL = readFileSync(join(spikeDir, '10-audit.sql'), 'utf8');
const GUARD_SQL = readFileSync(join(spikeDir, '90-audit-ddl-guard.sql'), 'utf8');
const BOOTSTRAP_DIR = join(repoRoot, 'prisma', 'bootstrap');
const SCHEMAS_SQL = readFileSync(join(BOOTSTRAP_DIR, '01-schemas.sql'), 'utf8');

const AUDIT_DB = 'spk08_audit';
const DDL_DB = 'spk08_ddl';
const SHADOW_DB = 'spk08_shadow';
const GUARD_MESSAGE = 'audit objects are immutable (SEC-P3-03)';
const PRIVILEGE_MESSAGE = /^(must be owner of |permission denied )/;
const PINNED_PATH = 'search_path=pg_catalog, pg_temp';
const EXTERNAL_TABLES = 'public.bootstrap_migrations,public.audit_entries,public.audit_partitions';
const PARTIAL_INDEX = 'ix_roles__key_system';

type Refusal = 'privilege' | 'guard' | 'other';

interface Outcome {
  ok: boolean;
  code?: string;
  message?: string;
  detail?: string;
  refusedBy?: Refusal;
}

const report: Record<string, unknown> = {};
let pgh: PlatformPostgres | undefined;
let workDir: string | undefined;

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
};
const cluster = (): PlatformPostgres => must(pgh, 'PostgreSQL container');
const work = (): string => must(workDir, 'work directory');

/** A copy of the bootstrap lane without the audit files: only `0N-*.sql` (the audit lane starts at `10-`). */
function preAuditBootstrapDir(target: string): string {
  mkdirSync(target);
  for (const name of readdirSync(BOOTSTRAP_DIR)) {
    if (/^0\d-[a-z0-9-]+\.sql$/.test(name)) cpSync(join(BOOTSTRAP_DIR, name), join(target, name));
  }
  return target;
}

/** `audit_entries_YYYY_MM` of the UTC month `offset` months from now. */
function partitionName(offset: number, now = new Date()): string {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `audit_entries_${String(month.getUTCFullYear())}_${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
}

const classify = (message: string): Refusal =>
  message === GUARD_MESSAGE ? 'guard' : PRIVILEGE_MESSAGE.test(message) ? 'privilege' : 'other';

function toOutcome(error: unknown): Outcome {
  const e = error as { code?: unknown; message?: unknown; detail?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  return {
    ok: false,
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    message,
    ...(typeof e.detail === 'string' ? { detail: e.detail } : {}),
    refusedBy: classify(message),
  };
}

/** Runs `sql` in a transaction that is always rolled back; returns the outcome instead of throwing. */
async function attempt(client: pg.Client, sql: string): Promise<Outcome> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    return { ok: true };
  } catch (error) {
    return toOutcome(error);
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Runs `sql` outside any explicit transaction (needed for CREATE INDEX CONCURRENTLY). */
async function execute(client: pg.Client, sql: string): Promise<Outcome> {
  try {
    await client.query(sql);
    return { ok: true };
  } catch (error) {
    return toOutcome(error);
  }
}

/** `sql` as a DO block whose EXECUTE string is concatenated at run time, so the statement text never appears whole. */
function dynamic(sql: string): string {
  const at = sql.indexOf('audit_');
  const cut = at >= 0 ? at + 'audit_'.length : sql.indexOf('public') + 'pub'.length;
  return `DO $spk08$ BEGIN EXECUTE ${quoteLiteral(sql.slice(0, cut))} || ${quoteLiteral(sql.slice(cut))}; END $spk08$`;
}

async function withClient<T>(config: pg.ClientConfig | Promise<pg.Client>, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = config instanceof Promise ? await config : new pg.Client(config);
  if (!(config instanceof Promise)) await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const asSuperuser = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(cluster().superuser(db), fn);
const asMigrator = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(cluster().migratorConnection(db), fn);
const asApp = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(cluster().appConnection(db), fn);

async function applyAsSuperuser(db: string, sql: string): Promise<void> {
  await asSuperuser(db, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** The Prisma CLI with the SPK-08 fixture config (same wrapper and lock as the harness). */
function prismaSpike(args: readonly string[], env: Readonly<Record<string, string>>): Promise<RunResult> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv['SHADOW_DATABASE_URL'];
  return withFileLock(PRISMA_TREE_LOCK, () =>
    runNode([prismaCli, ...args, '--config', FIXTURE_CONFIG], { cwd: repoRoot, env: childEnv, timeoutMs: 180_000 }),
  );
}

const tail = (result: RunResult): string => `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-30).join('\n');

/** Top-level statements of a script, comments removed, whitespace collapsed and lower-cased. */
const statementsOf = (sql: string): string[] => splitStatements(sql).map(normalise);

/**
 * Migrator-runnable rendering of the bootstrap lane for `migrations.initShadowDb` (data-model §7.3 as amended by
 * SEC-P3-27 item 6 and batch 0.2): no roles, no SET ROLE, no OWNER TO / AUTHORIZATION, no event triggers; grants and
 * default privileges are dropped as well (privileges are not diffed); the search-path lines and the three
 * CREATE EXTENSION IF NOT EXISTS lines are kept. 00-roles.sql (roles, database level) and 90-* (event triggers) are
 * not rendered at all. Prisma resets only the datasource schema (`public`) of the shadow database before each run, so
 * a schema the lane creates (`platform`) would keep the previous run's objects: each `CREATE SCHEMA IF NOT EXISTS x` is
 * therefore preceded by `DROP SCHEMA IF EXISTS x CASCADE` (the migrator owns both the shadow database and `x` there).
 * `dropSchemas: false` renders without those DROP lines (the F-02 negative control).
 */
function renderShadowInit(
  files: readonly string[],
  { dropSchemas = true }: { dropSchemas?: boolean } = {},
): { sql: string; kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const drop = /^(set role|reset role|alter default privileges|grant |revoke |create event trigger|drop event trigger)/;
  for (const file of files) {
    for (const statement of splitStatements(file)) {
      const text = normalise(statement);
      if (drop.test(text) || text.includes(' owner to ')) {
        dropped.push(text.slice(0, 80));
      } else if (text.startsWith('create schema if not exists ')) {
        const name = text.split(' ')[5] ?? '';
        if (dropSchemas) kept.push(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
        kept.push(statement.replace(/\s+AUTHORIZATION\s+\S+/i, ''));
      } else {
        kept.push(statement);
      }
    }
  }
  return { sql: `${kept.join(';\n')};\n`, kept: kept.map((s) => normalise(s).slice(0, 80)), dropped };
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'spk08-'));
  const bootstrapDir = preAuditBootstrapDir(join(workDir, 'bootstrap'));
  report['bootstrap_files'] = readdirSync(bootstrapDir).sort();
  const started = await PlatformPostgres.start();
  pgh = started;
  for (const name of [AUDIT_DB, DDL_DB]) {
    await started.createDatabase(name);
    await started.bootstrap(name, bootstrapDir);
    await applyAsSuperuser(name, AUDIT_SQL);
    await applyAsSuperuser(name, GUARD_SQL);
  }
  await asSuperuser('postgres', async (admin) => {
    await admin.query(`CREATE DATABASE ${SHADOW_DB} OWNER ${MIGRATOR}`);
    report['server_version'] = (await admin.query<{ v: string }>(`SELECT pg_catalog.current_setting('server_version') AS v`)).rows[0]?.v;
  });
}, 300_000);

afterAll(async () => {
  const out = process.env['SPK08_REPORT'];
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  try {
    await pgh?.stop();
  } finally {
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
  }
}, 120_000);

async function currentPartition(db: string): Promise<string> {
  return asSuperuser(db, async (client) => {
    const { rows } = await client.query<{ name: string }>(
      'SELECT partition_name AS name FROM public.audit_partitions ORDER BY range_start LIMIT 1',
    );
    const name = rows[0]?.name;
    if (!name) throw new Error('no audit partition');
    return name;
  });
}

describe('SPK-08 exit 1: SEC-TC-43 prototype (ownership separation and the identity-based guard)', () => {
  it('SEC-TC-43 (prototype) roles, owners, FORCE RLS, triggers, pinned search paths and both event triggers are as specified', async () => {
    await asSuperuser(AUDIT_DB, async (client) => {
      const roles = await client.query<{ rolname: string; rolcanlogin: boolean; rolinherit: boolean }>(
        `SELECT rolname, rolcanlogin, rolinherit FROM pg_catalog.pg_roles
          WHERE rolname IN ('platform_audit_owner', 'platform_schema_owner') ORDER BY rolname`,
      );
      expect(roles.rows).toEqual([
        { rolname: 'platform_audit_owner', rolcanlogin: false, rolinherit: false },
        { rolname: 'platform_schema_owner', rolcanlogin: false, rolinherit: false },
      ]);
      const members = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM pg_catalog.pg_auth_members m
          WHERE m.roleid IN ('platform_audit_owner'::regrole, 'platform_schema_owner'::regrole)
             OR m.member IN ('platform_audit_owner'::regrole, 'platform_schema_owner'::regrole)`,
      );
      expect(members.rows[0]?.n).toBe('0');
      const schemas = await client.query<{ nspname: string; owner: string }>(
        `SELECT nspname, pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace
          WHERE nspname IN ('public', 'platform') ORDER BY nspname`,
      );
      expect(schemas.rows).toEqual([
        { nspname: 'platform', owner: 'platform_schema_owner' },
        { nspname: 'public', owner: 'platform_schema_owner' },
      ]);
      const rels = await client.query<{ relname: string; owner: string; relkind: string; rls: boolean; force: boolean }>(
        `SELECT relname, pg_catalog.pg_get_userbyid(relowner) AS owner, relkind::text AS relkind,
                relrowsecurity AS rls, relforcerowsecurity AS force
           FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'audit\\_%' AND relkind IN ('r', 'p')
          ORDER BY relname`,
      );
      expect(rels.rows.every((r) => r.owner === 'platform_audit_owner')).toBe(true);
      // prototype only: data-model §3 classifies audit_entries as SYSTEM (no RLS); TASK-021/033 must not port this (PR12-SEC-08)
      expect(rels.rows.find((r) => r.relname === 'audit_entries')).toMatchObject({ relkind: 'p', rls: true, force: true });
      expect(rels.rows.filter((r) => /^audit_entries_\d{4}_\d{2}$/.test(r.relname))).toHaveLength(1);
      const fns = await client.query<{ proname: string; owner: string; prosecdef: boolean; proconfig: string[] | null }>(
        `SELECT proname, pg_catalog.pg_get_userbyid(proowner) AS owner, prosecdef, proconfig FROM pg_catalog.pg_proc
          WHERE pronamespace = 'platform'::regnamespace
            AND proname IN ('audit_forbid_mutation', 'ensure_audit_partitions', 'audit_ddl_guard') ORDER BY proname`,
      );
      expect(fns.rows).toEqual([
        { proname: 'audit_ddl_guard', owner: 'postgres', prosecdef: false, proconfig: [PINNED_PATH] },
        { proname: 'audit_forbid_mutation', owner: 'platform_audit_owner', prosecdef: false, proconfig: [PINNED_PATH] },
        {
          proname: 'ensure_audit_partitions',
          owner: 'platform_audit_owner',
          prosecdef: true,
          proconfig: [PINNED_PATH, 'TimeZone=UTC', 'lock_timeout=5s'],
        },
      ]);
      const evt = await client.query<{ evtname: string; evtevent: string; evtenabled: string; fn: string }>(
        `SELECT evtname, evtevent, evtenabled::text AS evtenabled, evtfoid::regproc::text AS fn
           FROM pg_catalog.pg_event_trigger ORDER BY evtname`,
      );
      expect(evt.rows).toEqual([
        { evtname: 'platform_audit_ddl_guard_drop', evtevent: 'sql_drop', evtenabled: 'O', fn: 'platform.audit_ddl_guard' },
        { evtname: 'platform_audit_ddl_guard_end', evtevent: 'ddl_command_end', evtenabled: 'O', fn: 'platform.audit_ddl_guard' },
      ]);
      const triggers = await client.query<{ rel: string; tgname: string; cloned: boolean }>(
        `SELECT c.relname AS rel, t.tgname, t.tgparentid <> 0 AS cloned
           FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname LIKE 'audit\\_entries%' ORDER BY c.relname COLLATE "C", t.tgname COLLATE "C"`,
      );
      const partition = await currentPartition(AUDIT_DB);
      expect(triggers.rows).toEqual([
        { rel: 'audit_entries', tgname: 'trg_audit_entries__no_truncate', cloned: false },
        { rel: 'audit_entries', tgname: 'trg_audit_entries__no_update_delete', cloned: false },
        { rel: partition, tgname: `trg_${partition}__no_truncate`, cloned: false },
        { rel: partition, tgname: 'trg_audit_entries__no_update_delete', cloned: true },
      ]);
    });
  });

  it('SEC-TC-43 every tamper statement fails for platform_migrator with 42501, directly and through DO $$ EXECUTE $$', async () => {
    const partition = await currentPartition(AUDIT_DB);
    const statements: Record<string, string> = {
      disable_trigger_all: 'ALTER TABLE public.audit_entries DISABLE TRIGGER ALL',
      no_force_rls: 'ALTER TABLE public.audit_entries NO FORCE ROW LEVEL SECURITY',
      disable_rls: 'ALTER TABLE public.audit_entries DISABLE ROW LEVEL SECURITY',
      drop_trigger: 'DROP TRIGGER trg_audit_entries__no_update_delete ON public.audit_entries',
      detach_partition: `ALTER TABLE public.audit_entries DETACH PARTITION public.${partition}`,
      drop_table: 'DROP TABLE public.audit_entries',
      drop_schema_public_cascade: 'DROP SCHEMA public CASCADE',
      drop_partition: `DROP TABLE public.${partition}`,
      partition_disable_trigger: `ALTER TABLE public.${partition} DISABLE TRIGGER ALL`,
      drop_policy: 'DROP POLICY p_audit_entries__app_select ON public.audit_entries',
      grant_update: 'GRANT UPDATE, DELETE ON public.audit_entries TO platform_app',
      truncate: 'TRUNCATE public.audit_entries',
      replace_forbid_mutation:
        'CREATE OR REPLACE FUNCTION platform.audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$',
      replace_ensure_partitions:
        'CREATE OR REPLACE FUNCTION platform.ensure_audit_partitions(p_months_ahead integer DEFAULT 3) RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$',
    };
    const outcomes: Record<string, { direct: Outcome; dynamic: Outcome }> = {};
    await asMigrator(AUDIT_DB, async (client) => {
      for (const [id, sql] of Object.entries(statements)) {
        outcomes[id] = { direct: await attempt(client, sql), dynamic: await attempt(client, dynamic(sql)) };
      }
    });
    report['sec_tc_43_tamper'] = outcomes;
    for (const [id, { direct, dynamic: viaDo }] of Object.entries(outcomes)) {
      expect({ id, ok: direct.ok, code: direct.code }).toEqual({ id, ok: false, code: '42501' });
      expect({ id, ok: viaDo.ok, code: viaDo.code }).toEqual({ id, ok: false, code: '42501' });
      expect({ id, same: viaDo.message === direct.message }).toEqual({ id, same: true });
      expect({ id, refusedBy: direct.refusedBy }).toEqual({ id, refusedBy: 'privilege' });
    }
  });

  it('SEC-TC-43 where privilege admits the migrator, the identity guard refuses (planted audit names), directly and dynamically', async () => {
    const statements: Record<string, string> = {
      audit_named_table: 'CREATE TABLE public.audit_spk08_planted (id integer)',
      partition_named_table: 'CREATE TABLE public.audit_entries_2099_01 (id integer)',
      ensure_overload_bigint: 'CREATE FUNCTION platform.ensure_audit_partitions(bigint) RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$',
      forbid_mutation_in_public:
        'CREATE FUNCTION public.audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$',
    };
    const outcomes: Record<string, { direct: Outcome; dynamic: Outcome }> = {};
    let control: Outcome = { ok: false };
    await asMigrator(AUDIT_DB, async (client) => {
      for (const [id, sql] of Object.entries(statements)) {
        outcomes[id] = { direct: await attempt(client, sql), dynamic: await attempt(client, dynamic(sql)) };
      }
      control = await attempt(client, 'CREATE TABLE public.spk08_control (id integer)');
    });
    report['sec_tc_43_guard'] = { outcomes, control };
    expect(control).toEqual({ ok: true });
    for (const [id, { direct, dynamic: viaDo }] of Object.entries(outcomes)) {
      expect({ id, code: direct.code, refusedBy: direct.refusedBy }).toEqual({ id, code: '42501', refusedBy: 'guard' });
      expect({ id, code: viaDo.code, refusedBy: viaDo.refusedBy }).toEqual({ id, code: '42501', refusedBy: 'guard' });
    }
  });

  it('SEC-TC-43 / R-ARCH-18 the sql_drop guard refuses a schema-owner and a superuser DROP of audit objects, and a migrator DROP of an audit-named index (F-08)', async () => {
    const partition = await currentPartition(AUDIT_DB);
    // platform_schema_owner owns `public`, so privilege admits its DROP of any relation there; only the guard stops it
    const asSchemaOwner = (sql: string): string => `SET LOCAL ROLE platform_schema_owner; ${sql}`;
    const owner = await asSuperuser(AUDIT_DB, async (client) => ({
      schema_owner_drop_partition: await attempt(client, asSchemaOwner(`DROP TABLE public.${partition}`)),
      schema_owner_drop_table: await attempt(client, asSchemaOwner('DROP TABLE public.audit_entries')),
      schema_owner_drop_index: await attempt(client, asSchemaOwner('DROP INDEX public.ix_audit__stream_seq')),
      superuser_drop_table: await attempt(client, 'DROP TABLE public.audit_entries'),
    }));
    // F-08 and PR12-SEC-02 (a)/(c): an index on the migrator's own table may take a partition name (the guard maps an
    // index to its table at ddl_command_end), but dropping it again is refused by name at sql_drop
    const squat = 'audit_entries_2099_02';
    const migrator = await asMigrator(AUDIT_DB, async (client) => {
      await client.query('BEGIN');
      try {
        const table = await execute(client, 'CREATE TABLE public.spk08_t (id integer)');
        const create = await execute(client, `CREATE INDEX ${squat} ON public.spk08_t (id)`);
        const drop = await execute(client, `DROP INDEX public.${squat}`);
        return { table, create, drop };
      } finally {
        await client.query('ROLLBACK');
      }
    });
    report['sql_drop_guard'] = { owner, migrator };
    const guard = (detail: string | RegExp): unknown =>
      expect.objectContaining({
        code: '42501',
        refusedBy: 'guard',
        detail: typeof detail === 'string' ? detail : expect.stringMatching(detail),
      });
    expect(owner).toEqual({
      schema_owner_drop_partition: guard(`DROP of table public.${partition} by platform_schema_owner`),
      schema_owner_drop_table: guard(/^DROP of .+ by platform_schema_owner$/),
      schema_owner_drop_index: guard('DROP of index public.ix_audit__stream_seq by platform_schema_owner'),
      superuser_drop_table: guard(/^DROP of .+ by postgres$/),
    });
    expect(migrator).toEqual({
      table: { ok: true },
      create: { ok: true },
      drop: guard(`DROP of index public.${squat} by platform_migrator`),
    });
  });

  it('SEC-TC-43 SELECT platform.ensure_audit_partitions(3) as platform_app succeeds; the new partitions belong to the audit owner and stay immutable', async () => {
    const before = new Set(
      await asSuperuser(AUDIT_DB, async (client) =>
        (
          await client.query<{ relname: string }>(
            `SELECT c.relname FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
              WHERE i.inhparent = 'public.audit_entries'::regclass`,
          )
        ).rows.map((r) => r.relname),
      ),
    );
    const wanted = [0, 1, 2, 3].map((offset) => partitionName(offset));
    const created = await asApp(AUDIT_DB, async (client) => {
      const result = await client.query<{ n: number }>('SELECT platform.ensure_audit_partitions(3) AS n');
      await client.query(
        `INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, actor_type, job_name, source_app,
                                           correlation_id, action, entity_name, outcome, prev_hash, entry_hash)
         VALUES (gen_random_uuid(), now(), gen_random_uuid(), 1, 'SYSTEM_JOB', 'spk08', 'worker', 'spk08-0001', 'CREATE',
                 'spk08', 'SUCCESS', decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'))`,
      );
      return result.rows[0]?.n;
    });
    // derived from the clock, so a UTC month boundary between beforeAll and this test does not matter (n1)
    expect(created).toBe(wanted.filter((name) => !before.has(name)).length);
    expect(created).toBeGreaterThan(0);
    await asSuperuser(AUDIT_DB, async (client) => {
      const parts = await client.query<{ relname: string; owner: string; truncate_trigger: boolean }>(
        `SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                EXISTS (SELECT FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'trg_' || c.relname || '__no_truncate') AS truncate_trigger
           FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'public.audit_entries'::regclass ORDER BY 1`,
      );
      const names = parts.rows.map((p) => p.relname);
      expect(names).toEqual(expect.arrayContaining(wanted));
      expect(names).toHaveLength(before.size + (created ?? 0));
      expect(parts.rows.every((p) => p.owner === 'platform_audit_owner' && p.truncate_trigger)).toBe(true);
      // the row trigger fires even for the superuser, who bypasses privileges and RLS; it names the partition (F-07)
      const update = await attempt(client, `UPDATE public.audit_entries SET details = '{}'::jsonb`);
      expect(update).toMatchObject({ ok: false, code: '42501' });
      expect(update.message).toMatch(/^AUDIT_IMMUTABLE: UPDATE on audit_entries_\d{4}_\d{2} is not permitted$/);
      report['sec_tc_43_ensure'] = { created, partitions: parts.rows, superuserUpdate: update };
    });
  });

  it('C14 (b) prototype: the guard refuses ALTER SCHEMA public|platform RENAME even for the superuser (OID match)', async () => {
    const outcomes = await asSuperuser(AUDIT_DB, async (client) => ({
      public: await attempt(client, 'ALTER SCHEMA public RENAME TO c14_x'),
      platform: await attempt(client, 'ALTER SCHEMA platform RENAME TO c14_y'),
    }));
    report['c14_b'] = outcomes;
    expect(outcomes.public).toMatchObject({ ok: false, code: '42501', refusedBy: 'guard' });
    expect(outcomes.platform).toMatchObject({ ok: false, code: '42501', refusedBy: 'guard' });
  });
});

describe('SPK-08 exit 2: SEC-TC-61 subset', () => {
  it('SEC-TC-61 DROP FUNCTION platform.audit_ddl_guard() CASCADE, DROP SCHEMA platform CASCADE and schema renames fail by privilege for platform_migrator', async () => {
    const statements: Record<string, string> = {
      drop_guard_cascade: 'DROP FUNCTION platform.audit_ddl_guard() CASCADE',
      drop_schema_platform_cascade: 'DROP SCHEMA platform CASCADE',
      rename_public: 'ALTER SCHEMA public RENAME TO x',
      rename_platform: 'ALTER SCHEMA platform RENAME TO y',
      owner_public: 'ALTER SCHEMA public OWNER TO platform_migrator',
      drop_event_trigger: 'DROP EVENT TRIGGER platform_audit_ddl_guard_end',
      disable_event_trigger: 'ALTER EVENT TRIGGER platform_audit_ddl_guard_drop DISABLE',
    };
    const outcomes: Record<string, Outcome> = {};
    await asMigrator(AUDIT_DB, async (client) => {
      for (const [id, sql] of Object.entries(statements)) outcomes[id] = await attempt(client, sql);
      outcomes['set_event_triggers_off'] = await attempt(client, 'SET event_triggers = off');
      outcomes['set_session_replication_role'] = await attempt(client, 'SET session_replication_role = replica');
    });
    report['sec_tc_61_privilege'] = outcomes;
    for (const [id, outcome] of Object.entries(outcomes)) {
      expect({ id, ok: outcome.ok, code: outcome.code, refusedBy: outcome.refusedBy }).toEqual({
        id,
        ok: false,
        code: '42501',
        refusedBy: 'privilege',
      });
    }
  });

  it('SEC-TC-61 planted public.pg_advisory_xact_lock(integer) and public.to_char(date, text) are never called by ensure_audit_partitions', async () => {
    try {
      await asMigrator(AUDIT_DB, async (client) => {
        await client.query(`CREATE TABLE platform.spk08_hijack_marker (fn text NOT NULL, by_user text NOT NULL DEFAULT current_user)`);
        await client.query('GRANT INSERT ON platform.spk08_hijack_marker TO PUBLIC');
        await client.query(`CREATE FUNCTION public.pg_advisory_xact_lock(integer) RETURNS void LANGUAGE sql
                              AS $f$ INSERT INTO platform.spk08_hijack_marker (fn) VALUES ('pg_advisory_xact_lock') $f$`);
        await client.query(`CREATE FUNCTION public.to_char(date, text) RETURNS text LANGUAGE sql
                              AS $f$ INSERT INTO platform.spk08_hijack_marker (fn) VALUES ('to_char'); SELECT 'hijacked'::text $f$`);
        await client.query('GRANT EXECUTE ON FUNCTION public.pg_advisory_xact_lock(integer), public.to_char(date, text) TO PUBLIC');
        // positive control: an unqualified call with an ordinary path resolves to the planted overloads
        await client.query('BEGIN');
        try {
          await client.query(`SELECT to_char(current_date, 'YYYY'), pg_advisory_xact_lock(1)`);
          const control = await client.query<{ fn: string }>('SELECT fn FROM platform.spk08_hijack_marker ORDER BY fn');
          report['sec_tc_61_hijack_control'] = control.rows;
          expect(control.rows.map((r) => r.fn)).toEqual(['pg_advisory_xact_lock', 'to_char']);
        } finally {
          await client.query('ROLLBACK');
        }
      });
      const before = await asSuperuser(AUDIT_DB, async (client) =>
        Number((await client.query<{ n: string }>('SELECT count(*) AS n FROM public.audit_partitions')).rows[0]?.n),
      );
      const created = await asApp(
        AUDIT_DB,
        async (client) => (await client.query<{ n: number }>('SELECT platform.ensure_audit_partitions(6) AS n')).rows[0]?.n,
      );
      expect(created).toBe(7 - before);
      expect(created).toBeGreaterThan(0);
      await asSuperuser(AUDIT_DB, async (client) => {
        const markers = await client.query<{ n: string }>('SELECT count(*) AS n FROM platform.spk08_hijack_marker');
        const disabled = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relname LIKE 'audit\\_%' AND t.tgenabled <> 'O'`,
        );
        const evt = await client.query<{ n: string }>(`SELECT count(*) AS n FROM pg_catalog.pg_event_trigger WHERE evtenabled = 'O'`);
        report['sec_tc_61_hijack'] = { before, created, markers: markers.rows[0]?.n, disabledTriggers: disabled.rows[0]?.n };
        expect(markers.rows[0]?.n).toBe('0');
        expect(disabled.rows[0]?.n).toBe('0');
        expect(evt.rows[0]?.n).toBe('2');
      });
    } finally {
      // the plants must not survive into the exit-3/4 tests, whatever failed above (n2)
      await asMigrator(AUDIT_DB, async (client) => {
        await client.query('DROP FUNCTION IF EXISTS public.pg_advisory_xact_lock(integer), public.to_char(date, text)');
        await client.query('DROP TABLE IF EXISTS platform.spk08_hijack_marker');
      });
    }
  });
});

/**
 * `migrate deploy` of the repository migrations to `spk08_audit` with every existing partition declared external
 * (variant c of exit 3). Idempotent, so exit 4 can call it too and does not depend on test order (n2).
 */
async function deployAuditDb(): Promise<RunResult> {
  const partitions = await asSuperuser(AUDIT_DB, async (client) =>
    (await client.query<{ name: string }>('SELECT partition_name AS name FROM public.audit_partitions ORDER BY 1')).rows.map(
      (r) => `public.${r.name}`,
    ),
  );
  return prismaSpike(['migrate', 'deploy'], {
    DATABASE_MIGRATOR_URL: cluster().migratorUrl(AUDIT_DB),
    SPK08_EXTERNAL_TABLES: [EXTERNAL_TABLES, ...partitions].join(','),
  });
}

describe('SPK-08 exit 3: no Prisma-generated DDL is blocked by the guard', () => {
  it('SPK-08 exit 3 prisma migrate deploy of the repository migrations succeeds as platform_migrator with the guard installed', async () => {
    const migrator = { DATABASE_MIGRATOR_URL: cluster().migratorUrl(AUDIT_DB) };
    // (a) tables.external = the bootstrap ledger only (the repository config before TASK-021)
    const ledgerOnly = await prismaSpike(['migrate', 'deploy'], { ...migrator, SPK08_EXTERNAL_TABLES: 'public.bootstrap_migrations' });
    report['exit3_deploy_ledger_only'] = { status: ledgerOnly.status, tail: tail(ledgerOnly) };
    // (b) the audit parents declared external (data-model §7.3); the partitions are not listed (F-01 premise)
    const parentsOnly = await prismaSpike(['migrate', 'deploy'], { ...migrator, SPK08_EXTERNAL_TABLES: EXTERNAL_TABLES });
    report['exit3_deploy_parents_external'] = { status: parentsOnly.status, tail: tail(parentsOnly) };
    // (c) the partitions listed as well
    const deployed = await deployAuditDb();
    report['exit3_deploy_partitions_external'] = { status: deployed.status, tail: tail(deployed) };
    const status = await prismaSpike(['migrate', 'status'], { ...migrator, SPK08_EXTERNAL_TABLES: EXTERNAL_TABLES });
    report['exit3_status'] = { status: status.status, tail: tail(status) };
    for (const refused of [ledgerOnly, parentsOnly]) {
      expect({ status: refused.status, p3005: `${refused.stdout}${refused.stderr}`.includes('P3005') }).toEqual({ status: 1, p3005: true });
    }
    expect({ status: deployed.status, tail: tail(deployed) }).toMatchObject({ status: 0 });
    expect({ status: status.status, tail: tail(status) }).toMatchObject({ status: 0 });
  }, 400_000);

  it('SPK-08 exit 3 a representative Prisma-generated DDL set on non-audit tables runs without guard interference', async () => {
    const statements = [
      `CREATE TYPE "public"."Spk08Status" AS ENUM ('DRAFT', 'BOOKED')`,
      `CREATE TABLE "public"."spk08_parent" ("id" UUID NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "spk08_parent_pkey" PRIMARY KEY ("id"))`,
      `CREATE TABLE "public"."spk08_child" ("id" UUID NOT NULL, "parent_id" UUID NOT NULL, "status" "public"."Spk08Status" NOT NULL DEFAULT 'DRAFT', "amount" INTEGER NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "spk08_child_pkey" PRIMARY KEY ("id"))`,
      `ALTER TABLE "public"."spk08_child" ADD COLUMN "note" TEXT`,
      `CREATE INDEX "spk08_child_parent_id_idx" ON "public"."spk08_child"("parent_id")`,
      `CREATE UNIQUE INDEX "spk08_parent_name_key" ON "public"."spk08_parent"("name")`,
      `CREATE INDEX CONCURRENTLY "spk08_child_created_at_idx" ON "public"."spk08_child"("created_at")`,
      `CREATE INDEX "spk08_parent_name_trgm_idx" ON "public"."spk08_parent" USING GIN ("name" gin_trgm_ops)`,
      `ALTER TABLE "public"."spk08_child" ALTER COLUMN "amount" SET DATA TYPE BIGINT`,
      `ALTER TABLE "public"."spk08_child" ALTER COLUMN "note" SET DEFAULT ''`,
      `ALTER TABLE "public"."spk08_child" ADD CONSTRAINT "spk08_child_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."spk08_parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      `ALTER TYPE "public"."Spk08Status" ADD VALUE 'CANCELLED'`,
      `ALTER TABLE "public"."spk08_child" RENAME COLUMN "note" TO "remark"`,
      `ALTER INDEX "public"."spk08_child_parent_id_idx" RENAME TO "spk08_child_parent_idx"`,
      `ALTER TABLE "public"."spk08_parent" ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE "public"."spk08_parent" FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY "spk08_parent_tenant" ON "public"."spk08_parent" FOR SELECT TO platform_app USING ("name" = current_setting('app.org_id', true))`,
      `GRANT SELECT, INSERT, UPDATE ON "public"."spk08_parent" TO platform_app`,
      `CREATE FUNCTION platform.spk08_helper() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$`,
      `DROP INDEX "public"."spk08_child_created_at_idx"`,
      `ALTER TABLE "public"."spk08_child" DROP CONSTRAINT "spk08_child_parent_id_fkey"`,
      `ALTER TABLE "public"."spk08_child" DROP COLUMN "remark"`,
      `ALTER TABLE "public"."spk08_child" RENAME TO "spk08_kid"`,
      `DROP POLICY "spk08_parent_tenant" ON "public"."spk08_parent"`,
      `DROP FUNCTION platform.spk08_helper()`,
      `DROP TABLE "public"."spk08_kid"`,
      `DROP TABLE "public"."spk08_parent"`,
      `DROP TYPE "public"."Spk08Status"`,
    ];
    const outcomes: { sql: string; outcome: Outcome }[] = [];
    let createSchema: Outcome = { ok: true };
    await asMigrator(DDL_DB, async (client) => {
      for (const sql of statements) outcomes.push({ sql, outcome: await execute(client, sql) });
      createSchema = await execute(client, 'CREATE SCHEMA IF NOT EXISTS "public"');
    });
    report['exit3_ddl'] = { outcomes, createSchema };
    for (const { sql, outcome } of outcomes) expect({ sql, outcome }).toEqual({ sql, outcome: { ok: true } });
    expect(createSchema).toMatchObject({ ok: false, code: '42501', refusedBy: 'privilege' });
  });

  it('SPK-08 exit 3 first migrate deploy succeeds when tables.external lists a generated range of partition names (most not existing)', async () => {
    // a pure function of the clock, as F-01 recommends for the real config: January of the current UTC year + 60 months
    const now = new Date();
    const names = Array.from({ length: 60 }, (_, i) => `public.${partitionName(i - now.getUTCMonth(), now)}`);
    const env = { DATABASE_MIGRATOR_URL: cluster().migratorUrl(DDL_DB), SPK08_EXTERNAL_TABLES: [EXTERNAL_TABLES, ...names].join(',') };
    const deploy = await prismaSpike(['migrate', 'deploy'], env);
    const status = await prismaSpike(['migrate', 'status'], env);
    report['exit3_deploy_generated_range'] = { names: names.length, deploy: deploy.status, status: status.status, tail: tail(deploy) };
    expect({ status: deploy.status, tail: tail(deploy) }).toMatchObject({ status: 0 });
    expect({ status: status.status, tail: tail(status) }).toMatchObject({ status: 0 });
  }, 240_000);
});

describe('SPK-08 exit 4: Prisma 7 migrations.initShadowDb with the rendered bootstrap lane', () => {
  const initFile = (): string => join(work(), 'shadow-init.sql');
  const migrationsCopy = (): string => join(work(), 'migrations');
  let diffStatements: string[] = [];
  const env = (init: string): Record<string, string> => ({
    DATABASE_MIGRATOR_URL: cluster().migratorUrl(AUDIT_DB),
    SPK08_SHADOW_DATABASE_URL: cluster().migratorUrl(SHADOW_DB),
    SPK08_SHADOW_INIT_FILE: init,
    SPK08_EXTERNAL_TABLES: EXTERNAL_TABLES,
  });

  beforeAll(() => {
    const rendered = renderShadowInit([SCHEMAS_SQL, AUDIT_SQL]);
    writeFileSync(initFile(), rendered.sql);
    cpSync(join(repoRoot, 'prisma', 'migrations'), migrationsCopy(), { recursive: true });
    report['exit4_rendering'] = { kept: rendered.kept, dropped: rendered.dropped };
  });

  it('SPK-08 exit 4 the rendering keeps the three CREATE EXTENSION IF NOT EXISTS lines and strips roles, OWNER TO, AUTHORIZATION, grants and event triggers', () => {
    const sql = normalise(readFileSync(initFile(), 'utf8'));
    for (const ext of ['pg_trgm', 'btree_gin', 'btree_gist'])
      expect(sql).toContain(`create extension if not exists ${ext} with schema public`);
    expect(sql).toContain('drop schema if exists platform cascade; create schema if not exists platform;');
    expect(sql).not.toMatch(/authorization|owner to|set role|event trigger|grant |default privileges/);
  });

  it('SPK-08 exit 4 negative control: a failing initShadowDb script fails migrate diff (the hook runs against the shadow database)', async () => {
    const bad = join(work(), 'shadow-init-bad.sql');
    writeFileSync(bad, 'SELECT pg_catalog.spk08_missing_function();\n');
    const result = await prismaSpike(
      ['migrate', 'diff', '--from-migrations', migrationsCopy(), '--to-schema', 'prisma/schema', '--exit-code'],
      env(bad),
    );
    report['exit4_negative'] = { status: result.status, tail: tail(result) };
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('spk08_missing_function');
  }, 240_000);

  it('SPK-08 exit 4 migrate diff --from-migrations --to-schema with the shadow database succeeds; the diff touches no bootstrap-lane object', async () => {
    const result = await prismaSpike(
      ['migrate', 'diff', '--from-migrations', migrationsCopy(), '--to-schema', 'prisma/schema', '--script'],
      env(initFile()),
    );
    const shadow = await withClient(cluster().migratorConnection(SHADOW_DB), async (client) => ({
      extensions: (await client.query<{ extname: string }>('SELECT extname FROM pg_catalog.pg_extension ORDER BY 1')).rows.map(
        (r) => r.extname,
      ),
      platformSchema: (await client.query<{ n: string }>(`SELECT count(*) AS n FROM pg_catalog.pg_namespace WHERE nspname = 'platform'`))
        .rows[0]?.n,
      auditRelations: (
        await client.query<{ relname: string }>(
          `SELECT relname FROM pg_catalog.pg_class WHERE relname LIKE 'audit\\_%' AND relkind IN ('r', 'p') ORDER BY 1`,
        )
      ).rows.map((r) => r.relname),
      prismaTables: (
        await client.query<{ relname: string }>(
          `SELECT relname FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname NOT LIKE 'audit\\_%' ORDER BY 1`,
        )
      ).rows.map((r) => r.relname),
    }));
    report['exit4_diff'] = { status: result.status, script: result.stdout, stderr: result.stderr, shadowAfter: shadow };
    expect({ status: result.status, tail: tail(result) }).toMatchObject({ status: 0 });
    // the shadow database really received the bootstrap-lane objects (and Prisma left them there)
    expect(shadow.extensions.filter((name) => name !== 'plpgsql')).toEqual(['btree_gin', 'btree_gist', 'pg_trgm']);
    expect(shadow.platformSchema).toBe('1');
    expect(shadow.auditRelations).toEqual(expect.arrayContaining(['audit_entries', 'audit_partitions']));
    expect(shadow.auditRelations.some((name) => /^audit_entries_\d{4}_\d{2}$/.test(name))).toBe(true);
    expect(shadow.prismaTables).toEqual(expect.arrayContaining(['permissions', 'role_permissions', 'roles']));
    // non-vacuous: the script is not empty, it holds exactly the known F-04 drift, and nothing of the bootstrap lane
    expect(result.stdout).toContain('ix_role_permissions__role_id');
    expect(result.stdout).not.toMatch(/audit|platform|extension|bootstrap_migrations|schema/i);
    diffStatements = statementsOf(result.stdout);
  }, 240_000);

  it('SPK-08 exit 4 migrate dev --create-only against the bootstrapped, audit-prototyped, migrated database succeeds (no drift; no audit object in the new migration)', async () => {
    const deployed = await deployAuditDb();
    expect({ status: deployed.status, tail: tail(deployed) }).toMatchObject({ status: 0 });
    const before = new Set(readdirSync(migrationsCopy()));
    const result = await prismaSpike(['migrate', 'dev', '--create-only', '--name', 'spk08_probe'], {
      ...env(initFile()),
      SPK08_MIGRATIONS_DIR: migrationsCopy(),
    });
    const created = readdirSync(migrationsCopy()).filter((name) => !before.has(name));
    const sql = created.map((name) => readFileSync(join(migrationsCopy(), name, 'migration.sql'), 'utf8')).join('\n');
    report['exit4_dev'] = { status: result.status, tail: tail(result), created, sql };
    expect({ status: result.status, tail: tail(result) }).toMatchObject({ status: 0 });
    expect(created).toHaveLength(1);
    expect(sql).toContain('ix_role_permissions__role_id');
    expect(sql).not.toMatch(/audit|platform|extension|bootstrap_migrations|schema/i);
    // `migrate dev` writes exactly what `migrate diff --from-migrations --to-schema` prints (the basis of the M1 probe)
    if (diffStatements.length > 0) expect(statementsOf(sql)).toEqual(diffStatements);
  }, 240_000);

  it('SPK-08 exit 4 (M1) what the next generated migration does with a raw-SQL partial index, with and without the partialIndexes preview', async () => {
    // A migration adds a raw-SQL partial index; `migrate diff --from-migrations --to-schema` prints what `migrate dev`
    // would write (test above). The schema variants are used as both the config schema and the diff target.
    const migrations = join(work(), 'migrations-m1');
    cpSync(join(repoRoot, 'prisma', 'migrations'), migrations, { recursive: true });
    mkdirSync(join(migrations, '20991231000000_spk08_partial_index'));
    writeFileSync(
      join(migrations, '20991231000000_spk08_partial_index', 'migration.sql'),
      `CREATE INDEX "${PARTIAL_INDEX}" ON "public"."roles"("key") WHERE "is_system";\n`,
    );
    const schemaCopy = (name: string, preview: boolean, index: string | undefined): string => {
      const dir = join(work(), `schema-m1-${name}`);
      cpSync(join(repoRoot, 'prisma', 'schema'), dir, { recursive: true });
      const base = join(dir, '_base.prisma');
      const authz = join(dir, 'authz.prisma');
      const baseSql = readFileSync(base, 'utf8');
      const authzSql = readFileSync(authz, 'utf8');
      const anchorLine = '  @@index([scope], map: "ix_roles__scope")\n';
      if (!authzSql.includes(anchorLine) || !baseSql.includes('provider = "prisma-client"\n'))
        throw new Error(`schema anchors moved (${name})`);
      if (preview)
        writeFileSync(
          base,
          baseSql.replace('provider = "prisma-client"\n', 'provider = "prisma-client"\n  previewFeatures = ["partialIndexes"]\n'),
        );
      if (index !== undefined) writeFileSync(authz, authzSql.replace(anchorLine, `${anchorLine}  ${index}\n`));
      return dir;
    };
    const declare = (predicate?: string): string =>
      `@@index([key], map: "${PARTIAL_INDEX}"${predicate === undefined ? '' : `, where: raw("${predicate}")`})`;
    const schemas: Record<string, string> = {
      undeclared_preview_off: schemaCopy('a', false, undefined),
      undeclared_preview_on: schemaCopy('b', true, undefined),
      declared_same_predicate_preview_on: schemaCopy('c', true, declare('is_system')),
      declared_other_predicate_preview_on: schemaCopy('d', true, declare('NOT is_system')),
      declared_without_predicate_preview_off: schemaCopy('e', false, declare()),
    };
    const outcomes: Record<string, { statements: string[]; shadowIndex: string | undefined }> = {};
    for (const [variant, schema] of Object.entries(schemas)) {
      const result = await prismaSpike(['migrate', 'diff', '--from-migrations', migrations, '--to-schema', schema, '--script'], {
        ...env(initFile()),
        SPK08_SCHEMA: schema,
      });
      expect({ variant, status: result.status, tail: tail(result) }).toMatchObject({ variant, status: 0 });
      // the shadow database keeps the replayed history: proof that the partial index was really created there
      const shadowIndex = await withClient(
        cluster().migratorConnection(SHADOW_DB),
        async (client) =>
          (await client.query<{ def: string }>('SELECT indexdef AS def FROM pg_catalog.pg_indexes WHERE indexname = $1', [PARTIAL_INDEX]))
            .rows[0]?.def,
      );
      outcomes[variant] = { statements: statementsOf(result.stdout).filter((s) => s.includes(PARTIAL_INDEX)), shadowIndex };
    }
    report['m1_partial_index'] = outcomes;
    const created = `CREATE INDEX ${PARTIAL_INDEX} ON public.roles USING btree (key) WHERE is_system`;
    expect(outcomes).toEqual({
      // preview off (the repository today): Prisma preserves the raw partial index, and a plain @@index of the same name
      // and columns compares equal (the predicate is invisible to the differ and to drift detection)
      undeclared_preview_off: { statements: [], shadowIndex: created },
      declared_without_predicate_preview_off: { statements: [], shadowIndex: created },
      // preview on: an undeclared raw partial index is DROPPED by the next generated migration; a declared one is kept
      // only when its predicate matches, otherwise it is dropped and re-created with the schema's predicate
      undeclared_preview_on: { statements: [`drop index "${PARTIAL_INDEX}"`], shadowIndex: created },
      declared_same_predicate_preview_on: { statements: [], shadowIndex: created },
      declared_other_predicate_preview_on: {
        statements: [`drop index "${PARTIAL_INDEX}"`, `create index "${PARTIAL_INDEX}" on "roles"("key") where (not is_system)`],
        shadowIndex: created,
      },
    });
  }, 400_000);

  it('SPK-08 exit 4 (F-02) negative control: without the DROP SCHEMA line a repeated shadow run fails because platform keeps its objects', async () => {
    const noDrop = join(work(), 'shadow-init-no-drop.sql');
    writeFileSync(noDrop, renderShadowInit([SCHEMAS_SQL, AUDIT_SQL], { dropSchemas: false }).sql);
    const args = ['migrate', 'diff', '--from-migrations', migrationsCopy(), '--to-schema', 'prisma/schema', '--script'];
    const first = await prismaSpike(args, env(noDrop));
    const second = await prismaSpike(args, env(noDrop));
    report['f02_negative'] = { first: { status: first.status, tail: tail(first) }, second: { status: second.status, tail: tail(second) } };
    expect(second.status).not.toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain('already exists');
  }, 240_000);
});
