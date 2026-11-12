/**
 * Migration linter with negative fixtures (data-model.md §8.3; NT-DATA-004-b; NT-AVAIL-003-a (rules 2-6, 11);
 * SEC-TC-33 (rules 7-9, 12, 14); ADR-0005 am. 10 items 1 and 9 (rules 16 and 15); PR5-SEC-11/-12; TASK-003, TASK-016).
 * Fixtures: tools/db/fixtures/lint/{migrations,bootstrap}/<case>/. The fixture tables are classified by
 * FIXTURE_CLASSES below (the repository's own manifests stay the source for the repository run).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  canonicalPolicy,
  lintBootstrap,
  lintMigrations,
  lintRepository,
  lockTimeoutMs,
  main,
  parseHeader,
  readReviewers,
  type LintFinding,
} from './lint-migrations.js';
import { renderRls } from './render-rls.js';
import { loadTableClasses, type TableClassEntry } from './table-classes.js';
import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tools', 'db', 'fixtures', 'lint');
/** Table classes of the fixture tables (rule 9 manifest lookup, rule 8 hardDelete allow-list). */
const FIXTURE_CLASSES: readonly TableClassEntry[] = [
  ...loadTableClasses(),
  { module: 'fixture', name: 'fixture_items', class: 'GLOBAL' },
  { module: 'fixture', name: 'fixture_owners', class: 'GLOBAL' },
  { module: 'fixture', name: 'fixture_events', class: 'GLOBAL' },
  { module: 'fixture', name: 'fixture_orders', class: 'TENANT' },
  { module: 'fixture', name: 'fixture_quotes', class: 'GUEST_CAPABLE' },
  { module: 'fixture', name: 'fixture_profiles', class: 'USER_OWNED', definerRead: true, definerPurge: true },
  { module: 'fixture', name: 'fixture_sessions', class: 'SYSTEM', hardDelete: true },
];
const lintCase = (name: string) => lintMigrations(join(fixtures, 'migrations', name), name, { tableClasses: FIXTURE_CLASSES });
const rules = (findings: LintFinding[]) => findings.map((finding) => finding.rule);
/** `[migration directory, rule]` per finding, for multi-migration cases. */
const byMigration = (findings: LintFinding[]) => findings.map((finding) => [finding.file.split(/[\\/]/)[1], finding.rule]);
const bootstrapCase = (name: string, reviewers: string[] = ['security-analyst'], today = '2026-11-12') =>
  lintBootstrap(join(fixtures, 'bootstrap', name), { reviewers, today }, name);

describe('migration header and down.sql (rule 1)', () => {
  it('[NT-DATA-004-b] accepts migrations with a complete header block and a down.sql (control)', () => {
    expect(lintCase('valid')).toEqual([]);
  });

  it('[NT-DATA-004-b] rejects a migration without the header block', () => {
    const findings = lintCase('no-header');
    expect(rules(findings)).toEqual(['1', '1', '1']);
    expect(findings.map((finding) => finding.message)).toEqual([
      'missing header line "-- migration-kind: …" before the first statement',
      'missing header line "-- data-changing: …" before the first statement',
      'missing header line "-- reversible: …" before the first statement',
    ]);
  });

  it('[NT-DATA-004-b] rejects invalid values, duplicates and a header placed after the first statement', () => {
    expect(lintCase('bad-header').map((finding) => finding.message)).toEqual([
      'migration-kind must be expand, migrate or contract, got "sideways"',
      'data-changing must be yes or no, got "maybe"',
      'duplicate header line "reversible"',
    ]);
    expect(rules(lintCase('header-after-statement'))).toEqual(['1', '1', '1']);
  });

  it('[NT-DATA-004-b] rejects a migration without down.sql', () => {
    expect(lintCase('no-down')).toEqual([
      {
        file: join('no-down', '20261112000000_no_down', 'down.sql'),
        rule: '1',
        message: 'down.sql is missing (every migration ships one, §8.4)',
      },
    ]);
  });

  it('parses the header case-insensitively', () => {
    expect(parseHeader('-- Migration-Kind: Contract\n-- data-changing: NO\n--reversible:no\nSELECT 1;')).toEqual({
      kind: 'contract',
      dataChanging: false,
      reversible: false,
      problems: [],
    });
  });
});

