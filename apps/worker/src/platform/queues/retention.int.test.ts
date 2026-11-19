/**
 * Bounded retention, the dead-letter trim, the hourly sweep, the Valkey ACL users and the singleton schedulers against
 * a real Valkey 8 (Testcontainers; ADR-0013 am. 3 items 8-11 and 16, §5; PR64-SEC-04, PR64-SEC-11; US-010 AT-US-010-04
 * to -06; REQ-PLAT-015; TASK-039). The bounds are test seams of the consumer and of the sweep (as retryBaseMs is), so
 * the cases use small bounds; the production composition is pinned to the ADR constants in start-worker.test.ts. Every
 * case uses its own key prefix except the ACL case, which runs on its own container (the ACL allows `bull:*` only).
 * `MEMORY USAGE` of one failed job key and one record key is written to reports/queue-memory-usage.json for the PR body
 * (the ADR budget assumes about 2 KiB each).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntimeLog, type RuntimeLog } from '@platform/api/runtime';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { deadLetterQueueName, type QueueName } from '@platform/shared/queues';
import { type ConnectionOptions, Queue } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { jobLogContext } from '../logging/job-context.js';
import { queueConnectionOptions } from './connection.js';
import { createQueueConsumer, type JobProcessor } from './consumer.js';
import type { DeadLetterRecord } from './dead-letter.js';
import { NonRetryableError } from './errors.js';
import type { RetentionBounds } from './retention.js';
import { createWorkerQueues, type WorkerQueues } from './runtime.js';

/** Valkey 8.1 (Alpine), pinned by digest; the image of consumer.int.test.ts. */
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a';

jest.setTimeout(180_000);

/** The repository root (apps/worker/src/platform/queues -> five levels up). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

let container: StartedTestContainer;
let connection: ConnectionOptions;
let queueConnection: ConnectionOptions;
const cleanups: (() => Promise<void>)[] = [];
const memory: Record<string, number | null> = {};

beforeAll(async () => {
  container = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const url = `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`;
  connection = queueConnectionOptions(url, 'worker-consumers-rt', 'worker');
  queueConnection = queueConnectionOptions(url, 'worker-queues-rt', 'queue');
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await container.stop();
  if (Object.keys(memory).length > 0) {
    const dir = join(REPO_ROOT, 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'queue-memory-usage.json'), `${JSON.stringify({ budgetAssumptionBytes: 2048, bytes: memory }, null, 2)}\n`);
  }
});

interface Captured {
  readonly log: RuntimeLog;
  lines(): Record<string, unknown>[];
}

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

async function until<T>(check: () => Promise<T | undefined> | T | undefined, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const prefixOf = (): string => `rt${randomUUID().slice(0, 8)}`;
const payload = (id: string = randomUUID()): Record<string, unknown> => ({
  v: 2,
  kind: 'outbox_event',
  id,
  correlation_id: 'demo-booking-0001',
  trace_context: null,
});
const keyOf = (data: Record<string, unknown>): string => `outbox_event.${String(data['id'])}`;

const bounds = (failed: number, deadLetter: number, ageSeconds = 3_600): RetentionBounds => ({
  completed: { age: ageSeconds, count: 1_000 },
  failed: { age: ageSeconds, count: failed },
  deadLetter: { age: ageSeconds, count: deadLetter },
});

function openQueues(
  prefix: string,
  name: QueueName = 'outbox-relay',
  conn: ConnectionOptions = queueConnection,
): { queue: Queue; deadLetter: Queue } {
  const queue = new Queue(name, { connection: conn, prefix });
  const deadLetter = new Queue(deadLetterQueueName(name), { connection: conn, prefix });
  cleanups.push(async () => {
    await Promise.all([queue.close(), deadLetter.close()]);
  });
  return { queue, deadLetter };
}

function consume(prefix: string, processor: JobProcessor, retention: RetentionBounds, conn = connection, qconn = queueConnection) {
  const captured = captureLog();
  const consumer = createQueueConsumer({
    queue: 'outbox-relay',
    processor,
    connection: conn,
    queueConnection: qconn,
    log: captured.log,
    ...(prefix === 'bull' ? {} : { prefix }),
    retryBaseMs: 10,
    retention,
  });
  consumer.start();
  cleanups.push(() => consumer.close(true));
  return { consumer, captured };
}

/** Adds a job and waits until it is failed (final) or completed. */
async function settle(queue: Queue, data: Record<string, unknown>): Promise<string> {
  const jobId = keyOf(data);
  await queue.add('outbox_event', data, { jobId, attempts: 1 });
  await until(async () => {
    const state = await (await queue.getJob(jobId))?.getState();
    return state === 'failed' || state === 'completed' ? true : undefined;
  });
  return jobId;
}

async function records(deadLetter: Queue): Promise<DeadLetterRecord[]> {
  return (await deadLetter.getJobs(['waiting'])).map((job) => job.data as DeadLetterRecord);
}

async function memoryUsage(queue: Queue, key: string): Promise<number | null> {
  const client = (await queue.getBackend().client) as unknown as { call(...args: string[]): Promise<unknown> };
  return (await client.call('MEMORY', 'USAGE', key)) as number | null;
}

