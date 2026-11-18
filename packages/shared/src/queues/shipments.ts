// Shipments-module queues (ADR-0013 §1): saga steps of the booking saga; jobId `saga.<saga_id>.<step>`.
import type { ModuleQueues } from './queue-definition.js';

export const shipmentsQueues = {
  booking: { kinds: ['saga'], concurrency: 5 },
} as const satisfies ModuleQueues;
