/**
 * Audit ownership separation and the identity-based audit DDL guard, migrator side (SEC-TC-43, SEC-TC-61; data-model.md
 * §4.4, §5.2 amendments SEC-P3-03, SEC-P3-27 and 2026-11-13 PR12-SEC-02/03/04, §5.3; ADR-0007 amendments 7 and 8;
 * D-SEC-PR12-01, D-ARCH-076; TASK-021).
 *
 * Source: the SPK-08 §8.1 port (D-TASK012-02 (1), PR #12 code review M3). This suite replaces the tamper assertions of
 * the deleted spike prisma/tests/spikes/spk08-audit-owner.int.test.ts, exits 1, 2 and 3b (F-05, F-06, F-08, F-10),
 * and runs them against the REAL lane: a clone of the bootstrapped (prisma/bootstrap/10-audit.sql and
 * 90-audit-ddl-guard.sql included) and fully migrated template of prisma/tests/harness/postgres.ts, never against the
 * prototype SQL. Differences to the prototype are deliberate: audit_entries is SYSTEM without RLS (PR12-SEC-08), so no
 * policy is dropped; triggers and event triggers are ENABLE ALWAYS ('A'); the bootstrap lane pre-creates the current
 * month and the next three partitions. Spike exit 3a (migrate deploy with tables.external) and exit 4 (shadow
 * rendering, F-01/F-02) are ported to prisma/tests/shadow/** with tools/db/shadow-init; the catalogue assertions of
 * exit 1 (roles, owners, proconfig, event triggers, C14 (b) superuser rename) live in
 * prisma/tests/catalog/c11-c14-audit.int.test.ts.
 *
 * F-10 pattern: every tamper attempt runs in BEGIN … ROLLBACK and its outcome is classified by message as `privilege`
 * ("must be owner of …" / "permission denied …") or `guard` ("audit objects are immutable (SEC-P3-03)"). Dynamic
 * variants run the statement through `DO $$ BEGIN EXECUTE '… audit_' || '…'; END $$`, so the statement text never
 * appears whole. Fixtures that another role must see (the F-08 plant, the exit-3b DDL set) are committed to a clone of
 * their own.
 *
 * Stays with other tasks: the generated immutability-per-role suite over every audit table, path and client, and the
 * guard-disabled variants (privilege alone, event triggers off) -> TASK-033; the hourly verifier tripwire on
 * evtenabled / tgenabled and the anchor chain -> TASK-116.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { quoteLiteral } from '../../../tools/db/sql-text.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { MIGRATOR, PlatformPostgres, SUPERUSER } from '../harness/postgres.js';

const BOOTSTRAP_DIR = join(findRepoRoot(), 'prisma', 'bootstrap');
const GUARD_FILE = '90-audit-ddl-guard.sql';
const AUDIT_FILE = '10-audit.sql';
const AUDIT_OWNER = 'platform_audit_owner';
const SCHEMA_OWNER = 'platform_schema_owner';
const GUARD_MESSAGE = 'audit objects are immutable (SEC-P3-03)';
const PRIVILEGE_MESSAGE = /^(must be owner of |permission denied )/;
/** An index squatting a partition name on a migrator-owned table, planted under the audit-owner exemption (F-08). */
const F08_INDEX = 'audit_entries_2099_02';

type Refusal = 'privilege' | 'guard' | 'other';

interface Outcome {
  ok: boolean;
  code?: string;
  message?: string;
  detail?: string;
  refusedBy?: Refusal;
}

const OK: Outcome = { ok: true };

let pgh: PlatformPostgres | undefined;
let workDir: string | undefined;
const dbs = { tamper: '', ensure: '', drop: '', ddl: '' };

const cluster = (): PlatformPostgres => {
  if (pgh === undefined) throw new Error('PostgreSQL container not started');
  return pgh;
};
const work = (): string => {
  if (workDir === undefined) throw new Error('work directory missing');
  return workDir;
};