describe('expand -> migrate -> contract (rules 2, 10 and contract reversibility)', () => {
  it('rejects a contract step declared reversible', () => {
    expect(lintCase('contract-reversible')).toEqual([
      {
        file: join('contract-reversible', '20261112000000_contract_reversible', 'migration.sql'),
        rule: 'C',
        message: 'a contract migration is restore-based only and must declare "reversible: no" (§8.2)',
      },
    ]);
  });

  it('rejects DROP COLUMN, DROP TABLE and DROP DEFAULT outside a contract migration', () => {
    const findings = lintCase('drop-in-expand');
    expect(rules(findings)).toEqual(['2', '2', '2']);
    expect(findings.map((finding) => finding.file)).toEqual([
      join('drop-in-expand', '20261112000000_drop_column', 'migration.sql'),
      join('drop-in-expand', '20261112000100_drop_table', 'migration.sql'),
      join('drop-in-expand', '20261112000200_drop_default', 'migration.sql'),
    ]);
  });

  it('rejects UPDATE and DELETE without "data-changing: yes" (backup guardrail)', () => {
    expect(rules(lintCase('undeclared-data-change'))).toEqual(['10', '10']);
  });

  it('rejects data changes wrapped in a CTE and DROP [COLUMN] IF EXISTS outside a contract migration (CR m3)', () => {
    const findings = lintCase('cte-and-drop-if-exists');
    expect(findings.map((finding) => [finding.file.split(/[\\/]/)[1], finding.rule])).toEqual([
      ['20261112000000_cte_update', '10'],
      ['20261112000100_cte_delete', '10'],
      ['20261112000200_drop_if_exists', '2'],
      ['20261112000300_drop_column_if_exists', '2'],
    ]);
  });

  it('rejects an upsert (INSERT … ON CONFLICT … DO UPDATE) without "data-changing: yes"; ON CONFLICT DO NOTHING stays clean (PR8-SEC-03)', () => {
    const findings = lintCase('upsert');
    expect(findings.map((finding) => [finding.file.split(/[\\/]/)[1], finding.rule])).toEqual([['20261112000000_upsert_do_update', '10']]);
  });

  it('does not flag a plain WITH ... SELECT, row locks (FOR [NO KEY] UPDATE) or keywords inside strings (CR m3 control)', () => {
    expect(lintCase('cte-select')).toEqual([]);
  });

  it('rejects data changes inside a DO block, static or dynamic, but not inside a CREATE FUNCTION body or a row lock (CR m6, PR #5 R2-m2)', () => {
    expect(byMigration(lintCase('do-block-data-change'))).toEqual([
      ['20261112000000_do_update', '10'],
      ['20261112000100_do_dynamic_delete', '10'],
    ]);
  });
});

