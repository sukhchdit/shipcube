/**
 * The shadow-database init rendering against PostgreSQL 18 and the REAL bootstrap lane, through the ROOT
 * prisma.config.ts (data-model.md §7.3 amendment 2026-11-13; SPK-08 F-01, F-02, F-03; PR12-SEC-07; TASK-021). Ported
 * from the SPK-08 spike exits 3c and 4 (prisma/tests/spikes/spk08-audit-owner.int.test.ts), which used a prototype
 * audit lane and a fixture config. One container:
 *  - a clone of the bootstrapped template (full lane, 10-audit.sql and 90-audit-ddl-guard.sql included) is deployed
 *    (F-01) and is the "real, bootstrapped database" of the PR12-SEC-07 refusal;
 *  - `shadow_init` is an empty database owned by the migrator: the SHADOW_DATABASE_URL of two `migrate diff` runs (F-02);
 *  - `shadow_raw` is another migrator-owned database for the F-02 negative control, run with pg directly.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { quoteIdentifier, splitStatements } from '../../../tools/db/sql-text.js';
import { OWNERSHIP_GUARD, readBootstrapLane, renderShadowInit } from '../../../tools/db/shadow-init.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import { findRepoRoot, runNode, type RunResult } from '../../../tools/test-support/process.js';
import { MIGRATOR, PlatformPostgres } from '../harness/postgres.js';

const repoRoot = findRepoRoot();
const prismaCli = `${repoRoot}/tools/deps/prisma-cli.mjs`;
const SHADOW_DB = 'shadow_init';
const RAW_DB = 'shadow_raw';
const PARTITION = /^audit_entries_\d{4}_\d{2}$/;

let pgh: PlatformPostgres | undefined;
let deployedDb = '';
let firstDeploy: RunResult | undefined;

const cluster = (): PlatformPostgres => {
  if (pgh === undefined) throw new Error('PostgreSQL container not started');
  return pgh;
};
const tail = (result: RunResult): string => `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-30).join('\n');

async function withClient<T>(config: pg.ClientConfig | Promise<pg.Client>, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = config instanceof Promise ? await config : new pg.Client(config);
  if (!(config instanceof Promise)) await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** SQLSTATE and message of a failed query (pg errors are not `instanceof Error` under Jest VM modules). */
async function failure(run: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    return { ...(typeof e.code === 'string' ? { code: e.code } : {}), message: typeof e.message === 'string' ? e.message : '' };
  }
  return { message: 'no error' };
}

/** The Prisma CLI with the ROOT config, as the migrator, with SHADOW_DATABASE_URL set (the harness unsets it). */
function prismaWithShadow(args: readonly string[]): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_MIGRATOR_URL: cluster().migratorUrl(deployedDb),
    SHADOW_DATABASE_URL: cluster().migratorUrl(SHADOW_DB),
  };
  return withFileLock(PRISMA_TREE_LOCK, () => runNode([prismaCli, ...args], { cwd: repoRoot, env, timeoutMs: 180_000 }));
}

const DIFF = ['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema', '--script'];

beforeAll(async () => {
  pgh = await PlatformPostgres.start();
  deployedDb = await pgh.clone(await pgh.template({ migrated: false }));
  firstDeploy = await pgh.prisma(deployedDb, ['migrate', 'deploy']);
  await withClient(pgh.superuser('postgres'), async (admin) => {
    for (const name of [SHADOW_DB, RAW_DB]) await admin.query(`CREATE DATABASE ${quoteIdentifier(name)} OWNER ${MIGRATOR}`);
  });
}, 400_000);

afterAll(async () => {
  await pgh?.stop();
}, 120_000);

describe('the first deploy after the full bootstrap lane (SPK-08 F-01)', () => {
  it('[SPK-08 F-01] the first migrate deploy after 10-audit.sql created partitions succeeds (no P3005: the partitions are in tables.external)', async () => {
    const partitions = await withClient(cluster().superuser(deployedDb), async (client) => {
      const { rows } = await client.query<{ relname: string }>(
        `SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_inherits i ON i.inhrelid = c.oid
          WHERE i.inhparent = 'public.audit_entries'::pg_catalog.regclass`,
      );
      return rows.map((row) => row.relname);
    });
    // Non-vacuous: the audit store and its partitions exist before the deploy (P3005 premise).
    expect(partitions.length).toBeGreaterThanOrEqual(4);
    expect(partitions.every((name) => PARTITION.test(name))).toBe(true);
    const deploy = firstDeploy;
    if (deploy === undefined) throw new Error('first deploy did not run');
    expect({ status: deploy.status, p3005: tail(deploy).includes('P3005'), tail: tail(deploy) }).toMatchObject({ status: 0, p3005: false });
    const status = await cluster().prisma(deployedDb, ['migrate', 'status']);
    expect({ status: status.status, tail: tail(status) }).toMatchObject({ status: 0 });
  });
});

