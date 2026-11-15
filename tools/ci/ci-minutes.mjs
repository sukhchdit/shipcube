// @ts-check
/**
 * `npm run ci:minutes` (ADR-0023 amendment C "Guards" as replaced by amendment L item 4, D-ARCH-010 item 6,
 * D-ARCH-129; SPK-07; TASK-015 part 015-B): hosted Actions minutes of one calendar month (UTC) for this repository, the
 * share of the free-tier allowance, the guard level, the month forecast and the per-run figures SPK-07 measures (lane A
 * job-minutes and wall-clock per PR run, `fast-lane` split into full and light mode, security-integration job-minutes).
 *
 * How minutes are counted: GitHub bills a private repository per JOB, each rounded UP to a whole minute, times the
 * runner multiplier (Linux 1, Windows 2, macOS 10; self-hosted 0). The script reads every run created in the month and
 * every job attempt of each run through `gh api` (the GitHub CLI's own authentication; this script never reads, prints
 * or stores a token) and applies that rule, so the total is an ESTIMATE of the billed figure. The authoritative number
 * is the account's billing report (`--billing` asks the billing usage endpoint, which needs a token with the `user`
 * scope; without it the script says so and keeps the estimate). Skipped jobs (no duration) count 0.
 *
 * Not billed: runs whose workflow `path` starts with `dynamic/dependabot/` (Dependabot version/security updates run on
 * standard GitHub-hosted runners, which GitHub does not bill). They are listed under "Not billed" and left out of the
 * total, the share and the forecast. Workflows that Dependabot PRs trigger (ci.yml) ARE billed and stay in the total.
 *
 * Mode split (ADR-0023 am. L item 1): a ci.yml `fast-lane` job ran in light mode when its `Unit tests` step concluded
 * `skipped` AND either the job succeeded or (a failed job) its `Install` step succeeded while the CODE-gated `Licences`
 * step right after it was skipped. A full run that fails before the unit tests also leaves `Unit tests` skipped; any
 * other combination, or a missing step, counts as full (fail safe: a full run is never reported as light).
 *
 * Forecast (`--forecast [--planned <min>]`, am. L item 4): billed-to-date + rate x remaining + planned, where
 *   rate      = billed-to-date / elapsed days, elapsed = (run time - first instant of the month UTC) in days (fractional);
 *   remaining = (first instant of the next month UTC - run time) in days (fractional, 0 for a past month);
 *   planned   = minutes already decided for the rest of the month (lane C wave-end, nightly), counted in the month total.
 * Each guard line's projected date is the UTC day on which billed-to-date + rate x days reaches its share (organic rate
 * only; planned minutes have no date and are counted in the total only). The 70 % guard acts on the FORECAST share, the
 * 90 %, 95 % and 100 % guards on the ACTUAL share (D-ARCH-129).
 *
 * Limits: runs are attributed to the month in which they were CREATED (a run started just before midnight UTC on the
 * last day is billed partly in the next month); deleted runs are billed but no longer listed, so the estimate is low by
 * their minutes; the runs list endpoint returns at most 1,000 runs for a filtered query, so a month with more runs is
 * refused (exit 1) rather than silently under-counted.
 *
 * CLI: node tools/ci/ci-minutes.mjs [--month YYYY-MM] [--repo owner/name] [--allowance <minutes>] [--forecast
 *        [--planned <minutes>]] [--json] [--billing]
 * Defaults: the current UTC month, the `origin` remote's GitHub repository, allowance 2000 (GitHub Free, private).
 * Exit 0 printed, 1 the GitHub API could not be read (or the 1,000-run cap was hit), 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ALLOWANCE = 2000;
/** The runs list endpoint's cap for filtered queries (`created=`): more runs than this are not listed. */
export const RUN_LIST_CAP = 1000;
/** Workflow paths GitHub does not bill (Dependabot updates on standard GitHub-hosted runners). */
export const NOT_BILLED_PATH = /^dynamic\/dependabot\//u;
const DAY_MS = 86_400_000;

/**
 * ADR-0023 amendment L item 4 / D-ARCH-129 guards, highest first: share of the allowance -> action. `basis` says which
 * share the guard acts on (the 70 % guard acts on the month forecast, the others on actual usage).
 */
