// @ts-check
/**
 * Flaky-test report over the stored lane B runs (TASK-277, T-QA-02; TEST-STRATEGY section 11, zero tolerance).
 *
 *   npm run quality:flake-report [-- --root <repo>] [-- --runs <dir>] [-- --out <file>] [-- --fail-on-same-sha]
 *
 * Reads every `<UTCstamp>_<sha7>/*.junit.xml` under the runs directory (default docs/05-quality/tests/runs), groups the
 * test cases by (suite, classname, name) and lists the tests with MIXED outcomes: at least one pass and at least one
 * failure/error among their observations (skips are ignored). A test mixed within one SHA (same `<sha7>`, including a
 * retry inside one run) is a definite flake per section 11.1 (`same_sha_mixed`); mixed only across SHAs is
 * informational (`cross_sha_mixed`: a code change may explain it).
 *
 * Output: deterministic JSON (sorted, no timestamps, no host paths) to stdout, or to `--out`. Exit: 0 (also when
 * flakes exist, unless `--fail-on-same-sha` and `same_sha_mixed` is non-empty: 1), 1 unreadable or unparseable input,
 * 2 usage or internal error. `--out` must stay inside the root and outside the committed evidence tree; links on the
 * way are refused and the file is replaced by a rename, never written through (PR35-SEC-01).
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONSOLE_IO, DEFAULT_ROOT, parseArgs, resolveOutput, safeIo, stableJson, writeOutput } from './lib/cli.mjs';
import { JUnitError, MAX_JUNIT_BYTES, parseJUnit } from './lib/junit.mjs';
import { MapError, readBounded, relPath } from './lib/test-ids.mjs';
import { RUNS_PATH, RUN_DIR } from './trace.mjs';

/**
 * @typedef {{ run: string, sha: string, suite: string, classname: string, name: string, outcome: 'passed' | 'failed' | 'skipped' }} Observation
 * @typedef {{ suite: string, classname: string, name: string, observations: number, passed: number, failed: number,
 *   skipped: number, passed_runs: string[], failed_runs: string[], mixed_shas: string[] }} FlakyTest
 */

/**
 * Observations of every test case in every run directory, plus problems for unreadable files.
 * @param {string} root
 * @param {string} runsDir
 * @returns {{ runs: string[], observations: Observation[], problems: string[] }}
 */
export function scanRuns(root, runsDir) {
  /** @type {Observation[]} */
  const observations = [];
  /** @type {string[]} */
  const problems = [];
  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return { runs: [], observations, problems: [`${relPath(root, runsDir)}: cannot be read`] };
  }
  const runs = entries
    .filter((d) => d.isDirectory() && RUN_DIR.test(d.name))
    .map((d) => d.name)
    .sort();
  for (const run of runs) {
    const sha = run.slice(-7);
    const dir = join(runsDir, run);
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.junit.xml'))
      .sort();
    for (const file of files) {
      const path = join(dir, file);
      let report;
      try {
        report = parseJUnit(readBounded(root, path, MAX_JUNIT_BYTES));
      } catch (error) {
        problems.push(
          error instanceof JUnitError
            ? `${relPath(root, path)}: unparseable JUnit XML`
            : error instanceof MapError
              ? error.message
              : `${relPath(root, path)}: cannot be read`,
        );
        continue;
      }
      const suite = file.slice(0, -'.junit.xml'.length);
      for (const kase of report.cases)
        observations.push({
          run,
          sha,
          suite,
          classname: kase.classname,
          name: kase.name,
          outcome: kase.status === 'passed' ? 'passed' : kase.status === 'skipped' ? 'skipped' : 'failed',
        });
    }
  }
  return { runs, observations, problems };
}

/**
 * @param {readonly string[]} runs
 * @param {readonly Observation[]} observations
 * @param {readonly string[]} problems
 */
export function buildFlakeReport(runs, observations, problems) {
  /** @type {Map<string, Observation[]>} */
  const groups = new Map();
  for (const o of observations) {
    const key = JSON.stringify([o.suite, o.classname, o.name]);
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }
  /** @type {FlakyTest[]} */
  const sameSha = [];
  /** @type {FlakyTest[]} */
  const crossSha = [];
  for (const list of groups.values()) {
    const passed = list.filter((o) => o.outcome === 'passed');
    const failed = list.filter((o) => o.outcome === 'failed');
    if (passed.length === 0 || failed.length === 0) continue;
    const mixedShas = [...new Set(passed.map((o) => o.sha))].filter((sha) => failed.some((o) => o.sha === sha)).sort();
    const first = /** @type {Observation} */ (list[0]);
    /** @type {FlakyTest} */
    const entry = {
      suite: first.suite,
      classname: first.classname,
      name: first.name,
      observations: list.length,
      passed: passed.length,
      failed: failed.length,
      skipped: list.length - passed.length - failed.length,
      passed_runs: [...new Set(passed.map((o) => o.run))].sort(),
      failed_runs: [...new Set(failed.map((o) => o.run))].sort(),
      mixed_shas: mixedShas,
    };
    (mixedShas.length > 0 ? sameSha : crossSha).push(entry);
  }
  const order = (/** @type {FlakyTest} */ a, /** @type {FlakyTest} */ b) =>
    a.suite.localeCompare(b.suite, 'en') || a.classname.localeCompare(b.classname, 'en') || a.name.localeCompare(b.name, 'en');
  return {
    schema_version: 1,
    runs: [...runs],
    tests_observed: groups.size,
    observations: observations.length,
    same_sha_mixed: sameSha.sort(order),
    cross_sha_mixed: crossSha.sort(order),
    problems: [...problems].sort(),
  };
}

/**
 * @param {readonly string[]} argv
 * @param {import('./lib/cli.mjs').Io} [rawIo]
 * @returns {number}
 */
export function main(argv, rawIo = CONSOLE_IO) {
  const name = 'quality:flake-report';
  const io = safeIo(rawIo);
  try {
    const args = parseArgs(argv, ['--root', '--runs', '--out'], ['--fail-on-same-sha']);
    const root = resolve(String(args.get('--root') ?? DEFAULT_ROOT));
    const runsDir = args.has('--runs') ? resolve(String(args.get('--runs'))) : join(root, ...RUNS_PATH.split('/'));
    const out = args.has('--out') ? resolveOutput(root, String(args.get('--out')), '') : undefined;
    const { runs, observations, problems } = scanRuns(root, runsDir);
    const report = buildFlakeReport(runs, observations, problems);
    const json = stableJson(report);
    if (out !== undefined) {
      writeOutput(root, out, json);
      io.out(
        `${name}: ${report.runs.length} runs, ${report.tests_observed} tests, ${report.same_sha_mixed.length} same-SHA mixed (flaky), ${report.cross_sha_mixed.length} cross-SHA mixed, ${report.problems.length} problems`,
      );
    } else io.out(json.trimEnd());
    for (const problem of report.problems) io.err(`${name}: ${problem}`);
    if (report.problems.length > 0) return 1;
    return args.has('--fail-on-same-sha') && report.same_sha_mixed.length > 0 ? 1 : 0;
  } catch (error) {
    io.err(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
