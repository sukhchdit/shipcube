/**
 * The transactional outbox end to end on PostgreSQL 18 (bootstrapped and migrated, as `platform_app`) and Valkey 8
 * (US-011 AT-US-011-01..06; US-008 AT-US-008-03 outbox hop; ADR-0004; data-model §3.5, §6.1, §10.5; D-ARCH-167,
 * D-ARCH-171; TASK-043). Lane B (Testcontainers).
 *
 * The writer runs on the worker's production database runtime (`databaseRuntimeFromConfig`, the one runner of the
 * process) inside a tenant transaction whose context carries the correlation id the API pipeline sets from
 * `X-Correlation-Id` (apps/api/src/platform/outbox/writer.int.test.ts proves that first hop through createApp). The
 * relay runs on the same runner with the api job producer over the worker queue runtime's queues (openQueue, the
 * fail-fast profile). The purge runs through its schedule handler.
 */
import { randomUUID } from 'node:crypto';

import {
  type ActiveDatabaseRuntime,
  type AppTransactionClient,
  createJobProducer,
  createOutbox,
  createRuntimeLog,
  databaseRuntimeFromConfig,
  type TenantContext,
} from '@platform/api/runtime';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { Config } from '@platform/config';
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';
import type { JobPayloadV2 } from '@platform/shared/queues';
import { identifierPayload } from '@platform/shared/events';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { queueConnectionOptions } from '../queues/connection.js';
import { createWorkerQueues, type WorkerQueues } from '../queues/runtime.js';
import { createOutboxPurge, PURGE_BATCH_SIZE } from './purge.js';
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
const outbox = createOutbox(catalogue);

let postgres: MigratedPostgres;
let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
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
      `SELECT id::text, org_id::text, actor_id::text, correlation_id, trace_context, published_at IS NOT NULL AS published,
              attempts, last_error, created_by::text, version
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
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
  await valkey?.stop();
  await postgres?.stop();
});

describe('[US-011] outbox writer on PostgreSQL 18', () => {
  it('[AT-US-011-01] the event is committed with the business change, with the transaction org, actor and correlation id', async () => {
    const aggregate = randomUUID();
    const [id] = await publishAll([aggregate], 'Client-Corr-0101');
    expect(await eventRows([id ?? ''])).toEqual([
      {
        id,
        org_id: ORG,
        actor_id: USER,
        correlation_id: 'Client-Corr-0101',
        trace_context: null,
        published: false,
        attempts: 0,
        last_error: null,
        created_by: USER,
        version: 1,
      },
    ]);
    await drainOutbox();
  });

  it('[AT-US-011-02] a rolled-back change leaves no event', async () => {
    let id = '';
    await expect(
      runtime.tenantTx.withTenantTx(request('outbox-it-0102'), async (db) => {
        ({ id } = await outbox.publish(db, { type: 'shipment.booked', aggregateId: randomUUID(), payload: { shipment_id: randomUUID() } }));
        throw new Error('business rule refused');
      }),
    ).rejects.toThrow('business rule refused');
    expect(id).not.toBe('');
    expect(await eventRows([id])).toEqual([]);
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
        'outbox_events UPDATE',
        'processed_events DELETE',
        'processed_events INSERT',
        'processed_events SELECT',
      ]);
    } finally {
      await app.end();
    }
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
