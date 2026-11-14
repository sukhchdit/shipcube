/**
 * Reversibility driver: up -> down -> up (data-model.md §8.4, NFR-DATA-004).
 *
 *   0. Snapshot S0 of the database before the run (bootstrapped; empty or seeded).
 *   1. `prisma migrate deploy` (all up) -> snapshot S1.
 *   2. For each applied migration, newest first: `prisma db execute --file <dir>/down.sql`, then mark the migration as
 *      rolled back in `_prisma_migrations`. A migration declared `reversible: no` (contract) stops the descent and is
 *      reported as excluded.
 *   3. Snapshot S_down. With nothing excluded it must equal S0: every down.sql reverts its migration completely.
 *   4. `prisma migrate deploy` again -> snapshot S2, which must equal S1.
 *
 * Correction of §8.4 step 2: Prisma 7.10 `migrate resolve --rolled-back` refuses a migration that finished
 * successfully (P3012, "not in a failed state"), so the driver sets `rolled_back_at` itself, as the migrator that
 * owns `_prisma_migrations`; `migrate deploy` then re-applies the migration (verified on PostgreSQL 18).
 *
 * The driver is I/O-agnostic: the caller supplies the Prisma runner (tools/deps/prisma-cli.mjs), the schema snapshot
 * (the Testcontainers harness uses `pg_dump --schema-only` in the container, see `normaliseSchemaDump`) and the
 * history update. The integration suite prisma/tests/migrations runs it on the repository's migrations.
 *
 * `runPrefixReversibility` (below) adds the partial-deploy check of §8.4 as amended 2026-11-13 (PR11-SEC-07).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseHeader } from './lint-migrations.js';
import { splitStatements } from './sql-text.js';

export interface PrismaRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface UpDownUpOptions {
  migrationsDir: string;
  /** Runs the Prisma CLI through the wrapper with the migrator datasource. */
  prisma: (args: string[]) => PrismaRun | Promise<PrismaRun>;
  /** Normalised schema snapshot (see `normaliseSchemaDump`). */
  snapshot: () => Promise<string>;
  /** Marks a successfully applied migration as rolled back (exactly one row). */
  markRolledBack: (migrationName: string) => Promise<void>;
  log?: (line: string) => void;
}

export interface UpDownUpReport {
  migrations: string[];
  rolledBack: string[];
  excluded: string[];
  /** S_down equals S0 (checked only when nothing was excluded). */
  downRestoresStart: boolean | null;
  /** S2 equals S1 (null when the descent left objects behind and up was not re-run). */
  upIsRepeatable: boolean | null;
  downDiff: SnapshotDiff;
  upDiff: SnapshotDiff;
}

export interface SnapshotDiff {
  onlyBefore: string[];
  onlyAfter: string[];
}

export class UpDownUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpDownUpError';
  }
}

/** Migration directory names in apply order. */
export function listMigrations(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort();
}

