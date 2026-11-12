/**
 * Migration linter with negative fixtures (data-model.md §8.3; NT-DATA-004-b; NT-AVAIL-003-a (rules 2-6, 11);
 * SEC-TC-33 (rules 7-9, 12, 14); ADR-0005 am. 10 items 1 and 9 (rules 16 and 15); PR5-SEC-11/-12; TASK-003, TASK-016).
 * Fixtures: tools/db/fixtures/lint/{migrations,bootstrap}/<case>/. The fixture tables are classified by
 * FIXTURE_CLASSES below (the repository's own manifests stay the source for the repository run).
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { lintBootstrap, lintMigrations, lintRepository, main, parseHeader, readReviewers, type LintFinding } from './lint-migrations.js';
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
    ['all-grant', ['8']],
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

  it('[SEC-TC-33] rule 14: CREATE SCHEMA, CREATE EXTENSION, ALTER DATABASE, ALTER SCHEMA OWNER TO, ALTER/CREATE/DROP ROLE fail', () => {
    expect(byMigration(lintCase('bootstrap-only'))).toEqual([
      ['20261112000000_create_schema', '14'],
      ['20261112000100_create_extension', '14'],
      ['20261112000200_alter_database', '14'],
      ['20261112000300_alter_schema_owner', '14'],
      ['20261112000400_alter_role', '14'],
      ['20261112000500_create_role', '14'],
      ['20261112000600_drop_role', '14'],
    ]);
  });
});

describe('definer ownership order (rule 15; ADR-0005 am. 10 item 9)', () => {
  it('rule 15 (ADR-0005 am. 10 item 9): GRANT/REVOKE after OWNER TO platform_definer fails (definer-grant-after-owner-to)', () => {
    expect(rules(lintCase('definer-grant-after-owner-to'))).toEqual(['15', '15']);
  });

  it('rule 15 (ADR-0005 am. 10 item 9): SECURITY DEFINER created outside SET ROLE platform_definer is flagged (definer-outside-set-role)', () => {
    expect(rules(lintCase('definer-outside-set-role'))).toEqual(['15']);
  });

  it.each([['definer-set-role-block'], ['definer-grants-before-owner-to']])('rule 15 (ADR-0005 am. 10 item 9): %s is clean', (name) => {
    expect(lintCase(name)).toEqual([]);
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
