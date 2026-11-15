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
import { SECURITY_INTEGRATION_PATHS, classify, classifyRange, globsMatch, lockfileChange, securityMatches } from './security-paths.mjs';

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

/** A repository with `files` at the base, then `edit` applied (null deletes) in a head commit; optional extra moves. */
function repoChange(
  files: Record<string, string>,
  edit: Record<string, string | null>,
  moves: Array<[string, string]> = [],
): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'security-paths-'));
  temps.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('README.md', 'base\n');
  for (const [path, text] of Object.entries(files)) write(path, text);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  for (const [path, text] of Object.entries(edit)) {
    if (text === null) rmSync(join(root, path));
    else write(path, text);
  }
  for (const [from, to] of moves) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    git(root, ['mv', from, to]);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'head']);
  return { root, base, head: git(root, ['rev-parse', 'HEAD']) };
}

type Entry = Record<string, unknown>;
const lock = (packages: Record<string, Entry>, version = 3): string =>
  `${JSON.stringify({ name: 'platform', version: '0.0.0', lockfileVersion: version, requires: true, packages }, null, 2)}\n`;
const root0: Entry = { name: 'platform', version: '0.0.0', engines: { node: '>=24' } };
const devJest = (version: string): Entry => ({ version, resolved: `https://registry.npmjs.org/jest/-/jest-${version}.tgz`, dev: true });
const pg = (version: string): Entry => ({ version, resolved: `https://registry.npmjs.org/pg/-/pg-${version}.tgz` });
const basePackages = { '': root0, 'node_modules/jest': devJest('30.0.0'), 'node_modules/pg': pg('8.16.0') };
const LOCK = 'package-lock.json';

