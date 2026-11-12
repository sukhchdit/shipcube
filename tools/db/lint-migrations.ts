/**
 * Migration linter (data-model.md §8.3; NFR-AVAIL-003, NFR-DATA-004; SEC-TC-33 part; lane A `migration-lint`).
 * A text-level early warning: ownership, the audit DDL guard and the catalog tests are the boundary (§8.3 "Limits").
 *
 * Rules implemented here (rule numbers of §8.3):
 *   1   header block (`migration-kind`, `data-changing`, `reversible`) before the first statement, and a `down.sql`
 *   2   DROP TABLE/COLUMN/INDEX/CONSTRAINT/... (also `DROP [COLUMN] IF EXISTS`) or ALTER ... DROP DEFAULT outside a
 *       `contract` migration
 *   C   a `contract` migration is never declared `reversible: yes` (§8.2: restore-based rollback only)
 *   10  UPDATE/DELETE/TRUNCATE/INSERT ... SELECT/MERGE, also inside a `WITH ...` statement, without
 *       `data-changing: yes` (backup guardrail, §8.6)
 *   12  audit objects and any mention of platform_audit_owner in prisma/migrations (unconditional); in prisma/bootstrap
 *       only with an approved `-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>` header (reviewer listed, date
 *       not in the future), except the role's own tightening statements (deny-by-default, AUDIT_OWNER_TIGHTENING)
 *   13  SECURITY DEFINER (anywhere outside the body) without exactly `SET search_path = pg_catalog, pg_temp`;
 *       ALTER FUNCTION ... SECURITY DEFINER; a bootstrap file whose first statement is not that SET
 * Rules 3-9, 11 and 14 are owned by TASK-016 (D-ARCH-049; data-model §8.3 batch 0.2 amendment).
 *
 * CLI (`npm run db:lint-migrations`): lints prisma/migrations and prisma/bootstrap, then runs `prisma validate`
 * through tools/deps/prisma-cli.mjs (`--no-validate` skips it). Exit 0 = clean, 1 = findings or failure.
 */
import { createHash } from 'node:crypto';
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
const NAME = '"?[a-z_][a-z0-9_]*"?';
const NAME_LIST = `${NAME}(, ?${NAME})*`;
const OWNER = `"?${AUDIT_OWNER}"?`;
/**
 * Rule 12, bootstrap lane: the only statements that may mention the audit owner without the approval marker
 * (deny-by-default, PR5-SEC-02 / CR m1). Each one sets the role up or tightens it, as 00-roles.sql and 01-schemas.sql
 * do (data-model §4.4), and is matched against the whole whitespace-normalised statement:
 * - `ALTER ROLE platform_audit_owner` with NO* attributes only (no LOGIN, PASSWORD, RENAME, SET, VALID UNTIL, ...);
 * - `GRANT USAGE|CREATE ON SCHEMA <schemas> TO platform_audit_owner` (schema privileges for the no-member owner);
 * - `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner [IN SCHEMA <schemas>] REVOKE ...`.
 * Everything else that names the role (membership grants in any position, SET ROLE, OWNER TO, REASSIGN/DROP OWNED,
 * ALTER ROLE ... LOGIN/PASSWORD/BYPASSRLS/RENAME, DROP ROLE, ALTER GROUP, default-privilege GRANTs, dynamic SQL in a
 * body) needs the marker.
 */
const AUDIT_OWNER_TIGHTENING = [
  new RegExp(`^alter role ${OWNER}( (nologin|nosuperuser|nocreatedb|nocreaterole|noreplication|nobypassrls|noinherit))+$`),
  new RegExp(`^grant (usage|create)(, ?(usage|create))? on schema ${NAME_LIST} to ${OWNER}$`),
  new RegExp(`^alter default privileges for role ${OWNER} (in schema ${NAME_LIST} )?revoke `),
];
/**
 * SHA-256 of the role-creation DO block of 00-roles.sql (whitespace collapsed), which names the audit owner inside an
 * array literal of its body. 00-roles.sql is immutable through the bootstrap ledger, so this exemption cannot drift; any
 * other body that names the role needs the marker.
 */
