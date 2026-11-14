// @ts-check
/**
 * `npm run ci:minutes` (ADR-0023 amendment C "Guards", D-ARCH-010 item 6; SPK-07; TASK-015 part 015-B): hosted Actions
 * minutes of one calendar month (UTC) for this repository, the share of the free-tier allowance, the guard level and the
 * per-run figures SPK-07 measures (lane A job-minutes and wall-clock per PR run, security-integration job-minutes).
 *
 * How minutes are counted: GitHub bills a private repository per JOB, each rounded UP to a whole minute, times the
 * runner multiplier (Linux 1, Windows 2, macOS 10; self-hosted 0). The script reads every run created in the month and
 * every job attempt of each run through `gh api` (the GitHub CLI's own authentication; this script never reads, prints
 * or stores a token) and applies that rule, so the total is an ESTIMATE of the billed figure. The authoritative number
 * is the account's billing report (`--billing` asks the billing usage endpoint, which needs a token with the `user`
 * scope; without it the script says so and keeps the estimate). Skipped jobs (no duration) count 0.
 *
 * CLI: node tools/ci/ci-minutes.mjs [--month YYYY-MM] [--repo owner/name] [--allowance <minutes>] [--json] [--billing]
 * Defaults: the current UTC month, the `origin` remote's GitHub repository, allowance 2000 (GitHub Free, private).
 * Exit 0 printed, 1 the GitHub API could not be read, 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ALLOWANCE = 2000;
/** ADR-0023 am. C guards: share of the allowance -> action. */
export const GUARDS = Object.freeze([
  { at: 100, level: 'degraded', action: 'degraded mode: lane A runs locally (npm run quality:fastlane), lane C waits for the reset' },
  { at: 90, level: 'guard-90', action: 'lane C for gates only (no wave-end dispatch)' },
  { at: 70, level: 'guard-70', action: 'CI_MAIN_FAST_LANE=false and no further wave-end dispatches this month (lane B wave profile only)' },
]);

/**
 * @typedef {{ id: number, name: string, path: string, event: string, created_at: string, run_started_at?: string | null,
 *   updated_at: string, status: string, conclusion: string | null }} Run
 * @typedef {{ run_id: number, name: string, started_at: string | null, completed_at: string | null, labels: string[],
 *   conclusion: string | null, run_attempt?: number }} Job
 */

/**
 * Runner multiplier from the job's labels (private-repository billing).
 * @param {readonly string[]} labels
 */
export function multiplier(labels) {
  const text = labels.join(' ').toLowerCase();
  if (text.includes('self-hosted')) return 0;
  if (text.includes('macos')) return 10;
  if (text.includes('windows')) return 2;
  return 1;
}

/**
 * Billed minutes of one job: duration rounded up to whole minutes, times the multiplier; 0 when it never ran.
 * @param {Job} job
 */
export function billedMinutes(job) {
  if (job.started_at === null || job.completed_at === null) return 0;
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60_000) * multiplier(job.labels);
}

/**
 * @param {readonly number[]} values
 * @param {number} p percentile 0-100 (nearest rank)
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return /** @type {number} */ (sorted[rank - 1]);
}

/**
 * @param {number} percent share of the allowance used
 * @returns {{ level: string, action: string }}
 */
export function guardFor(percent) {
  for (const guard of GUARDS) if (percent >= guard.at) return { level: guard.level, action: guard.action };
  return { level: 'ok', action: 'no guard reached' };
}

/**
 * Month usage and per-run figures.
 * @param {readonly Run[]} runs
 * @param {readonly Job[]} jobs every job attempt of those runs
 * @param {{ allowance: number }} options
 */
