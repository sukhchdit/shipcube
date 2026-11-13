/**
 * Post-build porcelain gate (TASK-007; ADR-0023 am. I item 4, J item 5; PR1-SEC-03 (b), PR4-SEC-04). The negative fixture is
 * a throw-away git repository whose build script rewrites package.json, as `@react-router/dev` does when it adds `isbot`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { parsePorcelain } from './check-porcelain.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'check-porcelain.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, args: string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

/** A committed repository whose `build.mjs` is the given source; the build is run with node. */
function buildRepo(buildSource: string): { root: string; build: () => number | null } {
  const root = mkdtempSync(join(tmpdir(), 'porcelain-'));
  temps.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node build.mjs' } }, null, 2)}\n`,
  );
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  writeFileSync(join(root, 'build.mjs'), buildSource);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: fixture']);
  return { root, build: () => runNode(['build.mjs'], { cwd: root }).status };
}

describe('check-porcelain', () => {
  it('PR1-SEC-03 (b) negative fixture: a build script that touches package.json fails the gate', () => {
    const { root, build } = buildRepo(
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const pkg = JSON.parse(readFileSync('package.json', 'utf8'));",
        "pkg.dependencies = { isbot: '^5' };",
        "writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');",
      ].join('\n'),
    );
    expect(build()).toBe(0);
    const result = runNode([script, '--root', root], { cwd: repoRoot });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('package.json');
  });

  it('PR1-SEC-03 (b): a build that creates an untracked nested package-lock.json fails the gate', () => {
    const { root, build } = buildRepo(
      "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('apps/web', { recursive: true });\nwriteFileSync('apps/web/package-lock.json', '{}');\n",
    );
    expect(build()).toBe(0);
    const result = runNode([script, '--root', root], { cwd: repoRoot });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('apps/web/package-lock.json');
  });

  it('[PR4-SEC-13] a typegen-phase rewrite of a tracked lint config (appending a rule override) fails the post-lint gate', () => {
    const { root, build } = buildRepo(
      "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('.react-router', { recursive: true });\nwriteFileSync('.react-router/types.d.ts', '');\nappendFileSync('eslint.config.mjs', 'export const override = { rules: {} };\\n');\n",
    );
    writeFileSync(join(root, 'eslint.config.mjs'), 'export default [];\n');
    writeFileSync(join(root, '.gitignore'), 'dist/\n.react-router/\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'chore: lint config']);
    expect(runNode([script, '--root', root], { cwd: repoRoot }).status).toBe(0);
    expect(build()).toBe(0);
    const result = runNode([script, '--root', root], { cwd: repoRoot });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('eslint.config.mjs');
    expect(result.stdout).not.toContain('.react-router');
  });

  it('positive control: a build that writes only git-ignored output passes', () => {
    const { root, build } = buildRepo(
      "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist');\nwriteFileSync('dist/index.js', '');\n",
    );
    expect(build()).toBe(0);
    expect(runNode([script, '--root', root], { cwd: repoRoot }).status).toBe(0);
  });

  it('exit 2 when git cannot report a status (not a repository)', () => {
    const root = mkdtempSync(join(tmpdir(), 'porcelain-none-'));
    temps.push(root);
    expect(runNode([script, '--root', root], { cwd: repoRoot, env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } }).status).toBe(2);
  });

  it('parsePorcelain reads status and path', () => {
    expect(parsePorcelain(' M package.json\n?? apps/web/package-lock.json\n')).toEqual([
      { status: ' M', path: 'package.json' },
      { status: '??', path: 'apps/web/package-lock.json' },
    ]);
  });
});
