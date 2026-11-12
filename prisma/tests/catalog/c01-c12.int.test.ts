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
 * Implemented here: C1-C5, C8, C9, C11, C12 (on the probe), C13, C14 (partial). Deferred, with owners (PR #11 review
 * m4): C6, C7 and the C14 remainder -> TASK-021 (audit/immutability triggers); C10 -> TASK-028 (classification
 * registry); the per-table C12 generator -> TASK-024.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { SEED_SOURCE } from '../../../tools/authz/generate.js';
import { grantTuples, loadGrantsManifest, validateGrants } from '../../../tools/db/grants-manifest.js';
import { renderRls } from '../../../tools/db/render-rls.js';
import { loadTableClasses, rlsAllowList } from '../../../tools/db/table-classes.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres, SUPERUSER } from '../harness/postgres.js';
import {
  CONTEXT_HELPERS,
  enumCheckValues,
  scanFunctionBodies,
  scanPolicies,
  type CheckRow,
  type FunctionRow,
  type PolicyRow,
} from './scans.js';

const repoRoot = findRepoRoot();
const ENTRIES = loadTableClasses();
const ALLOW_LIST = rlsAllowList(ENTRIES);
const DEFINER_TABLES = new Set(ENTRIES.filter((e) => e.definerRead === true || e.definerPurge === true).map((e) => e.name));
const HARD_DELETE = new Set(ENTRIES.filter((e) => e.hardDelete === true).map((e) => e.name));
const POLICY_SNAPSHOT = JSON.parse(
  readFileSync(join(repoRoot, 'prisma', 'tests', 'catalog', 'policies.snapshot.json'), 'utf8'),
) as PolicyRow[];
const APP_IS_OPERATOR_TEMPLATE = readFileSync(join(repoRoot, 'prisma', 'sql', 'function-templates', 'app-is-operator.sql'), 'utf8');
/** RDS master at M5 (C13 (b)/(c)); empty locally. */
const MASTER_ROLE = process.env['CATALOG_BOOTSTRAP_MASTER_ROLE'] ?? '';
const SYSTEM_ACTOR = '00000000-0000-7000-8000-000000000001';

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const OPERATOR_ORG = randomUUID();
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
};

const names = (list: readonly { relname: string }[]): string[] => list.map((row) => row.relname);

// ---------------------------------------------------------------------------------------------------------------------
// The TENANT probe (rendered by the RLS renderer; always rolled back)
// ---------------------------------------------------------------------------------------------------------------------

const PROBE = 'c_probe_parcels';

/**
 * Inside the caller's transaction on a superuser session: as the migrator, plant minimal `memberships` /
 * `organisations` tables (TASK-037 creates the real ones) and `platform.app_is_operator()` from its template (lead
 * decision 5), then the TENANT probe table with its leading-org_id index, seed rows (before FORCE) and the RLS block
 * rendered by tools/db/render-rls.ts.
 */
async function plantProbe(client: pg.Client): Promise<string> {
  await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
  await client.query(`
    CREATE TABLE public.memberships (id uuid PRIMARY KEY, org_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL);
    CREATE TABLE public.organisations (id uuid PRIMARY KEY, type text NOT NULL);
    GRANT SELECT ON public.memberships, public.organisations TO platform_definer;
    INSERT INTO public.organisations (id, type) VALUES ('${OPERATOR_ORG}', 'OPERATOR'), ('${ORG_A}', 'CUSTOMER');
    INSERT INTO public.memberships (id, org_id, user_id, status) VALUES
      ('${randomUUID()}', '${OPERATOR_ORG}', '${OPERATOR_USER}', 'ACTIVE'), ('${randomUUID()}', '${ORG_A}', '${CUSTOMER_USER}', 'ACTIVE');
    CREATE TABLE public.${PROBE} (id uuid PRIMARY KEY, org_id uuid NOT NULL, ref text NOT NULL);
    CREATE INDEX ix_${PROBE}__org_id ON public.${PROBE} (org_id);
    GRANT SELECT, INSERT, UPDATE ON public.${PROBE} TO platform_app;
    INSERT INTO public.${PROBE} (id, org_id, ref) VALUES ('${ROW_A}', '${ORG_A}', 'A1'), ('${ROW_B}', '${ORG_B}', 'B1');`);
  await client.query(APP_IS_OPERATOR_TEMPLATE); // ends with RESET ROLE (to the session user)
  await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
  const rendered = renderRls({ module: 'probe', name: PROBE, class: 'TENANT' });
  await client.query(rendered);
  await client.query('RESET ROLE');
  return rendered;
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

  it('C3: policy definitions equal the committed snapshot and carry no forbidden token (scan proven on planted policies)', async () => {
    const live = await query<PolicyRow>(C3_SQL);
    expect(live).toEqual(POLICY_SNAPSHOT);
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
    const migration = await query<{ owner: string }>(
      `SELECT DISTINCT pg_catalog.pg_get_userbyid(c.relowner) AS owner FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname NOT LIKE 'bootstrap\\_migrations%'`,
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

  it('C13 (d): no database-wide setting; the bootstrap role pins search_path; platform_app role settings are exactly the four rows incl. statement_timeout=30s; no app.% default anywhere', async () => {
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
    // The backstop is what a platform_app session outside withTenantTx actually runs with (ADR-0005 am. 10 item 12).
    const session = await withClient(db.appConnection(database), async (client) => rows(client, 'SHOW statement_timeout'));
    expect(session).toEqual([{ statement_timeout: '30s' }]);
  }, 60_000);

  it('C13/C14: audit objects (TASK-021) are owned by platform_audit_owner and the DDL guard is enabled, as far as they exist', async () => {
    // TASK-021 ships the audit tables, functions and event triggers; until then these sets are empty and the check
    // binds the first audit object the moment it appears.
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
    const guards = await query<{ evtname: string; evtenabled: string; fn: string; prosecdef: boolean; proconfig: string[] | null }>(
      `SELECT e.evtname, e.evtenabled, e.evtfoid::regprocedure::text AS fn, p.prosecdef, p.proconfig
         FROM pg_catalog.pg_event_trigger e JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid ORDER BY 1`,
    );
    for (const guard of guards) {
      expect(guard).toEqual({
        evtname: guard.evtname,
        evtenabled: 'O',
        fn: 'platform.audit_ddl_guard()',
        prosecdef: false,
        proconfig: ['search_path=pg_catalog, pg_temp'],
      });
    }
    if (guards.length > 0) expect(guards.map((g) => g.evtname)).toEqual(['platform_audit_ddl_guard_drop', 'platform_audit_ddl_guard_end']);
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
    expect(drifted).toEqual({ ck_roles__scope: ['CUSTOMER', 'OPERATOR'] });
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
