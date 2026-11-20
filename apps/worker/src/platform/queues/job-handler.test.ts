// Unit tests of the per-job logic around a processor (TASK-035), with a fake job and a fake dead-letter queue: the
// payload gate, the retry/final decision, the dead-letter record and id (R1-M1, R1-m2) and the sanitised error BullMQ
// persists (PR64-SEC-02). consumer.int.test.ts runs the same paths through a real BullMQ Worker on Valkey.
import { randomUUID } from 'node:crypto';

import { createRuntimeLog } from '@platform/api/runtime';
import { describe, expect, it } from '@jest/globals';
import { REDACTED } from '@platform/shared/logging';
import { UnrecoverableError } from 'bullmq';

import { jobLogContext } from '../logging/job-context.js';
import { isDeferredFailure } from './consumer.js';
import type { DeadLetterRecord } from './dead-letter.js';
import { NonRetryableError } from './errors.js';
import {
  createJobHandler,
  createStalledFailureRecorder,
  type DeadLetterSink,
  type HandledJob,
  type JobProcessor,
  persistedFailure,
} from './job-handler.js';

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
  /** Queues passed to onDeadLettered (the counter). */
  readonly counted: string[];
  handle(job: Partial<HandledJob> & { data: unknown }, processor?: JobProcessor): Promise<void>;
  failWith(sink: 'add' | 'update', error: Error): void;
}

interface HarnessOptions {
  readonly deadLetterCount?: number;
  readonly deadlineMs?: number;
}

function harness(queue: 'outbox-relay' | 'housekeeping' = 'outbox-relay', options: HarnessOptions = {}): Harness {
  const counted: string[] = [];
  const added: Added[] = [];
  const updates: unknown[] = [];
  const processed: string[] = [];
  const raw: string[] = [];
  const failing: { add?: Error; update?: Error } = {};
  const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { context: jobLogContext, level: 'debug' });
  const deadLetter: DeadLetterSink = {
    add: (name, record, options) => {
      if (failing.add !== undefined) return Promise.reject(failing.add);
      // BullMQ ignores an add whose id exists (the stored record stays).
      if (options.jobId !== undefined && added.some((entry) => entry.options['jobId'] === options.jobId)) return Promise.resolve();
      added.push({ name, record, options });
      return Promise.resolve();
    },
    getJob: (id) =>
      Promise.resolve(added.find((entry) => entry.options['jobId'] === id)?.record).then((data) =>
        data === undefined ? undefined : { data },
      ),
    getWaitingCount: () => Promise.resolve(added.length),
    clean: (_grace, limit) => Promise.resolve(added.splice(0, limit).map((entry) => String(entry.options['jobId']))),
  };
  return {
    added,
    updates,
    processed,
    counted,
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
        onDeadLettered: (name) => counted.push(name),
        ...options,
        processor:
          processor ??
          ((payload) => {
            processed.push('id' in payload ? payload.id : payload.schedule);
            return Promise.resolve();
          }),
      });
      return handler({
        id: keyOf(job.data),
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

/** The job id the dequeue check expects for an aggregate payload: <kind>.<id>. */
function keyOf(data: unknown): string {
  const { kind, id } = (data ?? {}) as { kind?: unknown; id?: unknown };
  return typeof kind === 'string' && typeof id === 'string' ? `${kind}.${id}` : 'outbox_event.x';
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
      record: { queue: 'outbox-relay', job_id: keyOf(data), reason: 'RETRIES_EXHAUSTED', error: 'Error', attempts: 5, data },
      options: { jobId: `${keyOf(data)}.dead.5`, removeOnComplete: false, removeOnFail: false },
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

  it('[R1-M1][PR64-SEC-07] a job with an auto-increment id ("7") is refused at dequeue with a record id BullMQ accepts; a job without an id gets none', async () => {
    const auto = harness();
    expect((await caught(auto.handle({ id: '7', data: payload() }))).message).toBe('PAYLOAD_INVALID');
    expect(auto.processed).toEqual([]);
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
    // The failed write still counts: the counter is +1 per final failure, written or not (D-ARCH-160).
    expect(h.counted).toEqual(['outbox-relay']);
  });
});

describe('US-010 dequeue refusals (D-PM-072 wording; ADR-0013 am. 1 items 2-3)', () => {
  it.each([
    ['without kind', (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'kind')), false],
    ['without id', (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'id')), false],
    ['carrying org_id', (data: Record<string, unknown>) => ({ ...data, org_id: randomUUID() }), true],
    ['carrying actor_id', (data: Record<string, unknown>) => ({ ...data, actor_id: randomUUID() }), true],
  ] as const)(
    '[AT-US-010-04] a delivered job %s is PAYLOAD_INVALID after one attempt and dead-lettered',
    async (_label, edit, mismatch) => {
      const h = harness();
      const data = edit(payload());
      const error = await caught(h.handle({ id: `outbox_event.${randomUUID()}`, data }));
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error.message).toBe('PAYLOAD_INVALID');
      expect(h.processed).toEqual([]);
      expect(h.added).toHaveLength(1);
      expect(h.added[0]?.record).toMatchObject({ reason: 'PAYLOAD_INVALID', attempts: 1 });
      expect(h.lines.some((line) => line['event'] === 'job_context_mismatch' && line['event_type'] === 'security')).toBe(mismatch);
    },
  );
});

