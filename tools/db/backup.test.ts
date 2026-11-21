/**
 * `db:backup` (data-model.md §8.6 step 2; NT-REC-003-a; TASK-034): one exported snapshot for the archive and the
 * manifest, the files it writes and the CLI's refusals. The PostgreSQL 18 run is
 * prisma/tests/migrations/backup-restore.int.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { BACKUP_DEPENDENCIES, BACKUP_FILES, main, runBackup, schemaSnapshot, type BackupDependencies } from './backup.js';
import { LOAD_TIME_CODE_SQL, type LoadTimeCodeRow } from './load-time-code.js';
import type { ArchiveTool } from './pg-archive.js';
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, privateFiles, type PrivateFs } from './private-files.js';
import {
  CLUSTER_IDENTIFIER_SQL,
  MIGRATION_TABLE_SQL,
  SEQUENCES_SQL,
  TABLES_SQL,
  manifestSha256,
  parseManifest,
  sha256Hex,
} from './rehearsal-manifest.js';
import { defaultRunDir, type ClosableSession } from './rehearsal-cli.js';

/** Yields once, as a real database or process call would. */
const tick = (): Promise<void> => Promise.resolve();

const work = mkdtempSync(join(tmpdir(), 'backup-unit-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const SNAPSHOT = '00000003-0000001B-1';
const NOW = new Date('2026-11-21T10:00:00.000Z');
let folders = 0;
const folder = () => {
  folders += 1;
  return join(work, `run-${String(folders)}`);
};

/** A C17 finding of the gate case: a CHECK that calls a migration routine (D-ARCH-236). */
const PLANTED: LoadTimeCodeRow = {
  kind: 'table check',
  object: 'public.a ck_a__probe',
  via: 'call',
  reference: 'public.zz_record(integer)',
  reason: 'not built in',
};

function fakes(options: { failDump?: boolean; loadTime?: readonly LoadTimeCodeRow[] } = {}) {
  const statements: string[] = [];
  const events: string[] = [];
  let ended = false;
  const session: ClosableSession = {
    async query<T extends object>(sql: string): Promise<T[]> {
      await tick();
      statements.push(sql);
      events.push(sql.split(' ').slice(0, 2).join(' '));
      if (sql.includes('pg_export_snapshot')) return [{ snapshot: SNAPSHOT }] as T[];
      if (sql === SEQUENCES_SQL) return [{ schema: 'public', name: 's', last_value: '7' }] as T[];
      if (sql === TABLES_SQL) return [{ schema: 'public', name: 'a' }] as T[];
      if (sql.includes('AS rows')) return [{ rows: '2', checksum: '42' }] as T[];
      if (sql === MIGRATION_TABLE_SQL) return [{ present: false }] as T[];
      if (sql === CLUSTER_IDENTIFIER_SQL) return [{ system_identifier: '7300000000000000001' }] as T[];
      if (sql === LOAD_TIME_CODE_SQL) return [...(options.loadTime ?? [])] as T[];
      return [];
    },
    async end() {
      await tick();
      ended = true;
    },
  };
  const archive: ArchiveTool = {
    async dump(request) {
      await tick();
      events.push(`dump ${request.database} ${request.snapshot}`);
      if (options.failDump === true) throw new Error('pg_dump exited with 1: no error line');
      writeFileSync(request.archive, 'archive');
    },
    async dumpSchema(request) {
      await tick();
      events.push(`schema ${request.database} ${String(request.snapshot)}`);
      return '--\n-- PostgreSQL database dump\n--\n\\restrict abc\nCREATE TABLE public.a (id integer);\n\\unrestrict abc\n';
    },
    async restore() {
      await tick();
      throw new Error('not used');
    },
  };
  return { session, archive, statements, events, ended: () => ended };
}

describe('runBackup', () => {
  it('[NT-REC-003-a] exports one snapshot, reads sequences, dumps under it, fingerprints in the same transaction, then commits', async () => {
    const run = fakes();
    const outDir = folder();
    const result = await runBackup({
      database: 'platform',
      outDir,
      connect: () => Promise.resolve(run.session),
      archive: run.archive,
      now: () => NOW,
    });
    expect(run.events.filter((event) => !event.startsWith('SET '))).toEqual([
      'BEGIN ISOLATION',
      'SELECT pg_catalog.pg_export_snapshot()',
      `SELECT schemaname`,
      `dump platform ${SNAPSHOT}`,
      `schema platform ${SNAPSHOT}`,
      'SELECT n.nspname',
      'SELECT pg_catalog.count(*)::pg_catalog.text',
      "SELECT pg_catalog.current_setting('server_version_num')",
      'SELECT system_identifier::pg_catalog.text', // D-ARCH-235: the source cluster, in the snapshot transaction
      'WITH site', // D-ARCH-236: the C17 query, in the snapshot transaction
      "SELECT pg_catalog.to_regclass('public._prisma_migrations')",
      'COMMIT',
    ]);
    expect(run.statements).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(run.ended()).toBe(true);
    expect(result.manifest).toMatchObject({
      database: 'platform',
      takenAt: NOW.toISOString(),
      migrationHead: null,
      tables: [{ table: 'public.a', rows: '2', checksum: '42' }],
      sequences: [{ sequence: 'public.s', lastValue: '7' }],
      cluster: { systemIdentifier: '7300000000000000001' },
      loadTimeCode: [],
    });
    expect(result.schema).toBe('CREATE TABLE public.a (id integer)'); // normalised: comments, psql meta-commands and ; dropped
    expect(result.manifest.schemaSha256).toBe(sha256Hex(result.schema));
    const written = parseManifest(JSON.parse(readFileSync(join(outDir, BACKUP_FILES.manifest), 'utf8')) as unknown);
    expect(manifestSha256(written)).toBe(result.manifestSha256);
    expect(readFileSync(join(outDir, BACKUP_FILES.schema), 'utf8')).toBe(result.schema);
    expect(readFileSync(join(outDir, BACKUP_FILES.archive), 'utf8')).toBe('archive');
  });

  it('rolls back, ends the session and writes no manifest when the dump fails', async () => {
    const run = fakes({ failDump: true });
    const outDir = folder();
    await expect(
      runBackup({ database: 'platform', outDir, connect: () => Promise.resolve(run.session), archive: run.archive }),
    ).rejects.toThrow(/pg_dump exited/);
    expect(run.statements.at(-1)).toBe('ROLLBACK');
    expect(run.ended()).toBe(true);
    expect(existsSync(join(outDir, BACKUP_FILES.manifest))).toBe(false);
  });

  it('never writes into a folder that holds files, and refuses a database name that is not plain', async () => {
    const run = fakes();
    const outDir = folder();
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'old'), 'x');
    await expect(
      runBackup({ database: 'platform', outDir, connect: () => Promise.resolve(run.session), archive: run.archive }),
    ).rejects.toThrow(/must be new or empty/);
    await expect(
      runBackup({ database: 'a=b', outDir: folder(), connect: () => Promise.resolve(run.session), archive: run.archive }),
    ).rejects.toThrow(/plain lower-case/);
    expect(run.statements).toEqual([]);
  });
});

