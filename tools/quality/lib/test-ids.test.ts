/**
 * Test-ID vocabulary and map readers (TASK-277, T-QA-02; TEST-STRATEGY section 6, D-QA-002), on synthetic text and on
 * the committed maps. Test titles here deliberately carry no test ID: quality:trace would treat them as claims.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../../test-support/process.js';
import {
  MAP_PATHS,
  MapError,
  extractIds,
  idFamily,
  loadStories,
  malformedIds,
  outlineRow,
  parseGherkinMap,
  parseJourneys,
  parseNfrParts,
  parseNfrTraceability,
  parseSecurityCases,
  parseStoryFile,
  readBounded,
  tableCells,
} from './test-ids.mjs';

const repoRoot = findRepoRoot();
const read = (path: string) => readFileSync(join(repoRoot, ...path.split('/')), 'utf8');

describe('extractIds', () => {
  it('finds every family, bracketed or bare, unique and sorted', () => {
    expect(
      extractIds(
        '[AT-US-202-01] [J-M0-03] booking AT-US-131-01-2, NT-PERF-003-a NT-A11Y-001-b NT-I18N-002-a (SEC-TC-38) J-M1-01L AT-US-202-01',
      ),
    ).toEqual(['AT-US-131-01-2', 'AT-US-202-01', 'J-M0-03', 'J-M1-01L', 'NT-A11Y-001-b', 'NT-I18N-002-a', 'NT-PERF-003-a', 'SEC-TC-38']);
  });

  it('is word-bounded and ignores near misses', () => {
    expect(
      extractIds(
        'XAT-US-001-01 AT-US-001-1 AT-US-01-01 AT-US-001-012 NT-PERF-003-ab NT-perf-003-a SEC-TC-1 SEC-TC-001 SEC-01 SEC-P3-08 J-M0-1 AT-US-135-* NT-PERF-001',
      ),
    ).toEqual([]);
    expect(extractIds('SEC-TC-01..64 and AT-US-001-01-a')).toEqual(['AT-US-001-01', 'SEC-TC-01']);
  });

  it('classifies families and outline rows', () => {
    expect(['AT-US-001-01', 'AT-US-001-01-3', 'NT-SEC-007-a', 'SEC-TC-64', 'J-KB-09', 'nope'].map(idFamily)).toEqual([
      'AT',
      'AT',
      'NT',
      'SEC-TC',
      'J',
      undefined,
    ]);
    expect(outlineRow('AT-US-131-01-12')).toEqual({ outline: 'AT-US-131-01', row: 12 });
    expect(outlineRow('AT-US-131-01')).toBeUndefined();
  });
});

describe('NFR Test(s) cells', () => {
  it('expands ranges and `· -x` shorthand, ignoring command flags and back-references', () => {
    expect(parseNfrParts('NT-PERF-003-a..c `k6` · NT-PERF-003-d cache · -e deadline cells')).toEqual([
      'NT-PERF-003-a',
      'NT-PERF-003-b',
      'NT-PERF-003-c',
      'NT-PERF-003-d',
      'NT-PERF-003-e',
    ]);
    expect(parseNfrParts('NT-OPS-001-a `docker compose up -d --wait` · -b `tsc -b` checks')).toEqual(['NT-OPS-001-a', 'NT-OPS-001-b']);
    expect(parseNfrParts('NT-RES-001-a cells · -b..c probes (for -d and -e)')).toEqual(['NT-RES-001-a', 'NT-RES-001-b', 'NT-RES-001-c']);
    expect(parseNfrParts('· -b without a prefix')).toEqual([]);
  });

  it('parses the committed nfr-traceability.md: 91 rows, every row with at least one part of its own NFR', () => {
    const rows = parseNfrTraceability(read(MAP_PATHS.nfr));
    expect(rows).toHaveLength(91);
    expect(rows.filter((r) => r.parts.length === 0)).toEqual([]);
    for (const row of rows) expect(row.parts.some((p) => p.startsWith(`NT-${row.nfr.slice('NFR-'.length)}-`))).toBe(true);
    const byNfr = Object.fromEntries(rows.map((r) => [r.nfr, r]));
    expect(byNfr['NFR-PERF-003']?.parts).toEqual(['NT-PERF-003-a', 'NT-PERF-003-b', 'NT-PERF-003-c', 'NT-PERF-003-d', 'NT-PERF-003-e']);
    expect(byNfr['NFR-OPS-001']?.parts).toEqual(['NT-OPS-001-a']);
    expect(byNfr['NFR-MAINT-002']?.parts).toEqual(['NT-MAINT-002-a', 'NT-MAINT-002-b', 'NT-MAINT-002-c']);
    expect(rows.map((r) => r.run).sort()).toEqual([
      ...Array<string>(6).fill('DEFERRED'),
      ...Array<string>(75).fill('FULL'),
      ...Array<string>(10).fill('PARTIAL'),
    ]);
  });

  it('rejects a table without the Run and Test(s) columns', () => {
    expect(() => parseNfrTraceability('| NFR | Metric |\n|---|---|\n| NFR-X-001 | m |\n')).toThrow(MapError);
  });
});

describe('committed maps', () => {
  it('security-test-cases.md: 64 adopted cases 01..64, proposed ones kept apart', () => {
    const { adopted, proposed } = parseSecurityCases(read(MAP_PATHS.security));
    expect(adopted).toEqual(Array.from({ length: 64 }, (_, i) => `SEC-TC-${String(i + 1).padStart(2, '0')}`));
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed.filter((id) => adopted.includes(id))).toEqual([]);
  });

  it('e2e-journeys.md: journey headings, the keyboard range and the live variant', () => {
    const ids = parseJourneys(read(MAP_PATHS.journeys));
    for (const id of ['J-M0-01', 'J-M0-05', 'J-M1-01', 'J-M1-01L', 'J-M1-06', 'J-SEC-02', 'J-KB-01', 'J-KB-09']) expect(ids).toContain(id);
    expect(ids.filter((id) => id.startsWith('J-KB-'))).toHaveLength(9);
  });

  it('gherkin-test-map.md: 1599 rows, 1593 counted for G3', () => {
    const rows = parseGherkinMap(read(MAP_PATHS.gherkin));
    expect(rows).toHaveLength(1599);
    expect(rows.filter((r) => r.g3)).toHaveLength(1593);
    expect(new Set(rows.map((r) => r.story)).size).toBe(218);
  });

  it('story files: every story has a MoSCoW value and Must stories have scenarios', () => {
    const stories = loadStories(repoRoot, (dir) => readdirSync(dir));
    expect(stories.filter((s) => !['Must', 'Should', 'Could', "Won't"].includes(s.moscow))).toEqual([]);
    const must = stories.filter((s) => s.moscow === 'Must');
    expect(must).toHaveLength(218);
    expect(must.filter((s) => s.scenarios.length === 0)).toEqual([]);
  });
});

describe('parseStoryFile', () => {
  const file = (body: string[]) =>
    [
      '# EPIC-02 — X',
      '',
      '| ID | Title | MS | MoSCoW | DC |',
      '|---|---|---|---|---|',
      '| US-010 | T | M0 | Must | DC |',
      '',
      ...body,
    ].join('\n');

  it('counts scenarios of gherkin blocks only, keeps comments out and marks @live-sandbox', () => {
    const [story] = parseStoryFile(
      file([
        '### US-010 — T',
        '```gherkin',
        '# a comment',
        '  Scenario: A',
        '  @live-sandbox @slow',
        '  Scenario Outline: B <x>',
        '```',
        '```text',
        '  Scenario: ignored',
        '```',
        '#### Notes',
        '```gherkin',
        '  Scenario: C',
        '```',
      ]),
      'EPIC-02-x.md',
    );
    expect(story).toMatchObject({ id: 'US-010', moscow: 'Must', dc: true, epic: 'EPIC-02', file: 'EPIC-02-x.md' });
    expect(story?.scenarios).toEqual([
      { index: 1, title: 'A', outline: false, liveSandbox: false },
      { index: 2, title: 'B <x>', outline: true, liveSandbox: true },
      { index: 3, title: 'C', outline: false, liveSandbox: false },
    ]);
  });

  it('rejects a story without a summary row, a bad file name and an unterminated block', () => {
    expect(() => parseStoryFile(file(['### US-011 — T']), 'EPIC-02-x.md')).toThrow(/US-011 has no row/);
    expect(() => parseStoryFile(file([]), 'notes.md')).toThrow(MapError);
    expect(() => parseStoryFile(file(['### US-010 — T', '```gherkin', '  Scenario: A']), 'EPIC-02-x.md')).toThrow(/unterminated/);
  });

  it('splits table cells on unescaped pipes', () => {
    expect(tableCells('| a | b \\| c | d |')).toEqual(['a', 'b \\| c', 'd']);
  });

  it('trims scenario titles and parses a megabyte-long whitespace run in linear time (PR35-SEC-02)', () => {
    const spaces = ' '.repeat(1_000_000);
    const started = Date.now();
    const [story] = parseStoryFile(
      file([
        '### US-010 — T',
        '```gherkin',
        `  Scenario: a${spaces}b`,
        `  Scenario Outline:   padded \t `,
        `  Scenario: c${spaces}`,
        '```',
      ]),
      'EPIC-02-x.md',
    );
    // The former lazy pattern needed seconds at 80,000 spaces and grows quadratically; the linear one needs milliseconds.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(story?.scenarios.map((s) => s.title)).toEqual([`a${spaces}b`, 'padded', 'c']);
  });
});

describe('malformedIds', () => {
  it('reports ID-shaped tokens that do not start with a well-formed ID, unique and sorted', () => {
    expect(malformedIds('[AT-US-66-01] AT-US-001-1 AT-US-001-010 SEC-TC-1 NT-PERF-6-a NT-PERF-003-ab J-M0-1 AT-US-66-01 XAT-US-1')).toEqual(
      ['AT-US-001-010', 'AT-US-001-1', 'AT-US-66-01', 'J-M0-1', 'NT-PERF-003-ab', 'NT-PERF-6-a', 'SEC-TC-1'],
    );
  });

  it('accepts well-formed IDs, outline rows and a well-formed ID with a hyphenated suffix', () => {
    expect(
      malformedIds(
        '[AT-US-012-02] AT-US-012-02-object-storage AT-US-131-01-2 NT-A11Y-001-b SEC-TC-01..64 J-M1-01L J-KB-09 NFR-PERF-001 plain',
      ),
    ).toEqual([]);
  });

  it('caps a reported token at 40 characters', () => {
    expect(malformedIds(`SEC-TC-${'9'.repeat(100)}`)).toEqual([`SEC-TC-${'9'.repeat(33)}`]);
  });
});

describe('map validators', () => {
  const MAP_HEAD = '| Test ID | Story | Scenario | Suite | Lane | G3 |\n|---|---|---|---|---|---|\n';

  it('parseGherkinMap rejects a row without six cells, a duplicate row and a malformed story or suite cell', () => {
    const row = '| AT-US-001-01 | US-001 | One | `unit` | A | yes |\n';
    expect(parseGherkinMap(MAP_HEAD + row)).toHaveLength(1);
    expect(() => parseGherkinMap(`${MAP_HEAD}| AT-US-001-01 | US-001 | One | \`unit\` | A | yes | extra |\n`)).toThrow(
      /has 7 cells, expected 6/,
    );
    expect(() => parseGherkinMap(MAP_HEAD + row + row)).toThrow(/appears twice/);
    expect(() => parseGherkinMap(`${MAP_HEAD}| AT-US-001-01 | US-1 | One | \`unit\` | A | yes |\n`)).toThrow(
      /malformed story or suite cell/,
    );
    expect(() => parseGherkinMap(`${MAP_HEAD}| AT-US-001-01 | US-001 | One | unit | A | yes |\n`)).toThrow(/malformed story or suite cell/);
  });

  it('parseNfrTraceability rejects an unknown Run value, a short row and a duplicate NFR', () => {
    const head = '| NFR | Run | Test(s) |\n|---|---|---|\n';
    expect(parseNfrTraceability(`${head}| NFR-PERF-001 | FULL | NT-PERF-001-a |\n`)).toEqual([
      { nfr: 'NFR-PERF-001', run: 'FULL', parts: ['NT-PERF-001-a'] },
    ]);
    expect(() => parseNfrTraceability(`${head}| NFR-PERF-001 | MAYBE | NT-PERF-001-a |\n`)).toThrow(/has Run "MAYBE"/);
    expect(() => parseNfrTraceability(`${head}| NFR-PERF-001 | FULL |\n`)).toThrow(/has 2 cells, expected 3/);
    expect(() => parseNfrTraceability(`${head}| NFR-PERF-001 | FULL | a |\n| NFR-PERF-001 | FULL | b |\n`)).toThrow(/appears twice/);
  });
});

describe('readBounded', () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'test-ids-read-'));
    temps.push(root);
    mkdirSync(join(root, 'dir'));
    writeFileSync(join(root, 'dir', 'file.md'), 'hello');
    return root;
  }

  it('reads a regular file within the cap', () => {
    const root = makeRoot();
    expect(readBounded(root, join(root, 'dir', 'file.md'))).toBe('hello');
    expect(readBounded(root, join(root, 'dir', 'file.md'), 5)).toBe('hello');
  });

  it('refuses a file over the cap, a directory, a missing path and a junction, naming the path relative to the root', () => {
    const root = makeRoot();
    expect(() => readBounded(root, join(root, 'dir', 'file.md'), 4)).toThrow('dir/file.md: exceeds 4 bytes');
    expect(() => readBounded(root, join(root, 'dir'))).toThrow('dir: not a regular file');
    expect(() => readBounded(root, join(root, 'missing.md'))).toThrow('missing.md: cannot be read');
    symlinkSync(join(root, 'dir'), join(root, 'link'), 'junction');
    expect(() => readBounded(root, join(root, 'link'))).toThrow('link: not a regular file');
    expect(() => readBounded(root, join(root, 'link'))).toThrow(MapError);
  });
});
