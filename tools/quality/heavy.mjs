// @ts-check
/**
 * Lane B local heavy run (TASK-011; ADR-0023 amendments B, C, G items 1-3, I item 4; TEST-STRATEGY sections 4 and 9;
 * D-ARCH-010, D-ARCH-021; R-ARCH-16, R-ARCH-21; SEC-P3-07).
 *
 *   npm run quality:heavy -- --profile pr|wave|gate [--base <ref>] [--suites a,b] [--dry-run] [--out-root <dir>]
 *                            [--suite-timeout-min <n>] [--build-timeout-min <n>] [--test-timeout <ms>]
 *
 * 1. Pre-flight: HEAD sha, clean tree over the manifest `rules.clean_tree_paths`, `SKIP_*`/`TEST_*` variable NAMES,
 *    host spec, lockfile and manifest SHA-256, Testcontainers image digests.
 * 2. Selection: `pr` = changed paths of `git diff <base>...HEAD` through the manifest path rules; `wave`/`gate` = the
 *    profile sets. Only `active` suites run; `planned` ones are listed in summary.md only (never as JUnit).
 * 3. `npm run build`, then `git status` again: `build_clean` (a build that changes the tree yields INVALID).
 * 4. Every required suite runs from tools/quality/suite-runners.json (one Jest run per suite, or a command whose
 *    native report is converted to JUnit). An active suite without a runner entry is reported as an error (FAIL).
 * 5. Evidence: docs/05-quality/{tests,security,performance}/runs/<UTCstamp>_<sha7>/ with `<suite>.junit.xml`, the
 *    sanitised native reports, attachments, `summary.json` (validated against tools/quality/summary.schema.json
 *    before it is written) and `summary.md`. File-name allow-list and the 5 MB cap are enforced at write time.
 *
 * `--suites` restricts the run for debugging. A restricted run still writes evidence (so it can be inspected) but its
 * verdict is always INVALID: it can never stand in for the profile.
 *
 * Exit: 0 PASS, 1 FAIL or INVALID, 2 usage or internal error. Environment VALUES are never printed or recorded.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ajvModule from 'ajv/dist/2020.js';

import { coverageGateCases } from '../ci/coverage-gate.mjs';
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
} from '../ci/coverage-merge.mjs';
import { coverageFlags, coverageGroups, listProjectTests, requiredProjects } from '../ci/coverage-run.mjs';
import { evaluateDiffCoverage, gitDiff, parseLcov, parseUnifiedDiff } from '../ci/diff-coverage.mjs';
import {
  CONVERTERS,
  convertNative,
  hostScrubList,
  jestToCases,
  malformed,
  sanitizeNative,
  scrubCases,
  scrubPaths,
} from './lib/convert.mjs';
import {
  changedPaths,
  envOverrides,
  gitRoot,
  headSha,
  hostSpec,
  imageDigests,
  npmCommand,
  porcelain,
  runStreaming,
  utcStamp,
} from './lib/host.mjs';
import { parseJUnit, sha256Bytes } from './lib/junit.mjs';
import { toJUnit } from './lib/junit-write.mjs';
import { isCleanTreePath, isProfile, loadManifest, manifestFile, selectSuites } from './lib/manifest.mjs';

/** @typedef {import('./lib/manifest.mjs').Manifest} Manifest */
/** @typedef {import('./lib/manifest.mjs').Profile} Profile */
/** @typedef {import('./lib/junit-write.mjs').JUnitCase} JUnitCase */
/** @typedef {'tests' | 'security' | 'performance'} EvidenceRoot */
/**
 * @typedef {'unit' | 'unit-dom' | 'integration' | 'api' | 'generated' | 'e2e'} JestProject
 * @typedef {{ kind: 'jest', projects: JestProject[], paths: string[], testNamePattern?: string, coverage: boolean }} JestRunner
 * @typedef {{ kind: 'command', cmd: string[], converter: 'junit' | keyof typeof CONVERTERS, native_report: string | null,
 *   evidence_root: EvidenceRoot, options: Record<string, unknown> }} CommandRunner
 * @typedef {JestRunner | CommandRunner} Runner
 * @typedef {import('../ci/coverage-merge.mjs').MergedCoverageConfig} MergedCoverageConfig
 * @typedef {import('../ci/coverage-merge.mjs').CoverageSource} CoverageSource
 * @typedef {{ testcontainers_images: string[], suites: Record<string, Runner>, mergedCoverage: MergedCoverageConfig | null }} RunnersConfig
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** Runner configuration, relative to the repository root (devops-owned; security-critical path tools/quality/**). */
export const RUNNERS_PATH = 'tools/quality/suite-runners.json';
/** Evidence base directory, relative to the repository root. */
export const EVIDENCE_BASE = 'docs/05-quality';
/** ADR-0023 amendment B: cap per run directory. */
export const MAX_RUN_DIR_BYTES = 5 * 1024 * 1024;
export const DEFAULTS = Object.freeze({ base: 'origin/main', suiteTimeoutMin: 45, buildTimeoutMin: 30, testTimeoutMs: 30_000 });
/**
 * Jest projects that start Testcontainers or a full app: always in band with a raised per-test timeout (host load).
 * `generated` holds the RBAC, audit, RLS and abuse generator suites (`*.api` / `*.int` under tests/generated; TASK-276).
 */
const IN_BAND_PROJECTS = new Set(['integration', 'api', 'generated']);
/** Jest projects of jest.config.ts a runner may select (`npm run test:unit` = unit + unit-dom since TASK-004). */
const JEST_PROJECTS = new Set(['unit', 'unit-dom', 'integration', 'api', 'generated', 'e2e']);
const SUITE_ID = /^[a-z0-9][a-z0-9-]*$/;

export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// --- arguments ----------------------------------------------------------------------------------------------------

/**
 * @param {readonly string[]} argv
 * @returns {{ profile: Profile, base: string, suites: string[] | null, dryRun: boolean, outRoot: string | null,
 *   suiteTimeoutMin: number, buildTimeoutMin: number, testTimeoutMs: number }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let dryRun = false;
  const valued = new Set(['--profile', '--base', '--suites', '--out-root', '--suite-timeout-min', '--build-timeout-min', '--test-timeout']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    const eq = arg.indexOf('=');
    const [flag, inline] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
    if (flag === '--dry-run' && inline === undefined) dryRun = true;
    else if (valued.has(flag)) {
      const value = inline ?? argv[i + 1];
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--')))
        throw new UsageError(`${flag} needs a value`);
      if (inline === undefined) i += 1;
      values[flag] = value;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  const profile = values['--profile'];
  if (profile === undefined || !isProfile(profile)) throw new UsageError('--profile pr|wave|gate is required');
  /** @param {string} flag @param {number} fallback @param {number} max */
  const int = (flag, fallback, max) => {
    const raw = values[flag];
    if (raw === undefined) return fallback;
    if (!/^[0-9]{1,7}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new UsageError(`${flag} must be an integer in 1..${max}`);
    return Number(raw);
  };
  const suites =
    values['--suites'] === undefined
      ? null
      : values['--suites']
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
  if (suites !== null && (suites.length === 0 || suites.some((s) => !SUITE_ID.test(s))))
    throw new UsageError('--suites takes a comma-separated list of suite ids');
  return {
    profile,
    base: values['--base'] ?? DEFAULTS.base,
    suites,
    dryRun,
    outRoot: values['--out-root'] ?? null,
    suiteTimeoutMin: int('--suite-timeout-min', DEFAULTS.suiteTimeoutMin, 600),
    buildTimeoutMin: int('--build-timeout-min', DEFAULTS.buildTimeoutMin, 600),
    testTimeoutMs: int('--test-timeout', DEFAULTS.testTimeoutMs, 3_600_000),
  };
}

