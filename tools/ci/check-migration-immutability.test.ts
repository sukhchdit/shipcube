import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { checkBootstrapChanges, checkMigrationChanges, checkRepository, parseNameStatus } from './check-migration-immutability.mjs';

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
  write('prisma/bootstrap/00-roles.sql', 'CREATE ROLE r;\n');
  write('prisma/bootstrap/02-role-backstops.sql', 'SELECT 2;\n');
  write('prisma/bootstrap/README.md', 'notes\n');
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

  it('[TASK-034 R1-m1] a new migration directory that sorts before a released one fails once per directory, naming the rename', () => {
    const { root, write, commit } = repo();
    write('prisma/migrations/20261111000000_late/migration.sql', 'CREATE TABLE c (id int);\n');
    write('prisma/migrations/20261111000000_late/down.sql', 'DROP TABLE c;\n');
    write('prisma/migrations/20261113000000_next/migration.sql', 'CREATE TABLE b (id int);\n');
    commit();
    const { findings } = checkRepository({ root, base: 'main' });
    expect(findings.map((f) => [f.rule, f.location])).toEqual([['migrations/added-out-of-order', 'prisma/migrations/20261111000000_late']]);
    expect(findings[0]?.message).toMatch(
      /sorts before the released 20261112000000_baseline.*rename it with a timestamp after 20261112000000/,
    );
    // The pure policy: the same directory sorting after every base directory passes.
    const added = [{ status: 'A', path: 'prisma/migrations/20261112000001_x/migration.sql' }];
    expect(checkMigrationChanges(added, new Set(['20261112000000_baseline']))).toEqual([]);
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

describe('released bootstrap files are immutable (PR #24 R1-m3, PR24-SEC-06)', () => {
  const rules = (root: string): string[] =>
    checkRepository({ root, base: 'main' })
      .findings.map((f) => f.rule)
      .sort();

  it('[R1-m3] an added bootstrap file that sorts last passes', () => {
    const { root, write, commit } = repo();
    write('prisma/bootstrap/10-audit.sql', 'CREATE SCHEMA audit;\n');
    commit();
    expect(checkRepository({ root, base: 'main' })).toEqual({ findings: [], changes: 1 });
  });

  it('[PR24-SEC-06] an in-place edit of a released bootstrap file fails, even with a reviewer marker', () => {
    const { root, write, commit } = repo();
    write('prisma/bootstrap/02-role-backstops.sql', '-- @audit-ddl security-approved: security-analyst 2026-11-13\nSELECT 3;\n');
    commit();
    const { findings } = checkRepository({ root, base: 'main' });
    expect(findings.map((f) => [f.rule, f.location])).toEqual([['bootstrap/released-changed', 'prisma/bootstrap/02-role-backstops.sql']]);
    expect(findings[0]?.message).toContain('released bootstrap files are immutable (PR #24 R1-m3, PR24-SEC-06)');
  });

  it('[R1-m3] deleting or renaming a released bootstrap file fails', () => {
    const deleted = repo();
    deleted.git('rm', '-q', 'prisma/bootstrap/00-roles.sql');
    deleted.commit();
    expect(rules(deleted.root)).toEqual(['bootstrap/released-changed']);
    const renamed = repo();
    renamed.git('mv', 'prisma/bootstrap/02-role-backstops.sql', 'prisma/bootstrap/03-role-backstops.sql');
    renamed.commit();
    expect(rules(renamed.root)).toEqual(['bootstrap/released-changed']);
  });

  it('[R1-m3] an added file that sorts before the last released one fails (the runtime ledger would refuse it)', () => {
    const { root, write, commit } = repo();
    write('prisma/bootstrap/01-schemas.sql', 'CREATE SCHEMA s;\n');
    commit();
    expect(rules(root)).toEqual(['bootstrap/added-out-of-order']);
  });

  it('[R1-m3] files the runner does not apply (README, nested folders) are not part of the lane', () => {
    const { root, write, commit } = repo();
    write('prisma/bootstrap/README.md', 'rewritten\n');
    write('prisma/bootstrap/fixtures/00-x.sql', 'SELECT 1;\n');
    commit();
    expect(checkRepository({ root, base: 'main' }).findings).toEqual([]);
  });

  it('[R1-m3] a base without bootstrap files accepts any added file; the pure policy ignores other paths', () => {
    expect(checkBootstrapChanges([{ status: 'A', path: 'prisma/bootstrap/00-a.sql' }], [])).toEqual([]);
    expect(
      checkBootstrapChanges(
        [
          { status: 'M', path: 'prisma/migrations/x/migration.sql' },
          { status: 'M', path: 'prisma/bootstrapx/00-a.sql' },
        ],
        ['00-a.sql'],
      ),
    ).toEqual([]);
    expect(checkBootstrapChanges([{ status: 'T', path: 'prisma/bootstrap/00-a.sql' }], ['00-a.sql']).map((f) => f.rule)).toEqual([
      'bootstrap/released-changed',
    ]);
  });
});
