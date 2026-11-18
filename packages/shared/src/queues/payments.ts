// Payments-module queues (ADR-0013 §1): webhook processing, capture, refund, authorisation sweeper.
import type { ModuleQueues } from './queue-definition.js';

export const paymentsQueues = {
  payments: { kinds: ['payment', 'order'], concurrency: 5 },
} as const satisfies ModuleQueues;
