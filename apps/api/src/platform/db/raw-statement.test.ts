/**
 * PR44-SEC-05 (TASK-020 part 020-D): the run-time twin of the raw-statement classifier (the TenantDb guard) against
 * the shared corpus tests/fixtures/sql/raw-statement-corpus.json, which tools/lint/raw-sql-lexer.test.ts runs through
 * the lint twin: a case one twin changes fails the other twin's suite. The corpus is JSON (not linted), so it may
 * spell the setter and Unicode-escape forms that platform/tenant-context-sql refuses in this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { refusedRawStatement, refusedRawText } from './raw-statement.js';

interface CorpusCase {
  readonly sql: string;
  readonly verdict: string;
}
interface Corpus {
  readonly cases: readonly CorpusCase[];
  readonly readOnlyAllowance: readonly CorpusCase[];
}

const CORPUS_FILE = join(import.meta.dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'sql', 'raw-statement-corpus.json');
const corpus = JSON.parse(readFileSync(CORPUS_FILE, 'utf8')) as Corpus;

describe('[PR44-SEC-05] raw-statement classifier, TenantDb twin (shared corpus)', () => {
  it('reads the shared corpus', () => {
    expect(corpus.cases.length).toBeGreaterThan(50);
  });

  it.each(corpus.cases.map((entry) => [entry.sql, entry.verdict] as const))('%j -> %s', (sql, verdict) => {
    expect(refusedRawText(sql)?.form ?? 'ok').toBe(verdict);
  });

  it.each(corpus.readOnlyAllowance.map((entry) => [entry.sql, entry.verdict] as const))(
    'with the read-only allowance: %j -> %s',
    (sql, verdict) => {
      expect(refusedRawText(sql, { allowReadOnlyTransaction: true })?.form ?? 'ok').toBe(verdict);
    },
  );

  it('joins the template strings with a bind parameter per value, as Prisma sends them', () => {
    expect(refusedRawStatement(['SELECT ', '; COMMIT'])).toEqual({ form: 'transaction-control', detail: 'COMMIT' });
    expect(refusedRawStatement(['SELECT ', ' FROM t'])).toBeUndefined();
  });

  it('refuses a template part that is not a string (an invalid escape has no cooked value)', () => {
    expect(refusedRawStatement(['SELECT ', undefined])).toEqual({ form: 'unreadable', detail: 'a template part with an invalid escape' });
  });

  it('names what could not be read, never the statement text', () => {
    expect(refusedRawText("SELECT 'secret-value")).toEqual({ form: 'unreadable', detail: 'an unterminated string' });
  });
});
