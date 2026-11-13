import type { Dataset, SeedRow } from './contracts.js';

/** Rows per statement. Each chunk is one statement with two parameters, whatever the column count. */
export const CHUNK_SIZE = 500;

/**
 * Identifiers are interpolated into the statements below. They are safe only because `validateDataset` restricts
 * them to `[a-z_][a-z0-9_]*`; this guard repeats the check so a renderer called on its own can never emit a
 * foreign identifier.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error('refusing to render an unvalidated SQL identifier');
  return `"${name}"`;
}

function table(dataset: Dataset): string {
  const [schema, name] = dataset.table.split('.');
  if (schema === undefined || name === undefined) throw new Error('refusing to render an unqualified table');
  return `${ident(schema)}.${ident(name)}`;
}

const list = (columns: readonly string[], prefix = ''): string => columns.map((column) => `${prefix}${ident(column)}`).join(', ');

/** Non-key columns: what a drifted row is compared on and restored to. */
const payloadColumns = (dataset: Dataset): string[] => dataset.columns.filter((column) => !dataset.naturalKey.includes(column));

/** Typed rows from one jsonb parameter: the table's own row type fixes every column type (no per-column casts). */
const incoming = (dataset: Dataset, parameter: string): string =>
  `pg_catalog.jsonb_populate_recordset(NULL::${table(dataset)}, ${parameter}::pg_catalog.jsonb)`;

const insertHead = (dataset: Dataset): string =>
  `INSERT INTO ${table(dataset)} AS cur (${list(dataset.columns)}, "created_by", "updated_by")\n` +
  `SELECT ${list(dataset.columns, 'v.')}, $1::pg_catalog.uuid, $1::pg_catalog.uuid\n` +
  `FROM ${incoming(dataset, '$2')} AS v\nWHERE true\n` +
  `ON CONFLICT (${list(dataset.naturalKey)})`;

/**
 * Upsert of one chunk: parameters `[actor uuid, rows as a JSON array]`. A conflicting row is updated only when its
 * seeded columns differ from the stored ones (`IS DISTINCT FROM`), so an unchanged dataset with no drift writes
 * nothing (no new tuple, no `updated_at` change) and a drifted row is restored (AT-US-049-08). Returns one row per
 * written row: `inserted` is true for a new row and false for a restored one.
 */
export function renderUpsert(dataset: Dataset): string {
  const payload = payloadColumns(dataset);
  if (payload.length === 0) return `${insertHead(dataset)} DO NOTHING\nRETURNING (cur.xmax = 0) AS inserted`;
  const assignments = [
    ...payload.map((column) => `${ident(column)} = EXCLUDED.${ident(column)}`),
    '"updated_at" = pg_catalog.now()',
    '"updated_by" = EXCLUDED."updated_by"',
    '"version" = cur."version" + 1',
  ];
  return (
    `${insertHead(dataset)} DO UPDATE SET ${assignments.join(', ')}\n` +
    `WHERE (${list(payload, 'cur.')}) IS DISTINCT FROM (${list(payload, 'EXCLUDED.')})\n` +
    'RETURNING (cur.xmax = 0) AS inserted'
  );
}

/** Insert-only chunk (same parameters): new keys are inserted, existing keys are left alone. One row per insert. */
export function renderInsertOnly(dataset: Dataset): string {
  return `${insertHead(dataset)} DO NOTHING\nRETURNING true AS inserted`;
}

/** Counts, for one chunk (parameter `[rows]`), the existing rows whose seeded columns differ from the dataset's. */
export function renderChangedCount(dataset: Dataset): string {
  const payload = payloadColumns(dataset);
  const join = dataset.naturalKey.map((column) => `cur.${ident(column)} = v.${ident(column)}`).join(' AND ');
  const changed = payload.length === 0 ? 'false' : `(${list(payload, 'cur.')}) IS DISTINCT FROM (${list(payload, 'v.')})`;
  return (
    `SELECT pg_catalog.count(*)::pg_catalog.int4 AS changed\n` +
    `FROM ${incoming(dataset, '$1')} AS v\nJOIN ${table(dataset)} AS cur ON ${join}\nWHERE ${changed}`
  );
}

/** Rows as the JSON array the statements take: only the dataset's columns, in the dataset's column order. */
export function rowsParameter(dataset: Dataset, rows: readonly SeedRow[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(dataset.columns.map((column) => [column, row[column]]))));
}

export function chunk<T>(items: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
