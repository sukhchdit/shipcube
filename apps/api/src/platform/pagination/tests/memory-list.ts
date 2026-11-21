/**
 * Test helper (TASK-045): runs a list request over in-memory records with the semantics of `prismaListArgs` on
 * PostgreSQL: filters with AND, the order of the sort terms (the id tie-breaker last) and, after a cursor, every row at
 * or after the boundary row in that order, the boundary row's CURRENT values deciding (Prisma's native cursor compares
 * with the stored row), the boundary row itself included only when it still matches. No boundary row: no rows.
 * tests/api/list-keyset.int.test.ts proves the same semantics on the database. Never imported by production code.
 */
import type { FilterTerm, ListRequest } from '../list-query.js';

export type MemoryValue = string | number | boolean | Date;
export type MemoryRecord = Readonly<Record<string, MemoryValue>>;

const ordinal = (value: MemoryValue): number | string =>
  value instanceof Date ? value.getTime() : typeof value === 'boolean' ? Number(value) : value;

function compareValues(a: MemoryValue, b: MemoryValue): number {
  const x = ordinal(a);
  const y = ordinal(b);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function matches(record: MemoryRecord, term: FilterTerm): boolean {
  const value = record[term.column];
  if (value === undefined) return false;
  switch (term.op) {
    case 'eq':
      return compareValues(value, term.value) === 0;
    case 'in':
      return term.values.some((candidate) => compareValues(value, candidate) === 0);
    case 'gte':
      return compareValues(value, term.value) >= 0;
    case 'lt':
      return compareValues(value, term.value) < 0;
  }
}

/** The list order of `request` as a comparator. */
export function listOrder(request: ListRequest): (a: MemoryRecord, b: MemoryRecord) => number {
  return (a, b) => {
    for (const term of request.sort) {
      const left = a[term.column];
      const right = b[term.column];
      if (left === undefined || right === undefined) throw new Error(`record lacks the sort column ${term.column}`);
      const order = compareValues(left, right);
      if (order !== 0) return term.direction === 'asc' ? order : -order;
    }
    return 0;
  };
}

/** The rows `prismaListArgs(request)` would return from `records` (the caller's visible set). */
export function memoryListRows(records: readonly MemoryRecord[], request: ListRequest): MemoryRecord[] {
  const order = listOrder(request);
  const matching = records.filter((record) => request.filters.every((term) => matches(record, term))).sort(order);
  if (request.after === undefined) return matching.slice(0, request.limit + 1);
  const after = request.after;
  const boundary = records.find((record) => record[request.idColumn] === after.id);
  if (boundary === undefined) return [];
  return matching.filter((record) => order(record, boundary) >= 0).slice(0, request.limit + 2);
}

/** The number of records matching the filters (for `include_total`). */
export const memoryListTotal = (records: readonly MemoryRecord[], request: ListRequest): number =>
  records.filter((record) => request.filters.every((term) => matches(record, term))).length;
