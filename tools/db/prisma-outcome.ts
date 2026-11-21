/**
 * The outcome of a `prisma migrate status | deploy` run, as the restore rehearsal reports it (tools/db/verify-restore.ts;
 * TASK-034 fix cycle 2, D-TASK034-14). Pure: it reads a finished run's exit code, stdout and stderr.
 *
 * Prisma 7.10 writes its config and schema banner ("Loaded Prisma config from …", "Prisma schema loaded from …") to one
 * stream and the status text ("Following migration have not yet been applied:" and the names) to the other, so a tail
 * of the joined text can hold the banner alone (lane B `20261121T0711Z_9c40d31`). Both streams are read here:
 *   - the migration names listed under Prisma's headings become structured fields (`pending`, `failed`), from either
 *     stream, so the report names the migration whatever stream or order the CLI uses;
 *   - `detail` is an allow-list (fix cycle 3, PR034-SEC-03): the exit code, the names, Prisma's error codes, the
 *     SQLSTATE and PostgreSQL's first `ERROR:` line with every quoted fragment and parenthesised group masked (no line
 *     for a PL/pgSQL `RAISE`, SQLSTATE class P0). A database error can quote row data (`DETAIL: Failing row contains
 *     (…)`, a `RAISE` message), and the detail is printed by the CLI and written to restore-report.json, so no other
 *     line of the output is kept, the banner and its datasource line included.
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
/** SGR colour codes, should a CI variable force colours on. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
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

/** Characters of a line that `maskValues` reads (a longer line is cut first; the cut cannot reveal a masked value). */
const MASK_INPUT_CHARS = 2_000;
const DOUBLE_QUOTED = /"(?:[^"\\]|\\.)*"/g;
const SINGLE_QUOTED = /'(?:[^'\\]|\\.)*'/g;
const GROUP = /\([^()]*\)/g;
/** The first quote or parenthesis that masking left open: everything from it on is dropped. */
const UNMATCHED = /["'(]/;

/**
 * Masks every quoted fragment (escaped quotes included) and every parenthesised group, innermost first, so neither a
 * constraint error's `Key (…)=(…)` nor a `Failing row contains (…)` keeps row data (PR034-SEC-03). A quote or a
 * parenthesis left open (a cut line) ends the line.
 */
export function maskValues(line: string): string {
  let text = line.slice(0, MASK_INPUT_CHARS).replace(DOUBLE_QUOTED, '⟪q⟫').replace(SINGLE_QUOTED, '⟪s⟫');
  // Innermost groups first; the stand-in holds no parenthesis, so every pass removes one level (at most 1 000 passes).
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(GROUP, '⟪g⟫');
  }
  const open = UNMATCHED.exec(text);
  const kept = open === null ? text : `${text.slice(0, open.index)}…`;
  return kept.replaceAll('⟪q⟫', '"…"').replaceAll('⟪s⟫', "'…'").replaceAll('⟪g⟫', '(…)');
}

/** A Prisma error code (`P3018`, `P3009`, `P1001`, …). */
const PRISMA_CODE = /\b(P[1-5]\d{3})\b/g;
/** `Database error code: <SQLSTATE>` of a P3018 report. */
const SQLSTATE_LINE = /^Database error code: ([0-9A-Z]{5})$/;
/** PostgreSQL's first error line, as Prisma prints it under "Database error:". */
const SERVER_ERROR_LINE = /^ERROR:\s/;
/** SQLSTATE class P0 (PL/pgSQL `RAISE`): the message text is the author's, and may carry any value; only the code is kept. */
const RAISED = /^P0/;

/**
 * The allow-listed facts of a failed run (PR034-SEC-03): Prisma's error codes, the SQLSTATE, and PostgreSQL's first
 * `ERROR:` line with values masked (none for a `RAISE`, class P0). Nothing else of the output is kept: no `DETAIL:`,
 * `CONTEXT:`, `HINT:`, `QUERY:` or `WHERE:` line, no `DbError { … }` dump, no free text.
 */
export function allowedFacts(run: Pick<PrismaRun, 'stdout' | 'stderr'>): string[] {
  const lines = [...linesOf(run.stdout), ...linesOf(run.stderr)];
  const codes = unique(lines.flatMap((line) => [...line.matchAll(PRISMA_CODE)].map((match) => match[1] as string)));
  const sqlstate = lines.map((line) => SQLSTATE_LINE.exec(line)?.[1]).find((code) => code !== undefined);
  const serverError = sqlstate !== undefined && RAISED.test(sqlstate) ? undefined : lines.find((line) => SERVER_ERROR_LINE.test(line));
  return [
    ...codes,
    ...(sqlstate === undefined ? [] : [`SQLSTATE ${sqlstate}`]),
    ...(serverError === undefined ? [] : [maskValues(serverError)]),
  ];
}

const nameList = (label: string, names: readonly string[]): string[] => {
  if (names.length === 0) return [];
  const shown = names.slice(0, NAMES_IN_DETAIL).join(', ');
  const more = names.length > NAMES_IN_DETAIL ? ` (+${String(names.length - NAMES_IN_DETAIL)} more)` : '';
  return [`${label} ${shown}${more}`];
};

function failure(run: PrismaRun, listed: { pending: string[]; failed: string[] }): MigrateOutcome {
  const parts = [...nameList('pending', listed.pending), ...nameList('failed', listed.failed), ...allowedFacts(run)];
  const text = parts.length === 0 ? 'no recognised output' : parts.join(' | ');
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