describe('audit DDL (rule 12) and the definer search path (rule 13)', () => {
  it('[SEC-TC-33] rejects audit DDL in prisma/migrations unconditionally, including dynamic SQL and the audit owner role (rule 12; DISABLE TRIGGER and DETACH PARTITION also fail rule 7)', () => {
    expect(byMigration(lintCase('audit-ddl'))).toEqual([
      ['20261112000000_audit_trigger', '12'],
      ['20261112000000_audit_trigger', '7'],
      ['20261112000100_audit_partition', '12'],
      ['20261112000100_audit_partition', '7'],
      ['20261112000200_audit_owner', '12'],
      ['20261112000300_audit_dynamic', '12'],
    ]);
  });

  it('rejects SECURITY DEFINER without exactly "SET search_path = pg_catalog, pg_temp", and ALTER FUNCTION that weakens it', () => {
    expect(rules(lintCase('definer-path'))).toEqual(['13', '13', '13', '13']);
  });

  it.each([
    ['definer-duplicate-set'],
    ['definer-set-from-current'],
    ['alter-routine-definer'],
    ['alter-routine-set'],
    ['alter-function-duplicate-set'],
  ])('rule 13 counts every SET search_path (the last one wins) and covers ALTER ROUTINE: %s fails (PR5-SEC-11)', (name) => {
    expect(rules(lintCase(name))).toEqual(['13']);
  });

  it('finds SECURITY DEFINER and the SET clause after the body, and ignores both inside the body (CR m2)', () => {
    expect(lintCase('definer-after-body').map((finding) => [finding.file.split(/[\\/]/)[1], finding.rule])).toEqual([
      ['20261112000000_definer_after_body', '13'],
      ['20261112000200_definer_path_in_body_only', '13'],
    ]);
  });

  it('requires an approved marker with a listed reviewer and a past date for audit DDL in the bootstrap lane (rule 12)', () => {
    expect(bootstrapCase('audit-approved')).toEqual([]);
    expect(bootstrapCase('audit-unapproved').map((finding) => finding.message)).toEqual([
      'audit DDL needs the header "-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>"',
    ]);
    expect(bootstrapCase('audit-unknown-reviewer').map((finding) => finding.message)).toEqual([
      'audit DDL reviewer "mallory" is not listed in tools/db/audit-ddl-reviewers.json',
    ]);
    expect(bootstrapCase('audit-future-date').map((finding) => finding.message)).toEqual([
      'audit DDL approval date 2099-01-01 lies in the future',
    ]);
    expect(rules(bootstrapCase('audit-approved', []))).toEqual(['12']);
  });

  it('treats handing out the audit owner role as audit DDL in the bootstrap lane, but not its definition and schema grants (rule 12)', () => {
    expect(bootstrapCase('audit-owner-setup')).toEqual([]);
    expect(rules(bootstrapCase('audit-owner-membership'))).toEqual(['12']);
  });

  it.each([
    ['audit-owner-grant-list'],
    ['audit-owner-reassign'],
    ['audit-owner-drop-owned'],
    ['audit-owner-login'],
    ['audit-owner-bypassrls'],
    ['audit-owner-rename'],
    ['audit-owner-drop-role'],
    ['audit-owner-default-grant'],
    ['audit-owner-alter-group'],
    ['audit-owner-set-role'],
    ['audit-owner-schema-grant-option'],
    ['audit-owner-dynamic'],
  ])('bootstrap lane is deny-by-default for the audit owner: %s needs the marker (rule 12; PR5-SEC-02, CR m1)', (name) => {
    expect(rules(bootstrapCase(name))).toEqual(['12']);
    expect(rules(bootstrapCase(name, []))).toEqual(['12']);
  });

  it('exempts only the tightening forms of the real 00-roles.sql and 01-schemas.sql, creation block included (rule 12 control)', () => {
    expect(lintBootstrap(join(repoRoot, 'prisma', 'bootstrap'), { reviewers: [], today: '2026-11-12' })).toEqual([]);
  });

  it('requires "SET search_path = pg_catalog, pg_temp" as the first statement of every bootstrap file', () => {
    expect(bootstrapCase('valid')).toEqual([]);
    expect(bootstrapCase('path-not-first')).toEqual([
      {
        file: join('path-not-first', '00-roles.sql'),
        rule: '13',
        message: 'the first statement must be "SET search_path = pg_catalog, pg_temp;"',
      },
    ]);
  });
});

