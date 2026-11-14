/**
 * Database side of the RLS generator (TASK-024): reads the live catalogue into `LiveTable`s, seeds the A/B rows of a
 * table under test, and runs one probe as the runtime role `platform_app` inside a transaction that is always rolled
 * back, with the tenant context set by the production statement (`CONTEXT_STATEMENT_SQL` of withTenantTx, so the
 * suite exercises the same `set_config(..., true)` path as the runtime, US-077 AT-04).
 *
 * Seeding runs on a superuser session with `session_replication_role = replica` for that one transaction: RLS is
 * bypassed by the superuser, and foreign keys and row triggers (the de-claim and standard-columns guards) are not
 * fired, so any table can be seeded from synthetic values. The probes themselves never run privileged.
 */
import type pg from 'pg';

import { CONTEXT_STATEMENT_SQL } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { quoteIdentifier } from '../../../tools/db/sql-text.js';
import { ROW_OVERRIDES } from './fixtures.js';
import {
  type ColumnInfo,
  DECLAIM_MARKER,
  type IsolationCase,
  type IsolationKey,
  type LiveTable,
  type Observation,
  type ProbeKind,
  RLS_MARKER,
  STD_GUARD_MARKER,
  type SynthesisedRow,
  type TablePrivilege,
  TABLE_PRIVILEGES,
  hasStdColumns,
  insertStamps,
  stableHash,
  stableUuid,
  synthesiseRow,
} from './generator.js';

// ---------------------------------------------------------------------------------------------------------------------
// Identities (deterministic)
// ---------------------------------------------------------------------------------------------------------------------

export interface Tenant {
  readonly org: string;
  readonly actor: string;
}

export const TENANT_A: Tenant = { org: stableUuid('rls-generator:org-A'), actor: stableUuid('rls-generator:user-A') };
export const TENANT_B: Tenant = { org: stableUuid('rls-generator:org-B'), actor: stableUuid('rls-generator:user-B') };
/** The guest token hash of the planted guest rows, and a different one. */
export const GUEST_HASH = stableHash('H');
export const OTHER_GUEST_HASH = stableHash('H2');
/** The actor `platform.std_columns_guard()` expects when no actor is set (guest sessions; data-model §7.6). */
export const ANONYMOUS_ACTOR = '00000000-0000-7000-8000-000000000002';
const CORRELATION = 'rls-generator';
/** statement_timeout, lock_timeout, idle_in_transaction_session_timeout of the probe transactions (ms). */
const TIMEOUTS = ['10000', '2000', '10000'] as const;

/** The eight bind values of the production context statement; deliberately unvalidated (malformed probes). */
type RawContext = readonly [org: string, actor: string, scope: string, guestHash: string];

const CONTEXTS = {
  tenantA: [TENANT_A.org, TENANT_A.actor, 'TENANT', ''],
  forcedOperator: [TENANT_A.org, TENANT_A.actor, 'OPERATOR', ''],
  empty: ['', '', '', ''],
  malformed: ['not-a-uuid', 'not-a-uuid', 'TENANT', ''],
  guestOwn: ['', '', 'TENANT', GUEST_HASH],
  guestOther: ['', '', 'TENANT', OTHER_GUEST_HASH],
  claim: [TENANT_A.org, TENANT_A.actor, 'TENANT', GUEST_HASH],
} as const satisfies Record<string, RawContext>;

// ---------------------------------------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Every relation of every user schema: tables in `public` (the manifest's domain) and, outside it, any table, view,
 * materialised view or foreign table, which `enumerationFindings` reports (R1-m4). Triggers are listed only when they
 * fire in an ordinary session (`tgenabled` O or A): a guard switched to REPLICA or disabled is absent (PR43-SEC-05 (d)).
 */
const LIVE_TABLES_SQL = `
  SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
         coalesce((SELECT json_agg(json_build_object(
                     'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
                     'hasDefault', a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '') ORDER BY a.attnum)
                     FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '[]') AS columns,
         coalesce((SELECT json_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
                    WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')), '[]') AS triggers,
         ARRAY(SELECT p FROM unnest($1::text[]) p WHERE has_table_privilege('platform_app', c.oid, p)) AS privileges,
         coalesce((SELECT json_agg(json_build_object('column', a.attname, 'def', pg_get_constraintdef(k.oid)))
                     FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                    WHERE k.conrelid = c.oid AND k.contype = 'c' AND cardinality(k.conkey) = 1), '[]') AS checks
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
     AND n.nspname NOT LIKE 'pg\\_temp\\_%' AND NOT c.relispartition
     AND (c.relkind IN ('r', 'p') OR (n.nspname <> 'public' AND c.relkind IN ('v', 'm', 'f')))
   ORDER BY n.nspname, c.relname`;

