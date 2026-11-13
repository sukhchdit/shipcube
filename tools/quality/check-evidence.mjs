// @ts-check
/**
 * Lane B evidence verifier `quality:check-evidence` (TASK-011; ADR-0023 amendments B, C, G and I item 4; TEST-STRATEGY
 * section 9.2 rules 1-6; D-QA-001, D-ARCH-010, D-ARCH-021; R-ARCH-16, R-ARCH-21; SEC-P3-07, SEC-P3-31; SEC-TC-48).
 *
 * Lane A runs the BASE-REF copy of this script and of the manifest next to it, so a pull request cannot weaken the
 * rules that judge it. The changed paths of `base...head` select the required lane B suites (lib/manifest.mjs
 * `selectSuites`, active suites only). Evidence is read from the git objects of `head` (never the working tree):
 * `docs/05-quality/{tests,security,performance}/runs/<stamp>_<sha7>/`. A run is accepted only when
 *
 * - every summary.json is schema-valid (summary.schema.json, Ajv draft 2020-12), its stamp and SHA match the directory;
 * - the directory holds only allow-listed names (section 9.1), is at most 5 MB, and every file other than
 *   summary.json/summary.md is a suite report or an attachment whose SHA-256 matches;
 * - every JUnit parses and its counts equal summary.json; the verdict recomputed from the JUnit equals the declared one;
 * - `git_dirty` is false, `build_clean` is true (R-ARCH-21), no `rules.invalid_env_prefixes` name (SKIP_*) is recorded;
 * - `git_sha` is an ancestor of `head` and every path changed between `git_sha` and `head` is staleness-allowed
 *   (`docs/**` minus the API contract minus `tooling_inputs`), so evidence older than an openapi.yaml change is stale;
 * - the run's profile is at least the requested one and every required suite is present with
 *   `tests >= max(min_tests, 1)`, `failures + errors = 0`, `skipped = 0` for zero-skip/security suites and every
 *   `required_cases` ID in a passing test case; no JUnit belongs to a `planned` suite; no SEC-TC test case is skipped or
 *   failed anywhere.
 *
 * Independently of the evidence, the checker FAILs on: an entry of `git status --porcelain --untracked-files=all` of the
 * checked-out root on a clean-tree path (SEC-TC-48 "untracked files in code paths"); at profile `gate`, any gate suite
 * not `active` and not deferred (rule 5); and a run directory changed by this range whose declared PASS is not
 * supported by its own reports or whose integrity fails (tampered evidence). When the required set is empty (docs-only
 * change, or every selected suite still `planned`) the result is PASS with a note listing the planned suites.
 *
 * CLI: node tools/quality/check-evidence.mjs --root <dir> --base <sha> --head <sha> [--profile pr|wave|gate]
 *      [--summary <file>] [--report-only] [--manifest <file>] [--json]
 * Exit 0 PASS (always 0 with --report-only), 1 FAIL, 2 usage or internal error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseJUnit, sha256Bytes } from './lib/junit.mjs';
import {
  gateBlockers,
  isCleanTreePath,
  isProfile,
  loadManifest,
  profileSatisfies,
  selectSuites,
  stalenessAllowed,
} from './lib/manifest.mjs';

/** @typedef {import('./lib/manifest.mjs').Manifest} Manifest */
/** @typedef {import('./lib/manifest.mjs').Profile} Profile */
/** @typedef {import('./lib/junit.mjs').JUnitReport} JUnitReport */

export const EVIDENCE_AREAS = /** @type {const} */ (['tests', 'security', 'performance']);
export const MAX_RUN_DIR_BYTES = 5 * 1024 * 1024;
/** Most run groups evaluated per invocation (newest first; groups changed by the range are always evaluated). */
const MAX_RUN_GROUPS = 30;
const RUN_ID = /^([0-9]{8}T[0-9]{4}Z)_([0-9a-f]{7})$/;
const SHA = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 60_000;
const SEC_TC = /SEC-TC-[0-9]+/;

