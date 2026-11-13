// @ts-check
/**
 * Coverage gate (US-006, REQ-PLAT-008; COVERAGE_TARGET in CLAUDE.md §3; TEST-STRATEGY §8; TASK-015). Reads Jest's
 * `coverage-summary.json` (the `json-summary` reporter) and checks:
 *   overall                   85 % lines / 75 % branches (the whole measured repository, `total`)
 *   packages/pricing|audit|authz  95 % lines AND 95 % branches each (required: the packages must exist)
 *   D-QA-003 money paths      95 % / 95 % (TEST-STRATEGY §8, PR #33 R1-M3): `apps/api/src/modules/payments/service`,
 *                             `packages/shared/src/money` (M1 money movement) and `apps/api/src/modules/ledger` (M4,
 *                             ADR-0003: a module, not a package). Inactive until the path holds measured source, then
 *                             gated (fail closed: measurable source without a summary entry is an error)
 *   packages/ledger           95 % / 95 %, inactive while absent: the literal path of AT-US-006-03 (EPIC-01), kept so a
 *                             package of that name could never escape the gate (D-TASK015-14)
 * Inactive scopes are logged instead of failing (AT-US-006-03).
 * Percentages are computed from covered/total (not Jest's rounded `pct`), so 84.9 % fails an 85 % threshold.
 *
 * Fail-closed rules: a summary without `total`, or with zero measured lines, is a failure; a REQUIRED critical package
 * that does not exist is a failure; a critical package whose source roots hold measurable files but whose coverage
 * entry is empty is a failure (a broken collectCoverageFrom glob cannot pass vacuously). A critical package that exists
 * but has no measurable source yet (only its re-exporting `src/index.ts`, which jest.config.ts excludes) is reported as
 * inactive and passes; it becomes active with its first measured file.
 *
 * Why not Jest `coverageThreshold` path keys (D-TASK015-10): Jest errors on a path key that matches no files (pricing and
 * audit hold no measured file yet) and subtracts path-matched files from `global`, which would change what "overall"
 * means. jest.config.ts keeps the global 85/75 threshold as a second, independent tripwire.
 *
 * CLI: node tools/ci/coverage-gate.mjs [--summary <file>] [--root <dir>] [--json]
 *   --summary defaults to <root>/coverage/coverage-summary.json (npm run test:coverage).
 * Exit 0 pass, 1 below threshold (each failing scope named), 2 usage error or unreadable/malformed summary.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ scope: string, lines: number, branches: number, required: boolean, roots: readonly string[], note?: string }} CriticalScope
 * @typedef {{ lines: number, branches: number }} Threshold
 */

/** Source roots jest.config.ts `collectCoverageFrom` measures inside a workspace package. */
const PACKAGE_ROOTS = Object.freeze(['src', 'app']);
/** A scope inside a source root (a module folder): the scope itself is the source root. */
const SCOPE_ROOT = Object.freeze(['.']);

/** The single source of every coverage threshold (overall and per critical scope), shared with diff-coverage.mjs. */
export const COVERAGE_THRESHOLDS = Object.freeze({
  overall: Object.freeze({ lines: 85, branches: 75 }),
  critical: Object.freeze(
    /** @type {readonly CriticalScope[]} */ ([
      Object.freeze({ scope: 'packages/pricing', lines: 95, branches: 95, required: true, roots: PACKAGE_ROOTS }),
      Object.freeze({ scope: 'packages/audit', lines: 95, branches: 95, required: true, roots: PACKAGE_ROOTS }),
      Object.freeze({ scope: 'packages/authz', lines: 95, branches: 95, required: true, roots: PACKAGE_ROOTS }),
      Object.freeze({
        scope: 'apps/api/src/modules/payments/service',
        lines: 95,
        branches: 95,
        required: false,
        roots: SCOPE_ROOT,
        note: 'D-QA-003 money-path gate is inactive until payments service code lands (M1)',
      }),
      Object.freeze({
        scope: 'packages/shared/src/money',
        lines: 95,
        branches: 95,
        required: false,
        roots: SCOPE_ROOT,
        note: 'D-QA-003 money-path gate is inactive until shared money code lands (M1)',
      }),
      Object.freeze({
        scope: 'apps/api/src/modules/ledger',
        lines: 95,
        branches: 95,
        required: false,
        roots: SCOPE_ROOT,
        note: 'ledger gate is inactive until the ledger module lands (M4, ADR-0003)',
      }),
      Object.freeze({
        scope: 'packages/ledger',
        lines: 95,
        branches: 95,
        required: false,
        roots: PACKAGE_ROOTS,
        note: 'ledger gate is inactive until M4',
      }),
    ]),
  ),
});
/** Bound on the directory walk of one package (files + directories visited). */
const MAX_WALK_ENTRIES = 20_000;

