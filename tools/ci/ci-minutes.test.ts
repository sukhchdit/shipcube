/**
 * `npm run ci:minutes` (TASK-015 part 015-B; ADR-0023 am. C guards; SPK-07): the billing estimate (per job, rounded up,
 * runner multiplier), the guard levels and the per-run lane A figures, on fixtures (no network).
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  GUARDS,
  billedMinutes,
  forecast,
  guardFor,
  jobLabel,
  main,
  monthRange,
  multiplier,
  notBilled,
  percentile,
  render,
  runCapProblem,
  summarize,
} from './ci-minutes.mjs';

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

  it('maps usage to the ADR-0023 am. L item 4 guard levels: 70 % on the forecast, 90/95/100 % on actual usage', () => {
    expect(guardFor(69.9).level).toBe('ok');
    expect(guardFor(70).level).toBe('guard-70');
    expect(guardFor(90).level).toBe('guard-90');
    expect(guardFor(95).level).toBe('guard-95');
    expect(guardFor(100).level).toBe('degraded');
    expect(guardFor(140).action).toContain('degraded mode');
    // The 70 % guard acts on the month forecast; the higher guards only on actual usage.
    expect(guardFor(40, 78.8).level).toBe('guard-70');
    expect(guardFor(40, 69.9).level).toBe('ok');
    expect(guardFor(40, 120).level).toBe('guard-70');
    expect(guardFor(91, 50).level).toBe('guard-90');
    expect(GUARDS.map((g) => [g.at, g.basis])).toEqual([
      [100, 'actual'],
      [95, 'actual'],
      [90, 'actual'],
      [70, 'forecast'],
    ]);
    expect(guardFor(70).action).toBe(
      'tier-1 lane C only (<= 1 wave-end a month), process levers P1/P2 mandatory, CI_MAIN_FAST_LANE stays false',
    );
    expect(guardFor(90).action).toContain('except a tier-1 wave-end already planned for the month');
    expect(guardFor(96).action).toContain('hard stop');
    expect(guardFor(100).action).toContain('never for security-critical paths');
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
    expect(s.jobs.find((j) => j.job === 'ci.yml:fast-lane (full)')).toMatchObject({ n: 2, median: 7, p90: 10, minutes: 17 });
    expect(s.jobs.some((j) => j.job === 'ci.yml:security-integration')).toBe(false);
    const text = render(s, '2026-11', 'o/r');
    expect(text).toContain('Total: 51 of 2000 min (2.6 %), guard: ok');
    expect(text).toContain('Lane A per pull-request run (ci.yml): job-min median 11, p90 15 (n=2)');
    expect(text).toContain('Not billed (Dependabot on standard runners): 0 min in 0 run(s), excluded from the total');
    expect(s.forecast).toBeNull();
    expect(text).not.toContain('Forecast');
  });

  it('[N4 M3] the lane A per-PR-run figures count pull_request runs only (a ci.yml push run on main is left out)', () => {
    const s = summarize(
      [run(1, 'ci.yml', 'pull_request', 0, 12), run(4, 'ci.yml', 'push', 30, 35)],
      [job(1, 'fast-lane', [0, 0], [9, 30]), job(4, 'fast-lane', [30, 0], [33, 0])],
      { allowance: 2000 },
    );
    expect(s.total_minutes).toBe(13);
    expect(s.lane_a_pr_run.job_minutes).toEqual({ n: 1, median: 10, p90: 10, max: 10 });
    expect(s.lane_a_pr_run.wall_clock_minutes).toEqual({ n: 1, median: 12, p90: 12, max: 12 });
  });

  it('[N4 M4] a cancelled run is billed and counted in job-minutes, but not in wall-clock', () => {
    const cancelled = { ...run(5, 'ci.yml', 'pull_request', 0, 40), conclusion: 'cancelled' };
    const s = summarize(
      [run(1, 'ci.yml', 'pull_request', 0, 12), cancelled],
      [job(1, 'fast-lane', [0, 0], [9, 30]), job(5, 'fast-lane', [0, 0], [1, 30])],
      { allowance: 2000 },
    );
    expect(s.total_minutes).toBe(12);
    expect(s.lane_a_pr_run.job_minutes.n).toBe(2);
    expect(s.lane_a_pr_run.wall_clock_minutes).toEqual({ n: 1, median: 12, p90: 12, max: 12 });
  });

  it('[RR-9] Dependabot update runs (dynamic/dependabot/**) are listed as not billed and left out of the total; ci.yml runs of Dependabot PRs stay billed', () => {
    const dependabot = { ...run(6, 'x', 'dynamic', 0, 5), name: 'npm_and_yarn in /', path: 'dynamic/dependabot/dependabot-updates' };
    expect(notBilled(dependabot)).toBe(true);
    expect(notBilled({ path: '.github/workflows/ci.yml' })).toBe(false);
    expect(notBilled({ path: '.github/workflows/dynamic/dependabot/x.yml' })).toBe(false);
    const s = summarize(
      [run(1, 'ci.yml', 'pull_request', 0, 12), dependabot],
      [job(1, 'fast-lane', [0, 0], [9, 30]), job(6, 'Dependabot', [0, 0], [3, 10]), job(6, 'Dependabot', [4, 0], [4, 30])],
      { allowance: 1000 },
    );
    expect(s.total_minutes).toBe(10);
    expect(s.percent).toBe(1);
    expect(s.workflows).toEqual([{ workflow: 'ci.yml', runs: 1, minutes: 10 }]);
    expect(s.not_billed).toEqual({ minutes: 5, runs: 1, workflows: [{ workflow: 'dependabot-updates', runs: 1, minutes: 5 }] });
    expect(s.jobs.map((j) => j.job)).toEqual(['ci.yml:fast-lane (full)']);
    const text = render(s, '2026-11', 'o/r');
    expect(text).toContain('Not billed (Dependabot on standard runners): 5 min in 1 run(s), excluded from the total');
    expect(text).toContain('  dependabot-updates     1 runs       5 min');
    expect(text).toContain('Total: 10 of 1000 min (1 %)');
  });

  it('[RR-9] ci.yml fast-lane splits into full and light by the Unit tests step (skipped = light; missing or failed = full)', () => {
    const light = { ...job(2, 'fast-lane', [20, 0], [21, 10]), unit_tests: 'skipped' };
    expect(jobLabel('ci.yml', light)).toBe('fast-lane (light)');
    expect(jobLabel('ci.yml', { ...light, unit_tests: 'success' })).toBe('fast-lane (full)');
    expect(jobLabel('ci.yml', { ...light, unit_tests: 'failure' })).toBe('fast-lane (full)');
    expect(jobLabel('ci.yml', { ...light, unit_tests: null })).toBe('fast-lane (full)');
    expect(jobLabel('ci.yml', job(2, 'fast-lane', [0, 0], [1, 0]))).toBe('fast-lane (full)');
    // A full run that failed before the unit tests also leaves them skipped: light only when Install succeeded and the
    // CODE-gated Licences step right after it was skipped.
    const failed = { ...light, conclusion: 'failure' };
    expect(jobLabel('ci.yml', failed)).toBe('fast-lane (full)');
    expect(jobLabel('ci.yml', { ...failed, install: 'success', licences: 'success' })).toBe('fast-lane (full)');
    expect(jobLabel('ci.yml', { ...failed, install: 'failure', licences: 'skipped' })).toBe('fast-lane (full)');
    expect(jobLabel('ci.yml', { ...failed, install: 'success', licences: 'skipped' })).toBe('fast-lane (light)');
    expect(jobLabel('lane-c.yml', light)).toBe('fast-lane');
    expect(jobLabel('ci.yml', { ...light, name: 'scans' })).toBe('scans');
    const s = summarize(
      [run(1, 'ci.yml', 'pull_request', 0, 12), run(2, 'ci.yml', 'pull_request', 20, 30)],
      [{ ...job(1, 'fast-lane', [0, 0], [4, 30]), unit_tests: 'success' }, light, job(2, 'scans', [20, 0], [21, 0])],
      { allowance: 2000 },
    );
    expect(s.jobs).toEqual([
      { job: 'ci.yml:fast-lane (full)', n: 1, median: 5, p90: 5, max: 5, minutes: 5 },
      { job: 'ci.yml:fast-lane (light)', n: 1, median: 2, p90: 2, max: 2, minutes: 2 },
      { job: 'ci.yml:scans', n: 1, median: 1, p90: 1, max: 1, minutes: 1 },
    ]);
    expect(s.workflows).toEqual([{ workflow: 'ci.yml', runs: 2, minutes: 8 }]);
  });

  it('ignores jobs of runs outside the month list', () => {
    expect(summarize(runs, [job(99, 'x', [0, 0], [50, 0])], { allowance: 2000 }).total_minutes).toBe(0);
  });
});

describe('ci:minutes: forecast (RR-9; ADR-0023 am. L item 4)', () => {
  const nov15 = new Date(Date.UTC(2026, 10, 15, 0, 0, 0));

  it('billed + rate x remaining UTC days + planned, rate = billed / elapsed days, with each guard date on the organic rate', () => {
    const f = forecast(700, 2000, { month: '2026-11', now: nov15, planned: 75 });
    expect(f).toEqual({
      as_of: '2026-11-15T00:00:00.000Z',
      elapsed_days: 14,
      remaining_days: 16,
      rate_per_day: 50,
      planned: 75,
      minutes: 700 + 50 * 16 + 75,
      percent: 78.8,
      guards: [
        { at: 70, basis: 'forecast', level: 'guard-70', minutes: 1400, date: '2026-11-29' },
        { at: 90, basis: 'actual', level: 'guard-90', minutes: 1800, date: 'not this month' },
        { at: 95, basis: 'actual', level: 'guard-95', minutes: 1900, date: 'not this month' },
        { at: 100, basis: 'actual', level: 'degraded', minutes: 2000, date: 'not this month' },
      ],
    });
  });

  it('a guard already crossed is "reached"; the others get their projected UTC day; elapsed counts to the run time (fractional)', () => {
    const f = forecast(1450, 2000, { month: '2026-11', now: nov15 });
    expect(f.rate_per_day).toBe(103.6);
    expect(f.guards.map((g) => g.date)).toEqual(['reached', '2026-11-18', '2026-11-19', '2026-11-20']);
    expect(f.minutes).toBe(Math.round(1450 + (1450 / 14) * 16));
    const half = forecast(100, 2000, { month: '2026-11', now: new Date(Date.UTC(2026, 10, 1, 12, 0, 0)) });
    expect(half.elapsed_days).toBe(0.5);
    expect(half.rate_per_day).toBe(200);
    expect(half.remaining_days).toBe(29.5);
    expect(half.minutes).toBe(100 + 200 * 29.5);
    expect(half.guards[0]?.date).toBe('2026-11-08');
  });

  it('a past month forecasts exactly billed + planned; a month not yet started has rate 0', () => {
    const past = forecast(900, 2000, { month: '2026-10', now: nov15, planned: 10 });
    expect(past).toMatchObject({ elapsed_days: 31, remaining_days: 0, rate_per_day: 29, minutes: 910, percent: 45.5 });
    const future = forecast(0, 2000, { month: '2026-12', now: nov15, planned: 75 });
    expect(future).toMatchObject({ elapsed_days: 0, remaining_days: 31, rate_per_day: 0, minutes: 75 });
    expect(future.guards.every((g) => g.date === 'not this month')).toBe(true);
  });

  it('the summary guard uses the forecast for the 70 % guard and the render prints the forecast block', () => {
    const runs = [run(1, 'ci.yml', 'pull_request', 0, 12)];
    const jobs = [job(1, 'fast-lane', [0, 0], [9, 30])];
    const s = summarize(runs, jobs, { allowance: 20, forecast: { month: '2026-11', now: nov15, planned: 0 } });
    expect(s.percent).toBe(50);
    expect(s.forecast?.minutes).toBe(Math.round(10 + (10 / 14) * 16));
    expect(s.guard.level).toBe('guard-70');
    const text = render(s, '2026-11', 'o/r');
    expect(text).toContain(
      'Forecast (as of 2026-11-15T00:00:00.000Z): 21 of 20 min (105 %) = billed 10 + 0.7 min/day x 16 remaining day(s) + planned 0',
    );
    expect(text).toContain('rate = billed to date / 14 elapsed UTC day(s)');
    expect(text).toContain(' 70 % (   14 min, acts on the forecast): 2026-11-20');
    expect(text).toContain('100 % (   20 min, acts on actual usage): 2026-11-29');
  });
});

describe('ci:minutes: CLI with an injected gh reader and clock (no network)', () => {
  const nov15 = new Date(Date.UTC(2026, 10, 15, 0, 0, 0));
  const fakeGh =
    (total: number) =>
    (endpoint: string): unknown[] => {
      if (endpoint.includes('/jobs?')) {
        const id = Number(/runs\/(\d+)\/jobs/u.exec(endpoint)?.[1]);
        return id === 6 ? [job(6, 'Dependabot', [0, 0], [3, 10])] : [{ ...job(id, 'fast-lane', [0, 0], [6, 30]), unit_tests: 'skipped' }];
      }
      return [
        { ...run(1, 'ci.yml', 'pull_request', 0, 12), total_count: total },
        { ...run(6, 'x', 'dynamic', 0, 5), path: 'dynamic/dependabot/dependabot-updates', total_count: total },
      ];
    };

  it('--forecast --planned prints the forecast; Dependabot is excluded; the light fast-lane is labelled', () => {
    let out = '';
    const status = main(['--repo', 'o/r', '--month', '2026-11', '--forecast', '--planned', '75'], {
      gh: fakeGh(2),
      now: () => nov15,
      write: (text) => {
        out += text;
      },
    });
    expect(status).toBe(0);
    expect(out).toContain('Total: 7 of 2000 min (0.4 %), guard: ok');
    expect(out).toContain('Not billed (Dependabot on standard runners): 4 min in 1 run(s)');
    expect(out).toContain('ci.yml:fast-lane (light)');
    expect(out).toContain('Forecast (as of 2026-11-15T00:00:00.000Z): 90 of 2000 min (4.5 %)');
  });

  it('[N4] refuses (exit 1) a month whose runs list reports more than 1,000 runs', () => {
    expect(runCapProblem([])).toBeNull();
    expect(runCapProblem([{ ...run(1, 'ci.yml', 'pull_request', 0, 1), total_count: 1000 }])).toBeNull();
    expect(runCapProblem([{ ...run(1, 'ci.yml', 'pull_request', 0, 1), total_count: 1001 }])).toContain('more than the 1000');
    let out = '';
    const status = main(['--repo', 'o/r', '--month', '2026-11'], {
      gh: fakeGh(1001),
      now: () => nov15,
      write: (text) => {
        out += text;
      },
    });
    expect(status).toBe(1);
    expect(out).toBe('');
  });

  it('--planned needs --forecast and a non-negative integer (exit 2)', () => {
    const quiet = { gh: fakeGh(2), now: () => nov15, write: () => undefined };
    expect(main(['--repo', 'o/r', '--planned', '75'], quiet)).toBe(2);
    expect(main(['--repo', 'o/r', '--forecast', '--planned', '-5'], quiet)).toBe(2);
    expect(main(['--repo', 'o/r', '--forecast', '--planned', '7.5'], quiet)).toBe(2);
    expect(main(['--repo', 'o/r', '--forecast', '--planned'], quiet)).toBe(2);
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
