// Documents-module queues (ADR-0013 §1): PDF generation and storage.
import type { ModuleQueues } from './queue-definition.js';

export const documentsQueues = {
  documents: { kinds: ['document', 'shipment'], concurrency: 4 },
} as const satisfies ModuleQueues;
