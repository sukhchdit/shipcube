/**
 * Migration linter with negative fixtures (data-model.md §8.3; NT-DATA-004-b; NT-AVAIL-003-a (rules 2-6, 11);
 * SEC-TC-33 (rules 7-9, 12, 14); ADR-0005 am. 10 items 1 and 9 (rules 16 and 15); PR5-SEC-11/-12; TASK-003, TASK-016;
 * PR66-SEC-01/02, TASK-293: token boundaries as PostgreSQL reads them, a lone CR, rule 10 at the call site).
 * Fixtures: tools/db/fixtures/lint/{migrations,bootstrap}/<case>/. The fixture tables are classified by
 * FIXTURE_CLASSES below (the repository's own manifests stay the source for the repository run).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  COVERING_INDEX_TOLERANCE,
  DYNAMIC_SQL_ALLOW_LIST,
  RULE_17_RELEASED,
  canonicalPolicy,
  doBlockLockTimeouts,
  dynamicSqlAllowed,
  lintBootstrap,
  lintMigrations,
  lintRepository,
  loadTimeClauseProblems,
  lockTimeoutMs,
  loneCarriageReturnLines,
  main,
  parseHeader,
  readReviewers,
  routineBodyChangesData,
  routineDefinitionSha256,
  type LintFinding,
  type LockTimeoutEvent,
} from './lint-migrations.js';
import { renderRls } from './render-rls.js';
import { EscapeContinuationError, SqlLexError, normalise, tokenize, tolerantRead } from './sql-text.js';
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

  it.each([['audit-unicode-ident'], ['audit-unicode-uescape'], ['audit-unicode-dynamic'], ['audit-unicode-owner']])(
    'bootstrap lane: a U& escape counts as audit DDL and needs the marker: %s (rule 12; PR #5 R2-n1, PR #11 review n5/R2-n2)',
    (name) => {
      const findings = bootstrapCase(name);
      expect(rules(findings)).toEqual(['12']);
      expect(findings[0]?.message).toBe('audit DDL needs the header "-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>"');
    },
  );

  it('bootstrap lane: an approved U& escape passes, and the & operator or a u& inside a word is no escape (rule 12 controls)', () => {
    expect(bootstrapCase('audit-unicode-approved')).toEqual([]);
    expect(rules(bootstrapCase('audit-unicode-approved', []))).toEqual(['12']);
    expect(bootstrapCase('unicode-lookalike')).toEqual([]);
  });

  describe('the real bootstrap lane', () => {
    const bootstrapDir = join(repoRoot, 'prisma', 'bootstrap');
    const scratch = mkdtempSync(join(tmpdir(), 'lint-bootstrap-'));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));
    /** Real files without the audit marker (00-roles, 01-schemas, 02-role-backstops): the exemptions apply to them. */
    const unmarked = readdirSync(bootstrapDir).filter(
      (name) => name.endsWith('.sql') && !/^-- @audit-ddl /m.test(readFileSync(join(bootstrapDir, name), 'utf8')),
    );

    it('exempts only the tightening forms of the real 00-roles.sql and 01-schemas.sql, creation block included (rule 12 control)', () => {
      expect(unmarked).toEqual(expect.arrayContaining(['00-roles.sql', '01-schemas.sql']));
      for (const name of unmarked) copyFileSync(join(bootstrapDir, name), join(scratch, name));
      // No reviewer listed: the unmarked files lint clean only through the AUDIT_OWNER_TIGHTENING forms.
      expect(lintBootstrap(scratch, { reviewers: [], today: '2026-11-13' })).toEqual([]);
    });

    it('the approved audit files (10-audit.sql, 90-audit-ddl-guard.sql, 91-audit-actions-v2.sql) are the only rule-12 findings without a listed reviewer, and none with it (TASK-021, TASK-285)', () => {
      // 2026-11-15 = the approval date of 91-audit-actions-v2.sql (TASK-285); 10 and 90 carry 2026-11-13.
      expect(lintBootstrap(bootstrapDir, { reviewers: ['security-analyst'], today: '2026-11-15' })).toEqual([]);
      const unreviewed = lintBootstrap(bootstrapDir, { reviewers: [], today: '2026-11-15' }, 'bootstrap');
      expect(unreviewed.map((finding) => [finding.file, finding.rule])).toEqual([
        [join('bootstrap', '10-audit.sql'), '12'],
        [join('bootstrap', '90-audit-ddl-guard.sql'), '12'],
        [join('bootstrap', '91-audit-actions-v2.sql'), '12'],
      ]);
      // An approval dated after "today" is refused for each audit file: all three on 2026-11-12, only 91 on 2026-11-14.
      expect(rules(lintBootstrap(bootstrapDir, { reviewers: ['security-analyst'], today: '2026-11-12' }))).toEqual(['12', '12', '12']);
      const early = lintBootstrap(bootstrapDir, { reviewers: ['security-analyst'], today: '2026-11-14' }, 'bootstrap');
      expect(early.map((finding) => [finding.file, finding.message])).toEqual([
        [join('bootstrap', '91-audit-actions-v2.sql'), 'audit DDL approval date 2026-11-15 lies in the future'],
      ]);
    });
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

  it('[PR11-SEC-17, PR24-SEC-03] rule 11 reads DO bodies: a raised SET, EXECUTE literal, set_config or computed value fails unless a top-level RESET follows; a DO-body RESET or lower SET never clears it; LOCAL forms and mere mentions pass', () => {
    const findings = lintCase('lock-timeout-do-body');
    expect(byMigration(findings)).toEqual([
      ['20261113000000_do_set_no_reset', '11'],
      ['20261113000100_do_execute_literal', '11'],
      ['20261113000200_do_set_config', '11'],
      ['20261113000300_do_format_computed', '11'],
      ['20261113000400_do_string_body', '11'],
      // PR24-SEC-03: DO-body events only raise; the RESET or the lower SET inside the body does not count
      ['20261113000500_do_set_then_reset', '11'],
      ['20261113000800_top_raised_do_lowers', '11'],
      // PR24-SEC-03 w1-w3: a RESET in a message, a dead branch or an unused string (flagged by the base linter too)
      ['20261113001000_do_reset_in_message', '11'],
      ['20261113001100_do_reset_dead_branch', '11'],
      ['20261113001200_do_reset_unused_string', '11'],
    ]);
    for (const finding of findings) expect(finding.message).toContain('end it with "RESET lock_timeout"');
  });

  it('[PR #24 R1-n1] past the dynamic-SQL nesting bound a literal naming lock_timeout counts as a raised SET (fail closed)', () => {
    const sql =
      "DO $a$ BEGIN EXECUTE $b$ DO $c$ BEGIN EXECUTE $d$ DO $e$ BEGIN EXECUTE $f$ SET lock_timeout = '10s' $f$; END $e$ $d$; END $c$ $b$; END $a$";
    const events = doBlockLockTimeouts(sql);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.kind).toBe('set');
    expect(event?.kind === 'set' ? lockTimeoutMs(event.value) : 0).toBe(Number.POSITIVE_INFINITY);
    expect(
      doBlockLockTimeouts('DO $a$ BEGIN EXECUTE $b$ DO $c$ BEGIN EXECUTE $d$ DO $e$ BEGIN PERFORM 1; END $e$ $d$; END $c$ $b$; END $a$'),
    ).toEqual([]);
  });

  it.each<[string, LockTimeoutEvent[]]>([
    ["DO $$ BEGIN SET lock_timeout = '10s'; RESET lock_timeout; END $$", [{ kind: 'set', value: "'10s'" }, { kind: 'reset' }]],
    ["DO $$ BEGIN EXECUTE 'SET lock_timeout TO ''2s'''; END $$", [{ kind: 'set', value: "'2s'" }]],
    ["DO $q$ BEGIN EXECUTE $x$SELECT set_config('lock_timeout', '0', false)$x$; END $q$", [{ kind: 'set', value: "'0'" }]],
    ["DO $$ BEGIN PERFORM set_config('lock_timeout', v_value, false); END $$", [{ kind: 'set', value: 'v_value' }]],
    ["DO $$ BEGIN EXECUTE 'SET lock_timeout = ' || v_value; END $$", [{ kind: 'set', value: '' }]],
    ["DO $$ BEGIN SET LOCAL lock_timeout = '10s'; PERFORM set_config('lock_timeout', '10s', true); END $$", []],
    ["SELECT set_config('lock_timeout', '10s', false)", []],
    ["DO $$ BEGIN RAISE NOTICE 'the lock_timeout stays'; END $$", []],
    // Every literal is read as possible dynamic SQL (fail closed): a message that starts like a SET counts as one.
    ["DO $$ BEGIN RAISE NOTICE 'SET lock_timeout = 0'; END $$", [{ kind: 'set', value: '0' }]],
    // PR11-SEC-17 c setter-key half (TASK-024): the quoted name counts in a DO body too.
    [
      'DO $$ BEGIN SET SESSION "lock_timeout" TO \'10s\'; RESET "lock_timeout"; END $$',
      [{ kind: 'set', value: "'10s'" }, { kind: 'reset' }],
    ],
  ])('[PR11-SEC-17] doBlockLockTimeouts(%s)', (sql, expected) => {
    expect(doBlockLockTimeouts(sql)).toEqual(expected);
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

  it('[PR11-SEC-10] the rendered DR-A14 blocks (users, memberships, organisations) lint clean; an edited EXISTS atom or a deny-list status fails rule 9', () => {
    const drA14: readonly TableClassEntry[] = [
      { module: 'fixture', name: 'organisations', class: 'TENANT', policySet: 'dr-a14-organisations', definerRead: true },
      { module: 'fixture', name: 'memberships', class: 'TENANT', policySet: 'dr-a14-memberships', definerRead: true },
      { module: 'fixture', name: 'users', class: 'USER_OWNED', policySet: 'dr-a14-users', definerRead: true },
    ];
    const lintDrA14 = (name: string, edit: (sql: string) => string = (sql) => sql): LintFinding[] => {
      const dir = join(scratch, name, '20261112000000_dr_a14');
      mkdirSync(dir, { recursive: true });
      const sql = [
        '-- migration-kind: expand\n-- data-changing: no\n-- reversible: yes\n',
        'CREATE TABLE public.organisations (id uuid PRIMARY KEY, type text NOT NULL);',
        'CREATE TABLE public.memberships (id uuid PRIMARY KEY, org_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL);',
        'CREATE INDEX ix_memberships__org_id ON public.memberships (org_id);',
        'CREATE TABLE public.users (id uuid PRIMARY KEY);',
        ...drA14.map((entry) => renderRls(entry)),
      ].join('\n');
      writeFileSync(join(dir, 'migration.sql'), edit(sql));
      writeFileSync(join(dir, 'down.sql'), 'DROP TABLE IF EXISTS public.users, public.memberships, public.organisations;\n');
      return lintMigrations(join(scratch, name), name, { tableClasses: [...FIXTURE_CLASSES, ...drA14] });
    };
    expect(lintDrA14('dr-a14-clean')).toEqual([]);
    expect(
      rules(lintDrA14('dr-a14-deny-list', (sql) => sql.replace("m.status IN ('ACTIVE','SUSPENDED')", "m.status <> 'REMOVED'"))),
    ).toContain('9');
    expect(
      rules(
        lintDrA14('dr-a14-other-table', (sql) =>
          sql.replace(
            'FROM public.memberships m\n                  WHERE m.org_id',
            'FROM public.invitations m\n                  WHERE m.org_id',
          ),
        ),
      ),
    ).toEqual(['9']);
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

  it('rule 16 reads DO bodies (static, EXECUTE literal, string-quoted body, RESET); a non-app set_config in a DO body is clean (PR11-SEC-17 c)', () => {
    expect(byMigration(lintCase('context-do-body'))).toEqual([
      ['20261113000000_do_set_config', '16'],
      ['20261113000100_do_execute_set_local', '16'],
      ['20261113000200_do_string_body', '16'],
      ['20261113000300_do_reset', '16'],
    ]);
  });
});

describe('bootstrap secret variables (PR5-SEC-12)', () => {
  it.each([['secret-variable'], ['password-literal'], ['password-other-variable']])('%s fails', (name) => {
    const findings = bootstrapCase(name);
    expect(rules(findings)).toEqual(['S']);
    expect(findings[0]?.message).not.toMatch(/alter role|select/i); // never echoes the statement (it may hold a plaintext)
  });
});

describe('TASK-024 linter rules (11c, 17, 16 E-strings and dynamic SQL, 11/15 setter keys, 18/19, 9 schema, 8/14)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'lint-task024-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  /** One migration directory with `migration` and `down` as written; returns its findings as [file, rule]. */
  const scratchCase = (name: string, migration: string, down = 'SELECT 1;\n') => {
    const dir = join(scratch, name, '20261114000000_case');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'migration.sql'), `-- migration-kind: expand\n-- data-changing: no\n-- reversible: yes\n${migration}\n`);
    writeFileSync(join(dir, 'down.sql'), down);
    return lintMigrations(join(scratch, name), name, { tableClasses: FIXTURE_CLASSES }).map((finding) => [
      finding.file.split(/[\\/]/)[2],
      finding.rule,
    ]);
  };

  it('[SEC-TC-73] rule 11c: BEGIN … ROLLBACK around a RESET fails (migration.sql), START TRANSACTION … COMMIT fails (down.sql); words in bodies, CASE … END and BEGIN ATOMIC are clean', () => {
    const findings = lintCase('transaction-control');
    expect(findings.map((finding) => [finding.file.split(/[\\/]/)[1], finding.file.split(/[\\/]/)[2], finding.rule])).toEqual([
      ['20261114000000_begin_rollback', 'migration.sql', '11'],
      ['20261114000000_begin_rollback', 'migration.sql', '11'],
      ['20261114000100_down_commit', 'down.sql', '11'],
      ['20261114000100_down_commit', 'down.sql', '11'],
    ]);
    for (const finding of findings) expect(finding.message).toMatch(/^transaction control \(rule 11c\)/);
  });

  it.each([
    'BEGIN',
    'begin transaction isolation level serializable',
    'START TRANSACTION',
    'COMMIT',
    'END',
    'ROLLBACK',
    'ROLLBACK TO SAVEPOINT s',
    'ABORT',
    'SAVEPOINT s',
    'RELEASE SAVEPOINT s',
    "PREPARE TRANSACTION 'x'",
    "COMMIT PREPARED 'x'",
    "ROLLBACK PREPARED 'x'",
  ])('[SEC-TC-73] rule 11c refuses top-level %s in migration.sql and in down.sql', (statement) => {
    const name = statement.replace(/\W+/g, '-').toLowerCase();
    expect(scratchCase(`tx-${name}`, `${statement};`, `${statement};\n`)).toEqual([
      ['migration.sql', '11'],
      ['down.sql', '11'],
    ]);
  });

  it('[SEC-TC-73] rule 11c control: a file without transaction control and transaction words inside a dollar body lint clean', () => {
    expect(scratchCase('tx-clean', "DO $x$ BEGIN EXECUTE 'COMMIT'; END $x$;\nSELECT 1;")).toEqual([]);
  });

  it('[PR11-SEC-07] rule 17: DROP and ALTER TABLE … DROP COLUMN in down.sql without IF EXISTS fail; IF EXISTS forms pass (down-without-if-exists)', () => {
    const findings = lintCase('down-without-if-exists');
    expect(findings.map((finding) => [finding.file.split(/[\\/]/)[2], finding.rule])).toEqual([
      ['down.sql', '17'],
      ['down.sql', '17'],
    ]);
    expect(findings[0]?.message).toContain('drop table public.fixture_items');
    expect(findings[1]?.message).toContain('drop column remark,');
  });

  it('[PR11-SEC-16] rule 16 refuses E-strings token-level (DO body hex key, nested dynamic SQL, lowercase e in a statement); lookalikes are clean', () => {
    const findings = lintCase('context-escape-string');
    expect(byMigration(findings)).toEqual([
      ['20261114000000_do_hex_key', '16'],
      ['20261114000100_nested_dynamic', '16'],
      ['20261114000200_statement_level', '16'],
    ]);
    for (const finding of findings) expect(finding.message).toContain('E-prefixed escape string');
  });

  it('[PR24-SEC-05] bootstrap lane: an E-string (statement or dynamic SQL in a body) counts as audit DDL; lookalikes do not (rule 12)', () => {
    for (const name of ['audit-estring', 'audit-estring-dynamic']) {
      expect(bootstrapCase(name).map((finding) => finding.message)).toEqual([
        'audit DDL needs the header "-- @audit-ddl security-approved: <reviewer> <YYYY-MM-DD>"',
      ]);
    }
    expect(bootstrapCase('estring-lookalike')).toEqual([]);
  });

  it('[PR11-SEC-17] rule 11 setter keys: a quoted SET and a top-level set_config raise the value; RESET "lock_timeout" and a lower set_config clear it; set_config(…, true) is local', () => {
    const findings = lintCase('lock-timeout-setter-keys');
    expect(byMigration(findings)).toEqual([
      ['20261114000000_quoted_set_no_reset', '11'],
      ['20261114000200_set_config_no_reset', '11'],
      ['20261114000400_set_config_local', '11'],
    ]);
    expect(findings[0]?.message).toContain('end it with "RESET lock_timeout"');
    expect(findings[1]?.message).toContain('end it with "RESET lock_timeout"');
    expect(findings[2]?.message).toContain('"SET LOCAL lock_timeout" does not count');
  });

  it("[PR11-SEC-15] rule 15: set_config('role' | 'session_authorization', …) fails at top level, in a DO body, in dynamic SQL and quoted; other keys are clean", () => {
    const findings = lintCase('set-config-role');
    expect(byMigration(findings)).toEqual([
      ['20261114000000_top_role', '15'],
      ['20261114000100_do_session_authorization', '15'],
      ['20261114000200_dynamic_role', '15'],
      // The doubled-quote key in dynamic SQL and the quoted key are computed keys for rule 16 as well.
      ['20261114000200_dynamic_role', '16'],
      ['20261114000300_quoted_setter', '15'],
      ['20261114000300_quoted_setter', '16'],
    ]);
    for (const finding of findings.filter((entry) => entry.rule === '15')) expect(finding.message).toMatch(/^set_config\('role'/);
  });

  it('[D-ARCH-077] rules 18 (F-04) and 19 (F-11): DROP INDEX of the covering index without INCLUDE, of a partial index without WHERE or with another WHERE fails; INCLUDE and the same WHERE pass', () => {
    // Rule 5 fires on every same-file re-create of an existing table's index (non-concurrent build).
    const findings = lintCase('drop-index-guarded');
    expect(byMigration(findings)).toEqual([
      ['20261114000100_covering_plain', '18'],
      ['20261114000100_covering_plain', '5'],
      ['20261114000200_covering_include', '5'],
      ['20261114000300_partial_same_where', '5'],
      ['20261114000400_partial_changed', '19'],
      ['20261114000400_partial_changed', '5'],
      ['20261114000500_partial_plain', '19'],
      ['20261114000500_partial_plain', '5'],
    ]);
    expect(findings.find((finding) => finding.file.includes('partial_changed') && finding.rule === '19')?.message).toMatch(
      /^partial-index predicate changed: review required/,
    );
    expect(COVERING_INDEX_TOLERANCE).toEqual(['ix_role_permissions__role_id', 'ix_memberships__user_status']);
  });

  it('[D-ARCH-077] COVERING_INDEX_TOLERANCE lists every INCLUDE index of prisma/migrations', () => {
    const migrationsDir = join(repoRoot, 'prisma', 'migrations');
    const covering = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => [
        ...readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8').matchAll(
          /CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?"?([a-z0-9_]+)"?[^;]*\bINCLUDE\b/gi,
        ),
      ])
      .map((match) => match[1]);
    expect(COVERING_INDEX_TOLERANCE).toEqual(expect.arrayContaining(covering));
  });

  it('[PR11-SEC-11] rule 9: CREATE TABLE outside public fails ("tables live in public only"); an unqualified table is public', () => {
    const findings = lintCase('table-schema-scope');
    expect(byMigration(findings)).toEqual([['20261114000000_platform_table', '9']]);
    expect(findings[0]?.message).toMatch(/^tables live in public only; platform holds no table/);
  });

  it('[PR11-SEC-15] rules 8 and 14: MAINTAIN to platform_app, GRANT/REVOKE ON SCHEMA, CREATE OPERATOR [CLASS], CREATE RULE fail; ALL TABLES IN SCHEMA is clean', () => {
    expect(byMigration(lintCase('refused-objects'))).toEqual([
      ['20261114000000_grant_maintain', '8'],
      ['20261114000100_grant_on_schema', '14'],
      ['20261114000200_revoke_on_schema', '14'],
      ['20261114000300_create_operator', '14'],
      ['20261114000400_create_operator_class', '14'],
      ['20261114000500_create_rule', '14'],
      ['20261114000700_create_cast', '14'],
      ['20261114000800_create_aggregate', '14'],
      ['20261114000900_create_range_type', '14'],
    ]);
  });

  it('[D-ARCH-172] rule 14: CREATE CAST and CREATE [OR REPLACE] AGGREGATE are refused outright, with the message naming them', () => {
    const findings = lintCase('refused-objects').filter((finding) => /create_(?:cast|aggregate)/.test(finding.file));
    expect(findings).toHaveLength(2);
    for (const finding of findings) expect(finding.message).toMatch(/CREATE CAST and CREATE AGGREGATE are refused in prisma\/migrations/);
  });

  it('[D-ARCH-237] [PR034-SEC-05] rule 14: CREATE TYPE … AS RANGE is refused outright (its subtype_diff is called without being named), with the message naming it; a plain CREATE TYPE is not', () => {
    const findings = lintCase('refused-objects').filter((finding) => /create_range_type/.test(finding.file));
    expect(findings.map((finding) => finding.rule)).toEqual(['14']);
    expect(findings[0]?.message).toMatch(
      /CREATE TYPE … AS RANGE, CREATE CAST and CREATE AGGREGATE are refused in prisma\/migrations .*D-ARCH-237/,
    );
    expect(findings[0]?.message).toContain('"create type public.fixture_span as range (subtype = integer)"');
  });

  it('[D-ARCH-236] [PR034-SEC-01] rule 21: a migration routine in a table CHECK, the P1b NOT VALID + VALIDATE shape, a domain CHECK, a STORED generated column and a partition key; query_to_xml in a CHECK; a platform routine no migration creates; built-in CHECKs, DEFAULT platform.app_org_id() and a policy WITH CHECK stay clean (load-time-code)', () => {
    const findings = lintCase('load-time-code');
    expect(byMigration(findings)).toEqual([
      ['20261121000000_check_in_create_table', '21'],
      ['20261121000100_check_added_not_valid', '21'],
      ['20261121000200_domain_check', '21'],
      ['20261121000300_generated_column', '21'],
      ['20261121000400_partition_key', '21'],
      ['20261121000500_query_to_xml', '21'],
      ['20261121000600_platform_routine', '21'],
      // Control: the policy is no load-time clause; rule 9 refuses it as a policy the renderer does not emit.
      ['20261121000800_policy_with_check', '9'],
    ]);
    const PREFIX = '^load-time expression: the ';
    const SUFFIX =
      '; a restore evaluates it as the loading superuser, so it may call IMMUTABLE pg_catalog routines only \\(PR034-SEC-01, D-ARCH-236\\): "';
    const OWN = 'calls public\\.fixture_check, a routine of this or an earlier migration';
    expect(findings.filter((finding) => finding.rule === '21').map((finding) => finding.message)).toEqual([
      expect.stringMatching(new RegExp(`${PREFIX}CHECK clause ${OWN}${SUFFIX}create table public\\.fixture_items \\(id integer`)),
      expect.stringMatching(new RegExp(`${PREFIX}CHECK clause ${OWN}${SUFFIX}alter table public\\.fixture_items add constraint`)),
      expect.stringMatching(new RegExp(`${PREFIX}CHECK clause ${OWN}${SUFFIX}create domain`)),
      expect.stringMatching(new RegExp(`${PREFIX}GENERATED ALWAYS AS clause ${OWN}${SUFFIX}`)),
      expect.stringMatching(new RegExp(`${PREFIX}PARTITION BY LIST clause ${OWN}${SUFFIX}`)),
      expect.stringMatching(new RegExp(`${PREFIX}CHECK clause calls query_to_xml, a built-in that runs a query string${SUFFIX}`)),
      expect.stringMatching(new RegExp(`${PREFIX}CHECK clause calls platform\\.fixture_unknown, a routine outside pg_catalog${SUFFIX}`)),
    ]);
  });

  it('[PR11-SEC-14] rule 16: EXECUTE in a function or procedure body off DYNAMIC_SQL_ALLOW_LIST fails; EXECUTE FUNCTION, GRANT/REVOKE EXECUTE, the word in a message and DO bodies are clean', () => {
    const findings = lintCase('dynamic-sql-function');
    expect(byMigration(findings)).toEqual([
      ['20261114000000_execute_in_function', '16'],
      ['20261114000100_execute_in_procedure', '16'],
    ]);
    expect(findings[0]?.message).toContain('public.fixture_dynamic, which is not on DYNAMIC_SQL_ALLOW_LIST');
    expect(DYNAMIC_SQL_ALLOW_LIST).toEqual([]);
  });

  /** `[migration, file, rule]` per finding. */
  const byFile = (findings: LintFinding[]) =>
    findings.map((finding) => [finding.file.split(/[\\/]/)[1], finding.file.split(/[\\/]/)[2], finding.rule]);

  it('[PR43-SEC-03] a begin parameter, RETURNS TABLE column or function name, a later END; and RETURN CASE swallow nothing; BEGIN ATOMIC with CASE stays one statement; an open block is rule L in both files (transaction-control-begin)', () => {
    const findings = lintCase('transaction-control-begin');
    expect(byFile(findings)).toEqual([
      ['20261114000000_begin_param', 'migration.sql', '11'],
      ['20261114000000_begin_param', 'migration.sql', '11'],
      ['20261114000000_begin_param', 'migration.sql', '8'],
      ['20261114000000_begin_param', 'migration.sql', '14'],
      ['20261114000100_returns_table_begin', 'migration.sql', '2'],
      ['20261114000200_function_named_begin', 'migration.sql', '11'],
      ['20261114000200_function_named_begin', 'down.sql', '17'],
      ['20261114000200_function_named_begin', 'down.sql', '11'],
      ['20261114000300_end_resync', 'migration.sql', '11'],
      ['20261114000300_end_resync', 'migration.sql', '8'],
      ['20261114000300_end_resync', 'migration.sql', '14'],
      ['20261114000400_return_case', 'migration.sql', '14'],
      // Control: the BEGIN ATOMIC body's END is no statement of its own (no 11c), and the CREATE SCHEMA after it splits.
      ['20261114000500_atomic_case_control', 'migration.sql', '14'],
      ['20261114000600_unbalanced_atomic', 'migration.sql', 'L'],
      ['20261114000600_unbalanced_atomic', 'down.sql', 'L'],
    ]);
    for (const finding of findings.filter((entry) => entry.rule === 'L')) expect(finding.message).toMatch(/unbalanced BEGIN ATOMIC block/);
  });

  it('[PR43-SEC-03] rule L: a bootstrap file that ends inside a BEGIN ATOMIC block, and migration files that do not lex, are findings, never a crash', () => {
    expect(bootstrapCase('unbalanced-atomic').map((finding) => [finding.rule, finding.message.slice(0, 64)])).toEqual([
      ['L', 'the file does not split into statements (unbalanced BEGIN ATOMIC'],
    ]);
    expect(scratchCase('lex-unterminated', "SELECT 'open;", 'DROP TABLE x /* open\n')).toEqual([
      ['migration.sql', 'L'],
      ['down.sql', 'L'],
    ]);
  });

  it('[PR43-SEC-11] labels case / end and the alias begin atomic inside a BEGIN ATOMIC body, the parenthesised labels and the paren gate hide nothing: every hostile statement after the routine is reported; text after a body END and a body semicolon in parentheses are rule L (atomic-body-labels)', () => {
    const findings = lintCase('atomic-body-labels');
    const RULE_11C = /^transaction control \(rule 11c\)/;
    const GRANT = /^TRUNCATE, TRIGGER or REFERENCES to platform_app/;
    const DROP = /^destructive statement outside a contract migration: "drop table public\.fixture_items"/;
    const LOCK = /^the file leaves lock_timeout above the migrator role default/;
    const expected: [string, string, RegExp][] = [
      ['20261117000000_as_case_label', '11', RULE_11C],
      ['20261117000000_as_case_label', '8', GRANT],
      ['20261117000100_attr_case', '2', DROP],
      ['20261117000100_attr_case', '11', RULE_11C],
      ['20261117000200_bare_case_label', '11', RULE_11C],
      ['20261117000200_bare_case_label', '11', LOCK],
      ['20261117000300_begin_atomic_alias', '11', RULE_11C],
      ['20261117000300_begin_atomic_alias', '8', GRANT],
      ['20261117000400_parenthesised_labels', '2', DROP],
      ['20261117000400_parenthesised_labels', '11', RULE_11C],
      ['20261117000500_begin_atomic_param', '11', RULE_11C],
      ['20261117000500_begin_atomic_param', '8', GRANT],
      // Control: AS end and a bare end stay inside the routine (no spurious 11c for a stray END), the schema splits.
      ['20261117000600_end_labels_control', '14', /"create schema fixture_after_end_labels"/],
      ['20261117000700_end_not_last', 'L', /the END of a routine body must end the routine statement/],
      ['20261117000800_paren_semicolon', 'L', /unbalanced parentheses in a BEGIN ATOMIC body statement/],
    ];
    expect(byFile(findings)).toEqual(expected.map(([migration, rule]) => [migration, 'migration.sql', rule]));
    findings.forEach((finding, index) => expect(finding.message).toMatch((expected[index] as [string, string, RegExp])[2]));
  });

  it('[PR #43 R1-m1] rule 11: a top-level setter in a materialized CTE or in VALUES raises lock_timeout; a later RESET clears it (lock-timeout-setter-cte-values)', () => {
    expect(byMigration(lintCase('lock-timeout-setter-cte-values'))).toEqual([
      ['20261114000000_with_materialized', '11'],
      ['20261114000100_values', '11'],
    ]);
  });

  it('[PR #43 R1-m2] rule 16: EXECUTE of a variable named function or procedure, and EXECUTE in an AS string body, fail (dynamic-sql-variable-name)', () => {
    expect(byMigration(lintCase('dynamic-sql-variable-name'))).toEqual([
      ['20261114000000_execute_function_var', '16'],
      ['20261114000100_execute_procedure_var', '16'],
      ['20261114000200_execute_string_body', '16'],
    ]);
  });

  it('[PR43-SEC-06 b] rule 16: query_to_xml, query_to_xmlschema, query_to_xml_and_xmlschema, ts_stat and ts_rewrite in PL/pgSQL, SQL dollar, RETURN, BEGIN ATOMIC and string bodies fail; a DO block is handled as for EXECUTE (dynamic-sql-query-functions)', () => {
    expect(byMigration(lintCase('dynamic-sql-query-functions'))).toEqual([
      ['20261114000000_query_to_xml_plpgsql', '16'],
      ['20261114000100_ts_stat_sql_body', '16'],
      ['20261114000200_query_to_xmlschema_return', '16'],
      ['20261114000300_query_to_xml_and_xmlschema_atomic', '16'],
      ['20261114000400_ts_rewrite_string_body', '16'],
    ]);
  });

  it('[PR43-SEC-06 d] DYNAMIC_SQL_ALLOW_LIST matches the qualified name AND the definition digest; the name alone is not enough', () => {
    const definition = "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'SELECT 1'; END $$";
    const list = [{ name: 'public.f', definitionSha256: routineDefinitionSha256(definition) }];
    expect(dynamicSqlAllowed('public.f', definition, list)).toBe(true);
    expect(dynamicSqlAllowed('public.f', definition.replaceAll(' ', '\n  '), list)).toBe(true); // whitespace only
    expect(dynamicSqlAllowed('public.f', definition.replace('SELECT 1', 'SELECT 2'), list)).toBe(false);
    expect(dynamicSqlAllowed('public.f', definition.replace('LANGUAGE', 'SECURITY DEFINER LANGUAGE'), list)).toBe(false);
    expect(dynamicSqlAllowed('public.g', definition, list)).toBe(false);
    expect(dynamicSqlAllowed('public.f', definition)).toBe(false); // the shipped list is empty
    expect(routineDefinitionSha256(definition)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[PR43-SEC-05 a] rule 7: ENABLE REPLICA | ALWAYS TRIGGER | RULE fail; a plain ENABLE TRIGGER is clean (trigger-replica-mode)', () => {
    const findings = lintCase('trigger-replica-mode');
    expect(byMigration(findings)).toEqual([
      ['20261114000000_replica_trigger', '7'],
      ['20261114001000_always_trigger', '7'],
      ['20261114002000_replica_rule', '7'],
      ['20261114003000_always_rule', '7'],
    ]);
  });

  it('[PR43-SEC-06 a] rule 20: standard_conforming_strings / backslash_quote in SET, SET LOCAL … TO, SET SESSION "…", the setter function, a routine SET clause, ALTER FUNCTION … SET and DO dynamic SQL fail in prisma/migrations (escape-setting)', () => {
    const findings = lintCase('escape-setting');
    expect(byMigration(findings)).toEqual([
      ['20261114000000_set_off', '20'],
      ['20261114000100_set_local_to', '20'],
      ['20261114000200_session_quoted', '20'],
      ['20261114000300_set_config', '20'],
      ['20261114000400_routine_set', '20'],
      ['20261114000500_alter_function_set', '20'],
      ['20261114000600_do_dynamic', '20'],
    ]);
  });

  it('[PR43-SEC-06 a] rule 20 in the bootstrap lane: SET … = off and the setter function fail, without a statement preview (escape-setting)', () => {
    const findings = bootstrapCase('escape-setting');
    expect(findings.map((finding) => [finding.file, finding.rule])).toEqual([
      [join('escape-setting', '00-roles.sql'), '20'],
      [join('escape-setting', '10-set-config.sql'), '20'],
    ]);
    expect(findings.map((finding) => finding.message.slice(-11))).toEqual(['statement 2', 'statement 2']);
  });
});