/** Fixed file names of a run directory (TEST-STRATEGY section 9.1, ADR-0023 amendment B), across the three areas. */
export const FIXED_RUN_FILES = new Set([
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
  'zap-baseline.json',
  'trivy-config.json',
  'gitleaks-full.json',
  'osv.json',
  'npm-audit.json',
  'semgrep.json',
  'host-spec.json',
  'stryker-summary.json',
]);

/**
 * File-name allow-list of a run directory: the fixed names, `<suite>.junit.xml` for a manifest suite,
 * `trivy-<image>.json`, `k6-<scenario>.summary.json` and `lighthouse/<route>-<locale>.json`.
 * @param {string} relPath path relative to the run directory
 * @param {Manifest} manifest
 */
export function allowedRunFile(relPath, manifest) {
  if (FIXED_RUN_FILES.has(relPath)) return true;
  const junit = /^([a-z0-9][a-z0-9-]*)\.junit\.xml$/.exec(relPath);
  if (junit !== null) return Object.hasOwn(manifest.suites, /** @type {string} */ (junit[1]));
  return (
    /^trivy-[a-z0-9][a-z0-9.-]{0,80}\.json$/.test(relPath) ||
    /^k6-[a-z0-9][a-z0-9-]{0,60}\.summary\.json$/.test(relPath) ||
    /^lighthouse\/[a-z0-9][a-z0-9-]{0,80}-[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(relPath)
  );
}

export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ allowExit?: number[] }} [options]
 * @returns {{ status: number, stdout: Buffer }}
 */
function gitRaw(root, args, options = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const status = result.status ?? -1;
  if (status !== 0 && !(options.allowExit ?? []).includes(status))
    throw new Error(
      `git ${args.slice(0, 3).join(' ')} failed (exit ${String(status)}): ${result.stderr.toString('utf8').trim().slice(0, 300)}`,
    );
  return { status, stdout: result.stdout };
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function gitText(root, args) {
  return gitRaw(root, args).stdout.toString('utf8');
}

/** @param {string} text NUL-separated list */
function splitZ(text) {
  return text.split('\0').filter((item) => item !== '');
}

/**
 * Resolves a revision to a full commit SHA.
 * @param {string} root
 * @param {string} rev
 */
export function resolveCommit(root, rev) {
  if (!/^[A-Za-z0-9._/^~-]{1,200}$/.test(rev) || rev.startsWith('-')) throw new UsageError(`not a revision: ${JSON.stringify(rev)}`);
  const result = gitRaw(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], { allowExit: [1] });
  const sha = result.stdout.toString('utf8').trim();
  if (result.status !== 0 || !SHA.test(sha)) throw new UsageError(`${rev} is not a commit of ${root}`);
  return sha;
}

/**
 * Paths changed between two commits (both sides of renames). `mergeBase` uses `a...b`.
 * @param {string} root
 * @param {string} from
 * @param {string} to
 * @param {boolean} mergeBase
 */
export function changedPaths(root, from, to, mergeBase) {
  const range = mergeBase ? [`${from}...${to}`] : [from, to];
  return splitZ(gitText(root, ['diff', '--name-only', '-z', '--no-renames', ...range, '--'])).sort();
}

/**
 * Entries of `git status --porcelain --untracked-files=all` on clean-tree paths of the checked-out root.
 * @param {string} root
 * @param {Manifest} manifest
 */
export function dirtyCleanTreePaths(root, manifest) {
  const entries = splitZ(gitText(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  /** @type {string[]} */
  const dirty = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = /** @type {string} */ (entries[i]);
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status.includes('R') || status.includes('C')) i += 1;
    if (isCleanTreePath(path, manifest)) dirty.push(`${status.trim() || status} ${path}`);
  }
  return dirty;
}

/**
 * @typedef {{ relPath: string, oid: string, size: number }} TreeFile
 * @typedef {{ area: string, dir: string, files: TreeFile[] }} RunDir
 */

