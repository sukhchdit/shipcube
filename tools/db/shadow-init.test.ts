/**
 * Shadow-database init rendering (tools/db/shadow-init.ts; data-model.md §7.3 amendments SEC-P3-27 item 6, D-ARCH-045,
 * 2026-11-13 SPK-08 F-02/F-03 and PR12-SEC-07; TASK-021). One test per rendering rule over synthetic files, plus the
 * rendering of the REAL bootstrap lane. The database behaviour (Prisma runs it twice; it refuses a bootstrapped
 * database) is prisma/tests/shadow/shadow-init.int.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import {
  BOOTSTRAP_DIR,
  OWNERSHIP_GUARD,
  ShadowInitError,
  isCheckReplacement,
  readBootstrapLane,
  renderShadowInit,
  shadowInitSql,
  statementCode,
  type BootstrapFile,
} from './shadow-init.js';
import { splitStatements } from './sql-text.js';

const PATH = 'SET search_path = pg_catalog, pg_temp;\n';
const file = (sql: string, name = '50-fixture.sql'): BootstrapFile => ({ name, sql: PATH + sql });
/** Rendered statements after the guard, as normalised code (strings and bodies blanked). */
const renderedCode = (sql: string): string[] => splitStatements(sql).slice(1).map(statementCode);
const render = (sql: string) => renderShadowInit([file(sql)]);
const refusal = (sql: string): string => {
  try {
    render(sql);
  } catch (error) {
    if (error instanceof ShadowInitError) return error.message;
    throw error;
  }
  throw new Error('expected a ShadowInitError');
};

