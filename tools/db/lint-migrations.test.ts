/**
 * Migration linter with negative fixtures (data-model.md §8.3; NT-DATA-004-b; the DROP part of NT-AVAIL-003-a and
 * the audit-DDL clause of SEC-TC-33, whose other parts (rules 3-9, 11) are not implemented yet, so their IDs stay out
 * of the titles;
 * TASK-003). Fixtures: tools/db/fixtures/lint/{migrations,bootstrap}/<case>/.
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { lintBootstrap, lintMigrations, lintRepository, main, parseHeader, readReviewers, type LintFinding } from './lint-migrations.js';
import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'tools', 'db', 'fixtures', 'lint');
const lintCase = (name: string) => lintMigrations(join(fixtures, 'migrations', name), name);
const rules = (findings: LintFinding[]) => findings.map((finding) => finding.rule);
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

  it('does not flag a plain WITH ... SELECT, row locks (FOR [NO KEY] UPDATE) or keywords inside strings (CR m3 control)', () => {
    expect(lintCase('cte-select')).toEqual([]);
  });
});

describe('audit DDL (rule 12) and the definer search path (rule 13)', () => {
  // SEC-TC-33's audit-DDL clause. The ID is not put in the titles: its other clauses (DROP TRIGGER, DISABLE ROW LEVEL
  // SECURITY, BYPASSRLS, ALTER POLICY; rules 7-9) are not implemented yet, and a bracketed ID would count as coverage.
  it('rejects audit DDL in prisma/migrations unconditionally, including dynamic SQL and the audit owner role (rule 12)', () => {
    const findings = lintCase('audit-ddl');
    expect(rules(findings)).toEqual(['12', '12', '12', '12']);
    expect(findings.map((finding) => finding.file.split(/[\\/]/)[1])).toEqual([
      '20261112000000_audit_trigger',
      '20261112000100_audit_partition',
      '20261112000200_audit_owner',
      '20261112000300_audit_dynamic',
    ]);
  });

  it('rejects SECURITY DEFINER without exactly "SET search_path = pg_catalog, pg_temp", and ALTER FUNCTION that weakens it', () => {
    expect(rules(lintCase('definer-path'))).toEqual(['13', '13', '13', '13']);
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

describe('the repository lanes', () => {
  it('[NT-DATA-004-b] prisma/migrations and prisma/bootstrap of this repository have no findings', () => {
    expect(lintRepository(repoRoot, '2026-11-12')).toEqual([]);
    expect(main(['--no-validate'])).toBe(0);
  });

  it('starts with an empty audit-DDL reviewer list, so audit DDL fails closed until security-analyst adds a reviewer', () => {
    expect(readReviewers(join(repoRoot, 'tools', 'db', 'audit-ddl-reviewers.json'))).toEqual([]);
  });
});
