/**
 * Job producer (ADR-0013 §2 and amendment 1; REQ-PLAT-013, DR-A25; D-062 AT-US-008-03 job-payload hop; TASK-035).
 *
 * Enqueues a payload v2 (`{ v: 2, kind, id, correlation_id, trace_context }`, identifiers only) on a named queue with
 * the shared job options: a deterministic job ID from the business key (so a duplicate enqueue is one job), 5 attempts
 * with the jittered exponential backoff, completed jobs kept 24 h, failed jobs kept.
 *
 * The `correlation_id` is COPIED from the originating context, never generated here: an explicit value (the outbox
 * row's `correlation_id` when the relay enqueues, TASK-043) or else the correlation ID of the request being handled.
 * Without either the enqueue is refused (`JobProducerError`), so a job can never start a correlation chain of its own.
 * The payload is validated against the queue's schema before it is written, as the worker validates it at dequeue.
 *
 * The Valkey `api` ACL user has no `~bull:*` key pattern (infra/local/valkey/users.acl; ADR-0013 am. 1 item 4): in the
 * deployed topology the worker's outbox relay is the producer, reaching this module through `@platform/api/runtime`.
 */
import {
  jobIdFor,
  jobOptions,
  type JobOptions,
  type JobPayloadV2,
  type JobRef,
  PAYLOAD_VERSION,
  QUEUES,
  type QueueName,
  type TraceContext,
  validateJobPayload,
} from '@platform/shared/queues';

import { currentRequestContext } from '../context/request-context.js';

/** The part of a BullMQ `Queue` the producer uses. */
export interface ProducerQueue {
  add(name: string, data: JobPayloadV2, opts: JobOptions): Promise<{ readonly id?: string | undefined }>;
}

export class JobProducerError extends Error {
  override readonly name = 'JobProducerError';
}

export interface JobProducerOptions {
  /** The BullMQ queue of a named queue (one instance per name, owned and closed by the caller). */
  readonly queueFor: (name: QueueName) => ProducerQueue;
  /** The correlation ID of the current context; defaults to the request context's (AsyncLocalStorage). */
  readonly contextCorrelationId?: () => string | undefined;
}

export interface EnqueueOptions {
  /** The originating correlation ID (outbox row); defaults to the current request's. */
  readonly correlationId?: string;
  readonly traceContext?: TraceContext | null;
}

export interface EnqueuedJob {
  readonly queue: QueueName;
  readonly jobId: string;
  readonly payload: JobPayloadV2;
}

export interface JobProducer {
  enqueue(queue: QueueName, ref: JobRef, options?: EnqueueOptions): Promise<EnqueuedJob>;
}

const requestCorrelationId = (): string | undefined => currentRequestContext()?.correlationId;

export function createJobProducer(options: JobProducerOptions): JobProducer {
  const contextCorrelationId = options.contextCorrelationId ?? requestCorrelationId;
  return {
    async enqueue(queue, ref, enqueueOptions = {}) {
      const correlationId = enqueueOptions.correlationId ?? contextCorrelationId();
      if (correlationId === undefined) throw new JobProducerError('no originating correlation id (request or outbox context)');
      const payload: JobPayloadV2 = {
        v: PAYLOAD_VERSION,
        kind: ref.kind,
        id: ref.id,
        correlation_id: correlationId,
        trace_context: enqueueOptions.traceContext ?? null,
      };
      const checked = validateJobPayload(QUEUES[queue], payload);
      if (!checked.ok) throw new JobProducerError(`payload refused for queue ${queue}: ${checked.issues.join(', ')}`);
      const jobId = jobIdFor(ref);
      await options.queueFor(queue).add(ref.kind, payload, jobOptions(jobId));
      return { queue, jobId, payload };
    },
  };
}