/**
 * @typedef {{ covered: number, total: number }} Counter
 * @typedef {{ scope: string, metric: 'lines' | 'branches', actual: number, threshold: number, ok: boolean }} Check
 * @typedef {{ checks: Check[], inactive: string[], errors: string[] }} GateResult
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} entry a summary entry
 * @param {'lines' | 'branches'} key
 * @returns {Counter | null}
 */
function counter(entry, key) {
  const metric = isRecord(entry) ? entry[key] : undefined;
  if (!isRecord(metric)) return null;
  const covered = metric['covered'];
  const total = metric['total'];
  if (typeof covered !== 'number' || typeof total !== 'number' || !Number.isFinite(covered) || !Number.isFinite(total)) return null;
  if (covered < 0 || total < 0 || covered > total) return null;
  return { covered, total };
}

/** Percentage with Jest's convention that an empty metric is fully covered. @param {Counter} c */
export function percent(c) {
  return c.total === 0 ? 100 : (c.covered * 100) / c.total;
}

/**
 * Repository-relative POSIX path of a summary key (Jest writes absolute host paths; quality:heavy writes relative ones).
 * @param {string} key
 * @param {string} root
 * @returns {string}
 */
export function relativeKey(key, root) {
  const normalized = key.replaceAll('\\', '/');
  const prefix = `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/`;
  return normalized.toLowerCase().startsWith(prefix.toLowerCase()) ? normalized.slice(prefix.length) : normalized;
}

/**
 * Whether a scope holds a file jest.config.ts would measure: `.ts`/`.tsx` under one of its source roots (`src/` or
 * `app/` of a package; the scope folder itself for a module path), not a test, not a declaration, not under tests/ or
 * fixtures/, and not a package's re-exporting `src/index.ts`.
 * @param {string} root repository root
 * @param {string} scope e.g. `packages/pricing`, `apps/api/src/modules/payments/service`
 * @param {readonly string[]} [roots] the scope's source roots (default: the scope's own, else a package's src/app)
 * @returns {boolean}
 */
export function hasMeasurableSource(
  root,
  scope,
  roots = COVERAGE_THRESHOLDS.critical.find((c) => c.scope === scope)?.roots ?? PACKAGE_ROOTS,
) {
  let budget = MAX_WALK_ENTRIES;
  /** @param {string} dir @param {string} rel @returns {boolean} */
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      budget -= 1;
      if (budget < 0) throw new Error(`${scope}: more than ${MAX_WALK_ENTRIES} entries under its source roots`);
      const full = join(dir, name);
      const relPath = `${rel}/${name}`;
      if (statSync(full).isDirectory()) {
        if (name === 'tests' || name === 'fixtures' || name === 'node_modules') continue;
        if (walk(full, relPath)) return true;
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') && relPath !== 'src/index.ts') return true;
    }
    return false;
  };
  return roots.some((sub) => {
    const dir = join(root, ...scope.split('/'), sub);
    return existsSync(dir) && statSync(dir).isDirectory() && walk(dir, sub);
  });
}

/**
 * @param {string} scope
 * @param {Threshold} threshold
 * @param {{ lines: Counter, branches: Counter }} counters
 * @returns {Check[]}
 */
function checksFor(scope, threshold, counters) {
  return /** @type {const} */ (['lines', 'branches']).map((metric) => {
    const actual = percent(counters[metric]);
    return { scope, metric, actual, threshold: threshold[metric], ok: actual >= threshold[metric] };
  });
}

/**
 * Pure evaluation of a coverage summary. Filesystem facts come in through `probe` so tests can fake them.
 * @param {unknown} summary parsed coverage-summary.json
 * @param {{ root: string, probe?: { exists: (scope: string) => boolean, measurable: (scope: string) => boolean } }} options
 * @returns {GateResult}
 */