describe('[PR64-SEC-04] bounded retention (ADR-0013 am. 3; Valkey 8)', () => {
  it('the failed set keeps the newest N, a retained failed job can be retried, and each retained failed job still has its record', async () => {
    const prefix = prefixOf();
    const { queue, deadLetter } = openQueues(prefix);
    const failing = new Set<string>();
    consume(
      prefix,
      (data, job) => (failing.has(job.id) ? Promise.reject(new NonRetryableError('VALIDATION_ERROR')) : Promise.resolve()),
      bounds(3, 10),
    );
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const data = payload();
      failing.add(keyOf(data));
      ids.push(await settle(queue, data));
      await sleep(5);
    }
    const failed = (await queue.getJobs(['failed'])).map((job) => job.id).sort();
    expect(failed).toEqual(ids.slice(2).sort());
    // Item 9: a retained failed job normally still has its record.
    for (const id of failed) expect(await deadLetter.getJob(`${String(id)}.dead.1`)).toBeDefined();
    memory['failedJob'] = await memoryUsage(queue, `${prefix}:outbox-relay:${String(ids[4])}`);
    memory['deadLetterRecord'] = await memoryUsage(deadLetter, `${prefix}:outbox-relay-dead:${String(ids[4])}.dead.1`);
    // Redrive of a retained failed job is job.retry() (item 11).
    const retried = ids[4] ?? '';
    failing.delete(retried);
    await (await queue.getJob(retried))?.retry();
    await until(async () => ((await (await queue.getJob(retried))?.getState()) === 'completed' ? true : undefined));
  });

  it('the record write trims the dead-letter queue to its count bound and keeps the newest records', async () => {
    const prefix = prefixOf();
    const { queue, deadLetter } = openQueues(prefix);
    const { captured } = consume(prefix, () => Promise.reject(new NonRetryableError('VALIDATION_ERROR')), bounds(100, 2));
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(await settle(queue, payload()));
      await until(async () =>
        (await deadLetter.getWaitingCount()) <= 2 && (await records(deadLetter)).some((r) => r.job_id === ids.at(-1)) ? true : undefined,
      );
    }
    expect((await records(deadLetter)).map((record) => record.job_id).sort()).toEqual(ids.slice(2).sort());
    expect(captured.lines()).toContainEqual(
      expect.objectContaining({ event: 'worker.dead_letter_trimmed', queue: 'outbox-relay', count: 1 }),
    );
  });

  it('on a queue where nothing else finishes, the sweep removes failed jobs, completed jobs and records older than their bound and keeps newer ones', async () => {
    const prefix = prefixOf();
    const { queue, deadLetter } = openQueues(prefix);
    const failing = new Set<string>();
    // The consumer keeps everything (large bounds), so only the sweep can remove by age.
    consume(
      prefix,
      (_data, job) => (failing.has(job.id) ? Promise.reject(new NonRetryableError('VALIDATION_ERROR')) : Promise.resolve()),
      bounds(1_000, 1_000),
    );
    const make = async (fail: boolean): Promise<string> => {
      const data = payload();
      if (fail) failing.add(keyOf(data));
      return settle(queue, data);
    };
    const old = [await make(true), await make(false)];
    await sleep(4_500);
    const fresh = [await make(true), await make(false)];
    const captured = captureLog();
    const sweeper = createWorkerQueues({
      connection,
      queueConnection,
      log: captured.log,
      processors: {},
      prefix,
      retention: bounds(1_000, 1_000, 3),
    });
    cleanups.push(() => sweeper.close());
    const result = await sweeper.sweepRetention();
    expect(result).toMatchObject({ failed: 1, completed: 1, deadLetterAged: 1, deadLetterTrimmed: 0, failedQueues: [] });
    for (const id of old) expect(await queue.getJob(id)).toBeUndefined();
    for (const id of fresh) expect(await queue.getJob(id)).toBeDefined();
    expect((await records(deadLetter)).map((record) => record.job_id)).toEqual([fresh[0]]);
    expect(captured.lines().filter((line) => line['event'] === 'worker.queue_retention_swept')).toHaveLength(1);
  });

  it('[AT-US-010-04] a delivered job whose payload lacks id is PAYLOAD_INVALID after one attempt and dead-lettered (no security event)', async () => {
    const prefix = prefixOf();
    const { queue, deadLetter } = openQueues(prefix);
    let calls = 0;
    const { captured } = consume(prefix, () => Promise.resolve(void (calls += 1)), bounds(10, 10));
    const data = payload();
    const jobId = keyOf(data);
    delete data['id'];
    await queue.add('outbox_event', data, { jobId, attempts: 5 });
    await until(async () => ((await (await queue.getJob(jobId))?.getState()) === 'failed' ? true : undefined));
    const [record] = await until(async () => {
      const found = await records(deadLetter);
      return found.length === 1 ? found : undefined;
    });
    expect(calls).toBe(0);
    expect(record).toMatchObject({ reason: 'PAYLOAD_INVALID', attempts: 1 });
    expect(captured.lines().some((line) => line['event'] === 'job_context_mismatch')).toBe(false);
  });
});

