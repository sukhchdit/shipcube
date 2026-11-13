/**
 * Runtime database composition (PR11-SEC-09 items 1-4; D-ORCH-014 (c)/(d)). Unit level: the not-ready latch, the
 * gated `database` readiness check, the start-up integrity log and the PGOPTIONS refusal through the composition
 * function. The PostgreSQL-backed wiring (fresh probe first, leak → latched not ready) is proved in
 * prisma/tests/rls/session-scope-leak.int.test.ts.
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Config } from '@platform/config';

import { createRuntimeLog } from '../runtime/log.js';
import type { ReadinessCheck } from '../runtime/readiness.js';
import type { QueryExtensionParams, StandardColumnsExtension } from './extensions/standard-columns.js';
import { SessionIntegrityError } from './session-integrity.js';
import {
  createDatabaseRuntime,
  databaseOptionsFrom,
  databaseRuntimeFromConfig,
  createNotReadyLatch,
  DatabaseNotReadyError,
  gatedDatabaseCheck,
  runStartupAuditPartitionsCheck,
  runStartupIntegrityCheck,
} from './runtime.js';
import { type TenantContext, TenantTxConfigError } from './with-tenant-tx.js';

const rejectWith = (reason: unknown) =>
  new Promise<never>(() => {
    throw reason;
  });

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createRuntimeLog('api', { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return { lines, log };
}

const signal = () => new AbortController().signal;

function innerCheck(): { check: ReadinessCheck; calls: () => number } {
  let calls = 0;
  return {
    check: {
      name: 'database',
      critical: true,
      check: () => {
        calls += 1;
        return Promise.resolve();
      },
    },
    calls: () => calls,
  };
}

describe('not-ready latch (PR11-SEC-09 item 4)', () => {
  it('keeps the first reason, reports it once and is never cleared', () => {
    const reported: string[] = [];
    const latch = createNotReadyLatch((reason) => reported.push(reason));
    expect(latch.reason).toBeUndefined();
    latch.mark('db_session_context_leak');
    latch.mark('db_session_default_tampered');
    expect(latch.reason).toBe('db_session_context_leak');
    expect(reported).toEqual(['db_session_context_leak']);
  });

  it('works without a callback', () => {
    const latch = createNotReadyLatch();
    latch.mark('db_session_default_tampered');
    expect(latch.reason).toBe('db_session_default_tampered');
  });
});

describe('gated database readiness check', () => {
  it('passes through to SELECT 1 + integrity once the fresh probe has passed', async () => {
    const inner = innerCheck();
    const check = gatedDatabaseCheck(inner.check, { latch: createNotReadyLatch(), freshProbe: () => Promise.resolve(true) });
    expect(check).toMatchObject({ name: 'database', critical: true });
    await expect(check.check(signal())).resolves.toBeUndefined();
    expect(inner.calls()).toBe(1);
  });

  it('is not ready while the fresh-connection probe has not passed (unverified), without touching the inner check', async () => {
    const inner = innerCheck();
    const check = gatedDatabaseCheck(inner.check, { latch: createNotReadyLatch(), freshProbe: () => Promise.resolve(false) });
    await expect(check.check(signal())).rejects.toThrow(new DatabaseNotReadyError('fresh_connection_unverified'));
    expect(inner.calls()).toBe(0);
  });

  it('reports the latched reason when the probe itself found the leak', async () => {
    const latch = createNotReadyLatch();
    const check = gatedDatabaseCheck(innerCheck().check, {
      latch,
      freshProbe: () => {
        latch.mark('db_session_context_leak');
        return Promise.resolve(false);
      },
    });
    await expect(check.check(signal())).rejects.toMatchObject({ name: 'DatabaseNotReadyError', reason: 'db_session_context_leak' });
  });

  it('[R2-n2] stays not ready once latched, however often it is polled, and never calls the probe or the inner check again', async () => {
    const latch = createNotReadyLatch();
    const inner = innerCheck();
    const freshProbe = jest.fn(() => Promise.resolve(true));
    const check = gatedDatabaseCheck(inner.check, { latch, freshProbe });
    await expect(check.check(signal())).resolves.toBeUndefined();
    latch.mark('db_session_context_leak');
    for (let i = 0; i < 5; i += 1) await expect(check.check(signal())).rejects.toThrow('database not ready: db_session_context_leak');
    expect(freshProbe).toHaveBeenCalledTimes(1);
    expect(inner.calls()).toBe(1);
  });

  it('honours an aborted signal before any I/O', async () => {
    const inner = innerCheck();
    const controller = new AbortController();
    controller.abort();
    await expect(
      gatedDatabaseCheck(inner.check, { latch: createNotReadyLatch(), freshProbe: () => Promise.resolve(true) }).check(controller.signal),
    ).rejects.toBeDefined();
    expect(inner.calls()).toBe(0);
  });
});

describe('start-up session-integrity check (PR-0009 M1)', () => {
  it('logs success and resolves true', async () => {
    const { lines, log } = capture();
    await expect(runStartupIntegrityCheck({ recheck: () => Promise.resolve() }, log)).resolves.toBe(true);
    expect(lines).toMatchObject([{ level: 'info', event: 'db.session_integrity_ok' }]);
  });

  it.each([
    ['drift', new SessionIntegrityError(['db_session_default_tampered']), 'SessionIntegrityError'],
    ['an unreachable database', Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { name: 'Error' }), 'Error'],
    ['a non-Error rejection', 'secret-value', 'non-error'],
  ])('never rejects on %s; logs the error class only', async (_label, reason, errorClass) => {
    const { lines, log } = capture();
    const recheck = () => rejectWith(reason);
    await expect(runStartupIntegrityCheck({ recheck }, log)).resolves.toBe(false);
    expect(lines).toMatchObject([{ level: 'warn', event: 'db.session_integrity_failed', error: errorClass }]);
    expect(JSON.stringify(lines)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|secret-value|tampered/u);
  });
});

describe('composition function (PR11-SEC-09 item 2, PR9-SEC-03 factory half)', () => {
  const saved = process.env['PGOPTIONS'];
  afterEach(() => {
    if (saved === undefined) delete process.env['PGOPTIONS'];
    else process.env['PGOPTIONS'] = saved;
  });

  const input = () => ({
    database: { connectionString: 'postgres://platform_app@db.invalid:5432/platform', poolMax: 1, applicationName: 'api' },
    tx: { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    log: capture().log,
  });

  it('refuses PGOPTIONS from process.env before any pool or client exists', () => {
    process.env['PGOPTIONS'] = '-c lock_timeout=0';
    expect(() => createDatabaseRuntime(input())).toThrow(TenantTxConfigError);
  });

  it('without the generated client: no runner, the pool and integrity monitor are the closeable resources (no connection opened)', async () => {
    delete process.env['PGOPTIONS'];
    const runtime = createDatabaseRuntime(input());
    expect(runtime.tenantTx).toBeUndefined();
    expect(runtime.sessionContextLeaks()).toBe(0);
    expect(runtime.resources.map((resource) => resource.name)).toEqual(['session-integrity-monitor', 'database']);
    expect(Object.keys(runtime).sort()).toEqual([
      'auditChecks',
      'readinessCheck',
      'resources',
      'sessionContextLeaks',
      'startup',
      'tenantTx',
    ]);
    expect(runtime.auditChecks.partitions).toMatchObject({ name: 'audit_partitions', critical: true });
    expect(runtime.auditChecks.chain).toMatchObject({ name: 'audit_chain', critical: false });
    for (const resource of runtime.resources) await resource.close();
  });

  it('maps the validated configuration onto the pool and transaction options (worker and API share it)', async () => {
    delete process.env['PGOPTIONS'];
    const config = {
      DATABASE_URL: { reveal: () => 'postgres://platform_app@db.invalid:5432/platform' },
      DB_POOL_MAX: 5,
      DB_IDLE_TIMEOUT_MS: 10_000,
      DB_CONNECTION_TIMEOUT_MS: 5_000,
      DB_STATEMENT_TIMEOUT_MS: 25_000,
      DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
      DB_TX_LOCK_TIMEOUT_MS: 2_000,
      DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
    } as unknown as Config;
    expect(databaseOptionsFrom(config, 'worker')).toEqual({
      connectionString: 'postgres://platform_app@db.invalid:5432/platform',
      poolMax: 5,
      applicationName: 'worker',
      idleTimeoutMs: 10_000,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 25_000,
    });
    const runtime = databaseRuntimeFromConfig(config, 'worker', capture().log);
    expect(runtime.tenantTx).toBeUndefined();
    for (const resource of runtime.resources) await resource.close();
  });
});

describe('standard-columns wiring through the composition function (PR26-SEC-02; D-TASK032-04)', () => {
  const saved = process.env['PGOPTIONS'];
  afterEach(() => {
    if (saved === undefined) delete process.env['PGOPTIONS'];
    else process.env['PGOPTIONS'] = saved;
  });

  /** A Prisma client double: records `$extends` and which client each transaction is opened on. */
  function recordingClientClass() {
    const extensions: StandardColumnsExtension[] = [];
    const transactionsOn: string[] = [];
    const tx = {
      $queryRaw: <T>(): Promise<T> => Promise.resolve([{ org_id: null, actor_id: null, actor_scope: null, guest_token_hash: null }] as T),
    };
    const extended = {
      $queryRaw: tx.$queryRaw,
      $transaction: <R>(fn: (inner: typeof tx) => Promise<R>): Promise<R> => {
        transactionsOn.push('extended');
        return fn(tx);
      },
    };
    class RecordingClient {
      readonly _runtimeDataModel = {
        models: {
          Shipment: {
            fields: ['id', 'createdBy', 'updatedBy', 'updatedAt', 'version', 'reference'].map((name) => ({ name, kind: 'scalar' })),
          },
        },
      };
      $queryRaw = tx.$queryRaw;
      $transaction<R>(fn: (inner: typeof tx) => Promise<R>): Promise<R> {
        transactionsOn.push('root');
        return fn(tx);
      }
      $extends(extension: StandardColumnsExtension): typeof extended {
        extensions.push(extension);
        return extended;
      }
      $disconnect(): Promise<void> {
        return Promise.resolve();
      }
    }
    return { RecordingClient, extensions, transactionsOn };
  }

  const input = () => ({
    database: { connectionString: 'postgres://platform_app@db.invalid:5432/platform', poolMax: 1, applicationName: 'api' },
    tx: { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    log: capture().log,
  });

  it('every tenant transaction runs on the root client extended once with the standard-columns extension bound to the context actor', async () => {
    delete process.env['PGOPTIONS'];
    const { RecordingClient, extensions, transactionsOn } = recordingClientClass();
    const runtime = createDatabaseRuntime({ ...input(), Client: RecordingClient });
    const actorId = randomUUID();
    const context = { orgId: randomUUID(), actorId, actorScope: 'TENANT', guestTokenHash: '', correlationId: 'req-1' } as TenantContext;
    await runtime.tenantTx?.withTenantTx(context, () => Promise.resolve('ok'));
    await runtime.tenantTx?.withTenantTx(context, () => Promise.resolve('ok'));

    expect(extensions.map((extension) => extension.name)).toEqual(['standard-columns', 'standard-columns']);
    expect(transactionsOn).toEqual(['extended', 'extended']);

    const [extension] = extensions;
    const seen: unknown[] = [];
    const params: QueryExtensionParams = {
      model: 'Shipment',
      operation: 'update',
      args: { where: { id: 'x' }, data: { reference: 'r' } },
      query: (args) => {
        seen.push(args);
        return Promise.resolve();
      },
    };
    await extension?.query.$allModels.$allOperations(params);
    expect(seen).toEqual([
      { where: { id: 'x' }, data: { reference: 'r', updatedBy: actorId, updatedAt: expect.any(Date), version: { increment: 1 } } },
    ]);
    for (const resource of runtime.resources) await resource.close();
  });
});

describe('start-up audit_partitions check (data-model §5.3 amendment item 3; TASK-021)', () => {
  const check = (outcome: () => Promise<'degraded' | undefined>): ReadinessCheck => ({
    name: 'audit_partitions',
    critical: true,
    check: outcome,
  });

  it('logs ok, late (degraded) and not-ready outcomes and never rejects', async () => {
    const { lines, log } = capture();
    await expect(
      runStartupAuditPartitionsCheck(
        check(() => Promise.resolve(undefined)),
        log,
      ),
    ).resolves.toBe(true);
    await expect(
      runStartupAuditPartitionsCheck(
        check(() => Promise.resolve('degraded')),
        log,
      ),
    ).resolves.toBe(true);
    await expect(
      runStartupAuditPartitionsCheck(
        check(() => rejectWith(new Error('connect ECONNREFUSED db.internal'))),
        log,
      ),
    ).resolves.toBe(false);
    expect(lines.map((line) => [line['level'], line['event']])).toEqual([
      ['info', 'audit.partitions_ok'],
      ['warn', 'audit.partitions_late'],
      ['warn', 'audit.partitions_not_ready'],
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/ECONNREFUSED|internal/);
  });
});