/** `audit_entries_YYYY_MM` of the UTC month `offset` months from now. */
function partitionName(offset: number, now = new Date()): string {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `audit_entries_${String(month.getUTCFullYear())}_${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
}

const classify = (message: string): Refusal =>
  message === GUARD_MESSAGE ? 'guard' : PRIVILEGE_MESSAGE.test(message) ? 'privilege' : 'other';

/** pg errors are duck-typed: under Jest VM modules `instanceof Error` can be false for them. */
function toOutcome(error: unknown): Outcome {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown; detail?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  return {
    ok: false,
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    message,
    ...(typeof e.detail === 'string' ? { detail: e.detail } : {}),
    refusedBy: classify(message),
  };
}

/**
 * Runs `setup` (which must succeed) and then `sql` in one transaction that is always rolled back; returns the outcome
 * of `sql` instead of throwing.
 */
async function attempt(client: pg.Client, sql: string, setup: readonly string[] = []): Promise<Outcome> {
  await client.query('BEGIN');
  try {
    for (const statement of setup) await client.query(statement);
    return await client.query(sql).then(() => OK, toOutcome);
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Runs `sql` outside an explicit transaction (committed; CREATE INDEX CONCURRENTLY needs this). */
const execute = (client: pg.Client, sql: string): Promise<Outcome> => client.query(sql).then(() => OK, toOutcome);

/** `sql` as a DO block whose EXECUTE string is concatenated at run time, split inside the first audit-ish name. */
function dynamic(sql: string): string {
  const marker = ['audit_', 'data_', 'public', 'platform'].find((candidate) => sql.includes(candidate));
  if (marker === undefined) throw new Error(`no split marker in: ${sql}`);
  const cut = sql.indexOf(marker) + Math.ceil(marker.length / 2);
  return `DO $probe$ BEGIN EXECUTE ${quoteLiteral(sql.slice(0, cut))} || ${quoteLiteral(sql.slice(cut))}; END $probe$`;
}

async function withClient<T>(connect: Promise<pg.Client> | pg.ClientConfig, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  let client: pg.Client;
  if (connect instanceof Promise) {
    client = await connect;
  } else {
    client = new pg.Client(connect);
    await client.connect();
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const asSuperuser = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(cluster().superuser(db), fn);
const asMigrator = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(cluster().migratorConnection(db), fn);
const asApp = <T>(db: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient(cluster().appConnection(db), fn);

async function scalar(client: pg.Client, sql: string): Promise<string> {
  const { rows } = await client.query<{ v: unknown }>(sql);
  const value = rows[0]?.v;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  throw new Error(`no text or number from: ${sql}`);
}

/** Direct and dynamic outcome of every statement, as `migrator` in `db`. */
async function directAndDynamic(
  db: string,
  statements: Readonly<Record<string, string>>,
  setup: readonly string[] = [],
): Promise<Record<string, { direct: Outcome; dynamic: Outcome }>> {
  const outcomes: Record<string, { direct: Outcome; dynamic: Outcome }> = {};
  await asMigrator(db, async (client) => {
    for (const [id, sql] of Object.entries(statements)) {
      outcomes[id] = { direct: await attempt(client, sql, setup), dynamic: await attempt(client, dynamic(sql), setup) };
    }
  });
  return outcomes;
}

/** Child partitions of public.audit_entries. */
const partitionsOf = (db: string): Promise<Set<string>> =>
  asSuperuser(db, async (client) => {
    const { rows } = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'public.audit_entries'::regclass`,
    );
    return new Set(rows.map((r) => r.relname));
  });

const currentPartition = (db: string): Promise<string> =>
  asSuperuser(db, (client) => scalar(client, 'SELECT partition_name AS v FROM public.audit_partitions ORDER BY range_start LIMIT 1'));