describe('US-010 singleton scheduled jobs (ADR-0013 §5; REQ-PLAT-015; D-TASK039-01)', () => {
  const runtime = (prefix: string, captured: Captured, every: number): WorkerQueues => {
    const queues = createWorkerQueues({
      connection,
      queueConnection,
      log: captured.log,
      processors: {},
      prefix,
      schedules: { every: { 'queue-retention': every } },
      retention: bounds(1_000, 1_000),
    });
    cleanups.push(() => queues.close());
    return queues;
  };

  it('[AT-US-010-05] three workers started at once run each occurrence of the scheduled job exactly once', async () => {
    const prefix = prefixOf();
    const logs = [captureLog(), captureLog(), captureLog()];
    const workers = logs.map((captured) => runtime(prefix, captured, 2_000));
    for (const worker of workers) worker.start();
    await Promise.all(workers.map((worker) => worker.registerSchedules()));
    const runs = (): string[] =>
      logs.flatMap((captured) =>
        captured
          .lines()
          .filter((line) => line['event'] === 'worker.queue_retention_swept')
          .map((line) => String(line['correlation_id'])),
      );
    await until(() => (runs().length >= 1 ? true : undefined));
    // Within one interval after the first run, no second worker ran it.
    await sleep(1_000);
    expect(runs()).toHaveLength(new Set(runs()).size);
    await until(() => (new Set(runs()).size >= 2 ? true : undefined), 20_000);
    const occurrences = runs();
    expect(occurrences).toHaveLength(new Set(occurrences).size);
    for (const occurrence of occurrences) expect(occurrence).toMatch(/^queue-retention-\d+$/);
    const { queue } = openQueues(prefix, 'housekeeping');
    expect(await queue.getJobSchedulersCount()).toBe(1);
  });

  it('[AT-US-010-06] a worker restarted 5 times leaves exactly one scheduler and one pending occurrence', async () => {
    const prefix = prefixOf();
    for (let restart = 0; restart < 5; restart += 1) {
      const queues = runtime(prefix, captureLog(), 3_600_000);
      expect(await queues.registerSchedules()).toEqual(['queue-retention']);
      await queues.close();
    }
    const { queue } = openQueues(prefix, 'housekeeping');
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toEqual(['queue-retention']);
    const pending = await queue.getJobCounts('waiting', 'delayed', 'prioritized');
    expect((pending['waiting'] ?? 0) + (pending['delayed'] ?? 0) + (pending['prioritized'] ?? 0)).toBe(1);
  });
});

describe('[PR64-SEC-11] the Valkey ACL users of infra/local/valkey/users.acl', () => {
  it('the worker user processes a job end to end and runs one sweep; a Queue.add as the api user fails with NOPERM', async () => {
    // Credentials generated here; the committed hashes are replaced, so no repository credential is used.
    const passwords = { api: randomBytes(24).toString('hex'), worker: randomBytes(24).toString('hex') };
    const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
    const acl = readFileSync(join(REPO_ROOT, 'infra', 'local', 'valkey', 'users.acl'), 'utf8')
      .split('\n')
      .map((line) => {
        const user = /^user (api|worker) /.exec(line)?.[1] as 'api' | 'worker' | undefined;
        return user === undefined ? line : line.replace(/#[0-9a-f]{64}/, `#${sha(passwords[user])}`);
      })
      .join('\n');
    const secured = await new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withCopyContentToContainer([{ content: acl, target: '/etc/valkey/users.acl' }])
      .withCommand(['valkey-server', '--aclfile', '/etc/valkey/users.acl'])
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    cleanups.push(async () => {
      await secured.stop();
    });
    const at = (user: 'api' | 'worker'): string =>
      `redis://${user}:${passwords[user]}@${secured.getHost()}:${String(secured.getMappedPort(6379))}`;
    const workerConn = queueConnectionOptions(at('worker'), 'worker-consumers-acl', 'worker');
    const workerQueueConn = queueConnectionOptions(at('worker'), 'worker-queues-acl', 'queue');
    const { queue } = openQueues('bull', 'outbox-relay', workerQueueConn);
    const done: string[] = [];
    consume('bull', (_data, job) => Promise.resolve(void done.push(job.id)), bounds(10, 10), workerConn, workerQueueConn);
    const jobId = await settle(queue, payload());
    expect(done).toEqual([jobId]);
    const sweeper = createWorkerQueues({ connection: workerConn, queueConnection: workerQueueConn, log: captureLog().log, processors: {} });
    cleanups.push(() => sweeper.close());
    await expect(sweeper.sweepRetention()).resolves.toMatchObject({ failedQueues: [] });
    const apiQueue = new Queue('outbox-relay', { connection: queueConnectionOptions(at('api'), 'api-acl', 'queue') });
    apiQueue.on('error', () => undefined);
    cleanups.push(() => apiQueue.close());
    await expect(apiQueue.add('outbox_event', payload(), { jobId: `outbox_event.${randomUUID()}` })).rejects.toThrow(/NOPERM/);
  });
});