describe('[PR64-SEC-07] job identity and per-job deadline', () => {
  it('refuses a job whose id names another aggregate than its payload, or whose name is not the kind', async () => {
    for (const job of [{ id: `outbox_event.${randomUUID()}` }, { name: 'saga' }]) {
      const h = harness();
      const data = payload();
      const error = await caught(h.handle({ ...job, data }));
      expect(error.message).toBe('PAYLOAD_INVALID');
      expect(h.processed).toEqual([]);
      expect(h.lines.some((line) => line['event'] === 'job_context_mismatch')).toBe(false);
    }
  });

  it('gives the processor the correlation id and a live signal; a processor past its deadline is aborted and the attempt is transient', async () => {
    const h = harness('outbox-relay', { deadlineMs: 20 });
    const seen: { signal?: AbortSignal; correlationId?: string } = {};
    const error = await caught(
      h.handle({ data: payload() }, (_payload, job) => {
        seen.signal = job.signal;
        seen.correlationId = job.correlationId;
        expect(job.signal.aborted).toBe(false);
        return new Promise<void>(() => undefined);
      }),
    );
    expect(seen.correlationId).toBe('demo-booking-0001');
    expect(seen.signal?.aborted).toBe(true);
    expect(error.message).toBe('TRANSIENT');
    expect(h.lines).toContainEqual(expect.objectContaining({ event: 'worker.job_failed', reason: 'TRANSIENT', error: 'JobDeadlineError' }));
  });

  it('[R1-M1][PR039-SEC-01] a processor that throws synchronously is a transient failure: no unhandled rejection, the deadline timer is cleared', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const h = harness('outbox-relay', { deadlineMs: 20 });
      let signal: AbortSignal | undefined;
      const syncThrow: JobProcessor = (_payload, job) => {
        signal = job.signal;
        throw new Error('thrown before any await');
      };
      const error = await caught(h.handle({ data: payload() }, syncThrow));
      expect(error.message).toBe('TRANSIENT');
      expect(h.lines).toContainEqual(expect.objectContaining({ event: 'worker.job_failed', reason: 'TRANSIENT', error: 'Error' }));
      // Well past the deadline: a timer left armed would have aborted the signal and rejected the deadline promise.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(signal?.aborted).toBe(false);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('a processor that rejects after its deadline is no unhandled rejection', async () => {
    const h = harness('outbox-relay', { deadlineMs: 5 });
    const late = new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('late')), 30));
    await caught(h.handle({ data: payload() }, () => late));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe('scheduled jobs at dequeue (D-TASK039-01)', () => {
  it('runs a scheduled occurrence with the occurrence as its correlation id, and refuses a forged one', async () => {
    const h = harness('housekeeping');
    let correlation = '';
    await h.handle(
      { id: 'repeat:queue-retention:1763550000000', name: 'queue-retention', data: { v: 2, schedule: 'queue-retention' } },
      (payload, job) => {
        correlation = job.correlationId;
        h.processed.push('schedule' in payload ? payload.schedule : 'aggregate');
        return Promise.resolve();
      },
    );
    expect(h.processed).toEqual(['queue-retention']);
    expect(correlation).toBe('queue-retention-1763550000000');
    const forged = harness('housekeeping');
    const error = await caught(
      forged.handle({ id: 'queue-retention.1', name: 'queue-retention', data: { v: 2, schedule: 'queue-retention' } }),
    );
    expect(error.message).toBe('PAYLOAD_INVALID');
  });
});

