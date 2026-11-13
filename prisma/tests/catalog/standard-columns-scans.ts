/**
 * Catalogue queries and pure finding functions for the US-064 schema checks (standard columns, UTC time, local dates,
 * server-set actor columns, key generation, on-behalf seam; NFR-DATA-002/003; REQ-RLS-009/012; REQ-ORG-007).
 * The SQL returns raw catalogue rows; the functions turn rows into findings (`<table>.<column>: <reason>`), so the
 * committed catalogue and the planted, rolled-back probes run the exact same code.
 */

export interface ColumnRow {
  schema_name: string;
  table_name: string;
  column_name: string;
  /** pg_type.typname: uuid, timestamptz, timestamp, time, date, text, int4, int8, ... */
  type_name: string;
  not_null: boolean;
  default_expr: string | null;
  /** pg_attribute.attidentity: '' (none), 'a' (ALWAYS) or 'd' (BY DEFAULT). */
  identity: string;
}

export interface PrimaryKeyRow {
  table_name: string;
  pk_columns: string[];
}

export interface CheckConstraintRow {
  table_name: string;
  conname: string;
  def: string;
}

export interface OnBehalfRow {
  schema_name: string;
  table_name: string;
  type_name: string;
  not_null: boolean;
  checks: string[];
}

/** Schemas of ours: public, platform and audit (a schema that does not exist simply yields no rows). */
export const OUR_SCHEMAS = ['public', 'platform', 'audit'];

/** Base tables (ordinary and partitioned parents, never partitions) with their columns. */
export const COLUMNS_SQL = `
  SELECT n.nspname::text AS schema_name, c.relname::text AS table_name, a.attname::text AS column_name,
         t.typname::text AS type_name, a.attnotnull AS not_null,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr, a.attidentity::text AS identity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = ANY ($1::text[]) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
   ORDER BY 1, 2, a.attnum`;

export const PRIMARY_KEYS_SQL = `
  SELECT c.relname::text AS table_name, array_agg(a.attname::text ORDER BY a.attname)::text[] AS pk_columns
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
   WHERE k.contype = 'p' AND n.nspname = $1 AND NOT c.relispartition
   GROUP BY c.relname ORDER BY 1`;

export const CHECKS_SQL = `
  SELECT c.relname::text AS table_name, k.conname::text AS conname, pg_catalog.pg_get_constraintdef(k.oid) AS def
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE k.contype = 'c' AND n.nspname = $1 AND NOT c.relispartition
   ORDER BY 1, 2`;

/** Every `on_behalf_of_org_id` column in any non-system schema, with the CHECK definitions of its table. */
export const ON_BEHALF_SQL = `
  SELECT n.nspname::text AS schema_name, c.relname::text AS table_name, t.typname::text AS type_name,
         a.attnotnull AS not_null,
         ARRAY(SELECT pg_catalog.pg_get_constraintdef(k.oid) FROM pg_catalog.pg_constraint k
                WHERE k.conrelid = c.oid AND k.contype = 'c' ORDER BY k.conname)::text[] AS checks
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
   WHERE a.attname = 'on_behalf_of_org_id' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg\\_temp%'
   ORDER BY 1, 2`;