// --- runner configuration -------------------------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string[]}
 */
function strings(value, where) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === ''))
    throw new Error(`${where} must be an array of non-empty strings`);
  return /** @type {string[]} */ (value);
}

/**
 * Default evidence root per converter (ADR-0023 am. B: security tools -> security/, k6/Lighthouse/Stryker -> performance/).
 * @param {string} converter
 * @returns {EvidenceRoot}
 */
export function defaultEvidenceRoot(converter) {
  if (converter === 'trivy' || converter === 'zap' || converter === 'gitleaks') return 'security';
  if (converter === 'k6' || converter === 'lighthouse' || converter === 'stryker') return 'performance';
  return 'tests';
}

/**
 * Validates tools/quality/suite-runners.json. Unknown kinds/converters and unsafe Jest paths throw.
 * @param {unknown} raw
 * @returns {RunnersConfig}
 */
export function parseRunners(raw) {
  if (!isRecord(raw) || raw['version'] !== 1 || !isRecord(raw['suites']))
    throw new Error(`${RUNNERS_PATH}: { version: 1, suites: {} } expected`);
  const images = strings(raw['testcontainers_images'], 'testcontainers_images');
  /** @type {Record<string, Runner>} */
  const suites = {};
  for (const [id, entry] of Object.entries(raw['suites'])) {
    if (!SUITE_ID.test(id) || !isRecord(entry)) throw new Error(`${RUNNERS_PATH}: suites.${id} is invalid`);
    if (entry['kind'] === 'jest') {
      const rawProjects = entry['project'];
      const projectList = typeof rawProjects === 'string' ? [rawProjects] : rawProjects;
      if (
        !Array.isArray(projectList) ||
        projectList.length === 0 ||
        !projectList.every((p) => typeof p === 'string' && JEST_PROJECTS.has(p))
      )
        throw new Error(`suites.${id}.project must be one of, or a non-empty list of, ${[...JEST_PROJECTS].join('|')}`);
      const projects = /** @type {JestProject[]} */ ([...new Set(projectList)]);
      const paths = strings(entry['paths'], `suites.${id}.paths`);
      if (paths.some((p) => p.startsWith('-') || p.includes('..')))
        throw new Error(`suites.${id}.paths must be repository-relative path patterns`);
      const pattern = entry['testNamePattern'];
      if (pattern !== undefined && (typeof pattern !== 'string' || pattern === '' || pattern.startsWith('-')))
        throw new Error(`suites.${id}.testNamePattern must be a non-empty string`);
      // A coverage run feeds the merged gate: a path or name filter would measure part of a project as if it were all.
      if (entry['coverage'] === true && (paths.length > 0 || pattern !== undefined))
        throw new Error(`suites.${id}: coverage: true needs whole projects (no paths, no testNamePattern)`);
      suites[id] = {
        kind: 'jest',
        projects,
        paths,
        ...(typeof pattern === 'string' ? { testNamePattern: pattern } : {}),
        coverage: entry['coverage'] === true,
      };
    } else if (entry['kind'] === 'command') {
      const cmd = strings(entry['cmd'], `suites.${id}.cmd`);
      if (cmd.length === 0) throw new Error(`suites.${id}.cmd must not be empty`);
      const converter = entry['converter'];
      if (typeof converter !== 'string' || (converter !== 'junit' && !Object.hasOwn(CONVERTERS, converter)))
        throw new Error(`suites.${id}.converter must be junit|${Object.keys(CONVERTERS).join('|')}`);
      const nativeReport = entry['native_report'] ?? null;
      if (nativeReport !== null && (typeof nativeReport !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(nativeReport)))
        throw new Error(`suites.${id}.native_report must be a .json file name`);
      if (converter !== 'junit' && nativeReport === null) throw new Error(`suites.${id}: converter ${converter} needs native_report`);
      const root = entry['evidence_root'] ?? defaultEvidenceRoot(converter);
      if (root !== 'tests' && root !== 'security' && root !== 'performance')
        throw new Error(`suites.${id}.evidence_root must be tests|security|performance`);
      const options = entry['options'] ?? {};
      if (!isRecord(options)) throw new Error(`suites.${id}.options must be an object`);
      suites[id] = {
        kind: 'command',
        cmd,
        converter: /** @type {CommandRunner['converter']} */ (converter),
        native_report: nativeReport,
        evidence_root: root,
        options,
      };
    } else throw new Error(`suites.${id}.kind must be jest|command`);
  }
  const mergedCoverage = raw['merged_coverage'] === undefined ? null : parseMergedCoverageConfig(raw['merged_coverage']);
  const coverageRunners = Object.entries(suites).filter(([, r]) => r.kind === 'jest' && r.coverage);
  // Fail closed (PR33-SEC-06): a coverage run without a merged gate would measure and judge nothing.
  if (coverageRunners.length > 0 && mergedCoverage === null)
    throw new Error(`${RUNNERS_PATH}: suites with coverage: true need merged_coverage (the suite that carries the US-006 gate)`);
  if (mergedCoverage !== null) {
    const host = suites[mergedCoverage.suite];
    if (host === undefined || host.kind !== 'jest' || !host.coverage)
      throw new Error(`${RUNNERS_PATH}: merged_coverage.suite ${mergedCoverage.suite} must be a kind jest suite with coverage: true`);
  }
  return { testcontainers_images: images, suites, mergedCoverage };
}

// --- planning -----------------------------------------------------------------------------------------------------

/**
 * @param {{ manifest: Manifest, runners: RunnersConfig, profile: Profile, changedPaths: readonly string[], restrict: readonly string[] | null }} input
 * @returns {{ required: string[], planned: string[], rules: string[], toRun: Array<{ id: string, runner: Runner | null, root: EvidenceRoot }>, restricted: boolean }}
 */
export function planRun({ manifest, runners, profile, changedPaths: paths, restrict }) {
  const selection = selectSuites(manifest, { profile, changedPaths: paths });
  if (restrict !== null) {
    const unknown = restrict.filter((id) => !Object.hasOwn(manifest.suites, id));
    if (unknown.length > 0) throw new UsageError(`--suites: not in the manifest: ${unknown.join(', ')}`);
    const inactive = restrict.filter((id) => manifest.suites[id]?.status !== 'active');
    if (inactive.length > 0) throw new UsageError(`--suites: not active in the manifest (never reported as JUnit): ${inactive.join(', ')}`);
  }
  const ids = restrict === null ? selection.required : [...new Set(restrict)].sort();
  return {
    required: selection.required,
    planned: selection.planned,
    rules: selection.rules,
    toRun: ids.map((id) => {
      const runner = runners.suites[id] ?? null;
      return { id, runner, root: runner?.kind === 'command' ? runner.evidence_root : 'tests' };
    }),
    restricted: restrict !== null,
  };
}

