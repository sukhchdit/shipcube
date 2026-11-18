/**
 * Catalog suite `catalog-c1-c14` (data-model.md §4.6 C1-C14 as amended 2026-11-12; ADR-0005 and am. 9-10;
 * US-074, US-075; PR8-SEC-10, PR8-SEC-14; PR5-SEC-09; TASK-016). Runs on a clone of the fully migrated template
 * (bootstrap lane + every Prisma migration). Probes (planted tables, functions, policies, role links) are created
 * inside transactions that are always rolled back (SPK-03 F-13: in-test DDL as the migrator, seed before FORCE), so
 * the committed catalogue is never changed.
 *
 * Today the schema holds no RLS table yet (the first tenant tables arrive with TASK-037/051); the RLS assertions are
 * therefore proven on a TENANT probe rendered by tools/db/render-rls.ts, and the committed-state assertions run on
 * the real catalogue so they bind every later migration.
 *
 * Implemented here: C1-C5, C8, C9, C11, C12 (on the probe), C13, C14 (owner/enabled summary). C6, C7 and the C14
 * remainder (immutability triggers incl. partitions, manifest-driven C7, event-trigger owner, proconfig of the audit
 * functions, OID rename probe, audit-owner converse, pg_depend check) are in c11-c14-audit.int.test.ts (TASK-021).
 * Deferred, with owners (PR #11 review m4): C10 -> TASK-028 (classification registry); the per-table C12 generator
 * -> TASK-024; the full immutability-per-role generator -> TASK-033; the verifier tripwire on tgenabled/evtenabled ->
 * TASK-116.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { SEED_SOURCE } from '../../../tools/authz/generate.js';
import { grantTuples, loadGrantsManifest, validateGrants } from '../../../tools/db/grants-manifest.js';
import { renderRls } from '../../../tools/db/render-rls.js';
import { splitStatements } from '../../../tools/db/sql-text.js';
import { RLS_CLASSES, loadTableClasses, rlsAllowList, type TableClassEntry } from '../../../tools/db/table-classes.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres, SUPERUSER } from '../harness/postgres.js';
import {
  CONTEXT_HELPERS,
  bodySha256,
  drA14Findings,
  dynamicSqlFindings,
  enumCheckValues,
  scanFunctionBodies,
  scanPolicies,
  type CheckRow,
  type DynamicSqlRow,
  type FunctionRow,
  type PolicyRow,
  type ReviewedBody,
} from './scans.js';

const repoRoot = findRepoRoot();
const ENTRIES = loadTableClasses();
const ALLOW_LIST = rlsAllowList(ENTRIES);
const DEFINER_TABLES = new Set(ENTRIES.filter((e) => e.definerRead === true || e.definerPurge === true).map((e) => e.name));
const HARD_DELETE = new Set(ENTRIES.filter((e) => e.hardDelete === true).map((e) => e.name));
const APP_IS_OPERATOR_TEMPLATE = readFileSync(join(repoRoot, 'prisma', 'sql', 'function-templates', 'app-is-operator.sql'), 'utf8');
/** RDS master at M5 (C13 (b)/(c)); empty locally. */
const MASTER_ROLE = process.env['CATALOG_BOOTSTRAP_MASTER_ROLE'] ?? '';
const SYSTEM_ACTOR = '00000000-0000-7000-8000-000000000001';

const ORG_A = randomUUID();
const ORG_B = randomUUID();
/**
 * The reserved operator organisation (D-ARCH-151; `OPERATOR_ORG_ID`, repeated because prisma/tests may not import
 * @platform/shared). The committed migration inserts it, so no fixture plants an OPERATOR organisation any more: the
 * probe only adds the operator membership to it.
 */
const OPERATOR_ORG = '00000000-0000-7000-8000-000000000010';
const OPERATOR_USER = randomUUID();
const CUSTOMER_USER = randomUUID();
const ROW_A = randomUUID();
const ROW_B = randomUUID();

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

/** SQLSTATE of `sql` inside a savepoint (the transaction stays usable), or 'none'. */
async function sqlState(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT probe');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT probe');
    return 'none';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    return String((error as { code?: unknown }).code);
  }
}

const rows = async <T extends Row>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T[]> =>
  (await client.query<T>(sql, params)).rows;

// ---------------------------------------------------------------------------------------------------------------------
// Catalog queries (shared by the committed-state checks and the probes)
// ---------------------------------------------------------------------------------------------------------------------

const C1_SQL = `
  SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname <> ALL ($1::text[])
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
   ORDER BY 1`;

const C2_SQL = `
  WITH keyed AS (
    SELECT c.oid, c.relname, a.attnum, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
                                    AND a.attname = CASE WHEN c.relname = 'organisations' THEN 'id' ELSE 'org_id' END
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname <> ALL ($1::text[]))
  SELECT k.relname FROM keyed k
   WHERE NOT (k.relrowsecurity AND k.relforcerowsecurity
              AND EXISTS (SELECT FROM pg_catalog.pg_policy p WHERE p.polrelid = k.oid AND 'platform_app'::regrole = ANY (p.polroles))
              AND EXISTS (SELECT FROM pg_catalog.pg_index i WHERE i.indrelid = k.oid AND i.indkey[0] = k.attnum))
   ORDER BY 1`;

const C3_SQL = `
  SELECT c.relname AS "table", p.polname AS policy, p.polcmd::text AS cmd,
         ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE r::regrole::text END FROM pg_catalog.unnest(p.polroles) r ORDER BY 1) AS roles,
         p.polpermissive AS permissive,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS qual, pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
   ORDER BY 1, 2`;

const USER_NAMESPACES = `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'`;

const PROSRC_SQL = `
  SELECT p.oid::regprocedure::text AS fn, p.prosrc FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE ${USER_NAMESPACES} ORDER BY 1`;

const DEFINER_SQL = `
  SELECT p.oid::regprocedure::text AS fn, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig,
         ARRAY(SELECT CASE WHEN a.grantee = 0 THEN 'public' ELSE a.grantee::regrole::text END
                 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner ORDER BY 1) AS execute
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef AND ${USER_NAMESPACES} ORDER BY 1`;

/** The C11 proconfig query of data-model §4.6 (every schema). */
const DEFINER_PATH_SQL = `
  SELECT p.oid::regprocedure::text AS fn FROM pg_catalog.pg_proc p
   WHERE p.prosecdef AND (p.proconfig IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY (p.proconfig))
          OR (SELECT count(*) FROM pg_catalog.unnest(p.proconfig) c WHERE c LIKE 'search_path=%') <> 1)`;

/** PR8-SEC-14 (D-ARCH-069): escalation backstop keyed on the KEY RULE, not on operator_only. */
const ESCALATION_SQL = `
  SELECT r.key AS role, p.key AS permission
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE r.scope <> 'OPERATOR'
     AND (p.key ~ '(^|:)any_org(:|$)' OR p.key LIKE 'audit:%' OR p.key IN ('featureflag:manage', 'carrier:status:read'))
   ORDER BY 1, 2`;

/**
 * C5 live grants, table and column ACLs. PUBLIC (grantee 0) is included and rendered as `PUBLIC`: platform_app holds
 * every PUBLIC grant implicitly, and the manifest cannot express PUBLIC, so any such row fails the equality
 * (PR11-SEC-04, review m2).
 */
const GRANTEE = `CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END`;
const ACL_GRANTEES = `(a.grantee = 0 OR a.grantee::regrole::text IN ('platform_app', 'platform_definer', 'platform_erasure'))`;
const TABLE_ACL_SQL = `
  SELECT ${GRANTEE} || ' ' || a.privilege_type || ' ' || n.nspname || '.' || c.relname || ' *' AS grant
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace, pg_catalog.aclexplode(c.relacl) a
   WHERE n.nspname IN ('public', 'platform') AND ${ACL_GRANTEES}
  UNION ALL
  SELECT ${GRANTEE} || ' ' || a.privilege_type || ' ' || n.nspname || '.' || c.relname || ' ' || att.attname
    FROM pg_catalog.pg_attribute att JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace, pg_catalog.aclexplode(att.attacl) a
   WHERE n.nspname IN ('public', 'platform') AND ${ACL_GRANTEES}
   ORDER BY 1`;

/** C11: SECURITY DEFINER functions allowed by data-model §4.5 / C11, with their owner (§4.5 functions join at TASK-037). */
const DEFINER_ALLOWED = new Map([
  ['platform.app_is_operator()', 'platform_definer'],
  ['platform.ensure_audit_partitions(integer)', 'platform_audit_owner'],
]);

/** C11 converse (PR11-SEC-06, D-ORCH-005 (7)): every object platform_definer owns. */
const DEFINER_OWNED_SQL = `
  SELECT 'proc ' || p.oid::regprocedure::text AS obj FROM pg_catalog.pg_proc p WHERE p.proowner = 'platform_definer'::regrole
  UNION ALL SELECT 'rel ' || c.oid::regclass::text FROM pg_catalog.pg_class c WHERE c.relowner = 'platform_definer'::regrole
  UNION ALL SELECT 'type ' || t.oid::regtype::text FROM pg_catalog.pg_type t WHERE t.typowner = 'platform_definer'::regrole
  UNION ALL SELECT 'schema ' || n.nspname FROM pg_catalog.pg_namespace n WHERE n.nspowner = 'platform_definer'::regrole
   ORDER BY 1`;

/** Objects owned by platform_definer that are not an allow-listed definer function of its own. */
const unexpectedDefinerObjects = (owned: readonly { obj: string }[]): string[] =>
  owned.map((row) => row.obj).filter((obj) => !(obj.startsWith('proc ') && DEFINER_ALLOWED.get(obj.slice(5)) === 'platform_definer'));

/**
 * C8 (NFR-DATA-001/002): no `timestamp without time zone`; every `id` of a public base table (outside the Prisma and
 * bootstrap bookkeeping tables) is `uuid DEFAULT uuidv7()`; every `*_minor` column is bigint and its table carries a
 * `^[A-Z]{3}$` currency CHECK.
 */
