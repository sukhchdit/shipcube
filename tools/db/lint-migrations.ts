/**
 * Migration linter (data-model.md §8.3; NFR-AVAIL-003, NFR-DATA-004; SEC-TC-33 part; lane A `migration-lint`).
 * A text-level early warning: ownership, the audit DDL guard and the catalog tests are the boundary (§8.3 "Limits").
 *
 * Rules implemented here (rule numbers of §8.3):
 *   1   header block (`migration-kind`, `data-changing`, `reversible`) before the first statement, and a `down.sql`
 *   2   DROP TABLE/COLUMN/INDEX/CONSTRAINT/... or ALTER ... DROP DEFAULT outside a `contract` migration
 *   C   a `contract` migration is never declared `reversible: yes` (§8.2: restore-based rollback only)
 *   10  UPDATE/DELETE/TRUNCATE/INSERT ... SELECT without `data-changing: yes` (backup guardrail, §8.6)
 *   12  audit objects in prisma/migrations (unconditional); in prisma/bootstrap only with an approved
 *       `-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>` header (reviewer listed, date not in the future)
 *   13  SECURITY DEFINER without exactly `SET search_path = pg_catalog, pg_temp`; ALTER FUNCTION ... SECURITY DEFINER;
 *       a bootstrap file whose first statement is not `SET search_path = pg_catalog, pg_temp`
 * Rules 3-9 and 11 are not implemented yet (see the TASK-003 report).
 *
 * CLI (`npm run db:lint-migrations`): lints prisma/migrations and prisma/bootstrap, then runs `prisma validate`
 * through tools/deps/prisma-cli.mjs (`--no-validate` skips it). Exit 0 = clean, 1 = findings or failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalise, splitStatements, tokenize } from './sql-text.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface LintFinding {
  file: string;
  rule: string;
  message: string;
}

export type MigrationKind = 'expand' | 'migrate' | 'contract';

export interface MigrationHeader {
  kind?: MigrationKind;
  dataChanging?: boolean;
  reversible?: boolean;
  problems: string[];
}

/** Audit objects of rule 12 (data-model §8.3 amendment). `audit_entries_*` partitions match the prefix. */
export const AUDIT_OBJECTS = [
  'audit_entries',
  'audit_stream_heads',
  'audit_checkpoint_heads',
  'audit_chain_verifications',
  'audit_partitions',
  'audit_anchors',
  'audit_pii_vault',
  'data_subjects',
  'audit_forbid_mutation',
  'audit_vault_guard',
  'ensure_audit_partitions',
  'audit_ddl_guard',
] as const;
export const AUDIT_OWNER = 'platform_audit_owner';
const AUDIT_OBJECT_PATTERN = new RegExp(`(^|[^a-z0-9_])"?(${AUDIT_OBJECTS.join('|')})(_[a-z0-9_]*)?"?($|[^a-z0-9_])`, 'i');
const AUDIT_OWNER_PATTERN = new RegExp(`(^|[^a-z0-9_])"?${AUDIT_OWNER}"?($|[^a-z0-9_])`, 'i');
/** Statements that act as the audit owner or hand it out: SET ROLE, OWNER TO, membership grants. */
const AUDIT_OWNER_ACTION = [
  new RegExp(`\\bset\\s+(local\\s+|session\\s+)?role\\s+"?${AUDIT_OWNER}\\b`, 'i'),
  new RegExp(`\\bowner\\s+to\\s+"?${AUDIT_OWNER}\\b`, 'i'),
  new RegExp(`\\bgrant\\s+"?${AUDIT_OWNER}"?\\s+to\\b`, 'i'),
];
/**
 * Rule 12, migrations lane: any audit object and any mention of the audit owner fails, unconditionally.
 * Bootstrap lane: audit objects and statements acting as or handing out the audit owner need the approval marker.
 * The role's own definition in 00-roles.sql and its schema grants and default privileges in 01-schemas.sql (data-model
 * §4.4) mention it without touching an audit object and need no marker (interpretation recorded in the TASK-003 report).
 */
const isAuditDdl = (statement: string, lane: 'migrations' | 'bootstrap'): boolean =>
  AUDIT_OBJECT_PATTERN.test(statement) ||
  (lane === 'migrations' ? AUDIT_OWNER_PATTERN.test(statement) : AUDIT_OWNER_ACTION.some((pattern) => pattern.test(statement)));

