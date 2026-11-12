/**
 * US-012 readiness against real dependencies (Testcontainers: PostgreSQL 18 and Valkey 8). The unit suites prove the
 * evaluation rules with stubs; this suite proves that the production checks (`SELECT 1` through the runtime pool,
 * `PING` through the ioredis client built from explicit options) report a healthy stack as `ok` and an outage as
 * `unavailable` within the 2.5 s bound. Object storage and the audit components are still pending checks
 * (TASK-019, TASK-021), so their rows are covered by the unit suite only.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import express from 'express';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { createDatabasePool } from '../db/client.js';
import { createDatabaseCheck } from '../db/health-check.js';
import { createReadinessProbe, pendingCheck, type ReadinessBody } from '../runtime/readiness.js';
import { createValkeyCheck, createValkeyClient } from '../valkey/client.js';
import { createHealthRouter } from './router.js';

/** Valkey 8.1 (Alpine), pinned by digest; published 2026-10-27, outside the 7-day cooldown. */
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a';
/** Same pinned image as prisma/tests/harness/postgres.ts (shared harness consolidation: TASK-276). */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const STARTUP_TIMEOUT_MS = 180_000;

describe('US-012 readiness with real PostgreSQL 18 and Valkey 8 (api)', () => {
  let postgres: StartedPostgreSqlContainer;
  let valkeyContainer: StartedTestContainer;
  let pool: pg.Pool;
  let valkey: Redis;
  let app: express.Express;

  beforeAll(async () => {
    [postgres, valkeyContainer] = await Promise.all([
      new PostgreSqlContainer(POSTGRES_IMAGE).start(),
      new GenericContainer(VALKEY_IMAGE)
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start(),
    ]);
    pool = createDatabasePool({ connectionString: postgres.getConnectionUri(), poolMax: 2, applicationName: 'api-health-it' });
    pool.on('error', () => undefined);
    valkey = createValkeyClient({
      url: `redis://${valkeyContainer.getHost()}:${String(valkeyContainer.getMappedPort(6379))}`,
      connectionName: 'api-health-it',
    });
    const probe = createReadinessProbe(
      [
        createDatabaseCheck(pool),
        createValkeyCheck(valkey),
        pendingCheck('object_storage'),
        pendingCheck('audit_partitions'),
        pendingCheck('audit_chain'),
        // No report reuse: each test stops a container and must see the next evaluation (PR-0009 m3 TTL is 1 s).
      ],
      { cacheTtlMs: 0 },
    );
    app = express();
    app.use(createHealthRouter({ probe }));
  }, STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    valkey.disconnect();
    await pool.end().catch(() => undefined);
    await Promise.allSettled([valkeyContainer.stop(), postgres.stop()]);
  }, STARTUP_TIMEOUT_MS);

  it('AT-US-012-01: healthy stack, ready reports database and redis ok with real dependencies', async () => {
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect((ready.body as ReadinessBody).components).toMatchObject({ database: 'ok', redis: 'ok' });
    expect((await request(app).get('/health/live')).status).toBe(200);
  });

  it('AT-US-012-02-redis: Valkey stopped makes ready 503 with redis unavailable within 2.5 s; live stays 200', async () => {
    await valkeyContainer.stop();
    const started = performance.now();
    const ready = await request(app).get('/health/ready');
    expect(performance.now() - started).toBeLessThan(2_500);
    expect(ready.status).toBe(503);
    expect((ready.body as ReadinessBody).components).toMatchObject({ database: 'ok', redis: 'unavailable' });
    expect((await request(app).get('/health/live')).status).toBe(200);
  });

  it('AT-US-012-02-postgres: PostgreSQL stopped makes ready 503 with database unavailable within 2.5 s', async () => {
    await postgres.stop();
    const started = performance.now();
    const ready = await request(app).get('/health/ready');
    expect(performance.now() - started).toBeLessThan(2_500);
    expect(ready.status).toBe(503);
    expect((ready.body as ReadinessBody).components.database).toBe('unavailable');
    expect(ready.text).not.toMatch(/ECONNREFUSED|localhost|127\.0\.0\.1|Error/);
  });
});
