/**
 * Rule-5 probe (data-model.md §8.3 rule 5 "verify in P5 spike"; NT-AVAIL-003-a; TASK-016): how Prisma 7.10
 * `migrate deploy` submits a migration file that holds `CREATE INDEX CONCURRENTLY`, on PostgreSQL 18 in the
 * Testcontainers harness, as the migrator. Fixtures: prisma/tests/fixtures/concurrent-index (the index statement alone in
 * its file, on a table created by an earlier migration) and prisma/tests/fixtures/concurrent-index-multi (the same
 * statement after a `SET lock_timeout`). The observation is recorded in prisma/README.md ("Rule 5").
 */
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../../../tools/test-support/process.js';
import { PlatformPostgres } from '../harness/postgres.js';

const fixtures = join(findRepoRoot(), 'prisma', 'tests', 'fixtures');
const INDEX_MIGRATION = '20261112000200_ci_probe_index';

let db: PlatformPostgres;

beforeAll(async () => {
  db = await PlatformPostgres.start();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

interface Observation {
  status: number | null;
  output: string;
  migrations: { migration_name: string; finished: boolean; rolled_back: boolean }[];
  index: { indisvalid: boolean; indisready: boolean }[];
  /** Whether `public.ci_partial` (first statement of the failing file) exists after the failed deploy. */
  partial: boolean;
}

/** Recorded 2026-11-12 on Prisma 7.10.1 / PostgreSQL 18.6 (prisma/README.md "Rule 5"). */
const OBSERVED_PARTIAL_SURVIVES = true;

async function deploy(set: string): Promise<Observation> {
  const database = await db.clone(await db.template({ migrated: false }));
  const result = await db.prisma(database, ['migrate', 'deploy'], { config: join(fixtures, set, 'prisma.config.ts') });
  const client = await db.superuser(database);
  try {
    const migrations = await client.query<Observation['migrations'][number]>(
      `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
         FROM public._prisma_migrations ORDER BY migration_name`,
    );
    const index = await client.query<Observation['index'][number]>(
      `SELECT i.indisvalid, i.indisready FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.ix_ci_probe__ref')`,
    );
    const partial = await client.query<{ present: boolean }>(`SELECT pg_catalog.to_regclass('public.ci_partial') IS NOT NULL AS present`);
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      migrations: migrations.rows,
      index: index.rows,
      partial: partial.rows[0]?.present === true,
    };
  } finally {
    await client.end();
  }
}

describe('rule 5: CREATE INDEX CONCURRENTLY through prisma migrate deploy (Prisma 7.10, PostgreSQL 18)', () => {
  it('[NT-AVAIL-003-a] a one-statement CREATE INDEX CONCURRENTLY migration is applied outside a transaction block and leaves a valid index', async () => {
    const observed = await deploy('concurrent-index');
    expect(observed.status).toBe(0);
    expect(observed.migrations).toEqual([
      { migration_name: '20261112000000_baseline', finished: true, rolled_back: false },
      { migration_name: '20261112000100_ci_probe_table', finished: true, rolled_back: false },
      { migration_name: INDEX_MIGRATION, finished: true, rolled_back: false },
    ]);
    expect(observed.index).toEqual([{ indisvalid: true, indisready: true }]);
  }, 300_000);

  it('[NT-AVAIL-003-a] CREATE INDEX CONCURRENTLY after another statement in the same file is ALSO applied: the file is not one (implicit) transaction', async () => {
    // Observed 2026-11-12: PostgreSQL rejects CREATE INDEX CONCURRENTLY inside a multi-statement simple-query string
    // (implicit transaction block, 25001), so its success here means migrate deploy does not submit the file as one
    // implicit transaction either. Rule 5's one-statement-per-file requirement therefore stands on atomicity (next
    // test), not on a deploy-time error.
    const observed = await deploy('concurrent-index-multi');
    expect(observed.status).toBe(0);
    expect(observed.migrations.map((row) => [row.migration_name, row.finished])).toEqual([
      ['20261112000000_baseline', true],
      ['20261112000100_ci_probe_table', true],
      [INDEX_MIGRATION, true],
    ]);
    expect(observed.index).toEqual([{ indisvalid: true, indisready: true }]);
  }, 300_000);

  it('[NT-AVAIL-003-a] atomicity control: a file whose second statement fails is reported as failed (P3018)', async () => {
    const observed = await deploy('concurrent-index-partial');
    expect(observed.status).not.toBe(0);
    expect(observed.output).toContain(INDEX_MIGRATION);
    expect(observed.output).toMatch(/22012/);
    expect(observed.migrations.map((row) => [row.migration_name, row.finished])).toEqual([
      ['20261112000000_baseline', true],
      ['20261112000100_ci_probe_table', true],
      [INDEX_MIGRATION, false],
    ]);
    expect({ partialTableSurvives: observed.partial }).toEqual({ partialTableSurvives: OBSERVED_PARTIAL_SURVIVES });
  }, 300_000);
});
