// The afterCommit queue (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4); TASK-020 part 020-C (a)): best effort, failures
// logged as api.after_commit_failed with route metadata only, and pending work drained at shutdown inside the window.
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from '@jest/globals';

import { createShutdown, DRAIN_TIMEOUT_MS } from '../runtime/shutdown.js';
import {
  AFTER_COMMIT_DEADLINE_MS,
  AFTER_COMMIT_DROPPED_EVENT,
  AFTER_COMMIT_FAILED_EVENT,
  AFTER_COMMIT_MAX_PENDING,
  AfterCommitShutdownError,
  createAfterCommitQueue,
} from './after-commit.js';

const LABEL = { route: '/api/v1/quotes', operationId: 'createQuote', correlationId: 'corr-12345678' };

function recordingLogger(): { readonly lines: [string, unknown][]; error(event: string, fields?: unknown): void } {
  const lines: [string, unknown][] = [];
  return { lines, error: (event, fields) => lines.push([event, fields]) };
}

describe('[D-ARCH-106 (4)] afterCommit queue', () => {
  it('starts the work on a later turn, never inside the caller, and tracks it until it settles', async () => {
    const queue = createAfterCommitQueue(recordingLogger());
    const order: string[] = [];
    queue.schedule(() => {
      order.push('work');
    }, LABEL);
    order.push('caller');
    expect(queue.pending).toBe(1);
    await queue.drain();
    expect(order).toEqual(['caller', 'work']);
    expect(queue.pending).toBe(0);
  });

  it('logs a synchronous throw and a rejection as api.after_commit_failed with the route, operation and correlation id only', async () => {
    const logger = recordingLogger();
    const queue = createAfterCommitQueue(logger);
    queue.schedule(() => {
      throw new TypeError('value 4111111111111111 leaked');
    }, LABEL);
    queue.schedule(() => Promise.reject(new Error('smtp said: user@example.test')), LABEL);
    await queue.drain();
    expect(logger.lines).toEqual([
      [
        AFTER_COMMIT_FAILED_EVENT,
        { route: '/api/v1/quotes', operation: 'createQuote', correlation_id: 'corr-12345678', error_class: 'TypeError' },
      ],
      [
        AFTER_COMMIT_FAILED_EVENT,
        { route: '/api/v1/quotes', operation: 'createQuote', correlation_id: 'corr-12345678', error_class: 'Error' },
      ],
    ]);
    expect(JSON.stringify(logger.lines)).not.toMatch(/4111|example\.test/);
  });

  it('a throwing logger does not become an unhandled rejection', async () => {
    const queue = createAfterCommitQueue({
      error: () => {
        throw new Error('logger down');
      },
    });
    queue.schedule(() => Promise.reject(new Error('x')), LABEL);
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('drain waits for slow work and for work scheduled while draining', async () => {
    const queue = createAfterCommitQueue(recordingLogger());
    const done: string[] = [];
    queue.schedule(async () => {
      await delay(20);
      done.push('first');
      queue.schedule(async () => {
        await delay(10);
        done.push('second');
      }, LABEL);
    }, LABEL);
    await queue.drain();
    expect(done).toEqual(['first', 'second']);
  });

  it('[ADR-0013 item 7] the shutdown drain includes pending afterCommit work and exits 0 once it settles', async () => {
    const queue = createAfterCommitQueue(recordingLogger());
    const done: string[] = [];
    queue.schedule(async () => {
      await delay(30);
      done.push('afterCommit');
    }, LABEL);
    const codes: number[] = [];
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, fatal: () => undefined };
    const shutdown = createShutdown({
      probe: { startDraining: () => undefined },
      drain: () => queue.drain(),
      resources: [],
      log,
      exit: (code) => codes.push(code),
      drainTimeoutMs: 1_000,
    });
    await shutdown('SIGTERM');
    expect([done, codes]).toEqual([['afterCommit'], [0]]);
  });

  it('[ADR-0013 item 7] afterCommit work that never settles is cut off by the drain bound (exit 1), never waited on forever', async () => {
    const queue = createAfterCommitQueue(recordingLogger());
    queue.schedule(() => new Promise<void>(() => undefined), LABEL);
    const codes: number[] = [];
    const warned: string[] = [];
    const log = {
      info: () => undefined,
      warn: (event: string) => warned.push(event),
      error: () => undefined,
      debug: () => undefined,
      fatal: () => undefined,
    };
    const shutdown = createShutdown({
      probe: { startDraining: () => undefined },
      drain: () => queue.drain(),
      resources: [],
      log,
      exit: (code) => codes.push(code),
      drainTimeoutMs: 50,
    });
    await shutdown('SIGTERM');
    expect([codes, warned]).toEqual([[1], ['shutdown.drain_timeout']]);
  });
});

describe('[PR #44 R1-m4, PR44-SEC-03] afterCommit queue bound, signal and deadline', () => {
  it('the cap and the per-work deadline are code constants; the deadline is below the shutdown drain bound', () => {
    expect([AFTER_COMMIT_MAX_PENDING, AFTER_COMMIT_DEADLINE_MS]).toEqual([1_000, 20_000]);
    expect(AFTER_COMMIT_DEADLINE_MS).toBeLessThan(DRAIN_TIMEOUT_MS);
  });

  it('at the cap the work is not started: one api.after_commit_dropped line with value-free fields, pending stays at the cap', async () => {
    const logger = recordingLogger();
    const queue = createAfterCommitQueue(logger, { maxPending: 2 });
    const started: number[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const index of [1, 2, 3]) {
      queue.schedule(async () => {
        started.push(index);
        await held;
      }, LABEL);
    }
    expect(queue.pending).toBe(2);
    await delay(10);
    expect(started).toEqual([1, 2]);
    expect(logger.lines).toEqual([
      [AFTER_COMMIT_DROPPED_EVENT, { route: '/api/v1/quotes', operation: 'createQuote', correlation_id: 'corr-12345678', max_pending: 2 }],
    ]);
    release();
    await queue.drain();
    expect([queue.pending, started]).toEqual([0, [1, 2]]);
    // Below the cap again: new work is accepted.
    queue.schedule(() => {
      started.push(4);
    }, LABEL);
    await queue.drain();
    expect(started).toEqual([1, 2, 4]);
  });

  it('the work signal aborts when the drain starts (shutdown), and well-behaved work stops at once', async () => {
    const queue = createAfterCommitQueue(recordingLogger());
    const seen: unknown[] = [];
    queue.schedule(async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve());
      });
      seen.push(signal.reason);
    }, LABEL);
    await delay(5);
    expect(seen).toEqual([]);
    const started = Date.now();
    await queue.drain();
    expect([seen.length, seen[0] instanceof AfterCommitShutdownError, Date.now() - started < 1_000]).toEqual([1, true, true]);
  });

  it('work that ignores its signal is abandoned at its deadline: logged as failed, no longer pending, drain settles', async () => {
    const logger = recordingLogger();
    const queue = createAfterCommitQueue(logger, { deadlineMs: 30 });
    let aborted = false;
    queue.schedule((signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise<void>(() => undefined);
    }, LABEL);
    for (let attempt = 0; attempt < 200 && queue.pending > 0; attempt += 1) await delay(5);
    expect([queue.pending, aborted]).toEqual([0, true]);
    expect(logger.lines).toEqual([
      [
        AFTER_COMMIT_FAILED_EVENT,
        { route: '/api/v1/quotes', operation: 'createQuote', correlation_id: 'corr-12345678', error_class: 'AfterCommitDeadlineError' },
      ],
    ]);
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
