// Route I/O phases in the tx slot (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4), threat model T-83; TASK-020 part
// 020-C (b), (c), (f)): load in a read-only transaction, call with no transaction and an AbortSignal, handler plus audit
// in the one write transaction, send, then afterCommit. Real createApp over loopback with a fake runner that records
// every transaction and can enforce a concurrency cap like the D-ARCH-086 admission permit; no database.
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, jest } from '@jest/globals';
import { AppError } from '@platform/shared';
import type { Express, NextFunction, Request, Response } from 'express';

import { createApp } from '../../app.js';
import { DbError, type TenantContext, type TenantTxCallOptions, type TenantTxRunner } from '../db/index.js';
import { dbErrorMapping } from '../db/map-db-error.js';
import type {
  AfterCommitContext,
  CallContext,
  RouteContext,
  RouteDescriptor,
  RouteRequestContext,
  RouteResult,
} from '../routing/define-route.js';
import { defaultPipelineSlots, type PipelineSlots } from '../routing/pipeline.js';
import { fixtureRoute, type FixtureRouteSpec } from '../routing/tests/fixture-route.js';
import { LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import { DRAIN_TIMEOUT_MS } from '../runtime/shutdown.js';
import { AFTER_COMMIT_FAILED_EVENT, createAfterCommitQueue } from './after-commit.js';
import { AfterCommitNotWiredError, CALL_DEADLINE_MS, DEADLINE_RETRY_AFTER_SECONDS, executeSlot, type ExecuteOptions } from './execute.js';

jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

interface FakeRunner extends TenantTxRunner<unknown> {
  readonly contexts: TenantContext[];
}

/** The admission wait of the fake bulkhead (the real one waits DB_TENANT_ADMISSION_WAIT_MS, D-ARCH-086). */
const ADMISSION_WAIT_MS = 300;

/**
 * Records `begin:ro` / `begin:rw`, `commit` and `rollback`. With `cap` it is a bulkhead like the D-ARCH-086 admission
 * permit: at most `cap` transactions are open, a further one waits up to ADMISSION_WAIT_MS for a permit and is then
 * refused with the same retryable 503 DbError as the real one (TENANT_CONCURRENCY_LIMIT, TASK-025). `refuse` refuses
 * the transactions whose 1-based index it lists.
 */
function fakeRunner(events: string[], options: { readonly cap?: number; readonly refuse?: readonly number[] } = {}): FakeRunner {
  const contexts: TenantContext[] = [];
  let open = 0;
  let started = 0;
  const waiting: (() => void)[] = [];
  const refused = (): DbError => {
    events.push('refused');
    return new DbError(dbErrorMapping(503, 'TENANT_CONCURRENCY_LIMIT', { retryable: true }));
  };
  const admit = async (): Promise<boolean> => {
    const deadline = Date.now() + ADMISSION_WAIT_MS;
    while (options.cap !== undefined && open >= options.cap) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await Promise.race([new Promise<void>((resolve) => waiting.push(resolve)), delay(left)]);
    }
    return true;
  };
  return {
    contexts,
    transactionOptions: { maxWait: 1, timeout: 1 },
    probeFreshConnection: () => Promise.resolve(),
    withTenantTx: async <R>(ctx: TenantContext, fn: (db: never) => Promise<R>, call?: TenantTxCallOptions): Promise<R> => {
      started += 1;
      if (options.refuse?.includes(started) === true || !(await admit())) throw refused();
      open += 1;
      contexts.push(ctx);
      events.push(call?.readOnly === true ? 'begin:ro' : 'begin:rw');
      try {
        const result = await fn((call?.readOnly === true ? 'read-only-db' : 'write-db') as never);
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      } finally {
        open -= 1;
        waiting.shift()?.();
      }
    },
  };
}

const silent = { info: () => undefined, debug: () => undefined, error: () => undefined };

/** The etag slot replaced by one that records `send` when the response finished (the step order is unchanged). */
function recordingSlots(runner: FakeRunner, events: string[], options: Partial<ExecuteOptions> = {}): PipelineSlots {
  const base = defaultPipelineSlots({ tenantTx: runner });
  return {
    ...base,
    etag: () => (_req: Request, res: Response, next: NextFunction) => {
      res.once('finish', () => events.push('send'));
      next();
    },
    execute: executeSlot({
      tenantTx: runner,
      audit: (ctx) => {
        events.push(`audit db=${String(ctx.db)}`);
        return Promise.resolve();
      },
      afterCommit: createAfterCommitQueue(silent),
      ...options,
    }),
  };
}

