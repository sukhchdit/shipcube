/**
 * Migration linter (data-model.md §8.3; NFR-AVAIL-003, NFR-DATA-004; SEC-TC-33; NT-AVAIL-003-a; lane A
 * `migration-lint`). A text-level early warning: ownership, the audit DDL guard and the catalog tests are the boundary
 * (§8.3 "Limits"). Owners: TASK-003 (rules 1, 2, 10, 12, 13, C) and TASK-016 (rules 3-9, 11, 14-16, the rule 13
 * extension of PR5-SEC-11 and the bootstrap secret-variable check S of PR5-SEC-12; D-ARCH-049, D-ARCH-065).
 *
 * Rules implemented here (rule numbers of §8.3). "Existing table" = a table not created by the same migration file.
 *   1   header block (`migration-kind`, `data-changing`, `reversible`) before the first statement, and a `down.sql`
 *   2   DROP TABLE/COLUMN/INDEX/CONSTRAINT/... (also `DROP [COLUMN] IF EXISTS`) or ALTER ... DROP DEFAULT outside a
 *       `contract` migration
 *   C   a `contract` migration is never declared `reversible: yes` (§8.2: restore-based rollback only)
 *   3   ALTER TABLE ... RENAME (table, column, constraint)
 *   4   on an existing table: ADD COLUMN ... NOT NULL without a constant default; ALTER COLUMN ... [SET DATA] TYPE;
 *       SET NOT NULL without a validated `CHECK (<col> IS NOT NULL)` (validated in this or an earlier migration)
 *   5   CREATE INDEX without CONCURRENTLY on an existing table; CREATE INDEX CONCURRENTLY in a multi-statement file
 *   6   ADD FOREIGN KEY / CHECK on an existing table without NOT VALID
 *   7   DROP TRIGGER, DISABLE TRIGGER, ENABLE REPLICA | ALWAYS TRIGGER | RULE (PR43-SEC-05 a), DISABLE ROW LEVEL
 *       SECURITY, NO FORCE ROW LEVEL SECURITY (any table); UPDATE,
 *       DELETE, TRUNCATE, DROP or DETACH PARTITION touching audit storage (REQ-AUDIT-015)
 *   8   DELETE (or ALL) granted to platform_app on a table without the manifest `hardDelete` flag (or on ALL TABLES);
 *       TRUNCATE, TRIGGER or REFERENCES (also via ALL) granted to platform_app on a table; any table or sequence
 *       privilege granted to PUBLIC; BYPASSRLS / SUPERUSER, ownership (OWNER TO) or role membership for platform_app;
 *       any GRANT on a partition
 *   9   DROP POLICY without a later CREATE POLICY of the same name on the same table in the file; ALTER POLICY (restate
 *       the policy as DROP + CREATE); a CREATE POLICY that is not, after `canonicalPolicy` normalisation, one of the
 *       policies `renderRls(entry)` emits for the table's manifest entry; policy DDL inside a body or dynamic SQL;
 *       CREATE TABLE in `public` whose table is in no table-class manifest, or whose class is an RLS class without
 *       ENABLE and FORCE ROW LEVEL SECURITY in the same file; a GRANT to platform_app on an RLS-class table before
 *       that table's ENABLE + FORCE (in this file, or an earlier one)
 *   10  UPDATE/DELETE/TRUNCATE/INSERT ... SELECT/MERGE, also inside a `WITH ...` statement or a DO block (dynamic SQL
 *       in string literals included), without `data-changing: yes` (backup guardrail, §8.6). A CREATE FUNCTION |
 *       PROCEDURE body is not executed at CREATE time, but its DML runs when the routine is called: a top-level call
 *       of a routine of this or an earlier migration file whose body holds one of those forms (or calls such a
 *       routine) is data-changing too (call site, PR66-SEC-02, TASK-293; see writingRoutineCall)
 *   11  ALTER TABLE, non-concurrent CREATE INDEX, CREATE TRIGGER or CREATE/ALTER/DROP POLICY on an existing table
 *       without `SET [SESSION] lock_timeout` as the first statement (`SET LOCAL` has no effect: files are not atomic);
 *       a file that leaves the session `lock_timeout` above the migrator role default (3s; 0 and unparsed values
 *       count as above) without a later `RESET lock_timeout` (the value persists into later files, D-ARCH-071); inside
 *       a DO body (incl. `EXECUTE '…'` literals) `SET [SESSION] lock_timeout`, `RESET lock_timeout` and a non-local
 *       `set_config('lock_timeout', …)` move that value too (PR11-SEC-17 c, DO-body half; D-ARCH-078); the name may be
 *       quoted (`SET "lock_timeout"`, `RESET "lock_timeout"`), and a top-level `set_config('lock_timeout', v, false)`
 *       in any statement but a routine definition (SELECT, WITH, VALUES, …; PR #43 R1-m1) is a SET to v (`true`: no
 *       effect, like SET LOCAL) (setter-key half, D-ARCH-078 (d), TASK-024)
 *   11c a top-level transaction-control statement (BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK [TO], ABORT,
 *       SAVEPOINT, RELEASE, PREPARE TRANSACTION, COMMIT/ROLLBACK PREPARED) in migration.sql or down.sql, as the first
 *       token of a statement (never in a body, CASE … END or BEGIN ATOMIC) (PR24-SEC-11, D-ARCH-099; SEC-TC-73)
 *   12  audit objects and any mention of platform_audit_owner in prisma/migrations (unconditional); in prisma/bootstrap
 *       only with an approved `-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>` header (reviewer listed, date
 *       not in the future), except the role's own tightening statements (deny-by-default, AUDIT_OWNER_TIGHTENING); in
 *       prisma/bootstrap any `U&"…"` / `U&'…'` escape and any E-prefixed escape string token counts as audit DDL
 *       (PR #11 review n5, R2-n2; PR24-SEC-05)
 *   13  SECURITY DEFINER (anywhere outside the body) without exactly one `SET search_path`, equal to
 *       `pg_catalog, pg_temp`; ALTER FUNCTION | PROCEDURE | ROUTINE ... SECURITY DEFINER, RESET search_path, RESET ALL
 *       or any other SET search_path; a bootstrap file whose first statement is not that SET
 *   14  CREATE SCHEMA, CREATE EXTENSION, ALTER DATABASE, ALTER SCHEMA ... OWNER TO, ALTER/CREATE/DROP ROLE|USER,
 *       ALTER DEFAULT PRIVILEGES, GRANT/REVOKE ... ON SCHEMA (PR11-SEC-15 d); CREATE OPERATOR [CLASS | FAMILY]
 *       (PR24-SEC-02), CREATE [OR REPLACE] RULE (PR11-SEC-15 e), CREATE CAST and CREATE [OR REPLACE] AGGREGATE
 *       (D-ARCH-172, TASK-034: a writer used as a cast or an aggregate support function is a call rule 10 cannot
 *       see) and CREATE TYPE … AS RANGE (D-ARCH-237, PR034-SEC-05: its `subtype_diff` is called at every GiST build and
 *       insert without being named) are refused outright
 *   15  GRANT/REVOKE on a function after its `OWNER TO platform_definer` in the same file; CREATE FUNCTION ...
 *       SECURITY DEFINER outside a `SET [SESSION] ROLE platform_definer; ... RESET ROLE;` block (the only accepted
 *       form, PR11-SEC-07); any `ALTER … OWNER TO platform_definer` (D-ARCH-071 (2) b); a file that ends with a
 *       SET ROLE still in effect; `set_config('role' | 'session_authorization', …)` anywhere (PR11-SEC-15 b)
 *   16  tenant-context writes and reads from the shared list tools/db/tenant-key-forms.ts (bodies and dynamic SQL
 *       included): every write form anywhere (DISCARD on text without string literals; every E-prefixed escape
 *       string, token-level, PR11-SEC-16); every read form outside the §4.2 helper definitions, except the
 *       renderer's operator-scope atom, exactly, inside a CREATE POLICY (app.correlation_id reads stay allowed);
 *       dynamic SQL in a CREATE FUNCTION | PROCEDURE whose name and definition digest are not on
 *       DYNAMIC_SQL_ALLOW_LIST (PR11-SEC-14 b, PR43-SEC-06 d): a bare `execute` word in the body code (PR #43 R1-m2) or
 *       a call of query_to_xml, query_to_xmlschema, query_to_xml_and_xmlschema, ts_stat or ts_rewrite (PR43-SEC-06 b);
 *       one finding per statement
 *   17  down.sql: every `DROP …` and `ALTER TABLE … DROP [COLUMN | CONSTRAINT]` carries IF EXISTS (PR11-SEC-07,
 *       D-ARCH-071); down.sql is otherwise only checked for 11c and L. Not covered (outside the TASK-024 AC; PR #43
 *       R1-n6 b): `ALTER TYPE … DROP ATTRIBUTE` and `ALTER DOMAIN … DROP CONSTRAINT`, which have IF EXISTS forms too
 *   18  (F-04) DROP INDEX of a COVERING_INDEX_TOLERANCE index unless the same file re-creates it WITH INCLUDE
 *   19  (F-11) DROP INDEX of a partial index an earlier file created unless the same file re-creates it with its WHERE
 *       clause; a different predicate is "partial-index predicate changed: review required" (D-ARCH-077, SPK-08)
 *   20  `standard_conforming_strings` or `backslash_quote` named anywhere (SET, set_config, routine SET clauses,
 *       ALTER … SET; bodies and dynamic SQL included), in both lanes (PR43-SEC-06 a)
 *   21  load-time expressions (PR034-SEC-01, D-ARCH-236): in a CHECK, GENERATED ALWAYS AS, PARTITION BY RANGE | LIST |
 *       HASH or SET EXPRESSION AS clause of CREATE | ALTER TABLE or CREATE | ALTER DOMAIN (migration.sql and down.sql),
 *       (a) a call of any routine of this or an earlier migration (the rule-10 registry, writing or not), (b) a routine
 *       or OPERATOR(…) qualified with a schema other than pg_catalog, (c) query_to_xml, query_to_xmlschema,
 *       query_to_xml_and_xmlschema, ts_stat or ts_rewrite, (d) a clause whose closing parenthesis cannot be found with
 *       literals blanked (fail closed). A restore evaluates these expressions as the loading superuser. The clause is
 *       delimited by parenthesis depth; a string literal in it is read as rule 10 reads one (a name in it counts).
 *       Not load-time clauses: a column DEFAULT, a policy's USING / WITH CHECK, an index, a trigger, GENERATED … AS
 *       IDENTITY. Limits: an unqualified call that the search path resolves to a routine of an extension or of the
 *       bootstrap lane, and a built-in outside list (c) that is not IMMUTABLE (`set_config`, `ts::date`), are not seen;
 *       catalog test C17 and the load-time gate of db:backup / db:verify-restore are the boundary (tools/db/load-time-code.ts)
 *   L   a file (migration.sql, down.sql, a bootstrap file) that does not split into statements is reported and not
 *       linted further (fail closed; PR43-SEC-03, PR43-SEC-11): it does not lex, ends inside a `BEGIN ATOMIC` block,
 *       has anything but `;` after the END of a routine body, or a body `;` inside parentheses (sql-text.ts
 *       splitStatements: the block boundaries follow PostgreSQL's grammar, so labels never move them; its token
 *       boundaries follow PostgreSQL's scanner, PR66-SEC-01); also, without stopping the lint, a lone CR anywhere in
 *       the file (PR66-SEC-01: it ends a `--` comment, invisibly in review)
 *   S   bootstrap lane: only the variables db_name, migrator_password and app_password, and every PASSWORD keyword in
 *       code is followed by :'migrator_password', :'app_password' or NULL (PR5-SEC-12)
 *   R   a `data-changing: yes` migration without a fresh, passed backup/restore rehearsal record (`rehearsal.json` in its
 *       directory, written by tools/db/verify-restore.ts; CLAUDE.md §5, §8.6; TASK-034). Run by lintRepository (the CLI
 *       and lane A) through lintRehearsals, not by lintMigrations, so the fixture cases are unchanged
 * Rules 2-11, 14-19, 21 and R apply to prisma/migrations; 12, 13, 20, L and S also (or only) to prisma/bootstrap.
 *
 * Stated limits (text rules cannot be complete over dynamic SQL; PR #11 review R2-n2, PR11-SEC-14/15/17): a setter
 * whose name and key are both built by `format()` or keyword-split concatenation, `EXECUTE` of a computed or table-read
 * statement in a DO body, a read through `pg_show_all_settings()`, and a `SET ROLE` inside a DO body are not seen by
 * rules 15 and 16 (`set_config('role' | 'session_authorization', …)` is, since TASK-024); rules 8, 9 b and the SET
 * ROLE block of rule 15 do not read DO bodies. Rules 10, 11
 * and 16 read DO bodies (TASK-021): rule 11 sees `SET [SESSION] lock_timeout`, `RESET lock_timeout` and
 * `set_config('lock_timeout', …)` there, in the body and in its string literals, but not a key or name computed at
 * run time (`EXECUTE v_sql`); a DO-body RESET or lower SET never lowers the tracked value (PR24-SEC-03: it may sit in a
 * message, a dead branch or an unused string), so only a top-level RESET clears a raised value; dynamic SQL nested
 * deeper than MAX_DYNAMIC_DEPTH is not read, and a literal there that names `lock_timeout` counts as a raised SET.
 * Seen since TASK-024 (setter-key half): `SET "lock_timeout"` / `RESET "lock_timeout"` (quoted name) and a top-level
 * `SELECT set_config('lock_timeout', …)`. Still not seen: a function created in the file whose body sets
 * `lock_timeout` and that is then called (`SELECT f()`; PR #24 R1-n7), and a top-level set_config whose key is
 * computed. Rule 10 sees that call shape since TASK-293 (PR66-SEC-02: a top-level call of a writing routine of this or
 * an earlier migration file, also after RENAME TO / SET SCHEMA); it still does not see a writing routine of the
 * bootstrap lane, a write reached only through `EXECUTE` of a string built at run time, a call through a computed name,
 * or attribute notation (PR293-SEC-01 row 3, pinned by a test). A cast function or an aggregate support function
 * (rows 4 and 5) cannot occur, because rule 14 refuses CREATE CAST and CREATE AGGREGATE (D-ARCH-172), nor can a range
 * type's `subtype_diff` (rule 14 refuses CREATE TYPE … AS RANGE, D-ARCH-237). Rule 10 reads
 * every string literal of a DO or routine body as dynamic SQL, so prose such as `RAISE NOTICE 'in update mode'` is a
 * finding too (fail closed; PR293-SEC-04 b, kept by TASK-034). The outcome controls are the
 * catalog suite (C5 grants incl. PUBLIC, C1
 * ENABLE/FORCE, the C11 converse on definer-owned objects), the withTenantTx session-leak check and, for rule 11, the
 * next file's own leading `SET lock_timeout`.
 *
 * CLI (`npm run db:lint-migrations`): lints prisma/migrations and prisma/bootstrap, then runs `prisma validate`
 * through tools/deps/prisma-cli.mjs (`--no-validate` skips it). Exit 0 = clean, 1 = findings or failure.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from './rehearsal-manifest.js';
import { RECORD_FILE, migrationNames, rehearsalProblems } from './rehearsal-record.js';
import { RenderRlsError, renderRls } from './render-rls.js';
import {
  ESCAPE_STRING_MARK,
  SqlLexError,
  type Token,
  containsEscapeString,
  decodeLineBreaks,
  literalBody,
  normalise,
  referencedVariables,
  splitStatements,
  sqlText,
  tokenize,
  tolerantRead,
} from './sql-text.js';
import { RLS_CLASSES, loadTableClasses, type TableClassEntry } from './table-classes.js';
import { CONTEXT_DISCARD, contextReads, contextWrites } from './tenant-key-forms.js';

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
 * Rule 12, bootstrap lane (PR #5 R2-n1, PR #11 code review n5 + R2-n2): a `U&"…"` identifier or `U&'…'` string, in
 * code or inside a body, spells an audit object or the audit owner without its text (`U&"audit\005fentries_x"`, with
 * any UESCAPE character). The token itself counts as audit DDL, so the file needs the approval marker. Chosen over
 * decoding: no decoder to get wrong (UESCAPE, 4- and 6-digit forms, surrogates, nesting in dynamic SQL), the same
 * fail-closed choice rule 16 makes (PR11-SEC-14 a), and the lane has no use for Unicode escapes. A false positive
 * (`U&` in a message text) only asks for a security review. In prisma/migrations rule 16 refuses every `U&` already.
 */
