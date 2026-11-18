/**
 * The per-job logic around a processor (ADR-0013 §2, §6 and amendment 1; REQ-PLAT-013, DR-A25; US-009; TASK-035),
 * separate from the BullMQ `Worker` wiring so it runs under unit test with fakes:
 * 1. the payload is validated against the queue's payload v2 schema (closed, no conversion); an invalid payload is a
 *    non-retryable PAYLOAD_INVALID and never reaches the processor; a payload carrying `org_id`/`actor_id` also emits
 *    the `job_context_mismatch` security event (ADR-0013 am. 1 item 2);
 * 2. the processor runs inside the job's log context, so every worker line of the job carries the payload's
 *    `correlation_id` (AT-US-008-03 job hop, D-062; the TASK-010 binding of job-context.ts);
 * 3. a failure is retried (BullMQ, jittered backoff) unless it is non-retryable (`NonRetryableError`, or BullMQ's own
 *    `UnrecoverableError`); on the LAST failure one redacted dead-letter record is written before the error reaches
 *    BullMQ, which keeps the job in its failed set as the backstop (`removeOnFail: false`);
 * 4. BullMQ only ever sees a SANITISED error (PR64-SEC-02, T-74): it persists `failedReason` (the message) and the
 *    stack of every failed attempt in the job hash, forever. Processor errors carry database, carrier and validation
 *    text, so what is rethrown is a fresh error with the reason code only and no frames; the original goes to the
 *    redacted log (class only) and the redacted dead-letter record. A refused payload's stored data is replaced by its
 *    redacted form.
 * Tenant context is never read from the payload: processors resolve it from PostgreSQL (TASK-047).
 */
import { redactValue, securityEvent } from '@platform/shared/logging';
import { type JobPayloadV2, QUEUES, type QueueName, validateJobPayload } from '@platform/shared/queues';

import type { RuntimeLog } from '@platform/api/runtime';

import { runWithJobContext } from '../logging/job-context.js';
import { type DeadLetterRecord, deadLetterJobId, deadLetterRecord } from './dead-letter.js';
import { NonRetryableError, nonRetryableReason } from './errors.js';

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

/** The part of a BullMQ `Job` the handler uses. */
export interface HandledJob {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
  readonly attemptsMade: number;
  readonly opts: { readonly attempts?: number | undefined };
  updateData(data: unknown): Promise<void>;
}

/** The part of the dead-letter `Queue` the handler uses. */
export interface DeadLetterSink {
  add(
    name: string,
    record: DeadLetterRecord,
    options: { readonly jobId?: string; readonly removeOnComplete: false; readonly removeOnFail: false },
  ): Promise<unknown>;
}

export interface JobHandlerOptions {
  readonly queue: QueueName;
  readonly processor: JobProcessor;
  readonly log: RuntimeLog;
  readonly deadLetter: DeadLetterSink;
}

/** Error class only: a message may carry data. */
export const errorClass = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/**
 * What BullMQ persists (`failedReason`, `stacktrace`) for a failed attempt: the reason code only, no message text and
 * no frames. A non-retryable failure stays an `UnrecoverableError` (BullMQ's retry decision is unchanged); anything
 * else is a plain transient `Error`.
 */
export function persistedFailure(error: unknown): Error {
  const reason = nonRetryableReason(error);
  const failure = reason === undefined ? new Error('TRANSIENT') : new NonRetryableError(reason, reason);
  failure.stack = `${failure.name}: ${failure.message}`;
  return failure;
}

export function createJobHandler(options: JobHandlerOptions): (job: HandledJob) => Promise<void> {
  const { queue, processor, log, deadLetter } = options;
  const definition = QUEUES[queue];

  /** The job's last failure: write the dead-letter record (never masking the original error). */
  async function recordFailure(job: HandledJob, error: unknown): Promise<void> {
    const attempts = job.attemptsMade + 1;
    const reason = nonRetryableReason(error);
    const final = reason !== undefined || attempts >= (job.opts.attempts ?? 1);
    log.warn('worker.job_failed', {
      queue,
      jobId: job.id ?? '',
      attempt: attempts,
      final,
      reason: reason ?? 'TRANSIENT',
      error: errorClass(error),
    });
    if (!final) return;
    try {
      const record = deadLetterRecord({ queueName: queue, id: job.id, name: job.name, data: job.data }, error, attempts);
      const jobId = deadLetterJobId(job.id, attempts);
      await deadLetter.add(job.name, record, {
        ...(jobId === undefined ? {} : { jobId }),
        removeOnComplete: false,
        removeOnFail: false,
      });
      log.warn('worker.job_dead_lettered', { queue, jobId: job.id ?? '', reason: record.reason, attempts });
    } catch (writeError) {
      // The job stays in the failed set (removeOnFail: false): the backstop when the record cannot be written.
      log.error('worker.dead_letter_write_failed', { queue, jobId: job.id ?? '', error: errorClass(writeError) });
    }
  }

  /** The failed-set copy of a refused payload is the redacted one (it may carry what a forger put there). */
  async function redactStoredData(job: HandledJob): Promise<void> {
    try {
      await job.updateData(redactValue(job.data));
    } catch (error) {
      // Must not turn the final refusal into a retry of the raw data: log and fall through to the final error.
      log.error('worker.job_data_redact_failed', { queue, jobId: job.id ?? '', error: errorClass(error) });
    }
  }

  return async function handle(job) {
    const checked = validateJobPayload(definition, job.data);
    if (!checked.ok) {
      if (checked.carriesTenantContext)
        securityEvent(log, 'job_context_mismatch', { queue, job_name: job.name, job_id: job.id ?? '', reason: 'PAYLOAD_INVALID' });
      const error = new NonRetryableError('PAYLOAD_INVALID', `payload v2 refused: ${checked.issues.join(', ')}`);
      await recordFailure(job, error);
      await redactStoredData(job);
      throw persistedFailure(error);
    }
    const { payload } = checked;
    await runWithJobContext({ correlationId: payload.correlation_id }, async () => {
      try {
        await processor(payload, { queue, id: job.id ?? '', name: job.name, attemptsMade: job.attemptsMade });
      } catch (error) {
        await recordFailure(job, error);
        throw persistedFailure(error);
      }
    });
  };
}
