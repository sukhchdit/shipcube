/**
 * The list declaration of one list operation (US-037; REQ-API-007/008; api/README.md §4; ADR-0016 item 5 and
 * amendment 5 (d); DR-A21): the page-size policy, the sort allow-list with its default, the filter allow-list and
 * whether the route documents `include_total`. One declaration drives the Joi query keys (`listQueryKeys`), the parser
 * (`parseListQuery`), the Prisma arguments (`prismaListArgs`) and the page (`pageOf`), so the allow-lists cannot drift
 * apart. Every name in it comes from code; `defineListSpec` refuses a malformed one when the route module loads.
 *
 * Field names are the API's snake_case names (`created_at`); `column` is the Prisma field that backs it (`createdAt`).
 * Sort fields must be NOT NULL columns with an index that leads with `org_id` for tenant lists (data-model §3 access
 * patterns; the query-plan registry, TASK-118, proves each plan).
 */

/** Page-size ceilings (DR-A21; ADR-0016 amendment 5 (d)). */
export const LIMIT_CEILINGS = Object.freeze({
  /** Business lists: default 25, max 100 (REQ-API-007). */
  standard: 100,
  /** Audit lists: default 50, max 200. */
  audit: 200,
  /** Bounded global reference lists (countries, currencies, ...): up to 300, so the whole set fits one page. */
  reference: 300,
});
export type LimitCeiling = keyof typeof LIMIT_CEILINGS;

export interface LimitPolicy {
  readonly default: number;
  readonly max: number;
}

/** The README §4 defaults: 25/100 for business lists, 50/200 for audit lists, 20/20 for HS-code search and service points. */
export const LIMIT_PRESETS = Object.freeze({
  standard: Object.freeze({ default: 25, max: 100 }),
  audit: Object.freeze({ default: 50, max: 200 }),
  search: Object.freeze({ default: 20, max: 20 }),
});

export type FilterKind = 'enum' | 'string' | 'uuid' | 'boolean' | 'integer' | 'timestamp';

export interface FilterFieldSpec {
  /** The Prisma field the filter applies to. */
  readonly column: string;
  readonly kind: FilterKind;
  /** `enum`: the allowed values. */
  readonly values?: readonly string[];
  /** `enum`, `uuid`, `string`: a comma-separated value means "any of" (README §4). */
  readonly anyOf?: boolean;
  /**
   * `timestamp`, `integer`: the filter is a range with `filter[<field>_from]` (inclusive) and `filter[<field>_to]`
   * (exclusive) instead of an equality (README §4 range suffixes; D-TASK045-05).
   */
  readonly range?: boolean;
  /** `string`: the longest accepted value (default 200). */
  readonly maxLength?: number;
}

export interface SortFieldSpec {
  /** The Prisma field the sort applies to; a NOT NULL column. */
  readonly column: string;
}

export interface ListSpecInput {
  /** Page size; default `LIMIT_PRESETS.standard`. */
  readonly limit?: LimitPolicy;
  /** The ceiling `limit.max` must respect; default `standard`. `reference` is for `public` reference lists only. */
  readonly ceiling?: LimitCeiling;
  readonly sort: {
    readonly fields: Readonly<Record<string, SortFieldSpec>>;
    /** `sort` syntax, e.g. `-created_at`; used when the request has no `sort`. */
    readonly default: string;
  };
  readonly filters?: Readonly<Record<string, FilterFieldSpec>>;
  /** The route documents `include_total` (AT-US-037-06); without it the parameter is an unknown field. */
  readonly totals?: boolean;
  /** The unique tie-breaker column (default `id`). */
  readonly idColumn?: string;
}

export interface ListSpec {
  readonly limit: LimitPolicy;
  readonly ceiling: LimitCeiling;
  readonly sortFields: ReadonlyMap<string, SortFieldSpec>;
  readonly defaultSort: string;
  readonly filters: ReadonlyMap<string, FilterFieldSpec>;
  readonly totals: boolean;
  readonly idColumn: string;
}