export const GUARDS = Object.freeze([
  {
    at: 100,
    basis: 'actual',
    level: 'degraded',
    action:
      'degraded mode (amendment C): lane A runs locally (npm run quality:fastlane), lane C waits for the reset; never for security-critical paths',
  },
  {
    at: 95,
    basis: 'actual',
    level: 'guard-95',
    action: 'hard stop: lane C for gates only, the planned tier-1 wave-end is no longer dispatched',
  },
  {
    at: 90,
    basis: 'actual',
    level: 'guard-90',
    action: 'lane C for gates only, except a tier-1 wave-end already planned for the month (dispatched up to the 95 % hard stop)',
  },
  {
    at: 70,
    basis: 'forecast',
    level: 'guard-70',
    action: 'tier-1 lane C only (<= 1 wave-end a month), process levers P1/P2 mandatory, CI_MAIN_FAST_LANE stays false',
  },
]);

/**
 * @typedef {{ id: number, name: string, path: string, event: string, created_at: string, run_started_at?: string | null,
 *   updated_at: string, status: string, conclusion: string | null, total_count?: number }} Run
 * @typedef {{ run_id: number, name: string, started_at: string | null, completed_at: string | null, labels: string[],
 *   conclusion: string | null, run_attempt?: number, unit_tests?: string | null,
 *   install?: string | null, licences?: string | null }} Job
 * @typedef {{ month: string, now: Date, planned?: number }} ForecastOptions
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
 * True for a run GitHub does not bill (Dependabot updates).
 * @param {Pick<Run, 'path'>} run
 */
export const notBilled = (run) => NOT_BILLED_PATH.test(run.path);

/**
 * `fast-lane (full)` / `fast-lane (light)` for ci.yml's fast-lane job (light = its `Unit tests` step was skipped);
 * every other job keeps its name.
 * @param {string} workflow the workflow file name
 * @param {Job} job
 */
export function jobLabel(workflow, job) {
  if (workflow !== 'ci.yml' || job.name !== 'fast-lane') return job.name;
  if (job.unit_tests !== 'skipped') return 'fast-lane (full)';
  if (job.conclusion === 'success') return 'fast-lane (light)';
  return job.install === 'success' && job.licences === 'skipped' ? 'fast-lane (light)' : 'fast-lane (full)';
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
 * The guard in force: the 100/95/90 % guards on the actual share, the 70 % guard on the forecast share (the actual
 * share when no forecast was computed; actual usage above 70 % always counts).
 * @param {number} percent actual share of the allowance used
 * @param {number} [forecastPercent] forecast share of the allowance at month end
 * @returns {{ level: string, action: string }}
 */
export function guardFor(percent, forecastPercent = percent) {
  for (const guard of GUARDS) {
    const share = guard.basis === 'forecast' ? Math.max(percent, forecastPercent) : percent;
    if (share >= guard.at) return { level: guard.level, action: guard.action };
  }
  return { level: 'ok', action: 'no guard reached' };
}

/** @param {number} n */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * First instant of the month and of the next month (UTC), in epoch milliseconds.
 * @param {string} month YYYY-MM
 */
export function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = Date.UTC(/** @type {number} */ (year), /** @type {number} */ (mon) - 1, 1);
  const end = Date.UTC(/** @type {number} */ (year), /** @type {number} */ (mon), 1);
  return { start, end };
}

/**
 * Month forecast (see the header: rate = billed / elapsed days, remaining days to the next month, plus planned).
 * @param {number} billed billed minutes to date (Dependabot excluded)
 * @param {number} allowance
 * @param {ForecastOptions} options
 */
export function forecast(billed, allowance, { month, now, planned = 0 }) {
  const { start, end } = monthBounds(month);
  const t = Math.min(Math.max(now.getTime(), start), end);
  const elapsedDays = (t - start) / DAY_MS;
  const remainingDays = (end - t) / DAY_MS;
  const rate = elapsedDays > 0 ? billed / elapsedDays : 0;
  const minutes = Math.round(billed + rate * remainingDays + planned);
  const percent = allowance > 0 ? round1((minutes / allowance) * 100) : 0;
  const guards = [...GUARDS]
    .sort((a, b) => a.at - b.at)
    .map((guard) => {
      const target = (guard.at / 100) * allowance;
      /** @type {string} */
      let date;
      if (billed >= target) date = 'reached';
      else if (rate <= 0) date = 'not this month';
      else {
        const when = t + ((target - billed) / rate) * DAY_MS;
        date = when < end ? new Date(when).toISOString().slice(0, 10) : 'not this month';
      }
      return { at: guard.at, basis: guard.basis, level: guard.level, minutes: Math.round(target), date };
    });
  return {
    as_of: new Date(t).toISOString(),
    elapsed_days: round1(elapsedDays),
    remaining_days: round1(remainingDays),
    rate_per_day: round1(rate),
    planned,
    minutes,
    percent,
    guards,
  };
}

/**
 * Month usage and per-run figures.
 * @param {readonly Run[]} runs
 * @param {readonly Job[]} jobs every job attempt of those runs
 * @param {{ allowance: number, forecast?: ForecastOptions }} options
 */
