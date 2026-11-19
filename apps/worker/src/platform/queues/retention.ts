/**
 * Bounded retention under `maxmemory-policy noeviction` (ADR-0013 amendment 3 items 8-10; PR64-SEC-04, T-77;
 * D-ARCH-159; TASK-039). Two mechanisms on the `Queue` instances the worker queue runtime owns (it constructs no
 * `Queue` of its own, PR64-SEC-13):
 *
 * - `trimDeadLetter`: the count trim of one dead-letter queue, run by the consumer after each record write and by the
 *   sweep. It removes the oldest surplus above the count bound with `clean(0, surplus, 'wait')`, and only for a surplus
 *   of 1 or more: BullMQ reads a limit of 0 as "no limit" (6.7.0 `Queue.clean`: `limit || Infinity`) and would remove
 *   every record.
 * - `sweepRetention`: the hourly `queue-retention` job. BullMQ applies an age bound only when another job of the queue
 *   finishes, so on a quiet queue an aged job would stay; the sweep makes the ages true. Per named queue: failed jobs
 *   older than the failed age, completed jobs older than the completed age, dead-letter records older than the record
 *   age, then the record count trim. Each `clean` call removes at most `batch` and is repeated while it removed exactly
 *   `batch`, at most `maxRounds` times per queue and set. One log line per run with the numbers removed; a failure on
 *   one queue is logged (error class only) and the sweep goes on, then the run fails so BullMQ retries it.
 */
import { COMPLETED_RETENTION, DEAD_LETTER_RETENTION, FAILED_RETENTION, type QueueName, type RetentionBound } from '@platform/shared/queues';

import type { RuntimeLog } from '@platform/api/runtime';

/** The three bounds (ages in seconds). Production uses the ADR constants; the integration suite passes small ones. */
export interface RetentionBounds {
  readonly completed: RetentionBound;
  readonly failed: RetentionBound;
  readonly deadLetter: RetentionBound;
}

export const PRODUCTION_RETENTION: RetentionBounds = Object.freeze({
  completed: COMPLETED_RETENTION,
  failed: FAILED_RETENTION,
  deadLetter: DEAD_LETTER_RETENTION,
});

/** Jobs one sweep `clean` call removes at most (ADR-0013 am. 3 item 10). */
export const SWEEP_BATCH = 1_000;
/** Calls per queue and set in one sweep run. */
export const SWEEP_MAX_ROUNDS = 10;

/** The part of a BullMQ `Queue` retention uses. */
export interface CleanableQueue {
  clean(grace: number, limit: number, type: 'completed' | 'failed' | 'wait'): Promise<string[]>;
  getWaitingCount(): Promise<number>;
}

/** Removes the oldest records above `count`; returns the number removed (0 when at or below the bound). */
export async function trimDeadLetter(deadLetter: CleanableQueue, count: number): Promise<number> {
  const depth = await deadLetter.getWaitingCount();
  const surplus = depth - count;
  if (!Number.isSafeInteger(surplus) || surplus < 1) return 0;
  return (await deadLetter.clean(0, surplus, 'wait')).length;
}

/** `clean` repeated while it removed exactly `batch`, at most `maxRounds` times; the total removed. */
async function cleanAged(
  queue: CleanableQueue,
  graceMs: number,
  type: 'completed' | 'failed' | 'wait',
  batch: number,
  maxRounds: number,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const removed = (await queue.clean(graceMs, batch, type)).length;
    total += removed;
    if (removed < batch) break;
  }
  return total;
}

/** The count trim repeated while the depth is still above the bound, at most `maxRounds` times. */
async function trimRepeated(deadLetter: CleanableQueue, count: number, maxRounds: number): Promise<number> {
  let total = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const removed = await trimDeadLetter(deadLetter, count);
    total += removed;
    if (removed === 0) break;
  }
  return total;
}

export interface RetentionSource {
  readonly queue: QueueName;
  readonly jobs: CleanableQueue;
  readonly deadLetter: CleanableQueue;
}

export interface SweepResult {
  readonly failed: number;
  readonly completed: number;
  readonly deadLetterAged: number;
  readonly deadLetterTrimmed: number;
  /** Queues whose sweep failed (logged one by one). */
  readonly failedQueues: readonly QueueName[];
}

export interface SweepOptions {
  readonly sources: readonly RetentionSource[];
  readonly bounds: RetentionBounds;
  readonly log: RuntimeLog;
  /** Test seams. */
  readonly batch?: number;
  readonly maxRounds?: number;
}

/** Thrown at the end of a run in which a queue failed, so BullMQ retries the job (a transient failure). */
export class RetentionSweepError extends Error {
  constructor(readonly failedQueues: readonly QueueName[]) {
    super(`queue retention sweep failed on ${String(failedQueues.length)} queue(s)`);
    this.name = 'RetentionSweepError';
  }
}

/** One sweep run over every source; never stops at a failing queue. Rejects with RetentionSweepError after logging. */
export async function sweepRetention(options: SweepOptions): Promise<SweepResult> {
  const { sources, bounds, log } = options;
  const batch = options.batch ?? SWEEP_BATCH;
  const maxRounds = options.maxRounds ?? SWEEP_MAX_ROUNDS;
  const totals = { failed: 0, completed: 0, deadLetterAged: 0, deadLetterTrimmed: 0 };
  const failedQueues: QueueName[] = [];
  for (const { queue, jobs, deadLetter } of sources) {
    try {
      totals.failed += await cleanAged(jobs, bounds.failed.age * 1_000, 'failed', batch, maxRounds);
      totals.completed += await cleanAged(jobs, bounds.completed.age * 1_000, 'completed', batch, maxRounds);
      totals.deadLetterAged += await cleanAged(deadLetter, bounds.deadLetter.age * 1_000, 'wait', batch, maxRounds);
      totals.deadLetterTrimmed += await trimRepeated(deadLetter, bounds.deadLetter.count, maxRounds);
    } catch (error) {
      failedQueues.push(queue);
      log.error('worker.queue_retention_failed', { queue, error: error instanceof Error ? error.name : typeof error });
    }
  }
  log.info('worker.queue_retention_swept', { ...totals, queues: sources.length, failedQueues: failedQueues.length });
  if (failedQueues.length > 0) throw new RetentionSweepError(failedQueues);
  return { ...totals, failedQueues };
}
