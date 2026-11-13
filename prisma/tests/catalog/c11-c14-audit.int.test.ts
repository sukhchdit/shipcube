/**
 * Catalog suite `catalog-c11-c14-audit` (data-model.md §4.6 C6, C7, C14 remainder as amended 2026-11-13; §5.1-§5.3,
 * §5.7; ADR-0007 amendment 7; PR12-SEC-02/03/04, D-ARCH-076, D-SEC-PR12-01; US-094, US-095; TASK-021). Runs on a clone
 * of the fully migrated template (bootstrap lane incl. prisma/bootstrap/10-audit.sql and 90-audit-ddl-guard.sql, then
 * every Prisma migration). Every probe runs in a transaction that is always rolled back.
 *
 * Covered here: C6 (immutability triggers on audit_entries and every partition, ENABLE ALWAYS); C7 (manifest-driven via
 * the table-class flag `immutable`, with a planted negative); C14 remainder (event triggers, guard owner and
 * prosecdef, proconfig of the audit functions, OID rename probe, audit-owner converse, pg_depend check with planted
 * negatives); the PR12-SEC-02 identity test of ensure_audit_partitions; the database layer of AT-US-094-01/02/05 and
 * AT-US-095-01/03/05/06.
 *
 * Still pending, with owners: the full immutability-per-role generator over every audit table, path and client (SQL and
 * Prisma) -> TASK-033; the hourly verifier tripwire on tgenabled/evtenabled -> TASK-116; the SEC-TC-43 / SEC-TC-61
 * migrator-side probes (ported from the SPK-08 spike) -> prisma/tests/audit (TASK-021, specialist 21B); the readiness
 * contiguity check (apps/api audit-partitions) -> TASK-021 lead.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { immutableTables, loadTableClasses } from '../../../tools/db/table-classes.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres, SUPERUSER } from '../harness/postgres.js';

const AUDIT_OWNER = 'platform_audit_owner';
const ENTRIES = loadTableClasses();
const AUDIT_TABLES = ENTRIES.filter((entry) => entry.module === 'audit').map((entry) => entry.name);
const IMMUTABLE = immutableTables(ENTRIES);
/**
 * Trigger functions that count as an immutability trigger for C7. A later task that flags its own table `immutable`
 * (compliance_packs, pricing child tables, …) adds its function here.
 */
const IMMUTABILITY_FUNCTIONS = ['platform.audit_forbid_mutation()', 'platform.audit_vault_guard()'];
const GUARD_MESSAGE = 'audit objects are immutable (SEC-P3-03)';
const PARTITION_NAME = /^audit_entries_\d{4}_\d{2}$/;

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
});

type Row = pg.QueryResultRow;

interface Outcome {
  code: string;
  message: string;
  detail: string;
}