describe('security-paths: package-lock.json production-closure rule (ADR-0023 am. L item 2 (b), RR-2)', () => {
  it('lockfileChange: a dev-only bump does not select; prod patch, root entry, dev->prod, new, deleted, corrupt and v1 do', () => {
    const base = lock(basePackages);
    expect(lockfileChange(base, lock({ ...basePackages, 'node_modules/jest': devJest('30.0.1') }))).toEqual({
      selected: false,
      reason: 'package-lock.json: dev-only change (1 entries)',
    });
    // Added and removed dev-only entries, devOptional, and key order alone.
    const reordered = lock({ 'node_modules/pg': pg('8.16.0'), '': root0, 'node_modules/jest': devJest('30.0.0') });
    expect(lockfileChange(base, reordered)).toMatchObject({ selected: false, reason: 'package-lock.json: dev-only change (0 entries)' });
    const devAdded = lock({ ...basePackages, 'node_modules/eslint': { version: '10.0.0', devOptional: true } });
    expect(lockfileChange(base, devAdded).selected).toBe(false);
    const devRemoved = lock({ '': root0, 'node_modules/pg': pg('8.16.0') });
    expect(lockfileChange(base, devRemoved).selected).toBe(false);

    expect(lockfileChange(base, lock({ ...basePackages, 'node_modules/pg': pg('8.16.1') }))).toEqual({
      selected: true,
      reason: 'package-lock.json: production-closure change (node_modules/pg)',
    });
    const engines = lock({ ...basePackages, '': { ...root0, engines: { node: '>=24.1' } } });
    expect(lockfileChange(base, engines)).toMatchObject({ selected: true, reason: expect.stringContaining('(root entry)') });
    // The root entry selects whatever flags it carries.
    const devRoot = (engine: string) => lock({ ...basePackages, '': { ...root0, dev: true, engines: { node: engine } } });
    expect(lockfileChange(devRoot('>=24'), devRoot('>=25')).selected).toBe(true);
    const moved = lock({ ...basePackages, 'node_modules/jest': { version: '30.0.0', resolved: devJest('30.0.0')['resolved'] } });
    expect(lockfileChange(base, moved)).toMatchObject({ selected: true, reason: expect.stringContaining('node_modules/jest') });
    const prodAdded = lock({ ...basePackages, 'node_modules/jose': { version: '6.0.0' } });
    expect(lockfileChange(base, prodAdded).selected).toBe(true);
    const prodRemoved = lock({ '': root0, 'node_modules/jest': devJest('30.0.0') });
    expect(lockfileChange(base, prodRemoved).selected).toBe(true);
    // Lockfile v2 (packages + dependencies) is read through its packages map.
    expect(lockfileChange(lock(basePackages, 2), lock({ ...basePackages, 'node_modules/jest': devJest('30.0.1') }, 2)).selected).toBe(
      false,
    );

    expect(lockfileChange(null, base)).toMatchObject({ selected: true, reason: expect.stringContaining('new lockfile') });
    expect(lockfileChange(base, null)).toMatchObject({ selected: true, reason: expect.stringContaining('deleted lockfile') });
    expect(lockfileChange(base, '{ not json')).toMatchObject({ selected: true, reason: expect.stringContaining('unparseable') });
    expect(lockfileChange(base, JSON.stringify({ lockfileVersion: 1, dependencies: {} })).selected).toBe(true);
    expect(lockfileChange(base, JSON.stringify({ packages: [] })).selected).toBe(true);
    expect(lockfileChange(base, 'null').selected).toBe(true);
  });

  it('classifyRange reads both lockfiles from git objects: dev-only bump false, pg patch true, root engines true, corrupt true, new true, dev->prod true', () => {
    const base = { [LOCK]: lock(basePackages) };
    const cases: Array<[string, Record<string, string>, Record<string, string | null>, boolean]> = [
      ['dev-only bump', base, { [LOCK]: lock({ ...basePackages, 'node_modules/jest': devJest('30.0.1') }) }, false],
      ['pg patch', base, { [LOCK]: lock({ ...basePackages, 'node_modules/pg': pg('8.16.1') }) }, true],
      ['root engines', base, { [LOCK]: lock({ ...basePackages, '': { ...root0, engines: { node: '>=25' } } }) }, true],
      ['corrupt', base, { [LOCK]: '{"packages": {' }, true],
      ['new lockfile', {}, { [LOCK]: lock(basePackages) }, true],
      ['deleted lockfile', base, { [LOCK]: null }, true],
      ['dev -> prod', base, { [LOCK]: lock({ ...basePackages, 'node_modules/jest': { version: '30.0.0' } }) }, true],
    ];
    for (const [label, files, edit, selected] of cases) {
      const repo = repoChange(files, edit);
      const result = classifyRange(repo.root, repo.base, repo.head);
      expect([label, result.selected, result.matched]).toEqual([label, selected, selected ? [LOCK] : []]);
      expect(result.reason).toContain('package-lock.json:');
    }
  });

  it('a dev-only lockfile bump next to another security path still selects through that path only', () => {
    const repo = repoChange(
      { [LOCK]: lock(basePackages) },
      { [LOCK]: lock({ ...basePackages, 'node_modules/jest': devJest('30.0.1') }), 'prisma/schema/x.prisma': 'model X {}\n' },
    );
    expect(classifyRange(repo.root, repo.base, repo.head)).toMatchObject({ selected: true, matched: ['prisma/schema/x.prisma'] });
  });

  it('the lockfile is compared against the merge base, not the moved base tip', () => {
    const repo = repoChange({ [LOCK]: lock(basePackages) }, { [LOCK]: lock({ ...basePackages, 'node_modules/jest': devJest('30.0.1') }) });
    // main moves on with a production change the PR does not carry: the PR's own change stays dev-only.
    git(repo.root, ['checkout', '-q', '-b', 'moved', repo.base]);
    writeFileSync(join(repo.root, LOCK), lock({ ...basePackages, 'node_modules/pg': pg('9.0.0') }));
    git(repo.root, ['commit', '-q', '-am', 'main moves']);
    const moved = git(repo.root, ['rev-parse', 'HEAD']);
    expect(classifyRange(repo.root, moved, repo.head)).toMatchObject({ selected: false, matched: [] });
  });

  it('fails closed on an unknown range and keeps the classify shape for a non-lockfile change', () => {
    const repo = repoChange({}, { 'apps/web/x.ts': 'x\n' });
    expect(classifyRange(repo.root, '0'.repeat(40), repo.head)).toMatchObject({
      selected: true,
      reason: expect.stringContaining('fail closed'),
    });
    expect(classifyRange(repo.root, 'f'.repeat(40), repo.head).selected).toBe(true);
    expect(classifyRange(repo.root, repo.base, repo.head)).toEqual({
      selected: false,
      reason: 'no security-critical path among 1 changed path(s)',
      matched: [],
    });
  });

  it('[review N1] a rename out of prisma/** selects (renames count as both paths)', () => {
    const repo = repoChange({ 'prisma/x.sql': 'select 1;\n' }, {}, [['prisma/x.sql', 'tools/x.sql']]);
    expect(classifyRange(repo.root, repo.base, repo.head)).toMatchObject({ selected: true, matched: ['prisma/x.sql'] });
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

  it('[RR-2] applies the lockfile rule: a dev-only lockfile bump writes false, a production change true', () => {
    const run = (packages: Record<string, Entry>): string => {
      const { root, base, head } = repoChange({ [LOCK]: lock(basePackages) }, { [LOCK]: lock(packages) });
      const output = join(root, 'out.txt');
      const summary = join(root, 'summary.md');
      const r = runNode([script, '--root', root, '--base', base, '--head', head, '--output', output, '--summary', summary], { cwd: root });
      expect(r.status).toBe(0);
      expect(readFileSync(summary, 'utf8')).toContain('package-lock.json: ');
      return readFileSync(output, 'utf8');
    };
    expect(run({ ...basePackages, 'node_modules/jest': devJest('30.0.1') })).toBe('security_paths=false\n');
    expect(run({ ...basePackages, 'node_modules/pg': pg('8.16.1') })).toBe('security_paths=true\n');
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