interface LiveTableRow {
  schema: string;
  name: string;
  kind: string;
  rls: boolean;
  forced: boolean;
  columns: Omit<ColumnInfo, 'enumValues'>[];
  triggers: string[];
  privileges: string[];
  checks: { column: string; def: string }[];
}

/** Values of a deparsed single-column enum CHECK (`(col = ANY (ARRAY['A'::text, …]))` or `(col = 'A'::text)`). */
export function enumCheckValues(definition: string): string[] | undefined {
  if (!/^CHECK \(\(?\(?[a-z_][a-z0-9_]*\)?(?:::text)? = (?:ANY \(\(?ARRAY\[|')/.test(definition)) return undefined;
  const values = [...definition.matchAll(/'((?:[^']|'')*)'::(?:text|character varying|bpchar)/g)].map((match) =>
    (match[1] ?? '').replace(/''/g, "'"),
  );
  return values.length > 0 ? values : undefined;
}

const isPrivilege = (value: string): value is TablePrivilege => (TABLE_PRIVILEGES as readonly string[]).includes(value);

export async function readLiveTables(client: pg.ClientBase): Promise<LiveTable[]> {
  const { rows } = await client.query<LiveTableRow>(LIVE_TABLES_SQL, [TABLE_PRIVILEGES]);
  return rows.map((row) => {
    const enums = new Map<string, string[]>();
    for (const check of row.checks) {
      const values = enumCheckValues(check.def);
      if (values !== undefined) enums.set(check.column, values);
    }
    return {
      schema: row.schema,
      name: row.name,
      kind: row.kind,
      rowSecurity: row.rls,
      forceRowSecurity: row.forced,
      triggers: row.triggers,
      appPrivileges: row.privileges.filter(isPrivilege),
      columns: row.columns.map((column) => {
        const values = enums.get(column.name);
        return values === undefined ? column : { ...column, enumValues: values };
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------------------------------------

/** The rows planted for one table under test. */
export interface TablePlan {
  readonly table: LiveTable;
  readonly key: IsolationKey;
  readonly rowA: string;
  readonly rowB: string;
  readonly keyA: string;
  readonly keyB: string;
  /** GUEST_CAPABLE only: the guest row (org_id NULL, hash GUEST_HASH). */
  readonly guestRow?: string;
  /** The seeded rows, column -> value (A, B and, GUEST_CAPABLE only, the guest row G): API paths and restores. */
  readonly seeded: Readonly<Record<SeededRow, SynthesisedRow | undefined>>;
}

export type SeededRow = 'A' | 'B' | 'G';

/** Column -> value of a seeded row (the API case runner fills path parameters from it). */
export function seededValues(plan: TablePlan, row: SeededRow): Readonly<Record<string, unknown>> {
  const seeded = plan.seeded[row];
  if (seeded === undefined) throw new Error(`${plan.table.name}: no seeded row ${row}`);
  return Object.fromEntries(seeded.columns.map((column, index) => [column, seeded.values[index]]));
}

const keyOf = (key: IsolationKey, tenant: Tenant): string => (key.scope === 'org' ? tenant.org : tenant.actor);

/** Column values that tie a row to `tenant` (isolation key, the other scope's column, standard-column stamps). */
function ownership(table: LiveTable, key: IsolationKey, tenant: Tenant, id: string): Record<string, unknown> {
  const has = (name: string): boolean => table.columns.some((column) => column.name === name);
  const values: Record<string, unknown> = { ...insertStamps(table, tenant.actor) };
  if (has('id')) values['id'] = id;
  if (has('org_id')) values['org_id'] = tenant.org;
  if (has('user_id')) values['user_id'] = tenant.actor;
  values[key.column] = keyOf(key, tenant);
  return { ...(ROW_OVERRIDES[table.name] ?? {}), ...values };
}

function insertSql(table: string, columns: readonly string[]): string {
  const names = columns.map((column) => quoteIdentifier(column)).join(', ');
  const params = columns.map((_, index) => `$${String(index + 1)}`).join(', ');
  return `INSERT INTO public.${quoteIdentifier(table)} (${names}) VALUES (${params})`;
}

/** Seeds the A and B rows (and the guest row of a GUEST_CAPABLE table), committed; returns the plan. */
export async function seedTable(superuser: pg.ClientBase, table: LiveTable, key: IsolationKey, guest: boolean): Promise<TablePlan> {
  const idOf = (tenant: Tenant, label: string): string => (key.column === 'id' ? keyOf(key, tenant) : stableUuid(`${table.name}:${label}`));
  const rowA = idOf(TENANT_A, 'row-A');
  const rowB = idOf(TENANT_B, 'row-B');
  const rows = [
    synthesiseRow(table, ownership(table, key, TENANT_A, rowA), 'A'),
    synthesiseRow(table, ownership(table, key, TENANT_B, rowB), 'B'),
  ];
  const guestRow = guest ? stableUuid(`${table.name}:guest`) : undefined;
  if (guestRow !== undefined) {
    const owner = ownership(table, key, TENANT_A, guestRow);
    rows.push(synthesiseRow(table, { ...owner, org_id: null, guest_token_hash: Buffer.from(GUEST_HASH, 'hex') }, 'G'));
  }
  const plan: TablePlan = {
    table,
    key,
    rowA,
    rowB,
    keyA: keyOf(key, TENANT_A),
    keyB: keyOf(key, TENANT_B),
    ...(guestRow === undefined ? {} : { guestRow }),
    seeded: { A: rows[0], B: rows[1], G: rows[2] },
  };
  await writeSeededRows(superuser, plan, false);
  return plan;
}

/**
 * Writes the plan's seeded rows in one committed transaction with triggers and foreign keys off. With `replace`, each
 * row is deleted by id first: the API case runner restores the rows after a case whose positive control wrote to them.
 */
async function writeSeededRows(superuser: pg.ClientBase, plan: TablePlan, replace: boolean): Promise<void> {
  const t = `public.${quoteIdentifier(plan.table.name)}`;
  const ids = [plan.rowA, plan.rowB, ...(plan.guestRow === undefined ? [] : [plan.guestRow])];
  await superuser.query('BEGIN');
  try {
    await superuser.query('SET LOCAL session_replication_role = replica');
    if (replace) await superuser.query(`DELETE FROM ${t} WHERE id = ANY ($1::uuid[])`, [ids]);
    for (const row of Object.values(plan.seeded)) {
      if (row !== undefined) await superuser.query(insertSql(plan.table.name, row.columns), [...row.values]);
    }
    await superuser.query('COMMIT');
  } catch (error) {
    await superuser.query('ROLLBACK');
    throw error;
  }
}

/** Restores the seeded A/B(/G) rows of `plan` exactly (committed). */
export async function restoreSeededRows(superuser: pg.ClientBase, plan: TablePlan): Promise<void> {
  await writeSeededRows(superuser, plan, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------------------------------------------------

async function setContext(client: pg.ClientBase, context: RawContext | null): Promise<void> {
  if (context === null) return;
  await client.query(CONTEXT_STATEMENT_SQL, [...context, CORRELATION, ...TIMEOUTS]);
}

/** Runs `sql` and returns its row count (`count` column for a SELECT count, else rowCount) or its SQLSTATE. */
async function observe(client: pg.ClientBase, sql: string, params: readonly unknown[]): Promise<Observation> {
  await client.query('SAVEPOINT probe');
  try {
    const result = await client.query<{ n?: number }>(sql, [...params]);
    await client.query('RELEASE SAVEPOINT probe');
    const counted = result.rows[0]?.n;
    return { rows: typeof counted === 'number' ? counted : (result.rowCount ?? 0) };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    const { code, message } = error as { code?: unknown; message?: unknown };
    const text = typeof message === 'string' ? message : '';
    const marker = [DECLAIM_MARKER, STD_GUARD_MARKER, RLS_MARKER].find((candidate) => text.includes(candidate));
    return { sqlState: String(code), ...(marker === undefined ? {} : { marker }) };
  }
}

interface ProbeStatement {
  readonly context: RawContext | null;
  readonly sql: string;
  readonly params: readonly unknown[];
}

function statementFor(plan: TablePlan, kind: ProbeKind): ProbeStatement {
  const t = `public.${quoteIdentifier(plan.table.name)}`;
  const k = quoteIdentifier(plan.key.column);
  const countById = `SELECT count(*)::int AS n FROM ${t} WHERE id = $1`;
  const countAll = `SELECT count(*)::int AS n FROM ${t}`;
  const guest = plan.guestRow ?? '';
  switch (kind) {
    case 'own-row-visible':
      return { context: CONTEXTS.tenantA, sql: countById, params: [plan.rowA] };
    case 'select-foreign-id':
      return { context: CONTEXTS.tenantA, sql: countById, params: [plan.rowB] };
    case 'select-foreign-key':
      return { context: CONTEXTS.tenantA, sql: `SELECT count(*)::int AS n FROM ${t} WHERE ${k} = $1`, params: [plan.keyB] };
    case 'update-foreign-id':
      return { context: CONTEXTS.tenantA, sql: `UPDATE ${t} SET ${k} = ${k} WHERE id = $1`, params: [plan.rowB] };
    case 'delete-foreign-id':
      return { context: CONTEXTS.tenantA, sql: `DELETE FROM ${t} WHERE id = $1`, params: [plan.rowB] };
    case 'update-blind':
      // No column is read (constants only, no WHERE, no RETURNING), so no SELECT policy filters the rows: only the
      // UPDATE policies decide (PR43-SEC-02). The stamps satisfy the standard-columns guard on A's row (version 1 -> 2).
      return {
        context: CONTEXTS.tenantA,
        sql: `UPDATE ${t} SET ${k} = $1${hasStdColumns(plan.table) ? ', updated_by = $2, version = 2' : ''}`,
        params: [plan.keyA, ...stampParams(plan.table)],
      };
    case 'delete-blind':
      return { context: CONTEXTS.tenantA, sql: `DELETE FROM ${t}`, params: [] };
    case 'reparent-own-row':
      return {
        context: CONTEXTS.tenantA,
        sql: `UPDATE ${t} SET ${k} = $2${stampUpdate(plan.table, 3)} WHERE id = $1`,
        params: [plan.rowA, plan.keyB, ...stampParams(plan.table)],
      };
    case 'guest-context-tenant-rows':
      return {
        context: CONTEXTS.guestOwn,
        sql: `SELECT count(*)::int AS n FROM ${t} WHERE id = ANY ($1::uuid[])`,
        params: [[plan.rowA, plan.rowB]],
      };
    case 'guest-update-other-hash':
      return { context: CONTEXTS.guestOther, sql: `UPDATE ${t} SET guest_token_hash = $1`, params: [Buffer.from(OTHER_GUEST_HASH, 'hex')] };
    case 'guest-insert-with-org': {
      // A guest (hash H, no organisation, the anonymous actor's stamps) writing a row of organisation A.
      const id = stableUuid(`${plan.table.name}:guest-insert`);
      const owner: Record<string, unknown> = {
        ...ownership(plan.table, plan.key, TENANT_A, id),
        ...insertStamps(plan.table, ANONYMOUS_ACTOR),
        guest_token_hash: Buffer.from(GUEST_HASH, 'hex'),
      };
      const row = synthesiseRow(plan.table, owner, 'GI');
      return { context: CONTEXTS.guestOwn, sql: insertSql(plan.table.name, row.columns), params: row.values };
    }
    case 'insert-foreign-key': {
      // B's key, A's stamps: the standard-columns guard (when present) passes, so WITH CHECK is what refuses it.
      const id = stableUuid(`${plan.table.name}:insert-foreign`);
      const owner: Record<string, unknown> = {
        ...ownership(plan.table, plan.key, TENANT_B, id),
        ...insertStamps(plan.table, TENANT_A.actor),
      };
      if (plan.key.column === 'id') owner['id'] = plan.keyB;
      const row = synthesiseRow(plan.table, owner, 'X');
      return { context: CONTEXTS.tenantA, sql: insertSql(plan.table.name, row.columns), params: row.values };
    }
    case 'no-context':
      return { context: null, sql: countAll, params: [] };
    case 'empty-context':
      return { context: CONTEXTS.empty, sql: countAll, params: [] };
    case 'malformed-context':
      return { context: CONTEXTS.malformed, sql: countAll, params: [] };
    case 'forced-operator':
      return { context: CONTEXTS.forcedOperator, sql: countById, params: [plan.rowB] };
    case 'operator-policies-select-only':
      // -1 when the table has no operator policy at all (the renderer always emits one): a vacuous pass is a failure.
      return {
        context: null,
        sql: `SELECT CASE WHEN count(*) FILTER (WHERE op) = 0 THEN -1 ELSE count(*) FILTER (WHERE op AND cmd <> 'SELECT') END::int AS n
                FROM (SELECT cmd, concat_ws(' ', qual, with_check) LIKE '%platform.app_is_operator()%' AS op
                        FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = $1) p`,
        params: [plan.table.name],
      };
    case 'guest-no-settings':
      return { context: null, sql: countById, params: [guest] };
    case 'guest-empty-settings':
      return { context: CONTEXTS.empty, sql: countById, params: [guest] };
    case 'guest-org-without-hash':
      return { context: CONTEXTS.tenantA, sql: countById, params: [guest] };
    case 'guest-other-hash':
      return { context: CONTEXTS.guestOther, sql: countById, params: [guest] };
    case 'guest-own-hash':
      return { context: CONTEXTS.guestOwn, sql: countById, params: [guest] };
    case 'guest-declaim-refused':
      return {
        context: CONTEXTS.claim,
        sql: `UPDATE ${t} SET org_id = NULL, guest_token_hash = $2${stampUpdate(plan.table, 3)} WHERE id = $1`,
        params: [plan.rowA, Buffer.from(GUEST_HASH, 'hex'), ...stampParams(plan.table)],
      };
    case 'guest-claim-allowed':
      return {
        context: CONTEXTS.claim,
        sql: `UPDATE ${t} SET org_id = $2, guest_token_hash = NULL${stampUpdate(plan.table, 3)} WHERE id = $1 AND org_id IS NULL`,
        params: [guest, TENANT_A.org, ...stampParams(plan.table)],
      };
  }
}

/** The update stamps the standard-columns guard requires (`updated_by` = actor, `version` + 1), when the table has them. */
const stampUpdate = (table: LiveTable, from: number): string =>
  hasStdColumns(table) ? `, updated_by = $${String(from)}, version = version + 1` : '';
const stampParams = (table: LiveTable): unknown[] => (hasStdColumns(table) ? [TENANT_A.actor] : []);

/**
 * Runs one probe as `platform_app` (the caller's client) in a transaction that is always rolled back. With
 * `inTransaction` the caller already holds a transaction (a mutation control that planted something): the probe then
 * runs in a savepoint that is rolled back, which also reverts its transaction-local context.
 */
export async function runProbe(app: pg.ClientBase, plan: TablePlan, kind: ProbeKind, inTransaction = false): Promise<Observation> {
  const statement = statementFor(plan, kind);
  await app.query(inTransaction ? 'SAVEPOINT rls_case' : 'BEGIN');
  try {
    await setContext(app, statement.context);
    return await observe(app, statement.sql, statement.params);
  } finally {
    await app.query(inTransaction ? 'ROLLBACK TO SAVEPOINT rls_case' : 'ROLLBACK');
  }
}

/** Runs every case of `cases` inside the caller's transaction; returns `table kind -> observation` (mutation controls). */
export async function runCases(
  app: pg.ClientBase,
  plans: ReadonlyMap<string, TablePlan>,
  cases: readonly IsolationCase[],
): Promise<Map<string, Observation>> {
  const observed = new Map<string, Observation>();
  for (const isolationCase of cases) {
    const plan = plans.get(isolationCase.table);
    if (plan === undefined) throw new Error(`no seeded plan for ${isolationCase.table}`);
    observed.set(`${isolationCase.table} ${isolationCase.kind}`, await runProbe(app, plan, isolationCase.kind, true));
  }
  return observed;
}

/** Sets A's tenant context (TENANT scope) transaction-locally with the production statement. */
export async function setTenantAContext(client: pg.ClientBase): Promise<void> {
  await setContext(client, CONTEXTS.tenantA);
}

/** Sets an arbitrary context transaction-locally with the production statement (operator positive control). */
export async function setContextValues(client: pg.ClientBase, org: string, actor: string, scope: 'TENANT' | 'OPERATOR'): Promise<void> {
  await setContext(client, [org, actor, scope, '']);
}
