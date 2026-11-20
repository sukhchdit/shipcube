/**
 * The at-least-once outbox relay (ADR-0004 item 3; REQ-PLAT-017, NFR-RES-004, NFR-SCALE-002; US-011 AT-US-011-03..06;
 * data-model §6.1; TASK-043).
 *
 * One tick is one SYSTEM-scope transaction on the worker's tenant-transaction runner (./system-tx.ts; no second pool,
 * PR2-SEC-05 addendum, PR11-SEC-05 item 2):
 *  1. `pg_try_advisory_xact_lock(RELAY_LOCK_KEY)`: one relay instance at a time across every worker, so events are
 *     enqueued in one global `(created_at, id)` order (a second worker skips the tick; the lock ends with the
 *     transaction). This is the "single active instance" of ADR-0004 item 3, held in PostgreSQL instead of Valkey;
 *  2. claims up to `batchSize` unpublished rows in `(created_at, id)` order, `FOR UPDATE SKIP LOCKED`
 *     (ix_outbox_events__unpublished): `id, correlation_id, trace_context` and the aggregate, never the payload;
 *  3. enqueues each as payload v2 `{ v: 2, kind: 'outbox_event', id, correlation_id, trace_context }` on the
 *     `outbox-relay` queue, job id `outbox_event.<id>` (deterministic, so BullMQ drops a second add of the same event
 *     while the job is retained), with the row's correlation id copied unchanged (AT-US-008-03, D-062);
 *  4. marks the accepted rows published (`published_at`, `attempts + 1`) and records failed attempts (`attempts + 1`,
 *     `last_error` = the error class, never a message or payload), then commits.
 *
 * At least once (AT-US-011-04): a crash or a failed commit between the enqueue and the commit leaves the rows pending,
 * and the next tick enqueues them again; the duplicate is absorbed by BullMQ's job-id dedupe or, after retention, by
 * the consumer's `processed_events` / `job_executions` claim. Order per aggregate (AT-US-011-03): rows are enqueued in
 * claim order, and after a failed enqueue no later row of the same aggregate is enqueued in that tick. A queue that
 * refuses the enqueue (Valkey down, AUTH refused) stops the tick and every remaining row stays pending (AT-US-011-05);
 * a payload refusal (`JobProducerError`, deterministic) blocks only its aggregate. The latency histogram is
 * AT-US-011-06 (./relay-metrics.ts).
 *
 * T-83 (D-ARCH-074, D-ARCH-106): the enqueue happens inside this SYSTEM transaction by design (ADR-0004 item 3, the
 * claim lock must cover it). It is bounded: each add runs on the fail-fast `queue` connection profile (2 s command
 * timeout, no offline queue) and within `enqueueTimeoutMs` (an add waits for a ready connection, which a Valkey that
 * refuses AUTH never gives), the first transport failure ends the tick, and no new row is enqueued once `budgetMs`
 * (half the transaction timeout) has passed, so the transaction never reaches its timeout (D-TASK043-06).
 */
import { type JobProducer, JobProducerError, type RuntimeLog } from '@platform/api/runtime';
import { isTraceparent } from '@platform/shared/queues';

import { createRelayMetrics, type RelayMetrics } from './relay-metrics.js';
import { errorClassOf, type RawDb, systemContext, type SystemTxRunner } from './system-tx.js';

/** Advisory lock key of the relay ("outbox" in ASCII); transaction-scoped, so a crash releases it. */
export const RELAY_LOCK_KEY = '478216878200';

/** Upper bound of `last_error` (`ck_outbox_events__last_error`). */
const MAX_LAST_ERROR = 500;

/** A claimed row: identifiers only (data-model §6.1 amendment, SEC-P3-12). */
export interface RelayRow {
  readonly id: string;
  readonly correlation_id: string;
  readonly trace_context: string | null;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  /** Seconds since `created_at` on the database clock at claim time. */
  readonly age_seconds: number;
}

