/**
 * Hosted security-integration job runner (TASK-015 part 015-B; ADR-0023 am. G item 5): suite selection from the base-ref
 * manifest and runners, the per-suite verdict, and a dry run over the repository's own manifests.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { planSecuritySuites, suiteProblems } from './security-integration.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'security-integration.mjs');
const manifestPath = join(repoRoot, 'tools', 'quality', 'required-suites.json');
const runnersPath = join(repoRoot, 'tools', 'quality', 'suite-runners.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown> & {
  suites: Record<string, Record<string, unknown>>;
  security_integration_suites: string[];
};
const runners = JSON.parse(readFileSync(runnersPath, 'utf8')) as { suites: Record<string, Record<string, unknown>> };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function withStatus(ids: Record<string, string>): typeof manifest {
  const copy = clone(manifest);
  for (const [id, status] of Object.entries(ids)) {
    const suite = copy.suites[id];
    if (suite === undefined) throw new Error(`no suite ${id}`);
    suite['status'] = status;
  }
  return copy;
}

describe('security-integration: plan', () => {
  it('runs the active security suites through their lane B runner entry, coverage off, and lists the planned ones', () => {
    const plan = planSecuritySuites(manifest, runners);
    expect(plan.errors).toEqual([]);
    const active = manifest.security_integration_suites.filter((id) => manifest.suites[id]?.['status'] === 'active');
    expect(plan.run.map((s) => s.id)).toEqual(active);
    expect(plan.run.length).toBeGreaterThan(0);
    expect(plan.run.every((s) => !s.runner.coverage)).toBe(true);
    // Mutant I6: the override, not the runner file, turns coverage off. A coverage runner covers whole projects
    // (parseRunners), so the entries become whole-project coverage runners here; the plan still runs them without.
    const covered = clone(runners);
    for (const s of plan.run) {
      const entry = covered.suites[s.id];
      if (entry === undefined) continue;
      delete entry['paths'];
      delete entry['testNamePattern'];
      entry['coverage'] = true;
    }
    expect(planSecuritySuites(manifest, covered).run.map((s) => s.runner.coverage)).toEqual(plan.run.map(() => false));
    expect(plan.notActive.map((s) => s.id)).toEqual(manifest.security_integration_suites.filter((id) => !active.includes(id)));
  });

  it('fails an active suite without a runner entry, a command runner, an unknown id and an empty or inactive list', () => {
    const noRunner = planSecuritySuites(withStatus({ 'rbac-matrix': 'active' }), runners);
    expect(noRunner.errors).toEqual(['rbac-matrix: active without a suite-runners.json entry']);

    const commandRunners = clone(runners);
    commandRunners.suites['catalog-c1-c14'] = { kind: 'command', cmd: ['{node}', 'x.mjs'], converter: 'junit' };
    expect(planSecuritySuites(manifest, commandRunners).errors).toEqual([
      'catalog-c1-c14: security-integration runs Jest suites only (kind command)',
    ]);

    const unknown = clone(manifest);
    unknown.security_integration_suites = [...unknown.security_integration_suites, 'no-such-suite'];
    expect(planSecuritySuites(unknown, runners).errors).toEqual(['no-such-suite: not a suite of the manifest']);

    const empty = clone(manifest);
    empty.security_integration_suites = [];
    expect(planSecuritySuites(empty, runners).errors).toEqual(['security_integration_suites must be a non-empty list of suite ids']);

    const inactive = withStatus(Object.fromEntries(manifest.security_integration_suites.map((id) => [id, 'planned'])));
    expect(planSecuritySuites(inactive, runners)).toMatchObject({
      run: [],
      errors: ['no security_integration_suites suite is active (fail closed)'],
    });
  });
});

describe('security-integration: suite verdict', () => {
  const planned = {
    id: 'catalog-c1-c14',
    suite: { status: 'active', security: true, zero_skip: true, min_tests: 3, required_cases: ['SEC-TC-06'], lane: ['B'] },
    runner: { kind: 'jest', projects: ['integration'], paths: ['prisma/tests/catalog/'], coverage: false },
  } as Parameters<typeof suiteProblems>[0];
  const report = (names: Array<[string, string]>, pending = 0) => ({
    numTotalTests: names.length,
    numFailedTests: names.filter(([, s]) => s === 'failed').length,
    numPendingTests: pending,
    testResults: [{ assertionResults: names.map(([fullName, status]) => ({ fullName, status })) }],
  });

  it('passes a clean run that carries the required cases', () => {
    const r = report([
      ['C1 SEC-TC-06 x', 'passed'],
      ['b', 'passed'],
      ['c', 'passed'],
    ]);
    expect(suiteProblems(planned, { status: 0, report: r })).toEqual([]);
  });

  it('fails a missing report, too few tests, failures, skips in a zero-skip suite, a missing case and a bare non-zero exit', () => {
    expect(suiteProblems(planned, { status: 1, report: null })).toEqual(['jest wrote no JSON report (exit 1)']);
    expect(suiteProblems(planned, { status: 0, report: report([['SEC-TC-06', 'passed']]) })).toEqual(['1 tests, at least 3 required']);
    const failing = report([
      ['SEC-TC-06', 'passed'],
      ['b', 'failed'],
      ['c', 'passed'],
    ]);
    expect(suiteProblems(planned, { status: 1, report: failing })).toEqual(['1 failed']);
    const skipped = {
      ...report([
        ['SEC-TC-06', 'passed'],
        ['b', 'passed'],
        ['c', 'passed'],
      ]),
      numPendingTests: 1,
    };
    expect(suiteProblems(planned, { status: 0, report: skipped })).toEqual(['1 skipped in a zero-skip suite']);
    const noCase = report([
      ['SEC-TC-06 failed here', 'failed'],
      ['b', 'passed'],
      ['c', 'passed'],
    ]);
    expect(suiteProblems(planned, { status: 1, report: noCase })).toEqual([
      '1 failed',
      'required case SEC-TC-06 is not in a passing test name',
    ]);
    const clean = report([
      ['SEC-TC-06', 'passed'],
      ['b', 'passed'],
      ['c', 'passed'],
    ]);
    expect(suiteProblems(planned, { status: 1, report: clean })).toEqual([
      'jest exited 1 without a failing test (open handle or runtime error)',
    ]);
  });

  it('[PR46-SEC-06] a required case matches its exact ID only: SEC-TC-060 does not satisfy SEC-TC-06; bracketed, trailing and colon forms do', () => {
    const decoy = report([
      ['SEC-TC-060 decoy', 'passed'],
      ['b', 'passed'],
      ['c', 'passed'],
    ]);
    expect(suiteProblems(planned, { status: 0, report: decoy })).toEqual(['required case SEC-TC-06 is not in a passing test name']);
    for (const name of ['[SEC-TC-06] bracketed', 'trailing SEC-TC-06', 'SEC-TC-06: colon', 'SEC-TC-060 decoy and SEC-TC-06 real']) {
      const named = report([
        [name, 'passed'],
        ['b', 'passed'],
        ['c', 'passed'],
      ]);
      expect([name, suiteProblems(planned, { status: 0, report: named })]).toEqual([name, []]);
    }
  });

  it('[review N2, mutant I4] todo tests count as skipped in a zero-skip suite', () => {
    const todo = {
      ...report([
        ['SEC-TC-06', 'passed'],
        ['b', 'passed'],
        ['c', 'passed'],
      ]),
      numTodoTests: 2,
    };
    expect(suiteProblems(planned, { status: 0, report: todo })).toEqual(['2 skipped in a zero-skip suite']);
  });
});

describe('security-integration: CLI', () => {
  // The dry run is refused on GitHub Actions (m1), so these runs clear the variable the hosted unit tests inherit.
  const localEnv = { ...process.env, GITHUB_ACTIONS: '' };

  it('a dry run over the repository manifests prints one Jest command per active suite and exits 0', () => {
    const r = runNode([script, '--root', repoRoot, '--manifest', manifestPath, '--runners', runnersPath, '--dry-run'], {
      cwd: repoRoot,
      env: localEnv,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('security-integration: catalog-c1-c14: node --experimental-vm-modules');
    expect(r.stdout).toContain('prisma/tests/catalog/ --selectProjects integration');
    expect(r.stdout).toContain('-i --testTimeout=60000');
  });

  it('[review m1] --dry-run is refused with exit 2 on GitHub Actions, before any plan or Jest command', () => {
    const r = runNode([script, '--root', repoRoot, '--manifest', manifestPath, '--runners', runnersPath, '--dry-run'], {
      cwd: repoRoot,
      env: { ...process.env, GITHUB_ACTIONS: 'true' },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--dry-run is refused on GitHub Actions');
    expect(r.stdout).not.toContain('catalog-c1-c14: node');
  });

  it('[review m1, mutant I7] a dry run with a plan error exits 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'security-integration-'));
    try {
      const inactive = join(dir, 'required-suites.json');
      const planned = withStatus(Object.fromEntries(manifest.security_integration_suites.map((id) => [id, 'planned'])));
      writeFileSync(inactive, JSON.stringify(planned));
      const r = runNode([script, '--root', repoRoot, '--manifest', inactive, '--runners', runnersPath, '--dry-run'], {
        cwd: repoRoot,
        env: localEnv,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no security_integration_suites suite is active (fail closed)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses missing arguments, a bad timeout and an unreadable manifest with exit 2', () => {
    expect(runNode([script, '--root', repoRoot], { cwd: repoRoot }).status).toBe(2);
    const base = ['--root', repoRoot, '--manifest', manifestPath, '--runners', runnersPath, '--dry-run'];
    expect(runNode([script, ...base, '--test-timeout', '5s'], { cwd: repoRoot, env: localEnv }).status).toBe(2);
    expect(
      runNode([script, '--root', repoRoot, '--manifest', join(repoRoot, 'nope.json'), '--runners', runnersPath], { cwd: repoRoot }).status,
    ).toBe(2);
  });
});
