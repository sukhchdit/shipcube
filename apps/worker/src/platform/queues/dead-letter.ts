/**
 * Dead-letter records (ADR-0013 §1; REQ-PLAT-013, NFR-RES-004; AT-US-009-02/04; TASK-035). When a job fails for the
 * last time (attempts exhausted, or a non-retryable failure) the consumer writes one record to the queue's
 * dead-letter queue BEFORE BullMQ marks the job failed: the job data deep-redacted (sensitive and personal keys become
 * `[REDACTED]`, strings pass the string redactor), the failure reason, the error class and the attempt count. The job
 * itself stays in the failed set (`removeOnFail: false`), the backstop when the record cannot be written.
 */
import { redactString, redactValue } from '@platform/shared/logging';

import { isNonRetryable } from './errors.js';

/** Reason of a transient failure whose retries are exhausted. */
export const RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED';
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
    reason: isNonRetryable(error) ? error.reason : RETRIES_EXHAUSTED,
    error: isNonRetryable(error) ? 'NonRetryableError' : errorName(error),
    message: errorMessage(error),
    attempts,
    failed_at: now.toISOString(),
    data: redactValue(job.data),
  };
}
