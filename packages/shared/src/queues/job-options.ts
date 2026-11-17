// Job options every producer uses (ADR-0013 §2; REQ-PLAT-013, DR-A25, NFR-RES-004; TASK-035): 5 attempts,
// exponential backoff from 2 s with jitter, a deterministic job ID, completed jobs kept 24 h (max 10 000), failed jobs
// kept (their dead-letter record is the operator view; the failed set is the backstop when that write fails).

/** Attempts per job, the first included (REQ-PLAT-013). */
export const JOB_ATTEMPTS = 5;
/** Delay before the first retry; doubles per retry (2 s, 4 s, 8 s, 16 s). */
export const BACKOFF_BASE_MS = 2_000;
/** Jitter as a fraction of the nominal delay: each delay is drawn from nominal × [1 - J, 1 + J]. */
export const BACKOFF_JITTER = 0.2;
/** The custom BullMQ backoff type; the worker's `settings.backoffStrategy` implements it with `retryDelayMs`. */
export const BACKOFF_TYPE = 'jittered-exponential';

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

export interface JobOptions {
  readonly jobId: string;
  readonly attempts: number;
  readonly backoff: { readonly type: typeof BACKOFF_TYPE; readonly delay: number };
  readonly removeOnComplete: { readonly age: number; readonly count: number };
  readonly removeOnFail: false;
}

/** The BullMQ job options of a job with this deterministic ID. */
export function jobOptions(jobId: string): JobOptions {
  return {
    jobId,
    attempts: JOB_ATTEMPTS,
    backoff: { type: BACKOFF_TYPE, delay: BACKOFF_BASE_MS },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: false,
  };
}
