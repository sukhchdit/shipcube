/**
 * PR44-SEC-05 (TASK-020 part 020-D): the run-time twin of the raw-statement classifier (the TenantDb guard) against
 * the shared corpus tests/fixtures/sql/raw-statement-corpus.json, which tools/lint/raw-sql-lexer.test.ts runs through
 * the lint twin: a case one twin changes fails the other twin's suite. The corpus is JSON (not linted), so it may
 * spell the setter and Unicode-escape forms that platform/tenant-context-sql refuses in this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { prismaText, refusedRawStatement, refusedRawText } from './raw-statement.js';

interface CorpusCase {
  readonly sql: string;
  readonly verdict: string;
  /** When present, the refusal's detail (the same in both twins). */
  readonly detail?: string;
}
interface TemplateCase {
  readonly strings: readonly string[];
  readonly verdict: string;
}
interface Corpus {
  readonly cases: readonly CorpusCase[];
  readonly templates: readonly TemplateCase[];
  readonly linearTime: { readonly open: string; readonly inner: string; readonly close: string; readonly depth: number };
  readonly readOnlyAllowance: readonly CorpusCase[];
}

const CORPUS_FILE = join(import.meta.dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'sql', 'raw-statement-corpus.json');
const corpus = JSON.parse(readFileSync(CORPUS_FILE, 'utf8')) as Corpus;

describe('[PR44-SEC-05] raw-statement classifier, TenantDb twin (shared corpus)', () => {
  it('reads the shared corpus', () => {
    expect(corpus.cases.length).toBeGreaterThan(100);
    expect(corpus.templates.length).toBeGreaterThan(10);
  });

  it.each(corpus.cases.map((entry) => [entry.sql, entry.verdict] as const))('%j -> %s', (sql, verdict) => {
    expect(refusedRawText(sql)?.form ?? 'ok').toBe(verdict);
  });

  it.each(corpus.cases.flatMap((entry) => (entry.detail === undefined ? [] : [[entry.sql, entry.detail] as const])))(
    '%j is refused naming %j',
    (sql, detail) => {
      expect(refusedRawText(sql)?.detail).toBe(detail);
    },
  );

  it.each(corpus.templates.map((entry) => [entry.strings, entry.verdict] as const))(
    '[PR54-SEC-01] template %j -> %s',
    (strings, verdict) => {
      expect(refusedRawStatement(strings)?.form ?? 'ok').toBe(verdict);
    },
  );

  it.each(corpus.readOnlyAllowance.map((entry) => [entry.sql, entry.verdict] as const))(
    'with the read-only allowance: %j -> %s',
    (sql, verdict) => {
      expect(refusedRawText(sql, { allowReadOnlyTransaction: true })?.form ?? 'ok').toBe(verdict);
    },
  );

  it("[PR54-SEC-01] renders a template as Prisma's Sql#text: $1, $2, ... and no spaces", () => {
    expect(prismaText(['SELECT ', ' + ', ''])).toBe('SELECT $1 + $2');
    expect(prismaText(['SELECT $q', '$q$'])).toBe('SELECT $q$1$q$');
    expect(prismaText(['SELECT 1'])).toBe('SELECT 1');
    expect(refusedRawStatement(['SELECT ', '; COMMIT'])).toEqual({ form: 'transaction-control', detail: 'COMMIT' });
    expect(refusedRawStatement(['SELECT ', ' FROM t'])).toBeUndefined();
  });

  it('refuses a template part that is not a string (an invalid escape has no cooked value)', () => {
    expect(refusedRawStatement(['SELECT ', undefined])).toEqual({ form: 'unreadable', detail: 'a template part with an invalid escape' });
  });

  it('names what could not be read, never the statement text', () => {
    expect(refusedRawText("SELECT 'secret-value")).toEqual({ form: 'unreadable', detail: 'an unterminated string' });
  });

  it('[PR54-SEC-06] classifies deeply nested setter calls in linear time', () => {
    const { open, inner, close, depth } = corpus.linearTime;
    const text = `SELECT ${open.repeat(depth)}${inner}${close.repeat(depth)}`;
    const started = performance.now();
    // Every level is a transaction-local setter, so every level is checked (the worst case).
    expect(refusedRawText(text)).toBeUndefined();
    // Quadratic classification took ~77-101 s at 32 000 levels (PR54-SEC-06); linear takes well under a second.
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
