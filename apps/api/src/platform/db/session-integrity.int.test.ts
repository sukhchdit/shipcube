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

import { createDatabasePool } from './client.js';
import { createDatabaseCheck } from './health-check.js';
import { createSessionIntegrityGuard, EXPECTED_ROLE_SETTINGS, type SessionIntegrityFinding } from './session-integrity.js';

/** Same pinned image as prisma/tests/harness/postgres.ts. */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const STARTUP_TIMEOUT_MS = 180_000;

describe('database session integrity with a real platform_app role (PR7-SEC-06 item 3)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
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
    pool = createDatabasePool({ connectionString: url.toString(), poolMax: 2, applicationName: 'api-integrity-it' });
    pool.on('error', () => undefined);
  }, STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    await container.stop();
  }, STARTUP_TIMEOUT_MS);

  it('intact role settings pass; the role resetting its own lock_timeout makes the database not ready', async () => {
    const guard = createSessionIntegrityGuard({ pool, onDrift: (findings) => events.push(findings), intervalMs: 0 });
    const check = createDatabaseCheck(pool, guard);
    await expect(check.check(new AbortController().signal)).resolves.toBeUndefined();

    // The runtime role needs no privilege for this (AlterRoleSet allows roleid == GetUserId()).
    await pool.query('ALTER ROLE platform_app RESET lock_timeout');
    await expect(check.check(new AbortController().signal)).rejects.toThrow('role_settings_drift');
    expect(events).toEqual([['role_settings_drift']]);
  });

  it('a role-level tenant-context default (set by a privileged role) is detected as drift and as a preset context', async () => {
    await pool.query("ALTER ROLE platform_app SET lock_timeout = '2s'");
    // platform_app cannot set a custom (placeholder) parameter on itself ("permission denied to set parameter"), so
    // this default can only come from a privileged misconfiguration; the guard still catches it.
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query("ALTER ROLE platform_app SET app.org_id = '00000000-0000-0000-0000-000000000001'");
    await admin.end();
    const fresh = createDatabasePool({
      connectionString: (pool.options as { connectionString: string }).connectionString,
      poolMax: 1,
      applicationName: 'api-integrity-it',
    });
    try {
      const guard = createSessionIntegrityGuard({ pool: fresh, onDrift: () => undefined, intervalMs: 0 });
      await expect(guard.assertIntact()).rejects.toThrow(/role_settings_drift, session_context_preset/u);
    } finally {
      await fresh.end();
    }
  });
});
