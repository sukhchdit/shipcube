/**
 * Conventional Commits are enforced by commitlint with the repository configuration (CLAUDE.md §2; TASK-002). The
 * CLI runs in a child process and reads the message on stdin, the form a CI step uses for a commit range. The working
 * directory is a scratch directory outside any git checkout, so the test does not depend on a `.git` root.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const commitlintCli = join(repoRoot, 'node_modules', '@commitlint', 'cli', 'cli.js');
const scratch = mkdtempSync(join(tmpdir(), 'commitlint-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lintMessage = (message: string) =>
  runNode([commitlintCli, '--config', join(repoRoot, 'commitlint.config.mjs')], {
    cwd: scratch,
    input: `${message}\n`,
    timeoutMs: 60_000,
  });

describe('commitlint (Conventional Commits)', () => {
  it('accepts a conventional message with the task reference', () => {
    const result = lintMessage('feat(lint): add rules (TASK-002, US-001)');
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('✖');
  }, 60_000);

  it('rejects a message without a type and subject', () => {
    const result = lintMessage('bad message');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/subject-empty|type-empty/u);
  }, 60_000);
});
