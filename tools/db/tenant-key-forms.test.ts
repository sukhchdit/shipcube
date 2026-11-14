import { describe, expect, it } from '@jest/globals';

import { ESCAPE_STRING_MARK, normalise, sqlText } from './sql-text.js';
import { CONTEXT_DISCARD, CONTEXT_WRITE_FORMS, contextReads, contextWrites } from './tenant-key-forms.js';

// Every evasion form of the PR #11 review (m1) and security review (PR11-SEC-02, probe P-B), in raw and in the
// linter's lowercased/whitespace-collapsed shape. The SQL validity of each form is proven by the C-series fixtures.
const WRITES: readonly string[] = [
  "PERFORM set_config('app.org_id', p, true)",
  "PERFORM set_config('' || 'app.org_id', p, false)",
  "PERFORM set_config('ap' || 'p.org_id', p, true)",
  'PERFORM set_config(k, p, true)',
  "PERFORM set_config(E'app.org_id', p, true)",
  'PERFORM "set_config"(\'app.org_id\', p, true)',
  'PERFORM pg_catalog."set_config"(\'app.org_id\', p, true)',
  "PERFORM set_config('APP.ORG_ID', p, true)",
  'SET app.org_id = 1',
  'SET LOCAL "app".org_id = 1',
  'SET SESSION "app.org_id" = 1',
  'SET app . org_id = 1',
  'set "APP" . "org_id" to 1',
  'RESET "app".org_id',
  'reset app.actor_id',
  "EXECUTE format('SET LOCAL %I = %L', 'app.org_id', p)",
  "EXECUTE 'SET LOCAL ' || k || ' = ' || quote_literal(p)",
  'RESET ALL',
  'UPDATE pg_catalog.pg_settings SET setting = p WHERE name = k',
  // PR11-SEC-14 (a): Unicode escapes spell any form without its text (identifier and string, any case).
  String.raw`SET LOCAL U&"\0061pp".org_id = 1`,
  String.raw`PERFORM U&"\0073et_config"(U&'\0061pp.org_id', p, true)`,
  String.raw`EXECUTE U&'SET LOCAL \0061pp.org_id = ''x'''`,
  String.raw`SHOW u&"\0061pp".actor_scope`,
];

/** PR11-SEC-14 (a): without the Unicode-escape form these match nothing, so it must be the only label. */
const UNICODE_ONLY: readonly string[] = [
  String.raw`SET LOCAL U&"\0061pp".org_id = 1`,
  String.raw`PERFORM U&"\0073et_config"(U&'\0061pp.org_id', p, true)`,
  String.raw`EXECUTE U&'SET LOCAL \0061pp.org_id = ''x'''`,
];

const READS: readonly string[] = [
  "SELECT current_setting('app.org_id', true)",
  "SELECT current_setting('app.' || 'org_id', true)",
  'SELECT current_setting(k, true)',
  'SELECT "current_setting"(k)',
  "EXECUTE format('SHOW %s', 'app.org_id')",
  'SHOW "app".actor_scope',
  'SELECT setting FROM pg_settings WHERE name = \'"app.guest_token_hash"\'',
];

const CLEAN: readonly string[] = [
  "SELECT set_config('search_path', '', false)",
  "PERFORM set_config('statement_timeout', '5s', true)",
  "SELECT current_setting('app.correlation_id', true)",
  "SELECT current_setting('search_path')",
  'UPDATE public.roles SET name = n WHERE id = i',
  'SELECT platform.app_org_id(), platform.app_actor_id(), platform.app_guest_token_hash(), platform.app_is_operator()',
  'ALTER TABLE t SET (fillfactor = 90)',
  "RAISE EXCEPTION 'discard nothing'",
  // `menu&'1'` is the `&` operator after an identifier, not a U& escape.
  "SELECT menu&'1'::int, flags & '3'::int FROM t",
];

describe('tenant-context SQL forms shared by rule 16 and the C-series scan (PR11-SEC-02)', () => {
  it.each(WRITES.flatMap((sql) => [sql, sql.toLowerCase().replace(/\s+/g, ' ')]))('write form: %s', (sql) => {
    expect(contextWrites(sql).length).toBeGreaterThan(0);
  });

  it.each(READS.flatMap((sql) => [sql, sql.toLowerCase().replace(/\s+/g, ' ')]))('read form: %s', (sql) => {
    expect(contextReads(sql).length).toBeGreaterThan(0);
  });

  it.each(CLEAN)('clean: %s', (sql) => {
    expect(contextWrites(sql)).toEqual([]);
    expect(contextReads(sql)).toEqual([]);
  });

  it.each(UNICODE_ONLY)('Unicode escape is a write form on its own (PR11-SEC-14 a): %s', (sql) => {
    expect(contextWrites(sql)).toEqual(['Unicode-escape string or identifier']);
  });

  it('[PR11-SEC-16] the E-string write form matches the sqlText mark only: escape strings anywhere, never lookalikes or raw text', () => {
    const [label, pattern] = CONTEXT_WRITE_FORMS.at(-1) ?? ['', /$^/];
    expect(label).toBe('E-prefixed escape string');
    expect(pattern.test(ESCAPE_STRING_MARK)).toBe(true);
    const forms = (sql: string) => contextWrites(normalise(sqlText(sql, true)));
    expect(forms(String.raw`DO $$ BEGIN EXECUTE E'SELECT 1'; END $$`)).toEqual(['E-prefixed escape string']);
    expect(forms("DO $$ BEGIN EXECUTE 'SELECT e''x'''; END $$")).toEqual(['E-prefixed escape string']);
    expect(forms("SELECT 'abcde', 'a e', date'2026-11-14'")).toEqual([]);
    // Raw text carries no mark: callers pass sqlText(…, true).
    expect(contextWrites("SELECT E'x'")).toEqual([]);
  });

  it('DISCARD forms reset the session; the word in prose does not match', () => {
    expect(['DISCARD ALL', 'discard  temp', 'DISCARD PLANS'].every((sql) => CONTEXT_DISCARD.test(sql))).toBe(true);
    expect(CONTEXT_DISCARD.test('discard nothing')).toBe(false);
  });
});
