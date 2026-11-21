/**
 * Paging through whole lists with the convention end to end, below HTTP (US-037): the fixture route body
 * (`answerList`: parseListQuery -> the in-memory engine with prismaListArgs semantics -> pageOf) driven page by page
 * with the returned cursors. pagination.api.test.ts repeats the scenarios over HTTP (lane B) and
 * apps/api/src/platform/pagination/list-keyset.int.test.ts on PostgreSQL 18 (lane B).
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import type { Principal, RouteDescriptor, RouteRequestContext } from '../routing/define-route.js';
// Through the module's entry point, as the list routes import it.
import { createCursorCodec, type ListPage, listQuerySchema, type ListSpec } from './index.js';
import {
  answerList,
  COUNTRY_LIST,
  fixtureCountries,
  fixtureRecords,
  ORG_A,
  ORG_EQUAL,
  type RecordItem,
  RECORD_LIST,
} from './tests/list-fixture.js';
import type { MemoryRecord } from './tests/memory-list.js';

const keyBytes = new Uint8Array(randomBytes(32));
const codec = createCursorCodec({ current: { keyId: 'cursor-v1', localOnly: false, material: { reveal: () => keyBytes.slice() } } });
const records = fixtureRecords();

const principal = (orgId: string): Principal => ({
  credential: 'session',
  authenticated: true,
  actorId: '0193a5b2-7c1e-7d4a-9f3b-0000000000f1',
  orgId,
  actorScope: 'TENANT',
  guestTokenHash: '',
  permissions: new Set(),
});

function page(spec: ListSpec, orgId: string, raw: Record<string, unknown>, data?: readonly MemoryRecord[]): ListPage<RecordItem> {
  const validated = listQuerySchema(spec).validate(raw, { convert: true });
  if (validated.error !== undefined) throw validated.error;
  const ctx: Pick<RouteRequestContext, 'route' | 'principal' | 'input'> = {
    route: { operationId: 'listFixtureRecords', tenancy: spec === COUNTRY_LIST ? 'public' : 'tenant' } as unknown as RouteDescriptor,
    principal: principal(orgId),
    input: { params: {}, query: validated.value as Record<string, unknown>, body: undefined, headers: {} },
  };
  return answerList(spec, ctx, codec, data ?? records.get(orgId) ?? []);
}

/** Every item of the list, following next_cursor until has_more is false. */
function walk(
  spec: ListSpec,
  orgId: string,
  raw: Record<string, unknown>,
  data?: readonly MemoryRecord[],
): { pages: number; ids: string[] } {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let pages = 1; pages <= 100; pages += 1) {
    const current = page(spec, orgId, cursor === undefined ? raw : { ...raw, cursor }, data);
    ids.push(...current.items.map((item) => item.id));
    expect(current.next_cursor === null).toBe(!current.has_more);
    if (!current.has_more) return { pages, ids };
    cursor = current.next_cursor ?? undefined;
  }
  throw new Error('more than 100 pages');
}

