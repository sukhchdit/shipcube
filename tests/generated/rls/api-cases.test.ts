/**
 * The cross-tenant API case runner over a fake HTTP server, without Docker (code review R2-n2 (c), PR43-SEC-12;
 * TASK-027). The fake answers like a route over a GUEST_CAPABLE table: user A sees rows of organisation A, the guest of
 * hash H sees the guest row G, everyone else gets 404 problem+json echoing the path in `instance`. Each test bends one
 * behaviour and pins the exact problems, so dropping a check of the runner fails here.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { callsFor, distinctiveValues, fillPath, PRINCIPAL_HEADER, runApiCase } from './api-cases.js';
import type { SeededRow, TablePlan } from './database.js';
import { type ApiCrossTenantCase, isSuccessStatus, type RouteShape, routeCaseFindings, stableUuid } from './generator.js';

// Composes the app (a cold module graph) and answers real requests: the 5 s Jest default timed out under parallel host load (W0-FLAKE, D-ORCH-097).
jest.setTimeout(60_000);

const ORG_A = stableUuid('fake:org:A');
const ORG_B = stableUuid('fake:org:B');
const COLUMNS = ['id', 'org_id', 'name', 'created_by'];
const SHARED = 'shared-constant-value';
const ROW_VALUES: Readonly<Record<SeededRow, readonly unknown[]>> = {
  A: [stableUuid('fake:row:A'), ORG_A, 'alpha-row-name', SHARED],
  B: [stableUuid('fake:row:B'), ORG_B, 'bravo-row-name', SHARED],
  G: [stableUuid('fake:row:G'), null, 'guest-row-name', SHARED],
};
const PLAN: TablePlan = {
  table: {
    schema: 'public',
    name: 'fake_quotes',
    kind: 'r',
    columns: COLUMNS.map((name) => ({ name, type: 'text', notNull: name !== 'org_id', hasDefault: false })),
    rowSecurity: true,
    forceRowSecurity: true,
    triggers: [],
    appPrivileges: ['SELECT'],
  },
  key: { column: 'org_id', scope: 'org' },
  rowA: String(ROW_VALUES.A[0]),
  rowB: String(ROW_VALUES.B[0]),
  keyA: ORG_A,
  keyB: ORG_B,
  guestRow: String(ROW_VALUES.G[0]),
  seeded: {
    A: { columns: COLUMNS, values: ROW_VALUES.A },
    B: { columns: COLUMNS, values: ROW_VALUES.B },
    G: { columns: COLUMNS, values: ROW_VALUES.G },
  },
};
const ROW = (row: SeededRow): Record<string, unknown> =>
  Object.fromEntries(COLUMNS.map((column, index) => [column, ROW_VALUES[row][index]]));

const DUAL: RouteShape = {
  operationId: 'getQuote',
  method: 'get',
  path: '/quotes/:quoteId',
  tenancy: 'guest',
  auth: ['session', 'quote-token'],
};
const SESSION_ONLY: RouteShape = { ...DUAL, operationId: 'getOrder', path: '/orders/:orderId', tenancy: 'tenant', auth: ['session'] };
const CASE: ApiCrossTenantCase = { table: 'fake_quotes', params: { quoteId: 'id' } };

type Visible = (principal: string, row: SeededRow) => boolean;
interface Behaviour {
  readonly visible: Visible;
  /** Status of a visible row (default 200). */
  readonly okStatus?: number;
  /** Extra headers on a 404. */
  readonly refusalHeaders?: (row: SeededRow | undefined) => Record<string, string>;
}

const ISOLATED: Visible = (principal, row) => (principal === 'tenant-a' && row === 'A') || (principal === 'guest-h' && row === 'G');
let behaviour: Behaviour = { visible: ISOLATED };

