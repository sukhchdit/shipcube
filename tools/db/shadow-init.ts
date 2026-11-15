/**
 * Shadow-database init script for Prisma's `migrations.initShadowDb` (data-model.md §7.3 amendments SEC-P3-27 item 6,
 * batch 0.2 / D-ARCH-045 and 2026-11-13 SPK-08 F-02/F-03 + PR12-SEC-07; D-ARCH-077; TASK-021).
 *
 * The shadow database must mirror the objects the bootstrap lane creates outside Prisma Migrate (the `platform` schema,
 * the extensions, the audit tables, functions and triggers), so that `migrate dev` / `migrate diff --from-migrations`
 * replay the migrations against the same surroundings as a real database. The shadow database is an EMPTY database
 * OWNED BY THE MIGRATOR, so the script is a migrator-runnable rendering of the real lane (prisma/bootstrap/*.sql,
 * every file, in name order), statement by statement:
 *
 *   prepended  a refusal guard as the FIRST statement: unless `current_database()` is owned by `current_user` and
 *              `public` is empty (as Prisma leaves it after its shadow reset), it raises 42501 before anything else runs
 *              (PR12-SEC-07: a mis-set SHADOW_DATABASE_URL would otherwise lose `platform` to the DROP below).
 *   rewritten  `CREATE SCHEMA IF NOT EXISTS <s> [AUTHORIZATION <r>]` (s ≠ public) -> `DROP SCHEMA IF EXISTS <s> CASCADE;
 *              CREATE SCHEMA IF NOT EXISTS <s>`: Prisma resets only `public` of the shadow database, so `platform`
 *              would keep the previous run's objects and the next run fail with "already exists" (F-02).
 *   kept       `SET search_path = pg_catalog, pg_temp`; `CREATE EXTENSION IF NOT EXISTS <e> WITH SCHEMA public` (the
 *              migrator owns the shadow database and may create trusted extensions, A16); CREATE TABLE, CREATE [UNIQUE]
 *              INDEX, CREATE [OR REPLACE] FUNCTION (not an event-trigger function), CREATE [CONSTRAINT] TRIGGER,
 *              CREATE POLICY, `ALTER TABLE <t> ENABLE [ALWAYS|REPLICA] TRIGGER <n>`, `ALTER TABLE <t> ENABLE|FORCE ROW
 *              LEVEL SECURITY`, the CHECK replacement `ALTER TABLE <t> DROP CONSTRAINT [IF EXISTS] <c>, ADD CONSTRAINT
 *              <c> CHECK (…)` (same name, one statement; 91-audit-actions-v2.sql, TASK-285), COMMENT ON, and
 *              `SELECT <schema>.<function>(<args>)` (the first ensure_audit_partitions
 *              call, so the shadow holds partitions as a real database does).
 *   stripped   (needs a role or privilege the migrator lacks, or is not diffed): CREATE/ALTER/DROP ROLE|USER|GROUP and a
 *              DO block that only creates roles; SET [SESSION|LOCAL] ROLE, RESET ROLE; a single-action `ALTER … OWNER
 *              TO <r>`; GRANT, REVOKE; ALTER DEFAULT PRIVILEGES; ALTER DATABASE; CREATE/ALTER/DROP EVENT TRIGGER
 *              (superuser only); a function RETURNS event_trigger (it exists only to serve those event triggers, which the
 *              shadow cannot have; Prisma does not diff functions, so dropping it changes nothing the differ sees).
 *   refused    everything else (fail closed, ShadowInitError): an unknown statement form, a kept statement that still
 *              names an owner (`OWNER TO` in a multi-action ALTER, AUTHORIZATION), a psql variable (`:'x'`, `:"x"`;
 *              initShadowDb takes plain SQL), a DO block that does more than create roles, `CREATE SCHEMA public`.
 *
 * Pure: `renderShadowInit` takes the file texts; `readBootstrapLane` is the one synchronous read (used at config load).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalise, referencedVariables, splitStatements, sqlText, tokenize } from './sql-text.js';

/** prisma/bootstrap of this repository. */
export const BOOTSTRAP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'bootstrap');

