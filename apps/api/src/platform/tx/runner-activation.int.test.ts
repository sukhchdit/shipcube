/**
 * Runner activation against a real PostgreSQL 18 (D-ARCH-104 (3); PR11-SEC-09 items 3 and 4 verified at the tx slot;
 * TASK-020 part 020-B). The database runtime is built by `databaseRuntimeFromConfig`, exactly as both entry points get
 * it (the generated client from platform/db/generated.ts, no class passed in), connected as `platform_app` with the
 * bootstrap role settings: the fresh-connection probe passes at start-up, a `transaction: 'tenant'` fixture route
 * answers 200 through the composed createApp inside a real tenant transaction, and a database failure inside the
 * handler (statement timeout, SQLSTATE 57014) surfaces as problem+json with the catalogue code, `Retry-After` and the
 * generic text, never the reason, SQLSTATE or Prisma code.
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { createApp } from '../../app.js';
import type { AppDb, AppTransactionClient } from '../db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../db/runtime.js';
import { EXPECTED_ROLE_SETTINGS } from '../db/session-integrity.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { createRuntimeLog } from '../runtime/log.js';

/** Same pinned image as prisma/tests/harness/postgres.ts. */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const TX_STATEMENT_TIMEOUT_MS = 300;

/** Creates `platform_app` with the bootstrap role settings and returns its connection URL (as health.int.test.ts). */
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

const configFor = (url: string): Config =>
  ({
    DATABASE_URL: { reveal: () => url },
    DB_POOL_MAX: 2,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: TX_STATEMENT_TIMEOUT_MS,
    DB_TX_LOCK_TIMEOUT_MS: 200,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
  }) as unknown as Config;

const okRoute = fixtureRoute({
  operationId: 'probeTenantTransaction',
  path: '/fixtures/tenant-tx',
  tenancy: 'guest',
  transaction: 'tenant',
  handler: async ({ db, correlationId }) => {
    // app.correlation_id is set with set_config(..., true): visible only inside the runner's transaction.
    const rows = await (db as AppDb).$queryRaw<{ correlation: string | null; role: string }[]>`
      SELECT current_setting('app.correlation_id', true) AS correlation, current_user::text AS role`;
    const row = rows[0];
    return { status: 200, body: { sameCorrelation: row?.correlation === correlationId, role: row?.role } };
  },
});

const slowRoute = fixtureRoute({
  operationId: 'probeTenantTransactionTimeout',
  path: '/fixtures/tenant-tx-timeout',
  tenancy: 'guest',
  transaction: 'tenant',
  handler: async ({ db }) => {
    await (db as AppDb).$queryRaw`SELECT pg_sleep(2)`;
    return { status: 200, body: { unreachable: true } };
  },
});

describe('[D-ARCH-104] runner activation on PostgreSQL 18 as platform_app (PR11-SEC-09 items 3-4 at the tx slot)', () => {
  let container: StartedPostgreSqlContainer;
  let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
  let server: Server;
  let base: string;
  const lines: string[] = [];
  const log = createRuntimeLog('api', {
    write: (line: string) => {
      lines.push(line);
      return true;
    },
  });
  const events = (): string[] => lines.map((line) => String((JSON.parse(line) as Record<string, unknown>)['event']));

  beforeAll(async () => {
    delete process.env['PGOPTIONS'];
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const appUrl = await createAppRole(container.getConnectionUri());
    runtime = databaseRuntimeFromConfig(configFor(appUrl), 'api', log);
    await runtime.startup();
    const app = createApp({
      health: [],
      modules: [{ name: 'fixtures', routes: [okRoute, slowRoute] }],
      tenantTx: runtime.tenantTx,
      logger: log,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server as Server | undefined)?.close(() => resolve()) ?? resolve());
    for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
    await (container as StartedPostgreSqlContainer | undefined)?.stop();
  }, 60_000);

  it('start-up runs the fresh-connection probe as platform_app and it passes; readiness reports the database ready', async () => {
    expect(events()).toContain('db.fresh_connection_ok');
    expect(events()).not.toContain('db.fresh_connection_failed');
    await expect(runtime.readinessCheck.check(AbortSignal.timeout(5_000))).resolves.toBeUndefined();
  });

  it('a transaction tenant route answers 200 through the composed app, inside one tenant transaction as platform_app', async () => {
    const response = await fetch(`${base}/fixtures/tenant-tx`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sameCorrelation: true, role: 'platform_app' });
  });

  it('a DbError inside the handler (statement timeout, 57014) is problem+json: catalogue code, Retry-After, generic text only', async () => {
    const response = await fetch(`${base}/fixtures/tenant-tx-timeout`);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
    expect(response.headers.get('retry-after')).not.toBeNull();
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    for (const leak of ['STATEMENT_TIMEOUT', '57014', 'P2010', 'pg_sleep', 'canceling statement']) expect(text).not.toContain(leak);
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['reason', 'sqlState', 'prismaCode', 'message']));
  });
});
