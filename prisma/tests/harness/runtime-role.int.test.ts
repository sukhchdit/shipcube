/**
 * The integration project's application connection is the runtime role, built by the production factory
 * apps/api/src/platform/db/client.ts with the generated Prisma 7 client (REQ-RLS-005, US-074 runtime-role part;
 * data-model.md §4.4, §7.1; TASK-003). The migrations themselves ran as platform_migrator.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createDatabaseClient } from '../../../apps/api/src/platform/db/client.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import { APP_ROLE, MIGRATOR, PlatformPostgres } from './postgres.js';

interface RawClient {
  $queryRawUnsafe<T>(sql: string): Promise<T>;
  $executeRawUnsafe(sql: string): Promise<number>;
  $disconnect(): Promise<void>;
}

let db: PlatformPostgres;
let client: RawClient;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
  // The generated client is loaded under the lock that the engine acceptance test holds while it regenerates it.
  const { PrismaClient } = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
  client = createDatabaseClient(PrismaClient, {
    connectionString: db.appUrl(database),
    poolMax: 2,
    applicationName: 'integration-test',
  });
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  await db?.stop();
});

describe('runtime connection (REQ-RLS-005)', () => {
  it('[AT-US-074-04] the client from the runtime factory connects as platform_app, which is not superuser and has no BYPASSRLS', async () => {
    const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT current_user::text AS current_user, session_user::text AS session_user, r.rolsuper, r.rolbypassrls,
              pg_catalog.current_setting('application_name') AS application_name
         FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows).toEqual([
      { current_user: APP_ROLE, session_user: APP_ROLE, rolsuper: false, rolbypassrls: false, application_name: 'integration-test' },
    ]);
  });

  it('[AT-US-074-04] migrations ran as platform_migrator, a role the runtime never uses, and the runtime role owns nothing', async () => {
    const rows = await client.$queryRawUnsafe<Array<{ history_owner: string; owned: bigint }>>(
      `SELECT pg_catalog.pg_get_userbyid(c.relowner)::text AS history_owner,
              (SELECT count(*) FROM pg_catalog.pg_class WHERE relowner = 'platform_app'::regrole) AS owned
         FROM pg_catalog.pg_class c WHERE c.oid = 'public._prisma_migrations'::regclass`,
    );
    expect(rows).toEqual([{ history_owner: MIGRATOR, owned: 0n }]);
  });

  it('[AT-US-074-04] the runtime role cannot run DDL in public or platform', async () => {
    await expect(client.$executeRawUnsafe('CREATE TABLE public.runtime_ddl_probe (id integer)')).rejects.toThrow(/permission denied/);
    await expect(
      client.$executeRawUnsafe('CREATE FUNCTION platform.runtime_ddl_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'),
    ).rejects.toThrow(/permission denied/);
  });

  it('runs with the runtime role settings: search_path pg_catalog, public and the lock and idle timeouts', async () => {
    const rows = await client.$queryRawUnsafe<Array<Record<string, string>>>(
      `SELECT pg_catalog.current_setting('search_path') AS search_path, pg_catalog.current_setting('lock_timeout') AS lock_timeout,
              pg_catalog.current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    expect(rows).toEqual([{ search_path: 'pg_catalog, public', lock_timeout: '2s', idle: '15s' }]);
  });
});
