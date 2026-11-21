/**
 * The backup manifest of the restore rehearsal (data-model.md §8.6 steps 2 and 5; NFR-REC-003, NFR-DATA-004; TASK-034).
 *
 * A manifest fingerprints a database so that a restore can be compared with its source:
 *  - per table (every ordinary table and partition outside the system schemas): the row count and an order-independent
 *    checksum, the sum of a 60-bit prefix of SHA-256 over each row's text form, so a lost, added or changed row changes
 *    it while the scan stays one pass in constant memory;
 *  - every sequence's `last_value`, the `_prisma_migrations` head and the SHA-256 of the normalised schema dump (owners,
 *    ACLs, RLS, policies, triggers and event triggers included, `normaliseSchemaDump`).
 * Row text depends on session settings (time zone, date, interval and float output), so `MANIFEST_SESSION_SETTINGS`
 * pins them in every session that fingerprints. Messages name tables and counts only, never row content.
 *
 * Foreign-key integrity is checked with generated anti-joins (`orphanCountSql`): restored validated constraints are not
 * re-checked by PostgreSQL. Each check uses the constraint's own equality operators (`conpfeqop`), so it resolves under
 * the pinned `pg_catalog, pg_temp` search path for every column type.
 */
import { createHash } from 'node:crypto';

import { quoteIdentifier } from './sql-text.js';

export const MANIFEST_FORMAT = 'platform.backup-manifest/v1';

