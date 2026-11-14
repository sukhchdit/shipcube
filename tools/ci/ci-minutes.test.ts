/**
 * `npm run ci:minutes` (TASK-015 part 015-B; ADR-0023 am. C guards; SPK-07): the billing estimate (per job, rounded up,
 * runner multiplier), the guard levels and the per-run lane A figures, on fixtures (no network).
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { billedMinutes, guardFor, monthRange, multiplier, percentile, render, summarize } from './ci-minutes.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'ci-minutes.mjs');

const at = (minute: number, second = 0): string => new Date(Date.UTC(2026, 10, 14, 10, minute, second)).toISOString();
const job = (runId: number, name: string, from: [number, number], to: [number, number], labels = ['ubuntu-24.04']) => ({
  run_id: runId,
  name,
  started_at: at(...from),
  completed_at: at(...to),
  labels,
  conclusion: 'success',
});
const run = (id: number, path: string, event: string, start: number, end: number) => ({
  id,
  name: path,
  path: `.github/workflows/${path}`,
  event,
  created_at: at(start),
  run_started_at: at(start),
  updated_at: at(end),
  status: 'completed',
  conclusion: 'success',
});

describe('ci:minutes: billing rule', () => {
  it('rounds each job up to a whole minute and applies the runner multiplier', () => {
    expect(billedMinutes(job(1, 'a', [0, 0], [0, 1]))).toBe(1);
    expect(billedMinutes(job(1, 'a', [0, 0], [8, 0]))).toBe(8);
    expect(billedMinutes(job(1, 'a', [0, 0], [8, 1]))).toBe(9);
    expect(billedMinutes(job(1, 'a', [0, 0], [3, 0], ['windows-latest']))).toBe(6);
    expect(billedMinutes(job(1, 'a', [0, 0], [3, 0], ['macos-14']))).toBe(30);
    expect(billedMinutes(job(1, 'a', [0, 0], [3, 0], ['self-hosted', 'heavy']))).toBe(0);
    expect(multiplier(['ubuntu-latest'])).toBe(1);
  });

  it('counts a skipped or never-started job as 0', () => {
    expect(billedMinutes({ ...job(1, 'a', [0, 0], [0, 0]), conclusion: 'skipped' })).toBe(0);
    expect(billedMinutes({ ...job(1, 'a', [0, 0], [1, 0]), started_at: null })).toBe(0);
  });

  it('maps usage to the ADR-0023 guard levels', () => {
    expect(guardFor(69.9).level).toBe('ok');
    expect(guardFor(70).level).toBe('guard-70');
    expect(guardFor(90).level).toBe('guard-90');
    expect(guardFor(100).level).toBe('degraded');
    expect(guardFor(140).action).toContain('degraded mode');
  });

  it('nearest-rank percentiles and the month range', () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBe(0);
    expect(monthRange('2026-11')).toBe('2026-11-01..2026-11-30');
    expect(monthRange('2028-02')).toBe('2028-02-01..2028-02-29');
  });
});

describe('ci:minutes: summary', () => {
  const runs = [
    run(1, 'ci.yml', 'pull_request', 0, 12),
    run(2, 'ci.yml', 'pull_request', 20, 30),
    run(3, 'lane-c.yml', 'workflow_dispatch', 0, 40),
  ];
  const jobs = [
    job(1, 'fast-lane', [0, 0], [9, 30]),
    job(1, 'scans', [0, 0], [3, 10]),
    job(1, 'ci-gate', [11, 0], [11, 5]),
    job(2, 'fast-lane', [20, 0], [27, 0]),
    job(2, 'scans', [20, 0], [22, 30]),
    { ...job(2, 'security-integration', [0, 0], [0, 0]), conclusion: 'skipped' },
    job(2, 'ci-gate', [28, 0], [28, 3]),
    job(3, 'integration', [0, 0], [25, 0]),
  ];

  it('totals per workflow and job, the allowance share and the lane A per-PR-run figures', () => {
    const s = summarize(runs, jobs, { allowance: 2000 });
    expect(s.total_minutes).toBe(10 + 4 + 1 + 7 + 3 + 0 + 1 + 25);
    expect(s.percent).toBe(2.6);
    expect(s.guard.level).toBe('ok');
    expect(s.workflows).toEqual([
      { workflow: 'ci.yml', runs: 2, minutes: 26 },
      { workflow: 'lane-c.yml', runs: 1, minutes: 25 },
    ]);
    expect(s.lane_a_pr_run.job_minutes).toEqual({ n: 2, median: 11, p90: 15, max: 15 });
    expect(s.lane_a_pr_run.wall_clock_minutes).toEqual({ n: 2, median: 10, p90: 12, max: 12 });
    expect(s.jobs.find((j) => j.job === 'ci.yml:fast-lane')).toMatchObject({ n: 2, median: 7, p90: 10, minutes: 17 });
    expect(s.jobs.some((j) => j.job === 'ci.yml:security-integration')).toBe(false);
    const text = render(s, '2026-11', 'o/r');
    expect(text).toContain('Total: 51 of 2000 min (2.6 %), guard: ok');
    expect(text).toContain('Lane A per pull-request run (ci.yml): job-min median 11, p90 15 (n=2)');
  });

  it('ignores jobs of runs outside the month list', () => {
    expect(summarize(runs, [job(99, 'x', [0, 0], [50, 0])], { allowance: 2000 }).total_minutes).toBe(0);
  });
});

describe('ci:minutes: CLI arguments', () => {
  it('refuses a malformed month, repository or allowance with exit 2 (before any API call)', () => {
    expect(runNode([script, '--month', '2026-13'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--repo', 'not a repo'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--repo', 'o/r', '--allowance', '-1'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--bogus'], { cwd: repoRoot }).status).toBe(2);
  });
});
