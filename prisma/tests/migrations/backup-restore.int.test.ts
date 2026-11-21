/**
 * Backup and restore rehearsal on PostgreSQL 18 (data-model.md §8.6 with the SEC-P3-03 amendment; NFR-REC-003,
 * NFR-DATA-004; CLAUDE.md §5 Database; TASK-034). Drivers: tools/db/backup.ts and tools/db/verify-restore.ts; the
 * archive tool runs pg_dump / pg_restore inside the Testcontainers PostgreSQL container as the superuser (the CLI does
 * the same in the Compose `postgres` service).
 *
 * The source is the fully migrated platform database plus fixture tables that exercise the row checksum (numeric,
 * float, bytea, jsonb, interval, timestamptz, NULLs), a foreign key, a partitioned table with a foreign key and identity
 * sequences. The scratch database gets only the database-level 00-roles.sql before pg_restore.
 *
 * The last describe drives the CLI entry points themselves (C4 harness proof, D-ORCH-160; D-TASK034-14).
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { BACKUP_DEPENDENCIES, main as backupMain, runBackup, type BackupResult } from '../../../tools/db/backup.js';
import { connectPrivileged, reapplyDatabaseLevel } from '../../../tools/db/bootstrap.js';
import { lintRehearsals } from '../../../tools/db/lint-migrations.js';
import { composeArchiveTool, errorSummary, runProcess, type ArchiveTool, type ProcessRunner } from '../../../tools/db/pg-archive.js';
import { pgSession, type ArchiveTarget, type ClosableSession } from '../../../tools/db/rehearsal-cli.js';
import { findOrphans, manifestTotals, parseManifest } from '../../../tools/db/rehearsal-manifest.js';
import { RECORD_FILE } from '../../../tools/db/rehearsal-record.js';
import { listMigrations } from '../../../tools/db/up-down-up.js';
import {
  REPORT_FILE,
  REPORT_FORMAT,
  VERIFY_RESTORE_DEPENDENCIES,
  main as verifyMain,
  runVerifyRestore,
  verifyRestoredDatabase,
  writeRehearsalRecord,
  type VerifyRestoreOptions,
} from '../../../tools/db/verify-restore.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import { findRepoRoot, runNode } from '../../../tools/test-support/process.js';
import { PlatformPostgres, SUPERUSER } from '../harness/postgres.js';

const repoRoot = findRepoRoot();
const repositoryMigrations = join(repoRoot, 'prisma', 'migrations');
/** Root schema and audit window, migrations from REHEARSAL_MIGRATIONS_PATH (R1-M1). */
const REHEARSAL_CONFIG = join(repoRoot, 'prisma', 'tests', 'fixtures', 'rehearsal', 'prisma.config.ts');
const work = mkdtempSync(join(tmpdir(), 'rehearsal-int-'));

let db: PlatformPostgres;

beforeAll(async () => {
  db = await PlatformPostgres.start();
}, 180_000);

afterAll(async () => {
  await db?.stop();
  rmSync(work, { recursive: true, force: true });
});

/** pg_dump / pg_restore inside the container, over its local socket, as the superuser. */
function containerArchive(): ArchiveTool {
  const exec = async (args: string[]): Promise<string> => {
    const result = await db.container.exec(args);
    if (result.exitCode !== 0)
      throw new Error(`${args[0] ?? 'tool'} exited with ${String(result.exitCode)}: ${errorSummary(result.stderr)}`);
    return result.stdout;
  };
  return {
    async dump({ database, snapshot, archive }) {
      await exec(['pg_dump', '--format=custom', '--username', SUPERUSER, '--dbname', database, '--snapshot', snapshot, '--file', archive]);
    },
    dumpSchema: ({ database, snapshot }) =>
      exec([
        'pg_dump',
        '--schema-only',
        '--username',
        SUPERUSER,
        '--dbname',
        database,
        ...(snapshot === undefined ? [] : ['--snapshot', snapshot]),
      ]),
    async restore({ database, archive }) {
      await exec(['pg_restore', '--exit-on-error', '--username', SUPERUSER, '--dbname', database, archive]);
    },
  };
}

const session = async (database: string): Promise<ClosableSession> => pgSession(await connectPrivileged(db.bootstrapConnection(database)));