/** A database session: the pg adapter, or a fake in the unit tests. */
export interface SqlSession {
  query<T extends object>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface TableFingerprint {
  /** `schema.table`, unquoted. */
  readonly table: string;
  /** Row count, as decimal text (bigint). */
  readonly rows: string;
  /** Sum of the per-row 60-bit hashes, as decimal text (numeric). */
  readonly checksum: string;
}

export interface SequenceState {
  readonly sequence: string;
  /** `last_value`, decimal text; null when the sequence was never called. */
  readonly lastValue: string | null;
}

export interface BackupManifest {
  readonly format: typeof MANIFEST_FORMAT;
  readonly database: string;
  readonly serverVersionNum: string;
  readonly takenAt: string;
  /** Newest applied, not rolled back `_prisma_migrations` row; null without the table or a row. */
  readonly migrationHead: string | null;
  readonly schemaSha256: string;
  readonly tables: readonly TableFingerprint[];
  readonly sequences: readonly SequenceState[];
}

/**
 * Session settings under which row text is deterministic (and the scan bounded). `SET` values, applied in order. The
 * statement timeout bounds one table scan of the rehearsal (30 min), never a production path.
 */
export const MANIFEST_SESSION_SETTINGS: readonly string[] = [
  "SET statement_timeout = '30min'",
  "SET TimeZone = 'UTC'",
  "SET DateStyle = 'ISO, YMD'",
  "SET IntervalStyle = 'iso_8601'",
  'SET extra_float_digits = 3',
  "SET bytea_output = 'hex'",
  "SET lc_monetary = 'C'",
];

/** Ordinary tables and partitions (relkind `r`) outside the system schemas, in name order. */
export const TABLES_SQL = `SELECT n.nspname AS schema, c.relname AS name
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
 ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`;

export const SEQUENCES_SQL = `SELECT schemaname AS schema, sequencename AS name, last_value::pg_catalog.text AS last_value
  FROM pg_catalog.pg_sequences
 WHERE schemaname <> 'information_schema' AND schemaname !~ '^pg_'
 ORDER BY schemaname COLLATE "C", sequencename COLLATE "C"`;

export const SERVER_VERSION_SQL = `SELECT pg_catalog.current_setting('server_version_num') AS version`;

export const MIGRATION_TABLE_SQL = `SELECT pg_catalog.to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
export const MIGRATION_HEAD_SQL = `SELECT migration_name FROM public._prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY migration_name COLLATE "C" DESC LIMIT 1`;

/** Top-level foreign keys (a partitioned table's constraint, not its per-partition clones), with their operators. */
export const FOREIGN_KEYS_SQL = `SELECT c.conname AS name,
       cn.nspname AS child_schema, cr.relname AS child_table,
       pn.nspname AS parent_schema, pr.relname AS parent_table,
       ARRAY(SELECT a.attname FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord)::pg_catalog.text[] AS child_columns,
       ARRAY(SELECT a.attname FROM pg_catalog.unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord)::pg_catalog.text[] AS parent_columns,
       ARRAY(SELECT o.oprname FROM pg_catalog.unnest(c.conpfeqop) WITH ORDINALITY k(opr, ord)
               JOIN pg_catalog.pg_operator o ON o.oid = k.opr ORDER BY k.ord)::pg_catalog.text[] AS operators,
       ARRAY(SELECT ns.nspname FROM pg_catalog.unnest(c.conpfeqop) WITH ORDINALITY k(opr, ord)
               JOIN pg_catalog.pg_operator o ON o.oid = k.opr
               JOIN pg_catalog.pg_namespace ns ON ns.oid = o.oprnamespace ORDER BY k.ord)::pg_catalog.text[] AS operator_schemas
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class cr ON cr.oid = c.conrelid JOIN pg_catalog.pg_namespace cn ON cn.oid = cr.relnamespace
  JOIN pg_catalog.pg_class pr ON pr.oid = c.confrelid JOIN pg_catalog.pg_namespace pn ON pn.oid = pr.relnamespace
 WHERE c.contype = 'f' AND c.conparentid = 0
 ORDER BY cn.nspname COLLATE "C", cr.relname COLLATE "C", c.conname COLLATE "C"`;

export class RehearsalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RehearsalError';
  }
}

export const qualifiedName = (schema: string, name: string): string => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;

/** Row count and order-independent checksum of one table (ONLY: a partition is fingerprinted as its own table). */
export function tableFingerprintSql(schema: string, name: string): string {
  const rowHash = `('x' OPERATOR(pg_catalog.||) pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(t::pg_catalog.text, 'UTF8')), 'hex'), 1, 15))::pg_catalog.bit(60)::pg_catalog.int8`;
  return `SELECT pg_catalog.count(*)::pg_catalog.text AS rows, pg_catalog.coalesce(pg_catalog.sum(${rowHash}), 0)::pg_catalog.text AS checksum FROM ONLY ${qualifiedName(schema, name)} AS t`;
}

export interface ForeignKey {
  readonly name: string;
  readonly childSchema: string;
  readonly childTable: string;
  readonly parentSchema: string;
  readonly parentTable: string;
  readonly childColumns: readonly string[];
  readonly parentColumns: readonly string[];
  readonly operators: readonly string[];
  readonly operatorSchemas: readonly string[];
}

/** An operator name as pg_operator stores it: only operator characters, so it can stand in OPERATOR(schema.op). */
const OPERATOR_NAME = /^[+\-*/<>=~!@#%^&|`?]{1,63}$/;

/**
 * Orphan rows of one foreign key (MATCH SIMPLE: a row with a NULL key column references nothing). Without ONLY: the
 * constraint of a partitioned table covers its partitions, and a partitioned parent holds no rows of its own.
 */
export function orphanCountSql(fk: ForeignKey): string {
  const width = fk.childColumns.length;
  if (width === 0 || fk.parentColumns.length !== width || fk.operators.length !== width || fk.operatorSchemas.length !== width) {
    throw new RehearsalError(`foreign key ${fk.name} has inconsistent column or operator lists`);
  }
  const notNull = fk.childColumns.map((column) => `c.${quoteIdentifier(column)} IS NOT NULL`).join(' AND ');
  const matches = fk.childColumns
    .map((column, index) => {
      const operator = fk.operators[index] as string;
      if (!OPERATOR_NAME.test(operator)) throw new RehearsalError(`foreign key ${fk.name} uses an unexpected operator name`);
      const schema = quoteIdentifier(fk.operatorSchemas[index] as string);
      return `p.${quoteIdentifier(fk.parentColumns[index] as string)} OPERATOR(${schema}.${operator}) c.${quoteIdentifier(column)}`;
    })
    .join(' AND ');
  return `SELECT pg_catalog.count(*)::pg_catalog.text AS orphans FROM ${qualifiedName(fk.childSchema, fk.childTable)} AS c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${qualifiedName(fk.parentSchema, fk.parentTable)} AS p WHERE ${matches})`;
}