/** The bootstrap lane without the guard: the `0N-*.sql` files and 10-audit.sql. */
function laneWithoutGuard(target: string): string {
  mkdirSync(target);
  for (const name of readdirSync(BOOTSTRAP_DIR)) {
    if (/^0\d-[a-z0-9-]+\.sql$/.test(name) || name === AUDIT_FILE) cpSync(join(BOOTSTRAP_DIR, name), join(target, name));
  }
  return target;
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'audit-owner-'));
  const started = await PlatformPostgres.start();
  pgh = started;
  const template = await started.template({ migrated: true });
  dbs.tamper = await started.clone(template);
  dbs.ensure = await started.clone(template);
  dbs.drop = await started.clone(template);
  dbs.ddl = await started.clone(template);
  // F-08 plant: an index under a partition name on a table the migrator owns. Only the audit-owner exemption of the
  // guard (the bootstrap lane / ensure_audit_partitions path) can create it. Since PR12-SEC-02-a the guard also refuses
  // any ALTER of a relation carrying such an index, so the superuser suspends both event triggers for the owner
  // transfer alone, inside the same committed setup transaction.
  await asSuperuser(dbs.drop, async (client) => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${AUDIT_OWNER}`);
    await client.query('CREATE TABLE public.f08_probe (id integer)');
    await client.query(`CREATE INDEX ${F08_INDEX} ON public.f08_probe (id)`);
    await client.query('RESET ROLE');
    await client.query('ALTER EVENT TRIGGER platform_audit_ddl_guard_end DISABLE');
    await client.query(`ALTER TABLE public.f08_probe OWNER TO ${MIGRATOR}`);
    await client.query('ALTER EVENT TRIGGER platform_audit_ddl_guard_end ENABLE ALWAYS');
    await client.query('COMMIT');
  });
}, 300_000);

afterAll(async () => {
  try {
    await pgh?.stop();
  } finally {
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
  }
}, 120_000);

describe('audit store: privilege refuses the migrator (SEC-TC-43, SPK-08 exit 1)', () => {
  it('[SEC-TC-43] every tamper statement fails for platform_migrator with 42501 by privilege, directly and through DO $$ EXECUTE $$', async () => {
    const partition = await currentPartition(dbs.tamper);
    const statements: Record<string, string> = {
      disable_trigger_all: 'ALTER TABLE public.audit_entries DISABLE TRIGGER ALL',
      demote_trigger_replica: 'ALTER TABLE public.audit_entries ENABLE REPLICA TRIGGER trg_audit_entries__no_update_delete',
      no_force_rls: 'ALTER TABLE public.audit_entries NO FORCE ROW LEVEL SECURITY',
      disable_rls: 'ALTER TABLE public.audit_entries DISABLE ROW LEVEL SECURITY',
      enable_rls: 'ALTER TABLE public.audit_entries ENABLE ROW LEVEL SECURITY',
      create_policy: 'CREATE POLICY p_probe ON public.audit_entries FOR SELECT TO platform_app USING (true)',
      drop_trigger: 'DROP TRIGGER trg_audit_entries__no_update_delete ON public.audit_entries',
      detach_partition: `ALTER TABLE public.audit_entries DETACH PARTITION public.${partition}`,
      drop_table: 'DROP TABLE public.audit_entries',
      drop_schema_public_cascade: 'DROP SCHEMA public CASCADE',
      drop_partition: `DROP TABLE public.${partition}`,
      partition_disable_trigger: `ALTER TABLE public.${partition} DISABLE TRIGGER ALL`,
      drop_index: 'DROP INDEX public.ix_audit__stream_seq',
      grant_update: 'GRANT UPDATE, DELETE ON public.audit_entries TO platform_app',
      truncate: 'TRUNCATE public.audit_entries',
      anchors_disable_trigger: 'ALTER TABLE public.audit_anchors DISABLE TRIGGER ALL',
      checkpoint_heads_truncate: 'TRUNCATE public.audit_checkpoint_heads',
      vault_disable_guard: 'ALTER TABLE public.audit_pii_vault DISABLE TRIGGER trg_audit_pii_vault__guard',
      drop_data_subjects: 'DROP TABLE public.data_subjects CASCADE',
      replace_forbid_mutation:
        'CREATE OR REPLACE FUNCTION platform.audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$',
      replace_vault_guard:
        'CREATE OR REPLACE FUNCTION platform.audit_vault_guard() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN OLD; END $f$',
      replace_ensure_partitions:
        'CREATE OR REPLACE FUNCTION platform.ensure_audit_partitions(p_months_ahead integer DEFAULT 3) RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$',
      alter_function_owner: `ALTER FUNCTION platform.audit_forbid_mutation() OWNER TO ${MIGRATOR}`,
      replace_guard: 'CREATE OR REPLACE FUNCTION platform.audit_ddl_guard() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN END $f$',
    };
    const outcomes = await directAndDynamic(dbs.tamper, statements);
    for (const [id, { direct, dynamic: viaDo }] of Object.entries(outcomes)) {
      expect({ id, ok: direct.ok, code: direct.code, refusedBy: direct.refusedBy }).toEqual({
        id,
        ok: false,
        code: '42501',
        refusedBy: 'privilege',
      });
      expect({ id, ok: viaDo.ok, code: viaDo.code, same: viaDo.message === direct.message }).toEqual({
        id,
        ok: false,
        code: '42501',
        same: true,
      });
    }
  });

  it('[SEC-TC-43] SELECT platform.ensure_audit_partitions(3) as platform_app succeeds; partitions it creates belong to platform_audit_owner and stay immutable', async () => {
    const db = dbs.ensure;
    const before = await partitionsOf(db);
    const wanted = [0, 1, 2, 3, 4, 5].map((offset) => partitionName(offset));
    const created = await asApp(db, async (client) => {
      const three = Number(await scalar(client, 'SELECT platform.ensure_audit_partitions(3) AS v'));
      const five = Number(await scalar(client, 'SELECT platform.ensure_audit_partitions(5) AS v'));
      // one row in the month-+5 partition this test made the function create
      await client.query(
        `INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, actor_type, job_name, source_app,
                                           correlation_id, action, entity_name, outcome, prev_hash, entry_hash)
         VALUES (gen_random_uuid(),
                 (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '5 months 1 day') AT TIME ZONE 'UTC',
                 gen_random_uuid(), 1, 'SYSTEM_JOB', 'audit-owner-suite', 'worker', 'audit-owner-0001', 'CREATE',
                 'audit_probe', 'SUCCESS', decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'))`,
      );
      return { three, five };
    });
    // derived from the clock, so a UTC month boundary between the bootstrap and this test does not matter
    const missingFirst = wanted.slice(0, 4).filter((name) => !before.has(name)).length;
    expect(created.three).toBe(missingFirst);
    expect(created.five).toBe(wanted.filter((name) => !before.has(name)).length - missingFirst);
    expect(created.five).toBeGreaterThan(0);

    const fresh = partitionName(5);
    await asSuperuser(db, async (client) => {
      const parts = await client.query<{
        relname: string;
        owner: string;
        truncate_trigger: string | null;
        row_trigger: string | null;
        app_access: boolean;
        migrator_access: boolean;
        registered: boolean;
      }>(
        `SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                (SELECT t.tgenabled::text FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = c.oid AND t.tgname = 'trg_' || c.relname || '__no_truncate') AS truncate_trigger,
                (SELECT t.tgenabled::text FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = c.oid AND t.tgname = 'trg_audit_entries__no_update_delete' AND t.tgparentid <> 0) AS row_trigger,
                pg_catalog.has_table_privilege('platform_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS app_access,
                pg_catalog.has_table_privilege('${MIGRATOR}', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS migrator_access,
                EXISTS (SELECT FROM public.audit_partitions p WHERE p.partition_name = c.relname) AS registered
           FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'public.audit_entries'::regclass ORDER BY 1`,
      );
      expect(parts.rows.map((p) => p.relname)).toEqual(expect.arrayContaining(wanted));
      for (const part of parts.rows) {
        expect(part).toEqual({
          relname: part.relname,
          owner: AUDIT_OWNER,
          truncate_trigger: 'A',
          row_trigger: 'A',
          app_access: false,
          migrator_access: false,
          registered: true,
        });
      }
      const inFresh = `WHERE occurred_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '5 months') AT TIME ZONE 'UTC'`;
      // the row and statement triggers fire even for the superuser, who bypasses privileges, and in replica mode
      // (ENABLE ALWAYS, PR12-SEC-04 item 3); the message names the partition
      const superuser = {
        update: await attempt(client, `UPDATE public.audit_entries SET details = '{}'::jsonb ${inFresh}`),
        delete: await attempt(client, `DELETE FROM public.audit_entries ${inFresh}`),
        update_replica: await attempt(client, `UPDATE public.audit_entries SET details = '{}'::jsonb ${inFresh}`, [
          'SET LOCAL session_replication_role = replica',
        ]),
        truncate_partition: await attempt(client, `TRUNCATE public.${fresh}`),
      };
      const immutable = (op: string): unknown =>
        expect.objectContaining({ ok: false, code: '42501', message: `AUDIT_IMMUTABLE: ${op} on ${fresh} is not permitted` });
      expect(superuser).toEqual({
        update: immutable('UPDATE'),
        delete: immutable('DELETE'),
        update_replica: immutable('UPDATE'),
        truncate_partition: immutable('TRUNCATE'),
      });
    });
    const migrator = await directAndDynamic(db, {
      disable_trigger_all: `ALTER TABLE public.${fresh} DISABLE TRIGGER ALL`,
      detach: `ALTER TABLE public.audit_entries DETACH PARTITION public.${fresh}`,
      drop: `DROP TABLE public.${fresh}`,
    });
    for (const [id, { direct, dynamic: viaDo }] of Object.entries(migrator)) {
      expect({ id, code: direct.code, refusedBy: direct.refusedBy }).toEqual({ id, code: '42501', refusedBy: 'privilege' });
      expect({ id, code: viaDo.code, refusedBy: viaDo.refusedBy }).toEqual({ id, code: '42501', refusedBy: 'privilege' });
    }
  });
});

