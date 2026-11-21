/**
 * The list declaration, the Joi query keys and the parser (US-037; REQ-API-007/008; api/README.md §4).
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';
import Joi from 'joi';

import type { Principal, RouteDescriptor, RouteInput, RouteRequestContext } from '../routing/define-route.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { createCursorCodec } from './cursor.js';
import { filterQueryKey, listQueryKeys, listQuerySchema, MAX_SORT_LENGTH, parseListQuery } from './list-query.js';
import { defineListSpec, INT4_RANGE, LIMIT_PRESETS, type ListSpecInput, ListSpecError, parseSortTerms } from './list-spec.js';

const SPEC_INPUT: ListSpecInput = {
  sort: { fields: { created_at: { column: 'createdAt' }, display_name: { column: 'displayName' } }, default: '-created_at' },
  filters: {
    status: { column: 'status', kind: 'enum', values: ['ACTIVE', 'SUSPENDED', 'REMOVED'], anyOf: true },
    country: { column: 'countryCode', kind: 'enum', values: ['IN', 'US'] },
    created_at: { column: 'createdAt', kind: 'timestamp', range: true },
    weight: { column: 'weightGrams', kind: 'integer', range: true },
    owner_id: { column: 'ownerId', kind: 'uuid', anyOf: true },
    reference: { column: 'reference', kind: 'string', maxLength: 10 },
    archived: { column: 'archived', kind: 'boolean' },
  },
};
const spec = defineListSpec(SPEC_INPUT);

const key = { keyId: 'cursor-v1', localOnly: false, material: { reveal: () => new Uint8Array(randomBytes(32)) } };
const fixedKey = new Uint8Array(randomBytes(32));
const codec = createCursorCodec({ current: { ...key, material: { reveal: () => fixedKey.slice() } } });

const principal = (orgId: string, actorId = 'actor-1'): Principal => ({
  credential: 'session',
  authenticated: true,
  actorId,
  orgId,
  actorScope: 'TENANT',
  guestTokenHash: '',
  permissions: new Set(),
});

const route = (tenancy: RouteDescriptor['tenancy'] = 'tenant', operationId = 'listThings'): RouteDescriptor =>
  ({ operationId, tenancy }) as unknown as RouteDescriptor;

type Ctx = Pick<RouteRequestContext, 'route' | 'principal' | 'input'>;

/** Validates `raw` with the list keys, as the validate slot does, and builds the handler context. */
function ctxFor(
  raw: Record<string, unknown>,
  options: { orgId?: string; tenancy?: RouteDescriptor['tenancy']; specOverride?: typeof spec } = {},
): Ctx {
  const result = listQuerySchema(options.specOverride ?? spec).validate(raw, { convert: true, abortEarly: false });
  if (result.error !== undefined) throw result.error;
  const input: RouteInput = { params: {}, query: result.value as Record<string, unknown>, body: undefined, headers: {} };
  return { route: route(options.tenancy), principal: principal(options.orgId ?? 'org-a'), input };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('no error thrown');
}

/** The Joi error types of a query, or [] when it validates. */
const joiTypes = (raw: Record<string, unknown>, keys = listQuerySchema(spec)): string[] =>
  keys.validate(raw, { convert: true, abortEarly: false }).error?.details.map((detail) => `${detail.path.join('.')}:${detail.type}`) ?? [];

