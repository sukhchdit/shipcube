/**
 * check-security-owned-paths (TASK-007; PR5-SEC-04 verification fixtures, PR2-SEC-08 CODEOWNERS coverage, PR10-SEC-04
 * record binding, code review PR #10 m2 renames and merge-main). Each case is a throw-away git repository: a base
 * commit, then PR commits.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  ownedPaths,
  parseCodeowners,
  patternToRegExp,
  recordHeadShas,
  recordPrefix,
  recordVerdict,
} from './check-security-owned-paths.mjs';

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

const RECORD = 'PR-0009-TASK-007-security-review.md';
const header = (sha: string, verdict: string) =>
  `| Branch / head | \`feat/x\` @ \`${sha.slice(0, 7)}\` |\n| **Verdict** | **${verdict}.** |\n`;

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

  move(from: string, to: string): string {
    mkdirSync(join(this.root, to, '..'), { recursive: true });
    git(this.root, ['mv', from, to]);
    git(this.root, ['commit', '-q', '-m', 'refactor: move']);
    return git(this.root, ['rev-parse', 'HEAD']);
  }

  recordText(name: string, text: string): string {
    return this.commit({ [`docs/05-quality/security/${name}`]: text }, 'docs(quality): review');
  }

  record(name: string, sha: string, verdict = 'PASS'): string {
    return this.recordText(name, header(sha, verdict));
  }

  /** Runs the check for PR #9 (records `PR-0009-*.md`) unless `extra` names another `--pr`. */
  check(...extra: string[]) {
    return this.checkFrom(this.base, ...extra);
  }

  checkFrom(base: string, ...extra: string[]) {
    const pr = extra.includes('--pr') ? [] : ['--pr', '9'];
    return runNode([script, '--root', this.root, '--base', base, '--head', 'HEAD', ...pr, ...extra], { cwd: repoRoot });
  }
}

