// Job options every producer uses (ADR-0013 §2 and amendment 3; REQ-PLAT-013, DR-A25, NFR-RES-004; TASK-035,
// TASK-039): 5 attempts, exponential backoff from 2 s with jitter, a deterministic job ID, and bounded retention of
// finished jobs (completed 24 h / 10,000, failed 7 days / 1,000 per queue; PR64-SEC-04, T-77, D-ARCH-159).

/** Attempts per job, the first included (REQ-PLAT-013). */
export const JOB_ATTEMPTS = 5;
/** Delay before the first retry; doubles per retry (2 s, 4 s, 8 s, 16 s). */
export const BACKOFF_BASE_MS = 2_000;
/** Jitter as a fraction of the nominal delay: each delay is drawn from nominal × [1 - J, 1 + J]. */
export const BACKOFF_JITTER = 0.2;
/** The custom BullMQ backoff type; the worker's `settings.backoffStrategy` implements it with `retryDelayMs`. */
export const BACKOFF_TYPE = 'jittered-exponential';

/** A BullMQ retention bound (`KeepJobs`): age in SECONDS, as BullMQ takes it, and the newest `count` kept. */
export interface RetentionBound {
  readonly age: number;
  readonly count: number;
}

/**
 * The three retention bounds of ADR-0013 amendment 3 (D-ARCH-159). Constants, not environment configuration: the
 * Valkey memory budget (item 13) and the dead-letter depth alarm (item 14, 80 % of the record count) derive from them,
 * so a change is an amendment of the ADR. Completed jobs: 24 hours, the newest 10,000 per queue (unchanged).
 */
export const COMPLETED_RETENTION: RetentionBound = Object.freeze({ age: 86_400, count: 10_000 });
/** Failed jobs: 7 days, the newest 1,000 per queue (the `job.retry()` handle and the backstop of the record). */
export const FAILED_RETENTION: RetentionBound = Object.freeze({ age: 604_800, count: 1_000 });
/** Dead-letter records in `<queue>-dead`: 14 days, the newest 2,000 per dead-letter queue. */
export const DEAD_LETTER_RETENTION: RetentionBound = Object.freeze({ age: 1_209_600, count: 2_000 });

/**
 * The delay before retry number `attemptsMade` (1 = the first retry): `base × 2^(attemptsMade - 1)` scaled by a jitter
 * factor in [1 - J, 1 + J], so concurrent failures do not retry in lock-step. `random` is a uniform draw in [0, 1)
 * (test seam). Integer milliseconds, never negative.
 */
export function retryDelayMs(attemptsMade: number, base: number = BACKOFF_BASE_MS, random: () => number = Math.random): number {
  const retry = Number.isFinite(attemptsMade) ? Math.min(Math.max(Math.trunc(attemptsMade), 1), 30) : 1;
  const nominal = base * 2 ** (retry - 1);
  const raw = random();
  const draw = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.5;
  return Math.max(0, Math.round(nominal * (1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * draw)));
}

/** Every job option but the id: what the job template of a Job Scheduler carries (ADR-0013 am. 3 item 8). */
export interface RetryAndRetentionOptions {
  readonly attempts: number;
  readonly backoff: { readonly type: typeof BACKOFF_TYPE; readonly delay: number };
  readonly removeOnComplete: RetentionBound;
  readonly removeOnFail: RetentionBound;
  /** BullMQ keeps no stack frames in the job hash (PR64-SEC-02): 0 empties `stacktrace`. */
  readonly stackTraceLimit: 0;
}

export interface JobOptions extends RetryAndRetentionOptions {
  readonly jobId: string;
}

/** Retries, backoff and both retention bounds; fresh objects, so BullMQ never holds the frozen constants. */
export function retryAndRetentionOptions(): RetryAndRetentionOptions {
  return {
    attempts: JOB_ATTEMPTS,
    backoff: { type: BACKOFF_TYPE, delay: BACKOFF_BASE_MS },
    removeOnComplete: { ...COMPLETED_RETENTION },
    removeOnFail: { ...FAILED_RETENTION },
    stackTraceLimit: 0,
  };
}

/** The BullMQ job options of a job with this deterministic ID. */
export function jobOptions(jobId: string): JobOptions {
  return { jobId, ...retryAndRetentionOptions() };
}