const C8_SQL = `
  SELECT c.table_name || '.' || c.column_name || ': timestamp without time zone' AS finding FROM information_schema.columns c
   WHERE c.table_schema IN ('public', 'platform') AND c.data_type = 'timestamp without time zone'
  UNION ALL
  SELECT c.table_name || '.id: ' || c.data_type || ' DEFAULT ' || coalesce(c.column_default, 'none') FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.table_name <> '_prisma_migrations'
     AND c.table_name NOT LIKE 'bootstrap\\_migrations%' AND (c.data_type <> 'uuid' OR c.column_default IS DISTINCT FROM 'uuidv7()')
     -- audit_entries (and its partitions): the id is a UUIDv7 set by packages/audit before hashing (data-model §3.4), so
     -- the column is uuid WITHOUT a default; a default would let an unhashed id in.
     AND NOT (c.table_name ~ '^audit_entries(_[0-9]{4}_[0-9]{2})?$' AND c.data_type = 'uuid' AND c.column_default IS NULL)
  UNION ALL
  SELECT c.table_name || '.' || c.column_name || ': ' || c.data_type || ' minor-unit column without bigint + currency CHECK'
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.column_name LIKE '%\\_minor'
     AND (c.data_type <> 'bigint' OR NOT EXISTS (
          SELECT FROM pg_catalog.pg_constraint k WHERE k.conrelid = pg_catalog.format('%I.%I', c.table_schema, c.table_name)::regclass
             AND k.contype = 'c' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%^[A-Z]{3}$%'))
   ORDER BY 1`;

/** C9: CHECK constraints in public that hold an IN list (deparsed `= ANY (ARRAY[…])`). */
const C9_SQL = `
  SELECT k.conname, pg_catalog.pg_get_constraintdef(k.oid) AS def FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_namespace n ON n.oid = k.connamespace
   WHERE n.nspname = 'public' AND k.contype = 'c' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%= ANY (%' ORDER BY 1`;

/**
 * C9 source of truth: the enum CHECKs and their TypeScript lists. prisma/tests may not import packages/authz directly
 * (boundaries), so the role scopes come from the seed source (tools/authz), which is the @platform/authz ROLES list.
 */
const ENUM_CHECKS: Record<string, string[]> = {
  ck_roles__scope: [...new Set(SEED_SOURCE.roles.map((role) => role.scope))].sort(),
  // Audit store (TASK-021, prisma/bootstrap/10-audit.sql; data-model §3.4, §5.1, §5.7). No TypeScript list exists yet:
  // the lists are pinned from the data model here, and the packages/audit enums must equal them when they land.
  ck_audit_chain_verifications__failure_kind: [
    'ANCHOR_MISSING',
    'CHECKPOINT_HEAD_MISMATCH',
    'CHECKPOINT_SIGNATURE_INVALID',
    'DUPLICATE_ENTRY_HASH',
    'HASH_MISMATCH',
    'HEAD_MISMATCH',
    'PREV_HASH_MISMATCH',
    'SEQ_DUPLICATE',
    'SEQ_GAP',
  ],
  ck_audit_chain_verifications__run_kind: ['FULL', 'INCREMENTAL'],
  ck_audit_chain_verifications__status: ['ERROR', 'FAILED', 'PASSED', 'RUNNING'],
  // The 20 REQ-AUDIT-002 actions after 91-audit-actions-v2.sql (TASK-285, D-ARCH-119); equality with the packages/audit
  // AUDIT_ENTRY_ACTIONS list (which prisma/tests/catalog may not import) is prisma/tests/audit/audit-actions-v2.int.test.ts.
  ck_audit_entries__action: [
    'ACCOUNT_LOCKED',
    'API_KEY_USE',
    'CONFIG_CHANGE',
    'CREATE',
    'DELETE',
    'DOWNLOAD',
    'EXPORT',
    'LOGIN',
    'LOGIN_FAILED',
    'LOGOUT',
    'MFA_ENROLLED',
    'MFA_FAILED',
    'MFA_RECOVERY_USED',
    'ON_BEHALF_ACTION',
    'PERMISSION_DENIED',
    'SESSION_REVOKED',
    'STATE_TRANSITION',
    'TOKEN_REUSE_DETECTED',
    'UPDATE',
    'VIEW',
  ],
  ck_audit_entries__actor_type: ['ANONYMOUS', 'API_KEY', 'SYSTEM_JOB', 'USER'],
  ck_audit_entries__outcome: ['DENIED', 'FAILED', 'SUCCESS'],
  ck_audit_entries__source_app: ['admin', 'api', 'web', 'worker'],
  ck_audit_pii_vault__classification: ['PERSONAL', 'SENSITIVE_PERSONAL'],
  ck_data_subjects__kind: ['CONTACT', 'USER'],
};

const names = (list: readonly { relname: string }[]): string[] => list.map((row) => row.relname);

// ---------------------------------------------------------------------------------------------------------------------
// The TENANT probe (rendered by the RLS renderer; always rolled back)
// ---------------------------------------------------------------------------------------------------------------------

const PROBE = 'c_probe_parcels';

/**
 * The subset of `tables` (public, unqualified names) that already exist in the catalogue the caller sees. TASK-037
 * commits `organisations` / `memberships` and TASK-049 `users` (R1-m3): the probes plant a minimal table only when the
 * real one is absent, so they never collide with it (42P07).
 */
async function committedTables(client: pg.Client, tables: readonly string[]): Promise<Set<string>> {
  const found = await rows<{ name: string }>(
    client,
    `SELECT t AS name FROM pg_catalog.unnest($1::text[]) t WHERE pg_catalog.to_regclass(pg_catalog.format('public.%I', t)) IS NOT NULL`,
    [tables],
  );
  return new Set(found.map((row) => row.name));
}

/**
 * Inside the caller's transaction on a superuser session: as the migrator, plant minimal `memberships` /
 * `organisations` tables when the real ones are absent (TASK-037 creates them; R1-m3) and `platform.app_is_operator()`
 * from its template (lead decision 5), then the TENANT probe table with its leading-org_id index, seed rows (before
 * FORCE) and the RLS block rendered by tools/db/render-rls.ts. When the real tables exist (TASK-037), the seed rows go
 * in as the superuser (RLS bypassed) with every NOT NULL column, under `session_replication_role = replica` so the
 * foreign keys to users and the standard-columns guard do not fire for these synthetic, rolled-back rows; the
 * committed `platform.app_is_operator()` is used as it is. The operator membership then goes into the reserved
 * operator organisation of the migration (D-ARCH-151); no OPERATOR organisation is planted.
 */
