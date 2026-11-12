import { SYSTEM_ACTOR_ID } from '@platform/authz';

import type { DatasetVersion, DatasetVersionStore, SeedSql } from './contracts.js';

interface VersionRow extends Record<string, unknown> {
  readonly dataset: string;
  readonly dataset_version: string;
  readonly content_sha256: Buffer;
  readonly row_count: number;
  readonly applied_at: Date;
}

/**
 * {@link DatasetVersionStore} over `public.reference_dataset_versions` (data-model §3.5). The table's own `version`
 * column is the row's optimistic-lock counter; the dataset's version label is stored in `dataset_version`.
 * `record` is an upsert by `dataset`, written as the SYSTEM actor, and stamps `applied_at` with the transaction time.
 * Only the seed's `platform_migrator` connection (the owner) can write it: `platform_app` holds `SELECT` only
 * (data-model §4.4, D-ARCH-075).
 */
export const referenceDatasetVersions: DatasetVersionStore = {
  async get(sql: SeedSql, dataset: string): Promise<DatasetVersion | undefined> {
    const result = await sql.query<VersionRow>(
      `SELECT dataset, dataset_version, content_sha256, row_count, applied_at
         FROM public.reference_dataset_versions WHERE dataset = $1`,
      [dataset],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      dataset: row.dataset,
      version: row.dataset_version,
      contentSha256: row.content_sha256.toString('hex'),
      rowCount: row.row_count,
      appliedAt: row.applied_at,
    };
  },

  async record(sql: SeedSql, version: Omit<DatasetVersion, 'appliedAt'>): Promise<void> {
    await sql.query(
      `INSERT INTO public.reference_dataset_versions AS cur
         (dataset, dataset_version, content_sha256, row_count, applied_at, created_by, updated_by)
       VALUES ($1, $2, pg_catalog.decode($3, 'hex'), $4, pg_catalog.now(), $5::pg_catalog.uuid, $5::pg_catalog.uuid)
       ON CONFLICT (dataset) DO UPDATE SET
         dataset_version = EXCLUDED.dataset_version,
         content_sha256 = EXCLUDED.content_sha256,
         row_count = EXCLUDED.row_count,
         applied_at = EXCLUDED.applied_at,
         updated_at = pg_catalog.now(),
         updated_by = EXCLUDED.updated_by,
         version = cur.version + 1`,
      [version.dataset, version.version, version.contentSha256, version.rowCount, SYSTEM_ACTOR_ID],
    );
  },
};
