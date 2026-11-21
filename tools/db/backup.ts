/**
 * `npm run db:backup` — step 2 of the restore rehearsal (data-model.md §8.6; NFR-REC-003, NFR-DATA-004; CLAUDE.md §5
 * Database; TASK-034): a `pg_dump --format=custom` archive of the database plus a manifest that fingerprints it
 * (tools/db/rehearsal-manifest.ts), taken from ONE snapshot. The manifest session opens a `REPEATABLE READ READ ONLY`
 * transaction, exports its snapshot and runs both `pg_dump` calls under it (`--snapshot`), so a live stack gives an
 * archive and a manifest of the same instant. Sequences are read before the dump starts (they are not transactional;
 * the restore may be ahead, never behind). The dump runs as the bootstrap superuser: FORCE RLS applies to the table
 * owners, so only a role that bypasses RLS dumps every row (data-model OI-16).
 *
 * The load-time gate (data-model §8.6 second amendment; D-ARCH-236): in the same snapshot the manifest records
 * `loadTimeCode`, the findings of catalog query C17 (tools/db/load-time-code.ts), and `cluster.systemIdentifier`, the
 * source cluster (D-ARCH-235). With a finding the archive, the manifest and the schema are still written, so the
 * finding can be read, and the CLI exits 1 with one line naming the objects; db:verify-restore refuses that backup.
 *
 * Output folder (default `reports/rehearsal/<UTC stamp>-backup/`, git-ignored): `platform.dump`, `manifest.json`,
 * `schema.sql` (the normalised schema the manifest digests). Never commit it: the archive holds every row. The folder
 * (and any parent it creates) is `0o700` and the files `0o600` (PR034-SEC-02; tools/db/private-files.ts).
 *
 * CLI: DATABASE_BOOTSTRAP_URL (a loopback host or a Unix socket only); `--out <dir>`, `--service <compose service>`
 * (default `postgres`), `--project <compose project>` (default: the project Compose derives from the working
 * directory; a task worktree has its own). The archive tool runs `pg_dump` in that Compose service over its local
 * socket. Exit 0 = backup written, 1 = refused, failed or stopped by the load-time gate (one stderr line, no URL or
 * value).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { connectPrivileged } from './bootstrap.js';
import { REPO_ROOT } from './lint-migrations.js';
import { checkDatabaseName, composeArchiveTool, type ArchiveTool } from './pg-archive.js';
import { PRIVATE_FILES, type PrivateFiles } from './private-files.js';
import {
  RehearsalError,
  applySessionSettings,
  captureManifest,
  captureSequences,
  loadTimeSummary,
  manifestSha256,
  manifestTotals,
  type BackupManifest,
} from './rehearsal-manifest.js';
import {
  archiveTarget,
  defaultRunDir,
  localDatabaseUrl,
  messageOf,
  parseFlags,
  pgSession,
  type ArchiveTarget,
  type ClosableSession,
} from './rehearsal-cli.js';
import { normaliseSchemaDump } from './up-down-up.js';

export const BACKUP_FILES = { archive: 'platform.dump', manifest: 'manifest.json', schema: 'schema.sql' } as const;

/**
 * Optimizer statistics that PostgreSQL 18's pg_dump can emit (`pg_restore_relation_stats`, `pg_restore_attribute_stats`,
 * `pg_clear_*_stats`) change with ANALYZE, not with the schema, so they never take part in the comparison.
 */
