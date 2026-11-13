import { createHash } from 'node:crypto';

import { SeedRefusedError, type Dataset } from './contracts.js';

/**
 * Canonical text of one seed value. The encoding is unambiguous (type-distinguishing) and independent of object key
 * order, so equal content always hashes equally. Dates carry a `Date(...)` tag, which no JSON text can produce.
 * Rejects what cannot be stored faithfully: `undefined`, non-finite numbers, invalid dates, bigint, functions.
 */
export function canonicalValue(value: unknown, dataset: string, location: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw invalid(dataset, location, 'a number must be finite');
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw invalid(dataset, location, `a ${typeof value} value cannot be seeded`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid(dataset, location, 'a date must be valid');
    return `Date(${value.toISOString()})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown, index) => canonicalValue(item, dataset, `${location}[${String(index)}]`)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareCodeUnits(a, b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item, dataset, `${location}.${key}`)}`).join(',')}}`;
}

function invalid(dataset: string, location: string, problem: string): SeedRefusedError {
  return new SeedRefusedError('SEED_INVALID_DATASET', [dataset], `Dataset ${dataset} is invalid: ${location}: ${problem}.`);
}

/** Code-unit order: locale-independent and identical on every host. */
export const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Canonical text of a row's natural-key tuple (also the duplicate-detection key). */
export function naturalKeyText(dataset: Dataset, row: Dataset['rows'][number]): string {
  return [...dataset.naturalKey]
    .sort(compareCodeUnits)
    .map((column) => canonicalValue(row[column], dataset.name, `natural key ${column}`))
    .join(',');
}

/**
 * Canonical content of a dataset: the table, the sorted natural-key and column names, then one line per row (columns
 * in sorted order) with the rows sorted by natural key. Row order and column order in the source never matter.
 * The dataset `name` and `version` are not part of the content: the version label is stored next to the hash.
 */
export function canonicalDataset(dataset: Dataset): string {
  const columns = [...dataset.columns].sort(compareCodeUnits);
  const lines = dataset.rows.map((row) => ({
    key: naturalKeyText(dataset, row),
    line: columns.map((column) => canonicalValue(row[column], dataset.name, column)).join(';'),
  }));
  lines.sort((a, b) => compareCodeUnits(a.key, b.key) || compareCodeUnits(a.line, b.line));
  const header = JSON.stringify({ table: dataset.table, naturalKey: [...dataset.naturalKey].sort(compareCodeUnits), columns });
  return [header, ...lines.map((entry) => entry.line)].join('\n');
}

/** Lower-case hex SHA-256 of {@link canonicalDataset}. */
export const hashDataset = (dataset: Dataset): string => createHash('sha256').update(canonicalDataset(dataset), 'utf8').digest('hex');