interface ForeignKeyRow {
  name: string;
  child_schema: string;
  child_table: string;
  parent_schema: string;
  parent_table: string;
  child_columns: string[];
  parent_columns: string[];
  operators: string[];
  operator_schemas: string[];
}

export async function foreignKeys(session: SqlSession): Promise<ForeignKey[]> {
  return (await session.query<ForeignKeyRow>(FOREIGN_KEYS_SQL)).map((row) => ({
    name: row.name,
    childSchema: row.child_schema,
    childTable: row.child_table,
    parentSchema: row.parent_schema,
    parentTable: row.parent_table,
    childColumns: row.child_columns,
    parentColumns: row.parent_columns,
    operators: row.operators,
    operatorSchemas: row.operator_schemas,
  }));
}

export interface OrphanFinding {
  readonly constraint: string;
  readonly table: string;
  readonly orphans: string;
}

/** Every foreign key with at least one orphan row (counts only). */
export async function findOrphans(session: SqlSession): Promise<OrphanFinding[]> {
  const findings: OrphanFinding[] = [];
  for (const fk of await foreignKeys(session)) {
    const [row] = await session.query<{ orphans: string }>(orphanCountSql(fk));
    const orphans = row?.orphans ?? '0';
    if (orphans !== '0') findings.push({ constraint: fk.name, table: `${fk.childSchema}.${fk.childTable}`, orphans });
  }
  return findings;
}

export async function applySessionSettings(session: SqlSession): Promise<void> {
  for (const statement of MANIFEST_SESSION_SETTINGS) await session.query(statement);
}

/** Sequence states, read first in a backup: sequences are not transactional, so the dump sees these values or later. */
export async function captureSequences(session: SqlSession): Promise<SequenceState[]> {
  return (await session.query<{ schema: string; name: string; last_value: string | null }>(SEQUENCES_SQL)).map((row) => ({
    sequence: `${row.schema}.${row.name}`,
    lastValue: row.last_value,
  }));
}

export interface ManifestInputs {
  readonly database: string;
  readonly takenAt: string;
  /** Normalised schema dump (`normaliseSchemaDump`). */
  readonly schema: string;
  readonly sequences: readonly SequenceState[];
}

/** Fingerprints every table of the session's database (call with MANIFEST_SESSION_SETTINGS applied). */
export async function captureManifest(session: SqlSession, inputs: ManifestInputs): Promise<BackupManifest> {
  const tables: TableFingerprint[] = [];
  for (const { schema, name } of await session.query<{ schema: string; name: string }>(TABLES_SQL)) {
    const [row] = await session.query<{ rows: string; checksum: string }>(tableFingerprintSql(schema, name));
    tables.push({ table: `${schema}.${name}`, rows: row?.rows ?? '0', checksum: row?.checksum ?? '0' });
  }
  const [version] = await session.query<{ version: string }>(SERVER_VERSION_SQL);
  const [migrations] = await session.query<{ present: boolean }>(MIGRATION_TABLE_SQL);
  const head = migrations?.present === true ? await session.query<{ migration_name: string }>(MIGRATION_HEAD_SQL) : [];
  return {
    format: MANIFEST_FORMAT,
    database: inputs.database,
    serverVersionNum: version?.version ?? '',
    takenAt: inputs.takenAt,
    migrationHead: head[0]?.migration_name ?? null,
    schemaSha256: sha256Hex(inputs.schema),
    tables,
    sequences: [...inputs.sequences],
  };
}

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Canonical JSON (keys sorted at every level) of a JSON value: the digest input. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const manifestSha256 = (manifest: BackupManifest): string => sha256Hex(canonicalJson(manifest));

