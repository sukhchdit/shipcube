/**
 * Lane C inventory cross-check (ADR-0023 am. G item 6; SEC-TC-48; TASK-015 part 015-B): file-to-project mapping, the
 * lane C and lane B per-file counts, the discrepancy rules and the CLI against the repository's own lane B evidence.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  compare,
  fileInSuite,
  jestFileCounts,
  junitFileCounts,
  playwrightCounts,
  projectsOf,
  referenceRuns,
  sameCode,
} from './inventory.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'quality', 'inventory.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('inventory: suite membership (jest.config.ts projects, suite-runners.json paths)', () => {
  it('maps test files to Jest projects like jest.config.ts', () => {
    expect(projectsOf('tools/ci/x.test.ts')).toEqual(['unit']);
    expect(projectsOf('apps/web/app/x.test.tsx')).toEqual(['unit-dom']);
    expect(projectsOf('prisma/tests/catalog/c01-c12.int.test.ts')).toEqual(['integration']);
    expect(projectsOf('tests/api/x.api.test.ts')).toEqual(['api']);
    expect(projectsOf('tests/generated/rls/cross-tenant.int.test.ts')).toEqual(['integration', 'generated']);
    expect(projectsOf('tests/generated/rbac/matrix.test.ts')).toEqual(['unit']);
    expect(projectsOf('tests/e2e/web.spec.ts')).toEqual([]);
    expect(projectsOf('apps/api/dist/x.test.ts')).toEqual([]);
  });

  it('a suite holds the files of its projects under its paths', () => {
    const catalog = { projects: ['integration'], paths: ['prisma/tests/catalog/'] };
    expect(fileInSuite('prisma/tests/catalog/c01-c12.int.test.ts', catalog)).toBe(true);
    expect(fileInSuite('prisma/tests/migrations/x.int.test.ts', catalog)).toBe(false);
    expect(fileInSuite('prisma/tests/catalog/scans.test.ts', catalog)).toBe(false);
    expect(fileInSuite('tools/ci/x.test.ts', { projects: ['unit', 'unit-dom'], paths: [] })).toBe(true);
  });
});

describe('inventory: counts', () => {
  it('lane C Jest reports: per file, a test seen in two reports counts once (failed wins)', () => {
    const report = (status: string) => ({
      testResults: [
        {
          name: join(repoRoot, 'a', 'x.int.test.ts'),
          assertionResults: [
            { fullName: 't1', status },
            { fullName: 't2', status: 'pending' },
          ],
        },
      ],
    });
    expect(jestFileCounts([report('passed'), report('failed')], repoRoot)).toEqual({
      'a/x.int.test.ts': { tests: 2, failures: 1, skipped: 1 },
    });
  });

  it('lane B JUnit: per file, the harness cases (classname = suite id) are left out', () => {
    const xml = [
      '<testsuites><testsuite name="unit" tests="4" failures="1" errors="0" skipped="1">',
      '<testcase name="a" classname="tools/ci/x.test.ts" time="0"/>',
      '<testcase name="b" classname="tools/ci/x.test.ts" time="0"><failure message="m"/></testcase>',
      '<testcase name="coverage gate: overall lines" classname="unit" time="0"/>',
      '<testcase name="c" classname="tools/ci/y.test.ts" time="0"><skipped/></testcase>',
      '</testsuite></testsuites>',
    ].join('');
    expect(junitFileCounts(xml)).toEqual({
      'tools/ci/x.test.ts': { tests: 2, failures: 1, skipped: 0 },
      'tools/ci/y.test.ts': { tests: 1, failures: 0, skipped: 1 },
    });
  });

  it('Playwright JUnit: per engine, --repeat-each repetitions count once, a failure is kept', () => {
    const suite = (project: string, cases: string) => `<testsuite name="web.spec.ts" hostname="${project}" tests="2">${cases}</testsuite>`;
    const pass = '<testcase name="t" classname="web.spec.ts" time="1"></testcase>';
    const fail = '<testcase name="t" classname="web.spec.ts" time="1"><failure message="x"/></testcase>';
    const xml = `<testsuites>${suite('webkit-mobile', pass + pass + fail)}${suite('webkit-desktop', pass)}${suite('firefox-mobile', pass)}</testsuites>`;
    expect(playwrightCounts([xml])).toEqual({
      'e2e-webkit': { projects: ['webkit-desktop', 'webkit-mobile'], tests: 2, failures: 1 },
      'e2e-firefox': { projects: ['firefox-mobile'], tests: 1, failures: 0 },
    });
  });
});

describe('inventory: discrepancies (SEC-TC-48 cross-check)', () => {
  const laneB = {
    unit: { 'x.test.ts': { tests: 3, failures: 0, skipped: 0 } },
    integration: { 'y.int.test.ts': { tests: 2, failures: 0, skipped: 0 } },
  };

  it('consistent: same counts, no failures', () => {
    expect(compare({ laneC: laneB, references: [{ run: 'r', same_code: true, suites: laneB }] })).toEqual([]);
  });

  it('missing suite, lower count and Linux-only failure at the same SHA', () => {
    const laneC = {
      unit: { 'x.test.ts': { tests: 2, failures: 1, skipped: 0 } },
      integration: {},
    };
    expect(compare({ laneC, references: [{ run: 'r', same_code: true, suites: laneB }] })).toEqual([
      { suite: 'unit', kind: 'lower-count', run: 'r', detail: 'x.test.ts: 2 on Linux, 3 in lane B' },
      { suite: 'unit', kind: 'linux-fail', run: 'r', detail: 'x.test.ts: 1 failed on Linux, passed in lane B' },
      { suite: 'integration', kind: 'missing-suite', run: 'r', detail: 'lane B ran 2 tests, lane C none' },
    ]);
  });

  it('a reference run of other code is checked for missing suites only; suites lane C does not inventory are skipped', () => {
    const laneC = { unit: { 'x.test.ts': { tests: 1, failures: 1, skipped: 0 } } };
    expect(compare({ laneC, references: [{ run: 'old', same_code: false, suites: laneB }] })).toEqual([]);
  });
});

describe('inventory: CLI', () => {
  it('takes the newest lane B run directory of the tree without --since', () => {
    const runs = referenceRuns(repoRoot, 'HEAD', undefined);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatch(/^\d{8}T\d{4}Z_[0-9a-f]{7}$/u);
  });

  it('same code = the run commit is in the clone and only docs/ or .claude/ differ', () => {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
    expect(sameCode(repoRoot, head, head)).toBe(true);
    expect(sameCode(repoRoot, 'f'.repeat(40), head)).toBe(false);
    expect(sameCode(repoRoot, 'HEAD', head)).toBe(false);
  });

  it('a lane C run that ran none of the reference unit tests is a missing-suite discrepancy (exit 1, inventory written)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inventory-'));
    temps.push(dir);
    writeFileSync(join(dir, 'unit.jest.json'), JSON.stringify({ testResults: [] }));
    const out = join(dir, 'inventory.json');
    const r = runNode([script, '--root', repoRoot, '--jest', dir, '--profile', 'wave-end', '--out', out], { cwd: repoRoot });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('**missing-suite** `unit`');
  });

  it('refuses a bad profile, a non-SHA --since and an empty report directory with exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inventory-'));
    temps.push(dir);
    const base = ['--root', repoRoot, '--jest', dir, '--out', join(dir, 'i.json')];
    expect(runNode([script, ...base, '--profile', 'nightly'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, ...base, '--profile', 'wave-end', '--since', 'main~3'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, ...base, '--profile', 'wave-end'], { cwd: repoRoot }).status).toBe(2);
  });
});
