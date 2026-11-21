/**
 * Test helper (TASK-045): the US-037 fixture data and the fixture list routes of pagination.api.test.ts and
 * paging.test.ts. Each route declares its list with defineListSpec, validates its query with listQuerySchema, parses
 * with parseListQuery and answers with pageOf over the in-memory engine (memory-list.ts), so the HTTP convention is
 * exercised without a database. Never imported by production code.
 */
import type { CursorCodec } from '../cursor.js';
import { type ListRequest, listQuerySchema, parseListQuery } from '../list-query.js';
import { defineListSpec, type ListSpec } from '../list-spec.js';
import { pageOf } from '../page.js';
import type { RouteRequestContext } from '../../routing/define-route.js';
import { type MemoryRecord, memoryListRows, memoryListTotal } from './memory-list.js';

export const ORG_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
export const ORG_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000b1';
/** The organisation whose 30 records share one created_at (AT-US-037-02). */
export const ORG_EQUAL = '0193a5b2-7c1e-7d4a-9f3b-0000000000c1';

const STATUSES = ['BOOKED', 'DRAFT', 'CANCELLED'] as const;
const COUNTRIES = ['IN', 'US', 'GB'] as const;
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);

/** A UUID-shaped id whose last 12 hex digits are `n` (ids sort like `n`). */
export const fixtureId = (prefix: string, n: number): string => `${prefix}-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** 60 records of org A (distinct created_at, statuses and countries cycling), 30 of org EQUAL (one created_at), 5 of org B. */
export function fixtureRecords(): ReadonlyMap<string, readonly MemoryRecord[]> {
  const orgA = Array.from({ length: 60 }, (_, n) => ({
    id: fixtureId('0193a5b2', n + 1),
    createdAt: new Date(T0 + n * 60_000),
    name: `Record ${String(n + 1).padStart(2, '0')}`,
    status: STATUSES[n % STATUSES.length] ?? 'DRAFT',
    countryCode: COUNTRIES[Math.floor(n / 3) % COUNTRIES.length] ?? 'IN',
  }));
  // Inserted out of id order, so only the tie-breaker can put them in order.
  const equal = Array.from({ length: 30 }, (_, n) => ({
    id: fixtureId('0193a5b3', ((n * 7) % 30) + 1),
    createdAt: new Date(T0),
    name: 'Same',
    status: 'BOOKED',
    countryCode: 'IN',
  }));
  const orgB = Array.from({ length: 5 }, (_, n) => ({
    id: fixtureId('0193a5b4', n + 1),
    createdAt: new Date(T0 + n),
    name: `B ${String(n)}`,
    status: 'BOOKED',
    countryCode: 'IN',
  }));
  return new Map([
    [ORG_A, orgA],
    [ORG_EQUAL, equal],
    [ORG_B, orgB],
  ]);
}

/** 250 enabled countries (AT-US-037-07: a bounded reference set), codes AA.. in order. */
export function fixtureCountries(): readonly MemoryRecord[] {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: 250 }, (_, n) => {
    const code = `${letters[Math.floor(n / 26)] ?? 'Z'}${letters[n % 26] ?? 'Z'}`;
    return { id: code, code, name: `Country ${code}` };
  });
}

export const RECORD_LIST: ListSpec = defineListSpec({
  sort: { fields: { created_at: { column: 'createdAt' }, name: { column: 'name' } }, default: '-created_at' },
  filters: {
    status: { column: 'status', kind: 'enum', values: [...STATUSES], anyOf: true },
    country: { column: 'countryCode', kind: 'enum', values: [...COUNTRIES] },
    created_at: { column: 'createdAt', kind: 'timestamp', range: true },
  },
});

export const RECORD_LIST_WITH_TOTALS: ListSpec = defineListSpec({
  sort: { fields: { created_at: { column: 'createdAt' } }, default: '-created_at' },
  totals: true,
});

export const COUNTRY_LIST: ListSpec = defineListSpec({
  limit: { default: 100, max: 300 },
  ceiling: 'reference',
  sort: { fields: { code: { column: 'code' } }, default: 'code' },
});

type ListContext = Pick<RouteRequestContext, 'route' | 'principal' | 'input'>;

export interface RecordItem {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly country?: string;
  readonly created_at?: string;
}

const toItem = (record: MemoryRecord): RecordItem => ({
  id: String(record['id']),
  name: String(record['name']),
  ...(record['status'] === undefined ? {} : { status: String(record['status']) }),
  ...(record['countryCode'] === undefined ? {} : { country: String(record['countryCode']) }),
  ...(record['createdAt'] instanceof Date ? { created_at: record['createdAt'].toISOString() } : {}),
});

/** The handler body of a fixture list route: parse, query the caller's records, answer the page. */
export function answerList(spec: ListSpec, ctx: ListContext, codec: CursorCodec, records: readonly MemoryRecord[]) {
  const request: ListRequest = parseListQuery(spec, ctx, codec);
  const rows = memoryListRows(records, request);
  return pageOf(request, rows, {
    codec,
    idOf: (record) => String(record['id']),
    toItem,
    ...(request.includeTotal ? { total: memoryListTotal(records, request) } : {}),
  });
}

/** The query schema of a fixture list route. */
export const fixtureQuery = (spec: ListSpec) => ({ query: listQuerySchema(spec) });
