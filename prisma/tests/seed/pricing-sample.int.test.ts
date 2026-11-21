/**
 * The sample pricing configuration version on PostgreSQL 18 (TASK-080; US-140, D-010, A-060; data-model §3.9, §9.1,
 * §9.2). The real reference seed definition runs as `platform_migrator` against the really migrated schema: the first
 * run inserts the published row, a re-run writes nothing, and the same version with another hash is refused. The
 * table is read-only at runtime and a published row is immutable even for its owner.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { type ConfigChange, type ConfigChangeSink, type Dataset, type SeedLogger } from '../../seed/framework/contracts.js';
import { runReferenceSeed, type ReferenceSeedResult } from '../../seed/framework/runner.js';
import { byteaHex, PRICING_SAMPLE_CONTENT_SHA256, PRICING_SAMPLE_VERSION_KEY } from '../../seed/reference/pricing-sample.js';
import { REFERENCE_DATASETS, REFERENCE_STEPS } from '../../seed/reference/index.js';
import { PlatformPostgres } from '../harness/postgres.js';

/** The SYSTEM actor (data-model §1.6); prisma/tests may not import @platform/authz. */
const SYSTEM_ACTOR_ID = '00000000-0000-7000-8000-000000000001';

let db: PlatformPostgres;
let template: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  template = await db.template({ migrated: true });
}, 300_000);

afterAll(async () => {
  await db?.stop();
}, 60_000);

const silent: SeedLogger = { info: () => undefined, warn: () => undefined };

function recordingSink(): ConfigChangeSink & { changes: ConfigChange[] } {
  const changes: ConfigChange[] = [];
  return {
    changes,
    configChanged: (_sql, change) => {
      changes.push(change);
      return Promise.resolve();
    },
  };
}

async function withClient<T>(config: pg.ClientConfig, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const seed = (database: string, datasets: readonly Dataset[], sink: ConfigChangeSink): Promise<ReferenceSeedResult> =>
  withClient(db.migratorConnection(database), (client) =>
    runReferenceSeed({ sql: client, datasets, steps: REFERENCE_STEPS, logger: silent, configChanges: sink }),
  );

interface VersionRow {
  version_key: string;
  digest: string;
  source: string;
  published: boolean;
  created_by: string;
  updated_by: string;
  version: number;
  xmin: string;
}

const pricingRows = (database: string): Promise<VersionRow[]> =>
  withClient(db.migratorConnection(database), async (client) => {
    const result = await client.query<VersionRow>(
      `SELECT version_key, pg_catalog.encode(content_sha256, 'hex') AS digest, source, published_at IS NOT NULL AS published,
              created_by::text AS created_by, updated_by::text AS updated_by, version, xmin::text AS xmin
         FROM public.pricing_config_versions ORDER BY version_key`,
    );
    return result.rows;
  });

/** An unpublished version row: $1 = the SYSTEM actor, $2 = the source. */
const INSERT_DRAFT = `INSERT INTO public.pricing_config_versions (created_by, updated_by, version_key, effective_from, content_sha256, source)
   VALUES ($1::uuid, $1::uuid, 'pricing-2099.1.0', pg_catalog.now(), pg_catalog.sha256('x'), $2)`;

/** The SQLSTATE and message of a refused statement. */
async function refusal(run: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await run();
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code, message };
  }
  return { code: undefined, message: 'no error' };
}