function respond(req: IncomingMessage, res: ServerResponse): void {
  const principal = String(req.headers[PRINCIPAL_HEADER]);
  const id = decodeURIComponent(String(req.url).split('/').pop() ?? '');
  const row = (['A', 'B', 'G'] as const).find((name) => ROW_VALUES[name][0] === id);
  if (row !== undefined && behaviour.visible(principal, row)) {
    res.writeHead(behaviour.okStatus ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ROW(row)));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/problem+json', ...(behaviour.refusalHeaders?.(row) ?? {}) });
  res.end(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND', instance: req.url }));
}

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer(respond);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', () => done()));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  server.closeAllConnections();
});

const run = (next: Behaviour, route: RouteShape = DUAL, apiCase: ApiCrossTenantCase = CASE): Promise<string[]> => {
  behaviour = next;
  return runApiCase(base, route, apiCase, PLAN);
};

describe('the API case runner (AT-US-077-02; R2-n2, PR43-SEC-12)', () => {
  it('a route that isolates A, B, G and the guests passes, the path echo in `instance` included', async () => {
    expect(await run({ visible: ISOLATED })).toEqual([]);
    expect(await run({ visible: ISOLATED }, SESSION_ONLY, { table: 'fake_quotes', params: { orderId: 'id' } })).toEqual([]);
  });

  it('R2-n2 (a) per credential kind the cross-tenant call then the positive; a dual-mode route adds both cross directions', () => {
    expect(callsFor(SESSION_ONLY)).toEqual([
      { principal: 'tenant-a', row: 'B', negative: true },
      { principal: 'tenant-a', row: 'A', negative: false },
    ]);
    expect(callsFor({ auth: ['quote-token'] })).toEqual([
      { principal: 'guest-h2', row: 'G', negative: true },
      { principal: 'guest-h', row: 'G', negative: false },
    ]);
    expect(callsFor(DUAL).slice(4)).toEqual([
      { principal: 'tenant-a', row: 'G', negative: true },
      { principal: 'guest-h', row: 'B', negative: true },
    ]);
    expect(callsFor({ auth: ['signature'] })).toEqual([]);
  });

  it('R2-n2 (a) a session that reads the guest row, and a guest that reads an organisation row, are each named', async () => {
    const crossLeak: Visible = (principal, row) =>
      ISOLATED(principal, row) || (principal === 'tenant-a' && row === 'G') || (principal === 'guest-h' && row === 'B');
    expect(await run({ visible: crossLeak })).toEqual([
      'getQuote [tenant-a -> row G]: expected 404, got 200',
      'getQuote [tenant-a -> row G]: not a problem+json body',
      'getQuote [tenant-a -> row G]: code undefined, expected NOT_FOUND',
      "getQuote [tenant-a -> row G]: the body carries 2 value(s) of the other tenant's row",
      'getQuote [guest-h -> row B]: expected 404, got 200',
      'getQuote [guest-h -> row B]: not a problem+json body',
      'getQuote [guest-h -> row B]: code undefined, expected NOT_FOUND',
      "getQuote [guest-h -> row B]: the body carries 3 value(s) of the other tenant's row",
    ]);
  });

  it('a route that answers every id leaks on every negative call', async () => {
    const problems = await run({ visible: () => true });
    expect(problems.filter((problem) => problem.endsWith('expected 404, got 200'))).toEqual([
      'getQuote [tenant-a -> row B]: expected 404, got 200',
      'getQuote [guest-h2 -> row G]: expected 404, got 200',
      'getQuote [tenant-a -> row G]: expected 404, got 200',
      'getQuote [guest-h -> row B]: expected 404, got 200',
    ]);
    expect(problems).toHaveLength(16);
  });

  it("R2-n2 (b) a 404 whose ETag or Location carries the other row's values is named", async () => {
    const refusalHeaders = (row: SeededRow | undefined): Record<string, string> =>
      row === 'B' ? { etag: `"${String(ROW_VALUES.B[0])}"`, location: `/orgs/${ORG_B}` } : {};
    expect(await run({ visible: ISOLATED, refusalHeaders }, SESSION_ONLY, { table: 'fake_quotes', params: { orderId: 'id' } })).toEqual([
      "getOrder [tenant-a -> row B]: response header etag carries 1 value(s) of the other tenant's row",
      "getOrder [tenant-a -> row B]: response header location carries 1 value(s) of the other tenant's row",
    ]);
  });

  it('R2-n2 (c) a positive control that does not reach the own row is named (the check cannot be dropped)', async () => {
    expect(await run({ visible: ISOLATED, okStatus: 403 }, SESSION_ONLY, { table: 'fake_quotes', params: { orderId: 'id' } })).toEqual([
      'getOrder [tenant-a -> row A]: positive control expected 200, got 403',
    ]);
    const nobody: Visible = () => false;
    expect(await run({ visible: nobody }, SESSION_ONLY, { table: 'fake_quotes', params: { orderId: 'id' } })).toEqual([
      'getOrder [tenant-a -> row A]: positive control expected 200, got 404',
    ]);
  });

  it('PR43-SEC-12 a mis-mapped case with positiveStatus 404 over a leaking route fails the runner and the enumeration; 201 on a creating route passes', async () => {
    // The parameter is mapped to org_id: no row has that id, so every call is 404 and only the positive control can tell.
    const misMapped: ApiCrossTenantCase = { table: 'fake_quotes', params: { orderId: 'org_id' }, positiveStatus: 404 };
    expect(await run({ visible: () => true }, SESSION_ONLY, misMapped)).toEqual([
      'getOrder [tenant-a -> row A]: positiveStatus 404 is not a success status',
      'getOrder [tenant-a -> row A]: positive control expected 404, got 404',
    ]);
    const entries = [{ module: 'm', name: 'fake_quotes', class: 'TENANT' as const }];
    expect(routeCaseFindings([SESSION_ONLY], new Map([['getOrder', misMapped]]), entries)).toEqual([
      "GET /orders/:orderId (getOrder): positiveStatus 404 is not a success status (the positive control must reach the caller's own row)",
    ]);
    const created: ApiCrossTenantCase = { table: 'fake_quotes', params: { orderId: 'id' }, positiveStatus: 201 };
    expect(routeCaseFindings([SESSION_ONLY], new Map([['getOrder', created]]), entries)).toEqual([]);
    expect(await run({ visible: ISOLATED, okStatus: 201 }, SESSION_ONLY, created)).toEqual([]);
    expect([200, 201, 299].map(isSuccessStatus)).toEqual([true, true, true]);
    expect([199, 300, 404, 200.5].map(isSuccessStatus)).toEqual([false, false, false, false]);
  });

  it('a case whose route accepts no presentable kind, or whose table lacks a seeded row, is named', async () => {
    expect(await run({ visible: ISOLATED }, { ...SESSION_ONLY, auth: ['signature'] })).toEqual([
      'getOrder: no credential kind the runner can present',
    ]);
    const noGuest: TablePlan = { ...PLAN, seeded: { ...PLAN.seeded, G: undefined } };
    behaviour = { visible: ISOLATED };
    expect(await runApiCase(base, { ...DUAL, auth: ['quote-token'] }, CASE, noGuest)).toEqual([
      'getQuote [guest-h2 -> row G]: table fake_quotes has no seeded row G',
      'getQuote [guest-h -> row G]: table fake_quotes has no seeded row G',
    ]);
  });

  it('fills path parameters from the seeded row and reads the distinctive values without the shared constants', () => {
    expect(fillPath('/quotes/:quoteId', { quoteId: 'id' }, ROW('G'))).toBe(`/quotes/${String(ROW_VALUES.G[0])}`);
    expect(() => fillPath('/quotes/:quoteId', {}, ROW('G'))).toThrow('path parameter quoteId: no seeded column undefined');
    expect(distinctiveValues(PLAN, 'B')).toEqual([String(ROW_VALUES.B[0]), ORG_B, 'bravo-row-name']);
  });
});
