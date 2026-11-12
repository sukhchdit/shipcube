/**
 * Conventional Commits are enforced by commitlint with the repository configuration (CLAUDE.md §2; TASK-002). The
 * CLI runs in a child process (`--edit <file>`), so the test exercises the same entry point a hook or CI step uses.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const commitlintCli = join(repoRoot, 'node_modules', '@commitlint', 'cli', 'cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'commitlint-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lintMessage = (message: string) => {
  const file = join(scratch, `msg-${String(Date.now())}-${String(Math.random()).slice(2)}.txt`);
  writeFileSync(file, `${message}\n`);
  return runNode([commitlintCli, '--config', join(repoRoot, 'commitlint.config.mjs'), '--edit', file], {
    cwd: repoRoot,
    timeoutMs: 60_000,
  });
};

describe('commitlint (Conventional Commits)', () => {
  it('accepts a conventional message with the task reference', () => {
    const result = lintMessage('feat(lint): add rules (TASK-002, US-001)');
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 60_000);

  it('rejects a message without a type and subject', () => {
    const result = lintMessage('bad message');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/subject-empty|type-empty/u);
  }, 60_000);
});