describe('audit DDL guard: where privilege admits the migrator, the identity guard refuses (SEC-TC-43 F-05, F-08)', () => {
  it('[SEC-TC-43 F-05] planted audit names (table, partition-named table, function overloads) are refused by the guard, directly and dynamically', async () => {
    const statements: Record<string, string> = {
      audit_named_table: 'CREATE TABLE public.audit_probe_planted (id integer)',
      partition_named_table: `CREATE TABLE public.${partitionName(6)} (id integer)`,
      data_subjects_in_platform: 'CREATE TABLE platform.data_subjects (id integer)',
      ensure_overload_bigint: 'CREATE FUNCTION platform.ensure_audit_partitions(bigint) RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$',
      forbid_mutation_in_public:
        'CREATE FUNCTION public.audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$',
      guard_overload: 'CREATE FUNCTION platform.audit_ddl_guard(integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 0 $f$',
    };
    const outcomes = await directAndDynamic(dbs.tamper, statements);
    const control = await asMigrator(dbs.tamper, (client) => attempt(client, 'CREATE TABLE public.probe_control (id integer)'));
    expect(control).toEqual(OK);
    for (const [id, { direct, dynamic: viaDo }] of Object.entries(outcomes)) {
      expect({ id, code: direct.code, refusedBy: direct.refusedBy, detail: direct.detail }).toEqual({
        id,
        code: '42501',
        refusedBy: 'guard',
        detail: expect.stringMatching(/^CREATE (TABLE|FUNCTION) on (table|function) (public|platform)\..+ by platform_migrator$/),
      });
      expect({ id, code: viaDo.code, refusedBy: viaDo.refusedBy }).toEqual({ id, code: '42501', refusedBy: 'guard' });
    }
  });

  it('[SEC-TC-43 F-08 / R-ARCH-18] sql_drop refuses a schema-owner and a superuser DROP of audit objects, and a migrator DROP of an audit-named index on its own table', async () => {
    const db = dbs.drop;
    const partition = await currentPartition(db);
    const asSchemaOwner = [`SET LOCAL ROLE ${SCHEMA_OWNER}`];
    // platform_schema_owner owns public and platform, so privilege admits its DROP of any object there
    const owner = await asSuperuser(db, async (client) => ({
      schema_owner_drop_partition: await attempt(client, `DROP TABLE public.${partition}`, asSchemaOwner),
      schema_owner_drop_table: await attempt(client, 'DROP TABLE public.audit_entries', asSchemaOwner),
      schema_owner_drop_index: await attempt(client, 'DROP INDEX public.ix_audit__stream_seq', asSchemaOwner),
      schema_owner_drop_anchors: await attempt(client, 'DROP TABLE public.audit_anchors', asSchemaOwner),
      schema_owner_drop_function: await attempt(client, 'DROP FUNCTION platform.audit_vault_guard() CASCADE', asSchemaOwner),
      superuser_drop_table: await attempt(client, 'DROP TABLE public.audit_entries'),
      superuser_drop_function: await attempt(client, 'DROP FUNCTION platform.ensure_audit_partitions(integer)'),
    }));
    const migrator = await asMigrator(db, async (client) => ({
      drop_index: await attempt(client, `DROP INDEX public.${F08_INDEX}`),
      drop_index_dynamic: await attempt(client, dynamic(`DROP INDEX public.${F08_INDEX}`)),
      drop_table: await attempt(client, 'DROP TABLE public.f08_probe'),
      // PR12-SEC-02-a: any DDL on a relation that carries a squatted index is refused too (the squat is never extended)
      alter_squatted_table: await attempt(client, 'CREATE INDEX ix_f08_more ON public.f08_probe (id)'),
      control: await attempt(client, 'DROP INDEX public.ix_f08_control', [
        'CREATE TABLE public.f08_control (id integer)',
        'CREATE INDEX ix_f08_control ON public.f08_control (id)',
      ]),
    }));
    const guard = (detail: string | RegExp): unknown =>
      expect.objectContaining({
        code: '42501',
        refusedBy: 'guard',
        detail: typeof detail === 'string' ? detail : expect.stringMatching(detail),
      });
    expect(owner).toEqual({
      schema_owner_drop_partition: guard(`DROP of table public.${partition} by ${SCHEMA_OWNER}`),
      schema_owner_drop_table: guard(new RegExp(`^DROP of .+ by ${SCHEMA_OWNER}$`)),
      schema_owner_drop_index: guard(`DROP of index public.ix_audit__stream_seq by ${SCHEMA_OWNER}`),
      schema_owner_drop_anchors: guard(new RegExp(`^DROP of .+ by ${SCHEMA_OWNER}$`)),
      schema_owner_drop_function: guard(new RegExp(`^DROP of .+ by ${SCHEMA_OWNER}$`)),
      superuser_drop_table: guard(new RegExp(`^DROP of .+ by ${SUPERUSER}$`)),
      superuser_drop_function: guard(`DROP of function platform.ensure_audit_partitions(integer) by ${SUPERUSER}`),
    });
    expect(migrator).toEqual({
      drop_index: guard(`DROP of index public.${F08_INDEX} by ${MIGRATOR}`),
      drop_index_dynamic: guard(`DROP of index public.${F08_INDEX} by ${MIGRATOR}`),
      drop_table: guard(`DROP of index public.${F08_INDEX} by ${MIGRATOR}`),
      alter_squatted_table: guard(/^CREATE INDEX on index public.ix_f08_more by platform_migrator$/),
      control: OK,
    });
  });
});

