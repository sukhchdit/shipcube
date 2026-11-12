// Worker log context (US-008 AT-US-008-03, REQ-PLAT-011; ADR-0013). A job runs inside `runWithJobContext` with the
// correlation ID its producer stored in the job envelope (ADR-0016 §15: propagated to jobs), so every worker log line
// written while it runs carries the same `correlation_id` as the api lines of the originating request. The queue
// tasks (TASK-035 named queues, TASK-047 tenant context from PostgreSQL) call this around each processor; `org_id` /
// `actor_id` come from the resolved job context there, never from the payload (ADR-0013 amendment 2).
import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogContext } from '@platform/shared/logging';

/** Correlation context of one job execution. */
export interface JobContext {
  readonly correlationId: string;
  readonly orgId?: string;
  readonly actorId?: string;
}

/** The same pattern the api accepts for `X-Correlation-Id` (ADR-0016 §15). */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const storage = new AsyncLocalStorage<JobContext>();

export class JobContextError extends Error {
  override readonly name = 'JobContextError';
}

/** Runs `fn` with `context` as the log context; a malformed correlation ID is refused (it would end up in logs). */
export function runWithJobContext<T>(context: JobContext, fn: () => T): T {
  if (!CORRELATION_ID_PATTERN.test(context.correlationId)) throw new JobContextError('invalid job correlation id');
  return storage.run(Object.freeze({ ...context }), fn);
}

/** The log context of the job being processed, or undefined outside a job (start-up, health server, shutdown). */
export function jobLogContext(): LogContext | undefined {
  const context = storage.getStore();
  if (context === undefined) return undefined;
  return {
    correlationId: context.correlationId,
    ...(context.orgId === undefined ? {} : { orgId: context.orgId }),
    ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
  };
}
