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
import type { ModuleQueues, QueueDefinition, ScheduleName } from './queue-definition.js';
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

/**
 * Merges module queues; a name declared twice, or not in the name pattern, fails at load time, and so does a schedule
 * declared on two queues (a Job Scheduler id is one schedule on one queue, D-TASK039-01).
 */
export function mergeQueues(modules: Readonly<Record<string, ModuleQueues>>): Readonly<Record<string, QueueDefinition>> {
  const merged: Record<string, QueueDefinition> = {};
  const owner = new Map<string, string>();
  const scheduleOwner = new Map<string, string>();
  for (const [module, queues] of Object.entries(modules)) {
    for (const [name, definition] of Object.entries(queues)) {
      if (!QUEUE_NAME_PATTERN.test(name) || name.endsWith(DEAD_LETTER_SUFFIX))
        throw new Error(`Queue name ${name} of ${module} is not a lower-case kebab name`);
      const previous = owner.get(name);
      if (previous !== undefined) throw new Error(`Queue ${name} is declared by both ${previous} and ${module}`);
      owner.set(name, module);
      const schedules = definition.schedules ?? [];
      for (const schedule of schedules) {
        const holder = scheduleOwner.get(schedule);
        if (holder !== undefined) throw new Error(`Schedule ${schedule} is declared on both ${holder} and ${name}`);
        scheduleOwner.set(schedule, name);
      }
      merged[name] = Object.freeze({
        kinds: Object.freeze([...definition.kinds]),
        ...(schedules.length === 0 ? {} : { schedules: Object.freeze([...schedules]) }),
        concurrency: definition.concurrency,
      });
    }
  }
  return Object.freeze(merged);
}

export const QUEUES = mergeQueues(QUEUE_MODULES) as Readonly<Record<QueueName, QueueDefinition>>;

/** Every scheduled job with the queue it runs on (ADR-0013 §5), sorted by schedule name. */
export const SCHEDULED_JOBS: readonly { readonly schedule: ScheduleName; readonly queue: QueueName }[] = Object.freeze(
  (Object.keys(QUEUES) as QueueName[])
    .flatMap((queue) => (QUEUES[queue].schedules ?? []).map((schedule) => Object.freeze({ schedule, queue })))
    .sort((a, b) => a.schedule.localeCompare(b.schedule)),
);

/** Every named queue, sorted. */
export const QUEUE_NAMES: readonly QueueName[] = Object.freeze(Object.keys(QUEUES).sort() as QueueName[]);

export function isQueueName(value: unknown): value is QueueName {
  return typeof value === 'string' && Object.hasOwn(QUEUES, value);
}

/** The dead-letter queue of a named queue. */
export function deadLetterQueueName(queue: QueueName): `${QueueName}${typeof DEAD_LETTER_SUFFIX}` {
  return `${queue}${DEAD_LETTER_SUFFIX}`;
}

export { JOB_KINDS, SCHEDULE_NAMES, type JobKind, type ModuleQueues, type QueueDefinition, type ScheduleName } from './queue-definition.js';
export {
  BACKOFF_BASE_MS,
  BACKOFF_JITTER,
  BACKOFF_TYPE,
  COMPLETED_RETENTION,
  DEAD_LETTER_RETENTION,
  FAILED_RETENTION,
  JOB_ATTEMPTS,
  jobOptions,
  retryAndRetentionOptions,
  retryDelayMs,
  type JobOptions,
  type RetentionBound,
  type RetryAndRetentionOptions,
} from './job-options.js';
export {
  isScheduledPayload,
  scheduledPayload,
  validateDequeuedJob,
  type DequeueCheck,
  type DequeuedJob,
  type JobPayload,
  type ScheduledJobPayload,
} from './scheduled-job.js';
export {
  carriesTenantContext,
  isJobPayloadV2,
  JOB_ID_PATTERN,
  MAX_ISSUES,
  MAX_PAYLOAD_KEYS,
  jobIdFor,
  PAYLOAD_VERSION,
  payloadSchemaFor,
  validateJobPayload,
  type JobPayloadV2,
  type JobRef,
  type PayloadValidation,
  type TraceContext,
} from './payload-v2.js';
