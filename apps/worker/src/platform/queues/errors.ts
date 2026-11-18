/**
 * Non-retryable job failures (ADR-0013 §2, DR-A25, EC-A38; REQ-PLAT-013; TASK-035). A processor throws
 * `NonRetryableError` for a failure no retry can fix: the job skips its remaining attempts (BullMQ treats an
 * `UnrecoverableError` as final) and goes to the dead-letter queue at once. Any other error is transient and retried.
 */
import { UnrecoverableError } from 'bullmq';

/** Why a job cannot succeed on retry; the dead-letter record carries the reason. */
export const NON_RETRYABLE_REASONS = [
  /** The payload failed the queue's payload v2 schema at dequeue (ADR-0013 am. 1 item 3). */
  'PAYLOAD_INVALID',
  /** The job has no (valid) tenant context: missing or invalid org (EC-A38). */
  'MISSING_TENANT_CONTEXT',
  /** `platform.job_context(kind, id)` found no row (ADR-0013 am. 1 item 2; TASK-047). */
  'JOB_CONTEXT_NOT_FOUND',
  /** The job's data failed a business validation rule. */
  'VALIDATION_ERROR',
  /** The resolved actor may not perform the job's action. */
  'PERMISSION_DENIED',
  /** No processor is registered for the job's queue in this worker. */
  'NO_PROCESSOR',
  /** A processor threw BullMQ's own UnrecoverableError (or an error named so) without one of the reasons above. */
  'UNRECOVERABLE',
] as const;
export type NonRetryableReason = (typeof NON_RETRYABLE_REASONS)[number];

export class NonRetryableError extends UnrecoverableError {
  readonly reason: NonRetryableReason;

  constructor(reason: NonRetryableReason, message: string = reason) {
    super(message);
    // BullMQ also recognises the class by this name (job.shouldRetryJob), across module realms.
    this.name = 'UnrecoverableError';
    this.reason = reason;
  }
}

export function isNonRetryable(error: unknown): error is NonRetryableError {
  return error instanceof NonRetryableError;
}

/**
 * BullMQ's own predicate (`Job.shouldRetryJob`): an `UnrecoverableError`, or any error named so, is final at once. The
 * consumer mirrors it so such a failure is dead-lettered, whichever class a processor threw (R1-m2).
 */
export function isUnrecoverable(error: unknown): boolean {
  if (error instanceof UnrecoverableError) return true;
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'UnrecoverableError';
}

/** The reason of a failure that skips the remaining attempts, or undefined for a transient one. */
export function nonRetryableReason(error: unknown): NonRetryableReason | undefined {
  if (isNonRetryable(error)) return error.reason;
  return isUnrecoverable(error) ? 'UNRECOVERABLE' : undefined;
}
