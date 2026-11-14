// @ts-check
/**
 * `npm run test:coverage` (US-006; TEST-STRATEGY section 8; D-ORCH-047; PR #33 R1-m4): ONE coverage summary merged
 * across the Jest projects that measure source. The project list is `merged_coverage` of
 * tools/quality/suite-runners.json (shared with quality:heavy): `projects` are always required, `projects_if_suites`
 * (`generated`) only while `jest --listTests` finds a test file for them.
 *
 * 1. One Jest run per group: the in-process projects together (unit, unit-dom; parallel workers), the projects that
 *    start Testcontainers or a full app together and in band with a raised test timeout (integration, api, generated;
 *    the quality:heavy rule). Each writes istanbul `coverage-final.json`; Jest's own `coverageThreshold` is switched
 *    off per partial run (`--coverageThreshold={}`) because a partial run is below the global target by design.
 * 2. tools/ci/coverage-merge.mjs merges the maps and writes `<out>/coverage-final.json`, `<out>/coverage-summary.json`
 *    (read by `npm run coverage:gate`) and `<out>/lcov.info` (read by `npm run coverage:diff -- --base <ref>`).
 * 3. The jest.config.ts `coverageThreshold.global` tripwire (85/75) is applied to the MERGED total, so it stays an
 *    independent second check next to coverage-gate.mjs.
 *
 * Fail-closed: the three outputs are deleted first and written only when every required project produced coverage
 * and ran at least one of its own test files; a failing Jest run, a missing or empty project, a project that ran no test
 * file, a map with two entries for one file, or a tripwire miss exits 1.
 *
 * CLI: node tools/ci/coverage-run.mjs [--out <dir>] [--test-timeout <ms>]
 * Exit 0 pass, 1 a run failed / a project is missing / below the tripwire, 2 usage or configuration error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadJestGlobalThreshold,
  mergeCoverageMaps,
  parseMergedCoverageConfig,
  projectProblems,
  readCoverageFinal,
  readRanTests,
  summarizeCoverage,
  toLcov,
  tripwireChecks,
} from './coverage-merge.mjs';

/** @typedef {import('./coverage-merge.mjs').MergedCoverageConfig} MergedCoverageConfig */
/** @typedef {import('./coverage-merge.mjs').CoverageSource} CoverageSource */

/** Runner configuration that holds `merged_coverage` (devops-owned; security-critical path tools/quality/**). */
export const RUNNERS_FILE = 'tools/quality/suite-runners.json';
/** Jest projects that start Testcontainers or a full app: in band, raised timeout (= quality:heavy IN_BAND_PROJECTS). */
export const IN_BAND_COVERAGE_PROJECTS = Object.freeze(['integration', 'api', 'generated']);
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 120_000;
const JEST_BIN = 'node_modules/jest/bin/jest.js';
const NODE_FLAGS = Object.freeze(['--experimental-vm-modules', '--disable-warning=ExperimentalWarning']);

/**
 * Jest flags that make one run write istanbul JSON for the merge, with the global threshold off for the partial run.
 * @param {string} coverageDir
 * @returns {string[]}
 */
export function coverageFlags(coverageDir) {
  return ['--coverage', '--coverageReporters=json', '--coverageThreshold={}', `--coverageDirectory=${coverageDir}`];
}

/**
 * Required projects, split into run groups (in-process first, then in band).
 * @param {readonly string[]} required
 * @returns {Array<{ projects: string[], inBand: boolean }>}
 */
export function coverageGroups(required) {
  const parallel = required.filter((p) => !IN_BAND_COVERAGE_PROJECTS.includes(p));
  const inBand = required.filter((p) => IN_BAND_COVERAGE_PROJECTS.includes(p));
  return [
    ...(parallel.length > 0 ? [{ projects: parallel, inBand: false }] : []),
    ...(inBand.length > 0 ? [{ projects: inBand, inBand: true }] : []),
  ];
}

