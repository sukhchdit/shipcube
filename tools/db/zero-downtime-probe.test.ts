/**
 * The zero-downtime probe (data-model.md §8.7; NT-AVAIL-003-b; TASK-034) on a fake clock: phases, the verdicts, the
 * open-loop schedule with its in-flight limit, the catalog read workload and the CLI. The PostgreSQL 18 run across a
 * real expand migration is prisma/tests/migrations/zero-downtime.int.test.ts.
 */
import { describe, expect, it, jest } from '@jest/globals';

import {
  PROBE_DEPENDENCIES,
  PROBE_POOL_LIMITS,
  READABLE_COLUMNS_SQL,
  bindParams,
  catalogReadWorkload,
  main,
  parseWorkload,
  percentile,
  readOperations,
  runZeroDowntimeProbe,
  type ProbeDependencies,
  type ProbeOperation,
  type ProbeOptions,
} from './zero-downtime-probe.js';

/** Yields once, as a real database or process call would. */
const tick = (): Promise<void> => Promise.resolve();

const READ: ProbeOperation = { name: 'read t', kind: 'read', sql: 'SELECT a FROM t LIMIT 1' };
const WRITE: ProbeOperation = {
  name: 'write t',
  kind: 'write',
  sql: 'INSERT INTO t (id, a) VALUES ($1, $2)',
  params: ['{{uuid}}', 'probe-{{seq}}', 7, null],
};

/**
 * A fake clock: sleep advances it; the migration settles when the clock reaches `migrationMs` after it started.
 * `fails(operation, at)` decides per request.
 */
function harness(
  options: {
    migrationMs?: number;
    migrationError?: Error;
    fails?: (operation: ProbeOperation, at: number) => Error | undefined;
    hang?: boolean;
  } = {},
) {
  let clock = 0;
  let settle: (() => void) | undefined;
  let migrationEnd = Number.POSITIVE_INFINITY;
  const executed: { operation: string; params: readonly unknown[]; at: number }[] = [];
  const probe: Pick<ProbeOptions, 'execute' | 'migrate' | 'now' | 'sleep' | 'uuid'> = {
    execute: (operation, params) => {
      executed.push({ operation: operation.name, params, at: clock });
      if (options.hang === true) return new Promise<void>(() => undefined);
      const error = options.fails?.(operation, clock);
      return error === undefined ? Promise.resolve() : Promise.reject(error);
    },
    migrate: () =>
      new Promise<void>((resolve, reject) => {
        migrationEnd = clock + (options.migrationMs ?? 100);
        settle = () => (options.migrationError === undefined ? resolve() : reject(options.migrationError));
      }),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      if (settle !== undefined && clock >= migrationEnd) {
        settle();
        settle = undefined;
      }
      await Promise.resolve();
    },
    uuid: () => '00000000-0000-4000-8000-000000000000',
  };
  return { probe, executed, time: () => clock };
}

const base = { ratePerSecond: 100, warmupMs: 100, afterMs: 100, maxInFlight: 4 };

