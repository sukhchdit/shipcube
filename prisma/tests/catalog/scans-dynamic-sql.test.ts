/**
 * Unit tests for the dynamic-SQL review keying of the catalog suite (PR43-SEC-06 d; scans.ts): the reviewed list binds
 * the signature AND the SHA-256 of the normalised body.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { ESCAPE_STRING_MARK } from '../../../tools/db/sql-text.js';
import { bodySha256, bodyText, dynamicSqlFindings, normaliseBody, scanFunctionBodies, type ReviewedBody } from './scans.js';

describe('catalog scans: bodyText keeps the escape-string mark (PR293-SEC-02; TASK-293 code review R3-M1)', () => {
  // A PL/pgSQL prosrc whose EXECUTE literal is an E-string continued on a new line: it does not lex (refused), and the
  // fallback must still mark it, so the prosrc scan names the form instead of reading the raw text as clean.
  const continued = "\nBEGIN\n  EXECUTE E'SELECT s\\x65t_config(\\x27\\x61pp.org_id\\x27, $1, true)'\n  '';\nEND\n";

  it('a body holding a continued E-string is marked and reported as an E-prefixed escape string; a body that does not lex for another reason is kept raw', () => {
    expect(bodyText(continued).startsWith(ESCAPE_STRING_MARK)).toBe(true);
    expect(scanFunctionBodies([{ fn: 'public.f(uuid)', prosrc: continued }])).toEqual(['public.f(uuid): E-prefixed escape string']);
    expect(bodyText("BEGIN RAISE NOTICE 'open; END")).toBe("BEGIN RAISE NOTICE 'open; END");
  });

  it('controls: an uncontinued E-string is marked by sqlText itself; a plain body has no mark', () => {
    expect(bodyText("BEGIN EXECUTE E'SELECT 1'; END")).toContain(ESCAPE_STRING_MARK);
    expect(bodyText("BEGIN EXECUTE 'SELECT 1'; END")).not.toContain(ESCAPE_STRING_MARK);
  });
});

describe('catalog scans: dynamic-SQL review keying (PR43-SEC-06 d)', () => {
  it('normaliseBody collapses every whitespace run (CR/LF, tabs) to one space and trims', () => {
    expect(normaliseBody('\r\n  BEGIN\r\n\tEXECUTE   p;\nEND \n')).toBe('BEGIN EXECUTE p; END');
    expect(bodySha256('BEGIN EXECUTE p; END')).toBe(createHash('sha256').update('BEGIN EXECUTE p; END', 'utf8').digest('hex'));
    expect(bodySha256(' BEGIN\n EXECUTE p; END')).toBe(bodySha256('BEGIN EXECUTE p; END'));
  });

  it('names an unreviewed signature and a reviewed signature whose body changed; a reviewed, unchanged body is clean', () => {
    const reviewed = new Map<string, ReviewedBody>([['public.f(text)', { sha256: bodySha256('BEGIN EXECUTE p; END'), reason: 'unit' }]]);
    expect(dynamicSqlFindings([{ fn: 'public.f(text)', body: '\nBEGIN  EXECUTE p;\nEND\n' }], reviewed)).toEqual([]);
    expect(dynamicSqlFindings([{ fn: 'public.g(text)', body: 'BEGIN EXECUTE p; END' }], reviewed)).toEqual([
      'public.g(text): not reviewed',
    ]);
    expect(dynamicSqlFindings([{ fn: 'public.f(text)', body: 'BEGIN EXECUTE p || q; END' }], reviewed)).toEqual([
      `public.f(text): body sha256 ${bodySha256('BEGIN EXECUTE p || q; END')} is not the reviewed ${bodySha256('BEGIN EXECUTE p; END')}`,
    ]);
  });
});
