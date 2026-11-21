/**
 * Prisma arguments and page assembly of a list request (US-037; NFR-PERF-006). The database behaviour of the native
 * cursor (microsecond timestamps, equal keys, a boundary row that no longer matches) is proven on PostgreSQL 18 by
 * tests/api/list-keyset.int.test.ts (lane B).
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { createCursorCodec } from './cursor.js';
import type { ListRequest } from './list-query.js';
import { pageOf } from './page.js';
import { prismaListArgs } from './prisma-args.js';

const keyBytes = new Uint8Array(randomBytes(32));
const codec = createCursorCodec({ current: { keyId: 'cursor-v1', localOnly: false, material: { reveal: () => keyBytes.slice() } } });

const REQUEST: ListRequest = {
  limit: 2,
  sort: [
    { field: 'created_at', column: 'createdAt', direction: 'desc' },
    { field: 'id', column: 'id', direction: 'desc' },
  ],
  filters: [],
  after: undefined,
  includeTotal: false,
  idColumn: 'id',
  cursorBinding: '["list","listThings","org-a","actor-a","","-created_at,-id",[]]',
};

interface Row {
  readonly id: string;
  readonly name: string;
}
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, name: `name-${id}` }));
const options = { codec, idOf: (row: Row) => row.id, toItem: (row: Row) => ({ id: row.id, name: row.name }) };

describe('prismaListArgs', () => {
  it('first page: the order with the id tie-breaker, limit + 1 rows, no cursor, no conditions', () => {
    expect(prismaListArgs(REQUEST)).toEqual({ where: {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 3 });
  });

  it('[AT-US-037-05] filters combine with AND after the repository scope: eq, in, gte, lt', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    const request: ListRequest = {
      ...REQUEST,
      filters: [
        { field: 'status', column: 'status', op: 'eq', value: 'BOOKED' },
        { field: 'country', column: 'countryCode', op: 'in', values: ['IN', 'US'] },
        { field: 'created_at_from', column: 'createdAt', op: 'gte', value: at },
        { field: 'created_at_to', column: 'createdAt', op: 'lt', value: at },
      ],
    };
    expect(prismaListArgs(request, { deletedAt: null }).where).toEqual({
      AND: [
        { deletedAt: null },
        { status: 'BOOKED' },
        { countryCode: { in: ['IN', 'US'] } },
        { createdAt: { gte: at } },
        { createdAt: { lt: at } },
      ],
    });
    expect(prismaListArgs(REQUEST, { deletedAt: null }).where).toEqual({ AND: [{ deletedAt: null }] });
  });

  it('next page: the native cursor on the id column and one more row for the boundary row (no skip)', () => {
    const args = prismaListArgs({ ...REQUEST, after: { id: 'b' }, idColumn: 'uid' });
    expect(args).toEqual({ where: {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 4, cursor: { uid: 'b' } });
    expect(args).not.toHaveProperty('skip');
  });
});

describe('pageOf', () => {
  it('[AT-US-037-01] a full first page has has_more and a cursor at its last row', () => {
    const page = pageOf(REQUEST, rows('a', 'b', 'c'), options);
    expect(page.items).toEqual([
      { id: 'a', name: 'name-a' },
      { id: 'b', name: 'name-b' },
    ]);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).not.toBeNull();
    expect(codec.decode(REQUEST.cursorBinding, page.next_cursor ?? '')).toEqual({ id: 'b' });
    expect(page).not.toHaveProperty('total');
  });

  it('the last page has has_more false and next_cursor null', () => {
    expect(pageOf(REQUEST, rows('a', 'b'), options)).toEqual({ items: rows('a', 'b'), next_cursor: null, has_more: false });
    expect(pageOf(REQUEST, [], options)).toEqual({ items: [], next_cursor: null, has_more: false });
  });

  it('[AT-US-037-01] after a cursor the boundary row is dropped by id, so the next page continues without overlap', () => {
    const request = { ...REQUEST, after: { id: 'b' } };
    const page = pageOf(request, rows('b', 'c', 'd', 'e'), options);
    expect(page.items.map((item) => item.id)).toEqual(['c', 'd']);
    expect(page.has_more).toBe(true);
    expect(codec.decode(REQUEST.cursorBinding, page.next_cursor ?? '')).toEqual({ id: 'd' });
  });

  it('after a cursor whose boundary row no longer matches the filters, nothing is dropped (no gap)', () => {
    const request = { ...REQUEST, after: { id: 'b' } };
    const page = pageOf(request, rows('c', 'd'), options);
    expect(page.items.map((item) => item.id)).toEqual(['c', 'd']);
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  it('carries the sort-key values in the cursor when the consumer supplies them', () => {
    const page = pageOf(REQUEST, rows('a', 'b', 'c'), { ...options, keysOf: (row: Row) => [row.name, 7] });
    expect(codec.decode(REQUEST.cursorBinding, page.next_cursor ?? '')).toEqual({ id: 'b', keys: ['name-b', 7] });
  });

  it('[AT-US-037-06] the total is part of the page only when the request asks for it', () => {
    expect(pageOf({ ...REQUEST, includeTotal: true }, rows('a'), { ...options, total: 1 })).toEqual({
      items: [{ id: 'a', name: 'name-a' }],
      next_cursor: null,
      has_more: false,
      total: 1,
    });
    expect(pageOf(REQUEST, rows('a'), { ...options, total: 1 })).not.toHaveProperty('total');
    expect(() => pageOf({ ...REQUEST, includeTotal: true }, rows('a'), options)).toThrow('no total was counted');
    expect(() => pageOf({ ...REQUEST, includeTotal: true }, rows('a'), { ...options, total: -1 })).toThrow('no total was counted');
    expect(() => pageOf({ ...REQUEST, includeTotal: true }, rows('a'), { ...options, total: 1.5 })).toThrow('no total was counted');
  });
});
