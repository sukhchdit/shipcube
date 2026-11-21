/**
 * Idempotency keys through the production composition (US-038; REQ-API-009..011, DR-A20, NFR-RES-005; ADR-0014;
 * api/README §5; TASK-040): createApp with `defaultPipelineSlots({ tenantTx, capture, idempotency })`, the idempotency
 * slot (7a), the tx slot's claim / replay / completion / release, and the real `TenantDb` guard and `systemDelegates`
 * port over an in-memory `idempotency_keys` table with per-transaction undo (tests/memory-keys.ts). The audit capture
 * is a recording double (FAILED entries and in-transaction entries become events). The same statements on PostgreSQL
 * 18 are prisma/tests/idempotency/idempotency-keys.int.test.ts.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';

import { createApp } from '../../app.js';
import type { AuditCapture } from '../audit/capture.js';
import { defineRoute, type Principal, RouteReturnedError, type RouteDescriptor, type RouteSpec } from '../routing/define-route.js';
import { defaultPipelineSlots, type PipelineSlots } from '../routing/pipeline.js';
import { ANONYMOUS, markPrivateResponse, readonlySet, setPrincipal } from '../routing/route-state.js';
import { closeLoopbackServer, fetchOnce, LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import { createBodyCipher } from './body-cipher.js';
import { createIdempotencyStore, IDEMPOTENCY_TTL_MS, type IdempotencyStore } from './store.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { type KeyRow, type LogLine, MemoryKeys, memoryRunner, recordingLog, TEST_BODY_KEY, TEST_NETWORK_KEY } from './tests/memory-keys.js';

jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const ORG_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000a0';
const ORG_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000b0';
const USER_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const USER_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000b1';
/** A UUIDv4 idempotency key, generated per run (a literal key-shaped value is a secret-scanner finding, PR33-SEC-08). */
const KEY: string = randomUUID();

const keys = new MemoryKeys();
const events: string[] = [];
const runner = memoryRunner(keys, events);
const clock = { now: Date.UTC(2026, 10, 20, 12) };
const lines: LogLine[] = [];
const warnings = (): string[] => lines.filter((line) => line.level === 'warn').map((line) => line.event);
const base = createIdempotencyStore({
  cipher: createBodyCipher(TEST_BODY_KEY),
  networkKey: TEST_NETWORK_KEY,
  log: recordingLog(lines),
  now: () => clock.now,
});
/** The store, recording its completion and release calls in the event list. */
const store: IdempotencyStore = {
  ...base,
  begin: (db, input) => {
    events.push('claim');
    return base.begin(db, input);
  },
  // The origin is handed on (a slot-rendered problem replays through the problem handler, R3-M1).
  complete: (db, claim, result, origin) => {
    events.push(`complete ${String(result.status)}`);
    return base.complete(db, claim, result, origin);
  },
  release: (db, claim) => {
    events.push('release');
    return base.release(db, claim);
  },
  renew: (db, claim, leaseMs) => {
    events.push('renew');
    return base.renew(db, claim, leaseMs);
  },
};

const statusOf = (error: unknown): number =>
  error instanceof RouteReturnedError ? error.result.status : error instanceof AppError ? error.status : 500;
/** When set, the next fail-closed DOWNLOAD entry fails with 503 AUDIT_UNAVAILABLE (once). */
let failEntryOnce = false;
/** Recording capture: the in-transaction entry, the DOWNLOAD entry and the FAILED entry become events. */
const capture: AuditCapture = {
  mount: (mounted) => ({
    readOnlyHandler: mounted.audit.action === 'DOWNLOAD',
    inTransaction: (_ctx, result) => {
      events.push(`audit ${String(result.status)}`);
      return Promise.resolve();
    },
    afterCommit: (_request, result) => {
      if (mounted.audit.action !== 'DOWNLOAD') return Promise.resolve();
      if (failEntryOnce) {
        failEntryOnce = false;
        events.push('download-entry failed');
        return Promise.reject(new AppError('AUDIT_UNAVAILABLE'));
      }
      events.push(`download-entry ${String(result.status)}`);
      return Promise.resolve();
    },
    afterFailure: (_request, error) => {
      events.push(`failed-entry ${String(statusOf(error))}`);
      return Promise.resolve();
    },
  }),
  mountDenials: () => undefined,
  denied: () => Promise.resolve(),
};

