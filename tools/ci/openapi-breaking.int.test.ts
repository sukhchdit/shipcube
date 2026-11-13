/**
 * openapi-breaking against the real digest-pinned oasdiff image (NFR-MAINT-004, PR #21 R1-m6; sheet TASK-015 "a seeded
 * fixture (an operation removed from a copy of the contract) fails the check"). Needs Docker: the integration project.
 * A throw-away repository holds a copy of the real contract tagged as a release; the PR removes the first path item.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { CONTRACT_PATH } from './openapi-breaking.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'ci', 'openapi-breaking.mjs');
const FIVE_MINUTES = 5 * 60_000;
const contract = readFileSync(join(repoRoot, CONTRACT_PATH), 'utf8').replaceAll('\r\n', '\n');
const root = mkdtempSync(join(tmpdir(), 'openapi-breaking-int-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const git = (...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const commit = (): void => {
  git('add', '-A');
  git('commit', '-q', '-m', 'x');
};

/** The contract without its first path item (every operation under it), and that item's operationIds. */
function withoutFirstPath(text: string): { text: string; operationIds: string[] } {
  const lines = text.split('\n');
  const paths = lines.indexOf('paths:');
  const start = lines.findIndex((line, index) => index > paths && /^ {2}\/\S*:$/u.test(line));
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S|^\S/u.test(line));
  if (paths < 0 || start < 0 || end < 0) throw new Error('fixture: cannot locate the first path item');
  const removed = lines.slice(start, end);
  const operationIds = removed.flatMap((line) => /^\s+operationId:\s*(\S+)\s*$/u.exec(line)?.[1] ?? []);
  return { text: [...lines.slice(0, start), ...lines.slice(end)].join('\n'), operationIds };
}

const run = () => runNode([script, '--root', root, '--base', 'main', '--json'], { cwd: repoRoot, timeoutMs: FIVE_MINUTES });

describe('openapi-breaking (Docker, real oasdiff image)', () => {
  it(
    '[R1-m6] no release tag prints "no release tag" and exits 0; an unchanged contract against the tag passes',
    () => {
      git('init', '-q', '-b', 'main');
      write(CONTRACT_PATH, contract);
      commit();
      const untagged = run();
      expect(untagged.stdout).toContain('no release tag');
      expect(untagged.status).toBe(0);
      git('tag', 'v0.1.0-m0');
      git('checkout', '-q', '-b', 'feature');
      const same = run();
      expect(JSON.parse(same.stdout.split('\n')[0] ?? '')).toMatchObject({ verdict: 'pass', tag: 'v0.1.0-m0', errors: [] });
      expect(same.status).toBe(0);
    },
    FIVE_MINUTES,
  );

  it(
    '[NFR-MAINT-004] an operation removed from the contract copy fails; a superseding ADR naming it passes',
    () => {
      const { text, operationIds } = withoutFirstPath(contract);
      expect(operationIds.length).toBeGreaterThan(0);
      write(CONTRACT_PATH, text);
      commit();
      const broken = run();
      const decision = JSON.parse(broken.stdout.split('\n')[0] ?? '') as {
        verdict: string;
        uncovered: Array<{ id: string; operationId: string }>;
      };
      expect(decision.verdict).toBe('fail');
      expect(decision.uncovered.map((change) => change.operationId).sort()).toEqual([...operationIds].sort());
      expect(decision.uncovered.every((change) => change.id.startsWith('api-'))).toBe(true);
      expect(broken.status).toBe(1);

      write('docs/03-architecture/adr/ADR-0999-v2-fixture.md', `# ADR-0999\n\n- Supersedes: ADR-0016 for ${operationIds.join(', ')}\n`);
      commit();
      const recorded = run();
      expect(JSON.parse(recorded.stdout.split('\n')[0] ?? '')).toMatchObject({
        verdict: 'pass',
        records: ['docs/03-architecture/adr/ADR-0999-v2-fixture.md'],
      });
      expect(recorded.status).toBe(0);
    },
    FIVE_MINUTES,
  );
});
