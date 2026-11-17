/**
 * The RBAC matrix runner over a fake HTTP server, without the app (PR #48 code review R1-m1 and R1-m4, PR48-SEC-01 and
 * PR48-SEC-05 item 1; TASK-289), like the RLS runner's api-cases.test.ts. The fake answers like a conformant pipeline
 * for one `[session]` route and one `[anonymous]` route, with a fresh correlation id per request (header and problem
 * member) so the volatile parts always differ. Each test bends one behaviour (S1-S4 of the PR48-SEC-01 record, the
 * Cache-Control and refusal checks, the transport) and pins the exact problems, so dropping a check fails here.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type MatrixCaller, type MatrixCell, matrixCallers, type MatrixRow, signatureHeaderId } from '@platform/authz/matrix';

import { closeLoopbackServer, LOOPBACK_TEST_TIMEOUT_MS } from '../../../apps/api/src/platform/routing/tests/loopback.js';
import { recordAbortTimeouts } from '../../../apps/api/src/platform/routing/tests/timing.js';
import { MATRIX_ORGS, PUBLIC_CACHE_CONTROL, REACHED_HEADER, REACHED_VALUE, refreshCookieName } from './matrix-app.js';
import {
  type MatrixTarget,
  MatrixRequestError,
  observe,
  OBSERVE_DEADLINE_MS,
  runOrgCase,
  runRow,
  VOLATILE_HEADERS,
  VOLATILE_PROBLEM_MEMBERS,
  weakBodyEtag,
} from './runner.js';

// Imports the matrix app (a cold createApp module graph) and answers real loopback requests (W0-FLAKE, D-ORCH-097).
jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const PRIVATE = 'private, no-store';
const CALLERS: ReadonlyMap<string, MatrixCaller> = new Map(
  matrixCallers([{ key: 'CU_OWNER', scope: 'CUSTOMER', nameKey: 'k', description: 'd', permissions: ['shipment:read'] }]).map((caller) => [
    caller.id,
    caller,
  ]),
);
const STRIPE = signatureHeaderId('stripe-signature');

const cell = (caller: string, outcome: MatrixCell['outcome'], foreign: boolean, isPrivate = true): MatrixCell => ({
  caller,
  outcome,
  private: isPrivate,
  foreign,
});

/** `getThing` `[session]`: the owner is allowed, every other caller 401; the cookie, token and signature are foreign. */
const SESSION_TARGET: MatrixTarget = { operationId: 'getThing', method: 'get', path: '/things/:thingId' };
const SESSION_ROW: MatrixRow = {
  route: {
    operationId: 'getThing',
    method: 'get',
    path: '/things/:thingId',
    permission: 'shipment:read',
    tenancy: 'tenant',
    auth: ['session'],
  },
  cells: [
    cell('none', 'deny-401', false),
    cell('CU_OWNER', 'allow', false),
    cell('session:expired', 'deny-401', false),
    cell('refresh-cookie:valid', 'deny-401', true),
    cell('refresh-cookie:unknown', 'deny-401', true),
    cell('quote-token:valid', 'deny-401', true),
    cell(STRIPE, 'deny-401', true),
  ],
};
/** `listThings` `[anonymous]`: everyone is allowed and the response is public; every credential is foreign. */
const OPEN_TARGET: MatrixTarget = { operationId: 'listThings', method: 'get', path: '/things' };
const OPEN_ROW: MatrixRow = {
  route: { operationId: 'listThings', method: 'get', path: '/things', permission: 'public', tenancy: 'public', auth: ['anonymous'] },
  cells: [
    cell('none', 'allow', false, false),
    cell('CU_OWNER', 'allow', true, false),
    cell('refresh-cookie:unknown', 'allow', true, false),
    cell(STRIPE, 'allow', true, false),
  ],
};

interface Request {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly path: string;
}
type Bend = (request: Request) => boolean;

let sequence = 0;
/** The bend of the current test: answers the request itself (true) or lets the conformant fake answer (false). */
let bend: Bend = () => false;

/** A problem document as Express sends it: with the weak ETag of exactly this body (which carries the correlation id). */
function problem(
  res: ServerResponse,
  url: string,
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): void {
  sequence += 1;
  const body = JSON.stringify({
    type: 'about:blank',
    title: 'Unauthorized',
    status,
    code,
    instance: url,
    correlation_id: `corr-${String(sequence)}`,
    ...extra,
  });
  res.writeHead(status, {
    'content-type': 'application/problem+json',
    'cache-control': PRIVATE,
    'x-correlation-id': `corr-${String(sequence)}`,
    etag: weakBodyEtag(body),
    ...headers,
  });
  res.end(body);
}

