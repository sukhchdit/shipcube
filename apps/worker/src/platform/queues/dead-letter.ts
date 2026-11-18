/**
 * Dead-letter records (ADR-0013 §1; REQ-PLAT-013, NFR-RES-004; AT-US-009-02/04; TASK-035). When a job fails for the
 * last time (attempts exhausted, or a non-retryable failure) the consumer writes one record to the queue's
 * dead-letter queue BEFORE BullMQ marks the job failed: the job data deep-redacted (sensitive and personal keys become
 * `[REDACTED]`, strings pass the string redactor), the failure reason, the error class and the attempt count. The job
 * itself stays in the failed set (`removeOnFail: false`), the backstop when the record cannot be written.
 */
import { redactString, redactValue } from '@platform/shared/logging';

import { isNonRetryable, nonRetryableReason } from './errors.js';

/** Reason of a transient failure whose retries are exhausted. */
export const RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED';

/**
 * The BullMQ job id of the dead-letter record of a job's final attempt (R1-M1, PR64-SEC-08). It is namespaced
 * (`<job id>.dead.<attempts>`), so it is never an integer (BullMQ refuses an integer custom id, and a job enqueued
 * without a custom id has an auto-increment one) and it keeps the part count of a `:` id (BullMQ allows `:` only in
 * exactly three parts). It is deterministic: a final attempt re-delivered after a crash (same attempt number) is one
 * record, not two. A later final failure of the same job, after an operator retry, has a higher attempt number and so
 * its own record (unless the retry reset the attempt count: that record is then a duplicate id, BullMQ ignores the
 * add, and the failed set still holds the job). `undefined` lets BullMQ assign the id of a job that has none.
 */
export function deadLetterJobId(jobId: string | undefined, attempts: number): string | undefined {
  return jobId === undefined || jobId === '' ? undefined : `${jobId}.dead.${String(attempts)}`;
}
/** Upper bound on the redacted failure message kept in a record. */
export const MAX_FAILURE_MESSAGE = 500;

export interface DeadLetterRecord {
  readonly v: 1;
  readonly queue: string;
  readonly job_id: string;
  readonly job_name: string;
  /** `NonRetryableReason`, or RETRIES_EXHAUSTED. */
  readonly reason: string;
  /** Error class name. */
  readonly error: string;
  /** Redacted, truncated error message. */
  readonly message: string;
  /** Attempts made, the failing one included. */
  readonly attempts: number;
  readonly failed_at: string;
  /** The job data, deep-redacted. */
  readonly data: unknown;
}

export interface FailedJob {
  readonly queueName: string;
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redactString(text).slice(0, MAX_FAILURE_MESSAGE);
}

export function deadLetterRecord(job: FailedJob, error: unknown, attempts: number, now: Date = new Date()): DeadLetterRecord {
  return {
    v: 1,
    queue: job.queueName,
    job_id: job.id ?? '',
    job_name: job.name,
    reason: nonRetryableReason(error) ?? RETRIES_EXHAUSTED,
    error: isNonRetryable(error) ? 'NonRetryableError' : errorName(error),
    message: errorMessage(error),
    attempts,
    failed_at: now.toISOString(),
    data: redactValue(job.data),
  };
}
