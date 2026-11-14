// The afterCommit queue (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4); TASK-020 part 020-C (a)): best effort, failures
// logged as api.after_commit_failed with route metadata only, and pending work drained at shutdown inside the window.
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from '@jest/globals';

import { createShutdown } from '../runtime/shutdown.js';
import { AFTER_COMMIT_FAILED_EVENT, createAfterCommitQueue } from './after-commit.js';

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
