/**
 * Security-critical path classifier (TASK-015 part 015-B; ADR-0023 am. G item 5): selects the hosted security-integration
 * job. Fail-closed cases, parity with the manifest glob dialect, and the CLI on a throw-away repository.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { globsMatch as manifestGlobsMatch } from '../quality/lib/manifest.mjs';
import { findRepoRoot, runNode } from '../test-support/process.js';
import { classify, globsMatch, securityGlobs, securityMatches } from './security-paths.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'security-paths.mjs');
const manifestGlobs = (
  JSON.parse(readFileSync(join(repoRoot, 'tools', 'quality', 'required-suites.json'), 'utf8')) as {
    security_critical_paths: string[];
  }
).security_critical_paths;
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
  it('matches the manifest security_critical_paths and nothing else', () => {
    const files = [
      'packages/authz/src/index.ts',
      'prisma/migrations/x/migration.sql',
      'apps/api/src/platform/db/client.ts',
      'apps/api/src/modules/identity/service.ts',
      '.github/workflows/ci.yml',
      '.npmrc',
      'tools/ci/x.mjs',
      'apps/web/app/root.tsx',
      'docs/sdlc/STATUS.md',
      'apps/api/src/modules/quotes/service.ts',
      'packages/authzx/index.ts',
    ];
    expect(securityMatches(files, manifestGlobs)).toEqual(files.slice(0, 7));
  });

  it('the copied glob matcher agrees with tools/quality/lib/manifest.mjs on a path corpus', () => {
    const globs = [...manifestGlobs, 'a/*.ts', 'a/**/b/*', '!prisma/generated/**', '**/x', 'c/*d*e', 'tests/**'];
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
      'tests/e2e/web.spec.ts',
      '.npmrc',
      '.npmrcx',
      'packages\\audit\\src\\x.ts',
      '',
      '.github',
    ];
    for (const path of paths)
      for (const glob of globs) expect([path, glob, globsMatch(path, [glob])]).toEqual([path, glob, manifestGlobsMatch(path, [glob])]);
    for (const path of paths) expect([path, globsMatch(path, globs)]).toEqual([path, manifestGlobsMatch(path, globs)]);
  });

  it('fails closed (runs) on an unknown range, a missing or malformed manifest and an empty list', () => {
    const files = { files: ['apps/web/app/root.tsx'] };
    expect(classify({ problem: 'the range has no base commit' }, { globs: manifestGlobs }).selected).toBe(true);
    for (const text of [
      '',
      '{',
      '[]',
      '{"security_critical_paths": []}',
      '{"security_critical_paths": [1]}',
      '{"security_critical_paths": ["!"]}',
    ]) {
      const globs = securityGlobs(text);
      expect('problem' in globs).toBe(true);
      expect(classify(files, globs)).toMatchObject({ selected: true, reason: expect.stringContaining('fail closed') });
    }
    expect(classify(files, { globs: manifestGlobs })).toMatchObject({ selected: false, matched: [] });
  });
});

describe('security-paths: CLI', () => {
  const manifestFile = (dir: string, text: string): string => {
    const file = join(dir, 'manifest.json');
    writeFileSync(file, text);
    return file;
  };

  it('writes security_paths=true for a security-critical change and lists it in the summary', () => {
    const { root, base, head } = repoWith(['packages/audit/src/writer.ts', 'apps/web/x.ts']);
    const output = join(root, 'out.txt');
    const summary = join(root, 'summary.md');
    const manifest = manifestFile(root, JSON.stringify({ security_critical_paths: manifestGlobs }));
    const r = runNode(
      [script, '--root', root, '--base', base, '--head', head, '--manifest', manifest, '--output', output, '--summary', summary],
      {
        cwd: root,
      },
    );
    expect(r.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('security_paths=true\n');
    expect(readFileSync(summary, 'utf8')).toContain('`packages/audit/src/writer.ts`');
    expect(readFileSync(summary, 'utf8')).not.toContain('apps/web/x.ts');
  });

  it('writes security_paths=false for a change outside the list, true for a zero or unknown base', () => {
    const { root, base, head } = repoWith(['apps/web/app/x.tsx']);
    const manifest = manifestFile(root, JSON.stringify({ security_critical_paths: manifestGlobs }));
    const run = (b: string): string => {
      const output = join(root, `out-${b.length}-${b.slice(0, 3)}.txt`);
      const r = runNode([script, '--root', root, '--base', b, '--head', head, '--manifest', manifest, '--output', output], { cwd: root });
      expect(r.status).toBe(0);
      return readFileSync(output, 'utf8');
    };
    expect(run(base)).toBe('security_paths=false\n');
    expect(run('0'.repeat(40))).toBe('security_paths=true\n');
    expect(run('1'.repeat(40))).toBe('security_paths=true\n');
  });

  it('refuses unknown arguments with exit 2', () => {
    expect(runNode([script, '--bogus', 'x'], { cwd: repoRoot }).status).toBe(2);
    expect(runNode([script, '--root', repoRoot], { cwd: repoRoot }).status).toBe(2);
  });
});
