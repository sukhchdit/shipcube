/**
 * Backup and restore rehearsal on PostgreSQL 18 (data-model.md §8.6 with the SEC-P3-03 amendment; NFR-REC-003,
 * NFR-DATA-004; CLAUDE.md §5 Database; TASK-034). Drivers: tools/db/backup.ts and tools/db/verify-restore.ts; the
 * archive tool runs pg_dump / pg_restore inside the Testcontainers PostgreSQL container as the superuser (the CLI does
 * the same in the Compose `postgres` service).
 *
 * The source is the fully migrated platform database plus fixture tables that exercise the row checksum (numeric,
 * float, bytea, jsonb, interval, timestamptz, NULLs), a foreign key, a partitioned table with a foreign key and identity
 * sequences. The scratch database gets only the database-level 00-roles.sql before pg_restore.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runBackup, type BackupResult } from '../../../tools/db/backup.js';
import { connectPrivileged, reapplyDatabaseLevel } from '../../../tools/db/bootstrap.js';
import { lintRehearsals } from '../../../tools/db/lint-migrations.js';
import { errorSummary, type ArchiveTool } from '../../../tools/db/pg-archive.js';
import { pgSession, type ClosableSession } from '../../../tools/db/rehearsal-cli.js';
import { findOrphans } from '../../../tools/db/rehearsal-manifest.js';
import { RECORD_FILE } from '../../../tools/db/rehearsal-record.js';
import { listMigrations } from '../../../tools/db/up-down-up.js';
import {
  runVerifyRestore,
  verifyRestoredDatabase,
  writeRehearsalRecord,
  type VerifyRestoreOptions,
} from '../../../tools/db/verify-restore.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { PlatformPostgres, SUPERUSER } from '../harness/postgres.js';

const repoRoot = findRepoRoot();
const repositoryMigrations = join(repoRoot, 'prisma', 'migrations');
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

describe('backup and restore rehearsal (NFR-REC-003)', () => {
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

  it('[NT-REC-003-a] the manifest fingerprints every table (partitions included) at the migration head', () => {
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

  it('[NT-REC-003-a] [NT-DATA-004-c] restore into a scratch database: row counts and checksums equal, 0 orphans, schema equal, migrate status up to date with the root config (SPK-08 F-01)', async () => {
    const report = await runVerifyRestore(verifyOptions(backup, 'rehearsal_ok', archive, true));
    expect(report.differences).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.schemaDiff).toEqual({ onlyBefore: [], onlyAfter: [] });
    expect(report.migrateStatus).toEqual({ ok: true, detail: 'up to date' });
    expect(report.verdict).toBe('pass');
    expect(report.totals.tables).toBe(backup.manifest.tables.length);
    expect(report.restoredManifestSha256).not.toBe(report.source.manifestSha256); // the database name and time differ
    expect(await databaseExists('rehearsal_ok')).toBe(true);
  }, 300_000);

  it('[NT-REC-003-a] negative controls on the restored database: a deleted row, a changed row and an orphan each fail the verification', async () => {
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

  it('[NT-REC-003-a] a tampered manifest fails the verification, and the scratch database is dropped afterwards', async () => {
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

  it('[NT-DATA-004-c] the passed rehearsal becomes the record that lets a data-changing migration through the linter; an edit after it does not pass', async () => {
    const report = await runVerifyRestore(verifyOptions(backup, 'rehearsal_record', archive, false));
    expect(report.verdict).toBe('pass');
    const root = join(work, 'migrations');
    const head = backup.manifest.migrationHead as string;
    mkdirSync(join(root, head), { recursive: true });
    writeFileSync(join(root, head, 'migration.sql'), readFileSync(join(repositoryMigrations, head, 'migration.sql')));
    const name = '29991231000000_rehearsal_probe';
    mkdirSync(join(root, name));
    const sql =
      "-- migration-kind: migrate\n-- data-changing: yes\n-- reversible: yes\nUPDATE public.zz_rehearsal_child SET note = '' WHERE note IS NULL;\n";
    writeFileSync(join(root, name, 'migration.sql'), sql);
    expect(lintRehearsals(root).map((finding) => finding.rule)).toEqual(['R']);
    writeRehearsalRecord(root, name, backup.manifest, report);
    expect(JSON.parse(readFileSync(join(root, name, RECORD_FILE), 'utf8'))).toMatchObject({
      migration: name,
      verification: { verdict: 'pass' },
    });
    expect(lintRehearsals(root)).toEqual([]);
    writeFileSync(join(root, name, 'migration.sql'), `${sql}DELETE FROM public.zz_rehearsal_child WHERE note = '';\n`);
    expect(lintRehearsals(root).map((finding) => finding.message)).toEqual([
      'stale or failed rehearsal record: migration.sql changed after the rehearsal (its SHA-256 differs from the record)',
    ]);
  }, 300_000);
});

describe('a backup under concurrent writes is one consistent snapshot', () => {
  it('[NT-REC-003-a] inserts committed while pg_dump runs are in neither the manifest nor the archive: the restore still verifies', async () => {
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