describe('[PR64-SEC-04][PR64-SEC-08] dead-letter write: counter, duplicate record, count trim', () => {
  const fail = (): Promise<void> => Promise.reject(new NonRetryableError('VALIDATION_ERROR'));

  it('counts +1 per final failure and +0 for an attempt that is retried', async () => {
    const h = harness();
    await caught(h.handle({ data: payload(), attemptsMade: 0 }, () => Promise.reject(new Error('x'))));
    expect(h.counted).toEqual([]);
    await caught(h.handle({ data: payload(), attemptsMade: 4 }, () => Promise.reject(new Error('x'))));
    expect(h.counted).toEqual(['outbox-relay']);
  });

  it('logs worker.job_dead_lettered only when the add created the record; a reused record id logs worker.dead_letter_duplicate', async () => {
    const h = harness();
    const data = payload();
    await caught(h.handle({ data }, fail));
    // An operator retry with resetAttemptsMade fails again on attempt 1: same record id, BullMQ ignores the add.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await caught(h.handle({ data }, fail));
    expect(h.added).toHaveLength(1);
    const events = h.lines.map((line) => line['event']);
    expect(events.filter((event) => event === 'worker.job_dead_lettered')).toHaveLength(1);
    expect(events.filter((event) => event === 'worker.dead_letter_duplicate')).toHaveLength(1);
    expect(h.counted).toEqual(['outbox-relay', 'outbox-relay']);
  });

  it('trims the oldest records above the count bound after a write, and makes no clean call at or below it', async () => {
    const h = harness('outbox-relay', { deadLetterCount: 2 });
    for (let index = 0; index < 2; index += 1) await caught(h.handle({ data: payload() }, fail));
    expect(h.lines.some((line) => line['event'] === 'worker.dead_letter_trimmed')).toBe(false);
    const third = payload();
    await caught(h.handle({ data: third }, fail));
    expect(h.added).toHaveLength(2);
    expect(h.added[1]?.record.job_id).toBe(keyOf(third));
    expect(h.lines).toContainEqual(expect.objectContaining({ event: 'worker.dead_letter_trimmed', queue: 'outbox-relay', count: 1 }));
  });
});

describe('[PR64-SEC-08] a job BullMQ failed itself after too many stalls', () => {
  it('isDeferredFailure is true only for a job BullMQ marked with a non-empty deferred failure', () => {
    expect(isDeferredFailure({ deferredFailure: 'job stalled more than allowable limit' })).toBe(true);
    for (const job of [{ deferredFailure: '' }, {}, { deferredFailure: 1 }, undefined, null]) expect(isDeferredFailure(job)).toBe(false);
  });

  it('gets a worker.job_failed line (reason STALLED), a dead-letter record and a count', async () => {
    const added: DeadLetterRecord[] = [];
    const raw: string[] = [];
    const counted: string[] = [];
    const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
    const record = createStalledFailureRecorder({
      queue: 'outbox-relay',
      log,
      onDeadLettered: (name) => counted.push(name),
      deadLetter: {
        add: (_name, entry) => {
          added.push(entry);
          return Promise.resolve();
        },
        getJob: () => Promise.resolve(undefined),
        getWaitingCount: () => Promise.reject(new Error('trim read failed')),
        clean: () => Promise.resolve([]),
      },
    });
    await record({ id: 'outbox_event.x', name: 'outbox_event', data: payload(), attemptsMade: 1 });
    expect(added).toEqual([expect.objectContaining({ reason: 'STALLED', error: 'NonRetryableError', attempts: 1 })]);
    expect(counted).toEqual(['outbox-relay']);
    const lines = raw
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'worker.job_failed', reason: 'STALLED', final: true, error: 'UnrecoverableError' }),
    );
    expect(lines).toContainEqual(expect.objectContaining({ event: 'worker.dead_letter_trim_failed', error: 'Error' }));
  });
});