/**
 * Lists the evidence run directories of a commit, grouped by run ID. Paths under a runs/ folder that do not follow
 * `<stamp>_<sha7>/<file>` are returned as strays.
 * @param {string} root
 * @param {string} commit
 * @returns {{ groups: Map<string, RunDir[]>, strays: string[] }}
 */
export function listRuns(root, commit) {
  const roots = EVIDENCE_AREAS.map((area) => `docs/05-quality/${area}/runs`);
  const out = gitText(root, ['ls-tree', '-r', '-z', '--long', '--full-tree', commit, '--', ...roots]);
  /** @type {Map<string, RunDir[]>} */
  const groups = new Map();
  /** @type {string[]} */
  const strays = [];
  for (const line of splitZ(out)) {
    const tab = line.indexOf('\t');
    const [mode, type, oid, size] = line.slice(0, tab).split(/ +/);
    const path = line.slice(tab + 1);
    const match = /^docs\/05-quality\/(tests|security|performance)\/runs\/([^/]+)\/(.+)$/.exec(path);
    if (match === null || type !== 'blob' || mode === '120000' || !RUN_ID.test(/** @type {string} */ (match[2]))) {
      strays.push(path);
      continue;
    }
    const [, area, id, relPath] = /** @type {[string, string, string, string]} */ (/** @type {unknown} */ (match));
    const dirs = groups.get(id) ?? [];
    let dir = dirs.find((d) => d.area === area);
    if (dir === undefined) {
      dir = { area, dir: `docs/05-quality/${area}/runs/${id}`, files: [] };
      dirs.push(dir);
      groups.set(id, dirs);
    }
    dir.files.push({ relPath, oid: /** @type {string} */ (oid), size: Number(size) });
  }
  return { groups, strays };
}

/**
 * Run ID of an evidence path, or undefined.
 * @param {string} path
 */
function runIdOf(path) {
  const match = /^docs\/05-quality\/(?:tests|security|performance)\/runs\/([^/]+)\//.exec(path);
  return match === null ? undefined : match[1];
}

/**
 * True when `id` occurs in `name` not followed by another digit (SEC-TC-1 does not match SEC-TC-14).
 * @param {string} name
 * @param {string} id
 */
export function nameHasId(name, id) {
  let from = 0;
  for (;;) {
    const at = name.indexOf(id, from);
    if (at === -1) return false;
    const next = name[at + id.length];
    if (next === undefined || next < '0' || next > '9') return true;
    from = at + 1;
  }
}

/**
 * @typedef {{ name: string, status: string, tests: number, failures: number, errors: number, skipped: number,
 *   report: string, report_sha256: string, native_report?: string, native_report_sha256?: string }} SummarySuite
 * @typedef {{ profile: Profile, git_sha: string, git_dirty: boolean, build_clean: boolean, stamp: string,
 *   generated_at: string, env_overrides: string[], suites: SummarySuite[], attachments: { file: string, sha256: string }[],
 *   verdict: 'PASS' | 'FAIL' | 'INVALID', invalid_reasons: string[] }} Summary
 * @typedef {{ suite: SummarySuite, junit: JUnitReport, area: string }} SuiteResult
 * @typedef {{ id: string, dirs: string[], touched: boolean, profile?: string, gitSha?: string, declared: string[],
 *   recomputed: string[], accepted: boolean, tampered: boolean, reasons: string[] }} RunResult
 */

/**
 * The verdict recomputed from a summary's own reports (independent of the change being checked).
 * @param {Summary} summary
 * @param {SuiteResult[]} results
 * @param {Manifest} manifest
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'INVALID', hard: string[], soft: string[] }}
 *   `hard` reasons contradict a declared PASS on the run's own facts (tampering); `soft` ones depend on the manifest.
 */
