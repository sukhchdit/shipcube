/**
 * The list response body `{ items, next_cursor, has_more }` (+ `total` when requested and documented; REQ-API-007,
 * api/README.md §4, AT-US-037-06) from the rows a keyset query returned.
 *
 * The rows are those of `prismaListArgs` (or of any query with the same contract): in list order, at most
 * `limit + 2`, possibly starting with the boundary row of the previous page, which is dropped by id. `has_more` is
 * true when a row beyond the page came back, and only then does the page carry a cursor (bound to the request's
 * binding) at its last row.
 */
import type { CursorCodec } from './cursor.js';
import type { ListRequest } from './list-query.js';

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
  /** The sort-key values of a row, for consumers that compare keys themselves; omitted from the cursor otherwise. */
  readonly keysOf?: (row: R) => readonly (string | number)[];
  /** The total number of matches; required when the request asks for it, ignored otherwise. */
  readonly total?: number;
}

export function pageOf<R, T>(request: ListRequest, rows: readonly R[], options: PageOptions<R, T>): ListPage<T> {
  const { codec, idOf, toItem, keysOf } = options;
  const first = rows[0];
  const after = request.after;
  const remaining = after !== undefined && first !== undefined && idOf(first) === after.id ? rows.slice(1) : rows;
  const hasMore = remaining.length > request.limit;
  const page = remaining.slice(0, request.limit);
  const last = page.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? codec.encode(request.cursorBinding, keysOf === undefined ? { id: idOf(last) } : { id: idOf(last), keys: keysOf(last) })
      : null;
  const body = { items: page.map(toItem), next_cursor: nextCursor, has_more: hasMore };
  if (!request.includeTotal) return body;
  if (options.total === undefined || !Number.isSafeInteger(options.total) || options.total < 0) {
    throw new Error('include_total was requested but no total was counted');
  }
  return { ...body, total: options.total };
}
