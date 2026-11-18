// `@platform/shared/queues`: the named BullMQ queues, their job options and the job payload v2 contract (ADR-0013 and
// amendment 1; REQ-PLAT-013, DR-A25, US-009; TASK-035). Each module owns `queues/<module>.ts`; this file aggregates
// them, one typed import per file (PLAN.md §5 rule 2), and queues.test.ts fails when a file is not listed here or a
// queue name is declared twice. A subpath of its own because the payload schema needs Joi, which the browser-safe
// root barrel does not carry.
import { auditQueues } from './audit.js';
import { documentsQueues } from './documents.js';
import { notificationsQueues } from './notifications.js';
import { paymentsQueues } from './payments.js';
import { pickupsQueues } from './pickups.js';
import { platformQueues } from './platform.js';
import type { ModuleQueues, QueueDefinition } from './queue-definition.js';
import { shipmentsQueues } from './shipments.js';
import { trackingQueues } from './tracking.js';

/** Module name (the queue file name) to that module's queues. */
export const QUEUE_MODULES = {
  audit: auditQueues,
  documents: documentsQueues,
  notifications: notificationsQueues,
  payments: paymentsQueues,
  pickups: pickupsQueues,
  platform: platformQueues,
  shipments: shipmentsQueues,
  tracking: trackingQueues,
} as const satisfies Readonly<Record<string, ModuleQueues>>;

type Modules = typeof QUEUE_MODULES;
type QueuesOf<M> = M extends unknown ? keyof M : never;

/** A named queue; producers and consumers accept nothing else. */
export type QueueName = Extract<QueuesOf<Modules[keyof Modules]>, string>;

/** BullMQ refuses `:` in a queue name (it is the key delimiter), so a name is lower-case words joined by `-`. */
export const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Suffix of each queue's dead-letter queue (ADR-0013 §1 names it `<queue>:dead`; BullMQ 6 refuses `:` in a queue name,
 * so the separator is `-`: D-TASK035-01).
 */
export const DEAD_LETTER_SUFFIX = '-dead';

/** Merges module queues; a name declared twice, or not in the name pattern, fails at load time. */
export function mergeQueues(modules: Readonly<Record<string, ModuleQueues>>): Readonly<Record<string, QueueDefinition>> {
  const merged: Record<string, QueueDefinition> = {};
  const owner = new Map<string, string>();
  for (const [module, queues] of Object.entries(modules)) {
    for (const [name, definition] of Object.entries(queues)) {
      if (!QUEUE_NAME_PATTERN.test(name) || name.endsWith(DEAD_LETTER_SUFFIX))
        throw new Error(`Queue name ${name} of ${module} is not a lower-case kebab name`);
      const previous = owner.get(name);
      if (previous !== undefined) throw new Error(`Queue ${name} is declared by both ${previous} and ${module}`);
      owner.set(name, module);
      merged[name] = Object.freeze({ kinds: Object.freeze([...definition.kinds]), concurrency: definition.concurrency });
    }
  }
  return Object.freeze(merged);
}

export const QUEUES = mergeQueues(QUEUE_MODULES) as Readonly<Record<QueueName, QueueDefinition>>;

/** Every named queue, sorted. */
export const QUEUE_NAMES: readonly QueueName[] = Object.freeze(Object.keys(QUEUES).sort() as QueueName[]);

export function isQueueName(value: unknown): value is QueueName {
  return typeof value === 'string' && Object.hasOwn(QUEUES, value);
}

/** The dead-letter queue of a named queue. */
export function deadLetterQueueName(queue: QueueName): `${QueueName}${typeof DEAD_LETTER_SUFFIX}` {
  return `${queue}${DEAD_LETTER_SUFFIX}`;
}

export { JOB_KINDS, type JobKind, type ModuleQueues, type QueueDefinition } from './queue-definition.js';
export { BACKOFF_BASE_MS, BACKOFF_JITTER, BACKOFF_TYPE, JOB_ATTEMPTS, jobOptions, retryDelayMs, type JobOptions } from './job-options.js';
export {
  isJobPayloadV2,
  JOB_ID_PATTERN,
  jobIdFor,
  PAYLOAD_VERSION,
  payloadSchemaFor,
  validateJobPayload,
  type JobPayloadV2,
  type JobRef,
  type PayloadValidation,
  type TraceContext,
} from './payload-v2.js';
