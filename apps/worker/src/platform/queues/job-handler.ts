/**
 * The per-job logic around a processor (ADR-0013 §2, §5, §6, amendments 1 and 3; REQ-PLAT-013, DR-A25; US-009,
 * US-010; TASK-035, TASK-039), separate from the BullMQ `Worker` wiring so it runs under unit test with fakes:
 * 1. the job is validated at dequeue (`validateDequeuedJob`): its payload against the queue's closed schema (payload v2,
 *    or the schedule payload of a scheduled job, D-TASK039-01) AND its identity against the payload (id `<kind>.<id>`
 *    and name = kind, or `repeat:<schedule>:<millis>` and name = schedule; PR64-SEC-07). A refused job is a
 *    non-retryable PAYLOAD_INVALID and never reaches the processor; tenant context in any spelling or depth, or an own
 *    `__proto__`, also emits the `job_context_mismatch` security event (ADR-0013 am. 1 item 2; PR64-SEC-06);
 * 2. the processor runs inside the job's log context (the payload's `correlation_id`, or the occurrence of a scheduled
 *    job), with a per-job deadline: an AbortSignal that fires after `deadlineMs`, when the handler stops waiting and
 *    fails the attempt as transient, so a hung processor cannot hold a worker slot (PR64-SEC-07);
 * 3. a failure is retried (BullMQ, jittered backoff) unless it is non-retryable (`NonRetryableError`, or BullMQ's own
 *    `UnrecoverableError`); on the LAST failure one redacted dead-letter record is written before the error reaches
 *    BullMQ. The final failure counts in `platform_queue_dead_lettered_total`; `worker.job_dead_lettered` is logged only
 *    when the add created the record (an add whose id exists is ignored by BullMQ, PR64-SEC-08); then the dead-letter
 *    queue is trimmed to its count bound (ADR-0013 am. 3 item 9). BullMQ keeps the failed job, bounded by
 *    FAILED_RETENTION, as the retry handle and the backstop of the record;
 * 4. BullMQ only ever sees a SANITISED error (PR64-SEC-02, T-74): what is rethrown is a fresh error with the reason
 *    code only and no frames; the original goes to the redacted log (class only) and the redacted dead-letter record.
 *    A refused payload's stored data is replaced by its redacted form.
 * A job BullMQ fails itself (stalled more than `maxStalledCount`, no processor ran) is recorded by
 * `recordStalledFailure`, which the consumer calls from its `failed` listener (PR64-SEC-08).
 * Tenant context is never read from the payload: processors resolve it from PostgreSQL (TASK-047); until then the
 * processors registered here are SYSTEM-scope.
 */
import { CORRELATION_ID_PATTERN } from '@platform/shared';
import { redactValue, securityEvent } from '@platform/shared/logging';
import { DEAD_LETTER_RETENTION, type JobPayload, QUEUES, type QueueName, validateDequeuedJob } from '@platform/shared/queues';

import type { RuntimeLog } from '@platform/api/runtime';

import { runWithJobContext } from '../logging/job-context.js';
import { type DeadLetterRecord, deadLetterJobId, deadLetterRecord } from './dead-letter.js';
import { NonRetryableError, nonRetryableReason } from './errors.js';
import { trimDeadLetter } from './retention.js';

/** What a processor learns about the job besides its payload. */
export interface ProcessorJob {
  readonly queue: QueueName;
  /** The BullMQ job id: `<kind>.<id>[.<step>]`, or `repeat:<schedule>:<millis>` for a scheduled job. */
  readonly id: string;
  readonly name: string;
  /** Attempts made before this one (0 on the first). */
  readonly attemptsMade: number;
  /** The correlation id every log line of the job carries. */
  readonly correlationId: string;
  /** Aborted when the job's deadline passes; a processor passes it to its I/O and stops early (PR64-SEC-07). */
  readonly signal: AbortSignal;
}

/**
 * Does the job's work; throws NonRetryableError for a failure no retry can fix, anything else to retry. BullMQ's
 * control-flow errors (`DelayedError`, `WaitingError`, `WaitingChildrenError`, `RateLimitError`) are not supported:
 * a processor has no token or worker handle, and such an error counts as a transient failure (D-TASK035-10, R2-n4).
 */