async function superuserRun(database: string, statements: readonly string[]): Promise<void> {
  const client = await db.superuser(database);
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

const FIXTURE = [
  `CREATE TABLE public.zz_rehearsal_parent (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL,
     at timestamptz NOT NULL DEFAULT pg_catalog.now(), amount numeric(12,2), ratio double precision, blob bytea, doc jsonb, span interval)`,
  `CREATE TABLE public.zz_rehearsal_child (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     parent_id bigint REFERENCES public.zz_rehearsal_parent (id), note text)`,
  `CREATE TABLE public.zz_rehearsal_events (id bigint NOT NULL, month date NOT NULL,
     parent_id bigint REFERENCES public.zz_rehearsal_parent (id), PRIMARY KEY (id, month)) PARTITION BY RANGE (month)`,
  `CREATE TABLE public.zz_rehearsal_events_2026 PARTITION OF public.zz_rehearsal_events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`,
  `INSERT INTO public.zz_rehearsal_parent (name, amount, ratio, blob, doc, span)
     SELECT 'p' || g, g * 1.25, g / 3.0, pg_catalog.sha256(g::text::bytea), pg_catalog.jsonb_build_object('g', g, 'odd', g % 2 = 1),
            pg_catalog.make_interval(secs => g) FROM pg_catalog.generate_series(1, 300) g`,
  `INSERT INTO public.zz_rehearsal_child (parent_id, note)
     SELECT CASE WHEN g % 11 = 0 THEN NULL ELSE 1 + g % 300 END, CASE WHEN g % 7 = 0 THEN NULL ELSE 'n' || g END
       FROM pg_catalog.generate_series(1, 600) g`,
  `INSERT INTO public.zz_rehearsal_events SELECT g, date '2026-01-01' + (g % 300), 1 + g % 300 FROM pg_catalog.generate_series(1, 200) g`,
];

const archivePath = (): string => `/tmp/rehearsal-${randomBytes(4).toString('hex')}.dump`;

async function sourceWithFixture(): Promise<string> {
  const database = await db.clone(await db.template({ migrated: true }));
  await superuserRun(database, FIXTURE);
  return database;
}

function verifyOptions(backup: BackupResult, scratch: string, archive: string, keep: boolean): VerifyRestoreOptions {
  return {
    manifest: backup.manifest,
    sourceSchema: backup.schema,
    scratchDatabase: scratch,
    archivePath: archive,
    archive: containerArchive(),
    admin: () => session('postgres'),
    scratch: () => session(scratch),
    prepareScratch: () => reapplyDatabaseLevel({ connection: db.bootstrapConnection(scratch), passwords: db.passwords }),
    migrateStatus: () => db.prisma(scratch, ['migrate', 'status']),
    keepScratch: keep,
  };
}

async function databaseExists(name: string): Promise<boolean> {
  const admin = await session('postgres');
  try {
    return (await admin.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [name])).length === 1;
  } finally {
    await admin.end();
  }
}

