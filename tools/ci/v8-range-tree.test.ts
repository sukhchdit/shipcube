/**
 * The in-house port of the @bcoe/v8-coverage range-tree merge (PR #40 R1-M1; D-TASK015-28). Hand cases pin the
 * original semantics (fold, coalesce, split); a seeded property test pins the conservative normalization's bound: it
 * keeps exactly the covered nodes of the original and never fewer uncovered ones, so its branch percentage is never
 * higher. (The port was also compared with @bcoe/v8-coverage 0.2.3 itself on 5,000 random merges, 0 differences; that
 * library is not a declared dependency, so the comparison is recorded in the PR, not repeated here.)
 */
import { describe, expect, it } from '@jest/globals';

import { prng } from './coverage-merge-probe.mjs';
import { comparePreOrder, mergeFunctionRanges, RangeTree, uncrossSpans } from './v8-range-tree.mjs';

type R = { start: number; end: number; count: number };
const r = (start: number, end: number, count: number): R => ({ start, end, count });
const flat = (ranges: R[]) => ranges.map((x) => [x.start, x.end, x.count]);
const pct = (ranges: R[]) => ranges.filter((x) => x.count > 0).length / ranges.length;

describe('mergeFunctionRanges: @bcoe/v8-coverage mergeFunctionCovs semantics', () => {
  it('[US-006] [R1-M1] a range one run coalesced is split against the other run and re-coalesced as Jest does (review case g)', () => {
    // Run A: g(1, 0) returns at the first `if`: the rest of the body (35..90) is one coalesced range with count 0.
    // Run B: g(0, 1): the first then-block (20..35) and `return 2` (70..90) are 0.
    const merged = mergeFunctionRanges([
      [r(0, 100, 1), r(35, 90, 0)],
      [r(0, 100, 1), r(20, 35, 0), r(70, 90, 0)],
    ]);
    // = one combined run: then-block + continuation now count 1 each, adjacent, so they coalesce; `return 2` stays 0.
    expect(flat(merged)).toEqual([
      [0, 100, 2],
      [20, 90, 1],
      [70, 90, 0],
    ]);
  });

  it('[US-006] counts are summed through implicit parents; one input is only normalized', () => {
    expect(flat(mergeFunctionRanges([[r(0, 10, 2), r(2, 4, 0)], [r(0, 10, 3)]]))).toEqual([
      [0, 10, 5],
      [2, 4, 3],
    ]);
    // A single child spanning its parent folds; adjacent equal-count siblings coalesce.
    expect(flat(mergeFunctionRanges([[r(0, 10, 1), r(0, 10, 4)]]))).toEqual([[0, 10, 4]]);
    expect(flat(mergeFunctionRanges([[r(0, 10, 1), r(2, 4, 0), r(4, 6, 0)]]))).toEqual([
      [0, 10, 1],
      [2, 6, 0],
    ]);
    expect(mergeFunctionRanges([])).toEqual([]);
  });

  it('[US-006] conservative normalization merges only covered nodes: uncovered siblings and folds under an uncovered parent stay', () => {
    expect(flat(mergeFunctionRanges([[r(0, 10, 1), r(2, 4, 0), r(4, 6, 0)]], { conservative: true }))).toEqual([
      [0, 10, 1],
      [2, 4, 0],
      [4, 6, 0],
    ]);
    expect(flat(mergeFunctionRanges([[r(0, 10, 1), r(2, 4, 3), r(4, 6, 3)]], { conservative: true }))).toEqual([
      [0, 10, 1],
      [2, 6, 3],
    ]);
    expect(flat(mergeFunctionRanges([[r(0, 10, 0), r(0, 10, 0)]], { conservative: true }))).toEqual([
      [0, 10, 0],
      [0, 10, 0],
    ]);
  });

  it('[US-006] [D-TASK015-28] seeded property: conservative keeps the covered nodes and never raises the branch percentage', () => {
    const rnd = prng(28);
    const ri = (n: number) => Math.floor(rnd() * n);
    const tree = (lo: number, hi: number, parent: number, depth: number, out: R[]) => {
      let at = lo;
      while (at < hi - 2 && depth < 4) {
        if (rnd() < 0.3) {
          at += 1 + ri(3);
          continue;
        }
        const end = Math.min(hi, at + 2 + ri(15));
        let count = ri(3);
        if (count === parent) count = (count + 1) % 3;
        if (parent === 0) break;
        out.push(r(at, end, count));
        tree(at + 1, end - 1, count, depth + 1, out);
        at = rnd() < 0.5 ? end : end + ri(3); // adjacent siblings half of the time
      }
    };
    const fn = () => {
      const root = ri(3);
      const out = [r(0, 60, root)];
      if (root > 0) tree(1, 59, root, 0, out);
      return out.sort(comparePreOrder);
    };
    let differed = 0;
    for (let i = 0; i < 2000; i += 1) {
      const runs = Array.from({ length: 1 + ri(3) }, fn);
      const plain = mergeFunctionRanges(runs.map((x) => x.map((y) => ({ ...y }))));
      const safe = mergeFunctionRanges(
        runs.map((x) => x.map((y) => ({ ...y }))),
        { conservative: true },
      );
      expect(safe.filter((x) => x.count > 0).length).toBe(plain.filter((x) => x.count > 0).length);
      expect(safe.length).toBeGreaterThanOrEqual(plain.length);
      expect(pct(safe)).toBeLessThanOrEqual(pct(plain));
      if (safe.length !== plain.length) differed += 1;
    }
    expect(differed).toBeGreaterThan(0); // the property is exercised, not vacuous
  });

  it('[US-006] fromSortedRanges clips a range that would leave its parent (source-map artefact) and drops one cut to nothing', () => {
    const tree = RangeTree.fromSortedRanges([r(0, 10, 1), r(2, 12, 0), r(12, 14, 3)]);
    expect(tree?.toRanges().map((x) => [x.start, x.end, x.count])).toEqual([
      [0, 10, 1],
      [2, 10, 0],
    ]);
  });
});

