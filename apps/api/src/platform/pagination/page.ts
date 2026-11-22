/**
 * The list response body `{ items, next_cursor, has_more }` (+ `total` when requested and documented; REQ-API-007,
 * api/README.md §4, AT-US-037-06) from the rows a keyset query returned.
 *
 * The rows are those of `prismaListArgs` (or of any query with the same contract): in list order, at most
 * `limit + 2`, possibly starting with the boundary row of the previous page, which is dropped by id. `has_more` is
 * true when a row beyond the page came back, and only then does the page carry a cursor (bound to the request's
 * binding) at its last row.
 *
 * A page after a cursor that came back with no row at all cannot be continued reliably, and is 400 `INVALID_CURSOR`
 * (R1-M1, PR045-SEC-02; D-TASK045-10): a cursor is only issued when a row existed beyond its page, so an empty answer
 * means the boundary row is gone for this caller (deleted, purged, moved to another organisation or otherwise
 * invisible under RLS: Prisma's boundary subqueries then match nothing) or every later row stopped matching. The
 * decision is taken on the result of the page query itself, so the caller's own scope and RLS decide it, and it is the
 * same answer for every cause (no existence oracle for foreign rows); the client restarts the list.
 */
import { AppError } from '@platform/shared';

import type { CursorCodec } from './cursor.js';
import type { ListRequest } from './list-query.js';
import type { CursorKeyKind, SortTerm } from './list-spec.js';

export interface ListPage<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
  readonly total?: number;
}

export interface PageOptions<R, T> {
  readonly codec: CursorCodec;
  /** The tie-breaker value of a row (its `id`). */
  readonly idOf: (row: R) => string;
  /** The response item of a row. */
  readonly toItem: (row: R) => T;
  /**
   * The sort-key values of a row, one per sort term before the id tie-breaker, each of the kind its sort field declares
   * (`SortFieldSpec.key`), for consumers that compare keys themselves; omitted from the cursor otherwise.
   */
  readonly keysOf?: (row: R) => readonly (string | number)[];
  /** The total number of matches; required when the request asks for it, ignored otherwise. */
  readonly total?: number;
}

const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
/** PostgreSQL `timestamptz::text` (or ISO 8601) at up to microsecond precision. */
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/;

const KEY_CHECKS: Readonly<Record<CursorKeyKind, (value: string | number) => boolean>> = {
  timestamp: (value) => typeof value === 'string' && TIMESTAMP_TEXT.test(value),
  integer: (value) => typeof value === 'number' && Number.isSafeInteger(value),
  uuid: (value) => typeof value === 'string' && UUID.test(value),
};

/**
 * The cursor keys of a row, checked against the declared kinds of the request's sort terms (the id tie-breaker is the
 * cursor's id). A mismatch is a programming error of the consumer (the same on every row), never row-data dependent.
 */
function checkedKeys(sort: readonly SortTerm[], idColumn: string, keys: readonly (string | number)[]): readonly (string | number)[] {
  const terms = sort.filter((term) => term.column !== idColumn);
  if (keys.length !== terms.length) throw new Error(`keysOf returned ${String(keys.length)} keys for ${String(terms.length)} sort terms`);
  terms.forEach((term, index) => {
    const value = keys[index];
    if (term.key === undefined) throw new Error(`sort field "${term.field}" declares no cursor key kind`);
    if (value === undefined || !KEY_CHECKS[term.key](value))
      throw new Error(`keysOf value for "${term.field}" is not of the ${term.key} kind`);
  });
  return keys;
}

export function pageOf<R, T>(request: ListRequest, rows: readonly R[], options: PageOptions<R, T>): ListPage<T> {
  const { codec, idOf, toItem, keysOf } = options;
  const after = request.after;
  if (after !== undefined && rows.length === 0) throw new AppError('INVALID_CURSOR');
  const first = rows[0];
  const remaining = after !== undefined && first !== undefined && idOf(first) === after.id ? rows.slice(1) : rows;
  const hasMore = remaining.length > request.limit;
  const page = remaining.slice(0, request.limit);
  const last = page.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? codec.encode(
          request.cursorBinding,
          keysOf === undefined ? { id: idOf(last) } : { id: idOf(last), keys: checkedKeys(request.sort, request.idColumn, keysOf(last)) },
        )
      : null;
  const body = { items: page.map(toItem), next_cursor: nextCursor, has_more: hasMore };
  if (!request.includeTotal) return body;
  if (options.total === undefined || !Number.isSafeInteger(options.total) || options.total < 0) {
    throw new Error('include_total was requested but no total was counted');
  }
  return { ...body, total: options.total };
}