describe('zero-downtime DDL (rules 3, 4, 5, 6, 11; NT-AVAIL-003-a)', () => {
  it('[NT-AVAIL-003-a] rejects RENAME of a table, a column and a constraint (rule 3)', () => {
    expect(byMigration(lintCase('rename'))).toEqual([
      ['20261112000000_rename_table', '3'],
      ['20261112000100_rename_column', '3'],
      ['20261112000200_rename_constraint', '3'],
    ]);
  });

  it('[NT-AVAIL-003-a] rejects ADD COLUMN NOT NULL without a constant default, ALTER COLUMN TYPE and SET NOT NULL without a validated CHECK (rule 4)', () => {
    expect(byMigration(lintCase('not-null-unsafe'))).toEqual([
      ['20261112000000_add_not_null_no_default', '4'],
      ['20261112000100_add_not_null_volatile_default', '4'],
      ['20261112000200_alter_type', '4'],
      ['20261112000300_set_not_null', '4'],
    ]);
  });

  it('[NT-AVAIL-003-a] accepts constant defaults, NOT NULL on a new table, and SET NOT NULL after CHECK NOT VALID + VALIDATE (rule 4 control)', () => {
    expect(lintCase('not-null-safe')).toEqual([]);
  });

  it('[NT-AVAIL-003-a] rejects CREATE INDEX without CONCURRENTLY on an existing table (rule 5)', () => {
    expect(rules(lintCase('index-not-concurrent'))).toEqual(['5']);
  });

  it('[NT-AVAIL-003-a] rejects CREATE INDEX CONCURRENTLY in a multi-statement file (rule 5)', () => {
    // Written per data-model §8.3; the Prisma 7.10 `migrate deploy` probe (prisma/tests/migrations) settles how a
    // one-statement file is submitted.
    const findings = lintCase('index-concurrent-multi');
    expect(rules(findings)).toEqual(['5']);
    expect(findings[0]?.message).toMatch(/must be the only statement/);
  });

  it('[NT-AVAIL-003-a] rejects FOREIGN KEY and CHECK on an existing table without NOT VALID (rule 6)', () => {
    expect(byMigration(lintCase('fk-check-not-valid'))).toEqual([
      ['20261112000000_fk_validated', '6'],
      ['20261112000100_check_validated', '6'],
    ]);
  });

  it('[NT-AVAIL-003-a] rejects altering an existing table without SET lock_timeout as the first statement (rule 11)', () => {
    expect(byMigration(lintCase('lock-timeout'))).toEqual([
      ['20261112000000_no_lock_timeout', '11'],
      ['20261112000100_lock_timeout_late', '11'],
    ]);
  });

  it('[NT-AVAIL-003-a] rule 11 refuses SET LOCAL lock_timeout (no effect outside a transaction block) and accepts SET SESSION (PR11-SEC-07)', () => {
    const findings = lintCase('set-local-lock-timeout');
    expect(byMigration(findings)).toEqual([['20261112000000_set_local', '11']]);
    expect(findings[0]?.message).toContain('files are not atomic; SET LOCAL outside a transaction block has no effect');
  });

  it('rule 11 (D-ARCH-071): a file that leaves lock_timeout above the 3s migrator default without RESET fails; RESET, DEFAULT and values within 3s pass', () => {
    const findings = lintCase('lock-timeout-raised');
    expect(byMigration(findings)).toEqual([
      ['20261112000000_raised_no_reset', '11'],
      ['20261112000200_minutes_no_reset', '11'],
      ['20261112000300_zero_no_reset', '11'],
    ]);
    expect(findings[0]?.message).toContain('end it with "RESET lock_timeout"');
  });

  it.each([
    ["'2s'", 2_000],
    ['3000', 3_000],
    ["'10 s'", 10_000],
    ["'1min'", 60_000],
    ["'1.5h'", 5_400_000],
    ["'500us'", 0.5],
    ['default', undefined],
    ['0', Number.POSITIVE_INFINITY],
    ["'soon'", Number.POSITIVE_INFINITY],
    ["'10 fortnights'", Number.POSITIVE_INFINITY],
  ])('rule 11 parses lock_timeout %s as %s ms (unparsed and 0 fail closed)', (value, expected) => {
    expect(lockTimeoutMs(value)).toBe(expected);
  });
});

