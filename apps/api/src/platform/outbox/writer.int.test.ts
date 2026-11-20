/**
 * AT-US-008-03, outbox hop, first half (D-062; code review m1): a `transaction: 'tenant'` route publishes with
 * `outbox.publish(db, event)` in its handler transaction, through the composed API (createApp) on PostgreSQL 18
 * (bootstrapped and migrated, as `platform_app`; the runner-activation.int.test.ts pattern). The request carries
 * `X-Correlation-Id: Client-Corr-0103`, and the event row carries exactly that value. The second half, row → job
 * payload, is the AT-US-011-03 case of apps/worker/src/platform/outbox/relay.int.test.ts with the same literal. A
 * handler transaction that fails after the publish leaves no event (AT-US-011-02 at the route level). Lane B.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import Joi from 'joi';

import { createApp } from '../../app.js';
import type { AppTransactionClient } from '../db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../db/runtime.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { createRuntimeLog } from '../runtime/log.js';
import type { OutboxDb } from './index.js';
import { type MigratedPostgres, startMigratedPostgres } from './tests/migrated-postgres.js';
import { createTestOutbox } from './tests/test-outbox.js';

const SHIPMENT = '0193a5b2-7c1e-7d4a-9f3b-0000000d0001';
const CORRELATION = 'Client-Corr-0103';
const outbox = createTestOutbox({
  'shipment.booked': { aggregateType: 'shipment', payload: Joi.object({ shipment_id: Joi.string().guid().required() }) },
});

const publishRoute = fixtureRoute({
  operationId: 'probeOutboxPublish',
  path: '/fixtures/outbox-publish',
  tenancy: 'guest',
  transaction: 'tenant',
  handler: async ({ db }) => {
    const { id } = await outbox.publish(db as OutboxDb, {
      type: 'shipment.booked',
      aggregateId: SHIPMENT,
      payload: { shipment_id: SHIPMENT },
    });
    return { status: 200, body: { id } };
  },
});

const failingRoute = fixtureRoute({
  operationId: 'probeOutboxRollback',
  path: '/fixtures/outbox-rollback',
  tenancy: 'guest',
  transaction: 'tenant',
  handler: async ({ db }) => {
    await outbox.publish(db as OutboxDb, { type: 'shipment.booked', aggregateId: SHIPMENT, payload: { shipment_id: SHIPMENT } });
    // A database error after the publish (division by zero): the handler transaction rolls back, the event with it.
    await (db as OutboxDb).$queryRaw`SELECT 1 / 0`;
    return { status: 200, body: {} };
  },
});

const configFor = (url: string): Config =>
  ({
    DATABASE_URL: { reveal: () => url },
    DB_POOL_MAX: 2,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
    DB_TX_LOCK_TIMEOUT_MS: 2_000,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
  }) as unknown as Config;

describe('[AT-US-008-03] outbox hop through the composed API on PostgreSQL 18', () => {
  let postgres: MigratedPostgres;
  let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
  let server: Server;
  let base: string;
  const log = createRuntimeLog('api', { write: () => true });

  async function rows(): Promise<{ id: string; correlation_id: string; org_id: string | null }[]> {
    const client = await postgres.superuser();
    try {
      const result = await client.query<{ id: string; correlation_id: string; org_id: string | null }>(
        'SELECT id::text, correlation_id, org_id::text FROM public.outbox_events ORDER BY created_at, id',
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    delete process.env['PGOPTIONS'];
    postgres = await startMigratedPostgres();
    runtime = databaseRuntimeFromConfig(configFor(postgres.appUrl), 'api', log);
    await runtime.startup();
    const app = createApp({
      health: [],
      modules: [{ name: 'fixtures', routes: [publishRoute, failingRoute] }],
      tenantTx: runtime.tenantTx,
      logger: log,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server as Server | undefined)?.close(() => resolve()) ?? resolve());
    for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
    await (postgres as MigratedPostgres | undefined)?.stop();
  }, 60_000);

  it('[AT-US-008-03] [AT-US-011-01] the event commits with the handler transaction and carries the request X-Correlation-Id', async () => {
    const response = await fetch(`${base}/fixtures/outbox-publish`, { headers: { 'X-Correlation-Id': CORRELATION } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe(CORRELATION);
    const { id } = (await response.json()) as { id: string };
    expect(await rows()).toEqual([{ id, correlation_id: CORRELATION, org_id: null }]);
  });

  it('[AT-US-011-02] a handler transaction that fails after the publish leaves no event', async () => {
    const before = await rows();
    const response = await fetch(`${base}/fixtures/outbox-rollback`, { headers: { 'X-Correlation-Id': 'Client-Corr-0802' } });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await rows()).toEqual(before);
  });
});
