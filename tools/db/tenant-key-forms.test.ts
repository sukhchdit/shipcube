import { describe, expect, it } from '@jest/globals';

import { CONTEXT_DISCARD, contextReads, contextWrites } from './tenant-key-forms.js';

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

  it('DISCARD forms reset the session; the word in prose does not match', () => {
    expect(['DISCARD ALL', 'discard  temp', 'DISCARD PLANS'].every((sql) => CONTEXT_DISCARD.test(sql))).toBe(true);
    expect(CONTEXT_DISCARD.test('discard nothing')).toBe(false);
  });
});