export interface BootstrapFile {
  readonly name: string;
  readonly sql: string;
}

export type StripReason =
  | 'role'
  | 'role DO block'
  | 'SET/RESET ROLE'
  | 'OWNER TO'
  | 'GRANT/REVOKE'
  | 'ALTER DEFAULT PRIVILEGES'
  | 'ALTER DATABASE'
  | 'event trigger'
  | 'event-trigger function';

export interface ShadowInitRendering {
  /** The script for `migrations.initShadowDb`. */
  readonly sql: string;
  /** Statements removed, with the rule that removed them (`file: preview`, strings and bodies blanked). */
  readonly stripped: readonly { readonly file: string; readonly reason: StripReason; readonly preview: string }[];
}

export class ShadowInitError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'ShadowInitError';
  }
}

/**
 * First statement of the rendering (PR12-SEC-07). Runs before `SET search_path`, so every name is qualified.
 * SQLSTATE 42501 (insufficient_privilege), as the DROP would raise against a bootstrapped database. Two conditions:
 *  1. `current_database()` is owned by `current_user` (the data-model §7.3 rule);
 *  2. `public` holds no table, view or foreign table. Prisma resets `public` of the shadow database before it runs the
 *     init, so a real shadow run always passes; a migrator-owned DEVELOPER database (tables and `_prisma_migrations` in
 *     `public`), which condition 1 alone lets through, is refused before `platform` is dropped (hardening beyond §7.3).
 */
export const OWNERSHIP_GUARD = `DO $shadow_guard$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_database d
     WHERE d.datname = pg_catalog.current_database()
       AND d.datdba = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'shadow init refused: the current database is not owned by the current user (PR12-SEC-07)',
      HINT = 'SHADOW_DATABASE_URL must name an empty database owned by the migrator';
  END IF;
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
     WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'shadow init refused: public is not empty, so this is not a reset shadow database (PR12-SEC-07)',
      HINT = 'SHADOW_DATABASE_URL must name an empty database owned by the migrator';
  END IF;
END
$shadow_guard$`;

