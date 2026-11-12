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
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const SCHEMAS_SQL = readFileSync(join(repoRoot, 'prisma', 'bootstrap', '01-schemas.sql'), 'utf8');

const AUDIT_DB = 'spk08_audit';
const DDL_DB = 'spk08_ddl';
const SHADOW_DB = 'spk08_shadow';
const GUARD_MESSAGE = 'audit objects are immutable (SEC-P3-03)';
const PRIVILEGE_MESSAGE = /^(must be owner of |permission denied )/;
const PINNED_PATH = 'search_path=pg_catalog, pg_temp';
const EXTERNAL_TABLES = 'public.bootstrap_migrations,public.audit_entries,public.audit_partitions';

type Refusal = 'privilege' | 'guard' | 'other';

interface Outcome {
  ok: boolean;
  code?: string;
  message?: string;
  detail?: string;
  refusedBy?: Refusal;
}

const report: Record<string, unknown> = {};
let pgh: PlatformPostgres;
let workDir: string;

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

const asSuperuser = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(pgh.superuser(db), fn);
const asMigrator = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(pgh.migratorConnection(db), fn);
const asApp = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(pgh.appConnection(db), fn);

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

/**
 * Migrator-runnable rendering of the bootstrap lane for `migrations.initShadowDb` (data-model §7.3 as amended by
 * SEC-P3-27 item 6 and batch 0.2): no roles, no SET ROLE, no OWNER TO / AUTHORIZATION, no event triggers; grants and
 * default privileges are dropped as well (privileges are not diffed); the search-path lines and the three
 * CREATE EXTENSION IF NOT EXISTS lines are kept. 00-roles.sql (roles, database level) and 90-* (event triggers) are
 * not rendered at all. Prisma resets only the datasource schema (`public`) of the shadow database before each run, so
 * a schema the lane creates (`platform`) would keep the previous run's objects: each `CREATE SCHEMA IF NOT EXISTS x` is
 * therefore preceded by `DROP SCHEMA IF EXISTS x CASCADE` (the migrator owns both the shadow database and `x` there).
 */
function renderShadowInit(files: readonly string[]): { sql: string; kept: string[]; dropped: string[] } {
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
        kept.push(`DROP SCHEMA IF EXISTS ${name} CASCADE`, statement.replace(/\s+AUTHORIZATION\s+\S+/i, ''));
      } else {
        kept.push(statement);
      }
    }
  }
  return { sql: `${kept.join(';\n')};\n`, kept: kept.map((s) => normalise(s).slice(0, 80)), dropped };
}

beforeAll(async () => {
  pgh = await PlatformPostgres.start();
  workDir = mkdtempSync(join(tmpdir(), 'spk08-'));
  for (const db of [AUDIT_DB, DDL_DB]) {
    await pgh.createDatabase(db);
    await pgh.bootstrap(db);
    await applyAsSuperuser(db, AUDIT_SQL);
    await applyAsSuperuser(db, GUARD_SQL);
  }
  await asSuperuser('postgres', async (admin) => {
    await admin.query(`CREATE DATABASE ${SHADOW_DB} OWNER ${MIGRATOR}`);
    report['server_version'] = (await admin.query<{ v: string }>(`SELECT pg_catalog.current_setting('server_version') AS v`)).rows[0]?.v;
  });
}, 300_000);

afterAll(async () => {
  const out = process.env['SPK08_REPORT'];
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(workDir, { recursive: true, force: true });
  await pgh?.stop();
});

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

  it('SEC-TC-43 SELECT platform.ensure_audit_partitions(3) as platform_app succeeds; the new partitions belong to the audit owner and stay immutable', async () => {
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
    expect(created).toBe(3);
    await asSuperuser(AUDIT_DB, async (client) => {
      const parts = await client.query<{ relname: string; owner: string; truncate_trigger: boolean }>(
        `SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                EXISTS (SELECT FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'trg_' || c.relname || '__no_truncate') AS truncate_trigger
           FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'public.audit_entries'::regclass ORDER BY 1`,
      );
      expect(parts.rows).toHaveLength(4);
      expect(parts.rows.every((p) => p.owner === 'platform_audit_owner' && p.truncate_trigger)).toBe(true);
      // the row trigger fires even for the superuser, who bypasses privileges and RLS
      const update = await attempt(client, `UPDATE public.audit_entries SET details = '{}'::jsonb`);
      expect(update).toMatchObject({
        ok: false,
        code: '42501',
        message: `AUDIT_IMMUTABLE: UPDATE on ${parts.rows[0]?.relname ?? '?'} is not permitted`,
      });
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
      await client.query(`SELECT to_char(current_date, 'YYYY'), pg_advisory_xact_lock(1)`);
      const control = await client.query<{ fn: string }>('SELECT fn FROM platform.spk08_hijack_marker ORDER BY fn');
      await client.query('ROLLBACK');
      report['sec_tc_61_hijack_control'] = control.rows;
      expect(control.rows.map((r) => r.fn)).toEqual(['pg_advisory_xact_lock', 'to_char']);
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
    await asMigrator(AUDIT_DB, async (client) => {
      await client.query('DROP FUNCTION public.pg_advisory_xact_lock(integer), public.to_char(date, text)');
      await client.query('DROP TABLE platform.spk08_hijack_marker');
    });
  });
});

