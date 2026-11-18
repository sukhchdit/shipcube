// Notifications-module queues (ADR-0013 §1): render and send.
import type { ModuleQueues } from './queue-definition.js';

export const notificationsQueues = {
  notifications: { kinds: ['notification'], concurrency: 10 },
} as const satisfies ModuleQueues;