/** The outcome of one tick. */
export interface RelayTick {
  /** False when another relay instance held the lock (nothing was claimed). */
  readonly locked: boolean;
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  /** True when the batch was full and fully published: the next tick runs at once. */
  readonly full: boolean;
}

export interface OutboxRelayOptions {
  readonly runner: SystemTxRunner;
  readonly producer: Pick<JobProducer, 'enqueue'>;
  readonly log: RuntimeLog;
  /** Rows claimed per tick (`OUTBOX_RELAY_BATCH_SIZE`). */
  readonly batchSize: number;
  /** Delay between ticks when the last one was not full (`OUTBOX_RELAY_POLL_INTERVAL_MS`). */
  readonly pollIntervalMs: number;
  /** No new row is enqueued once a tick ran this long (below the transaction timeout). */
  readonly budgetMs: number;
  /**
   * Bound of one enqueue (default ENQUEUE_TIMEOUT_MS). BullMQ's `add` waits for a ready connection, so against a Valkey
   * that refuses AUTH it never settles by itself; past the bound it counts as a transport failure.
   */
  readonly enqueueTimeoutMs?: number;
  readonly metrics?: RelayMetrics;
  /** Test seams: a monotonic clock in ms and the wall clock in ms. */
  readonly monotonicMs?: () => number;
  readonly wallMs?: () => number;
}

/** Default bound of one enqueue: the 2 s command timeout of the fail-fast `queue` connection profile. */
export const ENQUEUE_TIMEOUT_MS = 2_000;

/** An enqueue that did not settle within its bound (the queue is treated as unavailable). */
export class OutboxEnqueueTimeoutError extends Error {
  override readonly name = 'OutboxEnqueueTimeoutError';
}

/**
 * `work`, or a rejection with OutboxEnqueueTimeoutError once `ms` passed. The bound is an `AbortSignal.timeout` (its
 * timer never keeps the process alive); a late settlement of `work` is absorbed.
 */
export function within<T>(work: Promise<T>, ms: number): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return new Promise<T>((resolve, reject) => {
    const expire = (): void => reject(new OutboxEnqueueTimeoutError(`enqueue did not settle within ${String(ms)} ms`));
    signal.addEventListener('abort', expire, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', expire);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', expire);
        reject(error instanceof Error ? error : new Error(typeof error));
      },
    );
  });
}

export interface OutboxRelay {
  /** One tick (claim, enqueue, mark), exported for tests and the run loop. */
  runOnce(): Promise<RelayTick>;
  /** Starts the poll loop (idempotent). */
  start(): void;
  /** Stops the loop and waits for a running tick. */
  stop(): Promise<void>;
  /** Prometheus text of the relay metrics. */
  metrics(): string;
}

interface Failure {
  readonly id: string;
  readonly code: string;
}

/** Marks the accepted rows published (the guard requires `updated_by` = the SYSTEM actor and `version + 1`). */
async function markPublished(db: RawDb, ids: readonly string[], actor: string): Promise<void> {
  await db.$executeRaw`
    UPDATE public.outbox_events
       SET published_at = pg_catalog.now(), attempts = attempts + 1, last_error = NULL,
           updated_at = pg_catalog.now(), updated_by = ${actor}::uuid, version = version + 1
     WHERE id = ANY(${[...ids]}::uuid[]) AND published_at IS NULL`;
}

/** Records a failed attempt per row; one statement per error class. */
async function markFailed(db: RawDb, failures: readonly Failure[], actor: string): Promise<void> {
  const byCode = new Map<string, string[]>();
  for (const { id, code } of failures) byCode.set(code, [...(byCode.get(code) ?? []), id]);
  for (const [code, ids] of byCode) {
    await db.$executeRaw`
      UPDATE public.outbox_events
         SET attempts = attempts + 1, last_error = ${code.slice(0, MAX_LAST_ERROR)}::text,
             updated_at = pg_catalog.now(), updated_by = ${actor}::uuid, version = version + 1
       WHERE id = ANY(${ids}::uuid[]) AND published_at IS NULL`;
  }
}

