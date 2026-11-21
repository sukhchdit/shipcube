/**
 * The outcome of a `prisma migrate status | deploy` run, as the restore rehearsal reports it (tools/db/verify-restore.ts;
 * TASK-034 fix cycle 2, D-TASK034-14). Pure: it reads a finished run's exit code, stdout and stderr.
 *
 * Prisma 7.10 writes its config and schema banner ("Loaded Prisma config from …", "Prisma schema loaded from …") to one
 * stream and the status text ("Following migration have not yet been applied:" and the names) to the other, so a tail
 * of the joined text can hold the banner alone (lane B `20261121T0711Z_9c40d31`). Both streams are read here:
 *   - the migration names listed under Prisma's headings become structured fields (`pending`, `failed`), from either
 *     stream, so the report names the migration whatever stream or order the CLI uses;
 *   - `detail` starts with the exit code and the names, then the last lines of both streams without the banner. Quoted
 *     fragments and `=(…)` key values are masked, because a database error can quote row data (the detail is printed
 *     by the CLI and written to restore-report.json).
 */
import type { PrismaRun } from './up-down-up.js';

/** What the rehearsal records of one Prisma CLI step. */
export interface MigrateOutcome {
  readonly ok: boolean;
  /** `up to date` / `applied` on success, else `exit <code>: …` (names first, then the last output lines). */
  readonly detail: string;
  /** Migrations Prisma lists as not yet applied (`migrate status`), in its order. */
  readonly pending: readonly string[];
  /** Migrations Prisma reports as failed (status heading, `deploy` P3018 / P3009 text), in its order. */
  readonly failed: readonly string[];
}

/** A migration directory name as Prisma prints it. */
const MIGRATION_NAME = /^\d{14}_[A-Za-z0-9_]{1,200}$/;
const PENDING_HEADING = /have not yet been applied:$/i;
const FAILED_HEADING = /have failed:$/i;
/** `deploy` P3018: "Migration name: <name>". */
const MIGRATION_NAME_LINE = /^Migration name: (\d{14}_[A-Za-z0-9_]{1,200})$/;
/** `deploy` P3009: "The `<name>` migration started at … failed". */
const STARTED_FAILED = /^The `(\d{14}_[A-Za-z0-9_]{1,200})` migration started at .* failed$/;
/** Banner lines that carry no outcome (and, for the datasource line, the host and database). */
const BANNER = [/^Loaded Prisma config from /, /^Prisma schema loaded from /, /^Datasource "/, /^Environment variables loaded from /];
/** SGR colour codes, should a CI variable force colours on. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const TAIL_LINES = 3;
const NAMES_IN_DETAIL = 5;
const DETAIL_CHARS = 500;
const UP_TO_DATE = /Database schema is up to date/;

const linesOf = (text: string): string[] =>
  text
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim());

/** The names listed under each line that matches `heading`, up to the first line that is not a migration name. */
function listedUnder(lines: readonly string[], heading: RegExp): string[] {
  const names: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!heading.test(lines[index] as string)) continue;
    for (let next = index + 1; next < lines.length && MIGRATION_NAME.test(lines[next] as string); next += 1) {
      names.push(lines[next] as string);
    }
  }
  return names;
}

const unique = (names: readonly string[]): string[] => [...new Set(names)];

/** Pending and failed migration names in a run's output (stdout first, then stderr). */
export function listedMigrations(run: Pick<PrismaRun, 'stdout' | 'stderr'>): { pending: string[]; failed: string[] } {
  const lines = [...linesOf(run.stdout), ...linesOf(run.stderr)];
  const failedInline = lines.flatMap((line) => {
    const match = MIGRATION_NAME_LINE.exec(line) ?? STARTED_FAILED.exec(line);
    return match === null ? [] : [match[1] as string];
  });
  return {
    pending: unique(listedUnder(lines, PENDING_HEADING)),
    failed: unique([...listedUnder(lines, FAILED_HEADING), ...failedInline]),
  };
}

/** Masks quoted fragments and `=(…)` key values (a constraint error's DETAIL quotes row data). */
export const maskValues = (line: string): string =>
  line
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/=\([^)]*\)/g, '=(…)');

/** The last non-banner, non-empty lines of both streams (stdout first), masked. */
export function outputTail(run: Pick<PrismaRun, 'stdout' | 'stderr'>, count = TAIL_LINES): string[] {
  return [...linesOf(run.stdout), ...linesOf(run.stderr)]
    .filter((line) => line !== '' && !BANNER.some((banner) => banner.test(line)))
    .slice(-count)
    .map(maskValues);
}

const nameList = (label: string, names: readonly string[]): string[] => {
  if (names.length === 0) return [];
  const shown = names.slice(0, NAMES_IN_DETAIL).join(', ');
  const more = names.length > NAMES_IN_DETAIL ? ` (+${String(names.length - NAMES_IN_DETAIL)} more)` : '';
  return [`${label} ${shown}${more}`];
};

function failure(run: PrismaRun, listed: { pending: string[]; failed: string[] }): MigrateOutcome {
  const parts = [...nameList('pending', listed.pending), ...nameList('failed', listed.failed), ...outputTail(run)];
  const text = parts.length === 0 ? 'no output' : parts.join(' | ');
  return { ok: false, detail: `exit ${String(run.status)}: ${text}`.slice(0, DETAIL_CHARS), ...listed };
}

/** `prisma migrate status`: ok only with exit 0 and "Database schema is up to date" on either stream. */
export function statusOutcome(run: PrismaRun): MigrateOutcome {
  const listed = listedMigrations(run);
  const upToDate = run.status === 0 && (UP_TO_DATE.test(run.stdout) || UP_TO_DATE.test(run.stderr));
  return upToDate && listed.pending.length === 0 && listed.failed.length === 0
    ? { ok: true, detail: 'up to date', pending: [], failed: [] }
    : failure(run, listed);
}

/** `prisma migrate deploy`: ok with exit 0. */
export function deployOutcome(run: PrismaRun): MigrateOutcome {
  return run.status === 0 ? { ok: true, detail: 'applied', pending: [], failed: [] } : failure(run, listedMigrations(run));
}
