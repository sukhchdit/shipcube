/**
 * US-037 acceptance tests over HTTP (AT-US-037-01..07 and -10; REQ-API-007/008; api/README.md §4) against the real
 * createApp and pipeline with defineRoute fixture list routes (tests/list-fixture.ts) over the in-memory engine with
 * prismaListArgs semantics; no database. The contract rules (AT-US-037-08/09) are tools/openapi/list-contract.test.ts;
 * the database behaviour of the keyset arguments is apps/api/src/platform/pagination/list-keyset.int.test.ts.
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';

import { createApp, type AppLogger } from '../../app.js';
import type { Principal } from '../routing/define-route.js';
import { defaultPipelineSlots } from '../routing/pipeline.js';
import { ANONYMOUS, readonlySet, setPrincipal } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { closeLoopbackServer, fetchOnce, LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import { createCursorCodec, MAX_CURSOR_TTL_MS } from './cursor.js';
import {
  answerList,
  COUNTRY_LIST,
  fixtureCountries,
  fixtureQuery,
  fixtureRecords,
  ORG_A,
  ORG_B,
  ORG_EQUAL,
  RECORD_LIST,
  RECORD_LIST_WITH_TOTALS,
} from './tests/list-fixture.js';
import type { MemoryRecord } from './tests/memory-list.js';

jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const logger: AppLogger = { info: () => undefined, debug: () => undefined, error: () => undefined };
const records = fixtureRecords();
const countries = fixtureCountries();
const keyBytes = new Uint8Array(randomBytes(32));
let now = Date.UTC(2026, 10, 21, 12, 0, 0);
const codec = createCursorCodec({
  current: { keyId: 'cursor-v1', localOnly: false, material: { reveal: () => keyBytes.slice() } },
  now: () => now,
});

const ORG_HEADER = 'x-fixture-org';
const ACTOR_HEADER = 'x-fixture-actor';
const ACTOR_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000f1';
const ACTOR_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000f2';

/** Signs the caller in for the organisation (and actor) named by the fixture headers (no org header: anonymous). */
const signedIn: RouteSlot = () => (req: Request, res: Response, next: NextFunction) => {
  const orgId = req.headers[ORG_HEADER];
  const actorId = req.headers[ACTOR_HEADER];
  if (typeof orgId === 'string') {
    const principal: Principal = {
      ...ANONYMOUS,
      credential: 'session',
      authenticated: true,
      actorId: typeof actorId === 'string' ? actorId : ACTOR_A,
      orgId,
      permissions: readonlySet([]),
    };
    setPrincipal(res, principal);
  }
  next();
};

/** The records of the mutable fixture route (R1-M1: rows deleted between pages). */
let mutable: MemoryRecord[] = [...(records.get(ORG_A) ?? [])];

const routes = [
  fixtureRoute({
    operationId: 'listFixtureRecords',
    path: '/fixtures/records',
    auth: 'session',
    schema: fixtureQuery(RECORD_LIST, { q: Joi.string().min(2).max(100) }),
    handler: (ctx) => ({ status: 200, body: answerList(RECORD_LIST, ctx, codec, records.get(ctx.principal.orgId) ?? []) }),
  }),
  fixtureRoute({
    operationId: 'listFixtureMutableRecords',
    path: '/fixtures/mutable-records',
    auth: 'session',
    schema: fixtureQuery(RECORD_LIST),
    handler: (ctx) => ({ status: 200, body: answerList(RECORD_LIST, ctx, codec, mutable) }),
  }),
  fixtureRoute({
    operationId: 'listFixtureRecordsWithTotals',
    path: '/fixtures/records-with-totals',
    auth: 'session',
    schema: fixtureQuery(RECORD_LIST_WITH_TOTALS),
    handler: (ctx) => ({ status: 200, body: answerList(RECORD_LIST_WITH_TOTALS, ctx, codec, records.get(ctx.principal.orgId) ?? []) }),
  }),
  fixtureRoute({
    operationId: 'listFixtureCountries',
    path: '/fixtures/reference/countries',
    schema: fixtureQuery(COUNTRY_LIST),
    handler: (ctx) => ({ status: 200, body: answerList(COUNTRY_LIST, ctx, codec, countries) }),
  }),
];

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    health: [],
    modules: [{ name: 'fixtures', routes }],
    logger,
    pipeline: { ...defaultPipelineSlots({ tenantTx: undefined }), authenticate: signedIn },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await closeLoopbackServer(server);
});

