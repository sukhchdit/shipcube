/**
 * The `afterCommit` route phase runner (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4); TASK-020 part 020-C). The tx
 * slot schedules a route's `afterCommit` after COMMIT and after the response was written. The work is in-process and
 * best effort (durable work is an outbox event): a throw is logged as `api.after_commit_failed` with the route template
 * and the correlation id only (no request values, no error text) and never changes the response, which is already sent.
 * Pending work is tracked so the shutdown sequence can drain it inside the 30 s stop window (ADR-0013 item 7).
 *
 * Bounded (PR #44 R1-m4, PR44-SEC-03): at most `maxPending` pieces of work are pending; above it the work is not started
 * and `api.after_commit_dropped` is logged with the same value-free fields. Each piece of work gets an AbortSignal that
 * aborts when the drain starts (shutdown: well-behaved work stops at once) or at its own deadline; at the deadline the
 * queue also stops waiting for it (logged as failed), so neither a hung piece of work nor the cap can outlive it.
 */
import { thrownClassName } from '../errors/classify.js';
import { abortable, deadline } from './abortable.js';

/** Scalar fields of the failure line; structurally compatible with the platform logger (RuntimeLog). */
export interface AfterCommitLogger {
  error(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}

/** What identifies the scheduled work in the failure line: route metadata and the correlation id, never values. */
export interface AfterCommitLabel {
  readonly route: string;
  readonly operationId: string;
  readonly correlationId: string;
}

/** A piece of afterCommit work; `signal` aborts at shutdown (drain start) or at the work's deadline. */
export type AfterCommitWork = (signal: AbortSignal) => Promise<void> | void;

export interface AfterCommitQueue {
  /** Starts `work` on a later turn of the event loop and tracks it until it settles; never throws. Dropped at the cap. */
  schedule(work: AfterCommitWork, label: AfterCommitLabel): void;
  /** Aborts every work signal, then resolves once every scheduled piece of work (including late work) has settled. */
  drain(): Promise<void>;
  /** Work scheduled and not yet settled (never above the cap). */
  readonly pending: number;
}

export interface AfterCommitQueueOptions {
  /** Test seam (default AFTER_COMMIT_MAX_PENDING). */
  readonly maxPending?: number;
  /** Test seam (default AFTER_COMMIT_DEADLINE_MS). */
  readonly deadlineMs?: number;
}

export const AFTER_COMMIT_FAILED_EVENT = 'api.after_commit_failed';
export const AFTER_COMMIT_DROPPED_EVENT = 'api.after_commit_dropped';

/**
 * Pending afterCommit work per process (PR44-SEC-03): a code constant like CALL_DEADLINE_MS; performance-engineer sizes
 * it with the first route that declares afterCommit (TASK-083/091).
 */
export const AFTER_COMMIT_MAX_PENDING = 1_000;

/** Deadline of one piece of afterCommit work: below the 25 s shutdown drain bound (pinned by after-commit.test.ts). */
export const AFTER_COMMIT_DEADLINE_MS = 20_000;

/** The reason of a work signal aborted at its deadline; also the failure line's `error_class`. */
export class AfterCommitDeadlineError extends Error {
  constructor() {
    super('afterCommit work exceeded its deadline');
    this.name = 'AfterCommitDeadlineError';
  }
}

/** The reason of a work signal aborted because the process is draining (shutdown). */
export class AfterCommitShutdownError extends Error {
  constructor() {
    super('afterCommit work aborted: the process is shutting down');
    this.name = 'AfterCommitShutdownError';
  }
}

export function createAfterCommitQueue(logger: AfterCommitLogger, options: AfterCommitQueueOptions = {}): AfterCommitQueue {
  const maxPending = options.maxPending ?? AFTER_COMMIT_MAX_PENDING;
  const deadlineMs = options.deadlineMs ?? AFTER_COMMIT_DEADLINE_MS;
  const inFlight = new Set<Promise<void>>();
  const stopping = new AbortController();

  const log = (event: string, label: AfterCommitLabel, extra: Readonly<Record<string, string | number>>): void => {
    try {
      logger.error(event, { route: label.route, operation: label.operationId, correlation_id: label.correlationId, ...extra });
    } catch {
      // A failing logger must not turn best-effort work into an unhandled rejection.
    }
  };

  const run = async (work: AfterCommitWork, label: AfterCommitLabel): Promise<void> => {
    const bound = deadline(deadlineMs, () => new AfterCommitDeadlineError());
    try {
      const signal = AbortSignal.any([stopping.signal, bound.signal]);
      // Only the deadline is enforced by not waiting: the shutdown abort asks, and the drain bound limits the wait.
      await abortable(
        Promise.resolve().then(() => work(signal)),
        bound.signal,
      );
    } catch (thrown) {
      log(AFTER_COMMIT_FAILED_EVENT, label, { error_class: thrownClassName(thrown) });
    } finally {
      bound.clear();
    }
  };

  return {
    schedule(work, label) {
      if (inFlight.size >= maxPending) {
        log(AFTER_COMMIT_DROPPED_EVENT, label, { max_pending: maxPending });
        return;
      }
      // setImmediate: the work starts after the current I/O callbacks, so the response written just before is flushed
      // first and a synchronous throw cannot reach the slot that scheduled it.
      const settled = new Promise<void>((resolve) => {
        setImmediate(() => {
          void run(work, label).finally(resolve);
        });
      });
      inFlight.add(settled);
      void settled.finally(() => inFlight.delete(settled));
    },
    async drain() {
      if (!stopping.signal.aborted) stopping.abort(new AfterCommitShutdownError());
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
    get pending() {
      return inFlight.size;
    },
  };
}