function reached(res: ServerResponse, cacheControl: string): void {
  sequence += 1;
  res.writeHead(204, { [REACHED_HEADER]: REACHED_VALUE, 'cache-control': cacheControl, 'x-correlation-id': `corr-${String(sequence)}` });
  res.end();
}

function conformant({ req, res, path }: Request): void {
  const url = String(req.url);
  if (path === '/things') {
    reached(res, PUBLIC_CACHE_CONTROL);
    return;
  }
  if (path.startsWith('/orgs/')) {
    // SEC-TC-01 shape: the caller's own organisation is reached, any other is 404 before any data.
    if (path === `/orgs/${MATRIX_ORGS.CUSTOMER}`) reached(res, PRIVATE);
    else problem(res, url, 404, 'NOT_FOUND');
    return;
  }
  if (req.headers.authorization === 'Bearer rbac-matrix.CU_OWNER') reached(res, PRIVATE);
  else problem(res, url, 401, 'AUTH_REQUIRED');
}

function respond(req: IncomingMessage, res: ServerResponse): void {
  const request = { req, res, path: String(req.url).split('?')[0] ?? '' };
  if (!bend(request)) conformant(request);
}

let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer(respond);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', () => done()));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await closeLoopbackServer(server);
});

beforeEach(() => {
  bend = () => false;
});

const cookieOf = (req: IncomingMessage): string => req.headers.cookie ?? '';