describe('audit DDL guard: SEC-TC-61 subset (SPK-08 exit 2)', () => {
  it('[SEC-TC-61] DROP FUNCTION platform.audit_ddl_guard() CASCADE, DROP SCHEMA platform CASCADE, schema renames and event-trigger switches fail by privilege for platform_migrator', async () => {
    const statements: Record<string, string> = {
      drop_guard_cascade: 'DROP FUNCTION platform.audit_ddl_guard() CASCADE',
      drop_schema_platform_cascade: 'DROP SCHEMA platform CASCADE',
      rename_public: 'ALTER SCHEMA public RENAME TO x',
      rename_platform: 'ALTER SCHEMA platform RENAME TO y',
      owner_public: `ALTER SCHEMA public OWNER TO ${MIGRATOR}`,
      owner_platform: `ALTER SCHEMA platform OWNER TO ${MIGRATOR}`,
      drop_event_trigger: 'DROP EVENT TRIGGER platform_audit_ddl_guard_end',
      disable_event_trigger: 'ALTER EVENT TRIGGER platform_audit_ddl_guard_drop DISABLE',
      demote_event_trigger: 'ALTER EVENT TRIGGER platform_audit_ddl_guard_end ENABLE REPLICA',
      set_event_triggers_off: 'SET event_triggers = off',
      set_session_replication_role: 'SET session_replication_role = replica',
    };
    const outcomes: Record<string, Outcome> = {};
    await asMigrator(dbs.tamper, async (client) => {
      for (const [id, sql] of Object.entries(statements)) outcomes[id] = await attempt(client, sql);
    });
    for (const [id, outcome] of Object.entries(outcomes)) {
      expect({ id, ok: outcome.ok, code: outcome.code, refusedBy: outcome.refusedBy }).toEqual({
        id,
        ok: false,
        code: '42501',
        refusedBy: 'privilege',
      });
    }
  });

  it('[SEC-TC-61] planted public.pg_advisory_xact_lock(integer) and public.to_char(date, text) are never called by ensure_audit_partitions; every audit trigger stays enabled', async () => {
    const result = await asSuperuser(dbs.tamper, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
        await client.query('CREATE TABLE platform.probe_hijack_marker (fn text NOT NULL, by_user text NOT NULL DEFAULT current_user)');
        await client.query('GRANT INSERT, SELECT ON platform.probe_hijack_marker TO PUBLIC');
        await client.query(`CREATE FUNCTION public.pg_advisory_xact_lock(integer) RETURNS void LANGUAGE sql
                              AS $f$ INSERT INTO platform.probe_hijack_marker (fn) VALUES ('pg_advisory_xact_lock') $f$`);
        await client.query(`CREATE FUNCTION public.to_char(date, text) RETURNS text LANGUAGE sql
                              AS $f$ INSERT INTO platform.probe_hijack_marker (fn) VALUES ('to_char'); SELECT 'hijacked'::text $f$`);
        await client.query('GRANT EXECUTE ON FUNCTION public.pg_advisory_xact_lock(integer), public.to_char(date, text) TO PUBLIC');
        // positive control: an unqualified call with the runtime role's ordinary path resolves to the planted overloads
        await client.query('SAVEPOINT control');
        await client.query('SET LOCAL ROLE platform_app');
        await client.query('SET LOCAL search_path = pg_catalog, public');
        await client.query(`SELECT to_char(current_date, 'YYYY'), pg_advisory_xact_lock(1)`);
        const control = (await client.query<{ fn: string }>('SELECT fn FROM platform.probe_hijack_marker ORDER BY fn')).rows;
        await client.query('ROLLBACK TO SAVEPOINT control');
        await client.query('SET LOCAL ROLE platform_app');
        await client.query('SET LOCAL search_path = pg_catalog, public');
        const three = Number(await scalar(client, 'SELECT platform.ensure_audit_partitions(3) AS v'));
        const six = Number(await scalar(client, 'SELECT platform.ensure_audit_partitions(6) AS v'));
        await client.query('RESET ROLE');
        const markers = await scalar(client, 'SELECT count(*) AS v FROM platform.probe_hijack_marker');
        const notAlways = await scalar(
          client,
          `SELECT count(*) AS v FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND (c.relname ~ '^audit_' OR c.relname = 'data_subjects') AND t.tgenabled <> 'A'`,
        );
        const auditTriggers = await scalar(
          client,
          `SELECT count(*) AS v FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relname ~ '^audit_entries_[0-9]{4}_[0-9]{2}$'`,
        );
        const eventTriggers = await scalar(client, `SELECT count(*) AS v FROM pg_catalog.pg_event_trigger WHERE evtenabled = 'A'`);
        return { control: control.map((r) => r.fn), three, six, markers, notAlways, auditTriggers, eventTriggers };
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(result.control).toEqual(['pg_advisory_xact_lock', 'to_char']);
    expect(result.three).toBeGreaterThanOrEqual(0);
    expect(result.six).toBeGreaterThan(0);
    expect(result).toMatchObject({ markers: '0', notAlways: '0', eventTriggers: '2' });
    // two triggers (row clone + TRUNCATE) on each of the 7 partitions the call left in place, at least
    expect(Number(result.auditTriggers)).toBeGreaterThanOrEqual(14);
  });
});

describe('audit DDL guard: one squatting probe per object kind (PR12-SEC-02)', () => {
  const squat = partitionName(5);
  const probeTable = 'CREATE TABLE public.squat_probe (id integer)';

  /** Object kind -> [setup, statement]; `{name}` is the squatted name. */
  const KINDS: Record<string, readonly [readonly string[], string]> = {
    index: [[probeTable], 'CREATE INDEX {name} ON public.squat_probe (id)'],
    sequence: [[], 'CREATE SEQUENCE public.{name}'],
    view: [[], 'CREATE VIEW public.{name} AS SELECT 1 AS id'],
    materialized_view: [[], 'CREATE MATERIALIZED VIEW public.{name} AS SELECT 1 AS id'],
    composite_type: [[], 'CREATE TYPE public.{name} AS (id integer)'],
    enum_type: [[], `CREATE TYPE public.{name} AS ENUM ('a')`],
    domain: [[], 'CREATE DOMAIN public.{name} AS integer'],
    rename_table: [[probeTable], 'ALTER TABLE public.squat_probe RENAME TO {name}'],
    rename_index: [
      [probeTable, 'CREATE INDEX ix_squat_probe ON public.squat_probe (id)'],
      'ALTER INDEX public.ix_squat_probe RENAME TO {name}',
    ],
    rename_sequence: [['CREATE SEQUENCE public.squat_seq'], 'ALTER SEQUENCE public.squat_seq RENAME TO {name}'],
    rename_view: [['CREATE VIEW public.squat_view AS SELECT 1 AS id'], 'ALTER VIEW public.squat_view RENAME TO {name}'],
    rename_type: [[`CREATE TYPE public.squat_enum AS ENUM ('a')`], 'ALTER TYPE public.squat_enum RENAME TO {name}'],
    platform_schema_view: [[], 'CREATE VIEW platform.{name} AS SELECT 1 AS id'],
  };
  const withName = (sql: string, name: string): string => sql.replaceAll('{name}', name);

  async function probe(name: string): Promise<Record<string, { direct: Outcome; dynamic: Outcome }>> {
    const outcomes: Record<string, { direct: Outcome; dynamic: Outcome }> = {};
    await asMigrator(dbs.tamper, async (client) => {
      for (const [kind, [setup, sql]] of Object.entries(KINDS)) {
        const statement = withName(sql, name);
        outcomes[kind] = { direct: await attempt(client, statement, setup), dynamic: await attempt(client, dynamic(statement), setup) };
      }
    });
    return outcomes;
  }

  it('[PR12-SEC-02] as platform_migrator, an object of every kind created or renamed under audit_entries_<now + 5 months> is refused by the guard', async () => {
    const outcomes = await probe(squat);
    for (const [kind, { direct, dynamic: viaDo }] of Object.entries(outcomes)) {
      expect({ kind, code: direct.code, refusedBy: direct.refusedBy, detail: direct.detail }).toEqual({
        kind,
        code: '42501',
        refusedBy: 'guard',
        detail: expect.stringMatching(new RegExp(`^(CREATE|ALTER) [A-Z ]+ on [a-z ]+ (public|platform)\\.${squat} by ${MIGRATOR}$`)),
      });
      expect({ kind, code: viaDo.code, refusedBy: viaDo.refusedBy }).toEqual({ kind, code: '42501', refusedBy: 'guard' });
    }
  });

  it('[PR12-SEC-02] control: the same statements under a non-audit name succeed for platform_migrator', async () => {
    const outcomes = await probe('probe_entries_2099_01');
    for (const [kind, { direct, dynamic: viaDo }] of Object.entries(outcomes)) {
      expect({ kind, direct, dynamic: viaDo }).toEqual({ kind, direct: OK, dynamic: OK });
    }
  });

  /**
   * Implicitly named relations (constraint-backed indexes, identity sequences) under a partition name. Each runs as the
   * migrator in a superuser session that is rolled back; when the guard admits the squat, the same transaction then
   * calls ensure_audit_partitions(5) as platform_app, which must fail loudly (§5.3 identity test), never skip.
   */
  const IMPLICIT: Record<string, readonly [readonly string[], string]> = {
    add_unique: [[probeTable], 'ALTER TABLE public.squat_probe ADD CONSTRAINT {name} UNIQUE (id)'],
    add_primary_key: [[probeTable], 'ALTER TABLE public.squat_probe ADD CONSTRAINT {name} PRIMARY KEY (id)'],
    add_exclusion: [[probeTable], 'ALTER TABLE public.squat_probe ADD CONSTRAINT {name} EXCLUDE USING btree (id WITH =)'],
    add_using_index: [
      [probeTable, 'CREATE UNIQUE INDEX ix_squat_probe ON public.squat_probe (id)'],
      'ALTER TABLE public.squat_probe ADD CONSTRAINT {name} UNIQUE USING INDEX ix_squat_probe',
    ],
    inline_primary_key: [[], 'CREATE TABLE public.squat_probe (id integer CONSTRAINT {name} PRIMARY KEY)'],
    inline_unique: [[], 'CREATE TABLE public.squat_probe (id integer CONSTRAINT {name} UNIQUE)'],
    rename_constraint: [
      ['CREATE TABLE public.squat_probe (id integer CONSTRAINT squat_probe_pkey PRIMARY KEY)'],
      'ALTER TABLE public.squat_probe RENAME CONSTRAINT squat_probe_pkey TO {name}',
    ],
    identity_inline: [[], 'CREATE TABLE public.squat_probe (id integer GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.{name}))'],
    identity_add_column: [
      [probeTable],
      'ALTER TABLE public.squat_probe ADD COLUMN n integer GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.{name})',
    ],
  };

  /**
   * Pinned known gap (21B finding PR12-SEC-02-a, reported to the TASK-021 lead): ddl_command_end reports these commands
   * as the table (ALTER TABLE) or the table constraint (RENAME CONSTRAINT), so the guard's own-name check never sees the
   * index they create or rename. ensure_audit_partitions still fails loudly on them (asserted above). Set to [] in the
   * commit that makes 90-audit-ddl-guard.sql check the index names of the affected relation.
   */
  // PR12-SEC-02-a closed in the guard (index names of the altered relation are matched): no variant may bypass it.
  const KNOWN_GUARD_GAP: readonly string[] = [];

  async function squatThenEnsure(client: pg.Client, setup: readonly string[], sql: string): Promise<{ squat: Outcome; ensure?: Outcome }> {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
      for (const statement of setup) await client.query(statement);
      const squatted = await client.query(sql).then(() => OK, toOutcome);
      if (!squatted.ok) return { squat: squatted };
      await client.query('SET LOCAL ROLE platform_app');
      return { squat: squatted, ensure: await client.query('SELECT platform.ensure_audit_partitions(5)').then(() => OK, toOutcome) };
    } finally {
      await client.query('ROLLBACK');
    }
  }

  it('[PR12-SEC-02] implicitly named indexes and identity sequences under a partition name: refused by the guard, else ensure_audit_partitions fails loudly', async () => {
    const outcomes = await asSuperuser(dbs.tamper, async (client) => {
      const result: Record<string, { squat: Outcome; ensure?: Outcome }> = {};
      for (const [variant, [setup, sql]] of Object.entries(IMPLICIT))
        result[variant] = await squatThenEnsure(client, setup, withName(sql, squat));
      return result;
    });
    const bypassing: string[] = [];
    for (const [variant, { squat: squatted, ensure }] of Object.entries(outcomes)) {
      if (squatted.ok) {
        bypassing.push(variant);
        expect({ variant, ensure }).toEqual({
          variant,
          ensure: expect.objectContaining({ code: '42501', message: 'AUDIT_PARTITION_NAME_TAKEN', detail: squat }),
        });
      } else {
        expect({ variant, code: squatted.code, refusedBy: squatted.refusedBy }).toEqual({ variant, code: '42501', refusedBy: 'guard' });
      }
    }
    expect(bypassing).toEqual(KNOWN_GUARD_GAP);
  });
});

