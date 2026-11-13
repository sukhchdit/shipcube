/**
 * Merged coverage (US-006; TEST-STRATEGY section 8; D-ORCH-047; PR #33 R1-m4, PR33-SEC-06). The merge, the summary and
 * the lcov writer are pure and tested on hand-built istanbul maps shaped like v8-to-istanbul output (one statement per
 * line, one `branch` entry per V8 block range, function ranges in fnMap). The fail-closed project checks and the
 * configuration pins run against the repository's own jest.config.ts and tools/quality/suite-runners.json.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { jestExtraArgs } from '../quality/heavy.mjs';
import {
  impliedCount,
  isPlaceholder,
  istanbulPercent,
  mergeCoverageMaps,
  mergeFileCoverage,
  parseCoverageMap,
  parseMergedCoverageConfig,
  PLACEHOLDER_FUNCTION,
  projectProblems,
  readCoverageFinal,
  summarizeCoverage,
  summarizeFile,
  toLcov,
  tripwireChecks,
} from './coverage-merge.mjs';
import { IN_BAND_COVERAGE_PROJECTS } from './coverage-run.mjs';
import { parseLcov } from './diff-coverage.mjs';

type Loc = { start: { line: number; column: number }; end: { line: number; column: number } };
type FileCov = ReturnType<typeof mergeFileCoverage>;

const repoRoot = findRepoRoot();
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const loc = (sl: number, sc: number, el: number, ec: number): Loc => ({
  start: { line: sl, column: sc },
  end: { line: el, column: ec },
});

/**
 * A v8-to-istanbul shaped entry: `lines` = count per line (1-based, index 0 = line 1); `ranges` = V8 block ranges
 * (each a `branch` entry with one location); `fns` = function ranges.
 */
