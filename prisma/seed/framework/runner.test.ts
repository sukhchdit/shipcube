import { SYSTEM_ACTOR_ID } from '@platform/authz';
import { describe, expect, it } from '@jest/globals';

import {
  SeedRefusedError,
  type ConfigChange,
  type ConfigChangeSink,
  type Dataset,
  type DatasetVersion,
  type DatasetVersionStore,
  type SeedLogger,
  type SeedRow,
  type SeedSql,
  type SeedStep,
} from './contracts.js';
import { hashDataset } from './hash.js';
import { REFERENCE_SEED_LOCK_KEY, runDataset, runReferenceSeed } from './runner.js';

interface Call {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

type Responder = (call: Call) => { rows: Record<string, unknown>[] } | undefined;

/** A recording SeedSql; `respond` answers statements it recognises, everything else returns no rows. */
function fakeSql(respond: Responder = () => undefined): { sql: SeedSql; calls: Call[] } {
  const calls: Call[] = [];
  const sql: SeedSql = {
    query<R extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      const call = { text, values };
      calls.push(call);
      const rows = (respond(call)?.rows ?? []) as R[];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
  };
  return { sql, calls };
}

const logger: SeedLogger & { events: string[] } = {
  events: [],
  info(event) {
    this.events.push(event);
  },
  warn(event) {
    this.events.push(event);
  },
};

function memoryVersions(initial: DatasetVersion | undefined): DatasetVersionStore & { recorded: Omit<DatasetVersion, 'appliedAt'>[] } {
  const recorded: Omit<DatasetVersion, 'appliedAt'>[] = [];
  return {
    recorded,
    get: () => Promise.resolve(initial),
    record: (_sql, version) => {
      recorded.push(version);
      return Promise.resolve();
    },
  };
}

const sink = (): ConfigChangeSink & { changes: ConfigChange[] } => {
  const changes: ConfigChange[] = [];
  return {
    changes,
    configChanged: (_sql, change) => {
      changes.push(change);
      return Promise.resolve();
    },
  };
};

const makeRows = (count: number): SeedRow[] =>
  Array.from({ length: count }, (_, index) => ({
    code: `C${String(index).padStart(5, '0')}`,
    name_en: `Name ${String(index)}`,
    source: 'SEED',
  }));

const dataset = (rows: readonly SeedRow[], overrides: Partial<Dataset> = {}): Dataset => ({
  name: 'probe',
  version: '1',
  table: 'public.probe',
  naturalKey: ['code'],
  columns: ['code', 'name_en', 'source'],
  rows,
  ...overrides,
});

const versionOf = (d: Dataset, overrides: Partial<DatasetVersion> = {}): DatasetVersion => ({
  dataset: d.name,
  version: d.version,
  contentSha256: hashDataset(d),
  rowCount: d.rows.length,
  appliedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('runDataset', () => {
  it('uses one statement per chunk of at most 500 rows (no per-row queries) and records the first version', async () => {
    const d = dataset(makeRows(1201));
    const { sql, calls } = fakeSql((call) =>
      call.text.startsWith('INSERT') ? { rows: [{ inserted: true }, { inserted: true }] } : undefined,
    );
    const versions = memoryVersions(undefined);
    const result = await runDataset({ sql, logger, versions, configChanges: sink() }, d);

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => (JSON.parse(String(call.values?.[1])) as unknown[]).length)).toEqual([500, 500, 201]);
    expect(calls.every((call) => call.values?.[0] === SYSTEM_ACTOR_ID)).toBe(true);
    expect(result).toMatchObject({ dataset: 'probe', status: 'applied', inserted: 6, updated: 0, rowCount: 1201 });
    expect(versions.recorded).toEqual([{ dataset: 'probe', version: '1', contentSha256: hashDataset(d), rowCount: 1201 }]);
  });

  it('an unchanged dataset with no drift writes nothing: no rows returned, no version row, no audit', async () => {
    const d = dataset(makeRows(3));
    const { sql } = fakeSql();
    const versions = memoryVersions(versionOf(d));
    const configChanges = sink();
    const result = await runDataset({ sql, logger, versions, configChanges }, { ...d, audited: true });
    expect(result).toMatchObject({ status: 'unchanged', inserted: 0, updated: 0 });
    expect(versions.recorded).toEqual([]);
    expect(configChanges.changes).toEqual([]);
  });

  it('restores drifted rows (reported as updated and logged as drift) without touching the version row', async () => {
    const d = dataset(makeRows(3));
    const { sql } = fakeSql(() => ({ rows: [{ inserted: false }] }));
    const versions = memoryVersions(versionOf(d));
    const configChanges = sink();
    const warnings: [string, unknown][] = [];
    const recording: SeedLogger = { info: () => undefined, warn: (event, fields) => warnings.push([event, fields]) };
    const result = await runDataset({ sql, logger: recording, versions, configChanges }, d);
    expect(result).toMatchObject({ status: 'applied', inserted: 0, updated: 1 });
    expect(versions.recorded).toEqual([]);
    expect(warnings).toEqual([['seed.drift_restored', { dataset: 'probe', rows: 1, reinserted: 0, edited: 1 }]]);
    // Not audited: no configuration change.
    expect(configChanges.changes).toEqual([]);
  });

  it('a drift restore of an audited dataset reports one drift-restored change (code review m5)', async () => {
    const d = dataset(makeRows(3), { audited: true, version: '4' });
    const { sql } = fakeSql(() => ({ rows: [{ inserted: false }, { inserted: false }] }));
    const configChanges = sink();
    await runDataset({ sql, logger, versions: memoryVersions(versionOf(d)), configChanges }, d);
    expect(configChanges.changes).toEqual([
      { kind: 'drift-restored', dataset: 'probe', version: '4', sha256: hashDataset(d), restoredRows: 2 },
    ]);
  });

  it('re-inserting a row deleted by hand is a drift restore: warned and, for an audited dataset, reported (R2-m1)', async () => {
    const d = dataset(makeRows(3), { audited: true, version: '4' });
    const { sql } = fakeSql(() => ({ rows: [{ inserted: true }] }));
    const versions = memoryVersions(versionOf(d));
    const configChanges = sink();
    const warnings: [string, unknown][] = [];
    const recording: SeedLogger = { info: () => undefined, warn: (event, fields) => warnings.push([event, fields]) };
    const result = await runDataset({ sql, logger: recording, versions, configChanges }, d);
    expect(result).toMatchObject({ status: 'applied', inserted: 1, updated: 0 });
    expect(versions.recorded).toEqual([]);
    expect(warnings).toEqual([['seed.drift_restored', { dataset: 'probe', rows: 1, reinserted: 1, edited: 0 }]]);
    expect(configChanges.changes).toEqual([
      { kind: 'drift-restored', dataset: 'probe', version: '4', sha256: hashDataset(d), restoredRows: 1 },
    ]);
  });

  it('a drift restore counts re-inserted and edited rows together in restoredRows (R2-m1)', async () => {
    const d = dataset(makeRows(3), { audited: true, version: '4' });
    const { sql } = fakeSql(() => ({ rows: [{ inserted: true }, { inserted: false }] }));
    const configChanges = sink();
    await runDataset({ sql, logger, versions: memoryVersions(versionOf(d)), configChanges }, d);
    expect(configChanges.changes).toEqual([
      { kind: 'drift-restored', dataset: 'probe', version: '4', sha256: hashDataset(d), restoredRows: 2 },
    ]);
  });

  it('re-inserting a deleted published row of an insert-only dataset is a drift restore (R2-m1)', async () => {
    const d = dataset(makeRows(2), { insertOnly: true, audited: true });
    const { sql } = fakeSql((call) => (call.text.includes('count(*)') ? { rows: [{ changed: 0 }] } : { rows: [{ inserted: true }] }));
    const configChanges = sink();
    const result = await runDataset({ sql, logger, versions: memoryVersions(versionOf(d)), configChanges }, d);
    expect(result).toMatchObject({ status: 'applied', inserted: 1, updated: 0 });
    expect(configChanges.changes).toMatchObject([{ kind: 'drift-restored', restoredRows: 1 }]);
  });

  it('a version change that also restores rows reports the version change only', async () => {
    const d = dataset(makeRows(3), { audited: true, version: '2' });
    const { sql } = fakeSql(() => ({ rows: [{ inserted: false }] }));
    const configChanges = sink();
    await runDataset({ sql, logger, versions: memoryVersions(versionOf(dataset(makeRows(3)))), configChanges }, d);
    expect(configChanges.changes.map((change) => change.kind)).toEqual(['version']);
  });

  it('a changed version or hash records the version row and reports an audited change once', async () => {
    const d = dataset(makeRows(2), { audited: true, version: '2' });
    const previous = versionOf(dataset(makeRows(1)));
    const configChanges = sink();
    const versions = memoryVersions(previous);
    await runDataset({ sql: fakeSql().sql, logger, versions, configChanges }, d);
    expect(versions.recorded).toHaveLength(1);
    expect(configChanges.changes).toEqual([
      { kind: 'version', dataset: 'probe', fromVersion: '1', toVersion: '2', fromSha256: previous.contentSha256, toSha256: hashDataset(d) },
    ]);

    const unaudited = sink();
    await runDataset(
      { sql: fakeSql().sql, logger, versions: memoryVersions(previous), configChanges: unaudited },
      { ...d, audited: false },
    );
    expect(unaudited.changes).toEqual([]);
  });

  it('an insert-only dataset whose published version changed in place is refused before any write', async () => {
    const published = dataset(makeRows(2), { insertOnly: true });
    const edited = dataset(makeRows(3), { insertOnly: true });
    const { sql, calls } = fakeSql();
    const error = await runDataset({ sql, logger, versions: memoryVersions(versionOf(published)), configChanges: sink() }, edited).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SeedRefusedError);
    expect(error).toMatchObject({ code: 'SEED_INSERT_ONLY_CHANGED', subjects: ['probe'] });
    expect(calls).toEqual([]);
  });

  it('an insert-only dataset is refused when an existing natural key holds different content', async () => {
    const d = dataset(makeRows(2), { insertOnly: true, version: '2' });
    const { sql } = fakeSql((call) => (call.text.includes('count(*)') ? { rows: [{ changed: 1 }] } : undefined));
    const error = await runDataset(
      { sql, logger, versions: memoryVersions(versionOf(d, { version: '1' })), configChanges: sink() },
      d,
    ).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'SEED_INSERT_ONLY_CHANGED' });
  });

  it('an insert-only dataset counts only newly inserted rows', async () => {
    const d = dataset(makeRows(2), { insertOnly: true });
    const { sql } = fakeSql((call) => {
      if (call.text.includes('count(*)')) return { rows: [{ changed: 0 }] };
      return { rows: [{ inserted: true }] };
    });
    const result = await runDataset({ sql, logger, versions: memoryVersions(undefined), configChanges: sink() }, d);
    expect(result).toMatchObject({ inserted: 1, updated: 0, status: 'applied' });
  });

  it('refuses an invalid dataset before any SQL', async () => {
    const { sql, calls } = fakeSql();
    const bad = dataset(makeRows(1), { table: 'nope' });
    await expect(runDataset({ sql, logger, versions: memoryVersions(undefined), configChanges: sink() }, bad)).rejects.toMatchObject({
      code: 'SEED_INVALID_DATASET',
    });
    expect(calls).toEqual([]);
  });
});

