// Audit-module queues (ADR-0013 §1, §5): partition pre-creation, chain verification and checkpoints. Scheduled
// singleton jobs only; their payload kinds arrive with the schedulers (US-010, TASK-039), so until then every job on
// this queue is refused at dequeue (PAYLOAD_INVALID), never run.
import type { ModuleQueues } from './queue-definition.js';

export const auditQueues = {
  'audit-maintenance': { kinds: [], concurrency: 1 },
} as const satisfies ModuleQueues;