describe('runZeroDowntimeProbe', () => {
  it('[NT-AVAIL-003-b] PASS: requests at the fixed rate in all three phases with 0 failures', async () => {
    const run = harness({ migrationMs: 200 });
    const report = await runZeroDowntimeProbe({ ...base, operations: [READ, WRITE], ...run.probe });
    expect(report.verdict).toBe('pass');
    expect(report.failures).toBe(0);
    expect(report.saturated).toBe(0);
    expect(report.phases.warmup.requests).toBe(10);
    expect(report.phases.during.requests).toBeGreaterThanOrEqual(19);
    expect(report.phases.after.requests).toBe(10);
    expect(report.requests).toBe(run.executed.length);
    expect(report.migrationMs).toBe(200);
    expect(report.operations).toEqual([
      { name: 'read t', kind: 'read', requests: Math.ceil(run.executed.length / 2), failures: 0 },
      { name: 'write t', kind: 'write', requests: Math.floor(run.executed.length / 2), failures: 0 },
    ]);
    expect(run.executed[1]?.params).toEqual(['00000000-0000-4000-8000-000000000000', 'probe-2', 7, null]);
  });

  it('[NT-AVAIL-003-b] FAIL: a request that fails while or after the migration runs (a dropped column) fails the run, with operation, phase and SQLSTATE', async () => {
    const run = harness({
      migrationMs: 100,
      fails: (operation, at) =>
        operation.kind === 'read' && at >= 150 ? Object.assign(new Error('column "a" does not exist'), { code: '42703' }) : undefined,
    });
    const report = await runZeroDowntimeProbe({ ...base, operations: [READ, WRITE], ...run.probe });
    expect(report.verdict).toBe('fail');
    expect(report.failures).toBeGreaterThan(0);
    expect(report.phases.warmup.failures).toBe(0);
    expect(report.samples[0]).toEqual({ operation: 'read t', phase: 'during', code: '42703', message: 'column "a" does not exist' });
    expect(report.samples.length).toBeLessThanOrEqual(20);
  });

  it('INVALID-WORKLOAD: a failure before the migration starts means the workload is wrong, not the migration', async () => {
    const run = harness({
      fails: (operation) => (operation.kind === 'write' ? new Error(`permission denied\n${'x'.repeat(300)}`) : undefined),
    });
    const report = await runZeroDowntimeProbe({ ...base, operations: [READ, WRITE], ...run.probe });
    expect(report.verdict).toBe('invalid-workload');
    expect(report.samples[0]).toMatchObject({ phase: 'warmup', code: 'ERROR' });
    expect(report.samples[0]?.message.length).toBeLessThanOrEqual(160);
  });

  it('MIGRATION-FAILED: a migration that throws is reported with its message, whatever the requests did', async () => {
    const run = harness({ migrationError: new Error('lock timeout') });
    const report = await runZeroDowntimeProbe({ ...base, operations: [READ], ...run.probe });
    expect(report).toMatchObject({ verdict: 'migration-failed', migrationError: 'lock timeout', failures: 0 });
  });

  it('[NT-AVAIL-003-b] FAIL: requests blocked past the in-flight limit count as saturated (a blocking lock is downtime too)', async () => {
    const run = harness({ hang: true, migrationMs: 10 });
    const promise = runZeroDowntimeProbe({ ...base, warmupMs: 0, afterMs: 50, operations: [READ], ...run.probe });
    // Hanging requests never settle, so the probe cannot finish; inspect the schedule instead.
    await Promise.race([promise, new Promise((resolve) => setTimeout(resolve, 50))]);
    expect(run.executed).toHaveLength(4); // maxInFlight
    expect(run.time()).toBeGreaterThan(50);
  });

  it('counts saturation, and yields (a zero sleep) without bursting when behind schedule', async () => {
    let clock = 0;
    let pending: (() => void)[] = [];
    const sleeps: number[] = [];
    const report = await runZeroDowntimeProbe({
      ...base,
      warmupMs: 0,
      afterMs: 30,
      maxInFlight: 1,
      operations: [READ],
      execute: () =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
      migrate: () => Promise.resolve(),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += 25; // a slow host: every sleep overshoots the 10 ms interval, so the loop is behind schedule
        if (clock > 50) {
          pending.forEach((resolve) => resolve());
          pending = [];
        }
        await Promise.resolve();
      },
    });
    expect(report.saturated).toBeGreaterThan(0);
    expect(report.verdict).toBe('fail');
    expect(sleeps.slice(1).every((ms) => ms === 0)).toBe(true); // behind: no catch-up burst, but it still yields
    expect(report.requests).toBeLessThan(sleeps.length);
  });

  it('[TASK-034 R1-n6] a request saturated during the warm-up makes the run INVALID (the workload is too heavy), not FAIL', async () => {
    let clock = 0;
    let pending: (() => void)[] = [];
    let migrated = false;
    const report = await runZeroDowntimeProbe({
      ...base,
      warmupMs: 40,
      afterMs: 0,
      maxInFlight: 1,
      operations: [READ],
      execute: () =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
      migrate: () => {
        migrated = true;
        return Promise.resolve();
      },
      now: () => clock,
      sleep: async () => {
        clock += 25;
        if (clock >= 50) {
          pending.forEach((resolve) => resolve());
          pending = [];
        }
        await Promise.resolve();
      },
    });
    expect(report.phases.warmup.failures).toBe(0);
    expect(report.saturated).toBeGreaterThan(0);
    expect(report.verdict).toBe('invalid-workload');
    expect(migrated).toBe(true); // the run completes; the verdict says it proves nothing
  });

  it('[TASK-034 R1-n5] an error of an idle pooled client fails a run that would otherwise pass', async () => {
    const run = harness();
    let idle = 0;
    const report = await runZeroDowntimeProbe({
      ...base,
      operations: [READ],
      ...run.probe,
      migrate: () => {
        idle += 1; // a backend terminated by the migration while its client sat idle in the pool
        return Promise.resolve();
      },
      idleErrors: () => idle,
    });
    expect(report).toMatchObject({ verdict: 'fail', failures: 0, saturated: 0, idleErrors: 1 });
  });

  it('refuses an empty workload and a non-positive rate or limit', async () => {
    const run = harness();
    await expect(runZeroDowntimeProbe({ ...base, operations: [], ...run.probe })).rejects.toThrow(/at least one operation/);
    await expect(runZeroDowntimeProbe({ ...base, ratePerSecond: 0, operations: [READ], ...run.probe })).rejects.toThrow(/positive/);
    await expect(runZeroDowntimeProbe({ ...base, maxInFlight: 0, operations: [READ], ...run.probe })).rejects.toThrow(/positive/);
  });
});