describe('check-security-owned-paths (PR5-SEC-04)', () => {
  it('PR5-SEC-04: a PR changing prisma-engines.json without a record fails', () => {
    const repo = new Repo();
    repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^security-review-record: 1 security-owned path\(s\) changed \(tools\/deps\/prisma-engines\.json\)/m);
    expect(result.stdout).toContain('note: no record named docs/05-quality/security/PR-0009-*.md for PR #9');
  });

  it('PR5-SEC-04: a record whose SHA is not a commit of this PR fails', () => {
    const repo = new Repo();
    repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record(RECORD, repo.base);
    expect(repo.check().status).toBe(1);
  });

  it('PR5-SEC-04: a record naming the reviewed PR commit, verdict allow-listed, passes (the record commit itself may follow)', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record(RECORD, reviewed, 'PASS_WITH_FOLLOW-UPS');
    const result = repo.check();
    expect(result.stdout).toContain(`pass (docs/05-quality/security/${RECORD} @ ${reviewed.slice(0, 7)})`);
    expect(result.status).toBe(0);
  });

  it('PR5-SEC-04: an owned path changed after the reviewed commit invalidates the record', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record(RECORD, reviewed);
    repo.commit({ 'tools/deps/prisma-engines.json': '{"changed":true}' });
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('changed after it');
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

describe('record binding (PR10-SEC-04)', () => {
  it('a record named for another PR number does not satisfy the check, even when it names a commit of this PR', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record('PR-0008-TASK-013-security-review.md', reviewed);
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('no record named docs/05-quality/security/PR-0009-*.md');
    expect(repo.check('--pr', '8').status).toBe(0);
  });

  it('a PR number of five digits is not zero-padded away and does not match a four-digit prefix', () => {
    expect(recordPrefix(7)).toBe('PR-0007-');
    expect(recordPrefix(10010)).toBe('PR-10010-');
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record('PR-0010-TASK-007-security-review.md', reviewed);
    expect(repo.check('--pr', '100').status).toBe(1);
    expect(repo.check('--pr', '10').status).toBe(0);
  });

  it.each(['FAIL', 'PENDING', 'TBD', 'BLOCKED', 'PASSED', 'pass'])('a header verdict of %s is not allow-listed and fails', (verdict) => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record(RECORD, reviewed, verdict);
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('is not one of PASS, PASS_WITH_FOLLOW-UPS, PASS_WITH_CONDITIONS');
  });

  it('PASS_WITH_CONDITIONS is allow-listed', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record(RECORD, reviewed, 'PASS_WITH_CONDITIONS');
    expect(repo.check().status).toBe(0);
  });

  it('a record without a Verdict table row fails, even with a prose "Verdict: PASS"', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.recordText(RECORD, `| Branch / head | \`${reviewed.slice(0, 7)}\` |\n\nVerdict: PASS\n`);
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('verdict missing');
  });

  it('a header PASS with a later prose "Verdict: FAIL" and a later fenced example table passes (the header wins)', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    const text = [
      header(reviewed, 'PASS'),
      'Verdict: FAIL would be written like this in prose.',
      '',
      '```markdown',
      '| **Verdict** | **FAIL.** example of a failing record |',
      '| Branch / head | `0000000` |',
      '```',
      '',
      '~~~',
      '| Verdict | PENDING |',
      '~~~',
      '',
    ].join('\n');
    repo.recordText(RECORD, text);
    const result = repo.check();
    expect(result.stdout).toContain(`pass (docs/05-quality/security/${RECORD} @ ${reviewed.slice(0, 7)})`);
    expect(result.status).toBe(0);
  });

  it('the last Verdict row wins: a round-2 FAIL after a round-1 PASS fails', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.recordText(
      RECORD,
      `${header(reviewed, 'PASS')}\n## Round 2\n\n| Head | \`${reviewed.slice(0, 7)}\` |\n| **Verdict** | **FAIL.** regression |\n`,
    );
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('verdict FAIL is not one of');
  });

  it('a commit SHA outside the Branch / head and Head rows does not bind the record', () => {
    const repo = new Repo();
    const reviewed = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.recordText(
      RECORD,
      `| Branch / head | \`feat/x\` |\n| **Verdict** | **PASS.** reviewed \`${reviewed.slice(0, 7)}\` |\n\nReviewed ${reviewed}.\n`,
    );
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('no commit SHA in a "| Branch / head |" or "| Head |" table row');
  });

  it('a `Head / range` row binds the record (later review rounds)', () => {
    const repo = new Repo();
    const first = repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    repo.record(RECORD, first);
    const fixed = repo.commit({ 'tools/deps/prisma-engines.json': '{"fixed":true}' });
    repo.recordText(
      RECORD,
      `${header(first, 'PASS')}\n## Round 2\n\n| Head / range | \`${fixed.slice(0, 7)}\` against round 1 \`${first.slice(0, 7)}\` |\n| **Verdict** | **PASS_WITH_FOLLOW-UPS (unchanged).** |\n`,
    );
    expect(repo.check().stdout).toContain(`@ ${fixed.slice(0, 7)})`);
  });

  it('a change to .claude/settings.json needs a record (agent control plane in CODEOWNERS)', () => {
    const repo = new Repo({ '.github/CODEOWNERS': '/.claude/settings.json @owner\n/.claude/agents/ @owner\n/CLAUDE.md @owner\n' });
    repo.commit({ '.claude/settings.json': '{}\n' });
    expect(repo.check().status).toBe(1);
    const docsOnly = new Repo({ '.github/CODEOWNERS': '/.claude/settings.json @owner\n/.claude/agents/ @owner\n/CLAUDE.md @owner\n' });
    docsOnly.commit({ '.claude/commands/x.md': 'x\n', 'docs/CLAUDE.md': 'x\n' });
    expect(docsOnly.check().stdout).toContain('not-required');
  });
});

describe('diff semantics (code review PR #10 m2)', () => {
  it('(a) a rename out of an owned path reports the old path and requires a record', () => {
    const repo = new Repo({ '.github/CODEOWNERS': '/packages/authz/ @owner\n', 'packages/authz/x.ts': 'export const guard = 1;\n' });
    repo.move('packages/authz/x.ts', 'packages/shared/x.ts');
    const result = repo.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('(packages/authz/x.ts)');
  });

  it('(b) a merge of main that changes an owned path after the reviewed commit does not void the record; a later PR change does', () => {
    const repo = new Repo();
    git(repo.root, ['branch', 'upstream']);
    const reviewed = repo.commit({ 'tools/deps/a.json': '{}' });
    repo.record(RECORD, reviewed);
    git(repo.root, ['checkout', '-q', 'upstream']);
    const mainTip = repo.commit({ 'tools/deps/b.json': '{"from":"main"}' }, 'chore: main moves');
    git(repo.root, ['checkout', '-q', '-']);
    git(repo.root, ['merge', '-q', '--no-edit', 'upstream']);

    const merged = repo.checkFrom(mainTip);
    expect(merged.stdout).toContain(`pass (docs/05-quality/security/${RECORD} @ ${reviewed.slice(0, 7)})`);
    expect(merged.status).toBe(0);

    repo.commit({ 'tools/deps/a.json': '{"after":"review"}' });
    const changed = repo.checkFrom(mainTip);
    expect(changed.status).toBe(1);
    expect(changed.stdout).toContain('but tools/deps/a.json changed after it');
  });
});