describe('migrations.initShadowDb of the root config (SPK-08 F-02/F-03)', () => {
  it('[SPK-08 F-02] two consecutive migrate diff runs against the same shadow database succeed; the diff touches no bootstrap-lane object', async () => {
    const first = await prismaWithShadow(DIFF);
    expect({ status: first.status, tail: tail(first) }).toMatchObject({ status: 0 });
    const second = await prismaWithShadow(DIFF);
    expect({ status: second.status, tail: tail(second) }).toMatchObject({ status: 0 });
    expect(second.stdout).not.toMatch(/audit|platform|extension|bootstrap_migrations|schema/i);

    const shadow = await withClient(cluster().migratorConnection(SHADOW_DB), async (client) => ({
      extensions: (
        await client.query<{ extname: string }>(`SELECT extname FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`)
      ).rows.map((row) => row.extname),
      platformOwner: (
        await client.query<{ owner: string }>(
          `SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace WHERE nspname = 'platform'`,
        )
      ).rows[0]?.owner,
      relations: (
        await client.query<{ relname: string }>(
          `SELECT relname FROM pg_catalog.pg_class WHERE relnamespace = 'public'::pg_catalog.regnamespace AND relkind IN ('r', 'p') ORDER BY 1`,
        )
      ).rows.map((row) => row.relname),
      functions: (
        await client.query<{ proname: string }>(
          `SELECT proname FROM pg_catalog.pg_proc WHERE pronamespace = 'platform'::pg_catalog.regnamespace ORDER BY 1`,
        )
      ).rows.map((row) => row.proname),
    }));
    // The shadow database really received the rendered lane (Prisma leaves it there) as migrator-owned objects.
    expect(shadow.extensions).toEqual(['btree_gin', 'btree_gist', 'pg_trgm']);
    expect(shadow.platformOwner).toBe(MIGRATOR);
    expect(shadow.relations).toEqual(expect.arrayContaining(['audit_entries', 'audit_partitions', 'audit_pii_vault', 'data_subjects']));
    expect(shadow.relations.some((name) => PARTITION.test(name))).toBe(true);
    expect(shadow.relations).toEqual(expect.arrayContaining(['permissions', 'role_permissions', 'roles']));
    expect(shadow.functions).toEqual(expect.arrayContaining(['audit_forbid_mutation', 'ensure_audit_partitions']));
    expect(shadow.functions).not.toContain('audit_ddl_guard');
  }, 400_000);
});

describe('the rendering run directly (F-02 negative control; PR12-SEC-07)', () => {
  const lane = readBootstrapLane();
  /** Prisma's shadow reset: only `public` is emptied (SPK-08 F-02). */
  const resetPublic = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public';

  it('[SPK-08 F-02] negative control: without the DROP SCHEMA line the second run fails with "already exists"; with it, it succeeds', async () => {
    const withDrop = renderShadowInit(lane).sql;
    const noDrop = renderShadowInit(lane, { dropSchemas: false }).sql;
    const outcome = await withClient(cluster().migratorConnection(RAW_DB), async (client) => {
      await client.query(noDrop);
      await client.query(resetPublic);
      const refused = await failure(() => client.query(noDrop));
      await client.query(resetPublic);
      await client.query(withDrop);
      await client.query(resetPublic);
      const repeated = await failure(() => client.query(withDrop));
      return { refused, repeated };
    });
    expect(outcome.refused.message).toContain('already exists');
    expect(outcome.repeated).toEqual({ message: 'no error' });
  }, 120_000);

  it('[PR12-SEC-07] against the BOOTSTRAPPED database the migrator is refused with 42501 by the FIRST statement; platform is untouched', async () => {
    const rendered = renderShadowInit(lane).sql;
    expect(splitStatements(rendered)[0]).toBe(OWNERSHIP_GUARD);
    const refused = await withClient(cluster().migratorConnection(deployedDb), (client) => failure(() => client.query(rendered)));
    expect(refused).toEqual({ code: '42501', message: expect.stringContaining('shadow init refused: the current database is not owned') });
    const platform = await withClient(cluster().superuser(deployedDb), async (client) => ({
      owner: (
        await client.query<{ owner: string }>(
          `SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace WHERE nspname = 'platform'`,
        )
      ).rows[0]?.owner,
      guard: (await client.query(`SELECT FROM pg_catalog.pg_proc WHERE proname = 'audit_ddl_guard'`)).rowCount,
    }));
    expect(platform).toEqual({ owner: 'platform_schema_owner', guard: 1 });
  });

  it('[PR12-SEC-07] a migrator-OWNED database whose public is not empty (a developer database) is refused with 42501 too', async () => {
    const rendered = renderShadowInit(lane).sql;
    const refused = await withClient(cluster().migratorConnection(RAW_DB), async (client) => {
      await client.query('CREATE TABLE public.developer_table (id integer)');
      return failure(() => client.query(rendered));
    });
    expect(refused).toEqual({ code: '42501', message: expect.stringContaining('shadow init refused: public is not empty') });
  });
});