describe('TASK-293: token boundaries as PostgreSQL reads them (PR66-SEC-01) and rule 10 at the call site (PR66-SEC-02)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'lint-task293-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  /**
   * Migration directories written at run time (a lone CR and the non-ASCII shapes are not committed as fixtures: the
   * point is that they are invisible in review). One directory per entry, in order; returns [index, file, rule, message].
   */
  const lintTexts = (name: string, migrations: readonly string[], dataChanging: 'yes' | 'no' = 'no', down = 'SELECT 1;\n') => {
    migrations.forEach((migration, index) => {
      const dir = join(scratch, name, `2026111900000${String(index)}_case`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'migration.sql'),
        `-- migration-kind: expand\n-- data-changing: ${dataChanging}\n-- reversible: yes\n${migration}\n`,
      );
      writeFileSync(join(dir, 'down.sql'), down);
    });
    return lintMigrations(join(scratch, name), name, { tableClasses: FIXTURE_CLASSES }).map((finding) => {
      const [, directory, file] = finding.file.split(/[\\/]/);
      return [Number((directory ?? '').slice(13, 14)), file, finding.rule, finding.message] as const;
    });
  };
  const ruleOf = (findings: readonly (readonly [number, string | undefined, string, string])[]) =>
    findings.map(([index, file, rule]) => [index, file, rule]);
  const GRANT = 'GRANT TRUNCATE ON public.fixture_items TO platform_app;';
  const LONE_CR = /^a lone CR \(not followed by LF\) on line\(s\) \d+/;

  it('[PR66-SEC-01] control: the GRANT alone is rule 8', () => {
    expect(ruleOf(lintTexts('control', [GRANT]))).toEqual([[0, 'migration.sql', '8']]);
  });

  it('[PR66-SEC-01 a] a lone CR ends a -- comment: the GRANT after it is rule 8, and the CR itself is rule L', () => {
    const findings = lintTexts('cr-comment', [`SELECT 1; -- note\r${GRANT}\nSELECT 2;`]);
    expect(ruleOf(findings)).toEqual([
      [0, 'migration.sql', 'L'],
      [0, 'migration.sql', '8'],
    ]);
    expect(findings[0]?.[3]).toMatch(LONE_CR);
  });

  it('[PR66-SEC-01 a] a lone CR before the END of a routine body closes it there: the GRANT between two routines is rule 8', () => {
    const routine = (name: string) => `CREATE FUNCTION public.${name}() RETURNS integer LANGUAGE sql BEGIN ATOMIC SELECT 1;`;
    expect(ruleOf(lintTexts('cr-body', [`${routine('f')} --\rEND; ${GRANT} ${routine('g')}\nEND;`]))).toEqual([
      [0, 'migration.sql', 'L'],
      [0, 'migration.sql', '8'],
    ]);
  });

  it('[PR66-SEC-01 b] a $tag$ after a non-ASCII identifier character is part of the identifier: the GRANT between two such labels is rule 8', () => {
    expect(ruleOf(lintTexts('ident-dollar', [`SELECT 1 AS é$a$; ${GRANT} SELECT 2 AS ä$a$;`]))).toEqual([[0, 'migration.sql', '8']]);
    expect(ruleOf(lintTexts('nbsp-dollar', [`SELECT 1 AS \u00a0$q$; ${GRANT} SELECT 2 AS \u00a0$q$;`]))).toEqual([
      [0, 'migration.sql', '8'],
    ]);
  });

  it('[PR66-SEC-01 c] a non-ASCII dollar tag quotes a fake RESET ROLE: rule 15 still fires (the file ends inside SET ROLE); a real RESET ROLE is clean', () => {
    const definer =
      'SET ROLE platform_definer;\nCREATE FUNCTION platform.fixture_job() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;\n';
    const faked = lintTexts('tag-reset-role', [`${definer}SELECT $é$; RESET ROLE; $é$;`]);
    expect(ruleOf(faked)).toEqual([[0, 'migration.sql', '15']]);
    expect(faked[0]?.[3]).toMatch(/^the file ends with a SET ROLE still in effect/);
    expect(lintTexts('tag-reset-role-control', [`${definer}RESET ROLE;`])).toEqual([]);
  });

  it('[PR66-SEC-01 c] a non-ASCII dollar tag quotes a fake ENABLE + FORCE: rule 9 still fires for the TENANT table; the real statements are clean', () => {
    const table = 'CREATE TABLE public.fixture_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);\n';
    const rls = 'ALTER TABLE public.fixture_orders ENABLE ROW LEVEL SECURITY; ALTER TABLE public.fixture_orders FORCE ROW LEVEL SECURITY;';
    const faked = lintTexts('tag-rls', [`${table}SELECT $é$; ${rls} $é$;`]);
    expect(ruleOf(faked)).toEqual([[0, 'migration.sql', '9']]);
    expect(faked[0]?.[3]).toMatch(/^TENANT table "fixture_orders" needs ENABLE and FORCE ROW LEVEL SECURITY/);
    expect(lintTexts('tag-rls-control', [`${table}${rls}`])).toEqual([]);
  });

  it('[PR66-SEC-01] rule L for a lone CR: in down.sql and in a bootstrap file too; CRLF line ends are not refused; loneCarriageReturnLines counts LF-delimited lines', () => {
    expect(ruleOf(lintTexts('cr-down', ['SELECT 1;'], 'no', 'SELECT 1;\r-- x\n'))).toEqual([[0, 'down.sql', 'L']]);
    expect(lintTexts('crlf', ['SELECT 1; -- note\r\nSELECT 2;\r\n'], 'no', 'SELECT 1;\r\n')).toEqual([]);
    const bootstrap = join(scratch, 'bootstrap-cr');
    mkdirSync(bootstrap, { recursive: true });
    writeFileSync(join(bootstrap, '00-x.sql'), 'SET search_path = pg_catalog, pg_temp;\n-- c\rSELECT 1;\n');
    const findings = lintBootstrap(bootstrap, { reviewers: [], today: '2026-11-19' }, 'bootstrap-cr');
    expect(findings.map((finding) => finding.rule)).toEqual(['L']);
    expect(findings[0]?.message).toMatch(/^a lone CR \(not followed by LF\) on line\(s\) 2:/);
    expect(loneCarriageReturnLines('a\rb\nc\r\nd\re\n\r')).toEqual([1, 3, 4]);
    expect(loneCarriageReturnLines('a\r\nb\n')).toEqual([]);
  });

  const WRITER = 'CREATE FUNCTION public.fixture_purge() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;';
  const CALL_RULE_10 =
    /^call of public\.fixture_purge, a routine of this or an earlier migration whose body changes data, without "data-changing: yes" \(PR66-SEC-02\)/;

  it('[PR66-SEC-02] rule 10 at the call site: a routine created in the file whose BEGIN ATOMIC body deletes, then called, is data-changing', () => {
    const findings = lintTexts('call-atomic', [`${WRITER}\nSELECT public.fixture_purge();`]);
    expect(ruleOf(findings)).toEqual([[0, 'migration.sql', '10']]);
    expect(findings[0]?.[3]).toMatch(CALL_RULE_10);
    // Controls: the definition alone, and the call under "data-changing: yes", are clean.
    expect(lintTexts('call-atomic-definition-only', [WRITER])).toEqual([]);
    expect(lintTexts('call-atomic-declared', [`${WRITER}\nSELECT public.fixture_purge();`], 'yes')).toEqual([]);
  });

  it.each([
    [
      'a PL/pgSQL dollar body (UPDATE) called with SELECT',
      "CREATE FUNCTION public.fixture_touch() RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE public.fixture_items SET note = 'x'; END $$;\nSELECT fixture_touch();",
    ],
    [
      'an SQL string body (DELETE) called unqualified',
      "CREATE FUNCTION public.fixture_wipe() RETURNS void LANGUAGE sql AS 'DELETE FROM public.fixture_items';\nSELECT fixture_wipe();",
    ],
    [
      'an SQL string body (MERGE) called with a quoted name',
      'CREATE FUNCTION public.fixture_merge() RETURNS void LANGUAGE sql AS \'MERGE INTO public.fixture_items t USING public.fixture_owners o ON t.id = o.id WHEN MATCHED THEN DELETE\';\nSELECT "public"."fixture_merge"();',
    ],
    [
      'a procedure (TRUNCATE in a dollar body) called with CALL',
      'CREATE PROCEDURE public.fixture_reset() LANGUAGE sql AS $$ TRUNCATE public.fixture_items $$;\nCALL public.fixture_reset();',
    ],
    ['a DO block that PERFORMs the writer', `${WRITER}\nDO $$ BEGIN PERFORM public.fixture_purge(); END $$;`],
    [
      'a routine that calls the writer, called (transitive)',
      `${WRITER}\nCREATE FUNCTION public.fixture_outer() RETURNS void LANGUAGE sql BEGIN ATOMIC SELECT public.fixture_purge(); END;\nSELECT public.fixture_outer();`,
    ],
    ['a call inside a CTE', `${WRITER}\nWITH x AS (SELECT public.fixture_purge()) SELECT 1 FROM x;`],
    [
      'an INSERT … SELECT body',
      'CREATE FUNCTION public.fixture_copy() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.fixture_items SELECT * FROM public.fixture_owners $$;\nSELECT public.fixture_copy();',
    ],
    [
      'an upsert body (ON CONFLICT … DO UPDATE)',
      "CREATE FUNCTION public.fixture_upsert() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.fixture_items (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET note = 'x' $$;\nSELECT public.fixture_upsert();",
    ],
    [
      'a data-modifying WITH body',
      'CREATE FUNCTION public.fixture_cte() RETURNS bigint LANGUAGE sql AS $$ WITH d AS (DELETE FROM public.fixture_items RETURNING 1) SELECT count(*) FROM d $$;\nSELECT public.fixture_cte();',
    ],
  ])('[PR66-SEC-02] rule 10 at the call site: %s', (_shape, migration) => {
    expect(ruleOf(lintTexts(`call-${_shape.replace(/\W+/g, '-')}`, [migration]))).toEqual([[0, 'migration.sql', '10']]);
  });

  it('[PR66-SEC-02] rule 10 at the call site across files: a writer created in an earlier migration and called in a later one', () => {
    expect(ruleOf(lintTexts('call-cross-file', [WRITER, 'SELECT public.fixture_purge();']))).toEqual([[1, 'migration.sql', '10']]);
  });

  it.each([['"f("'], ['"g["'], ['"h)"'], ['"a*b+?"'], ['"x\\y{1}"'], ['"p|q^$"'], ['"say ""hi"""']])(
    '[TASK-293 R1-m1] a writing routine named %s (regular-expression metacharacters, a quote) is a finding at its call, never a crash; the next file still lints',
    (quoted) => {
      const writer = `CREATE FUNCTION public.${quoted}() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;`;
      const findings = lintTexts(`call-meta-${quoted.replace(/\W+/g, '-')}`, [`${writer}\nSELECT public.${quoted}();`, 'SELECT 1;']);
      expect(ruleOf(findings)).toEqual([[0, 'migration.sql', '10']]);
      expect(findings[0]?.[3]).toContain(`call of public.${quoted.slice(1, -1).replaceAll('""', '"')}, a routine`);
    },
  );

  it('[TASK-293 R1-m2] transitivity does not depend on order: a routine calling a writer created later in the file, or in a later file, is a writer at its call', () => {
    const caller =
      'CREATE FUNCTION public.fixture_caller() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM public.fixture_purge(); END $$;';
    expect(ruleOf(lintTexts('call-forward', [`${caller}\n${WRITER}\nSELECT public.fixture_caller();`]))).toEqual([
      [0, 'migration.sql', '10'],
    ]);
    // A call judged between the two definitions (no writer yet) does not freeze the answer for the later call.
    const between = lintTexts('call-forward-between', [
      `${caller}\nSELECT public.fixture_caller();\n${WRITER}\nSELECT public.fixture_caller();`,
    ]);
    expect(ruleOf(between)).toEqual([[0, 'migration.sql', '10']]);
    expect(between[0]?.[3]).toMatch(/^call of public\.fixture_caller, /);
    expect(ruleOf(lintTexts('call-forward-files', [caller, `${WRITER}\nSELECT public.fixture_caller();`]))).toEqual([
      [1, 'migration.sql', '10'],
    ]);
    // Control: the same caller without any writer behind it is clean.
    expect(lintTexts('call-forward-control', [`${caller}\nSELECT public.fixture_caller();`])).toEqual([]);
  });

  it('[TASK-293 R1-n1] names: a writer created unqualified matches a call in any schema, and a quoted name keeps its spaces', () => {
    const unqualified = 'CREATE FUNCTION fixture_unq() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;';
    expect(ruleOf(lintTexts('call-unqualified', [`${unqualified}\nSELECT platform.fixture_unq();`]))).toEqual([[0, 'migration.sql', '10']]);
    const spaced = 'CREATE FUNCTION public."my purge"() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;';
    expect(ruleOf(lintTexts('call-spaced', [`${spaced}\nSELECT public."my purge"();`]))).toEqual([[0, 'migration.sql', '10']]);
    expect(lintTexts('call-spaced-control', [`${spaced}\nSELECT public."my purge 2"();`])).toEqual([]);
  });

  it('[TASK-293 R1-n3] rule 10 body forms are matched in linear time: a 60 KB routine body and DO block without a semicolon lint in well under a second each', () => {
    const body = ' insert into public.fixture_items on conflict'.repeat(2000);
    const started = performance.now();
    const findings = lintTexts('call-redos', [
      `CREATE FUNCTION public.fixture_slow() RETURNS void LANGUAGE sql AS $$${body} $$;`,
      `DO $$ BEGIN IF true THEN ${body} END IF; END $$;`,
    ]);
    // Generous bound against host load: the replaced pattern needed about 21 s for the routine body alone.
    expect(performance.now() - started).toBeLessThan(5000);
    expect(findings).toEqual([]); // no SELECT and no DO UPDATE after the INSERT: not data-changing
  });

  it('[PR293-SEC-02] bootstrap lane: an approved audit-DDL file whose E-string is continued on a new line is rule L, so a statement it hides is never linted as string text', () => {
    const bootstrap = join(scratch, 'bootstrap-econt');
    mkdirSync(bootstrap, { recursive: true });
    writeFileSync(
      join(bootstrap, '10-x.sql'),
      "-- @audit-ddl security-approved: security-analyst 2026-11-13\nSET search_path = pg_catalog, pg_temp;\nSELECT E'x'\n'a\\'' ; CREATE FUNCTION public.h() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$ ; SELECT 1 AS \"q\" -- '\n;\n",
    );
    const findings = lintBootstrap(bootstrap, { reviewers: ['security-analyst'], today: '2026-11-19' }, 'bootstrap-econt');
    expect(findings.map((finding) => finding.rule)).toEqual(['L']);
    expect(findings[0]?.message).toMatch(/an E-string continued on a new line is refused \(PR293-SEC-02\)/);
  });

  /** An EXECUTE of a hex-obfuscated set_config('app.org_id', …) as an E-string continued on a new line (R3-M1 probe). */
  const CONTINUED_EXECUTE = "EXECUTE E'SELECT s\\x65t_config(\\x27\\x61pp.org_id\\x27, \\x27x\\x27, true)'\n'';";

  it('[TASK-293 R3-M1] rule 16: a DO block whose body holds a continued E-string is refused as an E-string, as the uncontinued control is', () => {
    const findings = lintTexts('r3m1-do', [`DO $$ BEGIN ${CONTINUED_EXECUTE} END $$;`]);
    expect(ruleOf(findings)).toEqual([[0, 'migration.sql', '16']]);
    expect(findings[0]?.[3]).toMatch(/E-prefixed escape string/);
    const control = lintTexts('r3m1-do-control', [`DO $$ BEGIN ${CONTINUED_EXECUTE.replace("'\n'';", "';")} END $$;`]);
    expect(ruleOf(control)).toEqual([[0, 'migration.sql', '16']]);
  });

  it('[TASK-293 R3-M1] rule 16: a PL/pgSQL routine body holding a continued E-string is refused as an E-string (rule 16 reports one finding per statement, the context write first; without the mark only the dynamic-SQL finding would remain)', () => {
    const findings = lintTexts('r3m1-fn', [
      `CREATE FUNCTION public.fixture_cont() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ${CONTINUED_EXECUTE} END $$;`,
    ]);
    expect(ruleOf(findings)).toEqual([[0, 'migration.sql', '16']]);
    expect(findings[0]?.[3]).toMatch(/^writes the tenant request context in SQL \(E-prefixed escape string\)/);
  });

  it('[PR293-SEC-01] rule 10 body forms scale linearly: time(4n) / time(n) < 8 on an adversarial body with every statement start', () => {
    const body = (n: number) => `as${' in insert into t on conflict open c for'.repeat(n)}`;
    const fastest = (text: string) =>
      Math.min(
        ...[0, 1, 2].map(() => {
          const started = performance.now();
          expect(routineBodyChangesData(text)).toBe(false);
          return performance.now() - started;
        }),
      );
    const small = fastest(body(20_000));
    const large = fastest(body(80_000));
    expect(large / Math.max(small, 1)).toBeLessThan(8);
  });

  const DO = (body: string) => `DO $$ DECLARE r record; c refcursor; BEGIN ${body} END $$;`;

  it.each([
    [
      'ALTER FUNCTION … SET SCHEMA, then a call in the new schema (row 1)',
      `${WRITER}\nALTER FUNCTION public.fixture_purge() SET SCHEMA platform;\nSELECT platform.fixture_purge();`,
      /^call of platform\.fixture_purge, /,
    ],
    [
      'ALTER FUNCTION … RENAME TO, then a call under the new name',
      `${WRITER}\nALTER FUNCTION public.fixture_purge() RENAME TO fixture_erase;\nSELECT public.fixture_erase();`,
      /^call of public\.fixture_erase, /,
    ],
    [
      'a routine body FOR r IN DELETE … RETURNING (row 2)',
      'CREATE FUNCTION public.fixture_loop() RETURNS void LANGUAGE plpgsql AS $$ DECLARE r record; BEGIN FOR r IN DELETE FROM public.fixture_items RETURNING id LOOP NULL; END LOOP; END $$;\nSELECT public.fixture_loop();',
      /^call of public\.fixture_loop, /,
    ],
    [
      'a DO FOR r IN DELETE … RETURNING (row 7)',
      DO('FOR r IN DELETE FROM public.fixture_items RETURNING id LOOP NULL; END LOOP;'),
      /^data-changing statement/,
    ],
    [
      'a DO FOR r IN UPDATE … RETURNING (row 7)',
      DO("FOR r IN UPDATE public.fixture_items SET note = 'x' RETURNING id LOOP NULL; END LOOP;"),
      /^data-changing statement/,
    ],
    [
      'a DO OPEN c FOR DELETE … RETURNING (row 8)',
      DO('OPEN c FOR DELETE FROM public.fixture_items RETURNING id;'),
      /^data-changing statement/,
    ],
    [
      'a DO OPEN c NO SCROLL FOR UPDATE … RETURNING (row 8)',
      DO("OPEN c NO SCROLL FOR UPDATE public.fixture_items SET note = 'x' RETURNING id;"),
      /^data-changing statement/,
    ],
    [
      "a DO WITH x AS (SELECT ';') DELETE (row 9)",
      DO("WITH x AS (SELECT ';') DELETE FROM public.fixture_items;"),
      /^data-changing statement/,
    ],
    [
      "a DO INSERT … VALUES (1, ';') ON CONFLICT … DO UPDATE (row 10)",
      DO("INSERT INTO public.fixture_items (id, note) VALUES (1, ';') ON CONFLICT (id) DO UPDATE SET note = 'y';"),
      /^data-changing statement/,
    ],
    [
      'a DO UPDATE of an unqualified quoted name holding ; (row 11, the regression of the round-1 segment split)',
      DO('UPDATE "fixture;items" SET note = \'x\';'),
      /^data-changing statement/,
    ],
    [
      "a DO EXECUTE of a string holding ';' before DELETE",
      DO("EXECUTE 'SELECT 1; DELETE FROM public.fixture_items';"),
      /^data-changing statement/,
    ],
    [
      'a non-ASCII routine name (row 6, code review R2-n1)',
      'CREATE FUNCTION public.purgé() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;\nSELECT public.purgé();',
      /^call of public\.purgé, /,
    ],
    [
      'a writing definition whose name the linter cannot read (three-part name; fail closed)',
      'CREATE FUNCTION mydb.public.fixture_three() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;',
      /^a routine whose body changes data, with a name the linter cannot read/,
    ],
    [
      'a call written with a three-part name (code review R2-n2)',
      `${WRITER}\nSELECT mydb.public.fixture_purge();`,
      /^call of public\.fixture_purge, /,
    ],
  ])('[PR293-SEC-01] rule 10 sees a shape PostgreSQL runs: %s', (shape, migration, message) => {
    const findings = lintTexts(`sec01-${shape.replace(/\W+/g, '-').slice(0, 60)}`, [migration]);
    expect(ruleOf(findings)).toEqual([[0, 'migration.sql', '10']]);
    expect(findings[0]?.[3]).toMatch(message);
  });

  it('[TASK-293 R3-n1] a row lock inside a WITH query of a FOR … IN loop is clean; a data-modifying CTE there, and an UPDATE CTE, stay data-changing', () => {
    expect(
      lintTexts('r3n1-lock', [DO('FOR r IN WITH x AS (SELECT 1) SELECT id FROM public.fixture_items FOR UPDATE LOOP NULL; END LOOP;')]),
    ).toEqual([]);
    expect(
      lintTexts('r3n1-no-key', [
        DO('FOR r IN WITH x AS (SELECT 1) SELECT id FROM public.fixture_items FOR NO KEY UPDATE LOOP NULL; END LOOP;'),
      ]),
    ).toEqual([]);
    expect(
      ruleOf(
        lintTexts('r3n1-delete', [
          DO('FOR r IN WITH d AS (DELETE FROM public.fixture_items RETURNING id) SELECT id FROM d LOOP NULL; END LOOP;'),
        ]),
      ),
    ).toEqual([[0, 'migration.sql', '10']]);
    expect(
      ruleOf(
        lintTexts('r3n1-update', [
          DO("FOR r IN WITH u AS (UPDATE public.fixture_items SET note = 'x' RETURNING id) SELECT id FROM u LOOP NULL; END LOOP;"),
        ]),
      ),
    ).toEqual([[0, 'migration.sql', '10']]);
  });

  it('[TASK-293 R3-n2] RENAME TO is tracked when the argument list holds parenthesised types (numeric(10,2), varchar(20)) and a quoted type name', () => {
    const writer =
      'CREATE FUNCTION public.fixture_typed(a numeric(10,2), b varchar(20)) RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END;';
    const findings = lintTexts('r3n2', [
      `${writer}\nALTER FUNCTION public.fixture_typed(numeric(10,2), varchar(20)) RENAME TO fixture_typed2;\nSELECT public.fixture_typed2(1, 'x');`,
    ]);
    expect(ruleOf(findings)).toEqual([[0, 'migration.sql', '10']]);
    expect(findings[0]?.[3]).toMatch(/^call of public\.fixture_typed2, /);
    const quoted = lintTexts('r3n2-quoted', [
      `${writer}\nALTER FUNCTION public.fixture_typed(numeric(10,2), "my(type") SET SCHEMA platform;\nSELECT platform.fixture_typed(1, 'x');`,
    ]);
    expect(ruleOf(quoted)).toEqual([[0, 'migration.sql', '10']]);
  });

  it('[PR293-SEC-01] controls: row locks, IN (SELECT …), a cursor over a SELECT … FOR UPDATE, a string holding ; without DML and a reading routine whose name cannot be read are clean', () => {
    const migration = [
      DO('FOR r IN SELECT id FROM public.fixture_items FOR UPDATE LOOP NULL; END LOOP;'),
      DO('OPEN c FOR SELECT id FROM public.fixture_items FOR UPDATE OF fixture_items;'),
      DO('PERFORM 1 FROM public.fixture_items WHERE id IN (SELECT 1);'),
      DO("RAISE NOTICE 'a; b';"),
      'CREATE FUNCTION mydb.public.fixture_three_reader() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.fixture_items; END;',
      'CREATE FUNCTION public.purgé_read() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.fixture_items; END;',
      'SELECT public.purgé_read();',
    ].join('\n');
    expect(lintTexts('sec01-controls', [migration])).toEqual([]);
  });

  it('[PR293-SEC-01] stated limit, pinned: attribute notation calls a writer unseen', () => {
    const writerOfRow =
      'CREATE FUNCTION public.fixture_attr(t public.fixture_items) RETURNS integer LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; SELECT 1; END;';
    const migration = [writerOfRow, 'SELECT t.fixture_attr FROM public.fixture_items t;'].join('\n');
    // PostgreSQL runs the DELETE (security record PR293-SEC-01 row 3); the linter does not see it. A change that starts
    // seeing it updates this pin and the "Not seen" list together.
    expect(lintTexts('sec01-limits', [migration])).toEqual([]);
  });

  it('[D-ARCH-172] PR293-SEC-01 rows 4 and 5 are no longer limits: the cast-function and aggregate-support shapes are refused by rule 14', () => {
    const writerOfRow =
      'CREATE FUNCTION public.fixture_attr(t public.fixture_items) RETURNS integer LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; SELECT 1; END;';
    const cast = lintTexts('sec01-row4', [
      [
        writerOfRow,
        'CREATE CAST (public.fixture_items AS integer) WITH FUNCTION public.fixture_attr(public.fixture_items);',
        'SELECT (t)::integer FROM public.fixture_items t;',
      ].join('\n'),
    ]);
    expect(ruleOf(cast)).toEqual([[0, 'migration.sql', '14']]);
    const aggregate = lintTexts('sec01-row5', [
      [
        WRITER,
        'CREATE AGGREGATE public.fixture_agg(integer) (SFUNC = public.fixture_purge, STYPE = integer);',
        'SELECT public.fixture_agg(1);',
      ].join('\n'),
    ]);
    expect(ruleOf(aggregate)).toEqual([[0, 'migration.sql', '14']]);
  });

  it('[PR293-SEC-04] (a) text that does not lex is also cut at the ; of code: a name holding ; hides no following UPDATE (contrived shape of the record)', () => {
    const shape = normalise(`begin perform 1; update "fixture;items" set note = 1; raise notice 'x; end`);
    expect(() => tokenize(shape)).toThrow(SqlLexError); // the shape does not lex: the fallback reads it
    expect(routineBodyChangesData(shape)).toBe(true);
    expect(tolerantRead(`a; update "x;y" set b = 'c;d'; e "f`).segments).toEqual(['a', ' update "x;y" set b = \'c;d\'', ' e "f']);
    expect(tolerantRead(`a 'it''s; here'; b`)).toEqual({ segments: [`a 'it''s; here'`, ' b'], bodies: ["it's; here"] });
    // Controls: the same unlexable text without DML, and a row lock, stay clean.
    expect(routineBodyChangesData(normalise(`begin perform 1; select "fixture;items"; raise notice 'x; end`))).toBe(false);
    expect(routineBodyChangesData(normalise(`begin perform 1 from "a;b" for update; raise notice 'x; end`))).toBe(false);
    const findings = lintTexts('sec04-a', [`DO $$ BEGIN PERFORM 1; UPDATE "fixture;items" SET note = 1; RAISE NOTICE 'x; END $$;`]);
    expect(ruleOf(findings).filter(([, , rule]) => rule === '10')).toEqual([[0, 'migration.sql', '10']]);
  });

  /** A PostgreSQL-valid E-string continued on a new line (PR293-SEC-02): the body then does not lex, and the fallback reads it. */
  const CONTINUED = "PERFORM E'x'\n'y';";
  it.each([
    ['(C) a -- line before the UPDATE', `${CONTINUED} -- tidy up\nUPDATE public.fixture_items SET note = 1;`, 'c'],
    ["(D) PERFORM 1; -- don't before the DELETE", `${CONTINUED} PERFORM 1; -- don't\nDELETE FROM public.fixture_items;`, 'd'],
    ['(E) /* x */ DELETE', `${CONTINUED} /* x */ DELETE FROM public.fixture_items;`, 'e'],
    ['a nested block comment holding ; and a quote', `${CONTINUED} /* a /* b; ' */ c */ DELETE FROM public.fixture_items;`, 'nested'],
    ['a -- comment holding ; and a quote, ended by a lone CR', `${CONTINUED} -- a; b 'c\rUPDATE public.fixture_items SET note = 1;`, 'cr'],
    [
      'a comment between the ; and a WITH write',
      `${CONTINUED} -- w\nWITH d AS (DELETE FROM public.fixture_items RETURNING 1) SELECT 1;`,
      'with',
    ],
  ])('[TASK-034 R1-M2] the PR293-SEC-04 (a) fallback skips comments as the lexed path does: %s is rule 10', (_label, statements, key) => {
    const body = `BEGIN ${statements} END`;
    expect(() => tokenize(body)).toThrow(EscapeContinuationError);
    expect(routineBodyChangesData(body)).toBe(true);
    const findings = lintTexts(`r1m2-${key}`, [`DO $$ ${body} $$;`]);
    expect(ruleOf(findings).filter(([, , rule]) => rule === '10')).toEqual([[0, 'migration.sql', '10']]);
  });

  it('[TASK-034 R1-M2] controls: DML that only a comment holds stays clean in the fallback, and the tolerant reading blanks comments', () => {
    expect(routineBodyChangesData(`BEGIN ${CONTINUED} -- UPDATE public.fixture_items SET note = 1\nPERFORM 1; END`)).toBe(false);
    expect(routineBodyChangesData(`BEGIN ${CONTINUED} /* DELETE FROM public.fixture_items */ PERFORM 1; END`)).toBe(false);
    // The kept over-approximation: a ; inside the comment before the DML still cuts the naive split (fail closed).
    expect(routineBodyChangesData(`BEGIN ${CONTINUED} /* ; DELETE FROM public.fixture_items; */ PERFORM 1; END`)).toBe(true);
    expect(tolerantRead("a -- b; 'c\nd; /* e /* ; */ f */ g; $q$ h; $q$ i").segments).toEqual(['a  \nd', '   g', ' $q$ h; $q$ i']);
  });

  it('[TASK-034 R1-M2] dynamic SQL in a literal: a comment before the DML hides it neither with a line break nor with an E-string line-break escape', () => {
    const withBreak = lintTexts('r1m2-dyn', ["DO $$ BEGIN EXECUTE 'SELECT 1; -- note\nDELETE FROM public.fixture_items'; END $$;"]);
    expect(ruleOf(withBreak)).toEqual([[0, 'migration.sql', '10']]);
    expect(routineBodyChangesData("BEGIN EXECUTE E'SELECT 1; -- note\\nDELETE FROM public.fixture_items'; END")).toBe(true);
    expect(routineBodyChangesData("BEGIN EXECUTE E'SELECT 1; -- note\\012DELETE FROM public.fixture_items'; END")).toBe(true);
    // Control: the DML inside the comment of the dynamic SQL is no statement.
    expect(routineBodyChangesData("BEGIN EXECUTE 'SELECT 1 -- DELETE FROM public.fixture_items\n'; END")).toBe(false);
  });

  it('[PR034-SEC-06] shape X4 through lintMigrations: an E-string line-break escape before the DML of an EXECUTE is decoded in the lint path (rule 10), and rule 16 still refuses the escape string', () => {
    const x4 = lintTexts('sec06-x4', ["DO $$ BEGIN EXECUTE E'SELECT 1; -- note\\nDELETE FROM public.fixture_items'; END $$;"]);
    expect(ruleOf(x4)).toEqual([
      [0, 'migration.sql', '10'],
      [0, 'migration.sql', '16'],
    ]);
    // The octal form of the same escape, and a routine body (the call-site half reads the same text).
    const octal = lintTexts('sec06-x4-octal', ["DO $$ BEGIN EXECUTE E'SELECT 1; -- note\\012DELETE FROM public.fixture_items'; END $$;"]);
    expect(ruleOf(octal).map(([, , rule]) => rule)).toEqual(['10', '16']);
    const routine = lintTexts('sec06-x4-routine', [
      "CREATE FUNCTION public.fixture_x4() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE E'SELECT 1; -- n\\nDELETE FROM public.fixture_items'; END $$;\nSELECT public.fixture_x4();",
    ]);
    expect(ruleOf(routine).filter(([, , rule]) => rule === '10')).toEqual([[0, 'migration.sql', '10']]);
    // Control: without the line-break escape the DML stays inside the comment (rule 16 only).
    const control = lintTexts('sec06-x4-control', ["DO $$ BEGIN EXECUTE E'SELECT 1; -- note DELETE FROM public.fixture_items'; END $$;"]);
    expect(ruleOf(control)).toEqual([[0, 'migration.sql', '16']]);
  });

  /** `[index, file, rule]` of the rule-21 findings only. */
  const rule21 = (findings: readonly (readonly [number, string | undefined, string, string])[]) =>
    ruleOf(findings).filter(([, , rule]) => rule === '21');
  const CHECK_ROUTINE = 'CREATE FUNCTION public.fixture_check(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;';

  it.each([
    [
      'an unqualified call of a migration routine',
      `${CHECK_ROUTINE}\nCREATE TABLE public.fixture_items (id integer CHECK (fixture_check(id)));`,
    ],
    [
      'a routine named inside a string literal of the clause',
      "CREATE TABLE public.fixture_items (id integer CHECK (pg_catalog.length('select public.fixture_w(1)') > 0));",
    ],
    ['an operator of another schema', 'CREATE TABLE public.fixture_items (id integer CHECK (id OPERATOR(public.===) 1));'],
    [
      'query_to_xmlschema, quoted',
      `CREATE TABLE public.fixture_items (id integer CHECK ("query_to_xmlschema"('select 1', true, false, '') IS NOT NULL));`,
    ],
    [
      'a domain CHECK added by ALTER DOMAIN',
      'ALTER DOMAIN public.fixture_code ADD CONSTRAINT ck_fixture_code_w CHECK (public.fixture_w(VALUE));',
    ],
    [
      'SET EXPRESSION AS',
      "SET lock_timeout = '3s';\nALTER TABLE public.fixture_items ALTER COLUMN flag SET EXPRESSION AS (public.fixture_w(id));",
    ],
    [
      'ADD COLUMN … GENERATED ALWAYS AS … STORED',
      "SET lock_timeout = '3s';\nALTER TABLE public.fixture_items ADD COLUMN flag boolean GENERATED ALWAYS AS (public.fixture_w(id)) STORED;",
    ],
    [
      'a PARTITION BY HASH key after literals that hold parentheses',
      "CREATE TABLE public.fixture_events (id integer CHECK (pg_catalog.length('(') > 0 AND pg_catalog.length(')') > 0), note text DEFAULT ')(') PARTITION BY HASH ((public.fixture_w(id)));",
    ],
    [
      'a CHECK after a comment and a quoted identifier holding parentheses',
      'CREATE TABLE public.fixture_items ("a(" integer, /* ( */ CONSTRAINT ck CHECK (public.fixture_w("a(")));',
    ],
  ])('[D-ARCH-236] rule 21: %s is refused', (label, migration) => {
    expect(rule21(lintTexts(`r21-${label.replace(/[^a-z]+/gi, '-')}`, [migration]))).toEqual([[0, 'migration.sql', '21']]);
  });

  it('[D-ARCH-236] rule 21: a clause whose closing parenthesis cannot be found is refused (fail closed, item d)', () => {
    const findings = lintTexts('r21-open', ['CREATE TABLE public.fixture_items (id integer CHECK ((id > 0);']);
    expect(rule21(findings)).toEqual([[0, 'migration.sql', '21']]);
    expect(findings.find(([, , rule]) => rule === '21')?.[3]).toMatch(
      /^load-time expression: the CHECK clause has no closing parenthesis the linter can find \(fail closed\)/,
    );
  });

  it('[D-ARCH-236] rule 21 controls: an identity column, a column DEFAULT, a policy, an index expression, a trigger, a plain partition key, a check_option setting and the word in a literal are no load-time clauses', () => {
    const migration = [
      CHECK_ROUTINE,
      "CREATE TABLE public.fixture_items (id integer GENERATED ALWAYS AS IDENTITY, org_id uuid DEFAULT platform.app_org_id(), note text DEFAULT 'check (public.fixture_check(1))', CONSTRAINT ck_fixture_items__note CHECK (pg_catalog.octet_length(note) <= 10 AND note IS DISTINCT FROM 'x'));",
      'CREATE TABLE public.fixture_events (id integer NOT NULL, month date NOT NULL) PARTITION BY RANGE (month);',
    ].join('\n');
    expect(rule21(lintTexts('r21-controls', [migration]))).toEqual([]);
  });

  it('[D-ARCH-236] rule 21 in down.sql: a load-time clause that calls a routine of the migrations, or one down.sql creates, is refused there too', () => {
    const earlier = `${CHECK_ROUTINE}\nSELECT 1;`;
    const down = 'CREATE TABLE IF NOT EXISTS public.fixture_items (id integer CHECK (fixture_check(id)));\n';
    expect(rule21(lintTexts('r21-down', [earlier], 'no', down))).toEqual([[0, 'down.sql', '21']]);
    const own = `${CHECK_ROUTINE.replace('fixture_check', 'fixture_down_only')}\nCREATE TABLE IF NOT EXISTS public.fixture_items (id integer CHECK (fixture_down_only(id)));\n`;
    expect(rule21(lintTexts('r21-down-own', ['SELECT 1;'], 'no', own))).toEqual([[0, 'down.sql', '21']]);
    expect(
      rule21(
        lintTexts(
          'r21-down-control',
          ['SELECT 1;'],
          'no',
          'CREATE TABLE IF NOT EXISTS public.fixture_items (id integer CHECK (id > 0));\n',
        ),
      ),
    ).toEqual([]);
  });

  it('[D-ARCH-236] rule 21 scales linearly: time(4n) / time(n) < 8 on one long clause with nested parentheses, and on many clauses in one statement', () => {
    const nested = (n: number) =>
      `CREATE TABLE public.fixture_items (id integer CHECK (${'(pg_catalog.abs('.repeat(n)}id${'))'.repeat(n)} >= 0));`;
    const many = (n: number) =>
      `CREATE TABLE public.fixture_items (id integer${" CHECK (check (pg_catalog.length('(') > 0 AND (id > 0)))".repeat(n)});`;
    const fastest = (text: string) =>
      Math.min(
        ...[0, 1, 2].map(() => {
          const started = performance.now();
          expect(loadTimeClauseProblems(text, [])).toEqual([]);
          return performance.now() - started;
        }),
      );
    for (const [statement, n] of [
      [nested, 5_000],
      [many, 2_000],
    ] as const) {
      const small = fastest(statement(n));
      const large = fastest(statement(4 * n));
      expect(large / Math.max(small, 1)).toBeLessThan(8);
    }
  });

  it('[PR293-SEC-04] (a) the fallback reading stays linear: time(4n) / time(n) < 8 on unlexable text full of quotes, semicolons and comments', () => {
    const quotes = (n: number) => `'${'; update "a; b'.repeat(n)}`;
    const comments = (n: number) =>
      `BEGIN ${CONTINUED} ${"-- it's; x\n; /* a /* b; ' */ c */ PERFORM \"a;b\", 'c;d', $q$ e; $q$;\r".repeat(n)} END`;
    const fastest = (text: string) =>
      Math.min(
        ...[0, 1, 2].map(() => {
          const started = performance.now();
          routineBodyChangesData(text);
          return performance.now() - started;
        }),
      );
    for (const [body, n] of [
      [quotes, 20_000],
      [comments, 5_000], // 60 characters a unit: 300 KB against 1.2 MB
    ] as const) {
      const small = fastest(body(n));
      const large = fastest(body(4 * n));
      expect(large / Math.max(small, 1)).toBeLessThan(8);
    }
    expect(routineBodyChangesData(comments(10))).toBe(false);
  });

  it("[PR293-SEC-04] (b) a string literal in a body is read as dynamic SQL, prose included: RAISE NOTICE 'running in update mode' stays a rule-10 finding (fail closed, kept by D-TASK034)", () => {
    // Narrowing to EXECUTE arguments would miss a literal that reaches EXECUTE through a variable or format(), and
    // query_to_xml('…') executes its argument wherever it stands; so the reading stays fail closed.
    const prose = lintTexts('sec04-b', [DO("RAISE NOTICE 'running in update mode';")]);
    expect(ruleOf(prose)).toEqual([[0, 'migration.sql', '10']]);
    const viaVariable = lintTexts('sec04-b-variable', [
      "DO $$ DECLARE q text := 'DELETE FROM public.fixture_items'; BEGIN EXECUTE q; END $$;",
    ]);
    expect(ruleOf(viaVariable)).toEqual([[0, 'migration.sql', '10']]);
    // Declared data-changing, the same prose is clean.
    expect(lintTexts('sec04-b-declared', [DO("RAISE NOTICE 'running in update mode';")], 'yes')).toEqual([]);
  });

  it('[PR66-SEC-02] rule 10 call-site controls: references that call nothing, a reading routine, a row lock and a same-prefix name are clean', () => {
    const migration = [
      'CREATE TABLE public.fixture_events (id integer);',
      WRITER,
      'REVOKE EXECUTE ON FUNCTION public.fixture_purge() FROM PUBLIC;',
      'GRANT EXECUTE ON FUNCTION public.fixture_purge() TO platform_app;',
      "COMMENT ON FUNCTION public.fixture_purge() IS 'deletes';",
      'CREATE TRIGGER trg_fixture_events__purge AFTER INSERT ON public.fixture_events FOR EACH ROW EXECUTE FUNCTION public.fixture_purge();',
      'CREATE FUNCTION public.fixture_read() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.fixture_items; END;',
      'SELECT public.fixture_read();',
      "CREATE FUNCTION public.fixture_lock() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM public.fixture_items FOR UPDATE; RAISE NOTICE 'x'; END $$;",
      'SELECT public.fixture_lock();',
      // INSERT … VALUES, also with ON CONFLICT DO NOTHING, is no rule-10 form at top level, so not in a body either.
      'CREATE FUNCTION public.fixture_seed() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.fixture_items (id) VALUES (1) ON CONFLICT DO NOTHING $$;',
      'SELECT public.fixture_seed();',
      'SELECT public.fixture_purge_count(), other.fixture_purge();',
      // The statement exemption alone covers the second name of a list (it has no FUNCTION keyword before it).
      'GRANT EXECUTE ON FUNCTION public.fixture_read(), public.fixture_purge() TO platform_app;',
      // The FUNCTION-reference stripping alone covers a reference in a statement outside the exemption list (a CREATE
      // CAST served here before rule 14 refused it, D-ARCH-172).
      "SECURITY LABEL FOR fixture ON FUNCTION public.fixture_purge() IS 'x';",
    ].join('\n');
    expect(lintTexts('call-controls', [migration])).toEqual([]);
  });
});

