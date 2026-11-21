/**
 * One answer for a refused reference (D-ARCH-164 as extended by D-ARCH-212; ADR-0005 amendment 14 item 34 and amendment
 * 15 item 37; PR293-SEC-03 (b); TASK-051). A refused reference, SQLSTATE 23503 (foreign_key_violation) or 23001
 * (restrict_violation, the PostgreSQL 18 code of a refused RESTRICT action), reported by Prisma as P2003 for a model
 * operation, is never mapped to a client-visible answer by constraint, field, message or detail: a reference a client
 * supplies is resolved by a read under RLS before the write, so a row of another owner and an absent row are the same
 * miss. `mapDbError` gives every such violation the same 500 (pinned in map-db-error.test.ts). This tripwire keeps every
 * other file under apps/ and packages/ from naming the Prisma code or either SQLSTATE at all.
 *
 * Stated limit (code review R1-n4; rulings/wave-1-r-arch-34-operator-rulings.md §8.6): the tripwire is lexical. It does
 * not see a mapping by constraint name, field name or message that never names a code (`meta.constraint`,
 * `meta.field_name`), nor a code assembled from parts; the review of each repository is the backstop for those.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();

/** The only files that may name a refused-reference code. */
const ALLOWED = new Set(['apps/api/src/platform/db/map-db-error.ts', 'apps/api/src/platform/db/map-db-error.test.ts']);
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.react-router']);
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/;
/** The Prisma code and the two SQLSTATEs of a refused reference, as whole tokens. */
const FK_CODE = /(?<![A-Za-z0-9])(?:P2003|23503|23001)(?![A-Za-z0-9])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

const repoPath = (path: string): string => relative(repoRoot, path).split(sep).join('/');

describe('one answer for a refused reference (D-ARCH-164, D-ARCH-212)', () => {
  it.each([
    ['P2003', ['case P2003:', '"P2003"', "code === 'P2003'"], ['P20031', 'XP2003', 'aP2003']],
    ['23503', ["if (code === '23503')", '"23503"', 'state: 23503,'], ['235031', 'a23503', '123503']],
    ['23001', ["if (sqlState === '23001')", '"23001"', 'case 23001:'], ['230011', 'a23001', '123001']],
  ] as const)(
    '[D-ARCH-164] [D-ARCH-212] the token pattern finds %s and nothing longer (positive and negative controls)',
    (_code, positive, negative) => {
      expect(positive.filter((text) => FK_CODE.test(text))).toEqual([...positive]);
      expect(negative.filter((text) => FK_CODE.test(text))).toEqual([]);
    },
  );

  it('[D-ARCH-164] [D-ARCH-212] no file under apps/ or packages/ other than map-db-error.ts and its test names P2003, 23503 or 23001', () => {
    const files = ['apps', 'packages'].flatMap((top) => sourceFiles(join(repoRoot, top)));
    expect(files.length).toBeGreaterThan(100); // not vacuous
    const naming = files.filter((file) => FK_CODE.test(readFileSync(file, 'utf8'))).map(repoPath);
    expect(naming.filter((file) => !ALLOWED.has(file))).toEqual([]);
    // The test of the mapping names them, so the allow-list is live.
    expect(naming).toContain('apps/api/src/platform/db/map-db-error.test.ts');
  });
});
