// @ts-check
/**
 * Merged coverage across Jest projects (US-006, REQ-PLAT-008; TEST-STRATEGY section 8 "merged across workspaces (unit +
 * integration + API Jest projects)"; D-ORCH-047; PR #33 code review R1-m4, PR33-SEC-06). The projects that measure
 * source run as separate Jest processes (unit and unit-dom in parallel, the Testcontainers projects in band), each with
 * the istanbul `json` reporter (`coverage-final.json`). This module merges those maps into ONE coverage map and derives
 * from it the `json-summary` object (tools/ci/coverage-gate.mjs) and `lcov.info` (tools/ci/diff-coverage.mjs).
 *
 * Merge semantics (jest.config.ts pins `coverageProvider: 'v8'`): inside ONE Jest run, Jest merges the raw V8 block
 * coverage of all test files (`mergeProcessCovs`) before v8-to-istanbul converts it. Across runs only the istanbul
 * form exists, and V8 omits a block whose count equals its enclosing range, so a plain location-keyed sum (istanbul's
 * own `FileCoverage.merge`) loses those implicit counts: a function that takes the `then` path in unit tests and the
 * `else` path in integration tests would report 1 of 3 branches instead of 3 of 3. A range one run lacks therefore
 * gets an IMPLIED count from that run (`impliedCount`), but only one that can never claim code ran when it did not:
 * v8-to-istanbul also drops every uncalled ANONYMOUS function (no name, no block data), so "absent" is ambiguous
 * between "same count as the enclosing range" and "never called". The implied count is the innermost enclosing range's
 * count capped by the highest count that run recorded for the lines strictly inside the range (an uncalled function's
 * own lines are 0 there), and 0 for a range with no interior line. Branch coverage is thus a lower bound of a single
 * combined run's, never above it (measured on the repository: see the PR record); a location outside every range of a
 * run also counts 0. Statements (one per line under v8-to-istanbul) are summed by location, so line coverage is exact. Placeholder
 * entries Jest writes for a file no test of that run loaded (one `(empty-report)` function over the whole file) are
 * dropped when another run measured the file, as Jest itself only adds them for files absent from its map; otherwise
 * one placeholder stays and the file counts as fully uncovered.
 *
 * Fail-closed (`projectProblems`): a required project with no coverage run, an unreadable or malformed
 * `coverage-final.json`, an empty map, or a map in which no file was executed is an error, never a smaller summary.
 * Summary numbers follow istanbul-lib-coverage `toSummary` (lines = statement start lines with the max count; `pct`
 * floored to two decimals; an empty metric is 100 %).
 *
 * No dependency: istanbul-lib-coverage is only a transitive dependency of Jest, and declaring it would add a package
 * whose last release is older than the 18-month maintenance rule (CLAUDE.md section 5).
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

/** Function name of the per-file placeholder Jest's v8 path writes for an untested file (@jest/reporters). */
export const PLACEHOLDER_FUNCTION = '(empty-report)';
/** Bound on one coverage-final.json (characters). */
const MAX_COVERAGE_CHARS = 512 * 1024 * 1024;

/**
 * @typedef {{ line: number, column: number }} Pos
 * @typedef {{ start: Pos, end: Pos }} Loc
 * @typedef {{ name: string, decl: Loc, loc: Loc, line: number }} FnMeta
 * @typedef {{ type: string, line: number, loc: Loc, locations: Loc[] }} BranchMeta
 * @typedef {{ path: string, statementMap: Record<string, Loc>, s: Record<string, number>, fnMap: Record<string, FnMeta>,
 *   f: Record<string, number>, branchMap: Record<string, BranchMeta>, b: Record<string, number[]> }} FileCoverage
 * @typedef {Record<string, FileCoverage>} CoverageMap
 * @typedef {{ total: number, covered: number, skipped: number, pct: number }} Metric
 * @typedef {{ lines: Metric, statements: Metric, functions: Metric, branches: Metric }} FileSummary
 * @typedef {{ projects: string[], map: CoverageMap | null, problem: string | null }} CoverageSource
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} n */
const isCount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
/** @param {unknown} p @returns {p is Pos} */
const isPos = (p) => isRecord(p) && Number.isInteger(p['line']) && (Number.isInteger(p['column']) || p['column'] === null);
/** @param {unknown} l @returns {l is Loc} */
const isLoc = (l) => isRecord(l) && isPos(l['start']) && isPos(l['end']);

