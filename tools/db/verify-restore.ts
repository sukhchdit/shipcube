/**
 * `npm run db:verify-restore` — steps 4 and 5 of the restore rehearsal (data-model.md §8.6 with the SEC-P3-03
 * amendment; NFR-REC-003, NFR-DATA-004; CLAUDE.md §5 Database; TASK-034). Exit 0 = pass.
 *
 *   0. The load-time gate (data-model §8.6 second amendment; D-ARCH-236): a manifest whose `loadTimeCode` holds a
 *      finding is refused before any database work. A restore would run that code as the loading superuser.
 *   1. The restore target (D-ARCH-235): the bootstrap URL names the target cluster, and its `system_identifier` must
 *      differ from the manifest's `cluster.systemIdentifier` (a second, fresh stack, as the job of TASK-119 runs it).
 *      `--same-cluster` is the one stated exception, for a developer's own Compose stack with synthetic data: it is
 *      refused on another cluster, never passed in CI, and the report records it (`target.sameCluster`). Then create an
 *      empty scratch database (`TEMPLATE template0`) there; refuse a name that exists.
 *   2. Run ONLY the database-level bootstrap file `00-roles.sql` on it (roles, CONNECT, the role-in-database search
 *      path; everything schema-scoped comes from the archive, and the audit DDL guard's event triggers are restored
 *      last), then `pg_restore --exit-on-error`.
 *   3. Verify (`verifyRestoredDatabase`): the restored manifest equals the backup manifest (row count and row checksum
 *      per table, migration head, sequences not behind, normalised schema digest: owners, ACLs, RLS, policies, triggers
 *      and event triggers); generated anti-joins find no orphan for any foreign key. Then, through the pinned wrapper
 *      with the ROOT prisma.config.ts (SPK-08 F-01, D-ARCH-077 (1)): with `--migration <name>`, `prisma migrate deploy`
 *      applies that migration (and any after it) to the restored data, which rehearses it (data-model §8.6;
 *      D-TASK034-09); then `prisma migrate status` must report the history up to date. What this proves about the
 *      config: it loads on a restored database, the generated `tables.external` window included, and its migrations
 *      folder matches the restored history. `migrate status` compares history only (no schema diff), so it does NOT
 *      prove that the window covers every audit partition of the restored schema (TASK-034 code review R1-m2).
 *   4. Drop the scratch database (unless `--keep`), write `restore-report.json` (owner-only, PR034-SEC-02) into the
 *      backup folder and, after a pass with `--migration <name>`, the rehearsal record
 *      `prisma/migrations/<name>/rehearsal.json` (rule R of the migration linter; tools/db/rehearsal-record.ts) before
 *      the PASS line. The record binds the bytes Prisma deployed: the report carries the `checksum` that
 *      `_prisma_migrations` holds for the migration after the deploy, and the record is refused when the current
 *      migration.sql differs from it (code review R2-m1). The `--migration` checks (name, `data-changing: yes` header,
 *      backup head = the migration before it) run first, before a database is created (R1-n3).
 *
 * What the privileged sessions do, and nothing else (data-model §8.6): read the system catalogs and base tables, run
 * `pg_dump`, and run `pg_restore` of a whole archive into an empty database. Prisma's `migrate deploy` and `migrate
 * status` run as the migrator, in a child process that inherits an allow-listed environment only (PR034-SEC-08).
 *
 * Not verified here (D-TASK034-04, owners routed by D-SD-012): the RustFS bucket copy and document SHA-256 (TASK-147),
 * the audit chain and anchors (TASK-116's verifier), the marker stream and the `/health/ready` smoke container (the
 * restore-rehearsal job of TASK-119).
 *
 * CLI: DATABASE_BOOTSTRAP_URL and DATABASE_MIGRATOR_URL (loopback or Unix socket, same host and port),
 * BOOTSTRAP_MIGRATOR_PASSWORD / BOOTSTRAP_APP_PASSWORD (or `*_FILE`, as for db:bootstrap); `--backup <dir>` (required),
 * `--scratch <name>`, `--migration <name>`, `--service <compose service>`, `--project <compose project>`, `--keep`,
 * `--same-cluster`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { connectPrivileged, readRolePasswords, reapplyDatabaseLevel } from './bootstrap.js';
import { BACKUP_FILES, schemaSnapshot } from './backup.js';
import { REPO_ROOT, parseHeader } from './lint-migrations.js';
import { checkDatabaseName, composeArchiveTool, type ArchiveTool } from './pg-archive.js';
import { PRIVATE_FILES } from './private-files.js';
import { deployOutcome, statusOutcome, type MigrateOutcome } from './prisma-outcome.js';
import {
  RehearsalError,
  applySessionSettings,
  captureManifest,
  captureSequences,
  clusterIdentifier,
  compareManifests,
  findOrphans,
  loadTimeSummary,
  manifestSha256,
  manifestTotals,
  parseManifest,
  sha256Hex,
  type BackupManifest,
  type OrphanFinding,
} from './rehearsal-manifest.js';
import { RECORD_FILE, buildRehearsalRecord, migrationNames, recordText, rehearsalProblems } from './rehearsal-record.js';
import {
  archiveTarget,
  localDatabaseUrl,
  messageOf,
  parseFlags,
  pgSession,
  prismaChildEnvironment,
  utcStamp,
  withDatabase,
  type ArchiveTarget,
  type ClosableSession,
} from './rehearsal-cli.js';
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
  /** `prisma migrate deploy` of the rehearsed migration; null without one. */
  readonly migrateDeploy: MigrateOutcome | null;
  readonly migrateStatus: MigrateOutcome;
  /** The rehearsed migration and the checksum `_prisma_migrations` holds for it after the deploy (R2-m1); null without one. */
  readonly rehearsed: RehearsedMigration | null;
}

