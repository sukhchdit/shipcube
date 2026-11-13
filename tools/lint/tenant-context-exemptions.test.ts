/**
 * Tripwire for stale `platform/tenant-context-sql` exemptions (PR #11 code review R3-n5; TASK-021).
 *
 * `TENANT_CONTEXT_EXEMPTIONS` in eslint.config.mjs relaxes the rule for named files only. An entry whose file was
 * deleted keeps exempting whatever is created at that path later, so every named file must exist: an entry and its
 * file are removed in the same commit (the SPK-03 / SPK-08 spike entries say so in their comments). The block is read
 * as text, like tools/repo/gitignore.test.ts reads the ignore globs, so this test does not load the ESLint plugins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const ROOT = findRepoRoot();

/** The `files: [...]` paths of every entry of the `TENANT_CONTEXT_EXEMPTIONS` array literal. */
function exemptedFiles(): string[] {
  const config = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
  const block = /const TENANT_CONTEXT_EXEMPTIONS = \[([\s\S]*?)\n\];/u.exec(config)?.[1];
  if (block === undefined) throw new Error('eslint.config.mjs no longer declares the TENANT_CONTEXT_EXEMPTIONS array literal');
  return [...block.matchAll(/files: \[([^\]]*)\]/gu)].flatMap((entry) =>
    [...(entry[1] ?? '').matchAll(/'([^']+)'/gu)].map((path) => path[1] ?? ''),
  );
}

describe('platform/tenant-context-sql exemptions', () => {
  it('[R3-n5] names concrete files only, and every named file exists (remove an entry together with its file)', () => {
    const files = exemptedFiles();
    // non-vacuous: the array holds the with-tenant-tx writer and the catalog suite at least
    expect(files).toEqual(
      expect.arrayContaining(['apps/api/src/platform/db/with-tenant-tx.ts', 'prisma/tests/catalog/c01-c12.int.test.ts']),
    );
    expect(files.filter((path) => /[*?{}[\]]/u.test(path))).toEqual([]);
    expect(files.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });
});