describe('workload', () => {
  it('reads every readable table with the column list of the old schema, quoted', async () => {
    const rows = [
      { schema: 'public', name: 'organisations', columns: ['id', 'name'] },
      { schema: 'public', name: 'odd"t', columns: ['x"y'] },
      { schema: 'public', name: 'no_columns', columns: [] },
    ];
    expect(readOperations(rows)).toEqual([
      { name: 'read public.organisations', kind: 'read', sql: 'SELECT "id", "name" FROM "public"."organisations" LIMIT 1' },
      { name: 'read public.odd"t', kind: 'read', sql: 'SELECT "x""y" FROM "public"."odd""t" LIMIT 1' },
    ]);
    const statements: string[] = [];
    const operations = await catalogReadWorkload({
      async query<T extends object>(sql: string): Promise<T[]> {
        await tick();
        statements.push(sql);
        return rows as unknown as T[];
      },
    });
    expect(statements).toEqual([READABLE_COLUMNS_SQL]);
    expect(operations).toHaveLength(2);
    expect(READABLE_COLUMNS_SQL).toContain("has_column_privilege(c.oid, a.attnum, 'SELECT')");
    expect(READABLE_COLUMNS_SQL).toContain('NOT c.relispartition');
  });

  it('binds {{uuid}} and {{seq}} and passes other values as they are', () => {
    expect(bindParams(WRITE, 12, () => 'u')).toEqual(['u', 'probe-12', 7, null]);
    expect(bindParams(READ, 1, () => 'u')).toEqual([]);
  });

  it('validates a workload file entry by entry', () => {
    expect(parseWorkload([{ name: 'w', kind: 'write', sql: 'INSERT INTO t VALUES ($1)', params: ['{{uuid}}', 1, true, null] }])).toEqual([
      { name: 'w', kind: 'write', sql: 'INSERT INTO t VALUES ($1)', params: ['{{uuid}}', 1, true, null] },
    ]);
    expect(parseWorkload([{ name: 'r', kind: 'read', sql: 'SELECT 1' }])).toEqual([{ name: 'r', kind: 'read', sql: 'SELECT 1' }]);
    const bad: [unknown, RegExp][] = [
      [[], /non-empty JSON array/],
      [{}, /non-empty JSON array/],
      [[null], /workload\[0\]: the entry/],
      [[{ kind: 'read', sql: 'x' }], /workload\[0\]: name/],
      [[{ name: 'n', kind: 'delete', sql: 'x' }], /workload\[0\]: kind/],
      [[{ name: 'n', kind: 'read', sql: ' ' }], /workload\[0\]: sql/],
      [[{ name: 'n', kind: 'read', sql: 'x', params: [{}] }], /workload\[0\]: params/],
    ];
    for (const [raw, message] of bad) expect(() => parseWorkload(raw)).toThrow(message);
  });

  it('takes nearest-rank percentiles', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(percentile([5], 0)).toBe(5);
  });
});

