/**
 * Singleton scheduled jobs (ADR-0013 §5; REQ-PLAT-015; US-010 AT-US-010-05/06; TASK-039; D-TASK039-01).
 *
 * Every scheduled job is one BullMQ Job Scheduler whose id is the schedule name (`SCHEDULE_NAMES`), upserted by every
 * worker at start. `upsertJobScheduler` is idempotent on that id: N workers, or one worker restarted N times, hold one
 * scheduler, and BullMQ produces one job per occurrence with the id `repeat:<schedule>:<occurrence millis>`, which any
 * one worker takes. The job template carries the schedule payload `{ v: 2, schedule }` and the retries and BOTH
 * retention bounds of `jobOptions` (ADR-0013 am. 3 item 8). The consumer validates the occurrence against the payload
 * (scheduled-job.ts) before `createScheduleProcessor` dispatches it to the schedule's handler, SYSTEM-scope.
 */
import {
  isScheduledPayload,
  type QueueName,
  retryAndRetentionOptions,
  type RetryAndRetentionOptions,
  SCHEDULED_JOBS,
  scheduledPayload,
  type ScheduledJobPayload,
  type ScheduleName,
} from '@platform/shared/queues';

import { NonRetryableError } from '../queues/errors.js';
import type { JobProcessor, ProcessorJob } from '../queues/job-handler.js';

/**
 * The interval of each schedule (ADR-0013 §5 "housekeeping hourly"; am. 3 item 10 `queue-retention` hourly; ADR-0004
 * item 6 and data-model §6.1 `outbox-purge` daily, TASK-043).
 */
export const SCHEDULE_EVERY_MS: Readonly<Record<ScheduleName, number>> = Object.freeze({
  'outbox-purge': 86_400_000,
  'queue-retention': 3_600_000,
});

/** The job template of a schedule's Job Scheduler. */
export interface ScheduleTemplate {
  readonly name: ScheduleName;
  readonly data: ScheduledJobPayload;
  readonly opts: RetryAndRetentionOptions;
}

/** The part of a BullMQ `Queue` registration uses. */
export interface SchedulableQueue {
  upsertJobScheduler(id: string, repeat: { readonly every: number }, template: ScheduleTemplate): Promise<unknown>;
}

export function scheduleTemplate(schedule: ScheduleName): ScheduleTemplate {
  return { name: schedule, data: scheduledPayload(schedule), opts: retryAndRetentionOptions() };
}

/**
 * Upserts every schedule on its queue (idempotent). The schedules and their handlers follow the conditions (i)-(iv) of
 * D-SECPR039-01, stated on SCHEDULE_NAMES (queue-definition.ts): handler parameters from code only, policy predicates
 * in the handler, a closed list of names of at most 47 characters, and "run now" only through the scheduler. `every` overrides intervals (test seam); `only` limits the
 * registration to the schedules this worker has a handler for (default: all). Rejects on the first failed upsert; the
 * runtime retries the whole registration.
 */
export async function registerSchedules(
  queueFor: (queue: QueueName) => SchedulableQueue,
  every: Partial<Readonly<Record<ScheduleName, number>>> = {},
  only?: ReadonlySet<ScheduleName>,
): Promise<readonly ScheduleName[]> {
  const registered: ScheduleName[] = [];
  for (const { schedule, queue } of SCHEDULED_JOBS) {
    if (only !== undefined && !only.has(schedule)) continue;
    await queueFor(queue).upsertJobScheduler(
      schedule,
      { every: every[schedule] ?? SCHEDULE_EVERY_MS[schedule] },
      scheduleTemplate(schedule),
    );
    registered.push(schedule);
  }
  return registered;
}

/** Runs one occurrence of a schedule. */
export type ScheduleHandler = (job: ProcessorJob) => Promise<void>;

/** The processor of a schedule-only queue: dispatches each validated occurrence to its schedule's handler. */
export function createScheduleProcessor(handlers: Readonly<Partial<Record<ScheduleName, ScheduleHandler>>>): JobProcessor {
  return async (payload, job) => {
    if (!isScheduledPayload(payload)) throw new NonRetryableError('PAYLOAD_INVALID', 'not a scheduled job');
    const handler = handlers[payload.schedule];
    if (handler === undefined) throw new NonRetryableError('NO_PROCESSOR', `no handler for schedule ${payload.schedule}`);
    await handler(job);
  };
}