export function recomputeVerdict(summary, results, manifest) {
  /** @type {string[]} */
  const invalid = [];
  if (summary.git_dirty) invalid.push('git_dirty is true (R-ARCH-16)');
  if (!summary.build_clean) invalid.push('build_clean is not true (R-ARCH-21)');
  const badEnv = summary.env_overrides.filter((name) => manifest.rules.invalid_env_prefixes.some((prefix) => name.startsWith(prefix)));
  if (badEnv.length > 0) invalid.push(`invalid environment override(s) recorded: ${badEnv.join(', ')}`);
  if (summary.invalid_reasons.length > 0) invalid.push(`invalid_reasons recorded: ${summary.invalid_reasons.length}`);
  if (invalid.length > 0) return { verdict: 'INVALID', hard: invalid, soft: [] };
  /** @type {string[]} */
  const hard = [];
  /** @type {string[]} */
  const soft = [];
  for (const { suite, junit } of results) {
    const spec = manifest.suites[suite.name];
    if (junit.failures + junit.errors > 0) hard.push(`${suite.name}: ${junit.failures} failure(s), ${junit.errors} error(s)`);
    if (suite.status !== 'passed') hard.push(`${suite.name}: status ${suite.status}`);
    const secCases = junit.cases.filter((c) => c.status !== 'passed' && SEC_TC.test(c.name));
    if (secCases.length > 0)
      hard.push(
        `${suite.name}: SEC-TC test case(s) ${secCases.map((c) => c.status).join('/')}: ${secCases
          .slice(0, 3)
          .map((c) => c.name)
          .join(' | ')}`,
      );
    if (spec === undefined) continue;
    if ((spec.security || spec.zero_skip) && junit.skipped > 0) hard.push(`${suite.name}: zero-skip suite skipped ${junit.skipped}`);
    if (spec.status === 'planned') soft.push(`${suite.name}: JUnit for a suite still 'planned' in the manifest (rule 4)`);
    if (junit.tests < Math.max(spec.min_tests, 1)) soft.push(`${suite.name}: tests ${junit.tests} < max(min_tests ${spec.min_tests}, 1)`);
    for (const id of spec.required_cases)
      if (!junit.cases.some((c) => c.status === 'passed' && nameHasId(c.name, id)))
        soft.push(`${suite.name}: required case ${id} not in a passing test case`);
  }
  return { verdict: hard.length + soft.length > 0 ? 'FAIL' : 'PASS', hard, soft };
}

/**
 * @param {string} root the repository to read objects from
 * @returns {Promise<(data: unknown) => string[]>} a summary.json validator returning error strings
 */
async function loadSchemaValidator(root) {
  const schemaFile = fileURLToPath(new URL('./summary.schema.json', import.meta.url));
  /** @type {unknown} */
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
  /** @type {{ default?: unknown }} */
  let mod;
  try {
    // The base-ref copy of this script lives outside the workspace: resolve Ajv from the checked-out repository.
    const resolved = createRequire(join(root, 'package.json')).resolve('ajv/dist/2020.js');
    mod = /** @type {{ default?: unknown }} */ (await import(pathToFileURL(resolved).href));
  } catch {
    mod = /** @type {{ default?: unknown }} */ (await import('ajv/dist/2020.js'));
  }
  const exported = /** @type {{ default?: unknown }} */ (mod.default);
  const Ajv2020 =
    /** @type {new (options: Record<string, unknown>) => { compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: { instancePath: string, message?: string }[] | null } }} */ (
      exported.default ?? exported
    );
  const validate = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false }).compile(schema);
  return (data) => {
    if (validate(data)) {
      const generatedAt = /** @type {{ generated_at: string }} */ (data).generated_at;
      return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(generatedAt) &&
        !Number.isNaN(Date.parse(generatedAt))
        ? []
        : ['/generated_at is not an RFC 3339 date-time'];
    }
    return (validate.errors ?? []).slice(0, 10).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
  };
}

