// Unit tests of the outbox relay with fakes (US-011; ADR-0004 item 3; data-model §6.1; TASK-043): a fake SYSTEM
// transaction that serves claimed rows and records the mark statements, and a fake producer with BullMQ's job-id
// dedupe. The PostgreSQL 18 + Valkey halves (AT-US-011-01..06, AT-US-008-03) are relay.int.test.ts (lane B).
import { createJobProducer, createRuntimeLog, type EnqueueOptions, JobProducerError, type TenantContext } from '@platform/api/runtime';
import type { Config } from '@platform/config';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { SYSTEM_ACTOR_ID } from '@platform/shared';
import type { JobRef, QueueName } from '@platform/shared/queues';

import { createProductionOutboxRelay } from '../../start-worker.js';
import { createRelayMetrics, RELAY_LATENCY_BUCKETS } from './relay-metrics.js';
import { createOutboxRelay, OutboxEnqueueTimeoutError, RELAY_LOCK_KEY, type RelayRow, within } from './relay.js';
import { type RawDb, systemContext, type SystemTxRunner } from './system-tx.js';

const TRACEPARENT = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
const uuid = (n: number): string => `0193a5b2-7c1e-7d4a-9f3b-${n.toString(16).padStart(12, '0')}`;
const A = uuid(0xa);
const B = uuid(0xb);

const row = (n: number, aggregate: string, overrides: Partial<RelayRow> = {}): RelayRow => ({
  id: uuid(n),
  correlation_id: `corr-${String(n).padStart(4, '0')}`,
  trace_context: null,
  aggregate_type: 'shipment',
  aggregate_id: aggregate,
  age_seconds: 0.2,
  ...overrides,
});

interface Statement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface FakeDatabase {
  readonly runner: SystemTxRunner;
  readonly statements: Statement[];
  readonly contexts: TenantContext[];
  /** Ids marked published in committed transactions. */
  readonly published: string[];
}

/** One fake SYSTEM transaction per tick; `commit: false` simulates a crash before COMMIT (the marks are lost). */
function fakeDatabase(rows: RelayRow[], options: { locked?: boolean; commit?: boolean } = {}): FakeDatabase {
  const statements: Statement[] = [];
  const contexts: TenantContext[] = [];
  const published: string[] = [];
  const pending = [...rows];
  const runner: SystemTxRunner = {
    async withTenantTx(ctx, fn) {
      contexts.push(ctx);
      const marked: string[] = [];
      const db: RawDb = {
        $queryRaw: <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('$');
          statements.push({ sql, values });
          if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve([{ locked: options.locked ?? true }] as T);
          const limit = Number(values[0]);
          return Promise.resolve(pending.slice(0, limit) as T);
        },
        $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('$');
          statements.push({ sql, values });
          if (sql.includes('published_at = pg_catalog.now()')) marked.push(...(values[1] as string[]));
          return Promise.resolve(1);
        },
      };
      const result = await fn(db);
      if (options.commit === false) throw new Error('crash before commit');
      published.push(...marked);
      for (const id of marked)
        pending.splice(
          pending.findIndex((r) => r.id === id),
          1,
        );
      return result;
    },
  };
  return { runner, statements, contexts, published };
}

interface Added {
  readonly queue: QueueName;
  readonly jobId: string;
  readonly correlationId: string | undefined;
  readonly traceContext: EnqueueOptions['traceContext'];
}

/** A producer whose queue keeps one job per job id (BullMQ dedupe) and can fail on chosen ids. */
function fakeProducer(fail: (ref: JobRef) => Error | undefined = () => undefined) {
  const jobs = new Map<string, Added>();
  const adds: Added[] = [];
  return {
    jobs,
    adds,
    enqueue(queue: QueueName, ref: JobRef, options: EnqueueOptions = {}) {
      const failure = fail(ref);
      if (failure !== undefined) return Promise.reject(failure);
      const jobId = `${ref.kind}.${ref.id}`;
      const added = { queue, jobId, correlationId: options.correlationId, traceContext: options.traceContext };
      adds.push(added);
      if (!jobs.has(jobId)) jobs.set(jobId, added);
      return Promise.resolve({ queue, jobId, payload: {} as never });
    },
  };
}

