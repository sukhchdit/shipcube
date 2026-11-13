/**
 * quality:trace (TASK-277, T-QA-02; TEST-STRATEGY section 6 rules 2 and 3, D-QA-002): IDs are extracted from every JUnit
 * file of a run into ac-trace.json, coverage is computed against the maps, and an ID absent from every map fails.
 */
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { toJUnit } from './lib/junit-write.mjs';
import { DEFAULT_OUT, RUNS_PATH, TRACE_FILE, main } from './trace.mjs';

const RUN = '20261113T1200Z_abcdef1';
const OTHER_RUN = '20261112T1200Z_abcdef0';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const STORIES = [
  '# EPIC-01 — Sample',
  '',
  '## Story summary',
  '| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |',
  '|---|---|---|---|---|---|---|---|',
  '| US-001 | First | M0 | Must | S | - | REQ-1 | DC |',
  '| US-002 | Second | M0 | Should | S | - | REQ-2 |  |',
  '',
  '### US-001 — First',
  '```gherkin',
  '  Scenario: One',
  '  Scenario Outline: Rows',
  '  Scenario: Three',
  '  @live-sandbox',
  '  Scenario: Live',
  '```',
  '',
  '### US-002 — Second',
  '```gherkin',
  '  Scenario: Should one',
  '```',
  '',
].join('\n');

const GHERKIN_MAP = [
  '# map',
  '',
  '| Test ID | Story | Scenario | Suite | Lane | G3 |',
  '|---|---|---|---|---|---|',
  '| AT-US-001-01 | US-001 (DC) | One | `unit` | A | yes |',
  '| AT-US-001-02 | US-001 (DC) | Rows (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |',
  '| AT-US-001-03 | US-001 (DC) | Three | `api` | B | yes |',
  '| AT-US-001-04 | US-001 (DC) | Live | `contract-live` | opt-in | no (COND-SANDBOX-DEMO) |',
  '',
].join('\n');

const SECURITY = [
  '# Security test cases',
  '',
  '| ID | Test |',
  '|---|---|',
  '| SEC-TC-01 | first |',
  '| SEC-TC-02 | second |',
  '',
  '## Proposed cases SEC-TC-09',
  '',
  '| SEC-TC-09 | proposed |',
  '',
].join('\n');

const JOURNEYS = ['# Journeys', '', '### J-M0-01 Sign in `@critical`', '', '### J-KB-01..02 Keyboard variants', ''].join('\n');

const NFR = [
  '# NFR traceability',
  '',
  '| NFR | Metric (short) | Mechanism (short) | Design (ADR / spec) | Verification approach | Run | Test(s) | Status |',
  '|---|---|---|---|---|---|---|---|',
  '| NFR-PERF-001 | m | m | d | v | FULL | NT-PERF-001-a..b `k6` · -c smoke | Designed |',
  '| NFR-A11Y-001 | m | m | d | v | FULL | NT-A11Y-001-a axe | Designed |',
  '| NFR-OPS-001 | m | m | d | v | PARTIAL | NT-OPS-001-a `docker compose up -d` · -b restore | Designed |',
  '| NFR-REC-001 | m | m | d | v | DEFERRED | NT-REC-001-a drill | Designed |',
  '',
].join('\n');

type Case = { name: string; status?: 'passed' | 'failed' | 'skipped'; classname?: string };

function junit(cases: readonly Case[]): string {
  return toJUnit({
    suite: 'suite',
    cases: cases.map((c) => ({ name: c.name, classname: c.classname ?? 'file', time: 0, status: c.status ?? 'passed' })),
  });
}

type MapTexts = { stories?: string; gherkin?: string; nfr?: string };

function makeRoot(files: Record<string, string>, extraRuns: Record<string, Record<string, string>> = {}, maps: MapTexts = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'quality-trace-'));
  temps.push(root);
  const write = (relative: string, text: string) => {
    const path = join(root, ...relative.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  };
  write('docs/01-requirements/stories/EPIC-01-sample.md', maps.stories ?? STORIES);
  write('docs/05-quality/tests/gherkin-test-map.md', maps.gherkin ?? GHERKIN_MAP);
  write('docs/05-quality/tests/security-test-cases.md', SECURITY);
  write('docs/05-quality/tests/e2e-journeys.md', JOURNEYS);
  write('docs/03-architecture/nfr-traceability.md', maps.nfr ?? NFR);
  for (const [name, text] of Object.entries(files)) write(`${RUNS_PATH}/${RUN}/${name}`, text);
  for (const [run, runFiles] of Object.entries(extraRuns))
    for (const [name, text] of Object.entries(runFiles)) write(`${RUNS_PATH}/${run}/${name}`, text);
  return root;
}