function v8File(path: string, lines: number[], ranges: Array<[Loc, number]>, fns: Array<[string, Loc, number]> = []): FileCov {
  const fc: FileCov = { path, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  lines.forEach((count, i) => {
    fc.statementMap[String(i)] = loc(i + 1, 0, i + 1, 10);
    fc.s[String(i)] = count;
  });
  ranges.forEach(([l, count], i) => {
    fc.branchMap[String(i)] = { type: 'branch', line: l.start.line, loc: l, locations: [l] };
    fc.b[String(i)] = [count];
  });
  fns.forEach(([name, l, count], i) => {
    fc.fnMap[String(i)] = { name, decl: l, loc: l, line: l.start.line };
    fc.f[String(i)] = count;
  });
  return fc;
}

/** Jest's untested-file placeholder over `n` lines. */
function placeholder(path: string, n: number): FileCov {
  const whole = loc(1, 0, n, 1);
  return v8File(
    path,
    Array.from({ length: n }, () => 0),
    [[whole, 0]],
    [[PLACEHOLDER_FUNCTION, whole, 0]],
  );
}

// `function g(x) { if (x) { A } else { B } }` over lines 1-7: root range 1:0-7:1, then-block 2:9-4:3, else-block 4:9-6:3.
const G_ROOT = loc(1, 0, 7, 1);
const G_THEN = loc(2, 9, 4, 3);
const G_ELSE = loc(4, 9, 6, 3);

describe('mergeCoverageMaps: V8-aware merge (D-ORCH-047)', () => {
  it('[US-006] a function taking `then` in one project and `else` in the other is fully covered (plain istanbul sum would say 1 of 3)', () => {
    // V8 omits the block whose count equals its parent: run A reports only the untaken else, run B only the untaken then.
    const unit = v8File(
      '/r/packages/audit/src/g.ts',
      [1, 1, 1, 1, 0, 0, 1],
      [
        [G_ROOT, 1],
        [G_ELSE, 0],
      ],
      [['g', G_ROOT, 1]],
    );
    const integration = v8File(
      '/r/packages/audit/src/g.ts',
      [1, 0, 0, 0, 1, 1, 1],
      [
        [G_ROOT, 1],
        [G_THEN, 0],
      ],
      [['g', G_ROOT, 1]],
    );
    const merged = mergeCoverageMaps([{ '/r/packages/audit/src/g.ts': unit }, { '/r/packages/audit/src/g.ts': integration }]);
    const file = merged['/r/packages/audit/src/g.ts'] as FileCov;
    expect(summarizeFile(file).branches).toEqual({ total: 3, covered: 3, skipped: 0, pct: 100 });
    expect(Object.values(file.b).map((c) => c[0])).toEqual([2, 1, 1]); // root 1+1, else 0+1 (implied), then 1 (implied)+0
    expect(summarizeFile(file).lines).toEqual({ total: 7, covered: 7, skipped: 0, pct: 100 });
    expect(file.f['0']).toBe(2);
  });

  it('[US-006] an untaken branch stays uncovered when no project takes it', () => {
    const a = v8File(
      '/r/x.ts',
      [1, 1, 1, 0, 0, 0, 1],
      [
        [G_ROOT, 2],
        [G_ELSE, 0],
      ],
      [['g', G_ROOT, 2]],
    );
    const b = v8File(
      '/r/x.ts',
      [1, 1, 1, 0, 0, 0, 1],
      [
        [G_ROOT, 1],
        [G_ELSE, 0],
      ],
      [['g', G_ROOT, 1]],
    );
    const file = mergeCoverageMaps([{ '/r/x.ts': a }, { '/r/x.ts': b }])['/r/x.ts'] as FileCov;
    expect(summarizeFile(file).branches).toMatchObject({ total: 2, covered: 1 });
    expect(summarizeFile(file).lines).toMatchObject({ total: 7, covered: 4 });
  });

  it('[US-006] no inflation: a block of a function another run never called takes that function count (0), not the module count', () => {
    // Run B loaded the file but never called g: V8 reports g as a non-block function range with count 0, no blocks.
    const a = v8File(
      '/r/x.ts',
      [1, 1, 1, 0, 0, 0, 1],
      [
        [G_ROOT, 1],
        [G_ELSE, 0],
      ],
      [['g', G_ROOT, 1]],
    );
    const b = v8File('/r/x.ts', [0, 0, 0, 0, 0, 0, 0], [], [['g', G_ROOT, 0]]);
    const file = mergeCoverageMaps([{ '/r/x.ts': a }, { '/r/x.ts': b }])['/r/x.ts'] as FileCov;
    expect(Object.values(file.b).map((c) => c[0])).toEqual([1, 0]);
    expect(summarizeFile(file).branches).toMatchObject({ total: 2, covered: 1 });
  });

  it('[US-006] impliedCount: innermost containing range, 0 outside every range, lowest count among equal spans', () => {
    const ranges = [
      { loc: loc(1, 0, 20, 0), count: 5 },
      { loc: loc(2, 0, 10, 0), count: 3 },
      { loc: loc(3, 0, 4, 0), count: 0 },
      { loc: loc(2, 0, 10, 0), count: 2 },
    ];
    expect(impliedCount(ranges, loc(3, 1, 3, 9))).toBe(0);
    expect(impliedCount(ranges, loc(5, 0, 6, 0))).toBe(2);
    expect(impliedCount(ranges, loc(12, 0, 13, 0))).toBe(5);
    expect(impliedCount(ranges, loc(30, 0, 31, 0))).toBe(0);
    expect(impliedCount([], loc(1, 0, 1, 1))).toBe(0);
  });

  it('[US-006] non-V8 branch entries (several locations) merge by location key and position, absent = zeros', () => {
    const meta = { type: 'if', line: 2, loc: loc(2, 0, 4, 0), locations: [loc(2, 0, 3, 0), loc(3, 0, 4, 0)] };
    const a: FileCov = { path: '/r/b.ts', statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: { '0': meta }, b: { '0': [1, 0] } };
    const b: FileCov = { path: '/r/b.ts', statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: { '7': meta }, b: { '7': [0, 4] } };
    const c: FileCov = { path: '/r/b.ts', statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
    expect(mergeFileCoverage([a, b, c]).b).toEqual({ '0': [1, 4] });
  });

  it('[US-006] the untested-file placeholder is dropped when another project measured the file, and kept (all zero) otherwise', () => {
    const measured = v8File('/r/m.ts', [1, 0], [[loc(1, 0, 2, 1), 1]], [['m', loc(1, 0, 2, 1), 1]]);
    expect(isPlaceholder(placeholder('/r/m.ts', 2))).toBe(true);
    expect(isPlaceholder(measured)).toBe(false);
    const merged = mergeCoverageMaps([
      { '/r/m.ts': placeholder('/r/m.ts', 2), '/r/u.ts': placeholder('/r/u.ts', 3) },
      { '/r/m.ts': measured },
    ]);
    expect(merged['/r/m.ts']).toEqual(measured);
    expect(isPlaceholder(merged['/r/u.ts'] as FileCov)).toBe(true);
    expect(summarizeCoverage(merged)['total']).toMatchObject({ lines: { total: 5, covered: 1 }, branches: { total: 2, covered: 1 } });
  });

  it('[US-006] file keys match across runs regardless of slash direction and case; the first key is kept', () => {
    const a = v8File('C:\\r\\x.ts', [1], []);
    const b = v8File('c:/r/x.ts', [0], []);
    expect(Object.keys(mergeCoverageMaps([{ 'C:\\r\\x.ts': a }, { 'c:/r/x.ts': b }]))).toEqual(['C:\\r\\x.ts']);
  });
});

describe('summary and lcov (istanbul-lib-coverage semantics)', () => {
  it('[US-006] percentages are floored to two decimals; an empty metric is 100 %', () => {
    expect(istanbulPercent(2, 3)).toBe(66.66);
    expect(istanbulPercent(1, 3)).toBe(33.33);
    expect(istanbulPercent(0, 0)).toBe(100);
    expect(istanbulPercent(5, 5)).toBe(100);
  });

  it('[US-006] lines count each start line once with its highest statement count; totals sum the files', () => {
    const fc = v8File('/r/a.ts', [1, 0], [[loc(1, 0, 2, 0), 0]]);
    fc.statementMap['2'] = loc(2, 12, 2, 20);
    fc.s['2'] = 3;
    expect(summarizeFile(fc)).toEqual({
      lines: { total: 2, covered: 2, skipped: 0, pct: 100 },
      statements: { total: 3, covered: 2, skipped: 0, pct: 66.66 },
      functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
      branches: { total: 1, covered: 0, skipped: 0, pct: 0 },
    });
    const summary = summarizeCoverage({ '/r/a.ts': fc, '/r/b.ts': v8File('/r/b.ts', [0, 0], []) });
    expect(Object.keys(summary)).toEqual(['total', '/r/a.ts', '/r/b.ts']);
    expect(summary['total']).toMatchObject({ lines: { total: 4, covered: 2, pct: 50 }, branches: { total: 1, covered: 0 } });
  });

  it('[US-006] lcov.info has relative SF paths and round-trips through diff-coverage parseLcov', () => {
    const root = join(tmpdir(), 'cov-root');
    const fc = v8File(
      join(root, 'packages', 'audit', 'src', 'g.ts'),
      [1, 1, 0],
      [
        [loc(1, 0, 3, 0), 2],
        [loc(3, 0, 3, 5), 0],
      ],
      [['g', loc(1, 0, 3, 0), 2]],
    );
    const text = toLcov({ [fc.path]: fc }, root);
    expect(text).toMatch(
      /^TN:\nSF:packages[\\/]audit[\\/]src[\\/]g\.ts\nFN:1,g\nFNF:1\nFNH:1\nFNDA:2,g\nDA:1,1\nDA:2,1\nDA:3,0\nLF:3\nLH:2\nBRDA:1,0,0,2\nBRDA:3,1,0,0\nBRF:2\nBRH:1\nend_of_record\n$/u,
    );
    const parsed = parseLcov(text, root).get('packages/audit/src/g.ts');
    expect(parsed?.lines).toEqual(
      new Map([
        [1, 1],
        [2, 1],
        [3, 0],
      ]),
    );
    expect(parsed?.branches.get(3)).toEqual({ total: 1, covered: 0 });
    expect(toLcov({}, root)).toBe('');
  });
});

describe('validation and fail-closed project checks (PR33-SEC-06)', () => {
  it('[US-006] malformed coverage-final.json is rejected, never merged into a smaller summary', () => {
    const good = { '/r/a.ts': v8File('/r/a.ts', [1], [[loc(1, 0, 1, 5), 1]], [['a', loc(1, 0, 1, 5), 1]]) };
    expect(parseCoverageMap(good, 'x')).toBe(good);
    expect(() => parseCoverageMap([], 'x')).toThrow('x: not a JSON object');
    expect(() => parseCoverageMap({ a: { statementMap: {} } }, 'x')).toThrow('entry 0 has no path');
    expect(() => parseCoverageMap({ a: { ...good['/r/a.ts'], b: undefined } }, 'x')).toThrow('b is not an object');
    expect(() => parseCoverageMap({ a: { ...good['/r/a.ts'], s: { '0': -1 } } }, 'x')).toThrow('statement 0 is malformed');
    expect(() => parseCoverageMap({ a: { ...good['/r/a.ts'], b: { '0': [1, 1] } } }, 'x')).toThrow('branch 0 is malformed');
    expect(() => parseCoverageMap({ a: { ...good['/r/a.ts'], f: { '0': 'x' } } }, 'x')).toThrow('function 0 is malformed');
  });

  it('[D-SEC-PR23-02] an unparsable coverage-final.json is reported without quoting its content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cov-merge-'));
    temps.push(dir);
    const file = join(dir, 'coverage-final.json');
    writeFileSync(file, '{"C:/Users/someone/secret-path": ');
    expect(() => readCoverageFinal(file, 'coverage of unit')).toThrow(/^coverage of unit: coverage-final.json is not valid JSON$/u);
    writeFileSync(file, JSON.stringify({ '/r/a.ts': v8File('/r/a.ts', [1], []) }));
    expect(Object.keys(readCoverageFinal(file, 'u'))).toEqual(['/r/a.ts']);
  });

  it('[US-006] project missing, failed, empty or with no executed file is a problem; a measured project is not', () => {
    const real = { '/r/a.ts': v8File('/r/a.ts', [1], []) };
    const onlyPlaceholders = { '/r/a.ts': placeholder('/r/a.ts', 3) };
    const problems = projectProblems(
      ['unit', 'unit-dom', 'integration', 'api', 'generated', 'e2e'],
      [
        { projects: ['unit', 'unit-dom'], map: real, problem: null },
        { projects: ['integration'], map: null, problem: 'coverage of integration: Jest wrote no coverage-final.json' },
        { projects: ['api'], map: {}, problem: null },
        { projects: ['generated'], map: onlyPlaceholders, problem: null },
      ],
    );
    expect(Object.fromEntries(problems)).toEqual({
      unit: null,
      'unit-dom': null,
      integration: 'coverage of integration: Jest wrote no coverage-final.json',
      api: 'coverage of api is empty (no file measured)',
      generated: 'coverage of generated executed no source file (every entry is an untested placeholder)',
      e2e: 'no coverage run selected project e2e',
    });
  });

  it('[US-006] merged_coverage configuration is validated', () => {
    expect(parseMergedCoverageConfig({ suite: 'unit', projects: ['unit', 'unit'], projects_if_suites: ['generated'] })).toEqual({
      suite: 'unit',
      projects: ['unit'],
      projectsIfSuites: ['generated'],
    });
    expect(parseMergedCoverageConfig({ suite: 'unit', projects: ['unit'] }).projectsIfSuites).toEqual([]);
    expect(() => parseMergedCoverageConfig(null)).toThrow('must be an object');
    expect(() => parseMergedCoverageConfig({ suite: 'Unit', projects: ['unit'] })).toThrow('suite must be a suite id');
    expect(() => parseMergedCoverageConfig({ suite: 'unit', projects: [] })).toThrow('projects must be a non-empty array');
    expect(() => parseMergedCoverageConfig({ suite: 'unit', projects: ['--all'] })).toThrow('projects must be');
    expect(() => parseMergedCoverageConfig({ suite: 'unit', projects: ['unit'], projects_if_suites: ['unit'] })).toThrow(
      'listed as both required and conditional',
    );
  });

  it('[US-006] tripwire: Jest coverageThreshold.global semantics over the merged total', () => {
    const summary = summarizeCoverage({
      '/r/a.ts': v8File(
        '/r/a.ts',
        [1, 1, 1, 0],
        [
          [loc(1, 0, 4, 0), 1],
          [loc(4, 0, 4, 5), 0],
        ],
      ),
    });
    expect(tripwireChecks({ lines: 75, branches: 50 }, summary).map((c) => c.ok)).toEqual([true, true]);
    expect(tripwireChecks({ lines: 85, branches: 75 }, summary)).toEqual([
      { metric: 'lines', ok: false, message: 'lines: 75% < 85%' },
      { metric: 'branches', ok: false, message: 'branches: 50% < 75%' },
    ]);
    expect(tripwireChecks({ lines: -1 }, summary)).toEqual([{ metric: 'lines', ok: true, message: 'lines: 1 uncovered, maximum 1' }]);
    expect(tripwireChecks({ lines: -0.5 }, summary)[0]?.ok).toBe(false);
    expect(tripwireChecks({ lines: 85 }, {})[0]).toMatchObject({ ok: false });
    expect(tripwireChecks({ lines: '85' }, summary)[0]).toMatchObject({ ok: false });
  });
});

