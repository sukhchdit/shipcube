/**
 * Ignore-file anchoring (PR2-SEC-11, PR #2 code review R2-m1 and R2-n8; TASK-007).
 *  - `.gitignore`: output and scratch folders are ignored at the repository root and the workspace roots only, so a
 *    source folder named `coverage`, `build`, `dist`, `logs`, `tmp` … is never silently untracked.
 *  - `.stylelintignore` and the ESLint `globalIgnores` cover the same matrix (no tool skips what the other lints).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const ROOT = findRepoRoot();

/** `git check-ignore --no-index` decides from the ignore rules alone, whether or not the path exists or is tracked. */
function isGitIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (error) {
    // Exit 1 = not ignored; anything else (128 = fatal) is a real failure.
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

const OUTPUT_DIRS = [
  'dist',
  'build',
  'out',
  'coverage',
  'logs',
  'tmp',
  'temp',
  'uploads',
  'test-results',
  'playwright-report',
  'k6-results',
];
const WORKSPACE_ROOTS = ['', 'apps/api/', 'apps/web/', 'packages/shared/', 'tests/e2e/', 'prisma/'];

describe('.gitignore anchoring (PR2-SEC-11, R2-m1)', () => {
  it.each(WORKSPACE_ROOTS.flatMap((root) => OUTPUT_DIRS.map((dir) => `${root}${dir}/x.js`)))('ignored: %s', (path) => {
    expect(isGitIgnored(path)).toBe(true);
  });

  it.each([
    'packages/shared/src/coverage/a.ts',
    'packages/carriers/src/build/a.ts',
    'packages/carriers/src/dist/a.ts',
    'apps/api/src/modules/shipments/build/a.ts',
    'apps/api/src/platform/logs/redact.ts',
    'apps/api/src/modules/documents/tmp/a.ts',
    'apps/web/app/routes/uploads/route.tsx',
    'packages/pricing/src/out/a.ts',
    'tools/ci/fixtures/coverage/a.json',
  ])('tracked (source folder named like an output folder): %s', (path) => {
    expect(isGitIgnored(path)).toBe(false);
  });

  it.each([
    'node_modules/x/index.js',
    'apps/web/node_modules/x.js',
    '.env',
    'apps/api/.env.local',
    'a.pem',
    'apps/web/.react-router/types/x.ts',
    'prisma/generated/client.ts',
    'x.tsbuildinfo',
  ])('still ignored at any depth: %s', (path) => {
    expect(isGitIgnored(path)).toBe(true);
  });

  it('.env.example stays tracked', () => {
    expect(isGitIgnored('.env.example')).toBe(false);
  });
});

/** Expands one level of `{a,b}` alternatives (all the ESLint ignore globs use). */
function expandBraces(glob: string): string[] {
  const match = /\{([^{}]+)\}/u.exec(glob);
  if (match === null) return [glob];
  return (match[1] ?? '').split(',').flatMap((option) => expandBraces(glob.replace(match[0], option)));
}

/** ESLint `globalIgnores([...])` entries, as anchored gitignore-style folder lines (`/dist/`, `node_modules/`). */
function eslintIgnoreLines(): Set<string> {
  const config = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
  const block = /globalIgnores\(\[([\s\S]*?)\]\)/u.exec(config)?.[1] ?? '';
  const globs = [...block.matchAll(/^\s*'([^']+)',/gmu)].map((m) => m[1] ?? '');
  expect(globs.length).toBeGreaterThan(5);
  return new Set(
    globs.flatMap(expandBraces).map((glob) => (glob === '**/node_modules/**' ? 'node_modules/' : `/${glob.replace(/\/\*\*$/u, '')}/`)),
  );
}

function stylelintIgnoreLines(): Set<string> {
  const lines = readFileSync(join(ROOT, '.stylelintignore'), 'utf8').split(/\r?\n/u);
  return new Set(lines.map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#')));
}

describe('.stylelintignore and ESLint globalIgnores are symmetric (R2-n8)', () => {
  it('both ignore exactly the same folders', () => {
    expect([...stylelintIgnoreLines()].sort()).toEqual([...eslintIgnoreLines()].sort());
  });
});
