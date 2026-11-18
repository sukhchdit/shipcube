// Shape of one named queue (ADR-0013 §1, §6 and amendment 1; REQ-PLAT-013, DR-A25; TASK-035). Pure data.

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

export interface QueueDefinition {
  /** The kinds a payload on this queue may carry; anything else is `PAYLOAD_INVALID` at dequeue. */
  readonly kinds: readonly JobKind[];
  /** Jobs one worker process runs at once on this queue (ADR-0013 §6 defaults). */
  readonly concurrency: number;
}

/** One module's queue file: `queues/<module>.ts` exports a record of this shape (PLAN.md §5 rule 2). */
export type ModuleQueues = Readonly<Record<string, QueueDefinition>>;