async function plantProbe(client: pg.Client): Promise<string> {
  const committed = await committedTables(client, ['memberships', 'organisations']);
  await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
  if (!committed.has('memberships')) {
    await client.query(`
      CREATE TABLE public.memberships (id uuid PRIMARY KEY, org_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL);
      GRANT SELECT ON public.memberships TO platform_definer;`);
  }
  if (!committed.has('organisations')) {
    await client.query(`
      CREATE TABLE public.organisations (id uuid PRIMARY KEY, type text NOT NULL);
      GRANT SELECT ON public.organisations TO platform_definer;`);
  }
  if (committed.size > 0) {
    await client.query('RESET ROLE');
    await client.query(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.organisations (id, type, display_name, created_by, updated_by) VALUES
        ('${ORG_A}', 'BUSINESS_CUSTOMER', 'Org A', '${SYSTEM_ACTOR}', '${SYSTEM_ACTOR}');
      INSERT INTO public.memberships (id, org_id, user_id, status, created_by, updated_by) VALUES
        ('${randomUUID()}', '${OPERATOR_ORG}', '${OPERATOR_USER}', 'ACTIVE', '${SYSTEM_ACTOR}', '${SYSTEM_ACTOR}'),
        ('${randomUUID()}', '${ORG_A}', '${CUSTOMER_USER}', 'ACTIVE', '${SYSTEM_ACTOR}', '${SYSTEM_ACTOR}');
      SET LOCAL session_replication_role = origin;`);
  } else {
    await client.query(`
      INSERT INTO public.organisations (id, type) VALUES ('${OPERATOR_ORG}', 'OPERATOR'), ('${ORG_A}', 'BUSINESS_CUSTOMER');
      INSERT INTO public.memberships (id, org_id, user_id, status) VALUES
        ('${randomUUID()}', '${OPERATOR_ORG}', '${OPERATOR_USER}', 'ACTIVE'), ('${randomUUID()}', '${ORG_A}', '${CUSTOMER_USER}', 'ACTIVE');`);
  }
  await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
  await client.query(`
    CREATE TABLE public.${PROBE} (id uuid PRIMARY KEY, org_id uuid NOT NULL, ref text NOT NULL);
    CREATE INDEX ix_${PROBE}__org_id ON public.${PROBE} (org_id);
    GRANT SELECT, INSERT, UPDATE ON public.${PROBE} TO platform_app;
    INSERT INTO public.${PROBE} (id, org_id, ref) VALUES ('${ROW_A}', '${ORG_A}', 'A1'), ('${ROW_B}', '${ORG_B}', 'B1');`);
  // The template ends with RESET ROLE (to the session user); once TASK-037 committed the function it is used as it is.
  const operatorFn = await rows<{ fn: string | null }>(
    client,
    "SELECT pg_catalog.to_regprocedure('platform.app_is_operator()')::text AS fn",
  );
  if (operatorFn[0]?.fn === null || operatorFn[0]?.fn === undefined) await client.query(APP_IS_OPERATOR_TEMPLATE);
  else await client.query('RESET ROLE');
  await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
  const rendered = renderRls({ module: 'probe', name: PROBE, class: 'TENANT' });
  await client.query(rendered);
  await client.query('RESET ROLE');
  return rendered;
}

const PROBE_ENTRY: TableClassEntry = { module: 'probe', name: PROBE, class: 'TENANT' };
/** The DR-A14 sets as TASK-037/049 will list them (rendered on the plantProbe tables plus a minimal users table). */
const DR_A14_ENTRIES: readonly TableClassEntry[] = [
  { module: 'probe', name: 'memberships', class: 'TENANT', policySet: 'dr-a14-memberships', definerRead: true },
  { module: 'probe', name: 'organisations', class: 'TENANT', policySet: 'dr-a14-organisations', definerRead: true },
  { module: 'probe', name: 'users', class: 'USER_OWNED', policySet: 'dr-a14-users', definerRead: true },
];
const DR_A14_TABLES: ReadonlySet<string> = new Set(DR_A14_ENTRIES.map((entry) => entry.name));

/**
 * C3 derived set (D-ARCH-072; data-model §4.6 as amended 2026-11-13): inside a savepoint that is rolled back, drop EVERY
 * policy of the database, create the CREATE POLICY statements `renderRls` emits for each RLS manifest entry whose table
 * exists, and read the deparsed rows back. The live rows must equal them: a policy on an unlisted table, a hand-written
 * or edited policy and a missing policy all break the equality, and no snapshot file is edited alongside.
 */
async function derivePolicies(client: pg.Client, entries: readonly TableClassEntry[]): Promise<PolicyRow[]> {
  await client.query('SAVEPOINT c3_derive');
  try {
    const existing = new Set(
      (await rows<{ relname: string }>(client, `SELECT relname FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace`)).map(
        (row) => row.relname,
      ),
    );
    for (const policy of await rows<{ table: string; policy: string }>(client, C3_SQL)) {
      await client.query(`DROP POLICY ${policy.policy} ON public.${policy.table}`);
    }
    for (const entry of entries.filter((e) => RLS_CLASSES.has(e.class) && existing.has(e.name))) {
      for (const statement of splitStatements(renderRls(entry)).filter((text) => /^\s*(?:--[^\n]*\n\s*)*CREATE POLICY /.test(text))) {
        await client.query(statement);
      }
    }
    return await rows<PolicyRow>(client, C3_SQL);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT c3_derive');
  }
}

/** Sets the four security keys transaction-locally, as withTenantTx does (data-model §4.1). */
async function context(client: pg.Client, org: string, actor: string, scope: 'TENANT' | 'OPERATOR'): Promise<void> {
  await client.query(
    `SELECT pg_catalog.set_config('app.org_id', $1, true), pg_catalog.set_config('app.actor_id', $2, true),
            pg_catalog.set_config('app.actor_scope', $3, true), pg_catalog.set_config('app.guest_token_hash', '', true)`,
    [org, actor, scope],
  );
}

const visible = async (client: pg.Client): Promise<string[]> =>
  (await rows<{ ref: string }>(client, `SELECT ref FROM public.${PROBE} ORDER BY ref`)).map((row) => row.ref);

describe('catalog-c1-c14: tenant tables (C1, C2, C3; US-074)', () => {
  it('C1: every non-partition table in public outside the GLOBAL/SYSTEM allow-list has RLS enabled and forced', async () => {
    expect(names(await query<{ relname: string }>(C1_SQL, [ALLOW_LIST]))).toEqual([]);
    expect(ALLOW_LIST).toEqual(
      expect.arrayContaining(['permissions', 'roles', 'role_permissions', '_prisma_migrations', 'bootstrap_migrations']),
    );
  }, 60_000);

  it('C2: every table with org_id is allow-listed or has RLS, a platform_app policy and a leading-org_id index', async () => {
    expect(names(await query<{ relname: string }>(C2_SQL, [ALLOW_LIST]))).toEqual([]);
  }, 60_000);

  it('AT-US-074-02 C1/C2: a planted table "widgets" without org_id and not on the allow-list is named by the check', async () => {
    const found = await rolledBack(db.migratorConnection(database), async (client) => {
      await client.query('CREATE TABLE public.widgets (id uuid PRIMARY KEY, label text)');
      return names(await rows<{ relname: string }>(client, C1_SQL, [ALLOW_LIST]));
    });
    expect(found).toEqual(['widgets']);
  }, 60_000);

  it('AT-US-074-01 C2: a rendered TENANT probe with org_id and a leading-org_id index passes; without the index it is named', async () => {
    const result = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      const withIndex = names(await rows<{ relname: string }>(client, C2_SQL, [ALLOW_LIST]));
      const c1 = names(await rows<{ relname: string }>(client, C1_SQL, [ALLOW_LIST]));
      await client.query(`DROP INDEX public.ix_${PROBE}__org_id`);
      const withoutIndex = names(await rows<{ relname: string }>(client, C2_SQL, [ALLOW_LIST]));
      return { withIndex, c1, withoutIndex };
    });
    expect(result.withIndex).not.toContain(PROBE);
    expect(result.c1).not.toContain(PROBE);
    expect(result.withoutIndex).toContain(PROBE);
  }, 60_000);

  it('AT-US-074-03 C12: the rendered probe has ENABLE + FORCE and USING/WITH CHECK on app.org_id; context decides visibility', async () => {
    const result = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      const flags = await rows(
        client,
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.${PROBE}'::regclass`,
      );
      const policies = (await rows<PolicyRow>(client, C3_SQL)).filter((row) => row.table === PROBE);
      await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      const noContext = await visible(client);
      await context(client, ORG_A, CUSTOMER_USER, 'TENANT');
      const orgA = await visible(client);
      const updateB = await client.query(`UPDATE public.${PROBE} SET ref = 'x' WHERE id = $1`, [ROW_B]);
      const insertB = await sqlState(client, `INSERT INTO public.${PROBE} (id, org_id, ref) VALUES ($1, $2, 'B2')`, [randomUUID(), ORG_B]);
      const deleteB = await sqlState(client, `DELETE FROM public.${PROBE} WHERE id = $1`, [ROW_B]);
      await context(client, ORG_A, CUSTOMER_USER, 'OPERATOR'); // a customer forcing the operator scope
      const forcedOperator = await visible(client);
      await context(client, '', OPERATOR_USER, 'OPERATOR'); // a verified operator: read-only cross-tenant branch
      const operator = await visible(client);
      const operatorWrite = await client.query(`UPDATE public.${PROBE} SET ref = 'x' WHERE id = $1`, [ROW_B]);
      await context(client, 'not-a-uuid', CUSTOMER_USER, 'TENANT');
      const malformed = await visible(client);
      return {
        flags,
        policies,
        noContext,
        orgA,
        updated: updateB.rowCount,
        insertB,
        deleteB,
        forcedOperator,
        operator,
        operatorWrite: operatorWrite.rowCount,
        malformed,
      };
    });
    expect(result.flags).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(result.policies).toEqual([
      {
        table: PROBE,
        policy: `p_${PROBE}__operator`,
        cmd: 'r',
        roles: [APP_ROLE],
        permissive: true,
        qual: "((current_setting('app.actor_scope'::text, true) = 'OPERATOR'::text) AND platform.app_is_operator())",
        with_check: null,
      },
      {
        table: PROBE,
        policy: `p_${PROBE}__tenant`,
        cmd: '*',
        roles: [APP_ROLE],
        permissive: true,
        qual: '(org_id = platform.app_org_id())',
        with_check: '(org_id = platform.app_org_id())',
      },
    ]);
    expect(result.noContext).toEqual([]); // fail closed (REQ-RLS-004)
    expect(result.orgA).toEqual(['A1']);
    expect(result.updated).toBe(0); // UPDATE of another org's row: 0 rows, silently (am. 10 item 15)
    expect(result.insertB).toBe('42501'); // WITH CHECK
    expect(result.deleteB).toBe('42501'); // no DELETE grant at all (REQ-RLS-010)
    expect(result.forcedOperator).toEqual(['A1']);
    expect(result.operator).toEqual(['A1', 'B1']);
    expect(result.operatorWrite).toBe(0);
    expect(result.malformed).toEqual([]);
  }, 60_000);

  it('C3 (D-ARCH-072): live pg_policies rows equal the set derived from the manifests and the renderer on a rolled-back probe; the hand-edited snapshot is retired', async () => {
    const live = await query<PolicyRow>(C3_SQL);
    expect(live).toEqual(await rolledBack('superuser', (client) => derivePolicies(client, ENTRIES)));
    expect(existsSync(join(repoRoot, 'prisma', 'tests', 'catalog', 'policies.snapshot.json'))).toBe(false);
    // Probe control: a rendered TENANT table derives to exactly its live rows; an added or edited policy breaks equality.
    const control = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      const entries = [...ENTRIES, PROBE_ENTRY];
      const equal = await rows<PolicyRow>(client, C3_SQL);
      const derived = await derivePolicies(client, entries);
      await client.query(
        `CREATE POLICY p_${PROBE}__extra ON public.${PROBE} FOR SELECT TO platform_app USING (org_id = platform.app_org_id())`,
      );
      const extra = await rows<PolicyRow>(client, C3_SQL);
      await client.query(`DROP POLICY p_${PROBE}__extra ON public.${PROBE}`);
      await client.query(`ALTER POLICY p_${PROBE}__tenant ON public.${PROBE} USING (platform.app_org_id() = platform.app_org_id())`);
      const edited = await rows<PolicyRow>(client, C3_SQL);
      return { equal, derived, extra, edited };
    });
    expect(control.equal).toEqual(control.derived);
    expect(control.extra).not.toEqual(control.derived);
    expect(control.edited).not.toEqual(control.derived);
  }, 60_000);

  it('C3 (PR11-SEC-10 req. 5): the rendered DR-A14 sets derive to their live rows, carry keyed atoms and hold the invariants; planted violations are named', async () => {
    const result = await rolledBack('superuser', async (client) => {
      // R1-m3: a DR-A14 table committed by TASK-037/049 is used as it is (its policies come from its migration and its
      // manifest entry); only an absent one is planted and rendered here, so the test holds in both states.
      const committed = await committedTables(client, [...DR_A14_TABLES]);
      await plantProbe(client); // memberships, organisations and app_is_operator() as TASK-037 will create them
      await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
      if (!committed.has('users')) await client.query('CREATE TABLE public.users (id uuid PRIMARY KEY)');
      for (const entry of DR_A14_ENTRIES.filter((e) => !committed.has(e.name))) await client.query(renderRls(entry));
      await client.query('RESET ROLE');
      const listed = new Set(ENTRIES.map((entry) => entry.name));
      const entries = [...ENTRIES, PROBE_ENTRY, ...DR_A14_ENTRIES.filter((entry) => !listed.has(entry.name))];
      expect([...committed].filter((table) => !listed.has(table))).toEqual([]); // a committed DR-A14 table is manifest-listed
      const live = (await rows<PolicyRow>(client, C3_SQL)).filter((row) => DR_A14_TABLES.has(row.table));
      const derived = (await derivePolicies(client, entries)).filter((row) => DR_A14_TABLES.has(row.table));
      const clean = [...scanPolicies(live, DR_A14_TABLES), ...drA14Findings(live)];
      await client.query(`
        CREATE POLICY p_bad_recursive ON public.memberships FOR SELECT TO platform_app
          USING (EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = memberships.org_id AND o.id = platform.app_org_id()));
        CREATE POLICY p_bad_other_table ON public.users FOR SELECT TO platform_app
          USING (EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = platform.app_org_id()));
        CREATE POLICY p_bad_in_list ON public.organisations FOR SELECT TO platform_app
          USING (EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id IN (organisations.id, platform.app_org_id()) AND m.user_id = platform.app_actor_id()));`);
      const planted = drA14Findings(await rows<PolicyRow>(client, C3_SQL));
      return { live, derived, clean, planted };
    });
    expect(result.live).toEqual(result.derived);
    expect(result.live.map((row) => row.policy)).toEqual([
      'p_memberships__definer_read',
      'p_memberships__operator',
      'p_memberships__own_read',
      'p_memberships__tenant',
      'p_organisations__active',
      'p_organisations__definer_read',
      'p_organisations__member_read',
      'p_organisations__operator',
      'p_users__definer_read',
      'p_users__operator',
      'p_users__org_member_read',
      'p_users__own',
    ]);
    expect(result.clean).toEqual([]);
    expect(result.planted).toEqual([
      'memberships.p_bad_recursive USING: subquery in a memberships policy (42P17)',
      'organisations.p_bad_in_list USING: IN list on m.org_id, allowed only on m.status',
      'users.p_bad_other_table USING: subquery reads public.organisations, not public.memberships',
    ]);
  }, 60_000);

  it('C3: live policies carry no forbidden token (scan proven on planted policies)', async () => {
    const live = await query<PolicyRow>(C3_SQL);
    expect(scanPolicies(live, DEFINER_TABLES)).toEqual([]);
    const planted = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      const clean = scanPolicies(
        (await rows<PolicyRow>(client, C3_SQL)).filter((row) => row.table === PROBE),
        DEFINER_TABLES,
      );
      await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
      await client.query(`
        CREATE POLICY p_bad_distinct ON public.${PROBE} FOR SELECT TO platform_app USING (org_id IS NOT DISTINCT FROM platform.app_org_id());
        CREATE POLICY p_bad_coalesce ON public.${PROBE} FOR SELECT TO platform_app USING (org_id = coalesce(platform.app_org_id(), org_id));
        CREATE POLICY p_bad_ne ON public.${PROBE} FOR SELECT TO platform_app USING (org_id <> platform.app_org_id());
        CREATE POLICY p_bad_not ON public.${PROBE} FOR SELECT TO platform_app USING (NOT (org_id = platform.app_org_id()));
        CREATE POLICY p_bad_raw ON public.${PROBE} FOR SELECT TO platform_app USING (org_id::text = current_setting('app.org_id', true));
        CREATE POLICY p_bad_true ON public.${PROBE} FOR SELECT TO platform_app USING (true);
        CREATE POLICY p_bad_definer ON public.${PROBE} FOR SELECT TO platform_definer USING (true);
        CREATE POLICY p_bad_migrator ON public.${PROBE} FOR SELECT TO platform_migrator USING (org_id = platform.app_org_id());
        CREATE POLICY p_bad_tautology ON public.${PROBE} TO platform_app USING (org_id = org_id) WITH CHECK (org_id = org_id);
        CREATE POLICY p_bad_unkeyed ON public.${PROBE} FOR SELECT TO platform_app USING (org_id IS NULL);
        CREATE POLICY p_bad_constant ON public.${PROBE} FOR SELECT TO platform_app USING (1 = 1);`);
      return { clean, findings: scanPolicies(await rows<PolicyRow>(client, C3_SQL), DEFINER_TABLES) };
    });
    expect(planted.clean).toEqual([]);
    expect(planted.findings).toEqual(
      expect.arrayContaining([
        `${PROBE}.p_bad_distinct USING: IS [NOT] DISTINCT FROM`,
        `${PROBE}.p_bad_coalesce USING: coalesce`,
        `${PROBE}.p_bad_ne USING: <>`,
        `${PROBE}.p_bad_not USING: NOT`,
        `${PROBE}.p_bad_raw USING: raw current_setting(`,
        `${PROBE}.p_bad_true: USING (true) for platform_app`,
        `${PROBE}.p_bad_definer: platform_definer policy outside the definer tables`,
        `${PROBE}.p_bad_migrator: targets platform_migrator`,
        `${PROBE}.p_bad_tautology USING: no keyed context atom`,
        `${PROBE}.p_bad_tautology WITH CHECK: no keyed context atom`,
        `${PROBE}.p_bad_unkeyed USING: no keyed context atom`,
        `${PROBE}.p_bad_constant USING: no keyed context atom`,
        `${PROBE}.p_bad_raw USING: no keyed context atom`,
      ]),
    );
    expect(planted.findings.filter((finding) => finding.includes(`p_${PROBE}__`))).toEqual([]);
  }, 60_000);
});