// NT-REC-003-a is covered here PARTIALLY: the database layer (row counts, checksums, FK anti-joins, schema digest,
// migration history). The bucket copy, document SHA-256, catalog C1-C14 on the restore, audit chain and anchors and the
// /health/ready smoke are deferred (D-TASK034-04; TASK-034 code review R1-m4).
describe('backup and restore rehearsal (NFR-REC-003; NT-REC-003-a partial: database layer)', () => {
  let source: string;
  let backup: BackupResult;
  let archive: string;

  beforeAll(async () => {
    source = await sourceWithFixture();
    archive = archivePath();
    backup = await runBackup({
      database: source,
      outDir: join(work, 'backup'),
      archivePath: archive,
      connect: () => session(source),
      archive: containerArchive(),
    });
  }, 300_000);

  it('[NT-REC-003-a] (partial) the manifest fingerprints every table (partitions included) at the migration head', () => {
    const rows = new Map(backup.manifest.tables.map((table) => [table.table, table.rows]));
    expect(rows.get('public.zz_rehearsal_parent')).toBe('300');
    expect(rows.get('public.zz_rehearsal_child')).toBe('600');
    expect(rows.get('public.zz_rehearsal_events_2026')).toBe('200');
    expect(rows.has('public.zz_rehearsal_events')).toBe(false); // a partitioned parent holds no rows of its own
    expect(Number(rows.get('public.permissions') ?? '0')).toBeGreaterThan(0); // the authz seed migration's rows
    expect(rows.has('public._prisma_migrations')).toBe(true);
    expect(backup.manifest.migrationHead).toBe(listMigrations(repositoryMigrations).at(-1));
    expect(backup.manifest.sequences.find((sequence) => sequence.sequence === 'public.zz_rehearsal_child_id_seq')?.lastValue).toBe('600');
    expect(backup.manifest.schemaSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[NT-REC-003-a] (partial) [NT-DATA-004-c] restore into a scratch database: row counts and checksums equal, 0 orphans, schema equal, migrate status up to date with the root config (SPK-08 F-01: the config loads, history only)', async () => {
    const report = await runVerifyRestore(verifyOptions(backup, 'rehearsal_ok', archive, true));
    expect(report.differences).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.schemaDiff).toEqual({ onlyBefore: [], onlyAfter: [] });
    expect(report.migrateStatus).toEqual({ ok: true, detail: 'up to date', pending: [], failed: [] });
    expect(report.verdict).toBe('pass');
    expect(report.totals.tables).toBe(backup.manifest.tables.length);
    expect(report.restoredManifestSha256).not.toBe(report.source.manifestSha256); // the database name and time differ
    expect(await databaseExists('rehearsal_ok')).toBe(true);
  }, 300_000);

  it('[NT-REC-003-a] (partial) negative controls on the restored database: a deleted row, a changed row and an orphan each fail the verification', async () => {
    const verify = async () => {
      const restored = await session('rehearsal_ok');
      try {
        return await verifyRestoredDatabase({
          manifest: backup.manifest,
          sourceSchema: backup.schema,
          database: 'rehearsal_ok',
          session: restored,
          archive: containerArchive(),
          migrateStatus: () => db.prisma('rehearsal_ok', ['migrate', 'status']),
        });
      } finally {
        await restored.end();
      }
    };
    await superuserRun('rehearsal_ok', ["UPDATE public.zz_rehearsal_parent SET name = 'changed' WHERE id = 7"]);
    expect((await verify()).differences).toEqual(['table public.zz_rehearsal_parent: row checksum differs (300 rows)']);
    await superuserRun('rehearsal_ok', ['DELETE FROM public.zz_rehearsal_child WHERE id = 5']);
    expect((await verify()).differences).toEqual([
      'table public.zz_rehearsal_child: 600 rows expected, 599 restored',
      'table public.zz_rehearsal_parent: row checksum differs (300 rows)',
    ]);
    // An orphan written past the FK trigger (replica mode) is found by the generated anti-join.
    await superuserRun('rehearsal_ok', [
      "SET session_replication_role = 'replica'",
      "INSERT INTO public.zz_rehearsal_child (parent_id, note) VALUES (999999, 'orphan')",
      "INSERT INTO public.zz_rehearsal_events VALUES (999999, date '2026-06-01', 999999)",
    ]);
    const check = await verify();
    expect(check.verdict).toBe('fail');
    expect(check.orphans.map((orphan) => [orphan.table, orphan.orphans])).toEqual([
      ['public.zz_rehearsal_child', '1'],
      ['public.zz_rehearsal_events', '1'],
    ]);
    const restored = await session('rehearsal_ok');
    try {
      expect(await findOrphans(restored)).toHaveLength(2);
    } finally {
      await restored.end();
    }
    const admin = await session('postgres');
    try {
      await admin.query('DROP DATABASE rehearsal_ok WITH (FORCE)');
    } finally {
      await admin.end();
    }
  }, 300_000);

  it('[NT-REC-003-a] (partial) a tampered manifest fails the verification, and the scratch database is dropped afterwards', async () => {
    const tables = backup.manifest.tables.map((table) =>
      table.table === 'public.zz_rehearsal_events_2026' ? { ...table, checksum: `${table.checksum}1` } : table,
    );
    const report = await runVerifyRestore({
      ...verifyOptions(backup, 'rehearsal_tampered', archive, false),
      manifest: { ...backup.manifest, tables },
    });
    expect(report.verdict).toBe('fail');
    expect(report.differences).toEqual(['table public.zz_rehearsal_events_2026: row checksum differs (200 rows)']);
    expect(await databaseExists('rehearsal_tampered')).toBe(false);
    await expect(runVerifyRestore(verifyOptions(backup, source, archive, false))).rejects.toThrow(/must not be the backed-up database/);
  }, 300_000);

  it('[NT-DATA-004-c] [TASK-034 R1-M1] a data-changing migration one step past the backup, in the real prisma/migrations layout: status alone is behind (exit 1); deploy rehearses it on the restored data, status is then up to date, and the record lets it through the linter; an edit after it does not pass', async () => {
    // A copy of the repository folder plus the migration under rehearsal; the fixture config points Prisma at it.
    const root = join(work, 'migrations');
    cpSync(repositoryMigrations, root, { recursive: true });
    const name = '29991231000000_rehearsal_probe';
    mkdirSync(join(root, name));
    const sql = [
      '-- migration-kind: migrate',
      '-- data-changing: yes',
      '-- reversible: yes',
      'CREATE TABLE public.zz_rehearsal_probe (id integer PRIMARY KEY);',
      'INSERT INTO public.zz_rehearsal_probe (id) SELECT g FROM pg_catalog.generate_series(1, 3) g;',
      '',
    ].join('\n');
    writeFileSync(join(root, name, 'migration.sql'), sql);
    writeFileSync(join(root, name, 'down.sql'), 'DROP TABLE IF EXISTS public.zz_rehearsal_probe;\n');
    expect(backup.manifest.migrationHead).toBe(listMigrations(repositoryMigrations).at(-1)); // the migration before `name`
    expect(lintRehearsals(root).map((finding) => finding.rule)).toEqual(['R']);
    const rehearsal = { config: REHEARSAL_CONFIG, env: { REHEARSAL_MIGRATIONS_PATH: root } };

    // Prisma 7.10 `migrate status` on the restored database, one migration behind: exit 1, so no record without deploy.
    const behind = await runVerifyRestore({
      ...verifyOptions(backup, 'rehearsal_behind', archive, false),
      migrateStatus: () => db.prisma('rehearsal_behind', ['migrate', 'status'], rehearsal),
    });
    expect(behind.verdict).toBe('fail');
    expect(behind.migrateStatus.ok).toBe(false);
    // Both streams are read and the names parsed (fix cycle 2: the banner and the status text are on different
    // streams, and a tail of the joined text held the banner alone).
    expect(behind.migrateStatus.pending).toEqual([name]);
    expect(behind.migrateStatus.failed).toEqual([]);
    expect(behind.migrateStatus.detail).toMatch(/^exit 1: pending 29991231000000_rehearsal_probe \| /);
    expect(() => writeRehearsalRecord(root, name, backup.manifest, behind)).toThrow(/no rehearsal record is written/);

    const report = await runVerifyRestore({
      ...verifyOptions(backup, 'rehearsal_record', archive, true),
      migrateDeploy: () => db.prisma('rehearsal_record', ['migrate', 'deploy'], rehearsal),
      migrateStatus: () => db.prisma('rehearsal_record', ['migrate', 'status'], rehearsal),
    });
    expect(report.differences).toEqual([]); // compared before the deploy, on the data as backed up
    expect(report.migrateDeploy).toEqual({ ok: true, detail: 'applied', pending: [], failed: [] });
    expect(report.migrateStatus).toEqual({ ok: true, detail: 'up to date', pending: [], failed: [] });
    expect(report.verdict).toBe('pass');
    const restored = await session('rehearsal_record');
    try {
      expect(await restored.query('SELECT count(*)::integer AS n FROM public.zz_rehearsal_probe')).toEqual([{ n: 3 }]);
    } finally {
      await restored.end();
    }
    await superuserRun('postgres', ['DROP DATABASE rehearsal_record WITH (FORCE)']);

    writeRehearsalRecord(root, name, backup.manifest, report);
    expect(JSON.parse(readFileSync(join(root, name, RECORD_FILE), 'utf8'))).toMatchObject({
      migration: name,
      verification: { verdict: 'pass', deployed: true },
    });
    expect(lintRehearsals(root)).toEqual([]);
    writeFileSync(join(root, name, 'migration.sql'), `${sql}DELETE FROM public.zz_rehearsal_child WHERE note = '';\n`);
    expect(lintRehearsals(root).map((finding) => finding.message)).toEqual([
      'stale or failed rehearsal record: migration.sql changed after the rehearsal (its SHA-256 differs from the record)',
    ]);
  }, 600_000);
});

