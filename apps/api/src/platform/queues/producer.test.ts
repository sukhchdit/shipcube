import { describe, expect, it } from '@jest/globals';
import { type JobOptions, type JobPayloadV2, jobOptions, type QueueName } from '@platform/shared/queues';

import { runWithRequestContext, type RequestContext } from '../context/request-context.js';
import { createJobProducer, JobProducerError, type ProducerQueue } from './producer.js';

const ID = '0193a5b2-7c1e-7d4a-9f3b-000000000f01';

interface Added {
  readonly queue: QueueName;
  readonly name: string;
  readonly data: JobPayloadV2;
  readonly opts: JobOptions;
}

function fakeQueues(): { readonly added: Added[]; readonly queueFor: (name: QueueName) => ProducerQueue } {
  const added: Added[] = [];
  return {
    added,
    queueFor: (queue) => ({
      add: (name, data, opts) => {
        added.push({ queue, name, data, opts });
        return Promise.resolve({ id: opts.jobId });
      },
    }),
  };
}

const requestContext = (correlationId: string): RequestContext => ({ correlationId }) as unknown as RequestContext;

describe('job producer (ADR-0013 §2 and amendment 1; D-062 AT-US-008-03 job-payload hop)', () => {
  it('[AT-US-008-03] copies the correlation id of the originating request into payload v2; never generates one', async () => {
    const queues = fakeQueues();
    const producer = createJobProducer({ queueFor: queues.queueFor });
    const job = await runWithRequestContext(requestContext('demo-booking-0001'), () =>
      producer.enqueue('outbox-relay', { kind: 'outbox_event', id: ID }),
    );
    expect(job).toEqual({
      queue: 'outbox-relay',
      jobId: `outbox_event.${ID}`,
      payload: { v: 2, kind: 'outbox_event', id: ID, correlation_id: 'demo-booking-0001', trace_context: null },
    });
    expect(queues.added).toEqual([
      { queue: 'outbox-relay', name: 'outbox_event', data: job.payload, opts: jobOptions(`outbox_event.${ID}`) },
    ]);
  });

  it('[AT-US-008-03] an explicit (outbox row) correlation id wins over the request context', async () => {
    const queues = fakeQueues();
    const producer = createJobProducer({ queueFor: queues.queueFor, contextCorrelationId: () => 'request-ctx-0001' });
    const job = await producer.enqueue('booking', { kind: 'saga', id: ID, step: 'book' }, { correlationId: 'outbox-row-0001' });
    expect(job.payload.correlation_id).toBe('outbox-row-0001');
    expect(job.jobId).toBe(`saga.${ID}.book`);
  });

  it('refuses to enqueue without an originating correlation id (outside a request, no explicit value)', async () => {
    const queues = fakeQueues();
    const producer = createJobProducer({ queueFor: queues.queueFor });
    await expect(producer.enqueue('outbox-relay', { kind: 'outbox_event', id: ID })).rejects.toThrow(JobProducerError);
    expect(queues.added).toEqual([]);
  });

  it('refuses a payload its queue would refuse at dequeue (kind of another queue, malformed correlation id, bad trace context)', async () => {
    const queues = fakeQueues();
    const producer = createJobProducer({ queueFor: queues.queueFor, contextCorrelationId: () => 'demo-booking-0001' });
    await expect(producer.enqueue('outbox-relay', { kind: 'saga', id: ID })).rejects.toThrow(
      'payload refused for queue outbox-relay: kind: any.only',
    );
    await expect(producer.enqueue('booking', { kind: 'saga', id: ID }, { correlationId: 'bad id' })).rejects.toThrow(JobProducerError);
    await expect(producer.enqueue('booking', { kind: 'saga', id: ID }, { traceContext: { traceparent: 'nope' } })).rejects.toThrow(
      'trace_context.traceparent: string.pattern.base',
    );
    await expect(producer.enqueue('booking', { kind: 'saga', id: 'NOT-A-UUID' })).rejects.toThrow(JobProducerError);
    expect(queues.added).toEqual([]);
  });

  it('carries a W3C trace context when the producer has one', async () => {
    const queues = fakeQueues();
    const producer = createJobProducer({ queueFor: queues.queueFor, contextCorrelationId: () => 'demo-booking-0001' });
    const traceContext = { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` };
    const job = await producer.enqueue('notifications', { kind: 'notification', id: ID }, { traceContext });
    expect(job.payload.trace_context).toEqual(traceContext);
  });
});