export function evaluateCoverage(summary, { root, probe }) {
  const fs = probe ?? {
    exists: (/** @type {string} */ scope) => existsSync(join(root, ...scope.split('/'))),
    measurable: (/** @type {string} */ scope) => hasMeasurableSource(root, scope),
  };
  /** @type {GateResult} */
  const result = { checks: [], inactive: [], errors: [] };
  if (!isRecord(summary)) {
    result.errors.push('coverage summary is not a JSON object');
    return result;
  }
  const totalLines = counter(summary['total'], 'lines');
  const totalBranches = counter(summary['total'], 'branches');
  if (totalLines === null || totalBranches === null) {
    result.errors.push('coverage summary has no valid `total.lines` / `total.branches` counters');
    return result;
  }
  if (totalLines.total === 0) {
    result.errors.push('coverage summary measured zero lines (collectCoverageFrom matched nothing)');
    return result;
  }
  result.checks.push(...checksFor('overall', COVERAGE_THRESHOLDS.overall, { lines: totalLines, branches: totalBranches }));

  for (const critical of COVERAGE_THRESHOLDS.critical) {
    const lines = { covered: 0, total: 0 };
    const branches = { covered: 0, total: 0 };
    let files = 0;
    for (const [key, entry] of Object.entries(summary)) {
      if (key === 'total' || !relativeKey(key, root).startsWith(`${critical.scope}/`)) continue;
      const l = counter(entry, 'lines');
      const b = counter(entry, 'branches');
      if (l === null || b === null) {
        result.errors.push(`coverage entry for ${relativeKey(key, root)} has no valid lines/branches counters`);
        continue;
      }
      files += 1;
      lines.covered += l.covered;
      lines.total += l.total;
      branches.covered += b.covered;
      branches.total += b.total;
    }
    if (files > 0) {
      result.checks.push(...checksFor(critical.scope, critical, { lines, branches }));
      continue;
    }
    if (!fs.exists(critical.scope)) {
      if (critical.required) result.errors.push(`${critical.scope} does not exist (a required critical package)`);
      else result.inactive.push(`${critical.scope} does not exist: ${critical.note ?? 'gate is inactive'}`);
    } else if (fs.measurable(critical.scope)) {
      result.errors.push(`${critical.scope} has measurable source files but the coverage summary has no entry for them`);
    } else {
      result.inactive.push(`${critical.scope} has no measured source file yet: its 95 % gate is inactive`);
    }
  }
  return result;
}

/** @param {Check} c */
function describeCheck(c) {
  return `${c.scope} ${c.metric} ${c.actual.toFixed(2)}% ${c.ok ? '>=' : '<'} ${c.threshold}%`;
}

/**
 * Human-readable lines and the verdict.
 * @param {GateResult} result
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function renderResult(result) {
  const failed = result.checks.filter((c) => !c.ok);
  const lines = [
    ...result.checks.map((c) => `coverage-gate: ${c.ok ? 'ok  ' : 'FAIL'} ${describeCheck(c)}`),
    ...result.inactive.map((note) => `coverage-gate: inactive ${note}`),
    ...result.errors.map((error) => `coverage-gate: FAIL ${error}`),
  ];
  const ok = failed.length === 0 && result.errors.length === 0;
  lines.push(
    ok
      ? 'coverage-gate: PASS'
      : `coverage-gate: FAIL (${[...failed.map((c) => `${c.scope} ${c.metric}`), ...result.errors.map(() => 'error')].join(', ')})`,
  );
  return { ok, lines };
}

/**
 * JUnit cases for quality:heavy (one per check, inactive scope and error), so a below-threshold scope fails the suite.
 * @param {unknown} summary parsed coverage-summary.json, or null when the file was absent or unreadable
 * @param {{ root: string, classname: string }} options
 * @returns {import('../quality/lib/junit-write.mjs').JUnitCase[]}
 */
export function coverageGateCases(summary, { root, classname }) {
  if (summary === null)
    return [
      { name: 'coverage gate: summary present', classname, status: 'error', message: 'coverage-summary.json is absent or unreadable' },
    ];
  const result = evaluateCoverage(summary, { root });
  return [
    ...result.checks.map((c) => ({
      name: `coverage gate: ${c.scope} ${c.metric}`,
      classname,
      status: /** @type {'passed' | 'failed'} */ (c.ok ? 'passed' : 'failed'),
      ...(c.ok ? {} : { message: describeCheck(c) }),
    })),
    ...result.inactive.map((note) => ({
      name: `coverage gate: ${note.split(' ')[0] ?? note} (inactive)`,
      classname,
      status: /** @type {const} */ ('passed'),
    })),
    ...result.errors.map((error) => ({
      name: `coverage gate: ${error.split(' ')[0] ?? 'summary'}`,
      classname,
      status: /** @type {const} */ ('failed'),
      message: error,
    })),
  ];
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  let root = process.cwd();
  /** @type {string | undefined} */
  let summaryPath;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' || arg === '--summary') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`coverage-gate: ${arg} needs a value`);
        return 2;
      }
      if (arg === '--root') root = resolve(value);
      else summaryPath = value;
      i += 1;
    } else if (arg === '--json') json = true;
    else {
      console.error(`coverage-gate: unknown argument ${String(arg)}`);
      return 2;
    }
  }
  const file = resolve(root, summaryPath ?? join('coverage', 'coverage-summary.json'));
  /** @type {unknown} */
  let summary;
  try {
    summary = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(
      `coverage-gate: cannot read ${file} (run npm run test:coverage first): ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  const result = evaluateCoverage(summary, { root });
  if (!isRecord(summary) || counter(summary['total'], 'lines') === null) {
    console.error(`coverage-gate: ${result.errors.join('; ')}`);
    return 2;
  }
  const rendered = renderResult(result);
  if (json) console.log(JSON.stringify({ ok: rendered.ok, ...result }, null, 2));
  else for (const line of rendered.lines) (rendered.ok ? console.log : console.error)(line);
  return rendered.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
