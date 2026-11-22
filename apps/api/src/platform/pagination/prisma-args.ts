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
 *
 * Limits of the native cursor (D-TASK045-10):
 *  - A boundary row the caller can no longer see (deleted, purged, moved under RLS) makes the statement return no row;
 *    `pageOf` answers that with 400 `INVALID_CURSOR`, never with a silent end of the list.
 *  - The walk resumes from the boundary row's CURRENT sort values, so it is exact for immutable sort keys only. When
 *    the boundary row's own sort value changes between pages, the unchanged rows between its old and new position are
 *    skipped (it moved forward) or repeated (it moved back); a change of any other row moves only that row
 *    (paging.test.ts pins both). Lists sorted on mutable columns (`updated_at`, `last_used_at`, `label`, `name`)
 *    carry this trade-off until principal-architect rules on it (routed with D-TASK045-10).
 *  - Composite-key or partitioned tables (`audit_entries`: primary key `(occurred_at, id)`, monthly partitions) have no
 *    unique `id` to point at and could not prune partitions: they use the keys path instead (sort values carried in
 *    the cursor through `keysOf`, exact timestamp text such as `occurred_at::text`, never a JavaScript `Date`, and the
 *    comparison in the consumer's own scoped SQL, PR045-SEC-06). TASK-073 is the first such consumer.
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