describe('repository pins', () => {
  const runners = JSON.parse(readFileSync(join(repoRoot, 'tools', 'quality', 'suite-runners.json'), 'utf8')) as {
    merged_coverage: unknown;
    suites: Record<string, { kind: string; project: string | string[]; paths?: string[]; coverage?: boolean }>;
  };

  it('[US-006] every jest.config.ts project is in merged_coverage (required, or conditional on having test files)', () => {
    const r = runNode(
      [
        '--input-type=module',
        '-e',
        'const m = await import(process.argv[1]); console.log(JSON.stringify({ projects: m.default.projects.map((p) => p.displayName), global: m.default.coverageThreshold.global }));',
        pathToFileURL(join(repoRoot, 'jest.config.ts')).href,
      ],
      { cwd: repoRoot },
    );
    expect(r.status).toBe(0);
    const jest = JSON.parse(r.stdout) as { projects: string[]; global: Record<string, number> };
    const config = parseMergedCoverageConfig(runners.merged_coverage);
    expect([...config.projects, ...config.projectsIfSuites].sort()).toEqual([...jest.projects].sort());
    expect(config).toEqual({ suite: 'unit', projects: ['unit', 'unit-dom', 'integration', 'api'], projectsIfSuites: ['generated'] });
    expect(jest.global).toEqual({ lines: 85, branches: 75 });
  });

  it('[US-006] the whole-project suites feed the merge; path-filtered suites do not', () => {
    const coverage = Object.entries(runners.suites)
      .filter(([, s]) => s.coverage === true)
      .map(([id]) => id)
      .sort();
    expect(coverage).toEqual(['api', 'integration', 'unit']);
    for (const id of coverage) expect(runners.suites[id]?.paths ?? []).toEqual([]);
  });

  it('[US-006] coverage-only runs use the quality:heavy in-band rule', () => {
    for (const project of ['unit', 'unit-dom', 'integration', 'api', 'generated'] as const)
      expect(jestExtraArgs({ kind: 'jest', projects: [project], paths: [], coverage: true }, { testTimeoutMs: 1 }).length > 0).toBe(
        IN_BAND_COVERAGE_PROJECTS.includes(project),
      );
  });
});