describe('catalog-c1-c14: roles and ownership (C4, C13; US-074)', () => {
  it('AT-US-074-04 C4 [SEC-TC-05]: platform_app is not superuser and has no BYPASSRLS/CREATEROLE/CREATEDB; it owns no relation or function; the migrator is another role', async () => {
    const roles = await query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin
         FROM pg_catalog.pg_roles WHERE rolname IN ($1, $2) ORDER BY rolname`,
      [APP_ROLE, MIGRATOR],
    );
    const attrs = {
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolcanlogin: true,
    };
    expect(roles).toEqual([
      { rolname: APP_ROLE, ...attrs },
      { rolname: MIGRATOR, ...attrs },
    ]);
    const owned = await query<{ n: string }>(
      `SELECT ((SELECT count(*) FROM pg_catalog.pg_class WHERE relowner = $1::regrole)
             + (SELECT count(*) FROM pg_catalog.pg_proc WHERE proowner = $1::regrole)
             + (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspowner = $1::regrole)
             + (SELECT count(*) FROM pg_catalog.pg_type WHERE typowner = $1::regrole))::text AS n`,
      [APP_ROLE],
    );
    expect(owned[0]?.n).toBe('0');
    // Audit-store relations (TASK-021) are owned by platform_audit_owner; c11-c14-audit.int.test.ts pins that set exactly.
    const migration = await query<{ owner: string }>(
      `SELECT DISTINCT pg_catalog.pg_get_userbyid(c.relowner) AS owner FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname NOT LIKE 'bootstrap\\_migrations%'
          AND c.relowner <> 'platform_audit_owner'::regrole`,
    );
    expect(migration).toEqual([{ owner: MIGRATOR }]);
  }, 60_000);

  it('AT-US-074-05: platform_app cannot disable or un-force row-level security (42501 permission denied)', async () => {
    // A real platform_app login on a committed table.
    const real = await rolledBack(db.appConnection(database), async (client) => ({
      disable: await sqlState(client, 'ALTER TABLE public.permissions DISABLE ROW LEVEL SECURITY'),
      noForce: await sqlState(client, 'ALTER TABLE public.permissions NO FORCE ROW LEVEL SECURITY'),
    }));
    expect(real).toEqual({ disable: '42501', noForce: '42501' });
    const probe = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      return {
        disable: await sqlState(client, `ALTER TABLE public.${PROBE} DISABLE ROW LEVEL SECURITY`),
        noForce: await sqlState(client, `ALTER TABLE public.${PROBE} NO FORCE ROW LEVEL SECURITY`),
        dropPolicy: await sqlState(client, `DROP POLICY p_${PROBE}__tenant ON public.${PROBE}`),
      };
    });
    expect(probe).toEqual({ disable: '42501', noForce: '42501', dropPolicy: '42501' });
  }, 60_000);

  it('C13 (a, b): public and platform are owned by the no-login platform_schema_owner; audit and schema owners have no membership rows', async () => {
    const schemas = await query(
      `SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) AS owner FROM pg_catalog.pg_namespace n
        WHERE n.nspname IN ('public', 'platform') ORDER BY 1`,
    );
    expect(schemas).toEqual([
      { nspname: 'platform', owner: 'platform_schema_owner' },
      { nspname: 'public', owner: 'platform_schema_owner' },
    ]);
    const login = await query(
      `SELECT rolname, rolcanlogin FROM pg_catalog.pg_roles WHERE rolname IN ('platform_schema_owner', 'platform_audit_owner') ORDER BY 1`,
    );
    expect(login).toEqual([
      { rolname: 'platform_audit_owner', rolcanlogin: false },
      { rolname: 'platform_schema_owner', rolcanlogin: false },
    ]);
  }, 60_000);

  it('C13 PR5-SEC-09: pg_auth_members rows of every platform_% role (pg_* predefined roles included) equal exactly the expected set', async () => {
    const members = await query(
      `SELECT r.rolname AS role, m.rolname AS member, am.admin_option, am.inherit_option, am.set_option
         FROM pg_catalog.pg_auth_members am
         JOIN pg_catalog.pg_roles r ON r.oid = am.roleid JOIN pg_catalog.pg_roles m ON m.oid = am.member
        WHERE m.rolname LIKE 'platform\\_%' OR r.rolname LIKE 'platform\\_%'
        ORDER BY 1, 2`,
    );
    const master =
      MASTER_ROLE === ''
        ? []
        : ['platform_audit_owner', 'platform_schema_owner'].map((role) => ({
            role,
            member: MASTER_ROLE,
            admin_option: true,
            inherit_option: false,
            set_option: false,
          }));
    expect(members).toEqual(
      [...master, { role: 'platform_definer', member: MIGRATOR, admin_option: false, inherit_option: false, set_option: true }].sort(
        (a, b) => (a.role === b.role ? a.member.localeCompare(b.member) : a.role.localeCompare(b.role)),
      ),
    );
  }, 60_000);

  it('C13 (c): the database is not owned by the migrator, which has CONNECT but no CREATE on it', async () => {
    const rowsDb = await query(
      `SELECT pg_catalog.pg_get_userbyid(datdba) AS owner, pg_catalog.has_database_privilege($2, datname, 'CREATE') AS migrator_create,
              pg_catalog.has_database_privilege($2, datname, 'CONNECT') AS migrator_connect
         FROM pg_catalog.pg_database WHERE datname = $1`,
      [database, MIGRATOR],
    );
    expect(rowsDb).toEqual([{ owner: MASTER_ROLE === '' ? SUPERUSER : MASTER_ROLE, migrator_create: false, migrator_connect: true }]);
  }, 60_000);

  it('C13 (d): no database-wide setting; the bootstrap role pins search_path; platform_app role settings are exactly the five rows incl. statement_timeout=30s and lc_messages=C; no app.% default anywhere', async () => {
    const inDatabase = await query(
      `SELECT CASE s.setrole WHEN 0 THEN '<database-wide>' ELSE s.setrole::regrole::text END AS setrole, s.setconfig
         FROM pg_catalog.pg_db_role_setting s
        WHERE s.setdatabase = (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())`,
    );
    expect(inDatabase).toEqual([{ setrole: MASTER_ROLE === '' ? SUPERUSER : MASTER_ROLE, setconfig: ['search_path=pg_catalog, pg_temp'] }]);
    const app = await query<{ setdatabase: number; setconfig: string[] }>(
      `SELECT setdatabase::int AS setdatabase, setconfig FROM pg_catalog.pg_db_role_setting WHERE setrole = $1::regrole`,
      [APP_ROLE],
    );
    expect(app).toHaveLength(1);
    expect(app[0]?.setdatabase).toBe(0);
    expect([...(app[0]?.setconfig ?? [])].sort()).toEqual([
      'idle_in_transaction_session_timeout=15s',
      'lc_messages=C',
      'lock_timeout=2s',
      'search_path=pg_catalog, public',
      'statement_timeout=30s',
    ]);
    const appKeys = await query(
      // GUC names are case-insensitive (PR11-SEC-11 b); a function SET clause on app.* is checked too.
      `SELECT (SELECT count(*)::int FROM pg_catalog.pg_db_role_setting s, pg_catalog.unnest(s.setconfig) c WHERE lower(c) LIKE 'app.%') AS role_settings,
              (SELECT count(*)::int FROM pg_catalog.pg_parameter_acl WHERE lower(parname) LIKE 'app.%') AS parameter_acl,
              (SELECT count(*)::int FROM pg_catalog.pg_proc p, pg_catalog.unnest(p.proconfig) c WHERE c ILIKE 'app.%') AS proc_config`,
    );
    expect(appKeys).toEqual([{ role_settings: 0, parameter_acl: 0, proc_config: 0 }]);
    // The backstops are what a platform_app session outside withTenantTx actually runs with (ADR-0005 am. 10 item 12;
    // D-ARCH-073 b: untranslated messages for mapDbError), and the role cannot change lc_messages itself (SUSET).
    const session = await withClient(db.appConnection(database), async (client) => ({
      statement: await rows(client, 'SHOW statement_timeout'),
      messages: await rows(client, 'SHOW lc_messages'),
      setMessages: await client.query("SET lc_messages = 'C'").then(
        () => 'none',
        (error: unknown) => String((error as { code?: unknown }).code),
      ),
    }));
    expect(session).toEqual({ statement: [{ statement_timeout: '30s' }], messages: [{ lc_messages: 'C' }], setMessages: '42501' });
  }, 60_000);

  it('C13/C14: audit objects (TASK-021) are owned by platform_audit_owner and the DDL guard is enabled ALWAYS', async () => {
    // TASK-021 ships the audit tables, partitions, functions and event triggers (prisma/bootstrap/10-audit.sql and
    // 90-audit-ddl-guard.sql); the detailed C6/C7/C14 assertions live in c11-c14-audit.int.test.ts.
    const audit = await query<{ object: string; owner: string }>(
      `SELECT c.relname AS object, pg_catalog.pg_get_userbyid(c.relowner) AS owner FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND (c.relname LIKE 'audit\\_%' OR c.relname = 'data_subjects')
       UNION ALL
       SELECT p.oid::regprocedure::text, pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'platform' AND p.proname IN ('audit_forbid_mutation', 'audit_vault_guard', 'ensure_audit_partitions')`,
    );
    expect(audit.filter((row) => row.owner !== 'platform_audit_owner')).toEqual([]);
    // eight tables, the current month + 3 partitions, three functions
    expect(audit.length).toBeGreaterThanOrEqual(8 + 4 + 3);
    const guards = await query<{ evtname: string; evtenabled: string; fn: string; prosecdef: boolean; proconfig: string[] | null }>(
      `SELECT e.evtname, e.evtenabled, e.evtfoid::regprocedure::text AS fn, p.prosecdef, p.proconfig
         FROM pg_catalog.pg_event_trigger e JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid ORDER BY 1`,
    );
    for (const guard of guards) {
      expect(guard).toEqual({
        evtname: guard.evtname,
        evtenabled: 'A', // ENABLE ALWAYS (PR12-SEC-04 item 3, D-ARCH-076)
        fn: 'platform.audit_ddl_guard()',
        prosecdef: false,
        proconfig: ['search_path=pg_catalog, pg_temp'],
      });
    }
    expect(guards.map((g) => g.evtname)).toEqual(['platform_audit_ddl_guard_drop', 'platform_audit_ddl_guard_end']);
  }, 60_000);
});

describe('catalog-c1-c14: grants and functions (C5, C11; US-074)', () => {
  it('C5: platform role table/column privileges equal prisma/sql/grants.manifest; DELETE only on the allow-list; no partition privilege; no default table/sequence/type/schema ACL', async () => {
    const manifest = loadGrantsManifest();
    expect(validateGrants(manifest, ENTRIES)).toEqual([]);
    const live = (await query<{ grant: string }>(TABLE_ACL_SQL)).map((row) => row.grant).sort();
    expect(live.filter((grant) => grant.startsWith('PUBLIC '))).toEqual([]); // the manifest cannot express PUBLIC
    expect(live).toEqual(grantTuples(manifest));
    const deletes = live
      .filter((grant) => grant.startsWith('platform_app DELETE public.'))
      .map((grant) => grant.split(' ')[2]?.slice('public.'.length));
    expect(deletes.filter((table) => !HARD_DELETE.has(table ?? ''))).toEqual([]);
    const partitions = await query(
      `SELECT c.relname FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
        WHERE c.relispartition AND a.grantee <> c.relowner`,
    );
    expect(partitions).toEqual([]);
    const defaults = await query(`SELECT defaclobjtype FROM pg_catalog.pg_default_acl WHERE defaclobjtype IN ('r', 'S', 'T', 'n')`);
    expect(defaults).toEqual([]);
  }, 60_000);

  it('C5 PR11-SEC-04: planted (rolled-back) table and column grants to PUBLIC appear in the live grant list and fail the check', async () => {
    const found = await rolledBack(db.migratorConnection(database), async (client) => {
      await client.query(`GRANT TRUNCATE ON public.permissions TO PUBLIC;
                          GRANT INSERT ON public.role_permissions TO PUBLIC;
                          GRANT UPDATE (key) ON public.permissions TO PUBLIC;`);
      return (await rows<{ grant: string }>(client, TABLE_ACL_SQL)).map((row) => row.grant);
    });
    expect(found.filter((grant) => grant.startsWith('PUBLIC ')).sort()).toEqual([
      'PUBLIC INSERT public.role_permissions *',
      'PUBLIC TRUNCATE public.permissions *',
      'PUBLIC UPDATE public.permissions key',
    ]);
  }, 60_000);

  it('C8: no timestamp without time zone; uuid ids default uuidv7(); *_minor columns are bigint with a currency CHECK (planted control)', async () => {
    expect(await query(C8_SQL)).toEqual([]);
    const planted = await rolledBack(db.migratorConnection(database), async (client) => {
      await client.query(`CREATE TABLE public.c8_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seen_at timestamp NOT NULL,
                                                        amount_minor integer NOT NULL, currency text NOT NULL)`);
      return (await rows<{ finding: string }>(client, C8_SQL)).map((row) => row.finding);
    });
    expect(planted.sort()).toEqual([
      'c8_probe.amount_minor: integer minor-unit column without bigint + currency CHECK',
      'c8_probe.id: uuid DEFAULT gen_random_uuid()',
      'c8_probe.seen_at: timestamp without time zone',
    ]);
  }, 60_000);

  it('C9: every enum-like CHECK equals its TypeScript list (ck_roles__scope = the authz role scopes); a drifted list is caught', async () => {
    expect(ENUM_CHECKS['ck_roles__scope']).toEqual(['CUSTOMER', 'OPERATOR', 'PARTNER']);
    expect(enumCheckValues(await query<CheckRow>(C9_SQL))).toEqual(ENUM_CHECKS);
    const drifted = await rolledBack(db.migratorConnection(database), async (client) => {
      await client.query(`ALTER TABLE public.roles DROP CONSTRAINT ck_roles__scope,
                            ADD CONSTRAINT ck_roles__scope CHECK (scope IN ('OPERATOR', 'CUSTOMER')) NOT VALID`);
      return enumCheckValues(await rows<CheckRow>(client, C9_SQL));
    });
    expect(drifted).toEqual({ ...ENUM_CHECKS, ck_roles__scope: ['CUSTOMER', 'OPERATOR'] });
    expect(drifted).not.toEqual(ENUM_CHECKS);
  }, 60_000);

  it('C11 [SEC-TC-05]: SECURITY DEFINER functions are on the allow-list with the fixed search path; three global default-ACL rows; helpers EXECUTE-able by platform_app only', async () => {
    const definers = await query<{ fn: string; owner: string; execute: string[] }>(DEFINER_SQL);
    const allowed = DEFINER_ALLOWED;
    for (const definer of definers) {
      // §4.5 functions (TASK-037 onwards) extend DEFINER_ALLOWED with owner platform_definer.
      expect({ fn: definer.fn, owner: allowed.get(definer.fn), execute: [APP_ROLE] }).toEqual({
        fn: definer.fn,
        owner: definer.owner,
        execute: definer.execute,
      });
    }
    expect(await query(DEFINER_PATH_SQL)).toEqual([]);
    const defaultAcl = await query(
      `SELECT pg_catalog.pg_get_userbyid(defaclrole) AS role, defaclnamespace::int AS namespace, defaclobjtype, defaclacl::text[] AS acl
         FROM pg_catalog.pg_default_acl ORDER BY 1`,
    );
    expect(defaultAcl).toEqual(
      ['platform_audit_owner', 'platform_definer', 'platform_migrator'].map((role) => ({
        role,
        namespace: 0,
        defaclobjtype: 'f',
        acl: [`${role}=X/${role}`],
      })),
    );
    const helpers = await query<{
      fn: string;
      owner: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      volatile: string;
      parallel: string;
      execute: string[];
    }>(
      `SELECT p.oid::regprocedure::text AS fn, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
              p.provolatile::text AS volatile, p.proparallel::text AS parallel,
              ARRAY(SELECT CASE WHEN a.grantee = 0 THEN 'public' ELSE a.grantee::regrole::text END
                      FROM pg_catalog.aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE' ORDER BY 1) AS execute
         FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::regnamespace AND p.proname LIKE 'app\\_%' ORDER BY 1`,
    );
    const helper = { owner: MIGRATOR, prosecdef: false, proconfig: null, volatile: 's', parallel: 's', execute: [APP_ROLE, MIGRATOR] };
    expect(helpers).toEqual([
      { fn: 'platform.app_actor_id()', ...helper },
      { fn: 'platform.app_guest_token_hash()', ...helper },
      { fn: 'platform.app_org_id()', ...helper },
    ]);
    // No platform-owned function outside extensions leaves EXECUTE to PUBLIC (a NULL proacl is the built-in default).
    const publicExecute = await query(
      `SELECT p.oid::regprocedure::text AS fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE ${USER_NAMESPACES}
          AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
          AND (p.proacl IS NULL OR EXISTS (SELECT FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0))`,
    );
    expect(publicExecute).toEqual([]);
    // Converse (PR11-SEC-06): platform_definer owns exactly its allow-listed definer functions, nothing else.
    expect(unexpectedDefinerObjects(await query<{ obj: string }>(DEFINER_OWNED_SQL))).toEqual([]);
  }, 60_000);

  it('C11 PR11-SEC-06: a planted (rolled-back) definer-owned view and invoker function are reported; app_is_operator() is not', async () => {
    const found = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      await client.query(`SET LOCAL ROLE platform_definer;
                          CREATE VIEW platform.c11_definer_view AS SELECT 1 AS one;
                          CREATE FUNCTION platform.c11_definer_invoker() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
                          RESET ROLE;`);
      return unexpectedDefinerObjects(await rows<{ obj: string }>(client, DEFINER_OWNED_SQL));
    });
    expect(found).toEqual(expect.arrayContaining(['rel platform.c11_definer_view', 'proc platform.c11_definer_invoker()']));
    expect(found.filter((obj) => obj.startsWith('proc ') || obj.startsWith('rel ')).sort()).toEqual([
      'proc platform.c11_definer_invoker()',
      'rel platform.c11_definer_view',
    ]);
  }, 60_000);

  it('C11: migrator-created probe functions in platform and public are EXECUTE-able by neither PUBLIC nor platform_app', async () => {
    const result = await rolledBack(db.migratorConnection(database), async (client) => {
      await client.query(`CREATE FUNCTION platform.c11_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
                          CREATE FUNCTION public.c11_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;`);
      return rows(
        client,
        `SELECT f AS fn, pg_catalog.has_function_privilege('public', f, 'EXECUTE') AS public_execute,
                pg_catalog.has_function_privilege('platform_app', f, 'EXECUTE') AS app_execute
           FROM pg_catalog.unnest(ARRAY['platform.c11_probe()', 'public.c11_probe()']) f ORDER BY 1`,
      );
    });
    expect(result).toEqual([
      { fn: 'platform.c11_probe()', public_execute: false, app_execute: false },
      { fn: 'public.c11_probe()', public_execute: false, app_execute: false },
    ]);
  }, 60_000);

  it('C11: app_is_operator() rendered from its template is SECURITY DEFINER, owned by platform_definer, fixed path, EXECUTE for platform_app only', async () => {
    const definers = await rolledBack('superuser', async (client) => {
      await plantProbe(client);
      return { definers: await rows(client, DEFINER_SQL), badPath: await rows(client, DEFINER_PATH_SQL) };
    });
    expect(definers).toEqual({
      definers: [
        {
          fn: 'platform.app_is_operator()',
          owner: 'platform_definer',
          proconfig: ['search_path=pg_catalog, pg_temp'],
          execute: [APP_ROLE],
        },
        {
          // TASK-021 (prisma/bootstrap/10-audit.sql, data-model §5.3)
          fn: 'platform.ensure_audit_partitions(integer)',
          owner: 'platform_audit_owner',
          proconfig: ['search_path=pg_catalog, pg_temp', 'TimeZone=UTC', 'lock_timeout=5s'],
          execute: [APP_ROLE],
        },
      ],
      badPath: [],
    });
  }, 60_000);
});

describe('catalog-c1-c14: tenant context in SQL (prosrc scan, F-07; US-075)', () => {
  it('rule 16 / C-series: no function body writes the request context and only the §4.2 helpers read the security keys', async () => {
    const functions = await query<FunctionRow>(PROSRC_SQL);
    expect(scanFunctionBodies(functions)).toEqual([]);
    expect(functions.map((row) => row.fn)).toEqual(
      expect.arrayContaining([...CONTEXT_HELPERS].filter((fn) => fn !== 'platform.app_is_operator()')),
    );
  }, 60_000);

  // Labels of tools/db/tenant-key-forms.ts (the one form list shared with linter rule 16; PR11-SEC-02, review m1).
  const SETTER = 'context setter with an app. or computed key';
  const SET_RESET = 'SET/RESET of an app. setting';
  const DYNAMIC = 'dynamic SET/RESET (name built at run time)';
  const MENTION = 'mentions a tenant security key';
  const COMPUTED = 'settings read with a computed key';
  const UNICODE = 'Unicode-escape string or identifier';
  const ESCAPE = 'E-prefixed escape string';
  const NIL = `'00000000-0000-0000-0000-000000000000'`;

  // Every form is EXECUTED as CREATE FUNCTION (plpgsql validates the body at CREATE time), which proves it is valid
  // SQL that could reach the catalogue; the scan must then name the function with exactly the expected forms.
  it.each([
    [
      'set_config(app.org_id, p, true)',
      'platform.c_scan_setter',
      `PERFORM pg_catalog.set_config('app.org_id', p, true);`,
      [SETTER, MENTION],
    ],
    ['SET app.org_id = …', 'public.c_scan_set', `SET app.org_id = ${NIL};`, [SET_RESET, MENTION]],
    [
      'current_setting(app.org_id, true) outside the helpers',
      'public.c_scan_reader',
      `PERFORM pg_catalog.current_setting('app.org_id', true);`,
      [MENTION],
    ],
    [
      'set_config(empty literal || app.org_id)',
      'public.c_scan_concat_empty',
      `PERFORM set_config('' || 'app.org_id', p, true);`,
      [SETTER, MENTION],
    ],
    ['set_config(split key literals)', 'public.c_scan_concat_split', `PERFORM set_config('ap' || 'p.org_id', p, true);`, [SETTER]],
    ['quoted setter name', 'public.c_scan_quoted', `PERFORM "set_config"('app.org_id', p, true);`, [SETTER, MENTION]],
    [
      'schema-qualified quoted setter name',
      'public.c_scan_qualified',
      `PERFORM pg_catalog."set_config"('app.org_id', p, true);`,
      [SETTER, MENTION],
    ],
    [
      'EXECUTE format(SET LOCAL %I = %L)',
      'public.c_scan_format_set',
      `EXECUTE format('SET LOCAL %I = %L', 'app.org_id', p);`,
      [DYNAMIC, MENTION],
    ],
    ['SET LOCAL "app".org_id', 'public.c_scan_quoted_ns', `SET LOCAL "app".org_id = ${NIL};`, [SET_RESET, MENTION]],
    ['RESET "app".org_id', 'public.c_scan_reset', `RESET "app".org_id;`, [SET_RESET, MENTION]],
    ['SET app . org_id (spaced)', 'public.c_scan_spaced', `SET app . org_id = ${NIL};`, [SET_RESET, MENTION]],
    [
      'EXECUTE SET LOCAL "app.org_id" || quote_literal',
      'public.c_scan_exec_set',
      `EXECUTE 'SET LOCAL "app.org_id" = ' || quote_literal(p);`,
      [SET_RESET, MENTION],
    ],
    ['current_setting(computed key)', 'public.c_scan_read_concat', `PERFORM current_setting('app.' || 'org_id', true);`, [COMPUTED]],
    ['EXECUTE format(SHOW %s, app.org_id)', 'public.c_scan_show', `EXECUTE format('SHOW %s', 'app.org_id') INTO r;`, [MENTION]],
    ['current_setting(k, true) (dynamic key)', 'public.c_scan_read_dynamic', `PERFORM current_setting(k, true);`, [COMPUTED]],
    ['EXECUTE DISCARD ALL', 'public.c_scan_discard', `EXECUTE 'DISCARD ALL';`, ['DISCARD']],
    // PR11-SEC-14 (a): Unicode escapes (standard_conforming_strings is on in PostgreSQL 18). Each body is valid
    // PL/pgSQL and spells the context write without its text; only the U& form names it.
    ['SET LOCAL U&"\\0061pp".org_id', 'public.c_scan_unicode_ident', String.raw`SET LOCAL U&"\0061pp".org_id = ${NIL};`, [UNICODE]],
    [
      'U&"\\0073et_config"(app.org_id, p, true)',
      'public.c_scan_unicode_setter',
      String.raw`PERFORM U&"\0073et_config"('app.org_id', p, true);`,
      [UNICODE, MENTION],
    ],
    [
      "EXECUTE U&'SET LOCAL \\0061pp.org_id = …'",
      'public.c_scan_unicode_string',
      String.raw`EXECUTE U&'SET LOCAL \0061pp.org_id = ''00000000-0000-0000-0000-000000000000''';`,
      [UNICODE],
    ],
    // PR11-SEC-16 (D-ARCH-078): an E-string spells app.org_id through hex escapes; refused token-level, never decoded.
    [
      "[PR11-SEC-16] EXECUTE E'SET LOCAL \\x61pp.org_id = …'",
      'public.c_scan_escape_string',
      String.raw`EXECUTE E'SET LOCAL \x61pp.org_id = ''00000000-0000-0000-0000-000000000000''';`,
      [ESCAPE],
    ],
    // PR #11 review R2-n1: the scan reads the comment-stripped body, as linter rule 16 does.
    ['SET app/**/.org_id (comment inside the name)', 'public.c_scan_comment_name', `SET app/**/.org_id = ${NIL};`, [SET_RESET, MENTION]],
    [
      'set_config/**/(app.org_id, …) (comment before the call)',
      'public.c_scan_comment_call',
      `PERFORM set_config/**/('app.org_id', p, true);`,
      [SETTER, MENTION],
    ],
    ['SET/**/app.org_id (comment after SET)', 'public.c_scan_comment_set', `SET/**/app.org_id = ${NIL};`, [SET_RESET, MENTION]],
  ])(
    'rule 16 negative fixture: %s fails the scan',
    async (_label, fn, body, forms) => {
      const findings = await rolledBack(db.migratorConnection(database), async (client) => {
        await client.query(`CREATE FUNCTION ${fn}(p text) RETURNS text LANGUAGE plpgsql AS $$
                              DECLARE r text; k text := p; BEGIN ${body} RETURN r; END $$`);
        // regprocedure text depends on the search path; pin it as on every privileged session (SEC-P3-34 item 2)
        await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
        return scanFunctionBodies(await rows<FunctionRow>(client, PROSRC_SQL));
      });
      expect(findings).toEqual(forms.map((form) => `${fn}(text): ${form}`));
    },
    60_000,
  );

  it('F-07 (ADR-0005 am. 10 item 7): after a committed transaction app.org_id reads as an empty string and every helper treats empty, NULL and malformed alike', async () => {
    const result = await withClient(db.appConnection(database), async (client) => {
      const helpers = `SELECT pg_catalog.current_setting('app.org_id', true) AS raw, platform.app_org_id() AS org,
                              platform.app_actor_id() AS actor, platform.app_guest_token_hash() AS guest`;
      const fresh = await rows(client, helpers);
      await client.query('BEGIN');
      await context(client, ORG_A, CUSTOMER_USER, 'TENANT');
      const inside = await rows(client, helpers);
      await client.query('COMMIT');
      const after = await rows(client, helpers);
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_catalog.set_config('app.org_id', 'not-a-uuid', true), pg_catalog.set_config('app.actor_id', '', true),
                pg_catalog.set_config('app.guest_token_hash', $1, true)`,
        ['AB'.repeat(32)],
      );
      const malformed = await rows(client, helpers);
      await client.query(`SELECT pg_catalog.set_config('app.guest_token_hash', $1, true)`, ['ab'.repeat(32)]);
      const guest = await rows<{ guest: Buffer | null }>(client, helpers);
      await client.query('ROLLBACK');
      return { fresh, inside, after, malformed, guestHex: guest[0]?.guest?.toString('hex') };
    });
    expect(result.fresh).toEqual([{ raw: null, org: null, actor: null, guest: null }]);
    expect(result.inside).toEqual([{ raw: ORG_A, org: ORG_A, actor: CUSTOMER_USER, guest: null }]);
    expect(result.after).toEqual([{ raw: '', org: null, actor: null, guest: null }]);
    expect(result.malformed).toEqual([{ raw: 'not-a-uuid', org: null, actor: null, guest: null }]);
    expect(result.guestHex).toBe('ab'.repeat(32));
  }, 60_000);

  it('§4.2 (D-ARCH-073 a): the qualified helpers ignore a caller search_path that shadows the built-ins and stay inlined (org_id = app_org_id() is an index condition)', async () => {
    const result = await rolledBack(db.migratorConnection(database), async (client) => {
      // A caller path that resolves unqualified current_setting( to a planted function (and pg_catalog last).
      await client.query(`CREATE FUNCTION public.current_setting(text, boolean) RETURNS text LANGUAGE sql IMMUTABLE
                            AS $$ SELECT '00000000-0000-0000-0000-000000000000'::pg_catalog.text $$`);
      await client.query(`CREATE TABLE public.c_plan_probe (id pg_catalog.int8 PRIMARY KEY, org_id pg_catalog.uuid NOT NULL)`);
      await client.query('CREATE INDEX ix_c_plan_probe__org_id ON public.c_plan_probe (org_id)');
      await client.query(
        `INSERT INTO public.c_plan_probe SELECT g, CASE WHEN g % 100 = 0 THEN $1::pg_catalog.uuid ELSE $2::pg_catalog.uuid END
           FROM pg_catalog.generate_series(1, 5000) g`,
        [ORG_A, ORG_B],
      );
      await client.query('ANALYZE public.c_plan_probe');
      await client.query('SET LOCAL search_path = public, pg_catalog');
      await client.query(`SELECT pg_catalog.set_config('app.org_id', $1, true)`, [ORG_A]);
      const shadowed = await rows<{ raw: string; org: string | null }>(
        client,
        'SELECT current_setting($1, true) AS raw, platform.app_org_id() AS org',
        ['app.org_id'],
      );
      const plan = await rows<{ 'QUERY PLAN': unknown }>(
        client,
        'EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) SELECT id FROM public.c_plan_probe WHERE org_id = platform.app_org_id()',
      );
      return { shadowed, plan: JSON.stringify(plan[0]?.['QUERY PLAN']) };
    });
    // The planted function answers the unqualified call; the helper still reads the real setting.
    expect(result.shadowed).toEqual([{ raw: '00000000-0000-0000-0000-000000000000', org: ORG_A }]);
    // Inlined: the helper call is folded into an index condition and 50 of 5,000 rows are read.
    expect(result.plan).toMatch(/"Node Type":"(?:Index|Index Only|Bitmap Index) Scan"/);
    expect(result.plan).toMatch(/"Index Name":"ix_c_plan_probe__org_id"/);
    expect(result.plan).toMatch(/"Index Cond":"\(org_id = CASE WHEN /);
    expect(result.plan).not.toMatch(/app_org_id/);
    expect(result.plan).toMatch(/"Actual Rows":50[,}]/);
  }, 60_000);
});

