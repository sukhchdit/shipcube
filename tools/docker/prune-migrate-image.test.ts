/**
 * prune-migrate-image.mjs (TASK-014; platform.md §3.2 migrate row; ADR-0022 am. 12; PR1-SEC-04 (b), PR1-SEC-05):
 * Prisma Studio and the dev server leave with their exclusive subtrees; shared packages stay; the Studio stub throws
 * only when used; the invariants catch a leftover elkjs or real Studio.
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import type { LockPackages } from './prune-deps.mjs';
import { REMOVE_ROOTS, STUB_VERSION, exclusiveSubtrees, invariantViolations, writeStudioStub } from './prune-migrate-image.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const tree: LockPackages = {
  '': { devDependencies: { tsx: '4' } },
  prisma: { dependencies: { pg: '8' }, devDependencies: { prisma: '7' } },
  'node_modules/prisma': { dependencies: { '@prisma/studio-core': '0.33', '@prisma/dev': '0.24', '@prisma/engines': '7' } },
  'node_modules/@prisma/engines': { dependencies: { '@prisma/get-platform': '7' } },
  'node_modules/@prisma/engines/node_modules/@prisma/get-platform': {},
  'node_modules/@prisma/studio-core': { dependencies: { elkjs: '0.11', '@visx/shape': '4.0.1-alpha.0', pg: '8' } },
  'node_modules/@prisma/dev': { dependencies: { '@prisma/get-platform': '7.2', 'std-env': '3' } },
  'node_modules/@prisma/get-platform': {},
  'node_modules/elkjs': {},
  'node_modules/@visx/shape': { dependencies: { 'd3-shape': '3' } },
  'node_modules/d3-shape': {},
  'node_modules/std-env': {},
  'node_modules/pg': {},
  'node_modules/tsx': { optionalDependencies: { 'std-env': '3' } },
};

describe('prune-migrate-image', () => {
  it('removes Studio and the dev server with their exclusive subtrees only', () => {
    expect(REMOVE_ROOTS).toEqual(['node_modules/@prisma/studio-core', 'node_modules/@prisma/dev']);
    // pg (shared with the prisma workspace) and std-env (also reached from tsx) stay; the nested get-platform of
    // @prisma/engines stays, the hoisted one only @prisma/dev used goes.
    expect(exclusiveSubtrees(tree)).toEqual([
      'node_modules/@prisma/dev',
      'node_modules/@prisma/get-platform',
      'node_modules/@prisma/studio-core',
      'node_modules/@visx/shape',
      'node_modules/d3-shape',
      'node_modules/elkjs',
    ]);
  });

  it('is a no-op when the roots are not installed', () => {
    expect(exclusiveSubtrees({ '': {}, 'node_modules/pg': {} })).toEqual([]);
  });

  it('writes a stub whose module loads but throws on use, and the invariants accept it', () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-migrate-'));
    temps.push(root);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeStudioStub(root);
    // The stub lives in a temporary tree, not in this repository's dependencies: resolve it from there.
    const require = createRequire(join(root, 'index.cjs'));
    const STUDIO = '@prisma/studio-core';
    const bff = require(`${STUDIO}/data/bff`) as Record<string, unknown>;
    expect(bff['__esModule']).toBeUndefined();
    expect(() => (bff['createBFF'] as () => unknown)()).toThrow(/not available in the tooling image/);
    expect((require(`${STUDIO}/package.json`) as { version: string }).version).toBe(STUB_VERSION);
    // prisma/build/cli.js 7.10.1 also requires @prisma/dev/internal/state at module load (first tooling-image build).
    const DEV = '@prisma/dev';
    const state = require(`${DEV}/internal/state`) as Record<string, unknown>;
    expect(() => (state['anything'] as () => unknown)()).toThrow(/not available in the tooling image/);
    expect(invariantViolations(root)).toEqual([]);
  });

  it('reports a leftover elkjs, a real Studio and the dev server', () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-migrate-'));
    temps.push(root);
    for (const [rel, text] of Object.entries({
      'node_modules/elkjs/package.json': '{}',
      'node_modules/@prisma/studio-core/package.json': '{"version":"0.33.0"}',
      'node_modules/@prisma/dev/package.json': '{}',
    })) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    const violations = invariantViolations(root).join('\n');
    expect(violations).toMatch(/elkjs/);
    expect(violations).toMatch(/real package 0\.33\.0/);
    expect(violations).toMatch(/@prisma[\\/]dev/);
  });
});
