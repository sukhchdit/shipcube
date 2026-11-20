/**
 * Code review R2-n6 (TASK-076): `IMPURE_SHARED_EXPORTS` of platform/pricing-purity is a hand-kept deny-list over the
 * `@platform/shared` root, which the boundaries policy allow-lists for packages/pricing. This pin scans every module
 * the shared root re-exports for clock or randomness reads; a new impure module, or a new export from the one impure
 * module, fails here until the deny-list (and this pin) is reviewed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { IMPURE_SHARED_EXPORTS } from '../eslint-rules/pricing-purity.mjs';
import { findRepoRoot } from '../test-support/process.js';

const SHARED_SRC = join(findRepoRoot(), 'packages', 'shared', 'src');
const IMPURE_SOURCE = /\bDate\.now\b|\bnew Date\(\s*\)|\bMath\.random\b|\bcrypto\.|\bperformance\.|from '(?:node:)?crypto'|from 'uuid'/u;

/** `export { a, b, type C } from './x.js'` blocks of the shared root: module -> value export names. */
function rootExports(): Map<string, string[]> {
  const index = readFileSync(join(SHARED_SRC, 'index.ts'), 'utf8');
  const exports = new Map<string, string[]>();
  for (const match of index.matchAll(/export\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/gu)) {
    const names = (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '' && !name.startsWith('type '));
    const module = match[2] ?? '';
    exports.set(module, [...(exports.get(module) ?? []), ...names]);
  }
  return exports;
}

describe('[R2-n6] IMPURE_SHARED_EXPORTS pins the clock and randomness of the @platform/shared root', () => {
  it('only ids/uuidv7 reads the clock or randomness, and its value exports are exactly the known list', () => {
    const exports = rootExports();
    expect(exports.size).toBeGreaterThan(10);
    const impure = [...exports.keys()].filter((module) =>
      IMPURE_SOURCE.test(readFileSync(join(SHARED_SRC, module.replace(/\.js$/u, '.ts')), 'utf8')),
    );
    expect(impure).toEqual(['./ids/uuidv7.js']);
    // The module's pure exports are constants and a format check; its clock/random exports are the deny-list.
    expect([...(exports.get('./ids/uuidv7.js') ?? [])].sort()).toEqual(
      ['ANONYMOUS_ACTOR_ID', 'OPERATOR_ORG_ID', 'SYSTEM_ACTOR_ID', 'isUuidV7', ...IMPURE_SHARED_EXPORTS].sort(),
    );
    expect([...IMPURE_SHARED_EXPORTS].sort()).toEqual(['uuidV7Timestamp', 'uuidv7']);
  });
});
