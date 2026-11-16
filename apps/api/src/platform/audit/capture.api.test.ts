/**
 * Descriptor-driven audit capture through the REAL composition (US-086; AT-US-008-03 audit hop; REQ-AUDIT-004/005/010;
 * D-ARCH-106, D-ARCH-122; PR42-SEC-15; TASK-029): createApp, the pipeline slots, the real `withTenantTx` with its
 * TenantDb guard and admission bulkhead, the real writer composed from the configuration, over a fake transaction client
 * that keeps the statements of a transaction only when it commits. The store and the tokeniser are doubles that write
 * their work as statements into the handed transaction, so "exists" means "committed".
 *
 * The database side of the same flows (real statements, held head rows, chained hashes) is
 * prisma/tests/audit/audit-capture-flush.int.test.ts.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AuditRowDraft, AuditStore, PiiTokeniser, PiiValue } from '@platform/audit';
import { toAuditWriteError } from '@platform/audit';
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';

import { createApp } from '../../app.js';
import { createWithTenantTx } from '../db/with-tenant-tx.js';
import { healthRoutes } from '../health/router.js';
import { defineRoute, type Principal, type RouteDescriptor, type RouteSpec } from '../routing/define-route.js';
import { defaultPipelineSlots, type PipelineSlots } from '../routing/pipeline.js';
import { ANONYMOUS, markPrivateResponse, readonlySet, setPrincipal } from '../routing/route-state.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import { createAuditCapture } from '../tx/execute.js';

jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000b2';
const SHIPPER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const VIEWER = '0193a5b2-7c1e-7d4a-9f3b-0000000000a2';

/** The context statement's setter name, assembled (the tenant-context lint reads test literals too). */
const CONTEXT_SETTER = ['set', 'config'].join('_');

interface Statement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A transaction: answers the context statement with a clean session; logs every other statement. */
class FakeTx {
  readonly log: Statement[] = [];
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    const sql = strings.join('?');
    if (!sql.includes(CONTEXT_SETTER)) this.log.push({ sql, values });
    return Promise.resolve([{ org_id: null, actor_id: null, actor_scope: null, guest_token_hash: null }] as T);
  }
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    this.log.push({ sql: strings.join('?'), values });
    return Promise.resolve(1);
  }
}

/** Committed transactions, each as its statement list, and the number rolled back. */
const committed: Statement[][] = [];
let rolledBack = 0;
const client = {
  async $transaction<R>(fn: (tx: FakeTx) => Promise<R>): Promise<R> {
    const tx = new FakeTx();
    try {
      const result = await fn(tx);
      committed.push(tx.log);
      return result;
    } catch (error) {
      rolledBack += 1;
      throw error;
    }
  },
  $queryRaw: <T>(): Promise<T> => Promise.resolve([] as T),
};

function runnerWith(admission?: { maxConcurrentTx: number; waitMs: number }) {
  return createWithTenantTx(
    client,
    {
      statementTimeoutMs: 5_000,
      lockTimeoutMs: 2_000,
      idleInTransactionTimeoutMs: 15_000,
      poolConnectionTimeoutMs: 5_000,
      ...(admission === undefined ? {} : { admission }),
    },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      scopeClient: () => client,
      env: {},
    },
  );
}

/** Store double: appends by writing one statement into the handed transaction; optionally gated or failing. */
let storeFailure: Error | undefined;
let storeGate: Promise<void> | undefined;
const store: AuditStore = {
  appendBatch: async (db, rows) => {
    if (storeGate !== undefined) await storeGate;
    if (storeFailure !== undefined) throw storeFailure;
    await db.$executeRaw`AUDIT APPEND ${rows}`;
    return rows.map((row, index) => ({
      id: row.id,
      streamId: row.streamId,
      streamSeq: index + 1,
      occurredAt: '',
      prevHash: '',
      entryHash: '',
    }));
  },
  insertVaultRows: () => Promise.reject(new Error('not used')),
};
const tokenised: PiiValue[] = [];
const tokeniser: PiiTokeniser = {
  tokenise: async (db, values) => {
    await db.$executeRaw`AUDIT VAULT ${values.length}`;
    tokenised.push(...values);
    return values.map(() => randomUUID());
  },
};
const parseUserAgent = (ua: string): string => (ua.startsWith('Mozilla/5.0') ? 'Firefox 146 / Windows' : `raw;${ua}`);

