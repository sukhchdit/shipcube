// @ts-check
/**
 * Hosted `security-integration` job (lane A, pull requests that change a security-critical path; ADR-0023 amendment G
 * item 5; TEST-STRATEGY section 4.1; TASK-015 part 015-B).
 *
 * Runs, on ubuntu with the runner's Docker (Testcontainers PostgreSQL 18 + Valkey), every suite of the manifest's
 * `security_integration_suites` whose status is `active`, through its tools/quality/suite-runners.json Jest entry
 * (the lane B definition: same paths, projects, in-band and timeout rules). The job passes the BASE ref's manifest and
 * runners (a PR neither drops a suite from its own run nor activates one early, like quality:check-evidence); a suite
 * that is `planned` there is listed as not run. Per suite: Jest exit 0, tests >= max(min_tests, 1), no failure, no skip
 * when the suite is `security` or `zero_skip`, and every `required_cases` ID in a passing test name. No active suite
 * at all fails closed (a security job that tests nothing is not green).
 *
 * This is a Linux re-run of head code, not a tamper-proof control: the lane B evidence check (base ref) and the
 * security record are the controls; this job catches Windows/Linux drift on the paths that matter most (R-ARCH-17).
 *
 * CLI: node tools/ci/security-integration.mjs --root <dir> --manifest <file> --runners <file> [--out <dir>]
 *        [--summary <$GITHUB_STEP_SUMMARY>] [--test-timeout <ms>] [--dry-run]
 * Exit 0 pass, 1 a suite failed or nothing ran, 2 usage or configuration error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { jestArgs, parseRunners } from '../quality/heavy.mjs';
import { parseManifest } from '../quality/lib/manifest.mjs';

/** @typedef {import('../quality/lib/manifest.mjs').Suite} Suite */
/** @typedef {import('../quality/heavy.mjs').JestRunner} JestRunner */
/** @typedef {{ id: string, suite: Suite, runner: JestRunner }} PlannedSuite */
/**
 * @typedef {{ numTotalTests: number, numFailedTests: number, numPendingTests: number, numTodoTests?: number,
 *   testResults: { assertionResults: { fullName: string, status: string }[] }[] }} JestReport
 */

export const DEFAULT_TEST_TIMEOUT_MS = 60_000;
const SUITE_TIMEOUT_MS = 20 * 60_000;

/**
 * The suites to run, the ones not active yet, and configuration errors (each fails the job).
 * @param {unknown} rawManifest
 * @param {unknown} rawRunners
 * @returns {{ run: PlannedSuite[], notActive: { id: string, status: string }[], errors: string[] }}
 */
export function planSecuritySuites(rawManifest, rawRunners) {
  const manifest = parseManifest(rawManifest);
  const runners = parseRunners(rawRunners);
  const list = /** @type {Record<string, unknown>} */ (rawManifest)['security_integration_suites'];
  /** @type {string[]} */
  const errors = [];
  if (!Array.isArray(list) || list.length === 0 || !list.every((id) => typeof id === 'string'))
    return { run: [], notActive: [], errors: ['security_integration_suites must be a non-empty list of suite ids'] };
  /** @type {PlannedSuite[]} */
  const run = [];
  /** @type {{ id: string, status: string }[]} */
  const notActive = [];
  for (const id of /** @type {string[]} */ (list)) {
    const suite = manifest.suites[id];
    if (suite === undefined) {
      errors.push(`${id}: not a suite of the manifest`);
      continue;
    }
    if (suite.status !== 'active') {
      notActive.push({ id, status: suite.status });
      continue;
    }
    const runner = runners.suites[id];
    if (runner === undefined) errors.push(`${id}: active without a suite-runners.json entry`);
    else if (runner.kind !== 'jest') errors.push(`${id}: security-integration runs Jest suites only (kind ${runner.kind})`);
    else run.push({ id, suite, runner: { ...runner, coverage: false } });
  }
  if (run.length === 0 && errors.length === 0) errors.push('no security_integration_suites suite is active (fail closed)');
  return { run, notActive, errors };
}

/**
 * Problems of one suite's Jest run (empty = pass).
 * @param {PlannedSuite} planned
 * @param {{ status: number | null, report: JestReport | null }} result
 * @returns {string[]}
 */
