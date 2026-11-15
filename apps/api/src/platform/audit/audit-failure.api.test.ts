/**
 * The HTTP answer to an audit write failure (REQ-AUDIT-004, ADR-0007 am. 10 item 2; US-088; TASK-025): the audit hook
 * runs inside the request's tenant transaction (tx slot), an `AuditWriteError` leaves the callback, the REAL
 * `withTenantTx` translates it into its `DbError`, and the problem handler answers with the catalogue code: 500
 * AUDIT_WRITE_FAILED, or 503 SERVICE_UNAVAILABLE with `Retry-After: 1` for a head-row lock timeout. The response never
 * carries the reason, the failure kind or the SQLSTATE; the original failure reaches only the redacting `onDbError`
 * log hook. The database side of the same failures (business row rolled back) is prisma/tests/audit.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { auditErrorCause, AuditWriteError, toAuditWriteError } from '@platform/audit';

import { createApp } from '../../app.js';
import { type DbErrorMapping, DbError } from '../db/index.js';
import { auditDbErrorMapping, createWithTenantTx } from '../db/with-tenant-tx.js';
import { defaultPipelineSlots } from '../routing/pipeline.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { createRuntimeLog } from '../runtime/log.js';
import type { AuditHook } from './capture.js';

/** A transaction client that answers the context statement with a clean session (no database). */
class FakeTx {
  $queryRaw<T>(): Promise<T> {
    return Promise.resolve([{ org_id: null, actor_id: null, actor_scope: null, guest_token_hash: null }] as T);
  }
  $executeRaw(): Promise<number> {
    return Promise.resolve(1);
  }
}

const fakeClient = {
  $transaction: <R>(fn: (tx: FakeTx) => Promise<R>): Promise<R> => fn(new FakeTx()),
  $queryRaw: <T>(): Promise<T> => Promise.resolve([] as T),
};

const driverError = (sqlState: string, message: string): Error =>
  Object.assign(new Error('Raw query failed'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: sqlState, originalMessage: message } } },
  });

let failure: unknown;
const logged: Array<{ error: unknown; mapping: DbErrorMapping }> = [];
const runner = createWithTenantTx(
  fakeClient,
  { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
  {
    onSecurityEvent: () => undefined,
    countSessionContextLeak: () => undefined,
    markNotReady: () => undefined,
    scopeClient: () => fakeClient,
    env: {},
    onDbError: (error, mapping) => logged.push({ error, mapping }),
  },
);
const hook: AuditHook = () => Promise.reject(failure instanceof Error ? failure : new Error('no failure set'));
const route = fixtureRoute({
  operationId: 'probeAuditFailure',
  path: '/fixtures/audit-failure',
  tenancy: 'guest',
  transaction: 'tenant',
  handler: () => ({ status: 201, body: { created: true } }),
});

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    health: [],
    modules: [{ name: 'fixtures', routes: [route] }],
    tenantTx: runner,
    logger: createRuntimeLog('api', { write: () => true }),
    pipeline: defaultPipelineSlots({ tenantTx: runner, audit: hook }),
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server as Server | undefined)?.close(() => resolve()) ?? resolve());
});

async function call(): Promise<{ status: number; retryAfter: string | null; text: string; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/fixtures/audit-failure`);
  const text = await response.text();
  expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    text,
    body: JSON.parse(text) as Record<string, unknown>,
  };
}

describe('[US-088] audit write failures through the tx slot, withTenantTx and the problem handler', () => {
  it('[AT-US-088-01] an audit insert failure answers 500 AUDIT_WRITE_FAILED with the generic text only', async () => {
    const original = driverError('23514', 'no partition of relation "audit_entries" found for row secret-detail');
    failure = toAuditWriteError(original);
    logged.length = 0;
    const res = await call();
    expect(res.status).toBe(500);
    expect(res.retryAfter).toBeNull();
    expect(res.body).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED', title: 'Audit write failed' });
    for (const key of ['reason', 'kind', 'sqlState', 'retryable']) expect(res.body).not.toHaveProperty(key);
    for (const leak of ['PARTITION_MISSING', '23514', 'no partition', 'secret-detail']) expect(res.text).not.toContain(leak);
    // the original failure reaches only the redacting log hook, with the safe mapping
    expect(logged).toEqual([
      {
        error: original,
        mapping: { status: 500, code: 'AUDIT_WRITE_FAILED', reason: 'AUDIT_WRITE_FAILED', retryable: false, sqlState: '23514' },
      },
    ]);
  });

  it('a head-row lock timeout answers 503 SERVICE_UNAVAILABLE with Retry-After: 1 (retryable; reason AUDIT_LOCK_TIMEOUT is log-only)', async () => {
    failure = toAuditWriteError(driverError('55P03', 'canceling statement due to lock timeout'));
    logged.length = 0;
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.retryAfter).toBe('1');
    expect(res.body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    for (const leak of ['AUDIT_LOCK_TIMEOUT', '55P03', 'lock timeout']) expect(res.text).not.toContain(leak);
    expect(logged[0]?.mapping).toEqual({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      reason: 'AUDIT_LOCK_TIMEOUT',
      retryable: true,
      retryAfterSeconds: 1,
      sqlState: '55P03',
    });
  });

  it('a refusal without a database cause is still 500 AUDIT_WRITE_FAILED and logs the error itself', async () => {
    const refusal = new AuditWriteError('INVALID_ENTRY', { field: 'origin.ip' });
    failure = refusal;
    logged.length = 0;
    const res = await call();
    expect(res.body).toMatchObject({ status: 500, code: 'AUDIT_WRITE_FAILED' });
    expect(res.text).not.toContain('origin.ip');
    expect(auditErrorCause(refusal)).toBeUndefined();
    expect(logged).toEqual([
      { error: refusal, mapping: { status: 500, code: 'AUDIT_WRITE_FAILED', reason: 'AUDIT_WRITE_FAILED', retryable: false } },
    ]);
  });

  it('auditDbErrorMapping maps every failure kind onto the two public outcomes', () => {
    for (const kind of [
      'INVALID_ENTRY',
      'TOKENISER_UNAVAILABLE',
      'TOKENISER_FAILED',
      'HEAD_MOVED',
      'HEAD_MISSING',
      'PARTITION_MISSING',
      'DATABASE_ERROR',
    ] as const) {
      expect(new DbError(auditDbErrorMapping(new AuditWriteError(kind))).toJSON()).toEqual({
        status: 500,
        code: 'AUDIT_WRITE_FAILED',
        reason: 'AUDIT_WRITE_FAILED',
        retryable: false,
      });
    }
    expect(auditDbErrorMapping(new AuditWriteError('LOCK_TIMEOUT'))).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      retryAfterSeconds: 1,
    });
  });
});
