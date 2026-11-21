/**
 * The list query of one request (US-037; REQ-API-007/008; api/README.md §4).
 *
 * Two steps, split along the pipeline:
 *  - `listQueryKeys(spec)`: the closed Joi keys the route spreads into its `schema.query`, validated by the validate
 *    slot like every other parameter. `limit` out of range, non-numeric or repeated is 400 `VALIDATION_ERROR`, never
 *    clamped; a filter VALUE outside its type or enum is 400 `VALIDATION_ERROR` with the `/query/filter[...]` pointer;
 *    an unknown `filter[...]` KEY is 400 `INVALID_FILTER` (the validate slot maps it for list schemas, D-TASK045-04);
 *    `include_total` exists only when the route documents it (AT-US-037-06).
 *  - `parseListQuery(spec, ctx, codec)`, in the handler: the sort against the allow-list (400 `INVALID_SORT`), the
 *    filters as typed terms, and the cursor, verified against the binding of this request (400 `INVALID_CURSOR`).
 *
 * The binding is everything a cursor must not cross: the operation, the caller (organisation, actor and guest token
 * hash, as the principal has them) and the canonical sort and filters. `limit` is not bound: a client may change the
 * page size between pages.
 */
import { AppError } from '@platform/shared';
import Joi from 'joi';

import type { RouteRequestContext } from '../routing/define-route.js';
import { type CursorCodec, type CursorPosition, MAX_CURSOR_LENGTH } from './cursor.js';
import {
  type FilterFieldSpec,
  filterKeysOf,
  type ListSpec,
  ListSpecError,
  MAX_SORT_TERMS,
  parseSortTerms,
  type SortTerm,
  stringFilterMax,
} from './list-spec.js';

/** The longest accepted `sort` value: `MAX_SORT_TERMS` terms of a `-` and a 63-character name, comma-separated. */
export const MAX_SORT_LENGTH = MAX_SORT_TERMS * 65;
/** At most this many values in one "any of" filter. */
export const MAX_ANY_OF_VALUES = 20;
const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';

/** The query key of a filter field: `filter[status]`. */
export const filterQueryKey = (key: string): string => `filter[${key}]`;

const anyOfPattern = (alternatives: string): RegExp =>
  new RegExp(`^(?:${alternatives})(?:,(?:${alternatives})){0,${String(MAX_ANY_OF_VALUES - 1)}}$`);

/** The Joi schema of one filter key's value. */
function filterValueSchema(filter: FilterFieldSpec): Joi.Schema {
  switch (filter.kind) {
    case 'enum': {
      const values = filter.values ?? [];
      return filter.anyOf === true ? Joi.string().pattern(anyOfPattern(values.join('|'))) : Joi.string().valid(...values);
    }
    case 'uuid':
      return Joi.string().pattern(filter.anyOf === true ? anyOfPattern(UUID) : new RegExp(`^${UUID}$`));
    case 'string':
      return Joi.string().min(1).max(stringFilterMax(filter));
    case 'boolean':
      return Joi.boolean();
    case 'integer':
      return Joi.number().integer();
    case 'timestamp':
      return Joi.date().iso();
  }
}

/**
 * The query keys of the list (spread them into the route's `schema.query`, beside any route-specific key such as
 * `q`). Every key is optional; `limit` defaults to the declared default.
 */
export function listQueryKeys(spec: ListSpec): Record<string, Joi.Schema> {
  const keys: Record<string, Joi.Schema> = {
    limit: Joi.number().integer().min(1).max(spec.limit.max).default(spec.limit.default),
    // An empty cursor or sort is refused by the parser with the list code, not by Joi as a too-short value.
    cursor: Joi.string().allow('').max(MAX_CURSOR_LENGTH),
    sort: Joi.string().allow('').max(MAX_SORT_LENGTH),
  };
  if (spec.totals) keys['include_total'] = Joi.boolean();
  for (const [field, filter] of spec.filters) {
    for (const key of filterKeysOf(field, filter)) keys[filterQueryKey(key)] = filterValueSchema(filter);
  }
  return keys;
}

/** `Joi.object(listQueryKeys(spec))`: the whole query schema of a list route without route-specific keys. */
export const listQuerySchema = (spec: ListSpec): Joi.ObjectSchema => Joi.object(listQueryKeys(spec));

export type FilterValue = string | number | boolean | Date;

