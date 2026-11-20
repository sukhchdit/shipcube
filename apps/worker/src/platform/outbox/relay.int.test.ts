/**
 * The transactional outbox end to end on PostgreSQL 18 (bootstrapped and migrated, as `platform_app`) and Valkey 8
 * (US-011 AT-US-011-01..06; US-008 AT-US-008-03 outbox hop; ADR-0004; data-model §3.5, §6.1, §10.5; D-ARCH-167,
 * D-ARCH-171; TASK-043). Lane B (Testcontainers).
 *
 * The writer runs on the worker's production database runtime (`databaseRuntimeFromConfig`, the one runner of the
 * process) inside a tenant transaction whose context carries a correlation id, as the API pipeline sets it from
 * `X-Correlation-Id`. AT-US-008-03 is pinned by two tests with the same literal `Client-Corr-0103`: the api-side
 * apps/api/src/platform/outbox/writer.int.test.ts sends it as the header of a `transaction: 'tenant'` route and asserts
 * the row; the AT-US-011-03 case below asserts that the row's value is the job payload's. The relay runs on the same
 * runner with the api job producer over the worker queue runtime's queues (openQueue, the fail-fast profile). The purge
 * runs through its schedule handler.
 */
import { randomUUID } from 'node:crypto';

import {
  type ActiveDatabaseRuntime,
  type AppTransactionClient,
  createJobProducer,
  createRuntimeLog,
  databaseRuntimeFromConfig,
  type TenantContext,
  type TenantDb,
} from '@platform/api/runtime';
import { createTestOutbox } from '@platform/api/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { Config } from '@platform/config';
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';
import type { JobPayloadV2 } from '@platform/shared/queues';
import { identifierPayload } from '@platform/shared/events';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { queueConnectionOptions } from '../queues/connection.js';
import { createWorkerQueues, type WorkerQueues } from '../queues/runtime.js';
import { createOutboxPurge, PURGE_BATCH_SIZE, rawJobExecutionLedger } from './purge.js';
import { createOutboxRelay, type OutboxRelay } from './relay.js';
import { systemContext, type SystemTxRunner } from './system-tx.js';
import { type MigratedPostgres, startMigratedPostgres } from './tests/migrated-postgres.js';

jest.setTimeout(240_000);

/** Valkey 8.1 (Alpine), pinned by digest; the image of consumer.int.test.ts. */
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a';
const USER = '0193a5b2-7c1e-7d4a-9f3b-0000000c0001';
const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000c0002';

const catalogue = {
  'shipment.booked': { aggregateType: 'shipment', payload: identifierPayload('shipment_id') },
} as const;
const outbox = createTestOutbox(catalogue);

let postgres: MigratedPostgres;
let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
/**
 * The runner of the F3 ordering test (D-ARCH-188): lock_timeout 10 s, not the 2 s integration default, so T1 is still
 * waiting on the aggregate row lock when the test observes it in pg_stat_activity and releases T2. The statement and
 * transaction timeouts are above it.
 */
let orderRuntime: ActiveDatabaseRuntime<AppTransactionClient>;
/** Transaction-local lock_timeout of orderRuntime (at least 10 s, D-ARCH-188). */
const ORDER_LOCK_TIMEOUT_MS = 10_000;
let valkey: StartedTestContainer;
let url: string;
const log = createRuntimeLog('worker', { write: () => true }, { level: 'debug' });
const cleanups: (() => Promise<void>)[] = [];

const configFor = (appUrl: string): Config =>
  ({
    DATABASE_URL: { reveal: () => appUrl },
    DB_POOL_MAX: 4,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: 10_000,
    DB_TX_LOCK_TIMEOUT_MS: 2_000,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
  }) as unknown as Config;

const request = (correlationId: string): TenantContext => ({
  orgId: ORG,
  actorId: USER,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId,
});