export class ListSpecError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid list declaration: ${problems.join('; ')}`);
    this.name = 'ListSpecError';
  }
}

/** API field names: snake_case, as the contract spells them. */
export const FIELD_NAME = /^[a-z][a-z0-9_]{0,62}$/;
/** Prisma field names. */
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
/** Sort syntax of one term: an optional `-` and a field name. */
export const SORT_TERM = /^(-?)([a-z][a-z0-9_]{0,62})$/;
/** At most this many sort terms and filter fields per list (bounded work per request). */
export const MAX_SORT_TERMS = 4;
export const MAX_FILTER_FIELDS = 16;
const MAX_ENUM_VALUES = 64;
const ENUM_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_STRING_MAX = 200;
const MAX_STRING_MAX = 500;

const FILTER_KINDS: readonly FilterKind[] = ['enum', 'string', 'uuid', 'boolean', 'integer', 'timestamp'];

function limitProblems(limit: LimitPolicy, ceiling: LimitCeiling): string[] {
  const problems: string[] = [];
  const cap = LIMIT_CEILINGS[ceiling];
  if (!Number.isInteger(limit.max) || limit.max < 1 || limit.max > cap) {
    problems.push(`limit.max must be an integer in 1..${String(cap)} for the ${ceiling} ceiling`);
  }
  if (!Number.isInteger(limit.default) || limit.default < 1 || limit.default > limit.max) {
    problems.push('limit.default must be an integer in 1..limit.max');
  }
  return problems;
}

function filterProblems(field: string, filter: FilterFieldSpec): string[] {
  const where = `filter "${field}"`;
  const problems: string[] = [];
  if (!COLUMN_NAME.test(filter.column)) problems.push(`${where} has an invalid column`);
  if (!FILTER_KINDS.includes(filter.kind)) problems.push(`${where} has an unknown kind`);
  if (filter.kind === 'enum') {
    const values = filter.values ?? [];
    if (values.length === 0 || values.length > MAX_ENUM_VALUES || !values.every((value) => ENUM_VALUE.test(value))) {
      problems.push(`${where} needs 1..${String(MAX_ENUM_VALUES)} enum values of [A-Za-z0-9_-]`);
    }
    if (new Set(values).size !== values.length) problems.push(`${where} repeats an enum value`);
  } else if (filter.values !== undefined) problems.push(`${where} declares values but is not an enum`);
  if (filter.anyOf === true && !['enum', 'uuid', 'string'].includes(filter.kind)) problems.push(`${where} cannot be "any of"`);
  if (filter.range === true && !['timestamp', 'integer'].includes(filter.kind)) problems.push(`${where} cannot be a range`);
  if (filter.range === true && filter.anyOf === true) problems.push(`${where} cannot be both a range and "any of"`);
  if (filter.maxLength !== undefined) {
    if (filter.kind !== 'string') problems.push(`${where} declares maxLength but is not a string`);
    if (!Number.isInteger(filter.maxLength) || filter.maxLength < 1 || filter.maxLength > MAX_STRING_MAX) {
      problems.push(`${where} maxLength must be in 1..${String(MAX_STRING_MAX)}`);
    }
  }
  return problems;
}

/** The query keys a filter field occupies (`status`, or `created_at_from` and `created_at_to` for a range). */
export function filterKeysOf(field: string, filter: FilterFieldSpec): readonly string[] {
  return filter.range === true ? [`${field}_from`, `${field}_to`] : [field];
}

/** The longest accepted value of a string filter. */
export const stringFilterMax = (filter: FilterFieldSpec): number => filter.maxLength ?? DEFAULT_STRING_MAX;

/**
 * Validates and freezes a list declaration. Throws `ListSpecError` listing every problem: a declaration is code, so a
 * mistake fails the module load (and its unit test), never a request.
 */
export function defineListSpec(input: ListSpecInput): ListSpec {
  const problems: string[] = [];
  const limit = input.limit ?? LIMIT_PRESETS.standard;
  const ceiling = input.ceiling ?? 'standard';
  if (!Object.hasOwn(LIMIT_CEILINGS, ceiling)) problems.push(`unknown ceiling "${String(ceiling)}"`);
  else problems.push(...limitProblems(limit, ceiling));
  const idColumn = input.idColumn ?? 'id';
  if (!COLUMN_NAME.test(idColumn)) problems.push('idColumn is invalid');

  const sortEntries = Object.entries(input.sort.fields);
  if (sortEntries.length === 0) problems.push('the sort allow-list is empty');
  for (const [field, sort] of sortEntries) {
    if (!FIELD_NAME.test(field)) problems.push(`sort field "${field}" is not a snake_case name`);
    if (!COLUMN_NAME.test(sort.column)) problems.push(`sort field "${field}" has an invalid column`);
  }
  const sortFields = new Map(sortEntries);

  const filterEntries = Object.entries(input.filters ?? {});
  if (filterEntries.length > MAX_FILTER_FIELDS) problems.push(`more than ${String(MAX_FILTER_FIELDS)} filter fields`);
  const keys = new Set<string>();
  for (const [field, filter] of filterEntries) {
    if (!FIELD_NAME.test(field)) problems.push(`filter field "${field}" is not a snake_case name`);
    problems.push(...filterProblems(field, filter));
    for (const key of filterKeysOf(field, filter)) {
      if (keys.has(key)) problems.push(`filter key "${key}" is declared twice`);
      keys.add(key);
    }
  }

  const spec: ListSpec = Object.freeze({
    limit: Object.freeze({ default: limit.default, max: limit.max }),
    ceiling,
    sortFields,
    defaultSort: input.sort.default,
    filters: new Map(filterEntries),
    totals: input.totals === true,
    idColumn,
  });
  if (problems.length === 0) {
    const sorted = parseSortTerms(spec, input.sort.default);
    if (sorted === undefined) problems.push(`the default sort "${input.sort.default}" is not in the allow-list`);
  }
  if (problems.length > 0) throw new ListSpecError(problems);
  return spec;
}

export type SortDirection = 'asc' | 'desc';

export interface SortTerm {
  /** The API field name (`created_at`), or the id column for the appended tie-breaker. */
  readonly field: string;
  readonly column: string;
  readonly direction: SortDirection;
}

/**
 * The sort terms of `sort` (`field,-field`) followed by the id tie-breaker in the direction of the last term, or
 * `undefined` when the value is outside the allow-list: an empty or malformed term, an unknown field, a repeated field,
 * or more than `MAX_SORT_TERMS` terms. The tie-breaker is not appended when the id column is already a term.
 */
export function parseSortTerms(spec: ListSpec, value: string): readonly SortTerm[] | undefined {
  const parts = value.split(',');
  if (parts.length > MAX_SORT_TERMS) return undefined;
  const terms: SortTerm[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const match = SORT_TERM.exec(part);
    const field = match?.[2];
    const sort = field === undefined ? undefined : spec.sortFields.get(field);
    if (match === null || field === undefined || sort === undefined || seen.has(field)) return undefined;
    seen.add(field);
    terms.push({ field, column: sort.column, direction: match[1] === '-' ? 'desc' : 'asc' });
  }
  const last = terms.at(-1);
  if (last !== undefined && !terms.some((term) => term.column === spec.idColumn)) {
    terms.push({ field: spec.idColumn, column: spec.idColumn, direction: last.direction });
  }
  return Object.freeze(terms);
}