export type JobProcessor = (payload: JobPayload, job: ProcessorJob) => Promise<void>;

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
  getJob(id: string): Promise<{ readonly data: unknown } | undefined>;
  getWaitingCount(): Promise<number>;
  clean(grace: number, limit: number, type: 'wait'): Promise<string[]>;
}

/** Default per-job deadline: 5 minutes, far above any job of this run (a sweep, a relay batch, a carrier call chain). */
export const DEFAULT_JOB_DEADLINE_MS = 300_000;

export interface JobHandlerOptions {
  readonly queue: QueueName;
  readonly processor: JobProcessor;
  readonly log: RuntimeLog;
  readonly deadLetter: DeadLetterSink;
  /** `platform_queue_dead_lettered_total` (D-ARCH-160); called once per final failure. */
  readonly onDeadLettered?: (queue: QueueName) => void;
  /** Records kept per dead-letter queue; default DEAD_LETTER_RETENTION.count (test seam). */
  readonly deadLetterCount?: number;
  /** Per-job deadline; default DEFAULT_JOB_DEADLINE_MS (test seam). */
  readonly deadlineMs?: number;
}

/** Error class only: a message may carry data. */
export const errorClass = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/** The deadline of an attempt passed: transient (the attempt is retried; the processor was told through its signal). */
export class JobDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`job deadline of ${String(deadlineMs)} ms exceeded`);
    this.name = 'JobDeadlineError';
  }
}

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

/**
 * Runs `work` until it settles or `deadlineMs` passes, whichever is first; the signal fires at the deadline
 * (D-TASK039-07; code review R1-M1, PR039-SEC-01). `work` is started as a promise job, so a processor that throws
 * synchronously becomes a rejection like any other; both promises carry a handler before anything can settle, and the
 * timer is cleared on every path, so neither a late processor rejection nor the deadline rejection is ever unhandled.
 */
