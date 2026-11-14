/**
 * Driver logic of tools/db/up-down-up.ts with an in-memory "database" (the PostgreSQL 18 run is
 * prisma/tests/migrations/up-down-up.int.test.ts).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { splitStatements } from './sql-text.js';
import { UpDownUpError, diffSnapshots, normaliseSchemaDump, runPrefixReversibility, runUpDownUp, sqlStateOf } from './up-down-up.js';

const work = mkdtempSync(join(tmpdir(), 'up-down-up-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Migrations `name -> reversible`; each creates `CREATE TABLE <name>` and its down.sql drops it. */
function migrations(spec: Record<string, boolean>, withDown = true): string {
  const dir = mkdtempSync(join(work, 'm-'));
  for (const [name, reversible] of Object.entries(spec)) {
    mkdirSync(join(dir, name));
    writeFileSync(
      join(dir, name, 'migration.sql'),
      `-- migration-kind: ${reversible ? 'expand' : 'contract'}\n-- data-changing: no\n-- reversible: ${reversible ? 'yes' : 'no'}\nSELECT 1;\n`,
    );
    if (withDown) writeFileSync(join(dir, name, 'down.sql'), 'SELECT 1;\n');
  }
  writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  return dir;
}

/** A fake Prisma + database: applied migrations are the schema; `leaky` names leave an object behind on down. */
function fakeDatabase(dir: string, options: { leaky?: string; failDeploy?: boolean } = {}) {
  const applied = new Set<string>();
  const leftovers: string[] = [];
  const calls: string[] = [];
  let pending: string | undefined;
  return {
    calls,
    prisma: (args: string[]) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'migrate' && args[1] === 'deploy') {
        if (options.failDeploy) return { status: 1, stdout: '', stderr: 'P3018 boom' };
        for (const name of readdirSync(dir).filter((n) => !n.endsWith('.toml'))) applied.add(name);
      }
      if (args[0] === 'db' && args[1] === 'execute') {
        pending = (args[3] as string).split(/[\\/]/).at(-2);
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    markRolledBack: (name: string) => {
      expect(name).toBe(pending);
      applied.delete(name);
      if (name === options.leaky) leftovers.push(`CREATE SEQUENCE ${name}_seq`);
      return Promise.resolve();
    },
    snapshot: () =>
      Promise.resolve(
        [...[...applied].map((name) => `CREATE TABLE ${name}`), ...leftovers.filter((left) => !applied.has(left))].sort().join(';\n'),
      ),
  };
}

describe('up -> down -> up driver (data-model §8.4)', () => {
  it('rolls every migration back newest first, then re-applies, and reports both diffs empty', async () => {
    const dir = migrations({ '0001_a': true, '0002_b': true });
    const fake = fakeDatabase(dir);
    const report = await runUpDownUp({ migrationsDir: dir, ...fake });
    expect(report).toMatchObject({
      migrations: ['0001_a', '0002_b'],
      rolledBack: ['0002_b', '0001_a'],
      excluded: [],
      downRestoresStart: true,
      upIsRepeatable: true,
    });
    expect(fake.calls).toEqual(['migrate deploy', 'db execute', 'db execute', 'migrate deploy']);
  });

  it('stops the descent at a migration declared reversible: no and reports it as excluded', async () => {
    const dir = migrations({ '0001_a': true, '0002_contract': false, '0003_c': true });
    const report = await runUpDownUp({ migrationsDir: dir, ...fakeDatabase(dir) });
    expect(report.rolledBack).toEqual(['0003_c']);
    expect(report.excluded).toEqual(['0002_contract']);
    expect(report.downRestoresStart).toBeNull();
    expect(report.upIsRepeatable).toBe(true);
  });

  it('reports an incomplete down.sql and does not re-run up', async () => {
    const dir = migrations({ '0001_a': true });
    const fake = fakeDatabase(dir, { leaky: '0001_a' });
    const report = await runUpDownUp({ migrationsDir: dir, ...fake });
    expect(report.downRestoresStart).toBe(false);
    expect(report.upIsRepeatable).toBeNull();
    expect(report.downDiff).toEqual({ onlyBefore: [], onlyAfter: ['CREATE SEQUENCE 0001_a_seq'] });
    expect(fake.calls).toEqual(['migrate deploy', 'db execute']);
  });

  it('refuses migrations without down.sql and surfaces a failing Prisma command', async () => {
    const noDown = migrations({ '0001_a': true }, false);
    await expect(runUpDownUp({ migrationsDir: noDown, ...fakeDatabase(noDown) })).rejects.toThrow(/0001_a has no down.sql/);
    const dir = migrations({ '0001_a': true });
    await expect(runUpDownUp({ migrationsDir: dir, ...fakeDatabase(dir, { failDeploy: true }) })).rejects.toThrow(UpDownUpError);
  });

  it('normalises pg_dump output: no comments, settings, meta-commands or Prisma history; statements sorted', () => {
    const dump = [
      '--',
      '-- PostgreSQL database dump',
      '\\restrict AbC123',
      'SET statement_timeout = 0;',
      "SELECT pg_catalog.set_config('search_path', '', false);",
      'CREATE TABLE public.b (id integer);',
      'CREATE TABLE public._prisma_migrations (id text);',
      'CREATE TABLE public.a (',
      '    id integer',
      ');',
      'CREATE FUNCTION public.f() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$;',
      '\\unrestrict AbC123',
    ].join('\n');
    expect(normaliseSchemaDump(dump)).toBe(
      [
        'CREATE FUNCTION public.f() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$',
        'CREATE TABLE public.a ( id integer )',
        'CREATE TABLE public.b (id integer)',
      ].join(';\n'),
    );
  });

  it('diffs snapshots as multisets', () => {
    expect(diffSnapshots('A;\nB;\nB', 'B;\nC')).toEqual({ onlyBefore: ['A', 'B'], onlyAfter: ['C'] });
  });
});