describe('defineListSpec', () => {
  it('defaults to the standard 25/100 policy, the id tie-breaker and no totals', () => {
    expect(spec.limit).toEqual({ default: 25, max: 100 });
    expect(spec.ceiling).toBe('standard');
    expect(spec.idColumn).toBe('id');
    expect(spec.totals).toBe(false);
  });

  it('refuses limits above the ceiling and defaults outside 1..max', () => {
    expect(() => defineListSpec({ ...SPEC_INPUT, limit: { default: 25, max: 101 } })).toThrow('1..100 for the standard ceiling');
    expect(() => defineListSpec({ ...SPEC_INPUT, limit: LIMIT_PRESETS.audit })).toThrow(ListSpecError);
    expect(defineListSpec({ ...SPEC_INPUT, limit: LIMIT_PRESETS.audit, ceiling: 'audit' }).limit.max).toBe(200);
    expect(() => defineListSpec({ ...SPEC_INPUT, limit: { default: 25, max: 301 }, ceiling: 'reference' })).toThrow('1..300');
    expect(defineListSpec({ ...SPEC_INPUT, limit: { default: 25, max: 300 }, ceiling: 'reference' }).limit.max).toBe(300);
    expect(() => defineListSpec({ ...SPEC_INPUT, limit: { default: 0, max: 100 } })).toThrow('limit.default');
    expect(() => defineListSpec({ ...SPEC_INPUT, limit: { default: 30, max: 20 } })).toThrow('limit.default');
    expect(() => defineListSpec({ ...SPEC_INPUT, limit: { default: 2.5, max: 20 } })).toThrow('limit.default');
    expect(() => defineListSpec({ ...SPEC_INPUT, ceiling: 'huge' as never })).toThrow('unknown ceiling');
  });

  it('refuses malformed names, columns, filters and default sorts, listing every problem', () => {
    const error = ((): ListSpecError => {
      try {
        defineListSpec({
          idColumn: 'id;drop',
          sort: { fields: { CreatedAt: { column: 'created at' } }, default: '-nope' },
          filters: {
            Bad: { column: 'x', kind: 'string' },
            e: { column: 'e', kind: 'enum', values: [] },
            d: { column: 'd', kind: 'enum', values: ['A', 'A'] },
            v: { column: 'v', kind: 'string', values: ['A'] },
            a: { column: 'a', kind: 'boolean', anyOf: true },
            r: { column: 'r', kind: 'string', range: true },
            ra: { column: 'ra', kind: 'integer', range: true, anyOf: true },
            m: { column: 'm', kind: 'integer', maxLength: 5 },
            n: { column: 'n', kind: 'string', maxLength: 501 },
            k: { column: 'k', kind: 'mystery' as never },
            c: { column: '1c', kind: 'string' },
          },
        });
      } catch (caught) {
        return caught as ListSpecError;
      }
      throw new Error('accepted');
    })();
    expect(error).toBeInstanceOf(ListSpecError);
    expect(error.problems).toEqual(
      expect.arrayContaining([
        'idColumn is invalid',
        'sort field "CreatedAt" is not a snake_case name',
        'sort field "CreatedAt" has an invalid column',
        'filter field "Bad" is not a snake_case name',
        'filter "e" needs 1..64 enum values of [A-Za-z0-9_-]',
        'filter "d" repeats an enum value',
        'filter "v" declares values but is not an enum',
        'filter "a" cannot be "any of"',
        'filter "r" cannot be a range',
        'filter "ra" cannot be both a range and "any of"',
        'filter "m" declares maxLength but is not a string',
        'filter "n" maxLength must be in 1..500',
        'filter "k" has an unknown kind',
        'filter "c" has an invalid column',
      ]),
    );
  });

  it('refuses an empty sort allow-list, a default sort outside it, colliding range keys and too many filters', () => {
    expect(() => defineListSpec({ sort: { fields: {}, default: 'id' } })).toThrow('the sort allow-list is empty');
    expect(() => defineListSpec({ ...SPEC_INPUT, sort: { ...SPEC_INPUT.sort, default: 'password_hash' } })).toThrow('the default sort');
    expect(() =>
      defineListSpec({
        ...SPEC_INPUT,
        filters: { created_at: { column: 'createdAt', kind: 'timestamp', range: true }, created_at_from: { column: 'x', kind: 'string' } },
      }),
    ).toThrow('filter key "created_at_from" is declared twice');
    const many = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`f${String(index)}`, { column: 'c', kind: 'string' as const }]),
    );
    expect(() => defineListSpec({ ...SPEC_INPUT, filters: many })).toThrow('more than 16 filter fields');
  });

  it('PR045-SEC-01: integer ranges are safe integers with min <= max, on integer filters only', () => {
    const withFilter = (filter: NonNullable<ListSpecInput['filters']>[string]) => () =>
      defineListSpec({ ...SPEC_INPUT, filters: { f: filter } });
    expect(withFilter({ column: 'c', kind: 'string', max: 5 })).toThrow('filter "f" declares min or max but is not an integer');
    expect(withFilter({ column: 'c', kind: 'integer', min: 5, max: 4 })).toThrow('min and max must be safe integers with min <= max');
    expect(withFilter({ column: 'c', kind: 'integer', max: Number.MAX_SAFE_INTEGER + 1 })).toThrow('safe integers');
    expect(withFilter({ column: 'c', kind: 'integer', min: 0.5 })).toThrow('safe integers');
    expect(withFilter({ column: 'c', kind: 'integer', min: 3_000_000_000 })).toThrow('min <= max');
    expect(withFilter({ column: 'c', kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER })).not.toThrow();
  });

  it('PR045-SEC-04: a sort field may declare only a timestamp, integer or uuid cursor key', () => {
    const sortWith = (key: string) => () =>
      defineListSpec({
        ...SPEC_INPUT,
        sort: { fields: { created_at: { column: 'createdAt', key: key as never } }, default: 'created_at' },
      });
    expect(sortWith('text')).toThrow('sort field "created_at" has an unknown key kind');
    for (const key of ['timestamp', 'integer', 'uuid']) expect(sortWith(key)).not.toThrow();
    const keyed = defineListSpec({
      ...SPEC_INPUT,
      sort: { fields: { created_at: { column: 'createdAt', key: 'timestamp' } }, default: '-created_at' },
    });
    expect(parseSortTerms(keyed, '-created_at')).toEqual([
      { field: 'created_at', column: 'createdAt', direction: 'desc', key: 'timestamp' },
      { field: 'id', column: 'id', direction: 'desc' },
    ]);
  });

  it('R1-m6: the type parameter binds columns to a model at compile time (a misspelt column does not compile)', () => {
    type Column = 'id' | 'createdAt' | 'status';
    const typed = defineListSpec<Column>({
      sort: { fields: { created_at: { column: 'createdAt' } }, default: '-created_at' },
      filters: { status: { column: 'status', kind: 'enum', values: ['ACTIVE'] } },
    });
    expect(typed.sortFields.get('created_at')?.column).toBe('createdAt');
    const misspelt = (): unknown =>
      defineListSpec<Column>({
        // @ts-expect-error -- 'createdat' is not a column of the model (R1-m6).
        sort: { fields: { created_at: { column: 'createdat' } }, default: '-created_at' },
      });
    expect(misspelt).not.toThrow();
  });
});