/** The code of the AppError `run` throws. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('no error thrown');
}

const idsOf = (orgId: string, compare: (a: MemoryRecord, b: MemoryRecord) => number): string[] =>
  [...(records.get(orgId) ?? [])].sort(compare).map((record) => String(record['id']));

describe('paging through a list (US-037)', () => {
  it('[AT-US-037-01] 60 records: the first page has 25 items, has_more and a cursor; the pages continue without overlap or gaps', () => {
    const first = page(RECORD_LIST, ORG_A, {});
    expect(first.items).toHaveLength(25);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = page(RECORD_LIST, ORG_A, { cursor: first.next_cursor });
    expect(second.items).toHaveLength(25);
    expect(second.items[0]?.created_at).not.toBe(first.items.at(-1)?.created_at);
    const all = walk(RECORD_LIST, ORG_A, {});
    expect(all.pages).toBe(3);
    const newestFirst = idsOf(ORG_A, (a, b) => (b['createdAt'] as Date).getTime() - (a['createdAt'] as Date).getTime());
    expect(all.ids).toEqual(newestFirst);
    expect(new Set(all.ids).size).toBe(60);
  });

  it('[AT-US-037-02] 30 records with the same created_at: each exactly once, ordered by the id tie-breaker, at any page size', () => {
    for (const limit of [1, 7, 25, 30]) {
      const all = walk(RECORD_LIST, ORG_EQUAL, { limit: String(limit), sort: 'created_at' });
      expect(all.ids).toEqual(idsOf(ORG_EQUAL, (a, b) => (String(a['id']) < String(b['id']) ? -1 : 1)));
    }
    const descending = walk(RECORD_LIST, ORG_EQUAL, { limit: '4', sort: '-created_at' });
    expect(descending.ids).toEqual(idsOf(ORG_EQUAL, (a, b) => (String(a['id']) < String(b['id']) ? 1 : -1)));
  });

  it('[AT-US-037-05] filter[status] and filter[country] combine with AND, sorted newest first', () => {
    const all = walk(RECORD_LIST, ORG_A, { 'filter[status]': 'BOOKED', 'filter[country]': 'IN', sort: '-created_at', limit: '2' });
    const expected = [...(records.get(ORG_A) ?? [])]
      .filter((record) => record['status'] === 'BOOKED' && record['countryCode'] === 'IN')
      .sort((a, b) => (b['createdAt'] as Date).getTime() - (a['createdAt'] as Date).getTime())
      .map((record) => String(record['id']));
    expect(expected.length).toBeGreaterThan(2);
    expect(all.ids).toEqual(expected);
  });

  it('a row whose sort value changes between pages does not shift the boundary of the others (the boundary row decides)', () => {
    const data = [...(records.get(ORG_A) ?? [])].slice(0, 10).map((record) => ({ ...record }));
    const first = page(RECORD_LIST, ORG_A, { limit: '3', sort: 'name' }, data);
    const boundary = first.items.at(-1)?.id;
    // A record of the first page is renamed so that it now sorts last: it appears again, nothing is skipped.
    const renamed = data.map((record) => (record['id'] === first.items[0]?.id ? { ...record, name: 'ZZZ' } : record));
    const rest = walk(RECORD_LIST, ORG_A, { limit: '3', sort: 'name', cursor: first.next_cursor }, renamed);
    expect(boundary).toBeDefined();
    expect(rest.ids).toHaveLength(8);
    expect(rest.ids.at(-1)).toBe(first.items[0]?.id);
  });

  it('R1-m1, the documented trade-off (D-TASK045-10): when the BOUNDARY row moves forward, the rows it passed are skipped', () => {
    const data = [...(records.get(ORG_A) ?? [])].slice(0, 10).map((record) => ({ ...record }));
    const idOfName = (name: string): string => String(data.find((record) => record['name'] === name)?.['id']);
    const first = page(RECORD_LIST, ORG_A, { limit: '3', sort: 'name' }, data);
    expect(first.items.map((item) => item.name)).toEqual(['Record 01', 'Record 02', 'Record 03']);
    // The boundary row (Record 03) is renamed past Record 08: the walk resumes from its current position.
    const moved = data.map((record) => (record['name'] === 'Record 03' ? { ...record, name: 'Record 08z' } : record));
    const rest = walk(RECORD_LIST, ORG_A, { limit: '3', sort: 'name', cursor: first.next_cursor }, moved);
    expect(rest.ids).toEqual([idOfName('Record 09'), idOfName('Record 10')]);
  });

  it("R1-M1 / PR045-SEC-02: a boundary row that left the caller's visible set is INVALID_CURSOR, never a silent end of the list", () => {
    const data = [...(records.get(ORG_A) ?? [])];
    const first = page(RECORD_LIST, ORG_A, { limit: '5' }, data);
    const boundary = first.items.at(-1)?.id;
    expect(boundary).toBeDefined();
    // Deleted, or moved to another organisation (both: no longer among the caller's records).
    const gone = data.filter((record) => record['id'] !== boundary);
    expect(codeOf(() => page(RECORD_LIST, ORG_A, { limit: '5', cursor: first.next_cursor }, gone))).toBe('INVALID_CURSOR');
    // Back again: the same cursor continues without overlap or gaps.
    const rest = walk(RECORD_LIST, ORG_A, { limit: '5', cursor: first.next_cursor }, data);
    expect([...first.items.map((item) => item.id), ...rest.ids]).toEqual(walk(RECORD_LIST, ORG_A, { limit: '5' }, data).ids);
  });

  it('[AT-US-037-07] a bounded reference list returns all 250 countries in one page of 300 with has_more false', () => {
    const countries = fixtureCountries();
    const all = page(COUNTRY_LIST, '', { limit: '300' }, countries);
    expect(all.items).toHaveLength(250);
    expect(all.has_more).toBe(false);
    expect(all.next_cursor).toBeNull();
    expect(listQuerySchema(COUNTRY_LIST).validate({ limit: '301' }).error?.details[0]?.type).toBe('number.max');
  });
});
