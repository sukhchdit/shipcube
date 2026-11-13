/**
 * quality:flake-report (TASK-277, T-QA-02; TEST-STRATEGY section 11): tests with mixed outcomes over the stored runs,
 * same-SHA mixes (definite flakes) separated from cross-SHA mixes (informational).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { main } from './flake-report.mjs';
import { toJUnit } from './lib/junit-write.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Status = 'passed' | 'failed' | 'error' | 'skipped';

function junit(cases: Record<string, Status> | Array<[string, Status]>): string {
  const list = Array.isArray(cases) ? cases : Object.entries(cases);
  return toJUnit({ suite: 'suite', cases: list.map(([name, status]) => ({ name, classname: 'file.test.ts', time: 0, status })) });
}

/** Runs keyed by `<stamp>_<sha7>`, each with files keyed by name. */
function makeRoot(runs: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'flake-report-'));
  temps.push(root);
  for (const [run, files] of Object.entries(runs)) {
    const dir = join(root, 'docs', '05-quality', 'tests', 'runs', run);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  }
  return root;
}

function run(argv: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

type Flaky = {
  suite: string;
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  passed_runs: string[];
  failed_runs: string[];
  mixed_shas: string[];
};
type Report = { runs: string[]; tests_observed: number; same_sha_mixed: Flaky[]; cross_sha_mixed: Flaky[]; problems: string[] };

const RUNS = {
  '20261113T0800Z_aaaaaaa': {
    'unit.junit.xml': junit({ stable: 'passed', 'same sha flake': 'passed', 'cross sha': 'failed', 'skip only mix': 'skipped' }),
    'api.junit.xml': junit({ 'fixed on the next sha': 'failed', 'always fails': 'failed' }),
    'summary.json': '{}',
  },
  '20261113T0900Z_aaaaaaa': {
    'unit.junit.xml': junit({ stable: 'passed', 'same sha flake': 'error', 'skip only mix': 'passed' }),
    'api.junit.xml': junit({ 'always fails': 'failed' }),
  },
  '20261113T1000Z_bbbbbbb': {
    'unit.junit.xml': junit({ stable: 'passed', 'cross sha': 'passed', 'same sha flake': 'passed' }),
    'api.junit.xml': `${junit({ 'fixed on the next sha': 'passed' })}`,
  },
  'not-a-run-dir': { 'unit.junit.xml': junit({ stable: 'failed' }) },
};

describe('quality:flake-report', () => {
  it('lists mixed-outcome tests, separating same-SHA flakes from cross-SHA mixes', () => {
    const root = makeRoot(RUNS);
    const result = run(['--root', root]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out.join('\n')) as Report;
    expect(report.runs).toEqual(['20261113T0800Z_aaaaaaa', '20261113T0900Z_aaaaaaa', '20261113T1000Z_bbbbbbb']);
    expect(report.same_sha_mixed.map((t) => [t.suite, t.name])).toEqual([['unit', 'same sha flake']]);
    expect(report.same_sha_mixed[0]).toMatchObject({
      passed: 2,
      failed: 1,
      passed_runs: ['20261113T0800Z_aaaaaaa', '20261113T1000Z_bbbbbbb'],
      failed_runs: ['20261113T0900Z_aaaaaaa'],
      mixed_shas: ['aaaaaaa'],
    });
    expect(report.cross_sha_mixed.map((t) => [t.suite, t.name])).toEqual([
      ['api', 'fixed on the next sha'],
      ['unit', 'cross sha'],
    ]);
    expect(report.cross_sha_mixed[1]).toMatchObject({ mixed_shas: [], failed_runs: ['20261113T0800Z_aaaaaaa'] });
    // Skipped observations never make a mix; a test that always fails is broken, not flaky.
    expect(JSON.stringify(report)).not.toContain('skip only mix');
    expect(JSON.stringify(report)).not.toContain('always fails');
    expect(report.problems).toEqual([]);
  });

  it('counts a pass and a failure of one test inside the same run as a same-SHA flake (retry)', () => {
    const root = makeRoot({
      '20261113T0800Z_ccccccc': {
        'e2e.junit.xml': junit([
          ['retried test', 'failed'],
          ['retried test', 'passed'],
        ]),
      },
    });
    const result = run(['--root', root]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out.join('\n')) as Report;
    expect(report.same_sha_mixed.map((t) => t.name)).toEqual(['retried test']);
  });

  it('is deterministic and --out writes the same JSON; --fail-on-same-sha exits 1 only with same-SHA flakes', () => {
    const root = makeRoot(RUNS);
    const out = join(root, 'flake-report.json');
    const stdout = run(['--root', root]).out.join('\n');
    const written = run(['--root', root, '--out', out]);
    expect(written.code).toBe(0);
    expect(written.out[0]).toContain('3 runs');
    expect(readFileSync(out, 'utf8')).toBe(`${stdout}\n`);
    expect(run(['--root', root, '--fail-on-same-sha']).code).toBe(1);
    const clean = makeRoot({
      '20261113T0800Z_aaaaaaa': { 'unit.junit.xml': junit({ ok: 'passed' }) },
      '20261113T0900Z_bbbbbbb': { 'unit.junit.xml': junit({ ok: 'failed' }) },
    });
    expect(run(['--root', clean, '--fail-on-same-sha']).code).toBe(0);
  });

  it('exits 1 on unparseable input without echoing it, and 2 on usage errors', () => {
    const root = makeRoot({ '20261113T0800Z_aaaaaaa': { 'unit.junit.xml': '<testsuite><testcase name="leak-me">' } });
    const result = run(['--root', root]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      'quality:flake-report: docs/05-quality/tests/runs/20261113T0800Z_aaaaaaa/unit.junit.xml: unparseable JUnit XML',
    ]);
    expect(result.out.join('\n')).not.toContain('leak-me');
    expect(run(['--root', root, '--runs', join(root, 'missing')]).code).toBe(1);
    expect(run(['--nope']).code).toBe(2);
  });
});
