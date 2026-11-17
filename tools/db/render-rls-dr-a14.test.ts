/**
 * DR-A14 named policy sets and the standard-columns guard rendering (data-model §4.3 "Special policies of DR-A14" as
 * amended 2026-11-14 (users fence, D-ARCH-123) and §7.6 "Database guard" as amended 2026-11-13; PR11-SEC-10
 * requirements 1-5, PR26-SEC-03; D-ARCH-072, D-ARCH-091; TASK-024). The byte-for-byte check reads the SQL block of data-model §4.3 itself, so the templates and the reviewed
 * design text cannot drift apart silently.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  DR_A14_ATOMS,
  FUNCTION_TEMPLATE_DIR,
  RenderRlsError,
  blocksFor,
  checkPredicate,
  loadPolicyTemplates,
  renderModule,
  renderRls,
  renderStdColumnsGuard,
  renderStdColumnsGuardFunction,
  stripComments,
  validateTemplate,
} from './render-rls.js';
import { splitStatements } from './sql-text.js';
import { POLICY_SETS, parseManifest, type TableClassEntry } from './table-classes.js';
import { findRepoRoot } from '../test-support/process.js';

const templates = loadPolicyTemplates();
const work: string[] = [];
afterAll(() => work.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const USERS: TableClassEntry = { module: 'identity', name: 'users', class: 'USER_OWNED', policySet: 'dr-a14-users', definerRead: true };
const MEMBERSHIPS: TableClassEntry = {
  module: 'orgs',
  name: 'memberships',
  class: 'TENANT',
  policySet: 'dr-a14-memberships',
  definerRead: true,
};
const ORGANISATIONS: TableClassEntry = {
  module: 'orgs',
  name: 'organisations',
  class: 'TENANT',
  policySet: 'dr-a14-organisations',
  definerRead: true,
};

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** CREATE POLICY statements of a SQL text, comments removed, whitespace collapsed. */
const policies = (sql: string): string[] =>
  splitStatements(stripComments(sql))
    .map(collapse)
    .filter((statement) => statement.startsWith('CREATE POLICY '));

/** The fenced SQL block of data-model §4.3 that holds the three DR-A14 templates. */
function designSql(): string {
  const text = readFileSync(join(findRepoRoot(), 'docs', '03-architecture', 'data-model.md'), 'utf8');
  const block = [...text.matchAll(/```sql\n([\s\S]*?)```/g)]
    .map((match) => match[1] ?? '')
    .find((sql) => sql.includes('-- template dr-a14-users'));
  if (block === undefined) throw new Error('data-model §4.3 DR-A14 block not found');
  return block;
}

