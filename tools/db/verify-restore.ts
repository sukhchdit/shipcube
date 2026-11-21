/**
 * `npm run db:verify-restore` — steps 4 and 5 of the restore rehearsal (data-model.md §8.6 with the SEC-P3-03
 * amendment; NFR-REC-003, NFR-DATA-004; CLAUDE.md §5 Database; TASK-034). Exit 0 = pass.
 *
 *   1. Create an empty scratch database (`TEMPLATE template0`) on the same cluster as the bootstrap role; refuse a name
 *      that exists.
 *   2. Run ONLY the database-level bootstrap file `00-roles.sql` on it (roles, CONNECT, the role-in-database search
 *      path; everything schema-scoped comes from the archive, and the audit DDL guard's event triggers are restored
 *      last), then `pg_restore --exit-on-error`.
 *   3. Verify (`verifyRestoredDatabase`): the restored manifest equals the backup manifest (row count and row checksum
 *      per table, migration head, sequences not behind, normalised schema digest: owners, ACLs, RLS, policies, triggers
 *      and event triggers); generated anti-joins find no orphan for any foreign key; `prisma migrate status` through the
 *      pinned wrapper with the ROOT prisma.config.ts reports the schema up to date, which proves the generated
 *      `tables.external` audit-partition window holds on a restored database (SPK-08 F-01, D-ARCH-077 (1)).
 *   4. Drop the scratch database (unless `--keep`), write `restore-report.json` into the backup folder and, after a pass
 *      with `--migration <name>`, the rehearsal record `prisma/migrations/<name>/rehearsal.json` (rule R of the
 *      migration linter; tools/db/rehearsal-record.ts).
 *
 * Not verified here (D-TASK034-04): the RustFS bucket copy and document SHA-256 (no documents table yet), the audit
 * chain and anchors (TASK-116's verifier), the marker stream and the `/health/ready` smoke container (the CI job).
 *
 * CLI: DATABASE_BOOTSTRAP_URL and DATABASE_MIGRATOR_URL (loopback or Unix socket, same host and port),
 * BOOTSTRAP_MIGRATOR_PASSWORD / BOOTSTRAP_APP_PASSWORD (or `*_FILE`, as for db:bootstrap); `--backup <dir>` (required),
 * `--scratch <name>`, `--migration <name>`, `--service <compose service>`, `--keep`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { connectPrivileged, readRolePasswords, reapplyDatabaseLevel } from './bootstrap.js';
import { BACKUP_FILES, schemaSnapshot } from './backup.js';
import { REPO_ROOT, parseHeader } from './lint-migrations.js';
import { checkDatabaseName, composeArchiveTool, type ArchiveTool } from './pg-archive.js';
import {
  RehearsalError,
  applySessionSettings,
  captureManifest,
  captureSequences,
  compareManifests,
  findOrphans,
  manifestSha256,
  manifestTotals,
  parseManifest,
  type BackupManifest,
  type OrphanFinding,
} from './rehearsal-manifest.js';
import { RECORD_FILE, buildRehearsalRecord, recordText, rehearsalProblems } from './rehearsal-record.js';
import { localDatabaseUrl, messageOf, parseFlags, pgSession, utcStamp, withDatabase, type ClosableSession } from './rehearsal-cli.js';
import { quoteIdentifier } from './sql-text.js';
import { diffSnapshots, type PrismaRun, type SnapshotDiff } from './up-down-up.js';

export const REPORT_FORMAT = 'platform.restore-report/v1';
export const REPORT_FILE = 'restore-report.json';
/** Schema diff lines kept in a report (each side). */
const DIFF_LINES = 20;

export interface RestoreCheck {
  readonly verdict: 'pass' | 'fail';
  readonly restoredManifest: BackupManifest;
  readonly differences: readonly string[];
  readonly orphans: readonly OrphanFinding[];
  readonly schemaDiff: SnapshotDiff;
  readonly migrateStatus: { readonly ok: boolean; readonly detail: string };
}

export interface VerifyRestoredOptions {
  readonly manifest: BackupManifest;
  /** The source's normalised schema (schema.sql of the backup), for a readable diff; the digest decides. */
  readonly sourceSchema?: string;
  readonly database: string;
  /** A privileged session on the restored database. */
  readonly session: ClosableSession;
  readonly archive: ArchiveTool;
  /** `prisma migrate status` with the root config against the restored database, as the migrator. */
  readonly migrateStatus: () => Promise<PrismaRun>;
  readonly now?: () => Date;
}