describe('audit DDL guard: install hardening (PR12-SEC-03 negative fixture)', () => {
  it('[PR12-SEC-03] a migrator-created platform.audit_ddl_guard() that exists before 90-audit-ddl-guard.sql runs makes that file fail', async () => {
    const pgc = cluster();
    const lane = laneWithoutGuard(join(work(), 'lane-planted'));
    const controlLane = laneWithoutGuard(join(work(), 'lane-control'));
    const planted = 'pr12_sec03_planted';
    const control = 'pr12_sec03_control';
    for (const [database, dir] of [
      [planted, lane],
      [control, controlLane],
    ] as const) {
      await pgc.createDatabase(database);
      await pgc.bootstrap(database, dir);
    }
    await asMigrator(planted, (client) =>
      client.query('CREATE FUNCTION platform.audit_ddl_guard() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN END $f$'),
    );
    cpSync(join(BOOTSTRAP_DIR, GUARD_FILE), join(lane, GUARD_FILE));
    cpSync(join(BOOTSTRAP_DIR, GUARD_FILE), join(controlLane, GUARD_FILE));

    const failure = await pgc.bootstrap(planted, lane).then(() => OK, toOutcome);
    expect(failure.ok).toBe(false);
    expect(failure.message).toMatch(new RegExp(`^${GUARD_FILE.replaceAll('.', '\\.')} failed: .*already exists`));
    const applied = await pgc.bootstrap(control, controlLane);
    expect(applied.applied).toEqual([GUARD_FILE]);

    const state = (database: string): Promise<{ guardOwner: string; eventTriggers: string; ledger: string }> =>
      asSuperuser(database, async (client) => ({
        guardOwner: await scalar(
          client,
          `SELECT pg_catalog.pg_get_userbyid(proowner) AS v FROM pg_catalog.pg_proc
            WHERE pronamespace = 'platform'::regnamespace AND proname = 'audit_ddl_guard'`,
        ),
        eventTriggers: await scalar(client, `SELECT count(*) AS v FROM pg_catalog.pg_event_trigger WHERE evtenabled = 'A'`),
        ledger: await scalar(client, `SELECT count(*) AS v FROM public.bootstrap_migrations WHERE file_name = '${GUARD_FILE}'`),
      }));
    // the planted function keeps its foreign owner but nothing runs it: no event trigger, no ledger row (fail loudly)
    expect(await state(planted)).toEqual({ guardOwner: MIGRATOR, eventTriggers: '0', ledger: '0' });
    expect(await state(control)).toEqual({ guardOwner: SUPERUSER, eventTriggers: '2', ledger: '1' });
  }, 180_000);
});