export type FilterTerm =
  | { readonly field: string; readonly column: string; readonly op: 'eq'; readonly value: FilterValue }
  | { readonly field: string; readonly column: string; readonly op: 'in'; readonly values: readonly string[] }
  | { readonly field: string; readonly column: string; readonly op: 'gte' | 'lt'; readonly value: number | Date };

/** One parsed list request. */
export interface ListRequest {
  readonly limit: number;
  /** The sort terms, the id tie-breaker last. */
  readonly sort: readonly SortTerm[];
  /** Combined with AND. */
  readonly filters: readonly FilterTerm[];
  /** The boundary of the previous page; undefined on the first page. */
  readonly after: CursorPosition | undefined;
  readonly includeTotal: boolean;
  /** The tie-breaker column. */
  readonly idColumn: string;
  /** What the cursors of this request are bound to (see the header). */
  readonly cursorBinding: string;
}

const canonicalValue = (value: FilterValue): string => (value instanceof Date ? value.toISOString() : String(value));

/** The typed terms of one filter field from the validated query (undefined values are absent keys). */
function filterTerms(field: string, filter: FilterFieldSpec, query: Readonly<Record<string, unknown>>): FilterTerm[] {
  const column = filter.column;
  if (filter.range === true) {
    const from = query[filterQueryKey(`${field}_from`)] as number | Date | undefined;
    const to = query[filterQueryKey(`${field}_to`)] as number | Date | undefined;
    return [
      ...(from === undefined ? [] : [{ field: `${field}_from`, column, op: 'gte' as const, value: from }]),
      ...(to === undefined ? [] : [{ field: `${field}_to`, column, op: 'lt' as const, value: to }]),
    ];
  }
  const value = query[filterQueryKey(field)] as FilterValue | undefined;
  if (value === undefined) return [];
  if (filter.anyOf === true && typeof value === 'string') {
    const values = [...new Set(value.split(','))].sort();
    return [
      values.length === 1 && values[0] !== undefined ? { field, column, op: 'eq', value: values[0] } : { field, column, op: 'in', values },
    ];
  }
  return [{ field, column, op: 'eq', value }];
}

const termValue = (term: FilterTerm): string => (term.op === 'in' ? term.values.join(',') : canonicalValue(term.value));

/**
 * Parses the validated list query of a request. Throws 400 `INVALID_SORT` for a sort outside the allow-list and 400
 * `INVALID_CURSOR` for a cursor that is not authentic, has expired or was issued for another binding. A `reference`
 * ceiling on a route that is not `public` is a programming error (ADR-0016 amendment 5 (d): tenant lists never raise the
 * cap) and throws `ListSpecError`; the contract test fails the same route (AT-US-037-08).
 */
export function parseListQuery(
  spec: ListSpec,
  ctx: Pick<RouteRequestContext, 'route' | 'principal' | 'input'>,
  codec: CursorCodec,
): ListRequest {
  if (spec.ceiling === 'reference' && ctx.route.tenancy !== 'public') {
    throw new ListSpecError([
      `${ctx.route.operationId} is a ${ctx.route.tenancy} route; only public reference lists may use the reference ceiling`,
    ]);
  }
  const query = ctx.input.query;
  const rawSort = query['sort'];
  const sort = parseSortTerms(spec, typeof rawSort === 'string' ? rawSort : spec.defaultSort);
  if (sort === undefined) throw new AppError('INVALID_SORT');

  const filters = [...spec.filters].flatMap(([field, filter]) => filterTerms(field, filter, query));
  const { principal, route } = ctx;
  const binding = JSON.stringify([
    'list',
    route.operationId,
    principal.orgId,
    principal.actorId,
    principal.guestTokenHash,
    sort.map((term) => `${term.direction === 'desc' ? '-' : ''}${term.field}`).join(','),
    filters.map((term) => [term.field, term.op, termValue(term)]),
  ]);

  const rawCursor = query['cursor'];
  const after = typeof rawCursor === 'string' ? codec.decode(binding, rawCursor) : undefined;
  const limit = query['limit'];
  return Object.freeze({
    limit: typeof limit === 'number' ? limit : spec.limit.default,
    sort,
    filters: Object.freeze(filters),
    after,
    includeTotal: spec.totals && query['include_total'] === true,
    idColumn: spec.idColumn,
    cursorBinding: binding,
  });
}