describe('events and usage (PR10-SEC-04)', () => {
  let usageRepo: Repo | undefined;

  it('--event push skips the check with exit 0 and a summary line', () => {
    const repo = new Repo();
    repo.commit({ 'tools/deps/prisma-engines.json': '{}' });
    const summaryDir = mkdtempSync(join(tmpdir(), 'owned-paths-summary-'));
    temps.push(summaryDir);
    const summary = join(summaryDir, 'summary.md');
    writeFileSync(summary, '');
    const result = runNode([script, '--root', repo.root, '--base', repo.base, '--event', 'push', '--summary', summary], { cwd: repoRoot });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skipped (record check is a pull-request control; skipped on push)');
    expect(readFileSync(summary, 'utf8')).toContain(
      '### Security-owned paths: skipped (record check is a pull-request control; skipped on push)',
    );
    const json = runNode([script, '--root', repo.root, '--base', repo.base, '--event', 'push', '--pr', '9', '--json'], { cwd: repoRoot });
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 'skipped' });
  });

  it.each([
    ['missing --pr', []],
    ['missing --pr with --report-only', ['--report-only']],
    ['--pr 0', ['--pr', '0']],
    ['--pr abc', ['--pr', 'abc']],
    ['--pr -1', ['--pr', '-1']],
    ['--pr 1.5', ['--pr', '1.5']],
    ['--pr abc on push', ['--pr', 'abc', '--event', 'push']],
    ['--event pull_request_target', ['--pr', '9', '--event', 'pull_request_target']],
  ])('%s exits 2', (_name, extra) => {
    const repo = (usageRepo ??= new Repo());
    const result = runNode([script, '--root', repo.root, '--base', repo.base, ...extra], { cwd: repoRoot });
    expect(result.status).toBe(2);
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

  it('pattern semantics: a plain root file (/CLAUDE.md) and a dot-folder (/.claude/agents/)', () => {
    const owners = parseCodeowners('/CLAUDE.md @owner\n/.claude/agents/ @owner\n/.claude/settings.json @owner # control plane\n');
    expect(ownedPaths(['CLAUDE.md', '.claude/agents/security-analyst.md', '.claude/settings.json'], owners)).toEqual([
      'CLAUDE.md',
      '.claude/agents/security-analyst.md',
      '.claude/settings.json',
    ]);
    expect(
      ownedPaths(['docs/CLAUDE.md', 'CLAUDE.md.bak', '.claude/agents', '.claude/settings.local.json', '.claude/commands/x.md'], owners),
    ).toEqual([]);
  });
});

describe('record parsing (PR10-SEC-04)', () => {
  it('recordVerdict reads the last Verdict table row of a multi-round record', () => {
    expect(recordVerdict('| **Verdict** | **FAIL.** x |\n## Round 2\n| **Verdict** | **PASS_WITH_FOLLOW-UPS.** |')).toBe(
      'PASS_WITH_FOLLOW-UPS',
    );
    expect(recordVerdict('| verdict | PASS |\r\n')).toBe('PASS');
    expect(recordVerdict('| **Verdict** | **PASS_WITH_FOLLOW-UPS (unchanged).** No new finding |')).toBe('PASS_WITH_FOLLOW-UPS');
    expect(recordVerdict('| **Verdict** | see below |')).toBe('');
    expect(recordVerdict('no verdict here\nVerdict: PASS')).toBeNull();
    expect(recordVerdict('| Final verdict | PASS |')).toBeNull();
  });

  it('recordVerdict ignores fenced and indented code and prose', () => {
    const text = '| **Verdict** | **PASS.** |\n\n```\n| **Verdict** | **FAIL.** |\n```\n\n    | Verdict | FAIL |\n\nVerdict: FAIL\n';
    expect(recordVerdict(text)).toBe('PASS');
  });

  it('recordHeadShas reads Branch / head, Head and Head / range rows only', () => {
    const text = [
      '| Branch / head | `feat/x` @ `76b69c0`; base `main` @ `1ba1b00` |',
      '| **Head / range** | `4ec1bc4` (fix cycle 1: `36d2310`) |',
      '| Head | f0387d4 bare |',
      '| Headline | `aaaaaaa` |',
      '| Verdict | PASS at `bbbbbbb` |',
      'Prose naming `ccccccc`.',
    ].join('\n');
    expect(recordHeadShas(text)).toEqual(['76b69c0', '1ba1b00', '4ec1bc4', '36d2310', 'f0387d4']);
  });

  it('every committed record of this repository has a readable Verdict row and a head SHA (format drift tripwire)', () => {
    const dir = join(repoRoot, 'docs', '05-quality', 'security');
    const names = spawnSync('git', ['ls-files', 'PR-*.md'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect([name, recordVerdict(text)]).toEqual([name, expect.stringMatching(/^[A-Z][A-Z_-]*$/)]);
      expect([name, recordHeadShas(text).length > 0]).toEqual([name, true]);
    }
  });
});
