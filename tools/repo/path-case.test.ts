/**
 * Repository invariant (PR40-SEC-04): no two tracked paths differ only in case. tools/ci/coverage-merge.mjs folds the
 * case of coverage file keys on Windows only; on a case-insensitive checkout two such files could not coexist, and on
 * Linux they would be two coverage entries that a Windows merge would fold into one. Keeping the tree free of such pairs
 * keeps both platforms' merged coverage identical.
 */
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

/** Tracked paths (and every parent directory) grouped by their lower-case form; groups of two or more collide. */
function caseCollisions(paths: readonly string[]): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/');
      const set = groups.get(prefix.toLowerCase()) ?? new Set<string>();
      set.add(prefix);
      groups.set(prefix.toLowerCase(), set);
    }
  }
  return [...groups.values()].filter((set) => set.size > 1).map((set) => [...set].sort());
}

describe('tracked paths (PR40-SEC-04)', () => {
  it('[PR40-SEC-04] the collision check finds files and folders that differ only in case', () => {
    expect(caseCollisions(['src/A.ts', 'src/a.ts', 'src/b.ts'])).toEqual([['src/A.ts', 'src/a.ts']]);
    expect(caseCollisions(['Src/x.ts', 'src/y.ts'])).toEqual([['Src', 'src']]);
    expect(caseCollisions(['src/x.ts', 'src/y.ts'])).toEqual([]);
  });

  it('[PR40-SEC-04] no two tracked paths of the repository differ only in case', () => {
    const tracked = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
      cwd: findRepoRoot(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
      .split('\0')
      .filter((p) => p !== '');
    expect(tracked.length).toBeGreaterThan(100);
    expect(caseCollisions(tracked)).toEqual([]);
  });
});