/** @param {string} relPath */
function safeRelPath(relPath) {
  return !relPath.startsWith('/') && !relPath.split('/').some((segment) => segment === '..' || segment === '.' || segment === '');
}

/**
 * Evaluates one run group (the directories of one `<stamp>_<sha7>` across the evidence areas).
 * @param {{ root: string, head: string, id: string, dirs: RunDir[], touched: boolean, manifest: Manifest,
 *   validate: (data: unknown) => string[], profile: Profile, required: string[] }} input
 * @returns {RunResult}
 */
export function evaluateRun({ root, head, id, dirs, touched, manifest, validate, profile, required }) {
  /** @type {RunResult} */
  const run = { id, dirs: dirs.map((d) => d.dir), touched, declared: [], recomputed: [], accepted: false, tampered: false, reasons: [] };
  const integrity = (/** @type {string} */ reason) => {
    run.tampered = true;
    run.reasons.push(reason);
  };
  const idMatch = /** @type {RegExpExecArray} */ (RUN_ID.exec(id));
  /** @type {Summary[]} */
  const summaries = [];
  /** @type {SuiteResult[]} */
  const results = [];
  for (const dir of dirs) {
    const total = dir.files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_RUN_DIR_BYTES) integrity(`${dir.dir}: ${total} bytes exceeds the 5 MB cap`);
    for (const file of dir.files)
      if (!allowedRunFile(file.relPath, manifest)) integrity(`${dir.dir}: file name not on the allow-list: ${file.relPath}`);
    const byPath = new Map(dir.files.map((f) => [f.relPath, f]));
    const summaryFile = byPath.get('summary.json');
    if (summaryFile === undefined) {
      integrity(`${dir.dir}: no summary.json`);
      continue;
    }
    if (total > MAX_RUN_DIR_BYTES) continue;
    const blob = (/** @type {TreeFile} */ f) => gitRaw(root, ['cat-file', 'blob', f.oid]).stdout;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(blob(summaryFile).toString('utf8'));
    } catch (error) {
      integrity(`${dir.dir}/summary.json is not JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const schemaErrors = validate(parsed);
    if (schemaErrors.length > 0) {
      integrity(`${dir.dir}/summary.json fails the schema: ${schemaErrors.join('; ')}`);
      continue;
    }
    const summary = /** @type {Summary} */ (parsed);
    summaries.push(summary);
    if (summary.stamp !== idMatch[1] || !summary.git_sha.startsWith(/** @type {string} */ (idMatch[2])))
      integrity(`${dir.dir}: stamp/git_sha (${summary.stamp}_${summary.git_sha.slice(0, 7)}) do not match the directory name`);
    /** @type {Map<string, string>} */
    const referenced = new Map();
    const reference = (/** @type {string} */ relPath, /** @type {string} */ sha) => {
      if (!safeRelPath(relPath)) return integrity(`${dir.dir}: unsafe reference ${relPath}`);
      if (referenced.has(relPath) || relPath === 'summary.json' || relPath === 'summary.md')
        return integrity(`${dir.dir}: ${relPath} referenced twice or reserved`);
      referenced.set(relPath, sha);
      const file = byPath.get(relPath);
      if (file === undefined) return integrity(`${dir.dir}: referenced file missing: ${relPath}`);
      const actual = sha256Bytes(blob(file));
      if (actual !== sha) integrity(`${dir.dir}: SHA-256 mismatch for ${relPath} (R-ARCH-16)`);
    };
    for (const suite of summary.suites) {
      if (suite.report !== `${suite.name}.junit.xml`) integrity(`${dir.dir}: suite ${suite.name} report must be ${suite.name}.junit.xml`);
      if (!Object.hasOwn(manifest.suites, suite.name)) integrity(`${dir.dir}: suite ${suite.name} is not in the manifest`);
      reference(suite.report, suite.report_sha256);
      if (suite.native_report !== undefined) reference(suite.native_report, suite.native_report_sha256 ?? '');
    }
    for (const attachment of summary.attachments) reference(attachment.file, attachment.sha256);
    for (const file of dir.files)
      if (file.relPath !== 'summary.json' && file.relPath !== 'summary.md' && !referenced.has(file.relPath))
        integrity(`${dir.dir}: unlisted file ${file.relPath} (every file needs a SHA-256 in summary.json)`);
    for (const suite of summary.suites) {
      const file = byPath.get(suite.report);
      if (file === undefined) continue;
      /** @type {JUnitReport} */
      let junit;
      try {
        junit = parseJUnit(blob(file).toString('utf8'));
      } catch (error) {
        integrity(`${dir.dir}/${suite.report}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const key of /** @type {const} */ (['tests', 'failures', 'errors', 'skipped']))
        if (junit[key] !== suite[key])
          integrity(`${dir.dir}: ${suite.name} ${key} ${suite[key]} in summary.json but ${junit[key]} in the JUnit`);
      results.push({ suite, junit, area: dir.area });
    }
    const own = results.filter((r) => r.area === dir.area);
    const { verdict, hard, soft } = recomputeVerdict(summary, own, manifest);
    run.declared.push(summary.verdict);
    run.recomputed.push(verdict);
    // A declared PASS that the run's own facts contradict is tampering; a manifest-dependent difference only rejects.
    if (summary.verdict === 'PASS' && hard.length > 0) integrity(`${dir.dir}: declared PASS but the reports say ${verdict}`);
    else if (summary.verdict !== verdict) run.reasons.push(`${dir.dir}: declared ${summary.verdict}, recomputed ${verdict}`);
    for (const reason of [...hard, ...soft]) run.reasons.push(`${dir.dir}: ${reason}`);
  }
  if (summaries.length === 0) return run;
  const first = /** @type {Summary} */ (summaries[0]);
  run.profile = first.profile;
  run.gitSha = first.git_sha;
  for (const other of summaries.slice(1))
    if (other.git_sha !== first.git_sha || other.profile !== first.profile || other.stamp !== first.stamp)
      integrity(`run ${id}: summary.json files disagree on git_sha/profile/stamp`);
  const names = results.map((r) => r.suite.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) integrity(`run ${id}: suite(s) reported twice: ${[...new Set(duplicates)].join(', ')}`);

  // Ancestry and staleness (ADR-0023 amendments B and G item 4).
  const ancestor =
    gitRaw(root, ['cat-file', '-e', `${first.git_sha}^{commit}`], { allowExit: [1, 128] }).status === 0
      ? gitRaw(root, ['merge-base', '--is-ancestor', first.git_sha, head], { allowExit: [1] }).status === 0
      : false;
  if (!ancestor) run.reasons.push(`git_sha ${first.git_sha.slice(0, 7)} is not an ancestor of the head (R-ARCH-16)`);
  else {
    const stale = changedPaths(root, first.git_sha, head, false).filter((path) => !stalenessAllowed(path, manifest));
    if (stale.length > 0)
      run.reasons.push(
        `stale: ${stale.length} path(s) outside the staleness allow-list changed since ${first.git_sha.slice(0, 7)}: ${stale.slice(0, 5).join(', ')}`,
      );
  }
  if (!profileSatisfies(first.profile, profile)) run.reasons.push(`profile ${first.profile} does not satisfy the requested ${profile}`);
  for (const name of required) {
    const result = results.find((r) => r.suite.name === name);
    const spec = /** @type {import('./lib/manifest.mjs').Suite} */ (manifest.suites[name]);
    if (result === undefined) {
      run.reasons.push(`required suite ${name}${spec.security ? ' (security)' : ''} missing`);
      continue;
    }
    const { junit } = result;
    if (junit.tests < Math.max(spec.min_tests, 1))
      run.reasons.push(`required suite ${name}: tests ${junit.tests} < ${Math.max(spec.min_tests, 1)}`);
    if (junit.failures + junit.errors > 0) run.reasons.push(`required suite ${name}: failures + errors = ${junit.failures + junit.errors}`);
    if ((spec.security || spec.zero_skip) && junit.skipped > 0)
      run.reasons.push(`required suite ${name}: skipped ${junit.skipped} in a zero-skip suite`);
  }
  run.reasons = [...new Set(run.reasons)];
  run.accepted = run.reasons.length === 0 && run.recomputed.every((v) => v === 'PASS');
  return run;
}

