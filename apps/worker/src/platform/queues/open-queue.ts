/**
 * The only place a worker `Queue` is constructed (PR64-SEC-01; CWE-532). BullMQ's `QueueBase.emit` falls back to
 * `console.error(err)` when a `Queue` has no `error` listener, and ioredis attaches the failing command to a refused
 * handshake (`HELLO 3 AUTH <user> <password>`), so the ACL password would reach stderr in clear and bypass the redacted
 * logger. Every `Queue` therefore goes through `openQueue`, which always attaches a listener that logs the error class
 * only (a message or command may carry a secret). A source-scan test keeps every other `new Queue(` out of the worker.
 */
import { Queue, type QueueOptions } from 'bullmq';

import type { RuntimeLog } from '@platform/api/runtime';

export function openQueue(name: string, options: QueueOptions, log: RuntimeLog): Queue {
  const queue = new Queue(name, options);
  queue.on('error', (error: unknown) => {
    log.warn('worker.queue_error', { queue: name, error: error instanceof Error ? error.name : typeof error });
  });
  return queue;
}
