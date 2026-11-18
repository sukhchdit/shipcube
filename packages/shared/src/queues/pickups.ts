// Pickups-module queues (ADR-0013 §1): schedule and cancel with the carrier.
import type { ModuleQueues } from './queue-definition.js';

export const pickupsQueues = {
  pickups: { kinds: ['pickup'], concurrency: 5 },
} as const satisfies ModuleQueues;
