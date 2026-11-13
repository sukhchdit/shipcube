/**
 * Diff-coverage gate (US-006 / REQ-PLAT-008; TASK-015 sheet: "Diff-coverage gate fails a PR whose changed files are
 * below 85/75 (95 in pricing/audit/authz)"). Fixture lcov text plus a throw-away git repository.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';
import { globsToMatcher } from 'jest-util';

import config from '../../jest.config.js';
import { findRepoRoot, runNode } from '../test-support/process.js';
import { evaluateDiffCoverage, isCoverageScoped, parseLcov, parseUnifiedDiff, thresholdFor } from './diff-coverage.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'diff-coverage.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, args: string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** lcov record for `file` (absolute SF path, as Jest writes it): `hits[i]` is the hit count of line i + 1. */
function lcovRecord(root: string, file: string, hits: number[], brda: string[] = []): string {
  return [`SF:${join(root, file)}`, ...hits.map((h, i) => `DA:${i + 1},${h}`), ...brda.map((b) => `BRDA:${b}`), 'end_of_record'].join('\n');
}

/**
 * Repository with `base` committed on main, then a feature commit adding ten lines to each source file; `lcov` is
 * written to coverage/lcov.info. Returns the root.
 */
function prRepo(files: string[], lcov: (root: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), 'diff-coverage-'));
  temps.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  write(root, 'README.md', 'fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  for (const file of files) write(root, file, Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'feature']);
  write(root, 'coverage/lcov.info', `${lcov(root)}\n`);
  return root;
}

const nine = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0];
const all = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