describe('catalog-c1-c14: authz escalation backstop (PR8-SEC-14, D-ARCH-069)', () => {
  it('PR8-SEC-14: no non-OPERATOR role links to an any_org / audit / featureflag:manage / carrier:status:read key, and no role links to webhook:% keys', async () => {
    expect(await query(ESCALATION_SQL)).toEqual([]);
    const webhook = await query(
      `SELECT r.key AS role, p.key AS permission FROM public.role_permissions rp
         JOIN public.roles r ON r.id = rp.role_id JOIN public.permissions p ON p.id = rp.permission_id
        WHERE p.key LIKE 'webhook:%'`,
    );
    expect(webhook).toEqual([]);
  }, 60_000);

  it('PR8-SEC-14 planted-row control: linking CUSTOMER_VIEWER to audit:read (as the migrator, rolled back) makes the query return exactly 1 row', async () => {
    const found = await rolledBack(db.migratorConnection(database), async (client) => {
      const inserted = await client.query(
        `INSERT INTO public.role_permissions (role_id, permission_id, created_by, updated_by)
         SELECT r.id, p.id, $1::uuid, $1::uuid FROM public.roles r, public.permissions p WHERE r.key = 'CUSTOMER_VIEWER' AND p.key = 'audit:read'`,
        [SYSTEM_ACTOR],
      );
      expect(inserted.rowCount).toBe(1);
      return rows(client, ESCALATION_SQL);
    });
    expect(found).toEqual([{ role: 'CUSTOMER_VIEWER', permission: 'audit:read' }]);
  }, 60_000);
});

