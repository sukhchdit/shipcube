// @ts-check
/**
 * Merged coverage across Jest projects (US-006, REQ-PLAT-008; TEST-STRATEGY section 8 "merged across workspaces (unit +
 * integration + API Jest projects)"; D-ORCH-047; PR #33 code review R1-m4, PR33-SEC-06). The projects that measure
 * source run as separate Jest processes (unit and unit-dom in parallel, the Testcontainers projects in band), each with
 * the istanbul `json` reporter (`coverage-final.json`). This module merges those maps into ONE coverage map and derives
 * from it the `json-summary` object (tools/ci/coverage-gate.mjs) and `lcov.info` (tools/ci/diff-coverage.mjs).
 *
 * Merge semantics (jest.config.ts pins `coverageProvider: 'v8'`; D-TASK015-22 as restated by D-TASK015-28). Inside ONE
 * Jest run, Jest merges the raw V8 block coverage of all test files with @bcoe/v8-coverage `mergeProcessCovs` (range
 * trees, then normalization: adjacent equal-count siblings coalesce) before v8-to-istanbul converts it. Across runs
 * only the istanbul form exists, and a location-keyed sum is wrong both ways: V8 omits a block whose count equals its
 * parent's (a plain sum loses counts), and a range one run coalesced survives as an extra key next to the other run's
 * split ranges (round 1 over-reported branches that way, PR #40 R1-M1). So this module rebuilds each run's V8 range
 * trees from the istanbul entry and merges them per function with the same range-tree algorithm (tools/ci/
 * v8-range-tree.mjs, an in-house port, MIT notice there):
 * - positions are canonicalized (v8-to-istanbul writes one offset as `(line + 1, -1)` when a range starts there and as
 *   `(line, length)` when one ends there) and compressed to integers in source order;
 * - each run's ranges split into functions (`groupFunctions`); a function that a run lacks was not called there;
 * - spans that cross after source mapping are uncrossed once per function for all runs (`uncrossSpans`);
 * - an anonymous function a run never called is dropped by v8-to-istanbul; where it was grouped with its parent, the run
 *   gets a 0 range for it (`zeroFillAbsent`, the round-1 interior-line cap in its new place);
 * - the merged tree is normalized conservatively: siblings coalesce and a spanning child folds only where the removed
 *   node is covered.
 * Bound (D-TASK015-28; proof in the PR #40 fix-cycle-1 body): per function, the merged branch percentage is never
 * above that of `mergeFunctionCovs` over the runs' trees (Jest's own merge with each run as one process): zero-filling
 * only lowers counts, the conservative normalization keeps exactly that merge's covered nodes and only splits its
 * uncovered ones (nothing under an uncovered node ran), and a function measured by one run is passed through. Equality
 * with ONE combined run is not attainable from per-run output in general (`mergeFunctionCovs` is not associative, and a
 * run's coalescing erases boundaries a combined run may keep), so that property is measured: the real-Jest trials in
 * tools/ci/fixtures/coverage-merge/trials.json (tools/ci/coverage-merge-probe.mjs, re-run on any Jest, v8-to-istanbul,
 * @swc/jest or transform change, PR40-SEC-06) have lines equal and branches never above the combined run. Statements
 * (one per line under v8-to-istanbul) are summed by location, so line coverage is exact. Placeholder
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
import { readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { comparePreOrder, mergeFunctionRanges, uncrossSpans } from './v8-range-tree.mjs';

/** Function name of the per-file placeholder Jest's v8 path writes for an untested file (@jest/reporters). */
export const PLACEHOLDER_FUNCTION = '(empty-report)';
/** Bound on one coverage-final.json (bytes; checked before reading, below V8's longest string, R1-n4). */
export const MAX_COVERAGE_BYTES = 256 * 1024 * 1024;

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
 * @typedef {{ projects: string[], map: CoverageMap | null, problem: string | null, ranTests: string[] | null }} CoverageSource coverage of one Jest run; ranTests = test files its Jest JSON report lists (null: no readable report)
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
 * @param {number} [maxBytes]
 * @returns {CoverageMap}
 */
