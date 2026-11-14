// @ts-check
/**
 * V8 block-coverage range trees and their merge (PR #40 code review R1-M1; D-TASK015-20, D-TASK015-28). An in-house
 * port of the `mergeFunctionCovs` semantics of @bcoe/v8-coverage, the library Jest uses to merge the V8 coverage of
 * all test files of ONE run before v8-to-istanbul converts it. tools/ci/coverage-merge.mjs applies the same merge
 * across runs, per function, so a range one run coalesced (two adjacent siblings with equal counts) is split against
 * the other run exactly as Jest would split it, instead of surviving as an extra key.
 *
 * Offsets are plain integers here (coverage-merge.mjs compresses istanbul positions to integers first). A tree node's
 * `delta` is its count minus its parent's count, as in the original.
 *
 * Adapted from @bcoe/v8-coverage 0.2.3 (src/lib/range-tree.ts, src/lib/merge.ts `mergeFunctionCovs` /
 * `mergeRangeTrees` / `mergeRangeTreeChildren` / `StartEventQueue`, src/lib/normalize.ts), no dependency added
 * (D-TASK015-20). Changes: JavaScript with JSDoc types; `fromSortedRanges` clips a range that crosses its parent (a
 * source-map artefact; V8 itself emits nested ranges only); `mergeFunctionTrees` takes ranges and returns ranges.
 *
 * The MIT License (MIT)
 *
 * Copyright © 2015-2017 Charles Samborski
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/** @typedef {{ start: number, end: number, count: number }} RangeCov */

/** Pre-order: ascending start, then descending end (@bcoe `compareRangeCovs`). @param {RangeCov} a @param {RangeCov} b */
export const comparePreOrder = (a, b) => a.start - b.start || b.end - a.end;

export class RangeTree {
  /**
   * @param {number} start
   * @param {number} end
   * @param {number} delta count minus the parent's count
   * @param {RangeTree[]} children
   */
  constructor(start, end, delta, children) {
    this.start = start;
    this.end = end;
    this.delta = delta;
    this.children = children;
  }

  /**
   * The tree of one function's ranges (pre-order sorted, first = the function's root range).
   * @param {readonly RangeCov[]} ranges
   * @returns {RangeTree | undefined}
   */
  static fromSortedRanges(ranges) {
    /** @type {RangeTree | undefined} */
    let root;
    /** @type {Array<[RangeTree, number]>} */
    const stack = [];
    for (const range of ranges) {
      if (root === undefined) {
        root = new RangeTree(range.start, range.end, range.count, []);
        stack.push([root, range.count]);
        continue;
      }
      /** @type {[RangeTree, number]} */
      let top = /** @type {[RangeTree, number]} */ (stack[stack.length - 1]);
      while (range.start >= top[0].end && stack.length > 1) {
        stack.pop();
        top = /** @type {[RangeTree, number]} */ (stack[stack.length - 1]);
      }
      const [parent, parentCount] = top;
      // Deviation: clip to the parent so the tree stays laminar (pre-order sorted V8 ranges never cross).
      const node = new RangeTree(Math.max(range.start, parent.start), Math.min(range.end, parent.end), range.count - parentCount, []);
      if (node.start >= node.end && range.start < range.end) continue;
      parent.children.push(node);
      stack.push([node, range.count]);
    }
    return root;
  }

  /**
   * Merges adjacent children with equal deltas and folds a single child that spans the whole node (recursively).
   *
   * Deviation (`conservative`, used across runs; D-TASK015-28): a chain of adjacent equal-delta children whose count is
   * 0 stays as separate nodes, unless the chain spans this covered node (the original would merge it and then fold this
   * node away, so that case keeps the original's result); and a spanning child is folded only when this node's count
   * is > 0. Nothing under an uncovered node ran, so the conservative tree has exactly the original's covered nodes and
   * at least its uncovered ones: its branch percentage is never above the original's. It matters where istanbul
   * positions make two ranges touch that were apart in the V8 offsets (a source map sends distinct offsets to one
   * original position).
   * @param {boolean} [conservative]
   * @param {number} [parentCount] count of the parent (0 for the root)
   */
  normalize(conservative = false, parentCount = 0) {
    const count = parentCount + this.delta;
    // The original's chains: adjacent children with equal deltas (decided on the deltas before any child is normalized).
    /** @type {RangeTree[][]} */
    const chains = [];
    let curEnd = Number.NaN;
    for (const child of this.children) {
      const chain = chains[chains.length - 1];
      if (chain !== undefined && child.delta === chain[0]?.delta && child.start === curEnd) chain.push(child);
      else chains.push([child]);
      curEnd = child.end;
    }
    const first = chains[0]?.[0];
    const last = chains[0]?.[chains[0].length - 1];
    const spansThis = chains.length === 1 && first?.start === this.start && last?.end === this.end;
    /** @type {RangeTree[]} */
    const children = [];
    for (const chain of chains) {
      const head = /** @type {RangeTree} */ (chain[0]);
      if (conservative && chain.length > 1 && count + head.delta === 0 && !(spansThis && count > 0)) {
        for (const child of chain) {
          child.normalize(conservative, count);
          children.push(child);
        }
        continue;
      }
      head.end = /** @type {RangeTree} */ (chain[chain.length - 1]).end;
      for (const tailTree of chain.slice(1))
        for (const subChild of tailTree.children) {
          subChild.delta += tailTree.delta - head.delta;
          head.children.push(subChild);
        }
      head.normalize(conservative, count);
      children.push(head);
    }
    if (children.length === 1 && (!conservative || count > 0)) {
      const only = /** @type {RangeTree} */ (children[0]);
      if (only.start === this.start && only.end === this.end) {
        this.delta += only.delta;
        this.children = only.children;
        return;
      }
    }
    this.children = children;
  }

