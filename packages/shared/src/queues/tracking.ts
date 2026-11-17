// Tracking-module queues (ADR-0013 §1): adaptive polling; jobId `tracking_poll.<id>`.
import type { ModuleQueues } from './queue-definition.js';

export const trackingQueues = {
  'tracking-poll': { kinds: ['tracking_poll', 'shipment'], concurrency: 10 },
} as const satisfies ModuleQueues;
