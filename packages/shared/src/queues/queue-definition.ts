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
 * SYSTEM-scope. Later housekeeping tasks (audit partitions, chain verification, purges) add their names here.
 */
export const SCHEDULE_NAMES = ['queue-retention'] as const;
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
