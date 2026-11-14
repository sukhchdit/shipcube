/**
 * Security-integration path classifier (TASK-015 part 015-B; ADR-0023 am. G item 5): the trigger list, fail-closed
 * cases, parity with the manifest glob dialect, and the CLI on a throw-away repository.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { globsMatch as manifestGlobsMatch } from '../quality/lib/manifest.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';
import { SECURITY_INTEGRATION_PATHS, classify, globsMatch, securityMatches } from './security-paths.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'security-paths.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, args: string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repository with one base commit and one head commit that adds `changed`. */
function repoWith(changed: string[]): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'security-paths-'));
  temps.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  for (const path of changed) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'x\n');
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'head']);
  return { root, base, head: git(root, ['rev-parse', 'HEAD']) };
}

describe('security-paths: classification', () => {
  it('selects exactly the ADR-0023 am. G item 5 paths and the lockfile', () => {
    const selected = [
      'packages/authz/src/index.ts',
      'packages/audit/src/writer.ts',
      'packages/config/src/schema.ts',
      'prisma/migrations/x/migration.sql',
      'prisma/tests/spikes/spk03-rls-tx.int.test.ts',
      'apps/api/src/platform/db/client.ts',
      'apps/api/src/modules/identity/service.ts',
      'package-lock.json',
    ];
    const notSelected = [
      'apps/web/app/root.tsx',
      'docs/sdlc/STATUS.md',
      'apps/api/src/modules/quotes/service.ts',
      'packages/authzx/index.ts',
      'tools/ci/x.mjs',
      'tools/quality/heavy.mjs',
      '.github/workflows/ci.yml',
      'apps/web/package-lock.json',
      'package.json',
    ];
    expect(securityMatches([...selected, ...notSelected])).toEqual(selected);
    expect(SECURITY_INTEGRATION_PATHS).toHaveLength(7);
  });

  it('the copied glob matcher agrees with tools/quality/lib/manifest.mjs on a path corpus', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'tools', 'quality', 'required-suites.json'), 'utf8')) as {
      security_critical_paths: string[];
    };
    const globs = [
      ...SECURITY_INTEGRATION_PATHS,
      ...manifest.security_critical_paths,
      'a/*.ts',
      'a/**/b/*',
      '!prisma/generated/**',
      '**/x',
      'c/*d*e',
    ];
    const paths = [
      'a/b.ts',
      'a/c/b/d',
      'a/b/c',
      'prisma/generated/client.js',
      'prisma/schema/x.prisma',
      'x',
      'q/r/x',
      'c/dXe',
      'c/de',
      'c/d/e',
      '.npmrc',
      '.npmrcx',
      'packages\\audit\\src\\x.ts',
      '',
      '.github',
      'package-lock.json',
    ];
    for (const path of paths)
      for (const glob of globs) expect([path, glob, globsMatch(path, [glob])]).toEqual([path, glob, manifestGlobsMatch(path, [glob])]);
    for (const path of paths) expect([path, globsMatch(path, globs)]).toEqual([path, manifestGlobsMatch(path, globs)]);
  });

  it('fails closed (runs) when the range is unknown', () => {
    expect(classify({ problem: 'the range has no base commit' })).toMatchObject({
      selected: true,
      reason: expect.stringContaining('fail closed'),
    });
    expect(classify({ files: ['apps/web/app/root.tsx'] })).toMatchObject({ selected: false, matched: [] });
  });
});

describe('security-paths: CLI', () => {
  it('writes security_paths=true for a selected change and lists only the selecting paths in the summary', () => {
    const { root, base, head } = repoWith(['packages/audit/src/writer.ts', 'apps/web/x.ts']);
    const output = join(root, 'out.txt');
    const summary = join(root, 'summary.md');
    const r = runNode([script, '--root', root, '--base', base, '--head', head, '--output', output, '--summary', summary], { cwd: root });
    expect(r.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('security_paths=true\n');
    expect(readFileSync(summary, 'utf8')).toContain('`packages/audit/src/writer.ts`');
    expect(readFileSync(summary, 'utf8')).not.toContain('apps/web/x.ts');
  });

  it('writes security_paths=false for other changes, true for a zero or unknown base', () => {
    const { root, base, head } = repoWith(['apps/web/app/x.tsx', 'tools/ci/y.mjs']);
    const run = (b: string): string => {
      const output = join(root, `out-${b.slice(0, 3)}.txt`);
      const r = runNode([script, '--root', root, '--base', b, '--head', head, '--output', output], { cwd: root });
      expect(r.status).toBe(0);
      return readFileSync(output, 'utf8');
    };
    expect(run(base)).toBe('security_paths=false\n');
    expect(run('0'.repeat(40))).toBe('security_paths=true\n');
    expect(run('1'.repeat(40))).toBe('security_paths=true\n');
  });

  it('refuses unknown or missing arguments with exit 2', () => {
    expect(runNode([script, '--bogus', 'x'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--root', repoRoot], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--root', repoRoot, '--head', 'x', '--manifest', 'm.json'], { cwd: repoRoot }).status).toBe(2);
  });
});
