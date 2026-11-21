/**
 * Prisma `findMany` arguments of a list request (keyset pagination; NFR-PERF-006). Plain objects only: this module
 * imports nothing from Prisma, the repository passes the result to its delegate (`db.membership.findMany({ ...args,
 * select })`), merging its own scope conditions through `base`.
 *
 * The page boundary is Prisma's native cursor on the unique id column (D-TASK045-03): `cursor: { id }` makes the
 * database compare every `orderBy` column with the stored values of the boundary row, inside the same statement and at
 * the column's full precision. A value cursor built from what the client received would not be exact: `timestamptz`
 * columns hold microseconds (data-model P4) while a JavaScript `Date` holds milliseconds, so rows written within one
 * millisecond would be skipped or repeated. Prisma's cursor is inclusive (the boundary row comes back first when it
 * still matches the filters), so the arguments ask for one extra row and `pageOf` drops the boundary row by id instead
 * of `skip: 1`, which would drop a different row once the boundary row no longer matches the filters.
 *
 * With `orderBy` leading on the sort columns and ending on the id, and an index `(org_id, <sort columns>, id)` for
 * tenant lists (data-model §3 access patterns), the statement is an index range scan bounded by `take`.
 */
import type { FilterTerm, ListRequest } from './list-query.js';

export type PrismaWhere = Readonly<Record<string, unknown>>;

export interface PrismaListArgs {
  readonly where: PrismaWhere;
  readonly orderBy: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
  /** `limit + 1` (the look-ahead row that sets `has_more`), plus 1 more after a cursor (the boundary row). */
  readonly take: number;
  readonly cursor?: Readonly<Record<string, string>>;
}

function conditionOf(term: FilterTerm): PrismaWhere {
  switch (term.op) {
    case 'eq':
      return { [term.column]: term.value };
    case 'in':
      return { [term.column]: { in: [...term.values] } };
    case 'gte':
      return { [term.column]: { gte: term.value } };
    case 'lt':
      return { [term.column]: { lt: term.value } };
  }
}

/**
 * The `findMany` arguments of `request`: the filters (AND, after the optional `base` conditions of the repository),
 * the order with the id tie-breaker, `take` and, after the first page, the cursor.
 */
export function prismaListArgs(request: ListRequest, base?: PrismaWhere): PrismaListArgs {
  const conditions = [...(base === undefined ? [] : [base]), ...request.filters.map(conditionOf)];
  const where: PrismaWhere = conditions.length === 0 ? {} : { AND: conditions };
  const orderBy = request.sort.map((term) => ({ [term.column]: term.direction }));
  if (request.after === undefined) return { where, orderBy, take: request.limit + 1 };
  return { where, orderBy, take: request.limit + 2, cursor: { [request.idColumn]: request.after.id } };
}