/** Migrations `name -> { up, down, reversible? }` with literal SQL bodies (statements `CREATE TABLE x` / `DROP TABLE [IF EXISTS] x`). */
function sqlMigrations(spec: Record<string, { up: string[]; down: string[]; reversible?: boolean }>, withDown = true): string {
  const dir = mkdtempSync(join(work, 'p-'));
  for (const [name, { up, down, reversible = true }] of Object.entries(spec)) {
    mkdirSync(join(dir, name));
    const header = `-- migration-kind: ${reversible ? 'expand' : 'contract'}\n-- data-changing: no\n-- reversible: ${reversible ? 'yes' : 'no'}\n`;
    writeFileSync(join(dir, name, 'migration.sql'), `${header}${up.map((s) => `${s};\n`).join('')}`);
    if (withDown) writeFileSync(join(dir, name, 'down.sql'), `-- down\n${down.map((s) => `${s};\n`).join('')}`);
  }
  writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  return dir;
}

class FakeSqlError extends Error {
  constructor(readonly code: string | undefined) {
    super(`fake error ${String(code)} with a secret-looking value 'tok_123'`);
  }
}

/** A fake database of table names: `prepare(i)` holds the tables of migrations 0..i-1; down.sql runs atomically. */
function fakePrefixDatabase(dir: string, options: { failUpOn?: string; codeless?: boolean } = {}) {
  const names = readdirSync(dir).filter((name) => !name.endsWith('.toml'));
  const created = (sql: string) => [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1] as string);
  const prepared: { index: number; migration: string }[] = [];
  const released: Set<string>[] = [];
  const execute = (tables: Set<string>, statement: string) => {
    const create = /^CREATE TABLE (\w+)$/.exec(statement);
    const drop = /^DROP TABLE (IF EXISTS )?(\w+)$/.exec(statement);
    if (create) {
      if (create[1] === options.failUpOn) throw new FakeSqlError('42601');
      if (tables.has(create[1] as string)) throw new FakeSqlError(options.codeless ? undefined : '42P07');
      tables.add(create[1] as string);
    } else if (drop) {
      if (!tables.delete(drop[2] as string) && drop[1] === undefined) throw new FakeSqlError(options.codeless ? undefined : '42P01');
    }
  };
  return {
    prepared,
    released,
    prepare: (index: number, migration: string) => {
      prepared.push({ index, migration });
      return Promise.resolve(
        new Set(names.slice(0, index).flatMap((name) => created(readFileSync(join(dir, name, 'migration.sql'), 'utf8')))),
      );
    },
    applyStatements: (tables: Set<string>, statements: readonly string[]) => {
      for (const statement of statements) execute(tables, statement);
      return Promise.resolve();
    },
    runDown: (tables: Set<string>, downSql: string) => {
      const copy = new Set(tables);
      for (const statement of splitStatements(downSql)) execute(copy, statement);
      tables.clear();
      for (const table of copy) tables.add(table);
      return Promise.resolve();
    },
    snapshot: (tables: Set<string>) =>
      Promise.resolve(
        [...tables]
          .sort()
          .map((table) => `CREATE TABLE ${table}`)
          .join(';\n'),
      ),
    release: (tables: Set<string>) => {
      released.push(tables);
      return Promise.resolve();
    },
  };
}

