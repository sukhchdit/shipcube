/**
 * Idempotent reference and demo seed framework on PostgreSQL 18 (TASK-023, US-049; data-model §9, REQ-DATA-001/002).
 * The framework runs as `platform_migrator` against the really migrated schema. A TEST-ONLY probe table
 * (`seed_probe_countries`, standard columns + `code` unique + `name_en` + `source`) carries a fixture dataset, because
 * the real reference datasets arrive with later tasks. The CLI suite spawns the real entry point with explicit env.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import {
  SeedRefusedError,
  type ConfigChange,
  type ConfigChangeSink,
  type Dataset,
  type SeedLogger,
} from '../../seed/framework/contracts.js';
import { runReferenceSeed, type ReferenceSeedResult } from '../../seed/framework/runner.js';
import { REFERENCE_STEPS } from '../../seed/reference/index.js';
import { DEMO_USERS } from '../../seed/demo/index.js';
import { main } from '../../seed/index.js';
import { findRepoRoot, runNode } from '../../../tools/test-support/process.js';
import { PlatformPostgres } from '../harness/postgres.js';

const repoRoot = findRepoRoot();
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const ROWS = 1_100;

let db: PlatformPostgres;
let template: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  template = await db.template({ migrated: true });
}, 300_000);

afterAll(async () => {
  await db?.stop();
});

const silent: SeedLogger = { info: () => undefined, warn: () => undefined };

function recordingSink(): ConfigChangeSink & { changes: ConfigChange[] } {
  const changes: ConfigChange[] = [];
  return {
    changes,
    configChanged: (_sql, change) => {
      changes.push(change);
      return Promise.resolve();
    },
  };
}

async function withClient<T>(config: pg.ClientConfig, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A migrated database clone with the two test-only probe tables (never part of a migration). */
async function freshDatabase(): Promise<string> {
  const database = await db.clone(template);
  await withClient(db.migratorConnection(database), async (client) => {
    for (const table of ['seed_probe_countries', 'seed_probe_rates']) {
      await client.query(`CREATE TABLE public.${table} (
        id uuid NOT NULL DEFAULT uuidv7() PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NOT NULL,
        updated_by uuid NOT NULL,
        version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
        code text NOT NULL UNIQUE,
        name_en text NOT NULL,
        source text NOT NULL CHECK (source IN ('ISO', 'SEED', 'SAMPLE'))
      )`);
    }
  });
  return database;
}

const probe = (count: number, overrides: Partial<Dataset> = {}): Dataset => ({
  name: 'probe_countries',
  version: '1',
  table: 'public.seed_probe_countries',
  naturalKey: ['code'],
  columns: ['code', 'name_en', 'source'],
  rows: Array.from({ length: count }, (_, index) => ({
    code: `P${String(index).padStart(5, '0')}`,
    name_en: `Probe ${String(index)}`,
    source: 'SEED',
  })),
  ...overrides,
});

const published = (names: readonly string[], version = '1'): Dataset => ({
  name: 'probe_rates',
  version,
  table: 'public.seed_probe_rates',
  naturalKey: ['code'],
  columns: ['code', 'name_en', 'source'],
  rows: names.map((name, index) => ({ code: `R${String(index)}`, name_en: name, source: 'SEED' })),
  insertOnly: true,
});

async function seed(
  database: string,
  datasets: readonly Dataset[],
  configChanges: ConfigChangeSink = recordingSink(),
): Promise<ReferenceSeedResult> {
  return withClient(db.migratorConnection(database), (client) =>
    runReferenceSeed({ sql: client, datasets, steps: REFERENCE_STEPS, logger: silent, configChanges }),
  );
}

/** Rows plus the physical row version (`xmin`): any write, however small, changes it. */
const stamp = (client: pg.Client, table: string) =>
  client.query<{ code: string; name_en: string; source: string; xmin: string; updated_at: Date; version: number }>(
    `SELECT code, name_en, source, xmin::text AS xmin, updated_at, version FROM public.${table} ORDER BY code`,
  );

const versionRows = (client: pg.Client) =>
  client.query<{ dataset: string; dataset_version: string; xmin: string; applied_at: Date; row_count: number; version: number }>(
    'SELECT dataset, dataset_version, xmin::text AS xmin, applied_at, row_count, version FROM public.reference_dataset_versions ORDER BY dataset',
  );