/**
 * Extra Jest arguments of a suite (recorded in summary.json `jest_args`).
 * @param {JestRunner} runner
 * @param {{ testTimeoutMs: number }} options
 * @returns {string[]}
 */
export function jestExtraArgs(runner, { testTimeoutMs }) {
  return runner.projects.some((project) => IN_BAND_PROJECTS.has(project)) ? ['-i', `--testTimeout=${testTimeoutMs}`] : [];
}

/**
 * Full Jest argument list (after `node`), one Jest run per suite. Paths come BEFORE `--selectProjects`.
 * @param {JestRunner} runner
 * @param {{ testTimeoutMs: number, outputFile: string, coverageDir: string }} options
 * @returns {string[]}
 */
export function jestArgs(runner, { testTimeoutMs, outputFile, coverageDir }) {
  return [
    '--experimental-vm-modules',
    '--disable-warning=ExperimentalWarning',
    'node_modules/jest/bin/jest.js',
    ...runner.paths,
    '--selectProjects',
    ...runner.projects,
    '--ci',
    '--json',
    '--outputFile',
    outputFile,
    ...(runner.testNamePattern === undefined ? [] : ['--testNamePattern', runner.testNamePattern]),
    ...(runner.coverage ? coverageFlags(coverageDir) : []),
    ...jestExtraArgs(runner, { testTimeoutMs }),
  ];
}

/**
 * Expands the placeholders of a command runner: `{node}`, `{npm}` (two arguments: node + npm-cli.js), `{root}`,
 * `{junit}` (where a `junit` converter command writes its report), `{native}` (where the tool writes its native JSON).
 * @param {readonly string[]} cmd
 * @param {{ node: string, npm: readonly string[], root: string, junit: string, native: string }} values
 * @returns {string[]}
 */
export function expandCommand(cmd, values) {
  return cmd.flatMap((part) =>
    part === '{npm}'
      ? [...values.npm]
      : [
          part
            .replaceAll('{node}', values.node)
            .replaceAll('{root}', values.root)
            .replaceAll('{junit}', values.junit)
            .replaceAll('{native}', values.native),
        ],
  );
}

// --- verdict ------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ id: string, root: EvidenceRoot, cases: JUnitCase[], tests: number, failures: number, errors: number, skipped: number,
 *   durationS: number, junit: string, native: { name: string, text: string } | null, jestArgs: string[] }} SuiteResult
 * @typedef {SuiteResult & { coverageRaw: unknown, coverageSource: CoverageSource | null }} RunResult
 */

/** @param {string} name @param {string} id */
function nameCarriesId(name, id) {
  let from = 0;
  for (;;) {
    const at = name.indexOf(id, from);
    if (at === -1) return false;
    const next = name[at + id.length];
    if (next === undefined || !/[0-9]/.test(next)) return true;
    from = at + 1;
  }
}

/**
 * Recomputes the verdict (TEST-STRATEGY 9.2 rules 1-3 and 6; ADR-0023 am. G items 1-3, I item 4).
 * @param {{ manifest: Manifest, required: readonly string[], results: readonly SuiteResult[], gitDirtyPaths: readonly string[],
 *   buildClean: boolean, buildFailed: boolean, invalidEnv: readonly string[], restricted: string[] | null, extraInvalid?: readonly string[] }} input
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'INVALID', invalidReasons: string[], failReasons: string[] }}
 */
export function computeVerdict({
  manifest,
  required,
  results,
  gitDirtyPaths,
  buildClean,
  buildFailed,
  invalidEnv,
  restricted,
  extraInvalid = [],
}) {
  /** @type {string[]} */
  const invalidReasons = [];
  if (gitDirtyPaths.length > 0)
    invalidReasons.push(
      `dirty tree under rules.clean_tree_paths: ${gitDirtyPaths.length} path(s), first ${gitDirtyPaths.slice(0, 3).join(', ')}`.slice(
        0,
        300,
      ),
    );
  if (!buildClean) invalidReasons.push('npm run build changed the working tree (build_clean false; R-ARCH-21, ADR-0023 am. I item 4)');
  if (buildFailed) invalidReasons.push('npm run build failed or timed out; suites were not run');
  for (const name of invalidEnv) invalidReasons.push(`invalidating environment variable set: ${name} (D-ARCH-021; value not recorded)`);
  if (restricted !== null)
    invalidReasons.push(`restricted run (--suites ${restricted.join(',')}): never evidence for the profile`.slice(0, 300));
  if (required.length === 0) invalidReasons.push('no active suite is selected for this profile and change: nothing was verified');
  invalidReasons.push(...extraInvalid);

  /** @type {string[]} */
  const failReasons = [];
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const id of required) {
    const suite = manifest.suites[id];
    const result = byId.get(id);
    if (suite === undefined) continue;
    if (result === undefined) {
      failReasons.push(`${id}: required suite missing`);
      continue;
    }
    const min = Math.max(suite.min_tests, 1);
    if (result.tests < min) failReasons.push(`${id}: ${result.tests} test(s) < min_tests ${min}`);
    if (result.failures + result.errors > 0) failReasons.push(`${id}: ${result.failures} failure(s), ${result.errors} error(s)`);
    if ((suite.security || suite.zero_skip) && result.skipped > 0)
      failReasons.push(`${id}: ${result.skipped} skipped in a zero-skip suite`);
    for (const caseId of suite.required_cases)
      if (!result.cases.some((c) => c.status === 'passed' && nameCarriesId(c.name, caseId)))
        failReasons.push(`${id}: required case ${caseId} has no passing test case`);
  }
  for (const result of results)
    for (const c of result.cases)
      if (c.status !== 'passed' && /SEC-TC-[0-9]{2,3}/.test(c.name))
        failReasons.push(`${result.id}: security case not passing (${c.status}): ${c.name.slice(0, 120)}`);
  const verdict = invalidReasons.length > 0 ? 'INVALID' : failReasons.length > 0 ? 'FAIL' : 'PASS';
  return { verdict, invalidReasons, failReasons: [...new Set(failReasons)] };
}

/**
 * Status of a suite for summary.json.
 * @param {{ tests: number, failures: number, errors: number }} counts
 * @returns {'passed' | 'failed' | 'error'}
 */
export function suiteStatus({ tests, failures, errors }) {
  if (errors > 0) return 'error';
  if (failures > 0 || tests === 0) return 'failed';
  return 'passed';
}

/**
 * build_clean: no porcelain entry appeared or changed status between before and after `npm run build`.
 * @param {ReadonlyArray<{ status: string, path: string }>} before
 * @param {ReadonlyArray<{ status: string, path: string }>} after
 */
export function buildCleanFrom(before, after) {
  const seen = new Set(before.map((e) => `${e.status} ${e.path}`));
  return after.every((e) => seen.has(`${e.status} ${e.path}`));
}

// --- evidence files -----------------------------------------------------------------------------------------------