  /**
   * Splits the node at `value` (`start < value < end`); this node keeps the left part.
   * @param {number} value
   * @returns {RangeTree} the right part
   */
  split(value) {
    let leftChildLen = this.children.length;
    /** @type {RangeTree | undefined} */
    let mid;
    for (let i = 0; i < this.children.length; i += 1) {
      const child = /** @type {RangeTree} */ (this.children[i]);
      if (child.start < value && value < child.end) {
        mid = child.split(value);
        leftChildLen = i + 1;
        break;
      } else if (child.start >= value) {
        leftChildLen = i;
        break;
      }
    }
    const rightChildren = this.children.splice(leftChildLen, this.children.length - leftChildLen);
    if (mid !== undefined) rightChildren.unshift(mid);
    const right = new RangeTree(value, this.end, this.delta, rightChildren);
    this.end = value;
    return right;
  }

  /** @returns {RangeCov[]} the ranges in pre-order with absolute counts */
  toRanges() {
    /** @type {RangeCov[]} */
    const ranges = [];
    /** @type {Array<[RangeTree, number]>} */
    const stack = [[this, 0]];
    while (stack.length > 0) {
      const [cur, parentCount] = /** @type {[RangeTree, number]} */ (stack.pop());
      const count = parentCount + cur.delta;
      ranges.push({ start: cur.start, end: cur.end, count });
      for (let i = cur.children.length - 1; i >= 0; i -= 1) stack.push([/** @type {RangeTree} */ (cur.children[i]), count]);
    }
    return ranges;
  }
}

/**
 * @param {readonly RangeTree[]} trees same start and end
 * @returns {RangeTree | undefined}
 */
function mergeRangeTrees(trees) {
  if (trees.length <= 1) return trees[0];
  const first = /** @type {RangeTree} */ (trees[0]);
  let delta = 0;
  for (const tree of trees) delta += tree.delta;
  return new RangeTree(first.start, first.end, delta, mergeRangeTreeChildren(trees));
}

/** @typedef {{ parentIndex: number, tree: RangeTree }} TreeWithParent */
/** @typedef {{ offset: number, trees: TreeWithParent[] }} StartEvent */

class StartEventQueue {
  /** @param {StartEvent[]} queue */
  constructor(queue) {
    this.queue = queue;
    this.nextIndex = 0;
    this.pendingOffset = 0;
    /** @type {TreeWithParent[] | undefined} */
    this.pendingTrees = undefined;
  }

  /** @param {readonly RangeTree[]} parentTrees */
  static fromParentTrees(parentTrees) {
    /** @type {Map<number, TreeWithParent[]>} */
    const startToTrees = new Map();
    parentTrees.forEach((parentTree, parentIndex) => {
      for (const child of parentTree.children) {
        const trees = startToTrees.get(child.start) ?? [];
        trees.push({ parentIndex, tree: child });
        startToTrees.set(child.start, trees);
      }
    });
    /** @type {StartEvent[]} */
    const queue = [...startToTrees].map(([offset, trees]) => ({ offset, trees }));
    queue.sort((a, b) => a.offset - b.offset);
    return new StartEventQueue(queue);
  }

  /** @param {number} offset */
  setPendingOffset(offset) {
    this.pendingOffset = offset;
  }

  /** @param {TreeWithParent} tree */
  pushPendingTree(tree) {
    if (this.pendingTrees === undefined) this.pendingTrees = [];
    this.pendingTrees.push(tree);
  }

  /** @returns {StartEvent | undefined} */
  next() {
    const pendingTrees = this.pendingTrees;
    const nextEvent = this.queue[this.nextIndex];
    if (pendingTrees === undefined) {
      this.nextIndex += 1;
      return nextEvent;
    }
    if (nextEvent === undefined) {
      this.pendingTrees = undefined;
      return { offset: this.pendingOffset, trees: pendingTrees };
    }
    if (this.pendingOffset < nextEvent.offset) {
      this.pendingTrees = undefined;
      return { offset: this.pendingOffset, trees: pendingTrees };
    }
    if (this.pendingOffset === nextEvent.offset) {
      this.pendingTrees = undefined;
      for (const tree of pendingTrees) nextEvent.trees.push(tree);
    }
    this.nextIndex += 1;
    return nextEvent;
  }
}