describe('a backup under concurrent writes is one consistent snapshot (NT-REC-003-a partial)', () => {
  it('[NT-REC-003-a] (partial) inserts committed while pg_dump runs are in neither the manifest nor the archive: the restore still verifies', async () => {
    const source = await sourceWithFixture();
    const writer = await db.superuser(source);
    let writing = true;
    let written = 0;
    const load = (async () => {
      while (writing) {
        await writer.query("INSERT INTO public.zz_rehearsal_child (parent_id, note) VALUES (1, 'concurrent')");
        written += 1;
      }
    })();
    const archive = archivePath();
    let backup: BackupResult;
    try {
      backup = await runBackup({
        database: source,
        outDir: join(work, 'backup-live'),
        archivePath: archive,
        connect: () => session(source),
        archive: containerArchive(),
      });
    } finally {
      writing = false;
      await load;
      await writer.end();
    }
    expect(written).toBeGreaterThan(0);
    const report = await runVerifyRestore(verifyOptions(backup, 'rehearsal_live', archive, false));
    expect(report.differences).toEqual([]);
    expect(report.verdict).toBe('pass');
  }, 300_000);
});

/**
 * C4 harness proof (D-ORCH-160, D-TASK034-14): `main` of db:backup and db:verify-restore with their production
 * dependencies (argument parsing, the URL rules, the privileged connections, 00-roles.sql, the archive tool of
 * `composeArchiveTool` with the real process runner `runProcess`, report and exit code), with ONE substitution: the
 * runner turns the `docker compose [-p <project>] exec -T <service>` prefix into `docker exec -i <harness container>`,
 * the same no-TTY exec with stdin attached. pg_dump streams the binary archive to a host file over the docker CLI's
 * stdout; pg_restore reads it from the host over stdin. Prisma calls take the shared PRISMA_TREE_LOCK, as the harness
 * does. Not proven here: Compose's own lookup of the project and service (the prefix is pinned below and by
 * pg-archive.test.ts) and the stack's DATABASE_* values.
 */