/**
 * @typedef {{ verdict: 'PASS' | 'FAIL', profile: Profile, base: string, head: string, changed: number,
 *   required: string[], planned: string[], rules: string[], problems: string[], notes: string[], runs: RunResult[],
 *   accepted?: string }} CheckResult
 */

/**
 * @param {{ root: string, base: string, head: string, profile: Profile, manifest: Manifest }} input
 * @returns {Promise<CheckResult>}
 */
export async function checkEvidence({ root, base, head, profile, manifest }) {
  const baseSha = resolveCommit(root, base);
  const headSha = resolveCommit(root, head);
  const changed = changedPaths(root, baseSha, headSha, true);
  const selection = selectSuites(manifest, { profile, changedPaths: changed });
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  for (const entry of dirtyCleanTreePaths(root, manifest))
    problems.push(`untracked or modified file on a clean-tree path in the checkout: ${entry} (SEC-TC-48)`);
  if (profile === 'gate') {
    const blockers = gateBlockers(manifest);
    if (blockers.length > 0) problems.push(`gate profile: suite(s) not active and not deferred: ${blockers.join(', ')} (rule 5)`);
  }
  const touchedIds = new Set(changed.map(runIdOf).filter((id) => id !== undefined));
  const { groups, strays } = listRuns(root, headSha);
  for (const stray of strays)
    if (changed.includes(stray)) problems.push(`evidence path outside <stamp>_<sha7>/<file>: ${stray}`);
    else notes.push(`ignored stray evidence path: ${stray}`);
  const ids = [...groups.keys()].sort().reverse();
  const evaluated = [...new Set([...ids.filter((id) => touchedIds.has(id)), ...ids.slice(0, MAX_RUN_GROUPS)])];
  const validate = evaluated.length > 0 ? await loadSchemaValidator(root) : () => [];
  const runs = evaluated.map((id) =>
    evaluateRun({
      root,
      head: headSha,
      id,
      dirs: /** @type {RunDir[]} */ (groups.get(id)),
      touched: touchedIds.has(id),
      manifest,
      validate,
      profile,
      required: selection.required,
    }),
  );
  for (const run of runs)
    if (run.touched && run.tampered) problems.push(`run ${run.id} added or changed by this range fails integrity (see its reasons)`);
  const accepted = runs.find((run) => run.accepted);
  if (selection.required.length === 0)
    notes.push(
      `no active lane B suite is required for this change${selection.planned.length > 0 ? `; selected suites still planned: ${selection.planned.join(', ')}` : ' (lane-A-only paths)'}`,
    );
  else if (accepted === undefined) problems.push(`no accepted lane B evidence for required suite(s): ${selection.required.join(', ')}`);
  else if (selection.planned.length > 0) notes.push(`selected suites still planned (not required): ${selection.planned.join(', ')}`);
  return {
    verdict: problems.length === 0 ? 'PASS' : 'FAIL',
    profile,
    base: baseSha,
    head: headSha,
    changed: changed.length,
    required: selection.required,
    planned: selection.planned,
    rules: selection.rules,
    problems,
    notes,
    runs,
    ...(accepted === undefined ? {} : { accepted: accepted.id }),
  };
}