/**
 * @param {readonly RangeTree[]} parentTrees
 * @returns {RangeTree[]}
 */
function mergeRangeTreeChildren(parentTrees) {
  /** @type {RangeTree[]} */
  const result = [];
  const queue = StartEventQueue.fromParentTrees(parentTrees);
  /** @type {Map<number, RangeTree[]>} */
  const parentToNested = new Map();
  /** @type {{ start: number, end: number } | undefined} */
  let openRange;
  for (;;) {
    const event = queue.next();
    if (event === undefined) break;
    if (openRange !== undefined && openRange.end <= event.offset) {
      result.push(nextChild(openRange, parentToNested));
      openRange = undefined;
    }
    if (openRange === undefined) {
      let openRangeEnd = event.offset + 1;
      for (const { parentIndex, tree } of event.trees) {
        openRangeEnd = Math.max(openRangeEnd, tree.end);
        insertChild(parentToNested, parentIndex, tree);
      }
      queue.setPendingOffset(openRangeEnd);
      openRange = { start: event.offset, end: openRangeEnd };
    } else {
      for (const { parentIndex, tree } of event.trees) {
        if (tree.end > openRange.end) queue.pushPendingTree({ parentIndex, tree: tree.split(openRange.end) });
        insertChild(parentToNested, parentIndex, tree);
      }
    }
  }
  if (openRange !== undefined) result.push(nextChild(openRange, parentToNested));
  return result;
}

/** @param {Map<number, RangeTree[]>} parentToNested @param {number} parentIndex @param {RangeTree} tree */
function insertChild(parentToNested, parentIndex, tree) {
  const nested = parentToNested.get(parentIndex) ?? [];
  nested.push(tree);
  parentToNested.set(parentIndex, nested);
}

/**
 * @param {{ start: number, end: number }} openRange
 * @param {Map<number, RangeTree[]>} parentToNested
 * @returns {RangeTree}
 */
function nextChild(openRange, parentToNested) {
  /** @type {RangeTree[]} */
  const matchingTrees = [];
  for (const nested of parentToNested.values()) {
    const only = nested[0];
    if (nested.length === 1 && only !== undefined && only.start === openRange.start && only.end === openRange.end) matchingTrees.push(only);
    else matchingTrees.push(new RangeTree(openRange.start, openRange.end, 0, nested));
  }
  parentToNested.clear();
  return /** @type {RangeTree} */ (mergeRangeTrees(matchingTrees));
}

/**
 * `mergeFunctionCovs` over the ranges of one function from several runs (each the same root range first). One input is
 * normalized only, as in the original.
 * @param {ReadonlyArray<readonly RangeCov[]>} runs
 * @param {{ conservative?: boolean }} [options] see `RangeTree.normalize`
 * @returns {RangeCov[]} the merged, normalized ranges in pre-order (root first)
 */
export function mergeFunctionRanges(runs, options = {}) {
  const trees = runs
    .filter((ranges) => ranges.length > 0)
    .map((ranges) => /** @type {RangeTree} */ (RangeTree.fromSortedRanges([...ranges].sort(comparePreOrder))));
  if (trees.length === 0) return [];
  const merged = /** @type {RangeTree} */ (mergeRangeTrees(trees));
  merged.normalize(options.conservative === true);
  return merged.toRanges();
}

/**
 * Removes crossings from the spans of one function (the first span in pre-order is the root). V8 ranges nest, but
 * positions mapped back through a source map can make a range end after the start of the next one (a then-block "ends"
 * inside `} else {`, the operands of `a && b || c` overlap). A span that starts inside an open span and ends after it
 * cuts that open span at its own start (in V8 offsets the two were adjacent siblings); a span that would leave the root
 * is clipped to it. Callers pass the union of all runs' spans, so every run gets the same rewrite and a range keeps one
 * identity across runs.
 * @param {ReadonlyArray<{ start: number, end: number }>} spans distinct spans
 * @returns {Array<{ start: number, end: number } | null>} the rewritten span per input (same order), null when cut to nothing
 */
export function uncrossSpans(spans) {
  const work = spans.map((s, i) => ({ start: s.start, end: s.end, count: i, gone: false }));
  /** @type {typeof work} */
  const stack = [];
  for (const span of [...work].sort(comparePreOrder)) {
    while (stack.length > 0) {
      const top = /** @type {(typeof work)[number]} */ (stack[stack.length - 1]);
      if (span.start >= top.end) stack.pop();
      else if (span.end > top.end && stack.length > 1) {
        top.end = span.start;
        top.gone = top.start >= top.end;
        stack.pop();
      } else {
        if (span.end > top.end) {
          span.end = top.end;
          span.gone = span.start >= span.end;
        }
        break;
      }
    }
    if (!span.gone) stack.push(span);
  }
  return work.map((s) => (s.gone ? null : { start: s.start, end: s.end }));
}