const AUDIT_OWNER_CREATION_BLOCK = '736c8905e08ef1110bda2f8ab3e66b5bcf2dd521c2f364762fe884c7d89a04bc';
const collapse = (statement: string): string => statement.replace(/\s+/g, ' ').trim();
/**
 * Rule 12. Migrations lane: any audit object and any mention of the audit owner fails, unconditionally.
 * Bootstrap lane: audit objects and every mention of the audit owner need the approval marker, except the
 * AUDIT_OWNER_TIGHTENING forms and the creation block.
 */
const isAuditDdl = (statement: string, lane: 'migrations' | 'bootstrap'): boolean => {
  if (AUDIT_OBJECT_PATTERN.test(statement)) return true;
  if (!AUDIT_OWNER_PATTERN.test(statement)) return false;
  if (lane === 'migrations') return true;
  if (AUDIT_OWNER_TIGHTENING.some((pattern) => pattern.test(normalise(statement)))) return false;
  return createHash('sha256').update(collapse(statement)).digest('hex') !== AUDIT_OWNER_CREATION_BLOCK;
};

/** The normalised statement with string literals, dollar-quoted bodies and comments blanked out. */
function codeOnly(statement: string): string {
  return normalise(
    tokenize(statement)
      .map((token) => (token.kind === 'string' || token.kind === 'dollar' || token.kind === 'comment' ? ' ' : token.text))
      .join(''),
  );
}

const HEADER_LINE = /^--\s*(migration-kind|data-changing|reversible)\s*:\s*(\S+)\s*$/i;
const AUDIT_MARKER = /^-- @audit-ddl security-approved: ([a-z0-9._-]+) (\d{4}-\d{2}-\d{2})$/;
const FIXED_PATH = /set search_path (=|to) pg_catalog, ?pg_temp( |;|$)/;
/** Rule 2's list: DROP TABLE / INDEX / COLUMN / CONSTRAINT and ALTER … DROP DEFAULT (`DROP x` without COLUMN too). */
const DESTRUCTIVE = [
  /^drop\s+(table|index)\b/,
  /^alter\s+table\b.*\bdrop\s+(column|constraint)\b/,
  /^alter\s+table\b.*\bdrop\s+default\b/,
  /^alter\s+table\b.*\bdrop\s+(?!column\b|constraint\b|default\b|not\b|identity\b|expression\b)"?[a-z_][a-z0-9_]*"?\s*(,|cascade|restrict|$)/,
  /^alter\s+table\b.*\bdrop\s+(column\s+)?if\s+exists\b/,
];
/** Rule 10's list, matched against the statement's code (strings and bodies blanked); a CTE may wrap the change. */
const DATA_CHANGING = [
  /^update\b/,
  /^delete\b/,
  /^truncate\b/,
  /^insert\s+into\b.*\bselect\b/,
  /^merge\b/,
  /^with\b.*(\bdelete\s+from\b|\binsert\s+into\b|\bmerge\s+into\b|(?<!\bfor |\bkey )\bupdate\b)/,
];

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
  // Code only: SECURITY DEFINER and SET may follow the body (CR m2), and a body's text must not count either way.
  const text = codeOnly(statement);
  if (/^create (or replace )?(function|procedure)\b/.test(text)) {
    return /\bsecurity definer\b/.test(text) && !FIXED_PATH.test(`${text};`);
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
    const code = codeOnly(statement);
    const preview = text.slice(0, 80);
    if (header.kind !== 'contract' && DESTRUCTIVE.some((pattern) => pattern.test(code))) {
      add('2', `destructive statement outside a contract migration: "${preview}"`);
    }
    if (header.dataChanging !== true && DATA_CHANGING.some((pattern) => pattern.test(code))) {
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
