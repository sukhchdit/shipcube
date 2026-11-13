/**
 * US-012 readiness against real dependencies (Testcontainers: PostgreSQL 18 and Valkey 8). The unit suites prove the
 * evaluation rules with stubs; this suite proves that the production checks report a healthy stack as `ok` and an
 * outage as `unavailable` within the 2.5 s bound. The database component is the one the processes run: the
 * composition of platform/db/runtime.ts (`SELECT 1` through the runtime pool plus the session-integrity guard, which
 * needs the bootstrap role settings, so the suite connects as a `platform_app` role created with them; D-ORCH-014
 * (d): no import of platform/db/client.ts here). `PING` goes through the ioredis client built from explicit options.
 * Object storage is still a pending check (TASK-019). The audit components need the bootstrapped catalogue, so here
 * they are fixed stand-ins (audit_chain degraded, as before any verification); the real checks run in
 * prisma/tests/health/audit-readiness.int.test.ts. pendingCheck refuses audit components (code review PR #24 R1-n2).
 */
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import express from 'express';
import type { Redis } from 'ioredis';
import pg from 'pg';
import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { createDatabaseRuntime } from '../db/runtime.js';
import { EXPECTED_ROLE_SETTINGS } from '../db/session-integrity.js';
import { createRuntimeLog } from '../runtime/log.js';
import { createReadinessProbe, pendingCheck, type ReadinessBody, type ReadinessCheck } from '../runtime/readiness.js';
import { createValkeyCheck, createValkeyClient } from '../valkey/client.js';
import { createHealthRouter } from './router.js';

/** Valkey 8.1 (Alpine), pinned by digest; published 2026-10-27, outside the 7-day cooldown. */
const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a';
/** Same pinned image as prisma/tests/harness/postgres.ts (shared harness consolidation: TASK-276). */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const STARTUP_TIMEOUT_MS = 180_000;

/** Stand-ins for the audit components (no audit catalogue in this plain PostgreSQL container). */
const AUDIT_STAND_INS: readonly ReadinessCheck[] = [
  { name: 'audit_partitions', critical: true, check: () => Promise.resolve() },
  { name: 'audit_chain', critical: false, check: () => Promise.resolve('degraded') },
];

/** Creates `platform_app` with the bootstrap role settings and returns its connection URL. */
async function createAppRole(adminUrl: string): Promise<string> {
  const password = randomBytes(24).toString('hex');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    for (const setting of EXPECTED_ROLE_SETTINGS) {
      const [name, value] = setting.split('=') as [string, string];
      await admin.query(`ALTER ROLE platform_app SET ${name} = ${name === 'search_path' ? value : `'${value}'`}`);
    }
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.username = 'platform_app';
  url.password = password;
  return url.toString();
}

describe('US-012 readiness with real PostgreSQL 18 and Valkey 8 (api)', () => {
  let postgres: StartedPostgreSqlContainer;
  let valkeyContainer: StartedTestContainer;
  let database: ReturnType<typeof createDatabaseRuntime>;
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
    database = createDatabaseRuntime({
      database: { connectionString: await createAppRole(postgres.getConnectionUri()), poolMax: 2, applicationName: 'api-health-it' },
      tx: { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
      log: createRuntimeLog('api', { write: () => true }),
    });
    await database.startup();
    valkey = createValkeyClient({
      url: `redis://${valkeyContainer.getHost()}:${String(valkeyContainer.getMappedPort(6379))}`,
      connectionName: 'api-health-it',
    });
    const probe = createReadinessProbe(
      [
        database.readinessCheck,
        createValkeyCheck(valkey),
        pendingCheck('object_storage'),
        ...AUDIT_STAND_INS,
        // No report reuse: each test stops a container and must see the next evaluation (PR-0009 m3 TTL is 1 s).
      ],
      { cacheTtlMs: 0 },
    );
    app = express();
    app.use(createHealthRouter({ probe }));
  }, STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    valkey.disconnect();
    for (const resource of database.resources) await resource.close().catch(() => undefined);
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