export function suiteProblems(planned, { status, report }) {
  if (report === null) return [`jest wrote no JSON report (exit ${String(status)})`];
  /** @type {string[]} */
  const out = [];
  const skipped = report.numPendingTests + (report.numTodoTests ?? 0);
  const min = Math.max(planned.suite.min_tests, 1);
  if (report.numTotalTests < min) out.push(`${String(report.numTotalTests)} tests, at least ${String(min)} required`);
  if (report.numFailedTests > 0) out.push(`${String(report.numFailedTests)} failed`);
  if ((planned.suite.security || planned.suite.zero_skip) && skipped > 0) out.push(`${String(skipped)} skipped in a zero-skip suite`);
  const passing = report.testResults.flatMap((file) => file.assertionResults.filter((a) => a.status === 'passed').map((a) => a.fullName));
  for (const id of planned.suite.required_cases) {
    if (!passing.some((name) => name.includes(id))) out.push(`required case ${id} is not in a passing test name`);
  }
  if (status !== 0 && out.length === 0) out.push(`jest exited ${String(status)} without a failing test (open handle or runtime error)`);
  return out;
}

/**
 * @param {string} file
 * @returns {JestReport | null}
 */
function readReport(file) {
  if (!existsSync(file)) return null;
  try {
    const raw = /** @type {JestReport} */ (JSON.parse(readFileSync(file, 'utf8')));
    return typeof raw.numTotalTests === 'number' && Array.isArray(raw.testResults) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @param {string} label
 */
function readJson(file, label) {
  try {
    return /** @type {unknown} */ (JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    throw new Error(`${label} ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function main(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let dryRun = false;
  const valued = new Set(['--root', '--manifest', '--runners', '--out', '--summary', '--test-timeout']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!valued.has(arg) || i + 1 >= argv.length) {
      console.error(`security-integration: unknown or incomplete argument ${arg}`);
      return 2;
    }
    values[arg] = /** @type {string} */ (argv[i + 1]);
    i += 1;
  }
  const root = values['--root'];
  if (root === undefined || values['--manifest'] === undefined || values['--runners'] === undefined) {
    console.error('security-integration: --root, --manifest and --runners are required');
    return 2;
  }
  const timeout = values['--test-timeout'] ?? String(DEFAULT_TEST_TIMEOUT_MS);
  if (!/^[1-9][0-9]{2,6}$/u.test(timeout)) {
    console.error('security-integration: --test-timeout must be an integer of milliseconds (>= 100)');
    return 2;
  }
  /** @type {ReturnType<typeof planSecuritySuites>} */
  let plan;
  try {
    plan = planSecuritySuites(readJson(values['--manifest'], 'manifest'), readJson(values['--runners'], 'runners'));
  } catch (error) {
    console.error(`security-integration: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const out = resolve(values['--out'] ?? join(root, 'reports', 'security-integration'));
  /** @type {string[]} */
  const rows = [];
  let failed = plan.errors.length > 0;
  for (const error of plan.errors) console.error(`security-integration: FAIL ${error}`);
  for (const { id, status } of plan.notActive) rows.push(`| \`${id}\` | not run (${status} in the base manifest) | – | – |`);
  if (!dryRun) mkdirSync(out, { recursive: true });
  for (const planned of plan.run) {
    const outputFile = join(out, `${planned.id}.jest.json`);
    const args = jestArgs(planned.runner, { testTimeoutMs: Number(timeout), outputFile, coverageDir: join(out, 'coverage') });
    console.log(`security-integration: ${planned.id}: node ${args.join(' ')}`);
    if (dryRun) continue;
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: SUITE_TIMEOUT_MS });
    const report = readReport(outputFile);
    const problems = suiteProblems(planned, { status: result.status, report });
    if (problems.length > 0) failed = true;
    for (const problem of problems) console.error(`security-integration: FAIL ${planned.id}: ${problem}`);
    rows.push(
      `| \`${planned.id}\` | ${problems.length === 0 ? 'PASS' : `FAIL: ${problems.join('; ')}`} | ${String(report?.numTotalTests ?? 0)} | ${String(report?.numPendingTests ?? 0)} |`,
    );
  }
  if (values['--summary'] !== undefined) {
    appendFileSync(
      values['--summary'],
      [
        `### security-integration: ${failed ? 'FAIL' : 'PASS'}`,
        '',
        ...plan.errors.map((e) => `- configuration: ${e}`),
        '| Suite | Result | Tests | Skipped |',
        '|---|---|---|---|',
        ...rows,
        '',
      ].join('\n'),
    );
  }
  if (dryRun) return plan.errors.length > 0 ? 1 : 0;
  return failed ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