export function readCoverageFinal(file, where, maxBytes = MAX_COVERAGE_BYTES) {
  if (statSync(file).size > maxBytes) throw new Error(`${where}: coverage-final.json is too large`);
  const text = readFileSync(file, 'utf8');
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
/** A V8 block range (v8-to-istanbul writes one location per branch entry, type `branch`). @param {BranchMeta} m */
const isV8Range = (m) => m.type === 'branch' && m.locations.length === 1;

/**
 * @typedef {import('./v8-range-tree.mjs').RangeCov} RangeCov
 * @typedef {[number, number]} CanonicalPos (line, column)
 * @typedef {{ start: number, end: number }} Span compressed positions
 * @typedef {{ root: RangeCov, ranges: RangeCov[] }} RunFunction one function of one run, ranges in pre-order
 */

/**
 * Line lengths of a file from its statements (v8-to-istanbul writes one statement per line, column 0 to line length).
 * @param {readonly FileCoverage[]} entries
 * @returns {Map<number, number>}
 */
function lineLengths(entries) {
  /** @type {Map<number, number>} */
  const lengths = new Map();
  for (const fc of entries)
    for (const loc of Object.values(fc.statementMap))
      if (loc.start.line === loc.end.line && typeof loc.end.column === 'number')
        lengths.set(loc.start.line, Math.max(lengths.get(loc.start.line) ?? 0, loc.end.column));
  return lengths;
}

/**
 * The canonical (line, column) of an istanbul position. v8-to-istanbul writes a source offset that lies on a line break
 * as (next line, -1) when a range STARTS there and as (line, line length) when a range ENDS there; both name one offset
 * (real Jest output: `5:-1` and `4:3`), and the range trees must see them as one position.
 * @param {Pos} pos
 * @param {ReadonlyMap<number, number>} lengths
 * @returns {CanonicalPos}
 */
export function canonicalPos(pos, lengths) {
  if (typeof pos.column === 'number' && pos.column < 0) {
    const previous = lengths.get(pos.line - 1);
    if (previous !== undefined) return [pos.line - 1, previous + 1 + pos.column];
  }
  return [pos.line, pos.column ?? -1];
}

/** @param {{ start: number, end: number }} r */
const spanKey = (r) => `${r.start}:${r.end}`;
/** Whether `outer` contains `inner` (bounds inclusive). @param {Span} outer @param {Span} inner */
const containsSpan = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;
/** Whether two spans overlap without one containing the other. @param {Span} a @param {Span} b */
const crosses = (a, b) =>
  (a.start < b.start && b.start < a.end && a.end < b.end) || (b.start < a.start && a.start < b.end && b.end < a.end);

/**
 * Splits one run's V8 ranges into functions. v8-to-istanbul writes them function by function, the functions sorted by
 * root range and each function's ranges in pre-order (Jest normalizes the merged script coverage before converting),
 * so a range starts a new function when it is a known root, lies outside the current root, breaks pre-order, or
 * repeats a span of the current function. A nested anonymous function that follows its parent's ranges in pre-order
 * cannot be told from a block of the parent; it is then grouped with the parent (see `zeroFillAbsent`).
 * @param {readonly RangeCov[]} ranges compressed, in branchMap order
 * @param {(range: RangeCov) => boolean} isRoot
 * @returns {RunFunction[]}
 */
export function groupFunctions(ranges, isRoot) {
  /** @type {RunFunction[]} */
  const functions = [];
  /** @type {RunFunction | undefined} */
  let current;
  /** @type {Set<string>} */
  let spans = new Set();
  for (const range of ranges) {
    const last = current?.ranges[current.ranges.length - 1];
    if (
      current === undefined ||
      last === undefined ||
      isRoot(range) ||
      !containsSpan(current.root, range) ||
      comparePreOrder(range, last) < 0 ||
      spans.has(spanKey(range))
    ) {
      current = { root: range, ranges: [range] };
      functions.push(current);
      spans = new Set([spanKey(range)]);
    } else {
      current.ranges.push(range);
      spans.add(spanKey(range));
    }
  }
  return functions;
}

/**
 * Zero ranges a run must have had but v8-to-istanbul could not write: an anonymous function that a run never called is
 * dropped entirely (no name, no block data), and when it was grouped with its parent (see `groupFunctions`) the tree
 * merge would otherwise give it, and every block inside it, the parent's count in that run. A span absent from this run
 * gets count 0 here when all of the following hold (the round-1 interior-line cap, kept):
 * - `mayBeFunction(span)`: no run reports it with count 0 (an anonymous function's root appears only in runs that called
 *   it, so a span seen with count 0 is a block);
 * - this run's innermost range containing it counts > 0 (otherwise the tree merge already gives 0);
 * - the run's lines strictly inside it are all 0, or there is no such line (an uncalled function's lines are 0, while a
 *   block that ran at its parent's count has a covered line of its own).
 * Otherwise the span is a block that this run elided at its parent's count, which the tree merge handles exactly.
 * Zero-filling only lowers counts, so it can only under-report. Spans are processed outer first, so the blocks inside a
 * zero-filled function inherit its 0.
 * @param {readonly RangeCov[]} ranges this run's ranges of the function (pre-order)
 * @param {Iterable<Span>} spans spans of the function in all runs
 * @param {(span: Span) => number | null} interiorMax highest line count of this run strictly inside the span, or null
 * @param {(span: Span) => boolean} mayBeFunction
 * @returns {RangeCov[]} the ranges with the zero ranges added, pre-order
 */
export function zeroFillAbsent(ranges, spans, interiorMax, mayBeFunction) {
  const present = new Set(ranges.map(spanKey));
  const out = [...ranges];
  const absent = [...spans].filter((span) => !present.has(spanKey(span))).sort((a, b) => a.start - b.start || b.end - a.end);
  for (const span of absent) {
    if (!mayBeFunction(span) || out.some((range) => crosses(range, span))) continue;
    /** @type {RangeCov | undefined} */
    let innermost;
    for (const range of out)
      if (containsSpan(range, span) && (innermost === undefined || containsSpan(innermost, range))) innermost = range;
    if (innermost === undefined || innermost.count === 0) continue;
    const interior = interiorMax(span);
    if (interior === null || interior === 0) out.push({ start: span.start, end: span.end, count: 0 });
  }
  return out.sort(comparePreOrder);
}

/**
 * Merges the entries of one file from several runs (placeholders already removed; at least one entry).
 *
 * Statements are summed by location. V8 block ranges are merged per function with the range-tree semantics of
 * @bcoe/v8-coverage `mergeFunctionCovs` (tools/ci/v8-range-tree.mjs): each run's ranges become a tree, the trees are
 * merged as Jest merges the coverage of two test files, and the result is normalized; a function that a run lacks was
 * not called in that run and adds nothing. Named functions are summed by location. Other branch entries (not V8
 * ranges) are summed by location, absent = 0.
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

  // Positions: canonical, compressed to integers in source order; the first istanbul form seen per role is kept.
  const lengths = lineLengths(entries);
  /** @type {Map<string, { pos: CanonicalPos, asStart?: Pos, asEnd?: Pos }>} */
  const positions = new Map();
  /** @param {Pos} pos @param {'asStart' | 'asEnd'} role */
  const note = (pos, role) => {
    const canonical = canonicalPos(pos, lengths);
    const key = `${canonical[0]}:${canonical[1]}`;
    const rec = positions.get(key) ?? { pos: canonical };
    rec[role] ??= { line: pos.line, column: pos.column };
    positions.set(key, rec);
    return key;
  };
  const raw = entries.map((fc) => ({
    ranges: Object.entries(fc.branchMap).flatMap(([id, meta]) => {
      if (!isV8Range(meta)) return [];
      const l = /** @type {Loc} */ (meta.locations[0]);
      return [{ start: note(l.start, 'asStart'), end: note(l.end, 'asEnd'), count: fc.b[id]?.[0] ?? 0 }];
    }),
    fns: Object.entries(fc.fnMap).map(([id, meta]) => ({
      meta,
      start: note(meta.loc.start, 'asStart'),
      end: note(meta.loc.end, 'asEnd'),
      count: fc.f[id] ?? 0,
    })),
  }));
  const ordered = [...positions.entries()].sort(([, a], [, b]) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1]);
  const index = new Map(ordered.map(([key], i) => [key, i]));
  const reps = ordered.map(([, rec]) => rec);
  /** @param {string} key */
  const at = (key) => /** @type {number} */ (index.get(key));
  const runs = raw.map((run, r) => {
    const fc = /** @type {FileCoverage} */ (entries[r]);
    /** @type {Map<number, number>} */
    const lines = new Map();
    for (const [id, loc] of Object.entries(fc.statementMap))
      lines.set(loc.start.line, Math.max(lines.get(loc.start.line) ?? 0, fc.s[id] ?? 0));
    return {
      ranges: run.ranges.map((x) => ({ start: at(x.start), end: at(x.end), count: x.count })),
      fns: run.fns.map((x) => ({ meta: x.meta, start: at(x.start), end: at(x.end), count: x.count })),
      lines,
    };
  });

  // Functions: roots named in fnMap, then every root that some run's order proves, then the final grouping per run.
  const named = new Set(runs.flatMap((run) => run.fns.map(spanKey)));
  const roots = new Set(named);
  for (const run of runs) for (const fn of groupFunctions(run.ranges, (range) => named.has(spanKey(range)))) roots.add(spanKey(fn.root));
  /** @type {Map<string, { root: Span, perRun: Map<number, { original: RangeCov[], ranges: RangeCov[] }>, spans: Map<string, Span> }>} */
  const functions = new Map();
  runs.forEach((run, r) => {
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const fn of groupFunctions(run.ranges, (range) => roots.has(spanKey(range)))) {
      const base = spanKey(fn.root);
      const nth = (seen.get(base) ?? 0) + 1;
      seen.set(base, nth);
      const key = nth === 1 ? base : `${base}#${nth}`;
      const acc = functions.get(key) ?? { root: { start: fn.root.start, end: fn.root.end }, perRun: new Map(), spans: new Map() };
      acc.perRun.set(r, { original: fn.ranges, ranges: [] });
      for (const range of fn.ranges) acc.spans.set(spanKey(range), { start: range.start, end: range.end });
      functions.set(key, acc);
    }
  });
  // One crossing-free rewrite of each function's spans, shared by all runs (see uncrossSpans).
  for (const fn of functions.values()) {
    const keys = [...fn.spans.keys()];
    const rewritten = uncrossSpans([...fn.spans.values()]);
    /** @type {Map<string, Span | null>} */
    const rewrite = new Map(keys.map((key, i) => [key, rewritten[i] ?? null]));
    fn.spans = new Map(rewritten.flatMap((span) => (span === null ? [] : [[spanKey(span), span]])));
    for (const run of fn.perRun.values())
      run.ranges = run.original.flatMap((range) => {
        const span = rewrite.get(spanKey(range));
        return span === null || span === undefined ? [] : [{ start: span.start, end: span.end, count: range.count }];
      });
  }

  // A span some run reports with count 0 is a block: an anonymous function's root appears only in runs that called it.
  /** @type {Map<string, number>} */
  const minCount = new Map();
  for (const fn of functions.values())
    for (const { ranges } of fn.perRun.values())
      for (const range of ranges) minCount.set(spanKey(range), Math.min(minCount.get(spanKey(range)) ?? Infinity, range.count));

  /** @param {number} i @returns {Pos} */
  const startOf = (i) => ({ .../** @type {Pos} */ (reps[i]?.asStart ?? reps[i]?.asEnd) });
  /** @param {number} i @returns {Pos} */
  const endOf = (i) => ({ .../** @type {Pos} */ (reps[i]?.asEnd ?? reps[i]?.asStart) });
  /** @param {number} i */
  const lineOf = (i) => {
    const pos = reps[i]?.pos;
    if (pos === undefined) throw new Error(`coverage merge: no position ${i}`);
    return pos[0];
  };
  /** @type {Array<{ loc: Loc, count: number }>} */
  const v8Branches = [];
  const sortedFunctions = [...functions.entries()].sort(
    ([ka, a], [kb, b]) => a.root.start - b.root.start || b.root.end - a.root.end || (ka < kb ? -1 : ka > kb ? 1 : 0),
  );
  for (const [, fn] of sortedFunctions) {
    const only = fn.perRun.size === 1 ? [...fn.perRun.values()][0] : undefined;
    if (only !== undefined) {
      // One run measured the function: its ranges are already Jest's normalized result; keep them as they are.
      for (const range of only.original)
        v8Branches.push({ loc: { start: startOf(range.start), end: endOf(range.end) }, count: range.count });
      continue;
    }
    const inputs = [...fn.perRun.entries()].map(([r, { ranges }]) => {
      const lines = /** @type {(typeof runs)[number]} */ (runs[r]).lines;
      /** @param {Span} span @returns {number | null} */
      const interiorMax = (span) => {
        /** @type {number | null} */
        let max = null;
        for (let line = lineOf(span.start) + 1; line < lineOf(span.end); line += 1) {
          const count = lines.get(line);
          if (count !== undefined) max = Math.max(max ?? 0, count);
        }
        return max;
      };
      return zeroFillAbsent(ranges, fn.spans.values(), interiorMax, (span) => (minCount.get(spanKey(span)) ?? 0) > 0);
    });
    for (const range of mergeFunctionRanges(inputs, { conservative: true }))
      v8Branches.push({ loc: { start: startOf(range.start), end: endOf(range.end) }, count: range.count });
  }

  /** @type {Map<string, { meta: FnMeta, count: number }>} */
  const fnTotals = new Map();
  for (const run of runs)
    for (const fn of run.fns) {
      const acc = fnTotals.get(spanKey(fn)) ?? { meta: fn.meta, count: 0 };
      acc.count += fn.count;
      fnTotals.set(spanKey(fn), acc);
    }

  /** @type {Map<string, { meta: BranchMeta, counts: number[] }>} */
  const otherBranches = new Map();
  for (const fc of entries)
    for (const [id, meta] of Object.entries(fc.branchMap)) {
      if (isV8Range(meta)) continue;
      const key = `${meta.type}|${meta.locations.map(locKey).join(';')}`;
      const acc = otherBranches.get(key) ?? { meta, counts: meta.locations.map(() => 0) };
      const counts = fc.b[id] ?? [];
      acc.counts = acc.counts.map((c, k) => c + (counts[k] ?? 0));
      otherBranches.set(key, acc);
    }

  /** @type {FileCoverage} */
  const out = { path: first.path, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  [...statements.values()].forEach(({ loc, count }, i) => {
    out.statementMap[String(i)] = loc;
    out.s[String(i)] = count;
  });
  [...fnTotals.values()].forEach(({ meta, count }, i) => {
    out.fnMap[String(i)] = meta;
    out.f[String(i)] = count;
  });
  /** @type {Array<{ meta: BranchMeta, counts: number[] }>} */
  const branches = [
    ...v8Branches.map(({ loc, count }) => ({
      meta: { type: 'branch', line: loc.start.line, loc, locations: [{ start: { ...loc.start }, end: { ...loc.end } }] },
      counts: [count],
    })),
    ...otherBranches.values(),
  ];
  branches.forEach(({ meta, counts }, i) => {
    out.branchMap[String(i)] = meta;
    out.b[String(i)] = counts;
  });
  return out;
}

