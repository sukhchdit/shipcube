/**
 * check-security-owned-paths (TASK-007; PR5-SEC-04 verification fixtures, PR2-SEC-08 CODEOWNERS coverage). Each case is a
 * throw-away git repository: a base commit, then PR commits.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { ownedPaths, parseCodeowners, patternToRegExp, recordVerdict } from './check-security-owned-paths.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'check-security-owned-paths.mjs');
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, args: string[]): string {
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
  return result.stdout.trim();
}

class Repo {
  readonly root = mkdtempSync(join(tmpdir(), 'owned-paths-'));
  readonly base: string;

  constructor(baseFiles: Record<string, string> = {}) {
    temps.push(this.root);
    git(this.root, ['init', '-q']);
    this.base = this.commit(
      { '.github/CODEOWNERS': '/tools/deps/ @owner\n/.github/ @owner\n', 'README.md': 'x\n', ...baseFiles },
      'chore: base',
    );
  }

  commit(files: Record<string, string>, message = 'feat: change'): string {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(this.root, rel, '..'), { recursive: true });
      writeFileSync(join(this.root, rel), content);
    }
    git(this.root, ['add', '-A']);
    git(this.root, ['commit', '-q', '-m', message]);
    return git(this.root, ['rev-parse', 'HEAD']);
  }

  record(name: string, sha: string, verdict = 'PASS'): string {
    return this.commit(
      {
        [`docs/05-quality/security/${name}`]: `| Branch / head | \`feat/x\` @ \`${sha.slice(0, 7)}\` |\n| **Verdict** | **${verdict}.** |\n`,
      },
      'docs(quality): review',
    );
  }

  check(...extra: string[]) {
    return runNode([script, '--root', this.root, '--base', this.base, '--head', 'HEAD', ...extra], { cwd: repoRoot });
  }
}

describe('check-security-owned-paths (PR5-SEC-04)', () => {
  it('PR5-SEC-04: a PR changing prisma-engines.json without a record fails', () => {
    const repo = new Repo();
    repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^security-review-record: 1 security-owned path\(s\) changed \(tools\/deps\/prisma-engines\.json\)/m);
  });

  it('PR5-SEC-04: a record whose SHA is not a commit of this PR fails', () => {
    const repo = new Repo();
    repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record('PR-0009-TASK-007-security-review.md', repo.base);
    expect(repo.check().status).toBe(1);
  });

  it('PR5-SEC-04: a record naming the reviewed PR commit, verdict not FAIL, passes (the record commit itself may follow)', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record('PR-0009-TASK-007-security-review.md', reviewed, 'PASS_WITH_FOLLOW-UPS');
    const result = repo.check();
    expect(result.stdout).toContain(`pass (docs/05-quality/security/PR-0009-TASK-007-security-review.md @ ${reviewed.slice(0, 7)})`);
    expect(result.status).toBe(0);
  });

  it('PR5-SEC-04: an owned path changed after the reviewed commit invalidates the record', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record('PR-0009-TASK-007-security-review.md', reviewed);
    repo.commit({ 'tools/deps/prisma-engines.json': '{"changed":true}' });
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('changed after it');
  });

  it('PR5-SEC-04: a record whose last verdict is FAIL does not count', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record('PR-0009-TASK-007-security-review.md', reviewed, 'FAIL');
    expect(repo.check().status).toBe(1);
  });

  it('PR5-SEC-04: deleting the CODEOWNERS line in the same PR does not exempt it (base patterns are read too)', () => {
    const repo = new Repo();
    repo.commit({ '.github/CODEOWNERS': '/nothing/ @owner\n', 'tools/deps/prisma-engines.json': '{}' });
    expect(repo.check().status).toBe(1);
  });

  it('a PR that changes no security-owned path passes without a record', () => {
    const repo = new Repo();
    repo.commit({ 'apps/api/src/x.ts': 'export {};\n' });
    expect(repo.check().stdout).toContain('not-required');
  });

  it('--report-only reports a missing record without failing while the base lacks the check, and is refused once the base has it', () => {
    const fresh = new Repo();
    fresh.commit({ 'tools/deps/prisma-engines.json': '{}' });
    expect(fresh.check('--report-only').status).toBe(0);

    const later = new Repo({ 'tools/ci/check-security-owned-paths.mjs': '// base copy\n' });
    later.commit({ 'tools/deps/prisma-engines.json': '{}' });
    expect(later.check('--report-only').status).toBe(2);
  });

  it('usage errors exit 2', () => {
    expect(runNode([script, '--root', repoRoot], { cwd: repoRoot }).status).toBe(2);
  });
});

describe('CODEOWNERS (PR5-SEC-04, PR2-SEC-08)', () => {
  const patterns = parseCodeowners(readFileSync(join(repoRoot, '.github', 'CODEOWNERS'), 'utf8'));

  it.each([
    'tools/deps/prisma-engines.json',
    'tools/deps/prisma-engines.mjs',
    'tools/deps/prisma-cli.mjs',
    'tools/db/audit-ddl-reviewers.json',
    'prisma/bootstrap/00-roles.sql',
    'tools/ci/licence-exceptions.json',
    'packages/authz/src/index.ts',
    'packages/audit/src/index.ts',
    'prisma/migrations/0001_init/migration.sql',
    '.github/workflows/ci.yml',
    'eslint.config.mjs',
    'stylelint.config.mjs',
    '.stylelintignore',
    'tools/eslint-rules/index.mjs',
    'tools/stylelint-rules/hover-in-media.mjs',
    'tools/lint/negative-fixtures.test.ts',
    'tests/fixtures/lint/x.ts',
    '.semgrep/raw-sql.yml',
    '.gitleaks.toml',
    '.npmrc',
    'package-lock.json',
    'packages/config/src/keys.ts',
  ])('%s is security-owned', (path) => {
    expect(ownedPaths([path], patterns)).toEqual([path]);
  });

  it('ordinary source files are not owned', () => {
    expect(ownedPaths(['apps/api/src/server.ts', 'packages/config/src/schema.ts', 'apps/web/package.json'], patterns)).toEqual([]);
  });

  it('pattern semantics: anchored directory, anchored file, unanchored glob', () => {
    expect(patternToRegExp('/tools/ci/').test('tools/ci/a.mjs')).toBe(true);
    expect(patternToRegExp('/tools/ci/').test('x/tools/ci/a.mjs')).toBe(false);
    expect(patternToRegExp('/package.json').test('apps/web/package.json')).toBe(false);
    expect(patternToRegExp('*.sql').test('prisma/migrations/a.sql')).toBe(true);
  });

  it('recordVerdict reads the last verdict of a multi-round record', () => {
    expect(recordVerdict('| **Verdict** | **FAIL.** x |\n## Round 2\n| **Verdict** | **PASS_WITH_FOLLOW-UPS.** |')).toBe(
      'PASS_WITH_FOLLOW-UPS',
    );
    expect(recordVerdict('no verdict here')).toBeNull();
  });
});
