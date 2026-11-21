/**
 * `db:verify-restore` (data-model.md §8.6 steps 4-6; NT-REC-003-a, NT-DATA-004-c; SPK-08 F-01; TASK-034): the scratch
 * database lifecycle, the verdict, the rehearsal record it writes and the CLI. Fakes stand in for PostgreSQL; the
 * PostgreSQL 18 run is prisma/tests/migrations/backup-restore.int.test.ts.
 */
import type { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { BACKUP_FILES } from './backup.js';
import { REPO_ROOT } from './lint-migrations.js';
import { LOAD_TIME_CODE_SQL, type LoadTimeCodeRow } from './load-time-code.js';
import type { ArchiveTool } from './pg-archive.js';
import {
  CLUSTER_IDENTIFIER_SQL,
  FOREIGN_KEYS_SQL,
  MIGRATION_HEAD_SQL,
  MIGRATION_TABLE_SQL,
  SEQUENCES_SQL,
  TABLES_SQL,
  captureManifest,
  manifestSha256,
  type BackupManifest,
} from './rehearsal-manifest.js';
import type { ClosableSession } from './rehearsal-cli.js';
import { RECORD_FILE, rehearsalProblems } from './rehearsal-record.js';
import { sha256Hex } from './rehearsal-manifest.js';
import { normaliseSchemaDump, type PrismaRun } from './up-down-up.js';
import {
  APPLIED_CHECKSUM_SQL,
  REPORT_FILE,
  VERIFY_RESTORE_DEPENDENCIES,
  main,
  prismaMigrate,
  prismaStatus,
  runVerifyRestore,
  writeRehearsalRecord,
  type RestoreReport,
  type VerifyRestoreDependencies,
  type VerifyRestoreOptions,
} from './verify-restore.js';

/** Yields once, as a real database or process call would. */
const tick = (): Promise<void> => Promise.resolve();

const work = mkdtempSync(join(tmpdir(), 'verify-restore-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const HEAD = '20261119000000_job_executions';
const SCHEMA = 'CREATE TABLE public.a (id integer);';
/** What backup.ts stores and digests (normaliseSchemaDump of the pg_dump text). */
const NORMALISED = normaliseSchemaDump(SCHEMA);
const NOW = new Date('2026-11-21T10:05:00.000Z');
const UP_TO_DATE: PrismaRun = { status: 0, stdout: '7 migrations found\nDatabase schema is up to date!\n', stderr: '' };
/** Prisma 7.10 `migrate status` on a database one migration behind: the databaseIsBehind branch, process.exit(1). */
const BEHIND: PrismaRun = {
  status: 1,
  stdout: '8 migrations found in prisma/migrations\nFollowing migration have not yet been applied:\n20261121000000_backfill\n',
  stderr: '',
};
const APPLIED: PrismaRun = {
  status: 0,
  stdout: 'Applying migration `20261121000000_backfill`\nAll migrations have been successfully applied.\n',
  stderr: '',
};

interface DatabaseState {
  rows: string;
  orphans: string;
  head: string | null;
  /** `system_identifier` of the fake's cluster (default: the source cluster, SOURCE_CLUSTER). */
  cluster?: string;
  /** `_prisma_migrations.checksum` of the rehearsed migration after the deploy (R2-m1); no row when undefined. */
  checksum?: string;
  /** Rows of the C17 query (D-ARCH-236). */
  loadTime?: readonly LoadTimeCodeRow[];
}

/** The cluster the source manifests are taken on, and the second, fresh cluster a restore goes to (D-ARCH-235). */
const SOURCE_CLUSTER = '7300000000000000001';
const TARGET_CLUSTER = '7300000000000000002';
/** The migration.sql text of the data-changing migration these tests rehearse, and Prisma's checksum of it. */
const MIGRATION_TEXT = '-- migration-kind: migrate\n-- data-changing: yes\n-- reversible: yes\nSELECT 1;\n';
const CHECKSUM = sha256Hex(MIGRATION_TEXT);
/** A C17 finding: a CHECK that calls a migration routine. */
const PLANTED: LoadTimeCodeRow = {
  kind: 'table check',
  object: 'public.a ck_a__probe',
  via: 'call',
  reference: 'public.zz_record(integer)',
  reason: 'not built in',
};

/** A session over one fake database; every statement is recorded. */
function database(state: DatabaseState, log: string[]): ClosableSession {
  return {
    async query<T extends object>(sql: string): Promise<T[]> {
      await tick();
      log.push(sql);
      const rows = (): object[] => {
        if (sql === TABLES_SQL) return [{ schema: 'public', name: 'a' }];
        if (sql.includes('AS rows')) return [{ rows: state.rows, checksum: state.rows === '0' ? '0' : '99' }];
        if (sql === SEQUENCES_SQL) return [];
        if (sql === MIGRATION_TABLE_SQL) return [{ present: state.head !== null }];
        if (sql === MIGRATION_HEAD_SQL) return [{ migration_name: state.head }];
        if (sql === FOREIGN_KEYS_SQL) {
          return [
            {
              name: 'fk',
              child_schema: 'public',
              child_table: 'b',
              parent_schema: 'public',
              parent_table: 'a',
              child_columns: ['a_id'],
              parent_columns: ['id'],
              operators: ['='],
              operator_schemas: ['pg_catalog'],
            },
          ];
        }
        if (sql.includes('AS orphans')) return [{ orphans: state.orphans }];
        if (sql.startsWith('SELECT 1 FROM pg_catalog.pg_database')) return log.includes('EXISTS') ? [{}] : [];
        if (sql === CLUSTER_IDENTIFIER_SQL) return [{ system_identifier: state.cluster ?? SOURCE_CLUSTER }];
        if (sql === LOAD_TIME_CODE_SQL) return [...(state.loadTime ?? [])];
        if (sql === APPLIED_CHECKSUM_SQL) return state.checksum === undefined ? [] : [{ checksum: state.checksum }];
        return [];
      };
      return rows() as T[];
    },
    async end() {
      await tick();
      log.push('end');
    },
  };
}

async function sourceManifest(state: DatabaseState = { rows: '3', orphans: '0', head: HEAD }): Promise<BackupManifest> {
  return captureManifest(database(state, []), {
    database: 'platform',
    takenAt: '2026-11-21T10:00:00.000Z',
    schema: NORMALISED,
    sequences: [],
  });
}

function setup(restored: DatabaseState, overrides: Partial<VerifyRestoreOptions> = {}) {
  const admin: string[] = [];
  const scratch: string[] = [];
  const steps: string[] = [];
  const archive: ArchiveTool = {
    async dump() {
      await tick();
      throw new Error('not used');
    },
    async dumpSchema({ database: name }) {
      await tick();
      steps.push(`schema ${name}`);
      return SCHEMA;
    },
    async restore({ database: name, archive: path }) {
      await tick();
      steps.push(`restore ${name} ${path}`);
    },
  };
  const options = async (): Promise<VerifyRestoreOptions> => ({
    manifest: await sourceManifest(),
    sourceSchema: NORMALISED,
    scratchDatabase: 'rehearsal_t1',
    archivePath: '/backup/platform.dump',
    archive,
    admin: () => Promise.resolve(database({ cluster: TARGET_CLUSTER, ...restored }, admin)),
    scratch: () => Promise.resolve(database({ cluster: TARGET_CLUSTER, ...restored }, scratch)),
    prepareScratch: async () => {
      await tick();
      steps.push('00-roles.sql');
    },
    migrateStatus: async () => {
      await tick();
      steps.push('migrate status');
      return UP_TO_DATE;
    },
    now: () => NOW,
    clock: (() => {
      let tick = 0;
      return () => (tick += 250);
    })(),
    ...overrides,
  });
  return { admin, scratch, steps, options };
}

describe('runVerifyRestore', () => {
  it('[NT-REC-003-a] creates the scratch database from template0, runs 00-roles.sql, restores, verifies and drops it: PASS', async () => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD });
    const report = await runVerifyRestore(await run.options());
    expect(run.admin.filter((sql) => sql !== 'end')).toEqual([
      CLUSTER_IDENTIFIER_SQL, // D-ARCH-235: the target is read before CREATE DATABASE
      'SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1',
      'CREATE DATABASE "rehearsal_t1" TEMPLATE template0',
      'DROP DATABASE IF EXISTS "rehearsal_t1" WITH (FORCE)',
    ]);
    expect(run.steps).toEqual(['00-roles.sql', 'restore rehearsal_t1 /backup/platform.dump', 'schema rehearsal_t1', 'migrate status']);
    expect(report).toMatchObject({
      verdict: 'pass',
      target: { sameCluster: false },
      scratchDatabase: 'rehearsal_t1',
      scratchKept: false,
      restoreMs: 250,
      verifiedAt: NOW.toISOString(),
      totals: { tables: 1, rows: '3' },
      differences: [],
      orphans: [],
      schemaDiff: { onlyBefore: [], onlyAfter: [] },
      migrateStatus: { ok: true, detail: 'up to date' },
    });
    expect(report.source.manifestSha256).toBe(manifestSha256(await sourceManifest()));
  });

  it('[NT-REC-003-a] FAIL on a row-count difference, an orphan and a migrate status that is not up to date; the scratch database is still dropped', async () => {
    const run = setup(
      { rows: '2', orphans: '4', head: HEAD },
      { migrateStatus: () => Promise.resolve({ status: 1, stdout: 'Following migration have not yet been applied:\nx', stderr: '' }) },
    );
    const report = await runVerifyRestore(await run.options());
    expect(report.verdict).toBe('fail');
    expect(report.differences).toEqual(['table public.a: 3 rows expected, 2 restored']);
    expect(report.orphans).toEqual([{ constraint: 'fk', table: 'public.b', orphans: '4' }]);
    expect(report.migrateStatus).toEqual({
      ok: false,
      detail: 'exit 1: no recognised output', // PR034-SEC-03: no free text of the output is kept
      pending: [], // `x` is not a migration name
      failed: [],
    });
    expect(run.admin).toContain('DROP DATABASE IF EXISTS "rehearsal_t1" WITH (FORCE)');
  });

  it('keeps the scratch database with keepScratch, and drops it when the restore throws', async () => {
    const kept = setup({ rows: '3', orphans: '0', head: HEAD }, { keepScratch: true });
    expect((await runVerifyRestore(await kept.options())).scratchKept).toBe(true);
    expect(kept.admin.some((sql) => sql.startsWith('DROP'))).toBe(false);
    const broken = setup({ rows: '3', orphans: '0', head: HEAD });
    const options = await broken.options();
    await expect(
      runVerifyRestore({
        ...options,
        archive: { ...options.archive, restore: async () => Promise.reject(new Error('pg_restore exited with 1')) },
      }),
    ).rejects.toThrow(/pg_restore exited/);
    expect(broken.admin).toContain('DROP DATABASE IF EXISTS "rehearsal_t1" WITH (FORCE)');
  });

  it('refuses an existing scratch database (never reused), the source database itself and a name that is not plain', async () => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD });
    run.admin.push('EXISTS');
    await expect(runVerifyRestore(await run.options())).rejects.toThrow(/database rehearsal_t1 exists/);
    expect(run.admin.some((sql) => sql.startsWith('CREATE') || sql.startsWith('DROP'))).toBe(false);
    await expect(runVerifyRestore({ ...(await run.options()), scratchDatabase: 'platform' })).rejects.toThrow(
      /must not be the backed-up database/,
    );
    await expect(runVerifyRestore({ ...(await run.options()), scratchDatabase: 'x;drop' })).rejects.toThrow(/plain lower-case/);
  });

  it('[TASK-034 R1-M1] a backup one migration behind: status alone fails (exit 1, databaseIsBehind); deploy first, then status, passes', async () => {
    let deployed = false;
    const status = async (): Promise<PrismaRun> => {
      await tick();
      return deployed ? UP_TO_DATE : BEHIND;
    };
    const behind = setup({ rows: '3', orphans: '0', head: HEAD }, { migrateStatus: status });
    const without = await runVerifyRestore(await behind.options());
    expect(without.verdict).toBe('fail');
    expect(without.migrateDeploy).toBeNull();
    expect(without.migrateStatus).toEqual({
      ok: false,
      detail: 'exit 1: pending 20261121000000_backfill',
      pending: ['20261121000000_backfill'],
      failed: [],
    });
    const rehearsed = setup(
      { rows: '3', orphans: '0', head: HEAD },
      {
        migrateStatus: status,
        migrateDeploy: async () => {
          await tick();
          rehearsed.steps.push('migrate deploy');
          deployed = true;
          return APPLIED;
        },
      },
    );
    const report = await runVerifyRestore(await rehearsed.options());
    expect(report).toMatchObject({ verdict: 'pass', migrateDeploy: { ok: true, detail: 'applied' }, migrateStatus: { ok: true } });
    // The comparison reads the restored data as backed up: the deploy runs after it.
    expect(rehearsed.steps).toEqual([
      '00-roles.sql',
      'restore rehearsal_t1 /backup/platform.dump',
      'schema rehearsal_t1',
      'migrate deploy',
    ]);
  });

  it('[TASK-034 R1-M1] a failed deploy fails the verification even when the status is then up to date', async () => {
    const run = setup(
      { rows: '3', orphans: '0', head: HEAD },
      { migrateDeploy: () => Promise.resolve({ status: 1, stdout: '', stderr: 'Error: P3018 A migration failed to apply.' }) },
    );
    const report = await runVerifyRestore(await run.options());
    expect(report.verdict).toBe('fail');
    expect(report.migrateDeploy).toEqual({
      ok: false,
      detail: 'exit 1: P3018',
      pending: [],
      failed: [],
    });
    expect(report.migrateStatus.ok).toBe(true);
  });

  it('[TASK-034 fc2] the real status runner reads both streams: the pending name is reported whether Prisma prints it on stdout or stderr (lane B 20261121T0711Z)', async () => {
    const banner =
      'Loaded Prisma config from prisma\\tests\\fixtures\\rehearsal\\prisma.config.ts.\n\nPrisma schema loaded from prisma\\schema.\n';
    const behindText = `${BEHIND.stdout}\nTo apply migrations in development run prisma migrate dev.\nTo apply migrations in production run prisma migrate deploy.\n`;
    const layouts = [
      { stdout: behindText, stderr: banner },
      { stdout: banner, stderr: behindText },
      { stdout: '', stderr: `${banner}${behindText}` },
    ];
    for (const layout of layouts) {
      const fake = (() => ({ status: 1, ...layout })) as unknown as typeof spawnSync;
      const run = setup(
        { rows: '3', orphans: '0', head: HEAD },
        { migrateStatus: () => Promise.resolve(prismaStatus({ DATABASE_MIGRATOR_URL: 'postgresql://m@127.0.0.1/rehearsal_t1' }, fake)) },
      );
      const report = await runVerifyRestore(await run.options());
      expect(report.verdict).toBe('fail');
      expect(report.migrateStatus.pending).toEqual(['20261121000000_backfill']);
      expect(report.migrateStatus.detail).toBe('exit 1: pending 20261121000000_backfill');
      expect(report.migrateStatus.detail).not.toMatch(/Loaded Prisma config/);
    }
  });

  it('[D-ARCH-236] the load-time gate: a manifest with a C17 finding is refused before the admin session runs anything, so no database is created', async () => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD });
    const options = await run.options();
    const manifest = {
      ...options.manifest,
      loadTimeCode: [
        { kind: 'table check', object: 'public.a ck_a__probe', reference: 'public.zz_record(integer)', reason: 'not built in' },
      ],
    };
    await expect(runVerifyRestore({ ...options, manifest })).rejects.toThrow(
      /^the load-time gate refuses this backup: 1 load-time finding\(s\): table check public\.a ck_a__probe: public\.zz_record\(integer\) \(not built in\)\. A restore would run this code as the loading superuser: remove the objects with a migration and take a new backup; never edit the manifest/,
    );
    expect(run.admin).toEqual([]);
    expect(run.steps).toEqual([]);
    // Also with --same-cluster: the gate holds in both forms.
    await expect(runVerifyRestore({ ...options, manifest, sameCluster: true })).rejects.toThrow(/load-time gate refuses/);
    expect(run.admin).toEqual([]);
  });

  it('[D-ARCH-235] the restore target: the backed-up cluster is refused without --same-cluster, before CREATE DATABASE; the switch on another cluster is refused too', async () => {
    const same = setup({ rows: '3', orphans: '0', head: HEAD, cluster: SOURCE_CLUSTER });
    await expect(runVerifyRestore(await same.options())).rejects.toThrow(
      /^the restore target is the cluster that was backed up \(same system_identifier\): restore into a second, fresh stack \(data-model 8\.6 step 4\), or pass --same-cluster on your own Compose stack with synthetic data only/,
    );
    expect(same.admin.filter((sql) => sql !== 'end')).toEqual([CLUSTER_IDENTIFIER_SQL]);
    const wrong = setup({ rows: '3', orphans: '0', head: HEAD });
    await expect(runVerifyRestore({ ...(await wrong.options()), sameCluster: true })).rejects.toThrow(
      /^--same-cluster was given, but the restore target is not the cluster that was backed up \(another system_identifier\): drop --same-cluster/,
    );
    expect(wrong.admin.filter((sql) => sql !== 'end')).toEqual([CLUSTER_IDENTIFIER_SQL]);
    expect(wrong.steps).toEqual([]);
  });

  it('[D-ARCH-235] the stated exception: --same-cluster on the backed-up cluster restores, and the report says so (target.sameCluster)', async () => {
    const same = setup({ rows: '3', orphans: '0', head: HEAD, cluster: SOURCE_CLUSTER }, { sameCluster: true });
    const report = await runVerifyRestore(await same.options());
    expect(report).toMatchObject({ verdict: 'pass', target: { sameCluster: true } });
    expect(same.admin).toContain('CREATE DATABASE "rehearsal_t1" TEMPLATE template0');
  });

  it('[TASK-034 R2-m1] after a successful deploy the report carries the checksum Prisma stored for the rehearsed migration; none without a deploy or after a failed one', async () => {
    const deployed = setup(
      { rows: '3', orphans: '0', head: HEAD, checksum: CHECKSUM },
      { migrateDeploy: () => Promise.resolve(APPLIED), rehearsedMigration: '20261121000000_backfill' },
    );
    const report = await runVerifyRestore(await deployed.options());
    expect(report.rehearsed).toEqual({ migration: '20261121000000_backfill', checksum: CHECKSUM });
    expect(deployed.scratch).toContain(APPLIED_CHECKSUM_SQL);
    const failed = setup(
      { rows: '3', orphans: '0', head: HEAD, checksum: CHECKSUM },
      {
        migrateDeploy: () => Promise.resolve({ status: 1, stdout: '', stderr: 'Error: P3018' }),
        rehearsedMigration: '20261121000000_backfill',
      },
    );
    expect((await runVerifyRestore(await failed.options())).rehearsed).toBeNull();
    const noRow = setup(
      { rows: '3', orphans: '0', head: HEAD },
      { migrateDeploy: () => Promise.resolve(APPLIED), rehearsedMigration: '20261121000000_backfill' },
    );
    expect((await runVerifyRestore(await noRow.options())).rehearsed).toEqual({ migration: '20261121000000_backfill', checksum: null });
  });

  it('reports a capped schema diff when the source schema text differs', async () => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD });
    const report = await runVerifyRestore({
      ...(await run.options()),
      sourceSchema: `${SCHEMA}\n\nCREATE TABLE public.gone (id integer);`,
    });
    expect(report.schemaDiff.onlyBefore.join('\n')).toContain('public.gone');
  });
});