describe('audit DDL guard: no Prisma-generated DDL is blocked (SPK-08 exit 3b)', () => {
  it('[SPK-08 exit 3b] a representative Prisma-generated DDL set on non-audit tables runs as platform_migrator without guard interference', async () => {
    const statements = [
      `CREATE TYPE "public"."ProbeStatus" AS ENUM ('DRAFT', 'BOOKED')`,
      `CREATE TABLE "public"."probe_parent" ("id" UUID NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "probe_parent_pkey" PRIMARY KEY ("id"))`,
      `CREATE TABLE "public"."probe_child" ("id" UUID NOT NULL, "parent_id" UUID NOT NULL, "status" "public"."ProbeStatus" NOT NULL DEFAULT 'DRAFT', "amount" INTEGER NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "probe_child_pkey" PRIMARY KEY ("id"))`,
      `ALTER TABLE "public"."probe_child" ADD COLUMN "note" TEXT`,
      `CREATE INDEX "probe_child_parent_id_idx" ON "public"."probe_child"("parent_id")`,
      `CREATE UNIQUE INDEX "probe_parent_name_key" ON "public"."probe_parent"("name")`,
      `CREATE INDEX CONCURRENTLY "probe_child_created_at_idx" ON "public"."probe_child"("created_at")`,
      `CREATE INDEX "probe_parent_name_trgm_idx" ON "public"."probe_parent" USING GIN ("name" gin_trgm_ops)`,
      `ALTER TABLE "public"."probe_child" ALTER COLUMN "amount" SET DATA TYPE BIGINT`,
      `ALTER TABLE "public"."probe_child" ALTER COLUMN "note" SET DEFAULT ''`,
      `ALTER TABLE "public"."probe_child" ADD CONSTRAINT "probe_child_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."probe_parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      `ALTER TYPE "public"."ProbeStatus" ADD VALUE 'CANCELLED'`,
      `ALTER TABLE "public"."probe_child" RENAME COLUMN "note" TO "remark"`,
      `ALTER INDEX "public"."probe_child_parent_id_idx" RENAME TO "probe_child_parent_idx"`,
      `ALTER TABLE "public"."probe_parent" ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE "public"."probe_parent" FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY "probe_parent_select" ON "public"."probe_parent" FOR SELECT TO platform_app USING ("name" <> '')`,
      `GRANT SELECT, INSERT, UPDATE ON "public"."probe_parent" TO platform_app`,
      `CREATE FUNCTION platform.probe_helper() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$`,
      `DROP INDEX "public"."probe_child_created_at_idx"`,
      `ALTER TABLE "public"."probe_child" DROP CONSTRAINT "probe_child_parent_id_fkey"`,
      `ALTER TABLE "public"."probe_child" DROP COLUMN "remark"`,
      `ALTER TABLE "public"."probe_child" RENAME TO "probe_kid"`,
      `DROP POLICY "probe_parent_select" ON "public"."probe_parent"`,
      `DROP FUNCTION platform.probe_helper()`,
      `DROP TABLE "public"."probe_kid"`,
      `DROP TABLE "public"."probe_parent"`,
      `DROP TYPE "public"."ProbeStatus"`,
    ];
    const outcomes: { sql: string; outcome: Outcome }[] = [];
    const createSchema = await asMigrator(dbs.ddl, async (client) => {
      for (const sql of statements) outcomes.push({ sql, outcome: await execute(client, sql) });
      return execute(client, 'CREATE SCHEMA IF NOT EXISTS "public"');
    });
    for (const { sql, outcome } of outcomes) expect({ sql, outcome }).toEqual({ sql, outcome: OK });
    expect(createSchema).toMatchObject({ ok: false, code: '42501', refusedBy: 'privilege' });
  });
});
