/**
 * Named-queue consumer (ADR-0013 §1, §2, §6, amendments 1 and 3; REQ-PLAT-013, DR-A25, NFR-RES-004; US-009, US-010;
 * TASK-035, TASK-039).
 *
 * One BullMQ `Worker` per named queue with a registered processor. The per-job logic (dequeue validation, job log
 * context, per-job deadline, retries and the dead-letter record, the sanitised error BullMQ persists) is
 * `createJobHandler` (job-handler.ts); this module wires it to the `Worker`: the jittered exponential backoff (5
 * attempts, 2 s base), the dead-letter queue, the retention defaults (COMPLETED_RETENTION and FAILED_RETENTION as the
 * `Worker`'s `removeOnComplete` / `removeOnFail`, which BullMQ applies to a job that carries no option of its own,
 * ADR-0013 am. 3 item 8) and the record of a job BullMQ fails itself after too many stalls (PR64-SEC-08). The `Worker`
 * uses the blocking `worker` connection profile, every `Queue` the fail-fast `queue` profile through `openQueue`
 * (connection.ts, PR64-SEC-01/-03).
 */
import { BACKOFF_BASE_MS, deadLetterQueueName, QUEUES, type QueueName, retryDelayMs } from '@platform/shared/queues';
import { type ConnectionOptions, type Job, type Queue, Worker, type WorkerOptions } from 'bullmq';

import type { RuntimeLog } from '@platform/api/runtime';

import { createJobHandler, createStalledFailureRecorder, errorClass, type JobProcessor } from './job-handler.js';
import { openQueue } from './open-queue.js';
import { PRODUCTION_RETENTION, type RetentionBounds } from './retention.js';

export type { JobProcessor, ProcessorJob } from './job-handler.js';

/** Worker tuning the tests shorten (lock and stall detection); production uses the BullMQ defaults. */
export type ConsumerTuning = Pick<WorkerOptions, 'lockDuration' | 'stalledInterval' | 'maxStalledCount' | 'drainDelay'>;

export interface QueueConsumerOptions {
  readonly queue: QueueName;
  readonly processor: JobProcessor;
  /** The `worker` connection profile (blocking commands): for the BullMQ `Worker` only. */
  readonly connection: ConnectionOptions;
  /** The fail-fast `queue` connection profile: for the consumer-owned dead-letter queue. */
  readonly queueConnection: ConnectionOptions;
  readonly log: RuntimeLog;
  /** Where the dead-letter records go (shared with the metrics); a consumer-owned queue when absent. */
  readonly deadLetter?: Queue;
  /** `platform_queue_dead_lettered_total` (D-ARCH-160). */
  readonly onDeadLettered?: (queue: QueueName) => void;
  /** Retention bounds; default the ADR-0013 am. 3 constants. Tests use small bounds, as they shorten retryBaseMs. */
  readonly retention?: RetentionBounds;
  /** First retry delay; default 2 s (BACKOFF_BASE_MS). Tests shorten it. */
  readonly retryBaseMs?: number;
  /** Uniform draw in [0, 1) for the backoff jitter (test seam). */
  readonly random?: () => number;
  /** Per-job deadline (test seam; default DEFAULT_JOB_DEADLINE_MS). */
  readonly deadlineMs?: number;
  /** Default: the queue's ADR-0013 §6 concurrency. */
  readonly concurrency?: number;
  readonly tuning?: ConsumerTuning;
  /** Start taking jobs at once (default false: `start()` after the start-up checks). */
  readonly autorun?: boolean;
  readonly prefix?: string;
}

export interface QueueConsumer {
  readonly queue: QueueName;
  readonly worker: Worker;
  /** Starts taking jobs (idempotent). */
  start(): void;
  /** Stops taking jobs and waits for the active ones; `force` abandons them (they stall and are re-delivered). */
  close(force?: boolean): Promise<void>;
}

/** True for a job BullMQ failed itself before any processor ran (6.7.0: stalled more than `maxStalledCount`). */
export function isDeferredFailure(job: unknown): boolean {
  const deferred = (job as { deferredFailure?: unknown } | undefined)?.deferredFailure;
  return typeof deferred === 'string' && deferred !== '';
}

export function createQueueConsumer(options: QueueConsumerOptions): QueueConsumer {
  const { queue, processor, log } = options;
  const definition = QUEUES[queue];
  const retention = options.retention ?? PRODUCTION_RETENTION;
  const prefix = options.prefix === undefined ? {} : { prefix: options.prefix };
  const ownsDeadLetter = options.deadLetter === undefined;
  const deadLetter = options.deadLetter ?? openQueue(deadLetterQueueName(queue), { connection: options.queueConnection, ...prefix }, log);
  const retryBaseMs = options.retryBaseMs ?? BACKOFF_BASE_MS;
  const random = options.random ?? Math.random;
  const shared = {
    queue,
    log,
    deadLetter,
    deadLetterCount: retention.deadLetter.count,
    ...(options.onDeadLettered === undefined ? {} : { onDeadLettered: options.onDeadLettered }),
  };
  const handle = createJobHandler({
    ...shared,
    processor,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  });
  const recordStalled = createStalledFailureRecorder(shared);

  const worker = new Worker(queue, (job: Job) => handle(job), {
    connection: options.connection,
    ...prefix,
    autorun: options.autorun ?? false,
    concurrency: options.concurrency ?? definition.concurrency,
    settings: { backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade, retryBaseMs, random) },
    removeOnComplete: { ...retention.completed },
    removeOnFail: { ...retention.failed },
    ...options.tuning,
  });
  // Connection errors surface here (and reconnect); without a listener Node would treat them as unhandled.
  worker.on('error', (error) => log.warn('worker.queue_error', { queue, error: errorClass(error) }));
  // The handler records every failure it sees; a job BullMQ failed itself (too many stalls) never reached it.
  worker.on('failed', (job) => {
    if (job !== undefined && isDeferredFailure(job)) void recordStalled(job);
  });

  let started = false;
  return {
    queue,
    worker,
    start() {
      if (started) return;
      started = true;
      void worker.run().catch((error: unknown) => log.error('worker.queue_run_failed', { queue, error: errorClass(error) }));
    },
    async close(force = false) {
      await worker.close(force);
      if (ownsDeadLetter) await deadLetter.close();
    },
  };
}