describe('the rendering rules', () => {
  it('[PR12-SEC-07] the FIRST statement refuses with 42501 unless current_database() is owned by current_user', () => {
    const { sql } = renderShadowInit([]);
    expect(splitStatements(sql)).toEqual([OWNERSHIP_GUARD]);
    expect(OWNERSHIP_GUARD).toMatch(/^DO \$shadow_guard\$/);
    expect(OWNERSHIP_GUARD).toContain("ERRCODE = '42501'");
    expect(OWNERSHIP_GUARD).toContain('d.datname = pg_catalog.current_database()');
    expect(OWNERSHIP_GUARD).toContain('r.rolname = CURRENT_USER');
    // Hardening: a migrator-owned database whose public is not empty (not a reset shadow database) is refused too.
    expect(OWNERSHIP_GUARD).toContain("c.relnamespace = 'public'::pg_catalog.regnamespace");
    expect(splitStatements(render('CREATE TABLE public.t (id int);').sql)[0]).toBe(OWNERSHIP_GUARD);
  });

  it('[SPK-08 F-02] CREATE SCHEMA IF NOT EXISTS <s> AUTHORIZATION <r> becomes DROP SCHEMA IF EXISTS <s> CASCADE + CREATE SCHEMA IF NOT EXISTS <s>', () => {
    const schema = 'CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION platform_schema_owner;';
    expect(renderedCode(render(schema).sql)).toEqual([
      'set search_path = pg_catalog, pg_temp',
      'drop schema if exists platform cascade',
      'create schema if not exists platform',
    ]);
    // The F-02 negative control renders without the DROP.
    expect(renderedCode(renderShadowInit([file(schema)], { dropSchemas: false }).sql)).toEqual([
      'set search_path = pg_catalog, pg_temp',
      'create schema if not exists platform',
    ]);
    expect(refusal('CREATE SCHEMA IF NOT EXISTS public;')).toMatch(/CREATE SCHEMA public is not rendered/);
  });

  it.each([
    ['role', "DO $r$ BEGIN EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN', 'x'); END $r$;", 'role DO block'],
    ['role', 'CREATE ROLE platform_x NOLOGIN;', 'role'],
    ['role', "ALTER ROLE platform_migrator LOGIN PASSWORD :'migrator_password';", 'role'],
    ['role', 'ALTER ROLE CURRENT_USER IN DATABASE :"db_name" SET search_path = pg_catalog, pg_temp;', 'role'],
    ['role', 'DROP USER platform_x;', 'role'],
    ['SET ROLE', 'SET ROLE platform_audit_owner;', 'SET/RESET ROLE'],
    ['SET ROLE', 'SET SESSION ROLE platform_audit_owner;', 'SET/RESET ROLE'],
    ['RESET ROLE', 'RESET ROLE;', 'SET/RESET ROLE'],
    ['OWNER TO', 'ALTER TABLE public.audit_entries OWNER TO platform_audit_owner;', 'OWNER TO'],
    ['OWNER TO', 'ALTER FUNCTION platform.f(integer) OWNER TO platform_audit_owner;', 'OWNER TO'],
    ['OWNER TO', 'ALTER SCHEMA platform OWNER TO platform_schema_owner;', 'OWNER TO'],
    ['GRANT', 'GRANT SELECT, INSERT ON public.audit_entries TO platform_app;', 'GRANT/REVOKE'],
    ['GRANT', 'GRANT platform_definer TO platform_migrator WITH INHERIT FALSE, SET TRUE;', 'GRANT/REVOKE'],
    ['REVOKE', 'REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;', 'GRANT/REVOKE'],
    [
      'ALTER DEFAULT PRIVILEGES',
      'ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
      'ALTER DEFAULT PRIVILEGES',
    ],
    ['ALTER DATABASE', "ALTER DATABASE platform SET timezone = 'UTC';", 'ALTER DATABASE'],
    ['event trigger', 'CREATE EVENT TRIGGER g ON ddl_command_end EXECUTE FUNCTION platform.audit_ddl_guard();', 'event trigger'],
    ['event trigger', 'ALTER EVENT TRIGGER g ENABLE ALWAYS;', 'event trigger'],
    [
      'event-trigger function',
      'CREATE FUNCTION platform.audit_ddl_guard() RETURNS event_trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$ BEGIN END $$;',
      'event-trigger function',
    ],
  ])('[SPK-08 F-03] strips %s: %s', (_, sql, reason) => {
    const rendering = render(sql);
    expect(renderedCode(rendering.sql)).toEqual(['set search_path = pg_catalog, pg_temp']);
    expect(rendering.stripped.map((entry) => entry.reason)).toEqual([reason]);
  });

  it.each([
    ['the fixed search path', 'SET search_path TO pg_catalog, pg_temp;'],
    ['a CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA public line (A16)', 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;'],
    ['a table', "CREATE TABLE public.audit_x (id uuid PRIMARY KEY, note text CHECK (note <> ''));"],
    ['an index', 'CREATE INDEX ix_x ON public.audit_x (id) WHERE note IS NOT NULL;'],
    [
      'a function (dynamic GRANT text in its body is not executed here)',
      "CREATE FUNCTION platform.f() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN EXECUTE 'REVOKE ALL ON public.x FROM PUBLIC'; RETURN NULL; END $$;",
    ],
    ['a trigger', 'CREATE TRIGGER trg_x BEFORE UPDATE ON public.audit_x FOR EACH ROW EXECUTE FUNCTION platform.f();'],
    ['ENABLE ALWAYS TRIGGER', 'ALTER TABLE public.audit_x ENABLE ALWAYS TRIGGER trg_x;'],
    ['ENABLE / FORCE ROW LEVEL SECURITY', 'ALTER TABLE public.audit_x FORCE ROW LEVEL SECURITY;'],
    [
      'a CHECK replaced under the same name in one statement (TASK-285)',
      "ALTER TABLE public.audit_x\n  DROP CONSTRAINT IF EXISTS ck_x__note,\n  ADD CONSTRAINT ck_x__note CHECK (note IN ('A','B', 'C'));",
    ],
    [
      'the same without IF EXISTS',
      "ALTER TABLE ONLY public.audit_x DROP CONSTRAINT ck_x__note,ADD CONSTRAINT ck_x__note CHECK(note <> '');",
    ],
    ['a policy', 'CREATE POLICY p ON public.audit_x FOR SELECT TO platform_app USING (true);'],
    ['a comment', "COMMENT ON TABLE public.audit_x IS 'x';"],
    ['the first ensure_audit_partitions call', 'SELECT platform.ensure_audit_partitions(3);'],
  ])('keeps %s verbatim', (_, sql) => {
    const rendering = render(sql);
    expect(splitStatements(rendering.sql).slice(1)).toEqual(splitStatements(PATH + sql));
    expect(rendering.stripped).toEqual([]);
  });

  it.each([
    ['an unknown statement form', 'DELETE FROM public.audit_x;', /statement form not recognised/],
    ['ALTER TABLE beyond the trigger/RLS forms', 'ALTER TABLE public.audit_x ADD COLUMN y int;', /statement form not recognised/],
    ['a DROP CONSTRAINT alone', 'ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note;', /statement form not recognised/],
    [
      'an ADD CONSTRAINT alone',
      "ALTER TABLE public.audit_x ADD CONSTRAINT ck_x__note CHECK (note <> '');",
      /statement form not recognised/,
    ],
    [
      'a CHECK replaced under another name',
      "ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__other CHECK (note <> '');",
      /statement form not recognised/,
    ],
    [
      'a replacement CHECK marked NOT VALID',
      "ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__note CHECK (note <> '') NOT VALID;",
      /statement form not recognised/,
    ],
    [
      'a replacement CHECK followed by another action',
      "ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__note CHECK (note <> ''), ADD COLUMN y int;",
      /statement form not recognised/,
    ],
    [
      'a replacement that is a foreign key',
      'ALTER TABLE public.audit_x DROP CONSTRAINT fk_x, ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES public.y (id);',
      /statement form not recognised/,
    ],
    ['another SET', "SET lock_timeout = '1s';", /statement form not recognised/],
    ['a CREATE SCHEMA without IF NOT EXISTS', 'CREATE SCHEMA platform;', /statement form not recognised/],
    ['REASSIGN OWNED', 'REASSIGN OWNED BY platform_migrator TO platform_audit_owner;', /statement form not recognised/],
    ['ALTER SYSTEM', "ALTER SYSTEM SET work_mem = '64MB';", /statement form not recognised/],
    ['OWNER TO next to another action', 'ALTER TABLE public.audit_x OWNER TO platform_audit_owner, ADD COLUMN y int;', /ownership clause/],
    ['an AUTHORIZATION it cannot parse', 'CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION "Owner";', /ownership clause/],
    ['a psql variable in a kept form', "CREATE TABLE public.x (id int DEFAULT :'app_password');", /psql variable/],
    [
      'a DO block that does more than create roles',
      "DO $$ BEGIN EXECUTE 'CREATE ROLE x'; EXECUTE 'CREATE TABLE public.y (id int)'; END $$;",
      /statement form not recognised/,
    ],
    ['any other DO block', 'DO $$ BEGIN PERFORM 1; END $$;', /statement form not recognised/],
    ['a SELECT that is not one function call', 'SELECT platform.f(1) FROM public.audit_x;', /statement form not recognised/],
  ])('refuses %s (fail closed)', (_, sql, message) => {
    expect(refusal(sql)).toMatch(message);
  });

  /** The shared prefix of the PR52-SEC-01 probe table (security record PR #52 §4). */
  const REPLACEMENT =
    "ALTER TABLE public.audit_entries DROP CONSTRAINT IF EXISTS ck_audit_entries__action, ADD CONSTRAINT ck_audit_entries__action CHECK (action IN ('A','B'))";

  it.each([
    ['the bare replacement', `${REPLACEMENT};`],
    [
      'ONLY with tight commas and nested parentheses',
      "ALTER TABLE ONLY public.audit_x DROP CONSTRAINT ck_x__note,ADD CONSTRAINT ck_x__note CHECK((note <> '') AND (length(note) < 9));",
    ],
    [
      'a quoted identifier holding a parenthesis inside the CHECK',
      `ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__note CHECK ("a)b" <> '' AND "(" IS NOT NULL);`,
    ],
    [
      'a string literal holding a closing parenthesis and an action',
      "ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__note CHECK (note <> '), add column y int');",
    ],
  ])('[PR52-SEC-01] keeps a same-name CHECK replacement whose CHECK ends the statement: %s', (_, sql) => {
    const rendering = render(sql);
    expect(splitStatements(rendering.sql).slice(1)).toEqual(splitStatements(PATH + sql));
    expect(rendering.stripped).toEqual([]);
  });

  it.each([
    // The controls of the PR #52 record (refused before and after).
    ['control: a NOT VALID tail', `${REPLACEMENT} NOT VALID;`, /statement form not recognised/],
    ['control: a second action', `${REPLACEMENT}, ADD COLUMN y int;`, /statement form not recognised/],
    ['control: a commented second action', `${REPLACEMENT} /* c */ , DISABLE TRIGGER ALL;`, /statement form not recognised/],
    [
      'control: another constraint name',
      "ALTER TABLE public.audit_entries DROP CONSTRAINT IF EXISTS ck_audit_entries__action, ADD CONSTRAINT ck_audit_entries__other CHECK (action IN ('A'));",
      /statement form not recognised/,
    ],
    ['control: NOT VALID then OWNER TO', `${REPLACEMENT} NOT VALID, OWNER TO platform_app;`, /ownership clause/],
    // The bypass shapes of PR52-SEC-01 (kept by the regex form; refused now).
    [
      'NOT VALID, DISABLE TRIGGER ALL, a second CHECK',
      `${REPLACEMENT} NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true);`,
      /statement form not recognised/,
    ],
    [
      'NO INHERIT, NO FORCE ROW LEVEL SECURITY, a second CHECK',
      `${REPLACEMENT} NO INHERIT, NO FORCE ROW LEVEL SECURITY, ADD CONSTRAINT z CHECK (true);`,
      /statement form not recognised/,
    ],
    [
      'NOT ENFORCED, DISABLE ROW LEVEL SECURITY, a parenthesised default',
      `${REPLACEMENT} NOT ENFORCED, DISABLE ROW LEVEL SECURITY, ALTER COLUMN action SET DEFAULT ('A');`,
      /statement form not recognised/,
    ],
    [
      'NOT VALID, a second DROP CONSTRAINT',
      `${REPLACEMENT} NOT VALID, DROP CONSTRAINT ck_audit_entries__outcome, ADD CONSTRAINT z CHECK (true);`,
      /statement form not recognised/,
    ],
    ['NOT VALID, ADD COLUMN with a CHECK', `${REPLACEMENT} NOT VALID, ADD COLUMN y int CHECK (y > 0);`, /statement form not recognised/],
    [
      'a primary key "replaced" by a CHECK of the same name',
      'ALTER TABLE public.audit_entries DROP CONSTRAINT pk_audit_entries, ADD CONSTRAINT pk_audit_entries CHECK (true);',
      /statement form not recognised/,
    ],
    [
      'a unique constraint "replaced" by a CHECK of the same name',
      'ALTER TABLE public.audit_entries DROP CONSTRAINT IF EXISTS ux_audit_entries__id, ADD CONSTRAINT ux_audit_entries__id CHECK (true);',
      /statement form not recognised/,
    ],
    [
      'a quoted CHECK name (statementCode folds its case)',
      'ALTER TABLE public.audit_x DROP CONSTRAINT "CK_X", ADD CONSTRAINT "ck_x" CHECK (true);',
      /statement form not recognised/,
    ],
    [
      'a quoted identifier holding a parenthesis before an attribute and an action',
      `ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__note CHECK ("a)b" <> '') NOT VALID, ADD COLUMN y int CHECK (y > 0);`,
      /statement form not recognised/,
    ],
    [
      'a quoted opening parenthesis that would hide an action from a scan without the quote skip',
      `ALTER TABLE public.audit_x DROP CONSTRAINT ck_x__note, ADD CONSTRAINT ck_x__note CHECK ("(" <> '') NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true));`,
      /statement form not recognised/,
    ],
  ])('[PR52-SEC-01] refuses %s (fail closed)', (_, sql, message) => {
    expect(refusal(sql)).toMatch(message);
  });

  it('[PR52-SEC-01] isCheckReplacement: the head alone, an unclosed CHECK and a statement that is not a replacement are no KEEP form', () => {
    const head = 'alter table public.audit_x drop constraint ck_x, add constraint ck_x check (';
    expect(isCheckReplacement(`${head}a > 0)`)).toBe(true);
    expect(isCheckReplacement(head)).toBe(false);
    expect(isCheckReplacement(`${head}(a > 0)`)).toBe(false);
    expect(isCheckReplacement(`${head}"a > 0)`)).toBe(false);
    expect(isCheckReplacement(`${head}a > 0) not valid`)).toBe(false);
    expect(isCheckReplacement('alter table public.audit_x drop constraint ck_x, add constraint ck_xy check (a > 0)')).toBe(false);
    expect(isCheckReplacement('alter table public.audit_x add constraint ck_x check (a > 0)')).toBe(false);
  });

  it('a refusal names the file and never echoes a string literal of the statement', () => {
    const message = refusal("ALTER SYSTEM SET application_name = 'literal-text-not-echoed';");
    expect(message).toMatch(/^50-fixture\.sql: /);
    expect(message).not.toContain('literal-text-not-echoed');
  });
});

describe('the rendering of the real bootstrap lane', () => {
  const lane = readBootstrapLane();
  const rendering = renderShadowInit(lane);
  const statements = splitStatements(rendering.sql);
  const codes = statements.map(statementCode);

  it('reads every prisma/bootstrap/*.sql file in name order (the runner order), audit files included', () => {
    const names = lane.map((entry) => entry.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining(['00-roles.sql', '01-schemas.sql', '10-audit.sql', '90-audit-ddl-guard.sql', '91-audit-actions-v2.sql']),
    );
    expect(shadowInitSql(BOOTSTRAP_DIR)).toBe(rendering.sql);
  });

  it('[PR12-SEC-07] starts with the ownership guard; [SPK-08 F-02] DROP SCHEMA platform precedes CREATE SCHEMA platform', () => {
    expect(statements[0]).toBe(OWNERSHIP_GUARD);
    const drop = codes.indexOf('drop schema if exists platform cascade');
    expect(drop).toBeGreaterThan(0);
    expect(codes[drop + 1]).toBe('create schema if not exists platform');
    expect(codes.filter((text) => text.startsWith('create schema '))).toEqual(['create schema if not exists platform']);
  });

  it('keeps the search-path lines and the three CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA public lines', () => {
    expect(codes.filter((text) => text === 'set search_path = pg_catalog, pg_temp').length).toBe(lane.length);
    for (const extension of ['pg_trgm', 'btree_gin', 'btree_gist']) {
      expect(codes).toContain(`create extension if not exists ${extension} with schema public`);
    }
  });

  it('keeps the audit tables, functions, triggers and the first partition call, so the shadow mirrors the external objects', () => {
    for (const table of [
      'audit_entries',
      'audit_stream_heads',
      'audit_partitions',
      'audit_chain_verifications',
      'audit_checkpoint_heads',
      'audit_anchors',
      'data_subjects',
      'audit_pii_vault',
    ]) {
      expect(codes.some((text) => text.startsWith(`create table public.${table} (`))).toBe(true);
    }
    for (const fn of ['audit_forbid_mutation', 'audit_vault_guard', 'ensure_audit_partitions']) {
      expect(codes.some((text) => text.startsWith(`create function platform.${fn}(`))).toBe(true);
    }
    expect(codes.filter((text) => text.startsWith('create trigger ')).length).toBeGreaterThanOrEqual(8);
    expect(codes).toContain('select platform.ensure_audit_partitions(3)');
  });

  it('keeps the action CHECK widening of 91-audit-actions-v2.sql after the first partition call (TASK-285)', () => {
    const widening = codes.findIndex((text) =>
      text.startsWith(
        'alter table public.audit_entries drop constraint if exists ck_audit_entries__action, add constraint ck_audit_entries__action check (action in (',
      ),
    );
    expect(widening).toBeGreaterThan(codes.indexOf('select platform.ensure_audit_partitions(3)'));
    expect(statements[widening]).toContain("'MFA_RECOVERY_USED','SESSION_REVOKED'");
  });

  it('[SPK-08 F-03] holds no role, SET ROLE, OWNER TO, AUTHORIZATION, GRANT/REVOKE, default privileges, ALTER DATABASE, event trigger, guard function or psql variable', () => {
    for (const text of codes.slice(1)) {
      expect(text).not.toMatch(
        /\b(?:create|alter|drop) (?:role|user|group)\b|\bset (?:session )?role\b|\breset role\b|\bowner to\b|\bauthorization\b|^grant\b|^revoke\b|default privileges|^alter database\b|event trigger|event_trigger/,
      );
    }
    expect(rendering.sql).not.toMatch(/:'[a-z_]+'|:"[a-z_]+"/);
    expect(rendering.sql).not.toContain('audit_ddl_guard');
    expect([...new Set(rendering.stripped.map((entry) => entry.reason))].sort()).toEqual([
      'ALTER DEFAULT PRIVILEGES',
      'GRANT/REVOKE',
      'OWNER TO',
      'SET/RESET ROLE',
      'event trigger',
      'event-trigger function',
      'role',
      'role DO block',
    ]);
  });
});