describe('runReferenceSeed', () => {
  const step = (name: string, run: () => Promise<void> = () => Promise.resolve()): SeedStep => ({ name, run });

  it('runs datasets then steps in one transaction behind an advisory lock', async () => {
    const order: string[] = [];
    const { sql, calls } = fakeSql();
    const result = await runReferenceSeed({
      sql,
      datasets: [dataset(makeRows(1))],
      steps: [
        step('first', () => {
          order.push(`first after ${String(calls.length)} statements`);
          return Promise.resolve();
        }),
      ],
      logger,
      configChanges: sink(),
      versions: memoryVersions(undefined),
    });
    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[1]).toMatchObject({ values: [REFERENCE_SEED_LOCK_KEY] });
    expect(calls[1]?.text).toContain('pg_advisory_xact_lock');
    expect(calls.at(-1)?.text).toBe('COMMIT');
    expect(order).toEqual(['first after 3 statements']);
    expect(result.steps).toEqual(['first']);
    expect(result.datasets.map((d) => d.dataset)).toEqual(['probe']);
  });

  it('rolls back and rethrows the original error when a step refuses', async () => {
    const { sql, calls } = fakeSql();
    const refusal = new SeedRefusedError('SEED_AUTHZ_DRIFT', ['role:X'], 'drift');
    await expect(
      runReferenceSeed({ sql, datasets: [], steps: [step('parity', () => Promise.reject(refusal))], logger, configChanges: sink() }),
    ).rejects.toBe(refusal);
    expect(calls.map((call) => call.text)).toEqual(['BEGIN', expect.stringContaining('pg_advisory_xact_lock'), 'ROLLBACK']);
  });

  it('keeps the original error when ROLLBACK itself fails and logs a warning', async () => {
    const failure = new Error('step failed');
    const sql: SeedSql = {
      query: (text) => (text === 'ROLLBACK' ? Promise.reject(new Error('connection lost')) : Promise.resolve({ rows: [], rowCount: 0 })),
    };
    const local = { ...logger, events: [] as string[] };
    await expect(
      runReferenceSeed({ sql, datasets: [], steps: [step('x', () => Promise.reject(failure))], logger: local, configChanges: sink() }),
    ).rejects.toBe(failure);
    expect(local.events).toContain('seed.rollback_failed');
  });

  it('refuses a pool before any statement (code review n3)', async () => {
    const { sql, calls } = fakeSql();
    const pool = Object.assign(Object.create(sql) as object, { totalCount: 0, idleCount: 0 }) as unknown as SeedSql;
    await expect(runReferenceSeed({ sql: pool, datasets: [], steps: [], logger, configChanges: sink() })).rejects.toThrow('not a pool');
    expect(calls).toEqual([]);
  });

  it('refuses invalid datasets before opening the transaction', async () => {
    const { sql, calls } = fakeSql();
    const d = dataset(makeRows(1));
    await expect(runReferenceSeed({ sql, datasets: [d, d], steps: [], logger, configChanges: sink() })).rejects.toMatchObject({
      code: 'SEED_INVALID_DATASET',
    });
    expect(calls).toEqual([]);
  });
});
