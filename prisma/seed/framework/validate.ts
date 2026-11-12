import { SeedRefusedError, type Dataset } from './contracts.js';
import { canonicalValue, naturalKeyText } from './hash.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const QUALIFIED_TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const DATASET_NAME = /^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]+)?$/;
const SOURCES: readonly unknown[] = ['ISO', 'SEED', 'SAMPLE'];

/** Written by the runner itself (standard columns, data-model P2); a dataset may not carry them. */
export const RESERVED_COLUMNS: readonly string[] = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version'];

/**
 * `reference_dataset_versions.dataset` keys no seed dataset may claim: TASK-221's reconciler keys its authz
 * `CONFIG_CHANGE` entries on `authz_matrix` (data-model §3.5 and §9.2, code review PR #13 n6, D-ARCH-075).
 */
export const RESERVED_DATASET_NAMES: readonly string[] = ['authz_matrix'];

function refuse(dataset: Dataset, problem: string): SeedRefusedError {
  const name = typeof dataset.name === 'string' ? dataset.name : '(unnamed)';
  return new SeedRefusedError('SEED_INVALID_DATASET', [name], `Dataset ${name} is invalid: ${problem}.`);
}

/**
 * Validates a dataset before any SQL is built from it (it is the only gate for the identifiers that are interpolated
 * into statements): identifier shapes, natural key ⊆ columns, `source` among the columns, uniform rows, no null
 * natural-key value and no duplicate natural key. Throws `SEED_INVALID_DATASET`; messages never include row values.
 */
export function validateDataset(dataset: Dataset): void {
  if (!DATASET_NAME.test(dataset.name)) throw refuse(dataset, 'name must match ^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]+)?$');
  if (RESERVED_DATASET_NAMES.includes(dataset.name)) throw refuse(dataset, 'name is reserved for another writer');
  if (dataset.version === '') throw refuse(dataset, 'version must not be empty');
  if (!QUALIFIED_TABLE.test(dataset.table)) throw refuse(dataset, 'table must be schema-qualified (schema.table, lower-case identifiers)');

  const columns = new Set(dataset.columns);
  if (columns.size !== dataset.columns.length) throw refuse(dataset, 'columns contain a duplicate');
  for (const column of dataset.columns) {
    if (!IDENTIFIER.test(column)) throw refuse(dataset, `column "${column}" is not a lower-case identifier`);
    if (RESERVED_COLUMNS.includes(column)) throw refuse(dataset, `column "${column}" is a standard column written by the runner`);
  }
  if (dataset.naturalKey.length === 0) throw refuse(dataset, 'naturalKey must name at least one column');
  if (new Set(dataset.naturalKey).size !== dataset.naturalKey.length) throw refuse(dataset, 'naturalKey contains a duplicate');
  for (const column of dataset.naturalKey) {
    if (!columns.has(column)) throw refuse(dataset, `natural-key column "${column}" is not in columns`);
  }
  if (!columns.has('source')) throw refuse(dataset, 'columns must include "source" (DR-A27)');

  const seen = new Map<string, number>();
  dataset.rows.forEach((row, index) => {
    const keys = Object.keys(row);
    const unexpected = keys.find((key) => !columns.has(key));
    if (unexpected !== undefined) throw refuse(dataset, `row ${String(index)} has column "${unexpected}" which is not in columns`);
    // Own properties only: `in` would find `__proto__` or `constructor` on the prototype chain (code review n1).
    const missing = dataset.columns.find((column) => !Object.hasOwn(row, column));
    if (missing !== undefined) throw refuse(dataset, `row ${String(index)} has no value for column "${missing}"`);
    if (!SOURCES.includes(row.source)) throw refuse(dataset, `row ${String(index)} has an invalid source (ISO, SEED or SAMPLE expected)`);
    for (const column of dataset.columns) canonicalValue(row[column], dataset.name, `row ${String(index)} column ${column}`);
    for (const column of dataset.naturalKey) {
      if (row[column] === null) throw refuse(dataset, `row ${String(index)} has a null natural-key value for "${column}"`);
    }
    const key = naturalKeyText(dataset, row);
    const first = seen.get(key);
    if (first !== undefined) throw refuse(dataset, `rows ${String(first)} and ${String(index)} share a natural key`);
    seen.set(key, index);
  });
}

/** Validates every dataset and that dataset names are unique across the list. */
export function validateDatasets(datasets: readonly Dataset[]): void {
  const names = new Set<string>();
  for (const dataset of datasets) {
    validateDataset(dataset);
    if (names.has(dataset.name)) throw refuse(dataset, 'name is used by another dataset');
    names.add(dataset.name);
  }
}
