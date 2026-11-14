/**
 * The `afterCommit` route phase runner (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4); TASK-020 part 020-C). The tx
 * slot schedules a route's `afterCommit` after COMMIT and after the response was written. The work is in-process and
 * best effort (durable work is an outbox event): a throw is logged as `api.after_commit_failed` with the route template
 * and the correlation id only (no request values, no error text) and never changes the response, which is already sent.
 * Pending work is tracked so the shutdown sequence can drain it inside the 30 s stop window (ADR-0013 item 7).
 */
import { thrownClassName } from '../errors/classify.js';

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

export interface AfterCommitQueue {
  /** Starts `work` on a later turn of the event loop and tracks it until it settles; never throws. */
  schedule(work: () => Promise<void> | void, label: AfterCommitLabel): void;
  /** Resolves once every scheduled piece of work (including work scheduled while draining) has settled. */
  drain(): Promise<void>;
  /** Work scheduled and not yet settled. */
  readonly pending: number;
}

export const AFTER_COMMIT_FAILED_EVENT = 'api.after_commit_failed';

export function createAfterCommitQueue(logger: AfterCommitLogger): AfterCommitQueue {
  const inFlight = new Set<Promise<void>>();

  const report = (thrown: unknown, label: AfterCommitLabel): void => {
    try {
      logger.error(AFTER_COMMIT_FAILED_EVENT, {
        route: label.route,
        operation: label.operationId,
        correlation_id: label.correlationId,
        error_class: thrownClassName(thrown),
      });
    } catch {
      // A failing logger must not turn best-effort work into an unhandled rejection.
    }
  };

  return {
    schedule(work, label) {
      // setImmediate: the work starts after the current I/O callbacks, so the response written just before is flushed
      // first and a synchronous throw cannot reach the slot that scheduled it.
      const settled = new Promise<void>((resolve) => {
        setImmediate(() => {
          Promise.resolve()
            .then(work)
            .catch((thrown: unknown) => report(thrown, label))
            .finally(resolve);
        });
      });
      inFlight.add(settled);
      void settled.finally(() => inFlight.delete(settled));
    },
    async drain() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
    get pending() {
      return inFlight.size;
    },
  };
}