describe('RLS, triggers, grants and privilege-bound statements (rules 7, 8, 9, 14; SEC-TC-33)', () => {
  it.each([
    ['drop-trigger', ['7']],
    ['disable-trigger', ['7']],
    ['disable-rls', ['7', '7']],
  ])('[SEC-TC-33] rule 7: %s fails', (name, expected) => {
    expect(rules(lintCase(name))).toEqual(expected);
  });

  it('[SEC-TC-33] rule 7: UPDATE, DELETE, TRUNCATE, DROP and DETACH PARTITION on audit storage fail (with rule 12)', () => {
    const findings = lintCase('audit-storage');
    expect([...new Set(findings.map((finding) => finding.file.split(/[\\/]/)[1]))]).toHaveLength(5);
    for (const migration of new Set(findings.map((finding) => finding.file))) {
      expect(rules(findings.filter((finding) => finding.file === migration)).sort()).toEqual(['12', '7']);
    }
  });

  it.each([
    ['delete-grant', ['8']],
    // ALL includes TRUNCATE/TRIGGER/REFERENCES (PR11-SEC-04) and DELETE outside the allow-list.
    ['all-grant', ['8', '8']],
    ['app-bypassrls', ['14', '8']],
    ['app-superuser', ['14', '8']],
    ['app-owner', ['8']],
    ['app-membership', ['8']],
    ['partition-grant', ['8']],
  ])('[SEC-TC-33] rule 8: %s fails', (name, expected) => {
    expect(rules(lintCase(name))).toEqual(expected);
  });

  it.each([['drop-policy'], ['alter-policy'], ['create-table-unclassified'], ['create-table-rls-no-force']])(
    '[SEC-TC-33] rule 9: %s fails',
    (name) => {
      expect(rules(lintCase(name))).toEqual(['9']);
    },
  );

  it('[SEC-TC-33] rule 9 is cross-checked with the manifests: a TENANT table ships ENABLE + FORCE, a policy is re-created in the same file', () => {
    expect(lintCase('task016-clean')).toEqual([]);
    // Without its manifest entry the same file fails rule 9.
    const unclassified = lintMigrations(join(fixtures, 'migrations', 'task016-clean'), 'task016-clean', { tableClasses: [] });
    expect(rules(unclassified)).toContain('9');
  });

  it('[SEC-TC-33] rule 8: a table or sequence privilege to PUBLIC fails, REVOKE FROM PUBLIC is clean (PR11-SEC-04, CR m2)', () => {
    expect(byMigration(lintCase('grant-to-public'))).toEqual([
      ['20261112000000_table_to_public', '8'],
      ['20261112000100_sequence_to_public', '8'],
    ]);
  });

  it('[SEC-TC-33] rule 8: TRUNCATE, TRIGGER and REFERENCES to platform_app fail (they act outside RLS; PR11-SEC-04)', () => {
    expect(byMigration(lintCase('truncate-to-app'))).toEqual([
      ['20261112000000_truncate', '8'],
      ['20261112000100_trigger', '8'],
      ['20261112000200_references', '8'],
    ]);
  });

  it.each([['policy-tautology'], ['policy-unkeyed']])(
    '[SEC-TC-33] rule 9: %s fails as "policy not rendered from the templates" (PR11-SEC-03 probe P-C)',
    (name) => {
      const findings = lintCase(name);
      expect(rules(findings)).toEqual(['9']);
      expect(findings[0]?.message).toMatch(/^policy not rendered from the templates/);
    },
  );

  it("[SEC-TC-33] rule 9: a GRANT to platform_app before the table's ENABLE + FORCE fails; a grant in a later file is clean (PR11-SEC-07)", () => {
    expect(byMigration(lintCase('grant-before-force'))).toEqual([['20261112000000_grant_before_force', '9']]);
  });

  it('[SEC-TC-33] rule 14: CREATE SCHEMA, CREATE EXTENSION, ALTER DATABASE, ALTER SCHEMA OWNER TO, ALTER/CREATE/DROP ROLE, ALTER DEFAULT PRIVILEGES fail', () => {
    expect(byMigration(lintCase('bootstrap-only'))).toEqual([
      ['20261112000000_create_schema', '14'],
      ['20261112000100_create_extension', '14'],
      ['20261112000200_alter_database', '14'],
      ['20261112000300_alter_schema_owner', '14'],
      ['20261112000400_alter_role', '14'],
      ['20261112000500_create_role', '14'],
      ['20261112000600_drop_role', '14'],
      ['20261112000700_alter_default_privileges', '14'],
    ]);
  });
});