describe('the repository lanes', () => {
  it('[NT-DATA-004-b] prisma/migrations and prisma/bootstrap of this repository have no findings', () => {
    // 2026-11-15 = the latest approval date (91-audit-actions-v2.sql, TASK-285; 10 and 90 carry 2026-11-13, TASK-021);
    // main() uses the clock.
    expect(lintRepository(repoRoot, '2026-11-15')).toEqual([]);
    expect(main(['--no-validate'])).toBe(0);
  });

  it('lists exactly security-analyst as the audit-DDL reviewer (added by TASK-021; any other reviewer still fails closed)', () => {
    expect(readReviewers(join(repoRoot, 'tools', 'db', 'audit-ddl-reviewers.json'))).toEqual(['security-analyst']);
  });
});

describe('rule 17 and released migrations (PR11-SEC-07; released down.sql files are immutable)', () => {
  it('[PR11-SEC-07] RULE_17_RELEASED is frozen: exactly the three pre-rule migrations, each still released and each still needing the exemption', () => {
    expect([...RULE_17_RELEASED]).toEqual([
      '20261112010000_authz_catalogue_tables',
      '20261112020000_platform_rls_helpers',
      '20261112030000_reference_dataset_versions',
    ]);
    const work = mkdtempSync(join(tmpdir(), 'rule17-'));
    try {
      for (const name of RULE_17_RELEASED) {
        const source = join(repoRoot, 'prisma', 'migrations', name);
        const copy = join(work, `${name}_copy`);
        mkdirSync(copy);
        for (const file of ['migration.sql', 'down.sql']) copyFileSync(join(source, file), join(copy, file));
        const findings = lintMigrations(work, 'rule17').filter((finding) => finding.rule === '17');
        expect(findings.length).toBeGreaterThan(0); // renamed, the exemption no longer applies: the list cannot hide a compliant file
        rmSync(copy, { recursive: true, force: true });
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