async function withClient<T>(config: pg.ClientConfig | 'superuser', fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = config === 'superuser' ? await db.superuser(database) : new pg.Client(config);
  if (config !== 'superuser') await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const query = <T extends Row>(sql: string, params: unknown[] = []): Promise<T[]> =>
  withClient('superuser', async (client) => (await client.query<T>(sql, params)).rows);

const rows = async <T extends Row>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T[]> =>
  (await client.query<T>(sql, params)).rows;

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack<T>(config: pg.ClientConfig | 'superuser', fn: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient(config, async (client) => {
    await client.query('BEGIN');
    try {
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

const field = (error: unknown, key: string): string => {
  const value: unknown = typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : '';
};

/** SQLSTATE, message and detail of `sql` inside a savepoint (the transaction stays usable); code 'none' on success. */
async function attempt(client: pg.Client, sql: string, params: unknown[] = []): Promise<Outcome> {
  await client.query('SAVEPOINT probe');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT probe');
    return { code: 'none', message: '', detail: '' };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    return { code: field(error, 'code'), message: field(error, 'message'), detail: field(error, 'detail') };
  }
}

/** `audit_entries_YYYY_MM` of the UTC month `offset` months from now (the naming of ensure_audit_partitions). */
async function partitionName(client: pg.Client, offset: number): Promise<string> {
  const [row] = await rows<{ name: string }>(
    client,
    `SELECT 'audit_entries_' || pg_catalog.to_char(pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC')
             + pg_catalog.make_interval(months => $1), 'YYYY_MM') AS name`,
    [offset],
  );
  if (row === undefined) throw new Error('partition name query returned no row');
  return row.name;
}

/** Disables both guard event triggers inside the caller's (rolled-back) superuser transaction. */
async function disableGuard(client: pg.Client): Promise<void> {
  await client.query(`ALTER EVENT TRIGGER platform_audit_ddl_guard_end DISABLE;
                      ALTER EVENT TRIGGER platform_audit_ddl_guard_drop DISABLE;`);
}

const ZERO = "pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')";
const ONES = "pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')";
const ACTOR = "'00000000-0000-7000-8000-000000000001'::uuid";

/** One valid row in each immutable audit table (inside the caller's rolled-back superuser transaction). */
async function seedAuditRows(client: pg.Client): Promise<void> {
  await client.query(`
    INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, actor_type, source_app, correlation_id, action,
                                      entity_name, outcome, prev_hash, entry_hash)
    VALUES (pg_catalog.uuidv7(), pg_catalog.now(), pg_catalog.gen_random_uuid(), 1, 'ANONYMOUS', 'api', 'c14-probe-0001', 'VIEW',
            'audit_entry', 'SUCCESS', ${ZERO}, ${ONES});
    INSERT INTO public.audit_checkpoint_heads (created_by, updated_by, checkpoint_entry_id, stream_id, entry_count, head_hash)
    VALUES (${ACTOR}, ${ACTOR}, pg_catalog.uuidv7(), pg_catalog.gen_random_uuid(), 1, ${ONES});
    INSERT INTO public.audit_anchors (anchor_seq, checkpoint_entry_id, created_at, heads_digest, prev_anchor_hash, anchor_hash,
                                      algorithm, key_id, signature)
    VALUES (1, pg_catalog.uuidv7(), pg_catalog.now(), ${ONES}, ${ZERO}, ${ONES}, 'ECDSA_P256_SHA256', 'audit-anchor-v1',
            pg_catalog.decode(pg_catalog.repeat('22', 70), 'hex'));
    INSERT INTO public.data_subjects (id, created_by, updated_by, kind, ref_id)
    VALUES ('00000000-0000-7000-8000-00000000c014', ${ACTOR}, ${ACTOR}, 'USER', pg_catalog.gen_random_uuid());
    INSERT INTO public.audit_pii_vault (created_by, updated_by, subject_id, classification, entity_name, field, value_hmac,
                                        value_hmac_key_id, ciphertext, ciphertext_key_id)
    VALUES (${ACTOR}, ${ACTOR}, '00000000-0000-7000-8000-00000000c014', 'PERSONAL', 'audit_entry', 'ip', ${ONES},
            'audit-vault-hmac-v1', pg_catalog.decode(pg_catalog.repeat('33', 40), 'hex'), 'audit-vault-v1');`);
}

/** Every non-internal trigger on an audit-owned relation, with its parent trigger (partition clones). */
const AUDIT_TRIGGERS_SQL = `
  SELECT c.relname, t.tgname, t.tgenabled::text AS tgenabled, t.tgtype::int AS tgtype, t.tgfoid::regprocedure::text AS fn,
         pt.tgname AS parent_trigger, c.relispartition AS partition
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    LEFT JOIN pg_catalog.pg_trigger pt ON pt.oid = t.tgparentid
   WHERE NOT t.tgisinternal AND c.relowner = '${AUDIT_OWNER}'::regrole
   ORDER BY 1, 2`;

interface TriggerRow {
  relname: string;
  tgname: string;
  tgenabled: string;
  tgtype: number;
  fn: string;
  parent_trigger: string | null;
  partition: boolean;
}

// pg_trigger.tgtype bits (include/catalog/pg_trigger.h)
const ROW = 1;
const BEFORE = 2;
const DELETE = 8;
const UPDATE = 16;
const TRUNCATE = 32;
const isRowUpdateDelete = (t: TriggerRow): boolean => (t.tgtype & (ROW | BEFORE | UPDATE | DELETE)) === (ROW | BEFORE | UPDATE | DELETE);
const isStatementTruncate = (t: TriggerRow): boolean => (t.tgtype & ROW) === 0 && (t.tgtype & (BEFORE | TRUNCATE)) === (BEFORE | TRUNCATE);

/** C7 findings for `tables`: each must carry a row UPDATE/DELETE and a TRUNCATE immutability trigger, ENABLE ALWAYS. */
function c7Findings(triggers: readonly TriggerRow[], tables: readonly string[]): string[] {
  return tables.flatMap((table) => {
    const own = triggers.filter((t) => t.relname === table && t.tgenabled === 'A' && IMMUTABILITY_FUNCTIONS.includes(t.fn));
    return [
      ...(own.some(isRowUpdateDelete) ? [] : [`${table}: no ENABLE ALWAYS BEFORE UPDATE OR DELETE row immutability trigger`]),
      ...(own.some((t) => isStatementTruncate(t) && t.fn === 'platform.audit_forbid_mutation()')
        ? []
        : [`${table}: no ENABLE ALWAYS BEFORE TRUNCATE immutability trigger`]),
    ];
  });
}

/** Functions owned by the audit owner, with prosecdef (C14 converse). */
const AUDIT_PROCS_SQL = `
  SELECT p.oid::regprocedure::text AS fn, p.prosecdef FROM pg_catalog.pg_proc p
   WHERE p.proowner = '${AUDIT_OWNER}'::regrole ORDER BY 1`;

/**
 * C14 dependency check (PR12-SEC-03 item 4): every pg_depend row whose dependent object belongs to an audit-owned
 * relation or function and whose referenced function/type/relation/operator/collation lies outside pg_catalog and is
 * owned by anyone other than platform_audit_owner or the bootstrap role.
 */
const AUDIT_DEPEND_SQL = `
  WITH audit_rel AS (SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relowner = '${AUDIT_OWNER}'::regrole),
  dependents AS (
    SELECT 'pg_catalog.pg_class'::regclass AS classid, oid AS objid FROM audit_rel
    UNION ALL SELECT 'pg_catalog.pg_proc'::regclass, p.oid FROM pg_catalog.pg_proc p WHERE p.proowner = '${AUDIT_OWNER}'::regrole
    UNION ALL SELECT 'pg_catalog.pg_constraint'::regclass, k.oid FROM pg_catalog.pg_constraint k WHERE k.conrelid IN (SELECT oid FROM audit_rel)
    UNION ALL SELECT 'pg_catalog.pg_trigger'::regclass, t.oid FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM audit_rel)
    UNION ALL SELECT 'pg_catalog.pg_attrdef'::regclass, a.oid FROM pg_catalog.pg_attrdef a WHERE a.adrelid IN (SELECT oid FROM audit_rel)
    UNION ALL SELECT 'pg_catalog.pg_rewrite'::regclass, w.oid FROM pg_catalog.pg_rewrite w WHERE w.ev_class IN (SELECT oid FROM audit_rel)
    UNION ALL SELECT 'pg_catalog.pg_policy'::regclass, y.oid FROM pg_catalog.pg_policy y WHERE y.polrelid IN (SELECT oid FROM audit_rel)),
  refs AS (
    SELECT d.classid, d.objid, d.refclassid, d.refobjid,
           CASE d.refclassid
             WHEN 'pg_catalog.pg_proc'::regclass      THEN (SELECT ARRAY[p.proowner, p.pronamespace] FROM pg_catalog.pg_proc p WHERE p.oid = d.refobjid)
             WHEN 'pg_catalog.pg_type'::regclass      THEN (SELECT ARRAY[t.typowner, t.typnamespace] FROM pg_catalog.pg_type t WHERE t.oid = d.refobjid)
             WHEN 'pg_catalog.pg_class'::regclass     THEN (SELECT ARRAY[c.relowner, c.relnamespace] FROM pg_catalog.pg_class c WHERE c.oid = d.refobjid)
             WHEN 'pg_catalog.pg_operator'::regclass  THEN (SELECT ARRAY[o.oprowner, o.oprnamespace] FROM pg_catalog.pg_operator o WHERE o.oid = d.refobjid)
             WHEN 'pg_catalog.pg_collation'::regclass THEN (SELECT ARRAY[l.collowner, l.collnamespace] FROM pg_catalog.pg_collation l WHERE l.oid = d.refobjid)
           END AS owner_ns
      FROM pg_catalog.pg_depend d JOIN dependents x ON x.classid = d.classid AND x.objid = d.objid)
  SELECT DISTINCT pg_catalog.pg_describe_object(r.refclassid, r.refobjid, 0) || ' (owner ' || pg_catalog.pg_get_userbyid(r.owner_ns[1]) || ')' AS finding
    FROM refs r
   WHERE r.owner_ns IS NOT NULL AND r.owner_ns[2] <> 'pg_catalog'::regnamespace
     AND r.owner_ns[1] NOT IN ('${AUDIT_OWNER}'::regrole, '${SUPERUSER}'::regrole)
   ORDER BY 1`;

describe('catalog-c11-c14-audit: immutability triggers (C6, C7; D-ARCH-076)', () => {
  it('[C6] audit_entries has the UPDATE/DELETE row trigger and the TRUNCATE trigger; every partition has the cloned row trigger (tgparentid) and its own TRUNCATE trigger; all ENABLE ALWAYS', async () => {
    const triggers = await query<TriggerRow>(AUDIT_TRIGGERS_SQL);
    const parent = triggers.filter((t) => t.relname === 'audit_entries');
    expect(parent.map((t) => [t.tgname, t.tgenabled, t.fn])).toEqual([
      ['trg_audit_entries__no_truncate', 'A', 'platform.audit_forbid_mutation()'],
      ['trg_audit_entries__no_update_delete', 'A', 'platform.audit_forbid_mutation()'],
    ]);
    expect(parent.filter(isRowUpdateDelete).map((t) => t.tgname)).toEqual(['trg_audit_entries__no_update_delete']);
    expect(parent.filter(isStatementTruncate).map((t) => t.tgname)).toEqual(['trg_audit_entries__no_truncate']);
    const partitions = await query<{ relname: string }>(
      `SELECT c.relname FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'public.audit_entries'::regclass ORDER BY 1`,
    );
    expect(partitions.length).toBeGreaterThanOrEqual(4);
    for (const { relname } of partitions) {
      const own = triggers.filter((t) => t.relname === relname);
      const shape = own
        .map((t) => ({ tgname: t.tgname, tgenabled: t.tgenabled, fn: t.fn, parent: t.parent_trigger }))
        .sort((a, b) => (a.tgname < b.tgname ? -1 : 1)); // code-point order, independent of the database collation
      expect(shape).toEqual([
        { tgname: `trg_${relname}__no_truncate`, tgenabled: 'A', fn: 'platform.audit_forbid_mutation()', parent: null },
        {
          tgname: 'trg_audit_entries__no_update_delete',
          tgenabled: 'A',
          fn: 'platform.audit_forbid_mutation()',
          parent: 'trg_audit_entries__no_update_delete',
        },
      ]);
      expect(own.filter(isStatementTruncate)).toHaveLength(1);
    }
    // Every audit trigger (tables, partitions, vault) is ENABLE ALWAYS; PG 18 clones the parent's 'A' onto partitions.
    expect(triggers.filter((t) => t.tgenabled !== 'A')).toEqual([]);
  }, 60_000);

  it('[C7] every table flagged immutable in the table-class manifests carries the immutability triggers, ENABLE ALWAYS', async () => {
    expect(IMMUTABLE).toEqual(expect.arrayContaining(['audit_anchors', 'audit_checkpoint_heads', 'audit_entries', 'audit_pii_vault']));
    const existing = (
      await query<{ relname: string }>(
        `SELECT c.relname FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1::text[])`,
        [IMMUTABLE],
      )
    ).map((row) => row.relname);
    expect(existing).toEqual(expect.arrayContaining(['audit_anchors', 'audit_checkpoint_heads', 'audit_entries', 'audit_pii_vault']));
    expect(c7Findings(await query<TriggerRow>(AUDIT_TRIGGERS_SQL), existing)).toEqual([]);
  }, 60_000);

  it('[C7] a planted (rolled-back) downgrade of an immutability trigger from ALWAYS to ORIGIN is reported', async () => {
    const found = await rolledBack('superuser', async (client) => {
      await disableGuard(client);
      await client.query('ALTER TABLE public.audit_anchors ENABLE TRIGGER trg_audit_anchors__immutable');
      await client.query('ALTER TABLE public.audit_pii_vault DISABLE TRIGGER trg_audit_pii_vault__no_truncate');
      return c7Findings(await rows<TriggerRow>(client, AUDIT_TRIGGERS_SQL), ['audit_anchors', 'audit_pii_vault']);
    });
    expect(found).toEqual([
      'audit_anchors: no ENABLE ALWAYS BEFORE UPDATE OR DELETE row immutability trigger',
      'audit_pii_vault: no ENABLE ALWAYS BEFORE TRUNCATE immutability trigger',
    ]);
  }, 60_000);
});

describe('catalog-c11-c14-audit: immutability per role (US-094, REQ-AUDIT-014/015)', () => {
  const ROLES = [APP_ROLE, MIGRATOR] as const;

  it('[AT-US-094-01] UPDATE, DELETE and TRUNCATE of audit_entries, a partition and the immutable tables fail with 42501 for platform_app and platform_migrator', async () => {
    const results = await rolledBack('superuser', async (client) => {
      await seedAuditRows(client);
      const current = await partitionName(client, 0);
      const out: Record<string, string> = {};
      for (const role of ROLES) {
        await client.query(`SET LOCAL ROLE ${role}`);
        const targets: [string, string, string][] = [
          ['audit_entries', 'audit_entries', 'route = route'],
          ['partition', current, 'route = route'],
          ['audit_checkpoint_heads', 'audit_checkpoint_heads', 'entry_count = entry_count'],
          ['audit_anchors', 'audit_anchors', 'key_id = key_id'],
          ['audit_pii_vault', 'audit_pii_vault', 'field = field'],
        ];
        for (const [label, table, set] of targets) {
          out[`${role} UPDATE ${label}`] = (await attempt(client, `UPDATE public.${table} SET ${set}`)).code;
          out[`${role} DELETE ${label}`] = (await attempt(client, `DELETE FROM public.${table}`)).code;
          out[`${role} TRUNCATE ${label}`] = (await attempt(client, `TRUNCATE public.${table}`)).code;
        }
        await client.query('RESET ROLE');
      }
      return out;
    });
    expect(Object.entries(results).filter(([, code]) => code !== '42501')).toEqual([]);
    expect(Object.keys(results)).toHaveLength(2 * 5 * 3);
  }, 60_000);

  it('[AT-US-094-01] the owner and the bootstrap superuser are stopped by the triggers (AUDIT_IMMUTABLE), also under session_replication_role = replica', async () => {
    const results = await rolledBack('superuser', async (client) => {
      await seedAuditRows(client);
      const current = await partitionName(client, 0);
      const statements: [string, string][] = [
        ['UPDATE audit_entries', "UPDATE public.audit_entries SET route = 'x'"],
        ['DELETE audit_entries', 'DELETE FROM public.audit_entries'],
        ['TRUNCATE audit_entries', 'TRUNCATE public.audit_entries'],
        ['UPDATE partition', `UPDATE public.${current} SET route = 'x'`],
        ['TRUNCATE partition', `TRUNCATE public.${current}`],
        ['UPDATE audit_checkpoint_heads', 'UPDATE public.audit_checkpoint_heads SET entry_count = entry_count + 1'],
        ['DELETE audit_anchors', 'DELETE FROM public.audit_anchors'],
        ['TRUNCATE audit_anchors', 'TRUNCATE public.audit_anchors'],
        ['DELETE audit_pii_vault', 'DELETE FROM public.audit_pii_vault'],
        ['TRUNCATE audit_pii_vault', 'TRUNCATE public.audit_pii_vault'],
      ];
      const out: Record<string, string> = {};
      for (const actor of ['superuser', 'owner', 'replica']) {
        if (actor === 'owner') await client.query(`SET LOCAL ROLE ${AUDIT_OWNER}`);
        if (actor === 'replica') await client.query("RESET ROLE; SET LOCAL session_replication_role = 'replica'");
        for (const [label, sql] of statements) {
          const outcome = await attempt(client, sql);
          out[`${actor} ${label}`] = `${outcome.code} ${outcome.message.split(':')[0] ?? ''}`;
        }
      }
      return out;
    });
    for (const [label, outcome] of Object.entries(results)) {
      expect({ label, outcome }).toEqual({
        label,
        outcome: label.endsWith('DELETE audit_pii_vault') ? '42501 AUDIT_VAULT_IMMUTABLE' : '42501 AUDIT_IMMUTABLE',
      });
    }
  }, 60_000);

  it('[AT-US-094-02] platform_app holds exactly SELECT, INSERT on the append-only audit tables and no privilege on any partition', async () => {
    const privileges = await query<{ relname: string; privs: string[] }>(
      `SELECT c.relname, ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                                WHERE pg_catalog.has_table_privilege($1, c.oid, p) ORDER BY 1) AS privs
         FROM pg_catalog.pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relowner = '${AUDIT_OWNER}'::regrole
        ORDER BY 1`,
      [APP_ROLE],
    );
    const byName = new Map(privileges.map((row) => [row.relname, row.privs]));
    for (const table of ['audit_entries', 'audit_checkpoint_heads', 'audit_anchors', 'audit_pii_vault', 'data_subjects']) {
      expect([table, byName.get(table)]).toEqual([table, ['INSERT', 'SELECT']]);
    }
    for (const table of ['audit_stream_heads', 'audit_partitions', 'audit_chain_verifications']) {
      expect([table, byName.get(table)]).toEqual([table, ['INSERT', 'SELECT', 'UPDATE']]);
    }
    const partitions = privileges.filter((row) => PARTITION_NAME.test(row.relname));
    expect(partitions.length).toBeGreaterThanOrEqual(4);
    expect(partitions.filter((row) => row.privs.length > 0)).toEqual([]);
  }, 60_000);

  it('[AT-US-094-05] platform_migrator cannot drop or disable an audit trigger, detach a partition or replace an audit function (42501)', async () => {
    const results = await rolledBack(db.migratorConnection(database), async (client) => {
      const current = await partitionName(client, 0);
      return {
        dropTrigger: (await attempt(client, 'DROP TRIGGER trg_audit_entries__no_update_delete ON public.audit_entries')).code,
        disable: (await attempt(client, 'ALTER TABLE public.audit_entries DISABLE TRIGGER ALL')).code,
        detach: (await attempt(client, `ALTER TABLE public.audit_entries DETACH PARTITION public.${current}`)).code,
        replace: (
          await attempt(
            client,
            `CREATE OR REPLACE FUNCTION platform.audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`,
          )
        ).code,
      };
    });
    expect(results).toEqual({ dropTrigger: '42501', disable: '42501', detach: '42501', replace: '42501' });
  }, 60_000);
});

describe('catalog-c11-c14-audit: partitions (US-095, REQ-AUDIT-016/017)', () => {
  it('[AT-US-095-01] the current month and the next three exist as attached audit-owned partitions carrying every parent index; no DEFAULT partition', async () => {
    const expected = await withClient('superuser', async (client) =>
      Promise.all([0, 1, 2, 3].map((offset) => partitionName(client, offset))),
    );
    const partitions = await query<{
      relname: string;
      owner: string;
      relkind: string;
      pending: boolean;
      bound: string;
      indexes: number;
      registry: number;
    }>(
      `SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner, c.relkind::text AS relkind, i.inhdetachpending AS pending,
              pg_catalog.pg_get_expr(c.relpartbound, c.oid) AS bound,
              (SELECT count(*)::int FROM pg_catalog.pg_index x JOIN pg_catalog.pg_inherits xi ON xi.inhrelid = x.indexrelid
                 JOIN pg_catalog.pg_index px ON px.indexrelid = xi.inhparent
                WHERE x.indrelid = c.oid AND px.indrelid = 'public.audit_entries'::regclass) AS indexes,
              (SELECT count(*)::int FROM public.audit_partitions r WHERE r.partition_name = c.relname) AS registry
         FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'public.audit_entries'::regclass ORDER BY 1`,
    );
    expect(partitions.map((p) => p.relname)).toEqual(expect.arrayContaining(expected));
    const parentIndexes = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_catalog.pg_index WHERE indrelid = 'public.audit_entries'::regclass`,
    );
    expect(parentIndexes[0]?.n).toBe(12); // PK, unique hash, ten secondary (§3.4 "12 index entries per audit insert")
    for (const partition of partitions) {
      expect(partition).toEqual({
        relname: partition.relname,
        owner: AUDIT_OWNER,
        relkind: 'r',
        pending: false,
        bound: expect.stringMatching(/^FOR VALUES FROM \('\d{4}-\d{2}-01 00:00:00\+00'\) TO \('\d{4}-\d{2}-01 00:00:00\+00'\)$/),
        indexes: 12,
        registry: 1,
      });
    }
    expect(partitions.filter((p) => p.bound === 'DEFAULT')).toEqual([]);
  }, 60_000);

  it('[AT-US-095-03] [AT-US-095-06] a second ensure_audit_partitions(3) run as platform_app returns 0 and changes nothing (idempotent daily job)', async () => {
    const snapshot = async () =>
      query<{ partitions: number; registry: number }>(
        `SELECT (SELECT count(*)::int FROM pg_catalog.pg_inherits WHERE inhparent = 'public.audit_entries'::regclass) AS partitions,
                (SELECT count(*)::int FROM public.audit_partitions) AS registry`,
      );
    const before = await snapshot();
    const created = await withClient(db.appConnection(database), async (client) => [
      ...(await rows<{ n: number }>(client, 'SELECT platform.ensure_audit_partitions(3) AS n')),
      ...(await rows<{ n: number }>(client, 'SELECT platform.ensure_audit_partitions(3) AS n')),
    ]);
    expect(created).toEqual([{ n: 0 }, { n: 0 }]);
    expect(await snapshot()).toEqual(before);
    const bad = await rolledBack(db.appConnection(database), async (client) => ({
      negative: await attempt(client, 'SELECT platform.ensure_audit_partitions(-1)'),
      tooMany: await attempt(client, 'SELECT platform.ensure_audit_partitions(13)'),
    }));
    expect([bad.negative.code, bad.tooMany.code]).toEqual(['22023', '22023']);
  }, 60_000);

  it('[AT-US-095-05] an insert outside every partition fails closed (no DEFAULT partition, 23514)', async () => {
    const outcome = await rolledBack(db.appConnection(database), async (client) =>
      attempt(
        client,
        `INSERT INTO public.audit_entries (id, occurred_at, stream_id, stream_seq, actor_type, source_app, correlation_id, action,
                                           entity_name, outcome, prev_hash, entry_hash)
         VALUES (pg_catalog.gen_random_uuid(), pg_catalog.now() + interval '3 years', pg_catalog.gen_random_uuid(), 1, 'ANONYMOUS',
                 'api', 'c14-probe-0002', 'VIEW', 'audit_entry', 'SUCCESS', ${ZERO}, ${ONES})`,
      ),
    );
    expect(outcome.code).toBe('23514');
  }, 60_000);
});

describe('catalog-c11-c14-audit: identity test of ensure_audit_partitions (PR12-SEC-02 items 2-4)', () => {
  it('[PR12-SEC-02] with the guard on, the migrator cannot squat a partition name with an index, view or enum (guard 42501)', async () => {
    const results = await rolledBack(db.migratorConnection(database), async (client) => {
      const name = await partitionName(client, 5);
      await client.query('CREATE TABLE public.c14_probe (id integer)');
      return {
        index: await attempt(client, `CREATE INDEX ${name} ON public.c14_probe (id)`),
        view: await attempt(client, `CREATE VIEW public.${name} AS SELECT 1 AS one`),
        enumType: await attempt(client, `CREATE TYPE public.${name} AS ENUM ('a')`),
        rename: await attempt(client, `ALTER TABLE public.c14_probe RENAME TO ${name}`),
      };
    });
    for (const outcome of Object.values(results)) expect([outcome.code, outcome.message]).toEqual(['42501', GUARD_MESSAGE]);
  }, 60_000);

  it('[PR12-SEC-02] with the guard disabled, a squatting index, view or enum makes ensure_audit_partitions(6) raise AUDIT_PARTITION_NAME_TAKEN; nothing is skipped', async () => {
    const results = await rolledBack('superuser', async (client) => {
      await disableGuard(client);
      const name = await partitionName(client, 5);
      await client.query(`SET LOCAL ROLE ${MIGRATOR}; CREATE TABLE public.c14_probe (id integer); RESET ROLE;`);
      const squat = async (ddl: string): Promise<Outcome & { name: string }> => {
        await client.query('SAVEPOINT squat');
        await client.query(`SET LOCAL ROLE ${MIGRATOR}; ${ddl}; RESET ROLE;`);
        const outcome = await attempt(client, 'SELECT platform.ensure_audit_partitions(6)');
        await client.query('ROLLBACK TO SAVEPOINT squat');
        return { ...outcome, name };
      };
      return {
        index: await squat(`CREATE INDEX ${name} ON public.c14_probe (id)`),
        view: await squat(`CREATE VIEW public.${name} AS SELECT 1 AS one`),
        enumType: await squat(`CREATE TYPE public.${name} AS ENUM ('a')`),
        table: await squat(`CREATE TABLE public.${name} (LIKE public.c14_probe)`),
      };
    });
    for (const outcome of Object.values(results)) {
      expect({ code: outcome.code, message: outcome.message, detail: outcome.detail }).toEqual({
        code: '42501',
        message: 'AUDIT_PARTITION_NAME_TAKEN',
        detail: outcome.name,
      });
    }
  }, 60_000);

  it('[PR12-SEC-02] an attached partition with the wrong bounds raises AUDIT_PARTITION_BOUNDS_MISMATCH', async () => {
    const outcome = await rolledBack('superuser', async (client) => {
      const name = await partitionName(client, 5);
      await client.query(`SET LOCAL ROLE ${AUDIT_OWNER};
        CREATE TABLE public.${name} (LIKE public.audit_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED);
        ALTER TABLE public.audit_entries ATTACH PARTITION public.${name}
          FOR VALUES FROM ('${name.slice(14, 18)}-${name.slice(19, 21)}-01 00:00:00+00') TO ('${name.slice(14, 18)}-${name.slice(19, 21)}-15 00:00:00+00');
        RESET ROLE;`);
      return { ...(await attempt(client, 'SELECT platform.ensure_audit_partitions(6)')), name };
    });
    expect({ code: outcome.code, message: outcome.message, detail: outcome.detail }).toEqual({
      code: '42501',
      message: 'AUDIT_PARTITION_BOUNDS_MISMATCH',
      detail: outcome.name,
    });
  }, 60_000);
});

describe('catalog-c11-c14-audit: DDL guard and ownership (C14 remainder, PR12-SEC-03/04)', () => {
  it('[C14] both event triggers exist, call platform.audit_ddl_guard(), are ENABLE ALWAYS and owned by the bootstrap role; the guard is bootstrap-owned and not SECURITY DEFINER', async () => {
    const triggers = await query(
      `SELECT e.evtname, e.evtevent, e.evtenabled::text AS evtenabled, pg_catalog.pg_get_userbyid(e.evtowner) AS owner,
              e.evtfoid::regprocedure::text AS fn
         FROM pg_catalog.pg_event_trigger e ORDER BY 1`,
    );
    expect(triggers).toEqual([
      {
        evtname: 'platform_audit_ddl_guard_drop',
        evtevent: 'sql_drop',
        evtenabled: 'A',
        owner: SUPERUSER,
        fn: 'platform.audit_ddl_guard()',
      },
      {
        evtname: 'platform_audit_ddl_guard_end',
        evtevent: 'ddl_command_end',
        evtenabled: 'A',
        owner: SUPERUSER,
        fn: 'platform.audit_ddl_guard()',
      },
    ]);
    const guard = await query(
      `SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
              pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_catalog.pg_proc p WHERE p.oid = 'platform.audit_ddl_guard()'::regprocedure`,
    );
    expect(guard).toEqual([{ owner: SUPERUSER, prosecdef: false, public_execute: false }]);
  }, 60_000);

  it('[C14] (a) the three non-definer audit functions have prosecdef = false and exactly one search_path entry, search_path=pg_catalog, pg_temp', async () => {
    const functions = await query(
      `SELECT p.oid::regprocedure::text AS fn, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
        WHERE p.oid IN ('platform.audit_forbid_mutation()'::regprocedure, 'platform.audit_vault_guard()'::regprocedure,
                        'platform.audit_ddl_guard()'::regprocedure)
        ORDER BY 1`,
    );
    expect(functions).toEqual(
      ['platform.audit_ddl_guard()', 'platform.audit_forbid_mutation()', 'platform.audit_vault_guard()'].map((fn) => ({
        fn,
        prosecdef: false,
        proconfig: ['search_path=pg_catalog, pg_temp'],
      })),
    );
  }, 60_000);

  it('[C14] (b) the guard matches public and platform by OID: a superuser rename of either raises 42501 with the guard message', async () => {
    const results = await rolledBack('superuser', async (client) => ({
      publicRename: await attempt(client, 'ALTER SCHEMA public RENAME TO c14_x'),
      platformRename: await attempt(client, 'ALTER SCHEMA platform RENAME TO c14_y'),
      publicOwner: await attempt(client, `ALTER SCHEMA public OWNER TO ${MIGRATOR}`),
    }));
    for (const outcome of Object.values(results)) expect([outcome.code, outcome.message]).toEqual(['42501', GUARD_MESSAGE]);
  }, 60_000);

  it('[C14] converse: platform_audit_owner owns exactly the three audit functions (one definer) and only audit relations; platform_schema_owner owns no function or relation', async () => {
    expect(await query(AUDIT_PROCS_SQL)).toEqual([
      { fn: 'platform.audit_forbid_mutation()', prosecdef: false },
      { fn: 'platform.audit_vault_guard()', prosecdef: false },
      { fn: 'platform.ensure_audit_partitions(integer)', prosecdef: true },
    ]);
    const relations = await query<{ relname: string; relkind: string; base: string | null }>(
      `SELECT c.relname, c.relkind::text AS relkind, b.relname AS base
         FROM pg_catalog.pg_class c
         LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
         LEFT JOIN pg_catalog.pg_class b ON b.oid = i.indrelid
        WHERE c.relowner = '${AUDIT_OWNER}'::regrole AND c.relnamespace = 'public'::regnamespace ORDER BY 1`,
    );
    const isAuditTable = (name: string | null): boolean => name !== null && (AUDIT_TABLES.includes(name) || PARTITION_NAME.test(name));
    const unexpected = relations.filter((r) =>
      r.relkind === 'r' || r.relkind === 'p' ? !isAuditTable(r.relname) : !(['i', 'I'].includes(r.relkind) && isAuditTable(r.base)),
    );
    expect(unexpected).toEqual([]);
    expect(relations.filter((r) => r.relkind === 'r' || r.relkind === 'p').map((r) => r.relname)).toEqual(
      expect.arrayContaining(AUDIT_TABLES),
    );
    const schemaOwner = await query(
      `SELECT (SELECT count(*)::int FROM pg_catalog.pg_proc WHERE proowner = 'platform_schema_owner'::regrole) AS procs,
              (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relowner = 'platform_schema_owner'::regrole) AS relations`,
    );
    expect(schemaOwner).toEqual([{ procs: 0, relations: 0 }]);
  }, 60_000);

  it('[C14] converse negative: a second (rolled-back) audit-owner definer function is reported', async () => {
    const procs = await rolledBack('superuser', async (client) => {
      await client.query(`SET LOCAL ROLE ${AUDIT_OWNER};
        CREATE FUNCTION platform.c14_second_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER
          SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;
        RESET ROLE;`);
      return rows<{ fn: string; prosecdef: boolean }>(client, AUDIT_PROCS_SQL);
    });
    expect(procs.filter((p) => p.prosecdef).map((p) => p.fn)).toEqual([
      'platform.c14_second_definer()',
      'platform.ensure_audit_partitions(integer)',
    ]);
  }, 60_000);

  it('[C14] pg_depend: no audit-owned relation or function depends on an object outside pg_catalog owned by another role; a planted (rolled-back) CHECK calling a migrator function is reported', async () => {
    expect(await query(AUDIT_DEPEND_SQL)).toEqual([]);
    const found = await rolledBack('superuser', async (client) => {
      await disableGuard(client);
      await client.query(`SET LOCAL ROLE ${MIGRATOR};
        CREATE FUNCTION platform.c14_helper(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
        RESET ROLE;
        ALTER TABLE public.audit_entries ADD CONSTRAINT ck_audit_entries__c14 CHECK (platform.c14_helper(correlation_id));`);
      return (await rows<{ finding: string }>(client, AUDIT_DEPEND_SQL)).map((row) => row.finding);
    });
    expect(found).toEqual([`function platform.c14_helper(text) (owner ${MIGRATOR})`]);
  }, 60_000);
});
