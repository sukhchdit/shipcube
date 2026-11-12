import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { checkMigrationChanges, checkRepository, parseNameStatus } from './check-migration-immutability.mjs';

const roots: string[] = [];

/** A temporary git repository with one released migration on `main`, and a feature branch checked out. */
function repo(): { root: string; write: (path: string, text: string) => void; commit: () => void; git: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'mig-immut-'));
  roots.push(root);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (): void => {
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
  };
  git('init', '-q', '-b', 'main');
  write('prisma/migrations/20261112000000_baseline/migration.sql', 'CREATE TABLE a (id int);\n');
  write('prisma/migrations/20261112000000_baseline/down.sql', 'DROP TABLE a;\n');
  write('prisma/migrations/migration_lock.toml', 'provider = "postgresql"\n');
  commit();
  git('checkout', '-q', '-b', 'feature');
  return { root, write, commit, git };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('released migrations are immutable (PR8-SEC-01 lane-A backstop)', () => {
  it('[PR8-SEC-01] a new migration directory passes', () => {
    const { root, write, commit } = repo();
    write('prisma/migrations/20261113000000_next/migration.sql', 'CREATE TABLE b (id int);\n');
    write('prisma/migrations/20261113000000_next/down.sql', 'DROP TABLE b;\n');
    commit();
    expect(checkRepository({ root, base: 'main' })).toEqual({ findings: [], changes: 2 });
  });

  it('[PR8-SEC-01] editing a released migration.sql fails', () => {
    const { root, write, commit } = repo();
    write('prisma/migrations/20261112000000_baseline/migration.sql', 'CREATE TABLE a (id int, granted text);\n');
    commit();
    expect(checkRepository({ root, base: 'main' }).findings.map((f) => f.rule)).toEqual(['migrations/released-changed']);
  });

  it('[PR8-SEC-01] deleting a released down.sql or adding a file to a released directory fails', () => {
    const { root, write, commit, git } = repo();
    git('rm', '-q', 'prisma/migrations/20261112000000_baseline/down.sql');
    write('prisma/migrations/20261112000000_baseline/extra.sql', 'SELECT 1;\n');
    commit();
    expect(
      checkRepository({ root, base: 'main' })
        .findings.map((f) => f.rule)
        .sort(),
    ).toEqual(['migrations/released-changed', 'migrations/released-dir-extended']);
  });

  it('[PR8-SEC-13] the failure names the rule; migration_lock.toml is allow-listed', () => {
    const { root, write, commit } = repo();
    write('prisma/migrations/migration_lock.toml', 'provider = "postgresql"\n# rewritten by migrate\n');
    commit();
    expect(checkRepository({ root, base: 'main' }).findings).toEqual([]);
    write('prisma/migrations/20261112000000_baseline/down.sql', 'DROP TABLE IF EXISTS a;\n');
    commit();
    expect(checkRepository({ root, base: 'main' }).findings[0]?.message).toContain('applied migrations are immutable (D-SEC-PR8-01/02)');
  });

  it('a rename is reported as delete + add (--no-renames), so moving a released migration fails', () => {
    const { root, git, commit } = repo();
    git('mv', 'prisma/migrations/20261112000000_baseline', 'prisma/migrations/20261112000001_baseline');
    commit();
    expect(checkRepository({ root, base: 'main' }).findings.some((f) => f.rule === 'migrations/released-changed')).toBe(true);
  });

  it('pure policy: paths outside prisma/migrations are ignored; NUL-separated parsing', () => {
    const changes = parseNameStatus('M\0apps/api/x.ts\0A\0prisma/migrations/x/migration.sql\0');
    expect(changes).toEqual([
      { status: 'M', path: 'apps/api/x.ts' },
      { status: 'A', path: 'prisma/migrations/x/migration.sql' },
    ]);
    expect(checkMigrationChanges(changes, new Set())).toEqual([]);
  });
});