describe('parseSortTerms', () => {
  it('parses field,-field and appends the id tie-breaker in the direction of the last term', () => {
    expect(parseSortTerms(spec, '-created_at')).toEqual([
      { field: 'created_at', column: 'createdAt', direction: 'desc' },
      { field: 'id', column: 'id', direction: 'desc' },
    ]);
    expect(parseSortTerms(spec, 'display_name,-created_at')).toEqual([
      { field: 'display_name', column: 'displayName', direction: 'asc' },
      { field: 'created_at', column: 'createdAt', direction: 'desc' },
      { field: 'id', column: 'id', direction: 'desc' },
    ]);
  });

  it('does not append the tie-breaker when the id is already a term', () => {
    const withId = defineListSpec({ ...SPEC_INPUT, sort: { fields: { ...SPEC_INPUT.sort.fields, id: { column: 'id' } }, default: 'id' } });
    expect(parseSortTerms(withId, 'id,created_at')).toEqual([
      { field: 'id', column: 'id', direction: 'asc' },
      { field: 'created_at', column: 'createdAt', direction: 'asc' },
    ]);
  });

  it('refuses unknown, repeated, malformed and empty terms, and more than four terms', () => {
    for (const value of [
      'password_hash',
      'created_at,created_at',
      'created_at,-created_at',
      '',
      ',',
      'created_at,',
      '--created_at',
      '+created_at',
      'Created_At',
      'a,b,c,d,e',
    ]) {
      expect(parseSortTerms(spec, value)).toBeUndefined();
    }
  });
});

