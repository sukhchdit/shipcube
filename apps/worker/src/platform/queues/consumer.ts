/**
 * Named-queue consumer (ADR-0013 §1, §2, §6 and amendment 1; REQ-PLAT-013, DR-A25, NFR-RES-004; US-009; TASK-035).
 *
 * One BullMQ `Worker` per named queue with a registered processor. Around the processor:
 * 1. the payload is validated against the queue's payload v2 schema (closed, no conversion); an invalid payload is a
 *    non-retryable PAYLOAD_INVALID and never reaches the processor; a payload carrying `org_id`/`actor_id` also emits
 *    the `job_context_mismatch` security event (ADR-0013 am. 1 item 2);
 * 2. the processor runs inside the job's log context, so every worker line of the job carries the payload's
 *    `correlation_id` (AT-US-008-03 job hop, D-062; the TASK-010 binding of job-context.ts);
 * 3. a failure is retried with the jittered exponential backoff (5 attempts, 2 s base) unless it is a
 *    `NonRetryableError`; on the LAST failure one redacted dead-letter record is written to `<queue>-dead` before the
 *    error reaches BullMQ, which keeps the job in its failed set as the backstop (`removeOnFail: false`).
 * Tenant context is never read from the payload: processors resolve it from PostgreSQL (TASK-047).
 */
import { securityEvent } from '@platform/shared/logging';
import {
  BACKOFF_BASE_MS,
  deadLetterQueueName,
  type JobPayloadV2,
  QUEUES,
  type QueueName,
  retryDelayMs,
  validateJobPayload,
} from '@platform/shared/queues';
import { type ConnectionOptions, type Job, Queue, Worker, type WorkerOptions } from 'bullmq';

import type { RuntimeLog } from '@platform/api/runtime';

import { runWithJobContext } from '../logging/job-context.js';
import { deadLetterRecord } from './dead-letter.js';
import { isNonRetryable, NonRetryableError } from './errors.js';

/** What a processor learns about the job besides its payload. */
export interface ProcessorJob {
  readonly queue: QueueName;
  readonly id: string;
  readonly name: string;
  /** Attempts made before this one (0 on the first). */
  readonly attemptsMade: number;
}

/** Does the job's work; throws NonRetryableError for a failure no retry can fix, anything else to retry. */
export type JobProcessor = (payload: JobPayloadV2, job: ProcessorJob) => Promise<void>;

/** Worker tuning the tests shorten (lock and stall detection); production uses the BullMQ defaults. */
export type ConsumerTuning = Pick<WorkerOptions, 'lockDuration' | 'stalledInterval' | 'maxStalledCount' | 'drainDelay'>;

export interface QueueConsumerOptions {
  readonly queue: QueueName;
  readonly processor: JobProcessor;
  readonly connection: ConnectionOptions;
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

/** Error class only: a message may carry data. */
const errorClass = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

export function createQueueConsumer(options: QueueConsumerOptions): QueueConsumer {
  const { queue, processor, log } = options;
  const definition = QUEUES[queue];
  const prefix = options.prefix === undefined ? {} : { prefix: options.prefix };
  const ownsDeadLetter = options.deadLetter === undefined;
  const deadLetter = options.deadLetter ?? new Queue(deadLetterQueueName(queue), { connection: options.connection, ...prefix });
  const retryBaseMs = options.retryBaseMs ?? BACKOFF_BASE_MS;
  const random = options.random ?? Math.random;

  /** The job's last failure: write the dead-letter record (never masking the original error). */
  async function recordFailure(job: Job, error: unknown): Promise<void> {
    const attempts = job.attemptsMade + 1;
    const final = isNonRetryable(error) || attempts >= (job.opts.attempts ?? 1);
    log.warn('worker.job_failed', {
      queue,
      jobId: job.id ?? '',
      attempt: attempts,
      final,
      reason: isNonRetryable(error) ? error.reason : 'TRANSIENT',
      error: errorClass(error),
    });
    if (!final) return;
    try {
      const record = deadLetterRecord({ queueName: queue, id: job.id, name: job.name, data: job.data }, error, attempts);
      await deadLetter.add(job.name, record, {
        ...(job.id === undefined ? {} : { jobId: job.id }),
        removeOnComplete: false,
        removeOnFail: false,
      });
      log.warn('worker.job_dead_lettered', { queue, jobId: job.id ?? '', reason: record.reason, attempts });
    } catch (writeError) {
      // The job stays in the failed set (removeOnFail: false): the backstop when the record cannot be written.
      log.error('worker.dead_letter_write_failed', { queue, jobId: job.id ?? '', error: errorClass(writeError) });
    }
  }

  async function processJob(job: Job): Promise<void> {
    const checked = validateJobPayload(definition, job.data);
    if (!checked.ok) {
      if (checked.carriesTenantContext)
        securityEvent(log, 'job_context_mismatch', { queue, job_name: job.name, job_id: job.id ?? '', reason: 'PAYLOAD_INVALID' });
      const error = new NonRetryableError('PAYLOAD_INVALID', `payload v2 refused: ${checked.issues.join(', ')}`);
      await recordFailure(job, error);
      throw error;
    }
    const { payload } = checked;
    await runWithJobContext({ correlationId: payload.correlation_id }, async () => {
      try {
        await processor(payload, { queue, id: job.id ?? '', name: job.name, attemptsMade: job.attemptsMade });
      } catch (error) {
        await recordFailure(job, error);
        throw error;
      }
    });
  }

  const worker = new Worker(queue, processJob, {
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