/** Normalised code of a statement: comments removed, string literals and dollar bodies blanked to `''` / `$$`. */
export function statementCode(statement: string): string {
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

const NAME = '(?:"[^"]+"|[a-z_][a-z0-9_$]*)';
const QNAME = `${NAME}(?: ?\\. ?${NAME})?`;

/** Statements removed from the rendering, matched on `statementCode()`. Order matters only for the reason reported. */
const STRIP: readonly (readonly [StripReason, RegExp])[] = [
  ['role', /^(?:create|alter|drop) (?:role|user|group)\b/],
  ['SET/RESET ROLE', /^(?:set (?:session |local )?role\b|reset role$)/],
  ['GRANT/REVOKE', /^(?:grant|revoke)\b/],
  ['ALTER DEFAULT PRIVILEGES', /^alter default privileges\b/],
  ['ALTER DATABASE', /^alter database\b/],
  ['event trigger', /^(?:(?:create|alter|drop) event trigger|comment on event trigger)\b/],
  ['event-trigger function', /^create (?:or replace )?function .*\breturns event_trigger\b/],
  // A single-action ownership change only; OWNER TO next to other actions is refused below.
  [
    'OWNER TO',
    new RegExp(
      `^alter (?:table|schema|function|procedure|routine|sequence|view|materialized view|type|domain) (?:if exists )?(?:only )?${QNAME}(?: ?\\([^()]*\\))? owner to ${NAME}$`,
    ),
  ],
];

/** Statements kept verbatim, matched on `statementCode()`. */
const KEEP: readonly RegExp[] = [
  /^set search_path (?:=|to) pg_catalog, ?pg_temp$/,
  /^create extension if not exists [a-z_][a-z0-9_]* with schema public$/,
  /^create (?:unlogged )?table /,
  /^create (?:unique )?index /,
  /^create (?:or replace )?function /,
  /^create (?:or replace )?(?:constraint )?trigger /,
  /^create policy /,
  new RegExp(`^alter table (?:only )?${QNAME} enable (?:always |replica )?trigger ${NAME}$`),
  new RegExp(`^alter table (?:only )?${QNAME} (?:enable|force) row level security$`),
  // A CHECK replaced under the same name in one statement (91-audit-actions-v2.sql, TASK-285); no third action (no
  // `), <action>` after the CHECK), no NOT VALID / NO INHERIT tail, so the shadow ends with the constraint a real
  // database holds.
  new RegExp(
    `^alter table (?:only )?${QNAME} drop constraint (?:if exists )?(${NAME}) ?, ?add constraint \\1 check ?\\((?:(?!\\) ?, ?[a-z])[^;])*\\)$`,
  ),
  /^comment on (?:table|column|function|index|schema|type) /,
  new RegExp(`^select ${NAME} ?\\. ?${NAME} ?\\([^()]*\\)$`),
];

const CREATE_SCHEMA = /^create schema if not exists ([a-z_][a-z0-9_]*)(?: authorization [a-z_][a-z0-9_]*)?$/;

/** A DO block whose body (dynamic SQL included) only creates roles: the 00-roles.sql creation block. */
function isRoleDoBlock(statement: string, text: string): boolean {
  if (!/^do\b/.test(text)) return false;
  const body = normalise(sqlText(statement, true));
  return (
    /\bcreate role\b/.test(body) &&
    !/\b(?:create|alter|drop) (?:table|function|procedure|schema|index|trigger|policy|extension|view|type|event)\b/.test(body) &&
    !/\b(?:grant|revoke|insert|update|delete|truncate)\b/.test(body)
  );
}

export interface RenderOptions {
  /** `false` renders without the DROP SCHEMA lines: only the F-02 negative control uses it. Default true. */
  readonly dropSchemas?: boolean;
}

/** The migrator-runnable rendering of `files` (the bootstrap lane, in order); throws ShadowInitError on any refusal. */
export function renderShadowInit(files: readonly BootstrapFile[], { dropSchemas = true }: RenderOptions = {}): ShadowInitRendering {
  const kept: string[] = [OWNERSHIP_GUARD];
  const stripped: { file: string; reason: StripReason; preview: string }[] = [];
  for (const file of files) {
    for (const statement of splitStatements(file.sql)) {
      const text = statementCode(statement);
      // Previews come from statementCode(): string literals are blanked, so a refused statement never echoes a literal.
      const preview = text.slice(0, 100);
      const strip = STRIP.find(([, pattern]) => pattern.test(text))?.[0] ?? (isRoleDoBlock(statement, text) ? 'role DO block' : undefined);
      if (strip !== undefined) {
        stripped.push({ file: file.name, reason: strip, preview });
        continue;
      }
      if (referencedVariables(statement).length > 0) {
        throw new ShadowInitError(file.name, `a psql variable cannot be rendered into initShadowDb: "${preview}"`);
      }
      if (/\bowner to\b|\bauthorization\b/.test(text) && !CREATE_SCHEMA.test(text)) {
        throw new ShadowInitError(file.name, `an ownership clause the rendering cannot strip safely: "${preview}"`);
      }
      const schema = CREATE_SCHEMA.exec(text);
      if (schema) {
        const name = schema[1] as string;
        if (name === 'public') throw new ShadowInitError(file.name, 'CREATE SCHEMA public is not rendered (Prisma resets public)');
        if (dropSchemas) kept.push(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
        kept.push(`CREATE SCHEMA IF NOT EXISTS ${name}`);
        continue;
      }
      if (!KEEP.some((pattern) => pattern.test(text))) {
        throw new ShadowInitError(file.name, `statement form not recognised by the shadow rendering (fail closed): "${preview}"`);
      }
      kept.push(statement);
    }
  }
  return { sql: `${kept.join(';\n\n')};\n`, stripped };
}

/** The `.sql` files of a bootstrap-lane directory in name order (the runner's order), read synchronously. */
export function readBootstrapLane(dir: string = BOOTSTRAP_DIR): BootstrapFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/** The `migrations.initShadowDb` script of this repository (root prisma.config.ts). */
export function shadowInitSql(dir: string = BOOTSTRAP_DIR): string {
  return renderShadowInit(readBootstrapLane(dir)).sql;
}
