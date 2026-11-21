/**
 * `db:verify-restore` (data-model.md §8.6 steps 4-6; NT-REC-003-a, NT-DATA-004-c; SPK-08 F-01; TASK-034): the scratch
 * database lifecycle, the verdict, the rehearsal record it writes and the CLI. Fakes stand in for PostgreSQL; the
 * PostgreSQL 18 run is prisma/tests/migrations/backup-restore.int.test.ts.
 */
import type { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const passed = async (): Promise<RestoreReport> => {
    const run = setup({ rows: '3', orphans: '0', head: HEAD });
    return runVerifyRestore(await run.options());
  };

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
  const deps = (
    restored: DatabaseState,
    sink: { lines: string[]; errors: string[]; urls: string[]; statusEnv?: NodeJS.ProcessEnv },
    migrationsRoot = work,
  ): VerifyRestoreDependencies => ({
    connect: async (url) => {
      await tick();
      sink.urls.push(url);
      return database(restored, []);
    },
    archive: () => ({
      dump: () => Promise.resolve(),
      dumpSchema: () => Promise.resolve(SCHEMA),
      restore: () => Promise.resolve(),
    }),
    prepareScratch: async (url) => {
      await tick();
      sink.urls.push(`prepare ${url}`);
    },
    migrateStatus: async (statusEnv) => {
      await tick();
      sink.statusEnv = statusEnv;
      return UP_TO_DATE;
    },
    migrationsRoot,
    now: () => NOW,
    write: (line) => sink.lines.push(line),
    writeError: (line) => sink.errors.push(line),
  });

  it('[NT-REC-003-a] restores into rehearsal_<stamp>, checks status against the scratch database without the shadow URL, writes the report: exit 0', async () => {
    const dir = await backupDir();
    const sink = { lines: [] as string[], errors: [] as string[], urls: [] as string[] } as {
      lines: string[];
      errors: string[];
      urls: string[];
      statusEnv?: NodeJS.ProcessEnv;
    };
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
    expect(JSON.parse(readFileSync(join(dir, REPORT_FILE), 'utf8'))).toMatchObject({ verdict: 'pass' });
  });

  it('[NT-DATA-004-c] with --migration writes the rehearsal record after a pass', async () => {
    const migrations = join(work, 'cli-migrations');
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
    const sink = { lines: [] as string[], errors: [] as string[], urls: [] as string[] };
    const code = await main(
      ['--backup', await backupDir(), '--migration', '20261121000000_backfill', '--scratch', 'rehearsal_cli'],
      env(),
      deps({ rows: '3', orphans: '0', head: HEAD }, sink, migrations),
    );
    expect(sink.errors).toEqual([]);
    expect(code).toBe(0);
    expect(sink.lines.at(-1)).toBe(`[db:verify-restore] wrote ${RECORD_FILE} for 20261121000000_backfill`);
  });

  it('[NT-REC-003-a] exit 1 with the reasons on a failed verification, and no record', async () => {
    const sink = { lines: [] as string[], errors: [] as string[], urls: [] as string[] };
    const code = await main(
      ['--backup', await backupDir(), '--migration', '20261121000000_backfill'],
      env(),
      deps({ rows: '1', orphans: '2', head: HEAD }, sink),
    );
    expect(code).toBe(1);
    expect(sink.errors[0]).toMatch(
      /^\[db:verify-restore\] FAIL \(1 tables, 1 rows, restore \d+ ms\): table public\.a: 3 rows expected, 1 restored; 2 orphan\(s\) for fk on public\.b$/,
    );
    expect(sink.lines).toEqual([]);
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

  it('[SPK-08 F-01] runs migrate status through the pinned wrapper with the root prisma.config.ts (no --config) and wires the production dependencies', () => {
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
    expect(Object.keys(VERIFY_RESTORE_DEPENDENCIES).sort()).toEqual([
      'archive',
      'connect',
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