const UP_TO_DATE = /Database schema is up to date/;

/** Step 3: compares a restored database with its backup manifest (the session stays open; the caller ends it). */
export async function verifyRestoredDatabase(options: VerifyRestoredOptions): Promise<RestoreCheck> {
  const { session } = options;
  await applySessionSettings(session);
  const sequences = await captureSequences(session);
  const schema = schemaSnapshot(await options.archive.dumpSchema({ database: options.database }));
  const restoredManifest = await captureManifest(session, {
    database: options.database,
    takenAt: (options.now ?? (() => new Date()))().toISOString(),
    schema,
    sequences,
  });
  const differences = compareManifests(options.manifest, restoredManifest);
  const orphans = await findOrphans(session);
  const fullDiff = options.sourceSchema === undefined ? { onlyBefore: [], onlyAfter: [] } : diffSnapshots(options.sourceSchema, schema);
  const schemaDiff = { onlyBefore: fullDiff.onlyBefore.slice(0, DIFF_LINES), onlyAfter: fullDiff.onlyAfter.slice(0, DIFF_LINES) };
  const status = await options.migrateStatus();
  const ok = status.status === 0 && UP_TO_DATE.test(status.stdout);
  const detail = ok
    ? 'up to date'
    : `exit ${String(status.status)}: ${`${status.stdout}\n${status.stderr}`.trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300)}`;
  const verdict = differences.length === 0 && orphans.length === 0 && ok ? 'pass' : 'fail';
  return { verdict, restoredManifest, differences, orphans, schemaDiff, migrateStatus: { ok, detail } };
}

export interface VerifyRestoreOptions {
  readonly manifest: BackupManifest;
  readonly sourceSchema?: string;
  readonly scratchDatabase: string;
  /** The archive as the archive tool reads it (a host path for Compose, a container path for the harness). */
  readonly archivePath: string;
  readonly archive: ArchiveTool;
  /** A privileged session on the maintenance database (`postgres`). */
  readonly admin: () => Promise<ClosableSession>;
  /** A privileged session on the scratch database. */
  readonly scratch: () => Promise<ClosableSession>;
  /** Runs the database-level bootstrap file (00-roles.sql) on the scratch database. */
  readonly prepareScratch: () => Promise<void>;
  readonly migrateStatus: () => Promise<PrismaRun>;
  readonly keepScratch?: boolean;
  readonly now?: () => Date;
  readonly clock?: () => number;
}

export interface RestoreReport {
  readonly format: typeof REPORT_FORMAT;
  readonly verdict: 'pass' | 'fail';
  readonly source: {
    readonly database: string;
    readonly manifestSha256: string;
    readonly migrationHead: string | null;
    readonly takenAt: string;
  };
  readonly scratchDatabase: string;
  readonly scratchKept: boolean;
  readonly restoreMs: number;
  readonly verifiedAt: string;
  readonly totals: { readonly tables: number; readonly rows: string };
  readonly restoredManifestSha256: string;
  readonly differences: readonly string[];
  readonly orphans: readonly OrphanFinding[];
  readonly schemaDiff: SnapshotDiff;
  readonly migrateStatus: { readonly ok: boolean; readonly detail: string };
}

async function withSession<T>(open: () => Promise<ClosableSession>, work: (session: ClosableSession) => Promise<T>): Promise<T> {
  const session = await open();
  try {
    return await work(session);
  } finally {
    await session.end();
  }
}