const qualify = (schema: string, table: string): string => (schema === 'public' ? table : `${schema}.${table}`);

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-064-04: UTC time. `time without time zone` is allowed (data-model P4: a local time of day is `time` plus a
// stated zone column); only `timestamp without time zone` is a defect.
// ---------------------------------------------------------------------------------------------------------------------

export function naiveTimestampFindings(columns: readonly ColumnRow[]): string[] {
  return columns
    .filter((c) => c.type_name === 'timestamp')
    .map((c) => `${qualify(c.schema_name, c.table_name)}.${c.column_name}: timestamp without time zone`)
    .sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-064-05: local-by-nature dates carry an IANA zone (data-model P4).
// ---------------------------------------------------------------------------------------------------------------------

/** `table.column` -> reason a `date` column may live without a zone column. Empty today: every date has a zone. */
export const DATE_ZONE_EXEMPT: Record<string, string> = {};

const isZoneColumn = (c: ColumnRow): boolean =>
  c.type_name === 'text' && (c.column_name === 'time_zone' || c.column_name.endsWith('_time_zone'));

export function dateZoneFindings(columns: readonly ColumnRow[], exempt: Readonly<Record<string, string>> = DATE_ZONE_EXEMPT): string[] {
  const zoned = new Set(columns.filter(isZoneColumn).map((c) => qualify(c.schema_name, c.table_name)));
  return columns
    .filter((c) => c.type_name === 'date')
    .map((c) => ({ table: qualify(c.schema_name, c.table_name), column: c.column_name }))
    .filter(({ table, column }) => !zoned.has(table) && !Object.hasOwn(exempt, `${table}.${column}`))
    .map(({ table, column }) => `${table}.${column}: date without an IANA time-zone column`)
    .sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// NFR-DATA-003: standard columns on every base table of `public`.
// ---------------------------------------------------------------------------------------------------------------------

/** Tables outside the standard-column contract, by exact name. */
export const STANDARD_COLUMNS_EXEMPT: Record<string, string> = {
  _prisma_migrations: 'Prisma migration history (written by prisma migrate, shape owned by Prisma)',
  bootstrap_migrations: 'bootstrap-lane ledger (written by tools/db/bootstrap.ts, shape owned by the lane)',
};

/**
 * OI-08 append-only family (by pattern; NFR-DATA-003 exemption D-043, ADR-0007 am. 6): never updated, so no
 * `updated_*` / `version` requirement, and their keys follow ADR-0007 (the partitioned `audit_entries` is keyed
 * `(occurred_at, id)` with an application id, `audit_pii_vault` by `token`, `audit_anchors` by the chained
 * `anchor_seq`, ADR-0007 am. 7; their shapes are pinned by the audit catalog suite, TASK-021). Required here: a
 * `timestamptz NOT NULL` creation column (`created_at` or `occurred_at`).
 */
export const APPEND_ONLY_PATTERNS: readonly RegExp[] = [
  /^audit_entries/,
  /^audit_pii_vault$/,
  /^audit_checkpoint_heads$/,
  /^audit_anchors$/,
  /^outbox_events$/,
  /^processed_events$/,
];

/** Defaults accepted for created_at / updated_at: `now()` and its SQL-standard alias (Prisma emits CURRENT_TIMESTAMP). */
const NOW_DEFAULTS = new Set(['now()', 'CURRENT_TIMESTAMP']);
/** `version >= 1`, or `version = 1` for rows that are never updated (data-model P2: append-only rows keep version 1). */
const VERSION_CHECK = /(^|[^\w])version (>= 1|= 1)\b/;

export interface StandardColumnInput {
  columns: readonly ColumnRow[];
  primaryKeys: readonly PrimaryKeyRow[];
  checks: readonly CheckConstraintRow[];
}

export function standardColumnFindings(
  { columns, primaryKeys, checks }: StandardColumnInput,
  exempt: Readonly<Record<string, string>> = STANDARD_COLUMNS_EXEMPT,
): string[] {
  const findings: string[] = [];
  const tables = [...new Set(columns.map((c) => c.table_name))];
  for (const table of tables) {
    if (Object.hasOwn(exempt, table)) continue;
    const cols = new Map(columns.filter((c) => c.table_name === table).map((c) => [c.column_name, c]));
    if (APPEND_ONLY_PATTERNS.some((pattern) => pattern.test(table))) {
      const created = ['created_at', 'occurred_at'].map((name) => cols.get(name));
      if (!created.some((c) => c !== undefined && c.type_name === 'timestamptz' && c.not_null)) {
        findings.push(`${table}: missing created_at or occurred_at timestamptz NOT NULL`);
      }
      continue;
    }

    const id = cols.get('id');
    if (id === undefined) {
      findings.push(`${table}: missing id`);
    } else {
      if (id.type_name !== 'uuid') findings.push(`${table}.id: type is ${id.type_name}, expected uuid`);
      if (!id.not_null) findings.push(`${table}.id: must be NOT NULL`);
      if (id.default_expr !== 'uuidv7()') findings.push(`${table}.id: DEFAULT is not uuidv7()`);
      const pk = primaryKeys.find((row) => row.table_name === table)?.pk_columns ?? [];
      if (pk.length !== 1 || pk[0] !== 'id') {
        findings.push(`${table}.id: primary key is (${pk.join(', ') || 'none'}), expected (id) alone`);
      }
    }

    for (const name of ['created_at', 'updated_at']) {
      const col = cols.get(name);
      if (col === undefined) {
        findings.push(`${table}: missing ${name}`);
        continue;
      }
      if (col.type_name !== 'timestamptz') findings.push(`${table}.${name}: type is ${col.type_name}, expected timestamptz`);
      if (!col.not_null) findings.push(`${table}.${name}: must be NOT NULL`);
      if (col.default_expr === null || !NOW_DEFAULTS.has(col.default_expr)) {
        findings.push(`${table}.${name}: DEFAULT is not now()`);
      }
    }

    for (const name of ['created_by', 'updated_by']) {
      const col = cols.get(name);
      if (col === undefined) {
        findings.push(`${table}: missing ${name}`);
        continue;
      }
      if (col.type_name !== 'uuid') findings.push(`${table}.${name}: type is ${col.type_name}, expected uuid`);
      if (!col.not_null) findings.push(`${table}.${name}: must be NOT NULL`);
      if (col.default_expr !== null) findings.push(`${table}.${name}: server-set column must not have a DEFAULT`);
    }

    const version = cols.get('version');
    if (version === undefined) {
      findings.push(`${table}: missing version`);
    } else {
      if (version.type_name !== 'int4') findings.push(`${table}.version: type is ${version.type_name}, expected int4`);
      if (!version.not_null) findings.push(`${table}.version: must be NOT NULL`);
      if (version.default_expr !== '1') findings.push(`${table}.version: DEFAULT is not 1`);
      if (!checks.some((k) => k.table_name === table && VERSION_CHECK.test(k.def))) {
        findings.push(`${table}.version: missing CHECK (version >= 1)`);
      }
    }
  }
  return findings.sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// NFR-DATA-002: keys are uuid; no serial, identity or sequence-backed column.
// ---------------------------------------------------------------------------------------------------------------------

export function sequenceKeyFindings(columns: readonly ColumnRow[]): string[] {
  const findings: string[] = [];
  for (const c of columns) {
    const where = `${qualify(c.schema_name, c.table_name)}.${c.column_name}`;
    if (c.identity !== '') findings.push(`${where}: identity column`);
    else if (c.default_expr !== null && c.default_expr.startsWith('nextval(')) findings.push(`${where}: sequence default`);
  }
  return findings.sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// REQ-ORG-007 / data-model OI-24: the on-behalf seam stays NULL in M1 (`ck_<table>__on_behalf_null_m1`).
// ---------------------------------------------------------------------------------------------------------------------

/** `CHECK ((on_behalf_of_org_id IS NULL))` with any parenthesisation, optionally NOT VALID. */
const ON_BEHALF_NULL_CHECK = /^CHECK \(+on_behalf_of_org_id IS NULL\)+(?: NOT VALID)?$/;

/**
 * Tables whose `on_behalf_of_org_id` is not the business seam: the audit record copies the value of the audited row
 * (REQ-ORG-007 "record both on the audit entry"); the M1 guardrail CHECK sits on the business tables.
 */
export const ON_BEHALF_EXEMPT: Record<string, string> = {
  audit_entries: 'audit copy of the audited row (REQ-ORG-007); append-only, guarded by the business-table CHECK',
};

export function onBehalfFindings(rows: readonly OnBehalfRow[], exempt: Readonly<Record<string, string>> = ON_BEHALF_EXEMPT): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    if (row.schema_name === 'public' && Object.hasOwn(exempt, row.table_name)) continue;
    const where = `${qualify(row.schema_name, row.table_name)}.on_behalf_of_org_id`;
    if (row.type_name !== 'uuid') findings.push(`${where}: type is ${row.type_name}, expected uuid`);
    if (row.not_null) findings.push(`${where}: must be nullable`);
    if (!row.checks.some((def) => ON_BEHALF_NULL_CHECK.test(def))) {
      findings.push(`${where}: missing CHECK (on_behalf_of_org_id IS NULL), expected ck_${row.table_name}__on_behalf_null_m1`);
    }
  }
  return findings.sort();
}

/**
 * Prisma field name -> database column of every standard column, as the standard-columns query extension keys them
 * (PR26-SEC-06). The extension works on Prisma names and this suite on database names; this table bridges the two.
 */
export const STANDARD_COLUMN_PAIRS: Readonly<Record<string, string>> = Object.freeze({
  id: 'id',
  orgId: 'org_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  createdBy: 'created_by',
  updatedBy: 'updated_by',
  version: 'version',
  onBehalfOfOrgId: 'on_behalf_of_org_id',
});

interface RuntimeField {
  readonly name?: unknown;
  readonly dbName?: unknown;
}

/**
 * Naming drift between Prisma fields and database columns that would silently disable the extension's stamping and
 * refusal: a field mapped to a standard column under another name (`creatorId @map("created_by")`), or a standard
 * Prisma name mapped to another column. `dataModel` is Prisma's runtime data model (`models.<Name>.fields[]`, with
 * `dbName` present only when the column is mapped).
 */
export function namingParityFindings(dataModel: unknown): string[] {
  const models = (dataModel as { models?: Record<string, { fields?: RuntimeField[] }> } | null)?.models ?? {};
  const columnToField = new Map(Object.entries(STANDARD_COLUMN_PAIRS).map(([field, column]) => [column, field]));
  const findings: string[] = [];
  for (const [modelName, model] of Object.entries(models)) {
    for (const field of model.fields ?? []) {
      if (typeof field.name !== 'string') continue;
      const column = typeof field.dbName === 'string' ? field.dbName : field.name;
      const expectedColumn = Object.hasOwn(STANDARD_COLUMN_PAIRS, field.name) ? STANDARD_COLUMN_PAIRS[field.name] : undefined;
      const expectedField = columnToField.get(column);
      if (expectedColumn !== undefined && expectedColumn !== column) {
        findings.push(`${modelName}.${field.name}: maps to column ${column}, expected ${expectedColumn}`);
      } else if (expectedField !== undefined && expectedField !== field.name) {
        findings.push(`${modelName}.${field.name}: column ${column} must be the Prisma field ${expectedField}`);
      }
    }
  }
  return findings.sort();
}