describe('diff-coverage gate', () => {
  it('[US-006] fails a PR whose changed file is below 85 % of its changed lines; passes at 90 %', () => {
    const below = prRepo(['apps/api/src/a.ts'], (root) => lcovRecord(root, 'apps/api/src/a.ts', [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]));
    const fail = runNode([script, '--root', below, '--base', 'main'], { cwd: below });
    expect(fail.status).toBe(1);
    expect(fail.stdout).toContain('FAIL apps/api/src/a.ts [below]');
    expect(fail.stdout).toContain('uncovered: 9,10');

    const ok = prRepo(['apps/api/src/a.ts'], (root) => lcovRecord(root, 'apps/api/src/a.ts', nine));
    expect(runNode([script, '--root', ok, '--base', 'main'], { cwd: ok }).status).toBe(0);
  });

  it('[US-006] 90 % is below the 95 % diff threshold inside packages/pricing, packages/audit and packages/authz', () => {
    for (const pkg of ['pricing', 'audit', 'authz']) {
      const file = `packages/${pkg}/src/rule.ts`;
      const root = prRepo([file], (r) => lcovRecord(r, file, nine));
      const res = runNode([script, '--root', root, '--base', 'main'], { cwd: root });
      expect(res.status).toBe(1);
      expect(res.stdout).toContain(`FAIL ${file} [below]`);
    }
    const full = prRepo(['packages/authz/src/rule.ts'], (r) => lcovRecord(r, 'packages/authz/src/rule.ts', all));
    expect(runNode([script, '--root', full, '--base', 'main'], { cwd: full }).status).toBe(0);
  });

  it('[US-006] branches on changed lines must reach 75 %; a changed in-scope file lcov does not know fails', () => {
    const branches = prRepo(['apps/api/src/b.ts'], (r) =>
      lcovRecord(r, 'apps/api/src/b.ts', all, ['3,0,0,1', '3,0,1,0', '4,1,0,1', '4,1,1,-']),
    );
    const res = runNode([script, '--root', branches, '--base', 'main'], { cwd: branches });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('branches 50.00% (2/4)');

    const unmeasured = prRepo(['apps/api/src/c.ts', 'apps/api/src/d.ts'], (r) => lcovRecord(r, 'apps/api/src/d.ts', all));
    const out = runNode([script, '--root', unmeasured, '--base', 'main'], { cwd: unmeasured });
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('FAIL apps/api/src/c.ts [unmeasured]');
  });

  it('[US-006] out-of-scope files (tests, tools, generated) are ignored; no --base or a bad ref exits 2', () => {
    const root = prRepo(['apps/api/src/a.test.ts', 'tools/ci/x.mjs', 'packages/shared/src/api/types.gen.ts'], () => '');
    const res = runNode([script, '--root', root, '--base', 'main'], { cwd: root });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('PASS (0 changed source file(s))');
    expect(runNode([script, '--root', root], { cwd: root }).status).toBe(2);
    expect(runNode([script, '--root', root, '--base', 'no-such-ref'], { cwd: root }).status).toBe(2);
    expect(runNode([script, '--root', root, '--base', '--output=x'], { cwd: root }).status).toBe(2);
  });

  it('[US-006] parsers: hunks with and without counts, deletions, and lcov hit/branch records', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -3 +3 @@',
      '@@ -10,2 +11,3 @@',
      '@@ -20,4 +23,0 @@',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
    ].join('\n');
    expect([...(parseUnifiedDiff(diff).get('x.ts') ?? [])]).toEqual([3, 11, 12, 13]);
    const lcov = parseLcov('SF:/r/x.ts\nDA:3,0\nDA:11,2\nBRDA:11,0,0,-\nBRDA:11,0,1,4\nend_of_record\n', '/r');
    expect(lcov.get('x.ts')?.branches.get(11)).toEqual({ total: 2, covered: 1 });
    expect(() => parseLcov('SF:/r/x.ts\nDA:x,1\n', '/r')).toThrow('malformed lcov');
    expect(evaluateDiffCoverage(new Map([['apps/api/src/t.ts', new Set([1])]]), new Map())).toEqual([
      expect.objectContaining({ status: 'unmeasured' }),
    ]);
    expect(thresholdFor('packages/pricing/src/q.ts')).toEqual({ lines: 95, branches: 95 });
    expect(thresholdFor('apps/web/app/q.tsx')).toEqual({ lines: 85, branches: 75 });
  });

  it('[US-006] isCoverageScoped mirrors jest.config.ts collectCoverageFrom (drift fails here)', () => {
    expect(config.collectCoverageFrom).toEqual([
      '{apps,packages}/*/{src,app}/**/*.{ts,tsx}',
      'prisma/seed/**/*.{ts,tsx}',
      '!**/*.test.{ts,tsx}',
      '!**/*.d.ts',
      '!apps/api/src/modules/index.generated.ts',
      '!packages/shared/src/api/types.gen.ts',
      '!**/{tests,fixtures}/**',
      '!**/.react-router/**',
      '!prisma/generated/**',
      '!packages/*/src/index.ts',
      '!apps/*/app/{entry.server.tsx,routes.ts}',
    ]);
    const cases: Array<[string, boolean]> = [
      ['apps/api/src/server.ts', true],
      ['apps/web/app/root.tsx', true],
      ['packages/authz/src/guard.ts', true],
      ['prisma/seed/run.ts', true],
      ['apps/api/src/server.test.ts', false],
      ['apps/web/app/x.test.tsx', false],
      ['packages/x/src/types.d.ts', false],
      ['apps/api/src/modules/index.generated.ts', false],
      ['packages/shared/src/api/types.gen.ts', false],
      ['apps/api/src/modules/a/tests/helper.ts', false],
      ['packages/x/src/fixtures/f.ts', false],
      ['apps/web/.react-router/types/x.ts', false],
      ['prisma/generated/client.ts', false],
      ['packages/pricing/src/index.ts', false],
      ['packages/pricing/src/rules/index.ts', true],
      ['apps/web/app/entry.server.tsx', false],
      ['apps/admin/app/routes.ts', false],
      ['tools/ci/x.ts', false],
      ['apps/api/src/x.mjs', false],
    ];
    // Jest's own matcher over the same globs agrees with the predicate on every case.
    const jestMatch = globsToMatcher(config.collectCoverageFrom ?? []);
    for (const [path, scoped] of cases) {
      expect([path, isCoverageScoped(path)]).toEqual([path, scoped]);
      expect([path, jestMatch(path)]).toEqual([path, scoped]);
    }
  });
});