/** Steps 1-4 without the files: restore into a new scratch database, verify, drop it (unless kept). */
export async function runVerifyRestore(options: VerifyRestoreOptions): Promise<RestoreReport> {
  const scratch = checkDatabaseName(options.scratchDatabase);
  if (scratch === options.manifest.database) throw new RehearsalError('the scratch database must not be the backed-up database');
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  await withSession(options.admin, async (admin) => {
    const existing = await admin.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [scratch]);
    if (existing.length > 0) throw new RehearsalError(`database ${scratch} exists: choose another --scratch name (it is never reused)`);
    await admin.query(`CREATE DATABASE ${quoteIdentifier(scratch)} TEMPLATE template0`);
  });
  try {
    await options.prepareScratch();
    const started = clock();
    await options.archive.restore({ database: scratch, archive: options.archivePath });
    const restoreMs = Math.round(clock() - started);
    const check = await withSession(options.scratch, (session) =>
      verifyRestoredDatabase({
        manifest: options.manifest,
        ...(options.sourceSchema === undefined ? {} : { sourceSchema: options.sourceSchema }),
        database: scratch,
        session,
        archive: options.archive,
        migrateStatus: options.migrateStatus,
        now,
      }),
    );
    return {
      format: REPORT_FORMAT,
      verdict: check.verdict,
      source: {
        database: options.manifest.database,
        manifestSha256: manifestSha256(options.manifest),
        migrationHead: options.manifest.migrationHead,
        takenAt: options.manifest.takenAt,
      },
      scratchDatabase: scratch,
      scratchKept: options.keepScratch === true,
      restoreMs,
      verifiedAt: now().toISOString(),
      totals: manifestTotals(check.restoredManifest),
      restoredManifestSha256: manifestSha256(check.restoredManifest),
      differences: check.differences,
      orphans: check.orphans,
      schemaDiff: check.schemaDiff,
      migrateStatus: check.migrateStatus,
    };
  } finally {
    if (options.keepScratch !== true) {
      await withSession(options.admin, (admin) => admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(scratch)} WITH (FORCE)`));
    }
  }
}

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]{1,100}$/;

/**
 * Writes `prisma/migrations/<migration>/rehearsal.json` for a passed report. Refuses a migration that is not declared
 * `data-changing: yes`, a failed report, and a backup whose migration head is not the migration just before this one.
 * Returns the record's path.
 */
export function writeRehearsalRecord(migrationsRoot: string, migration: string, manifest: BackupManifest, report: RestoreReport): string {
  if (!MIGRATION_NAME.test(migration)) throw new RehearsalError('--migration must be a migration directory name (<14 digits>_<name>)');
  const names = readdirSync(migrationsRoot)
    .filter((name) => statSync(join(migrationsRoot, name)).isDirectory())
    .sort();
  const index = names.indexOf(migration);
  const migrationFile = join(migrationsRoot, migration, 'migration.sql');
  if (index < 0 || !existsSync(migrationFile)) throw new RehearsalError(`migration ${migration} does not exist`);
  const migrationSql = readFileSync(migrationFile);
  if (parseHeader(migrationSql.toString('utf8')).dataChanging !== true) {
    throw new RehearsalError(`migration ${migration} is not declared "data-changing: yes"; it needs no rehearsal record`);
  }
  if (report.verdict !== 'pass') throw new RehearsalError('the verification failed: no rehearsal record is written');
  const previous = index === 0 ? null : (names[index - 1] as string);
  if (manifest.migrationHead !== previous) {
    throw new RehearsalError(
      `the backup's migration head ${String(manifest.migrationHead)} is not the migration before ${migration} (${String(previous)}): back up the database at that state`,
    );
  }
  const record = buildRehearsalRecord({
    migration,
    migrationSql,
    manifest,
    manifestSha256: report.source.manifestSha256,
    verifiedAt: report.verifiedAt,
    totals: report.totals,
  });
  const problems = rehearsalProblems(record, { migration, migrationSha256: record.migrationSha256, previous });
  if (problems.length > 0) throw new RehearsalError(`the record would not pass the linter: ${problems.join('; ')}`);
  const path = join(migrationsRoot, migration, RECORD_FILE);
  writeFileSync(path, recordText(record));
  return path;
}

/** Side effects of main, injectable for the unit tests. */
export interface VerifyRestoreDependencies {
  readonly connect: (connectionString: string) => Promise<ClosableSession>;
  readonly archive: (options: { service: string; user: string }) => ArchiveTool;
  readonly prepareScratch: (connectionString: string, env: NodeJS.ProcessEnv) => Promise<void>;
  readonly migrateStatus: (env: NodeJS.ProcessEnv) => Promise<PrismaRun>;
  readonly migrationsRoot: string;
  readonly now: () => Date;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
}

const STATUS_TIMEOUT_MS = 5 * 60_000;

