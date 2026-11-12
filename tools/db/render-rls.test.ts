import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  POLICY_TEMPLATE_DIR,
  RenderRlsError,
  TEMPLATE_NAMES,
  blocksFor,
  checkPredicate,
  loadPolicyTemplates,
  main,
  renderGuestCapableGuardFunction,
  renderModule,
  renderRls,
  validateTemplate,
} from './render-rls.js';
import type { TableClassEntry } from './table-classes.js';

const entry = (name: string, tableClass: TableClassEntry['class'], extra: Partial<TableClassEntry> = {}): TableClassEntry => ({
  module: 'probe',
  name,
  class: tableClass,
  ...extra,
});

const templates = loadPolicyTemplates();
const work: string[] = [];
afterAll(() => work.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('RLS renderer (data-model §4.3, ADR-0005 am. 10 item 7)', () => {
  it('renders the TENANT block: ENABLE + FORCE, tenant ALL policy on org_id, read-only operator policy', () => {
    expect(renderRls(entry('shipments', 'TENANT'), templates)).toBe(
      [
        '-- RLS for public.shipments (TENANT), module probe: rendered by tools/db/render-rls.ts from prisma/sql/policy-templates; do not edit.',
        'ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE public.shipments FORCE ROW LEVEL SECURITY;',
        '',
        'CREATE POLICY p_shipments__tenant ON public.shipments',
        '  FOR ALL TO platform_app',
        '  USING      (org_id = platform.app_org_id())',
        '  WITH CHECK (org_id = platform.app_org_id());',
        '',
        'CREATE POLICY p_shipments__operator ON public.shipments',
        '  FOR SELECT TO platform_app',
        "  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());",
        '',
      ].join('\n'),
    );
  });

  it('renders GUEST_CAPABLE with the guest branch and the no-de-claim BEFORE UPDATE trigger (PR7-SEC-04)', () => {
    const sql = renderRls(entry('quotes', 'GUEST_CAPABLE', { definerRead: true }), templates);
    expect(sql).toContain('CREATE POLICY p_quotes__guest ON public.quotes');
    expect(sql).toContain('USING      (org_id IS NULL AND guest_token_hash = platform.app_guest_token_hash())');
    expect(sql).toContain('CREATE TRIGGER tg_quotes__guest_capable_guard\n  BEFORE UPDATE ON public.quotes');
    expect(sql).toContain('GRANT SELECT ON public.quotes TO platform_definer;');
    expect(sql.split('\n')[0]).toContain('(GUEST_CAPABLE; definerRead)');
    expect(sql).not.toContain('--  ');
  });

  it('renders USER_OWNED with the own-row policy and both definer policies for purge tables', () => {
    const sql = renderRls(entry('refresh_tokens', 'USER_OWNED', { definerRead: true, definerPurge: true }), templates);
    expect(sql).toContain('USING      (user_id = platform.app_actor_id())');
    expect(sql).toContain("USING (expires_at < now() - interval '7 days');");
    expect(sql).toContain('GRANT DELETE ON public.refresh_tokens TO platform_definer;');
    expect(sql).not.toContain('org_id');
    expect(blocksFor({ class: 'USER_OWNED', definerRead: true, definerPurge: true })).toEqual([
      'enable-force',
      'user-owned',
      'operator',
      'definer-read',
      'definer-purge',
    ]);
  });

  it('is deterministic and uses the default templates when none are passed', () => {
    const table = entry('orders', 'TENANT');
    expect(renderRls(table)).toBe(renderRls(table, templates));
  });

  it.each([
    ['a GLOBAL table', entry('roles', 'GLOBAL'), /class GLOBAL has no RLS block/],
    ['a SYSTEM table', entry('outbox_events', 'SYSTEM'), /class SYSTEM has no RLS block/],
    ['an uppercase name', entry('Orders', 'TENANT'), /not a lowercase SQL identifier/],
    ['an injected name', entry('t; DROP TABLE x', 'TENANT'), /not a lowercase SQL identifier/],
    ['a 64-byte name', entry('t'.repeat(64), 'TENANT'), /not a lowercase SQL identifier/],
    ['a policy name PostgreSQL would truncate', entry('t'.repeat(55), 'TENANT'), /longer than 63 bytes/],
    ['definerPurge without definerRead', entry('tokens', 'USER_OWNED', { definerPurge: true }), /definerPurge requires definerRead/],
  ])('refuses %s', (_label, table, error) => {
    expect(() => renderRls(table, templates)).toThrow(RenderRlsError);
    expect(() => renderRls(table, templates)).toThrow(error);
  });

  it('renders every RLS table of a module manifest and skips its GLOBAL/SYSTEM tables', () => {
    const entries = [
      entry('a_items', 'TENANT'),
      entry('b_ref', 'GLOBAL'),
      entry('c_own', 'USER_OWNED'),
      { ...entry('x', 'TENANT'), module: 'other' },
    ];
    const sql = renderModule('probe', entries, templates);
    expect(sql).toContain('public.a_items');
    expect(sql).toContain('public.c_own');
    expect(sql).not.toContain('b_ref');
    expect(sql).not.toContain('public.x ');
    expect(() => renderModule('missing', entries, templates)).toThrow(/no manifest lists module "missing"/);
    expect(renderModule('probe', [entry('only_ref', 'GLOBAL')], templates)).toBe('');
  });

  it('renders the guard function once, not SECURITY DEFINER, with the fixed search path and the widened conditions', () => {
    const sql = renderGuestCapableGuardFunction();
    expect(sql).toContain('CREATE FUNCTION platform.guest_capable_guard() RETURNS trigger');
    expect(sql).toContain('SET search_path = pg_catalog, pg_temp AS $$');
    expect(sql).toContain('OLD.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM OLD.org_id');
    expect(sql).toContain('NEW.guest_token_hash IS NOT NULL AND NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash');
    expect(sql).toContain("ERRCODE = '23514', MESSAGE = 'GUEST_DECLAIM_FORBIDDEN'");
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/);
  });

  it('refuses a guard function template that is SECURITY DEFINER, lacks the fixed path or takes a placeholder', () => {
    const original = readFileSync(join(POLICY_TEMPLATE_DIR, 'guest-capable-guard-function.sql'), 'utf8');
    const variant = (text: string): string => {
      const dir = mkdtempSync(join(tmpdir(), 'rls-guard-'));
      work.push(dir);
      writeFileSync(join(dir, 'guest-capable-guard-function.sql'), text);
      return dir;
    };
    expect(() =>
      renderGuestCapableGuardFunction(variant(original.replace('LANGUAGE plpgsql', 'LANGUAGE plpgsql SECURITY DEFINER'))),
    ).toThrow(/must not be SECURITY DEFINER/);
    expect(() => renderGuestCapableGuardFunction(variant(original.replace('pg_catalog, pg_temp', 'pg_catalog, public')))).toThrow(
      /needs the fixed search path/,
    );
    expect(() => renderGuestCapableGuardFunction(variant(original.replace('TG_TABLE_NAME', "'{{table}}'")))).toThrow(
      /takes no placeholder/,
    );
  });
});

