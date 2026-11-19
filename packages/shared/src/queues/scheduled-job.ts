// The dequeue contract of every job (ADR-0013 §2, §5, amendment 1 item 3, amendment 3 item 7; PR64-SEC-07; TASK-039,
// D-TASK039-01). A job is accepted only when its payload AND its identity agree:
//
// - an aggregate job carries payload v2 (payload-v2.ts); its BullMQ id is `<kind>.<id>` or `<kind>.<id>.<step>` of
//   that payload and its name is the payload kind. `job_executions.job_key` is the job id while the action follows the
//   payload id, so a job whose id names another aggregate than its payload is refused (PR64-SEC-07);
// - a scheduled job carries the schedule payload `{ v: 2, schedule }` (no kind, no id, no tenant context: it names no
//   aggregate and runs SYSTEM-scope); the schedule is one of the queue's schedules, its name is the schedule and its id
//   is the one BullMQ gives every occurrence of a Job Scheduler, `repeat:<schedule>:<occurrence millis>` (BullMQ 6.7.0
//   `JobScheduler.getSchedulerNextJobId`). The occurrence is the job's correlation id, so a redelivered occurrence
//   logs under the same id.
//
// Anything else is PAYLOAD_INVALID at dequeue. Pure; never throws.
import Joi from 'joi';

import { capIssues, carriesTenantContext, type JobPayloadV2, PAYLOAD_VERSION, structuralIssues, validateJobPayload } from './payload-v2.js';
import type { QueueDefinition, ScheduleName } from './queue-definition.js';

/** The payload of a scheduled job: the schedule's name, nothing else. */
export interface ScheduledJobPayload {
  readonly v: typeof PAYLOAD_VERSION;
  readonly schedule: ScheduleName;
}

/** A validated job payload: an aggregate job (payload v2) or a scheduled job. */
export type JobPayload = JobPayloadV2 | ScheduledJobPayload;

export function isScheduledPayload(payload: JobPayload): payload is ScheduledJobPayload {
  return Object.hasOwn(payload, 'schedule');
}

/** The template data of the schedule's Job Scheduler. */
export function scheduledPayload(schedule: ScheduleName): ScheduledJobPayload {
  return { v: PAYLOAD_VERSION, schedule };
}

/** BullMQ's id of a Job Scheduler occurrence: `repeat:<scheduler id>:<next millis>`. */
const SCHEDULED_JOB_ID = /^repeat:([a-z][a-z0-9-]{0,62}):([1-9][0-9]{0,15})$/;

/** The identity of a dequeued job. */
export interface DequeuedJob {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
}

export type DequeueCheck =
  | {
      readonly ok: true;
      readonly payload: JobPayload;
      /** The payload's correlation id, or `<schedule>-<occurrence millis>` for a scheduled job. */
      readonly correlationId: string;
    }
  | {
      readonly ok: false;
      /** Key paths and rule names only, never a value; capped (PR64-SEC-06). */
      readonly issues: readonly string[];
      /** The forgery signal: tenant context in any spelling and depth, or an own `__proto__`. */
      readonly carriesTenantContext: boolean;
    };

const SCHEDULE_SCHEMAS = new WeakMap<QueueDefinition, Joi.ObjectSchema>();

function scheduleSchemaFor(definition: QueueDefinition): Joi.ObjectSchema {
  let schema = SCHEDULE_SCHEMAS.get(definition);
  if (schema === undefined) {
    const schedules = definition.schedules ?? [];
    schema = Joi.object({
      v: Joi.number().valid(PAYLOAD_VERSION).required(),
      schedule:
        schedules.length === 0
          ? Joi.any()
              .required()
              .custom((_value: unknown, helpers) => helpers.error('any.invalid'))
          : Joi.string()
              .valid(...schedules)
              .required(),
    })
      .unknown(false)
      .required()
      .prefs({ convert: false, abortEarly: false, errors: { wrap: { label: false } } });
    SCHEDULE_SCHEMAS.set(definition, schema);
  }
  return schema;
}

const refused = (issues: readonly string[], data: unknown): DequeueCheck => ({
  ok: false,
  issues: capIssues(issues),
  carriesTenantContext: carriesTenantContext(data),
});

function checkScheduledJob(definition: QueueDefinition, job: DequeuedJob): DequeueCheck {
  const structural = structuralIssues(job.data);
  if (structural.length > 0) return refused(structural, job.data);
  const result = scheduleSchemaFor(definition).validate(job.data);
  if (result.error !== undefined)
    return refused(
      result.error.details.map((detail) => `${detail.path.join('.') || '(root)'}: ${detail.type}`),
      job.data,
    );
  const payload = result.value as ScheduledJobPayload;
  const match = SCHEDULED_JOB_ID.exec(job.id ?? '');
  const issues: string[] = [];
  if (match?.[1] !== payload.schedule) issues.push('(job id): schedule.mismatch');
  if (job.name !== payload.schedule) issues.push('(job name): schedule.mismatch');
  if (issues.length > 0 || match?.[2] === undefined) return refused(issues, job.data);
  return { ok: true, payload, correlationId: `${payload.schedule}-${match[2]}` };
}

function checkAggregateJob(definition: QueueDefinition, job: DequeuedJob): DequeueCheck {
  const checked = validateJobPayload(definition, job.data);
  if (!checked.ok) return checked;
  const { payload } = checked;
  const key = `${payload.kind}.${payload.id}`;
  const id = job.id ?? '';
  const issues: string[] = [];
  if (id !== key && !(id.startsWith(`${key}.`) && /^[a-z0-9_-]{1,40}$/.test(id.slice(key.length + 1))))
    issues.push('(job id): kind.id.mismatch');
  if (job.name !== payload.kind) issues.push('(job name): kind.mismatch');
  if (issues.length > 0) return { ok: false, issues, carriesTenantContext: false };
  return { ok: true, payload, correlationId: payload.correlation_id };
}

/**
 * Validates a dequeued job against its queue (payload and identity). A payload with an own `schedule` key is checked
 * as a scheduled job, anything else as payload v2; each check refuses what its queue does not declare.
 */
export function validateDequeuedJob(definition: QueueDefinition, job: DequeuedJob): DequeueCheck {
  const scheduled = typeof job.data === 'object' && job.data !== null && Object.hasOwn(job.data, 'schedule');
  return scheduled ? checkScheduledJob(definition, job) : checkAggregateJob(definition, job);
}