describe('writeRehearsalRecord (rule R input)', () => {
  const MIGRATION = '20261121000000_backfill';
  let roots = 0;
  const root = (dataChanging = 'yes'): string => {
    roots += 1;
    const dir = join(work, `migrations-${String(roots)}`);
    for (const [name, header] of [
      [HEAD, 'no'],
      [MIGRATION, dataChanging],
    ] as const) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(
        join(dir, name, 'migration.sql'),
        `-- migration-kind: migrate\n-- data-changing: ${header}\n-- reversible: yes\nSELECT 1;\n`,
      );
    }
    return dir;
  };
  /** A passed report of a run that deployed the migration on the restored data (D-TASK034-09), with Prisma's checksum. */
  const passed = async (checksum: string = CHECKSUM): Promise<RestoreReport> => {
    const run = setup(
      { rows: '3', orphans: '0', head: HEAD, checksum },
      { migrateDeploy: () => Promise.resolve(APPLIED), rehearsedMigration: MIGRATION },
    );
    return runVerifyRestore(await run.options());
  };

  it('[TASK-034 R2-m1] binds the record to the deployed bytes: migration.sql changed between the deploy and the write is refused, and so is a report without the checksum', async () => {
    const dir = root();
    const manifest = await sourceManifest();
    const report = await passed(); // the deploy fake ran on the bytes of MIGRATION_TEXT
    writeFileSync(join(dir, MIGRATION, 'migration.sql'), `${MIGRATION_TEXT}UPDATE public.a SET id = id;\n`); // an edit during the run
    expect(() => writeRehearsalRecord(dir, MIGRATION, manifest, report)).toThrow(
      /^migration\.sql changed during the rehearsal \(its SHA-256 differs from the checksum Prisma recorded at the deploy\): no rehearsal record is written/,
    );
    expect(existsSync(join(dir, MIGRATION, RECORD_FILE))).toBe(false);
    const unbound = root();
    expect(() => writeRehearsalRecord(unbound, MIGRATION, manifest, { ...report, rehearsed: null })).toThrow(
      /the report holds no deployed checksum for 20261121000000_backfill/,
    );
    expect(() =>
      writeRehearsalRecord(unbound, MIGRATION, manifest, { ...report, rehearsed: { migration: MIGRATION, checksum: null } }),
    ).toThrow(/no deployed checksum/);
    expect(() =>
      writeRehearsalRecord(unbound, MIGRATION, manifest, { ...report, rehearsed: { migration: HEAD, checksum: CHECKSUM } }),
    ).toThrow(/no deployed checksum/);
    // Control: the unchanged file is accepted, and the record's digest is the deployed checksum.
    const path = writeRehearsalRecord(unbound, MIGRATION, manifest, report);
    expect((JSON.parse(readFileSync(path, 'utf8')) as { migrationSha256: string }).migrationSha256).toBe(report.rehearsed?.checksum);
  });

  it('[TASK-034 R1-M1] refuses a passed report whose run did not deploy the migration', async () => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD });
    const statusOnly = await runVerifyRestore(await run.options());
    expect(statusOnly.verdict).toBe('pass');
    const manifest = await sourceManifest();
    expect(() => writeRehearsalRecord(root(), MIGRATION, manifest, statusOnly)).toThrow(
      /did not deploy the migration on the restored data/,
    );
  });

  it('[TASK-034 R1-n4] "previous" skips a directory without migration.sql (Prisma applies only those)', async () => {
    const dir = root();
    mkdirSync(join(dir, '20261120000000_empty'));
    const manifest = await sourceManifest();
    const report = await passed();
    expect(writeRehearsalRecord(dir, MIGRATION, manifest, report)).toBe(join(dir, MIGRATION, RECORD_FILE));
    expect(() => writeRehearsalRecord(dir, '20261120000000_empty', manifest, report)).toThrow(/does not exist/);
  });

  it('[NT-DATA-004-c] writes a record the linter accepts for a passed report taken at the previous migration', async () => {
    const dir = root();
    const report = await passed();
    const path = writeRehearsalRecord(dir, MIGRATION, await sourceManifest(), report);
    expect(path).toBe(join(dir, MIGRATION, RECORD_FILE));
    const written = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const sql = readFileSync(join(dir, MIGRATION, 'migration.sql'));
    expect(rehearsalProblems(written, { migration: MIGRATION, migrationSha256: sha256Hex(sql), previous: HEAD })).toEqual([]);
  });

  it('[NT-DATA-004-c] refuses a failed report, a backup at another head, a migration that is not data-changing, an unknown or malformed name', async () => {
    const report = await passed();
    const manifest = await sourceManifest();
    expect(() => writeRehearsalRecord(root(), MIGRATION, manifest, { ...report, verdict: 'fail' })).toThrow(
      /no rehearsal record is written/,
    );
    expect(() => writeRehearsalRecord(root(), MIGRATION, { ...manifest, migrationHead: null }, report)).toThrow(
      /migration head null is not the migration before 20261121000000_backfill \(20261119000000_job_executions\)/,
    );
    expect(() => writeRehearsalRecord(root('no'), MIGRATION, manifest, report)).toThrow(/not declared "data-changing: yes"/);
    expect(() => writeRehearsalRecord(root(), '20261121000001_absent', manifest, report)).toThrow(/does not exist/);
    expect(() => writeRehearsalRecord(root(), '../../etc', manifest, report)).toThrow(/must be a migration directory name/);
  });

  it('a first migration is recorded against a null head', async () => {
    const dir = join(work, 'first');
    mkdirSync(join(dir, MIGRATION), { recursive: true });
    writeFileSync(
      join(dir, MIGRATION, 'migration.sql'),
      '-- migration-kind: migrate\n-- data-changing: yes\n-- reversible: yes\nSELECT 1;\n',
    );
    const manifest = { ...(await sourceManifest()), migrationHead: null };
    expect(writeRehearsalRecord(dir, MIGRATION, manifest, await passed())).toBe(join(dir, MIGRATION, RECORD_FILE));
    expect(readFileSync(join(dir, MIGRATION, 'migration.sql'), 'utf8')).toBe(MIGRATION_TEXT);
  });
});