/**
 * Validates one parsed `coverage-final.json`. Throws on anything that is not an istanbul file-coverage map, so a
 * corrupt report can never merge into a smaller (and better looking) summary.
 * @param {unknown} raw
 * @param {string} where label for messages (no host path)
 * @returns {CoverageMap}
 */
export function parseCoverageMap(raw, where) {
  if (!isRecord(raw)) throw new Error(`${where}: not a JSON object`);
  let index = 0;
  for (const value of Object.values(raw)) {
    const at = `${where}: entry ${index}`;
    index += 1;
    if (!isRecord(value) || typeof value['path'] !== 'string') throw new Error(`${at} has no path`);
    for (const key of ['statementMap', 's', 'fnMap', 'f', 'branchMap', 'b'])
      if (!isRecord(value[key])) throw new Error(`${at}: ${key} is not an object`);
    const statementMap = /** @type {Record<string, unknown>} */ (value['statementMap']);
    const s = /** @type {Record<string, unknown>} */ (value['s']);
    const fnMap = /** @type {Record<string, unknown>} */ (value['fnMap']);
    const f = /** @type {Record<string, unknown>} */ (value['f']);
    const branchMap = /** @type {Record<string, unknown>} */ (value['branchMap']);
    const b = /** @type {Record<string, unknown>} */ (value['b']);
    for (const [id, loc] of Object.entries(statementMap))
      if (!isLoc(loc) || !isCount(s[id])) throw new Error(`${at}: statement ${id} is malformed`);
    for (const [id, meta] of Object.entries(fnMap))
      if (!isRecord(meta) || typeof meta['name'] !== 'string' || !isLoc(meta['loc']) || !isCount(f[id]))
        throw new Error(`${at}: function ${id} is malformed`);
    for (const [id, meta] of Object.entries(branchMap)) {
      const counts = b[id];
      if (
        !isRecord(meta) ||
        typeof meta['type'] !== 'string' ||
        !isLoc(meta['loc']) ||
        !Array.isArray(meta['locations']) ||
        !meta['locations'].every(isLoc) ||
        !Array.isArray(counts) ||
        counts.length !== meta['locations'].length ||
        !counts.every(isCount)
      )
        throw new Error(`${at}: branch ${id} is malformed`);
    }
  }
  return /** @type {CoverageMap} */ (raw);
}

/**
 * Reads and validates a `coverage-final.json`.
 * @param {string} file
 * @param {string} where label for messages (no host path)
 * @returns {CoverageMap}
 */
export function readCoverageFinal(file, where) {
  const text = readFileSync(file, 'utf8');
  if (text.length > MAX_COVERAGE_CHARS) throw new Error(`${where}: coverage-final.json is too large`);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // V8's JSON.parse message quotes input; the input is a host-path-keyed report (D-SEC-PR23-02 (3)).
    throw new Error(`${where}: coverage-final.json is not valid JSON`);
  }
  return parseCoverageMap(raw, where);
}

/** Whether an entry is Jest's placeholder for a file no test of that run loaded. @param {FileCoverage} fc */
export function isPlaceholder(fc) {
  const fns = Object.values(fc.fnMap);
  return fns.length === 1 && fns[0]?.name === PLACEHOLDER_FUNCTION;
}