/** @type {Record<EvidenceRoot, string[]>} */
const FIXED_FILES = {
  // Degraded-mode lane A evidence (tools/quality/fastlane.mjs) lives in docs/05-quality/tests/fastlane/, never in runs/.
  tests: [
    'summary.json',
    'summary.md',
    'coverage-summary.json',
    'compose-up.json',
    'axe-summary.json',
    'csp-violations.json',
    'headers.json',
    'restore-report.json',
    'flake-report.json',
    'ac-trace.json',
    'inventory.json',
  ],
  security: [
    'summary.json',
    'summary.md',
    'zap-baseline.json',
    'trivy-config.json',
    'gitleaks-full.json',
    'osv.json',
    'npm-audit.json',
    'semgrep.json',
  ],
  performance: ['summary.json', 'summary.md', 'host-spec.json', 'stryker-summary.json'],
};
/** @type {Record<EvidenceRoot, RegExp[]>} */
// Same patterns as allowedRunFile in tools/quality/check-evidence.mjs: every name written here must pass the verifier.
const PATTERN_FILES = {
  tests: [],
  security: [/^trivy-[a-z0-9][a-z0-9.-]{0,80}\.json$/],
  performance: [/^k6-[a-z0-9][a-z0-9-]{0,60}\.summary\.json$/, /^lighthouse\/[a-z0-9][a-z0-9-]{0,80}-[a-z]{2}(?:-[A-Z]{2})?\.json$/],
};

/**
 * File-name allow-list of a run directory (TEST-STRATEGY 9.1; ADR-0023 am. B): the fixed names, `<suite>.junit.xml`
 * for every manifest suite and the per-root patterns. HTML, traces, screenshots and raw lcov never match.
 * @param {string} name path relative to the run directory, `/`-separated
 * @param {EvidenceRoot} root
 * @param {readonly string[]} suiteIds
 */
export function isAllowedRunFile(name, root, suiteIds) {
  if (FIXED_FILES[root].includes(name)) return true;
  const junit = /^([a-z0-9][a-z0-9-]*)\.junit\.xml$/.exec(name);
  if (junit !== null) return suiteIds.includes(/** @type {string} */ (junit[1]));
  return PATTERN_FILES[root].some((re) => re.test(name));
}

/**
 * Coverage summary with repository-relative keys (no host paths) and the per-package roll-up.
 * @param {unknown} raw Jest `coverage-summary.json`
 * @param {string} root
 * @returns {{ file: Record<string, unknown>, coverage: { line: number, branch: number, per_package: Record<string, { line: number, branch: number }> } } | null}
 */
export function relativiseCoverage(raw, root) {
  if (!isRecord(raw) || !isRecord(raw['total'])) return null;
  const prefix = root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  /** @type {Record<string, unknown>} */
  const file = {};
  /** @type {Map<string, { lc: number, lt: number, bc: number, bt: number }>} */
  const packages = new Map();
  /** @param {unknown} m @param {string} key */
  const metric = (m, key) => {
    const entry = isRecord(m) ? m[key] : undefined;
    return isRecord(entry)
      ? { covered: Number(entry['covered']) || 0, total: Number(entry['total']) || 0, pct: Number(entry['pct']) || 0 }
      : { covered: 0, total: 0, pct: 0 };
  };
  for (const [key, value] of Object.entries(raw)) {
    const normalized = key.replaceAll('\\', '/');
    const rel =
      key === 'total'
        ? 'total'
        : normalized.toLowerCase().startsWith(`${prefix}/`)
          ? normalized.slice(prefix.length + 1)
          : `<outside>/${normalized.split('/').pop() ?? ''}`;
    file[rel] = value;
    const pkg = /^((?:apps|packages)\/[^/]+|prisma)\//.exec(rel);
    if (pkg === null) continue;
    const acc = packages.get(/** @type {string} */ (pkg[1])) ?? { lc: 0, lt: 0, bc: 0, bt: 0 };
    const lines = metric(value, 'lines');
    const branches = metric(value, 'branches');
    acc.lc += lines.covered;
    acc.lt += lines.total;
    acc.bc += branches.covered;
    acc.bt += branches.total;
    packages.set(/** @type {string} */ (pkg[1]), acc);
  }
  /** @param {number} c @param {number} t */
  const pct = (c, t) => (t === 0 ? 100 : Math.round((c / t) * 10_000) / 100);
  /** @type {Record<string, { line: number, branch: number }>} */
  const perPackage = {};
  for (const [name, acc] of [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)))
    perPackage[name] = { line: pct(acc.lc, acc.lt), branch: pct(acc.bc, acc.bt) };
  const clamp = (/** @type {number} */ n) => Math.min(100, Math.max(0, n));
  return {
    file,
    coverage: {
      line: clamp(metric(raw['total'], 'lines').pct),
      branch: clamp(metric(raw['total'], 'branches').pct),
      per_package: perPackage,
    },
  };
}

/**
 * One summary.md line on the merged gate: projects, overall lines/branches of the merged summary and the verdict of the
 * gate cases (`coverage gate:`, `coverage merge:`, `coverage tripwire:`, `coverage diff:`).
 * @param {Record<string, unknown> | null} summary
 * @param {readonly string[]} projects
 * @param {readonly JUnitCase[]} cases
 * @returns {string}
 */
export function mergedCoverageNote(summary, projects, cases) {
  const failed = cases.filter((c) => c.status !== 'passed').length;
  const verdict = failed === 0 ? 'PASS' : `FAIL (${failed} case(s))`;
  const total = summary !== null && isRecord(summary['total']) ? summary['total'] : null;
  /** @param {string} key */
  const pct = (key) => {
    const m = total?.[key];
    return isRecord(m) ? `${String(m['pct'])} % (${String(m['covered'])}/${String(m['total'])})` : 'n/a';
  };
  return `Merged coverage (${projects.join(', ')}): lines ${pct('lines')}, branches ${pct('branches')}; US-006 merged gate ${verdict}`;
}

/**
 * summary.md (first line is the contract of ADR-0023 am. B).
 * @param {Record<string, unknown> & { git_sha: string, stamp: string, profile: string, verdict: string, invalid_reasons: string[],
 *   suites: Array<{ name: string, status: string, tests: number, failures: number, errors: number, skipped: number, duration_s: number }> }} summary
 * @param {{ planned: readonly string[], rules: readonly string[], failReasons: readonly string[], restricted: string[] | null, siblings: readonly string[],
 *   coverageNote?: string | null }} extra
 */
export function renderSummaryMd(summary, extra) {
  const lines = [
    `sha ${summary.git_sha.slice(0, 7)} · ${summary.stamp} · profile ${summary.profile} · verdict ${summary.verdict}`,
    '',
    `Generated by \`npm run quality:heavy\` (tools/quality/heavy.mjs). Machine-generated: do not edit.`,
    '',
    '| Suite | Status | Tests | Failures | Errors | Skipped | Duration (s) |',
    '|---|---|---|---|---|---|---|',
    ...summary.suites.map((s) => `| ${s.name} | ${s.status} | ${s.tests} | ${s.failures} | ${s.errors} | ${s.skipped} | ${s.duration_s} |`),
    '',
  ];
  if (extra.coverageNote) lines.push(extra.coverageNote, '');
  if (extra.rules.length > 0) lines.push(`Path rules fired: ${extra.rules.join(', ')}`, '');
  if (extra.restricted !== null) lines.push(`Restricted run (--suites): ${extra.restricted.join(', ')}`, '');
  if (extra.planned.length > 0)
    lines.push(`Skipped by manifest (status planned, never reported as JUnit): ${extra.planned.join(', ')}`, '');
  if (summary.invalid_reasons.length > 0) lines.push('INVALID because:', ...summary.invalid_reasons.map((r) => `- ${r}`), '');
  if (extra.failReasons.length > 0) lines.push('FAIL because:', ...extra.failReasons.map((r) => `- ${r}`), '');
  if (extra.siblings.length > 0) lines.push(`Same run, other evidence roots: ${extra.siblings.join(', ')}`, '');
  return lines.join('\n');
}