describe('the RBAC matrix runner over a fake server (R1-m1, PR48-SEC-01)', () => {
  it('a conformant row passes although the volatile parts differ on every request (date, x-correlation-id, content-length, problem correlation_id)', async () => {
    expect([...VOLATILE_HEADERS].sort()).toEqual([
      'connection',
      'content-length',
      'date',
      'keep-alive',
      'transfer-encoding',
      'x-correlation-id',
    ]);
    expect(VOLATILE_PROBLEM_MEMBERS).toEqual(['correlation_id']);
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([]);
    expect(await runRow(origin, OPEN_TARGET, OPEN_ROW, CALLERS)).toEqual([]);
  });

  it('PR #60 R1-n4: the problem `instance` is compared (the same request path for the reference and every cell), so a foreign credential that changes it is named', async () => {
    bend = ({ req, res }) => {
      if (cookieOf(req) === '') return false;
      problem(res, String(req.url), 401, 'AUTH_REQUIRED', { instance: '/api/v1/session/refresh' });
      return true;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      "getThing x refresh-cookie:valid: a credential outside the route's set changed the response (body)",
      "getThing x refresh-cookie:unknown: a credential outside the route's set changed the response (body)",
    ]);
  });

  it('PR #60 R1-n2: repeated Set-Cookie headers are joined, so a clearing cookie added before the reference one (same last value) is named', async () => {
    bend = ({ req, res }) => {
      // Every response sets a consent cookie; the web refresh cookie also gets a clearing Set-Cookie before it.
      res.setHeader(
        'set-cookie',
        cookieOf(req).startsWith('__Host-rt_web=')
          ? ['__Host-rt_web=; Max-Age=0; Path=/; Secure; HttpOnly', 'consent=1; Path=/']
          : ['consent=1; Path=/'],
      );
      return false;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      "getThing x refresh-cookie:valid: a credential outside the route's set changed the response (header set-cookie)",
    ]);
  });

  it("a body-derived ETag (Express's weak hash of exactly the body) is volatile with the body; any other ETag a foreign credential adds is named", async () => {
    // The `etag` package's values for '' and 'hello world' (byte length in hex, first 27 base64 characters of the SHA-1).
    expect(weakBodyEtag('')).toBe('W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"');
    expect(weakBodyEtag('hello world')).toBe('W/"b-Kq5sNclPz7QV2+lfQIuc6R7oRu0"');
    bend = ({ req, res }) => {
      if (req.headers['x-quote-token'] === undefined) return false;
      problem(res, String(req.url), 401, 'AUTH_REQUIRED', {}, { etag: 'W/"quote-token-seen"' });
      return true;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      "getThing x quote-token:valid: a credential outside the route's set changed the response (header etag)",
    ]);
  });

  it('the unknown refresh cookie is the admin cookie, so both refresh cookie names are presented as foreign credentials (R1-n2)', async () => {
    const seen: string[] = [];
    bend = ({ req }) => {
      if (cookieOf(req) !== '') seen.push(cookieOf(req).split('=')[0] ?? '');
      return false;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([]);
    expect(seen).toEqual(['__Host-rt_web', '__Host-rt_admin']);
    expect([refreshCookieName(true), refreshCookieName(false)]).toEqual(['__Host-rt_web', '__Host-rt_admin']);
  });

  it('S1 a foreign refresh cookie that makes the route clear it (Set-Cookie) is named', async () => {
    bend = ({ req, res }) => {
      if (!cookieOf(req).startsWith('__Host-rt_web=')) return false;
      res.setHeader('set-cookie', '__Host-rt_web=; Max-Age=0; Path=/; Secure; HttpOnly');
      return false;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      "getThing x refresh-cookie:valid: a credential outside the route's set changed the response (header set-cookie)",
    ]);
  });

  it('S2 a foreign guest token that adds WWW-Authenticate (status unchanged) is named', async () => {
    bend = ({ req, res }) => {
      if (req.headers['x-quote-token'] === undefined) return false;
      res.setHeader('www-authenticate', 'Bearer error="invalid_token"');
      return false;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      "getThing x quote-token:valid: a credential outside the route's set changed the response (header www-authenticate)",
    ]);
  });

  it('S3 a foreign refresh cookie that changes the refusal body (status, code and Cache-Control unchanged) is named', async () => {
    bend = ({ req, res }) => {
      if (cookieOf(req) === '') return false;
      problem(res, String(req.url), 401, 'AUTH_REQUIRED', { detail: 'the refresh cookie was stale' });
      return true;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      "getThing x refresh-cookie:valid: a credential outside the route's set changed the response (body)",
      "getThing x refresh-cookie:unknown: a credential outside the route's set changed the response (body)",
    ]);
  });

  it('S4 a real stripe-signature header read on an [anonymous] route (401) is named in status, headers and body', async () => {
    bend = ({ req, res }) => {
      if (req.headers['stripe-signature'] !== 't=0,v1=0') return false;
      problem(res, String(req.url), 401, 'AUTH_REQUIRED');
      return true;
    };
    expect(await runRow(origin, OPEN_TARGET, OPEN_ROW, CALLERS)).toEqual([
      'listThings x signature-header:stripe-signature: expected allowed, got 401 AUTH_REQUIRED (Cache-Control "private, no-store")',
      'listThings x signature-header:stripe-signature: Cache-Control "private, no-store", expected not "private, no-store"',
      "listThings x signature-header:stripe-signature: a credential outside the route's set changed the response (status 204 -> 401, header cache-control, header content-type, header x-rbac-matrix, body)",
    ]);
  });

  it('Cache-Control: a foreign credential that marks the response private, and a private cell answered public, are named', async () => {
    bend = ({ req, res, path }) => {
      if (path === '/things' && req.headers.authorization !== undefined) {
        reached(res, PRIVATE);
        return true;
      }
      if (path !== '/things' && req.headers.authorization === 'Bearer rbac-matrix.CU_OWNER') {
        reached(res, PUBLIC_CACHE_CONTROL);
        return true;
      }
      return false;
    };
    expect(await runRow(origin, OPEN_TARGET, OPEN_ROW, CALLERS)).toEqual([
      'listThings x CU_OWNER: Cache-Control "private, no-store", expected not "private, no-store"',
      "listThings x CU_OWNER: a credential outside the route's set changed the response (header cache-control)",
    ]);
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      'getThing x CU_OWNER: Cache-Control "public, max-age=60", expected "private, no-store"',
    ]);
  });

  it('a refusal that reached the terminal, a refusal that is not a problem document and a malformed problem body are named', async () => {
    bend = ({ req, res }) => {
      if (req.headers.authorization === 'Bearer rbac-matrix.expired') {
        res.setHeader(REACHED_HEADER, REACHED_VALUE);
        problem(res, String(req.url), 401, 'AUTH_REQUIRED');
        return true;
      }
      if (req.headers['x-quote-token'] !== undefined) {
        res.writeHead(401, { 'content-type': 'application/json', 'cache-control': PRIVATE });
        res.end(JSON.stringify({ code: 'AUTH_REQUIRED' }));
        return true;
      }
      if (req.headers['stripe-signature'] !== undefined) {
        res.writeHead(401, { 'content-type': 'application/problem+json', 'cache-control': PRIVATE });
        res.end('not json');
        return true;
      }
      return false;
    };
    expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([
      'getThing x session:expired: expected 401 AUTH_REQUIRED, got 401 AUTH_REQUIRED (Cache-Control "private, no-store")',
      'getThing x quote-token:valid: expected 401 AUTH_REQUIRED, got 401 (Cache-Control "private, no-store")',
      "getThing x quote-token:valid: a credential outside the route's set changed the response (header content-type, body)",
      'getThing x signature-header:stripe-signature: expected 401 AUTH_REQUIRED, got 401 (Cache-Control "private, no-store")',
      'getThing x signature-header:stripe-signature: the problem+json body is not a JSON object',
      "getThing x signature-header:stripe-signature: a credential outside the route's set changed the response (body)",
    ]);
  });

  it('a cell naming a caller the matrix does not have is named, and the row goes on', async () => {
    const row: MatrixRow = { ...SESSION_ROW, cells: [cell('ghost', 'allow', false), ...SESSION_ROW.cells] };
    expect(await runRow(origin, SESSION_TARGET, row, CALLERS)).toEqual([
      'getThing x ghost: the cell names a caller the matrix does not have',
    ]);
  });
});