describe('listQueryKeys', () => {
  it('declares limit, cursor, sort and one key per allow-listed filter (range fields as _from/_to); include_total only when documented', () => {
    expect(Object.keys(listQueryKeys(spec)).sort()).toEqual(
      [
        'cursor',
        'filter[archived]',
        'filter[country]',
        'filter[created_at_from]',
        'filter[created_at_to]',
        'filter[owner_id]',
        'filter[reference]',
        'filter[status]',
        'filter[weight_from]',
        'filter[weight_to]',
        'limit',
        'sort',
      ].sort(),
    );
    expect(Object.keys(listQueryKeys(defineListSpec({ ...SPEC_INPUT, totals: true })))).toContain('include_total');
  });

  it('[AT-US-037-03-1] [AT-US-037-03-2] limit 0, 101, non-numeric, fractional or repeated is a validation error, never clamped', () => {
    expect(joiTypes({ limit: '101' })).toEqual(['limit:number.max']);
    expect(joiTypes({ limit: '0' })).toEqual(['limit:number.min']);
    expect(joiTypes({ limit: 'ten' })).toEqual(['limit:number.base']);
    expect(joiTypes({ limit: '2.5' })).toEqual(['limit:number.integer']);
    expect(joiTypes({ limit: ['1', '2'] })).toEqual(['limit:number.base']);
    expect(listQuerySchema(spec).validate({}, { convert: true }).value).toEqual({ limit: 25 });
    expect(listQuerySchema(spec).validate({ limit: '100' }, { convert: true }).value).toEqual({ limit: 100 });
  });

  it('[AT-US-037-04-1] an unknown filter key is an unknown field of the closed schema (the validate slot answers INVALID_FILTER)', () => {
    expect(joiTypes({ 'filter[internal_notes]': 'x' })).toEqual(['filter[internal_notes]:object.unknown']);
    expect(joiTypes({ filter: { status: 'ACTIVE' } })).toEqual(['filter:object.unknown']);
  });

  it('checks filter values: enums, any-of lists, UUIDs, strings, integers, timestamps and booleans', () => {
    expect(joiTypes({ 'filter[status]': 'ACTIVE,REMOVED', 'filter[country]': 'IN' })).toEqual([]);
    expect(joiTypes({ 'filter[status]': 'ACTIVE,NOPE' })).toEqual(['filter[status]:string.pattern.base']);
    expect(joiTypes({ 'filter[status]': 'ACTIVE,' })).toEqual(['filter[status]:string.pattern.base']);
    expect(joiTypes({ 'filter[status]': Array.from({ length: 21 }, () => 'ACTIVE').join(',') })).toEqual([
      'filter[status]:string.pattern.base',
    ]);
    expect(joiTypes({ 'filter[country]': 'IN,US' })).toEqual(['filter[country]:any.only']);
    expect(joiTypes({ 'filter[owner_id]': '0193a5b2-7c1e-7d4a-9f3b-000000000b02,0193a5b2-7c1e-7d4a-9f3b-000000000b03' })).toEqual([]);
    expect(joiTypes({ 'filter[owner_id]': 'not-a-uuid' })).toEqual(['filter[owner_id]:string.pattern.base']);
    expect(joiTypes({ 'filter[reference]': 'x'.repeat(11) })).toEqual(['filter[reference]:string.max']);
    expect(joiTypes({ 'filter[reference]': '' })).toEqual(['filter[reference]:string.empty']);
    expect(joiTypes({ 'filter[weight_from]': '1.5' })).toEqual(['filter[weight_from]:number.integer']);
    expect(joiTypes({ 'filter[created_at_from]': 'yesterday' })).toEqual(['filter[created_at_from]:date.format']);
    expect(joiTypes({ 'filter[archived]': 'maybe' })).toEqual(['filter[archived]:boolean.base']);
    expect(joiTypes({ 'filter[status]': ['ACTIVE', 'REMOVED'] })).toEqual(['filter[status]:string.base']);
  });

  it('PR045-SEC-01: a filter value the column would refuse is a validation error (NUL, outside int4, year 0000 or negative)', () => {
    const nul = String.fromCharCode(0);
    expect(joiTypes({ 'filter[reference]': `a${nul}b` })).toEqual(['filter[reference]:string.pattern.base']);
    expect(joiTypes({ 'filter[reference]': nul })).toEqual(['filter[reference]:string.pattern.base']);
    expect(joiTypes({ 'filter[weight_from]': '3000000000' })).toEqual(['filter[weight_from]:number.max']);
    expect(joiTypes({ 'filter[weight_to]': String(INT4_RANGE.max + 1) })).toEqual(['filter[weight_to]:number.max']);
    expect(joiTypes({ 'filter[weight_from]': '-2147483649' })).toEqual(['filter[weight_from]:number.min']);
    expect(joiTypes({ 'filter[created_at_from]': '0000-01-01T00:00:00Z' })).toEqual(['filter[created_at_from]:date.min']);
    expect(joiTypes({ 'filter[created_at_from]': '-000001-01-01T00:00:00Z' })).toEqual(
      expect.arrayContaining(['filter[created_at_from]:date.min']),
    );
    expect(joiTypes({ 'filter[created_at_to]': '+275760-09-13T00:00:00Z' })).toEqual(
      expect.arrayContaining(['filter[created_at_to]:date.max']),
    );
    expect(joiTypes({ 'filter[created_at_to]': '10000-01-01T00:00:00Z' })).toEqual(['filter[created_at_to]:date.format']);
  });

  it('PR045-SEC-01 controls: the bounds themselves, tabs and ordinary values are accepted', () => {
    expect(joiTypes({ 'filter[reference]': 'a\tb' })).toEqual([]);
    expect(joiTypes({ 'filter[weight_from]': String(INT4_RANGE.max), 'filter[weight_to]': String(INT4_RANGE.min) })).toEqual([]);
    expect(joiTypes({ 'filter[created_at_from]': '0001-01-01T00:00:00Z', 'filter[created_at_to]': '9999-12-31T23:59:59.999Z' })).toEqual(
      [],
    );
    expect(
      joiTypes({ 'filter[created_at_from]': '2026-11-21T12:00:00.123+05:30', 'filter[created_at_to]': '2026-11-21T12:00:00Z' }),
    ).toEqual([]);
    const wide = defineListSpec({
      ...SPEC_INPUT,
      filters: { big: { column: 'big', kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER } },
    });
    expect(joiTypes({ 'filter[big]': '3000000000' }, listQuerySchema(wide))).toEqual([]);
    expect(joiTypes({ 'filter[big]': '-1' }, listQuerySchema(wide))).toEqual(['filter[big]:number.min']);
  });

  it('R1-n2: a timestamp bound is a date-time with at most millisecond precision (never silently rounded), not a date', () => {
    for (const value of [
      '2026-11-21',
      '2026-11-21T12:00Z',
      '2026-11-21T12:00:00',
      '2026-11-21T12:00:00.1234Z',
      '2026-11-21T12:00:00.123456Z',
      '2026-11-21 12:00:00Z',
      '1763726400000',
    ]) {
      expect(joiTypes({ 'filter[created_at_from]': value })).toEqual(['filter[created_at_from]:date.format']);
    }
    const request = parseListQuery(spec, ctxFor({ 'filter[created_at_from]': '2026-11-21T12:00:00.123Z' }), codec);
    expect(request.filters).toEqual([
      { field: 'created_at_from', column: 'createdAt', op: 'gte', value: new Date('2026-11-21T12:00:00.123Z') },
    ]);
  });

  it('a list query schema mounts through defineRoute (closed, built-in Joi types only)', () => {
    expect(() =>
      fixtureRoute({
        operationId: 'listThings',
        path: '/things',
        schema: { query: listQuerySchema(spec) },
        handler: () => ({ status: 200, body: {} }),
      }),
    ).not.toThrow();
  });

  it('bounds cursor and sort lengths; an empty cursor or sort passes to the parser', () => {
    expect(joiTypes({ cursor: 'x'.repeat(513) })).toEqual(['cursor:string.max']);
    expect(joiTypes({ sort: 'x'.repeat(MAX_SORT_LENGTH + 1) })).toEqual(['sort:string.max']);
    expect(joiTypes({ cursor: '', sort: '' })).toEqual([]);
  });

  it('is a closed object Joi accepts as a route query schema (no key patterns, no unknown keys)', () => {
    const description = listQuerySchema(spec).describe() as { flags?: { unknown?: boolean }; patterns?: unknown };
    expect(description.flags?.unknown).toBeUndefined();
    expect(description.patterns).toBeUndefined();
    expect(Joi.isSchema(listQuerySchema(spec))).toBe(true);
  });
});