const authzStamp = async (client: pg.Client): Promise<string[][]> => {
  const stamps: string[][] = [];
  for (const table of ['permissions', 'roles', 'role_permissions']) {
    const result = await client.query<{ stamp: string }>(`SELECT id::text || ':' || xmin::text AS stamp FROM public.${table} ORDER BY id`);
    stamps.push(result.rows.map((row) => row.stamp));
  }
  return stamps;
};

async function refusal(run: Promise<unknown>): Promise<SeedRefusedError> {
  const error = await run.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof SeedRefusedError)) throw new Error('expected a SeedRefusedError');
  return error;
}

describe('reference seed framework (US-049)', () => {
  it('[AT-US-049-01] running the seed twice gives identical counts, every row has a source, and the second run writes nothing', async () => {
    const database = await freshDatabase();
    const first = await seed(database, [probe(ROWS)]);
    expect(first.datasets).toMatchObject([{ dataset: 'probe_countries', status: 'applied', inserted: ROWS, updated: 0, rowCount: ROWS }]);
    expect(first.steps).toEqual(['authz-parity']);

    const [afterFirst, versionsFirst] = await withClient(db.migratorConnection(database), async (client) => [
      (await stamp(client, 'seed_probe_countries')).rows,
      (await versionRows(client)).rows,
    ]);
    expect(afterFirst).toHaveLength(ROWS);
    expect(afterFirst.every((row) => row.source === 'SEED')).toBe(true);
    expect(versionsFirst).toMatchObject([{ dataset: 'probe_countries', dataset_version: '1', row_count: ROWS, version: 1 }]);

    const second = await seed(database, [probe(ROWS)]);
    expect(second.datasets).toMatchObject([{ status: 'unchanged', inserted: 0, updated: 0, rowCount: ROWS }]);

    const [afterSecond, versionsSecond] = await withClient(db.migratorConnection(database), async (client) => [
      (await stamp(client, 'seed_probe_countries')).rows,
      (await versionRows(client)).rows,
    ]);
    // Same xmin and updated_at for every row and for the version row: nothing was written.
    expect(afterSecond).toEqual(afterFirst);
    expect(versionsSecond).toEqual(versionsFirst);
  }, 120_000);

  it('[AT-US-049-08] a manually changed seeded row is restored by the next run, with no duplicate row', async () => {
    const database = await freshDatabase();
    await seed(database, [probe(20)]);
    const before = await withClient(db.migratorConnection(database), async (client) => {
      await client.query(`UPDATE public.seed_probe_countries SET name_en = 'tampered' WHERE code = 'P00003'`);
      return (await stamp(client, 'seed_probe_countries')).rows;
    });
    expect(before.find((row) => row.code === 'P00003')?.name_en).toBe('tampered');

    const result = await seed(database, [probe(20)]);
    expect(result.datasets).toMatchObject([{ status: 'applied', inserted: 0, updated: 1 }]);

    const after = await withClient(db.migratorConnection(database), async (client) => (await stamp(client, 'seed_probe_countries')).rows);
    expect(after).toHaveLength(20);
    expect(after.find((row) => row.code === 'P00003')).toMatchObject({ name_en: 'Probe 3', version: 2 });
    // Only the drifted row was written.
    expect(after.filter((row) => row.xmin !== before.find((b) => b.code === row.code)?.xmin).map((row) => row.code)).toEqual(['P00003']);
  }, 120_000);

  it('a drift restore of an audited dataset reports one drift-restored change and leaves the version row alone (m5)', async () => {
    const database = await freshDatabase();
    const sink = recordingSink();
    const audited = probe(10, { audited: true });
    await seed(database, [audited], sink);
    const versionsBefore = await withClient(db.migratorConnection(database), async (client) => {
      await client.query(`UPDATE public.seed_probe_countries SET name_en = 'tampered' WHERE code IN ('P00001', 'P00007')`);
      return (await versionRows(client)).rows;
    });

    const result = await seed(database, [audited], sink);
    expect(result.datasets).toMatchObject([{ status: 'applied', inserted: 0, updated: 2 }]);
    expect(sink.changes.map((change) => change.kind)).toEqual(['version', 'drift-restored']);
    expect(sink.changes[1]).toMatchObject({ dataset: 'probe_countries', version: '1', restoredRows: 2 });
    expect(await withClient(db.migratorConnection(database), async (client) => (await versionRows(client)).rows)).toEqual(versionsBefore);

    await seed(database, [audited], sink);
    expect(sink.changes).toHaveLength(2);

    // R2-m1: a row deleted by hand is re-inserted by the next run and reported as a drift restore too.
    await withClient(db.migratorConnection(database), async (client) => {
      await client.query(`DELETE FROM public.seed_probe_countries WHERE code = 'P00004'`);
    });
    const reinserted = await seed(database, [audited], sink);
    expect(reinserted.datasets).toMatchObject([{ status: 'applied', inserted: 1, updated: 0 }]);
    expect(sink.changes).toHaveLength(3);
    expect(sink.changes[2]).toMatchObject({ kind: 'drift-restored', dataset: 'probe_countries', version: '1', restoredRows: 1 });
    expect(await withClient(db.migratorConnection(database), async (client) => (await versionRows(client)).rows)).toEqual(versionsBefore);
    const restored = await withClient(db.migratorConnection(database), async (client) => (await stamp(client, 'seed_probe_countries')).rows);
    expect(restored).toHaveLength(10);
    expect(restored.find((row) => row.code === 'P00004')).toMatchObject({ name_en: 'Probe 4' });
  }, 120_000);

  it('two concurrent seeds queue on the advisory lock: one applies, the other finds nothing to do (n8)', async () => {
    const database = await freshDatabase();
    const results = await Promise.all([seed(database, [probe(300)]), seed(database, [probe(300)])]);
    expect(results.map((result) => result.datasets[0]?.status).sort()).toEqual(['applied', 'unchanged']);
    expect(results.map((result) => result.datasets[0]?.inserted).sort()).toEqual([0, 300]);
    const rows = await withClient(db.migratorConnection(database), async (client) => (await stamp(client, 'seed_probe_countries')).rows);
    expect(rows).toHaveLength(300);
  }, 120_000);

  it('a changed dataset version updates its rows, bumps the version row once and reports an audited change only then', async () => {
    const database = await freshDatabase();
    const sink = recordingSink();
    const audited = (version: string, rows = 5): Dataset => ({ ...probe(rows), version, audited: true });
    await seed(database, [audited('1')], sink);
    await seed(database, [audited('1')], sink);
    expect(sink.changes).toHaveLength(1);
    await seed(database, [audited('2', 6)], sink);
    expect(sink.changes.map((change) => (change.kind === 'version' ? [change.fromVersion, change.toVersion] : change.kind))).toEqual([
      [undefined, '1'],
      ['1', '2'],
    ]);
    const versions = await withClient(db.migratorConnection(database), async (client) => (await versionRows(client)).rows);
    expect(versions).toMatchObject([{ dataset_version: '2', row_count: 6, version: 2 }]);
  }, 120_000);

  it('an insert-only dataset changed in place is refused (SEED_INSERT_ONLY_CHANGED) and the whole run rolls back', async () => {
    const database = await freshDatabase();
    await seed(database, [published(['alpha', 'beta'])]);
    const snapshot = await withClient(db.migratorConnection(database), async (client) => (await stamp(client, 'seed_probe_rates')).rows);

    // New version label, new row R2 and a changed R1: the new row must not survive the refusal.
    const changed = published(['alpha', 'BETA', 'gamma'], '2');
    const error = await refusal(seed(database, [probe(3), changed]));
    expect(error).toMatchObject({ code: 'SEED_INSERT_ONLY_CHANGED', subjects: ['probe_rates'] });

    await withClient(db.migratorConnection(database), async (client) => {
      expect((await stamp(client, 'seed_probe_rates')).rows).toEqual(snapshot);
      expect((await stamp(client, 'seed_probe_countries')).rows).toEqual([]);
      expect((await versionRows(client)).rows).toMatchObject([{ dataset: 'probe_rates', dataset_version: '1' }]);
    });

    // Same version label, different content: refused up front.
    const inPlace = await refusal(seed(database, [published(['alpha', 'beta', 'gamma'])]));
    expect(inPlace.code).toBe('SEED_INSERT_ONLY_CHANGED');

    // A new version that only adds rows is the supported path.
    const added = await seed(database, [published(['alpha', 'beta', 'gamma'], '2')]);
    expect(added.datasets).toMatchObject([{ status: 'applied', inserted: 1, updated: 0 }]);
  }, 120_000);

  it('authz parity is green on the migrated database and the reference seed never writes the authz tables', async () => {
    const database = await freshDatabase();
    const before = await withClient(db.migratorConnection(database), authzStamp);
    expect(before.every((rows) => rows.length > 0)).toBe(true);
    await seed(database, [probe(10)]);
    await seed(database, [probe(10)]);
    expect(await withClient(db.migratorConnection(database), authzStamp)).toEqual(before);
  }, 120_000);

  it('authz drift is refused (SEED_AUTHZ_DRIFT) naming the link, and the run rolls back', async () => {
    const database = await freshDatabase();
    const link = await withClient(db.migratorConnection(database), async (client) => {
      const picked = await client.query<{ id: string; link: string }>(
        `SELECT rp.id::text AS id, r.key || '|' || p.key AS link FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id JOIN public.permissions p ON p.id = rp.permission_id ORDER BY r.key, p.key LIMIT 1`,
      );
      return picked.rows[0];
    });
    if (link === undefined) throw new Error('the migrated database has no role_permissions');
    const admin = await db.superuser(database);
    try {
      await admin.query('DELETE FROM public.role_permissions WHERE id = $1', [link.id]);
    } finally {
      await admin.end();
    }

    const error = await refusal(seed(database, [probe(5)]));
    expect(error).toMatchObject({ code: 'SEED_AUTHZ_DRIFT', subjects: [`link:${link.link} (missing)`] });

    await withClient(db.migratorConnection(database), async (client) => {
      expect((await stamp(client, 'seed_probe_countries')).rows).toEqual([]);
      expect((await versionRows(client)).rows).toEqual([]);
      const relinked = await client.query('SELECT 1 FROM public.role_permissions WHERE id = $1', [link.id]);
      expect(relinked.rowCount).toBe(0);
    });
  }, 120_000);

  it('platform_app may read, insert and update reference_dataset_versions and may not delete from it (data-model §4.4)', async () => {
    const database = await freshDatabase();
    await seed(database, [probe(2)]);
    await withClient(db.appConnection(database), async (client) => {
      expect((await client.query('SELECT 1 FROM public.reference_dataset_versions')).rowCount).toBe(1);
      await client.query(`UPDATE public.reference_dataset_versions SET row_count = row_count`);
      await expect(client.query('DELETE FROM public.reference_dataset_versions')).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('TRUNCATE public.reference_dataset_versions')).rejects.toMatchObject({ code: '42501' });
    });
  }, 120_000);
});

