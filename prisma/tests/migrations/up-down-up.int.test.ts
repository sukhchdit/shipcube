/**
 * Reversibility of the Prisma migration history on PostgreSQL 18: up -> down -> up (data-model.md §8.4,
 * NFR-DATA-004, TASK-003). Driver: tools/db/up-down-up.ts; Prisma runs through tools/deps/prisma-cli.mjs as the
 * migrator against a database cloned from the bootstrapped template.
 *
 * Also here: the prefix reversibility of a partial deploy (data-model §8.4 as amended 2026-11-13, PR11-SEC-07,
 * D-ARCH-071; driver `runPrefixReversibility`) and the recorded audit DDL guard share of `migrate deploy`
 * (D-ARCH-093; reports/up-down-up-guard-share.json).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { RULE_17_RELEASED } from '../../../tools/db/lint-migrations.js';
import { quoteIdentifier, splitStatements } from '../../../tools/db/sql-text.js';
import {
  listMigrations,
  normaliseSchemaDump,
  runPrefixReversibility,
  runUpDownUp,
  type UpDownUpReport,
} from '../../../tools/db/up-down-up.js';
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

/*
 * Prefix reversibility (data-model §8.4 as amended 2026-11-13; PR11-SEC-07; D-ARCH-071): a failed deploy leaves a
 * statement prefix applied, and the migration's down.sql must revert it. The pre-M states are built once as
 * template databases (each earlier migration applied statement by statement as the migrator, nothing recorded in
 * `_prisma_migrations`); every prefix runs on a fresh clone that is dropped afterwards.
 */
const repositoryMigrations = join(repoRoot, 'prisma', 'migrations');

/**
 * Observed failing prefixes. Only the three released migrations grandfathered by linter rule 17 (`RULE_17_RELEASED`:
 * DROP without IF EXISTS in an immutable down.sql) may appear here; any change to this list is a finding.
 */
const PINNED_PREFIX_FAILURES: readonly string[] = [
  // Prefixes that stop before the third table: `DROP TABLE "public"."role_permissions"` finds no table (undefined_table).
  '20261112010000_authz_catalogue_tables: prefix 1/11 (down.sql failed: 42P01)',
  '20261112010000_authz_catalogue_tables: prefix 2/11 (down.sql failed: 42P01)',
  // Prefixes that stop before the third helper: `DROP FUNCTION platform.app_guest_token_hash()` (undefined_function).
  '20261112020000_platform_rls_helpers: prefix 1/5 (down.sql failed: 42883)',
  '20261112020000_platform_rls_helpers: prefix 2/5 (down.sql failed: 42883)',
];