const HEADER_LINE = /^--\s*(migration-kind|data-changing|reversible)\s*:\s*(\S+)\s*$/i;
const AUDIT_MARKER = /^-- @audit-ddl security-approved: ([a-z0-9._-]+) (\d{4}-\d{2}-\d{2})$/;
const FIXED_PATH = /set search_path (=|to) pg_catalog, ?pg_temp( |;|$)/;
/** Rule 2's list: DROP TABLE / INDEX / COLUMN / CONSTRAINT and ALTER … DROP DEFAULT (`DROP x` without COLUMN too). */
const DESTRUCTIVE = [
  /^drop\s+(table|index)\b/,
  /^alter\s+table\b.*\bdrop\s+(column|constraint)\b/,
  /^alter\s+table\b.*\bdrop\s+default\b/,
  /^alter\s+table\b.*\bdrop\s+(?!column\b|constraint\b|default\b|not\b|identity\b|expression\b)"?[a-z_][a-z0-9_]*"?\s*(,|cascade|restrict|$)/,
];
const DATA_CHANGING = [/^update\b/, /^delete\b/, /^truncate\b/, /^insert\s+into\b.*\bselect\b/, /^merge\b/];

/** Leading comment lines up to the first statement. */
function leadingComments(sql: string): string[] {
  const lines: string[] = [];
  for (const token of tokenize(sql)) {
    if (token.kind === 'comment') {
      lines.push(...token.text.split(/\r?\n/).map((line) => line.trim()));
      continue;
    }
    if (token.kind === 'code' && token.text.trim() === '') continue;
    break;
  }
  return lines;
}

export function parseHeader(sql: string): MigrationHeader {
  const header: MigrationHeader = { problems: [] };
  const seen = new Set<string>();
  for (const line of leadingComments(sql)) {
    const match = HEADER_LINE.exec(line);
    if (!match) continue;
    const key = (match[1] as string).toLowerCase();
    const value = (match[2] as string).toLowerCase();
    if (seen.has(key)) header.problems.push(`duplicate header line "${key}"`);
    seen.add(key);
    if (key === 'migration-kind') {
      if (value === 'expand' || value === 'migrate' || value === 'contract') header.kind = value;
      else header.problems.push(`migration-kind must be expand, migrate or contract, got "${value}"`);
    } else if (value === 'yes' || value === 'no') {
      if (key === 'data-changing') header.dataChanging = value === 'yes';
      else header.reversible = value === 'yes';
    } else {
      header.problems.push(`${key} must be yes or no, got "${value}"`);
    }
  }
  for (const key of ['migration-kind', 'data-changing', 'reversible']) {
    if (!seen.has(key)) header.problems.push(`missing header line "-- ${key}: …" before the first statement`);
  }
  return header;
}

