/**
 * Driver logic of tools/db/up-down-up.ts with an in-memory "database" (the PostgreSQL 18 run is
 * prisma/tests/migrations/up-down-up.int.test.ts).
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { UpDownUpError, diffSnapshots, normaliseSchemaDump, runUpDownUp } from './up-down-up.js';

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
