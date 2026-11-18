// Platform queues (ADR-0013 §1, §5): the outbox relay (jobId `outbox_event.<event_id>`) and housekeeping. The
// housekeeping schedules and their payload kinds arrive with US-010 (TASK-039); until then its jobs are refused at
// dequeue (PAYLOAD_INVALID), never run.
import type { ModuleQueues } from './queue-definition.js';

export const platformQueues = {
  'outbox-relay': { kinds: ['outbox_event'], concurrency: 5 },
  housekeeping: { kinds: [], concurrency: 1 },
} as const satisfies ModuleQueues;