const STATISTICS = /\bpg_(?:restore|clear)_(?:relation|attribute)_stats\(/;

/** The normalised schema of a `pg_dump --schema-only` text (`normaliseSchemaDump`) without statistics statements. */
export function schemaSnapshot(dump: string): string {
  return normaliseSchemaDump(dump)
    .split(';\n')
    .filter((statement) => statement !== '' && !STATISTICS.test(statement))
    .join(';\n');
}

export interface BackupOptions {
  readonly database: string;
  /** Folder for the manifest and the schema (created; must be empty). */
  readonly outDir: string;
  /** Where the archive tool writes the archive (default `<outDir>/platform.dump`; a container path for the harness). */
  readonly archivePath?: string;
  /** A privileged session on `database`. */
  readonly connect: () => Promise<ClosableSession>;
  readonly archive: ArchiveTool;
  readonly now?: () => Date;
  /** Owner-only folder and files (PR034-SEC-02); a fake in the unit tests. */
  readonly files?: PrivateFiles;
}

export interface BackupResult {
  readonly manifest: BackupManifest;
  readonly manifestSha256: string;
  readonly archivePath: string;
  /** The normalised schema the manifest digests. */
  readonly schema: string;
}

/** Takes the archive and the manifest from one exported snapshot and writes manifest.json and schema.sql. */
export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const database = checkDatabaseName(options.database);
  const files = options.files ?? PRIVATE_FILES;
  if (existsSync(options.outDir) && readdirSync(options.outDir).length > 0) {
    throw new RehearsalError('the backup folder must be new or empty (a backup is never written over another)');
  }
  files.makeDir(options.outDir);
  const archivePath = options.archivePath ?? join(options.outDir, BACKUP_FILES.archive);
  const now = options.now ?? (() => new Date());
  const session = await options.connect();
  try {
    await applySessionSettings(session);
    await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const [exported] = await session.query<{ snapshot: string }>('SELECT pg_catalog.pg_export_snapshot() AS snapshot');
    if (exported === undefined) throw new RehearsalError('pg_export_snapshot returned no row');
    const takenAt = now().toISOString();
    const sequences = await captureSequences(session);
    await options.archive.dump({ database, snapshot: exported.snapshot, archive: archivePath });
    const schema = schemaSnapshot(await options.archive.dumpSchema({ database, snapshot: exported.snapshot }));
    const manifest = await captureManifest(session, { database, takenAt, schema, sequences });
    await session.query('COMMIT');
    files.writeFile(join(options.outDir, BACKUP_FILES.schema), schema, true);
    files.writeFile(join(options.outDir, BACKUP_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`, true);
    return { manifest, manifestSha256: manifestSha256(manifest), archivePath, schema };
  } catch (error) {
    await session.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await session.end();
  }
}

/** Side effects of main, injectable for the unit tests. */
export interface BackupDependencies {
  readonly connect: (connectionString: string) => Promise<ClosableSession>;
  readonly archive: (options: ArchiveTarget) => ArchiveTool;
  readonly now: () => Date;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
}

export const BACKUP_DEPENDENCIES: BackupDependencies = {
  connect: async (connectionString) => pgSession(await connectPrivileged({ connectionString })),
  archive: (target) => composeArchiveTool(target),
  now: () => new Date(),
  write: (line) => process.stdout.write(`${line}\n`),
  writeError: (line) => process.stderr.write(`${line}\n`),
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: BackupDependencies = BACKUP_DEPENDENCIES,
): Promise<number> {
  try {
    const flags = parseFlags(argv, { values: ['out', 'service', 'project'], switches: [] });
    const target = localDatabaseUrl(env, 'DATABASE_BOOTSTRAP_URL');
    const outDir = flags.values.get('out') ?? defaultRunDir('backup', deps.now());
    const result = await runBackup({
      database: target.endpoint.database,
      outDir,
      connect: () => deps.connect(target.url),
      archive: deps.archive(archiveTarget(flags, target.user)),
      now: deps.now,
    });
    const totals = manifestTotals(result.manifest);
    const written = relative(REPO_ROOT, outDir) || outDir;
    if (result.manifest.loadTimeCode.length > 0) {
      // The load-time gate (D-ARCH-236): the files stay written, so the findings can be read; db:verify-restore refuses them.
      deps.writeError(
        `[db:backup] load-time gate: ${loadTimeSummary(result.manifest.loadTimeCode)}. A restore would run this code as the loading superuser, so db:verify-restore refuses this backup (written to ${written}): remove the objects with a migration and take a new backup; never edit the manifest (data-model 8.6, D-ARCH-236)`,
      );
      return 1;
    }
    deps.write(
      `[db:backup] ${result.manifest.database}: ${String(totals.tables)} tables, ${totals.rows} rows, migration head ${String(result.manifest.migrationHead)}; manifest sha256 ${result.manifestSha256}; written to ${written}`,
    );
    return 0;
  } catch (error) {
    deps.writeError(`[db:backup] ${messageOf(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