describe('parseListQuery', () => {
  it('applies the default sort and limit on a request without parameters', () => {
    const request = parseListQuery(spec, ctxFor({}), codec);
    expect(request).toMatchObject({ limit: 25, filters: [], after: undefined, includeTotal: false, idColumn: 'id' });
    expect(request.sort.map((term) => `${term.direction}:${term.column}`)).toEqual(['desc:createdAt', 'desc:id']);
  });

  it('[AT-US-037-04-2] a sort outside the allow-list is INVALID_SORT, as are empty and repeated sorts', () => {
    for (const sort of ['password_hash', '', 'created_at,created_at', 'created_at,-password_hash']) {
      expect(codeOf(() => parseListQuery(spec, ctxFor({ sort }), codec))).toBe('INVALID_SORT');
    }
  });

  it('[AT-US-037-05] builds typed filter terms combined with AND: equality, any-of (sorted, deduplicated) and ranges', () => {
    const request = parseListQuery(
      spec,
      ctxFor({
        'filter[status]': 'REMOVED,ACTIVE,REMOVED',
        'filter[country]': 'IN',
        'filter[created_at_from]': '2026-11-01T00:00:00Z',
        'filter[created_at_to]': '2026-11-02T00:00:00Z',
        'filter[weight_from]': '10',
        'filter[archived]': 'false',
        'filter[owner_id]': '0193a5b2-7c1e-7d4a-9f3b-000000000b02',
        sort: '-created_at',
      }),
      codec,
    );
    expect(request.filters).toEqual([
      { field: 'status', column: 'status', op: 'in', values: ['ACTIVE', 'REMOVED'] },
      { field: 'country', column: 'countryCode', op: 'eq', value: 'IN' },
      { field: 'created_at_from', column: 'createdAt', op: 'gte', value: new Date('2026-11-01T00:00:00Z') },
      { field: 'created_at_to', column: 'createdAt', op: 'lt', value: new Date('2026-11-02T00:00:00Z') },
      { field: 'weight_from', column: 'weightGrams', op: 'gte', value: 10 },
      { field: 'owner_id', column: 'ownerId', op: 'eq', value: '0193a5b2-7c1e-7d4a-9f3b-000000000b02' },
      { field: 'archived', column: 'archived', op: 'eq', value: false },
    ]);
  });

  it('an any-of filter with one distinct value is an equality', () => {
    const request = parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE,ACTIVE' }), codec);
    expect(request.filters).toEqual([{ field: 'status', column: 'status', op: 'eq', value: 'ACTIVE' }]);
  });

  it('[AT-US-037-10] a cursor round-trips for the same caller, sort and filters, and is INVALID_CURSOR for org B', () => {
    const first = parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE' }), codec);
    const cursor = codec.encode(first.cursorBinding, { id: 'row-25' });
    expect(parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE', cursor }), codec).after).toEqual({ id: 'row-25' });
    expect(parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE', cursor, limit: '50' }), codec).after).toEqual({ id: 'row-25' });
    expect(codeOf(() => parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE', cursor }, { orgId: 'org-b' }), codec))).toBe(
      'INVALID_CURSOR',
    );
    expect(codeOf(() => parseListQuery(spec, ctxFor({ 'filter[status]': 'REMOVED', cursor }), codec))).toBe('INVALID_CURSOR');
    expect(codeOf(() => parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE', cursor, sort: 'created_at' }), codec))).toBe(
      'INVALID_CURSOR',
    );
    expect(codeOf(() => parseListQuery(spec, ctxFor({ cursor }), codec))).toBe('INVALID_CURSOR');
  });

  describe('PR045-SEC-03 / R1-m3 / R1-m4: every binding member is pinned', () => {
    const routeQuery = Joi.object({ ...listQueryKeys(spec), q: Joi.string().min(2).max(100), since: Joi.date().iso() });
    const BASE: Principal = { ...principal('org-a'), actorId: 'actor-1', guestTokenHash: 'guest-hash-1' };

    interface Variant {
      readonly principal?: Partial<Principal>;
      readonly operationId?: string;
      readonly params?: Record<string, unknown>;
      readonly query?: Record<string, unknown>;
    }

    /** The parse of `{ 'filter[status]': 'ACTIVE', q: 'acme', ...variant.query }` for the variant caller and route. */
    const parse = (variant: Variant, cursor?: string) => {
      const raw = { 'filter[status]': 'ACTIVE', q: 'acme', ...variant.query, ...(cursor === undefined ? {} : { cursor }) };
      const validated = routeQuery.validate(Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)), {
        convert: true,
      });
      if (validated.error !== undefined) throw validated.error;
      const ctx: Ctx = {
        route: route('tenant', variant.operationId ?? 'listThings'),
        principal: { ...BASE, ...variant.principal },
        input: {
          params: variant.params ?? { orgId: 'org-a' },
          query: validated.value as Record<string, unknown>,
          body: undefined,
          headers: {},
        },
      };
      return parseListQuery(spec, ctx, codec);
    };
    const cursor = codec.encode(parse({}).cursorBinding, { id: 'row-25' });

    it('the same caller, route, sort, filters, path parameters and q continue; limit and include_total may change', () => {
      expect(parse({}, cursor).after).toEqual({ id: 'row-25' });
      expect(parse({ query: { limit: '50' } }, cursor).after).toEqual({ id: 'row-25' });
      const totals = defineListSpec({ ...SPEC_INPUT, totals: true });
      const withTotals = Joi.object({ ...listQueryKeys(totals), q: Joi.string() });
      const ctx = (raw: Record<string, unknown>): Ctx => ({
        route: route(),
        principal: BASE,
        input: {
          params: {},
          query: withTotals.validate(raw, { convert: true }).value as Record<string, unknown>,
          body: undefined,
          headers: {},
        },
      });
      const first = codec.encode(parseListQuery(totals, ctx({ q: 'acme' }), codec).cursorBinding, { id: 'row-2' });
      expect(parseListQuery(totals, ctx({ q: 'acme', include_total: 'true', cursor: first }), codec).after).toEqual({ id: 'row-2' });
    });

    it.each<[string, Variant]>([
      ['another organisation', { principal: { orgId: 'org-b' } }],
      ['another actor of the same organisation', { principal: { actorId: 'actor-2' } }],
      ['another guest-token hash', { principal: { guestTokenHash: 'guest-hash-2' } }],
      ['another actor scope', { principal: { actorScope: 'OPERATOR' } }],
      ['another credential kind', { principal: { credential: 'quote-token' } }],
      ['another operation', { operationId: 'listOtherThings' }],
      ['another sort', { query: { sort: 'created_at' } }],
      ['another filter value', { query: { 'filter[status]': 'REMOVED' } }],
      ['another q', { query: { q: 'zeta' } }],
      ['no q', { query: { q: undefined } }],
      ['a route date key', { query: { since: '2026-11-21T00:00:00Z' } }],
      ['another path parameter', { params: { orgId: 'org-c' } }],
      ['an extra path parameter', { params: { orgId: 'org-a', memberId: 'm-1' } }],
    ])('a cursor presented with %s is INVALID_CURSOR', (_name, variant) => {
      expect(codeOf(() => parse(variant, cursor))).toBe('INVALID_CURSOR');
    });

    it('route keys and path parameters are bound in canonical order (key order of the input does not matter)', () => {
      const a = parse({ params: { orgId: 'org-a', memberId: 'm-1' } });
      const b = parse({ params: { memberId: 'm-1', orgId: 'org-a' } });
      expect(a.cursorBinding).toBe(b.cursorBinding);
      expect(parse({ query: { q: 'acme' } }).cursorBinding).toBe(parse({}).cursorBinding);
      expect(parse({ query: { since: '2026-11-21T00:00:00Z' } }).cursorBinding).toBe(
        parse({ query: { since: '2026-11-21T00:00:00.000Z' } }).cursorBinding,
      );
    });
  });

  it('binds equivalent filter spellings to the same cursor (any-of order and duplicates do not matter)', () => {
    const a = parseListQuery(spec, ctxFor({ 'filter[status]': 'ACTIVE,REMOVED' }), codec);
    const b = parseListQuery(spec, ctxFor({ 'filter[status]': 'REMOVED,ACTIVE,ACTIVE' }), codec);
    expect(a.cursorBinding).toBe(b.cursorBinding);
    expect(parseListQuery(spec, ctxFor({}), codec).cursorBinding).not.toBe(a.cursorBinding);
  });

  it('[AT-US-037-03-3] a tampered cursor and an empty cursor are INVALID_CURSOR', () => {
    expect(codeOf(() => parseListQuery(spec, ctxFor({ cursor: 'tampered' }), codec))).toBe('INVALID_CURSOR');
    expect(codeOf(() => parseListQuery(spec, ctxFor({ cursor: '' }), codec))).toBe('INVALID_CURSOR');
  });

  it('[AT-US-037-06] include_total is honoured only on a route that documents it', () => {
    const totals = defineListSpec({ ...SPEC_INPUT, totals: true });
    expect(parseListQuery(totals, ctxFor({ include_total: 'true' }, { specOverride: totals }), codec).includeTotal).toBe(true);
    expect(parseListQuery(totals, ctxFor({ include_total: 'false' }, { specOverride: totals }), codec).includeTotal).toBe(false);
    expect(parseListQuery(totals, ctxFor({}, { specOverride: totals }), codec).includeTotal).toBe(false);
    expect(joiTypes({ include_total: 'true' })).toEqual(['include_total:object.unknown']);
  });

  it('[AT-US-037-08] a reference ceiling on a route that is not public is refused as a programming error', () => {
    const reference = defineListSpec({ ...SPEC_INPUT, limit: { default: 100, max: 300 }, ceiling: 'reference' });
    expect(() => parseListQuery(reference, ctxFor({}, { tenancy: 'tenant', specOverride: reference }), codec)).toThrow(ListSpecError);
    expect(parseListQuery(reference, ctxFor({ limit: '300' }, { tenancy: 'public', specOverride: reference }), codec).limit).toBe(300);
  });

  it('keeps filterQueryKey in the contract spelling', () => {
    expect(filterQueryKey('status')).toBe('filter[status]');
  });
});