async function superuser<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await postgres.superuser();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function eventRows(ids: readonly string[]): Promise<Record<string, unknown>[]> {
  return superuser(async (client) => {
    const result = await client.query(
      `SELECT id::text, type, aggregate_type, aggregate_id::text, payload, org_id::text, actor_id::text, correlation_id,
              trace_context, published_at IS NOT NULL AS published, attempts, last_error, created_by::text, version,
              created_at IS NOT NULL AS created_set, created_at = updated_at AS created_is_updated
         FROM public.outbox_events WHERE id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [ids],
    );
    return result.rows as Record<string, unknown>[];
  });
}

/** Publishes one event per aggregate id, each in its own committed transaction (distinct created_at). */
async function publishAll(aggregates: readonly string[], correlationId = 'outbox-it-0001'): Promise<string[]> {
  const ids: string[] = [];
  for (const aggregate of aggregates) {
    const { id } = await runtime.tenantTx.withTenantTx(request(correlationId), (db) =>
      outbox.publish(db, { type: 'shipment.booked', aggregateId: aggregate, payload: { shipment_id: aggregate } }),
    );
    ids.push(id);
  }
  return ids;
}

/** Marks every pending event published (as the superuser, respecting the guard), so each case starts clean. */
async function drainOutbox(): Promise<void> {
  await superuser((client) =>
    client.query(
      `UPDATE public.outbox_events SET published_at = now(), updated_by = $1, version = version + 1 WHERE published_at IS NULL`,
      [ANONYMOUS_ACTOR_ID],
    ),
  );
}

function workerQueues(): WorkerQueues {
  const queues = createWorkerQueues({
    connection: queueConnectionOptions(url, 'worker-consumers-it', 'worker'),
    queueConnection: queueConnectionOptions(url, 'worker-queues-it', 'queue'),
    log,
    processors: {},
    prefix: `it-${randomUUID().slice(0, 8)}`,
  });
  cleanups.push(() => queues.close());
  return queues;
}

function relayOver(queues: WorkerQueues, runner: SystemTxRunner = runtime.tenantTx): OutboxRelay {
  return createOutboxRelay({
    runner,
    producer: createJobProducer({ queueFor: (name) => queues.queueFor(name), contextCorrelationId: () => undefined }),
    log,
    batchSize: 100,
    pollIntervalMs: 500,
    budgetMs: 5_000,
    enqueueTimeoutMs: 2_000,
  });
}

/** A business row in the same transaction: a `job_executions` claim (a table platform_app may write; m2). */
async function businessChange(db: TenantDb<AppTransactionClient>, key: string): Promise<void> {
  expect(await rawJobExecutionLedger().claim(db, { jobKey: key, queue: 'booking' })).toBe(true);
}

async function businessRows(key: string): Promise<number> {
  return superuser(async (client) => {
    const result = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM public.job_executions WHERE job_key = $1', [key]);
    return result.rows[0]?.n ?? 0;
  });
}

beforeAll(async () => {
  delete process.env['PGOPTIONS'];
  [postgres, valkey] = await Promise.all([
    startMigratedPostgres(),
    new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  url = `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;
  runtime = databaseRuntimeFromConfig(configFor(postgres.appUrl), 'worker', log);
  await runtime.startup();
  orderRuntime = databaseRuntimeFromConfig(
    {
      ...configFor(postgres.appUrl),
      DB_TX_LOCK_TIMEOUT_MS: ORDER_LOCK_TIMEOUT_MS,
      DB_TX_STATEMENT_TIMEOUT_MS: 20_000,
      DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 30_000,
    },
    'worker',
    log,
  );
  await orderRuntime.startup();
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const resource of (orderRuntime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
  for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
  await valkey?.stop();
  await postgres?.stop();
});

describe('[US-011] outbox writer on PostgreSQL 18', () => {
  it('[AT-US-011-01] the event is committed with the business change, with the transaction org, actor and correlation id', async () => {
    const aggregate = randomUUID();
    const key = `business.${randomUUID()}`;
    const { id } = await runtime.tenantTx.withTenantTx(request('Client-Corr-0101'), async (db) => {
      await businessChange(db, key);
      return outbox.publish(db, { type: 'shipment.booked', aggregateId: aggregate, payload: { shipment_id: aggregate } });
    });
    expect(await businessRows(key)).toBe(1);
    expect(await eventRows([id])).toEqual([
      {
        id,
        type: 'shipment.booked',
        aggregate_type: 'shipment',
        aggregate_id: aggregate,
        payload: { shipment_id: aggregate },
        org_id: ORG,
        actor_id: USER,
        correlation_id: 'Client-Corr-0101',
        trace_context: null,
        published: false,
        attempts: 0,
        last_error: null,
        created_by: USER,
        version: 1,
        created_set: true,
        created_is_updated: true,
      },
    ]);
    await drainOutbox();
  });

  it('[AT-US-011-02] a rolled-back change leaves no event and no business row', async () => {
    let id = '';
    const key = `business.${randomUUID()}`;
    await expect(
      runtime.tenantTx.withTenantTx(request('outbox-it-0102'), async (db) => {
        await businessChange(db, key);
        ({ id } = await outbox.publish(db, { type: 'shipment.booked', aggregateId: randomUUID(), payload: { shipment_id: randomUUID() } }));
        throw new Error('business rule refused');
      }),
    ).rejects.toThrow('business rule refused');
    expect(id).not.toBe('');
    expect(await eventRows([id])).toEqual([]);
    expect(await businessRows(key)).toBe(0);
  });

  it('[D-ARCH-187] [F12] the correlation check refuses a value outside ADR-0016 §15 with 23514 (a BullMQ occurrence id, 7 characters)', async () => {
    for (const correlation of ['repeat:outbox-purge:1763550000000', 'abc-123']) {
      await expect(
        superuser((client) =>
          client.query(
            `INSERT INTO public.outbox_events (type, aggregate_type, aggregate_id, actor_id, payload, correlation_id, created_by, updated_by)
             VALUES ('shipment.booked', 'shipment', gen_random_uuid(), $1, '{}'::jsonb, $2, $1, $1)`,
            [ANONYMOUS_ACTOR_ID, correlation],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'ck_outbox_events__correlation_id' });
    }
  });

  it('platform_app may not UPDATE processed_events (insert-only); it may DELETE it (purge)', async () => {
    const app = new pg.Client({ connectionString: postgres.appUrl });
    await app.connect();
    try {
      await expect(app.query('UPDATE public.processed_events SET consumer = consumer')).rejects.toMatchObject({ code: '42501' });
      const { rows } = await app.query(
        "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('outbox_events', 'processed_events') AND grantee = $1 ORDER BY 1, 2",
        ['platform_app'],
      );
      expect(rows.map((r: { table_name: string; privilege_type: string }) => `${r.table_name} ${r.privilege_type}`)).toEqual([
        'outbox_events DELETE',
        'outbox_events INSERT',
        'outbox_events SELECT',
        'processed_events DELETE',
        'processed_events INSERT',
        'processed_events SELECT',
      ]);
      // PR043-SEC-05 (D-ARCH-197): UPDATE on outbox_events is column-level, the relay's mark columns only.
      const columns = await app.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.column_privileges WHERE table_name = 'outbox_events' AND grantee = $1 AND privilege_type = 'UPDATE' ORDER BY 1",
        ['platform_app'],
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        'attempts',
        'last_error',
        'published_at',
        'updated_at',
        'updated_by',
        'version',
      ]);
    } finally {
      await app.end();
    }
  });

  it('[PR043-SEC-05] as platform_app an UPDATE of org_id (or actor_id, payload) is refused with 42501; the relay marks still pass', async () => {
    const [id] = await publishAll([randomUUID()], 'outbox-it-sec05');
    const app = new pg.Client({ connectionString: postgres.appUrl });
    await app.connect();
    try {
      for (const column of ['org_id', 'actor_id', 'payload', 'correlation_id']) {
        await expect(app.query(`UPDATE public.outbox_events SET ${column} = ${column} WHERE id = $1`, [id])).rejects.toMatchObject({
          code: '42501',
        });
      }
    } finally {
      await app.end();
    }
    // The claim and both mark statements (published and failed) run as platform_app through the relay.
    const failing = createOutboxRelay({
      runner: runtime.tenantTx,
      producer: { enqueue: () => Promise.reject(new Error('Connection is closed.')) },
      log,
      batchSize: 100,
      pollIntervalMs: 500,
      budgetMs: 5_000,
      enqueueTimeoutMs: 1_000,
    });
    expect(await failing.runOnce()).toMatchObject({ locked: true, claimed: 1, published: 0, failed: 1 });
    expect(await relayOver(workerQueues()).runOnce()).toMatchObject({ published: 1, failed: 0 });
    expect(await eventRows([id ?? ''])).toMatchObject([{ published: true, attempts: 2, last_error: null }]);
  });

  it('[PR043-SEC-05] ck_outbox_events__actor: an insert whose actor_id differs from created_by is refused with 23514', async () => {
    await expect(
      superuser((client) =>
        client.query(
          `INSERT INTO public.outbox_events (type, aggregate_type, aggregate_id, actor_id, payload, correlation_id, created_by, updated_by)
           VALUES ('shipment.booked', 'shipment', gen_random_uuid(), $1, '{}'::jsonb, 'outbox-it-actor1', $2, $2)`,
          [USER, ANONYMOUS_ACTOR_ID],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'ck_outbox_events__actor' });
  });
});

describe('[US-011] outbox relay on PostgreSQL 18 and Valkey 8', () => {
  it('[AT-US-011-03] [AT-US-008-03] publishes in order per aggregate, marks each event after BullMQ accepted it; the job carries the row correlation id', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const ids = await publishAll([a, b, a, b, a], 'Client-Corr-0103');
    const queues = workerQueues();
    const relay = relayOver(queues);
    expect(await relay.runOnce()).toMatchObject({ locked: true, claimed: 5, published: 5, failed: 0 });
    const jobs = await queues.queueFor('outbox-relay').getJobs(['waiting'], 0, -1, true);
    expect(jobs.map((job) => job.id)).toEqual(ids.map((id) => `outbox_event.${id}`));
    for (const job of jobs) {
      const data = job.data as JobPayloadV2;
      expect(data).toEqual({ v: 2, kind: 'outbox_event', id: data.id, correlation_id: 'Client-Corr-0103', trace_context: null });
    }
    const rows = await eventRows(ids);
    expect(rows.every((row) => row['published'] === true && row['attempts'] === 1 && row['correlation_id'] === 'Client-Corr-0103')).toBe(
      true,
    );
    // A second tick finds nothing pending.
    expect(await relay.runOnce()).toMatchObject({ claimed: 0 });
  });

  it('[AT-US-011-04] a crash between enqueue and mark redelivers; the duplicate is discarded (one job per event id)', async () => {
    const [id] = await publishAll([randomUUID()]);
    const queues = workerQueues();
    const crashing: SystemTxRunner = {
      withTenantTx: (ctx, fn) =>
        runtime.tenantTx.withTenantTx(ctx, async (db) => {
          await fn(db);
          throw new Error('worker killed before COMMIT');
        }),
    };
    await expect(relayOver(queues, crashing).runOnce()).rejects.toThrow('worker killed before COMMIT');
    expect(await eventRows([id ?? ''])).toMatchObject([{ published: false, attempts: 0 }]);
    expect(await relayOver(queues).runOnce()).toMatchObject({ published: 1 });
    const queue = queues.queueFor('outbox-relay');
    expect((await queue.getJobs(['waiting'], 0, -1, true)).map((job) => job.id)).toEqual([`outbox_event.${id ?? ''}`]);
    expect(await eventRows([id ?? ''])).toMatchObject([{ published: true, attempts: 1 }]);
  });

  it('[AT-US-011-05] with the queue unavailable the events stay pending, the attempt is recorded, and a later tick publishes them', async () => {
    const ids = await publishAll([randomUUID(), randomUUID()]);
    const down = createWorkerQueues({
      connection: queueConnectionOptions('redis://127.0.0.1:1', 'worker-consumers-down', 'worker'),
      queueConnection: queueConnectionOptions('redis://127.0.0.1:1', 'worker-queues-down', 'queue'),
      log,
      processors: {},
    });
    cleanups.push(async () => {
      await Promise.race([down.close(), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    });
    const relay = createOutboxRelay({
      runner: runtime.tenantTx,
      producer: createJobProducer({ queueFor: (name) => down.queueFor(name), contextCorrelationId: () => undefined }),
      log,
      batchSize: 100,
      pollIntervalMs: 500,
      budgetMs: 5_000,
      enqueueTimeoutMs: 1_000,
    });
    expect(await relay.runOnce()).toMatchObject({ published: 0, failed: 1 });
    const rows = await eventRows(ids);
    expect(rows.map((row) => row['published'])).toEqual([false, false]);
    expect(rows[0]).toMatchObject({ attempts: 1, last_error: expect.stringMatching(/^[A-Za-z]+$/) });
    expect(await relayOver(workerQueues()).runOnce()).toMatchObject({ published: 2 });
  });

  it('[AT-US-011-06] exports the relay latency histogram (commit to accepted enqueue)', async () => {
    await publishAll([randomUUID()]);
    const relay = relayOver(workerQueues());
    await relay.runOnce();
    const text = relay.metrics();
    expect(text).toContain('# TYPE platform_outbox_relay_latency_seconds histogram');
    expect(text).toContain('platform_outbox_relay_latency_seconds_count 1\n');
    expect(text).toContain('platform_outbox_relay_published_total 1\n');
  });

  it('[n5] two relays tick at once: the advisory lock lets one claim, and each event is enqueued exactly once', async () => {
    const ids = await publishAll([randomUUID(), randomUUID(), randomUUID()]);
    const queues = workerQueues();
    const ticks = await Promise.all([relayOver(queues).runOnce(), relayOver(queues).runOnce()]);
    expect(ticks.reduce((sum, tick) => sum + tick.published, 0)).toBe(3);
    const jobs = await queues.queueFor('outbox-relay').getJobs(['waiting'], 0, -1, true);
    expect(jobs.map((job) => job.id).sort()).toEqual(ids.map((id) => `outbox_event.${id}`).sort());
  });

  it('[AT-US-011-03] [ADR-0004 am. 2 item 18] while one tick is held inside an enqueue, a second relay gets no lock and claims nothing; then every event is enqueued once, in order', async () => {
    const ids = await publishAll([randomUUID(), randomUUID(), randomUUID()]);
    const queues = workerQueues();
    const real = createJobProducer({ queueFor: (name) => queues.queueFor(name), contextCorrelationId: () => undefined });
    let entered = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = createOutboxRelay({
      runner: runtime.tenantTx,
      producer: {
        enqueue: async (queue, ref, enqueueOptions) => {
          entered();
          await gate;
          return real.enqueue(queue, ref, enqueueOptions);
        },
      },
      log,
      batchSize: 100,
      pollIntervalMs: 500,
      budgetMs: 8_000,
      enqueueTimeoutMs: 8_000,
    });
    const first = held.runOnce();
    await inside;
    expect(await relayOver(queues).runOnce()).toEqual({ locked: false, claimed: 0, published: 0, failed: 0, full: false });
    release();
    expect(await first).toMatchObject({ locked: true, claimed: 3, published: 3, failed: 0 });
    const jobs = await queues.queueFor('outbox-relay').getJobs(['waiting'], 0, -1, true);
    expect(jobs.map((job) => job.id)).toEqual(ids.map((id) => `outbox_event.${id}`));
    expect((await eventRows(ids)).map((row) => row['attempts'])).toEqual([1, 1, 1]);
  });
});

/** Waits (no sleep: one catalogue query per turn, bounded) until a backend of this database waits on a lock. */
async function untilLockWaiter(): Promise<void> {
  await superuser(async (client) => {
    for (let turn = 0; turn < 10_000; turn += 1) {
      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      );
      if ((rows[0]?.n ?? 0) > 0) return;
    }
    throw new Error('no backend waited on the lock');
  });
}

/**
 * The interleaving of D-ARCH-185 F3: T1 begins; T2 begins, locks the aggregate row (`SELECT … FOR UPDATE` on a
 * published outbox row both may lock), inserts E2 and holds; T1 asks for the same lock and waits (seen in
 * pg_stat_activity); T2 commits; T1 gets the lock, inserts E1 and commits. Returns [E1, E2]. Both run on orderRuntime
 * (lock_timeout 10 s, D-ARCH-188).
 */
async function interleave(insert: (db: TenantDb<AppTransactionClient>, label: string) => Promise<string>): Promise<[string, string]> {
  const [lockRow] = await publishAll([randomUUID()], 'order-it-lockrow');
  await drainOutbox();
  const gate = (): { promise: Promise<void>; open: () => void } => {
    let open = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };
  const t1Began = gate();
  const t2Locked = gate();
  const t2Release = gate();
  const t1 = orderRuntime.tenantTx.withTenantTx(request('order-it-txn-0001'), async (db) => {
    const [setting] = await db.$queryRaw<{ lock_timeout: string }[]>`SELECT pg_catalog.current_setting('lock_timeout') AS lock_timeout`;
    expect(setting?.lock_timeout).toBe('10s');
    t1Began.open();
    await t2Locked.promise;
    await db.$queryRaw`SELECT id FROM public.outbox_events WHERE id = ${lockRow ?? ''}::uuid FOR UPDATE`;
    return insert(db, 'E1');
  });
  await t1Began.promise;
  const t2 = orderRuntime.tenantTx.withTenantTx(request('order-it-txn-0002'), async (db) => {
    await db.$queryRaw`SELECT id FROM public.outbox_events WHERE id = ${lockRow ?? ''}::uuid FOR UPDATE`;
    const id = await insert(db, 'E2');
    t2Locked.open();
    await t2Release.promise;
    return id;
  });
  await t2Locked.promise;
  await untilLockWaiter();
  t2Release.open();
  const [e1, e2] = await Promise.all([t1, t2]);
  return [e1, e2];
}

describe('[US-011] per-aggregate order under the aggregate row lock (ADR-0004 amendment 2 items 13 and 14; D-ARCH-185)', () => {
  it('[AT-US-011-03] two transactions serialised by the row lock: the writer orders by insert time (E2, E1); the column default would invert it (E1, E2)', async () => {
    const aggregate = randomUUID();
    // Writer arm: outbox.publish sets created_at = clock_timestamp().
    const [writerE1, writerE2] = await interleave(async (db) => {
      const { id } = await outbox.publish(db, { type: 'shipment.booked', aggregateId: aggregate, payload: { shipment_id: aggregate } });
      return id;
    });
    const writerQueues = workerQueues();
    expect(await relayOver(writerQueues).runOnce()).toMatchObject({ published: 2, failed: 0 });
    const writerJobs = await writerQueues.queueFor('outbox-relay').getJobs(['waiting'], 0, -1, true);
    expect(writerJobs.map((job) => job.id)).toEqual([`outbox_event.${writerE2}`, `outbox_event.${writerE1}`]);

    // Control arm: a raw insert that leaves created_at to the column default (the transaction start).
    const [controlE1, controlE2] = await interleave(async (db, label) => {
      const rows = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO public.outbox_events (type, aggregate_type, aggregate_id, actor_id, payload, correlation_id, created_by, updated_by)
        VALUES ('shipment.booked', 'shipment', ${aggregate}::uuid, ${USER}::uuid, '{}'::jsonb, ${`order-it-ctrl-${label}`}, ${USER}::uuid,
                ${USER}::uuid)
        RETURNING id::text AS id`;
      return rows[0]?.id ?? '';
    });
    const controlQueues = workerQueues();
    expect(await relayOver(controlQueues).runOnce()).toMatchObject({ published: 2, failed: 0 });
    const controlJobs = await controlQueues.queueFor('outbox-relay').getJobs(['waiting'], 0, -1, true);
    expect(controlJobs.map((job) => job.id)).toEqual([`outbox_event.${controlE1}`, `outbox_event.${controlE2}`]);
  });
});

describe('[ADR-0004 item 6] outbox-purge on PostgreSQL 18 (D-ARCH-167, D-ARCH-171)', () => {
  it('deletes what is older than 30 days in batches of 5,000; rows of 29 days stay (outbox, processed events, job executions)', async () => {
    const anon = ANONYMOUS_ACTOR_ID;
    await superuser(async (client) => {
      await client.query('DELETE FROM public.outbox_events');
      // 5,001 events published 31 days ago (two batches), 2 published 29 days ago, 1 pending of 40 days (never purged).
      await client.query(
        `INSERT INTO public.outbox_events (type, aggregate_type, aggregate_id, actor_id, payload, correlation_id, published_at,
                                           created_at, created_by, updated_by)
         SELECT 'shipment.booked', 'shipment', gen_random_uuid(), $1, '{}'::jsonb, 'purge-it-0001',
                now() - make_interval(days => d), now() - make_interval(days => d), $1, $1
           FROM (SELECT CASE WHEN g <= 5001 THEN 31 ELSE 29 END AS d FROM generate_series(1, 5003) AS g) AS s`,
        [anon],
      );
      await client.query(
        `INSERT INTO public.outbox_events (type, aggregate_type, aggregate_id, actor_id, payload, correlation_id, created_at, created_by, updated_by)
         VALUES ('shipment.booked', 'shipment', gen_random_uuid(), $1, '{}'::jsonb, 'purge-it-0002', now() - interval '40 days', $1, $1)`,
        [anon],
      );
      await client.query(
        `INSERT INTO public.processed_events (consumer, event_id, processed_at, created_by, updated_by)
         VALUES ('notifications', gen_random_uuid(), now() - interval '31 days', $1, $1),
                ('notifications', gen_random_uuid(), now() - interval '29 days', $1, $1)`,
        [anon],
      );
      await client.query(
        `INSERT INTO public.job_executions (job_key, queue, completed_at, created_by, updated_by)
         VALUES ('purge-it.old', 'documents', now() - interval '31 days', $1, $1),
                ('purge-it.new', 'documents', now() - interval '29 days', $1, $1)`,
        [anon],
      );
    });
    const purge = createOutboxPurge({ runner: runtime.tenantTx, log });
    const occurrence = `repeat:outbox-purge:${String(Date.now())}`;
    const job = {
      queue: 'housekeeping' as const,
      id: occurrence,
      name: 'outbox-purge',
      attemptsMade: 0,
      correlationId: `outbox-purge-${occurrence.slice(20)}`,
      signal: new AbortController().signal,
    };
    expect(await purge.run(job)).toEqual({ outbox_events: 5_001, processed_events: 1, job_executions: 1 });
    expect(PURGE_BATCH_SIZE).toBe(5_000);
    const remaining = await superuser(async (client) => ({
      outbox: (
        await client.query<{ days: number; published: boolean; n: string }>(
          `SELECT round(extract(epoch FROM now() - created_at) / 86400)::int AS days, published_at IS NOT NULL AS published, count(*) AS n
             FROM public.outbox_events GROUP BY 1, 2 ORDER BY 1`,
        )
      ).rows.map((r) => `${String(r.days)} ${String(r.published)} ${r.n}`),
      processed: (await client.query(`SELECT count(*)::int AS n FROM public.processed_events`)).rows[0] as { n: number },
      ledger: (
        await client.query<{ job_key: string }>(
          `SELECT job_key FROM public.job_executions WHERE queue IN ('documents', 'housekeeping') ORDER BY job_key`,
        )
      ).rows.map((r) => r.job_key),
    }));
    expect(remaining.outbox).toEqual(['29 true 2', '40 false 1']);
    expect(remaining.processed).toEqual({ n: 1 });
    // The 29-day ledger row stays; each batch of the occurrence left its claim (two outbox batches, one per other table).
    expect(remaining.ledger).toEqual([
      'purge-it.new',
      `${occurrence}.job_executions.0`,
      `${occurrence}.outbox_events.0`,
      `${occurrence}.outbox_events.1`,
      `${occurrence}.processed_events.0`,
    ]);
    // A redelivered occurrence runs no committed batch again and finds nothing more to delete.
    expect(await purge.run(job)).toEqual({ outbox_events: 0, processed_events: 0, job_executions: 0 });
  });

  it('the purge runs SYSTEM-scope (no organisation, the SYSTEM actor stamps its ledger rows)', async () => {
    const actor = await runtime.tenantTx.withTenantTx(
      systemContext('purge-it-0003'),
      (db) =>
        db.$queryRaw<
          { actor: string | null; org: string | null }[]
        >`SELECT platform.app_actor_id()::text AS actor, platform.app_org_id()::text AS org`,
    );
    expect(actor).toEqual([{ actor: '00000000-0000-7000-8000-000000000001', org: null }]);
  });
});