describe('prefix reversibility of a partial deploy (data-model §8.4 as amended 2026-11-13, PR11-SEC-07)', () => {
  it('runs every proper prefix on a fresh pre-M state and reports nothing when every down.sql tolerates it', async () => {
    const dir = sqlMigrations({
      '0001_one': { up: ['CREATE TABLE a'], down: ['DROP TABLE a'] },
      '0002_three': {
        up: ['CREATE TABLE b', 'CREATE TABLE c', 'CREATE TABLE d'],
        down: ['DROP TABLE IF EXISTS d', 'DROP TABLE IF EXISTS c', 'DROP TABLE IF EXISTS b'],
      },
    });
    const fake = fakePrefixDatabase(dir);
    const report = await runPrefixReversibility({ migrationsDir: dir, ...fake });
    expect(report).toEqual({
      checked: [
        { migration: '0001_one', statements: 1, prefixes: 0 },
        { migration: '0002_three', statements: 3, prefixes: 2 },
      ],
      excluded: [],
      failures: [],
    });
    // One preparation for the pre-M snapshot plus one per prefix, all of the state before 0002 (index 1); none for 0001.
    expect(fake.prepared).toEqual(Array.from({ length: 3 }, () => ({ index: 1, migration: '0002_three' })));
    expect(fake.released).toHaveLength(3);
  });

  it('reports a down.sql that fails on a prefix with migration, prefix length and SQLSTATE only', async () => {
    const dir = sqlMigrations({
      '0001_strict': { up: ['CREATE TABLE a', 'CREATE TABLE b', 'CREATE TABLE c'], down: ['DROP TABLE c', 'DROP TABLE b', 'DROP TABLE a'] },
    });
    const lines: string[] = [];
    const report = await runPrefixReversibility({ migrationsDir: dir, ...fakePrefixDatabase(dir), log: (line) => lines.push(line) });
    expect(report.failures).toEqual([
      {
        migration: '0001_strict',
        prefix: 1,
        statements: 3,
        reason: 'down-failed',
        sqlstate: '42P01',
        message: '0001_strict: prefix 1/3 (down.sql failed: 42P01)',
      },
      {
        migration: '0001_strict',
        prefix: 2,
        statements: 3,
        reason: 'down-failed',
        sqlstate: '42P01',
        message: '0001_strict: prefix 2/3 (down.sql failed: 42P01)',
      },
    ]);
    expect(lines.join('\n')).not.toContain('tok_123');
  });

  it('reports a down.sql that leaves an object of a prefix behind as a schema difference', async () => {
    const dir = sqlMigrations({
      '0001_leaky': {
        up: ['CREATE TABLE a', 'CREATE TABLE b', 'CREATE TABLE c'],
        down: ['DROP TABLE IF EXISTS c', 'DROP TABLE IF EXISTS a'],
      },
    });
    const report = await runPrefixReversibility({ migrationsDir: dir, ...fakePrefixDatabase(dir) });
    expect(report.failures).toEqual([
      {
        migration: '0001_leaky',
        prefix: 2,
        statements: 3,
        reason: 'schema-differs',
        differing: 1,
        message: '0001_leaky: prefix 2/3 (schema differs: 1 objects)',
      },
    ]);
  });

  it('excludes reversible: no migrations, reports a code-less error as unknown and releases every database', async () => {
    const dir = sqlMigrations({
      '0001_contract': { up: ['CREATE TABLE a', 'CREATE TABLE b'], down: ['DROP TABLE a'], reversible: false },
      '0002_strict': { up: ['CREATE TABLE c', 'CREATE TABLE d'], down: ['DROP TABLE d', 'DROP TABLE c'] },
    });
    const fake = fakePrefixDatabase(dir, { codeless: true });
    const report = await runPrefixReversibility({ migrationsDir: dir, ...fake });
    expect(report.excluded).toEqual(['0001_contract']);
    expect(report.checked).toEqual([{ migration: '0002_strict', statements: 2, prefixes: 1 }]);
    expect(report.failures.map((failure) => failure.message)).toEqual(['0002_strict: prefix 1/2 (down.sql failed: unknown)']);
    expect(fake.released).toHaveLength(fake.prepared.length);
  });

  it('fails fast when the up statements of a prefix do not apply, or a migration has no down.sql', async () => {
    const dir = sqlMigrations({ '0001_bad': { up: ['CREATE TABLE a', 'CREATE TABLE b', 'CREATE TABLE c'], down: [] } });
    const fake = fakePrefixDatabase(dir, { failUpOn: 'b' });
    await expect(runPrefixReversibility({ migrationsDir: dir, ...fake })).rejects.toThrow(
      new UpDownUpError('0001_bad: prefix 2/3 (up statements failed: 42601)'),
    );
    expect(fake.released).toHaveLength(fake.prepared.length);
    const noDown = sqlMigrations({ '0001_a': { up: ['CREATE TABLE a', 'CREATE TABLE b'], down: [] } }, false);
    await expect(runPrefixReversibility({ migrationsDir: noDown, ...fakePrefixDatabase(noDown) })).rejects.toThrow(
      /0001_a has no down.sql/,
    );
  });

  it('reads the SQLSTATE of a driver error and nothing else', () => {
    expect(sqlStateOf(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' }))).toBe('42P01');
    expect(sqlStateOf(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('unknown');
    expect(sqlStateOf('42P01')).toBe('unknown');
    expect(sqlStateOf(null)).toBe('unknown');
  });
});