/** `prisma migrate status` through the pinned wrapper, root prisma.config.ts (no --config; SPK-08 F-01). */
export function prismaStatus(env: NodeJS.ProcessEnv, run: typeof spawnSync = spawnSync): PrismaRun {
  const result = run(process.execPath, [join(REPO_ROOT, 'tools', 'deps', 'prisma-cli.mjs'), 'migrate', 'status'], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: STATUS_TIMEOUT_MS,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export const VERIFY_RESTORE_DEPENDENCIES: VerifyRestoreDependencies = {
  connect: async (connectionString) => pgSession(await connectPrivileged({ connectionString })),
  archive: ({ service, user }) => composeArchiveTool({ service, user }),
  prepareScratch: (connectionString, env) => reapplyDatabaseLevel({ connection: { connectionString }, passwords: readRolePasswords(env) }),
  migrateStatus: (env) => Promise.resolve(prismaStatus(env)),
  migrationsRoot: join(REPO_ROOT, 'prisma', 'migrations'),
  now: () => new Date(),
  write: (line) => process.stdout.write(`${line}\n`),
  writeError: (line) => process.stderr.write(`${line}\n`),
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: VerifyRestoreDependencies = VERIFY_RESTORE_DEPENDENCIES,
): Promise<number> {
  try {
    const flags = parseFlags(argv, { values: ['backup', 'scratch', 'migration', 'service'], switches: ['keep'] });
    const backupDir = flags.values.get('backup');
    if (backupDir === undefined) throw new RehearsalError('--backup <folder written by db:backup> is required');
    const bootstrap = localDatabaseUrl(env, 'DATABASE_BOOTSTRAP_URL');
    const migrator = localDatabaseUrl(env, 'DATABASE_MIGRATOR_URL');
    if (migrator.endpoint.host !== bootstrap.endpoint.host || migrator.endpoint.port !== bootstrap.endpoint.port) {
      throw new RehearsalError('DATABASE_MIGRATOR_URL must name the same host and port as DATABASE_BOOTSTRAP_URL');
    }
    readRolePasswords(env); // fail fast, before a database is created
    const manifest = parseManifest(JSON.parse(readFileSync(join(backupDir, BACKUP_FILES.manifest), 'utf8')) as unknown);
    const schemaFile = join(backupDir, BACKUP_FILES.schema);
    const scratch = flags.values.get('scratch') ?? `rehearsal_${utcStamp(deps.now()).toLowerCase()}`;
    const scratchMigrator: NodeJS.ProcessEnv = { ...env, DATABASE_MIGRATOR_URL: withDatabase(migrator.url, scratch) };
    delete scratchMigrator['SHADOW_DATABASE_URL'];
    const report = await runVerifyRestore({
      manifest,
      ...(existsSync(schemaFile) ? { sourceSchema: readFileSync(schemaFile, 'utf8') } : {}),
      scratchDatabase: scratch,
      archivePath: join(backupDir, BACKUP_FILES.archive),
      archive: deps.archive({ service: flags.values.get('service') ?? 'postgres', user: bootstrap.user || 'postgres' }),
      admin: () => deps.connect(withDatabase(bootstrap.url, 'postgres')),
      scratch: () => deps.connect(withDatabase(bootstrap.url, scratch)),
      prepareScratch: () => deps.prepareScratch(withDatabase(bootstrap.url, scratch), env),
      migrateStatus: () => deps.migrateStatus(scratchMigrator),
      keepScratch: flags.switches.has('keep'),
      now: deps.now,
    });
    writeFileSync(join(backupDir, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`);
    const summary = `${String(report.totals.tables)} tables, ${report.totals.rows} rows, restore ${String(report.restoreMs)} ms`;
    if (report.verdict !== 'pass') {
      const reasons = [
        ...report.differences,
        ...report.orphans.map((orphan) => `${orphan.orphans} orphan(s) for ${orphan.constraint} on ${orphan.table}`),
      ];
      if (!report.migrateStatus.ok) reasons.push(`migrate status: ${report.migrateStatus.detail}`);
      deps.writeError(`[db:verify-restore] FAIL (${summary}): ${reasons.slice(0, 10).join('; ')}`);
      return 1;
    }
    deps.write(`[db:verify-restore] PASS: ${summary}; report ${REPORT_FILE} in the backup folder`);
    const migration = flags.values.get('migration');
    if (migration !== undefined) {
      writeRehearsalRecord(deps.migrationsRoot, migration, manifest, report);
      deps.write(`[db:verify-restore] wrote ${RECORD_FILE} for ${migration}`);
    }
    return 0;
  } catch (error) {
    deps.writeError(`[db:verify-restore] ${messageOf(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