export function summarize(runs, jobs, { allowance }) {
  const byRun = new Map(runs.map((run) => [run.id, run]));
  /** @type {Map<string, { runs: Set<number>, minutes: number }>} */
  const byWorkflow = new Map();
  /** @type {Map<string, number[]>} */
  const perJobName = new Map();
  /** @type {Map<number, number>} */
  const perRun = new Map();
  let total = 0;
  for (const job of jobs) {
    const run = byRun.get(job.run_id);
    if (run === undefined) continue;
    const minutes = billedMinutes(job);
    total += minutes;
    const key = run.path.split('/').pop() ?? run.name;
    const entry = byWorkflow.get(key) ?? { runs: new Set(), minutes: 0 };
    entry.runs.add(run.id);
    entry.minutes += minutes;
    byWorkflow.set(key, entry);
    perRun.set(run.id, (perRun.get(run.id) ?? 0) + minutes);
    if (minutes > 0) {
      const name = `${key}:${job.name}`;
      perJobName.set(name, [...(perJobName.get(name) ?? []), minutes]);
    }
  }
  const prRuns = runs.filter((run) => run.path.endsWith('/ci.yml') && run.event === 'pull_request' && run.conclusion !== 'skipped');
  const prJobMinutes = prRuns.map((run) => perRun.get(run.id) ?? 0).filter((m) => m > 0);
  const prWall = prRuns
    .filter((run) => run.status === 'completed' && run.conclusion !== 'cancelled')
    .map((run) => (Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? run.created_at)) / 60_000)
    .filter((m) => Number.isFinite(m) && m > 0);
  const percent = allowance > 0 ? Math.round((total / allowance) * 1000) / 10 : 0;
  const stat = (/** @type {number[]} */ xs) => ({
    n: xs.length,
    median: Math.round(percentile(xs, 50) * 10) / 10,
    p90: Math.round(percentile(xs, 90) * 10) / 10,
    max: Math.round(Math.max(0, ...xs) * 10) / 10,
  });
  return {
    total_minutes: total,
    allowance,
    percent,
    guard: guardFor(percent),
    workflows: [...byWorkflow.entries()]
      .map(([workflow, entry]) => ({ workflow, runs: entry.runs.size, minutes: entry.minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    jobs: [...perJobName.entries()]
      .map(([job, xs]) => ({ job, ...stat(xs), minutes: xs.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.minutes - a.minutes),
    lane_a_pr_run: { job_minutes: stat(prJobMinutes), wall_clock_minutes: stat(prWall) },
  };
}

/**
 * @param {ReturnType<typeof summarize>} s
 * @param {string} month
 * @param {string} repo
 */
export function render(s, month, repo) {
  const lines = [
    `Hosted Actions minutes, ${repo}, ${month} (UTC); estimate = per-job duration rounded up x runner multiplier`,
    `Total: ${String(s.total_minutes)} of ${String(s.allowance)} min (${String(s.percent)} %), guard: ${s.guard.level} (${s.guard.action})`,
    '',
    'By workflow:',
    ...s.workflows.map((w) => `  ${w.workflow.padEnd(16)} ${String(w.runs).padStart(5)} runs ${String(w.minutes).padStart(7)} min`),
    '',
    'By job (billed minutes per run: median / p90 / max, n):',
    ...s.jobs.map(
      (j) =>
        `  ${j.job.padEnd(40)} ${String(j.median).padStart(5)} / ${String(j.p90).padStart(5)} / ${String(j.max).padStart(5)}  n=${String(j.n).padStart(4)}  total ${String(j.minutes)} min`,
    ),
    '',
    `Lane A per pull-request run (ci.yml): job-min median ${String(s.lane_a_pr_run.job_minutes.median)}, p90 ${String(s.lane_a_pr_run.job_minutes.p90)} (n=${String(s.lane_a_pr_run.job_minutes.n)}); wall-clock min median ${String(s.lane_a_pr_run.wall_clock_minutes.median)}, p90 ${String(s.lane_a_pr_run.wall_clock_minutes.p90)}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * `gh api` with --paginate and a jq filter that emits one compact JSON value per line.
 * @param {string} endpoint path without a leading slash (Git Bash rewrites a leading slash)
 * @param {string} jq
 * @returns {unknown[]}
 */
function ghLines(endpoint, jq) {
  const r = spawnSync('gh', ['api', '--paginate', endpoint, '--jq', jq], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`gh api ${endpoint.split('?')[0] ?? ''} failed: ${(r.stderr || '').trim().split('\n')[0] ?? ''}`);
  return r.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => /** @type {unknown} */ (JSON.parse(line)));
}

/** @param {string} month YYYY-MM */
export function monthRange(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(/** @type {number} */ (year), /** @type {number} */ (mon) - 1, 1));
  const end = new Date(Date.UTC(/** @type {number} */ (year), /** @type {number} */ (mon), 0));
  const day = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);
  return `${day(start)}..${day(end)}`;
}

/** The GitHub `owner/name` of the origin remote, or null. */
function originRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/u.exec(r.stdout ?? '');
  return match?.[1] ?? null;
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function main(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let json = false;
  let billing = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (arg === '--json') json = true;
    else if (arg === '--billing') billing = true;
    else if (['--month', '--repo', '--allowance'].includes(arg) && i + 1 < argv.length) {
      values[arg] = /** @type {string} */ (argv[i + 1]);
      i += 1;
    } else {
      console.error(`ci:minutes: unknown or incomplete argument ${arg}`);
      return 2;
    }
  }
  const month = values['--month'] ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) {
    console.error('ci:minutes: --month must be YYYY-MM');
    return 2;
  }
  const repo = values['--repo'] ?? originRepo();
  if (repo === null || !/^[\w.-]+\/[\w.-]+$/u.test(repo)) {
    console.error('ci:minutes: --repo owner/name is required (no GitHub origin remote)');
    return 2;
  }
  const allowance = Number(values['--allowance'] ?? DEFAULT_ALLOWANCE);
  if (!Number.isInteger(allowance) || allowance < 0) {
    console.error('ci:minutes: --allowance must be a non-negative integer');
    return 2;
  }
  try {
    const runs = /** @type {Run[]} */ (
      ghLines(
        `repos/${repo}/actions/runs?per_page=100&created=${monthRange(month)}`,
        '.workflow_runs[] | {id, name, path, event, created_at, run_started_at, updated_at, status, conclusion}',
      )
    );
    /** @type {Job[]} */
    const jobs = [];
    for (const run of runs) {
      for (const job of ghLines(
        `repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100&filter=all`,
        '.jobs[] | {run_id, name, started_at, completed_at, labels, conclusion, run_attempt}',
      ))
        jobs.push(/** @type {Job} */ (job));
    }
    const summary = summarize(runs, jobs, { allowance });
    if (json) process.stdout.write(`${JSON.stringify({ repo, month, ...summary }, null, 2)}\n`);
    else process.stdout.write(render(summary, month, repo));
  } catch (error) {
    console.error(`ci:minutes: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (billing) {
    const owner = repo.split('/')[0] ?? '';
    const [year, mon] = month.split('-');
    const r = spawnSync(
      'gh',
      [
        'api',
        `users/${owner}/settings/billing/usage?year=${String(year)}&month=${String(Number(mon))}`,
        '--jq',
        '.usageItems[] | select(.product == "actions") | {sku, quantity, unitType, netAmount}',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      },
    );
    if (r.status === 0) process.stdout.write(`\nBilling report (authoritative):\n${r.stdout}`);
    else
      process.stdout.write(
        '\nBilling report: not readable with this token (needs the `user` scope: gh auth refresh -s user); the estimate above stands.\n',
      );
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