/** @param {Loc} l */
const locKey = (l) => `${l.start.line}:${l.start.column ?? -1}-${l.end.line}:${l.end.column ?? -1}`;
/** @param {Pos} a @param {Pos} b @returns {number} */
const cmp = (a, b) => a.line - b.line || (a.column ?? -1) - (b.column ?? -1);
/** Whether `outer` contains `inner` (bounds inclusive). @param {Loc} outer @param {Loc} inner */
const contains = (outer, inner) => cmp(outer.start, inner.start) <= 0 && cmp(inner.end, outer.end) <= 0;
/** A V8 block range (v8-to-istanbul writes one location per branch entry, type `branch`). @param {BranchMeta} m */
const isV8Range = (m) => m.type === 'branch' && m.locations.length === 1;

/**
 * @typedef {{ ranges: Array<{ loc: Loc, count: number }>, lines: Map<number, number> }} RunShape
 */

/**
 * What one run's file entry says about implicit counts: every V8 block range, every function range, and the highest
 * statement count per line.
 * @param {FileCoverage} fc
 * @returns {RunShape}
 */
export function runShape(fc) {
  /** @type {Array<{ loc: Loc, count: number }>} */
  const ranges = [];
  for (const [id, meta] of Object.entries(fc.branchMap))
    if (isV8Range(meta)) ranges.push({ loc: /** @type {Loc} */ (meta.locations[0]), count: fc.b[id]?.[0] ?? 0 });
  for (const [id, meta] of Object.entries(fc.fnMap)) ranges.push({ loc: meta.loc, count: fc.f[id] ?? 0 });
  /** @type {Map<number, number>} */
  const lines = new Map();
  for (const [id, loc] of Object.entries(fc.statementMap))
    lines.set(loc.start.line, Math.max(lines.get(loc.start.line) ?? 0, fc.s[id] ?? 0));
  return { ranges, lines };
}

/**
 * Count of `loc` in a run that has no entry for it, never above what that run can prove: the count of the innermost
 * range of the run containing it (smallest span; among equal spans the lowest), capped by the run's highest line
 * count strictly inside `loc`; 0 when `loc` has no interior line or no range of the run contains it.
 * @param {RunShape} shape
 * @param {Loc} loc
 * @returns {number}
 */
export function impliedCount(shape, loc) {
  let interior = 0;
  for (let line = loc.start.line + 1; line < loc.end.line; line += 1) interior = Math.max(interior, shape.lines.get(line) ?? 0);
  return interior === 0 ? 0 : Math.min(interior, enclosingCount(shape.ranges, loc));
}

/**
 * Count of the innermost range containing `loc` (smallest span; among equal spans the lowest count), else 0.
 * @param {ReadonlyArray<{ loc: Loc, count: number }>} ranges
 * @param {Loc} loc
 * @returns {number}
 */
export function enclosingCount(ranges, loc) {
  /** @type {{ loc: Loc, count: number } | null} */
  let best = null;
  for (const range of ranges) {
    if (!contains(range.loc, loc)) continue;
    if (best === null) best = range;
    else {
      const inner = contains(best.loc, range.loc);
      const outer = contains(range.loc, best.loc);
      if ((inner && !outer) || (inner && outer && range.count < best.count)) best = range;
    }
  }
  return best === null ? 0 : best.count;
}

/**
 * Merges the entries of one file from several runs (placeholders already removed; at least one entry).
 * @param {readonly FileCoverage[]} entries
 * @returns {FileCoverage}
 */