async function asMigrator<T>(database: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(db.migratorConnection(database));
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function applyEach(client: pg.Client, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await client.query(statement);
}

const stateTemplates = new Map<number, Promise<string>>();

/** Template database in the state just before migration `index` (bootstrapped; migrations 0..index-1 applied). */
function stateBefore(index: number): Promise<string> {
  let pending = stateTemplates.get(index);
  if (pending === undefined) {
    pending =
      index === 0
        ? db.template({ migrated: false })
        : (async () => {
            const database = await db.clone(await stateBefore(index - 1));
            const previous = listMigrations(repositoryMigrations)[index - 1] as string;
            const sql = readFileSync(join(repositoryMigrations, previous, 'migration.sql'), 'utf8');
            await asMigrator(database, (client) => applyEach(client, splitStatements(sql)));
            return database;
          })();
    stateTemplates.set(index, pending);
  }
  return pending;
}

/** Normalised schema dump plus one `ROWS <table> = <count>` line per table (counts only, never values). */
async function snapshotWithRowCounts(database: string): Promise<string> {
  const schema = normaliseSchemaDump(await db.dumpSchema(database));
  const admin = await db.superuser(database);
  try {
    const tables = await admin.query<{ schema: string; name: string }>(
      `SELECT n.nspname AS schema, c.relname AS name
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname <> '_prisma_migrations'
          AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
        ORDER BY 1, 2`,
    );
    const counts: string[] = [];
    for (const { schema: nsp, name } of tables.rows) {
      const result = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${quoteIdentifier(nsp)}.${quoteIdentifier(name)}`);
      counts.push(`ROWS ${nsp}.${name} = ${String(result.rows[0]?.n)}`);
    }
    return [schema, ...counts].filter(Boolean).join(';\n');
  } finally {
    await admin.end();
  }
}

async function dropDatabase(database: string): Promise<void> {
  const admin = await db.superuser('postgres');
  try {
    await admin.query(`DROP DATABASE ${quoteIdentifier(database)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

describe('prefix reversibility of a partial deploy (data-model §8.4 as amended 2026-11-13, PR11-SEC-07)', () => {
  it('[NT-DATA-004-a] every proper statement prefix of every repository migration is reverted by its down.sql, except the pinned RULE_17_RELEASED prefixes', async () => {
    expect(PINNED_PREFIX_FAILURES.filter((pinned) => !RULE_17_RELEASED.has(pinned.slice(0, pinned.indexOf(':'))))).toEqual([]);
    const report = await runPrefixReversibility<string>({
      migrationsDir: repositoryMigrations,
      prepare: async (index) => db.clone(await stateBefore(index)),
      applyStatements: (database, statements) => asMigrator(database, (client) => applyEach(client, statements)),
      // One script, as `prisma db execute --file down.sql` runs it in the rollback runbook.
      runDown: (database, downSql) => asMigrator(database, async (client) => void (await client.query(downSql))),
      snapshot: snapshotWithRowCounts,
      release: dropDatabase,
    });
    expect(report.checked.map((entry) => entry.migration)).toEqual(listMigrations(repositoryMigrations));
    expect(report.excluded).toEqual([]);
    expect(report.checked.reduce((sum, entry) => sum + entry.prefixes, 0)).toBeGreaterThan(0);
    expect(report.failures.map((failure) => failure.message)).toEqual(PINNED_PREFIX_FAILURES);
    // Every failure belongs to a grandfathered released migration; every other migration reverts every prefix.
    expect(report.failures.filter((failure) => !RULE_17_RELEASED.has(failure.migration))).toEqual([]);
  }, 900_000);
});

/*
 * Guard share (D-ARCH-093; PR #24 code review R2-n2): the cost of the audit DDL guard event triggers in a full
 * `migrate deploy`. RECORDED, NOT ASSERTED: the figures go to reports/up-down-up-guard-share.json (git-ignored).
 */
const GUARD_TRIGGERS = ['platform_audit_ddl_guard_end', 'platform_audit_ddl_guard_drop'] as const;
const GUARD_SHARE_THRESHOLDS = { share: 0.25, deploySeconds: 60 } as const;

async function timedDeploy(guard: boolean): Promise<number> {
  const database = await db.clone(await db.template({ migrated: false }));
  if (!guard) {
    const admin = await db.superuser(database);
    try {
      for (const trigger of GUARD_TRIGGERS) await admin.query(`ALTER EVENT TRIGGER ${quoteIdentifier(trigger)} DISABLE`);
      const states = await admin.query<{ evtname: string; evtenabled: string }>(
        'SELECT evtname, evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = ANY($1::text[]) ORDER BY 1',
        [[...GUARD_TRIGGERS]],
      );
      expect(states.rows).toEqual([...GUARD_TRIGGERS].sort().map((evtname) => ({ evtname, evtenabled: 'D' })));
    } finally {
      await admin.end();
    }
  }
  const started = performance.now();
  const deploy = await db.prisma(database, ['migrate', 'deploy']);
  const seconds = (performance.now() - started) / 1000;
  expect(deploy.status).toBe(0);
  await dropDatabase(database);
  return seconds;
}

describe('audit DDL guard share of migrate deploy (D-ARCH-093)', () => {
  it('[NT-DATA-004-a] records the deploy time with and without the audit DDL guard event triggers', async () => {
    // Alternating samples, best of two each: the Prisma CLI start-up and the shared tree lock add noise.
    const samples = { withGuard: [] as number[], withoutGuard: [] as number[] };
    for (let round = 0; round < 2; round += 1) {
      samples.withoutGuard.push(await timedDeploy(false));
      samples.withGuard.push(await timedDeploy(true));
    }
    const withGuard = Math.min(...samples.withGuard);
    const withoutGuard = Math.min(...samples.withoutGuard);
    const share = (withGuard - withoutGuard) / withGuard;
    expect(Number.isFinite(withGuard) && Number.isFinite(withoutGuard) && Number.isFinite(share)).toBe(true);
    const reports = join(repoRoot, 'reports');
    mkdirSync(reports, { recursive: true });
    const report = {
      measuredAt: new Date().toISOString(),
      migrations: listMigrations(repositoryMigrations),
      deploySeconds: { withGuard, withoutGuard },
      samples,
      share,
      thresholds: GUARD_SHARE_THRESHOLDS,
      withinThresholds: { share: share <= GUARD_SHARE_THRESHOLDS.share, deploySeconds: withGuard <= GUARD_SHARE_THRESHOLDS.deploySeconds },
      asserted: false,
    };
    writeFileSync(join(reports, 'up-down-up-guard-share.json'), `${JSON.stringify(report, null, 2)}\n`);
  }, 900_000);
});