describe('owner-only artefacts (PR034-SEC-02)', () => {
  it('[PR034-SEC-02] creates the folder 0o700 and writes manifest.json and schema.sql 0o600, exclusively (platform-independent)', async () => {
    const calls: string[] = [];
    const fs: PrivateFs = {
      platform: 'linux',
      mkdirSync: (path, options) => {
        calls.push(`mkdir ${path} ${options.mode.toString(8)} ${String(options.recursive)}`);
        mkdirSync(path, { recursive: true });
      },
      chmodSync: (path, mode) => calls.push(`chmod ${path} ${mode.toString(8)}`),
      writeFileSync: (path, data, options) => {
        calls.push(`write ${path} ${options.flag} ${options.mode.toString(8)}`);
        writeFileSync(path, data, { flag: options.flag });
      },
      createWriteStream: () => {
        throw new Error('not used by runBackup');
      },
    };
    const run = fakes();
    const outDir = folder();
    await runBackup({
      database: 'platform',
      outDir,
      connect: () => Promise.resolve(run.session),
      archive: run.archive,
      files: privateFiles(fs),
    });
    expect(calls).toEqual([
      `mkdir ${outDir} 700 true`,
      `chmod ${outDir} 700`, // an existing empty folder keeps its old mode otherwise
      `write ${join(outDir, BACKUP_FILES.schema)} wx 600`,
      `write ${join(outDir, BACKUP_FILES.manifest)} wx 600`,
    ]);
  });

  (process.platform === 'win32' ? it.skip : it)(
    '[PR034-SEC-02] POSIX: the folder, the manifest and the schema are not readable by group or others',
    async () => {
      const run = fakes();
      const outDir = folder();
      await runBackup({ database: 'platform', outDir, connect: () => Promise.resolve(run.session), archive: run.archive });
      expect(statSync(outDir).mode & 0o777).toBe(PRIVATE_DIR_MODE);
      for (const file of [BACKUP_FILES.manifest, BACKUP_FILES.schema])
        expect(statSync(join(outDir, file)).mode & 0o777).toBe(PRIVATE_FILE_MODE);
    },
  );
});

describe('schemaSnapshot', () => {
  it('normalises a schema dump and drops optimizer statistics, which change with ANALYZE, not with the schema', () => {
    const dump = [
      'SET statement_timeout = 0;',
      'CREATE TABLE public.b (id integer);',
      "SELECT * FROM pg_catalog.pg_restore_relation_stats('version', '180001'::integer, 'schemaname', 'public', 'relname', 'b', 'reltuples', '5'::real);",
      "SELECT * FROM pg_catalog.pg_restore_attribute_stats('schemaname', 'public', 'relname', 'b', 'attname', 'id');",
      'CREATE TABLE public.a (id integer);',
    ].join('\n');
    expect(schemaSnapshot(dump)).toBe('CREATE TABLE public.a (id integer);\nCREATE TABLE public.b (id integer)');
    expect(schemaSnapshot('')).toBe('');
  });
});

