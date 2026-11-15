/**
 * The Compose/image stack suite is opt-in (TASK-014): the `stack` Jest project exists only with JEST_STACK=1, the
 * unit project never picks up `*.stack.test.ts`, and `npm run test:stack` is the runner that sets the variable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { stackJestArgs } from './run-stack-tests.mjs';

const root = findRepoRoot();

describe('stack suite gating (TASK-014)', () => {
  it('runs path patterns before --selectProjects stack, in band', () => {
    const args = stackJestArgs(['tests/compose/compose-up']);
    const select = args.indexOf('--selectProjects');
    expect(args.indexOf('tests/compose/compose-up')).toBeLessThan(select);
    expect(args.slice(select, select + 2)).toEqual(['--selectProjects', 'stack']);
    expect(args).toContain('--runInBand');
  });

  it('jest.config.ts adds the stack project only when JEST_STACK=1 and the unit project ignores *.stack.test.ts', () => {
    const config = readFileSync(join(root, 'jest.config.ts'), 'utf8');
    expect(config).toContain("...(process.env.JEST_STACK === '1' ? [{ ...common, displayName: 'stack'");
    expect(config).toContain("'\\\\.(int|api|stack)\\\\.test\\\\.ts$'");
  });

  it('npm run test:stack is the runner; no other script sets JEST_STACK', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:stack']).toBe('node tools/compose/run-stack-tests.mjs');
    expect(Object.values(pkg.scripts).filter((script) => script.includes('JEST_STACK'))).toEqual([]);
  });
});
