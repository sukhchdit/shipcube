// Shape of one named queue (ADR-0013 §1, §5, §6 and amendment 1; REQ-PLAT-013, REQ-PLAT-015, DR-A25; TASK-035,
// TASK-039). Pure data.

/**
 * The aggregate kinds a job payload v2 may name (`platform.job_context(kind, id)`, data-model §1.7 `job_context_kind`;
 * ADR-0013 amendment 1 item 1). The worker resolves the tenant context of a job from the row the kind and id name.
 */
export const JOB_KINDS = [
  'outbox_event',
  'saga',
  'shipment',
  'order',
  'pickup',
  'document',
  'payment',
  'tracking_poll',
  'notification',
  'quote',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * The scheduled jobs (ADR-0013 §5; REQ-PLAT-015; D-TASK039-01). Each is one BullMQ Job Scheduler whose id is its name,
 * so N workers that register it at start hold one schedule. A scheduled job names no aggregate: it carries the schedule
 * payload `{ v: 2, schedule }` (scheduled-job.ts), never a kind, an id or tenant context, and its processor runs
 * SYSTEM-scope. Later housekeeping tasks (audit partitions, chain verification, purges) add their names here:
 * `outbox-purge` (TASK-043) is the daily purge of published outbox events, processed events and job executions older
 * than 30 days (ADR-0004 item 6; data-model §6.1, §10.5; D-ARCH-167, D-ARCH-171).
 *
 * Conditions of the security ruling D-SECPR039-01 on this contract, binding every schedule added here:
 * (i) a handler takes every parameter from code constants or configuration, never from the job;
 * (ii) a handler whose effect is destructive or not naturally idempotent applies its policy predicate itself (a purge
 *      deletes by age, never "because a run started"), and if it writes, it runs through `idempotentProcessor` keyed by
 *      the occurrence id, so a forged or early occurrence can only do what the policy already allows at that moment;
 * (iii) this list stays a closed code list; the load-time one-queue check and the runtime refusal of a registered
 *      processor on a schedule-only queue stay; a name has at most 47 characters (`SCHEDULE_NAME_PATTERN`), so
 *      `<schedule>-<millis>` fits CORRELATION_ID_PATTERN;
 * (iv) an operator "run now" action enqueues through the scheduler (`upsertJobScheduler` or the same contract), never
 *      as a hand-made job with a `repeat:` id.
 */
export const SCHEDULE_NAMES = ['outbox-purge', 'queue-retention'] as const;
export type ScheduleName = (typeof SCHEDULE_NAMES)[number];

export interface QueueDefinition {
  /** The kinds a payload on this queue may carry; anything else is `PAYLOAD_INVALID` at dequeue. */
  readonly kinds: readonly JobKind[];
  /** The schedules whose jobs run on this queue (a schedule belongs to exactly one queue); none when absent. */
  readonly schedules?: readonly ScheduleName[];
  /** Jobs one worker process runs at once on this queue (ADR-0013 §6 defaults). */
  readonly concurrency: number;
}

/** One module's queue file: `queues/<module>.ts` exports a record of this shape (PLAN.md §5 rule 2). */
export type ModuleQueues = Readonly<Record<string, QueueDefinition>>;
