/**
 * Lane C inventory cross-check (ADR-0023 am. G item 6; SEC-TC-48; TASK-015 part 015-B): file-to-project mapping, the
 * lane C and lane B per-file counts, the discrepancy rules and the CLI against the repository's own lane B evidence.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(projectsOf('tests/generated/rls/cross-tenant.int.test.ts')).toEqual(['generated']);
    expect(projectsOf('tests/generated/rbac/matrix.test.ts')).toEqual(['unit']);
    expect(projectsOf('tests/e2e/web.spec.ts')).toEqual([]);
    expect(projectsOf('apps/api/dist/x.test.ts')).toEqual([]);
  });

  it('[PR #46 N7] tests/generated/** is in neither integration nor api (jest.config.ts GENERATED_PATH), fixtures are in no project', () => {
    expect(projectsOf('tests/generated/rls/cross-tenant.int.test.ts')).not.toContain('integration');
    expect(projectsOf('tests/generated/rbac/matrix.api.test.ts')).toEqual(['generated']);
    expect(projectsOf('apps/api/tests/generated/x.int.test.ts')).toEqual(['generated']);
    expect(projectsOf('tests/api/generated/x.api.test.ts')).toEqual(['api']);
    expect(projectsOf('tests/fixtures/lint/x.test.ts')).toEqual([]);
    expect(fileInSuite('tests/generated/rls/cross-tenant.int.test.ts', { projects: ['integration'], paths: [] })).toBe(false);
    expect(fileInSuite('tests/generated/rls/cross-tenant.int.test.ts', { projects: ['generated'], paths: ['tests/generated/rls/'] })).toBe(
      true,
    );
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

  const assertions = (cases: [string, string][]) => ({
    testResults: [{ name: join(repoRoot, 'a', 'x.test.ts'), assertionResults: cases.map(([fullName, status]) => ({ fullName, status })) }],
  });

  it('[PR #46 M1] two tests of one file that share a full name count twice in one report', () => {
    expect(
      jestFileCounts(
        [
          assertions([
            ['same name', 'passed'],
            ['same name', 'passed'],
            ['other', 'passed'],
          ]),
        ],
        repoRoot,
      ),
    ).toEqual({ 'a/x.test.ts': { tests: 3, failures: 0, skipped: 0 } });
  });

  it('[PR #46 M1] a duplicate pair seen in two reports counts as the most occurrences of one report, and a failed copy is a failure', () => {
    const pair = assertions([
      ['same name', 'passed'],
      ['same name', 'passed'],
    ]);
    expect(jestFileCounts([pair, pair], repoRoot)).toEqual({ 'a/x.test.ts': { tests: 2, failures: 0, skipped: 0 } });
    const oneFailed = assertions([
      ['same name', 'passed'],
      ['same name', 'failed'],
    ]);
    expect(jestFileCounts([oneFailed], repoRoot)).toEqual({ 'a/x.test.ts': { tests: 2, failures: 1, skipped: 0 } });
    expect(jestFileCounts([pair, assertions([['same name', 'failed']])], repoRoot)).toEqual({
      'a/x.test.ts': { tests: 2, failures: 1, skipped: 0 },
    });
    expect(jestFileCounts([assertions([['same name', 'failed']]), pair], repoRoot)).toEqual({
      'a/x.test.ts': { tests: 2, failures: 1, skipped: 0 },
    });
  });

  it('[PR #46 M1] lane B JUnit with a duplicate pair and the lane C Jest report of the same file give no lower-count', () => {
    const xml = [
      '<testsuites><testsuite name="unit" tests="3" failures="0" errors="0" skipped="0">',
      '<testcase name="same name" classname="a/x.test.ts" time="0"/>',
      '<testcase name="same name" classname="a/x.test.ts" time="0"/>',
      '<testcase name="other" classname="a/x.test.ts" time="0"/>',
      '</testsuite></testsuites>',
    ].join('');
    const laneC = {
      unit: jestFileCounts(
        [
          assertions([
            ['same name', 'passed'],
            ['same name', 'passed'],
            ['other', 'passed'],
          ]),
        ],
        repoRoot,
      ),
    };
    expect(compare({ laneC, references: [{ run: 'r', same_code: true, suites: { unit: junitFileCounts(xml) } }] })).toEqual([]);
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

describe('inventory: reference runs and same code in a scratch repository (PR #46 m6)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'inventory-git-'));
  temps.push(repo);
  const git = (...args: string[]): string => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=inventory-test', '-c', 'user.email=inventory-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      { cwd: repo, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const put = (path: string, text: string) => {
    const full = join(repo, ...path.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  };
  const runs = 'docs/05-quality/tests/runs';
  git('init', '-q');
  put('src/a.ts', 'export const a = 1;\n');
  put(`${runs}/20261101T1000Z_aaaaaaa/summary.json`, '{"v":1}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const since = git('rev-parse', 'HEAD');
  put(`${runs}/20261102T1000Z_bbbbbbb/summary.json`, '{}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'run b');
  put(`${runs}/20261103T1000Z_ccccccc/summary.json`, '{}\n');
  put('docs/notes.md', 'notes\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'run c and docs');
  const docsOnly = git('rev-parse', 'HEAD');
  put(`${runs}/20261101T1000Z_aaaaaaa/summary.json`, '{"v":2}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'modify the old run');
  const modified = git('rev-parse', 'HEAD');
  put('src/a.ts', 'export const a = 2;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'code');
  const code = git('rev-parse', 'HEAD');

  it('--since selects every run directory ADDED in since..sha (two runs), not one whose summary was only modified', () => {
    expect(referenceRuns(repo, modified, since)).toEqual(['20261102T1000Z_bbbbbbb', '20261103T1000Z_ccccccc']);
    expect(referenceRuns(repo, docsOnly, since)).toEqual(['20261102T1000Z_bbbbbbb', '20261103T1000Z_ccccccc']);
    expect(referenceRuns(repo, since, since)).toEqual([]);
  });

  it('without --since only the newest run directory of the tree is taken', () => {
    expect(referenceRuns(repo, code, undefined)).toEqual(['20261103T1000Z_ccccccc']);
  });

  it('same code: a diff only under docs/ is the same code, a code diff is not', () => {
    expect(sameCode(repo, since, docsOnly)).toBe(true);
    expect(sameCode(repo, since, modified)).toBe(true);
    expect(sameCode(repo, since, code)).toBe(false);
    expect(sameCode(repo, modified, code)).toBe(false);
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

  it('[PR #46 m6] wave-end without --since records references_scope newest-only and prints a WARNING; with --since it records the since scope and no warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inventory-'));
    temps.push(dir);
    writeFileSync(join(dir, 'unit.jest.json'), JSON.stringify({ testResults: [] }));
    const out = join(dir, 'inventory.json');
    const newest = runNode([script, '--root', repoRoot, '--jest', dir, '--profile', 'wave-end', '--out', out], { cwd: repoRoot });
    expect(newest.stdout).toContain('**WARNING: wave-end without --since compares the newest lane B run only');
    expect((JSON.parse(readFileSync(out, 'utf8')) as { references_scope: string }).references_scope).toBe('newest-only');
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
    const scoped = runNode([script, '--root', repoRoot, '--jest', dir, '--profile', 'wave-end', '--since', head, '--out', out], {
      cwd: repoRoot,
    });
    expect(scoped.status).toBe(0);
    expect(scoped.stdout).not.toContain('WARNING');
    expect(scoped.stdout).toContain(`References (since:${head}): none`);
    const inventory = JSON.parse(readFileSync(out, 'utf8')) as { references_scope: string; references: unknown[] };
    expect(inventory.references_scope).toBe(`since:${head}`);
    expect(inventory.references).toEqual([]);
    const rc = runNode([script, '--root', repoRoot, '--jest', dir, '--profile', 'release-candidate', '--out', out], { cwd: repoRoot });
    expect(rc.stdout).not.toContain('WARNING');
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
