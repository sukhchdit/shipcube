// Unit tests of the per-job logic around a processor (TASK-035), with a fake job and a fake dead-letter queue: the
// payload gate, the retry/final decision, the dead-letter record and id (R1-M1, R1-m2) and the sanitised error BullMQ
// persists (PR64-SEC-02). consumer.int.test.ts runs the same paths through a real BullMQ Worker on Valkey.
import { randomUUID } from 'node:crypto';

import { createRuntimeLog } from '@platform/api/runtime';
import { describe, expect, it } from '@jest/globals';
import { REDACTED } from '@platform/shared/logging';
import { UnrecoverableError } from 'bullmq';

import { jobLogContext } from '../logging/job-context.js';
import type { DeadLetterRecord } from './dead-letter.js';
import { NonRetryableError } from './errors.js';
import { createJobHandler, type DeadLetterSink, type HandledJob, type JobProcessor, persistedFailure } from './job-handler.js';

const SENTINEL = 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sentinelsig';
const TOKEN = 'tok_live_secret_value';

interface Added {
  readonly name: string;
  readonly record: DeadLetterRecord;
  readonly options: Record<string, unknown>;
}

interface Harness {
  readonly added: Added[];
  readonly updates: unknown[];
  readonly lines: Record<string, unknown>[];
  readonly processed: string[];
  handle(job: Partial<HandledJob> & { data: unknown }, processor?: JobProcessor): Promise<void>;
  failWith(sink: 'add' | 'update', error: Error): void;
}

function harness(queue: 'outbox-relay' | 'housekeeping' = 'outbox-relay'): Harness {
  const added: Added[] = [];
  const updates: unknown[] = [];
  const processed: string[] = [];
  const raw: string[] = [];
  const failing: { add?: Error; update?: Error } = {};
  const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { context: jobLogContext, level: 'debug' });
  const deadLetter: DeadLetterSink = {
    add: (name, record, options) => {
      if (failing.add !== undefined) return Promise.reject(failing.add);
      added.push({ name, record, options });
      return Promise.resolve();
    },
  };
  return {
    added,
    updates,
    processed,
    get lines() {
      return raw.flatMap((chunk) =>
        chunk
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>),
      );
    },
    failWith: (sink, error) => {
      failing[sink] = error;
    },
    handle: (job, processor) => {
      const handler = createJobHandler({
        queue,
        log,
        deadLetter,
        processor:
          processor ??
          ((payload) => {
            processed.push(payload.id);
            return Promise.resolve();
          }),
      });
      return handler({
        id: 'outbox_event.x',
        name: 'outbox_event',
        attemptsMade: 0,
        opts: { attempts: 5 },
        updateData: (data) => {
          if (failing.update !== undefined) return Promise.reject(failing.update);
          updates.push(data);
          return Promise.resolve();
        },
        ...job,
      });
    },
  };
}

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 2,
  kind: 'outbox_event',
  id: randomUUID(),
  correlation_id: 'demo-booking-0001',
  trace_context: null,
  ...overrides,
});

const caught = async (work: Promise<unknown>): Promise<Error> => {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a rejection');
};

describe('persistedFailure: what BullMQ keeps of a failed attempt (PR64-SEC-02)', () => {
  it('is the reason code only, with no message text and no frames; the retry decision survives', () => {
    const transient = persistedFailure(new Error(`upstream said ${SENTINEL}`));
    expect([transient.name, transient.message, transient.stack]).toEqual(['Error', 'TRANSIENT', 'Error: TRANSIENT']);
    expect(transient).not.toBeInstanceOf(UnrecoverableError);
    for (const final of [new NonRetryableError('VALIDATION_ERROR', `row ${SENTINEL}`), new UnrecoverableError(SENTINEL)]) {
      const failure = persistedFailure(final);
      expect(failure).toBeInstanceOf(UnrecoverableError);
      expect(failure.name).toBe('UnrecoverableError');
      expect(failure.stack).toBe(`UnrecoverableError: ${failure.message}`);
      expect(failure.stack).not.toContain(SENTINEL);
    }
    expect(persistedFailure(new NonRetryableError('VALIDATION_ERROR', 'x')).message).toBe('VALIDATION_ERROR');
    expect(persistedFailure(new UnrecoverableError('x')).message).toBe('UNRECOVERABLE');
    expect(persistedFailure('plain string').message).toBe('TRANSIENT');
  });
});