/** What Prisma recorded for the rehearsed migration on the restored database (code review R2-m1). */
export interface RehearsedMigration {
  readonly migration: string;
  /** `_prisma_migrations.checksum`: the SHA-256 (hex) of the migration.sql bytes Prisma applied; null when no row. */
  readonly checksum: string | null;
}

/** The checksum Prisma stored for an applied, not rolled back migration (read as a base table, no routine). */
export const APPLIED_CHECKSUM_SQL = `SELECT checksum FROM public._prisma_migrations
 WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1`;

export interface VerifyRestoredOptions {
  readonly manifest: BackupManifest;
  /** The source's normalised schema (schema.sql of the backup), for a readable diff; the digest decides. */
  readonly sourceSchema?: string;
  readonly database: string;
  /** A privileged session on the restored database. */
  readonly session: ClosableSession;
  readonly archive: ArchiveTool;
  /**
   * `prisma migrate deploy` with the root config against the restored database, as the migrator: given when a
   * migration is rehearsed (`--migration`), run after the comparison and before the status (D-TASK034-09).
   */
  readonly migrateDeploy?: () => Promise<PrismaRun>;
  /** The migration `migrateDeploy` rehearses: its checksum is read after a successful deploy (R2-m1). */
  readonly rehearsedMigration?: string;
  /** `prisma migrate status` with the root config against the restored database, as the migrator. */
  readonly migrateStatus: () => Promise<PrismaRun>;
  readonly now?: () => Date;
}

/**
 * Step 3: compares a restored database with its backup manifest (the session stays open; the caller ends it). The
 * comparison runs first, on the restored data as backed up; a rehearsed migration is deployed after it. Prisma's
 * `migrate status` exits 1 while a migration is pending ("Following migration have not yet been applied"), so a
 * backup taken one migration behind passes only once that migration is deployed (TASK-034 code review R1-M1).
 */
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
  let migrateDeploy: MigrateOutcome | null = null;
  let rehearsed: RehearsedMigration | null = null;
  if (options.migrateDeploy !== undefined) {
    migrateDeploy = deployOutcome(await options.migrateDeploy());
    if (migrateDeploy.ok && options.rehearsedMigration !== undefined) {
      const [row] = await session.query<{ checksum: string | null }>(APPLIED_CHECKSUM_SQL, [options.rehearsedMigration]);
      rehearsed = { migration: options.rehearsedMigration, checksum: row?.checksum ?? null };
    }
  }
  // After a failed deploy the history is pending or failed: the status is still taken, for the report. Both streams
  // are read and the pending / failed names are parsed (prisma-outcome.ts; D-TASK034-14).
  const migrateStatus = statusOutcome(await options.migrateStatus());
  const passed = differences.length === 0 && orphans.length === 0 && (migrateDeploy?.ok ?? true) && migrateStatus.ok;
  const verdict = passed ? 'pass' : 'fail';
  return { verdict, restoredManifest, differences, orphans, schemaDiff, migrateDeploy, migrateStatus, rehearsed };
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
  /** See VerifyRestoredOptions.migrateDeploy. */
  readonly migrateDeploy?: () => Promise<PrismaRun>;
  /** See VerifyRestoredOptions.rehearsedMigration. */
  readonly rehearsedMigration?: string;
  readonly migrateStatus: () => Promise<PrismaRun>;
  /**
   * The stated exception of D-ARCH-235 (`--same-cluster`): restore into the cluster that was backed up. Without it a
   * target with the manifest's `system_identifier` is refused; with it a target with another identifier is refused.
   */
  readonly sameCluster?: boolean;
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
  /** The restore target (D-ARCH-235): `sameCluster` true only in the `--same-cluster` form. */
  readonly target: { readonly sameCluster: boolean };
  readonly scratchDatabase: string;
  readonly scratchKept: boolean;
  readonly restoreMs: number;
  readonly verifiedAt: string;
  readonly totals: { readonly tables: number; readonly rows: string };
  readonly restoredManifestSha256: string;
  readonly differences: readonly string[];
  readonly orphans: readonly OrphanFinding[];
  readonly schemaDiff: SnapshotDiff;
  readonly migrateDeploy: MigrateOutcome | null;
  readonly migrateStatus: MigrateOutcome;
  /** See RestoreCheck.rehearsed (R2-m1). */
  readonly rehearsed: RehearsedMigration | null;
}

