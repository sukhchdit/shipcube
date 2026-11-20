// Unit tests of the outbox relay with fakes (US-011; ADR-0004 item 3; data-model §6.1; TASK-043): a fake SYSTEM
// transaction that serves claimed rows and records the mark statements, and a fake producer with BullMQ's job-id
// dedupe. The PostgreSQL 18 + Valkey halves (AT-US-011-01..06, AT-US-008-03) are relay.int.test.ts (lane B).
import { createJobProducer, createRuntimeLog, type EnqueueOptions, JobProducerError, type TenantContext } from '@platform/api/runtime';
import type { Config } from '@platform/config';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { CORRELATION_ID_PATTERN, SYSTEM_ACTOR_ID } from '@platform/shared';
import type { JobRef, QueueName } from '@platform/shared/queues';

import { createProductionOutboxRelay } from '../../start-worker.js';
import { createRelayMetrics, RELAY_LATENCY_BUCKETS } from './relay-metrics.js';
import {
  createOutboxRelay,
  OutboxEnqueueTimeoutError,
  RELAY_LOCK_KEY,
  RELAY_MAX_BACKOFF_MS,
  relayBounds,
  type RelayRow,
  within,
} from './relay.js';
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
    enqueueTimeoutMs: 1_250,
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
    // D-ARCH-187 (F12): the tick's own correlation id is inside ADR-0016 §15, so it could publish.
    expect(db.contexts[0]?.correlationId).toMatch(CORRELATION_ID_PATTERN);
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
    expect(tick).toEqual({ locked: true, claimed: 3, published: 0, failed: 1, full: false, failure: 'Error' });
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
      enqueueTimeoutMs: 500,
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
    const options = {
      producer: fakeProducer(),
      log: capture().log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 2_000,
      enqueueTimeoutMs: 1_000,
      metrics,
    };
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

describe('[ADR-0004 am. 2 item 11] relay liveness gauges (D-ARCH-183 F7)', () => {
  const gauges = (text: string): [number, number] => [
    Number(/^platform_outbox_relay_oldest_pending_age_seconds (\S+)$/m.exec(text)?.[1]),
    Number(/^platform_outbox_relay_last_tick_timestamp_seconds (\S+)$/m.exec(text)?.[1]),
  ];
  const relayWith = (db: FakeDatabase, metrics: ReturnType<typeof createRelayMetrics>, wall: number) =>
    createOutboxRelay({
      runner: db.runner,
      producer: fakeProducer(),
      log: capture().log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 2_500,
      enqueueTimeoutMs: 1_250,
      metrics,
      wallMs: () => wall,
    });

  it('a tick with the lock and rows reports the age of the first claimed row and its end time', async () => {
    const metrics = createRelayMetrics();
    expect(gauges(metrics.render())).toEqual([0, 0]);
    await relayWith(fakeDatabase([row(1, A, { age_seconds: 42.5 }), row(2, B, { age_seconds: 3 })]), metrics, 1_763_600_000_000).runOnce();
    expect(gauges(metrics.render())).toEqual([42.5, 1_763_600_000]);
  });

  it('[PR043-SEC-04] a tick with the lock and no rows reports 0 and moves the timestamp; a tick without the lock reports 0 and does not', async () => {
    const metrics = createRelayMetrics();
    await relayWith(fakeDatabase([row(1, A, { age_seconds: 9 })]), metrics, 1_000_000).runOnce();
    await relayWith(fakeDatabase([]), metrics, 2_000_000).runOnce();
    expect(gauges(metrics.render())).toEqual([0, 2_000]);
    await relayWith(fakeDatabase([row(1, A, { age_seconds: 9 })]), metrics, 3_000_000).runOnce();
    await relayWith(fakeDatabase([row(1, A)], { locked: false }), metrics, 4_000_000).runOnce();
    // A foreign holder of the lock: the lag reads 0, and the last-tick timestamp stays at the last locked tick.
    expect(gauges(metrics.render())).toEqual([0, 3_000]);
  });

  it('[D-ARCH-188] a tick that threw after its claim keeps the lag it claimed; the timestamp stops', async () => {
    const metrics = createRelayMetrics();
    await relayWith(fakeDatabase([row(1, A, { age_seconds: 7 })]), metrics, 5_000_000).runOnce();
    await expect(
      relayWith(fakeDatabase([row(2, B, { age_seconds: 12 })], { commit: false }), metrics, 6_000_000).runOnce(),
    ).rejects.toThrow();
    expect(gauges(metrics.render())).toEqual([12, 5_000]);
    const text = metrics.render();
    expect(text).toContain('# TYPE platform_outbox_relay_oldest_pending_age_seconds gauge');
    expect(text).toContain('# TYPE platform_outbox_relay_last_tick_timestamp_seconds gauge');
  });

  it('[PR043-SEC-04] ticks without the lock never move the last-tick gauge: after 61 s of them, time() - gauge > 60 (OutboxRelayStalled fires)', async () => {
    const metrics = createRelayMetrics();
    const start = 1_763_600_000_000;
    // A tick with the lock and no rows moves the gauge.
    await relayWith(fakeDatabase([]), metrics, start).runOnce();
    expect(gauges(metrics.render())).toEqual([0, start / 1_000]);
    // A foreign holder of the key: 61 s of ticks without the lock, one per poll interval.
    let now = start;
    for (let tick = 0; tick < 122; tick += 1) {
      now += 500;
      await relayWith(fakeDatabase([row(1, A, { age_seconds: 600 })], { locked: false }), metrics, now).runOnce();
    }
    const [lag, lastTick] = gauges(metrics.render());
    expect(lastTick).toBe(start / 1_000);
    expect(now / 1_000 - lastTick).toBeGreaterThan(60);
    expect(lag).toBe(0);
    expect(metrics.render()).toContain(
      '# HELP platform_outbox_relay_last_tick_timestamp_seconds Wall-clock time of the last tick that held the relay lock',
    );
  });

  it('[D-ARCH-188] the lag is set right after the claim, before the first enqueue: a tick held inside an enqueue already shows it', async () => {
    const metrics = createRelayMetrics();
    let release = (): void => undefined;
    let entered = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const db = fakeDatabase([row(1, A, { age_seconds: 33 })]);
    const relay = createOutboxRelay({
      runner: db.runner,
      producer: {
        enqueue: () => {
          entered();
          return new Promise<never>((_resolve, reject) => {
            release = () => reject(new Error('Connection is closed.'));
          });
        },
      },
      log: capture().log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 2_500,
      enqueueTimeoutMs: 1_250,
      metrics,
      wallMs: () => 9_000_000,
    });
    const tick = relay.runOnce();
    await inside;
    expect(gauges(metrics.render())).toEqual([33, 0]);
    release();
    expect(await tick).toMatchObject({ published: 0, failed: 1 });
    expect(gauges(metrics.render())).toEqual([33, 9_000]);
  });
});