describe('uncrossSpans (positions mapped through a source map)', () => {
  it('[US-006] a span that starts inside an open span and ends after it cuts the open one at its start; the root clips', () => {
    expect(
      uncrossSpans([
        { start: 0, end: 100 },
        { start: 10, end: 44 }, // then-block "ends" inside `} else {`
        { start: 40, end: 60 }, // else-block
        { start: 50, end: 120 }, // leaves the root
        { start: 20, end: 30 },
      ]),
    ).toEqual([
      { start: 0, end: 100 },
      { start: 10, end: 40 },
      { start: 40, end: 50 },
      { start: 50, end: 100 },
      { start: 20, end: 30 },
    ]);
    // Operands of `a && b || c` whose mapped spans overlap pairwise become adjacent siblings; a span cut to nothing is null.
    expect(
      uncrossSpans([
        { start: 0, end: 50 },
        { start: 10, end: 21 },
        { start: 15, end: 25 },
        { start: 21, end: 29 },
        { start: 25, end: 31 },
        { start: 10, end: 12 },
        { start: 10, end: 15 },
      ]),
    ).toEqual([
      { start: 0, end: 50 },
      { start: 10, end: 15 },
      { start: 15, end: 21 },
      { start: 21, end: 25 },
      { start: 25, end: 31 },
      { start: 10, end: 12 },
      { start: 10, end: 15 },
    ]);
    expect(
      uncrossSpans([
        { start: 0, end: 9 },
        { start: 3, end: 7 },
        { start: 3, end: 8 },
      ]),
    ).toEqual([
      { start: 0, end: 9 },
      { start: 3, end: 7 },
      { start: 3, end: 8 },
    ]);
  });
});