const session = (actorId: string, orgId: string): Principal => ({
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId,
  orgId,
  actorScope: 'TENANT',
  permissions: readonlySet(['address_book:manage']),
});
const PRINCIPALS: Readonly<Record<string, Principal>> = { a: session(USER_A, ORG_A), b: session(USER_B, ORG_B) };
const signedIn: PipelineSlots['authenticate'] = () => (req: Request, res: Response, next: NextFunction) => {
  setPrincipal(res, PRINCIPALS[req.get('x-test-principal') ?? 'a'] ?? ANONYMOUS);
  markPrivateResponse(res);
  next();
};
/** Test seam for n6: `x-test-no-ip` makes the request's client IP empty (a misconfigured trust proxy). */
const noIp: PipelineSlots['etag'] = () => (req: Request, _res: Response, next: NextFunction) => {
  if (req.get('x-test-no-ip') === '1') Object.defineProperty(req, 'ip', { value: '' });
  next();
};
/** A route-class stand-in for the TASK-041 limiter (part 041-A not on main yet): 429 when the test asks for it. */
const limiter: PipelineSlots['rateLimit'] = () => (req: Request, _res: Response, next: NextFunction) => {
  next(req.get('x-test-limited') === '1' ? new AppError('RATE_LIMITED', { retryAfterSeconds: 1 }) : undefined);
};

const runs: string[] = [];
/** A gateway-client-secret-shaped value, built per run (no secret-shaped literal in the source, PR33-SEC-08). */
const intentSecret = ['pi', randomUUID().slice(0, 8), 'secret', randomUUID().slice(0, 8)].join('_');
let gate: Promise<void> | undefined;