describe('template validation and the predicate allow-list (ADR-0005 am. 10 item 7)', () => {
  it('accepts every committed template', () => {
    for (const name of TEMPLATE_NAMES) {
      expect(() => validateTemplate(name, readFileSync(join(POLICY_TEMPLATE_DIR, `${name}.sql`), 'utf8'))).not.toThrow();
    }
  });

  const policy = (using: string, check: string | null = using, head = 'FOR ALL TO platform_app'): string =>
    `CREATE POLICY p_{{table}}__x ON public.{{table}} ${head} USING (${using})${check === null ? '' : ` WITH CHECK (${check})`};`;

  it.each([
    ['IS DISTINCT FROM', policy('org_id IS NOT DISTINCT FROM platform.app_org_id()'), /forbidden token IS \[NOT\] DISTINCT FROM/],
    ['coalesce', policy("org_id = coalesce(platform.app_org_id(), '00000000-0000-0000-0000-000000000000')"), /forbidden token coalesce/],
    ['<>', policy('org_id <> platform.app_org_id()'), /forbidden token <>/],
    ['!=', policy('org_id != platform.app_org_id()'), /forbidden token !=/],
    ['NOT', policy('NOT (org_id = platform.app_org_id())'), /forbidden token NOT/],
    ['OR', policy('org_id = platform.app_org_id() OR org_id IS NULL'), /forbidden token OR/],
    ['raw current_setting(', policy("org_id = current_setting('app.org_id', true)::uuid"), /raw current_setting\( outside the helpers/],
    ['an unkeyed predicate', policy('org_id IS NULL'), /no keyed atom/],
    ['USING (true) for platform_app', policy('true'), /not on the allow-list: true/],
    ['an unknown atom', policy('org_id = platform.app_org_id() AND id = platform.app_actor_id()'), /not on the allow-list: id =/],
    [
      'half of the operator pair',
      policy(
        "current_setting('app.actor_scope', true) = 'OPERATOR' AND org_id = platform.app_org_id()",
        null,
        'FOR SELECT TO platform_app',
      ),
      /needs both the actor_scope check/,
    ],
    [
      'a writable operator branch',
      policy("current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator()"),
      /operator branch is read-only/,
    ],
    [
      'a definer policy other than USING (true)',
      policy('org_id = platform.app_org_id()', null, 'FOR SELECT TO platform_definer'),
      /not allowed for platform_definer FOR SELECT/,
    ],
    ['a definer write policy', policy('true', null, 'FOR UPDATE TO platform_definer'), /write policy without WITH CHECK/],
    ['a definer INSERT policy', policy('true', 'true', 'FOR INSERT TO platform_definer'), /SELECT or DELETE only/],
    ['a write policy without WITH CHECK', policy('org_id = platform.app_org_id()', null), /write policy without WITH CHECK/],
    [
      'WITH CHECK on SELECT',
      policy('org_id = platform.app_org_id()', 'org_id = platform.app_org_id()', 'FOR SELECT TO platform_app'),
      /WITH CHECK on a SELECT policy/,
    ],
    ['a policy for the migrator', policy('true', null, 'FOR SELECT TO platform_migrator'), /policy header outside the template shape/],
    ['a policy without USING', 'CREATE POLICY p_{{table}}__x ON public.{{table}} FOR SELECT TO platform_app;', /policy without USING/],
    [
      'trailing policy text',
      'CREATE POLICY p_{{table}}__x ON public.{{table}} FOR SELECT TO platform_app USING (true) extra;',
      /unexpected text/,
    ],
    ['unbalanced parentheses', 'CREATE POLICY p_{{table}}__x ON public.{{table}} FOR SELECT TO platform_app USING ((true);', /unbalanced/],
    ['another statement', 'ALTER TABLE public.{{table}} DISABLE ROW LEVEL SECURITY;', /outside the template shapes/],
    ['a GRANT to platform_app', 'GRANT DELETE ON public.{{table}} TO platform_app;', /outside the template shapes/],
    ['an unknown placeholder', 'ALTER TABLE public.{{schema}} ENABLE ROW LEVEL SECURITY;', /unknown placeholder \{\{schema\}\}/],
    ['dollar quoting', 'DO $$ BEGIN END $$;', /dollar quoting/],
    ['an empty template', '-- only a comment\n', /empty/],
    ['a missing semicolon', 'ALTER TABLE public.{{table}} ENABLE ROW LEVEL SECURITY', /must end with ";"/],
  ])('refuses a template with %s', (_label, text, error) => {
    expect(() => validateTemplate('probe', text)).toThrow(RenderRlsError);
    expect(() => validateTemplate('probe', text)).toThrow(error);
  });

  it('refuses a forbidden-token template on disk, so nothing is rendered from it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rls-templates-'));
    work.push(dir);
    for (const name of TEMPLATE_NAMES) writeFileSync(join(dir, `${name}.sql`), readFileSync(join(POLICY_TEMPLATE_DIR, `${name}.sql`)));
    writeFileSync(
      join(dir, 'tenant.sql'),
      'CREATE POLICY p_{{table}}__tenant ON public.{{table}} FOR ALL TO platform_app\n  USING (org_id IS NOT DISTINCT FROM platform.app_org_id())\n  WITH CHECK (org_id IS NOT DISTINCT FROM platform.app_org_id());\n',
    );
    expect(() => loadPolicyTemplates(dir)).toThrow(
      /template tenant statement 1: USING refused \(forbidden token IS \[NOT\] DISTINCT FROM\)/,
    );
  });

  it('allows the documented predicates and nothing wider', () => {
    expect(checkPredicate('org_id = platform.app_org_id()', 'platform_app', 'ALL')).toBeNull();
    expect(checkPredicate('org_id IS NULL AND guest_token_hash = platform.app_guest_token_hash()', 'platform_app', 'ALL')).toBeNull();
    expect(
      checkPredicate("current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator()", 'platform_app', 'SELECT'),
    ).toBeNull();
    expect(checkPredicate("expires_at < now() - interval '7 days'", 'platform_definer', 'DELETE')).toBeNull();
    expect(checkPredicate("expires_at < now() - interval '7 days'", 'platform_definer', 'SELECT')).toMatch(/not allowed/);
    expect(checkPredicate("org_id = platform.app_org_id() AND note = 'a AND b'", 'platform_app', 'ALL')).toMatch(
      /not on the allow-list: note = 'a AND b'/,
    );
  });
});

describe('render-rls CLI', () => {
  const run = (argv: string[], manifestDir?: string): { code: number; out: string; err: string } => {
    let out = '';
    let err = '';
    const code = main(
      argv,
      (text) => (out += text),
      (text) => (err += text),
      manifestDir,
    );
    return { code, out, err };
  };

  it('prints usage without exactly one module argument', () => {
    expect(run([]).code).toBe(2);
    expect(run(['a', 'b']).err).toContain('usage');
  });

  it('renders a module manifest; a module without RLS tables says so; an unknown module fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rls-manifests-'));
    work.push(dir);
    writeFileSync(join(dir, 'probe.json'), JSON.stringify({ module: 'probe', tables: [{ name: 'parcels', class: 'TENANT' }] }));
    expect(run(['probe'], dir)).toEqual({ code: 0, out: renderRls(entry('parcels', 'TENANT'), templates), err: '' });
    expect(run(['authz']).out).toBe('-- module authz has no RLS table\n');
    const missing = run(['nope']);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no manifest lists module "nope"');
  });
});