async function withSession<T>(open: () => Promise<ClosableSession>, work: (session: ClosableSession) => Promise<T>): Promise<T> {
  const session = await open();
  try {
    return await work(session);
  } finally {
    await session.end();
  }
}

/**
 * Steps 0-4 without the files: the load-time gate, the restore-target check, then restore into a new scratch database,
 * verify, drop it (unless kept). Both refusals come before the admin session creates a database, so every caller (the
 * CLI and the harness) is covered.
 */
export async function runVerifyRestore(options: VerifyRestoreOptions): Promise<RestoreReport> {
  const scratch = checkDatabaseName(options.scratchDatabase);
  if (scratch === options.manifest.database) throw new RehearsalError('the scratch database must not be the backed-up database');
  if (options.manifest.loadTimeCode.length > 0) {
    throw new RehearsalError(
      `the load-time gate refuses this backup: ${loadTimeSummary(options.manifest.loadTimeCode)}. A restore would run this code as the loading superuser: remove the objects with a migration and take a new backup; never edit the manifest (data-model 8.6, D-ARCH-236)`,
    );
  }
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  let sameCluster = false;
  await withSession(options.admin, async (admin) => {
    sameCluster = (await clusterIdentifier(admin)) === options.manifest.cluster.systemIdentifier;
    if (sameCluster && options.sameCluster !== true) {
      throw new RehearsalError(
        'the restore target is the cluster that was backed up (same system_identifier): restore into a second, fresh stack (data-model 8.6 step 4), or pass --same-cluster on your own Compose stack with synthetic data only (D-ARCH-235)',
      );
    }
    if (!sameCluster && options.sameCluster === true) {
      throw new RehearsalError(
        '--same-cluster was given, but the restore target is not the cluster that was backed up (another system_identifier): drop --same-cluster (D-ARCH-235)',
      );
    }
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
        ...(options.migrateDeploy === undefined ? {} : { migrateDeploy: options.migrateDeploy }),
        ...(options.rehearsedMigration === undefined ? {} : { rehearsedMigration: options.rehearsedMigration }),
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
      target: { sameCluster },
      scratchDatabase: scratch,
      scratchKept: options.keepScratch === true,
      restoreMs,
      verifiedAt: now().toISOString(),
      totals: manifestTotals(check.restoredManifest),
      restoredManifestSha256: manifestSha256(check.restoredManifest),
      differences: check.differences,
      orphans: check.orphans,
      schemaDiff: check.schemaDiff,
      migrateDeploy: check.migrateDeploy,
      migrateStatus: check.migrateStatus,
      rehearsed: check.rehearsed,
    };
  } finally {
    if (options.keepScratch !== true) {
      await withSession(options.admin, (admin) => admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(scratch)} WITH (FORCE)`));
    }
  }
}

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]{1,100}$/;

/** A migration a backup may rehearse: its migration.sql bytes and the migration before it. */
export interface RehearsalTarget {
  readonly migration: string;
  readonly migrationSql: Buffer;
  readonly previous: string | null;
}

/**
 * The `--migration` checks, run before any database is created (R1-n3): the name is a migration directory with a
 * migration.sql (Prisma's list, `migrationNames`; R1-n4), declared `data-changing: yes`, and the backup's migration
 * head is the migration just before it.
 */
export function rehearsalTarget(migrationsRoot: string, migration: string, manifest: BackupManifest): RehearsalTarget {
  if (!MIGRATION_NAME.test(migration)) throw new RehearsalError('--migration must be a migration directory name (<14 digits>_<name>)');
  const names = migrationNames(migrationsRoot);
  const index = names.indexOf(migration);
  if (index < 0) throw new RehearsalError(`migration ${migration} does not exist`);
  const migrationSql = readFileSync(join(migrationsRoot, migration, 'migration.sql'));
  if (parseHeader(migrationSql.toString('utf8')).dataChanging !== true) {
    throw new RehearsalError(`migration ${migration} is not declared "data-changing: yes"; it needs no rehearsal record`);
  }
  const previous = index === 0 ? null : (names[index - 1] as string);
  if (manifest.migrationHead !== previous) {
    throw new RehearsalError(
      `the backup's migration head ${String(manifest.migrationHead)} is not the migration before ${migration} (${String(previous)}): back up the database at that state`,
    );
  }
  return { migration, migrationSql, previous };
}

