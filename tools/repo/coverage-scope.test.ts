/**
 * The coverage gate (COVERAGE_TARGET 85 % line / 75 % branch, TEST-STRATEGY §8) spans the whole repository:
 * every workspace source root must be inside `collectCoverageFrom`, and every coverage include glob must point at
 * a real source root. A source root is a plain directory in a workspace tsconfig `include` (`src`, `app`, `seed`);
 * glob entries there name config files (`*.ts`: vite.config.ts and the like), and `tests` folders and the tests/*
 * workspaces hold test code only. Matching uses `globsToMatcher` from jest-util, the function @jest/transform applies
 * to decide which files to instrument, so this test and Jest cannot disagree about glob semantics.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { globsToMatcher } from 'jest-util';

import jestConfig from '../../jest.config.js';
import { findRepoRoot } from '../test-support/process.js';
import { listManifests } from './workspaces.js';

const repoRoot = findRepoRoot();
const coverageGlobs = jestConfig.collectCoverageFrom ?? [];
const isMeasured = globsToMatcher(coverageGlobs);

/** Workspaces that hold only test code (Playwright, k6, generated contract tests). */
const TEST_ONLY_WORKSPACE = /^tests\//;
/** `include` entries that name test folders rather than sources. */
const TEST_FOLDERS = new Set(['tests']);
const GLOB_CHARS = /[*?{}[\]]/;

interface TsConfig {
  include?: string[];
  compilerOptions?: { jsx?: string };
}

interface SourceRoot {
  root: string;
  extensions: string[];
}

const readTsconfig = (dir: string): TsConfig =>
  JSON.parse(readFileSync(join(repoRoot, ...dir.split('/'), 'tsconfig.json'), 'utf8')) as TsConfig;

const sourceRoots: SourceRoot[] = listManifests(repoRoot)
  .filter(({ dir }) => dir !== '.' && !TEST_ONLY_WORKSPACE.test(dir))
  .flatMap(({ dir }) => {
    const tsconfig = readTsconfig(dir);
    const extensions = tsconfig.compilerOptions?.jsx === undefined ? ['ts'] : ['ts', 'tsx'];
    return (tsconfig.include ?? [])
      .filter((entry) => !GLOB_CHARS.test(entry) && !TEST_FOLDERS.has(entry))
      .map((entry) => ({ root: `${dir}/${entry.replace(/\/+$/, '')}`, extensions }));
  });

/** A representative non-test source file at some depth below a root. */
const samplesOf = ({ root, extensions }: SourceRoot) => extensions.map((ext) => `${root}/feature/nested/module.${ext}`);

describe('coverage scope covers every workspace source root (TEST-STRATEGY §8, PR #1 review M1)', () => {
  it('derives the source roots, including the React Router app/ folders and the Prisma seed', () => {
    const roots = sourceRoots.map(({ root }) => root);
    expect(roots).toEqual(
      expect.arrayContaining(['apps/api/src', 'apps/worker/src', 'apps/web/app', 'apps/admin/app', 'packages/pricing/src', 'prisma/seed']),
    );
  });

  it.each(sourceRoots.map((sourceRoot) => [sourceRoot.root, sourceRoot] as const))('measures sources under %s', (_root, sourceRoot) => {
    const unmeasured = samplesOf(sourceRoot).filter((path) => !isMeasured(path));
    expect(unmeasured).toEqual([]);
  });

  it('has no include glob that misses every source root (no stale globs)', () => {
    const samples = sourceRoots.flatMap(samplesOf);
    const includes = coverageGlobs.filter((glob) => !glob.startsWith('!'));
    const stale = includes.filter((glob) => !samples.some((path) => globsToMatcher([glob])(path)));
    expect(includes.length).toBeGreaterThan(0);
    expect(stale).toEqual([]);
  });

  it.each([
    'apps/api/src/modules/quotes/service/quote.test.ts',
    'apps/api/src/modules/quotes/service/quote.int.test.ts',
    'apps/web/app/routes/home.test.tsx',
    'apps/api/src/modules/quotes/tests/builders.ts',
    'packages/carriers/src/fixtures/dhl-rate.ts',
    'packages/shared/src/types.d.ts',
    'packages/carriers/src/dhl/client.generated.ts',
    'apps/web/.react-router/types/app/+types/root.ts',
    'prisma/generated/client.ts',
    'apps/web/vite.config.ts',
    'tests/e2e/journeys/booking.spec.ts',
    'tools/repo/structure.ts',
  ])('does not measure test, generated or config file %s', (path) => {
    expect(isMeasured(path)).toBe(false);
  });
});
