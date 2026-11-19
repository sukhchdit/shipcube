// Unit tests of the retention bounds (ADR-0013 am. 3 items 9, 10, 12; PR64-SEC-04, D-ARCH-159/160; TASK-039) with fake
// queues: the record count trim (never a limit of 0), the hourly sweep's calls, repetition, logging and failure
// handling, and the dead-lettered counter's series. consumer.int.test.ts runs them against Valkey 8.
import { createRuntimeLog } from '@platform/api/runtime';
import { describe, expect, it } from '@jest/globals';
import { QUEUE_NAMES, type QueueName } from '@platform/shared/queues';

import { createDeadLetteredCounter, renderQueueMetrics, type QueueMetrics } from './metrics.js';
import {
  type CleanableQueue,
  PRODUCTION_RETENTION,
  RetentionSweepError,
  sweepRetention,
  SWEEP_BATCH,
  SWEEP_MAX_ROUNDS,
  trimDeadLetter,
} from './retention.js';

interface FakeQueue extends CleanableQueue {
  readonly calls: [number, number, string][];
}

/** A queue holding `depth` waiting records and answering each clean with `answer(call)` ids. */
function fakeQueue(depth: number, answer: (grace: number, limit: number, type: string, call: number) => number = () => 0): FakeQueue {
  const calls: [number, number, string][] = [];
  let waiting = depth;
  return {
    calls,
    getWaitingCount: () => Promise.resolve(waiting),
    clean: (grace, limit, type) => {
      calls.push([grace, limit, type]);
      const removed = Math.min(
        answer(grace, limit, type, calls.length),
        type === 'wait' && grace === 0 ? waiting : Number.MAX_SAFE_INTEGER,
      );
      if (type === 'wait') waiting -= removed;
      return Promise.resolve(Array.from({ length: removed }, (_unused, index) => String(index)));
    },
  };
}