// --- edges ----------------------------------------------------------------------------------------------------------

/**
 * Validator of tools/quality/summary.schema.json (the schema next to this script, versioned with it).
 * @returns {import('ajv').ValidateFunction}
 */
export function summaryValidator() {
  const Ajv2020 = ajvModule.default;
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  // ajv-formats is not a dependency; the one format the schema uses is the UTC timestamp heavy.mjs writes itself.
  ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/);
  const schema = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(join(HERE, 'summary.schema.json'), 'utf8')));
  return ajv.compile(schema);
}

/**
 * Turns cases into a JUnit document and re-reads it with the verifier's parser, so the counts recorded in summary.json
 * are by construction the counts quality:check-evidence will see.
 * @param {string} id
 * @param {JUnitCase[]} cases
 * @param {number} durationS
 */
function junitFor(id, cases, durationS) {
  const junit = toJUnit({ suite: id, cases, time: durationS });
  const parsed = parseJUnit(junit);
  return { junit, tests: parsed.tests, failures: parsed.failures, errors: parsed.errors, skipped: parsed.skipped };
}

/** @param {string} file */
function readJson(file) {
  return /** @type {unknown} */ (JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Test cases of a Jest JSON report. A missing, truncated (suite-timeout kill) or otherwise unreadable report becomes one
 * error case, so the run still produces evidence that says why it failed (PR #23 R1-n1).
 * @param {string} file
 * @param {{ root: string, scrub: string[] }} options
 * @returns {JUnitCase[]}
 */
export function jestCasesFrom(file, options) {
  if (!existsSync(file)) return malformed('jest', 'Jest wrote no JSON report');
  /** @type {unknown} */
  let report;
  try {
    report = readJson(file);
  } catch (error) {
    return malformed('jest', `Jest JSON report is not readable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
  }
  return jestToCases(report, options);
}

/**
 * The coverage of one Jest run for the merge: its projects, its validated istanbul map (or the reason it has none) and
 * the test files its Jest JSON report says ran (projectProblems requires each project to have run one of its own).
 * @param {readonly JestProject[]} projects
 * @param {string} coverageDir
 * @param {string} reportFile the run's `--outputFile` Jest JSON report
 * @returns {CoverageSource}
 */
export function coverageSourceFrom(projects, coverageDir, reportFile) {
  const label = `coverage of ${projects.join('+')}`;
  const file = join(coverageDir, 'coverage-final.json');
  const ranTests = readRanTests(reportFile);
  if (!existsSync(file)) return { projects: [...projects], map: null, problem: `${label}: Jest wrote no coverage-final.json`, ranTests };
  try {
    return { projects: [...projects], map: readCoverageFinal(file, label), problem: null, ranTests };
  } catch (error) {
    return { projects: [...projects], map: null, problem: error instanceof Error ? error.message : String(error), ranTests };
  }
}

/** Case name prefix of the merged step's own checks. */
const MERGE = 'coverage merge:';

/**
 * Diff-coverage cases (US-006 changed-file gate, tools/ci/diff-coverage.mjs) over the merged lcov.
 * @param {{ lcov: string, repoRoot: string, base: string, classname: string, diff?: (root: string, base: string, head: string) => string }} input
 * @returns {JUnitCase[]}
 */
export function diffCoverageCases({ lcov, repoRoot, base, classname, diff = gitDiff }) {
  try {
    const verdicts = evaluateDiffCoverage(parseUnifiedDiff(diff(repoRoot, base, 'HEAD')), parseLcov(lcov, repoRoot));
    if (verdicts.length === 0) return [{ name: 'coverage diff: no changed source file in scope', classname, status: 'passed' }];
    /** @param {{ covered: number, total: number }} c */
    const fmt = (c) => (c.total === 0 ? 'n/a' : `${((c.covered * 100) / c.total).toFixed(2)}% (${c.covered}/${c.total})`);
    return verdicts.map((v) =>
      v.status === 'ok' || v.status === 'no-executable-change'
        ? { name: `coverage diff: ${v.file}`, classname, status: /** @type {const} */ ('passed') }
        : {
            name: `coverage diff: ${v.file}`,
            classname,
            status: /** @type {const} */ ('failed'),
            message:
              `${v.status}: changed lines ${fmt(v.lines)} (>= ${v.threshold.lines}%), branches ${fmt(v.branches)} (>= ${v.threshold.branches}%)` +
              (v.uncovered.length > 0 ? `, uncovered lines ${v.uncovered.slice(0, 20).join(',')}` : ''),
          },
    );
  } catch (error) {
    return [
      {
        name: 'coverage diff: evaluated',
        classname,
        status: 'error',
        message: `diff coverage not evaluated: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      },
    ];
  }
}

/**
 * The merged US-006 gate of a run (D-ORCH-047; PR #33 R1-m4, PR33-SEC-06). Takes the coverage of every suite that ran
 * whole projects with `coverage: true`, runs each required project no such suite covered (one Jest run per group, same
 * in-band rule), merges, and returns the cases for the `merged_coverage.suite` JUnit plus the merged summary.
 * Fail-closed: a project without usable coverage, or one that ran none of its own test files (R1-m1, PR40-SEC-03), fails
 * its `coverage merge: project <p> measured` case and the gate reports an absent summary; maps that cannot be merged
 * fail `coverage merge: maps merged`; a coverage-only run with a failing test, a non-zero exit or a timeout fails its own
 * case (R1-m2).
 * @param {{ config: MergedCoverageConfig, results: readonly RunResult[], repoRoot: string, work: string, testTimeoutMs: number,
 *   suiteTimeoutMs: number, profile: Profile, base: string,
 *   listTests?: (project: string) => string[], loadThreshold?: () => Promise<Record<string, unknown>>,
 *   diff?: (root: string, base: string, head: string) => string }} ctx
 * @returns {Promise<{ cases: JUnitCase[], summary: Record<string, unknown> | null, required: string[] }>}
 */
export async function mergedCoverageStep(ctx) {
  const classname = ctx.config.suite;
  /** @type {JUnitCase[]} */
  const cases = [];
  const listTests = ctx.listTests ?? ((/** @type {string} */ project) => listProjectTests(ctx.repoRoot, project));
  const { required, notRequired } = requiredProjects(ctx.config, listTests);
  for (const project of notRequired)
    cases.push({ name: `${MERGE} project ${project} has no test files (not required)`, classname, status: 'passed' });

  const sources = ctx.results.flatMap((r) => (r.coverageSource === null ? [] : [r.coverageSource]));
  const covered = new Set(sources.flatMap((s) => s.projects));
  for (const group of coverageGroups(required.filter((p) => !covered.has(p)))) {
    const projects = /** @type {JestProject[]} */ (group.projects);
    const tag = projects.join('-');
    const outputFile = join(ctx.work, `coverage-run-${tag}.jest.json`);
    const coverageDir = join(ctx.work, `coverage-run-${tag}`);
    /** @type {JestRunner} */
    const runner = { kind: 'jest', projects, paths: [], coverage: true };
    console.error(`quality:heavy: coverage run ${projects.join(' ')} (no selected suite ran these projects)`);
    const result = await runStreaming(process.execPath, jestArgs(runner, { testTimeoutMs: ctx.testTimeoutMs, outputFile, coverageDir }), {
      cwd: ctx.repoRoot,
      timeoutMs: ctx.suiteTimeoutMs,
    });
    const bad = jestCasesFrom(outputFile, { root: ctx.repoRoot, scrub: [] }).filter(
      (c) => c.status === 'failed' || c.status === 'error',
    ).length;
    const problem = result.timedOut
      ? 'timed out (process tree killed)'
      : bad > 0
        ? `${bad} failing test case(s)`
        : result.status !== 0
          ? `jest exited ${String(result.status)}`
          : null;
    cases.push({
      name: `${MERGE} ${projects.join('+')} coverage run`,
      classname,
      status: problem === null ? 'passed' : 'failed',
      ...(problem === null ? {} : { message: `coverage-only run of ${projects.join('+')}: ${problem}` }),
    });
    sources.push(coverageSourceFrom(projects, coverageDir, outputFile));
  }

  const problems = projectProblems(required, sources, listTests);
  for (const [project, problem] of problems)
    cases.push({
      name: `${MERGE} project ${project} measured`,
      classname,
      status: problem === null ? 'passed' : 'failed',
      ...(problem === null ? {} : { message: problem }),
    });
  if ([...problems.values()].some((p) => p !== null)) {
    cases.push(...coverageGateCases(null, { root: ctx.repoRoot, classname }));
    return { cases, summary: null, required };
  }
  /** @type {import('../ci/coverage-merge.mjs').CoverageMap} */
  let merged;
  try {
    merged = mergeCoverageMaps(sources.flatMap((s) => (s.map === null ? [] : [s.map])));
  } catch (error) {
    // Fail closed (PR40-SEC-04): e.g. one run's map holds two entries for one file.
    cases.push({
      name: `${MERGE} maps merged`,
      classname,
      status: 'failed',
      message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    });
    cases.push(...coverageGateCases(null, { root: ctx.repoRoot, classname }));
    return { cases, summary: null, required };
  }
  const summary = summarizeCoverage(merged);
  cases.push(...coverageGateCases(summary, { root: ctx.repoRoot, classname }));
  const loadThreshold = ctx.loadThreshold ?? (() => loadJestGlobalThreshold(pathToFileURL(join(ctx.repoRoot, 'jest.config.ts')).href));
  try {
    for (const check of tripwireChecks(await loadThreshold(), summary))
      cases.push({
        name: `coverage tripwire: jest.config.ts global ${check.metric}`,
        classname,
        status: check.ok ? 'passed' : 'failed',
        ...(check.ok ? {} : { message: check.message }),
      });
  } catch (error) {
    cases.push({
      name: 'coverage tripwire: jest.config.ts global',
      classname,
      status: 'error',
      message: `tripwire not evaluated: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
    });
  }
  if (ctx.profile === 'pr')
    cases.push(
      ...diffCoverageCases({
        lcov: toLcov(merged, ctx.repoRoot),
        repoRoot: ctx.repoRoot,
        base: ctx.base,
        classname,
        ...(ctx.diff === undefined ? {} : { diff: ctx.diff }),
      }),
    );
  return { cases, summary, required };
}

/**
 * Where evidence is written: the repository's docs/05-quality tree, or --out-root. A restricted run (--suites) is
 * always INVALID, so by default it goes to a fresh temp directory and can never be committed by accident (R1-n5).
 * @param {{ outRoot: string | null, suites: string[] | null }} args
 * @param {string} repoRoot
 * @returns {string}
 */
export function resolveOutBase(args, repoRoot) {
  if (args.outRoot !== null) return isAbsolute(args.outRoot) ? args.outRoot : resolve(process.cwd(), args.outRoot);
  if (args.suites !== null) return mkdtempSync(join(tmpdir(), 'quality-heavy-restricted-'));
  return join(repoRoot, ...EVIDENCE_BASE.split('/'));
}

/**
 * @param {{ id: string, runner: Runner | null, root: EvidenceRoot }} item
 * @param {{ repoRoot: string, work: string, testTimeoutMs: number, suiteTimeoutMs: number, scrub: string[] }} ctx
 * @returns {Promise<RunResult>}
 */
async function runSuite(item, ctx) {
  const started = Date.now();
  /** @param {JUnitCase[]} rawCases @param {Partial<RunResult>} [more] @returns {RunResult} */
  const done = (rawCases, more = {}) => {
    // The one choke point: whatever a converter or runner produced, no host path reaches the committed JUnit (PR28-SEC-02).
    const cases = scrubCases(rawCases, ctx.scrub);
    const durationS = Math.round((Date.now() - started) / 100) / 10;
    return {
      id: item.id,
      root: item.root,
      cases,
      durationS,
      native: null,
      jestArgs: [],
      coverageRaw: null,
      coverageSource: null,
      ...junitFor(item.id, cases, durationS),
      ...more,
    };
  };
  if (item.runner === null)
    return done([
      {
        name: `${item.id}: runner configured`,
        classname: item.id,
        status: 'error',
        message: `no runner entry for active suite ${item.id} in ${RUNNERS_PATH}`,
      },
    ]);
  /** @param {import('./lib/host.mjs').RunResult} r */
  const exitProblem = (r) =>
    r.timedOut
      ? `timed out after ${Math.round(ctx.suiteTimeoutMs / 60_000)} min (process tree killed)`
      : r.status !== 0
        ? `exited ${String(r.status)}${r.signal ? ` (signal ${r.signal})` : ''}`
        : null;

  if (item.runner.kind === 'jest') {
    const outputFile = join(ctx.work, `${item.id}.jest.json`);
    const coverageDir = join(ctx.work, `coverage-${item.id}`);
    const args = jestArgs(item.runner, { testTimeoutMs: ctx.testTimeoutMs, outputFile, coverageDir });
    const result = await runStreaming(process.execPath, args, { cwd: ctx.repoRoot, timeoutMs: ctx.suiteTimeoutMs });
    const cases = jestCasesFrom(outputFile, { root: ctx.repoRoot, scrub: ctx.scrub });
    const problem = exitProblem(result);
    if (problem !== null && !cases.some((c) => c.status === 'failed' || c.status === 'error'))
      cases.push({
        name: `${item.id}: jest process completed`,
        classname: item.id,
        status: 'error',
        message: `jest ${problem} without a failing test (coverage threshold, open handle or runtime error)`,
      });
    const extra = jestExtraArgs(item.runner, { testTimeoutMs: ctx.testTimeoutMs });
    // The US-006 gate is judged once, on the coverage merged across projects (mergedCoverageStep), not per suite.
    const coverageSource = item.runner.coverage ? coverageSourceFrom(item.runner.projects, coverageDir, outputFile) : null;
    return done(cases, { jestArgs: extra, coverageSource });
  }

  const runner = item.runner;
  const junitPath = join(ctx.work, `${item.id}.cmd.junit.xml`);
  const nativePath = join(ctx.work, runner.native_report ?? `${item.id}.native.json`);
  const [node, cli] = npmCommand();
  const [command, ...args] = expandCommand(runner.cmd, {
    node: process.execPath,
    npm: [node, cli],
    root: ctx.repoRoot,
    junit: junitPath,
    native: nativePath,
  });
  const result = await runStreaming(/** @type {string} */ (command), args, { cwd: ctx.repoRoot, timeoutMs: ctx.suiteTimeoutMs });
  /** @type {JUnitCase[]} */
  let cases;
  /** @type {{ name: string, text: string } | null} */
  let native = null;
  try {
    if (runner.converter === 'junit') {
      if (!existsSync(junitPath)) cases = malformed(item.id, 'the command wrote no JUnit report at {junit}');
      else
        cases = parseJUnit(readFileSync(junitPath, 'utf8')).cases.map((c) => ({
          name: scrubPaths(c.name, ctx.scrub),
          classname: scrubPaths(c.classname, ctx.scrub),
          time: c.time,
          status: c.status,
        }));
    } else if (!existsSync(nativePath))
      cases = malformed(runner.converter, `the command wrote no native report ${runner.native_report ?? ''}`);
    else {
      const report = readJson(nativePath);
      cases = convertNative(/** @type {keyof typeof CONVERTERS} */ (runner.converter), report, runner.options);
      if (runner.native_report !== null)
        native = {
          name: runner.native_report,
          text: `${scrubPaths(JSON.stringify(sanitizeNative(runner.converter, report), null, 1), ctx.scrub)}\n`,
        };
    }
  } catch (error) {
    cases = malformed(item.id, error instanceof Error ? error.message : String(error));
  }
  const problem = exitProblem(result);
  if (problem !== null && !cases.some((c) => c.status === 'failed' || c.status === 'error'))
    cases.push({
      name: `${item.id}: command completed`,
      classname: item.id,
      status: 'error',
      message: `command ${problem} without a failing case`,
    });
  return done(cases, { native });
}

/** @param {string} root */
function cleanDirty(root, /** @type {Manifest} */ manifest) {
  return porcelain(root)
    .map((e) => e.path)
    .filter((path) => isCleanTreePath(path, manifest));
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = gitRoot(process.cwd());
  const manifestPath = manifestFile(repoRoot);
  const manifest = loadManifest(manifestPath);
  const runnersPath = join(repoRoot, ...RUNNERS_PATH.split('/'));
  const runners = parseRunners(existsSync(runnersPath) ? readJson(runnersPath) : { version: 1, suites: {} });
  const startedAt = new Date();
  const stamp = utcStamp(startedAt);
  const sha = headSha(repoRoot);
  const before = porcelain(repoRoot);
  const dirtyStart = before.map((e) => e.path).filter((path) => isCleanTreePath(path, manifest));
  const env = envOverrides(process.env, manifest.rules.recorded_env_prefixes, manifest.rules.invalid_env_prefixes);
  const paths = args.profile === 'pr' ? changedPaths(repoRoot, args.base) : [];
  const plan = planRun({ manifest, runners, profile: args.profile, changedPaths: paths, restrict: args.suites });

  if (args.dryRun) {
    console.log(
      `quality:heavy --dry-run · sha ${sha.slice(0, 7)} · profile ${args.profile}${args.profile === 'pr' ? ` · base ${args.base} (${paths.length} changed path(s))` : ''}`,
    );
    console.log(
      `clean tree: ${dirtyStart.length === 0 ? 'yes' : `NO (${dirtyStart.length} path(s))`} · recorded env names: ${env.names.join(', ') || 'none'}${env.invalid.length > 0 ? ' · INVALID (SKIP_*)' : ''}`,
    );
    if (plan.rules.length > 0) console.log(`path rules: ${plan.rules.join(', ')}`);
    console.log(`required (active): ${plan.required.join(', ') || 'none'}`);
    console.log(`skipped by manifest (planned): ${plan.planned.join(', ') || 'none'}`);
    for (const item of plan.toRun) {
      if (item.runner === null) console.log(`  ${item.id}: NO RUNNER (would be reported as an error)`);
      else if (item.runner.kind === 'jest')
        console.log(
          `  ${item.id} -> ${item.root}/: node ${jestArgs(item.runner, { testTimeoutMs: args.testTimeoutMs, outputFile: '<tmp>', coverageDir: '<tmp>' }).join(' ')}`,
        );
      else console.log(`  ${item.id} -> ${item.root}/: ${item.runner.cmd.join(' ')} [${item.runner.converter}]`);
    }
    return 0;
  }

  const host = hostSpec(repoRoot);
  const lockfile = join(repoRoot, 'package-lock.json');
  /** @type {string[]} */
  const extraInvalid = [];
  if (!existsSync(lockfile)) extraInvalid.push('package-lock.json is missing (lockfile_sha256 is the hash of zero bytes)');
  const lockfileSha = existsSync(lockfile) ? sha256Bytes(readFileSync(lockfile)) : sha256Bytes('');
  const manifestSha = sha256Bytes(readFileSync(manifestPath));
  const images = imageDigests(runners.testcontainers_images, repoRoot);

  const [node, cli] = npmCommand();
  console.error(`quality:heavy: npm run build (timeout ${args.buildTimeoutMin} min)`);
  const build = await runStreaming(node, [cli, 'run', 'build'], { cwd: repoRoot, timeoutMs: args.buildTimeoutMin * 60_000 });
  const buildFailed = build.timedOut || build.status !== 0;
  const buildClean = buildCleanFrom(before, porcelain(repoRoot));

  const work = mkdtempSync(join(tmpdir(), 'quality-heavy-'));
  const scrub = hostScrubList({ repoRoot, homeDir: homedir(), tmpDir: tmpdir(), env: process.env, realpath: realpathSync.native });
  /** @type {RunResult[]} */
  const results = [];
  /** @type {string | null} */
  let coverageNote = null;
  try {
    for (const item of plan.toRun) {
      if (buildFailed) {
        /** @type {JUnitCase[]} */
        const cases = [
          {
            name: `${item.id}: not run`,
            classname: item.id,
            status: 'error',
            message: 'npm run build failed or timed out; suites were not run',
          },
        ];
        results.push({
          id: item.id,
          root: item.root,
          cases,
          durationS: 0,
          native: null,
          jestArgs: [],
          coverageRaw: null,
          coverageSource: null,
          ...junitFor(item.id, cases, 0),
        });
        continue;
      }
      console.error(`quality:heavy: suite ${item.id}`);
      results.push(
        await runSuite(item, { repoRoot, work, testTimeoutMs: args.testTimeoutMs, suiteTimeoutMs: args.suiteTimeoutMin * 60_000, scrub }),
      );
    }
    // US-006 merged gate (D-ORCH-047): once every suite ran, in the JUnit of merged_coverage.suite (unit: in every profile).
    const host = runners.mergedCoverage === null ? undefined : results.find((r) => r.id === runners.mergedCoverage?.suite);
    if (!buildFailed && host !== undefined && runners.mergedCoverage !== null) {
      console.error('quality:heavy: merged coverage');
      const mergeStarted = Date.now();
      const merged = await mergedCoverageStep({
        config: runners.mergedCoverage,
        results,
        repoRoot,
        work,
        testTimeoutMs: args.testTimeoutMs,
        suiteTimeoutMs: args.suiteTimeoutMin * 60_000,
        profile: args.profile,
        base: args.base,
      });
      const cases = [...host.cases, ...scrubCases(merged.cases, scrub)];
      const durationS = Math.round(host.durationS * 10 + (Date.now() - mergeStarted) / 100) / 10;
      Object.assign(host, { cases, durationS, coverageRaw: merged.summary, ...junitFor(host.id, cases, durationS) });
      coverageNote = mergedCoverageNote(merged.summary, merged.required, merged.cases);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const dirtyEnd = cleanDirty(repoRoot, manifest);
  const gitDirtyPaths = [...new Set([...dirtyStart, ...dirtyEnd])];
  const outBase = resolveOutBase(args, repoRoot);
  const dirName = `${stamp}_${sha.slice(0, 7)}`;
  const suiteIds = Object.keys(manifest.suites);
  /** @type {EvidenceRoot[]} */
  const roots = [...new Set(/** @type {EvidenceRoot[]} */ (['tests', ...results.map((r) => r.root)]))];

  // Per-root file sets, checked against the allow-list and the 5 MB cap BEFORE anything is written.
  /** @type {Map<EvidenceRoot, Map<string, string>>} */
  const files = new Map(roots.map((root) => [root, new Map()]));
  /** @type {Record<string, unknown> | undefined} */
  let coverage;
  for (const r of results) {
    const set = /** @type {Map<string, string>} */ (files.get(r.root));
    set.set(`${r.id}.junit.xml`, r.junit);
    if (r.native !== null) set.set(r.native.name, r.native.text);
    if (r.coverageRaw !== null) {
      const rel = relativiseCoverage(r.coverageRaw, repoRoot);
      if (rel !== null) {
        set.set('coverage-summary.json', `${JSON.stringify(rel.file, null, 1)}\n`);
        coverage = rel.coverage;
      }
    }
  }
  for (const [root, set] of files) {
    const bad = [...set.keys()].filter((name) => !isAllowedRunFile(name, root, suiteIds));
    if (bad.length > 0) throw new Error(`refusing to write files outside the ${root}/ allow-list: ${bad.join(', ')}`);
    const size = [...set.values()].reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
    if (size > MAX_RUN_DIR_BYTES - 256 * 1024) {
      extraInvalid.push(`${root}/ run directory would exceed the 5 MB cap (${size} bytes); native reports and attachments dropped`);
      for (const name of [...set.keys()]) if (!name.endsWith('.junit.xml')) set.delete(name);
      const junitSize = [...set.values()].reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
      if (junitSize > MAX_RUN_DIR_BYTES - 256 * 1024)
        throw new Error(`${root}/ JUnit reports alone exceed the 5 MB cap (${junitSize} bytes); nothing written`);
    }
  }

  const { verdict, invalidReasons, failReasons } = computeVerdict({
    manifest,
    required: plan.required,
    results,
    gitDirtyPaths,
    buildClean,
    buildFailed,
    invalidEnv: env.invalid,
    restricted: args.suites,
    extraInvalid,
  });
  const jestArgsRecorded = results.filter((r) => r.jestArgs.length > 0).map((r) => `${r.id}: ${r.jestArgs.join(' ')}`);
  const validate = summaryValidator();
  const siblingsOf = (/** @type {EvidenceRoot} */ root) =>
    roots.filter((r) => r !== root).map((r) => `${EVIDENCE_BASE}/${r}/runs/${dirName}/`);

  /** @type {Array<{ dir: string, summary: Record<string, unknown>, md: string, set: Map<string, string> }>} */
  const outputs = [];
  for (const root of roots) {
    const set = /** @type {Map<string, string>} */ (files.get(root));
    const mine = results.filter((r) => r.root === root);
    const summary = {
      schema_version: 1,
      lane: 'B',
      profile: args.profile,
      git_sha: sha,
      git_dirty: gitDirtyPaths.length > 0,
      build_clean: buildClean,
      stamp,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      host,
      lockfile_sha256: lockfileSha,
      manifest_sha256: manifestSha,
      testcontainers_images: images,
      env_overrides: env.names,
      suites: mine.map((r) => ({
        name: r.id,
        status: suiteStatus(r),
        tests: r.tests,
        failures: r.failures,
        errors: r.errors,
        skipped: r.skipped,
        duration_s: r.durationS,
        report: `${r.id}.junit.xml`,
        report_sha256: sha256Bytes(r.junit),
        ...(r.native !== null && set.has(r.native.name)
          ? { native_report: r.native.name, native_report_sha256: sha256Bytes(r.native.text) }
          : {}),
      })),
      attachments: [...set.entries()]
        .filter(([name]) => !name.endsWith('.junit.xml') && !mine.some((r) => r.native?.name === name))
        .map(([name, text]) => ({ file: name, sha256: sha256Bytes(text) })),
      ...(root === 'tests' && coverage !== undefined ? { coverage } : {}),
      ...(jestArgsRecorded.length > 0 ? { jest_args: jestArgsRecorded } : {}),
      verdict,
      invalid_reasons: invalidReasons.map((r) => r.slice(0, 300)),
    };
    if (!validate(summary))
      throw new Error(`summary.json for ${root}/ does not match summary.schema.json: ${JSON.stringify(validate.errors).slice(0, 1000)}`);
    const md = renderSummaryMd(summary, {
      planned: plan.planned,
      rules: plan.rules,
      failReasons,
      restricted: args.suites,
      siblings: siblingsOf(root),
      coverageNote: root === 'tests' ? coverageNote : null,
    });
    outputs.push({ dir: join(outBase, root, 'runs', dirName), summary, md, set });
  }

  for (const out of outputs)
    if (existsSync(out.dir)) throw new Error(`run directory already exists: ${out.dir} (one run per minute and sha)`);
  for (const out of outputs) {
    for (const [name, text] of out.set) {
      const target = join(out.dir, ...name.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    mkdirSync(out.dir, { recursive: true });
    writeFileSync(join(out.dir, 'summary.json'), `${JSON.stringify(out.summary, null, 2)}\n`);
    writeFileSync(join(out.dir, 'summary.md'), out.md);
    const total = [...out.set.keys(), 'summary.json', 'summary.md'].reduce(
      (sum, name) => sum + statSync(join(out.dir, ...name.split('/'))).size,
      0,
    );
    if (total > MAX_RUN_DIR_BYTES) throw new Error(`${out.dir} exceeds 5 MB after writing (${total} bytes)`);
  }
  const first = outputs[0];
  if (first !== undefined) {
    console.log(first.md.split('\n', 1)[0]);
    for (const out of outputs) console.log(`evidence: ${out.dir}`);
    if (args.suites !== null)
      console.log(
        'restricted run (--suites): INVALID by design, written outside the repository unless --out-root says otherwise; do not commit it',
      );
  }
  for (const reason of [...invalidReasons, ...failReasons]) console.log(`  - ${reason}`);
  return verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`quality:heavy: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