function appWith(route: RouteDescriptor, runner: FakeRunner, events: string[], options: Partial<ExecuteOptions> = {}): Express {
  return createApp({
    health: [],
    modules: [{ name: 't', routes: [route] }],
    logger: silent,
    pipeline: recordingSlots(runner, events, options),
  });
}

async function request(app: Express, path: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers; body: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}${path}`, init);
    return { status: response.status, headers: response.headers, body: await response.text() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Resolves once `events` holds `event` (afterCommit runs after the response, so the client may see it first). */
async function eventually(events: readonly string[], event: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !events.includes(event); attempt += 1) await delay(5);
}

const phased = <L, C>(spec: Omit<FixtureRouteSpec<L, C>, 'operationId' | 'path'>): RouteDescriptor =>
  fixtureRoute<L, C>({ operationId: 'checkoutThing', path: '/things', method: 'post', transaction: 'tenant', tenancy: 'guest', ...spec });

describe('[D-ARCH-106 (4)] tx slot phase order (TASK-020 part 020-C (b), (c))', () => {
  it('runs load (read-only tx), call (no tx), handler + audit (write tx), send, then afterCommit', async () => {
    const events: string[] = [];
    const route = phased({
      load: (ctx) => {
        events.push(`load db=${String(ctx.db)}`);
        return { orderId: 'o-1' };
      },
      call: (_ctx, loaded) => {
        events.push(`call ${loaded.orderId}`);
        return { reference: `ref-${loaded.orderId}` };
      },
      handler: (ctx, { loaded, called }) => {
        events.push(`handler db=${String(ctx.db)} ${loaded.orderId} ${called.reference}`);
        return { status: 201, body: { reference: called.reference } };
      },
      afterCommit: (_ctx, result) => {
        events.push(`afterCommit ${String(result.status)}`);
      },
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-o-1' });
    await eventually(events, 'afterCommit 201');
    expect(events).toEqual([
      'begin:ro',
      'load db=read-only-db',
      'commit',
      'call o-1',
      'begin:rw',
      'handler db=write-db o-1 ref-o-1',
      'audit db=write-db',
      'commit',
      'send',
      'afterCommit 201',
    ]);
  });

  it('a route with only a handler is exactly one write transaction, as before part C', async () => {
    const events: string[] = [];
    const route = phased({
      handler: (_ctx, { loaded, called }) => ({ status: 200, body: { loaded: loaded ?? null, called: called ?? null } }),
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect([response.status, JSON.parse(response.body)]).toEqual([200, { loaded: null, called: null }]);
    expect(events).toEqual(['begin:rw', 'audit db=write-db', 'commit', 'send']);
  });

  it('call without load gets undefined and still runs outside any transaction', async () => {
    const events: string[] = [];
    const route = phased({
      call: (_ctx, loaded) => {
        events.push(`call ${String(loaded)}`);
        return 7;
      },
      handler: (_ctx, { called }) => ({ status: 200, body: { called } }),
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect(JSON.parse(response.body)).toEqual({ called: 7 });
    expect(events).toEqual(['call undefined', 'begin:rw', 'audit db=write-db', 'commit', 'send']);
  });

  it('a call that throws opens no handler transaction and answers a problem', async () => {
    const events: string[] = [];
    const route = phased({
      load: () => ({ id: 'x' }),
      call: () => {
        events.push('call');
        throw new AppError('SERVICE_UNAVAILABLE');
      },
      handler: () => {
        events.push('handler');
        return { status: 200 };
      },
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await delay(20);
    expect(events).toEqual(['begin:ro', 'commit', 'call', 'send']);
  });

  it('a handler that throws rolls back and schedules no afterCommit', async () => {
    const events: string[] = [];
    const route = phased({
      call: () => 'k',
      handler: () => {
        throw new Error('handler failed');
      },
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect(response.status).toBe(500);
    await delay(20);
    expect(events).toEqual(['begin:rw', 'rollback', 'send']);
  });

  it('an audit failure answers 500, sends no 2xx and schedules no afterCommit', async () => {
    const events: string[] = [];
    const route = phased({
      call: () => 'k',
      handler: () => ({ status: 201, body: {} }),
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const app = appWith(route, fakeRunner(events), events, { audit: () => Promise.reject(new Error('audit insert failed')) });
    const response = await request(app, '/api/v1/things', { method: 'POST' });
    expect(response.status).toBe(500);
    await delay(20);
    expect(events).toEqual(['begin:rw', 'rollback', 'send']);
  });

  it('an afterCommit that throws leaves the response unchanged and logs api.after_commit_failed without values', async () => {
    const events: string[] = [];
    const logged: [string, unknown][] = [];
    const logger = { error: (event: string, fields?: unknown) => logged.push([event, fields]) };
    const route = phased({
      handler: () => ({ status: 200, body: { ok: true } }),
      afterCommit: () => {
        events.push('afterCommit');
        throw new Error('fan-out start failed for secret-value');
      },
    });
    const app = appWith(route, fakeRunner(events), events, { afterCommit: createAfterCommitQueue(logger) });
    const response = await request(app, '/api/v1/things', { method: 'POST', headers: { 'X-Correlation-Id': 'corr-12345678' } });
    expect([response.status, JSON.parse(response.body)]).toEqual([200, { ok: true }]);
    for (let attempt = 0; attempt < 200 && logged.length === 0; attempt += 1) await delay(5);
    expect(logged).toEqual([
      [
        AFTER_COMMIT_FAILED_EVENT,
        { route: '/api/v1/things', operation: 'checkoutThing', correlation_id: 'corr-12345678', error_class: 'Error' },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain('secret-value');
  });

  it('runs afterCommit on a transaction none route after the response, with no transaction at all', async () => {
    const events: string[] = [];
    const route = fixtureRoute({
      operationId: 'pingThing',
      path: '/ping',
      handler: (ctx) => {
        events.push(`handler db=${String(ctx.db)}`);
        return { status: 204 };
      },
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/ping');
    expect(response.status).toBe(204);
    await eventually(events, 'afterCommit');
    expect(events).toEqual(['handler db=undefined', 'audit db=undefined', 'send', 'afterCommit']);
  });
});

describe('[D-ARCH-106 (4)] phase contexts: no database handle outside load and handler, frozen transport everywhere', () => {
  it('load and handler get a db; call (with a signal) and afterCommit get none; every context and transport is frozen', async () => {
    const seen: Record<string, RouteRequestContext> = {};
    const route = phased({
      load: (ctx: RouteContext) => {
        seen['load'] = ctx;
        return 1;
      },
      call: (ctx: CallContext) => {
        seen['call'] = ctx;
        return 2;
      },
      handler: (ctx: RouteContext) => {
        seen['handler'] = ctx;
        return { status: 204 };
      },
      afterCommit: (ctx: RouteRequestContext) => {
        seen['afterCommit'] = ctx;
      },
    });
    const events: string[] = [];
    await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST', headers: { 'User-Agent': 'probe/1' } });
    for (let attempt = 0; attempt < 200 && seen['afterCommit'] === undefined; attempt += 1) await delay(5);
    expect(Object.keys(seen).sort()).toEqual(['afterCommit', 'call', 'handler', 'load']);
    for (const [phase, ctx] of Object.entries(seen)) {
      expect([phase, Object.isFrozen(ctx), Object.isFrozen(ctx.transport), ctx.transport.userAgent]).toEqual([
        phase,
        true,
        true,
        'probe/1',
      ]);
      expect([phase, 'req' in ctx, 'res' in ctx]).toEqual([phase, false, false]);
    }
    expect(['db' in seen['load']!, 'db' in seen['handler']!, 'db' in seen['call']!, 'db' in seen['afterCommit']!]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect((seen['call'] as CallContext).signal).toBeInstanceOf(AbortSignal);
    expect((seen['afterCommit'] as AfterCommitContext).signal).toBeInstanceOf(AbortSignal);
  });

  it('[R1-n2] the call deadline is below the shutdown drain bound', () => {
    expect(CALL_DEADLINE_MS).toBeLessThan(DRAIN_TIMEOUT_MS);
    expect(DEADLINE_RETRY_AFTER_SECONDS).toBe(1);
  });

  it('[R1-M1] a call that never settles and ignores its signal answers a retryable 503 at the deadline; no handler transaction', async () => {
    const events: string[] = [];
    const route = phased({
      load: () => ({ id: 'x' }),
      call: () => {
        events.push('call');
        return new Promise<never>(() => undefined);
      },
      handler: () => {
        events.push('handler');
        return { status: 200 };
      },
    });
    const started = Date.now();
    const response = await request(appWith(route, fakeRunner(events), events, { callDeadlineMs: 50 }), '/api/v1/things', {
      method: 'POST',
    });
    const elapsed = Date.now() - started;
    expect([response.status, response.headers.get('retry-after'), (JSON.parse(response.body) as { code: string }).code]).toEqual([
      503,
      '1',
      'SERVICE_UNAVAILABLE',
    ]);
    expect(elapsed).toBeLessThan(2_000);
    await delay(20);
    expect(events).toEqual(['begin:ro', 'commit', 'call', 'send']);
  });

  it('[R1-M1] a call that rethrows the signal reason answers the same retryable 503, not a 500', async () => {
    const events: string[] = [];
    const route = phased({
      call: async (ctx) => {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => resolve());
        });
        // The reason itself is the retryable 503, so a rethrow answers 503 even where nothing races the call.
        const reason: unknown = ctx.signal.reason;
        events.push(reason instanceof AppError ? `aborted ${reason.code} retry=${String(reason.retryAfterSeconds)}` : 'aborted other');
        ctx.signal.throwIfAborted();
        return 'never';
      },
      handler: () => ({ status: 200 }),
    });
    const response = await request(appWith(route, fakeRunner(events), events, { callDeadlineMs: 30 }), '/api/v1/things', {
      method: 'POST',
    });
    expect([response.status, response.headers.get('retry-after')]).toEqual([503, '1']);
    await delay(20);
    expect(events).toEqual(['aborted SERVICE_UNAVAILABLE retry=1', 'send']);
  });

  it('the call signal aborts at the request deadline; the handler transaction is never opened', async () => {
    const events: string[] = [];
    const route = phased({
      call: async (ctx) => {
        await new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            events.push('aborted');
            reject(new AppError('SERVICE_UNAVAILABLE'));
          });
        });
        return 'never';
      },
      handler: () => ({ status: 200 }),
    });
    const response = await request(appWith(route, fakeRunner(events), events, { callDeadlineMs: 30 }), '/api/v1/things', {
      method: 'POST',
    });
    expect(response.status).toBe(503);
    expect(events).toEqual(['aborted', 'send']);
  });

  it('the call signal aborts when the client disconnects', async () => {
    const events: string[] = [];
    let entered: () => void = () => undefined;
    const inCall = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let aborted: (reason: unknown) => void = () => undefined;
    const sawAbort = new Promise<unknown>((resolve) => {
      aborted = resolve;
    });
    const route = phased({
      call: async (ctx) => {
        ctx.signal.addEventListener('abort', () => aborted(ctx.signal.reason));
        entered();
        await sawAbort;
        throw new AppError('SERVICE_UNAVAILABLE');
      },
      handler: () => ({ status: 200 }),
    });
    const app = appWith(route, fakeRunner(events), events);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/things`, {
        method: 'POST',
        signal: controller.signal,
      }).catch((error: unknown) => error);
      await inCall;
      controller.abort();
      await pending;
      expect(await sawAbort).toBeInstanceOf(AppError);
      expect(events).not.toContain('begin:rw');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('[R1-m1] a client that disconnects during load gets no call and no handler transaction', async () => {
    const events: string[] = [];
    let entered: () => void = () => undefined;
    const inLoad = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const route = phased({
      load: async () => {
        entered();
        await held;
        events.push('load');
        return { id: 'x' };
      },
      call: (ctx) => {
        events.push(`call aborted=${String(ctx.signal.aborted)}`);
        return 'effect';
      },
      handler: () => {
        events.push('handler');
        return { status: 200 };
      },
    });
    const app = appWith(route, fakeRunner(events), events);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/things`, {
        method: 'POST',
        signal: controller.signal,
      }).catch((error: unknown) => error);
      await inLoad;
      controller.abort();
      await pending;
      await delay(100); // the server sees the socket close while load is still held
      release();
      for (let attempt = 0; attempt < 100 && !events.includes('commit'); attempt += 1) await delay(5);
      await delay(100);
      expect(events.filter((event) => event !== 'send')).toEqual(['begin:ro', 'load', 'commit']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('[R2-m1] a client gone before the tx slot runs (an earlier slot held) gets no call and no handler transaction', async () => {
    const events: string[] = [];
    let entered: () => void = () => undefined;
    const inEtag = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const route = phased({
      call: (ctx) => {
        events.push(`call aborted=${String(ctx.signal.aborted)}`);
        return 'effect';
      },
      handler: () => {
        events.push('handler');
        return { status: 200 };
      },
    });
    const runner = fakeRunner(events);
    // The etag slot (before the tx slot) is held while the client goes away, then released: the tx slot starts with
    // the response already closed, so only the pre-slot `res.closed || res.destroyed` check can see it (P7).
    // Code review R1-n1 (PR #54): sequenced on events, not delays. The etag slot resolves `closed` when the server
    // sees the response close; the execute slot resolves `executed` when it has returned, whatever it decided.
    let closed: Promise<unknown> = Promise.resolve();
    let finished: () => void = () => undefined;
    const executed = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const recording = recordingSlots(runner, events);
    const slots: PipelineSlots = {
      ...recording,
      etag: () => (_req: Request, res: Response, next: NextFunction) => {
        closed = new Promise((resolve) => res.once('close', resolve));
        entered();
        void held.then(() => next());
      },
      execute: (descriptor) => {
        const inner = recording.execute(descriptor);
        return async (req: Request, res: Response, next: NextFunction) => {
          try {
            await inner(req, res, next);
          } finally {
            finished();
          }
        };
      },
    };
    const app = createApp({ health: [], modules: [{ name: 't', routes: [route] }], logger: silent, pipeline: slots });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/things`, {
        method: 'POST',
        signal: controller.signal,
      }).catch((error: unknown) => error);
      await inEtag;
      controller.abort();
      await pending;
      await closed; // the server has seen the close while the etag slot is still held
      release();
      await executed; // the execute slot ran to its end with the response already closed
      expect(events.filter((event) => event.startsWith('call'))).toEqual([]);
      expect(events).not.toContain('begin:rw');
      expect(events).not.toContain('handler');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('[D-ARCH-086] [D-ARCH-106 (4)] no admission permit or connection is held across call', () => {
  it('two concurrent requests above a cap of one transaction, both inside a slow call at the same time, both succeed', async () => {
    const events: string[] = [];
    let arrived = 0;
    let bothInCall: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      bothInCall = resolve;
    });
    const route = phased({
      load: () => ({ id: 'o' }),
      call: async () => {
        arrived += 1;
        if (arrived === 2) bothInCall();
        await barrier; // both requests are in call together: a permit held across call would refuse the second
        return 'done';
      },
      handler: () => ({ status: 200, body: {} }),
    });
    const app = appWith(route, fakeRunner(events, { cap: 1 }), events);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/things`;
      const statuses = await Promise.all(
        [fetch(url, { method: 'POST' }), fetch(url, { method: 'POST' })].map(async (r) => (await r).status),
      );
      expect(statuses).toEqual([200, 200]);
      expect(events).not.toContain('refused');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('control: the same cap refuses a second request while the first holds its transaction', async () => {
    const events: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inside: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      inside = resolve;
    });
    const route = phased({
      handler: async () => {
        inside();
        await held;
        return { status: 200, body: {} };
      },
    });
    const app = appWith(route, fakeRunner(events, { cap: 1 }), events);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/things`;
      const first = fetch(url, { method: 'POST' });
      await entered;
      const second = await fetch(url, { method: 'POST' });
      release();
      expect([(await first).status, second.status, second.headers.get('retry-after')]).toEqual([200, 503, '1']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('repeat safety: the handler transaction is refused after call, and the retry produces one external effect with the same key', async () => {
    const events: string[] = [];
    // The gateway stand-in deduplicates by idempotency key, as Stripe does (ADR-0014 G3).
    const effects = new Map<string, number>();
    const keys: string[] = [];
    const route = phased({
      load: () => ({ orderId: 'ord-42', attempt: 1 }),
      call: (_ctx, loaded) => {
        const key = `auth:${loaded.orderId}:${String(loaded.attempt)}`; // derived from loaded, never random
        keys.push(key);
        effects.set(key, (effects.get(key) ?? 0) + 1);
        return { key };
      },
      handler: (_ctx, { called }) => ({ status: 201, body: called }),
    });
    // Transaction 2 is the first request's handler transaction: refused like an exhausted admission permit.
    const app = appWith(route, fakeRunner(events, { refuse: [2] }), events);
    const first = await request(app, '/api/v1/things', { method: 'POST' });
    expect([first.status, first.headers.get('retry-after')]).toEqual([503, '1']);
    const retry = await request(app, '/api/v1/things', { method: 'POST' });
    expect([retry.status, JSON.parse(retry.body)]).toEqual([201, { key: 'auth:ord-42:1' }]);
    expect(keys).toEqual(['auth:ord-42:1', 'auth:ord-42:1']);
    expect([...effects.keys()]).toEqual(['auth:ord-42:1']);
  });
});

describe('[TASK-020 part 020-C (f)] the stream hook: a stream result is completed after COMMIT', () => {
  it('sends the status and headers after COMMIT, writes the chunks, ends, then runs afterCommit', async () => {
    const events: string[] = [];
    const route = phased({
      handler: (): RouteResult => {
        events.push('handler');
        return {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          stream: {
            complete: async (sink) => {
              events.push('stream');
              sink.write('data: one\n\n');
              await delay(5);
              sink.write('data: two\n\n');
            },
          },
        };
      },
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect([response.status, response.headers.get('content-type'), response.body]).toEqual([
      200,
      'text/event-stream',
      'data: one\n\ndata: two\n\n',
    ]);
    await eventually(events, 'afterCommit');
    expect(events).toEqual(['begin:rw', 'handler', 'audit db=write-db', 'commit', 'stream', 'send', 'afterCommit']);
  });

  it('[R1-m2] a result with both a body and a stream rolls the write back, answers 500 and streams nothing', async () => {
    const events: string[] = [];
    const complete = jest.fn(() => Promise.resolve());
    const route = phased({
      handler: () => ({ status: 200, body: {}, stream: { complete } }),
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const response = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' });
    expect(response.status).toBe(500);
    expect(complete).not.toHaveBeenCalled();
    await delay(20);
    expect(events).toEqual(['begin:rw', 'rollback', 'send']);
  });

  it('[R1-n4] a stream that throws after COMMIT closes the connection and afterCommit still runs', async () => {
    const events: string[] = [];
    const route = phased({
      handler: (): RouteResult => ({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        stream: {
          complete: (sink) => {
            sink.write('data: one\n\n');
            return Promise.reject(new Error('upstream gone'));
          },
        },
      }),
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const outcome = await request(appWith(route, fakeRunner(events), events), '/api/v1/things', { method: 'POST' }).then(
      () => 'completed',
      () => 'terminated',
    );
    expect(outcome).toBe('terminated');
    await eventually(events, 'afterCommit');
    expect(events).toEqual(['begin:rw', 'audit db=write-db', 'commit', 'afterCommit']);
  });

  it('[R1-M1] a stream that never settles and ignores its signal is ended at the deadline; afterCommit still runs', async () => {
    const events: string[] = [];
    const route = phased({
      handler: (): RouteResult => ({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        stream: {
          complete: (sink) => {
            sink.write('data: one\n\n');
            return new Promise<never>(() => undefined);
          },
        },
      }),
      afterCommit: () => {
        events.push('afterCommit');
      },
    });
    const started = Date.now();
    const outcome = await request(appWith(route, fakeRunner(events), events, { callDeadlineMs: 50 }), '/api/v1/things', {
      method: 'POST',
    }).then(
      () => 'completed',
      () => 'terminated',
    );
    expect([outcome, Date.now() - started < 2_000]).toEqual(['terminated', true]);
    await eventually(events, 'afterCommit');
    expect(events).toEqual(['begin:rw', 'audit db=write-db', 'commit', 'afterCommit']);
  });
});

describe('afterCommit wiring', () => {
  it('a route with afterCommit is refused at mount time by a tx slot without a queue', () => {
    const route = phased({ handler: () => ({ status: 204 }), afterCommit: () => undefined });
    expect(() => executeSlot({ tenantTx: fakeRunner([]) })(route)).toThrow(AfterCommitNotWiredError);
    expect(() => executeSlot({ tenantTx: fakeRunner([]), afterCommit: createAfterCommitQueue(silent) })(route)).not.toThrow();
  });
});
