/**
 * Drift guard between the two lexical twins of the tenant-context form list (R2-m2, PR11-SEC-15 g; TASK-016): the
 * TypeScript-side ESLint rule `platform/tenant-context-sql` (tools/eslint-rules/tenant-context-sql.mjs) and the SQL
 * lanes' shared list (tools/db/tenant-key-forms.ts: migration-linter rule 16 and the C-series `prosrc` scan). One
 * probe corpus runs through both; they must agree on every sample:
 *  - the rule's `session-set` form <-> `CONTEXT_WRITE_FORMS[1]` (SET/RESET of an app. setting, any quoting/spacing);
 *  - the rule's `keys` form <-> `CONTEXT_READ_FORMS[0]` (a mention of a security key, any quoting/spacing);
 *  - every sample the SQL lanes report as a context-setter write is reported by the rule's `setter` (or
 *    `session-set-config`) form too (the rule's setter form is deliberately broader: any mention of the setter).
 *
 * This file is itself linted by `platform/tenant-context-sql` with no exemption, so the corpus spells the namespace
 * as `{A}` and the setter as `{S}`; `expand` substitutes them at run time.
 */
import { describe, expect, it } from '@jest/globals';

import { CONTEXT_READ_FORMS, CONTEXT_WRITE_FORMS, contextReads, contextWrites } from '../db/tenant-key-forms.js';
import { FORMS } from '../eslint-rules/tenant-context-sql.mjs';

const SETTER_NAME = ['set', 'config'].join('_');
const expand = (sample: string): string => sample.replaceAll('{A}', 'app').replaceAll('{S}', SETTER_NAME);

const eslintForm = (form: string): RegExp => {
  const entry = FORMS.find((candidate) => candidate.form === form);
  if (entry === undefined) throw new Error(`platform/tenant-context-sql has no form ${form}`);
  return entry.pattern;
};

const SESSION_SET = eslintForm('session-set');
const KEYS = eslintForm('keys');
const SETTER = eslintForm('setter');
const SESSION_SET_CONFIG = eslintForm('session-set-config');

const labelOf = (form: (typeof CONTEXT_WRITE_FORMS)[number] | undefined): string => {
  if (form === undefined) throw new Error('tenant-key-forms.ts lost a form this test relies on');
  return form[0];
};
const SETTER_WRITE = labelOf(CONTEXT_WRITE_FORMS[0]);
const SET_WRITE = labelOf(CONTEXT_WRITE_FORMS[1]);
const KEY_READ = labelOf(CONTEXT_READ_FORMS[0]);

/** [sample (with `{A}` / `{S}` placeholders), is a SET/RESET of an app. setting, mentions a security key]. */
const CORPUS: readonly (readonly [sample: string, write: boolean, key: boolean])[] = [
  // Round-1 forms.
  ['SET {A}.org_id = 1', true, true],
  ['set session {A}.actor_id = 1', true, true],
  ['SET LOCAL {A}.org_id = 1', true, true],
  ['RESET {A}.guest_token_hash', true, true],
  ["SELECT {S}('{A}.org_id', $1, true)", false, true],
  ["SELECT {S}('{A}.org_id', $1, false)", false, true],
  ["SELECT current_setting('{A}.actor_scope', true)", false, true],
  ['SHOW {A}.org_id', false, true],
  // R2-m2: quoted and spaced GUC names.
  ['SET "{A}"."org_id" = 1', true, true],
  ['SET {A} . org_id = 1', true, true],
  ['SET "{A}.org_id" = 1', true, true],
  ['RESET "{A}".x', true, false],
  ['SET SESSION "{A}" . "actor_id" TO DEFAULT', true, true],
  ['set   local\n  {A}.correlation_id = 1', true, false],
  ['SELECT "{A}.guest_token_hash"', false, true],
  // Benign controls.
  ["SELECT current_setting('{A}.correlation_id')", false, false],
  ["SELECT {S}('search_path', '', false)", false, false],
  ['SET search_path TO public', false, false],
  ['SET LOCAL statement_timeout = 1000', false, false],
  ['RESET ALL', false, false],
  ['SELECT my{A}.org_id FROM t', false, false],
  ['SELECT {A}.org_identity FROM t', false, false],
  ['SELECT {A}_org_id FROM t', false, false],
  ['SELECT 1', false, false],
];

describe('tenant-context form twins agree (R2-m2: eslint rule vs tools/db/tenant-key-forms.ts)', () => {
  it.each(CORPUS)('%j (write %s, key %s)', (sample, write, key) => {
    const text = expand(sample);
    expect({
      eslintWrite: SESSION_SET.test(text),
      sqlWrite: contextWrites(text).includes(SET_WRITE),
      eslintKey: KEYS.test(text),
      sqlKey: contextReads(text).includes(KEY_READ),
    }).toEqual({ eslintWrite: write, sqlWrite: write, eslintKey: key, sqlKey: key });
  });

  it('every setter write the SQL lanes report is reported by the eslint rule', () => {
    const setterWrites = CORPUS.map(([sample]) => expand(sample)).filter((text) => contextWrites(text).includes(SETTER_WRITE));
    expect(setterWrites.length).toBeGreaterThan(0);
    expect(setterWrites.filter((text) => !SETTER.test(text) && !SESSION_SET_CONFIG.test(text))).toEqual([]);
  });

  it('the twins are the patterns this test names (sources pinned to the shared list)', () => {
    expect(SESSION_SET.source).toBe(CONTEXT_WRITE_FORMS[1]?.[1].source);
    expect(KEYS.source).toBe(CONTEXT_READ_FORMS[0]?.[1].source);
  });
});