const ROUTE = {
  permission: 'address_book:manage',
  rateLimit: 'authenticated',
  tenancy: 'tenant',
  auth: 'session',
  audit: { action: 'CREATE', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
  schema: { body: Joi.object({ qty: Joi.number().integer().required(), outcome: Joi.string() }) },
} as const;
const route = (spec: Partial<RouteSpec> & Pick<RouteSpec, 'operationId' | 'path' | 'idempotency' | 'handler'>): RouteDescriptor =>
  defineRoute({ ...ROUTE, method: 'post', ...spec } as RouteSpec);

const routes: RouteDescriptor[] = [
  route({
    operationId: 'createOrder',
    path: '/orders',
    idempotency: 'required',
    handler: async (ctx) => {
      const { qty, outcome } = ctx.input.body as { qty: number; outcome?: string };
      const id = `ord_${String(runs.length + 1)}`;
      runs.push(`${ctx.principal.actorId}:${id}`);
      if (outcome === 'hold' && gate !== undefined) await gate;
      switch (outcome) {
        case '409':
          return { status: 409, body: { code: 'CONFLICT', run: id } };
        case '422':
          return { status: 422, body: { code: 'UNPROCESSABLE', run: id } };
        case '429':
          return { status: 429, body: { code: 'RATE_LIMITED' } };
        case '500':
          return { status: 500, body: { code: 'INTERNAL_ERROR' } };
        case 'returned-problem-ext':
          // A route's own problem document with extension members (R3-M1): replayed as returned.
          return {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
            body: { type: 'https://docs.example.test/p/HOLD', title: 'On hold', status: 409, hold_id: id },
          };
        case 'returned-problem-code':
          return {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
            body: { type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT', run: id },
          };
        case 'throw':
          throw new AppError('CONFLICT');
        case 'throw-400':
          throw new AppError('VALIDATION_ERROR', {
            errors: [{ pointer: '/body/qty', code: 'OUT_OF_RANGE', message: 'Field is out of range.' }],
          });
        case 'throw-422':
          throw new AppError('ORG_TYPE_NOT_ALLOWED', { detail: 'Personal organisations cannot do this.' });
        case 'throw-429':
          throw new AppError('RATE_LIMITED', { retryAfterSeconds: 1 });
        case 'throw-500':
          throw new Error('handler bug');
        case 'throw-unserialisable':
          // PR040-SEC-09: a code defect, an errors[] item that JSON cannot serialise.
          throw new AppError('VALIDATION_ERROR', {
            errors: [{ pointer: '/body/qty', code: 'OUT_OF_RANGE', message: 'Field is out of range.', limit: 10n } as never],
          });
        case 'client-secret':
          // The gateway intent of checkoutOrder (PR040-SEC-03): its client secret is stored, encrypted only.
          return { status: 201, body: { id, payment_intent: { id: 'pi_1', client_secret: intentSecret } } };
        default:
          return { status: 201, body: { id, qty, actor: ctx.principal.actorId }, headers: { Location: `/api/v1/orders/${id}` } };
      }
    },
  }),
  route({
    operationId: 'createNote',
    path: '/notes',
    idempotency: 'optional',
    handler: () => {
      runs.push('note');
      return { status: 201, body: { id: `note_${String(runs.length)}` } };
    },
  }),
  route({
    operationId: 'emailAddressDocuments',
    path: '/docs/:addressId/email',
    idempotency: 'optional',
    audit: { action: 'DOWNLOAD', entity: 'address', sensitivity: 'SENSITIVE', reasonRequired: false },
    schema: { params: Joi.object({ addressId: Joi.string().required() }), body: Joi.object({ qty: Joi.number().integer().required() }) },
    handler: (ctx) => {
      runs.push('email');
      return { status: 202, body: { address: ctx.input.params['addressId'] } };
    },
  }),
  defineRoute<string, string>({
    ...ROUTE,
    method: 'post',
    operationId: 'shipOrder',
    path: '/orders/:addressId/ship',
    idempotency: 'required',
    schema: {
      params: Joi.object({ addressId: Joi.string().required() }),
      body: Joi.object({ qty: Joi.number().integer().required(), outcome: Joi.string() }),
    },
    load: (ctx) => {
      runs.push('load');
      if ((ctx.input.body as { outcome?: string }).outcome === 'stolen-in-load') {
        // Another request took the key over while load ran (its lease expired): the row moved on to a newer version.
        for (const row of keys.rows.values()) row.version += 5;
      }
      if ((ctx.input.body as { outcome?: string }).outcome === 'load-404') throw new AppError('NOT_FOUND');
      return 'loaded';
    },
    call: (ctx) => {
      runs.push('call');
      if ((ctx.input.body as { outcome?: string }).outcome === 'call-422') {
        throw new AppError('ORG_TYPE_NOT_ALLOWED', { detail: 'The carrier refused the shipment.' });
      }
      if ((ctx.input.body as { outcome?: string }).outcome === 'stolen') {
        // Another request took the key over (its lease expired): the row moved on to a newer version.
        for (const row of keys.rows.values()) row.version += 5;
      }
      return 'called';
    },
    handler: () => {
      runs.push('ship');
      return { status: 201, body: { shipped: true } };
    },
  }),
  fixtureRoute({
    operationId: 'recordConsent',
    method: 'post',
    path: '/consents',
    tenancy: 'guest',
    transaction: 'tenant',
    idempotency: 'optional',
    schema: { body: Joi.object({ qty: Joi.number().integer().required() }) },
    handler: () => {
      runs.push('consent');
      return { status: 201, body: { recorded: true } };
    },
  }),
  fixtureRoute({
    operationId: 'recordGuestOrder',
    method: 'post',
    path: '/guest-orders',
    tenancy: 'guest',
    transaction: 'tenant',
    idempotency: 'required',
    schema: { body: Joi.object({ qty: Joi.number().integer().required() }) },
    handler: () => {
      runs.push('guest-order');
      return { status: 201, body: { recorded: true } };
    },
  }),
  route({
    operationId: 'createQuote',
    path: '/quotes',
    idempotency: 'not-applicable',
    handler: () => {
      runs.push('quote');
      return { status: 201, body: { id: 'q', guest_token: 'one-time-secret-value' } };
    },
  }),
];

let server: Server;
let origin = '';

beforeAll(async () => {
  const app = createApp({
    health: [],
    modules: [{ name: 't', routes }],
    logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
    pipeline: {
      ...defaultPipelineSlots({ tenantTx: runner, capture, idempotency: store }),
      authenticate: signedIn,
      rateLimit: limiter,
      etag: noIp,
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await closeLoopbackServer(server);
});

beforeEach(() => {
  keys.rows.clear();
  keys.failNext = undefined;
  keys.statements.length = 0;
  events.length = 0;
  runs.length = 0;
  keys.phantomConflicts = 0;
  lines.length = 0;
  gate = undefined;
  failEntryOnce = false;
  clock.now = Date.UTC(2026, 10, 20, 12);
});

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
  /** The body exactly as received. */
  readonly text: string;
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const response = await fetchOnce(`${origin}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}
const withKey = (key = KEY, extra: Record<string, string> = {}): Record<string, string> => ({ 'idempotency-key': key, ...extra });

describe('[US-038] idempotency keys', () => {
  it('[AT-US-038-01] replay returns the stored status, body and Location with Idempotent-Replayed: true; no second effect or audit entry', async () => {
    const first = await post('/orders', { qty: 2 }, withKey());
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    const second = await post('/orders', { qty: 2 }, withKey());
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers.get('location')).toBe(first.headers.get('location'));
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.headers.get('cache-control')).toBe('private, no-store');
    expect(runs).toHaveLength(1);
    expect(events.filter((event) => event === 'audit 201')).toHaveLength(1);
    // The 2xx completion rides the handler transaction, before its audit flush (ADR-0014).
    expect(events).toEqual(['begin', 'claim', 'commit', 'begin', 'complete 201', 'audit 201', 'commit', 'begin', 'claim', 'commit']);
  });

  it('[AT-US-038-02] a booking route without Idempotency-Key is 400 IDEMPOTENCY_KEY_REQUIRED and runs nothing', async () => {
    const answer = await post('/orders', { qty: 1 });
    expect(answer.status).toBe(400);
    expect(answer.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(runs).toEqual([]);
    expect(events).toEqual([]);
  });

  it('[AT-US-038-03] a key of 256 characters or with a control character is 400 VALIDATION_ERROR', async () => {
    for (const key of ['k'.repeat(256), 'abc\tdef']) {
      const answer = await post('/orders', { qty: 1 }, withKey(key));
      expect(answer.status).toBe(400);
      expect(answer.body['code']).toBe('VALIDATION_ERROR');
      expect(answer.body['errors']).toEqual([expect.objectContaining({ pointer: '/headers/idempotency-key' })]);
    }
    expect(runs).toEqual([]);
  });

  it('[AT-US-038-04] the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    expect((await post('/orders', { qty: 1 }, withKey())).status).toBe(201);
    const reused = await post('/orders', { qty: 9 }, withKey());
    expect(reused.status).toBe(422);
    expect(reused.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(runs).toHaveLength(1);
  });

  it('[AT-US-038-05] a duplicate while the first request runs is 409 IDEMPOTENCY_IN_PROGRESS with Retry-After 1', async () => {
    let open: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = post('/orders', { qty: 1, outcome: 'hold' }, withKey());
    for (let tries = 0; runs.length === 0 && tries < 200; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const duplicate = await post('/orders', { qty: 1, outcome: 'hold' }, withKey());
    expect(duplicate.status).toBe(409);
    expect(duplicate.body['code']).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(duplicate.headers.get('retry-after')).toBe('1');
    open();
    expect((await first).status).toBe(201);
    expect(runs).toHaveLength(1);
  });

  it('[AT-US-038-06] a returned 500 is not stored: the retry executes again (the handler runs twice)', async () => {
    expect((await post('/orders', { qty: 1, outcome: '500' }, withKey())).status).toBe(500);
    expect(keys.rows.size).toBe(0);
    expect((await post('/orders', { qty: 1, outcome: '500' }, withKey())).status).toBe(500);
    expect(runs).toHaveLength(2);
    expect(events.filter((event) => event === 'release')).toHaveLength(2);
  });

  it('[AT-US-038-06] rate limits are not stored: a 429 of the limiter claims nothing, a returned 429 releases the key', async () => {
    const limited = await post('/orders', { qty: 1 }, withKey(KEY, { 'x-test-limited': '1' }));
    expect(limited.status).toBe(429);
    expect(keys.rows.size).toBe(0);
    expect((await post('/orders', { qty: 1, outcome: '429' }, withKey())).status).toBe(429);
    expect(keys.rows.size).toBe(0);
    expect((await post('/orders', { qty: 1, outcome: '429' }, withKey())).status).toBe(429);
    expect(runs).toHaveLength(2);
  });

  it('[AT-US-038-07] a returned 422 is replayed with Idempotent-Replayed true; completed after the FAILED entry', async () => {
    const first = await post('/orders', { qty: 1, outcome: '422' }, withKey());
    expect(first.status).toBe(422);
    const replay = await post('/orders', { qty: 1, outcome: '422' }, withKey());
    expect(replay.status).toBe(422);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(runs).toHaveLength(1);
    // Rolled-back handler transaction, then the FAILED entry, then the completion in its own transaction (D-ARCH-143).
    expect(events.slice(0, 9)).toEqual([
      'begin',
      'claim',
      'commit',
      'begin',
      'rollback',
      'failed-entry 422',
      'begin',
      'complete 422',
      'commit',
    ]);
  });

  it('[D-ARCH-143] a returned 409 replayed with the same key answers the stored 409 and the handler ran once', async () => {
    const first = await post('/orders', { qty: 1, outcome: '409' }, withKey());
    const replay = await post('/orders', { qty: 1, outcome: '409' }, withKey());
    expect([first.status, replay.status]).toEqual([409, 409]);
    expect(replay.body).toEqual(first.body);
    expect(runs).toHaveLength(1);
    expect(events.indexOf('failed-entry 409')).toBeLessThan(events.indexOf('complete 409'));
  });

  it('[D-ARCH-143] a failed completion write answers the original status and leaves no row and no stuck key', async () => {
    keys.failNext = 'updateMany';
    const first = await post('/orders', { qty: 1, outcome: '422' }, withKey());
    expect(first.status).toBe(422);
    expect(keys.rows.size).toBe(0);
    expect(warnings()).toEqual(['api.idempotency_completion_failed']);
    const retry = await post('/orders', { qty: 1, outcome: '422' }, withKey());
    expect(retry.status).toBe(422);
    expect(retry.headers.get('idempotent-replayed')).toBeNull();
    expect(runs).toHaveLength(2);
  });

  it('[AT-US-038-07] [D-ARCH-195] a thrown 409 and a thrown 422 are replayed byte for byte; the handler ran once', async () => {
    for (const [outcome, status, key] of [
      ['throw', 409, 'k-409'],
      ['throw-422', 422, 'k-422'],
      ['throw-400', 400, 'k-400'],
    ] as const) {
      const first = await post('/orders', { qty: 1, outcome }, withKey(key));
      const replay = await post('/orders', { qty: 1, outcome }, withKey(key));
      expect([first.status, replay.status]).toEqual([status, status]);
      // The stored document as sent, rendered once: the first request's correlation_id included.
      expect(replay.text).toBe(first.text);
      expect(replay.body['correlation_id']).toBe(first.headers.get('x-correlation-id'));
      expect(replay.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
      expect(replay.headers.get('idempotent-replayed')).toBe('true');
      expect(first.headers.get('idempotent-replayed')).toBeNull();
      // The replay carries its own X-Correlation-Id header.
      expect(replay.headers.get('x-correlation-id')).not.toBe(first.headers.get('x-correlation-id'));
    }
    expect(runs).toHaveLength(3);
    // Order after the rollback: the FAILED entry, then the completion, then the response.
    expect(events.indexOf('failed-entry 409')).toBeLessThan(events.indexOf('complete 409'));
  });

  it('[R3-M1] a RETURNED application/problem+json 409 (extension members, or a catalogue code) is replayed as returned', async () => {
    for (const [outcome, key] of [
      ['returned-problem-ext', 'k-ext'],
      ['returned-problem-code', 'k-code'],
    ] as const) {
      const first = await post('/orders', { qty: 1, outcome }, withKey(key));
      const replay = await post('/orders', { qty: 1, outcome }, withKey(key));
      expect([first.status, replay.status]).toEqual([409, 409]);
      expect(replay.text).toBe(first.text);
      expect(replay.headers.get('content-type')).toBe(first.headers.get('content-type'));
      expect(replay.headers.get('idempotent-replayed')).toBe('true');
    }
    expect(runs).toHaveLength(2);
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
  });

  it('[AT-US-038-07] [D-ARCH-195] a 4xx thrown in load and one thrown in call are replayed; call ran once', async () => {
    const load1 = await post('/orders/o-9/ship', { qty: 1, outcome: 'load-404' }, withKey('k-load'));
    const load2 = await post('/orders/o-9/ship', { qty: 1, outcome: 'load-404' }, withKey('k-load'));
    expect([load1.status, load2.status]).toEqual([404, 404]);
    expect(load2.text).toBe(load1.text);
    const call1 = await post('/orders/o-9/ship', { qty: 1, outcome: 'call-422' }, withKey('k-call'));
    const call2 = await post('/orders/o-9/ship', { qty: 1, outcome: 'call-422' }, withKey('k-call'));
    expect([call1.status, call2.status]).toEqual([422, 422]);
    expect(call2.text).toBe(call1.text);
    expect(call2.headers.get('idempotent-replayed')).toBe('true');
    expect(runs.filter((run) => run === 'call')).toHaveLength(1);
    expect(runs).toEqual(['load', 'load', 'call']);
  });

  it('[AT-US-038-06] [M2] a thrown 429 or a thrown 5xx is not stored: the retry executes again', async () => {
    for (const [outcome, status, key] of [
      ['throw-429', 429, 'k-429'],
      ['throw-500', 500, 'k-500'],
    ] as const) {
      expect((await post('/orders', { qty: 1, outcome }, withKey(key))).status).toBe(status);
      expect((await post('/orders', { qty: 1, outcome }, withKey(key))).status).toBe(status);
    }
    expect(runs).toHaveLength(4);
    expect(keys.rows.size).toBe(0);
  });

  it('[M1] a read-only (DOWNLOAD) idempotent route completes its key after the fail-closed entry', async () => {
    const first = await post('/docs/d-1/email', { qty: 1 }, withKey());
    expect(first.status).toBe(202);
    expect(events.indexOf('download-entry 202')).toBeLessThan(events.indexOf('complete 202'));
    const replay = await post('/docs/d-1/email', { qty: 1 }, withKey());
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(runs).toEqual(['email']);
  });

  it('[M1] a failed DOWNLOAD entry answers 503 AUDIT_UNAVAILABLE, releases the key, and the retry runs and writes the entry', async () => {
    failEntryOnce = true;
    const first = await post('/docs/d-2/email', { qty: 1 }, withKey());
    expect(first.status).toBe(503);
    expect(first.body['code']).toBe('AUDIT_UNAVAILABLE');
    expect(keys.rows.size).toBe(0);
    expect(events).not.toContain('complete 202');
    const retry = await post('/docs/d-2/email', { qty: 1 }, withKey());
    expect(retry.status).toBe(202);
    expect(retry.headers.get('idempotent-replayed')).toBeNull();
    expect(runs).toEqual(['email', 'email']);
    expect(events).toContain('download-entry 202');
  });

  it('[m4] the lease is renewed before call and before the handler transaction', async () => {
    const answer = await post('/orders/o-1/ship', { qty: 1 }, withKey());
    expect(answer.status).toBe(201);
    expect(runs).toEqual(['load', 'call', 'ship']);
    expect(events.filter((event) => event === 'renew')).toHaveLength(2);
    expect(events.indexOf('renew')).toBeLessThan(events.indexOf('complete 201'));
  });

  it('[m4] [D-PM-084] a key taken over during call answers 409 before the handler, with one FAILED entry and one WARN', async () => {
    const answer = await post('/orders/o-2/ship', { qty: 1, outcome: 'stolen' }, withKey());
    expect(answer.status).toBe(409);
    expect(answer.body['code']).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(runs).toEqual(['load', 'call']);
    // call ran (an external effect happened): exactly one FAILED entry (D-PM-084).
    expect(events.filter((event) => event.startsWith('failed-entry'))).toEqual(['failed-entry 409']);
    const correlationId = answer.headers.get('x-correlation-id');
    expect(lines.filter((line) => line.event === 'api.idempotency_claim_lost')).toEqual([
      { level: 'warn', event: 'api.idempotency_claim_lost', fields: { phase: 'before-handler', correlation_id: correlationId } },
    ]);
    expect(JSON.stringify(lines)).not.toContain(KEY);
    expect(keys.rows.size).toBe(1);
  });

  it('[m4] [D-PM-081] a key taken over before call answers 409 without running call, with no audit entry and one WARN', async () => {
    const answer = await post('/orders/o-4/ship', { qty: 1, outcome: 'stolen-in-load' }, withKey());
    expect(answer.status).toBe(409);
    expect(answer.body['code']).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(runs).toEqual(['load']);
    expect(events.filter((event) => event.startsWith('failed-entry'))).toEqual([]);
    expect(lines.filter((line) => line.event === 'api.idempotency_claim_lost')).toEqual([
      {
        level: 'warn',
        event: 'api.idempotency_claim_lost',
        fields: { phase: 'before-call', correlation_id: answer.headers.get('x-correlation-id') },
      },
    ]);
  });

  it('[n3] the scope uses the normalised path: a trailing slash or another percent-encoding of the same id replays', async () => {
    const first = await post('/orders/o-3/ship', { qty: 1 }, withKey());
    const replay = await post('/orders/%6F-3/ship/', { qty: 1 }, withKey());
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
  });

  it('[m5] a failed release still answers the original status and logs api.idempotency_release_failed; the lease frees the key', async () => {
    keys.failNext = 'deleteMany';
    expect((await post('/orders', { qty: 1, outcome: '500' }, withKey())).status).toBe(500);
    expect(warnings()).toEqual(['api.idempotency_release_failed']);
    expect([...keys.rows.values()].map((row) => row.status)).toEqual(['IN_PROGRESS']);
    expect((await post('/orders', { qty: 1, outcome: '500' }, withKey())).status).toBe(409);
    clock.now += 10 * 60_000;
    expect((await post('/orders', { qty: 1, outcome: '500' }, withKey())).status).toBe(500);
    expect(runs).toHaveLength(2);
  });

  it('[D-PM-081 (a)] 409 IN_PROGRESS and 422 KEY_REUSED write no audit entry; each logs its code and correlation id, never the key', async () => {
    let open: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = post('/orders', { qty: 1, outcome: 'hold' }, withKey());
    for (let tries = 0; runs.length === 0 && tries < 200; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const auditBefore = events.filter((event) => event.startsWith('audit') || event.startsWith('failed-entry')).length;
    const busy = await post('/orders', { qty: 1, outcome: 'hold' }, withKey());
    open();
    await first;
    const reused = await post('/orders', { qty: 2 }, withKey());
    expect([busy.status, reused.status]).toEqual([409, 422]);
    expect(events.filter((event) => event.startsWith('failed-entry'))).toEqual([]);
    expect(events.filter((event) => event.startsWith('audit') || event.startsWith('failed-entry'))).toHaveLength(auditBefore + 1);
    const conflicts = lines.filter((line) => line.event === 'api.idempotency_conflict');
    expect(conflicts).toEqual([
      {
        level: 'info',
        event: 'api.idempotency_conflict',
        fields: { code: 'IDEMPOTENCY_IN_PROGRESS', correlation_id: busy.headers.get('x-correlation-id') },
      },
      {
        level: 'info',
        event: 'api.idempotency_conflict',
        fields: { code: 'IDEMPOTENCY_KEY_REUSED', correlation_id: reused.headers.get('x-correlation-id') },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  it('[D-PM-081 (b)] a retry whose stored response cannot be read answers 500 with an ERROR event carrying no key or body', async () => {
    expect((await post('/orders', { qty: 7 }, withKey())).status).toBe(201);
    for (const row of keys.rows.values()) row.responseBodyKeyId = 'idempotency-body-v9';
    const retry = await post('/orders', { qty: 7 }, withKey());
    expect(retry.status).toBe(500);
    expect(lines.filter((line) => line.level === 'error')).toEqual([
      {
        level: 'error',
        event: 'api.idempotency_replay_unreadable',
        fields: { error: 'IdempotencyReplayError', reason: 'unknown body key id' },
      },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(new RegExp(`${KEY}|ord_1|qty`, 'u'));
    expect(events.filter((event) => event.startsWith('failed-entry'))).toEqual([]);
  });

  it('[D-PM-081 (c)] a claim that fails on a new request answers 500 and writes exactly one FAILED entry', async () => {
    keys.failNext = 'createManyAndReturn';
    expect((await post('/orders', { qty: 1 }, withKey())).status).toBe(500);
    expect(events.filter((event) => event.startsWith('failed-entry'))).toEqual(['failed-entry 500']);
    expect(runs).toEqual([]);
  });

  it('[n6] an anonymous caller without a client IP: an optional route runs without idempotency, a required one answers 503', async () => {
    const anonymous = { 'x-test-principal': 'anonymous', 'x-test-no-ip': '1' };
    expect((await post('/consents', { qty: 1 }, withKey(KEY, anonymous))).status).toBe(201);
    expect((await post('/consents', { qty: 1 }, withKey(KEY, anonymous))).status).toBe(201);
    expect(keys.rows.size).toBe(0);
    const required = await post('/guest-orders', { qty: 1 }, withKey(KEY, anonymous));
    expect(required.status).toBe(503);
    expect(events.filter((event) => event.startsWith('failed-entry'))).toEqual(['failed-entry 503']);
    expect(warnings()).toEqual([
      'api.idempotency_scope_unavailable',
      'api.idempotency_scope_unavailable',
      'api.idempotency_scope_unavailable',
    ]);
    expect(runs).toEqual(['consent', 'consent']);
    // With a client IP the anonymous caller is scoped by its network and replayed.
    const scoped = { 'x-test-principal': 'anonymous' };
    await post('/consents', { qty: 1 }, withKey('net-key', scoped));
    const replay = await post('/consents', { qty: 1 }, withKey('net-key', scoped));
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
  });

  it('[AT-US-038-08] user B of another org with the same key value on the same path executes independently', async () => {
    const a = await post('/orders', { qty: 1 }, withKey());
    const b = await post('/orders', { qty: 1 }, withKey(KEY, { 'x-test-principal': 'b' }));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers.get('idempotent-replayed')).toBeNull();
    expect(b.body['actor']).toBe(USER_B);
    expect(b.body['id']).not.toBe(a.body['id']);
    const replayA = await post('/orders', { qty: 1 }, withKey());
    expect(replayA.body).toEqual(a.body);
    expect(keys.rows.size).toBe(2);
  });

  it('[AT-US-038-09] a key stored 24 h and 1 s ago is processed as new', async () => {
    expect((await post('/orders', { qty: 1 }, withKey())).status).toBe(201);
    clock.now += IDEMPOTENCY_TTL_MS + 1_000;
    try {
      const later = await post('/orders', { qty: 5 }, withKey());
      expect(later.status).toBe(201);
      expect(later.headers.get('idempotent-replayed')).toBeNull();
      expect(runs).toHaveLength(2);
    } finally {
      clock.now -= IDEMPOTENCY_TTL_MS + 1_000;
    }
  });

  it('an optional route without a key runs every time and stores nothing; with a key it is replayed', async () => {
    await post('/notes', { qty: 1 });
    await post('/notes', { qty: 1 });
    expect(keys.rows.size).toBe(0);
    const first = await post('/notes', { qty: 1 }, withKey());
    const replay = await post('/notes', { qty: 1 }, withKey());
    expect(replay.body).toEqual(first.body);
    expect(runs).toEqual(['note', 'note', 'note']);
  });

  it('[SEC-TC-04] a not-applicable one-time-secret route (createQuote) never creates a row, even when a key is sent', async () => {
    const first = await post('/quotes', { qty: 1 }, withKey());
    const second = await post('/quotes', { qty: 1 }, withKey());
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.headers.get('idempotent-replayed')).toBeNull();
    expect(keys.rows.size).toBe(0);
    expect(keys.statements).toEqual([]);
    expect(runs).toEqual(['quote', 'quote']);
  });

  it('[SEC-TC-04] the stored body of a completed key is ciphertext with its key id', async () => {
    await post('/orders', { qty: 3 }, withKey());
    const [row] = [...keys.rows.values()];
    expect(row?.responseBodyKeyId).toBe('idempotency-body-v1');
    const stored = Buffer.from(row?.responseBody ?? new Uint8Array()).toString('latin1');
    expect(stored.includes(USER_A)).toBe(false);
    expect(stored.includes('ord_')).toBe(false);
  });

  it('[SEC-TC-04] [PR040-SEC-03] a stored gateway client secret is replayed, and no clear column holds a client-secret shape', async () => {
    const first = await post('/orders', { qty: 1, outcome: 'client-secret' }, withKey());
    const replay = await post('/orders', { qty: 1, outcome: 'client-secret' }, withKey());
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.text).toBe(first.text);
    expect(replay.text).toContain(intentSecret);
    expect(runs).toHaveLength(1);
    const [row] = [...keys.rows.values()];
    if (row === undefined) throw new Error('no row');
    const { responseBody, ...clear } = row;
    const clearText = JSON.stringify(clear, (_name, value: unknown) =>
      value instanceof Uint8Array ? Buffer.from(value).toString('latin1') : value,
    );
    expect(clearText).not.toMatch(/_secret_/u);
    expect(clearText).not.toContain(intentSecret);
    expect(Buffer.from(responseBody ?? new Uint8Array()).toString('latin1')).not.toContain(intentSecret);
  });

  it('[PR040-SEC-02] a clear status or Location changed by a database writer is never replayed: 500, the handler not run again', async () => {
    const tampers: ReadonlyArray<readonly [string, (row: KeyRow) => void]> = [
      ['k-status', (row) => (row.responseStatus = 409)],
      ['k-location', (row) => (row.responseHeaders = { Location: 'https://attacker.example.test/' })],
    ];
    for (const [key, tamper] of tampers) {
      expect((await post('/orders', { qty: 1 }, withKey(key))).status).toBe(201);
      for (const row of keys.rows.values()) if (row.idemKey === key) tamper(row);
      const retry = await post('/orders', { qty: 1 }, withKey(key));
      expect(retry.status).toBe(500);
      expect(retry.headers.get('location')).toBeNull();
      expect(retry.headers.get('idempotent-replayed')).toBeNull();
    }
    expect(runs).toHaveLength(2);
    expect(lines.filter((line) => line.level === 'error').map((line) => line.fields?.['reason'])).toEqual([
      'stored response mismatch',
      'stored response mismatch',
    ]);
  });

  it('[PR040-SEC-09] a thrown 4xx whose document cannot be rendered releases the key: no row, the retry runs again', async () => {
    const first = await post('/orders', { qty: 1, outcome: 'throw-unserialisable' }, withKey());
    expect(first.status).toBe(500);
    expect(keys.rows.size).toBe(0);
    expect(events).toContain('release');
    expect(lines.filter((line) => line.event === 'api.idempotency_problem_unrendered')).toEqual([
      { level: 'warn', event: 'api.idempotency_problem_unrendered', fields: { error: 'TypeError' } },
    ]);
    // Not held until the lease ends: the retry executes at once instead of answering 409 IDEMPOTENCY_IN_PROGRESS.
    const retry = await post('/orders', { qty: 1, outcome: 'throw-unserialisable' }, withKey());
    expect(retry.status).toBe(500);
    expect(runs).toHaveLength(2);
  });
});
