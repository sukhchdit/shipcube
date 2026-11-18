/**
 * Named queues with retries and dead-letter queues against a real Valkey 8 (Testcontainers; US-009 AT-US-009-01..05,
 * REQ-PLAT-013, NFR-RES-004, D-062 AT-US-008-03 job-payload hop; TASK-035). Every case uses its own key prefix, so
 * the cases share one container without seeing each other's jobs.
 */
import { randomUUID } from 'node:crypto';

import { createJobProducer, createRuntimeLog, type RuntimeLog } from '@platform/api/runtime';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { Config } from '@platform/config';
import { REDACTED } from '@platform/shared/logging';
import { deadLetterQueueName, type JobPayloadV2, type QueueName } from '@platform/shared/queues';
import { type ConnectionOptions, type Job, Queue, UnrecoverableError } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { createProductionQueues } from '../../start-worker.js';
import { jobLogContext } from '../logging/job-context.js';
import { queueConnectionOptions } from './connection.js';
import { createQueueConsumer, type JobProcessor, type QueueConsumer } from './consumer.js';
import { type DeadLetterRecord, RETRIES_EXHAUSTED } from './dead-letter.js';
import { NonRetryableError } from './errors.js';
import { createWorkerQueues } from './runtime.js';

/** Valkey 8.1 (Alpine), pinned by digest; the image of the api readiness suite. */
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a';

jest.setTimeout(120_000);

let container: StartedTestContainer;
let url: string;
/** The `worker` profile (blocking commands): Workers only. */
let connection: ConnectionOptions;
/** The fail-fast `queue` profile: every Queue. */
let queueConnection: ConnectionOptions;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  container = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  url = `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`;
  connection = queueConnectionOptions(url, 'worker-consumers-it', 'worker');
  queueConnection = queueConnectionOptions(url, 'worker-queues-it', 'queue');
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await container.stop();
});

interface Captured {
  readonly log: RuntimeLog;
  lines(): Record<string, unknown>[];
}

/** A real worker logger (job context binding included) writing JSON lines to memory. */
function captureLog(): Captured {
  const raw: string[] = [];
  const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { context: jobLogContext, level: 'debug' });
  return {
    log,
    lines: () =>
      raw.flatMap((chunk) =>
        chunk
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>),
      ),
  };
}

const ID = (): string => randomUUID();

/** One BullMQ Queue per name under `prefix` for a producer, closed after the file. */
function producerQueues(prefix: string): (name: QueueName) => Queue {
  const open = new Map<QueueName, Queue>();
  cleanups.push(async () => {
    await Promise.all([...open.values()].map((queue) => queue.close()));
  });
  return (name) => {
    let queue = open.get(name);
    if (queue === undefined) {
      queue = new Queue(name, { connection: queueConnection, prefix });
      open.set(name, queue);
    }
    return queue;
  };
}
const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 2,
  kind: 'outbox_event',
  id: ID(),
  correlation_id: 'demo-booking-0001',
  trace_context: null,
  ...overrides,
});

interface Fixture {
  readonly prefix: string;
  readonly queue: Queue;
  readonly deadLetter: Queue;
  readonly consumer: QueueConsumer;
  readonly captured: Captured;
}

/** A consumer of `outbox-relay` (or `name`) under a fresh prefix, started; closed after the file. */
function consume(
  processor: JobProcessor,
  options: { readonly retryBaseMs?: number; readonly random?: () => number; readonly name?: QueueName } = {},
): Fixture {
  const prefix = `it${randomUUID().slice(0, 8)}`;
  const name = options.name ?? 'outbox-relay';
  const captured = captureLog();
  const queue = new Queue(name, { connection: queueConnection, prefix });
  const deadLetter = new Queue(deadLetterQueueName(name), { connection: queueConnection, prefix });
  const consumer = createQueueConsumer({
    queue: name,
    processor,
    connection,
    queueConnection,
    log: captured.log,
    prefix,
    retryBaseMs: options.retryBaseMs ?? 10,
    ...(options.random === undefined ? {} : { random: options.random }),
  });
  consumer.start();
  cleanups.push(async () => {
    await consumer.close(true);
    await Promise.all([queue.close(), deadLetter.close()]);
  });
  return { prefix, queue, deadLetter, consumer, captured };
}