describe('sample pricing configuration version seed (TASK-080, data-model §9.1)', () => {
  it('the first run inserts the published SEED row with the pricing hash; a re-run writes nothing', async () => {
    const database = await db.clone(template);
    const first = recordingSink();
    const applied = await seed(database, REFERENCE_DATASETS, first);
    expect(applied.datasets).toEqual([expect.objectContaining({ dataset: 'pricing_config_versions', status: 'applied', inserted: 1 })]);
    expect(first.changes).toEqual([
      expect.objectContaining({ kind: 'version', dataset: 'pricing_config_versions', toVersion: PRICING_SAMPLE_VERSION_KEY }),
    ]);
    const rows = await pricingRows(database);
    expect(rows).toEqual([
      expect.objectContaining({
        version_key: PRICING_SAMPLE_VERSION_KEY,
        digest: PRICING_SAMPLE_CONTENT_SHA256,
        source: 'SEED',
        published: true,
        created_by: SYSTEM_ACTOR_ID,
        updated_by: SYSTEM_ACTOR_ID,
        version: 1,
      }),
    ]);

    const second = recordingSink();
    const rerun = await seed(database, REFERENCE_DATASETS, second);
    expect(rerun.datasets).toEqual([expect.objectContaining({ dataset: 'pricing_config_versions', status: 'unchanged', inserted: 0 })]);
    expect(second.changes).toEqual([]);
    expect(await pricingRows(database)).toEqual(rows);
  }, 120_000);

  it('refuses the same version with another hash (SEED_INSERT_ONLY_CHANGED) and leaves the published row as it was', async () => {
    const database = await db.clone(template);
    await seed(database, REFERENCE_DATASETS, recordingSink());
    const before = await pricingRows(database);
    const [dataset] = REFERENCE_DATASETS;
    if (dataset === undefined) throw new Error('the reference seed has no dataset');
    const changed: Dataset = {
      ...dataset,
      rows: dataset.rows.map((row) => ({ ...row, content_sha256: byteaHex('0'.repeat(64)) })),
    };
    const sink = recordingSink();
    const error = await seed(database, [changed], sink).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'SEED_INSERT_ONLY_CHANGED', subjects: ['pricing_config_versions'] });
    expect(sink.changes).toEqual([]);
    expect(await pricingRows(database)).toEqual(before);
  }, 120_000);

  it('a published version is immutable for its owner (PRICING_VERSION_IMMUTABLE) and read-only for platform_app', async () => {
    const database = await db.clone(template);
    await seed(database, REFERENCE_DATASETS, recordingSink());
    const owner = await withClient(db.migratorConnection(database), async (client) => ({
      update: await refusal(() => client.query(`UPDATE public.pricing_config_versions SET notes = 'changed'`)),
      delete: await refusal(() => client.query('DELETE FROM public.pricing_config_versions')),
    }));
    expect(owner.update).toMatchObject({ code: 'P0001', message: expect.stringContaining('PRICING_VERSION_IMMUTABLE') });
    expect(owner.delete).toMatchObject({ code: 'P0001', message: expect.stringContaining('PRICING_VERSION_IMMUTABLE') });

    const app = await withClient(db.appConnection(database), async (client) => ({
      read: (await client.query<{ n: number }>('SELECT pg_catalog.count(*)::int AS n FROM public.pricing_config_versions')).rows[0]?.n,
      update: await refusal(() => client.query(`UPDATE public.pricing_config_versions SET notes = 'changed'`)),
      insert: await refusal(() =>
        client.query(
          `INSERT INTO public.pricing_config_versions (created_by, updated_by, version_key, effective_from, content_sha256, source)
           VALUES ($1::uuid, $1::uuid, 'pricing-2099.1.0', pg_catalog.now(), pg_catalog.sha256('x'), 'SEED')`,
          [SYSTEM_ACTOR_ID],
        ),
      ),
    }));
    expect(app).toEqual({
      read: 1,
      update: expect.objectContaining({ code: '42501' }),
      insert: expect.objectContaining({ code: '42501' }),
    });

    // An unpublished draft row stays editable for the owner (the trigger only guards published versions). OPERATOR is a
    // source the CHECK admits (data-model §1.7, reserved for the M2 pricing admin; D-TASK080-14); ADMIN is not.
    const draft = await withClient(db.migratorConnection(database), async (client) => {
      const admin = await refusal(() => client.query(INSERT_DRAFT, [SYSTEM_ACTOR_ID, 'ADMIN']));
      expect(admin).toMatchObject({ code: '23514', message: expect.stringContaining('ck_pricing_config_versions__source') });
      await client.query(INSERT_DRAFT, [SYSTEM_ACTOR_ID, 'OPERATOR']);
      const updated = await client.query(
        `UPDATE public.pricing_config_versions SET notes = 'draft' WHERE version_key = 'pricing-2099.1.0'`,
      );
      const deleted = await client.query(`DELETE FROM public.pricing_config_versions WHERE version_key = 'pricing-2099.1.0'`);
      return { updated: updated.rowCount, deleted: deleted.rowCount };
    });
    expect(draft).toEqual({ updated: 1, deleted: 1 });
  }, 120_000);

  it('[PR080-SEC-04] TRUNCATE is refused while a published version exists and allowed over drafts only', async () => {
    const empty = await db.clone(template);
    const draftsOnly = await withClient(db.migratorConnection(empty), async (client) => {
      await client.query(INSERT_DRAFT, [SYSTEM_ACTOR_ID, 'SEED']);
      await client.query('TRUNCATE public.pricing_config_versions');
      return (await client.query<{ n: number }>('SELECT pg_catalog.count(*)::int AS n FROM public.pricing_config_versions')).rows[0]?.n;
    });
    expect(draftsOnly).toBe(0);

    const database = await db.clone(template);
    await seed(database, REFERENCE_DATASETS, recordingSink());
    const before = await pricingRows(database);
    const owner = await withClient(db.migratorConnection(database), (client) =>
      refusal(() => client.query('TRUNCATE public.pricing_config_versions')),
    );
    expect(owner).toMatchObject({ code: 'P0001', message: expect.stringContaining('PRICING_VERSION_IMMUTABLE') });
    const app = await withClient(db.appConnection(database), (client) =>
      refusal(() => client.query('TRUNCATE public.pricing_config_versions')),
    );
    expect(app).toMatchObject({ code: '42501' });
    expect(await pricingRows(database)).toEqual(before);
  }, 120_000);
});