/**
 * Catalog classes routed to TASK-024 (PR11-SEC-15 d/e, PR24-SEC-02 class fix, PR11-SEC-14 b). Each committed-state
 * assertion has a planted, rolled-back control that it names.
 */
const SCHEMA_CREATE_SQL = `
  SELECT n.nspname FROM pg_catalog.pg_namespace n
   WHERE ${USER_NAMESPACES} AND pg_catalog.has_schema_privilege('platform_app', n.oid, 'CREATE') ORDER BY 1`;
const RULES_SQL = `
  SELECT c.oid::regclass::text || '.' || r.rulename AS rule FROM pg_catalog.pg_rewrite r
    JOIN pg_catalog.pg_class c ON c.oid = r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE ${USER_NAMESPACES} AND r.rulename <> '_RETURN' ORDER BY 1`;
const OPERATORS_SQL = `
  SELECT o.oid::regoperator::text AS operator FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace
   WHERE n.nspname IN ('public', 'platform')
     AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e')
   ORDER BY 1`;
/**
 * PR11-SEC-14 b with PR43-SEC-06 (b): a function body that runs a computed statement. EXECUTE in plpgsql, and in EVERY
 * language the built-ins that execute a query string (`query_to_xml`, `query_to_xmlschema`,
 * `query_to_xml_and_xmlschema`, `ts_stat`, `ts_rewrite`). The scanned body is `prosrc`, or the deparsed body of a
 * SQL-standard (`BEGIN ATOMIC`) function, whose `prosrc` is empty.
 */