/**
 * Differences between the source manifest and the manifest of the restored database. The database name and the time
 * differ by design; a sequence may be ahead (the dump reads sequences after the manifest, under live traffic), never
 * behind. Messages name tables, sequences and counts only.
 */
export function compareManifests(expected: BackupManifest, actual: BackupManifest): string[] {
  const differences: string[] = [];
  if (actual.schemaSha256 !== expected.schemaSha256) differences.push('schema: the normalised schema dump differs from the source');
  if (actual.migrationHead !== expected.migrationHead) {
    differences.push(`migration head: expected ${String(expected.migrationHead)}, restored ${String(actual.migrationHead)}`);
  }
  const restoredTables = new Map(actual.tables.map((table) => [table.table, table]));
  for (const table of expected.tables) {
    const restored = restoredTables.get(table.table);
    restoredTables.delete(table.table);
    if (restored === undefined) differences.push(`table ${table.table}: missing in the restore`);
    else if (restored.rows !== table.rows) differences.push(`table ${table.table}: ${table.rows} rows expected, ${restored.rows} restored`);
    else if (restored.checksum !== table.checksum) differences.push(`table ${table.table}: row checksum differs (${table.rows} rows)`);
  }
  for (const extra of restoredTables.keys()) differences.push(`table ${extra}: not in the source manifest`);
  const restoredSequences = new Map(actual.sequences.map((sequence) => [sequence.sequence, sequence.lastValue]));
  for (const sequence of expected.sequences) {
    if (!restoredSequences.has(sequence.sequence)) {
      differences.push(`sequence ${sequence.sequence}: missing in the restore`);
      continue;
    }
    const restored = restoredSequences.get(sequence.sequence) ?? null;
    if (sequence.lastValue !== null && (restored === null || BigInt(restored) < BigInt(sequence.lastValue))) {
      differences.push(`sequence ${sequence.sequence}: restored ${String(restored)} is behind the source ${sequence.lastValue}`);
    }
  }
  return differences;
}

const DECIMAL = /^-?\d{1,40}$/;
const isText = (value: unknown): value is string => typeof value === 'string';
const isDecimal = (value: unknown): value is string => isText(value) && DECIMAL.test(value);

/** Validates a manifest read from disk (a boundary): throws RehearsalError naming the first bad field. */
export function parseManifest(raw: unknown): BackupManifest {
  const bad = (field: string): never => {
    throw new RehearsalError(`the backup manifest is not a ${MANIFEST_FORMAT} manifest (field ${field})`);
  };
  if (raw === null || typeof raw !== 'object') return bad('root');
  const value = raw as Record<string, unknown>;
  if (value['format'] !== MANIFEST_FORMAT) bad('format');
  for (const field of ['database', 'serverVersionNum', 'takenAt'] as const) if (!isText(value[field])) bad(field);
  if (!(value['migrationHead'] === null || isText(value['migrationHead']))) bad('migrationHead');
  if (!isText(value['schemaSha256']) || !/^[0-9a-f]{64}$/.test(value['schemaSha256'])) bad('schemaSha256');
  const tables = value['tables'];
  if (!Array.isArray(tables)) return bad('tables');
  tables.forEach((table: unknown, index) => {
    const entry = table as Record<string, unknown> | null;
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !isText(entry['table']) ||
      !isDecimal(entry['rows']) ||
      !isDecimal(entry['checksum'])
    ) {
      bad(`tables[${String(index)}]`);
    }
  });
  const sequences = value['sequences'];
  if (!Array.isArray(sequences)) return bad('sequences');
  sequences.forEach((sequence: unknown, index) => {
    const entry = sequence as Record<string, unknown> | null;
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !isText(entry['sequence']) ||
      !(entry['lastValue'] === null || isDecimal(entry['lastValue']))
    ) {
      bad(`sequences[${String(index)}]`);
    }
  });
  return raw as BackupManifest;
}

/** Totals for a report: table count and the sum of the row counts. */
export function manifestTotals(manifest: BackupManifest): { tables: number; rows: string } {
  return { tables: manifest.tables.length, rows: manifest.tables.reduce((sum, table) => sum + BigInt(table.rows), 0n).toString() };
}