describe('SPK-08 exit 3: no Prisma-generated DDL is blocked by the guard', () => {
  it('SPK-08 exit 3 prisma migrate deploy of the repository migrations succeeds as platform_migrator with the guard installed', async () => {
    // (a) the repository config, whose tables.external lists only the bootstrap ledger (TASK-021 adds the audit tables)
    const rootConfig = await pgh.prisma(AUDIT_DB, ['migrate', 'deploy']);
    report['exit3_deploy_root_config'] = { status: rootConfig.status, tail: tail(rootConfig) };
    expect(rootConfig.status).toBe(1);
    expect(rootConfig.stdout + rootConfig.stderr).toContain('P3005');
    // (b) the audit parents declared external (data-model §7.3); the partitions are not listed
    const migrator = { DATABASE_MIGRATOR_URL: pgh.migratorUrl(AUDIT_DB), SPK08_EXTERNAL_TABLES: EXTERNAL_TABLES };
    const parentsOnly = await prismaSpike(['migrate', 'deploy'], migrator);
    report['exit3_deploy_parents_external'] = { status: parentsOnly.status, tail: tail(parentsOnly) };
    let deployed = parentsOnly;
    if (parentsOnly.status !== 0) {
      // (c) the partitions listed as well
      const partitions = await asSuperuser(AUDIT_DB, async (client) =>
        (await client.query<{ name: string }>('SELECT partition_name AS name FROM public.audit_partitions ORDER BY 1')).rows.map(
          (r) => `public.${r.name}`,
        ),
      );
      deployed = await prismaSpike(['migrate', 'deploy'], {
        ...migrator,
        SPK08_EXTERNAL_TABLES: [EXTERNAL_TABLES, ...partitions].join(','),
      });
      report['exit3_deploy_partitions_external'] = { status: deployed.status, tail: tail(deployed) };
    }
    const status = await prismaSpike(['migrate', 'status'], migrator);
    report['exit3_status'] = { status: status.status, tail: tail(status) };
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
    const names: string[] = [];
    for (let year = 2026; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) names.push(`public.audit_entries_${String(year)}_${String(month).padStart(2, '0')}`);
    }
    const env = { DATABASE_MIGRATOR_URL: pgh.migratorUrl(DDL_DB), SPK08_EXTERNAL_TABLES: [EXTERNAL_TABLES, ...names].join(',') };
    const deploy = await prismaSpike(['migrate', 'deploy'], env);
    const status = await prismaSpike(['migrate', 'status'], env);
    report['exit3_deploy_generated_range'] = { names: names.length, deploy: deploy.status, status: status.status, tail: tail(deploy) };
    expect({ status: deploy.status, tail: tail(deploy) }).toMatchObject({ status: 0 });
    expect({ status: status.status, tail: tail(status) }).toMatchObject({ status: 0 });
  }, 240_000);
});

describe('SPK-08 exit 4: Prisma 7 migrations.initShadowDb with the rendered bootstrap lane', () => {
  const initFile = (): string => join(workDir, 'shadow-init.sql');
  const migrationsCopy = (): string => join(workDir, 'migrations');
  const env = (init: string): Record<string, string> => ({
    DATABASE_MIGRATOR_URL: pgh.migratorUrl(AUDIT_DB),
    SPK08_SHADOW_DATABASE_URL: pgh.migratorUrl(SHADOW_DB),
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
    const bad = join(workDir, 'shadow-init-bad.sql');
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
    const shadow = await withClient(pgh.migratorConnection(SHADOW_DB), async (client) => ({
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
    expect(result.stdout).not.toMatch(/audit|platform|extension|bootstrap_migrations|schema/i);
  }, 240_000);

  it('SPK-08 exit 4 migrate dev --create-only against the bootstrapped, audit-prototyped, migrated database succeeds (no drift; no audit object in the new migration)', async () => {
    const before = new Set(readdirSync(migrationsCopy()));
    const result = await prismaSpike(['migrate', 'dev', '--create-only', '--name', 'spk08_probe'], {
      ...env(initFile()),
      SPK08_MIGRATIONS_DIR: migrationsCopy(),
    });
    const created = readdirSync(migrationsCopy()).filter((name) => !before.has(name));
    const sql = created.map((name) => readFileSync(join(migrationsCopy(), name, 'migration.sql'), 'utf8')).join('\n');
    report['exit4_dev'] = { status: result.status, tail: tail(result), created, sql };
    expect({ status: result.status, tail: tail(result) }).toMatchObject({ status: 0 });
    expect(sql).not.toMatch(/audit|platform|extension|bootstrap_migrations|schema/i);
  }, 240_000);
});
