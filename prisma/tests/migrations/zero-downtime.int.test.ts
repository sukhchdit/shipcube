/**
 * Zero-downtime probe on PostgreSQL 18 (data-model.md §8.7; NFR-AVAIL-003; NT-AVAIL-003-b; TASK-034). Driver:
 * tools/db/zero-downtime-probe.ts. The "old code" runs as platform_app through a bounded pool (5 s statement timeout)
 * while a migration is applied as platform_migrator statement by statement, as `migrate deploy` applies a file:
 *  - an expand change (nullable column, concurrent index, new table) under continuous reads and writes: 0 errors;
 *  - the negative control, a RENAME COLUMN: the old code's statements fail;
 *  - the repository's latest expand migration under the catalog read workload (every table platform_app may read,
 *    with the column list taken before the migration): 0 errors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { parseHeader } from '../../../tools/db/lint-migrations.js';
import { splitStatements } from '../../../tools/db/sql-text.js';
import { listMigrations } from '../../../tools/db/up-down-up.js';
import {
  PROBE_POOL_LIMITS,
  catalogReadWorkload,
  runZeroDowntimeProbe,
  type ProbeOperation,
  type ProbeReport,
} from '../../../tools/db/zero-downtime-probe.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { PlatformPostgres } from '../harness/postgres.js';

const repositoryMigrations = join(findRepoRoot(), 'prisma', 'migrations');

let db: PlatformPostgres;

beforeAll(async () => {
  db = await PlatformPostgres.start();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

async function asMigrator(database: string, statements: readonly string[], pauseMs = 0): Promise<void> {
  const client = new pg.Client(db.migratorConnection(database));
  await client.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  } finally {
    await client.end();
  }
}

/** Runs the probe as platform_app with the old code's operations (plus the catalog reads when asked). */
async function probe(
  database: string,
  operations: readonly ProbeOperation[],
  migrate: () => Promise<void>,
  catalogReads = false,
): Promise<ProbeReport> {
  const pool = new pg.Pool({ ...db.appConnection(database), ...PROBE_POOL_LIMITS, max: 8 });
  try {
    const reads = catalogReads
      ? await catalogReadWorkload({ query: async <T extends object>(sql: string) => (await pool.query<T>(sql)).rows })
      : [];
    return await runZeroDowntimeProbe({
      operations: [...reads, ...operations],
      execute: async (operation, params) => {
        await pool.query(operation.sql, [...params]);
      },
      migrate,
      ratePerSecond: 50,
      warmupMs: 1_000,
      afterMs: 1_000,
      maxInFlight: 8,
    });
  } finally {
    await pool.end();
  }
}

const OLD_CODE: readonly ProbeOperation[] = [
  {
    name: 'insert zdt_probe',
    kind: 'write',
    sql: 'INSERT INTO public.zdt_probe (id, label) VALUES ($1, $2)',
    params: ['{{uuid}}', 'probe-{{seq}}'],
  },
  { name: 'read zdt_probe', kind: 'read', sql: 'SELECT id, label, created_at FROM public.zdt_probe ORDER BY created_at DESC LIMIT 5' },
  {
    name: 'update zdt_probe',
    kind: 'write',
    sql: 'UPDATE public.zdt_probe SET label = $1 WHERE id = (SELECT id FROM public.zdt_probe ORDER BY created_at LIMIT 1)',
    params: ['updated-{{seq}}'],
  },
];

async function probeTable(): Promise<string> {
  const database = await db.clone(await db.template({ migrated: true }));
  await asMigrator(database, [
    'CREATE TABLE public.zdt_probe (id uuid PRIMARY KEY, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT pg_catalog.now())',
    'GRANT SELECT, INSERT, UPDATE ON public.zdt_probe TO platform_app',
  ]);
  return database;
}

// NT-AVAIL-003-b is covered here PARTIALLY: a database-level probe, not the previous api image under k6 (D-TASK034-05 as
// corrected by D-TASK034-11; TASK-034 code review R1-m4). The image-level job is TASK-119's (D-SD-012).
describe('zero-downtime probe (NFR-AVAIL-003; NT-AVAIL-003-b partial: database level)', () => {
  it('[NT-AVAIL-003-b] (partial) continuous reads and writes across an expand migration (nullable column, concurrent index, new table) have 0 errors', async () => {
    const database = await probeTable();
    const report = await probe(database, OLD_CODE, () =>
      asMigrator(
        database,
        [
          "SET lock_timeout = '3s'",
          'ALTER TABLE public.zdt_probe ADD COLUMN note text',
          'CREATE INDEX CONCURRENTLY ix_zdt_probe__label ON public.zdt_probe (label)',
          'CREATE TABLE public.zdt_probe_extra (id uuid PRIMARY KEY, probe_id uuid)',
          'ALTER TABLE public.zdt_probe_extra ADD CONSTRAINT fk_zdt_probe_extra__probe FOREIGN KEY (probe_id) REFERENCES public.zdt_probe (id) NOT VALID',
        ],
        250,
      ),
    );
    expect(report.samples).toEqual([]);
    expect(report).toMatchObject({ verdict: 'pass', failures: 0, saturated: 0, migrationError: null });
    expect(report.phases.during.requests).toBeGreaterThan(20);
    expect(report.phases.after.requests).toBeGreaterThan(20);
    expect(report.operations.every((operation) => operation.requests > 0)).toBe(true);
  }, 120_000);

  it('[NT-AVAIL-003-b] (partial) negative control: a RENAME COLUMN breaks the old code, and the probe counts the failures (SQLSTATE 42703)', async () => {
    const database = await probeTable();
    const report = await probe(database, OLD_CODE, () =>
      asMigrator(database, ['ALTER TABLE public.zdt_probe RENAME COLUMN label TO title']),
    );
    expect(report.verdict).toBe('fail');
    expect(report.failures).toBeGreaterThan(0);
    expect(report.phases.warmup.failures).toBe(0);
    expect(report.samples[0]).toMatchObject({ code: '42703' });
  }, 120_000);

  it("[NT-AVAIL-003-b] (partial) the repository's latest expand migration, applied as deploy applies it, under the catalog read workload of platform_app: 0 errors", async () => {
    const names = listMigrations(repositoryMigrations);
    const read = (name: string) => readFileSync(join(repositoryMigrations, name, 'migration.sql'), 'utf8');
    const target = names.findLastIndex((name) => parseHeader(read(name)).kind === 'expand');
    expect(target).toBeGreaterThan(0);
    const database = await db.clone(await db.template({ migrated: false }));
    for (const name of names.slice(0, target)) await asMigrator(database, splitStatements(read(name)));
    const report = await probe(database, [], () => asMigrator(database, splitStatements(read(names[target] as string)), 100), true);
    expect(report.samples).toEqual([]);
    expect(report.verdict).toBe('pass');
    expect(report.operations.length).toBeGreaterThan(3); // the reads of the tables that exist before the migration
  }, 300_000);
});