/**
 * Map key used to match one file across runs. On Windows paths are case-insensitive and Jest may write either slash
 * direction, so both are folded; elsewhere the key is the path itself, and two files that differ only in case stay
 * two files (PR40-SEC-04).
 * @param {string} key
 * @param {string} platform `process.platform`
 */
export const fileKey = (key, platform) => (platform === 'win32' ? key.replaceAll('\\', '/').toLowerCase() : key);

/**
 * Merges the coverage maps of several runs into one (keys of the first run that measured a file are kept). Throws when
 * one map holds two keys for the same file (fail closed: one of the two would otherwise be absorbed, PR40-SEC-04).
 * @param {readonly CoverageMap[]} maps
 * @param {{ platform?: string }} [options]
 * @returns {CoverageMap}
 */
export function mergeCoverageMaps(maps, options = {}) {
  const platform = options.platform ?? process.platform;
  /** @type {Map<string, { key: string, entries: FileCoverage[] }>} */
  const files = new Map();
  maps.forEach((map, run) => {
    /** @type {Set<string>} */
    const own = new Set();
    for (const [key, fc] of Object.entries(map)) {
      const k = fileKey(key, platform);
      if (own.has(k)) throw new Error(`coverage map ${run + 1} has two entries for one file (keys that differ only in case or slashes)`);
      own.add(k);
      const acc = files.get(k) ?? { key, entries: [] };
      acc.entries.push(fc);
      files.set(k, acc);
    }
  });
  /** @type {CoverageMap} */
  const out = {};
  for (const [, { key, entries }] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
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
 * source failed to produce a readable map, whose map is empty, in whose map no file was executed, or that ran none of
 * its own test files (PR #40 R1-m1, PR40-SEC-03). The last check is per PROJECT, not per Jest run: unit and unit-dom
 * share one run (as do integration and api in a coverage-only run), so a project that lost all its tests would
 * otherwise pass on its group's map. A project's test files are `jest --listTests --selectProjects <p>`; at least one
 * of them must appear in the run's Jest JSON report (`ranTests`). A listing failure, no listed file, or no report is a
 * problem too.
 * @param {readonly string[]} required
 * @param {readonly CoverageSource[]} sources
 * @param {(project: string) => string[]} listTests throws when Jest cannot list the project's test files
 * @param {string} [platform] `process.platform` (path comparison folds case on win32)
 * @returns {Map<string, string | null>} project -> problem (null = measured)
 */
export function projectProblems(required, sources, listTests, platform = process.platform) {
  /** @param {string} p */
  const key = (p) => fileKey(resolve(p), platform);
  /** @type {Map<string, string | null>} */
  const out = new Map();
  for (const project of required) {
    const source = sources.find((s) => s.projects.includes(project));
    const label = source === undefined ? '' : `coverage of ${source.projects.join('+')}`;
    if (source === undefined) out.set(project, `no coverage run selected project ${project}`);
    else if (source.problem !== null || source.map === null) out.set(project, source.problem ?? `${label} is missing`);
    else if (Object.keys(source.map).length === 0) out.set(project, `${label} is empty (no file measured)`);
    else if (Object.values(source.map).every(isPlaceholder))
      out.set(project, `${label} executed no source file (every entry is an untested placeholder)`);
    else {
      /** @type {string[]} */
      let listed;
      try {
        listed = listTests(project);
      } catch {
        out.set(project, `jest --listTests for project ${project} failed`);
        continue;
      }
      const ran = new Set((source.ranTests ?? []).map(key));
      if (listed.length === 0) out.set(project, `project ${project} has no test files (ran 0 test files)`);
      else if (source.ranTests === null)
        out.set(project, `${label}: no readable Jest report, so project ${project} is not shown to have run`);
      else if (!listed.some((file) => ran.has(key(file))))
        out.set(project, `project ${project} ran 0 of its ${listed.length} test file(s)`);
      else out.set(project, null);
    }
  }
  return out;
}

/**
 * Test files a Jest JSON report (`--json --outputFile`) says ran, or null when the report is absent or unreadable.
 * @param {string} file
 * @returns {string[] | null}
 */
export function readRanTests(file) {
  /** @type {unknown} */
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const results = isRecord(report) ? report['testResults'] : undefined;
  if (!Array.isArray(results)) return null;
  return results.flatMap((r) => (isRecord(r) && typeof r['name'] === 'string' ? [r['name']] : []));
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