describe('observe(): per-request deadline and named transport errors (R1-m4)', () => {
  it('every request carries one AbortSignal.timeout of OBSERVE_DEADLINE_MS = 30 s (magnitude pinned by a spy, D-SEC-PR53-02)', async () => {
    expect(OBSERVE_DEADLINE_MS).toBe(30_000);
    const recorded = recordAbortTimeouts();
    try {
      expect(await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS)).toEqual([]);
    } finally {
      recorded.restore();
    }
    // The `none` reference plus one request per cell other than `none`.
    expect(recorded.calls).toEqual(Array.from({ length: SESSION_ROW.cells.length }, () => OBSERVE_DEADLINE_MS));
  });

  it('a request that gets no answer within the deadline rejects with a MatrixRequestError naming the cell and the timeout', async () => {
    bend = ({ path }) => path === '/hang'; // never answers
    const hang: MatrixTarget = { operationId: 'hangThing', method: 'get', path: '/hang' };
    const failure = observe(origin, hang, { id: 'none', kind: 'none' }, { deadlineMs: 50 });
    await expect(failure).rejects.toThrow(MatrixRequestError);
    await expect(failure).rejects.toThrow('hangThing x none: request failed: TimeoutError: The operation was aborted due to timeout');
    // The transport was aborted by observe's own signal (fetchOnce's abort path), not by fetchOnce's 60 s fallback
    // deadline: a signal that never reached the transport would reject later with FetchOnceTimeoutError.
    const cause = await failure.catch((error: unknown) => (error as { readonly cause?: unknown }).cause);
    expect(cause).toMatchObject({ message: expect.stringMatching(/^(?:fetchOnce: aborted|The operation was aborted due to timeout)$/u) });
    expect((cause as { readonly name?: unknown }).name).not.toBe('FetchOnceTimeoutError');
  });

  it('a reset connection ends its row with one problem naming the cell; the cells before it are still judged', async () => {
    bend = ({ req }) => {
      if (req.headers['x-quote-token'] === undefined) return false;
      req.socket.destroy();
      return true;
    };
    const problems = await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^getThing x quote-token:valid: request failed: Error ECONNRESET: [^\n]+ \(the row stopped after 5 of 7 cells\)$/u,
    );
  });

  it('a failing no-credential reference stops the row before any cell', async () => {
    bend = ({ req }) => {
      if (
        Object.keys(req.headers).some(
          (name) => name === 'authorization' || name === 'cookie' || name === 'x-quote-token' || name.endsWith('-signature'),
        )
      )
        return false;
      req.socket.destroy();
      return true;
    };
    const problems = await runRow(origin, SESSION_TARGET, SESSION_ROW, CALLERS);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^getThing x none: request failed: Error ECONNRESET: [^\n]+ \(the row stopped after 0 of 7 cells\)$/u);
  });
});

describe('[SEC-TC-01] runOrgCase: route reached with the own organisation, then 404 for the foreign one (PR48-SEC-05 item 1)', () => {
  const ORG_TARGET: MatrixTarget = { operationId: 'getOrg', method: 'get', path: '/orgs/:orgId' };
  const OWNER = CALLERS.get('CU_OWNER') as MatrixCaller;
  const origins = (): { matrix: string; orgScope: string } => ({ matrix: origin, orgScope: origin });

  it('a route that serves the own organisation and refuses the foreign one passes', async () => {
    expect(await runOrgCase(origins(), ORG_TARGET, OWNER)).toEqual([]);
  });

  it('a route that is not reached with the own organisation is named (a refusal of every orgId no longer passes)', async () => {
    bend = ({ req, res, path }) => {
      if (!path.startsWith('/orgs/')) return false;
      problem(res, String(req.url), 404, 'NOT_FOUND');
      return true;
    };
    expect(await runOrgCase(origins(), ORG_TARGET, OWNER)).toEqual([
      '[SEC-TC-01] getOrg x CU_OWNER -> own {orgId}: the route was not reached (expected 204 with x-rbac-matrix, got 404 NOT_FOUND (Cache-Control "private, no-store"))',
    ]);
  });

  it('a transport failure is one named problem', async () => {
    bend = ({ req }) => {
      req.socket.destroy();
      return true;
    };
    const problems = await runOrgCase(origins(), ORG_TARGET, OWNER);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^\[SEC-TC-01\] getOrg x CU_OWNER: request failed: Error ECONNRESET: /u);
  });
});