/**
 * Writes `prisma/migrations/<migration>/rehearsal.json` for a passed report whose run deployed the migration on the
 * restored data (D-TASK034-09). Repeats the `rehearsalTarget` checks (the files may have changed during the run),
 * refuses a failed report, and binds the record to the bytes that were deployed: the SHA-256 of the current
 * migration.sql must equal the `checksum` Prisma stored for the migration on the restored database (code review
 * R2-m1), else the file changed during the rehearsal. Returns the record's path.
 */
export function writeRehearsalRecord(migrationsRoot: string, migration: string, manifest: BackupManifest, report: RestoreReport): string {
  const { migrationSql, previous } = rehearsalTarget(migrationsRoot, migration, manifest);
  if (report.verdict !== 'pass') throw new RehearsalError('the verification failed: no rehearsal record is written');
  if (report.migrateDeploy?.ok !== true) {
    throw new RehearsalError('the verification did not deploy the migration on the restored data: no rehearsal record is written');
  }
  if (report.rehearsed?.migration !== migration || report.rehearsed.checksum === null) {
    throw new RehearsalError(`the report holds no deployed checksum for ${migration}: no rehearsal record is written`);
  }
  if (sha256Hex(migrationSql) !== report.rehearsed.checksum) {
    throw new RehearsalError(
      'migration.sql changed during the rehearsal (its SHA-256 differs from the checksum Prisma recorded at the deploy): no rehearsal record is written; rehearse it again',
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
  readonly archive: (options: ArchiveTarget) => ArchiveTool;
  readonly prepareScratch: (connectionString: string, env: NodeJS.ProcessEnv) => Promise<void>;
  readonly migrateDeploy: (env: NodeJS.ProcessEnv) => Promise<PrismaRun>;
  readonly migrateStatus: (env: NodeJS.ProcessEnv) => Promise<PrismaRun>;
  readonly migrationsRoot: string;
  readonly now: () => Date;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
}

const PRISMA_TIMEOUT_MS = { status: 5 * 60_000, deploy: 30 * 60_000 } as const;

/** `prisma migrate status | deploy` through the pinned wrapper, root prisma.config.ts (no --config; SPK-08 F-01). */
export function prismaMigrate(command: 'status' | 'deploy', env: NodeJS.ProcessEnv, run: typeof spawnSync = spawnSync): PrismaRun {
  const result = run(process.execPath, [join(REPO_ROOT, 'tools', 'deps', 'prisma-cli.mjs'), 'migrate', command], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: PRISMA_TIMEOUT_MS[command],
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** `prisma migrate status` (see prismaMigrate). */
export const prismaStatus = (env: NodeJS.ProcessEnv, run: typeof spawnSync = spawnSync): PrismaRun => prismaMigrate('status', env, run);

export const VERIFY_RESTORE_DEPENDENCIES: VerifyRestoreDependencies = {
  connect: async (connectionString) => pgSession(await connectPrivileged({ connectionString })),
  archive: (target) => composeArchiveTool(target),
  prepareScratch: (connectionString, env) => reapplyDatabaseLevel({ connection: { connectionString }, passwords: readRolePasswords(env) }),
  migrateDeploy: (env) => Promise.resolve(prismaMigrate('deploy', env)),
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
    const flags = parseFlags(argv, {
      values: ['backup', 'scratch', 'migration', 'service', 'project'],
      switches: ['keep', 'same-cluster'],
    });
    const backupDir = flags.values.get('backup');
    if (backupDir === undefined) throw new RehearsalError('--backup <folder written by db:backup> is required');
    const bootstrap = localDatabaseUrl(env, 'DATABASE_BOOTSTRAP_URL');
    const migrator = localDatabaseUrl(env, 'DATABASE_MIGRATOR_URL');
    if (migrator.endpoint.host !== bootstrap.endpoint.host || migrator.endpoint.port !== bootstrap.endpoint.port) {
      throw new RehearsalError('DATABASE_MIGRATOR_URL must name the same host and port as DATABASE_BOOTSTRAP_URL');
    }
    readRolePasswords(env); // fail fast, before a database is created
    const manifest = parseManifest(JSON.parse(readFileSync(join(backupDir, BACKUP_FILES.manifest), 'utf8')) as unknown);
    const migration = flags.values.get('migration');
    if (migration !== undefined) rehearsalTarget(deps.migrationsRoot, migration, manifest); // fail fast (R1-n3)
    const schemaFile = join(backupDir, BACKUP_FILES.schema);
    const scratch = flags.values.get('scratch') ?? `rehearsal_${utcStamp(deps.now()).toLowerCase()}`;
    // PR034-SEC-08: the Prisma child gets an allow-listed environment and the scratch database's migrator URL only.
    const scratchMigrator = prismaChildEnvironment(env, withDatabase(migrator.url, scratch));
    const report = await runVerifyRestore({
      manifest,
      ...(existsSync(schemaFile) ? { sourceSchema: readFileSync(schemaFile, 'utf8') } : {}),
      scratchDatabase: scratch,
      archivePath: join(backupDir, BACKUP_FILES.archive),
      archive: deps.archive(archiveTarget(flags, bootstrap.user)),
      admin: () => deps.connect(withDatabase(bootstrap.url, 'postgres')),
      scratch: () => deps.connect(withDatabase(bootstrap.url, scratch)),
      prepareScratch: () => deps.prepareScratch(withDatabase(bootstrap.url, scratch), env),
      ...(migration === undefined ? {} : { migrateDeploy: () => deps.migrateDeploy(scratchMigrator), rehearsedMigration: migration }),
      migrateStatus: () => deps.migrateStatus(scratchMigrator),
      sameCluster: flags.switches.has('same-cluster'),
      keepScratch: flags.switches.has('keep'),
      now: deps.now,
    });
    PRIVATE_FILES.writeFile(join(backupDir, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, false);
    const summary = `${String(report.totals.tables)} tables, ${report.totals.rows} rows, restore ${String(report.restoreMs)} ms`;
    if (report.verdict !== 'pass') {
      const reasons = [
        ...report.differences,
        ...report.orphans.map((orphan) => `${orphan.orphans} orphan(s) for ${orphan.constraint} on ${orphan.table}`),
      ];
      if (report.migrateDeploy?.ok === false) reasons.push(`migrate deploy: ${report.migrateDeploy.detail}`);
      if (!report.migrateStatus.ok) reasons.push(`migrate status: ${report.migrateStatus.detail}`);
      deps.writeError(`[db:verify-restore] FAIL (${summary}): ${reasons.slice(0, 10).join('; ')}`);
      return 1;
    }
    if (migration !== undefined) {
      // The record is written before the PASS line: a refused write is a FAIL, never a PASS followed by exit 1 (R2-m1).
      try {
        writeRehearsalRecord(deps.migrationsRoot, migration, manifest, report);
      } catch (error) {
        deps.writeError(
          `[db:verify-restore] FAIL (${summary}): the verification passed, but no ${RECORD_FILE} was written: ${messageOf(error)}`,
        );
        return 1;
      }
    }
    const rehearsed = migration === undefined ? '' : `; ${migration} deployed on the restored data`;
    const form = report.target.sameCluster ? '; same cluster (--same-cluster)' : '';
    deps.write(`[db:verify-restore] PASS: ${summary}${rehearsed}${form}; report ${REPORT_FILE} in the backup folder`);
    if (migration !== undefined) deps.write(`[db:verify-restore] wrote ${RECORD_FILE} for ${migration}`);
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