describe('DR-A14 policy sets (data-model §4.3 as amended 2026-11-14 (D-ARCH-123); PR11-SEC-10; D-ARCH-072)', () => {
  it('PR11-SEC-10 req. 1-2: the rendered users, memberships and organisations policies equal the data-model §4.3 SQL byte for byte (whitespace normalised)', () => {
    const design = policies(designSql());
    const rendered = [USERS, MEMBERSHIPS, ORGANISATIONS].flatMap((entry) =>
      policies(renderRls({ ...entry, definerRead: false }, templates)),
    );
    expect(rendered).toEqual(design);
    expect(design).toHaveLength(9);
  });

  it('blocksFor: users replaces user-owned, organisations replaces tenant, memberships adds own_read after tenant; definer-read stays a flag', () => {
    expect(blocksFor(USERS)).toEqual(['enable-force', 'dr-a14-users', 'operator', 'definer-read']);
    expect(blocksFor(MEMBERSHIPS)).toEqual(['enable-force', 'tenant', 'dr-a14-memberships', 'operator', 'definer-read']);
    expect(blocksFor(ORGANISATIONS)).toEqual(['enable-force', 'dr-a14-organisations', 'operator', 'definer-read']);
    expect(renderRls(USERS, templates)).toContain('(USER_OWNED; policySet dr-a14-users, definerRead)');
    expect(renderRls(USERS, templates)).not.toContain('user_id = platform.app_actor_id()');
    expect(renderRls(ORGANISATIONS, templates)).not.toContain('org_id = platform.app_org_id()');
  });

  it('PR11-SEC-10 req. 5 (renderer side): memberships policies hold no subquery; users/organisations subqueries read public.memberships only; IN lists are positive and only on m.status', () => {
    const rendered = renderRls(MEMBERSHIPS, templates);
    expect(rendered).not.toMatch(/\(\s*SELECT\b/i);
    for (const entry of [USERS, ORGANISATIONS]) {
      const sql = stripComments(renderRls(entry, templates));
      expect([...sql.matchAll(/\bFROM\s+([a-z_.]+)/gi)].map((match) => match[1])).toEqual(['public.memberships']);
      expect([...sql.matchAll(/([a-z_.]+)\s+IN\s*\(/gi)].map((match) => match[1])).toEqual(['m.status']);
      expect(sql).not.toMatch(/NOT\s+IN|<>|!=/i);
    }
    expect(renderRls(USERS, templates)).toContain("m.status IN ('ACTIVE','SUSPENDED')");
    expect(renderRls(ORGANISATIONS, templates)).toContain("m.status IN ('ACTIVE','SUSPENDED')");
  });

  it('PR11-SEC-10 req. 3: the special atoms are admitted ONLY in their own template', () => {
    const usersExists = [...DR_A14_ATOMS['dr-a14-users']].find((atom) => atom.startsWith('EXISTS')) ?? '';
    const orgExists = [...DR_A14_ATOMS['dr-a14-organisations']].find((atom) => atom.startsWith('EXISTS')) ?? '';
    const select = (using: string): string =>
      `CREATE POLICY p_{{table}}__x ON public.{{table}} FOR SELECT TO platform_app USING (${using});`;
    const all = (pred: string): string =>
      `CREATE POLICY p_{{table}}__x ON public.{{table}} FOR ALL TO platform_app USING (${pred}) WITH CHECK (${pred});`;
    // accepted in their own template
    expect(() => validateTemplate('dr-a14-users', select(usersExists))).not.toThrow();
    expect(() => validateTemplate('dr-a14-users', all('id = platform.app_actor_id()'))).not.toThrow();
    expect(() => validateTemplate('dr-a14-organisations', select(orgExists))).not.toThrow();
    expect(() => validateTemplate('dr-a14-organisations', all('id = platform.app_org_id()'))).not.toThrow();
    // refused everywhere else, including the sibling DR-A14 templates
    for (const name of ['tenant', 'user-owned', 'guest', 'dr-a14-memberships', 'probe']) {
      expect(() => validateTemplate(name, select(usersExists))).toThrow(/not on the allow-list: EXISTS/);
      expect(() => validateTemplate(name, all('id = platform.app_org_id()'))).toThrow(/not on the allow-list: id =/);
    }
    expect(() => validateTemplate('dr-a14-organisations', select(usersExists))).toThrow(/not on the allow-list: EXISTS/);
    expect(() => validateTemplate('dr-a14-users', all('id = platform.app_org_id()'))).toThrow(
      /not on the allow-list: id = platform.app_org_id/,
    );
  });

  it.each([
    [
      'a deny-list status (fail-open on enum growth)',
      (atom: string) => atom.replace("m.status IN ('ACTIVE','SUSPENDED')", "m.status <> 'REMOVED'"),
      /forbidden token <>/,
    ],
    ['NOT IN', (atom: string) => atom.replace('m.status IN', 'm.status NOT IN'), /forbidden token NOT/],
    ['an OR inside EXISTS', (atom: string) => atom.replace(' AND m.org_id', ' OR m.org_id'), /forbidden token OR/],
    [
      'coalesce inside EXISTS',
      (atom: string) => atom.replace('platform.app_org_id()', 'coalesce(platform.app_org_id(), m.org_id)'),
      /forbidden token coalesce/,
    ],
    [
      'IS DISTINCT FROM inside EXISTS',
      (atom: string) => atom.replace('m.org_id = platform.app_org_id()', 'm.org_id IS NOT DISTINCT FROM platform.app_org_id()'),
      /forbidden token IS/,
    ],
    ['!= inside EXISTS', (atom: string) => atom.replace('m.org_id =', 'm.org_id !='), /forbidden token !=/],
    [
      'a raw current_setting inside EXISTS',
      (atom: string) => atom.replace('platform.app_org_id()', "current_setting('app.org_id', true)::uuid"),
      /raw current_setting\(/,
    ],
    [
      'another table in the subquery',
      (atom: string) => atom.replace('public.memberships m', 'public.invitations m'),
      /not on the allow-list: EXISTS/,
    ],
    ['an extra status', (atom: string) => atom.replace("'SUSPENDED')", "'SUSPENDED','REMOVED')"), /not on the allow-list: EXISTS/],
  ])('refuses %s in the users template', (_label, mutate, error) => {
    const atom = [...DR_A14_ATOMS['dr-a14-users']].find((a) => a.startsWith('EXISTS')) ?? '';
    const text = `CREATE POLICY p_{{table}}__x ON public.{{table}} FOR SELECT TO platform_app USING (${mutate(atom)});`;
    expect(() => validateTemplate('dr-a14-users', text)).toThrow(RenderRlsError);
    expect(() => validateTemplate('dr-a14-users', text)).toThrow(error);
  });

  it('checkPredicate without extra atoms refuses the DR-A14 atoms (the default for every other caller)', () => {
    for (const atom of [...DR_A14_ATOMS['dr-a14-users'], ...DR_A14_ATOMS['dr-a14-organisations']]) {
      expect(checkPredicate(atom.replace('{{table}}', 'users'), 'platform_app', 'SELECT')).toMatch(/not on the allow-list/);
    }
  });

  it('PR11-SEC-10 req. 1: the manifest accepts a policySet only on the table of the same name and class', () => {
    const manifest = (tables: unknown): string => JSON.stringify({ module: 'm', tables });
    expect(parseManifest('m.json', manifest([{ name: 'users', class: 'USER_OWNED', policySet: 'dr-a14-users' }]))[0]?.policySet).toBe(
      'dr-a14-users',
    );
    for (const [policySet, { table, class: tableClass }] of Object.entries(POLICY_SETS)) {
      expect(() => parseManifest('m.json', manifest([{ name: `${table}_x`, class: tableClass, policySet }]))).toThrow(/belongs to table/);
      const other = tableClass === 'TENANT' ? 'USER_OWNED' : 'TENANT';
      expect(() => parseManifest('m.json', manifest([{ name: table, class: other, policySet }]))).toThrow(/belongs to table/);
    }
    expect(() => parseManifest('m.json', manifest([{ name: 'users', class: 'USER_OWNED', policySet: 'dr-a14-admins' }]))).toThrow(
      /must be one of/,
    );
    expect(() => parseManifest('m.json', manifest([{ name: 'users', class: 'USER_OWNED', policySet: 'toString' }]))).toThrow(
      /must be one of/,
    );
  });

  it('the renderer refuses a policySet on the wrong table or class even when the entry bypasses the loader', () => {
    expect(() => renderRls({ ...USERS, name: 'people' }, templates)).toThrow(/belongs to table users/);
    expect(() => renderRls({ ...MEMBERSHIPS, class: 'USER_OWNED' }, templates)).toThrow(/needs class TENANT/);
  });
});

describe('standard-columns guard rendering (data-model §7.6 amendment 2026-11-13; D-ARCH-091; C15)', () => {
  const STD: TableClassEntry = { module: 'orgs', name: 'org_widgets', class: 'TENANT', stdColumns: true };

  it('[SEC-TC-74] renders trg_<table>__std_columns BEFORE INSERT OR UPDATE FOR EACH ROW on platform.std_columns_guard() for a stdColumns table', () => {
    expect(renderStdColumnsGuard(STD, templates)).toBe(
      [
        '-- Standard-columns guard for public.org_widgets, module orgs: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.',
        'CREATE TRIGGER trg_org_widgets__std_columns BEFORE INSERT OR UPDATE ON public.org_widgets',
        '  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();',
        '',
      ].join('\n'),
    );
    expect(() => renderStdColumnsGuard({ ...STD, stdColumns: false }, templates)).toThrow(/not flagged stdColumns/);
    expect(() => renderStdColumnsGuard({ ...STD, name: `t${'x'.repeat(60)}` }, templates)).toThrow(/longer than 63 bytes/);
  });

  it('renderModule appends the guard after the RLS block, and renders it for flagged GLOBAL/SYSTEM tables too', () => {
    const entries: TableClassEntry[] = [
      STD,
      { module: 'orgs', name: 'org_kinds', class: 'GLOBAL', stdColumns: true },
      { module: 'orgs', name: 'org_flags', class: 'GLOBAL' },
    ];
    const sql = renderModule('orgs', entries, templates);
    expect([...sql.matchAll(/CREATE TRIGGER (\S+)/g)].map((match) => match[1])).toEqual([
      'trg_org_widgets__std_columns',
      'trg_org_kinds__std_columns',
    ]);
    expect(sql.indexOf('p_org_widgets__tenant')).toBeLessThan(sql.indexOf('trg_org_widgets__std_columns'));
  });

  it('the manifest refuses stdColumns on a runtimeReadOnly or audit table, and runtimeReadOnly on an RLS class', () => {
    const manifest = (module: string, tables: unknown): string => JSON.stringify({ module, tables });
    expect(() => parseManifest('m.json', manifest('m', [{ name: 't', class: 'GLOBAL', runtimeReadOnly: true, stdColumns: true }]))).toThrow(
      /never written at runtime/,
    );
    expect(() => parseManifest('m.json', manifest('m', [{ name: 't', class: 'SYSTEM', runtimeReadOnly: true, hardDelete: true }]))).toThrow(
      /never written at runtime/,
    );
    expect(() => parseManifest('m.json', manifest('m', [{ name: 't', class: 'TENANT', runtimeReadOnly: true }]))).toThrow(
      /GLOBAL and SYSTEM tables only/,
    );
    expect(() => parseManifest('audit.json', manifest('audit', [{ name: 't', class: 'SYSTEM', stdColumns: true }]))).toThrow(
      /outside the standard-columns guard/,
    );
    expect(parseManifest('m.json', manifest('m', [{ name: 't', class: 'TENANT', stdColumns: true }]))[0]).toEqual({
      module: 'm',
      name: 't',
      class: 'TENANT',
      stdColumns: true,
    });
  });

  it('[SEC-TC-74] the guard function template: plpgsql, invoker, fixed path, actor through the helper only, assertion only, migrator exemption, P0001 STD_COLUMNS_VIOLATION naming column and table', () => {
    const sql = collapse(renderStdColumnsGuardFunction());
    expect(
      sql.startsWith(
        'CREATE FUNCTION platform.std_columns_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$',
      ),
    ).toBe(true);
    expect(sql).toContain("IF current_user = 'platform_migrator' THEN RETURN NEW; END IF;");
    expect(sql).toContain('v_actor := COALESCE(platform.app_actor_id(), c_anonymous);');
    expect(sql).toContain("c_anonymous constant uuid := '00000000-0000-7000-8000-000000000002'");
    expect(sql).toContain(
      "RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = pg_catalog.format('STD_COLUMNS_VIOLATION: %s on %s.%s (%s)', v_column, TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP);",
    );
    expect(sql).not.toMatch(/SECURITY DEFINER|current_setting|set_config|CREATE OR REPLACE/i);
  });

  it.each([
    [
      'SECURITY DEFINER',
      (sql: string) => sql.replace('LANGUAGE plpgsql', 'LANGUAGE plpgsql SECURITY DEFINER'),
      /must not be SECURITY DEFINER/,
    ],
    ['a missing fixed path', (sql: string) => sql.replace('SET search_path = pg_catalog, pg_temp', ''), /fixed search path/],
    [
      'a raw current_setting read',
      (sql: string) => sql.replace('COALESCE(platform.app_actor_id()', "COALESCE(current_setting('app.actor_id', true)::uuid"),
      /through platform.app_actor_id\(\) only/,
    ],
    [
      'an assignment to NEW',
      (sql: string) => sql.replace('RETURN NEW;\nEND $$;', 'NEW.version := 1;\n  RETURN NEW;\nEND $$;'),
      /asserts and never assigns/,
    ],
    [
      'CREATE OR REPLACE',
      (sql: string) => sql.replace('CREATE FUNCTION platform.', 'CREATE OR REPLACE FUNCTION platform.'),
      /plain CREATE FUNCTION/,
    ],
  ])('refuses a guard function template with %s', (_label, mutate, error) => {
    const dir = mkdtempSync(join(tmpdir(), 'std-guard-'));
    work.push(dir);
    writeFileSync(join(dir, 'std-columns-guard.sql'), mutate(readFileSync(join(FUNCTION_TEMPLATE_DIR, 'std-columns-guard.sql'), 'utf8')));
    expect(() => renderStdColumnsGuardFunction(dir)).toThrow(error);
  });
});
