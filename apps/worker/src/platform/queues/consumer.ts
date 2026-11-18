/**
 * Named-queue consumer (ADR-0013 §1, §2, §6 and amendment 1; REQ-PLAT-013, DR-A25, NFR-RES-004; US-009; TASK-035).
 *
 * One BullMQ `Worker` per named queue with a registered processor. The per-job logic (payload v2 validation, job log
 * context, retries and the dead-letter record, the sanitised error BullMQ persists) is `createJobHandler`
 * (job-handler.ts); this module wires it to the `Worker`: the jittered exponential backoff (5 attempts, 2 s base) and
 * the dead-letter queue. The `Worker` uses the blocking `worker` connection profile, every `Queue` the fail-fast
 * `queue` profile through `openQueue` (connection.ts, PR64-SEC-01/-03).
 */
import { BACKOFF_BASE_MS, deadLetterQueueName, QUEUES, type QueueName, retryDelayMs } from '@platform/shared/queues';
import { type ConnectionOptions, type Job, type Queue, Worker, type WorkerOptions } from 'bullmq';

import type { RuntimeLog } from '@platform/api/runtime';

import { createJobHandler, errorClass, type JobProcessor } from './job-handler.js';
import { openQueue } from './open-queue.js';

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
  /** First retry delay; default 2 s (BACKOFF_BASE_MS). Tests shorten it. */
  readonly retryBaseMs?: number;
  /** Uniform draw in [0, 1) for the backoff jitter (test seam). */
  readonly random?: () => number;
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

export function createQueueConsumer(options: QueueConsumerOptions): QueueConsumer {
  const { queue, processor, log } = options;
  const definition = QUEUES[queue];
  const prefix = options.prefix === undefined ? {} : { prefix: options.prefix };
  const ownsDeadLetter = options.deadLetter === undefined;
  const deadLetter = options.deadLetter ?? openQueue(deadLetterQueueName(queue), { connection: options.queueConnection, ...prefix }, log);
  const retryBaseMs = options.retryBaseMs ?? BACKOFF_BASE_MS;
  const random = options.random ?? Math.random;
  const handle = createJobHandler({ queue, processor, log, deadLetter });

  const worker = new Worker(queue, (job: Job) => handle(job), {
    connection: options.connection,
    ...prefix,
    autorun: options.autorun ?? false,
    concurrency: options.concurrency ?? definition.concurrency,
    settings: { backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade, retryBaseMs, random) },
    ...options.tuning,
  });
  // Connection errors surface here (and reconnect); without a listener Node would treat them as unhandled.
  worker.on('error', (error) => log.warn('worker.queue_error', { queue, error: errorClass(error) }));

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