describe('db:verify-restore main', () => {
  const env = (): NodeJS.ProcessEnv => ({
    DATABASE_BOOTSTRAP_URL: 'postgresql://postgres@127.0.0.1:5432/platform',
    DATABASE_MIGRATOR_URL: 'postgresql://platform_migrator@127.0.0.1:5432/platform',
    BOOTSTRAP_MIGRATOR_PASSWORD: 'm'.repeat(32),
    BOOTSTRAP_APP_PASSWORD: 'a'.repeat(32),
    SHADOW_DATABASE_URL: 'postgresql://platform_migrator@127.0.0.1:5432/shadow',
  });
  let backups = 0;
  const backupDir = async (state: DatabaseState = { rows: '3', orphans: '0', head: HEAD }) => {
    backups += 1;
    const dir = join(work, `backup-${String(backups)}`);
    mkdirSync(dir);
    writeFileSync(join(dir, BACKUP_FILES.manifest), JSON.stringify(await sourceManifest(state)));
    writeFileSync(join(dir, BACKUP_FILES.schema), NORMALISED);
    return dir;
  };
  interface Sink {
    lines: string[];
    errors: string[];
    urls: string[];
    statusEnv?: NodeJS.ProcessEnv;
    deployEnv?: NodeJS.ProcessEnv;
    archiveTarget?: object;
  }
  const newSink = (): Sink => ({ lines: [], errors: [], urls: [] });
  /** A folder with the migration before the rehearsed one and the data-changing `20261121000000_backfill`. */
  let migrationRoots = 0;
  const cliMigrations = (): string => {
    migrationRoots += 1;
    const migrations = join(work, `cli-migrations-${String(migrationRoots)}`);
    for (const [name, header] of [
      [HEAD, 'no'],
      ['20261121000000_backfill', 'yes'],
    ] as const) {
      mkdirSync(join(migrations, name), { recursive: true });
      writeFileSync(
        join(migrations, name, 'migration.sql'),
        `-- migration-kind: migrate\n-- data-changing: ${header}\n-- reversible: yes\nSELECT 1;\n`,
      );
    }
    return migrations;
  };
  /**
   * `pending`: the restored history is one migration behind, as rule R requires; `migrate status` then reports it as
   * Prisma 7.10 does (exit 1) until `migrate deploy` ran (R1-M1).
   */
  const deps = (
    restored: DatabaseState,
    sink: Sink,
    migrationsRoot = work,
    { pending = false, deploy = APPLIED }: { pending?: boolean; deploy?: PrismaRun } = {},
  ): VerifyRestoreDependencies => {
    let deployed = false;
    return {
      connect: async (url) => {
        await tick();
        sink.urls.push(url);
        return database({ cluster: TARGET_CLUSTER, checksum: CHECKSUM, ...restored }, []);
      },
      archive: (target) => {
        sink.archiveTarget = target;
        return { dump: () => Promise.resolve(), dumpSchema: () => Promise.resolve(SCHEMA), restore: () => Promise.resolve() };
      },
      prepareScratch: async (url) => {
        await tick();
        sink.urls.push(`prepare ${url}`);
      },
      migrateDeploy: async (deployEnv) => {
        await tick();
        sink.deployEnv = deployEnv;
        sink.urls.push('migrate deploy');
        deployed = deploy.status === 0;
        return deploy;
      },
      migrateStatus: async (statusEnv) => {
        await tick();
        sink.statusEnv = statusEnv;
        return pending && !deployed ? BEHIND : UP_TO_DATE;
      },
      migrationsRoot,
      now: () => NOW,
      write: (line) => sink.lines.push(line),
      writeError: (line) => sink.errors.push(line),
    };
  };

  it('[NT-REC-003-a] restores into rehearsal_<stamp>, checks status against the scratch database without the shadow URL, writes the report: exit 0', async () => {
    const dir = await backupDir();
    const sink = newSink();
    expect(await main(['--backup', dir], env(), deps({ rows: '3', orphans: '0', head: HEAD }, sink))).toBe(0);
    expect(sink.errors).toEqual([]);
    expect(sink.urls).toEqual([
      'postgresql://postgres@127.0.0.1:5432/postgres',
      'prepare postgresql://postgres@127.0.0.1:5432/rehearsal_20261121t100500z',
      'postgresql://postgres@127.0.0.1:5432/rehearsal_20261121t100500z',
      'postgresql://postgres@127.0.0.1:5432/postgres',
    ]);
    expect(sink.statusEnv?.['DATABASE_MIGRATOR_URL']).toBe('postgresql://platform_migrator@127.0.0.1:5432/rehearsal_20261121t100500z');
    expect(sink.statusEnv).not.toHaveProperty('SHADOW_DATABASE_URL');
    // PR034-SEC-08: the Prisma child sees an allow-list: no superuser URL, no role password.
    for (const name of ['DATABASE_BOOTSTRAP_URL', 'BOOTSTRAP_MIGRATOR_PASSWORD', 'BOOTSTRAP_APP_PASSWORD'])
      expect(sink.statusEnv).not.toHaveProperty(name);
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatch(
      /^\[db:verify-restore\] PASS: 1 tables, 3 rows, restore \d+ ms; report restore-report\.json in the backup folder$/,
    );
    expect(JSON.parse(readFileSync(join(dir, REPORT_FILE), 'utf8'))).toMatchObject({
      verdict: 'pass',
      target: { sameCluster: false },
      migrateDeploy: null,
      rehearsed: null,
    });
    expect(sink.urls).not.toContain('migrate deploy'); // no --migration: nothing is deployed
    expect(sink.archiveTarget).toEqual({ service: 'postgres', user: 'postgres' });
  });

  it('[NT-DATA-004-c] [TASK-034 R1-M1] with --migration: the backup is one migration behind, deploy rehearses it on the restored data, status is then up to date, the record is written', async () => {
    const migrations = cliMigrations();
    const sink = newSink();
    const code = await main(
      ['--backup', await backupDir(), '--migration', '20261121000000_backfill', '--scratch', 'rehearsal_cli', '--project', 'shipqube'],
      env(),
      deps({ rows: '3', orphans: '0', head: HEAD }, sink, migrations, { pending: true }),
    );
    expect(sink.errors).toEqual([]);
    expect(code).toBe(0);
    expect(sink.urls.slice(0, 4)).toEqual([
      'postgresql://postgres@127.0.0.1:5432/postgres',
      'prepare postgresql://postgres@127.0.0.1:5432/rehearsal_cli',
      'postgresql://postgres@127.0.0.1:5432/rehearsal_cli',
      'migrate deploy',
    ]);
    expect(sink.deployEnv?.['DATABASE_MIGRATOR_URL']).toBe('postgresql://platform_migrator@127.0.0.1:5432/rehearsal_cli');
    expect(sink.deployEnv).not.toHaveProperty('SHADOW_DATABASE_URL');
    expect(sink.deployEnv).not.toHaveProperty('DATABASE_BOOTSTRAP_URL');
    expect(sink.archiveTarget).toEqual({ service: 'postgres', user: 'postgres', project: 'shipqube' });
    expect(sink.lines[0]).toMatch(/; 20261121000000_backfill deployed on the restored data; report restore-report\.json/);
    expect(sink.lines.at(-1)).toBe(`[db:verify-restore] wrote ${RECORD_FILE} for 20261121000000_backfill`);
    const record = JSON.parse(readFileSync(join(migrations, '20261121000000_backfill', RECORD_FILE), 'utf8')) as { verification: object };
    expect(record.verification).toMatchObject({ verdict: 'pass', deployed: true });
  });

  it('[TASK-034 R1-M1] with --migration, a failed deploy is a FAIL with its reason, and no record', async () => {
    const migrations = cliMigrations();
    const sink = newSink();
    const code = await main(
      ['--backup', await backupDir(), '--migration', '20261121000000_backfill'],
      env(),
      deps({ rows: '3', orphans: '0', head: HEAD }, sink, migrations, {
        pending: true,
        deploy: { status: 1, stdout: '', stderr: 'Error: P3018' },
      }),
    );
    expect(code).toBe(1);
    expect(sink.errors[0]).toMatch(/: migrate deploy: exit 1: P3018; migrate status: exit 1: pending 20261121000000_backfill$/);
    expect(existsSync(join(migrations, '20261121000000_backfill', RECORD_FILE))).toBe(false);
  });

  it('[TASK-034 R2-m1] a record the writer refuses is a FAIL line and exit 1, never a PASS line first', async () => {
    const migrations = cliMigrations();
    const sink = newSink();
    const code = await main(
      ['--backup', await backupDir(), '--migration', '20261121000000_backfill'],
      env(),
      deps({ rows: '3', orphans: '0', head: HEAD, checksum: 'f'.repeat(64) }, sink, migrations, { pending: true }),
    );
    expect(code).toBe(1);
    expect(sink.lines).toEqual([]);
    expect(sink.errors).toEqual([
      expect.stringMatching(
        /^\[db:verify-restore\] FAIL \(1 tables, 3 rows, restore \d+ ms\): the verification passed, but no rehearsal\.json was written: migration\.sql changed during the rehearsal/,
      ),
    ]);
    expect(existsSync(join(migrations, '20261121000000_backfill', RECORD_FILE))).toBe(false);
  });

  it('[D-ARCH-235] --same-cluster is a switch of the CLI: refused on another cluster, accepted on the backed-up one and named in the PASS line and the report', async () => {
    const wrong = newSink();
    expect(await main(['--backup', await backupDir(), '--same-cluster'], env(), deps({ rows: '3', orphans: '0', head: HEAD }, wrong))).toBe(
      1,
    );
    expect(wrong.errors).toEqual([
      expect.stringMatching(
        /^\[db:verify-restore\] --same-cluster was given, but the restore target is not the cluster that was backed up/,
      ),
    ]);
    const refused = newSink();
    expect(
      await main(['--backup', await backupDir()], env(), deps({ rows: '3', orphans: '0', head: HEAD, cluster: SOURCE_CLUSTER }, refused)),
    ).toBe(1);
    expect(refused.errors).toEqual([expect.stringMatching(/^\[db:verify-restore\] the restore target is the cluster that was backed up/)]);
    expect(refused.urls).toEqual(['postgresql://postgres@127.0.0.1:5432/postgres']); // the admin session only: nothing created
    const dir = await backupDir();
    const same = newSink();
    expect(
      await main(['--backup', dir, '--same-cluster'], env(), deps({ rows: '3', orphans: '0', head: HEAD, cluster: SOURCE_CLUSTER }, same)),
    ).toBe(0);
    expect(same.lines).toEqual([
      expect.stringMatching(/; same cluster \(--same-cluster\); report restore-report\.json in the backup folder$/),
    ]);
    expect(JSON.parse(readFileSync(join(dir, REPORT_FILE), 'utf8'))).toMatchObject({ verdict: 'pass', target: { sameCluster: true } });
  });

  it('[D-ARCH-236] a backup folder whose manifest has a load-time finding is refused before any database work, in both forms', async () => {
    for (const argv of [[], ['--same-cluster']]) {
      const sink = newSink();
      const dir = await backupDir({ rows: '3', orphans: '0', head: HEAD, loadTime: [PLANTED] });
      expect(await main(['--backup', dir, ...argv], env(), deps({ rows: '3', orphans: '0', head: HEAD }, sink))).toBe(1);
      expect(sink.errors).toEqual([
        expect.stringMatching(
          /^\[db:verify-restore\] the load-time gate refuses this backup: 1 load-time finding\(s\): table check public\.a ck_a__probe/,
        ),
      ]);
      expect(sink.urls).toEqual([]);
      expect(existsSync(join(dir, REPORT_FILE))).toBe(false);
    }
  });

  it('[NT-REC-003-a] exit 1 with the reasons on a failed verification, and no record', async () => {
    const migrations = cliMigrations();
    const sink = newSink();
    const code = await main(
      ['--backup', await backupDir(), '--migration', '20261121000000_backfill'],
      env(),
      deps({ rows: '1', orphans: '2', head: HEAD }, sink, migrations, { pending: true }),
    );
    expect(code).toBe(1);
    expect(sink.errors[0]).toMatch(
      /^\[db:verify-restore\] FAIL \(1 tables, 1 rows, restore \d+ ms\): table public\.a: 3 rows expected, 1 restored; 2 orphan\(s\) for fk on public\.b$/,
    );
    expect(sink.lines).toEqual([]);
    expect(existsSync(join(migrations, '20261121000000_backfill', RECORD_FILE))).toBe(false);
  });

  it('[TASK-034 R1-n3] the --migration checks run before any database work: nothing is created or printed as PASS', async () => {
    for (const [migration, message] of [
      ['20261121000001_absent', /migration 20261121000001_absent does not exist/],
      [HEAD, /is not declared "data-changing: yes"/],
      ['../etc', /must be a migration directory name/],
    ] as const) {
      const sink = newSink();
      expect(
        await main(
          ['--backup', await backupDir(), '--migration', migration],
          env(),
          deps({ rows: '3', orphans: '0', head: HEAD }, sink, cliMigrations()),
        ),
      ).toBe(1);
      expect(sink.errors[0]).toMatch(message);
      expect(sink.urls).toEqual([]);
      expect(sink.lines).toEqual([]);
    }
    const atAnotherHead = newSink();
    const code = await main(
      ['--backup', await backupDir({ rows: '3', orphans: '0', head: null }), '--migration', '20261121000000_backfill'],
      env(),
      deps({ rows: '3', orphans: '0', head: HEAD }, atAnotherHead, cliMigrations()),
    );
    expect(code).toBe(1);
    expect(atAnotherHead.errors[0]).toMatch(/migration head null is not the migration before 20261121000000_backfill/);
    expect(atAnotherHead.urls).toEqual([]);
  });

  it('refuses a missing --backup, a remote URL, a migrator on another server and missing role passwords, before any database work', async () => {
    const cases: [string[], NodeJS.ProcessEnv, RegExp][] = [
      [[], env(), /--backup <folder written by db:backup> is required/],
      [
        ['--backup', 'x'],
        { ...env(), DATABASE_BOOTSTRAP_URL: 'postgresql://u@db.example.com/platform' },
        /DATABASE_BOOTSTRAP_URL must name a loopback host/,
      ],
      [
        ['--backup', 'x'],
        { ...env(), DATABASE_MIGRATOR_URL: 'postgresql://m@127.0.0.1:6543/platform' },
        /must name the same host and port/,
      ],
      [['--backup', 'x'], { ...env(), BOOTSTRAP_APP_PASSWORD: '' }, /BOOTSTRAP_APP_PASSWORD \(or BOOTSTRAP_APP_PASSWORD_FILE\) is not set/],
    ];
    for (const [argv, variables, message] of cases) {
      const sink = { lines: [] as string[], errors: [] as string[], urls: [] as string[] };
      expect(await main(argv, variables, deps({ rows: '3', orphans: '0', head: HEAD }, sink))).toBe(1);
      expect(sink.errors[0]).toMatch(message);
      expect(sink.urls).toEqual([]);
    }
  });

  it('[SPK-08 F-01] runs migrate status and deploy through the pinned wrapper with the root prisma.config.ts (no --config) and wires the production dependencies', () => {
    const calls: unknown[][] = [];
    const fake = ((...args: unknown[]) => {
      calls.push(args);
      return { status: 0, stdout: 'Database schema is up to date!', stderr: null };
    }) as unknown as typeof spawnSync;
    const statusEnv = { DATABASE_MIGRATOR_URL: 'postgresql://m@127.0.0.1/rehearsal_x' };
    expect(prismaStatus(statusEnv, fake)).toEqual({ status: 0, stdout: 'Database schema is up to date!', stderr: '' });
    const [command, args, options] = calls[0] as [string, string[], { cwd: string; env: object; timeout: number }];
    expect(command).toBe(process.execPath);
    expect(args.slice(1)).toEqual(['migrate', 'status']);
    expect(args[0]).toMatch(/tools[\\/]deps[\\/]prisma-cli\.mjs$/);
    expect(options.cwd).toBe(REPO_ROOT); // the root prisma.config.ts, with the generated tables.external window
    expect(options.env).toBe(statusEnv);
    expect(options.timeout).toBeGreaterThan(0);
    prismaMigrate('deploy', statusEnv, fake);
    const [, deployArgs, deployOptions] = calls[1] as [string, string[], { cwd: string; timeout: number }];
    expect(deployArgs.slice(1)).toEqual(['migrate', 'deploy']);
    expect(deployOptions.cwd).toBe(REPO_ROOT);
    expect(deployOptions.timeout).toBeGreaterThan(options.timeout);
    expect(Object.keys(VERIFY_RESTORE_DEPENDENCIES).sort()).toEqual([
      'archive',
      'connect',
      'migrateDeploy',
      'migrateStatus',
      'migrationsRoot',
      'now',
      'prepareScratch',
      'write',
      'writeError',
    ]);
    expect(VERIFY_RESTORE_DEPENDENCIES.migrationsRoot).toMatch(/prisma[\\/]migrations$/);
  });
});
