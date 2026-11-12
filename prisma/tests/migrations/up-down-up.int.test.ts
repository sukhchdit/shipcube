/**
 * Reversibility of the Prisma migration history on PostgreSQL 18: up -> down -> up (data-model.md §8.4,
 * NFR-DATA-004, TASK-003). Driver: tools/db/up-down-up.ts; Prisma runs through tools/deps/prisma-cli.mjs as the
 * migrator against a database cloned from the bootstrapped template.
 */
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { listMigrations, normaliseSchemaDump, runUpDownUp, type UpDownUpReport } from '../../../tools/db/up-down-up.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { PlatformPostgres } from '../harness/postgres.js';

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, 'prisma', 'tests', 'fixtures');

let db: PlatformPostgres;

beforeAll(async () => {
  db = await PlatformPostgres.start();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

async function upDownUp(migrationsDir: string, config?: string): Promise<{ report: UpDownUpReport; database: string }> {
  const database = await db.clone(await db.template({ migrated: false }));
  const report = await runUpDownUp({
    migrationsDir,
    prisma: (args) => db.prisma(database, args, config ? { config } : {}),
    snapshot: async () => normaliseSchemaDump(await db.dumpSchema(database)),
    markRolledBack: (name) => db.markRolledBack(database, name),
  });
  return { report, database };
}

describe('up -> down -> up (NFR-DATA-004)', () => {
  it('[NT-DATA-004-a] the repository migrations go up, all the way down and up again with a schema diff of 0 (empty database)', async () => {
    const migrationsDir = join(repoRoot, 'prisma', 'migrations');
    const { report, database } = await upDownUp(migrationsDir);
    expect(report.migrations).toEqual(listMigrations(migrationsDir));
    expect(report.migrations).toContain('20261112000000_baseline');
    expect(report.rolledBack).toEqual([...report.migrations].reverse());
    expect(report.excluded).toEqual([]);
    expect(report.downDiff).toEqual({ onlyBefore: [], onlyAfter: [] });
    expect(report.upDiff).toEqual({ onlyBefore: [], onlyAfter: [] });
    expect(report.downRestoresStart).toBe(true);
    expect(report.upIsRepeatable).toBe(true);
    const status = await db.prisma(database, ['migrate', 'status']);
    expect(status.stdout).toContain('Database schema is up to date');
  }, 300_000);

  it('[NT-DATA-004-a] a migration that creates a table, an index and a CHECK is reverted by its down.sql and re-applied identically', async () => {
    const dir = join(fixtures, 'updown');
    const { report } = await upDownUp(join(dir, 'migrations'), join(dir, 'prisma.config.ts'));
    expect(report.rolledBack).toEqual(['20261112000100_updown_probe', '20261112000000_baseline']);
    expect(report.downRestoresStart).toBe(true);
    expect(report.upIsRepeatable).toBe(true);
  }, 300_000);

  it('[NT-DATA-004-a] a down.sql that leaves an object behind is reported (negative control)', async () => {
    const dir = join(fixtures, 'updown-broken');
    const { report } = await upDownUp(join(dir, 'migrations'), join(dir, 'prisma.config.ts'));
    expect(report.downRestoresStart).toBe(false);
    expect(report.upIsRepeatable).toBeNull();
    expect(report.downDiff.onlyBefore).toEqual([]);
    expect(report.downDiff.onlyAfter.join('\n')).toContain('CREATE SEQUENCE public.updown_probe_leftover_seq');
  }, 300_000);
});