/** True when `statement` declares or alters a SECURITY DEFINER routine without the fixed search path. */
function definerWithoutFixedPath(statement: string): boolean {
  const text = normalise(statement);
  const isRoutine = /^create (or replace )?(function|procedure)\b/.test(text);
  if (isRoutine) {
    const header = text.split(/\bas\s+(\$|')/)[0] ?? text;
    return /\bsecurity definer\b/.test(header) && !FIXED_PATH.test(`${header};`);
  }
  if (/^alter (function|procedure)\b/.test(text)) {
    if (/\bsecurity definer\b/.test(text)) return true;
    if (/\b(reset search_path|reset all)\b/.test(text)) return true;
    return /\bset search_path\b/.test(text) && !FIXED_PATH.test(`${text};`);
  }
  return false;
}

/** Lints one migration directory (`<name>/migration.sql` + `down.sql`). */
export function lintMigrationDir(dir: string, label: string = dir): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (rule: string, message: string, file = join(label, 'migration.sql')) => findings.push({ file, rule, message });
  const migrationFile = join(dir, 'migration.sql');
  if (!existsSync(migrationFile)) {
    add('1', 'migration.sql is missing');
    return findings;
  }
  if (!existsSync(join(dir, 'down.sql'))) add('1', 'down.sql is missing (every migration ships one, §8.4)', join(label, 'down.sql'));
  const sql = readFileSync(migrationFile, 'utf8');
  const header = parseHeader(sql);
  header.problems.forEach((problem) => add('1', problem));
  if (header.kind === 'contract' && header.reversible === true) {
    add('C', 'a contract migration is restore-based only and must declare "reversible: no" (§8.2)');
  }
  for (const statement of splitStatements(sql)) {
    const text = normalise(statement);
    const preview = text.slice(0, 80);
    if (header.kind !== 'contract' && DESTRUCTIVE.some((pattern) => pattern.test(text))) {
      add('2', `destructive statement outside a contract migration: "${preview}"`);
    }
    if (header.dataChanging !== true && DATA_CHANGING.some((pattern) => pattern.test(text))) {
      add('10', `data-changing statement without "data-changing: yes": "${preview}"`);
    }
    if (isAuditDdl(statement, 'migrations')) {
      add('12', `audit object in a Prisma migration (audit DDL belongs to the bootstrap lane only): "${preview}"`);
    }
    if (definerWithoutFixedPath(statement)) {
      add('13', `SECURITY DEFINER routine without exactly "SET search_path = pg_catalog, pg_temp": "${preview}"`);
    }
  }
  return findings;
}

/** Lints every migration directory under `root` (files such as migration_lock.toml are skipped). */
export function lintMigrations(root: string, labelRoot: string = root): LintFinding[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort()
    .flatMap((name) => lintMigrationDir(join(root, name), join(labelRoot, name)));
}

export interface BootstrapLintOptions {
  reviewers: readonly string[];
  /** ISO date (YYYY-MM-DD) the approval date must not exceed. */
  today: string;
}

/** Lints the bootstrap lane: rule 13 (first statement) and rule 12 (approved audit DDL only). */
export function lintBootstrap(dir: string, options: BootstrapLintOptions, labelRoot: string = dir): LintFinding[] {
  if (!existsSync(dir)) return [];
  const findings: LintFinding[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const file = join(labelRoot, name);
    const sql = readFileSync(join(dir, name), 'utf8');
    const statements = splitStatements(sql);
    const first = normalise(statements[0] ?? '');
    if (!/^set search_path (=|to) pg_catalog, ?pg_temp$/.test(first)) {
      findings.push({ file, rule: '13', message: 'the first statement must be "SET search_path = pg_catalog, pg_temp;"' });
    }
    statements.filter(definerWithoutFixedPath).forEach((statement) =>
      findings.push({
        file,
        rule: '13',
        message: `SECURITY DEFINER routine without the fixed search path: "${normalise(statement).slice(0, 80)}"`,
      }),
    );
    if (!statements.some((statement) => isAuditDdl(statement, 'bootstrap'))) continue;
    const marker = leadingComments(sql)
      .map((line) => AUDIT_MARKER.exec(line))
      .find((match) => match !== null);
    if (!marker) {
      findings.push({ file, rule: '12', message: 'audit DDL needs the header "-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>"' });
    } else if (!options.reviewers.includes(marker[1] as string)) {
      findings.push({ file, rule: '12', message: `audit DDL reviewer "${marker[1]}" is not listed in tools/db/audit-ddl-reviewers.json` });
    } else if ((marker[2] as string) > options.today) {
      findings.push({ file, rule: '12', message: `audit DDL approval date ${marker[2]} lies in the future` });
    }
  }
  return findings;
}

export function readReviewers(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { reviewers?: unknown };
  if (!Array.isArray(raw.reviewers) || !raw.reviewers.every((reviewer) => typeof reviewer === 'string')) {
    throw new Error(`${path} must hold { "reviewers": string[] }`);
  }
  return raw.reviewers;
}

/** Lints the repository's lanes; returns the findings with repository-relative paths. */
export function lintRepository(root: string = REPO_ROOT, today: string = new Date().toISOString().slice(0, 10)): LintFinding[] {
  const reviewers = readReviewers(join(root, 'tools', 'db', 'audit-ddl-reviewers.json'));
  const rel = (path: string) => relative(root, path).replaceAll('\\', '/');
  return [
    ...lintMigrations(join(root, 'prisma', 'migrations'), rel(join(root, 'prisma', 'migrations'))),
    ...lintBootstrap(join(root, 'prisma', 'bootstrap'), { reviewers, today }, rel(join(root, 'prisma', 'bootstrap'))),
  ];
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const findings = lintRepository();
  for (const finding of findings) process.stderr.write(`${finding.file}: rule ${finding.rule}: ${finding.message}\n`);
  if (findings.length > 0) return 1;
  process.stdout.write('[lint-migrations] prisma/migrations and prisma/bootstrap: no findings\n');
  if (argv.includes('--no-validate')) return 0;
  const validate = spawnSync(process.execPath, [join(REPO_ROOT, 'tools', 'deps', 'prisma-cli.mjs'), 'validate'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  return validate.status === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