describe('db:backup and db:verify-restore CLI entry points (C4 harness proof)', () => {
  const PROJECT = 'harness_c4';
  const outDir = join(work, 'cli-backup');
  /** Every runner call: the Compose prefix the CLI built, and the in-container command. */
  const calls: { prefix: string[]; command: string[] }[] = [];
  let source: string;

  const harnessRunner: ProcessRunner = (request) => {
    const exec = request.args.indexOf('exec');
    calls.push({ prefix: request.args.slice(0, exec + 3), command: request.args.slice(exec + 3) });
    return runProcess({ ...request, args: ['exec', '-i', db.container.getId(), ...request.args.slice(exec + 3)] });
  };

  interface Sink {
    lines: string[];
    errors: string[];
  }
  const newSink = (): Sink => ({ lines: [], errors: [] });
  const write = (sink: Sink) => ({ write: (line: string) => sink.lines.push(line), writeError: (line: string) => sink.errors.push(line) });
  const backupDeps = (sink: Sink) => ({
    ...BACKUP_DEPENDENCIES,
    archive: (target: ArchiveTarget) => composeArchiveTool({ ...target, run: harnessRunner }),
    ...write(sink),
  });
  const verifyDeps = (sink: Sink) => ({
    ...VERIFY_RESTORE_DEPENDENCIES,
    archive: (target: ArchiveTarget) => composeArchiveTool({ ...target, run: harnessRunner }),
    migrateStatus: (env: NodeJS.ProcessEnv) => withFileLock(PRISMA_TREE_LOCK, () => VERIFY_RESTORE_DEPENDENCIES.migrateStatus(env)),
    ...write(sink),
  });

  /** The process environment without any database or bootstrap variable, plus the harness URLs and role passwords. */
  const cliEnv = (database: string): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (!/^(DATABASE_|SHADOW_DATABASE_|BOOTSTRAP_)/.test(name)) env[name] = value;
    }
    return {
      ...env,
      DATABASE_BOOTSTRAP_URL: db.bootstrapConnection(database).connectionString,
      DATABASE_MIGRATOR_URL: db.migratorUrl(database),
      BOOTSTRAP_MIGRATOR_PASSWORD: db.passwords.migrator,
      BOOTSTRAP_APP_PASSWORD: db.passwords.app,
    };
  };
  const secrets = (): string[] => [
    decodeURIComponent(new URL(db.bootstrapConnection('postgres').connectionString).password),
    db.passwords.migrator,
    db.passwords.app,
  ];
  const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

  beforeAll(async () => {
    source = await sourceWithFixture();
  }, 300_000);

  it('[NT-REC-003-a] (partial) db:backup main: exit 0, a binary archive streamed to the host, the manifest and schema files, the totals in its line', async () => {
    const sink = newSink();
    const code = await backupMain(['--out', outDir, '--project', PROJECT], cliEnv(source), backupDeps(sink));
    expect(sink.errors).toEqual([]);
    expect(code).toBe(0);
    expect(readdirSync(outDir).sort()).toEqual(['manifest.json', 'platform.dump', 'schema.sql']);
    const archive = readFileSync(join(outDir, 'platform.dump'));
    expect(archive.subarray(0, 5).toString('latin1')).toBe('PGDMP'); // the custom-format magic, byte for byte
    expect(archive.includes(0)).toBe(true); // binary content survived the docker CLI's stdout
    const manifest = parseManifest(JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as unknown);
    const totals = manifestTotals(manifest);
    expect(manifest.database).toBe(source);
    expect(manifest.migrationHead).toBe(listMigrations(repositoryMigrations).at(-1));
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatch(
      new RegExp(
        `^\\[db:backup\\] ${source}: ${String(totals.tables)} tables, ${totals.rows} rows, migration head ${String(manifest.migrationHead)}; manifest sha256 [0-9a-f]{64}; written to `,
      ),
    );
    // The CLI built the Compose prefix from --project and the URL's user; the tools ran inside the container.
    expect(calls.map((call) => call.prefix)).toEqual([
      ['compose', '-p', PROJECT, 'exec', '-T', 'postgres'],
      ['compose', '-p', PROJECT, 'exec', '-T', 'postgres'],
    ]);
    expect(calls[0]?.command).toEqual([
      'timeout',
      '-k',
      '10',
      '3600',
      'pg_dump',
      '--format=custom',
      '--username',
      SUPERUSER,
      '--dbname',
      source,
      '--snapshot',
      expect.stringMatching(/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{1,8}$/i),
    ]);
    expect(calls[1]?.command.slice(4, 6)).toEqual(['pg_dump', '--schema-only']);
    for (const secret of secrets()) expect(sink.lines.join('\n')).not.toContain(secret);
  }, 300_000);

  it('db:backup refuses a folder that holds a backup (exit 1, one line), and the runner never writes over an existing archive (wx)', async () => {
    const before = sha256(join(outDir, 'platform.dump'));
    const sink = newSink();
    expect(await backupMain(['--out', outDir], cliEnv(source), backupDeps(sink))).toBe(1);
    expect(sink.errors).toEqual(['[db:backup] the backup folder must be new or empty (a backup is never written over another)']);
    // The runner's own guard: an archive path that exists is opened with `wx` and refused; nothing is written.
    const other = join(work, 'cli-backup-wx');
    await expect(
      runBackup({
        database: source,
        outDir: other,
        archivePath: join(outDir, 'platform.dump'),
        connect: () => session(source),
        archive: composeArchiveTool({ user: SUPERUSER, run: harnessRunner }),
      }),
    ).rejects.toThrow(/^pg_dump exited with null: /);
    expect(sha256(join(outDir, 'platform.dump'))).toBe(before);
    expect(readdirSync(other)).toEqual([]);
  }, 300_000);

  it('[NT-REC-003-a] (partial) db:verify-restore main: exit 0, pg_restore fed from the host archive over stdin, the report totals equal the manifest, the scratch database dropped', async () => {
    const calledBefore = calls.length;
    const sink = newSink();
    const code = await verifyMain(
      ['--backup', outDir, '--scratch', 'rehearsal_cli', '--project', PROJECT],
      cliEnv(source),
      verifyDeps(sink),
    );
    expect(sink.errors).toEqual([]);
    expect(code).toBe(0);
    const manifest = parseManifest(JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as unknown);
    const totals = manifestTotals(manifest);
    const report = JSON.parse(readFileSync(join(outDir, REPORT_FILE), 'utf8')) as Record<string, unknown> & { restoreMs: number };
    expect(report).toMatchObject({
      format: REPORT_FORMAT,
      verdict: 'pass',
      scratchDatabase: 'rehearsal_cli',
      scratchKept: false,
      totals,
      differences: [],
      orphans: [],
      schemaDiff: { onlyBefore: [], onlyAfter: [] },
      migrateDeploy: null,
      migrateStatus: { ok: true, detail: 'up to date', pending: [], failed: [] },
    });
    expect(sink.lines).toEqual([
      `[db:verify-restore] PASS: ${String(totals.tables)} tables, ${totals.rows} rows, restore ${String(report.restoreMs)} ms; report ${REPORT_FILE} in the backup folder`,
    ]);
    const restore = calls.slice(calledBefore).find((call) => call.command[4] === 'pg_restore');
    expect(restore?.prefix).toEqual(['compose', '-p', PROJECT, 'exec', '-T', 'postgres']);
    expect(restore?.command).toEqual([
      'timeout',
      '-k',
      '10',
      '3600',
      'pg_restore',
      '--exit-on-error',
      '--username',
      SUPERUSER,
      '--dbname',
      'rehearsal_cli',
    ]);
    expect(await databaseExists('rehearsal_cli')).toBe(false);
  }, 300_000);

  it('db:verify-restore main: a truncated archive fails pg_restore (exit 1, its masked error line, no report) and the scratch database is dropped; a bad flag is refused', async () => {
    const truncated = join(work, 'cli-backup-truncated');
    mkdirSync(truncated);
    for (const file of ['manifest.json', 'schema.sql']) cpSync(join(outDir, file), join(truncated, file));
    const archive = readFileSync(join(outDir, 'platform.dump'));
    writeFileSync(join(truncated, 'platform.dump'), archive.subarray(0, Math.floor(archive.length / 2)));
    const sink = newSink();
    const code = await verifyMain(['--backup', truncated, '--scratch', 'rehearsal_cli_cut'], cliEnv(source), verifyDeps(sink));
    expect(code).toBe(1);
    expect(sink.lines).toEqual([]);
    expect(sink.errors).toHaveLength(1);
    expect(sink.errors[0]).toMatch(/^\[db:verify-restore\] pg_restore exited with 1: pg_restore: error: /);
    expect(readdirSync(truncated).sort()).toEqual(['manifest.json', 'platform.dump', 'schema.sql']);
    expect(await databaseExists('rehearsal_cli_cut')).toBe(false);
    const refused = newSink();
    expect(await verifyMain(['--backup', outDir, '--bogus'], cliEnv(source), verifyDeps(refused))).toBe(1);
    expect(refused.errors).toEqual(['[db:verify-restore] unknown flag --bogus']);
  }, 300_000);

  it('the npm script entries (`tsx tools/db/<tool>.ts`) start main and set the exit code, with one stderr line and no value', () => {
    const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    for (const [script, tool] of [
      ['tools/db/backup.ts', 'db:backup'],
      ['tools/db/verify-restore.ts', 'db:verify-restore'],
    ] as const) {
      const result = runNode([tsxCli, script, '--bogus'], { cwd: repoRoot, env: cliEnv(source), timeoutMs: 120_000 });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      // Only the tool's line counts (Node may add its own warnings on stderr).
      expect(result.stderr.split(/\r?\n/).filter((line) => line.startsWith('['))).toEqual([`[${tool}] unknown flag --bogus`]);
      for (const secret of secrets()) expect(result.stderr).not.toContain(secret);
    }
  }, 300_000);
});