describe('db:backup main', () => {
  const deps = (
    run: ReturnType<typeof fakes>,
    lines: string[],
    errors: string[],
    seen: { url?: string; archive?: object } = {},
  ): BackupDependencies => ({
    connect: async (url) => {
      await tick();
      seen.url = url;
      return run.session;
    },
    archive: (options) => {
      seen.archive = options;
      return run.archive;
    },
    now: () => NOW,
    write: (line) => lines.push(line),
    writeError: (line) => errors.push(line),
  });

  it('backs up the loopback DATABASE_BOOTSTRAP_URL through the Compose service as the URL user', async () => {
    const run = fakes();
    const lines: string[] = [];
    const errors: string[] = [];
    const seen: { url?: string; archive?: object } = {};
    const outDir = folder();
    const url = 'postgresql://postgres@127.0.0.1:5432/platform';
    expect(await main(['--out', outDir, '--service', 'db'], { DATABASE_BOOTSTRAP_URL: url }, deps(run, lines, errors, seen))).toBe(0);
    expect(seen).toEqual({ url, archive: { service: 'db', user: 'postgres' } });
    expect(errors).toEqual([]);
    expect(lines[0]).toMatch(/^\[db:backup\] platform: 1 tables, 2 rows, migration head null; manifest sha256 [0-9a-f]{64}; written to /);
  });

  it('[D-ARCH-236] the load-time gate: with a C17 finding main prints one line with the count and the objects and returns 1; the archive, the manifest (with the finding) and the schema stay written', async () => {
    const run = fakes({ loadTime: [PLANTED] });
    const lines: string[] = [];
    const errors: string[] = [];
    const outDir = folder();
    expect(
      await main(['--out', outDir], { DATABASE_BOOTSTRAP_URL: 'postgresql://postgres@127.0.0.1:5432/platform' }, deps(run, lines, errors)),
    ).toBe(1);
    expect(lines).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^\[db:backup\] load-time gate: 1 load-time finding\(s\): table check public\.a ck_a__probe: public\.zz_record\(integer\) \(not built in\)\. A restore would run this code as the loading superuser, so db:verify-restore refuses this backup \(written to .+\): remove the objects with a migration and take a new backup; never edit the manifest/,
    );
    expect(readdirSync(outDir).sort()).toEqual([BACKUP_FILES.manifest, BACKUP_FILES.archive, BACKUP_FILES.schema].sort());
    const manifest = parseManifest(JSON.parse(readFileSync(join(outDir, BACKUP_FILES.manifest), 'utf8')) as unknown);
    expect(manifest.loadTimeCode).toEqual([
      { kind: 'table check', object: 'public.a ck_a__probe', reference: 'public.zz_record(integer)', reason: 'not built in' },
    ]);
    expect(run.statements).toContain('COMMIT');
  });

  it('refuses a remote or missing URL and an unknown flag with one line, before connecting', async () => {
    for (const [argv, env, message] of [
      [[], {}, '[db:backup] DATABASE_BOOTSTRAP_URL is not set'],
      [[], { DATABASE_BOOTSTRAP_URL: 'postgresql://u@db.example.com/platform' }, /must name a loopback host/],
      [['--force'], { DATABASE_BOOTSTRAP_URL: 'postgresql://u@localhost/platform' }, '[db:backup] unknown flag --force'],
    ] as const) {
      const run = fakes();
      const errors: string[] = [];
      expect(await main([...argv], env, deps(run, [], errors))).toBe(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(message);
      expect(run.statements).toEqual([]);
    }
  });

  it('defaults to the postgres service and role, and to a stamped folder under reports/rehearsal', async () => {
    const seen: { url?: string; archive?: object } = {};
    const run = fakes();
    const lines: string[] = [];
    // A unique instant, so the default folder (in the git-ignored reports/) is new; it is removed afterwards.
    const later = new Date(Date.UTC(2001, 0, 1) + process.pid * 1000);
    const expected = defaultRunDir('backup', later);
    try {
      const result = await main(
        [],
        { DATABASE_BOOTSTRAP_URL: 'postgresql://localhost/platform' },
        { ...deps(run, lines, [], seen), now: () => later },
      );
      expect(result).toBe(0);
      expect(seen.archive).toEqual({ service: 'postgres', user: 'postgres' });
      expect(existsSync(join(expected, BACKUP_FILES.manifest))).toBe(true);
      expect(lines[0]).toMatch(/written to reports[\\/]rehearsal[\\/]\d{8}T\d{6}Z-backup$/);
    } finally {
      rmSync(expected, { recursive: true, force: true });
    }
  });

  it('wires the production dependencies', () => {
    expect(Object.keys(BACKUP_DEPENDENCIES).sort()).toEqual(['archive', 'connect', 'now', 'write', 'writeError']);
    expect(BACKUP_DEPENDENCIES.archive({ service: 'postgres', user: 'postgres' })).toHaveProperty('dump');
    expect(BACKUP_DEPENDENCIES.now()).toBeInstanceOf(Date);
  });
});