const isAudit = (statement: Statement): boolean => statement.sql.startsWith('AUDIT ');
const entries = (): AuditRowDraft[] =>
  committed.flat().flatMap((statement) => (statement.sql.startsWith('AUDIT APPEND') ? (statement.values[0] as AuditRowDraft[]) : []));
const businessRows = (): unknown[] =>
  committed.flat().flatMap((statement) => (statement.sql.startsWith('INSERT INTO business') ? [statement.values[0]] : []));

let principal: Principal = ANONYMOUS;
const session = (actorId: string, permissions: readonly string[]): Principal => ({
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId,
  orgId: ORG,
  actorScope: 'TENANT',
  permissions: readonlySet(permissions),
});
const signedIn: PipelineSlots['authenticate'] = () => (_req: Request, res: Response, next: NextFunction) => {
  setPrincipal(res, principal);
  if (principal.authenticated) markPrivateResponse(res);
  next();
};

const ADDRESS_ROUTE = {
  permission: 'address_book:manage',
  schema: {},
  rateLimit: 'authenticated',
  idempotency: 'not-applicable',
  tenancy: 'tenant',
  auth: 'session',
} as const;

const route = (spec: Partial<RouteSpec> & Pick<RouteSpec, 'operationId' | 'method' | 'path' | 'audit' | 'handler'>): RouteDescriptor =>
  defineRoute({ ...ADDRESS_ROUTE, ...spec } as RouteSpec);

const insertBusiness = async (db: unknown, id: string): Promise<void> => {
  await (db as FakeTx).$executeRaw`INSERT INTO business ${id}`;
};

/** The feature routes: they do business work only; none imports the audit writer (AT-US-086-01). */
const routes: RouteDescriptor[] = [
  route({
    operationId: 'createAddress',
    method: 'post',
    path: '/address-book',
    audit: { action: 'CREATE', entity: 'address', sensitivity: 'SENSITIVE', reasonRequired: false },
    schema: { body: Joi.object({ city: Joi.string().required() }) },
    handler: async (ctx) => {
      const id = randomUUID();
      await insertBusiness(ctx.db, id);
      return { status: 201, body: { id, city: (ctx.input.body as { city: string }).city } };
    },
  }),
  route({
    operationId: 'updateAddress',
    method: 'patch',
    path: '/address-book/:addressId',
    audit: { action: 'UPDATE', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
    schema: { params: Joi.object({ addressId: Joi.string().required() }), body: Joi.object({ city: Joi.string().required() }) },
    handler: async (ctx) => {
      await insertBusiness(ctx.db, String(ctx.input.params['addressId']));
      throw new AppError('CONFLICT');
    },
  }),
  route({
    operationId: 'listAddresses',
    method: 'get',
    path: '/address-book',
    permission: 'address_book:read',
    audit: { action: 'VIEW', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
    schema: { query: Joi.object({ city: Joi.string() }) },
    handler: () => ({ status: 200, body: { data: Array.from({ length: 37 }, (_value, index) => ({ id: String(index) })) } }),
  }),
  route({
    operationId: 'getAddress',
    method: 'get',
    path: '/address-book/:addressId',
    permission: 'address_book:read',
    audit: { action: 'VIEW', entity: 'address', sensitivity: 'SENSITIVE', reasonRequired: false },
    schema: { params: Joi.object({ addressId: Joi.string().required() }) },
    handler: (ctx) =>
      ctx.input.params['addressId'] === 'missing'
        ? { status: 404, body: { code: 'NOT_FOUND' } }
        : { status: 200, body: { id: ctx.input.params['addressId'], city: 'Pune' } },
  }),
  route({
    operationId: 'deleteAddress',
    method: 'delete',
    path: '/address-book/:addressId',
    audit: { action: 'DELETE', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
    schema: { params: Joi.object({ addressId: Joi.string().required() }) },
    // returned, not thrown: 409 commits as a FAILED entry in the same transaction, 404 commits nothing worth an entry
    handler: (ctx) => ({ status: ctx.input.params['addressId'] === 'locked' ? 409 : 404, body: { code: 'X' } }),
  }),
  route({
    operationId: 'verifyAddress',
    method: 'post',
    path: '/address-book/:addressId/verify',
    audit: { action: 'UPDATE', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
    schema: { params: Joi.object({ addressId: Joi.string().required() }) },
    handler: async (ctx) => {
      await insertBusiness(ctx.db, String(ctx.input.params['addressId']));
      throw new Error('unexpected');
    },
  }),
  defineRoute<string, string>({
    ...ADDRESS_ROUTE,
    operationId: 'importAddress',
    method: 'put',
    path: '/address-book/:addressId/import',
    audit: { action: 'UPDATE', entity: 'address', sensitivity: 'NORMAL', reasonRequired: false },
    schema: { params: Joi.object({ addressId: Joi.string().required() }) },
    load: async (ctx) => {
      await (ctx.db as FakeTx).$queryRaw`SELECT before image`;
      if (ctx.input.params['addressId'] === 'stale') throw new AppError('CONFLICT');
      return 'loaded';
    },
    call: (ctx) => {
      if (ctx.input.params['addressId'] === 'carrier-down') throw new Error('carrier unreachable');
      return 'called';
    },
    handler: async (ctx) => {
      await insertBusiness(ctx.db, String(ctx.input.params['addressId']));
      return { status: 200, body: { ok: true } };
    },
  }),
  // REQ-AUDIT-006 closed-list routes (AT-US-086-06): NONE, never an entry.
  ...(
    [
      ['listCountries', 'get', '/reference/countries'],
      ['getCsrfToken', 'get', '/auth/csrf'],
      ['reportCspViolation', 'post', '/security/csp-report'],
      ['calculateVolumetricWeight', 'get', '/reference/volumetric'],
    ] as const
  ).map(([operationId, method, path]) =>
    fixtureRoute({ operationId, method, path, transaction: 'tenant', handler: () => ({ status: 204 }) }),
  ),
];

let server: Server;
let base: string;
let runner = runnerWith();

function compose(admission?: { maxConcurrentTx: number; waitMs: number }) {
  runner = runnerWith(admission);
  const capture = createAuditCapture({
    config: { DB_AUDIT_LOCK_TIMEOUT_MS: 250 },
    tenantTx: runner,
    writer: { store, tokeniser },
    parseUserAgent,
  });
  return createApp({
    health: healthRoutes({ probe: { readiness: () => Promise.reject(new Error('not probed')) } } as never),
    modules: [{ name: 'addresses', routes }],
    tenantTx: runner,
    logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
    pipeline: { ...defaultPipelineSlots({ tenantTx: runner, capture }), authenticate: signedIn },
  });
}

async function listen(admission?: { maxConcurrentTx: number; waitMs: number }): Promise<void> {
  server = compose(admission).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}
const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));

async function send(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>),
  };
}