interface Page {
  readonly items: { readonly id: string; readonly status?: string; readonly country?: string; readonly created_at?: string }[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
  readonly total?: number;
}

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** GET `path` with `query` (values encoded) as `actorId`, a member of `orgId` (undefined: anonymous). */
async function get(path: string, query: Record<string, string>, orgId: string | undefined = ORG_A, actorId = ACTOR_A): Promise<Answer> {
  const search = new URLSearchParams(query).toString();
  const response = await fetchOnce(`${base}/api/v1${path}${search === '' ? '' : `?${search}`}`, {
    headers: orgId === undefined ? {} : { [ORG_HEADER]: orgId, [ACTOR_HEADER]: actorId },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function pageOf(path: string, query: Record<string, string>, orgId: string = ORG_A): Promise<Page> {
  const answer = await get(path, query, orgId);
  expect(answer.status).toBe(200);
  return answer.body as unknown as Page;
}

/** Every id of the list, following next_cursor. */
async function walk(query: Record<string, string>, orgId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 100; pages += 1) {
    const page: Page = await pageOf('/fixtures/records', cursor === null ? query : { ...query, cursor }, orgId);
    ids.push(...page.items.map((item) => item.id));
    if (!page.has_more) return ids;
    cursor = page.next_cursor;
  }
  throw new Error('more than 100 pages');
}

const sortedIds = (orgId: string, compare: (a: string, b: string) => number): string[] =>
  (records.get(orgId) ?? []).map((record) => String(record['id'])).sort(compare);

describe('US-037 cursor pagination, filtering and sorting over HTTP', () => {
  it('[AT-US-037-01] first page has 25 items, has_more and a next_cursor; the next page continues without overlap or gaps', async () => {
    const first = await pageOf('/fixtures/records', {});
    expect(first.items).toHaveLength(25);
    expect(first.has_more).toBe(true);
    expect(typeof first.next_cursor).toBe('string');
    expect(first).not.toHaveProperty('total');
    const second = await pageOf('/fixtures/records', { cursor: first.next_cursor ?? '' });
    expect(second.items).toHaveLength(25);
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(50);
    const all = await walk({}, ORG_A);
    const byCreatedDesc = [...(records.get(ORG_A) ?? [])]
      .sort((a, b) => (b['createdAt'] as Date).getTime() - (a['createdAt'] as Date).getTime())
      .map((record) => String(record['id']));
    expect(all).toEqual(byCreatedDesc);
    expect(all.slice(0, 50)).toEqual(ids);
  });

  it('[AT-US-037-02] 30 records with the same created_at are returned exactly once each, ordered by the id tie-breaker', async () => {
    const ascending = await walk({ sort: 'created_at', limit: '7' }, ORG_EQUAL);
    expect(ascending).toEqual(sortedIds(ORG_EQUAL, (a, b) => (a < b ? -1 : 1)));
    const descending = await walk({ sort: '-created_at', limit: '4' }, ORG_EQUAL);
    expect(descending).toEqual(sortedIds(ORG_EQUAL, (a, b) => (a < b ? 1 : -1)));
  });

  it.each([
    ['1', { limit: '101' }, 'VALIDATION_ERROR'],
    ['2', { limit: '0' }, 'VALIDATION_ERROR'],
    ['3', { cursor: 'tampered' }, 'INVALID_CURSOR'],
  ])('[AT-US-037-03-%s] invalid pagination input %j is 400 %s', async (_row, query, code) => {
    const answer = await get('/fixtures/records', query);
    expect(answer.status).toBe(400);
    expect(answer.body['code']).toBe(code);
  });

  it('[AT-US-037-03-1] limit=101 names the limit with OUT_OF_RANGE and is never clamped', async () => {
    const answer = await get('/fixtures/records', { limit: '101' });
    expect(answer.body['errors']).toEqual([{ pointer: '/query/limit', code: 'OUT_OF_RANGE', message: 'Field is out of range.' }]);
  });

  it('[AT-US-037-03-4] an expired cursor is 400 INVALID_CURSOR', async () => {
    const issuedAt = now;
    const first = await pageOf('/fixtures/records', {});
    try {
      now = issuedAt + MAX_CURSOR_TTL_MS;
      const answer = await get('/fixtures/records', { cursor: first.next_cursor ?? '' });
      expect(answer.status).toBe(400);
      expect(answer.body['code']).toBe('INVALID_CURSOR');
    } finally {
      now = issuedAt;
    }
  });

  it.each([
    ['1', { 'filter[internal_notes]': 'x' }, 'INVALID_FILTER'],
    ['2', { sort: 'password_hash' }, 'INVALID_SORT'],
  ])('[AT-US-037-04-%s] %j is 400 %s', async (_row, query, code) => {
    const answer = await get('/fixtures/records', query);
    expect(answer.status).toBe(400);
    expect(answer.body['code']).toBe(code);
    expect(answer.body).not.toHaveProperty('errors');
  });

  it('[AT-US-037-05] filter[status]=BOOKED&filter[country]=IN&sort=-created_at returns only records matching both, newest first', async () => {
    const page = await pageOf('/fixtures/records', {
      'filter[status]': 'BOOKED',
      'filter[country]': 'IN',
      sort: '-created_at',
      limit: '100',
    });
    expect(page.items.length).toBeGreaterThan(1);
    expect(page.items.every((item) => item.status === 'BOOKED' && item.country === 'IN')).toBe(true);
    const created = page.items.map((item) => item.created_at ?? '');
    expect(created).toEqual([...created].sort().reverse());
    const expected = (records.get(ORG_A) ?? []).filter((record) => record['status'] === 'BOOKED' && record['countryCode'] === 'IN').length;
    expect(page.items).toHaveLength(expected);
  });

  it('[AT-US-037-06] totals are opt-in: none without include_total, the count with include_total=true where documented, 400 elsewhere', async () => {
    expect(await pageOf('/fixtures/records-with-totals', {})).not.toHaveProperty('total');
    const counted = await pageOf('/fixtures/records-with-totals', { include_total: 'true', limit: '10' });
    expect(counted.total).toBe(60);
    expect(counted.items).toHaveLength(10);
    const undocumented = await get('/fixtures/records', { include_total: 'true' });
    expect(undocumented.status).toBe(400);
    expect(undocumented.body['code']).toBe('VALIDATION_ERROR');
  });

  it('[AT-US-037-07] a bounded reference list allows limit=300: every enabled country in one page, has_more false; 301 is 400', async () => {
    const all = await get('/fixtures/reference/countries', { limit: '300' }, undefined);
    expect(all.status).toBe(200);
    const page = all.body as unknown as Page;
    expect(page.items).toHaveLength(countries.length);
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
    const over = await get('/fixtures/reference/countries', { limit: '301' }, undefined);
    expect(over.status).toBe(400);
    expect(over.body['code']).toBe('VALIDATION_ERROR');
  });

  it('[AT-US-037-10] a cursor issued to org A is 400 INVALID_CURSOR when org B presents it', async () => {
    const first = await pageOf('/fixtures/records', { limit: '2' }, ORG_A);
    const cursor = first.next_cursor ?? '';
    expect((await get('/fixtures/records', { limit: '2', cursor }, ORG_A)).status).toBe(200);
    const foreign = await get('/fixtures/records', { limit: '2', cursor }, ORG_B);
    expect(foreign.status).toBe(400);
    expect(foreign.body['code']).toBe('INVALID_CURSOR');
  });

  it('[AT-US-037-10] PR045-SEC-03: a cursor is bound to the actor and to q (another member or another q is INVALID_CURSOR)', async () => {
    const first = await pageOf('/fixtures/records', { limit: '2', q: 'record' });
    const cursor = first.next_cursor ?? '';
    expect((await get('/fixtures/records', { limit: '2', q: 'record', cursor })).status).toBe(200);
    for (const answer of [
      await get('/fixtures/records', { limit: '2', q: 'record', cursor }, ORG_A, ACTOR_B),
      await get('/fixtures/records', { limit: '2', q: 'record 1', cursor }),
      await get('/fixtures/records', { limit: '2', cursor }),
    ]) {
      expect(answer.status).toBe(400);
      expect(answer.body['code']).toBe('INVALID_CURSOR');
    }
  });

  it('R1-M1 / PR045-SEC-02: a boundary record deleted between pages is 400 INVALID_CURSOR, not an empty last page', async () => {
    const original = mutable;
    try {
      const first = await pageOf('/fixtures/mutable-records', { limit: '5' });
      const boundary = first.items.at(-1)?.id;
      expect(first.has_more).toBe(true);
      mutable = original.filter((record) => record['id'] !== boundary);
      const answer = await get('/fixtures/mutable-records', { limit: '5', cursor: first.next_cursor ?? '' });
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ code: 'INVALID_CURSOR', detail: 'Invalid cursor.' });
    } finally {
      mutable = original;
    }
  });

  it.each([
    ['a string with U+0000', 'filter[name]', `Record${String.fromCharCode(0)}`, 'INVALID_FORMAT'],
    ['an integer outside int4', 'filter[rank]', '3000000000', 'OUT_OF_RANGE'],
    ['a negative integer outside int4', 'filter[rank]', '-2147483649', 'OUT_OF_RANGE'],
    ['the year 0000', 'filter[created_at_from]', '0000-01-01T00:00:00Z', 'OUT_OF_RANGE'],
    ['a date without a time', 'filter[created_at_from]', '2026-11-21', 'INVALID_FORMAT'],
    ['a sub-millisecond bound', 'filter[created_at_to]', '2026-11-21T12:00:00.123456Z', 'INVALID_FORMAT'],
  ])('PR045-SEC-01: %s is 400 VALIDATION_ERROR with the filter pointer, never 500', async (_name, key, value, subCode) => {
    const answer = await get('/fixtures/records', { [key]: value });
    expect(answer.status).toBe(400);
    expect(answer.body['code']).toBe('VALIDATION_ERROR');
    expect(answer.body['errors']).toEqual([expect.objectContaining({ pointer: `/query/${key}`, code: subCode })]);
  });

  it('PR045-SEC-01 controls: the int4 maximum and the year bounds are accepted', async () => {
    expect((await get('/fixtures/records', { 'filter[rank]': '2147483647' })).status).toBe(200);
    const all = await pageOf('/fixtures/records', {
      'filter[created_at_from]': '0001-01-01T00:00:00Z',
      'filter[created_at_to]': '9999-12-31T23:59:59.999Z',
      limit: '100',
    });
    expect(all.items).toHaveLength(60);
  });
});