describe('[ADR-0004 am. 2 item 11] relay loop (D-ARCH-183 F6)', () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const idle = { locked: true, claimed: 0, published: 0, failed: 0, full: false };

  /** A runner whose ticks return (or throw) the queued outcomes in turn, recording the fake time of each call. */
  function scripted(outcomes: (() => Promise<unknown>)[]) {
    const at: number[] = [];
    const runner: SystemTxRunner = {
      withTenantTx: () => {
        at.push(Date.now());
        return (outcomes.shift()?.() ?? Promise.resolve(idle)) as never;
      },
    };
    return { runner, at };
  }

  it('a run of failing ticks logs one WARN, its wait doubles from the poll interval to 5 s; recovery logs once and resets it', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'], now: 0 });
    const queueDown = { locked: true, claimed: 3, published: 0, failed: 1, full: false, failure: 'OutboxEnqueueTimeoutError' };
    const { runner, at } = scripted([
      () => Promise.reject(new Error('db down: secret detail')),
      () => Promise.resolve(queueDown),
      () => Promise.resolve(queueDown),
      () => Promise.resolve(queueDown),
      () => Promise.resolve(queueDown),
      () => Promise.resolve({ locked: true, claimed: 1, published: 1, failed: 0, full: false }),
      () => Promise.resolve(idle),
    ]);
    const captured = capture();
    const relay = createOutboxRelay({
      runner,
      producer: fakeProducer(),
      log: captured.log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 2_500,
      enqueueTimeoutMs: 1_250,
    });
    relay.start();
    relay.start();
    for (let step = 0; step < 50; step += 1) {
      await jest.advanceTimersByTimeAsync(500);
      await settle();
    }
    await relay.stop();
    const waits = at.slice(1).map((time, index) => time - (at[index] ?? 0));
    // After each failing tick: 1 s, 2 s, 4 s, then the 5 s cap; after the recovery the poll interval again.
    expect(waits.slice(0, 6)).toEqual([1_000, 2_000, 4_000, RELAY_MAX_BACKOFF_MS, RELAY_MAX_BACKOFF_MS, 500]);
    const events = captured.lines().map((line) => line['event']);
    expect(events.filter((event) => event === 'worker.outbox_relay_failed')).toHaveLength(1);
    expect(events.filter((event) => event === 'worker.outbox_relay_recovered')).toHaveLength(1);
    expect(captured.lines().find((line) => line['event'] === 'worker.outbox_relay_failed')).toMatchObject({ error: 'Error' });
    expect(JSON.stringify(captured.lines())).not.toContain('secret detail');
  });

  it('polls after the interval, runs at once after a full batch, and stops', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'], now: 0 });
    const { runner, at } = scripted([() => Promise.resolve({ locked: true, claimed: 1, published: 1, failed: 0, full: true })]);
    const relay = createOutboxRelay({
      runner,
      producer: fakeProducer(),
      log: capture().log,
      batchSize: 1,
      pollIntervalMs: 500,
      budgetMs: 1_000,
      enqueueTimeoutMs: 250,
    });
    relay.start();
    await jest.advanceTimersByTimeAsync(10);
    await settle();
    await jest.advanceTimersByTimeAsync(10);
    await settle();
    expect(at).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(500);
    await settle();
    expect(at).toHaveLength(3);
    await relay.stop();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(at).toHaveLength(3);
  });

  it('a partly failed tick that still published resets the wait (it made progress)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'], now: 0 });
    const { runner, at } = scripted([
      () => Promise.resolve({ locked: true, claimed: 2, published: 1, failed: 1, full: false, failure: 'Error' }),
      () => Promise.resolve(idle),
    ]);
    const captured = capture();
    const relay = createOutboxRelay({
      runner,
      producer: fakeProducer(),
      log: captured.log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 1_000,
      enqueueTimeoutMs: 250,
    });
    relay.start();
    for (let step = 0; step < 4; step += 1) {
      await jest.advanceTimersByTimeAsync(500);
      await settle();
    }
    await relay.stop();
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBe(500);
    expect(captured.lines().map((line) => line['event'])).not.toContain('worker.outbox_relay_failed');
  });
});