beforeAll(() => listen());
afterAll(() => close());
beforeEach(() => {
  committed.length = 0;
  rolledBack = 0;
  tokenised.length = 0;
  storeFailure = undefined;
  storeGate = undefined;
  principal = session(SHIPPER, ['address_book:manage', 'address_book:read']);
});

describe('[US-086] descriptor-driven capture: mutations, ordering and the request correlation id', () => {
  it('[AT-US-086-01] a Shipper POSTs a valid address: exactly one CREATE entry for entity "address" with the new id; the handler did business work only', async () => {
    const res = await send('POST', '/api/v1/address-book', { body: { city: 'Pune' }, headers: { 'User-Agent': 'Mozilla/5.0 (X11)' } });
    expect(res.status).toBe(201);
    const id = res.body?.['id'];
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      action: 'CREATE',
      outcome: 'SUCCESS',
      entityName: 'address',
      entityId: id,
      orgId: ORG,
      streamId: ORG,
      actorType: 'USER',
      userId: SHIPPER,
      httpMethod: 'POST',
      route: '/api/v1/address-book',
      uaParsed: 'Firefox 146 / Windows',
      sourceApp: 'api',
    });
    // the client IP and the raw user agent are tokenised in the same flush, never stored in clear
    expect(tokenised.map((value) => value.field)).toEqual(['ip', 'user_agent']);
    // AT-US-087-04 value hop (D-ARCH-125): the entry IP is req.ip as Express computed it, never parsed from a header here
    expect(tokenised[0]?.value).toBe('127.0.0.1');
    expect(entries()[0]?.ipCoarse).toBe('127.0.0.0/24');
    expect(entries()[0]?.ipToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(businessRows()).toEqual([id]);
  });

  it('[D-ARCH-106] the entry is the LAST database work of the ONE handler transaction: business, then vault, then the append', async () => {
    await send('POST', '/api/v1/address-book', { body: { city: 'Pune' } });
    expect(committed).toHaveLength(1);
    expect((committed[0] ?? []).map((statement) => statement.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'INSERT INTO business',
      'AUDIT VAULT ?',
      'AUDIT APPEND ?',
    ]);
  });

  it('[AT-US-008-03] the entry carries the request correlation id: the inbound X-Correlation-Id, else the server-generated id', async () => {
    await send('POST', '/api/v1/address-book', { body: { city: 'Pune' }, headers: { 'X-Correlation-Id': 'corr-audit-hop-0001' } });
    const generated = await send('POST', '/api/v1/address-book', { body: { city: 'Delhi' } });
    const [first, second] = entries();
    expect(first?.correlationId).toBe('corr-audit-hop-0001');
    expect(second?.correlationId).toBe(generated.headers.get('x-correlation-id'));
    expect(second?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('[D-ARCH-106] a route with load, call and handler: the read-only load transaction records nothing; one entry in the handler transaction', async () => {
    const res = await send('PUT', '/api/v1/address-book/a-77/import');
    expect(res.status).toBe(200);
    expect(committed).toHaveLength(2);
    expect((committed[0] ?? []).some(isAudit)).toBe(false);
    expect(entries()).toEqual([expect.objectContaining({ action: 'UPDATE', entityId: 'a-77', outcome: 'SUCCESS' })]);
  });

  it('X-Client-App web or admin is the source app; anything else is api', async () => {
    await send('POST', '/api/v1/address-book', { body: { city: 'Pune' }, headers: { 'X-Client-App': 'admin' } });
    await send('POST', '/api/v1/address-book', { body: { city: 'Pune' }, headers: { 'X-Client-App': 'evil' } });
    expect(entries().map((entry) => entry.sourceApp)).toEqual(['admin', 'api']);
  });
});

describe('[US-086] views, denials, NONE routes and failure outcomes', () => {
  it('[AT-US-086-04] a list GET returning 37 rows writes ONE VIEW entry with the filter summary (tokenised) and result_count 37', async () => {
    const res = await send('GET', '/api/v1/address-book?city=Pune');
    expect(res.status).toBe(200);
    expect(entries()).toHaveLength(1);
    const [view] = entries();
    expect(view).toMatchObject({ action: 'VIEW', outcome: 'SUCCESS', entityName: 'address', entityId: null });
    expect(view?.details).toEqual({ filter: { city: { $pii: expect.stringMatching(/^[0-9a-f-]{36}$/) } }, result_count: 37 });
    expect(tokenised.find((value) => value.field === 'filter')?.value).toBe('Pune');
    // its own short transaction, after the handler's (which wrote nothing)
    expect(committed).toHaveLength(2);
    expect((committed[0] ?? []).some(isAudit)).toBe(false);
  });

  it('[REQ-AUDIT-005] a SENSITIVE detail view is not released when its entry cannot be written: 503 AUDIT_UNAVAILABLE, no data', async () => {
    storeFailure = new Error('store down');
    const res = await send('GET', '/api/v1/address-book/a-1');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
    expect(res.headers.get('retry-after')).toBe('1');
    expect(JSON.stringify(res.body)).not.toContain('Pune');
  });

  it('a NORMAL list view is best effort: the store failure does not change the answer', async () => {
    storeFailure = new Error('store down');
    expect((await send('GET', '/api/v1/address-book')).status).toBe(200);
    expect(entries()).toEqual([]);
  });

  it('[AT-US-086-05] a Viewer calls a mutating route: 403, no business row, one PERMISSION_DENIED entry with outcome DENIED', async () => {
    principal = session(VIEWER, ['address_book:read']);
    const res = await send('POST', '/api/v1/address-book', { body: { city: 'Pune' } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'AUTHZ_DENIED' });
    expect(businessRows()).toEqual([]);
    expect(entries()).toEqual([
      expect.objectContaining({
        action: 'PERMISSION_DENIED',
        outcome: 'DENIED',
        entityName: 'address',
        entityId: null,
        userId: VIEWER,
        details: { required_permission: 'address_book:manage' },
        route: '/api/v1/address-book',
      }),
    ]);
  });

  it('a denial whose entry cannot be written answers the audit failure, never a silent 403', async () => {
    principal = session(VIEWER, ['address_book:read']);
    storeFailure = toAuditWriteError(Object.assign(new Error('x'), { code: '55P03' }));
    const res = await send('POST', '/api/v1/address-book', { body: { city: 'Pune' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('1');
  });

  it('[AT-US-086-06] GET /health/live and the closed-list NONE routes write no audit entry', async () => {
    principal = ANONYMOUS;
    for (const [method, path] of [
      ['GET', '/health/live'],
      ['GET', '/api/v1/reference/countries'],
      ['GET', '/api/v1/auth/csrf'],
      ['POST', '/api/v1/security/csp-report'],
      ['GET', '/api/v1/reference/volumetric'],
    ] as const) {
      expect((await send(method, path)).status).toBeLessThan(300);
    }
    expect(committed.flat().filter(isAudit)).toEqual([]);
    expect(tokenised).toEqual([]);
  });

  it('[REQ-AUDIT-010] an authenticated mutation ending in 409: the business change rolls back, a FAILED entry is written separately', async () => {
    const res = await send('PATCH', '/api/v1/address-book/a-9', { body: { city: 'Goa' } });
    expect(res.status).toBe(409);
    expect(businessRows()).toEqual([]);
    expect(rolledBack).toBe(1);
    expect(entries()).toEqual([
      expect.objectContaining({ action: 'UPDATE', outcome: 'FAILED', entityId: 'a-9', details: { status: 409, code: 'CONFLICT' } }),
    ]);
  });

  it('[REQ-AUDIT-010] a 400 validation failure is not audited', async () => {
    expect((await send('POST', '/api/v1/address-book', { body: { town: 'Pune' } })).status).toBe(400);
    expect(committed).toEqual([]);
  });

  it('[PR42-SEC-15] a crafted User-Agent and an e-mail path parameter never fail the entry: ua_parsed and entity_id are null', async () => {
    const res = await send('GET', '/api/v1/address-book/someone@example.test', { headers: { 'User-Agent': 'curl/8; evil' } });
    expect(res.status).toBe(200);
    expect(entries()).toEqual([expect.objectContaining({ entityId: null, uaParsed: null })]);
    // the raw user agent is still captured, as a vault token
    expect(tokenised.find((value) => value.field === 'user_agent')?.value).toBe('curl/8; evil');
  });
});

describe('[REQ-AUDIT-010] results returned (not thrown) by the handler', () => {
  it('a returned 409 commits a FAILED entry in the handler transaction; a returned 404 commits no entry', async () => {
    expect((await send('DELETE', '/api/v1/address-book/locked')).status).toBe(409);
    expect((await send('DELETE', '/api/v1/address-book/gone')).status).toBe(404);
    expect(entries()).toEqual([
      expect.objectContaining({ action: 'DELETE', outcome: 'FAILED', entityId: 'locked', details: { status: 409 } }),
    ]);
    expect(committed).toHaveLength(2);
  });

  it('an unexpected error (500) of an authenticated mutation: rolled back, FAILED entry with INTERNAL_ERROR in its own transaction', async () => {
    expect((await send('POST', '/api/v1/address-book/a-5/verify')).status).toBe(500);
    expect(businessRows()).toEqual([]);
    expect(entries()).toEqual([
      expect.objectContaining({ outcome: 'FAILED', entityId: 'a-5', details: { status: 500, code: 'INTERNAL_ERROR' } }),
    ]);
  });

  it('[REQ-AUDIT-010] a mutation that fails in its load (409) or call (500) phase gets its FAILED entry in a transaction of its own', async () => {
    expect((await send('PUT', '/api/v1/address-book/stale/import')).status).toBe(409);
    expect((await send('PUT', '/api/v1/address-book/carrier-down/import')).status).toBe(500);
    expect(businessRows()).toEqual([]);
    expect(entries()).toEqual([
      expect.objectContaining({ action: 'UPDATE', outcome: 'FAILED', entityId: 'stale', details: { status: 409, code: 'CONFLICT' } }),
      expect.objectContaining({
        action: 'UPDATE',
        outcome: 'FAILED',
        entityId: 'carrier-down',
        details: { status: 500, code: 'INTERNAL_ERROR' },
      }),
    ]);
  });

  it('a view that found nothing (404) releases nothing and records no VIEW entry', async () => {
    expect((await send('GET', '/api/v1/address-book/missing')).status).toBe(404);
    expect(entries()).toEqual([]);
  });

  it('a capture without a tenant-transaction runner refuses to write in a separate transaction (503, never silent)', async () => {
    const capture = createAuditCapture({ config: { DB_AUDIT_LOCK_TIMEOUT_MS: 250 }, tenantTx: undefined });
    const failure = await capture
      .denied(
        {
          route: routes[0] as RouteDescriptor,
          input: { params: {}, query: {}, body: undefined, headers: {} },
          principal: ANONYMOUS,
          correlationId: 'corr-no-runner-0001',
          transport: { ip: '', userAgent: '', clientApp: '', routeTemplate: '/api/v1/address-book' },
        },
        { orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: 'corr-no-runner-0001' },
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('[ADR-0007 am. 10 item 2-3] 503 classes surface with Retry-After and roll the business change back', () => {
  it('AUDIT_LOCK_TIMEOUT: 503 SERVICE_UNAVAILABLE, Retry-After 1, no business row, and no FAILED entry (the audit path failed)', async () => {
    storeFailure = toAuditWriteError(Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }));
    const res = await send('POST', '/api/v1/address-book', { body: { city: 'Pune' } });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(res.headers.get('retry-after')).toBe('1');
    expect(businessRows()).toEqual([]);
    expect(committed).toEqual([]);
  });

  it('TENANT_CONCURRENCY_LIMIT: a request refused by the bulkhead while the stream is busy answers 503 with Retry-After and writes nothing', async () => {
    await close();
    await listen({ maxConcurrentTx: 1, waitMs: 50 });
    try {
      let release: () => void = () => undefined;
      storeGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const held = send('POST', '/api/v1/address-book', { body: { city: 'Held' } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const refused = await send('POST', '/api/v1/address-book', { body: { city: 'Refused' } });
      expect(refused.status).toBe(503);
      expect(refused.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(refused.headers.get('retry-after')).toBe('1');
      release();
      expect((await held).status).toBe(201);
      expect(entries()).toHaveLength(1);
      expect(businessRows()).toHaveLength(1);
    } finally {
      await close();
      await listen();
    }
  });
});

describe('[PR #42 R1-n5] the capture takes DB_AUDIT_LOCK_TIMEOUT_MS from the configuration createApp receives', () => {
  /** A client whose transactions answer the head-row lock with an empty stream head and record the bound timeout. */
  function lockingRunner(locks: unknown[]) {
    const tx = {
      $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
        if (!strings.join('?').includes('FOR UPDATE OF h')) {
          return Promise.resolve([{ org_id: null, actor_id: null, actor_scope: null, guest_token_hash: null }] as T);
        }
        locks.push(values[0]);
        return Promise.resolve([{ entry_count: '0', head_hash: '00'.repeat(32), head_us: null, now_us: '1763000000123456' }] as T);
      },
      $executeRaw: (): Promise<number> => Promise.resolve(1),
    };
    const lockingClient = {
      $transaction<R>(fn: (inner: typeof tx) => Promise<R>): Promise<R> {
        return fn(tx);
      },
      $queryRaw: <T>(): Promise<T> => Promise.resolve([] as T),
    };
    return createWithTenantTx(
      lockingClient,
      { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
      {
        onSecurityEvent: () => undefined,
        countSessionContextLeak: () => undefined,
        markNotReady: () => undefined,
        scopeClient: () => lockingClient,
        env: {},
      },
    );
  }

  it('the configured value is bound in the head-row lock statement of the real store', async () => {
    const locks: unknown[] = [];
    const capture = createAuditCapture({ config: { DB_AUDIT_LOCK_TIMEOUT_MS: 321 }, tenantTx: lockingRunner(locks) });
    // a denial entry without personal values (no IP, no user agent): the real Prisma store, no tokeniser needed
    await capture.denied(
      {
        route: routes[0] as RouteDescriptor,
        input: { params: {}, query: {}, body: undefined, headers: {} },
        principal: ANONYMOUS,
        correlationId: 'corr-config-0001',
        transport: { ip: '', userAgent: '', clientApp: '', routeTemplate: '/api/v1/address-book' },
      },
      { orgId: '', actorId: '', actorScope: 'TENANT', guestTokenHash: '', correlationId: 'corr-config-0001' },
    );
    expect(locks).toEqual(['321']);
  });

  it('createApp builds the capture from auditConfig: audited routes mount with it and are refused without it', () => {
    const deps = {
      health: [],
      modules: [{ name: 'addresses', routes }],
      tenantTx: lockingRunner([]),
      logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
    };
    expect(() => createApp({ ...deps, auditConfig: { DB_AUDIT_LOCK_TIMEOUT_MS: 321 } })).not.toThrow();
    expect(() => createApp(deps)).toThrow(/audit slot stub cannot honour audit action CREATE on createAddress/);
  });
});