function capture() {
  const raw: string[] = [];
  const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
  return { log, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

const relayOf = (db: FakeDatabase, producer: ReturnType<typeof fakeProducer>, overrides: { batchSize?: number; budgetMs?: number } = {}) =>
  createOutboxRelay({
    runner: db.runner,
    producer,
    log: capture().log,
    batchSize: overrides.batchSize ?? 100,
    pollIntervalMs: 500,
    budgetMs: overrides.budgetMs ?? 2_500,
    wallMs: () => 1_763_600_000_000,
  });

afterEach(() => {
  jest.useRealTimers();
});

describe('[US-011] outbox relay tick (ADR-0004 item 3; data-model §6.1)', () => {
  it('[AT-US-011-03] claims under the relay lock in (created_at, id) order and enqueues each event in claim order, then marks it', async () => {
    const rows = [row(1, A), row(2, B), row(3, A), row(4, A, { trace_context: TRACEPARENT }), row(5, B)];
    const db = fakeDatabase(rows);
    const producer = fakeProducer();
    const tick = await relayOf(db, producer).runOnce();
    expect(tick).toEqual({ locked: true, claimed: 5, published: 5, failed: 0, full: false });
    expect(producer.adds.map((added) => added.jobId)).toEqual(rows.map((r) => `outbox_event.${r.id}`));
    expect(producer.adds.every((added) => added.queue === 'outbox-relay')).toBe(true);
    expect(producer.adds[3]?.traceContext).toEqual({ traceparent: TRACEPARENT });
    expect(producer.adds[0]?.traceContext).toBeNull();
    expect(db.published).toEqual(rows.map((r) => r.id));
    const [lock, claim, mark] = db.statements;
    expect(lock?.sql).toContain('pg_catalog.pg_try_advisory_xact_lock');
    expect(lock?.values).toEqual([RELAY_LOCK_KEY]);
    expect(claim?.sql).toMatch(/WHERE published_at IS NULL\s+ORDER BY created_at, id\s+LIMIT \$::int\s+FOR UPDATE SKIP LOCKED/);
    // Identifiers only: the relay never reads the payload, org_id or actor_id (SEC-P3-12).
    expect(claim?.sql).not.toMatch(/payload|org_id|actor_id/);
    // The guard: updated_by is the SYSTEM actor of the transaction and version + 1.
    expect(mark?.sql).toContain('version = version + 1');
    expect(mark?.values[0]).toBe(SYSTEM_ACTOR_ID);
    expect(db.contexts).toEqual([systemContext('outbox-relay-1763600000000')]);
  });

  it('[AT-US-008-03] copies each row correlation id unchanged into the job (D-062)', async () => {
    const db = fakeDatabase([row(1, A, { correlation_id: 'Client-Corr-0001' })]);
    const producer = fakeProducer();
    await relayOf(db, producer).runOnce();
    expect(producer.adds[0]?.correlationId).toBe('Client-Corr-0001');
  });

  it('another relay instance holds the lock: nothing is claimed', async () => {
    const db = fakeDatabase([row(1, A)], { locked: false });
    const producer = fakeProducer();
    expect(await relayOf(db, producer).runOnce()).toEqual({ locked: false, claimed: 0, published: 0, failed: 0, full: false });
    expect(db.statements).toHaveLength(1);
    expect(producer.adds).toEqual([]);
  });

  it('a full, fully published batch reports full (the loop runs again at once)', async () => {
    const db = fakeDatabase([row(1, A), row(2, B), row(3, A)]);
    expect(await relayOf(db, fakeProducer(), { batchSize: 2 }).runOnce()).toMatchObject({ claimed: 2, published: 2, full: true });
  });

  it('[AT-US-011-04] a crash between enqueue and mark redelivers: the second enqueue is the same job id, so the queue holds one job', async () => {
    const crashed = fakeDatabase([row(1, A)], { commit: false });
    const producer = fakeProducer();
    await expect(relayOf(crashed, producer).runOnce()).rejects.toThrow('crash before commit');
    expect(crashed.published).toEqual([]);
    const db = fakeDatabase([row(1, A)]);
    await relayOf(db, producer).runOnce();
    expect(producer.adds.map((added) => added.jobId)).toEqual([`outbox_event.${uuid(1)}`, `outbox_event.${uuid(1)}`]);
    expect([...producer.jobs.keys()]).toEqual([`outbox_event.${uuid(1)}`]);
    expect(db.published).toEqual([uuid(1)]);
  });

  it('[AT-US-011-05] a queue that is unavailable stops the tick: nothing is marked published, the attempt is recorded', async () => {
    const db = fakeDatabase([row(1, A), row(2, B), row(3, A)]);
    const producer = fakeProducer(() => new Error('Connection is closed.'));
    const tick = await relayOf(db, producer).runOnce();
    expect(tick).toEqual({ locked: true, claimed: 3, published: 0, failed: 1, full: false });
    expect(db.published).toEqual([]);
    const failed = db.statements.at(-1);
    expect(failed?.sql).toContain('last_error =');
    expect(failed?.values).toEqual(['Error', SYSTEM_ACTOR_ID, [uuid(1)]]);
  });

  it('a payload refusal (JobProducerError) blocks only its aggregate: later events of that aggregate wait, others go', async () => {
    const db = fakeDatabase([row(1, A), row(2, B), row(3, A), row(4, B)]);
    const producer = fakeProducer((ref) => (ref.id === uuid(1) ? new JobProducerError('payload refused') : undefined));
    const tick = await relayOf(db, producer).runOnce();
    expect(tick).toMatchObject({ published: 2, failed: 1 });
    expect(producer.adds.map((added) => added.jobId)).toEqual([`outbox_event.${uuid(2)}`, `outbox_event.${uuid(4)}`]);
    expect(db.published).toEqual([uuid(2), uuid(4)]);
    expect(db.statements.at(-1)?.values).toEqual(['JobProducerError', SYSTEM_ACTOR_ID, [uuid(1)]]);
  });

  it('stops enqueuing once the tick budget is spent (the transaction never reaches its timeout)', async () => {
    let now = 0;
    const db = fakeDatabase([row(1, A), row(2, B), row(3, A)]);
    const producer = fakeProducer(() => {
      now += 600;
      return undefined;
    });
    const relay = createOutboxRelay({
      runner: db.runner,
      producer,
      log: capture().log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 1_000,
      monotonicMs: () => now,
    });
    expect(await relay.runOnce()).toMatchObject({ claimed: 3, published: 2 });
  });

  it('drops an invalid stored traceparent rather than refusing the job', async () => {
    const db = fakeDatabase([row(1, A, { trace_context: 'garbage' })]);
    const producer = fakeProducer();
    await relayOf(db, producer).runOnce();
    expect(producer.adds[0]?.traceContext).toBeNull();
  });
});

describe('[AT-US-011-06] relay latency metric', () => {
  it('observes commit-to-enqueue latency per published event after the commit; a rolled-back tick counts nothing', async () => {
    const metrics = createRelayMetrics();
    const crashed = fakeDatabase([row(1, A, { age_seconds: 0.3 })], { commit: false });
    const options = { producer: fakeProducer(), log: capture().log, batchSize: 10, pollIntervalMs: 500, budgetMs: 2_000, metrics };
    await expect(createOutboxRelay({ ...options, runner: crashed.runner }).runOnce()).rejects.toThrow();
    expect(metrics.render()).toContain('platform_outbox_relay_latency_seconds_count 0\n');
    const db = fakeDatabase([row(1, A, { age_seconds: 0.3 }), row(2, B, { age_seconds: 1.5 })]);
    let now = 0;
    await createOutboxRelay({ ...options, runner: db.runner, monotonicMs: () => (now += 100) }).runOnce();
    const text = metrics.render();
    expect(text).toContain('# TYPE platform_outbox_relay_latency_seconds histogram');
    expect(text).toContain('platform_outbox_relay_latency_seconds_bucket{le="0.5"} 1\n');
    expect(text).toContain('platform_outbox_relay_latency_seconds_bucket{le="2"} 2\n');
    expect(text).toContain('platform_outbox_relay_latency_seconds_bucket{le="+Inf"} 2\n');
    expect(text).toContain('platform_outbox_relay_latency_seconds_count 2\n');
    expect(text).toContain('platform_outbox_relay_published_total 2\n');
    expect(text).toContain('platform_outbox_relay_failed_total 0\n');
  });

  it('renders every bucket in order; negative and non-finite observations count as 0', () => {
    const metrics = createRelayMetrics();
    metrics.observeLatency(Number.NaN);
    metrics.observeLatency(-1);
    metrics.observeLatency(120);
    metrics.failed(Number.POSITIVE_INFINITY);
    const text = metrics.render();
    const bounds = [...text.matchAll(/_bucket\{le="([^"]+)"\}/g)].map((match) => match[1]);
    expect(bounds).toEqual([...RELAY_LATENCY_BUCKETS.map(String), '+Inf']);
    expect(text).toContain('platform_outbox_relay_latency_seconds_bucket{le="0.05"} 2\n');
    expect(text).toContain('platform_outbox_relay_latency_seconds_bucket{le="+Inf"} 3\n');
    expect(text).toContain('platform_outbox_relay_failed_total 0\n');
  });
});

describe('enqueue bound', () => {
  it('within: passes a value or an error through; an enqueue that never settles fails with OutboxEnqueueTimeoutError', async () => {
    await expect(within(Promise.resolve(7), 1_000)).resolves.toBe(7);
    await expect(within(Promise.reject(new TypeError('x')), 1_000)).rejects.toThrow(TypeError);
    await expect(within(Promise.reject(new Error('plain')), 1_000)).rejects.toThrow('plain');
    await expect(within(new Promise<never>(() => undefined), 20)).rejects.toBeInstanceOf(OutboxEnqueueTimeoutError);
  });

  it('a hanging enqueue ends the tick as a transport failure: the row stays pending', async () => {
    const db = fakeDatabase([row(1, A), row(2, B)]);
    const relay = createOutboxRelay({
      runner: db.runner,
      producer: { enqueue: () => new Promise<never>(() => undefined) },
      log: capture().log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 1_000,
      enqueueTimeoutMs: 20,
    });
    expect(await relay.runOnce()).toMatchObject({ claimed: 2, published: 0, failed: 1 });
    expect(db.statements.at(-1)?.values[0]).toBe('OutboxEnqueueTimeoutError');
  });
});

describe('relay loop', () => {
  it('polls after the interval, at once after a full batch, logs a failure streak once and its recovery, and stops', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const outcomes: (() => Promise<unknown>)[] = [];
    let calls = 0;
    const runner: SystemTxRunner = {
      withTenantTx: () => {
        calls += 1;
        const next = outcomes.shift();
        return (next?.() ?? Promise.resolve({ locked: false, claimed: 0, published: 0, failed: 0, full: false })) as never;
      },
    };
    const captured = capture();
    const relay = createOutboxRelay({
      runner,
      producer: fakeProducer(),
      log: captured.log,
      batchSize: 1,
      pollIntervalMs: 500,
      budgetMs: 1_000,
    });
    outcomes.push(
      () => Promise.reject(new Error('db down')),
      () => Promise.reject(new Error('db down')),
      () => Promise.resolve({ locked: true, claimed: 1, published: 1, failed: 0, full: true }),
    );
    const settle = async (): Promise<void> => {
      for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    };
    relay.start();
    relay.start();
    await jest.advanceTimersByTimeAsync(0);
    await settle();
    expect(calls).toBe(1);
    await jest.advanceTimersByTimeAsync(500);
    await settle();
    expect(calls).toBe(2);
    await jest.advanceTimersByTimeAsync(500);
    await settle();
    expect(calls).toBe(3);
    // A full batch: the next tick runs without waiting for the 500 ms interval.
    await jest.advanceTimersByTimeAsync(10);
    await settle();
    expect(calls).toBe(4);
    await relay.stop();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(4);
    const events = captured.lines().map((line) => line['event']);
    expect(events.filter((event) => event === 'worker.outbox_relay_failed')).toHaveLength(1);
    expect(events).toContain('worker.outbox_relay_recovered');
    expect(JSON.stringify(captured.lines())).not.toContain('db down');
  });
});

describe('createProductionOutboxRelay (composition)', () => {
  it('takes the batch size and poll interval from the configuration and a budget of half the transaction timeout', async () => {
    const statements: string[] = [];
    let started = 0;
    const runner = {
      transactionOptions: { timeout: 5_000 },
      withTenantTx: <R>(_ctx: TenantContext, fn: (db: RawDb) => Promise<R>): Promise<R> =>
        fn({
          $queryRaw: <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
            statements.push(`${strings.join('$')} ${JSON.stringify(values)}`);
            started += 1;
            return Promise.resolve((started === 1 ? [{ locked: true }] : []) as T);
          },
          $executeRaw: () => Promise.resolve(0),
        }),
    };
    const config = { OUTBOX_RELAY_BATCH_SIZE: 7, OUTBOX_RELAY_POLL_INTERVAL_MS: 500 } as unknown as Config;
    const relay = createProductionOutboxRelay({ config, log: capture().log, runner, queueFor: () => ({}) as never });
    expect(await relay.runOnce()).toEqual({ locked: true, claimed: 0, published: 0, failed: 0, full: false });
    expect(statements[1]).toContain('[7]');
    expect(relay.metrics()).toContain('platform_outbox_relay_published_total 0');
    // The producer the composition builds needs the row's correlation id: it never falls back to a request context.
    const producer = createJobProducer({ queueFor: () => ({ add: () => Promise.resolve({}) }), contextCorrelationId: () => undefined });
    await expect(producer.enqueue('outbox-relay', { kind: 'outbox_event', id: A })).rejects.toThrow(JobProducerError);
  });
});