function run(argv: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

type Trace = {
  run: string;
  maps: Record<string, string>;
  ids: Record<string, { family: string; g3?: boolean; suites: string[]; tests: number; passed: number; failed: number; skipped: number }>;
  coverage: {
    must_ac: { counted: number; covered: number; ratio: number; unmapped: { count: number; ids: string[] } };
    nfr: {
      total: number;
      verified: number;
      verified_ratio: number;
      partial_evidence: number;
      partial_evidence_by_run: Record<string, number>;
    };
    sec_tc: { total: number; present: number; passing: number; ratio: number };
  };
  orphans: string[];
  problems: string[];
};

function readTrace(root: string): { text: string; trace: Trace } {
  const text = readFileSync(join(root, ...DEFAULT_OUT.split('/')), 'utf8');
  return { text, trace: JSON.parse(text) as Trace };
}

const HAPPY: Record<string, string> = {
  'unit.junit.xml': junit([
    { name: '[AT-US-001-01] [SEC-TC-01] @security first scenario secret-title-text' },
    { name: '[AT-US-001-02-1] first row' },
    { name: '[AT-US-001-02-2] second row' },
    { name: 'AT-US-002-01 should story, bare ID' },
    { name: '[NT-PERF-001-a] [NT-PERF-001-b] [NT-PERF-001-c] perf parts' },
    { name: '[NT-A11Y-001-a] axe part', status: 'failed' },
    { name: '[NT-OPS-001-b] restore part' },
    { name: 'no id here' },
  ]),
  'api.junit.xml': junit([
    { name: '[AT-US-001-03] [J-M0-01] [J-KB-02] journey', status: 'failed' },
    { name: '[SEC-TC-02] [SEC-TC-09] @security skipped', status: 'skipped' },
    { name: '[AT-US-001-01] passes in api too' },
  ]),
};

describe('quality:trace', () => {
  it('extracts IDs from every JUnit file of the run and writes ac-trace.json with coverage, exit 0', () => {
    const root = makeRoot(HAPPY);
    const result = run(['--root', root]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(1);
    expect(result.out[0]).toContain('must-AC 2/3 (0.6667, 0 Must scenarios unmapped)');
    const { trace, text } = readTrace(root);
    expect(trace.run).toBe(RUN);
    expect(Object.keys(trace.maps).sort()).toEqual(['gherkin_sha256', 'journeys_sha256', 'nfr_sha256', 'security_sha256']);
    expect(Object.keys(trace.ids)).toEqual([...Object.keys(trace.ids)].sort());
    expect(trace.ids['AT-US-001-01']).toEqual({
      family: 'AT',
      g3: true,
      suites: ['api', 'unit'],
      tests: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
    });
    expect(trace.ids['AT-US-002-01']).toMatchObject({ family: 'AT', g3: false, tests: 1 });
    expect(trace.ids['AT-US-001-02-1']).toMatchObject({ g3: true, passed: 1 });
    expect(trace.ids['AT-US-001-03']).toMatchObject({ failed: 1, suites: ['api'] });
    expect(trace.ids['J-KB-02']).toMatchObject({ family: 'J', tests: 1 });
    expect(trace.ids['SEC-TC-09']).toMatchObject({ family: 'SEC-TC', skipped: 1 });
    // Must-AC: 01 passes (2 tests), the 02 outline passes through its rows, 03 fails; 04 is @live-sandbox (not counted).
    expect(trace.coverage.must_ac).toEqual({ counted: 3, covered: 2, ratio: 0.6667, unmapped: { count: 0, ids: [] } });
    // PERF-001 FULL verified (a..b plus the `· -c` shorthand); A11Y-001 failed; OPS-001 PARTIAL with evidence; REC none.
    expect(trace.coverage.nfr).toEqual({
      total: 4,
      verified: 1,
      verified_ratio: 0.25,
      partial_evidence: 1,
      partial_evidence_by_run: { DEFERRED: 0, FULL: 0, PARTIAL: 1 },
    });
    // Nothing is written into the evidence tree (D-TASK277-03, PR35-SEC-01).
    expect(existsSync(join(root, ...RUNS_PATH.split('/'), RUN, TRACE_FILE))).toBe(false);
    expect(trace.coverage.sec_tc).toEqual({ total: 2, present: 2, passing: 1, ratio: 0.5 });
    expect(trace.orphans).toEqual([]);
    expect(trace.problems).toEqual([]);
    // IDs and counts only: no test names, no host paths, no timestamps; trailing newline.
    expect(text).not.toContain('secret-title-text');
    expect(text).not.toContain(root);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('is deterministic: two runs write identical bytes', () => {
    const root = makeRoot(HAPPY);
    expect(run(['--root', root]).code).toBe(0);
    const first = readTrace(root).text;
    expect(run(['--root', root]).code).toBe(0);
    expect(readTrace(root).text).toBe(first);
  });

  it('fails (exit 1) on an ID that no map defines, listing the orphan', () => {
    const root = makeRoot({
      'unit.junit.xml': junit([
        { name: '[AT-US-001-09] not in the maps' },
        { name: '[AT-US-001-01-1] row of a non-outline scenario' },
        { name: '[NT-PERF-001-z] [SEC-TC-63] [J-M9-01] unknown' },
        { name: '[AT-US-001-01] known' },
      ]),
    });
    const result = run(['--root', root]);
    expect(result.code).toBe(1);
    const { trace } = readTrace(root);
    expect(trace.orphans).toEqual(['AT-US-001-01-1', 'AT-US-001-09', 'J-M9-01', 'NT-PERF-001-z', 'SEC-TC-63']);
    expect(trace.ids['AT-US-001-09']).toBeUndefined();
    expect(result.err).toContain('quality:trace: orphan ID AT-US-001-09 (in a test title, absent from every map)');
  });

  it('fails (exit 1) on an unparseable JUnit file without echoing its content', () => {
    const root = makeRoot({ ...HAPPY, 'bad.junit.xml': '<testsuites><testcase name="leak-me"/></testsuites>' });
    const result = run(['--root', root]);
    expect(result.code).toBe(1);
    const { trace, text } = readTrace(root);
    expect(trace.problems).toEqual([`${RUNS_PATH}/${RUN}/bad.junit.xml: unparseable JUnit XML`]);
    expect(text).not.toContain('leak-me');
    expect(result.err.join('\n')).not.toContain('leak-me');
  });

  it('fails (exit 1) when a map cannot be read, and when the run has no JUnit file', () => {
    const root = makeRoot(HAPPY);
    rmSync(join(root, 'docs', '03-architecture', 'nfr-traceability.md'));
    const missingMap = run(['--root', root]);
    expect(missingMap.code).toBe(1);
    expect(missingMap.err).toEqual(['quality:trace: docs/03-architecture/nfr-traceability.md: cannot be read']);
    const empty = makeRoot({ 'summary.json': '{}' });
    expect(run(['--root', empty]).code).toBe(1);
    expect(readTrace(empty).trace.problems).toEqual([`${RUNS_PATH}/${RUN}: no *.junit.xml file`]);
  });

  it('defaults to the latest run, accepts --run inside the runs directory and refuses path escapes (exit 2)', () => {
    const root = makeRoot(HAPPY, { [OTHER_RUN]: { 'unit.junit.xml': junit([{ name: '[AT-US-001-01] old' }]) } });
    expect(run(['--root', root]).out[0]).toContain(RUN);
    const out = join(root, 'elsewhere.json');
    const explicit = run(['--root', root, '--run', join(root, ...RUNS_PATH.split('/'), OTHER_RUN), '--out', out]);
    expect(explicit.code).toBe(0);
    expect((JSON.parse(readFileSync(out, 'utf8')) as Trace).run).toBe(OTHER_RUN);
    for (const escape of [
      root,
      join(root, 'docs'),
      join(root, ...RUNS_PATH.split('/'), RUN, '..', '..'),
      join(root, ...RUNS_PATH.split('/'), 'not-a-run'),
    ])
      expect(run(['--root', root, '--run', escape]).code).toBe(2);
    expect(run(['--root', root, '--bogus']).code).toBe(2);
  });

  it('counts a Must AC as covered only with at least one test, all passing (no test, skipped row, failing sibling)', () => {
    const mixed = makeRoot({
      'unit.junit.xml': junit([
        { name: '[AT-US-001-01] passes' },
        { name: '[AT-US-001-02-1] row passes' },
        { name: '[AT-US-001-02-2] row skipped', status: 'skipped' },
        { name: '[AT-US-001-03] passes' },
        { name: '[AT-US-001-03] sibling fails', status: 'failed' },
      ]),
    });
    expect(run(['--root', mixed]).code).toBe(0);
    expect(readTrace(mixed).trace.coverage.must_ac).toMatchObject({ counted: 3, covered: 1 });
    // Two Must ACs have no test at all: they are not covered.
    const sparse = makeRoot({ 'unit.junit.xml': junit([{ name: '[AT-US-001-01] only this one' }]) });
    expect(run(['--root', sparse]).code).toBe(0);
    expect(readTrace(sparse).trace.coverage.must_ac).toMatchObject({ counted: 3, covered: 1, ratio: 0.3333 });
  });

  it('counts NFR rows: a failing sibling or no part blocks verified, partial evidence covers every Run value', () => {
    const nfr = [
      '| NFR | Run | Test(s) |',
      '|---|---|---|',
      '| NFR-PERF-001 | FULL | NT-PERF-001-a..b |',
      '| NFR-PERF-002 | FULL | NT-PERF-002-a |',
      '| NFR-PERF-003 | FULL | prose only, no part |',
      '| NFR-OPS-001 | PARTIAL | NT-OPS-001-a |',
      '| NFR-REC-001 | DEFERRED | NT-REC-001-a |',
      '| NFR-REC-002 | DEFERRED | NT-REC-002-a |',
      '',
    ].join('\n');
    const root = makeRoot(
      {
        'unit.junit.xml': junit([
          { name: '[NT-PERF-001-a] passes' },
          { name: '[NT-PERF-001-b] passes' },
          { name: '[NT-PERF-001-b] sibling fails', status: 'failed' },
          { name: '[NT-PERF-002-a] passes' },
          { name: '[NT-OPS-001-a] passes' },
          { name: '[NT-REC-001-a] passes' },
          { name: '[NT-REC-002-a] fails', status: 'failed' },
        ]),
      },
      {},
      { nfr },
    );
    expect(run(['--root', root]).code).toBe(0);
    expect(readTrace(root).trace.coverage.nfr).toEqual({
      total: 6,
      verified: 1,
      verified_ratio: 0.1667,
      partial_evidence: 3,
      partial_evidence_by_run: { DEFERRED: 1, FULL: 1, PARTIAL: 1 },
    });
  });

  it('lists the Must scenarios of the story files that have no map row (Should stories never count)', () => {
    const stories = STORIES.replace('  Scenario: Live\n', '  Scenario: Live\n  Scenario: Added later\n  Scenario: Added too\n');
    const root = makeRoot(HAPPY, {}, { stories });
    const result = run(['--root', root]);
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain('2 Must scenarios unmapped');
    expect(readTrace(root).trace.coverage.must_ac).toEqual({
      counted: 3,
      covered: 2,
      ratio: 0.6667,
      unmapped: { count: 2, ids: ['AT-US-001-05', 'AT-US-001-06'] },
    });
  });

  it('fails (exit 1) on malformed ID-shaped tokens and credits IDs from the test name only, never the classname', () => {
    const root = makeRoot({
      'unit.junit.xml': junit([
        { name: '[AT-US-01-01] [SEC-TC-1] typos' },
        { name: 'AT-US-001-010 J-M0-1 NT-PERF-1-a more typos' },
        { name: '[AT-US-001-01-object-storage] suffixed but well-formed' },
        { name: 'no id in the name', classname: 'tests/AT-US-001-03.test.ts' },
      ]),
    });
    const result = run(['--root', root]);
    expect(result.code).toBe(1);
    const { trace } = readTrace(root);
    const file = `${RUNS_PATH}/${RUN}/unit.junit.xml`;
    expect(trace.problems).toEqual(
      ['AT-US-001-010', 'AT-US-01-01', 'J-M0-1', 'NT-PERF-1-a', 'SEC-TC-1'].map(
        (token) => `${file}: malformed test ID ${token} (no AT-/NT-/SEC-TC-/J- form matches)`,
      ),
    );
    expect(trace.orphans).toEqual([]);
    expect(Object.keys(trace.ids)).toEqual(['AT-US-001-01']);
  });

  it('refuses symlinked or junctioned run directories, explicit or default, and skips non-run names by default', () => {
    const runs = (root: string) => join(root, ...RUNS_PATH.split('/'));
    const root = makeRoot(HAPPY, { 'zz-not-a-run': { 'unit.junit.xml': junit([{ name: '[AT-US-001-01] x' }]) } });
    writeFileSync(join(runs(root), '20261115T1200Z_abcdef3'), 'a file named like a later run');
    mkdirSync(join(root, 'outside-run'));
    writeFileSync(join(root, 'outside-run', 'unit.junit.xml'), junit([{ name: '[AT-US-001-09] planted' }]));
    const linked = join(runs(root), '20261114T1200Z_abcdef2');
    symlinkSync(join(root, 'outside-run'), linked, 'junction');
    const latest = run(['--root', root]);
    expect(latest.code).toBe(0);
    expect(latest.out[0]).toContain(RUN);
    const explicit = run(['--root', root, '--run', linked]);
    expect(explicit.code).toBe(2);
    expect(explicit.err).toEqual([`quality:trace: ${RUNS_PATH}/20261114T1200Z_abcdef2 is not a directory (symlinks are not followed)`]);
    // A junction between the root and the runs directory is refused too.
    const parent = makeRoot(HAPPY);
    renameSync(runs(parent), join(parent, 'real-runs'));
    symlinkSync(join(parent, 'real-runs'), runs(parent), 'junction');
    for (const argv of [
      ['--root', parent],
      ['--root', parent, '--run', join(runs(parent), RUN)],
    ]) {
      const refused = run(argv);
      expect(refused.code).toBe(2);
      expect(refused.err).toEqual([`quality:trace: ${RUNS_PATH} is a symbolic link or junction (links are not followed)`]);
    }
  });

  it('confines --out to the root outside the evidence tree and never writes through a link (PR35-SEC-01)', () => {
    const root = makeRoot(HAPPY);
    const outside = join(root, '..', `${basename(root)}-outside.json`);
    const inEvidence = join(root, ...RUNS_PATH.split('/'), RUN, TRACE_FILE);
    for (const out of [outside, inEvidence, join(root, 'DOCS', '05-quality', 'tests', 'runs', 'x.json'), root]) {
      const result = run(['--root', root, '--out', out]);
      expect(result.code).toBe(2);
      expect(result.err[0]).toMatch(/^quality:trace: --out must (name a file inside --root|not be inside docs\/05-quality\/tests\/runs)/);
    }
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(inEvidence)).toBe(false);
    // A hard link planted at the target is replaced, its other name keeps its bytes.
    writeFileSync(join(root, 'victim.txt'), 'keep');
    mkdirSync(join(root, 'reports'));
    linkSync(join(root, 'victim.txt'), join(root, ...DEFAULT_OUT.split('/')));
    expect(run(['--root', root]).code).toBe(0);
    expect(readFileSync(join(root, 'victim.txt'), 'utf8')).toBe('keep');
    expect(readTrace(root).trace.run).toBe(RUN);
    // A junction at the target, or on the way to it, is refused.
    mkdirSync(join(root, 'real'));
    rmSync(join(root, ...DEFAULT_OUT.split('/')));
    symlinkSync(join(root, 'real'), join(root, ...DEFAULT_OUT.split('/')), 'junction');
    const atTarget = run(['--root', root]);
    expect(atTarget.code).toBe(2);
    expect(atTarget.err).toEqual([`quality:trace: --out: ${DEFAULT_OUT} is a symbolic link or junction (links are not followed)`]);
    symlinkSync(join(root, 'real'), join(root, 'via'), 'junction');
    const onTheWay = run(['--root', root, '--out', join(root, 'via', 'x.json')]);
    expect(onTheWay.code).toBe(2);
    expect(onTheWay.err).toEqual(['quality:trace: --out: via is a symbolic link or junction (links are not followed)']);
    expect(existsSync(join(root, 'real', 'x.json'))).toBe(false);
  });
});
