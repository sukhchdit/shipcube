/**
 * No image-shipped workspace exports a pruned path (PR #53 code review R2-B1; US-012, image build TASK-014).
 *
 * The image preflight (`preflight.mjs`) imports every non-wildcard `exports` entry of every `@platform/*` dependency of the
 * api and worker through its `default` condition, after prune-dist (`prune-dist.mjs`) has deleted `tests/`, `fixtures/`,
 * `*.test.*` and the other test seams from dist. An export whose `default` target is pruned therefore fails `docker build`
 * with "cannot load @platform/<pkg>/<subpath>" while lane A and lane B (neither builds an image) stay green. This check
 * needs no Docker: it applies prune-dist's own `shouldRemove` to every export target of every workspace manifest.
 * `./testing` subpaths are the one sanctioned test-helper convention (`SKIPPED_EXPORTS`: the preflight never imports them).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { SKIPPED_EXPORTS } from './preflight.mjs';
import { shouldRemove } from './prune-dist.mjs';
import { findRepoRoot } from '../test-support/process.js';

type Manifest = { readonly name?: string; readonly exports?: Record<string, unknown> };

/** Leaf targets of an export entry reached through the `default` condition (a plain string is its own target). */
function defaultTargets(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry];
  if (entry === null || typeof entry !== 'object') return [];
  const conditions = entry as Record<string, unknown>;
  return 'default' in conditions ? defaultTargets(conditions.default) : [];
}

/** True when prune-dist would delete the target file or any directory on its way (a wildcard stands for one segment). */
function isPruned(target: string): boolean {
  const parts = target.replace(/^\.\//, '').replaceAll('*', 'x').split('/');
  return parts.some((_, index) => {
    const rel = parts.slice(0, index + 1).join('/');
    return shouldRemove(rel, index < parts.length - 1);
  });
}

/** `<package name>/<subpath>` of every export of `manifest` (outside the sanctioned test subpaths) whose default target is pruned. */
export function prunedExports(manifest: Manifest): string[] {
  return Object.entries(manifest.exports ?? {})
    .filter(([subpath]) => !SKIPPED_EXPORTS.includes(subpath))
    .filter(([, entry]) => defaultTargets(entry).some(isPruned))
    .map(([subpath]) => `${manifest.name ?? '?'}${subpath.slice(1)}`);
}

const ROOT = findRepoRoot();
const workspaceManifests = ['apps', 'packages']
  .flatMap((group) => readdirSync(join(ROOT, group)).map((dir) => join(ROOT, group, dir, 'package.json')))
  .filter((file) => existsSync(file))
  .map((file) => JSON.parse(readFileSync(file, 'utf8')) as Manifest);

describe('image-shipped package exports survive prune-dist (R2-B1)', () => {
  it('finds the api and worker manifests (the scan is not vacuous)', () => {
    const names = workspaceManifests.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['@platform/api', '@platform/worker', '@platform/config']));
    expect(workspaceManifests.find((m) => m.name === '@platform/api')?.exports).toBeDefined();
  });

  it.each(workspaceManifests.map((m) => [m.name ?? '?', m] as const))('%s exports no path that prune-dist deletes', (_name, manifest) => {
    expect(prunedExports(manifest)).toEqual([]);
  });

  it('never publishes a timing or other test helper through a non-testing subpath of @platform/api', () => {
    const api = workspaceManifests.find((m) => m.name === '@platform/api');
    const subpaths = Object.keys(api?.exports ?? {});
    expect(subpaths.filter((s) => !SKIPPED_EXPORTS.includes(s) && /test|timing/i.test(s))).toEqual([]);
  });

  describe('the check itself', () => {
    const exportOf = (target: string): Manifest => ({
      name: '@platform/x',
      exports: { './helper': { '@platform/source': './src/a.ts', types: './dist/a.d.ts', default: target } },
    });

    it.each([
      ['a tests directory (the R2-B1 export)', './dist/platform/routing/tests/timing.js'],
      ['a fixtures directory', './dist/fixtures/seed.js'],
      ['a __fixtures__ directory', './dist/__fixtures__/seed.js'],
      ['a spikes directory', './dist/spikes/a.js'],
      ['a compiled test file', './dist/a.test.js'],
      ['a wildcard that passes through tests', './dist/tests/*/index.js'],
      ['the query-counter test seam', './dist/platform/db/query-counter.js'],
    ])('flags an export into %s', (_label, target) => {
      expect(prunedExports(exportOf(target))).toEqual(['@platform/x/helper']);
    });

    it('accepts a normal dist target and a string-valued asset export', () => {
      expect(prunedExports(exportOf('./dist/platform/runtime/index.js'))).toEqual([]);
      expect(prunedExports({ name: '@platform/x', exports: { './theme.css': './src/theme.css' } })).toEqual([]);
    });

    it('lets the sanctioned ./testing subpath through (the preflight never imports it)', () => {
      expect(prunedExports({ name: '@platform/x', exports: { './testing': { default: './dist/testing/tests/index.js' } } })).toEqual([]);
    });

    it('flags the exact export that broke the worker image (re-added to the real api manifest)', () => {
      const api = workspaceManifests.find((m) => m.name === '@platform/api');
      const mutant: Manifest = {
        ...api,
        exports: {
          './test-support/timing': { default: './dist/platform/routing/tests/timing.js' },
          ...api?.exports,
        },
      };
      expect(prunedExports(mutant)).toEqual(['@platform/api/test-support/timing']);
    });
  });
});