const DYNAMIC_SQL_SQL = `
  SELECT fn, body FROM (
    SELECT p.oid::regprocedure::text AS fn, l.lanname,
           CASE WHEN p.prosqlbody IS NULL THEN p.prosrc ELSE pg_catalog.pg_get_function_sqlbody(p.oid) END AS body
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE ${USER_NAMESPACES}) f
   WHERE (f.lanname = 'plpgsql' AND f.body OPERATOR(pg_catalog.~*) '\\mexecute\\M')
      OR f.body OPERATOR(pg_catalog.~*) '\\m(query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|ts_stat|ts_rewrite)\\M'
   ORDER BY 1`;
/**
 * PR11-SEC-14 b / PR43-SEC-06 (d): functions reviewed for dynamic SQL, keyed by signature AND the SHA-256 of the
 * normalised body (scans.ts `normaliseBody`: every whitespace run becomes one space, then trimmed), with the reason. A
 * changed body under the same signature is unreviewed again.
 */
const DYNAMIC_SQL_REVIEWED: ReadonlyMap<string, ReviewedBody> = new Map([
  [
    'platform.ensure_audit_partitions(integer)',
    {
      sha256: 'd1b613072270ac44f9a43855c348d75f1d3f47355147c32b13317c70ee406d95',
      reason: 'TASK-021: creates monthly audit partitions by name; security-reviewed (PR #24)',
    },
  ],
]);

/**
 * PR11-SEC-11 e catalog half (R1-m4, PR43-SEC-10): no table, partitioned table, foreign table, view or materialised
 * view in a user namespace other than `public` (C1, C2, C3 and the generator read `public` only).
 */
const NON_PUBLIC_RELATIONS_SQL = `
  SELECT n.nspname || '.' || c.relname || ' (' || c.relkind::text || ')' AS relation
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE ${USER_NAMESPACES} AND n.nspname <> 'public' AND c.relkind IN ('r', 'p', 'f', 'v', 'm') ORDER BY 1`;
/** Exact relation (as NON_PUBLIC_RELATIONS_SQL renders it) -> reason. Empty: nothing lives outside `public`. */
const NON_PUBLIC_RELATIONS_ALLOWED = new Map<string, string>();