function capture() {
  const raw: string[] = [];
  const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
  return {
    log,
    lines: (): Record<string, unknown>[] =>
      raw
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('[PR64-SEC-04] dead-letter count trim (ADR-0013 am. 3 item 9)', () => {
  it('removes exactly the oldest surplus above the bound', async () => {
    const queue = fakeQueue(2_005, (_grace, limit) => limit);
    expect(await trimDeadLetter(queue, 2_000)).toBe(5);
    expect(queue.calls).toEqual([[0, 5, 'wait']]);
  });

  it('makes no clean call at or below the bound: BullMQ reads a limit of 0 as "no limit" and would remove every record', async () => {
    for (const depth of [0, 1_999, 2_000]) {
      const queue = fakeQueue(depth, () => {
        throw new Error('clean must not be called');
      });
      expect(await trimDeadLetter(queue, 2_000)).toBe(0);
      expect(queue.calls).toEqual([]);
    }
  });
});

describe('[PR64-SEC-04] hourly queue-retention sweep (ADR-0013 am. 3 item 10)', () => {
  it('cleans failed (7 d), completed (24 h) and aged records (14 d), then trims the count, on every queue; one log line per run', async () => {
    const jobs = fakeQueue(0);
    const deadLetter = fakeQueue(2_003, (grace, limit) => (grace === 0 ? limit : 0));
    const { log, lines } = capture();
    const result = await sweepRetention({ sources: [{ queue: 'booking', jobs, deadLetter }], bounds: PRODUCTION_RETENTION, log });
    expect(jobs.calls).toEqual([
      [604_800_000, SWEEP_BATCH, 'failed'],
      [86_400_000, SWEEP_BATCH, 'completed'],
    ]);
    expect(deadLetter.calls).toEqual([
      [1_209_600_000, SWEEP_BATCH, 'wait'],
      [0, 3, 'wait'],
    ]);
    expect(result).toEqual({ failed: 0, completed: 0, deadLetterAged: 0, deadLetterTrimmed: 3, failedQueues: [] });
    expect(lines().filter((line) => line['event'] === 'worker.queue_retention_swept')).toEqual([
      expect.objectContaining({ failed: 0, completed: 0, deadLetterAged: 0, deadLetterTrimmed: 3, queues: 1, failedQueues: 0 }),
    ]);
  });

  it('repeats a call while it removed exactly its limit, at most 10 times per queue and set', async () => {
    const always = fakeQueue(0, (_grace, limit, type) => (type === 'failed' ? limit : 0));
    const twice = fakeQueue(0, (_grace, limit, type, call) => (type === 'completed' && call <= SWEEP_MAX_ROUNDS + 2 ? limit : 0));
    const { log } = capture();
    const result = await sweepRetention({
      sources: [
        { queue: 'booking', jobs: always, deadLetter: fakeQueue(0) },
        { queue: 'payments', jobs: twice, deadLetter: fakeQueue(0) },
      ],
      bounds: PRODUCTION_RETENTION,
      log,
      batch: 3,
    });
    expect(always.calls.filter(([, , type]) => type === 'failed')).toHaveLength(SWEEP_MAX_ROUNDS);
    expect(result.failed).toBe(3 * SWEEP_MAX_ROUNDS);
    expect(result.completed).toBeGreaterThan(0);
  });

  it('logs a failing queue by error class, sweeps the next queue, then fails the run so BullMQ retries it', async () => {
    const broken: CleanableQueue = {
      clean: () => Promise.reject(new TypeError('connection lost: secret-ish text')),
      getWaitingCount: () => Promise.resolve(0),
    };
    const next = fakeQueue(0);
    const { log, lines } = capture();
    const run = sweepRetention({
      sources: [
        { queue: 'booking', jobs: broken, deadLetter: fakeQueue(0) },
        { queue: 'payments', jobs: next, deadLetter: fakeQueue(0) },
      ],
      bounds: PRODUCTION_RETENTION,
      log,
    });
    await expect(run).rejects.toBeInstanceOf(RetentionSweepError);
    expect(next.calls).toHaveLength(2);
    expect(lines()).toContainEqual(
      expect.objectContaining({ event: 'worker.queue_retention_failed', queue: 'booking', error: 'TypeError' }),
    );
    expect(JSON.stringify(lines())).not.toContain('secret-ish');
    expect(lines()).toContainEqual(expect.objectContaining({ event: 'worker.queue_retention_swept', failedQueues: 1 }));
  });
});

describe('[D-ARCH-160] platform_queue_dead_lettered_total', () => {
  const zero = (queue: QueueName): QueueMetrics => ({
    queue,
    counts: { waiting: 0, active: 0, delayed: 0, prioritized: 0, completed: 0, failed: 0 },
    deadLetter: 0,
  });

  it('has the nine series at 0 before any failure, as a counter beside the two canonical gauges', () => {
    const counter = createDeadLetteredCounter(QUEUE_NAMES);
    const text = renderQueueMetrics(QUEUE_NAMES.map(zero), counter);
    expect(text).toContain('# TYPE platform_queue_dead_lettered_total counter\n');
    expect(text.match(/^platform_queue_dead_lettered_total\{queue="[a-z-]+"\} 0$/gmu)).toHaveLength(9);
    expect(text).toContain('# TYPE platform_queue_jobs gauge\n');
    expect(text).toContain('# TYPE platform_queue_dead_letter_jobs gauge\n');
    expect(text).not.toContain('bullmq_');
  });

  it('+1 per final failure of a queue; an unknown queue changes nothing', () => {
    const counter = createDeadLetteredCounter(QUEUE_NAMES);
    counter.inc('booking');
    counter.inc('booking');
    counter.inc('nope' as QueueName);
    const text = renderQueueMetrics(QUEUE_NAMES.map(zero), counter);
    expect(text).toContain('platform_queue_dead_lettered_total{queue="booking"} 2\n');
    expect(text).toContain('platform_queue_dead_lettered_total{queue="payments"} 0\n');
    expect(text).not.toContain('nope');
  });
});
