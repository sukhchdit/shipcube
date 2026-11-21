// Platform queues (ADR-0013 §1, §5): the outbox relay (jobId `outbox_event.<event_id>`) and housekeeping. The
// housekeeping queue carries scheduled jobs only (no payload kind); the first is `queue-retention`, hourly (ADR-0013
// am. 3 item 10; TASK-039). Any other job on it is refused at dequeue (PAYLOAD_INVALID), never run.
import type { ModuleQueues } from './queue-definition.js';

export const platformQueues = {
  'outbox-relay': { kinds: ['outbox_event'], concurrency: 5 },
  housekeeping: { kinds: [], schedules: ['queue-retention'], concurrency: 1 },
} as const satisfies ModuleQueues;