const UNICODE_ESCAPE = /(^|[^a-z0-9_$])u&["']/i;
/**
 * Rule 12. Migrations lane: any audit object and any mention of the audit owner fails, unconditionally.
 * Bootstrap lane: audit objects, every `U&` escape, every E-prefixed escape string (token-level, in code, bodies or
 * dynamic SQL: `E'audit\x5fentries'` spells an audit object the same way; PR24-SEC-05) and every mention of the audit
 * owner need the approval marker, except the AUDIT_OWNER_TIGHTENING forms and the creation block.
 */
const isAuditDdl = (statement: string, lane: 'migrations' | 'bootstrap'): boolean => {
  if (AUDIT_OBJECT_PATTERN.test(statement)) return true;
  if (lane === 'bootstrap' && (UNICODE_ESCAPE.test(statement) || containsEscapeString(statement))) return true;
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
/**
 * Rule 10's list, matched against the statement's code (strings and bodies blanked); a CTE may wrap the change. An
 * upsert (`INSERT … ON CONFLICT … DO UPDATE`) rewrites existing rows and counts too; `ON CONFLICT … DO NOTHING` does
 * not (D-SEC-PR8-01, PR8-SEC-03).
 */
const DATA_CHANGING = [
  /^update\b/,
  /^delete\b/,
  /^truncate\b/,
  /^insert\s+into\b.*\bselect\b/,
  /^insert\s+into\b.*\bon\s+conflict\b.*\bdo\s+update\b/,
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

/**
 * True when `statement` declares or alters a SECURITY DEFINER routine without the fixed search path. PostgreSQL applies
 * SET clauses left to right and the last one wins (PR5-SEC-11), so exactly one `SET search_path` is accepted, and it
 * must be the fixed one; `SET search_path FROM CURRENT` counts as a SET. ALTER ROUTINE takes the same actions.
 */
function definerWithoutFixedPath(statement: string): boolean {
  // Code only: SECURITY DEFINER and SET may follow the body (CR m2), and a body's text must not count either way.
  const text = codeOnly(statement);
  const pathSets = text.match(/\bset search_path\b/g)?.length ?? 0;
  const fixedOnly = pathSets === 1 && FIXED_PATH.test(`${text};`);
  if (/^create (or replace )?(function|procedure)\b/.test(text)) {
    return /\bsecurity definer\b/.test(text) && !fixedOnly;
  }
  if (/^alter (function|procedure|routine)\b/.test(text)) {
    if (/\bsecurity definer\b/.test(text)) return true;
    if (/\b(reset search_path|reset all)\b/.test(text)) return true;
    return pathSets > 0 && !fixedOnly;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// TASK-016 rules (3-9, 11, 14-16). They match the MASKED text: comments removed, every string literal replaced by
// `''` and every dollar-quoted body by `$$`, whitespace collapsed, lowercased. Rule 16 reads bodies (see sqlText).
// ---------------------------------------------------------------------------------------------------------------

/** One identifier: quoted (no embedded quotes) or plain. Matched against lowercased text. */
const IDENT = '(?:"[^"]+"|[a-z_][a-z0-9_$]*)';
/** An optionally schema-qualified name. */
const QNAME = `${IDENT}(?: ?\\. ?${IDENT})?`;
const ALTER_TABLE = new RegExp(`^alter table (?:if exists )?(?:only )?(${QNAME})(?: \\*)?`);
const CREATE_TABLE = new RegExp(`^create (?:(?:global |local )?(?:temporary|temp) |unlogged )?table (?:if not exists )?(${QNAME})`);
const PARTITION_OF = new RegExp(`\\bpartition of (${QNAME})`);
const CREATE_INDEX = new RegExp(`^create (?:unique )?index (concurrently )?(?:if not exists )?(?:${IDENT} )?on (?:only )?(${QNAME})`);
const CREATE_TRIGGER = new RegExp(`^create (?:or replace )?(?:constraint )?trigger ${IDENT} .*? on (${QNAME})`);
const POLICY = new RegExp(`^(create|alter|drop) policy (?:if exists )?(${IDENT}) on (${QNAME})`);
const ROUTINE_NAME = new RegExp(`^(?:create (?:or replace )?|alter )(?:function|procedure|routine) (${QNAME}) ?\\(`);
const ROUTINE_LIST_NAME = new RegExp(`(${QNAME}) ?\\(`, 'g');
const GRANT_ON = /^(grant|revoke) (?:grant option for )?(.+?) on (.+?) (?:to|from) (.+)$/;
/**
 * Rule 11. Only the session form counts: a migration file is not atomic (prisma/README.md "Rule 5" item 3), so each
 * statement runs outside a transaction block, where `SET LOCAL` has no effect (PR11-SEC-07).
 */
/** The setting's name, plain or quoted (`SET "lock_timeout" = 0`; PR11-SEC-17 c, setter-key half, D-ARCH-078 (d)). */
const LOCK_TIMEOUT_NAME = '(?:lock_timeout|"lock_timeout")(?![a-z0-9_$"])';
const LOCAL_LOCK_TIMEOUT = new RegExp(`^set local ${LOCK_TIMEOUT_NAME}`);
/**
 * Rule 11 (D-ARCH-071): the session value persists on the deploy connection into later files, so a file that raises
 * `lock_timeout` above the migrator's role default (`ALTER ROLE platform_migrator SET lock_timeout = '3s'`,
 * prisma/bootstrap/00-roles.sql) must end at or below it, normally with `RESET lock_timeout`.
 */
export const MIGRATOR_LOCK_TIMEOUT_MS = 3_000;
/** `SET [SESSION] lock_timeout { = | TO } <value>` on string-kept, normalised text; `RESET lock_timeout` (name quoted or not). */
const LOCK_TIMEOUT_VALUE = new RegExp(`^set (?:session )?${LOCK_TIMEOUT_NAME} ?(?:=|to\\b) ?(.+?)$`);
const LOCK_TIMEOUT_RESET = new RegExp(`^reset ${LOCK_TIMEOUT_NAME}$`);
/**
 * A top-level `[pg_catalog.]set_config('lock_timeout', <value>, <is_local>)` in any statement that is not a routine
 * definition (`SELECT`, `WITH … SELECT`, `VALUES`, …; PR11-SEC-17 c, D-ARCH-078 (d), PR #43 R1-m1): a SET to <value>
 * unless is_local is a true literal (that value ends with the statement's own transaction, like `SET LOCAL`). Matched
 * on the statement with strings kept and bodies blanked: a function body is not executed here.
 */
const ROUTINE_DEFINITION = /^create (?:or replace )?(?:function|procedure)\b/;
const TOP_SET_CONFIG = /\bset_config"? ?\( ?'"?lock_timeout"?' ?, ?([^,]*?) ?, ?([^)]*?) ?\)/g;
const BOOLEAN_TRUE = /^'?(?:t|tr|tru|true|y|ye|yes|on|1)'?$/;
/** The top-level change of the session `lock_timeout` one statement makes; `local` = a LOCAL form without effect. */
type TopLockTimeout = { readonly kind: 'set'; readonly value: string } | { readonly kind: 'reset' } | { readonly kind: 'local' };

function topLevelLockTimeout(statement: string, maskedText: string): TopLockTimeout | undefined {
  if (LOCAL_LOCK_TIMEOUT.test(maskedText)) return { kind: 'local' };
  if (LOCK_TIMEOUT_RESET.test(maskedText)) return { kind: 'reset' };
  let kept: string;
  try {
    kept = normalise(
      tokenize(statement)
        .map((token) => (token.kind === 'comment' ? ' ' : token.kind === 'dollar' ? ' $$ ' : token.text))
        .join(''),
    );
  } catch (error) {
    if (!(error instanceof SqlLexError)) throw error;
    return undefined;
  }
  const value = LOCK_TIMEOUT_VALUE.exec(kept);
  if (value) return { kind: 'set', value: value[1] as string };
  // Every top-level statement but a routine definition (PR #43 R1-m1): `WITH … AS (SELECT set_config(…)) SELECT …`
  // and `VALUES (set_config(…))` run the setter as `SELECT` does. Bodies are blanked above.
  if (ROUTINE_DEFINITION.test(kept)) return undefined;
  let found: TopLockTimeout | undefined;
  for (const match of kept.matchAll(TOP_SET_CONFIG)) {
    if (!BOOLEAN_TRUE.test((match[2] ?? '').trim())) found = { kind: 'set', value: match[1] ?? '' };
    else found ??= { kind: 'local' };
  }
  return found;
}
/**
 * Rule 11 (c) (PR24-SEC-11, D-ARCH-099; SEC-TC-73): a top-level transaction-control statement, matched on the first
 * token of the statement's code. `BEGIN; RESET lock_timeout; ROLLBACK;` undoes the RESET the linter counted, and a
 * transaction left open swallows the files after it. Bodies, `CASE … END` and `BEGIN ATOMIC … END` never match: they
 * are not the start of a top-level statement (splitStatements keeps a `BEGIN ATOMIC` body whole).
 */
const TRANSACTION_CONTROL = /^(?:begin|start transaction|commit|end|rollback|abort|savepoint|release|prepare transaction)(?![a-z0-9_$])/;
const transactionControl = (statement: string): string | undefined =>
  TRANSACTION_CONTROL.test(codeOnly(statement))
    ? `transaction control (rule 11c): BEGIN/START TRANSACTION/COMMIT/END/ROLLBACK/ABORT/SAVEPOINT/RELEASE/PREPARE TRANSACTION are refused in migration.sql and down.sql (a rolled-back block undoes what the linter counted, an open one swallows later statements; PR24-SEC-11): "${normalise(statement).slice(0, 80)}"`
    : undefined;
/**
 * Rule 17 (PR11-SEC-07, D-ARCH-071): every `DROP …` and `ALTER TABLE … DROP [COLUMN | CONSTRAINT]` in down.sql carries
 * `IF EXISTS`, so a partial or repeated rollback re-runs cleanly. `DROP OWNED` has no IF EXISTS form and is exempt.
 */
function dropWithoutIfExists(statement: string): boolean {
  const text = masked(statement);
  if (/^drop (?!owned\b)/.test(text)) return !/^drop (?:[a-z_]+ ){1,3}?if exists\b/.test(text);
  const altered = ALTER_TABLE.exec(text);
  if (!altered) return false;
  return splitActions(text.slice(altered[0].length)).some(
    (action) => /^drop\b/.test(action) && !/^drop (?:column |constraint )?if exists\b/.test(action),
  );
}
/** PostgreSQL time units for an integer GUC whose base unit is ms (guc.c `time_unit_conversion_table`). */
const TIME_UNIT_MS: Readonly<Record<string, number>> = { us: 0.001, ms: 1, s: 1_000, min: 60_000, h: 3_600_000, d: 86_400_000 };

/** One change of the session `lock_timeout` inside a DO block: a value (`set`, raw text) or `reset`. */
export type LockTimeoutEvent = { readonly kind: 'set'; readonly value: string } | { readonly kind: 'reset' };
const LITERAL_SLOT = '\u0001';
const SLOT = new RegExp(`${LITERAL_SLOT}(\\d+)${LITERAL_SLOT}`, 'g');
/**
 * Nesting bound of dynamic SQL inside a DO body (`EXECUTE '… EXECUTE ''…'' …'`); deeper text is not read, and a deeper
 * literal that mentions `lock_timeout` counts as one unknown SET (fail closed).
 */
const MAX_DYNAMIC_DEPTH = 4;
/**
 * Rule 11 inside a DO body (PR11-SEC-17 c, DO-body half; D-ARCH-078), in text order. Matched on the body with every
 * string literal and nested dollar body replaced by a slot, so a SET is only seen at a PL/pgSQL statement start (body
 * start, `;`, BEGIN, THEN, ELSE, LOOP); each literal is then read as dynamic SQL in its own right (`EXECUTE '…'`,
 * `format('…')`), so its SET/RESET counts at its position:
 *  - `SET [SESSION] lock_timeout { = | TO } <value>` (the value up to `;`; an empty or computed value fails closed);
 *  - `RESET lock_timeout`;
 *  - `set_config('lock_timeout', <value>, <is_local>)` anywhere, unless is_local is the literal `true` (that value
 *    ends with the DO block's transaction, like `SET LOCAL`, which is not counted either).
 * The quoted setter name (`SET "lock_timeout"`, `RESET "lock_timeout"`) counts here too; a top-level `set_config` is
 * read by topLevelLockTimeout (TASK-024 setter-key half).
 */
const DO_LOCK_TIMEOUT = new RegExp(
  `(?:^|[;]|\\b(?:begin|then|else|loop)\\b) ?set (?:session )?${LOCK_TIMEOUT_NAME} ?(?:=|to) ?([^;]*)` +
    `|(?:^|[;]|\\b(?:begin|then|else|loop)\\b) ?(reset) ${LOCK_TIMEOUT_NAME}` +
    `|\\bset_config"? ?\\( ?${LITERAL_SLOT}(\\d+)${LITERAL_SLOT} ?, ?([^,]*?) ?, ?([^)]*?) ?\\)` +
    `|${LITERAL_SLOT}(\\d+)${LITERAL_SLOT}`,
  'g',
);

/** The text of a string literal or dollar body token, unquoted (`''` -> `'`); E-string escapes are left as written. */
function literalText(token: string): string {
  if (token.startsWith('$')) {
    const tag = (/^\$[^$]*\$/.exec(token) as RegExpExecArray)[0];
    return token.slice(tag.length, token.length - tag.length);
  }
  return token
    .replace(/^[eE]'/, "'")
    .slice(1, -1)
    .replaceAll("''", "'");
}

/** The `lock_timeout` changes a DO statement (or dynamic SQL text at `depth`) makes, in order; see DO_LOCK_TIMEOUT. */
export function doBlockLockTimeouts(sql: string, depth = 0): LockTimeoutEvent[] {
  let tokens;
  try {
    tokens = tokenize(sql);
  } catch (error) {
    if (!(error instanceof SqlLexError)) throw error;
    // Dynamic SQL that does not lex on its own (a fragment glued at run time): read it as one unknown SET if it names
    // the setting at all, so a raised value cannot hide in it (fail closed).
    return /\block_timeout\b/i.test(sql) ? [{ kind: 'set', value: sql }] : [];
  }
  if (depth === 0 && !/^do\b/.test(codeOnly(sql))) return [];
  const literals: string[] = [];
  const text = normalise(
    tokens
      .map((token) => {
        if (token.kind === 'comment') return ' ';
        if (token.kind !== 'string' && token.kind !== 'dollar') return token.text;
        return `${LITERAL_SLOT}${String(literals.push(token.text) - 1)}${LITERAL_SLOT}`;
      })
      .join(''),
  );
  const resolve = (value: string) =>
    value
      .replace(SLOT, (_, at: string) => literals[Number(at)] ?? '')
      .trim()
      .toLowerCase();
  const events: LockTimeoutEvent[] = [];
  for (const match of text.matchAll(DO_LOCK_TIMEOUT)) {
    const [, setValue, reset, configKey, configValue, configLocal, nested] = match;
    if (setValue !== undefined) events.push({ kind: 'set', value: resolve(setValue) });
    else if (reset !== undefined) events.push({ kind: 'reset' });
    else if (configKey !== undefined) {
      const key = normalise(literalText(literals[Number(configKey)] ?? ''));
      if (key === 'lock_timeout' && resolve(configLocal ?? '') !== 'true') {
        events.push({ kind: 'set', value: resolve(configValue ?? '') });
      }
    } else if (nested !== undefined && depth < MAX_DYNAMIC_DEPTH) {
      events.push(...doBlockLockTimeouts(literalText(literals[Number(nested)] ?? ''), depth + 1));
    } else if (nested !== undefined && /\block_timeout\b/i.test(literals[Number(nested)] ?? '')) {
      // Past the nesting bound the text is not read: a literal that names the setting there counts as one unknown SET
      // (fail closed; code review PR #24 R1-n1).
      events.push({ kind: 'set', value: literalText(literals[Number(nested)] ?? '') });
    }
  }
  return events;
}

/**
 * The milliseconds a `lock_timeout` value sets, `undefined` for DEFAULT (the role default applies again) and
 * `Infinity` for 0 (no timeout) or anything this parser does not understand (fail closed: the RESET is then required).
 */
export function lockTimeoutMs(value: string): number | undefined {
  const text = value
    .trim()
    .replace(/^'(.*)'$/, '$1')
    .trim();
  if (text === 'default') return undefined;
  const match = /^(\d+(?:\.\d+)?) ?(us|ms|s|min|h|d)?$/.exec(text);
  if (!match) return Number.POSITIVE_INFINITY;
  const ms = Number(match[1]) * (TIME_UNIT_MS[match[2] ?? 'ms'] ?? Number.NaN);
  return Number.isFinite(ms) && ms > 0 ? ms : Number.POSITIVE_INFINITY;
}
const PLATFORM_APP = /(^|[^a-z0-9_])"?platform_app"?($|[^a-z0-9_])/;
const DEFINER_ROLE = '"?platform_definer"?';
/** Rule 15: `SET [SESSION | LOCAL] ROLE <role>` (`none` resets). */
const SET_ROLE = /^set (session |local )?role (.+)$/;
/** Rule 8: privileges that act outside row level security (TRUNCATE, TRIGGER, REFERENCES; `ALL` includes them). */
const RLS_INDEPENDENT_PRIVILEGES = /\b(?:truncate|trigger|references|maintain|all)\b/;
/** §4.2 helpers: the only functions that may read the four security keys (rule 16). */
const CONTEXT_HELPERS = ['app_org_id', 'app_actor_id', 'app_guest_token_hash', 'app_is_operator'];
const HELPER_DEFINITION = new RegExp(`^create (?:or replace )?function platform ?\\. ?(?:${CONTEXT_HELPERS.join('|')}) ?\\(`);
/**
 * Rule 16: the renderer's operator-scope atom (prisma/sql/policy-templates/operator.sql), normalised. It is the one
 * sanctioned read outside the §4.2 helpers, exempted exactly and only inside a CREATE POLICY statement; rule 9 then
 * requires that statement to equal the renderer output (PR11-SEC-03).
 */
const OPERATOR_SCOPE_ATOM = "current_setting('app.actor_scope', true) = 'operator'";
/** Rule 14: privilege-bound statements that belong to the bootstrap lane (§8.1, D-ARCH-033, D-ARCH-045). */
const BOOTSTRAP_ONLY = [
  /^create schema\b/,
  /^create extension\b/,
  /^alter database\b/,
  /^alter schema\b.*\bowner to\b/,
  /^(?:create|alter|drop) (?:role|user|group)\b/,
  /^alter default privileges\b/,
  // PR11-SEC-15 d: schema privileges are set once by the bootstrap lane (01-schemas.sql).
  /^(?:grant|revoke) (?:grant option for )?.+? on schema\b/,
];
/**
 * Rule 14: objects refused in prisma/migrations outright. An operator (and its class or family) or a rewrite rule
 * redirects comparisons or whole queries to code that no policy template or catalog test reviews (PR24-SEC-02 class
 * fix and PR11-SEC-15 e, lint halves). A cast or an aggregate runs a routine through syntax that names no routine
 * (`x::type`, `a(…)` calling its SFUNC or FINALFUNC), so rule 10's call site cannot follow a writer there (D-ARCH-172,
 * D-TASK293-10, PR293-SEC-01 rows 4 and 5; TASK-034). A range type names its `subtype_diff` (and `canonical`) routine
 * without a call, and PostgreSQL calls it at every GiST build and insert, so an IMMUTABLE wrapper around a writer
 * changes data in a migration declared `data-changing: no` (D-ARCH-237, PR034-SEC-05; its catalog half is C17 (b)). No
 * table, index or policy of the data model needs any of them (`valid_during` is the built-in `tstzrange`).
 */
const REFUSED_OBJECTS = [
  /^create operator\b/,
  /^create (?:or replace )?rule\b/,
  /^create cast\b/,
  /^create (?:or replace )?aggregate\b/,
  /^create type\b[^;]*\bas range\b/,
];
/**
 * Rule 15 (PR11-SEC-15 b): `set_config('role' | 'session_authorization', …)` in any case, with the setter or the key
 * quoted, at any quoting depth of dynamic SQL (`''role''`), matched on the body-expanded text with strings kept.
 */
const SET_CONFIG_ROLE = /\bset_config"? ?\( ?'+"?(?:role|session_authorization)"?'+ ?,/;
/**
 * Rule 18 (F-04, D-ARCH-077, SPK-08): covering indexes (`INCLUDE`) a migration may drop only to re-create them WITH
 * `INCLUDE` in the same file. Every `INCLUDE` index of prisma/migrations belongs here (TASK-024; TASK-037 AP-ORG-08).
 */
export const COVERING_INDEX_TOLERANCE: readonly string[] = ['ix_role_permissions__role_id', 'ix_memberships__user_status'];
const CREATE_INDEX_NAMED = new RegExp(`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(${IDENT}) on (?:only )?(${QNAME})`);
const DROP_INDEX = /^drop index (?:concurrently )?(?:if exists )?(.+?)(?: cascade| restrict)?$/;

/** One CREATE INDEX of a file: qualified name, statement index, INCLUDE and the canonical WHERE predicate. */
interface CreatedIndex {
  readonly name: string;
  readonly at: number;
  readonly include: boolean;
  readonly predicate: string | undefined;
}

/** `p` without parentheses that wrap all of it (`((a))` -> `a`). */
function unwrap(predicate: string): string {
  let text = predicate.trim();
  for (;;) {
    if (!text.startsWith('(') || !text.endsWith(')')) return text;
    let depth = 0;
    for (let i = 0; i < text.length - 1; i += 1) {
      if (text[i] === '(') depth += 1;
      if (text[i] === ')') depth -= 1;
      if (depth === 0) return text;
    }
    text = text.slice(1, -1).trim();
  }
}

/** The CREATE INDEX of `statement` (masked `text`), if it is one. */
function createdIndex(statement: string, text: string, at: number): CreatedIndex | undefined {
  const match = CREATE_INDEX_NAMED.exec(text);
  if (!match) return undefined;
  const schema = qualify(match[2] as string).split('.')[0] as string;
  const where = /\bwhere\b/.test(text) ? /(?:^|[ )])where(?=[ (])(.*)$/.exec(canonicalPolicy(statement)) : null;
  return {
    name: `${schema}.${unquote(match[1] as string)}`,
    at,
    include: /\binclude ?\(/.test(text),
    predicate: where ? unwrap(where[1] as string) : undefined,
  };
}

/** Qualified names a `DROP INDEX` (masked text) drops. */
function droppedIndexes(text: string): string[] {
  const match = DROP_INDEX.exec(text);
  return match ? (match[1] as string).split(',').map((name) => qualify(name.trim())) : [];
}

/**
 * Rule 16, dynamic-SQL allow-list, lint half (PR11-SEC-14 b): qualified names of the functions and procedures whose
 * body may run dynamic SQL (`EXECUTE …`). Each entry is security-reviewed; the migrations lane has none today. DO
 * bodies keep their own handling (rules 10, 11 and 16 read their literals as dynamic SQL).
 */
export const DYNAMIC_SQL_ALLOW_LIST: readonly DynamicSqlAllowance[] = [];
/**
 * One reviewed routine (PR43-SEC-06 d): its qualified name and the SHA-256 (hex) of its definition as
 * routineDefinitionSha256 computes it. A routine with the name but another definition is not allowed, so a later
 * CREATE OR REPLACE needs a new review.
 */
export interface DynamicSqlAllowance {
  readonly name: string;
  readonly definitionSha256: string;
}
/**
 * SHA-256 (hex) of a routine definition: the CREATE statement as splitStatements returns it (comments removed), with
 * whitespace runs collapsed to one space. It covers the body and the head (SECURITY DEFINER, SET clauses), so neither
 * can change under an allow-list entry.
 */
export function routineDefinitionSha256(statement: string): string {
  return createHash('sha256').update(statement.replace(/\s+/g, ' ').trim()).digest('hex');
}
/** True when `list` holds `name` with exactly this definition (name alone never suffices). */
export function dynamicSqlAllowed(name: string, statement: string, list: readonly DynamicSqlAllowance[] = DYNAMIC_SQL_ALLOW_LIST): boolean {
  const digest = routineDefinitionSha256(statement);
  return list.some((entry) => entry.name === name && entry.definitionSha256 === digest);
}
/**
 * Functions that run a query string without the EXECUTE keyword (PR43-SEC-06 b): `query_to_xml`,
 * `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `ts_stat` and `ts_rewrite` (every form, fail closed).
 */
const QUERY_STRING_FUNCTION = /(?<![a-z0-9_$])"?(query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|ts_stat|ts_rewrite)"? ?\(/;

/**
 * The routine's string-free code split into its body (dollar-quoted bodies and an `AS '…'` string body, each expanded
 * with sqlText, strings and comments blanked) and the whole statement (head, `BEGIN ATOMIC` / `RETURN` bodies and the
 * expanded bodies), both normalised.
 */
function routineCode(statement: string): { body: string; all: string } {
  const bodies: string[] = [];
  let previousCode = '';
  const expand = (text: string): string => {
    try {
      return sqlText(text, false);
    } catch {
      return text; // A body that does not lex is scanned verbatim (fail closed).
    }
  };
  const all = tokenize(statement)
    .map((token) => {
      if (token.kind === 'code' || token.kind === 'identifier') {
        if (token.kind === 'code') previousCode = token.text;
        return token.text;
      }
      const isBody = token.kind === 'dollar' || (token.kind === 'string' && /\bas\s*$/i.test(previousCode));
      if (!isBody) return ' ';
      const body = expand(literalBody(token));
      bodies.push(body);
      return ` ${body} `;
    })
    .join('');
  return { body: normalise(bodies.join(' ; ')), all: normalise(all) };
}

/**
 * The qualified name of the routine `statement` creates when it runs dynamic SQL and is not on DYNAMIC_SQL_ALLOW_LIST
 * with this definition: a bare `execute` word in its body code (PR #43 R1-m2: mirrors the catalog `\mexecute\M`; a
 * PL/pgSQL variable named `function` or `procedure` is no exemption, and `EXECUTE FUNCTION` / `GRANT EXECUTE` cannot
 * be body code outside a string), or a QUERY_STRING_FUNCTION call anywhere in it (any language: PL/pgSQL, SQL string
 * bodies, `BEGIN ATOMIC` and `RETURN` bodies).
 */
function dynamicSqlRoutine(statement: string, maskedText: string): string | undefined {
  const routine = ROUTINE_DEFINITION.test(maskedText) ? ROUTINE_NAME.exec(maskedText) : null;
  if (!routine) return undefined;
  const name = qualify(routine[1] as string);
  const code = routineCode(statement);
  const dynamic = /\bexecute\b/.test(code.body) || QUERY_STRING_FUNCTION.test(code.all);
  return dynamic && !dynamicSqlAllowed(name, statement) ? name : undefined;
}

/** Role-membership targets that would hand platform_app another role's privileges (rule 8). */
const MEMBERSHIP_GRANT = /^grant (?!.*\bon\b)(.+?) to (.+?)(?: with (?:admin|inherit|set) (?:option|true|false))*(?: granted by .+)?$/;

const unquote = (name: string): string => name.replace(/"/g, '').replace(/ /g, '');
/** `schema.name`, `public` when unqualified (matched on lowercased text). */
const qualify = (name: string): string => {
  const plain = unquote(name);
  return plain.includes('.') ? plain : `public.${plain}`;
};

/** The statement with comments removed, string literals as `''` and bodies as `$$`, normalised. */
function masked(statement: string): string {
  return normalise(
    tokenize(statement)
      .map((token) => {
        if (token.kind === 'string') return "''";
        if (token.kind === 'dollar') return '$$';
        return token.kind === 'comment' ? ' ' : token.text;
      })
      .join(''),
  );
}

/** A string or dollar token's body read as SQL: an E-string's line-break escapes are line breaks there (TASK-034 R1-M2). */
const nestedSql = (token: Token): string => (token.escape === true ? decodeLineBreaks(literalBody(token)) : literalBody(token));

/**
 * Rule 10 inside a DO block (PR #5 R2-m2, PR #11 review m6): a data-changing statement at a PL/pgSQL statement start
 * (file start, `;`, BEGIN, THEN, ELSE, LOOP, EXECUTE) or at the start of a string literal (dynamic SQL, `EXECUTE '…'`,
 * `format('…')`). Matched on the body-expanded text with string literals kept. A DO block runs at migration time; a
 * CREATE FUNCTION body runs only when the routine is called, so a definition is not data-changing itself and is read
 * for the call-site half instead (writingRoutineCall, PR66-SEC-02). `FOR [NO KEY] UPDATE` and `GRANT UPDATE`
 * do not start a statement and stay clean. A key built entirely at run time (`EXECUTE v_sql`) is not visible here.
 *
 * The forms (each after a statement start): `UPDATE [ONLY] <name>`, `DELETE FROM`, `TRUNCATE`, `MERGE INTO`,
 * `INSERT INTO … SELECT`, `INSERT INTO … ON CONFLICT … DO UPDATE`, and `WITH … DELETE FROM | INSERT INTO | MERGE INTO |
 * UPDATE <name>`, where `…` never crosses a `;`. Matched per `;`-separated segment, with the earliest qualifying start
 * of each multi-part form followed by plain searches, so the cost is linear in the text (TASK-293 code review R1-n3: the
 * nested lazy pattern it replaces backtracked for seconds on a 60 KB routine body without `;`).
 */
function bodyDataChanging(starts: string): (text: string) => boolean {
  const start = `(?:^|'|\\b(?:${starts})) ?`;
  const simple = new RegExp(`${start}(?:update (?:only )?${QNAME}|delete from\\b|truncate\\b|merge into\\b)`);
  const insert = new RegExp(`${start}insert into\\b`);
  const withStart = new RegExp(`${start}with\\b`);
  // A row lock (`FOR [NO KEY] UPDATE`) inside the WITH query is no write (code review R3-n1), as at top level (DATA_CHANGING).
  const withWrite = new RegExp(`\\b(?:delete from|insert into|merge into|(?<!\\bfor |\\bkey )update (?:only )?${QNAME})`);
  const after = (segment: string, match: RegExpExecArray | null): string | undefined =>
    match === null ? undefined : segment.slice(match.index + match[0].length);
  const insertWrites = (rest: string): boolean => {
    if (/\bselect\b/.test(rest)) return true;
    const conflict = /\bon conflict\b/.exec(rest);
    return conflict !== null && /\bdo update\b/.test(rest.slice(conflict.index + conflict[0].length));
  };
  const segmentWrites = (segment: string): boolean => {
    if (simple.test(segment)) return true;
    const insertRest = after(segment, insert.exec(segment));
    if (insertRest !== undefined && insertWrites(insertRest)) return true;
    const withRest = after(segment, withStart.exec(segment));
    return withRest !== undefined && withWrite.test(withRest);
  };
  const writes = (segment: string): boolean => segmentWrites(normalise(segment));
  /**
   * `text` is read as written (line breaks kept, so a `--` comment ends where PostgreSQL's does) and each segment is
   * normalised before matching. Segments end at a `;` of CODE only: a `;` inside a string literal or a quoted identifier
   * (`UPDATE "a;b"`, `WITH x AS (SELECT ';') DELETE …`) never cuts a statement (PR293-SEC-01 rows 9-11), and a comment
   * is one space, so a comment before a statement hides it nowhere (TASK-034 code review R1-M2). Each string literal and
   * dollar body is also read as a body of its own (dynamic SQL, `EXECUTE 'SELECT 1; DELETE …'`; an E-string with its
   * line-break escapes decoded), down to MAX_DYNAMIC_DEPTH.
   * Text that does not lex is read whole and cut at every `;` (over-approximations, kept), and read by `tolerantRead`:
   * the lexed path's code-`;` cut and comment blanking, and its nested bodies, as far as the text allows (fail closed;
   * PR293-SEC-04 a, TASK-034).
   */
  const check = (text: string, depth: number): boolean => {
    let tokens: Token[];
    try {
      tokens = tokenize(text);
    } catch {
      const whole = normalise(text);
      if (segmentWrites(whole) || whole.split(';').some(segmentWrites)) return true;
      const reading = tolerantRead(text);
      return reading.segments.some(writes) || (depth < MAX_DYNAMIC_DEPTH && reading.bodies.some((body) => check(body, depth + 1)));
    }
    const segments: string[] = [];
    let current = '';
    for (const token of tokens) {
      if (token.kind === 'comment') {
        current += ' ';
        continue;
      }
      if (token.kind !== 'code') {
        current += token.text;
        if ((token.kind === 'string' || token.kind === 'dollar') && depth < MAX_DYNAMIC_DEPTH && check(nestedSql(token), depth + 1)) {
          return true;
        }
        continue;
      }
      const parts = token.text.split(';');
      current += parts[0] ?? '';
      for (const part of parts.slice(1)) {
        segments.push(current);
        current = part;
      }
    }
    segments.push(current);
    return segments.some(writes);
  };
  return (text) => check(text, 0);
}

/**
 * PL/pgSQL statement starts before which a data-changing form also runs: `FOR target IN <query>` and `OPEN cursor
 * [[NO] SCROLL] FOR <query>` accept INSERT, UPDATE, DELETE or MERGE with RETURNING (PR293-SEC-01 rows 2, 7, 8). A bare
 * `for` stays out (row locks: `FOR UPDATE`), so `FOR r IN SELECT … FOR UPDATE` and `WHERE id IN (SELECT …)` stay clean.
 */
const OPEN_FOR = 'open [a-z_\\u0080-\\uFFFF][a-z0-9_$\\u0080-\\uFFFF]*(?: no)?(?: scroll)? for';
const doBodyChangesData = bodyDataChanging(`begin|then|else|loop|execute|in|${OPEN_FOR}`);

/**
 * The statement text that rule 10 reads (`sqlText` with strings kept, bodies expanded), without ESCAPE_STRING_MARK.
 * The mark ends in U+2063, which the tokenizer counts as an identifier character, so a marked `E'…'` would lex as an
 * identifier followed by a plain string and its line-break escapes would never be decoded (PR034-SEC-06). Rule 16
 * reads the marked text and stays the control for every escape string (D-TASK034-13 as corrected by D-TASK034-16).
 */
const bodyText = (statement: string): string => sqlText(statement, true).replaceAll(ESCAPE_STRING_MARK, ' ');

/** True when `statement` is a DO block whose body changes data (rule 10). */
function doBlockChangesData(statement: string): boolean {
  return /^do\b/.test(codeOnly(statement)) && doBodyChangesData(bodyText(statement));
}

/**
 * Rule 10, call site (PR66-SEC-02, TASK-293). A routine body is not executed at CREATE time, but DML in it runs
 * whenever the routine is called, and a migration may call it: `CREATE FUNCTION f() … BEGIN ATOMIC DELETE …; END;
 * SELECT f();` changes data as surely as a top-level DELETE. So a routine whose definition holds a rule-10 form (the DO
 * statement starts plus the routine body starts `AS` (dollar or string body), `ATOMIC` and `RETURN QUERY`; dynamic SQL
 * in its string literals included), or that calls such a routine, is a WRITING routine, and a top-level statement that
 * names a writing routine followed by `(` is data-changing.
 *  - Every definition is recorded with the names it calls (RoutineRegistry), and "calls a writing routine" is resolved
 *    when a call site is judged, over every routine known by then, so the order of the definitions does not matter: a
 *    PL/pgSQL routine may call one created later in the file (TASK-293 code review R1-m2).
 *  - The registry is carried from file to file and never shrinks: a later `CREATE OR REPLACE` adds to what a name
 *    writes and calls, and a DROP does not clear it (fail closed).
 *  - Names are compared as parsed identifiers (quoted names keep every character), never through a regular expression
 *    built from the SQL text (R1-m1). A routine created unqualified matches a call with any schema, and an unqualified
 *    call matches every schema; a name inside a string literal also counts (fail closed).
 *  - `ALTER FUNCTION | PROCEDURE | ROUTINE … RENAME TO | SET SCHEMA` records the new name as a routine that calls the
 *    old one, so the registry resolves a call under the new name transitively (PR293-SEC-01 row 1).
 *  - Names are parsed identifiers, non-ASCII letters included (scan.l `ident_start`; code review R2-n1). A writing
 *    definition whose name cannot be parsed is itself reported (fail closed): its calls could not be recognised.
 *  - Not a call: GRANT / REVOKE, COMMENT ON, ALTER / DROP FUNCTION | PROCEDURE | ROUTINE, CREATE TRIGGER (the trigger
 *    runs at a later DML statement, which rule 10 judges itself, except a plain `INSERT … VALUES`, which is no rule-10
 *    form: a writing trigger fired by one is not seen; R1-n2), and `FUNCTION | PROCEDURE | ROUTINE <name>(` references.
 *    A call written with a three-part name (`db.schema.name(`) is seen through its last two parts (R2-n2).
 *  - Not seen (stated limits; PR293-SEC-01 row 3, pinned by a test): a routine created in the bootstrap lane, a write
 *    reached only through `EXECUTE` of a string built at run time, a call through a computed name, and a call in
 *    attribute notation (`SELECT t.w FROM t` calls `w(t)`). A writer used as a cast function (`CREATE CAST … WITH
 *    FUNCTION w`, then `x::type`) or as an aggregate support function (`CREATE AGGREGATE a (SFUNC = w, …)`, then
 *    `a(…)`) is no limit any more: rule 14 refuses both statements (D-ARCH-172, PR293-SEC-01 rows 4 and 5; TASK-034).
 */
export const routineBodyChangesData = bodyDataChanging(`begin|then|else|loop|execute|as|atomic|query|in|${OPEN_FOR}`);
const NOT_A_CALL_SITE =
  /^(?:grant|revoke|comment on|(?:alter|drop) (?:function|procedure|routine)|create (?:or replace )?(?:constraint )?trigger)\b/;
/**
 * One identifier of normalised text: quoted (`""` is a quote inside it) or plain, non-ASCII letters included (scan.l
 * `ident_start [A-Za-z\200-\377_]`, `ident_cont [A-Za-z\200-\377_0-9\$]`). Linear: the branches never overlap.
 */
const CALL_IDENT = '"(?:[^"]|"")*"|[a-z_\\u0080-\\uFFFF][a-z0-9_$\\u0080-\\uFFFF]*';
const ROUTINE_REFERENCE = new RegExp(`\\b(?:function|procedure|routine) (?:(?:${CALL_IDENT}) ?\\. ?)?(?:${CALL_IDENT}) ?\\(`, 'g');
const NAMED_CALL = new RegExp(`(?<![a-z0-9_$"\\u0080-\\uFFFF])(?:(${CALL_IDENT}) ?\\. ?)?(${CALL_IDENT}) ?\\(`, 'g');
/** The name a CREATE FUNCTION | PROCEDURE defines, in masked text (a quoted name may hold `""`, unlike ROUTINE_NAME). */
const DEFINED_NAME = new RegExp(`^create (?:or replace )?(?:function|procedure) (?:(${CALL_IDENT}) ?\\. ?)?(${CALL_IDENT}) ?\\(`);
/** `ALTER FUNCTION | PROCEDURE | ROUTINE <name>`, in masked text; the argument list and the action follow. */
const ALTERED_HEAD = new RegExp(`^alter (?:function|procedure|routine) (?:(${CALL_IDENT}) ?\\. ?)?(${CALL_IDENT})`);
const ALTERED_ACTION = new RegExp(`^ ?(rename to|set schema) (${CALL_IDENT})$`);

/**
 * `ALTER FUNCTION | PROCEDURE | ROUTINE <name>[(args)] RENAME TO <new> | SET SCHEMA <schema>` in masked text: the
 * argument list is skipped by parenthesis depth (quoted names skipped whole), so typed arguments such as `numeric(10,2)`
 * are no obstacle (code review R3-n2; strings and bodies are already masked). Undefined for any other statement.
 */
function alteredRoutine(maskedText: string): { old: RoutineName; action: string; target: string } | undefined {
  const head = ALTERED_HEAD.exec(maskedText);
  if (head === null) return undefined;
  let at = head[0].length;
  if (maskedText[at] === ' ' && maskedText[at + 1] === '(') at += 1;
  if (maskedText[at] === '(') {
    let depth = 0;
    for (; at < maskedText.length; at += 1) {
      if (maskedText[at] === '"') {
        const close = maskedText.indexOf('"', at + 1); // a quoted name (a doubled quote is a close and a reopen)
        if (close < 0) return undefined;
        at = close;
      } else if (maskedText[at] === '(') depth += 1;
      else if (maskedText[at] === ')') depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0) return undefined;
    at += 1;
  }
  const action = ALTERED_ACTION.exec(maskedText.slice(at));
  if (action === null) return undefined;
  return {
    old: { schema: head[1] === undefined ? null : identifierValue(head[1]), name: identifierValue(head[2] as string) },
    action: action[1] as string,
    target: identifierValue(action[2] as string),
  };
}

/** A routine name: `schema` null when the definition or the call does not qualify it. */
interface RoutineName {
  readonly schema: string | null;
  readonly name: string;
}

const identifierValue = (ident: string): string => (ident.startsWith('"') ? ident.slice(1, -1).replaceAll('""', '"') : ident);
const sameRoutine = (definition: RoutineName, call: RoutineName): boolean =>
  definition.name === call.name && (definition.schema === null || call.schema === null || definition.schema === call.schema);
const routineLabel = (routine: RoutineName): string => (routine.schema === null ? routine.name : `${routine.schema}.${routine.name}`);

/** Every `name(` and `schema.name(` in normalised text, `FUNCTION | PROCEDURE | ROUTINE <name>(` references excluded. */
function namedCalls(text: string): RoutineName[] {
  return [...text.replace(ROUTINE_REFERENCE, ' ').matchAll(NAMED_CALL)].map((match) => ({
    schema: match[1] === undefined ? null : identifierValue(match[1]),
    name: identifierValue(match[2] as string),
  }));
}

interface RoutineFacts extends RoutineName {
  writes: boolean;
  readonly calls: RoutineName[];
}

/** Routines created by the migration files so far, with what each writes and calls (rule 10 call site). */
export class RoutineRegistry {
  private readonly routines = new Map<string, RoutineFacts>();
  /** Routines whose recorded calls name `name`. */
  private readonly callers = new Map<string, RoutineFacts[]>();
  private writing: RoutineFacts[] | undefined;

  define(routine: RoutineName, writes: boolean, calls: readonly RoutineName[]): void {
    const key = JSON.stringify([routine.schema, routine.name]);
    const facts = this.routines.get(key) ?? { ...routine, writes: false, calls: [] };
    this.routines.set(key, facts);
    facts.writes ||= writes;
    for (const call of calls) {
      facts.calls.push(call);
      const list = this.callers.get(call.name) ?? [];
      if (!list.includes(facts)) list.push(facts);
      this.callers.set(call.name, list);
    }
    this.writing = undefined;
  }

  /** The writing routine (label) one of `calls` names, if any; transitive and independent of definition order. */
  calledWriter(calls: readonly RoutineName[]): string | undefined {
    const writing = this.writingRoutines();
    for (const call of calls) {
      const writer = writing.find((routine) => sameRoutine(routine, call));
      if (writer !== undefined) return routineLabel(writer);
    }
    return undefined;
  }

  /**
   * A routine of the registry (label) that one of `calls` names, writing or not (rule 21 (a), D-ARCH-236): an
   * unqualified definition or call matches every schema, as for rule 10.
   */
  definedRoutine(calls: readonly RoutineName[]): string | undefined {
    const byName = new Map<string, RoutineFacts[]>();
    for (const routine of this.routines.values()) byName.set(routine.name, [...(byName.get(routine.name) ?? []), routine]);
    for (const call of calls) {
      const routine = byName.get(call.name)?.find((candidate) => sameRoutine(candidate, call));
      if (routine !== undefined) return routineLabel(routine);
    }
    return undefined;
  }

  /** Writing routines: those with a rule-10 form, then (breadth first over callers) those calling one. Cached. */
  private writingRoutines(): RoutineFacts[] {
    if (this.writing !== undefined) return this.writing;
    const found = new Set([...this.routines.values()].filter((routine) => routine.writes));
    const queue = [...found];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      const writer = next;
      for (const caller of this.callers.get(writer.name) ?? []) {
        if (!found.has(caller) && caller.calls.some((call) => sameRoutine(writer, call))) {
          found.add(caller);
          queue.push(caller);
        }
      }
    }
    this.writing = [...found];
    return this.writing;
  }
}

/**
 * Rule 10 call-site pass over one statement: records a routine `statement` defines (or renames, or moves) in
 * `registry`, and returns the rule-10 message when the statement calls a writing routine, or defines a writing routine
 * whose name cannot be read.
 */
function writingRoutineCall(statement: string, registry: RoutineRegistry): string | undefined {
  const maskedText = masked(statement);
  const expanded = bodyText(statement);
  const text = normalise(expanded);
  if (ROUTINE_DEFINITION.test(maskedText)) {
    const name = DEFINED_NAME.exec(maskedText);
    const writes = routineBodyChangesData(expanded);
    if (name === null) {
      return writes
        ? 'a routine whose body changes data, with a name the linter cannot read (its calls cannot be recognised; fail closed)'
        : undefined;
    }
    const routine = { schema: name[1] === undefined ? null : identifierValue(name[1]), name: identifierValue(name[2] as string) };
    registry.define(routine, writes, namedCalls(text));
    return undefined;
  }
  const moved = alteredRoutine(maskedText);
  if (moved !== undefined) {
    const { old, action, target } = moved;
    registry.define(action === 'rename to' ? { schema: old.schema, name: target } : { schema: target, name: old.name }, false, [old]);
    return undefined;
  }
  if (NOT_A_CALL_SITE.test(maskedText)) return undefined;
  const writer = registry.calledWriter(namedCalls(text));
  return writer === undefined ? undefined : `call of ${writer}, a routine of this or an earlier migration whose body changes data`;
}

/** Rule 21: the statements whose clauses PostgreSQL evaluates as the role that writes a row (masked text). */
const LOAD_TIME_STATEMENT =
  /^(?:create (?:(?:global |local )?(?:temporary|temp) |unlogged )?table|alter table|create domain|alter domain)\b/;
/**
 * Rule 21: the keyword of a load-time clause and its opening parenthesis, in code lowercased (ASCII only, so offsets
 * stay those of the statement) with every literal, quoted identifier and comment blanked to spaces of the same length.
 * `GENERATED … AS IDENTITY` has no parenthesis after `as`, so it is no clause.
 */
const LOAD_TIME_KEYWORD =
  /(?<![a-z0-9_$\u0080-￿])(check|generated\s+always\s+as|partition\s+by\s+(?:range|list|hash)|set\s+expression\s+as)\s*\(/g;
const OPERATOR_SCHEMA = new RegExp(`\\boperator ?\\( ?(${CALL_IDENT}) ?\\.`, 'g');
const QUERY_STRING_BUILTIN = /(?<![a-z0-9_$])"?(query_to_xml_and_xmlschema|query_to_xmlschema|query_to_xml|ts_stat|ts_rewrite)"? ?\(/;

/** The statement with every non-code token blanked to spaces and ASCII letters lowercased: same length, same offsets. */
function blankedCode(tokens: readonly Token[]): string {
  return tokens
    .map((token) => (token.kind === 'code' ? token.text.replace(/[A-Z]/g, (ch) => ch.toLowerCase()) : ' '.repeat(token.text.length)))
    .join('');
}

/** The offset of the parenthesis that closes the one at `open` in `blanked`, or -1. */
function closingParenthesis(blanked: string, open: number): number {
  let depth = 0;
  for (let at = open; at < blanked.length; at += 1) {
    if (blanked[at] === '(') depth += 1;
    else if (blanked[at] === ')') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** What rule 21 refuses in one load-time clause (normalised, strings kept), or undefined. */
function loadTimeClauseProblem(clauseText: string, registries: readonly RoutineRegistry[]): string | undefined {
  const calls = namedCalls(clauseText);
  for (const registry of registries) {
    const routine = registry.definedRoutine(calls);
    if (routine !== undefined) return `calls ${routine}, a routine of this or an earlier migration`;
  }
  const qualified = calls.find((call) => call.schema !== null && call.schema !== 'pg_catalog');
  if (qualified !== undefined) return `calls ${routineLabel(qualified)}, a routine outside pg_catalog`;
  for (const match of clauseText.matchAll(OPERATOR_SCHEMA)) {
    const schema = identifierValue(match[1] as string);
    if (schema !== 'pg_catalog') return `uses an operator of schema ${schema}, outside pg_catalog`;
  }
  const builtin = QUERY_STRING_BUILTIN.exec(clauseText);
  if (builtin !== null) return `calls ${builtin[1] as string}, a built-in that runs a query string`;
  return undefined;
}

/**
 * Rule 21 (PR034-SEC-01, D-ARCH-236; data-model §8.3): the problems of the load-time clauses of one statement. A restore
 * loads every row as the bootstrap superuser, and PostgreSQL evaluates a table or domain CHECK, a generated-column
 * expression and a partition-key expression as the role that writes the row. Each clause is delimited by parenthesis
 * depth on the statement with literals, quoted identifiers and comments blanked, and the scan resumes after it, so the
 * cost is linear in the statement. One problem per clause; an undelimited clause ends the scan (fail closed).
 */
export function loadTimeClauseProblems(statement: string, registries: readonly RoutineRegistry[]): string[] {
  if (!LOAD_TIME_STATEMENT.test(masked(statement))) return [];
  let tokens: Token[];
  try {
    tokens = tokenize(statement);
  } catch {
    return []; // rule L reports a statement that does not lex
  }
  const blanked = blankedCode(tokens);
  const problems: string[] = [];
  const keyword = new RegExp(LOAD_TIME_KEYWORD.source, 'g');
  for (let match = keyword.exec(blanked); match !== null; match = keyword.exec(blanked)) {
    const kind = (match[1] as string).replace(/\s+/g, ' ').toUpperCase();
    const open = match.index + match[0].length - 1;
    const close = closingParenthesis(blanked, open);
    if (close < 0) {
      problems.push(`the ${kind} clause has no closing parenthesis the linter can find (fail closed)`);
      break;
    }
    let clauseText: string;
    try {
      clauseText = normalise(bodyText(statement.slice(open, close + 1)));
    } catch {
      problems.push(`the ${kind} clause cannot be read (fail closed)`);
      break;
    }
    const problem = loadTimeClauseProblem(clauseText, registries);
    if (problem !== undefined) problems.push(`the ${kind} clause ${problem}`);
    keyword.lastIndex = close + 1;
  }
  return problems;
}

const loadTimeMessage = (problem: string, statement: string): string =>
  `load-time expression: ${problem}; a restore evaluates it as the loading superuser, so it may call IMMUTABLE pg_catalog routines only (PR034-SEC-01, D-ARCH-236): "${normalise(statement).slice(0, 80)}"`;

const LITERAL_MARK = '';
/**
 * Rule 9 comparison text of a policy statement: comments removed; string literals, dollar bodies and quoted identifiers
 * other than plain lowercase names kept verbatim (case and spacing matter there); quoted plain lowercase names unquoted;
 * code lowercased, whitespace collapsed and dropped next to `( ) , . =`. Stricter than `masked()`, which would make
 * `'OPERATOR'` and any other literal compare equal (PR11-SEC-03).
 */
export function canonicalPolicy(statement: string): string {
  const kept: string[] = [];
  const keep = (text: string) => `${LITERAL_MARK}${String(kept.push(text) - 1)}${LITERAL_MARK}`;
  const text = tokenize(statement)
    .map((token) => {
      if (token.kind === 'comment') return ' ';
      if (token.kind === 'string' || token.kind === 'dollar') return keep(token.text);
      if (token.kind === 'identifier') return /^"[a-z_][a-z0-9_$]*"$/.test(token.text) ? token.text.slice(1, -1) : keep(token.text);
      return token.text.toLowerCase();
    })
    .join('');
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ ?([(),.=]) ?/g, '$1')
    .replace(new RegExp(`${LITERAL_MARK}(\\d+)${LITERAL_MARK}`, 'g'), (_, at: string) => kept[Number(at)] ?? '');
}

/** Rule 9: the canonical CREATE POLICY statements `renderRls(entry)` emits; empty when the entry has no RLS block. */
const renderedPolicyCache = new WeakMap<TableClassEntry, ReadonlySet<string>>();
function renderedPolicies(entry: TableClassEntry): ReadonlySet<string> {
  let policies = renderedPolicyCache.get(entry);
  if (policies === undefined) {
    try {
      policies = new Set(
        splitStatements(renderRls(entry))
          .map(canonicalPolicy)
          .filter((statement) => statement.startsWith('create policy ')),
      );
    } catch (error) {
      if (!(error instanceof RenderRlsError)) throw error;
      policies = new Set();
    }
    renderedPolicyCache.set(entry, policies);
  }
  return policies;
}

/** Grantees of a GRANT (`a, group b, "c" with grant option granted by d`), unquoted. */
function grantees(list: string): string[] {
  return list
    .replace(/ granted by .+$/, '')
    .replace(/ with grant option$/, '')
    .split(',')
    .map((grantee) => unquote(grantee.trim().replace(/^group /, '')));
}

/** Splits the actions of an ALTER TABLE (`rest` after the table name) on top-level commas. */
function splitActions(rest: string): string[] {
  const actions: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of rest) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      actions.push(current.trim());
      current = '';
    } else current += ch;
  }
  actions.push(current.trim());
  return actions.filter((action) => action !== '');
}

/** A literal default: a string, a number or a boolean, with an optional cast, and nothing computed after it. */
const CONSTANT_DEFAULT =
  /\bdefault (?:''|[+-]?\d+(?:\.\d+)?|true|false)(?: ?:: ?[a-z_][a-z0-9_ ]*?(?: ?\(\d+(?: ?, ?\d+)?\))?(?:\[\])?)?(?= (?:not|null|constraint|check|references|collate|primary|unique)\b|$)/;
const ADD_COLUMN = /^add (?!constraint\b|primary\b|unique\b|foreign\b|check\b|exclude\b)(?:column )?(?:if not exists )?/;
const NOT_NULL_CHECK = new RegExp(`^add constraint (${IDENT}) check ?\\( ?\\(?(${IDENT})\\)? is not null ?\\)`);

/** State carried from one migration file to the next, in file-name order. */
export interface MigrationHistory {
  /** Partitions (`CREATE TABLE ... PARTITION OF`), qualified. Rule 8: no GRANT on a partition. */
  readonly partitions: Set<string>;
  /** `<table>.<column>` with a validated `CHECK (<column> IS NOT NULL)`. Rule 4: SET NOT NULL may follow. */
  readonly validatedNotNull: Set<string>;
  /** `<table>.<constraint>` -> column of a NOT VALID not-null CHECK awaiting VALIDATE CONSTRAINT. */
  readonly pendingNotNull: Map<string, string>;
  /** Tables (qualified) with ENABLE and FORCE ROW LEVEL SECURITY in an earlier file. Rule 9: grants may follow. */
  readonly rlsProtected: Set<string>;
  /** Partial indexes (qualified name -> canonical WHERE predicate) created by an earlier file. Rule 19 (F-11). */
  readonly partialIndexes: Map<string, string>;
  /** Routines created by this or an earlier file, with what each writes and calls. Rule 10 call site (PR66-SEC-02). */
  readonly routines: RoutineRegistry;
}

export const emptyHistory = (): MigrationHistory => ({
  partitions: new Set(),
  validatedNotNull: new Set(),
  pendingNotNull: new Map(),
  rlsProtected: new Set(),
  partialIndexes: new Map(),
  routines: new RoutineRegistry(),
});

export interface MigrationLintOptions {
  /** Table-class manifests (rules 8 and 9); default `loadTableClasses()` (tools/db/table-classes). */
  readonly tableClasses?: readonly TableClassEntry[];
  /** Cross-file state; `lintMigrations` threads one through the directory in order. */
  readonly history?: MigrationHistory;
}

interface FileFacts {
  created: Set<string>;
  rlsEnabled: Set<string>;
  rlsForced: Set<string>;
  /** `name@table` -> index of each CREATE POLICY. */
  policies: Map<string, number[]>;
  /** Qualified routine name -> index of its `OWNER TO platform_definer`. */
  definerOwner: Map<string, number>;
}

function collectFacts(statements: readonly string[]): FileFacts {
  const facts: FileFacts = {
    created: new Set(),
    rlsEnabled: new Set(),
    rlsForced: new Set(),
    policies: new Map(),
    definerOwner: new Map(),
  };
  statements.forEach((text, index) => {
    const created = CREATE_TABLE.exec(text);
    if (created) facts.created.add(qualify(created[1] as string));
    const altered = ALTER_TABLE.exec(text);
    if (altered) {
      const table = qualify(altered[1] as string);
      if (/\benable row level security\b/.test(text)) facts.rlsEnabled.add(table);
      if (/(?<!\bno )\bforce row level security\b/.test(text)) facts.rlsForced.add(table);
    }
    const policy = POLICY.exec(text);
    if (policy?.[1] === 'create') {
      const key = `${unquote(policy[2] as string)}@${qualify(policy[3] as string)}`;
      facts.policies.set(key, [...(facts.policies.get(key) ?? []), index]);
    }
    const routine = ROUTINE_NAME.exec(text);
    if (routine && text.startsWith('alter ') && new RegExp(`\\bowner to ${DEFINER_ROLE}$`).test(text)) {
      facts.definerOwner.set(qualify(routine[1] as string), index);
    }
  });
  return facts;
}

/** Routine names of a GRANT/REVOKE target (`function a(), b(uuid)`); `*` for `ALL FUNCTIONS|ROUTINES IN SCHEMA`. */
function grantedRoutines(target: string): string[] | undefined {
  if (/^all (?:functions|procedures|routines) in schema\b/.test(target)) return ['*'];
  if (!/^(?:function|procedure|routine)s? /.test(target)) return undefined;
  return [...target.replace(/^\w+ /, '').matchAll(ROUTINE_LIST_NAME)].map((match) => qualify(match[1] as string));
}

/** Table names of a GRANT target (`[TABLE] a, b`), `*` for `ALL TABLES IN SCHEMA`; undefined for other objects. */
function grantedTables(target: string): string[] | undefined {
  if (/^all tables in schema\b/.test(target)) return ['*'];
  if (
    /^(?:function|procedure|routine|sequence|schema|database|domain|type|language|large object|foreign|tablespace|parameter|all )/.test(
      target,
    )
  ) {
    return undefined;
  }
  return target
    .replace(/^table /, '')
    .split(',')
    .map((name) => qualify(name.trim()));
}

type Add = (rule: string, message: string) => void;

/** Rules 3-9, 11, 14-16 over one migration file. */
function lintTask016Rules(statements: readonly string[], add: Add, classes: readonly TableClassEntry[], history: MigrationHistory): void {
  const texts = statements.map(masked);
  const facts = collectFacts(texts);
  const preview = (index: number) => `"${(texts[index] ?? '').slice(0, 80)}"`;
  const existing = (table: string) => !facts.created.has(table);
  const topLock = statements.map((statement, index) => topLevelLockTimeout(statement, texts[index] ?? ''));
  const createdIndexes = statements.flatMap((statement, index) => createdIndex(statement, texts[index] ?? '', index) ?? []);
  const lockTimeoutFirst = topLock[0]?.kind === 'set';
  const localLockTimeout = topLock[0]?.kind === 'local';
  const manifest = new Map(classes.map((entry) => [entry.name, entry]));
  /** RLS-class entry of a qualified table name, if any. */
  const rlsEntry = (table: string): TableClassEntry | undefined => {
    const [schema, name] = table.split('.') as [string, string];
    const entry = schema === 'public' ? manifest.get(name) : undefined;
    return entry !== undefined && RLS_CLASSES.has(entry.class) ? entry : undefined;
  };
  let lockReported = false;
  /** Rule 11: the `lock_timeout` in effect after the latest SET/RESET (undefined = the migrator role default). */
  let sessionLockTimeoutMs: number | undefined;
  let definerRole = false;
  let roleSet = false;
  const enabledSoFar = new Set<string>();
  const forcedSoFar = new Set<string>();
  const needsLockTimeout = (index: number) => {
    if (lockTimeoutFirst || lockReported) return;
    lockReported = true;
    add(
      '11',
      localLockTimeout
        ? `"SET LOCAL lock_timeout" does not count: files are not atomic; SET LOCAL outside a transaction block has no effect (use "SET lock_timeout = …"): ${preview(index)}`
        : `alters an existing table without "SET lock_timeout = …" as the first statement: ${preview(index)}`,
    );
  };

  texts.forEach((text, index) => {
    // --- Rule 11: the session lock_timeout this file leaves on the deploy connection.
    const top = topLock[index];
    if (top?.kind === 'set') sessionLockTimeoutMs = lockTimeoutMs(top.value);
    else if (top?.kind === 'reset') sessionLockTimeoutMs = undefined;
    else if (top === undefined) {
      // DO-body events only ever RAISE the tracked value (PR24-SEC-03): every literal is read as possible dynamic SQL,
      // which is fail-closed for a SET but would be fail-open for a RESET or a lower SET found in a message, a dead
      // branch or an unused string. Only a top-level RESET, or a top-level SET at or below the role default, lowers it.
      for (const event of doBlockLockTimeouts(statements[index] ?? '')) {
        if (event.kind === 'reset') continue;
        const ms = lockTimeoutMs(event.value);
        if (ms !== undefined && ms > (sessionLockTimeoutMs ?? MIGRATOR_LOCK_TIMEOUT_MS)) sessionLockTimeoutMs = ms;
      }
    }

    // --- Rule 14: bootstrap-lane statements; operators, rewrite rules, casts and aggregates (refused outright).
    if (BOOTSTRAP_ONLY.some((pattern) => pattern.test(text))) {
      add('14', `schemas, extensions, roles and database settings belong to the bootstrap lane (§8.1): ${preview(index)}`);
    }
    if (REFUSED_OBJECTS.some((pattern) => pattern.test(text))) {
      add(
        '14',
        `CREATE OPERATOR [CLASS | FAMILY], CREATE RULE, CREATE TYPE … AS RANGE, CREATE CAST and CREATE AGGREGATE are refused in prisma/migrations (they re-route queries, comparisons and calls outside the reviewed functions; PR24-SEC-02, PR11-SEC-15 e, D-ARCH-172, D-ARCH-237): ${preview(index)}`,
      );
    }

    // --- Rule 15: a role switch through set_config (PR11-SEC-15 b), anywhere (DO bodies and dynamic SQL included).
    if (SET_CONFIG_ROLE.test(normalise(sqlText(statements[index] ?? '', true)))) {
      add(
        '15',
        `set_config('role' | 'session_authorization', …) switches the session role outside "SET ROLE platform_definer; … RESET ROLE;": ${preview(index)}`,
      );
    }

    // --- Rules 18 (F-04) and 19 (F-11): DROP INDEX of a covering or partial index (D-ARCH-077, SPK-08).
    for (const dropped of droppedIndexes(text)) {
      const recreated = createdIndexes.filter((created) => created.name === dropped && created.at > index);
      const short = dropped.replace(/^public\./, '');
      if (COVERING_INDEX_TOLERANCE.includes(short) && !recreated.some((created) => created.include)) {
        add(
          '18',
          `DROP INDEX of covering index "${short}" (COVERING_INDEX_TOLERANCE, F-04) without re-creating it WITH INCLUDE in the same file: ${preview(index)}`,
        );
      }
      const predicate = history.partialIndexes.get(dropped);
      if (predicate === undefined) continue;
      const last = recreated.at(-1);
      if (last?.predicate === undefined) {
        add(
          '19',
          `DROP INDEX of partial index "${short}" (created WHERE ${predicate} earlier, F-11) without re-creating it with its WHERE clause in the same file: ${preview(index)}`,
        );
      } else if (last.predicate !== predicate) {
        add(
          '19',
          `partial-index predicate changed: review required ("${short}": WHERE ${predicate} -> WHERE ${last.predicate}): ${preview(index)}`,
        );
      }
    }

    // --- ALTER TABLE: rules 3, 4, 6, 7, 11 and the rule-4 history.
    const altered = ALTER_TABLE.exec(text);
    if (altered) {
      const table = qualify(altered[1] as string);
      const isExisting = existing(table);
      if (/\benable row level security\b/.test(text)) enabledSoFar.add(table);
      if (/(?<!\bno )\bforce row level security\b/.test(text)) forcedSoFar.add(table);
      if (/\brename\b/.test(text)) add('3', `RENAME breaks the running release; add + backfill + drop instead: ${preview(index)}`);
      if (/\bdisable trigger\b/.test(text)) add('7', `DISABLE TRIGGER: ${preview(index)}`);
      // PR43-SEC-05 (a): REPLICA mode stops a trigger or rule in every normal (origin) session; ALWAYS is refused too.
      if (/\benable (?:replica|always) (?:trigger|rule)\b/.test(text))
        add('7', `ENABLE REPLICA | ALWAYS TRIGGER | RULE: ${preview(index)}`);
      if (/\b(?:disable|no force) row level security\b/.test(text))
        add('7', `row level security must never be disabled or unforced: ${preview(index)}`);
      if (isExisting) needsLockTimeout(index);
      for (const action of splitActions(text.slice(altered[0].length))) {
        const notNullCheck = NOT_NULL_CHECK.exec(action);
        if (notNullCheck) {
          const key = `${table}.${unquote(notNullCheck[1] as string)}`;
          const column = `${table}.${unquote(notNullCheck[2] as string)}`;
          if (/\bnot valid\b/.test(action)) history.pendingNotNull.set(key, column);
          else history.validatedNotNull.add(column);
        }
        const validated = /^validate constraint (\S+)$/.exec(action);
        const pending = validated ? history.pendingNotNull.get(`${table}.${unquote(validated[1] as string)}`) : undefined;
        if (pending !== undefined) history.validatedNotNull.add(pending);
        if (!isExisting) continue;
        if (ADD_COLUMN.test(action) && /\bnot null\b/.test(action) && !CONSTANT_DEFAULT.test(action)) {
          add('4', `ADD COLUMN ... NOT NULL without a constant DEFAULT on an existing table: ${preview(index)}`);
        }
        if (/^alter (?:column )?\S+ (?:set data )?type\b/.test(action)) {
          add('4', `ALTER COLUMN ... TYPE rewrites an existing table: ${preview(index)}`);
        }
        const setNotNull = /^alter (?:column )?(\S+) set not null$/.exec(action);
        if (setNotNull && !history.validatedNotNull.has(`${table}.${unquote(setNotNull[1] as string)}`)) {
          add('4', `SET NOT NULL without a preceding validated CHECK (<column> IS NOT NULL): ${preview(index)}`);
        }
        if (/^add (?:constraint \S+ )?(?:foreign key|check)\b/.test(action) && !/\bnot valid\b/.test(action)) {
          add('6', `FOREIGN KEY / CHECK on an existing table without NOT VALID: ${preview(index)}`);
        }
      }
    }

    // --- Rule 7: triggers and audit storage.
    if (/^drop trigger\b/.test(text)) add('7', `DROP TRIGGER: ${preview(index)}`);
    if (
      AUDIT_OBJECT_PATTERN.test(text) &&
      (/^(?:update|delete|truncate|drop)\b/.test(text) ||
        /^with\b.*\b(?:update|delete from)\b/.test(text) ||
        /\bdetach partition\b/.test(text))
    ) {
      add('7', `audit storage is append-only (REQ-AUDIT-015): ${preview(index)}`);
    }

    // --- Rule 5: indexes; rule 11 for a blocking index build.
    const index_ = CREATE_INDEX.exec(text);
    if (index_) {
      const concurrent = index_[1] !== undefined;
      const table = qualify(index_[2] as string);
      if (concurrent && texts.length > 1) {
        add('5', `CREATE INDEX CONCURRENTLY must be the only statement of its migration file: ${preview(index)}`);
      }
      if (!concurrent && existing(table)) {
        add('5', `CREATE INDEX without CONCURRENTLY on an existing table: ${preview(index)}`);
        needsLockTimeout(index);
      }
    }
    const trigger = CREATE_TRIGGER.exec(text);
    if (trigger && existing(qualify(trigger[1] as string))) needsLockTimeout(index);

    // --- Rule 9: policies; rule 11 for policy DDL on an existing table.
    const policy = POLICY.exec(text);
    if (policy) {
      const table = qualify(policy[3] as string);
      if (existing(table)) needsLockTimeout(index);
      const recreated = (facts.policies.get(`${unquote(policy[2] as string)}@${table}`) ?? []).some((at) => at > index);
      if (policy[1] === 'drop' && !recreated) add('9', `DROP POLICY without re-creating the policy in the same file: ${preview(index)}`);
      if (policy[1] === 'alter')
        add('9', `ALTER POLICY: restate the policy as DROP POLICY + CREATE POLICY in the same file: ${preview(index)}`);
      // Am. 10 item 7 / PR11-SEC-03: a policy is the renderer's output for the table's manifest entry, verbatim.
      const entry = rlsEntry(table);
      if (policy[1] === 'create' && (entry === undefined || !renderedPolicies(entry).has(canonicalPolicy(statements[index] ?? '')))) {
        add('9', `policy not rendered from the templates (paste the output of tools/db/render-rls.ts): ${preview(index)}`);
      }
    } else if (/\b(?:create|alter|drop) policy\b/.test(normalise(sqlText(statements[index] ?? '', true)))) {
      add('9', `policy DDL in a body or dynamic SQL cannot be checked against the templates: ${preview(index)}`);
    }

    // --- Rule 9: every table has a class; RLS classes ship ENABLE + FORCE in the same file.
    const created = CREATE_TABLE.exec(text);
    if (created) {
      const table = qualify(created[1] as string);
      const parent = PARTITION_OF.exec(text);
      if (parent) history.partitions.add(table);
      const [schema, name] = table.split('.') as [string, string];
      const entry = manifest.get(parent ? (qualify(parent[1] as string).split('.')[1] ?? '') : name);
      if (schema !== 'public') {
        add('9', `tables live in public only; platform holds no table (C1, PR11-SEC-11 e): "${schema}.${name}": ${preview(index)}`);
      } else if (entry === undefined) {
        add('9', `table "${name}" is in no table-class manifest (tools/db/table-classes/*.json): ${preview(index)}`);
      } else if (schema === 'public' && !parent && entry !== undefined && RLS_CLASSES.has(entry.class)) {
        if (!facts.rlsEnabled.has(table) || !facts.rlsForced.has(table)) {
          add('9', `${entry.class} table "${name}" needs ENABLE and FORCE ROW LEVEL SECURITY in the same file: ${preview(index)}`);
        }
      }
    }

    // --- Rule 8: grants and role attributes of platform_app; privileges on partitions.
    const grant = GRANT_ON.exec(text);
    if (grant?.[1] === 'grant') {
      const privileges = grant[2] as string;
      const target = grant[3] as string;
      const tables = grantedTables(target);
      const toApp = PLATFORM_APP.test(grant[4] as string);
      // PR11-SEC-04: platform_app inherits every PUBLIC grant; the manifest cannot express PUBLIC.
      if ((tables || /^(?:sequence |all sequences in schema\b)/.test(target)) && grantees(grant[4] as string).includes('public')) {
        add('8', `privilege granted to PUBLIC (platform_app inherits it; grant to the role instead): ${preview(index)}`);
      }
      if (tables && toApp && RLS_INDEPENDENT_PRIVILEGES.test(privileges)) {
        add('8', `TRUNCATE, TRIGGER or REFERENCES to platform_app (they act outside row level security; MAINTAIN too): ${preview(index)}`);
      }
      // PR11-SEC-07: a file is not atomic, so the grant must not exist while the table still lacks ENABLE + FORCE.
      const unprotected = (tables?.includes('*') ? [...facts.created] : (tables ?? [])).filter(
        (table) =>
          toApp &&
          rlsEntry(table) !== undefined &&
          !history.rlsProtected.has(table) &&
          !(enabledSoFar.has(table) && forcedSoFar.has(table)),
      );
      if (unprotected.length > 0) {
        add('9', `GRANT to platform_app before ENABLE + FORCE ROW LEVEL SECURITY of ${unprotected.join(', ')}: ${preview(index)}`);
      }
      if (tables && toApp && /\b(?:delete|all)\b/.test(privileges)) {
        const refused = tables.filter((table) => {
          const [schema, name] = table.split('.') as [string, string];
          return table === '*' || schema !== 'public' || manifest.get(name)?.hardDelete !== true;
        });
        if (refused.length > 0) {
          add('8', `DELETE to platform_app outside the hardDelete allow-list (${refused.join(', ')}): ${preview(index)}`);
        }
      }
      if (tables?.some((table) => history.partitions.has(table))) add('8', `privilege granted on a partition: ${preview(index)}`);
    }
    const membership = MEMBERSHIP_GRANT.exec(text);
    if (membership && PLATFORM_APP.test(membership[2] as string)) add('8', `role membership granted to platform_app: ${preview(index)}`);
    if (/\bowner to "?platform_app"?(?![a-z0-9_])/.test(text)) add('8', `ownership handed to platform_app: ${preview(index)}`);
    if (/^(?:create|alter) (?:role|user) "?platform_app"?\b/.test(text) && /\b(?:bypassrls|superuser)\b/.test(text)) {
      add('8', `BYPASSRLS / SUPERUSER for platform_app: ${preview(index)}`);
    }

    // --- Rule 15: definer ownership. The SET ROLE block is the only accepted form (PR11-SEC-07): "grants before
    // OWNER TO" leaves a migrator-owned definer function executable by platform_app when OWNER TO fails, because a
    // file is not atomic. For the same reason SET LOCAL ROLE (no effect outside a transaction block) does not count.
    const setRole = SET_ROLE.exec(text);
    if (setRole) {
      const effective = setRole[1] !== 'local ';
      roleSet = effective && setRole[2] !== 'none';
      definerRole = effective && new RegExp(`^${DEFINER_ROLE}$`).test(setRole[2] as string);
    } else if (text === 'reset role') {
      roleSet = false;
      definerRole = false;
    }
    const routine = ROUTINE_NAME.exec(text);
    if (routine && /^create\b/.test(text) && /\bsecurity definer\b/.test(text) && !definerRole) {
      add('15', `SECURITY DEFINER function created outside "SET ROLE platform_definer; … RESET ROLE;": ${preview(index)}`);
    }
    // D-ARCH-071 (2) b: no object is handed to the definer after creation; definer functions are born inside the block.
    if (/^alter\b/.test(text) && new RegExp(`\\bowner to ${DEFINER_ROLE}(?![a-z0-9_])`).test(text)) {
      add(
        '15',
        `OWNER TO platform_definer: create the function inside "SET ROLE platform_definer; … RESET ROLE;" instead: ${preview(index)}`,
      );
    }
    const routines = grant ? grantedRoutines(grant[3] as string) : undefined;
    if (routines?.some((name) => [...facts.definerOwner].some(([owned, at]) => at < index && (name === '*' || name === owned)))) {
      add('15', `${(grant?.[1] ?? '').toUpperCase()} after OWNER TO platform_definer fails at deploy (42501): ${preview(index)}`);
    }
  });
  if (roleSet) {
    add(
      '15',
      'the file ends with a SET ROLE still in effect: close the block with RESET ROLE (the role persists on the deploy connection)',
    );
  }
  if (sessionLockTimeoutMs !== undefined && sessionLockTimeoutMs > MIGRATOR_LOCK_TIMEOUT_MS) {
    add(
      '11',
      'the file leaves lock_timeout above the migrator role default (3s): end it with "RESET lock_timeout" (the session value persists on the deploy connection into later files)',
    );
  }
  for (const table of facts.rlsEnabled) if (facts.rlsForced.has(table)) history.rlsProtected.add(table);
  // Rule 19 history: the partial indexes this file leaves behind, in statement order.
  texts.forEach((text, index) => {
    for (const dropped of droppedIndexes(text)) history.partialIndexes.delete(dropped);
    const created = createdIndexes.find((entry) => entry.at === index);
    if (created?.predicate !== undefined) history.partialIndexes.set(created.name, created.predicate);
    else if (created) history.partialIndexes.delete(created.name);
  });

  // --- Rule 16: tenant-context writes and security-key reads (bodies and dynamic SQL included), one finding per
  // statement, from the shared form list (tools/db/tenant-key-forms.ts; PR11-SEC-02).
  statements.forEach((statement, index) => {
    const withStrings = normalise(sqlText(statement, true));
    const writes = contextWrites(withStrings);
    if (CONTEXT_DISCARD.test(normalise(sqlText(statement, false)))) writes.push('DISCARD');
    if (writes.length > 0) {
      add('16', `writes the tenant request context in SQL (${writes.join('; ')}); only withTenantTx sets it: ${preview(index)}`);
      return;
    }
    const helper = HELPER_DEFINITION.test((texts[index] ?? '').replace(/"/g, ''));
    const readText = /^create policy\b/.test(texts[index] ?? '') ? withStrings.split(OPERATOR_SCOPE_ATOM).join(' ') : withStrings;
    const reads = helper ? [] : contextReads(readText);
    if (reads.length > 0) {
      add(
        '16',
        `reads the tenant context outside the §4.2 helpers (${reads.join('; ')}); use platform.app_org_id() etc.: ${preview(index)}`,
      );
      return;
    }
    const dynamic = dynamicSqlRoutine(statement, texts[index] ?? '');
    if (dynamic !== undefined) {
      add(
        '16',
        `dynamic SQL (EXECUTE, query_to_xml*, ts_stat, ts_rewrite) in ${dynamic}, which is not on DYNAMIC_SQL_ALLOW_LIST with this definition (reviewed list; PR11-SEC-14 b, PR43-SEC-06): ${preview(index)}`,
      );
    }
  });
}

/** Lints one migration directory (`<name>/migration.sql` + `down.sql`). */
export function lintMigrationDir(dir: string, label: string = dir, options: MigrationLintOptions = {}): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (rule: string, message: string, file = join(label, 'migration.sql')) => findings.push({ file, rule, message });
  const migrationFile = join(dir, 'migration.sql');
  if (!existsSync(migrationFile)) {
    add('1', 'migration.sql is missing');
    return findings;
  }
  if (!existsSync(join(dir, 'down.sql'))) add('1', 'down.sql is missing (every migration ships one, §8.4)', join(label, 'down.sql'));
  const sql = readFileSync(migrationFile, 'utf8');
  const statements = lexedStatements(sql, (message) => add('L', message));
  const history = options.history ?? emptyHistory();
  if (statements !== undefined) lintMigrationSql(sql, statements, add, { ...options, history });
  if (existsSync(join(dir, 'down.sql'))) {
    const released = RULE_17_RELEASED.has(basename(dir));
    lintDownSql(
      readFileSync(join(dir, 'down.sql'), 'utf8'),
      (rule, message) => {
        if (!(released && rule === '17')) add(rule, message, join(label, 'down.sql'));
      },
      history.routines,
    );
  }
  return findings;
}

/**
 * Rule 20 (PR43-SEC-06 a): `standard_conforming_strings` and `backslash_quote` named anywhere in a statement's code or
 * string literals, bodies and dynamic SQL included: `SET [SESSION | LOCAL] … { = | TO }`, `set_config('…', …)`, a
 * routine `SET` clause, `ALTER FUNCTION | ROLE | DATABASE … SET`. With `standard_conforming_strings = off` a plain
 * `'\x61pp…'` is an escape string that the E-string controls (rules 12 and 16) do not see. No migration or bootstrap
 * file needs either setting, so every mention is refused (reads too; fail closed).
 */
const ESCAPE_SETTING = /(?<![a-z0-9_$])"?(?:standard_conforming_strings|backslash_quote)"?(?![a-z0-9_$])/;
function namesEscapeSetting(statement: string): boolean {
  return ESCAPE_SETTING.test(normalise(sqlText(statement, true)));
}
const escapeSettingMessage = (where: string): string =>
  `standard_conforming_strings / backslash_quote are refused in both lanes (they make backslash escapes live in plain strings, outside the E-string controls; PR43-SEC-06 a): ${where}`;

/**
 * Rule L (PR43-SEC-03, PR43-SEC-11): splitStatements of `sql`, or undefined after a finding when the text does not
 * lex (an unterminated string, comment, identifier or dollar body), ends inside a `BEGIN ATOMIC` block, has anything
 * but `;` after the END of a routine body, or holds a body `;` inside parentheses. Fail closed: such a file is
 * reported, never linted as one swallowed statement and never a crash.
 * Also rule L, without stopping the lint (PR66-SEC-01 optional item, TASK-293): a lone CR (one not followed by LF). It
 * ends a `--` comment in PostgreSQL (and in tokenize), but no diff view shows it, so a statement after it reads as
 * comment text in review. `.gitattributes` keeps LF line ends; CRLF is not refused.
 */
function lexedStatements(sql: string, report: (message: string) => void): string[] | undefined {
  const loneCr = loneCarriageReturnLines(sql);
  if (loneCr.length > 0) {
    report(
      `a lone CR (not followed by LF) on line(s) ${loneCr.slice(0, 5).join(', ')}${loneCr.length > 5 ? ', …' : ''}: it ends a -- comment in PostgreSQL but is invisible in review; use LF line ends (PR66-SEC-01)`,
    );
  }
  try {
    return splitStatements(sql);
  } catch (error) {
    if (!(error instanceof SqlLexError)) throw error;
    report(`the file does not split into statements (${error.message}); it is not linted further until it does (fail closed)`);
    return undefined;
  }
}

/** 1-based line numbers (counted by LF) of every CR that is not followed by LF. */
export function loneCarriageReturnLines(sql: string): number[] {
  const lines: number[] = [];
  let line = 1;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql[i] === '\n') line += 1;
    else if (sql[i] === '\r' && sql[i + 1] !== '\n') lines.push(line);
  }
  return lines;
}

/** The migration.sql pass of lintMigrationDir over the split `statements`. */
function lintMigrationSql(sql: string, statements: readonly string[], add: Add, options: MigrationLintOptions): void {
  const header = parseHeader(sql);
  header.problems.forEach((problem) => add('1', problem));
  if (header.kind === 'contract' && header.reversible === true) {
    add('C', 'a contract migration is restore-based only and must declare "reversible: no" (§8.2)');
  }
  const history = options.history ?? emptyHistory();
  for (const statement of statements) {
    const text = normalise(statement);
    const code = codeOnly(statement);
    const preview = text.slice(0, 80);
    if (header.kind !== 'contract' && DESTRUCTIVE.some((pattern) => pattern.test(code))) {
      add('2', `destructive statement outside a contract migration: "${preview}"`);
    }
    const callSite = writingRoutineCall(statement, history.routines);
    if (header.dataChanging !== true && (DATA_CHANGING.some((pattern) => pattern.test(code)) || doBlockChangesData(statement))) {
      add('10', `data-changing statement without "data-changing: yes": "${preview}"`);
    } else if (header.dataChanging !== true && callSite !== undefined) {
      add('10', `${callSite}, without "data-changing: yes" (PR66-SEC-02): "${preview}"`);
    }
    if (isAuditDdl(statement, 'migrations')) {
      add('12', `audit object in a Prisma migration (audit DDL belongs to the bootstrap lane only): "${preview}"`);
    }
    if (definerWithoutFixedPath(statement)) {
      add('13', `SECURITY DEFINER routine without exactly one "SET search_path = pg_catalog, pg_temp": "${preview}"`);
    }
    const control = transactionControl(statement);
    if (control !== undefined) add('11', control);
    if (namesEscapeSetting(statement)) add('20', escapeSettingMessage(`"${preview}"`));
    for (const problem of loadTimeClauseProblems(statement, [history.routines])) add('21', loadTimeMessage(problem, statement));
  }
  lintTask016Rules(statements, add, options.tableClasses ?? loadTableClasses(), history);
}

/**
 * Migrations released before rule 17 existed (TASK-024). Their down.sql files are immutable (tools/ci/check-migration-
 * immutability.mjs: a released migration directory may not change), so rule 17 cannot be met by editing them; it binds
 * every later migration. Exact names, frozen: the list may only shrink (lint-migrations.test.ts pins it).
 */
export const RULE_17_RELEASED: ReadonlySet<string> = new Set([
  '20261112010000_authz_catalogue_tables',
  '20261112020000_platform_rls_helpers',
  '20261112030000_reference_dataset_versions',
]);

/**
 * The down.sql pass: rule 11 (c) transaction control, rule 17 DROP … IF EXISTS and rule 21 (load-time expressions; the
 * routines of the migrations so far and those down.sql itself creates count for (a)).
 */
function lintDownSql(sql: string, add: Add, routines: RoutineRegistry): void {
  const own = new RoutineRegistry();
  for (const statement of lexedStatements(sql, (message) => add('L', message)) ?? []) {
    writingRoutineCall(statement, own); // records the routines down.sql creates (rule 10 does not apply to down.sql)
    for (const problem of loadTimeClauseProblems(statement, [routines, own])) add('21', loadTimeMessage(problem, statement));
    const control = transactionControl(statement);
    if (control !== undefined) add('11', control);
    if (dropWithoutIfExists(statement)) {
      add(
        '17',
        `down.sql DROP without IF EXISTS (rule 17): a partial or repeated rollback must re-run cleanly: "${normalise(statement).slice(0, 80)}"`,
      );
    }
  }
}

/** Lints every migration directory under `root` in name order (files such as migration_lock.toml are skipped). */
export function lintMigrations(root: string, labelRoot: string = root, options: Omit<MigrationLintOptions, 'history'> = {}): LintFinding[] {
  if (!existsSync(root)) return [];
  const history = emptyHistory();
  const tableClasses = options.tableClasses ?? loadTableClasses();
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort()
    .flatMap((name) => lintMigrationDir(join(root, name), join(labelRoot, name), { tableClasses, history }));
}

export interface BootstrapLintOptions {
  reviewers: readonly string[];
  /** ISO date (YYYY-MM-DD) the approval date must not exceed. */
  today: string;
}

/** Variables a bootstrap file may reference (PR5-SEC-12): the database name and the two SCRAM-verifier placeholders. */
const BOOTSTRAP_VARIABLES: ReadonlySet<string> = new Set(['db_name', 'migrator_password', 'app_password']);

/** Lints the bootstrap lane: rule 13 (first statement), rule 12 (approved audit DDL only) and S (secret variables). */
export function lintBootstrap(dir: string, options: BootstrapLintOptions, labelRoot: string = dir): LintFinding[] {
  if (!existsSync(dir)) return [];
  const findings: LintFinding[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const file = join(labelRoot, name);
    const sql = readFileSync(join(dir, name), 'utf8');
    const statements = lexedStatements(sql, (message) => findings.push({ file, rule: 'L', message }));
    if (statements === undefined) continue;
    const first = normalise(statements[0] ?? '');
    if (!/^set search_path (=|to) pg_catalog, ?pg_temp$/.test(first)) {
      findings.push({ file, rule: '13', message: 'the first statement must be "SET search_path = pg_catalog, pg_temp;"' });
    }
    for (const variable of referencedVariables(sql).filter((name) => !BOOTSTRAP_VARIABLES.has(name))) {
      findings.push({
        file,
        rule: 'S',
        message: `variable "${variable}" is not one of ${[...BOOTSTRAP_VARIABLES].join(', ')} (PR5-SEC-12)`,
      });
    }
    for (const statement of statements) {
      const unsafe = [...codeOnly(statement).matchAll(/\bpassword\b(?! ?(?::'migrator_password'|:'app_password'|null)(?![a-z0-9_]))/g)];
      if (unsafe.length > 0) {
        findings.push({
          file,
          rule: 'S',
          // No statement preview: the statement may hold the plaintext this check exists to catch.
          message: `PASSWORD must be followed by :'migrator_password', :'app_password' or NULL (PR5-SEC-12), ${unsafe.length} occurrence(s)`,
        });
      }
    }
    statements.forEach((statement, index) => {
      // No statement preview in the bootstrap lane: a role statement may hold secret material (as rule S).
      if (namesEscapeSetting(statement)) findings.push({ file, rule: '20', message: escapeSettingMessage(`statement ${index + 1}`) });
    });
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

/**
 * Rule R (backup guardrail, CLAUDE.md §5 Database; data-model §8.6; TASK-034): every migration declared
 * `data-changing: yes` carries `rehearsal.json`, a passed backup/restore verification bound to its migration.sql bytes
 * and taken at the migration just before it in Prisma's list (`migrationNames`), whose run deployed the migration on
 * the restored data (tools/db/rehearsal-record.ts; D-TASK034-09). The repository lanes and the CLI run it; the fixture
 * cases of lintMigrations do not, so their outcomes are unchanged. A migration whose header does not parse is rule
 * 1's; one without `data-changing: yes` needs no record. A released record stays fresh because no new migration folder
 * may sort before a released one (tools/ci/check-migration-immutability.mjs, D-TASK034-10).
 */
export function lintRehearsals(root: string, labelRoot: string = root): LintFinding[] {
  if (!existsSync(root)) return [];
  const names = migrationNames(root);
  const findings: LintFinding[] = [];
  names.forEach((name, index) => {
    const bytes = readFileSync(join(root, name, 'migration.sql'));
    if (parseHeader(bytes.toString('utf8')).dataChanging !== true) return;
    const file = join(labelRoot, name, RECORD_FILE);
    const add = (message: string) => findings.push({ file, rule: 'R', message });
    const recordPath = join(root, name, RECORD_FILE);
    if (!existsSync(recordPath)) {
      add(
        `a data-changing migration needs a fresh, verified backup (CLAUDE.md §5): run "npm run db:backup", then "npm run db:verify-restore -- --backup <dir> --migration ${name}" (${RECORD_FILE} is missing)`,
      );
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(recordPath, 'utf8'));
    } catch {
      add(`${RECORD_FILE} is not valid JSON`);
      return;
    }
    const expected = { migration: name, migrationSha256: sha256Hex(bytes), previous: index === 0 ? null : (names[index - 1] as string) };
    for (const problem of rehearsalProblems(raw, expected)) add(`stale or failed rehearsal record: ${problem}`);
  });
  return findings;
}

/** Lints the repository's lanes; returns the findings with repository-relative paths. */
export function lintRepository(root: string = REPO_ROOT, today: string = new Date().toISOString().slice(0, 10)): LintFinding[] {
  const reviewers = readReviewers(join(root, 'tools', 'db', 'audit-ddl-reviewers.json'));
  const rel = (path: string) => relative(root, path).replaceAll('\\', '/');
  const migrations = join(root, 'prisma', 'migrations');
  return [
    ...lintMigrations(migrations, rel(migrations)),
    ...lintRehearsals(migrations, rel(migrations)),
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
