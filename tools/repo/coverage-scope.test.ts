/**
 * The coverage gate (COVERAGE_TARGET 85 % line / 75 % branch, TEST-STRATEGY §8) spans the whole repository:
 * every workspace source root must be inside `collectCoverageFrom`, and every coverage include glob must point at
 * a real source root. A source root is a plain directory in a workspace tsconfig `include` (`src`, `app`, `seed`);
 * glob entries there name config files (`*.ts`: vite.config.ts and the like), and `tests` folders and the tests/*
 * workspaces hold test code only. Matching uses `globsToMatcher` from jest-util, the function @jest/transform applies
 * to decide which files to instrument, so this test and Jest cannot disagree about glob semantics.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
    'apps/api/src/modules/index.generated.ts',
    'packages/shared/src/api/types.gen.ts',
    'apps/web/.react-router/types/app/+types/root.ts',
    'prisma/generated/client.ts',
    'apps/web/vite.config.ts',
    'tests/e2e/journeys/booking.spec.ts',
    'tools/repo/structure.ts',
  ])('does not measure test, generated or config file %s', (path) => {
    expect(isMeasured(path)).toBe(false);
  });
});

/**
 * Structural exclusions (PR21-SEC-04): each is a test-code shape, a generated folder, or a re-export/build-time entry
 * point with its reason in jest.config.ts. Anything else excluded from coverage must be an exact, existing path.
 */
const STRUCTURAL_EXCLUSIONS = new Set([
  '!**/*.test.{ts,tsx}',
  '!**/*.d.ts',
  '!**/{tests,fixtures}/**',
  '!**/.react-router/**',
  '!prisma/generated/**',
  '!packages/*/src/index.ts',
  '!apps/*/app/{entry.server.tsx,routes.ts}',
]);
const GENERATED_SUFFIX = /\.(?:generated|gen)\.ts$/u;

/** Exclusions that are neither structural nor an exact existing path (a suffix-wide pattern, a stale path). */
const exclusionFindings = (globs: readonly string[]): string[] =>
  globs
    .filter((glob) => glob.startsWith('!') && !STRUCTURAL_EXCLUSIONS.has(glob))
    .filter((glob) => GLOB_CHARS.test(glob.slice(1)) || !existsSync(join(repoRoot, ...glob.slice(1).split('/'))));

describe('coverage exclusions are exact (PR21-SEC-04)', () => {
  it('[PR21-SEC-04] every ! exclusion is structural or an exact existing path', () => {
    expect(exclusionFindings(coverageGlobs)).toEqual([]);
  });

  it('[PR21-SEC-04] the exact generated-file exclusions equal the tracked *.generated.ts / *.gen.ts files under measured roots', () => {
    const tracked = execFileSync('git', ['ls-files', '*.generated.ts', '*.gen.ts'], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 })
      .split(/\r?\n/u)
      .filter((path) => path !== '' && globsToMatcher(coverageGlobs.filter((glob) => !glob.startsWith('!')))(path));
    const excluded = coverageGlobs.filter((glob) => glob.startsWith('!') && GENERATED_SUFFIX.test(glob)).map((glob) => glob.slice(1));
    expect(excluded.sort()).toEqual(tracked.sort());
    expect(tracked.filter((path) => isMeasured(path))).toEqual([]);
  });

  it('[PR21-SEC-04] mutation: a suffix-wide generated pattern or a stale exact path is reported; a hand-written *.generated.ts is measured', () => {
    expect(exclusionFindings([...coverageGlobs, '!**/*.generated.ts'])).toEqual(['!**/*.generated.ts']);
    expect(exclusionFindings([...coverageGlobs, '!**/*.gen.ts'])).toEqual(['!**/*.gen.ts']);
    expect(exclusionFindings([...coverageGlobs, '!apps/api/src/modules/gone.generated.ts'])).toEqual([
      '!apps/api/src/modules/gone.generated.ts',
    ]);
    expect(isMeasured('packages/carriers/src/dhl/client.generated.ts')).toBe(true);
  });
});