/**
 * PR43-SEC-06 (a) catalog half: no routine SET clause and no role / database setting names standard_conforming_strings
 * or backslash_quote (escape processing that would hide a key or an audit name without an E-string).
 */
const ESCAPE_SETTINGS_SQL = `
  SELECT 'function ' || p.oid::regprocedure::text || ' ' || c AS setting FROM pg_catalog.pg_proc p, pg_catalog.unnest(p.proconfig) c
   WHERE lower(pg_catalog.split_part(c, '=', 1)) IN ('standard_conforming_strings', 'backslash_quote')
  UNION ALL
  SELECT 'role ' || CASE s.setrole WHEN 0 THEN '<all>' ELSE s.setrole::regrole::text END
         || ' database ' || CASE s.setdatabase WHEN 0 THEN '<all>' ELSE '<one>' END || ' ' || c
    FROM pg_catalog.pg_db_role_setting s, pg_catalog.unnest(s.setconfig) c
   WHERE lower(pg_catalog.split_part(c, '=', 1)) IN ('standard_conforming_strings', 'backslash_quote')
   ORDER BY 1`;

/**
 * PR43-SEC-07 parameter ACL: no SET / ALTER SYSTEM grant on any parameter to PUBLIC or a platform_% role (a granted
 * session_replication_role would let a runtime session skip every origin-mode trigger, the std-columns guard included).
 */
const PARAMETER_ACL_SQL = `
  SELECT pa.parname || ' ' || a.privilege_type || ' ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grant
    FROM pg_catalog.pg_parameter_acl pa, pg_catalog.aclexplode(pa.paracl) a
   WHERE a.grantee = 0 OR a.grantee::regrole::text LIKE 'platform\\_%'
   ORDER BY 1`;
const REPLICATION_ROLE_SQL = `SELECT pg_catalog.has_parameter_privilege('platform_app', 'session_replication_role', 'SET') AS app_can_set`;

describe('catalog: routed object classes (PR11-SEC-15 d/e, PR24-SEC-02, PR11-SEC-14 b; TASK-024)', () => {
  it('PR11-SEC-15 d: platform_app (and so PUBLIC) holds CREATE on no schema; a planted GRANT CREATE ON SCHEMA public TO PUBLIC is named', async () => {
    expect(await query(SCHEMA_CREATE_SQL)).toEqual([]);
    const planted = await rolledBack('superuser', async (client) => {
      await client.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
      return rows(client, SCHEMA_CREATE_SQL);
    });
    expect(planted).toEqual([{ nspname: 'public' }]);
  }, 60_000);

  it('PR11-SEC-15 e: pg_rewrite holds only the _RETURN rules of views; a planted CREATE RULE … DO ALSO is named', async () => {
    expect(await query(RULES_SQL)).toEqual([]);
    const planted = await rolledBack('superuser', async (client) => {
      await client.query('CREATE RULE r_probe AS ON INSERT TO public.roles DO ALSO NOTIFY probe');
      return rows(client, RULES_SQL);
    });
    expect(planted).toEqual([{ rule: 'public.roles.r_probe' }]);
  }, 60_000);

  it('PR24-SEC-02 class fix: public and platform hold no operator outside an extension; a planted operator is named', async () => {
    expect(await query(OPERATORS_SQL)).toEqual([]);
    const planted = await rolledBack('superuser', async (client) => {
      await client.query('CREATE FUNCTION public.c_probe_eq(oid, oid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$');
      await client.query('CREATE OPERATOR public.= (LEFTARG = oid, RIGHTARG = oid, FUNCTION = public.c_probe_eq)');
      return rows(client, OPERATORS_SQL);
    });
    expect(planted).toEqual([{ operator: 'public.=(oid,oid)' }]);
  }, 60_000);

  it('PR11-SEC-14 b / PR43-SEC-06 (b): every function running a computed statement (plpgsql EXECUTE; query_to_xml family, ts_stat, ts_rewrite in any language) is reviewed; planted ones are named', async () => {
    const found = await query<DynamicSqlRow>(DYNAMIC_SQL_SQL);
    expect(dynamicSqlFindings(found, DYNAMIC_SQL_REVIEWED)).toEqual([]);
    expect(found.map((row) => row.fn)).toEqual(['platform.ensure_audit_partitions(integer)']); // the reviewed entry is still seen
    const planted = await rolledBack(db.migratorConnection(database), async (client) => {
      await client.query(`CREATE FUNCTION public.c_probe_dynamic(p text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE p; END $$`);
      await client.query(
        `CREATE FUNCTION public.c_probe_xml(q text) RETURNS xml LANGUAGE sql AS $$ SELECT pg_catalog.query_to_xml(q, true, false, '') $$`,
      );
      await client.query(
        `CREATE FUNCTION public.c_probe_xml_atomic() RETURNS xml LANGUAGE sql
           BEGIN ATOMIC SELECT pg_catalog.query_to_xmlschema('SELECT 1', true, false, ''); END`,
      );
      await client.query(
        `CREATE FUNCTION public.c_probe_tsstat(q text) RETURNS bigint LANGUAGE plpgsql
           AS $$ BEGIN RETURN (SELECT count(*) FROM pg_catalog.ts_stat(q)); END $$`,
      );
      await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
      return dynamicSqlFindings(await rows<DynamicSqlRow>(client, DYNAMIC_SQL_SQL), DYNAMIC_SQL_REVIEWED).sort();
    });
    expect(planted).toEqual([
      'public.c_probe_dynamic(text): not reviewed',
      'public.c_probe_tsstat(text): not reviewed',
      'public.c_probe_xml(text): not reviewed',
      'public.c_probe_xml_atomic(): not reviewed',
    ]);
  }, 60_000);

  it('PR43-SEC-06 (d): the reviewed list is keyed by signature plus the SHA-256 of the normalised body; a whitespace-only change passes, a body change under the same signature is named', async () => {
    const sign = 'public.c_probe_reviewed(text)';
    const reviewedBody = ' BEGIN EXECUTE p; END ';
    const reviewed = new Map([...DYNAMIC_SQL_REVIEWED, [sign, { sha256: bodySha256(reviewedBody), reason: 'control' }]]);
    const result = await rolledBack(db.migratorConnection(database), async (client) => {
      const define = async (body: string): Promise<string[]> => {
        await client.query(`CREATE OR REPLACE FUNCTION public.c_probe_reviewed(p text) RETURNS void LANGUAGE plpgsql AS $$${body}$$`);
        await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
        return dynamicSqlFindings(await rows<DynamicSqlRow>(client, DYNAMIC_SQL_SQL), reviewed);
      };
      const same = await define(reviewedBody);
      const reformatted = await define('\n  BEGIN\n    EXECUTE   p;\n  END\n');
      const changed = await define(` BEGIN EXECUTE p || ' -- x'; END `);
      return { same, reformatted, changed };
    });
    expect(result.same).toEqual([]);
    expect(result.reformatted).toEqual([]);
    expect(result.changed).toEqual([
      `${sign}: body sha256 ${bodySha256(` BEGIN EXECUTE p || ' -- x'; END `)} is not the reviewed ${bodySha256(reviewedBody)}`,
    ]);
  }, 60_000);

  it('PR11-SEC-11 e catalog half (R1-m4, PR43-SEC-10): no table, partitioned or foreign table, view or materialised view outside public; planted ones in platform and in a new schema are named', async () => {
    const live = (await query<{ relation: string }>(NON_PUBLIC_RELATIONS_SQL)).map((row) => row.relation);
    expect(live.filter((relation) => !NON_PUBLIC_RELATIONS_ALLOWED.has(relation))).toEqual([]);
    const planted = await rolledBack('superuser', async (client) => {
      await client.query(`
        CREATE TABLE platform.c_probe_t (id uuid PRIMARY KEY);
        CREATE TABLE platform.c_probe_p (id uuid NOT NULL) PARTITION BY HASH (id);
        CREATE VIEW platform.c_probe_v AS SELECT 1 AS x;
        CREATE MATERIALIZED VIEW platform.c_probe_m AS SELECT 1 AS x;
        CREATE SCHEMA c_probe_schema;
        CREATE TABLE c_probe_schema.t (id uuid);`);
      return (await rows<{ relation: string }>(client, NON_PUBLIC_RELATIONS_SQL))
        .map((row) => row.relation)
        .filter((relation) => !NON_PUBLIC_RELATIONS_ALLOWED.has(relation));
    });
    expect(planted).toEqual([
      'c_probe_schema.t (r)',
      'platform.c_probe_m (m)',
      'platform.c_probe_p (p)',
      'platform.c_probe_t (r)',
      'platform.c_probe_v (v)',
    ]);
  }, 60_000);

  it('PR43-SEC-06 (a): no routine SET clause or role/database setting names standard_conforming_strings or backslash_quote; planted ones are named', async () => {
    expect(await query(ESCAPE_SETTINGS_SQL)).toEqual([]);
    const planted = await rolledBack('superuser', async (client) => {
      await client.query('ALTER FUNCTION platform.app_org_id() SET standard_conforming_strings = off');
      await client.query(`ALTER ROLE ${APP_ROLE} SET backslash_quote = on`);
      return rows(client, ESCAPE_SETTINGS_SQL);
    });
    expect(planted).toEqual([
      { setting: 'function platform.app_org_id() standard_conforming_strings=off' },
      { setting: `role ${APP_ROLE} database <all> backslash_quote=on` },
    ]);
  }, 60_000);

  it('PR43-SEC-07: no parameter ACL grants SET or ALTER SYSTEM to PUBLIC or a platform_% role, and platform_app cannot set session_replication_role; a planted grant is named', async () => {
    expect(await query(PARAMETER_ACL_SQL)).toEqual([]);
    expect(await query(REPLICATION_ROLE_SQL)).toEqual([{ app_can_set: false }]);
    const planted = await rolledBack('superuser', async (client) => {
      await client.query(`GRANT SET ON PARAMETER session_replication_role TO ${APP_ROLE}`);
      await client.query('GRANT ALTER SYSTEM ON PARAMETER backslash_quote TO platform_migrator');
      return { acl: await rows(client, PARAMETER_ACL_SQL), role: await rows(client, REPLICATION_ROLE_SQL) };
    });
    expect(planted).toEqual({
      acl: [{ grant: 'backslash_quote ALTER SYSTEM platform_migrator' }, { grant: `session_replication_role SET ${APP_ROLE}` }],
      role: [{ app_can_set: true }],
    });
  }, 60_000);
});