export function mergeFileCoverage(entries) {
  const first = /** @type {FileCoverage} */ (entries[0]);
  /** @type {Map<string, { loc: Loc, count: number }>} */
  const statements = new Map();
  for (const fc of entries)
    for (const [id, loc] of Object.entries(fc.statementMap)) {
      const key = locKey(loc);
      const acc = statements.get(key) ?? { loc, count: 0 };
      acc.count += fc.s[id] ?? 0;
      statements.set(key, acc);
    }

  const shapes = entries.map(runShape);
  /** @type {Map<string, FnMeta>} */
  const fnMetas = new Map();
  /** @type {Map<string, BranchMeta>} */
  const branchMetas = new Map();
  /** @type {Array<{ fns: Map<string, number>, branches: Map<string, number[]> }>} */
  const own = entries.map((fc) => {
    const fns = new Map();
    for (const [id, meta] of Object.entries(fc.fnMap)) {
      const key = locKey(meta.loc);
      if (!fnMetas.has(key)) fnMetas.set(key, meta);
      fns.set(key, (fns.get(key) ?? 0) + (fc.f[id] ?? 0));
    }
    const branches = new Map();
    for (const [id, meta] of Object.entries(fc.branchMap)) {
      const key = `${meta.type}|${meta.locations.map(locKey).join(';')}`;
      if (!branchMetas.has(key)) branchMetas.set(key, meta);
      const counts = fc.b[id] ?? [];
      const prev = branches.get(key);
      branches.set(key, prev === undefined ? [...counts] : counts.map((c, i) => c + (prev[i] ?? 0)));
    }
    return { fns, branches };
  });

  /** @type {FileCoverage} */
  const out = { path: first.path, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  let i = 0;
  for (const { loc, count } of statements.values()) {
    out.statementMap[String(i)] = loc;
    out.s[String(i)] = count;
    i += 1;
  }
  i = 0;
  for (const [key, meta] of fnMetas) {
    out.fnMap[String(i)] = meta;
    out.f[String(i)] = own.reduce(
      (sum, run, r) => sum + (run.fns.get(key) ?? impliedCount(shapes[r] ?? { ranges: [], lines: new Map() }, meta.loc)),
      0,
    );
    i += 1;
  }
  i = 0;
  for (const [key, meta] of branchMetas) {
    out.branchMap[String(i)] = meta;
    out.b[String(i)] = own.reduce(
      (sum, run, r) => {
        const counts =
          run.branches.get(key) ??
          (isV8Range(meta)
            ? [impliedCount(shapes[r] ?? { ranges: [], lines: new Map() }, /** @type {Loc} */ (meta.locations[0]))]
            : meta.locations.map(() => 0));
        return sum.map((c, k) => c + (counts[k] ?? 0));
      },
      meta.locations.map(() => 0),
    );
    i += 1;
  }
  return out;
}

/** Map key used to match one file across runs. @param {string} key */
const fileKey = (key) => key.replaceAll('\\', '/').toLowerCase();

/**
 * Merges coverage maps of several runs into one (keys of the first run that measured a file are kept).
 * @param {readonly CoverageMap[]} maps
 * @returns {CoverageMap}
 */
export function mergeCoverageMaps(maps) {
  /** @type {Map<string, { key: string, entries: FileCoverage[] }>} */
  const files = new Map();
  for (const map of maps)
    for (const [key, fc] of Object.entries(map)) {
      const k = fileKey(key);
      const acc = files.get(k) ?? { key, entries: [] };
      acc.entries.push(fc);
      files.set(k, acc);
    }
  /** @type {CoverageMap} */
  const out = {};
  for (const { key, entries } of [...files.values()].sort((a, b) => fileKey(a.key).localeCompare(fileKey(b.key)))) {
    const measured = entries.filter((fc) => !isPlaceholder(fc));
    out[key] = measured.length === 0 ? /** @type {FileCoverage} */ (JSON.parse(JSON.stringify(entries[0]))) : mergeFileCoverage(measured);
  }
  return out;
}

/** istanbul-lib-coverage `percent`. @param {number} covered @param {number} total */
export function istanbulPercent(covered, total) {
  return total > 0 ? Math.floor((1000 * 100 * covered) / total / 10) / 100 : 100;
}

/** @param {number} total @param {number} covered @returns {Metric} */
const metric = (total, covered) => ({ total, covered, skipped: 0, pct: istanbulPercent(covered, total) });

/**
 * istanbul `FileCoverage.toSummary` for one file.
 * @param {FileCoverage} fc
 * @returns {FileSummary}
 */
export function summarizeFile(fc) {
  /** @type {Map<number, number>} */
  const lines = new Map();
  for (const [id, loc] of Object.entries(fc.statementMap)) {
    const count = fc.s[id] ?? 0;
    const prev = lines.get(loc.start.line);
    if (prev === undefined || prev < count) lines.set(loc.start.line, count);
  }
  const counted = (/** @type {Iterable<number>} */ values) => {
    let total = 0;
    let covered = 0;
    for (const v of values) {
      total += 1;
      if (v > 0) covered += 1;
    }
    return metric(total, covered);
  };
  const branchCounts = Object.values(fc.b).flat();
  return {
    lines: counted(lines.values()),
    statements: counted(Object.values(fc.s)),
    functions: counted(Object.values(fc.f)),
    branches: counted(branchCounts),
  };
}

/**
 * The `json-summary` object of a coverage map: `total` first, then one entry per file (keys as in the map).
 * @param {CoverageMap} map
 * @returns {Record<string, FileSummary>}
 */
export function summarizeCoverage(map) {
  const names = /** @type {const} */ (['lines', 'statements', 'functions', 'branches']);
  const sums = Object.fromEntries(names.map((name) => [name, { total: 0, covered: 0 }]));
  /** @type {Record<string, FileSummary>} */
  const files = {};
  for (const [key, fc] of Object.entries(map)) {
    const summary = summarizeFile(fc);
    files[key] = summary;
    for (const name of names) {
      const acc = /** @type {{ total: number, covered: number }} */ (sums[name]);
      acc.total += summary[name].total;
      acc.covered += summary[name].covered;
    }
  }
  const total = /** @type {FileSummary} */ (
    Object.fromEntries(names.map((name) => [name, metric(Number(sums[name]?.total), Number(sums[name]?.covered))]))
  );
  return { total, ...files };
}

/**
 * `lcov.info` text of a coverage map (istanbul-reports `lcovonly` layout; SF relative to `root`, as Jest writes it).
 * @param {CoverageMap} map
 * @param {string} root
 * @returns {string}
 */
export function toLcov(map, root) {
  /** @type {string[]} */
  const out = [];
  for (const fc of Object.values(map)) {
    const summary = summarizeFile(fc);
    out.push('TN:', `SF:${relative(root, fc.path)}`);
    for (const meta of Object.values(fc.fnMap)) out.push(`FN:${(meta.decl ?? meta.loc).start.line},${meta.name}`);
    out.push(`FNF:${summary.functions.total}`, `FNH:${summary.functions.covered}`);
    for (const [id, meta] of Object.entries(fc.fnMap)) out.push(`FNDA:${fc.f[id] ?? 0},${meta.name}`);
    /** @type {Map<number, number>} */
    const lines = new Map();
    for (const [id, loc] of Object.entries(fc.statementMap)) {
      const count = fc.s[id] ?? 0;
      const prev = lines.get(loc.start.line);
      if (prev === undefined || prev < count) lines.set(loc.start.line, count);
    }
    for (const [line, count] of lines) out.push(`DA:${line},${count}`);
    out.push(`LF:${summary.lines.total}`, `LH:${summary.lines.covered}`);
    for (const [id, counts] of Object.entries(fc.b)) {
      const meta = fc.branchMap[id];
      if (meta !== undefined) counts.forEach((count, k) => out.push(`BRDA:${meta.loc.start.line},${id},${k},${count}`));
    }
    out.push(`BRF:${summary.branches.total}`, `BRH:${summary.branches.covered}`, 'end_of_record');
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

// --- configuration and fail-closed checks -------------------------------------------------------------------------

/**
 * @typedef {{ suite: string, projects: string[], projectsIfSuites: string[] }} MergedCoverageConfig
 */

/** Jest project names of jest.config.ts that may be merged (e2e is Playwright, not Jest). */
const PROJECT_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Validates `merged_coverage` of tools/quality/suite-runners.json: the suite whose JUnit carries the merged gate, the
 * projects that are always required and those required only while they have test files (`generated`).
 * @param {unknown} raw
 * @returns {MergedCoverageConfig}
 */
export function parseMergedCoverageConfig(raw) {
  if (!isRecord(raw)) throw new Error('merged_coverage must be an object');
  const { suite, projects, projects_if_suites: ifSuites } = raw;
  if (typeof suite !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(suite)) throw new Error('merged_coverage.suite must be a suite id');
  /** @param {unknown} list @param {string} name @param {boolean} nonEmpty */
  const names = (list, name, nonEmpty) => {
    if (list === undefined && !nonEmpty) return [];
    if (!Array.isArray(list) || (nonEmpty && list.length === 0) || !list.every((p) => typeof p === 'string' && PROJECT_NAME.test(p)))
      throw new Error(`merged_coverage.${name} must be ${nonEmpty ? 'a non-empty' : 'an'} array of Jest project names`);
    return /** @type {string[]} */ ([...new Set(list)]);
  };
  const always = names(projects, 'projects', true);
  const conditional = names(ifSuites, 'projects_if_suites', false);
  const both = always.filter((p) => conditional.includes(p));
  if (both.length > 0) throw new Error(`merged_coverage: ${both.join(', ')} listed as both required and conditional`);
  return { suite, projects: always, projectsIfSuites: conditional };
}

/**
 * Fail-closed checks over the coverage sources of a merge: one problem per required project that has no source, whose
 * source failed to produce a readable map, whose map is empty, or in whose map no file was executed.
 * @param {readonly string[]} required
 * @param {readonly CoverageSource[]} sources
 * @returns {Map<string, string | null>} project -> problem (null = measured)
 */
export function projectProblems(required, sources) {
  /** @type {Map<string, string | null>} */
  const out = new Map();
  for (const project of required) {
    const source = sources.find((s) => s.projects.includes(project));
    if (source === undefined) out.set(project, `no coverage run selected project ${project}`);
    else if (source.problem !== null || source.map === null)
      out.set(project, source.problem ?? `coverage of ${source.projects.join('+')} is missing`);
    else if (Object.keys(source.map).length === 0) out.set(project, `coverage of ${source.projects.join('+')} is empty (no file measured)`);
    else if (Object.values(source.map).every(isPlaceholder))
      out.set(project, `coverage of ${source.projects.join('+')} executed no source file (every entry is an untested placeholder)`);
    else out.set(project, null);
  }
  return out;
}

/**
 * Jest `coverageThreshold.global` semantics over a merged summary total (the independent tripwire of jest.config.ts):
 * a positive value is a minimum percentage, a negative one a maximum number of uncovered items.
 * @param {Record<string, unknown>} global jest.config.ts `coverageThreshold.global`
 * @param {Record<string, FileSummary> | Record<string, unknown>} summary
 * @returns {Array<{ metric: string, ok: boolean, message: string }>}
 */
export function tripwireChecks(global, summary) {
  const total = isRecord(summary['total']) ? summary['total'] : {};
  return Object.entries(global).map(([name, threshold]) => {
    const m = total[name];
    if (typeof threshold !== 'number' || !isRecord(m) || typeof m['pct'] !== 'number' || typeof m['total'] !== 'number')
      return { metric: name, ok: false, message: `no ${name} total in the merged summary or no numeric threshold` };
    if (threshold < 0) {
      const uncovered = m['total'] - Number(m['covered']);
      return { metric: name, ok: uncovered <= -threshold, message: `${name}: ${uncovered} uncovered, maximum ${-threshold}` };
    }
    return {
      metric: name,
      ok: m['pct'] >= threshold,
      message: `${name}: ${m['pct']}% ${m['pct'] >= threshold ? '>=' : '<'} ${threshold}%`,
    };
  });
}

/**
 * `coverageThreshold.global` of the repository's jest.config.ts (Node 24 strips the type annotations natively).
 * @param {string} configUrl file URL of jest.config.ts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadJestGlobalThreshold(configUrl) {
  const mod = /** @type {{ default?: unknown }} */ (await import(configUrl));
  const config = mod.default;
  const threshold = isRecord(config) && isRecord(config['coverageThreshold']) ? config['coverageThreshold']['global'] : undefined;
  if (!isRecord(threshold) || Object.keys(threshold).length === 0) throw new Error('jest.config.ts has no coverageThreshold.global');
  return threshold;
}
