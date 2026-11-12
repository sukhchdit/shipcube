/**
 * Runtime database composition (PR11-SEC-09 items 1-4; D-ORCH-014 (c)/(d)). Unit level: the not-ready latch, the
 * gated `database` readiness check, the start-up integrity log and the PGOPTIONS refusal through the composition
 * function. The PostgreSQL-backed wiring (fresh probe first, leak → latched not ready) is proved in
 * prisma/tests/rls/session-scope-leak.int.test.ts.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createRuntimeLog } from '../runtime/log.js';
import type { ReadinessCheck } from '../runtime/readiness.js';
import { SessionIntegrityError } from './session-integrity.js';
import {
  createDatabaseRuntime,
  createNotReadyLatch,
  DatabaseNotReadyError,
  gatedDatabaseCheck,
  runStartupIntegrityCheck,
} from './runtime.js';
import { TenantTxConfigError } from './with-tenant-tx.js';

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
    expect(Object.keys(runtime).sort()).toEqual(['readinessCheck', 'resources', 'sessionContextLeaks', 'startup', 'tenantTx']);
    for (const resource of runtime.resources) await resource.close();
  });
});