/** Statements of `pg_dump --schema-only` output, without comments, session settings and Prisma's history table. */
export function normaliseSchemaDump(dump: string): string {
  // psql meta-commands (PostgreSQL 18 pg_dump writes `\restrict <random key>`) are not SQL and differ per dump.
  const body = dump
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  return splitStatements(body)
    .map((statement) => statement.replace(/\s+/g, ' '))
    .filter((statement) => !/^(SET |SELECT pg_catalog\.set_config\()/.test(statement) && !statement.includes('_prisma_migrations'))
    .sort()
    .join(';\n');
}

/** Multiset difference of two normalised snapshots. */
export function diffSnapshots(before: string, after: string): SnapshotDiff {
  const count = (snapshot: string) => {
    const counts = new Map<string, number>();
    for (const statement of snapshot.split(';\n').filter(Boolean)) counts.set(statement, (counts.get(statement) ?? 0) + 1);
    return counts;
  };
  const a = count(before);
  const b = count(after);
  const only = (x: Map<string, number>, y: Map<string, number>) =>
    [...x].flatMap(([statement, n]) => Array.from({ length: Math.max(0, n - (y.get(statement) ?? 0)) }, () => statement));
  return { onlyBefore: only(a, b), onlyAfter: only(b, a) };
}

const isEmpty = (diff: SnapshotDiff) => diff.onlyBefore.length === 0 && diff.onlyAfter.length === 0;

async function prismaOk(options: UpDownUpOptions, args: string[]): Promise<void> {
  const run = await options.prisma(args);
  if (run.status !== 0) {
    throw new UpDownUpError(`prisma ${args.join(' ')} exited ${String(run.status)}: ${run.stderr.trim() || run.stdout.trim()}`);
  }
}

export async function runUpDownUp(options: UpDownUpOptions): Promise<UpDownUpReport> {
  const log = options.log ?? (() => {});
  const migrations = listMigrations(options.migrationsDir);
  for (const name of migrations) {
    if (!existsSync(join(options.migrationsDir, name, 'down.sql'))) throw new UpDownUpError(`${name} has no down.sql`);
  }

  const s0 = await options.snapshot();
  await prismaOk(options, ['migrate', 'deploy']);
  const s1 = await options.snapshot();

  const rolledBack: string[] = [];
  const excluded: string[] = [];
  for (const name of [...migrations].reverse()) {
    const header = parseHeader(readFileSync(join(options.migrationsDir, name, 'migration.sql'), 'utf8'));
    if (header.reversible !== true) {
      excluded.push(name);
      log(`[up-down-up] ${name} is not reversible (restore-based); the descent stops here`);
      break;
    }
    await prismaOk(options, ['db', 'execute', '--file', join(options.migrationsDir, name, 'down.sql')]);
    await options.markRolledBack(name);
    rolledBack.push(name);
    log(`[up-down-up] rolled back ${name}`);
  }
  const sDown = await options.snapshot();
  const downDiff = diffSnapshots(s0, sDown);
  const downRestoresStart = excluded.length === 0 ? isEmpty(downDiff) : null;
  const report = { migrations, rolledBack, excluded, downRestoresStart, downDiff };
  if (downRestoresStart === false) {
    // An incomplete down.sql: re-applying would collide with the leftovers, so the run stops here and reports them.
    log('[up-down-up] the down migrations did not restore the starting schema; up is not re-run');
    return { ...report, upIsRepeatable: null, upDiff: { onlyBefore: [], onlyAfter: [] } };
  }

  await prismaOk(options, ['migrate', 'deploy']);
  const s2 = await options.snapshot();
  const upDiff = diffSnapshots(s1, s2);
  return { ...report, upIsRepeatable: isEmpty(upDiff), upDiff };
}

/*
 * Prefix reversibility (data-model.md §8.4 as amended 2026-11-13; PR11-SEC-07; D-ARCH-071).
 *
 * A failed `migrate deploy` can leave a statement PREFIX of a migration applied: the file is not atomic. For every
 * reversible migration M with n statements (split with `splitStatements`) and every proper prefix k = 1..n-1:
 *   1. a fresh database in the state just before M (every earlier migration applied; M is not recorded);
 *   2. apply M's first k statements one by one as the migrator;
 *   3. run M's down.sql as the migrator;
 *   4. the snapshot must equal the pre-M snapshot.
 * A down.sql that fails or leaves a difference is reported by migration name and prefix length, with the SQLSTATE or
 * the number of differing objects only: error messages and dump lines can carry values and are never reported.
 * A migration declared `reversible: no` (contract, restore-based) is excluded, as in `runUpDownUp`.
 */

export interface PrefixReversibilityOptions<H> {
  migrationsDir: string;
  /** A fresh database in the state just before migration `index` of `listMigrations` (earlier ones applied). */
  prepare: (index: number, migration: string) => Promise<H>;
  /** Applies the statements in order, each on its own (autocommit), as the migrator. */
  applyStatements: (handle: H, statements: readonly string[]) => Promise<void>;
  /** Runs the migration's down.sql (full text) as the migrator. */
  runDown: (handle: H, downSql: string) => Promise<void>;
  /** Normalised snapshot of the database (see `normaliseSchemaDump`). */
  snapshot: (handle: H) => Promise<string>;
  /** Disposes of a prepared database (optional). */
  release?: (handle: H) => Promise<void>;
  log?: (line: string) => void;
}

export interface PrefixFailure {
  migration: string;
  /** Number of applied statements (1..statements-1). */
  prefix: number;
  statements: number;
  reason: 'down-failed' | 'schema-differs';
  /** SQLSTATE of the failing down.sql (`down-failed`), `unknown` when the error carries none. */
  sqlstate?: string;
  /** Number of differing snapshot objects (`schema-differs`). */
  differing?: number;
  /** `<migration>: prefix k/n (down.sql failed: <sqlstate>)` or `(schema differs: <n> objects)`. */
  message: string;
}

export interface PrefixReversibilityReport {
  /** Checked migrations with their statement count and the number of proper prefixes run. */
  checked: { migration: string; statements: number; prefixes: number }[];
  excluded: string[];
  failures: PrefixFailure[];
}

/** SQLSTATE of a driver error (`pg` sets `code`), never its message. */
export function sqlStateOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
}