describe('rendered RLS blocks (rules 9 and 16; PR11-SEC-03)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'lint-rendered-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const rendered = FIXTURE_CLASSES.filter((entry) => ['fixture_orders', 'fixture_quotes', 'fixture_profiles'].includes(entry.name));
  /** Writes one migration holding the renderer output for the TENANT, GUEST_CAPABLE and USER_OWNED fixture tables. */
  const renderedCase = (name: string, edit: (sql: string) => string = (sql) => sql) => {
    const dir = join(scratch, name, '20261112000000_rendered');
    mkdirSync(dir, { recursive: true });
    const sql = [
      '-- migration-kind: expand\n-- data-changing: no\n-- reversible: yes\n',
      'CREATE TABLE public.fixture_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);',
      'CREATE TABLE public.fixture_quotes (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea);',
      'CREATE TABLE public.fixture_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, expires_at timestamptz NOT NULL);',
      ...rendered.map((entry) => renderRls(entry)),
      'GRANT SELECT, INSERT, UPDATE ON public.fixture_orders, public.fixture_quotes, public.fixture_profiles TO platform_app;',
    ].join('\n');
    writeFileSync(join(dir, 'migration.sql'), edit(sql));
    writeFileSync(join(dir, 'down.sql'), 'SELECT 1;\n');
    return lintMigrations(join(scratch, name), name, { tableClasses: FIXTURE_CLASSES });
  };

  it('the renderer output for TENANT, GUEST_CAPABLE and USER_OWNED (definer flags included) lints clean; the operator atom is exempt in a CREATE POLICY', () => {
    expect(renderedCase('clean')).toEqual([]);
  });

  it('a rendered policy whose operator literal or predicate is edited fails rule 9 (and rule 16 outside the exact atom)', () => {
    expect(rules(renderedCase('scope', (sql) => sql.replace("= 'OPERATOR'", "= 'ANYONE'")))).toEqual(['9', '16']);
    expect(rules(renderedCase('predicate', (sql) => sql.replace('(org_id = platform.app_org_id())', '(org_id = org_id)')))).toEqual(['9']);
  });

  it('canonicalPolicy ignores comments, case, quoting of plain names and spacing, but keeps literals verbatim', () => {
    const rendered =
      "CREATE POLICY p_t__operator ON public.t FOR SELECT TO platform_app USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator())";
    expect(
      canonicalPolicy(
        `create policy "p_t__operator" on "public".t -- note\n for select to platform_app using(current_setting( 'app.actor_scope' , true )='OPERATOR' and platform . app_is_operator ( ))`,
      ),
    ).toBe(canonicalPolicy(rendered));
    expect(canonicalPolicy(rendered.replace("'OPERATOR'", "'operator'"))).not.toBe(canonicalPolicy(rendered));
  });
});