/**
 * Node arguments of one group's Jest run.
 * @param {{ projects: readonly string[], inBand: boolean }} group
 * @param {{ coverageDir: string, testTimeoutMs: number, reportFile: string }} options `reportFile`: the Jest JSON report
 *   (which test files ran, for the per-project check of projectProblems)
 * @returns {string[]}
 */
export function groupJestArgs(group, { coverageDir, testTimeoutMs, reportFile }) {
  return [
    ...NODE_FLAGS,
    JEST_BIN,
    '--selectProjects',
    ...group.projects,
    ...coverageFlags(coverageDir),
    '--json',
    `--outputFile=${reportFile}`,
    ...(group.inBand ? ['-i', `--testTimeout=${testTimeoutMs}`] : []),
  ];
}

/**
 * Test files Jest would run for one project (`jest --listTests --json`). Throws when Jest cannot list them.
 * @param {string} root
 * @param {string} project
 * @returns {string[]}
 */
export function listProjectTests(root, project) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, JEST_BIN, '--listTests', '--json', '--selectProjects', project], {
    cwd: root,
    encoding: 'utf8',
    timeout: LIST_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error !== undefined || r.status !== 0) throw new Error(`jest --listTests for project ${project} failed (exit ${String(r.status)})`);
  const line = r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('['));
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(line ?? '');
  } catch {
    throw new Error(`jest --listTests for project ${project} printed no JSON list`);
  }
  if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string'))
    throw new Error(`jest --listTests for project ${project} printed no JSON list`);
  return parsed;
}

/**
 * The projects a merge must contain. A conditional project whose test files cannot be listed is required (fail closed).
 * @param {MergedCoverageConfig} config
 * @param {(project: string) => string[]} list
 * @returns {{ required: string[], notRequired: string[] }}
 */
export function requiredProjects(config, list) {
  /** @type {string[]} */
  const notRequired = [];
  const conditional = config.projectsIfSuites.filter((project) => {
    try {
      if (list(project).length > 0) return true;
    } catch {
      return true;
    }
    notRequired.push(project);
    return false;
  });
  return { required: [...config.projects, ...conditional], notRequired };
}

/**
 * `merged_coverage` of the repository's runner file.
 * @param {string} root
 * @returns {MergedCoverageConfig}
 */
export function loadMergedCoverageConfig(root) {
  const raw = /** @type {unknown} */ (JSON.parse(readFileSync(join(root, ...RUNNERS_FILE.split('/')), 'utf8')));
  if (typeof raw !== 'object' || raw === null || !('merged_coverage' in raw)) throw new Error(`${RUNNERS_FILE} has no merged_coverage`);
  return parseMergedCoverageConfig(raw.merged_coverage);
}