export async function runWithDeadline(work: (signal: AbortSignal) => Promise<void>, deadlineMs: number): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const running = Promise.resolve().then(() => work(controller.signal));
    running.catch(() => undefined);
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new JobDeadlineError(deadlineMs);
        controller.abort(error);
        reject(error);
      }, deadlineMs);
    });
    expired.catch(() => undefined);
    await Promise.race([running, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** The dead-letter write of a final failure, shared by the handler and the stalled-failure recorder. */
function createDeadLetterWriter(options: JobHandlerOptions) {
  const { queue, log, deadLetter } = options;
  const keep = options.deadLetterCount ?? DEAD_LETTER_RETENTION.count;

  /** True unless the stored record is another failure's (BullMQ ignored the add); a failed read counts as created. */
  async function created(jobId: string | undefined, record: DeadLetterRecord): Promise<boolean> {
    if (jobId === undefined) return true;
    try {
      const stored = (await deadLetter.getJob(jobId))?.data as Partial<DeadLetterRecord> | undefined;
      return stored === undefined || stored.failed_at === record.failed_at;
    } catch {
      return true;
    }
  }

  /**
   * The write-time count trim. Concurrent writers read the same depth, so a burst can trim up to (writers - 1) records
   * below the bound: bounded and harmless, the hourly sweep converges on the bound again (code review R1-n6).
   */
  async function trim(): Promise<void> {
    try {
      const removed = await trimDeadLetter(deadLetter, keep);
      if (removed > 0) log.info('worker.dead_letter_trimmed', { queue, count: removed });
    } catch (error) {
      // Never changes the outcome of the job; the hourly sweep trims again.
      log.warn('worker.dead_letter_trim_failed', { queue, error: errorClass(error) });
    }
  }

  return async function write(job: Pick<HandledJob, 'id' | 'name' | 'data'>, error: unknown, attempts: number): Promise<void> {
    options.onDeadLettered?.(queue);
    const jobId = deadLetterJobId(job.id, attempts);
    try {
      const record = deadLetterRecord({ queueName: queue, id: job.id, name: job.name, data: job.data }, error, attempts);
      await deadLetter.add(job.name, record, {
        ...(jobId === undefined ? {} : { jobId }),
        removeOnComplete: false,
        removeOnFail: false,
      });
      if (await created(jobId, record)) {
        log.warn('worker.job_dead_lettered', { queue, jobId: job.id ?? '', reason: record.reason, attempts });
      } else {
        // An operator retry with resetAttemptsMade failed again under the same record id: the first record stands.
        log.warn('worker.dead_letter_duplicate', { queue, jobId: job.id ?? '', reason: record.reason, attempts });
      }
    } catch (writeError) {
      // The failed job stays in the failed set (FAILED_RETENTION): the backstop when the record cannot be written.
      log.error('worker.dead_letter_write_failed', { queue, jobId: job.id ?? '', error: errorClass(writeError) });
      return;
    }
    await trim();
  };
}

export function createJobHandler(options: JobHandlerOptions): (job: HandledJob) => Promise<void> {
  const { queue, processor, log } = options;
  const definition = QUEUES[queue];
  const deadlineMs = options.deadlineMs ?? DEFAULT_JOB_DEADLINE_MS;
  const writeDeadLetter = createDeadLetterWriter(options);

  /** Logs the failed attempt; on the job's last failure writes the dead-letter record (never masking the error). */
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
    if (final) await writeDeadLetter(job, error, attempts);
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
    const checked = validateDequeuedJob(definition, job);
    if (!checked.ok) {
      if (checked.carriesTenantContext)
        securityEvent(log, 'job_context_mismatch', { queue, job_name: job.name, job_id: job.id ?? '', reason: 'PAYLOAD_INVALID' });
      const error = new NonRetryableError('PAYLOAD_INVALID', `payload v2 refused: ${checked.issues.join(', ')}`);
      await recordFailure(job, error);
      await redactStoredData(job);
      throw persistedFailure(error);
    }
    const { payload, correlationId } = checked;
    await runWithJobContext({ correlationId }, async () => {
      try {
        await runWithDeadline(
          (signal) =>
            processor(payload, { queue, id: job.id ?? '', name: job.name, attemptsMade: job.attemptsMade, correlationId, signal }),
          deadlineMs,
        );
      } catch (error) {
        await recordFailure(job, error);
        throw persistedFailure(error);
      }
    });
  };
}

/**
 * Records a job BullMQ failed without running the handler: it stalled more often than `maxStalledCount` allows and
 * BullMQ failed it on its next pick-up (6.7.0 `Worker.getUnrecoverableErrorMessage`, `job.deferredFailure`). The
 * consumer calls it from its `failed` listener; the job is already in the failed set, so the record follows it.
 */
export function createStalledFailureRecorder(
  options: Omit<JobHandlerOptions, 'processor' | 'deadlineMs'>,
): (job: Pick<HandledJob, 'id' | 'name' | 'data' | 'attemptsMade'>) => Promise<void> {
  const writeDeadLetter = createDeadLetterWriter({ ...options, processor: () => Promise.resolve() });
  const record = async (job: Pick<HandledJob, 'id' | 'name' | 'data'>, attempts: number): Promise<void> => {
    options.log.warn('worker.job_failed', {
      queue: options.queue,
      jobId: job.id ?? '',
      attempt: attempts,
      final: true,
      reason: 'STALLED',
      // What BullMQ persisted for it (the processor never ran, so no error class of its own exists).
      error: 'UnrecoverableError',
    });
    await writeDeadLetter(job, new NonRetryableError('STALLED'), attempts);
  };
  return async (job) => {
    const attempts = Math.max(job.attemptsMade, 1);
    // The STALLED lines carry the job's correlation id like every other failure line, when its payload has a valid one
    // (code review R1-n7); a refused or forged payload gets none.
    const correlation = (job.data as { correlation_id?: unknown } | null | undefined)?.correlation_id;
    if (typeof correlation === 'string' && CORRELATION_ID_PATTERN.test(correlation)) {
      await runWithJobContext({ correlationId: correlation }, () => record(job, attempts));
    } else {
      await record(job, attempts);
    }
  };
}