export function createOutboxRelay(options: OutboxRelayOptions): OutboxRelay {
  const { runner, producer, log, batchSize, pollIntervalMs, budgetMs } = options;
  const metrics = options.metrics ?? createRelayMetrics();
  const monotonic = options.monotonicMs ?? (() => performance.now());
  const wall = options.wallMs ?? Date.now;
  const enqueueTimeoutMs = options.enqueueTimeoutMs ?? ENQUEUE_TIMEOUT_MS;

  const runOnce = async (): Promise<RelayTick> => {
    const started = monotonic();
    const context = systemContext(`outbox-relay-${String(wall())}`);
    const latencies: number[] = [];
    const tick = await runner.withTenantTx(context, async (db) => {
      const lock = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_catalog.pg_try_advisory_xact_lock(${RELAY_LOCK_KEY}::bigint) AS locked`;
      if (lock[0]?.locked !== true) return { locked: false, claimed: 0, published: 0, failed: 0, full: false };
      const rows = await db.$queryRaw<RelayRow[]>`
        SELECT id::text AS id, correlation_id, trace_context, aggregate_type, aggregate_id::text AS aggregate_id,
               EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - created_at))::float8 AS age_seconds
          FROM public.outbox_events
         WHERE published_at IS NULL
         ORDER BY created_at, id
         LIMIT ${batchSize}::int
           FOR UPDATE SKIP LOCKED`;
      const claimedAt = monotonic();
      const published: string[] = [];
      const failures: Failure[] = [];
      const blocked = new Set<string>();
      for (const row of rows) {
        if (monotonic() - started > budgetMs) break;
        const aggregate = `${row.aggregate_type}:${row.aggregate_id}`;
        if (blocked.has(aggregate)) continue;
        try {
          const traceparent = row.trace_context !== null && isTraceparent(row.trace_context) ? row.trace_context : undefined;
          await within(
            producer.enqueue(
              'outbox-relay',
              { kind: 'outbox_event', id: row.id },
              { correlationId: row.correlation_id, traceContext: traceparent === undefined ? null : { traceparent } },
            ),
            enqueueTimeoutMs,
          );
          published.push(row.id);
          latencies.push(Number(row.age_seconds) + (monotonic() - claimedAt) / 1_000);
        } catch (error) {
          blocked.add(aggregate);
          failures.push({ id: row.id, code: errorClassOf(error) });
          log.warn('worker.outbox_relay_enqueue_failed', { eventId: row.id, error: errorClassOf(error) });
          // A transport failure (queue unavailable) ends the tick: every remaining row stays pending.
          if (!(error instanceof JobProducerError)) break;
        }
      }
      if (published.length > 0) await markPublished(db, published, context.actorId);
      if (failures.length > 0) await markFailed(db, failures, context.actorId);
      return {
        locked: true,
        claimed: rows.length,
        published: published.length,
        failed: failures.length,
        full: rows.length === batchSize && published.length === rows.length,
      };
    });
    // Counted after the commit only: a rolled-back tick published nothing.
    for (const seconds of latencies) metrics.observeLatency(seconds);
    metrics.published(tick.published);
    metrics.failed(tick.failed);
    return tick;
  };

  let stopped = true;
  let timer: NodeJS.Timeout | undefined;
  let inflight: Promise<void> | undefined;
  let failing = false;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      inflight = loop().finally(() => {
        inflight = undefined;
      });
    }, delayMs);
    timer.unref();
  };

  const loop = async (): Promise<void> => {
    let delay = pollIntervalMs;
    try {
      const tick = await runOnce();
      if (failing) log.info('worker.outbox_relay_recovered', {});
      failing = false;
      if (tick.full) delay = 0;
    } catch (error) {
      // Logged once per failure streak (a database outage would otherwise log every poll).
      if (!failing) log.warn('worker.outbox_relay_failed', { error: errorClassOf(error) });
      failing = true;
    }
    schedule(delay);
  };

  return {
    runOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(0);
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      await inflight;
    },
    metrics: () => metrics.render(),
  };
}
