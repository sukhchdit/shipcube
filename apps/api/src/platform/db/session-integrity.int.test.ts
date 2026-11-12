/**
 * PR7-SEC-06 item 3 against a real PostgreSQL 18: the runtime role may rewrite its own role defaults
 * (`ALTER ROLE platform_app RESET lock_timeout`), and the readiness database check must then report not ready.
 * The role is created here with the `prisma/bootstrap/00-roles.sql` settings (the bootstrap harness is a prisma
 * workspace test helper; consolidation is TASK-276).
 */
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { createDatabasePool, type DatabaseClientOptions } from './client.js';
import { dedicatedConnector } from './dedicated-connection.js';
import { createDatabaseCheck } from './health-check.js';
import { createSessionIntegrityGuard, EXPECTED_ROLE_SETTINGS, type SessionIntegrityFinding } from './session-integrity.js';

/** Same pinned image as prisma/tests/harness/postgres.ts. */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const STARTUP_TIMEOUT_MS = 180_000;

describe('database session integrity with a real platform_app role (PR7-SEC-06 item 3)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let options: DatabaseClientOptions;
  const events: (readonly SessionIntegrityFinding[])[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const password = randomBytes(24).toString('hex');
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query(`CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    for (const setting of EXPECTED_ROLE_SETTINGS) {
      const [name, value] = setting.split('=') as [string, string];
      await admin.query(`ALTER ROLE platform_app SET ${name} = ${name === 'search_path' ? value : `'${value}'`}`);
    }
    await admin.end();
    const url = new URL(container.getConnectionUri());
    url.username = 'platform_app';
    url.password = password;
    options = { connectionString: url.toString(), poolMax: 2, applicationName: 'api-integrity-it' };
    pool = createDatabasePool(options);
    pool.on('error', () => undefined);
  }, STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    await container.stop();
  }, STARTUP_TIMEOUT_MS);

  it('[M1] a transaction-local set_config on the pool BEFORE the first probe leaves the database ready (dedicated start-up connection)', async () => {
    const single = createDatabasePool({ ...options, poolMax: 1 });
    try {
      const client = await single.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.org_id', '00000000-0000-0000-0000-000000000001', true)");
        await client.query('COMMIT');
        // The pooled backend now reports '' for app.org_id (ADR-0005 item 16, F-07).
        const { rows } = await client.query<{ value: string | null }>("SELECT current_setting('app.org_id', true) AS value");
        expect(rows[0]?.value).toBe('');
      } finally {
        client.release();
      }
      const local: (readonly SessionIntegrityFinding[])[] = [];
      const guard = createSessionIntegrityGuard({
        pool: single,
        connectDedicated: dedicatedConnector(options),
        onDrift: (f) => local.push(f),
        intervalMs: 0,
      });
      await expect(guard.recheck()).resolves.toBeUndefined();
      const check = createDatabaseCheck(single, guard);
      for (let i = 0; i < 3; i += 1) await expect(check.check(new AbortController().signal)).resolves.toBeUndefined();
      expect(local).toEqual([]);
    } finally {
      await single.end();
    }
  });

  it('intact role settings pass; the role resetting its own lock_timeout makes the database not ready', async () => {
    const guard = createSessionIntegrityGuard({
      pool,
      connectDedicated: dedicatedConnector(options),
      onDrift: (findings) => events.push(findings),
      intervalMs: 0,
    });
    const check = createDatabaseCheck(pool, guard);
    await expect(check.check(new AbortController().signal)).resolves.toBeUndefined();

    // The runtime role needs no privilege for this (AlterRoleSet allows roleid == GetUserId()).
    await pool.query('ALTER ROLE platform_app RESET lock_timeout');
    await expect(check.check(new AbortController().signal)).rejects.toThrow('db_role_setting_drift');
    expect(events).toEqual([['db_role_setting_drift']]);
  });

  it('a role-level tenant-context default (set by a privileged role) is detected as drift and as a preset context', async () => {
    await pool.query("ALTER ROLE platform_app SET lock_timeout = '2s'");
    // platform_app cannot set a custom (placeholder) parameter on itself ("permission denied to set parameter"), so
    // this default can only come from a privileged misconfiguration; the guard still catches it.
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query("ALTER ROLE platform_app SET app.org_id = '00000000-0000-0000-0000-000000000001'");
    await admin.end();
    // The start-up check opens its own connection; the pool is not used until it has passed.
    const guard = createSessionIntegrityGuard({
      pool,
      connectDedicated: dedicatedConnector(options),
      onDrift: () => undefined,
      intervalMs: 0,
    });
    await expect(guard.recheck()).rejects.toThrow(/db_role_setting_drift, db_session_default_tampered/u);
  });

  it('[M1] an empty-string tenant-context default is tampering on the dedicated start-up connection (NULL required there)', async () => {
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query("ALTER ROLE platform_app SET app.org_id = ''");
    await admin.end();
    const guard = createSessionIntegrityGuard({
      pool,
      connectDedicated: dedicatedConnector(options),
      onDrift: () => undefined,
      intervalMs: 0,
    });
    await expect(guard.recheck()).rejects.toThrow('db_session_default_tampered');
  });
});