describe('db:zero-downtime-probe main', () => {
  const env = (): NodeJS.ProcessEnv => ({
    DATABASE_URL: 'postgresql://platform_app@127.0.0.1:5432/platform',
    DATABASE_MIGRATOR_URL: 'postgresql://platform_migrator@127.0.0.1:5432/platform',
    SHADOW_DATABASE_URL: 'postgresql://platform_migrator@127.0.0.1:5432/shadow',
  });

  function deps(options: { deployFails?: boolean; queryFails?: boolean; idleError?: boolean } = {}) {
    const lines: string[] = [];
    const errors: string[] = [];
    const files = new Map<string, string>();
    const queries: string[] = [];
    let ended = false;
    let deployEnv: NodeJS.ProcessEnv | undefined;
    let poolArgs: [string, number] | undefined;
    let onIdleError: ((error: unknown) => void) | undefined;
    const value: ProbeDependencies = {
      pool: (url, max, onError) => {
        poolArgs = [url, max];
        onIdleError = onError;
        return {
          query: async (sql: string) => {
            await tick();
            queries.push(sql);
            if (sql === READABLE_COLUMNS_SQL) return { rows: [{ schema: 'public', name: 't', columns: ['a'] }] };
            if (options.queryFails === true) throw Object.assign(new Error('column "a" does not exist'), { code: '42703' });
            return { rows: [] };
          },
          end: async () => {
            await tick();
            ended = true;
          },
        };
      },
      deploy: async (deployEnvironment) => {
        await tick();
        deployEnv = deployEnvironment;
        if (options.idleError === true) onIdleError?.(Object.assign(new Error('terminating connection'), { code: '57P01' }));
        if (options.deployFails === true) throw new Error('prisma migrate deploy exited with 1');
      },
      readFile: (path) => files.get(path) ?? '',
      writeFile: (path, text) => files.set(path, text),
      write: (line) => lines.push(line),
      writeError: (line) => errors.push(line),
    };
    return { value, lines, errors, files, queries, ended: () => ended, deployEnv: () => deployEnv, poolArgs: () => poolArgs };
  }

  const fast = ['--warmup-ms', '0', '--after-ms', '0', '--rate', '1000'];

  it('[NT-AVAIL-003-b] probes the catalog reads plus a workload file across prisma migrate deploy (no shadow URL), writes the report: exit 0', async () => {
    const run = deps();
    run.files.set('w.json', JSON.stringify([{ name: 'w', kind: 'write', sql: 'INSERT INTO t (a) VALUES ($1)', params: ['{{seq}}'] }]));
    const code = await main([...fast, '--workload', 'w.json', '--report', 'r.json', '--max-in-flight', '8'], env(), run.value);
    expect(run.errors).toEqual([]);
    expect(code).toBe(0);
    expect(run.poolArgs()).toEqual(['postgresql://platform_app@127.0.0.1:5432/platform', 8]);
    expect(run.queries[0]).toBe(READABLE_COLUMNS_SQL);
    expect(run.queries).toContain('SELECT "a" FROM "public"."t" LIMIT 1');
    expect(run.deployEnv()).not.toHaveProperty('SHADOW_DATABASE_URL');
    expect(run.deployEnv()?.['DATABASE_MIGRATOR_URL']).toBe(env()['DATABASE_MIGRATOR_URL']);
    expect(JSON.parse(run.files.get('r.json') ?? '{}')).toMatchObject({ verdict: 'pass' });
    expect(run.lines[0]).toMatch(
      /^\[db:zero-downtime-probe\] PASS: \d+ requests, 0 failed, 0 saturated, 0 idle-client errors; migration \d+ ms; p95 [\d.]+ ms$/,
    );
    expect(run.ended()).toBe(true);
  });

  it('[NT-AVAIL-003-b] exit 1 naming the first failure, and on a failed deploy', async () => {
    const failing = deps({ queryFails: true });
    expect(await main([...fast, '--warmup-ms', '0'].slice(2), env(), failing.value)).toBe(1);
    expect(failing.errors[0]).toMatch(/INVALID-WORKLOAD|FAIL/);
    const broken = deps({ deployFails: true });
    expect(await main(fast, env(), broken.value)).toBe(1);
    expect(broken.errors[0]).toMatch(/^\[db:zero-downtime-probe\] MIGRATION-FAILED: .*; prisma migrate deploy exited with 1$/);
    expect(broken.ended()).toBe(true);
    // R1-n5: an idle client's error reaches the pool's 'error' listener and fails the run instead of crashing the CLI.
    const idle = deps({ idleError: true });
    expect(await main(fast, env(), idle.value)).toBe(1);
    expect(idle.errors[0]).toMatch(/^\[db:zero-downtime-probe\] FAIL: \d+ requests, 0 failed, 0 saturated, 1 idle-client errors;/);
  });

  it('refuses a remote URL, URLs of different databases and a bad flag before connecting', async () => {
    const cases: [string[], NodeJS.ProcessEnv, RegExp][] = [
      [[], { ...env(), DATABASE_URL: 'postgresql://a@db.example.com/platform' }, /DATABASE_URL must name a loopback host/],
      [[], { ...env(), DATABASE_MIGRATOR_URL: 'postgresql://m@127.0.0.1:5432/other' }, /must name the same host, port and database/],
      [['--rate', '0'], env(), /--rate must be an integer from 1 to 1000/],
    ];
    for (const [argv, variables, message] of cases) {
      const run = deps();
      expect(await main(argv, variables, run.value)).toBe(1);
      expect(run.errors[0]).toMatch(message);
      expect(run.deployEnv()).toBeUndefined();
    }
  });

  it('bounds every probe request and wires the production dependencies', () => {
    expect(PROBE_POOL_LIMITS).toEqual({ connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
    expect(Object.keys(PROBE_DEPENDENCIES).sort()).toEqual(['deploy', 'pool', 'readFile', 'write', 'writeError', 'writeFile']);
    const seen: unknown[] = [];
    const pool = PROBE_DEPENDENCIES.pool('postgresql://platform_app@127.0.0.1:1/platform', 2, (error) => seen.push(error));
    // The real pg.Pool has the 'error' listener: an idle client's error is reported, not thrown (R1-n5).
    (pool as unknown as { emit(event: string, error: Error): boolean }).emit('error', new Error('idle client'));
    expect(seen).toHaveLength(1);
    const end = jest.spyOn(pool, 'end');
    return pool.end().then(() => expect(end).toHaveBeenCalled());
  });
});
