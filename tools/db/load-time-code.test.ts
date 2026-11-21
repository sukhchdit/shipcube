/**
 * Load-time code (data-model §4.6 C17, §8.6 second amendment; D-ARCH-236; PR034-SEC-01; TASK-034 fix cycle 3): the
 * query is the reviewed text of the data model, and the finding rule with fake rows. The PostgreSQL 18 run of the query,
 * with planted probes, is prisma/tests/catalog/c17-load-time-code.int.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  LOAD_TIME_CODE_SQL,
  REVIEWED_NON_IMMUTABLE_BUILTINS,
  describeFinding,
  loadTimeCodeFindings,
  unusedReviewedBuiltins,
  type LoadTimeCodeRow,
} from './load-time-code.js';
import { stripComments } from './sql-text.js';
import { findRepoRoot } from '../test-support/process.js';

/** Comments removed, whitespace collapsed, the final `;` dropped. */
const comparable = (sql: string): string => stripComments(sql).replace(/\s+/g, ' ').trim().replace(/ ?;$/, '');

/** The fenced SQL block of data-model §8.6 that starts with `-- C17: load-time code`. */
function designSql(): string {
  const text = readFileSync(join(findRepoRoot(), 'docs', '03-architecture', 'data-model.md'), 'utf8');
  const blocks = [...text.matchAll(/```sql\n([\s\S]*?)```/g)]
    .map((match) => match[1] ?? '')
    .filter((sql) => sql.startsWith('-- C17: load-time code'));
  if (blocks.length !== 1) throw new Error(`data-model §8.6: expected one C17 block, found ${String(blocks.length)}`);
  return blocks[0] as string;
}

const row = (overrides: Partial<LoadTimeCodeRow>): LoadTimeCodeRow => ({
  kind: 'table check',
  object: 'public.t ck_t',
  via: 'call',
  reference: 'random()',
  reason: 'not immutable',
  ...overrides,
});

describe('LOAD_TIME_CODE_SQL (D-ARCH-236)', () => {
  it('[C17] equals the query of data-model §8.6 (comments removed, whitespace collapsed, the final semicolon dropped)', () => {
    expect(comparable(LOAD_TIME_CODE_SQL)).toBe(comparable(designSql()));
  });

  it('[C17] reads the stored expression trees of the four call sites, and the range types, schema-qualified', () => {
    for (const source of ['c.conbin', 'ad.adbin', 'pt.partexprs', 'pg_catalog.pg_range']) expect(LOAD_TIME_CODE_SQL).toContain(source);
    for (const field of [':funcid ', ':opfuncid ', ':opno ']) expect(LOAD_TIME_CODE_SQL).toContain(field);
    expect(LOAD_TIME_CODE_SQL).not.toMatch(/pg_depend d\b|refclassid/); // the record's pg_depend form misses built-ins
    expect(LOAD_TIME_CODE_SQL).toMatch(/OR \(r\.via = 'call' AND p\.provolatile <> 'i'\)/);
  });
});

describe('the finding rule (D-ARCH-236 item 1)', () => {
  it('[C17] the reviewed list starts empty and is an exact-key map', () => {
    expect(REVIEWED_NON_IMMUTABLE_BUILTINS).toBeInstanceOf(Map);
    expect(REVIEWED_NON_IMMUTABLE_BUILTINS.size).toBe(0);
  });

  it('[C17] every row is a finding with the shipped (empty) list, without the via column', () => {
    const rows = [
      row({}),
      row({ kind: 'generated column', object: 'public.t.g', reference: 'public.w(integer)', reason: 'not built in' }),
      row({ kind: 'partition key', object: 'public.p', via: 'operator', reference: 'unknown routine', reason: 'unknown routine' }),
      row({ kind: 'range type', object: 'public.r', via: 'type', reference: 'public.r', reason: 'range type outside an extension' }),
    ];
    expect(loadTimeCodeFindings(rows)).toEqual(rows.map(({ kind, object, reference, reason }) => ({ kind, object, reference, reason })));
    expect(describeFinding(loadTimeCodeFindings(rows)[1] as never)).toBe('generated column public.t.g: public.w(integer) (not built in)');
  });

  it('[C17] a reviewed entry excuses a "not immutable" row of exactly that regprocedure, and nothing else', () => {
    const reviewed = new Map([
      ['date_trunc(text,timestamp with time zone)', 'reviewed: stable in the session time zone, which the loader pins'],
    ]);
    const rows = [
      row({ reference: 'date_trunc(text,timestamp with time zone)' }),
      row({ reference: 'date_trunc(text,timestamp without time zone)' }), // another signature
      row({ reference: 'date_trunc(text,timestamp with time zone)', reason: 'not built in' }), // never excused
      row({ reference: 'date_trunc(text,timestamp with time zone)', reason: 'something new' }), // fail closed
    ];
    expect(loadTimeCodeFindings(rows, reviewed).map((finding) => [finding.reference, finding.reason])).toEqual([
      ['date_trunc(text,timestamp without time zone)', 'not immutable'],
      ['date_trunc(text,timestamp with time zone)', 'not built in'],
      ['date_trunc(text,timestamp with time zone)', 'something new'],
    ]);
  });

  it('[C17] an entry that no "not immutable" row uses is reported as unused (the list cannot carry stale exceptions)', () => {
    const reviewed = new Map([
      ['random()', 'reason'],
      ['clock_timestamp()', 'reason'],
    ]);
    expect(
      unusedReviewedBuiltins([row({ reference: 'random()' }), row({ reference: 'clock_timestamp()', reason: 'not built in' })], reviewed),
    ).toEqual(['clock_timestamp()']);
    expect(unusedReviewedBuiltins([row({})])).toEqual([]);
  });
});