/** @param {string} text */
function cell(text) {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', "'");
}

/**
 * @param {CheckResult} result
 * @param {boolean} reportOnly
 */
export function renderMarkdown(result, reportOnly) {
  const lines = [
    `### Lane B evidence (quality:check-evidence): ${result.verdict}${reportOnly ? ' (report-only)' : ''}`,
    '',
    `Profile \`${result.profile}\`, range \`${result.base.slice(0, 7)}...${result.head.slice(0, 7)}\` (${result.changed} changed path(s)), rules fired: ${result.rules.length > 0 ? result.rules.join(', ') : 'none'}.`,
    '',
    `- Required (active): ${result.required.length > 0 ? result.required.join(', ') : 'none'}`,
    `- Selected but planned: ${result.planned.length > 0 ? result.planned.join(', ') : 'none'}`,
    ...(result.accepted === undefined ? [] : [`- Accepted run: \`${result.accepted}\``]),
    ...result.problems.map((p) => `- **FAIL:** ${cell(p)}`),
    ...result.notes.map((n) => `- Note: ${cell(n)}`),
  ];
  if (result.runs.length > 0) {
    lines.push(
      '',
      '| Run | Changed here | Profile | SHA | Declared | Recomputed | Accepted | Reasons |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const run of result.runs)
      lines.push(
        `| \`${run.id}\` | ${run.touched ? 'yes' : 'no'} | ${run.profile ?? '?'} | ${run.gitSha?.slice(0, 7) ?? '?'} | ${run.declared.join('/') || '?'} | ${run.recomputed.join('/') || '?'} | ${run.accepted ? 'yes' : 'no'} | ${cell(run.reasons.slice(0, 8).join('; ')) || '-'} |`,
      );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ root: string, base?: string, head?: string, profile: Profile, summary?: string, reportOnly: boolean, manifest?: string, json: boolean }} */
  const options = { root: process.cwd(), profile: 'pr', reportOnly: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = /** @type {string} */ (argv[i]);
    if (arg === '--report-only') options.reportOnly = true;
    else if (arg === '--json') options.json = true;
    else if (['--root', '--base', '--head', '--profile', '--summary', '--manifest'].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i += 1;
      if (arg === '--root') options.root = resolve(value);
      else if (arg === '--base') options.base = value;
      else if (arg === '--head') options.head = value;
      else if (arg === '--summary') options.summary = value;
      else if (arg === '--manifest') options.manifest = resolve(value);
      else if (isProfile(value)) options.profile = value;
      else throw new UsageError(`--profile must be pr, wave or gate (got ${value})`);
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  if (options.base === undefined || options.head === undefined) throw new UsageError('--base and --head are required');
  return /** @type {typeof options & { base: string, head: string }} */ (options);
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-evidence: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  /** @type {CheckResult} */
  let result;
  try {
    // The manifest next to this script is the base-ref copy in CI (SEC-P3-31); --manifest exists for fixtures.
    const manifest = loadManifest(options.manifest ?? fileURLToPath(new URL('./required-suites.json', import.meta.url)));
    result = await checkEvidence({ root: options.root, base: options.base, head: options.head, profile: options.profile, manifest });
  } catch (error) {
    const message = `check-evidence: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    if (options.summary !== undefined)
      appendFileSync(options.summary, `\n### Lane B evidence (quality:check-evidence): ERROR\n\n${cell(message)}\n`);
    return options.reportOnly && !(error instanceof UsageError) ? 0 : 2;
  }
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const problem of result.problems) console.log(`check-evidence: FAIL: ${problem}`);
    for (const note of result.notes) console.log(`check-evidence: note: ${note}`);
    for (const run of result.runs)
      console.log(
        `check-evidence: run ${run.id} ${run.accepted ? 'accepted' : 'rejected'}${run.reasons.length > 0 ? `: ${run.reasons.join('; ')}` : ''}`,
      );
    console.log(`check-evidence: ${result.verdict}${options.reportOnly ? ' (report-only)' : ''}`);
  }
  if (options.summary !== undefined) appendFileSync(options.summary, `\n${renderMarkdown(result, options.reportOnly)}`);
  if (options.reportOnly) return 0;
  return result.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`check-evidence: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