/** Polls until `check` returns a value (bounded); real time, the queue runs in Valkey. */
async function until<T>(check: () => Promise<T | undefined> | T | undefined, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function deadLetters(deadLetter: Queue, count: number): Promise<DeadLetterRecord[]> {
  return until(async () => {
    const jobs = await deadLetter.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    return jobs.length >= count ? jobs.map((job) => job.data as DeadLetterRecord) : undefined;
  });
}

/**
 * Waits for the dead-letter record(s) AND for BullMQ to have moved the job to `failed`. The consumer writes the record
 * before it rethrows, so the record appears a few ms before `moveToFailed`; reading the state once after the record
 * races (R1-m3).
 */
async function settledFailure(
  queue: Queue,
  deadLetter: Queue,
  jobId: string,
  count = 1,
): Promise<{ records: DeadLetterRecord[]; job: Job }> {
  return until(async () => {
    const records = await deadLetters(deadLetter, count);
    const job = await queue.getJob(jobId);
    return job !== undefined && (await job.getState()) === 'failed' ? { records, job } : undefined;
  });
}

const transient = (): Error => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

describe('US-009 named queues with retries and dead-letter queues (Valkey 8)', () => {
  it('[AT-US-009-01] a job failing twice with a network error is attempted 3 times, about 2 s then 4 s apart with jitter, and completes', async () => {
    const attempts: number[] = [];
    const { queue } = consume(
      () => {
        attempts.push(Date.now());
        return attempts.length <= 2 ? Promise.reject(transient()) : Promise.resolve();
      },
      { retryBaseMs: 2_000, random: () => 0.5 },
    );
    const job = await queue.add('outbox_event', payload(), {
      jobId: `outbox_event.${ID()}`,
      attempts: 5,
      backoff: { type: 'jittered-exponential', delay: 2_000 },
    });
    await until(async () => ((await job.getState()) === 'completed' ? true : undefined));
    expect(attempts).toHaveLength(3);
    const [first = 0, second = 0, third = 0] = attempts;
    // Nominal 2 s and 4 s (random 0.5 = the middle of the ±20 % jitter band); the bounds allow scheduling slack only.
    expect(second - first).toBeGreaterThanOrEqual(1_950);
    expect(second - first).toBeLessThan(3_500);
    expect(third - second).toBeGreaterThanOrEqual(3_950);
    expect(third - second).toBeLessThan(5_500);
  });

  it('[AT-US-009-02] a job that always fails transiently is attempted 5 times, then one dead-letter record holds the redacted data, the reason and attempt count 5', async () => {
    let calls = 0;
    const { queue, deadLetter } = consume(() => {
      calls += 1;
      return Promise.reject(transient());
    });
    const data = payload();
    const jobId = `outbox_event.${String(data['id'])}`;
    await queue.add('outbox_event', data, {
      jobId,
      attempts: 5,
      backoff: { type: 'jittered-exponential', delay: 10 },
    });
    const {
      records: [record],
    } = await settledFailure(queue, deadLetter, jobId);
    expect(calls).toBe(5);
    expect(record).toMatchObject({ queue: 'outbox-relay', job_id: jobId, reason: RETRIES_EXHAUSTED, error: 'Error', attempts: 5, data });
    // The record has its own namespaced id (R1-M1): one record for the job's final attempt.
    expect((await deadLetter.getJob(`${jobId}.dead.5`))?.data).toEqual(record);
  });

  it('[PR64-SEC-02] a transient failure whose message carries a secret leaves no raw text in the failed job: failedReason, stacktrace and data are sanitised', async () => {
    const secret = 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.int-sentinel-sig';
    const { queue, deadLetter } = consume(() => Promise.reject(new Error(`carrier refused ${secret}`)));
    const data = payload();
    const jobId = `outbox_event.${String(data['id'])}`;
    await queue.add('outbox_event', data, { jobId, attempts: 2, backoff: { type: 'jittered-exponential', delay: 10 }, stackTraceLimit: 0 });
    const {
      records: [record],
      job,
    } = await settledFailure(queue, deadLetter, jobId);
    expect(job.failedReason).toBe('TRANSIENT');
    expect(job.stacktrace).toEqual([]);
    expect(JSON.stringify(job)).not.toContain('int-sentinel-sig');
    expect(JSON.stringify(job)).not.toContain('carrier refused');
    // The record keeps the original message, redacted and bounded.
    expect(record?.message).toContain('carrier refused');
    expect(JSON.stringify(record)).not.toContain('int-sentinel-sig');
  });

  it("[R1-m2] a processor throwing BullMQ's own UnrecoverableError is attempted once and dead-lettered as UNRECOVERABLE", async () => {
    let calls = 0;
    const { queue, deadLetter } = consume(() => {
      calls += 1;
      return Promise.reject(new UnrecoverableError('stop here'));
    });
    const jobId = `outbox_event.${ID()}`;
    await queue.add('outbox_event', payload(), { jobId, attempts: 5, backoff: { type: 'jittered-exponential', delay: 10 } });
    const {
      records: [record],
      job,
    } = await settledFailure(queue, deadLetter, jobId);
    expect(calls).toBe(1);
    expect(record).toMatchObject({ reason: 'UNRECOVERABLE', error: 'UnrecoverableError', attempts: 1 });
    expect(job.failedReason).toBe('UNRECOVERABLE');
  });

  it.each([
    ['AT-US-009-03-1', 'validation error', 'VALIDATION_ERROR'],
    ['AT-US-009-03-2', 'missing tenant context', 'MISSING_TENANT_CONTEXT'],
  ] as const)('[%s] a job failing with a %s is attempted once and dead-lettered immediately', async (_id, _label, reason) => {
    let calls = 0;
    const { queue, deadLetter } = consume(() => {
      calls += 1;
      return Promise.reject(new NonRetryableError(reason));
    });
    await queue.add('outbox_event', payload(), {
      jobId: `outbox_event.${ID()}`,
      attempts: 5,
      backoff: { type: 'jittered-exponential', delay: 10 },
    });
    const [record] = await deadLetters(deadLetter, 1);
    expect(calls).toBe(1);
    expect(record).toMatchObject({ reason, error: 'NonRetryableError', attempts: 1 });
  });

  it('[AT-US-009-04] a payload carrying a "token" field never reaches the processor; its dead-letter record shows [REDACTED]', async () => {
    let calls = 0;
    const { queue, deadLetter } = consume(() => {
      calls += 1;
      return Promise.resolve();
    });
    const jobId = `outbox_event.${ID()}`;
    await queue.add('outbox_event', payload({ token: 'tok_live_secret_value' }), { jobId, attempts: 5 });
    const {
      records: [record],
      job,
    } = await settledFailure(queue, deadLetter, jobId);
    expect(calls).toBe(0);
    expect(record).toMatchObject({ reason: 'PAYLOAD_INVALID', attempts: 1, data: { token: REDACTED } });
    expect(JSON.stringify(record)).not.toContain('tok_live_secret_value');
    // PR64-SEC-02: the failed-set original beside the record is redacted too (data, failedReason, stacktrace).
    expect(job.data).toMatchObject({ token: REDACTED });
    expect(job.failedReason).toBe('PAYLOAD_INVALID');
    // The whole job as read back from its Valkey hash (data, opts, failedReason, stacktrace) carries no sentinel.
    expect(JSON.stringify(job)).not.toContain('tok_live_secret_value');
    expect(JSON.stringify(job.toJSON())).not.toContain('tok_live_secret_value');
  });

  it('[R1-M1] a forged job enqueued WITHOUT a custom id (auto-increment id) still gets exactly one dead-letter record and the security event', async () => {
    const { queue, deadLetter, captured } = consume(() => Promise.resolve());
    const job = await queue.add('outbox_event', payload({ org_id: ID(), token: 'tok_live_secret_value' }), { attempts: 5 });
    expect(job.id).toMatch(/^\d+$/);
    const { records, job: failed } = await settledFailure(queue, deadLetter, job.id ?? '');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ job_id: job.id, reason: 'PAYLOAD_INVALID', attempts: 1, data: { token: REDACTED } });
    expect((await deadLetter.getJob(`${String(job.id)}.dead.1`))?.data).toEqual(records[0]);
    expect(failed.data).toMatchObject({ token: REDACTED });
    expect(captured.lines()).toContainEqual(
      expect.objectContaining({ event: 'job_context_mismatch', event_type: 'security', queue: 'outbox-relay', reason: 'PAYLOAD_INVALID' }),
    );
    expect(captured.lines().some((line) => line['event'] === 'worker.dead_letter_write_failed')).toBe(false);
  });

  it('[ADR-0013 am. 1] a payload carrying org_id is refused as PAYLOAD_INVALID and emits the job_context_mismatch security event', async () => {
    const { queue, deadLetter, captured } = consume(() => Promise.resolve());
    await queue.add('outbox_event', payload({ org_id: ID() }), { jobId: `outbox_event.${ID()}`, attempts: 5 });
    const [record] = await deadLetters(deadLetter, 1);
    expect(record).toMatchObject({ reason: 'PAYLOAD_INVALID' });
    expect(captured.lines()).toContainEqual(
      expect.objectContaining({ event: 'job_context_mismatch', event_type: 'security', queue: 'outbox-relay', reason: 'PAYLOAD_INVALID' }),
    );
  });

  it('[AT-US-009-05] queue depth and failed count are exposed per named queue, with the dead-letter depth', async () => {
    const captured = captureLog();
    const prefix = `it${randomUUID().slice(0, 8)}`;
    const queues = createWorkerQueues({
      connection,
      queueConnection,
      log: captured.log,
      prefix,
      retryBaseMs: 10,
      processors: { booking: () => Promise.reject(new NonRetryableError('PERMISSION_DENIED')) },
    });
    cleanups.push(() => queues.close());
    expect(queues.consuming).toEqual(['booking']);
    queues.start();
    const producer = createJobProducer({ queueFor: producerQueues(prefix), contextCorrelationId: () => 'demo-booking-0001' });
    await producer.enqueue('booking', { kind: 'saga', id: ID(), step: 'book' });
    await producer.enqueue('payments', { kind: 'payment', id: ID() });
    await producer.enqueue('payments', { kind: 'payment', id: ID() });
    // The record is written a few ms before BullMQ moves the job to failed: wait for both in one snapshot (R1-m3).
    const text = await until(async () => {
      const current = await queues.metrics();
      return current.includes('platform_queue_dead_letter_jobs{queue="booking"} 1\n') &&
        current.includes('platform_queue_jobs{queue="booking",state="failed"} 1\n')
        ? current
        : undefined;
    });
    expect(text).toContain('platform_queue_jobs{queue="booking",state="failed"} 1\n');
    expect(text).toContain('platform_queue_jobs{queue="payments",state="waiting"} 2\n');
    expect(text).toContain('platform_queue_dead_letter_jobs{queue="payments"} 0\n');
    expect(text.match(/^platform_queue_dead_letter_jobs\{/gmu)).toHaveLength(9);
  });

  it('[DR-A25] a duplicate enqueue of the same business key is one job, processed once (deterministic job id)', async () => {
    const processed: string[] = [];
    const { prefix } = consume((_payload, job) => {
      processed.push(job.id);
      return Promise.resolve();
    });
    const producer = createJobProducer({ queueFor: producerQueues(prefix), contextCorrelationId: () => 'demo-booking-0001' });
    const ref = { kind: 'outbox_event', id: ID() } as const;
    const [first, second] = await Promise.all([producer.enqueue('outbox-relay', ref), producer.enqueue('outbox-relay', ref)]);
    expect(first.jobId).toBe(second.jobId);
    await until(() => (processed.length >= 1 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(processed).toEqual([first.jobId]);
  });

  it('[AT-US-008-03] the producer copies the request correlation id into payload v2 and every worker line of the job carries it', async () => {
    const holder: { log?: RuntimeLog } = {};
    const fixture = consume((_payload, job) => {
      holder.log?.info('test.job_step', { step: job.name });
      return Promise.resolve();
    });
    holder.log = fixture.captured.log;
    const producer = createJobProducer({ queueFor: producerQueues(fixture.prefix), contextCorrelationId: () => 'demo-booking-0001' });
    const job = await producer.enqueue('outbox-relay', { kind: 'outbox_event', id: ID() });
    expect(job.payload.correlation_id).toBe('demo-booking-0001');
    const stored = await until(async () => (await fixture.queue.getJob(job.jobId))?.data as JobPayloadV2 | undefined);
    expect(stored).toEqual(job.payload);
    const line = await until(() => fixture.captured.lines().find((entry) => entry['event'] === 'test.job_step'));
    expect(line).toMatchObject({ correlation_id: 'demo-booking-0001', service: 'worker' });
  });

  it('[NFR-RES-004] a worker killed mid-job loses nothing: the stalled job is re-delivered and all 10 complete on the restarted worker', async () => {
    const prefix = `it${randomUUID().slice(0, 8)}`;
    const captured = captureLog();
    const tuning = { lockDuration: 1_000, stalledInterval: 300 };
    let started = 0;
    const crashing = createQueueConsumer({
      queue: 'outbox-relay',
      connection,
      queueConnection,
      log: captured.log,
      prefix,
      concurrency: 1,
      tuning,
      // The first job never finishes on this worker: it is "killed" (force-closed) mid-job.
      processor: () => {
        started += 1;
        return new Promise<void>(() => undefined);
      },
    });
    const queue = new Queue('outbox-relay', { connection: queueConnection, prefix });
    cleanups.push(() => queue.close());
    const producer = createJobProducer({ queueFor: () => queue, contextCorrelationId: () => 'demo-booking-0001' });
    const ids = await Promise.all(Array.from({ length: 10 }, () => producer.enqueue('outbox-relay', { kind: 'outbox_event', id: ID() })));
    crashing.start();
    await until(() => (started >= 1 ? true : undefined));
    await crashing.close(true);

    const completed = new Map<string, number>();
    const restarted = createQueueConsumer({
      queue: 'outbox-relay',
      connection,
      queueConnection,
      log: captured.log,
      prefix,
      tuning,
      processor: (_payload, job) => {
        completed.set(job.id, (completed.get(job.id) ?? 0) + 1);
        return Promise.resolve();
      },
    });
    cleanups.push(() => restarted.close());
    restarted.start();
    await until(async () => ((await queue.getJobCounts('completed'))['completed'] === 10 ? true : undefined));
    expect([...completed.keys()].sort()).toEqual(ids.map((job) => job.jobId).sort());
    expect([...completed.values()].every((count) => count === 1)).toBe(true);
    expect(await queue.getJobCounts('failed', 'waiting', 'active', 'delayed')).toEqual({ failed: 0, waiting: 0, active: 0, delayed: 0 });
  });

  it('createProductionQueues builds every named queue on the worker connection from REDIS_URL; no processor, no consumer', async () => {
    const captured = captureLog();
    const config = { REDIS_URL: { reveal: () => url } } as unknown as Config;
    const queues = createProductionQueues({ config, log: captured.log, processors: {} });
    try {
      expect(queues.consuming).toEqual([]);
      queues.start();
      expect(await queues.metrics()).toContain('platform_queue_jobs{queue="tracking-poll",state="waiting"} 0\n');
    } finally {
      await queues.close();
    }
    expect(captured.lines()).toContainEqual(expect.objectContaining({ event: 'worker.queues_started', queues: '' }));
  });
});