describe('seed CLI (US-049)', () => {
  const unreachableUrl = (): string => `postgresql://platform_migrator:${randomBytes(12).toString('hex')}@127.0.0.1:1/platform`;
  const localDefault = (): string => `local-only-${randomBytes(8).toString('hex')}`;
  const randomPassword = (): string => randomBytes(18).toString('base64url');

  const NODE_ENV_FOR: Record<string, string> = { local: 'development', test: 'test', staging: 'production', production: 'production' };

  function cli(command: string, env: Record<string, string | undefined>) {
    const childEnv: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
      const value = process.env[name];
      if (value !== undefined) childEnv[name] = value;
    }
    for (const [name, value] of Object.entries(env)) if (value !== undefined) childEnv[name] = value;
    return runNode([tsxCli, '--conditions=@platform/source', 'prisma/seed/index.ts', command], {
      cwd: repoRoot,
      env: childEnv,
      timeoutMs: 90_000,
    });
  }

  const events = (stdout: string): Array<Record<string, unknown>> =>
    stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  const stderrRefusal = (stderr: string): { code: string; subjects: string[] } =>
    JSON.parse(stderr.trim().split('\n').at(-1) ?? '') as { code: string; subjects: string[] };

  it('[AT-US-049-03] APP_ENV=production demo: the reference seed runs, the demo seed is skipped, exit 0', async () => {
    const database = await freshDatabase();
    const result = cli('demo', { APP_ENV: 'production', NODE_ENV: 'production', DATABASE_MIGRATOR_URL: db.migratorUrl(database) });
    expect(result.status).toBe(0);
    const lines = events(result.stdout);
    expect(lines).toContainEqual(expect.objectContaining({ event: 'seed.step', step: 'authz-parity' }));
    expect(lines).toContainEqual(expect.objectContaining({ event: 'seed.reference.done' }));
    expect(lines).toContainEqual(expect.objectContaining({ event: 'seed.demo.done', skipped: true, created: 0 }));
  }, 120_000);

  it.each([
    ['[AT-US-049-04-1]', 'test'],
    ['[AT-US-049-04-2]', 'staging'],
    ['[AT-US-049-04-3]', 'production'],
  ])(
    '%s APP_ENV=%s with a local-only SEED_SUPERADMIN_PASSWORD is refused before any connection (exit 1, variable named, value never printed)',
    async (_id, appEnv) => {
      const database = await freshDatabase();
      const secret = localDefault();
      const result = cli('demo', {
        APP_ENV: appEnv,
        NODE_ENV: NODE_ENV_FOR[appEnv],
        // Unreachable: a refusal that connected first would exit 2 instead of 1.
        DATABASE_MIGRATOR_URL: unreachableUrl(),
        SEED_SUPERADMIN_PASSWORD: secret,
        ...(appEnv === 'test' ? { SEED_CUSTOMER_PASSWORD: randomPassword() } : {}),
      });
      expect(result.status).toBe(1);
      const refused = stderrRefusal(result.stderr);
      expect(refused.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
      expect(refused.subjects).toEqual(['SEED_SUPERADMIN_PASSWORD']);
      expect(result.stdout + result.stderr).not.toContain(secret);
      await withClient(db.migratorConnection(database), async (client) => {
        expect((await versionRows(client)).rows).toEqual([]);
      });
    },
    120_000,
  );

  it('[AT-US-049-06] APP_ENV=local with SEED_CUSTOMER_PASSWORD unset is refused naming the variable (exit 1)', () => {
    const secret = localDefault();
    const result = cli('demo', { APP_ENV: 'local', DATABASE_MIGRATOR_URL: unreachableUrl(), SEED_SUPERADMIN_PASSWORD: secret });
    expect(result.status).toBe(1);
    expect(stderrRefusal(result.stderr)).toEqual({
      level: 'error',
      event: 'seed.refused',
      code: 'SEED_VARIABLE_MISSING',
      subjects: ['SEED_CUSTOMER_PASSWORD'],
    });
    expect(result.stdout + result.stderr).not.toContain(secret);
  }, 120_000);

  it('[AT-US-049-07] a local demo run prints neither seed password nor the database password', async () => {
    const database = await freshDatabase();
    const superadmin = localDefault();
    const customer = localDefault();
    const result = cli('demo', {
      APP_ENV: 'local',
      DATABASE_MIGRATOR_URL: db.migratorUrl(database),
      SEED_SUPERADMIN_PASSWORD: superadmin,
      SEED_CUSTOMER_PASSWORD: customer,
    });
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    for (const secret of [superadmin, customer, db.passwords.migrator]) expect(output).not.toContain(secret);
    expect(events(result.stdout)).toContainEqual(expect.objectContaining({ event: 'seed.demo.done', skipped: false }));
  }, 120_000);

  it('[AT-US-049-05] in-process main: a local demo run with local-only defaults reaches every demo user (deferred until TASK-089)', async () => {
    const database = await freshDatabase();
    const lines: string[] = [];
    const errors: string[] = [];
    const env = {
      APP_ENV: 'local',
      DATABASE_MIGRATOR_URL: db.migratorUrl(database),
      SEED_SUPERADMIN_PASSWORD: localDefault(),
      SEED_CUSTOMER_PASSWORD: localDefault(),
    };
    const status = await main(['demo'], env, { out: (line) => lines.push(line), err: (line) => errors.push(line) });
    expect({ status, errors }).toEqual({ status: 0, errors: [] });
    expect(events(lines.join('\n'))).toContainEqual(
      expect.objectContaining({ event: 'seed.demo.done', skipped: false, created: 0, deferred: DEMO_USERS.length }),
    );
  }, 120_000);

  it('the session stays pinned when the migrator role defaults to search_path=public (PR13-SEC-03)', async () => {
    const database = await freshDatabase();
    const admin = await db.superuser(database);
    try {
      // Database-scoped, so no other suite's sessions are affected.
      await admin.query(`ALTER ROLE platform_migrator IN DATABASE "${database}" SET search_path = public`);
    } finally {
      await admin.end();
    }
    const lines: string[] = [];
    const errors: string[] = [];
    const status = await main(
      ['reference'],
      { APP_ENV: 'local', DATABASE_MIGRATOR_URL: db.migratorUrl(database) },
      {
        out: (line) => lines.push(line),
        err: (line) => errors.push(line),
      },
    );
    expect({ status, errors }).toEqual({ status: 0, errors: [] });
    expect(events(lines.join('\n'))).toContainEqual(expect.objectContaining({ event: 'seed.reference.done' }));
  }, 120_000);

  it('a URL that overrides the pinned session is refused before connecting (exit 1, value never printed; PR13-SEC-03)', async () => {
    const database = await freshDatabase();
    for (const query of ['?options=-c%20search_path%3Dpublic', '?statement_timeout=0', '?host=127.0.0.1']) {
      const lines: string[] = [];
      const errors: string[] = [];
      const status = await main(
        ['reference'],
        { APP_ENV: 'local', DATABASE_MIGRATOR_URL: `${db.migratorUrl(database)}${query}` },
        {
          out: (line) => lines.push(line),
          err: (line) => errors.push(line),
        },
      );
      expect(status).toBe(1);
      expect(stderrRefusal(errors.join('\n'))).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects: ['DATABASE_MIGRATOR_URL'] });
      expect([...lines, ...errors].join('\n')).not.toContain(db.passwords.migrator);
    }
    await withClient(db.migratorConnection(database), async (client) => {
      expect((await versionRows(client)).rows).toEqual([]);
    });
  }, 120_000);

  it('the reference command runs the seed once and again with the same outcome (db:seed twice, exit 0)', async () => {
    const database = await freshDatabase();
    const env = { APP_ENV: 'local', DATABASE_MIGRATOR_URL: db.migratorUrl(database) };
    expect(cli('reference', env).status).toBe(0);
    const second = cli('reference', env);
    expect(second.status).toBe(0);
    expect(events(second.stdout)).toContainEqual(expect.objectContaining({ event: 'seed.reference.done', applied: 0 }));
  }, 120_000);

  it('refuses a missing or unknown APP_ENV and a missing DATABASE_MIGRATOR_URL with exit 1, and bad usage with exit 2', () => {
    expect(stderrRefusal(cli('reference', { DATABASE_MIGRATOR_URL: unreachableUrl() }).stderr)).toMatchObject({
      code: 'SEED_ENVIRONMENT_INVALID',
      subjects: ['APP_ENV'],
    });
    expect(cli('reference', { APP_ENV: 'prod', DATABASE_MIGRATOR_URL: unreachableUrl() }).status).toBe(1);
    const missingUrl = cli('reference', { APP_ENV: 'local' });
    expect(missingUrl.status).toBe(1);
    expect(stderrRefusal(missingUrl.stderr)).toMatchObject({ code: 'SEED_VARIABLE_MISSING', subjects: ['DATABASE_MIGRATOR_URL'] });
    expect(cli('bogus', { APP_ENV: 'local' }).status).toBe(2);
  }, 120_000);

  it('an unreachable database is an unexpected error (exit 2) that never echoes the connection URL', () => {
    const url = unreachableUrl();
    const password = new URL(url).password;
    const result = cli('reference', { APP_ENV: 'local', DATABASE_MIGRATOR_URL: url });
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain(url);
    expect(JSON.parse(result.stderr.trim().split('\n').at(-1) ?? '')).toMatchObject({ level: 'error', event: 'seed.failed' });
  }, 120_000);
});