export function summarize(runs, jobs, { allowance, forecast: forecastOptions }) {
  const byRun = new Map(runs.map((run) => [run.id, run]));
  /** @type {Map<string, { runs: Set<number>, minutes: number }>} */
  const byWorkflow = new Map();
  /** @type {Map<string, { runs: Set<number>, minutes: number }>} */
  const unbilled = new Map();
  /** @type {Map<string, number[]>} */
  const perJobName = new Map();
  /** @type {Map<number, number>} */
  const perRun = new Map();
  let total = 0;
  for (const job of jobs) {
    const run = byRun.get(job.run_id);
    if (run === undefined) continue;
    const minutes = billedMinutes(job);
    const key = run.path.split('/').pop() ?? run.name;
    const skip = notBilled(run);
    const bucket = skip ? unbilled : byWorkflow;
    const entry = bucket.get(key) ?? { runs: new Set(), minutes: 0 };
    entry.runs.add(run.id);
    entry.minutes += minutes;
    bucket.set(key, entry);
    if (skip) continue;
    total += minutes;
    perRun.set(run.id, (perRun.get(run.id) ?? 0) + minutes);
    if (minutes > 0) {
      const name = `${key}:${jobLabel(key, job)}`;
      perJobName.set(name, [...(perJobName.get(name) ?? []), minutes]);
    }
  }
  const prRuns = runs.filter((run) => run.path.endsWith('/ci.yml') && run.event === 'pull_request' && run.conclusion !== 'skipped');
  const prJobMinutes = prRuns.map((run) => perRun.get(run.id) ?? 0).filter((m) => m > 0);
  const prWall = prRuns
    .filter((run) => run.status === 'completed' && run.conclusion !== 'cancelled')
    .map((run) => (Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? run.created_at)) / 60_000)
    .filter((m) => Number.isFinite(m) && m > 0);
  const percent = allowance > 0 ? round1((total / allowance) * 100) : 0;
  const projection = forecastOptions === undefined ? null : forecast(total, allowance, forecastOptions);
  const stat = (/** @type {number[]} */ xs) => ({
    n: xs.length,
    median: round1(percentile(xs, 50)),
    p90: round1(percentile(xs, 90)),
    max: round1(Math.max(0, ...xs)),
  });
  const list = (/** @type {Map<string, { runs: Set<number>, minutes: number }>} */ m) =>
    [...m.entries()]
      .map(([workflow, entry]) => ({ workflow, runs: entry.runs.size, minutes: entry.minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  const notBilledList = list(unbilled);
  return {
    total_minutes: total,
    allowance,
    percent,
    guard: guardFor(percent, projection?.percent ?? percent),
    forecast: projection,
    workflows: list(byWorkflow),
    not_billed: {
      minutes: notBilledList.reduce((a, w) => a + w.minutes, 0),
      runs: notBilledList.reduce((a, w) => a + w.runs, 0),
      workflows: notBilledList,
    },
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
  const row = (/** @type {{ workflow: string, runs: number, minutes: number }} */ w) =>
    `  ${w.workflow.padEnd(16)} ${String(w.runs).padStart(5)} runs ${String(w.minutes).padStart(7)} min`;
  const lines = [
    `Hosted Actions minutes, ${repo}, ${month} (UTC); estimate = per-job duration rounded up x runner multiplier`,
    `Total: ${String(s.total_minutes)} of ${String(s.allowance)} min (${String(s.percent)} %), guard: ${s.guard.level} (${s.guard.action})`,
    '',
    'By workflow:',
    ...s.workflows.map(row),
    '',
    `Not billed (Dependabot on standard runners): ${String(s.not_billed.minutes)} min in ${String(s.not_billed.runs)} run(s), excluded from the total`,
    ...s.not_billed.workflows.map(row),
    '',
    'By job (billed minutes per run: median / p90 / max, n):',
    ...s.jobs.map(
      (j) =>
        `  ${j.job.padEnd(40)} ${String(j.median).padStart(5)} / ${String(j.p90).padStart(5)} / ${String(j.max).padStart(5)}  n=${String(j.n).padStart(4)}  total ${String(j.minutes)} min`,
    ),
    '',
    `Lane A per pull-request run (ci.yml): job-min median ${String(s.lane_a_pr_run.job_minutes.median)}, p90 ${String(s.lane_a_pr_run.job_minutes.p90)} (n=${String(s.lane_a_pr_run.job_minutes.n)}); wall-clock min median ${String(s.lane_a_pr_run.wall_clock_minutes.median)}, p90 ${String(s.lane_a_pr_run.wall_clock_minutes.p90)}`,
  ];
  const f = s.forecast;
  if (f !== null) {
    lines.push(
      '',
      `Forecast (as of ${f.as_of}): ${String(f.minutes)} of ${String(s.allowance)} min (${String(f.percent)} %) = billed ${String(s.total_minutes)} + ${String(f.rate_per_day)} min/day x ${String(f.remaining_days)} remaining day(s) + planned ${String(f.planned)}`,
      `  rate = billed to date / ${String(f.elapsed_days)} elapsed UTC day(s); guard dates use the rate only (planned minutes have no date)`,
      ...f.guards.map(
        (g) =>
          `  ${String(g.at).padStart(3)} % (${String(g.minutes).padStart(5)} min, ${g.basis === 'forecast' ? 'acts on the forecast' : 'acts on actual usage'}): ${g.date}`,
      ),
    );
  }
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
  const { start, end } = monthBounds(month);
  const day = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
  return `${day(start)}..${day(end - DAY_MS)}`;
}

/**
 * The problem when the runs list hit the endpoint's cap (N4), or null.
 * @param {readonly Run[]} runs each carries the list's `total_count`
 */
export function runCapProblem(runs) {
  const count = Math.max(0, runs.length, ...runs.map((run) => run.total_count ?? 0));
  return count > RUN_LIST_CAP
    ? `the month has ${String(count)} runs, more than the ${String(RUN_LIST_CAP)} the runs list returns for a filtered query; the total would be under-counted (split the query, e.g. by half month, before using this figure)`
    : null;
}

/** The GitHub `owner/name` of the origin remote, or null. */
function originRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/u.exec(r.stdout ?? '');
  return match?.[1] ?? null;
}

/**
 * @param {readonly string[]} argv
 * @param {{ gh?: (endpoint: string, jq: string) => unknown[], now?: () => Date, write?: (text: string) => void }} [deps]
 *   injectable for tests: the `gh api` reader, the clock and stdout
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const gh = deps.gh ?? ghLines;
  const now = deps.now ?? (() => new Date());
  const write =
    deps.write ??
    ((/** @type {string} */ text) => {
      process.stdout.write(text);
    });
  /** @type {Record<string, string>} */
  const values = {};
  let json = false;
  let billing = false;
  let withForecast = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (arg === '--json') json = true;
    else if (arg === '--billing') billing = true;
    else if (arg === '--forecast') withForecast = true;
    else if (['--month', '--repo', '--allowance', '--planned'].includes(arg) && i + 1 < argv.length) {
      values[arg] = /** @type {string} */ (argv[i + 1]);
      i += 1;
    } else {
      console.error(`ci:minutes: unknown or incomplete argument ${arg}`);
      return 2;
    }
  }
  const month = values['--month'] ?? now().toISOString().slice(0, 7);
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
  const plannedText = values['--planned'];
  if (plannedText !== undefined && !withForecast) {
    console.error('ci:minutes: --planned needs --forecast');
    return 2;
  }
  if (plannedText !== undefined && !/^\d{1,6}$/u.test(plannedText)) {
    console.error('ci:minutes: --planned must be a non-negative integer number of minutes');
    return 2;
  }
  const planned = Number(plannedText ?? '0');
  try {
    const runs = /** @type {Run[]} */ (
      gh(
        `repos/${repo}/actions/runs?per_page=100&created=${monthRange(month)}`,
        '.total_count as $total | .workflow_runs[] | {id, name, path, event, created_at, run_started_at, updated_at, status, conclusion, total_count: $total}',
      )
    );
    const cap = runCapProblem(runs);
    if (cap !== null) throw new Error(cap);
    /** @type {Job[]} */
    const jobs = [];
    for (const run of runs) {
      for (const job of gh(
        `repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100&filter=all`,
        '.jobs[] | {run_id, name, started_at, completed_at, labels, conclusion, run_attempt, unit_tests: ([.steps[]? | select(.name == "Unit tests") | .conclusion][0]), install: ([.steps[]? | select(.name | startswith("Install (npm ci")) | .conclusion][0]), licences: ([.steps[]? | select(.name == "Licences") | .conclusion][0])}',
      ))
        jobs.push(/** @type {Job} */ (job));
    }
    const summary = summarize(runs, jobs, { allowance, ...(withForecast ? { forecast: { month, now: now(), planned } } : {}) });
    if (json) write(`${JSON.stringify({ repo, month, ...summary }, null, 2)}\n`);
    else write(render(summary, month, repo));
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
    if (r.status === 0) write(`\nBilling report (authoritative):\n${r.stdout}`);
    else
      write(
        '\nBilling report: not readable with this token (needs the `user` scope: gh auth refresh -s user); the estimate above stands.\n',
      );
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