describe('[ADR-0004 am. 2 item 10] relay bounds (D-ARCH-183 F5; code review m6)', () => {
  it('W = min(transaction timeout, idle-in-transaction timeout): budget W / 2, one enqueue min(2,000 ms, W / 4)', () => {
    // The defaults: transaction timeout 5,000 ms (DB_TX_STATEMENT_TIMEOUT_MS), idle 15,000 ms.
    expect(relayBounds(5_000, 15_000)).toEqual({ budgetMs: 2_500, enqueueTimeoutMs: 1_250 });
    // The idle timeout is the smaller value.
    expect(relayBounds(10_000, 4_000)).toEqual({ budgetMs: 2_000, enqueueTimeoutMs: 1_000 });
    // A long window: the enqueue bound stops at 2 s.
    expect(relayBounds(60_000, 60_000)).toEqual({ budgetMs: 30_000, enqueueTimeoutMs: 2_000 });
    expect(relayBounds(1, 1)).toEqual({ budgetMs: 1, enqueueTimeoutMs: 1 });
  });
});

describe('createProductionOutboxRelay (composition)', () => {
  const runnerWith = (timeout: number, statements: string[] = []) => {
    let started = 0;
    return {
      transactionOptions: { timeout },
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
  };
  const configWith = (idle: number): Config =>
    ({ OUTBOX_RELAY_BATCH_SIZE: 7, OUTBOX_RELAY_POLL_INTERVAL_MS: 500, DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: idle }) as unknown as Config;

  it('takes the batch size and poll interval from the configuration and the bounds of the defaults (2,500 / 1,250 ms)', async () => {
    const statements: string[] = [];
    const relay = createProductionOutboxRelay({
      config: configWith(15_000),
      log: capture().log,
      runner: runnerWith(5_000, statements),
      queueFor: () => ({}) as never,
    });
    expect([relay.budgetMs, relay.enqueueTimeoutMs]).toEqual([2_500, 1_250]);
    expect(await relay.runOnce()).toEqual({ locked: true, claimed: 0, published: 0, failed: 0, full: false });
    expect(statements[1]).toContain('[7]');
    expect(relay.metrics()).toContain('platform_outbox_relay_published_total 0');
    // The producer the composition builds needs the row's correlation id: it never falls back to a request context.
    const producer = createJobProducer({ queueFor: () => ({ add: () => Promise.resolve({}) }), contextCorrelationId: () => undefined });
    await expect(producer.enqueue('outbox-relay', { kind: 'outbox_event', id: A })).rejects.toThrow(JobProducerError);
  });

  it('follows DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS when it is the smaller value', () => {
    const relay = createProductionOutboxRelay({
      config: configWith(4_000),
      log: capture().log,
      runner: runnerWith(10_000),
      queueFor: () => ({}) as never,
    });
    expect([relay.budgetMs, relay.enqueueTimeoutMs]).toEqual([2_000, 1_000]);
  });
});
