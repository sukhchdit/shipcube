/**
 * PR44-SEC-05 / D-ARCH-124 (TASK-020 part 020-D): the lint twin of the raw-statement classifier
 * (tools/eslint-rules/raw-sql-lexer.mjs) against the shared corpus tests/fixtures/sql/raw-statement-corpus.json, which
 * apps/api/src/platform/db/raw-statement.test.ts runs through the TenantDb run-time twin: a case one twin changes
 * fails the other twin's suite. The corpus is JSON (not linted), so it may spell the setter and Unicode-escape forms
 * that platform/tenant-context-sql refuses in this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { identifiersOf, lexSql, refusedStatement, statementsOf, templateText } from '../eslint-rules/raw-sql-lexer.mjs';
import { namedSystemTables } from '../eslint-rules/system-model-owner.mjs';

interface CorpusCase {
  readonly sql: string;
  readonly verdict: string;
  readonly note?: string;
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

const CORPUS_FILE = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'sql', 'raw-statement-corpus.json');
const corpus = JSON.parse(readFileSync(CORPUS_FILE, 'utf8')) as Corpus;
const verdictOf = (sql: string, allowReadOnlyTransaction = false): string =>
  refusedStatement(sql, { allowReadOnlyTransaction })?.form ?? 'ok';

describe('[PR44-SEC-05] raw-statement classifier, lint twin (shared corpus)', () => {
  it('the corpus covers every refused form and the residuals', () => {
    expect(new Set(corpus.cases.map((entry) => entry.verdict))).toEqual(
      new Set(['ok', 'transaction-control', 'session', 'anonymous-block', 'session-setter', 'unreadable']),
    );
    expect(corpus.cases.filter((entry) => entry.note?.startsWith('residual')).length).toBeGreaterThanOrEqual(3);
  });

  it.each(corpus.cases.map((entry) => [entry.sql, entry.verdict] as const))('%j -> %s', (sql, verdict) => {
    expect(verdictOf(sql)).toBe(verdict);
  });

  it.each(corpus.templates.map((entry) => [entry.strings, entry.verdict] as const))(
    '[PR54-SEC-01] template %j -> %s',
    (strings, verdict) => {
      expect(verdictOf(templateText(strings) ?? '')).toBe(verdict);
    },
  );

  it.each(corpus.readOnlyAllowance.map((entry) => [entry.sql, entry.verdict] as const))(
    'with the withTenantTx read-only allowance: %j -> %s',
    (sql, verdict) => {
      expect(verdictOf(sql, true)).toBe(verdict);
    },
  );

  it('names the refused keyword', () => {
    expect(refusedStatement('SELECT 1; rollback')).toEqual({ form: 'transaction-control', detail: 'ROLLBACK' });
    expect(refusedStatement('discard all')).toEqual({ form: 'session', detail: 'DISCARD' });
  });

  it.each(corpus.cases.flatMap((entry) => (entry.detail === undefined ? [] : [[entry.sql, entry.detail] as const])))(
    '%j is refused naming %j',
    (sql, detail) => {
      expect(refusedStatement(sql)?.detail).toBe(detail);
    },
  );

  it('[PR54-SEC-06] classifies deeply nested setter calls in linear time', () => {
    const { open, inner, close, depth } = corpus.linearTime;
    const text = `SELECT ${open.repeat(depth)}${inner}${close.repeat(depth)}`;
    const started = performance.now();
    // Every level is a transaction-local setter, so every level is checked (the worst case).
    expect(refusedStatement(text)).toBeUndefined();
    // Quadratic classification took ~77 s at 32 000 levels (PR54-SEC-06); linear takes well under a second.
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe('[PR44-SEC-05] [D-ARCH-124] raw-SQL lexer', () => {
  it('folds unquoted words to lower case, keeps quoted identifiers, drops comments and keeps parameters', () => {
    expect(lexSql('SELECT "Mixed""Case" FROM Public.T -- x\n WHERE a = $12 /* y */;').tokens).toEqual([
      { kind: 'word', value: 'select' },
      { kind: 'quoted', value: 'Mixed"Case' },
      { kind: 'word', value: 'from' },
      { kind: 'word', value: 'public' },
      { kind: 'punct', value: '.' },
      { kind: 'word', value: 't' },
      { kind: 'word', value: 'where' },
      { kind: 'word', value: 'a' },
      { kind: 'punct', value: '=' },
      { kind: 'param', value: '$12' },
      { kind: 'punct', value: ';' },
    ]);
  });

  it('reads string forms as strings (doubled quotes, prefixes, dollar quotes) and a lone $ as punctuation', () => {
    expect(lexSql("'a''b' e'c' $t$d$t$ $$e$$ $").tokens).toEqual([
      { kind: 'string', value: "a'b" },
      { kind: 'string', value: 'c' },
      { kind: 'string', value: 'd' },
      { kind: 'string', value: 'e' },
      { kind: 'punct', value: '$' },
    ]);
  });

  it('[PR54-SEC-01] a line comment ends at CR; a string continued across a newline is one token in its own mode', () => {
    expect(lexSql('SELECT 1 -- x\rFROM t').tokens.map((token) => token.value)).toEqual(['select', '1', 'from', 't']);
    expect(lexSql("E'a'\n'\\'b' 'c' 'd'\r\n  -- e\n'f'").tokens).toEqual([
      { kind: 'string', value: "a\\'b" },
      { kind: 'string', value: 'c' },
      { kind: 'string', value: 'df' },
    ]);
  });

  it('a line comment at the end of the text ends the text', () => {
    expect(lexSql('SELECT 1 -- trailing').tokens.map((token) => token.value)).toEqual(['select', '1']);
  });

  it('templateText binds each value as a parameter and refuses a part without a cooked value', () => {
    expect(templateText(['SELECT ', ' + ', ''])).toBe('SELECT $1 + $2');
    expect(templateText(['SELECT $q', '$q$'])).toBe('SELECT $q$1$q$');
    expect(templateText(['SELECT ', undefined])).toBeUndefined();
    expect(templateText(['SELECT ', null])).toBeUndefined();
  });

  it('statementsOf splits at top-level semicolons and drops empty statements', () => {
    expect(statementsOf(lexSql(';SELECT 1;; SELECT 2;').tokens).map((statement) => statement.map((token) => token.value))).toEqual([
      ['select', '1'],
      ['select', '2'],
    ]);
  });

  it('identifiersOf returns the words and quoted identifiers, not strings, parameters or punctuation', () => {
    expect(identifiersOf(lexSql(`SELECT "Audit_Entries", x FROM t WHERE y = 'z' AND w = $1`).tokens)).toEqual([
      'select',
      'Audit_Entries',
      'x',
      'from',
      't',
      'where',
      'y',
      'and',
      'w',
    ]);
  });
});

describe('[D-ARCH-124] namedSystemTables', () => {
  const tables = new Map([
    ['audit_entries', 'audit'],
    ['outbox_events', 'outbox'],
  ]);

  it('maps a monthly partition to its table and reports each table once, in order of first mention', () => {
    expect(namedSystemTables(['outbox_events', 'audit_entries_2026_11', 'audit_entries', 'orders'], tables)).toEqual([
      'outbox_events',
      'audit_entries',
    ]);
  });

  it('ignores longer names, other partition shapes and other-case quoted names', () => {
    expect(namedSystemTables(['audit_entries_count', 'audit_entries_2026', 'Audit_Entries', 'orders_2026_11'], tables)).toEqual([]);
  });
});