/** @param {Record<string, { lines: { pct: number, covered: number, total: number } }> | Record<string, any>} summary */
function textSummary(summary) {
  const total = summary['total'];
  /** @param {string} label @param {{ pct: number, covered: number, total: number }} m */
  const row = (label, m) => `${label.padEnd(13)}: ${m.pct}% ( ${m.covered}/${m.total} )`;
  return [
    '=============================== Coverage summary ===============================',
    row('Statements', total.statements),
    row('Branches', total.branches),
    row('Functions', total.functions),
    row('Lines', total.lines),
    '================================================================================',
  ];
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const root = process.cwd();
  let out = 'coverage';
  let testTimeoutMs = DEFAULT_TEST_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if ((arg === '--out' || arg === '--test-timeout') && (value === undefined || value === '' || value.startsWith('--'))) {
      console.error(`coverage-run: ${arg} needs a value`);
      return 2;
    }
    if (arg === '--out') out = /** @type {string} */ (value);
    else if (arg === '--test-timeout') {
      if (!/^[0-9]{1,7}$/.test(String(value)) || Number(value) < 1) {
        console.error('coverage-run: --test-timeout must be a positive integer (ms)');
        return 2;
      }
      testTimeoutMs = Number(value);
    } else {
      console.error(`coverage-run: unknown argument ${String(arg)}`);
      return 2;
    }
    i += 1;
  }
  const outDir = isAbsolute(out) ? out : resolve(root, out);
  /** @type {MergedCoverageConfig} */
  let config;
  /** @type {Record<string, unknown>} */
  let threshold;
  try {
    config = loadMergedCoverageConfig(root);
    threshold = await loadJestGlobalThreshold(pathToFileURL(join(root, 'jest.config.ts')).href);
  } catch (error) {
    console.error(`coverage-run: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const outputs = ['coverage-final.json', 'coverage-summary.json', 'lcov.info'].map((name) => join(outDir, name));
  for (const file of outputs) rmSync(file, { force: true });
  const partsDir = join(outDir, '.parts');
  rmSync(partsDir, { recursive: true, force: true });

  const { required, notRequired } = requiredProjects(config, (project) => listProjectTests(root, project));
  if (notRequired.length > 0) console.error(`coverage-run: not required (no test files): ${notRequired.join(', ')}`);
  /** @type {CoverageSource[]} */
  const sources = [];
  for (const group of coverageGroups(required)) {
    const coverageDir = join(partsDir, group.projects.join('+'));
    const reportFile = join(partsDir, `${group.projects.join('+')}.jest.json`);
    console.error(`coverage-run: jest --selectProjects ${group.projects.join(' ')}${group.inBand ? ' (in band)' : ''}`);
    const r = spawnSync(process.execPath, groupJestArgs(group, { coverageDir, testTimeoutMs, reportFile }), {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    const file = join(coverageDir, 'coverage-final.json');
    const label = `coverage of ${group.projects.join('+')}`;
    try {
      sources.push({
        projects: group.projects,
        map: existsSync(file) ? readCoverageFinal(file, label) : null,
        problem: r.status === 0 ? null : `${label}: jest exited ${String(r.status)}`,
        ranTests: readRanTests(reportFile),
      });
    } catch (error) {
      sources.push({
        projects: group.projects,
        map: null,
        problem: error instanceof Error ? error.message : String(error),
        ranTests: null,
      });
    }
  }
  const problems = [...projectProblems(required, sources, (project) => listProjectTests(root, project)).entries()].filter(
    ([, problem]) => problem !== null,
  );
  for (const [project, problem] of problems) console.error(`coverage-run: FAIL project ${project}: ${problem}`);
  if (problems.length > 0) {
    console.error('coverage-run: FAIL (no merged coverage written)');
    return 1;
  }
  /** @type {import('./coverage-merge.mjs').CoverageMap} */
  let merged;
  try {
    merged = mergeCoverageMaps(sources.map((s) => /** @type {import('./coverage-merge.mjs').CoverageMap} */ (s.map)));
  } catch (error) {
    console.error(`coverage-run: FAIL ${error instanceof Error ? error.message : String(error)} (no merged coverage written)`);
    return 1;
  }
  const summary = summarizeCoverage(merged);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(/** @type {string} */ (outputs[0]), `${JSON.stringify(merged)}\n`);
  writeFileSync(/** @type {string} */ (outputs[1]), `${JSON.stringify(summary)}\n`);
  writeFileSync(/** @type {string} */ (outputs[2]), toLcov(merged, root));
  for (const line of textSummary(summary)) console.log(line);
  console.log(`coverage-run: merged projects ${required.join(', ')}; written to ${out}/`);
  const tripwire = tripwireChecks(threshold, summary);
  for (const check of tripwire)
    (check.ok ? console.log : console.error)(`coverage-run: ${check.ok ? 'ok  ' : 'FAIL'} jest.config.ts global ${check.message}`);
  return tripwire.every((c) => c.ok) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`coverage-run: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