async function withHandle<H, T>(options: PrefixReversibilityOptions<H>, handle: H, work: (handle: H) => Promise<T>): Promise<T> {
  try {
    return await work(handle);
  } finally {
    await options.release?.(handle);
  }
}

export async function runPrefixReversibility<H>(options: PrefixReversibilityOptions<H>): Promise<PrefixReversibilityReport> {
  const log = options.log ?? (() => {});
  const migrations = listMigrations(options.migrationsDir);
  const report: PrefixReversibilityReport = { checked: [], excluded: [], failures: [] };
  for (const [index, migration] of migrations.entries()) {
    const dir = join(options.migrationsDir, migration);
    if (!existsSync(join(dir, 'down.sql'))) throw new UpDownUpError(`${migration} has no down.sql`);
    const up = readFileSync(join(dir, 'migration.sql'), 'utf8');
    if (parseHeader(up).reversible !== true) {
      report.excluded.push(migration);
      log(`[prefix] ${migration} is not reversible (restore-based); excluded`);
      continue;
    }
    const statements = splitStatements(up);
    const down = readFileSync(join(dir, 'down.sql'), 'utf8');
    const n = statements.length;
    report.checked.push({ migration, statements: n, prefixes: Math.max(0, n - 1) });
    if (n < 2) continue;

    const before = await withHandle(options, await options.prepare(index, migration), (handle) => options.snapshot(handle));
    for (let k = 1; k < n; k += 1) {
      const label = `${migration}: prefix ${String(k)}/${String(n)}`;
      const failure = await withHandle(options, await options.prepare(index, migration), async (handle) => {
        try {
          await options.applyStatements(handle, statements.slice(0, k));
        } catch (error) {
          // The up statements themselves must apply on the pre-M state; that is a migration defect, not a finding.
          throw new UpDownUpError(`${label} (up statements failed: ${sqlStateOf(error)})`);
        }
        try {
          await options.runDown(handle, down);
        } catch (error) {
          const sqlstate = sqlStateOf(error);
          return { reason: 'down-failed' as const, sqlstate, message: `${label} (down.sql failed: ${sqlstate})` };
        }
        const diff = diffSnapshots(before, await options.snapshot(handle));
        const differing = diff.onlyBefore.length + diff.onlyAfter.length;
        return differing === 0
          ? undefined
          : { reason: 'schema-differs' as const, differing, message: `${label} (schema differs: ${String(differing)} objects)` };
      });
      if (failure !== undefined) {
        report.failures.push({ migration, prefix: k, statements: n, ...failure });
        log(`[prefix] ${failure.message}`);
      }
    }
    log(`[prefix] ${migration}: ${String(n - 1)} prefixes checked`);
  }
  return report;
}