describe('definer ownership order (rule 15; ADR-0005 am. 10 item 9)', () => {
  it('rule 15 (ADR-0005 am. 10 item 9): GRANT/REVOKE after OWNER TO platform_definer fails (definer-grant-after-owner-to)', () => {
    // The CREATE outside the SET ROLE block fails too since PR11-SEC-07 (no "OWNER TO later" alternative).
    expect(lintCase('definer-grant-after-owner-to').map((finding) => finding.message.slice(0, 40))).toEqual([
      'SECURITY DEFINER function created outsid',
      'OWNER TO platform_definer: create the fu',
      'REVOKE after OWNER TO platform_definer f',
      'GRANT after OWNER TO platform_definer fa',
    ]);
  });

  it('rule 15 (ADR-0005 am. 10 item 9): SECURITY DEFINER created outside SET ROLE platform_definer is flagged (definer-outside-set-role)', () => {
    expect(rules(lintCase('definer-outside-set-role'))).toEqual(['15']);
  });

  it('rule 15 (ADR-0005 am. 10 item 9): definer-set-role-block is clean', () => {
    expect(lintCase('definer-set-role-block')).toEqual([]);
  });

  it('rule 15 (D-ARCH-071 (2) b): a bare ALTER FUNCTION / ROUTINE … OWNER TO platform_definer fails, quoted role included', () => {
    const findings = lintCase('definer-owner-to');
    expect(byMigration(findings)).toEqual([
      ['20261112000000_function_owner_to', '15'],
      ['20261112000100_routine_owner_to_quoted', '15'],
    ]);
    expect(findings.every((finding) => finding.message.startsWith('OWNER TO platform_definer'))).toBe(true);
  });

  it('rule 15: "grants before OWNER TO" is no longer accepted; the SET ROLE block is the only form (PR11-SEC-07)', () => {
    // The CREATE outside the block and the bare OWNER TO (D-ARCH-071 (2) b) both fail.
    expect(rules(lintCase('definer-grants-before-owner-to'))).toEqual(['15', '15']);
  });

  it('rule 15: a file ending inside SET ROLE fails; SET LOCAL ROLE does not open the definer block (PR11-SEC-07)', () => {
    const findings = lintCase('definer-role-not-reset');
    expect(byMigration(findings)).toEqual([
      ['20261112000000_role_not_reset', '15'],
      ['20261112000100_set_local_role', '15'],
    ]);
    expect(findings[0]?.message).toMatch(/ends with a SET ROLE still in effect/);
    expect(findings[1]?.message).toMatch(/created outside "SET ROLE platform_definer/);
  });
});

describe('tenant context in SQL (rule 16; ADR-0005 am. 10 item 1)', () => {
  it.each([
    ['context-set-config-platform', 'a platform function calling set_config(app.org_id, …, true)'],
    ['context-set-public', 'a public function running a session SET of the org key'],
    ['context-read-non-helper', 'a non-helper reading current_setting(app.org_id, true)'],
  ])('rule 16 (ADR-0005 am. 10 item 1): %s fails (%s)', (name) => {
    expect(rules(lintCase(name))).toEqual(['16']);
  });

  it('rule 16 (ADR-0005 am. 10 item 1): a §4.2 helper definition, an app.correlation_id read and a non-app set_config are clean', () => {
    expect(lintCase('context-helper')).toEqual([]);
  });

  it('rule 16 uses the shared form list: every PostgreSQL-valid evasion of probe P-B fails, one finding per statement (PR11-SEC-02, CR m1)', () => {
    expect(byMigration(lintCase('context-evasions'))).toEqual([
      ['20261112000000_concat_empty_literal', '16'],
      ['20261112000100_concat_split_literal', '16'],
      ['20261112000200_quoted_setter', '16'],
      ['20261112000300_qualified_quoted_setter', '16'],
      ['20261112000400_format_set_local', '16'],
      ['20261112000500_set_local_quoted_namespace', '16'],
      ['20261112000600_reset_quoted_namespace', '16'],
      ['20261112000700_set_spaced_namespace', '16'],
      ['20261112000800_execute_quoted_name', '16'],
      ['20261112000900_read_concat_key', '16'],
      ['20261112001000_read_dynamic_key', '16'],
      ['20261112001100_show_format', '16'],
    ]);
  });

  it('rule 16 refuses a U& Unicode escape (identifier, setter name, dynamic string) in a function body (PR11-SEC-14 a)', () => {
    const findings = lintCase('context-unicode');
    expect(byMigration(findings)).toEqual([
      ['20261112000000_unicode_ident', '16'],
      ['20261112000100_unicode_setter', '16'],
      ['20261112000200_unicode_string', '16'],
    ]);
    for (const finding of findings) expect(finding.message).toContain('Unicode-escape string or identifier');
  });
});

describe('bootstrap secret variables (PR5-SEC-12)', () => {
  it.each([['secret-variable'], ['password-literal'], ['password-other-variable']])('%s fails', (name) => {
    const findings = bootstrapCase(name);
    expect(rules(findings)).toEqual(['S']);
    expect(findings[0]?.message).not.toMatch(/alter role|select/i); // never echoes the statement (it may hold a plaintext)
  });
});

describe('the repository lanes', () => {
  it('[NT-DATA-004-b] prisma/migrations and prisma/bootstrap of this repository have no findings', () => {
    expect(lintRepository(repoRoot, '2026-11-12')).toEqual([]);
    expect(main(['--no-validate'])).toBe(0);
  });

  it('starts with an empty audit-DDL reviewer list, so audit DDL fails closed until security-analyst adds a reviewer', () => {
    expect(readReviewers(join(repoRoot, 'tools', 'db', 'audit-ddl-reviewers.json'))).toEqual([]);
  });
});