describe('job handler', () => {
  it('runs the processor for a valid payload inside the job log context and writes nothing else', async () => {
    const h = harness();
    const data = payload();
    await h.handle({ data });
    expect(h.processed).toEqual([data['id']]);
    expect(h.added).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it('[PR64-SEC-02] a transient failure is rethrown as a plain TRANSIENT error: no message, no frames, no record yet', async () => {
    const h = harness();
    const error = await caught(
      h.handle({ data: payload(), attemptsMade: 1 }, () => Promise.reject(new Error(`connect failed with ${SENTINEL}`))),
    );
    expect([error.name, error.message, error.stack]).toEqual(['Error', 'TRANSIENT', 'Error: TRANSIENT']);
    expect(h.added).toEqual([]);
    expect(h.lines).toContainEqual(
      expect.objectContaining({ event: 'worker.job_failed', attempt: 2, final: false, reason: 'TRANSIENT', error: 'Error' }),
    );
    expect(JSON.stringify(h.lines)).not.toContain('sentinelsig');
  });

  it('[AT-US-009-02] the last attempt writes one redacted record before the error leaves, with the attempt count', async () => {
    const h = harness();
    const data = payload();
    const error = await caught(h.handle({ data, attemptsMade: 4 }, () => Promise.reject(new Error(`upstream refused ${SENTINEL}`))));
    expect(error.message).toBe('TRANSIENT');
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({
      name: 'outbox_event',
      record: { queue: 'outbox-relay', job_id: 'outbox_event.x', reason: 'RETRIES_EXHAUSTED', error: 'Error', attempts: 5, data },
      options: { jobId: 'outbox_event.x.dead.5', removeOnComplete: false, removeOnFail: false },
    });
    expect(JSON.stringify(h.added)).not.toContain('sentinelsig');
    expect(h.lines).toContainEqual(
      expect.objectContaining({ event: 'worker.job_dead_lettered', reason: 'RETRIES_EXHAUSTED', attempts: 5 }),
    );
  });

  it('[AT-US-009-03] a NonRetryableError is final on the first attempt and stays an UnrecoverableError with its reason', async () => {
    const h = harness();
    const error = await caught(
      h.handle({ data: payload() }, () => Promise.reject(new NonRetryableError('MISSING_TENANT_CONTEXT', 'org x'))),
    );
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('MISSING_TENANT_CONTEXT');
    expect(h.added[0]).toMatchObject({ record: { reason: 'MISSING_TENANT_CONTEXT', error: 'NonRetryableError', attempts: 1 } });
  });

  it("[R1-m2] BullMQ's own UnrecoverableError, or any error named so, is final too and dead-lettered as UNRECOVERABLE", async () => {
    for (const thrown of [new UnrecoverableError(`stop ${SENTINEL}`), Object.assign(new Error('stop'), { name: 'UnrecoverableError' })]) {
      const h = harness();
      const error = await caught(h.handle({ data: payload() }, () => Promise.reject(thrown)));
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error.message).toBe('UNRECOVERABLE');
      expect(h.added).toHaveLength(1);
      expect(h.added[0]).toMatchObject({ record: { reason: 'UNRECOVERABLE', error: 'UnrecoverableError', attempts: 1 } });
      expect(h.lines).toContainEqual(expect.objectContaining({ event: 'worker.job_failed', final: true, reason: 'UNRECOVERABLE' }));
    }
  });

  it('[R1-M1] a job with an auto-increment id ("7") gets a record id BullMQ accepts; a job without an id gets none', async () => {
    const auto = harness();
    await caught(auto.handle({ id: '7', data: payload() }, () => Promise.reject(new NonRetryableError('VALIDATION_ERROR'))));
    expect(auto.added[0]?.options).toEqual({ jobId: '7.dead.1', removeOnComplete: false, removeOnFail: false });
    const none = harness();
    await caught(none.handle({ id: undefined, data: payload() }, () => Promise.reject(new NonRetryableError('VALIDATION_ERROR'))));
    expect(none.added[0]?.options).toEqual({ removeOnComplete: false, removeOnFail: false });
  });

  it('[AT-US-009-04] a payload carrying "token" never reaches the processor; record and stored data are redacted; the error has no issue text', async () => {
    const h = harness();
    const error = await caught(h.handle({ id: '9', data: payload({ token: TOKEN }) }));
    expect(h.processed).toEqual([]);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect([error.message, error.stack]).toEqual(['PAYLOAD_INVALID', 'UnrecoverableError: PAYLOAD_INVALID']);
    expect(h.added[0]).toMatchObject({
      record: {
        reason: 'PAYLOAD_INVALID',
        attempts: 1,
        data: { token: REDACTED },
        message: expect.stringContaining('payload v2 refused'),
      },
      options: { jobId: '9.dead.1' },
    });
    expect(h.updates).toEqual([expect.objectContaining({ token: REDACTED })]);
    expect(JSON.stringify([h.added, h.updates, h.lines, error.stack])).not.toContain(TOKEN);
    expect(h.lines.some((line) => line['event_type'] === 'security')).toBe(false);
  });

  it('[ADR-0013 am. 1] a payload carrying org_id also emits the job_context_mismatch security event', async () => {
    const h = harness();
    await caught(h.handle({ data: payload({ org_id: randomUUID() }) }));
    expect(h.lines).toContainEqual(
      expect.objectContaining({ event: 'job_context_mismatch', event_type: 'security', queue: 'outbox-relay', reason: 'PAYLOAD_INVALID' }),
    );
  });

  it('[R1-m1] a payload without a kind is refused on a queue that has no kinds, and on a queue that has', async () => {
    const kindless = Object.fromEntries(Object.entries(payload()).filter(([key]) => key !== 'kind'));
    for (const queue of ['housekeeping', 'outbox-relay'] as const) {
      const h = harness(queue);
      const error = await caught(h.handle({ data: kindless }));
      expect(error.message).toBe('PAYLOAD_INVALID');
      expect(h.processed).toEqual([]);
    }
  });

  it('a failed redaction of the stored data never turns the final refusal into a retry of the raw data', async () => {
    const h = harness();
    h.failWith('update', new Error('connection lost'));
    const error = await caught(h.handle({ data: payload({ token: TOKEN }) }));
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(h.added).toHaveLength(1);
    expect(h.lines).toContainEqual(expect.objectContaining({ event: 'worker.job_data_redact_failed', error: 'Error' }));
  });

  it('a failed dead-letter write is logged (class only) and never masks the job error', async () => {
    const h = harness();
    h.failWith('add', new Error(`write refused ${SENTINEL}`));
    const error = await caught(h.handle({ data: payload() }, () => Promise.reject(new NonRetryableError('PERMISSION_DENIED'))));
    expect(error.message).toBe('PERMISSION_DENIED');
    expect(h.lines).toContainEqual(expect.objectContaining({ event: 'worker.dead_letter_write_failed', error: 'Error' }));
    expect(JSON.stringify(h.lines)).not.toContain('sentinelsig');
  });
});
