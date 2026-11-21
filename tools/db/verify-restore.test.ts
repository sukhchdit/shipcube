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
import type { ArchiveTool } from './pg-archive.js';
import {
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
}

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
    admin: () => Promise.resolve(database(restored, admin)),
    scratch: () => Promise.resolve(database(restored, scratch)),
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
      'SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1',
      'CREATE DATABASE "rehearsal_t1" TEMPLATE template0',
      'DROP DATABASE IF EXISTS "rehearsal_t1" WITH (FORCE)',
    ]);
    expect(run.steps).toEqual(['00-roles.sql', 'restore rehearsal_t1 /backup/platform.dump', 'schema rehearsal_t1', 'migrate status']);
    expect(report).toMatchObject({
      verdict: 'pass',
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
    expect(report.migrateStatus).toEqual({ ok: false, detail: 'exit 1: Following migration have not yet been applied: | x' });
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
      detail: 'exit 1: 8 migrations found in prisma/migrations | Following migration have not yet been applied: | 20261121000000_backfill',
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
    expect(report.migrateDeploy).toEqual({ ok: false, detail: 'exit 1: Error: P3018 A migration failed to apply.' });
    expect(report.migrateStatus.ok).toBe(true);
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
  /** A passed report of a run that deployed the migration on the restored data (D-TASK034-09). */
  const passed = async (): Promise<RestoreReport> => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD }, { migrateDeploy: () => Promise.resolve(APPLIED) });
    return runVerifyRestore(await run.options());
  };

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
        return database(restored, []);
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
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatch(
      /^\[db:verify-restore\] PASS: 1 tables, 3 rows, restore \d+ ms; report restore-report\.json in the backup folder$/,
    );
    expect(JSON.parse(readFileSync(join(dir, REPORT_FILE), 'utf8'))).toMatchObject({ verdict: 'pass', migrateDeploy: null });
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
    expect(sink.errors[0]).toMatch(/: migrate deploy: exit 1: Error: P3018; migrate status: exit 1: .*have not yet been applied/);
    expect(existsSync(join(migrations, '20261121000000_backfill', RECORD_FILE))).toBe(false);
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
