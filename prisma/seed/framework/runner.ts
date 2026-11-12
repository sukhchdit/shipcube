import { SYSTEM_ACTOR_ID } from '@platform/authz';

import {
  SeedRefusedError,
  type ConfigChangeSink,
  type Dataset,
  type DatasetResult,
  type DatasetVersionStore,
  type SeedContext,
  type SeedLogger,
  type SeedSql,
  type SeedStep,
} from './contracts.js';
import { hashDataset } from './hash.js';
import { chunk, renderChangedCount, renderInsertOnly, renderUpsert, rowsParameter } from './sql.js';
import { validateDataset, validateDatasets } from './validate.js';
import { referenceDatasetVersions } from './version-store.js';

/** `pg_advisory_xact_lock` key of the reference seed: concurrent seed jobs (scaled-out compose, deploy overlap) queue up. */
export const REFERENCE_SEED_LOCK_KEY = 4_821_950_023;

export interface ReferenceSeedOptions {
  readonly sql: SeedSql;
  readonly datasets: readonly Dataset[];
  readonly steps: readonly SeedStep[];
  readonly logger: SeedLogger;
  readonly configChanges: ConfigChangeSink;
  readonly versions?: DatasetVersionStore;
}

export interface ReferenceSeedResult {
  readonly datasets: readonly DatasetResult[];
  readonly steps: readonly string[];
}

type DatasetContext = Pick<SeedContext, 'sql' | 'logger' | 'versions' | 'configChanges'>;

/**
 * Applies one dataset inside the caller's transaction: validate, hash, upsert in chunks of at most 500 rows (one
 * statement per chunk, no per-row queries), then write the version row (and report an audited change) only when the
 * version label or the content hash changed.
 *
 * Rows are checked on every run, not only when the hash changed, so a row edited by hand in the database is restored
 * (AT-US-049-08); a run that finds nothing to do writes nothing at all (AT-US-049-01). A restoration is logged as
 * `warn seed.drift_restored` (tamper evidence) and, for an audited dataset whose version did not change, reported as a
 * `drift-restored` `ConfigChange`.
 */
export async function runDataset(context: DatasetContext, dataset: Dataset): Promise<DatasetResult> {
  validateDataset(dataset);
  const { sql, logger, versions, configChanges } = context;
  const contentSha256 = hashDataset(dataset);
  const existing = await versions.get(sql, dataset.name);

  if (dataset.insertOnly === true && existing?.version === dataset.version && existing.contentSha256 !== contentSha256) {
    throw insertOnlyChanged(dataset);
  }

  let inserted = 0;
  let updated = 0;
  for (const rows of chunk(dataset.rows)) {
    const parameter = rowsParameter(dataset, rows);
    if (dataset.insertOnly === true) {
      const written = await sql.query(renderInsertOnly(dataset), [SYSTEM_ACTOR_ID, parameter]);
      inserted += written.rows.length;
      const changed = await sql.query<{ changed: number }>(renderChangedCount(dataset), [parameter]);
      if ((changed.rows[0]?.changed ?? 0) > 0) throw insertOnlyChanged(dataset);
    } else {
      const written = await sql.query<{ inserted: boolean }>(renderUpsert(dataset), [SYSTEM_ACTOR_ID, parameter]);
      for (const row of written.rows) {
        if (row.inserted) inserted += 1;
        else updated += 1;
      }
    }
  }

  const versionChanged = existing === undefined || existing.version !== dataset.version || existing.contentSha256 !== contentSha256;
  if (versionChanged) {
    await versions.record(sql, { dataset: dataset.name, version: dataset.version, contentSha256, rowCount: dataset.rows.length });
    if (dataset.audited === true) {
      await configChanges.configChanged(sql, {
        kind: 'version',
        dataset: dataset.name,
        fromVersion: existing?.version,
        toVersion: dataset.version,
        fromSha256: existing?.contentSha256,
        toSha256: contentSha256,
      });
    }
  } else if (updated > 0) {
    logger.warn('seed.drift_restored', { dataset: dataset.name, rows: updated });
    if (dataset.audited === true) {
      await configChanges.configChanged(sql, {
        kind: 'drift-restored',
        dataset: dataset.name,
        version: dataset.version,
        sha256: contentSha256,
        restoredRows: updated,
      });
    }
  }

  const result: DatasetResult = {
    dataset: dataset.name,
    status: versionChanged || inserted > 0 || updated > 0 ? 'applied' : 'unchanged',
    inserted,
    updated,
    rowCount: dataset.rows.length,
    contentSha256,
  };
  logger.info('seed.dataset', { dataset: dataset.name, status: result.status, inserted, updated, rows: result.rowCount });
  return result;
}

function insertOnlyChanged(dataset: Dataset): SeedRefusedError {
  return new SeedRefusedError(
    'SEED_INSERT_ONLY_CHANGED',
    [dataset.name],
    `Seed refused: published dataset ${dataset.name} changed in place; add a new version instead (data-model §9.1).`,
  );
}

/**
 * The reference seed: every dataset, then every step, in ONE transaction guarded by a transaction-level advisory lock.
 * Any failure rolls the whole run back, so a refused insert-only change or an authz drift leaves nothing half-applied.
 */
export async function runReferenceSeed(options: ReferenceSeedOptions): Promise<ReferenceSeedResult> {
  const { sql, datasets, steps, logger, configChanges } = options;
  const versions = options.versions ?? referenceDatasetVersions;
  if ('totalCount' in sql) {
    // A pool would run BEGIN, the lock and COMMIT on different connections (code review n3).
    throw new TypeError('runReferenceSeed needs one dedicated connection (a pg.Client), not a pool');
  }
  validateDatasets(datasets);

  await sql.query('BEGIN');
  try {
    await sql.query('SELECT pg_catalog.pg_advisory_xact_lock($1::pg_catalog.int8)', [REFERENCE_SEED_LOCK_KEY]);
    const context: SeedContext = { sql, logger, versions, configChanges };
    const results: DatasetResult[] = [];
    for (const dataset of datasets) results.push(await runDataset(context, dataset));
    for (const step of steps) {
      await step.run(context);
      logger.info('seed.step', { step: step.name });
    }
    await sql.query('COMMIT');
    return { datasets: results, steps: steps.map((step) => step.name) };
  } catch (error) {
    // A failed ROLLBACK means the connection is gone (the server then rolls back); the original error is the useful one.
    await sql.query('ROLLBACK').catch(() => {
      logger.warn('seed.rollback_failed');
    });
    throw error;
  }
}
