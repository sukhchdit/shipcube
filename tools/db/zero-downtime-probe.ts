/**
 * `npm run db:zero-downtime-probe` — continuous reads and writes across a migration (data-model.md §8.7;
 * NFR-AVAIL-003; NT-AVAIL-003-b; TASK-034). An expand migration must not break or block the code that is still
 * running during a rolling deploy, so the probe drives the OLD code's queries at a fixed rate while the migration runs
 * and for a while after it, and passes only with 0 failed requests.
 *
 * Phases: warm-up (before the migration starts; any failure there makes the run INVALID: the workload itself is
 * wrong), during (the migration runs), after (`afterMs` once it finished). Requests start on a fixed schedule (open
 * loop), with at most `maxInFlight` outstanding; a request that cannot start because the limit is reached counts as
 * `saturated` and fails the run too, because a blocked query is downtime as much as an error is. A failure is counted
 * in the phase in which it completes. Failures are reported as operation name, phase and SQLSTATE, with a bounded
 * message, never parameters or rows.
 *
 * The default workload (`catalogReadWorkload`) is one read per table the probe role may read, with the column list
 * taken BEFORE the migration: exactly the shape of code compiled against the old schema. A dropped or renamed column
 * or table fails it; an added nullable column, table or concurrent index does not. `--workload <json>` adds writes
 * (`[{ "name", "kind": "read" | "write", "sql", "params": ["{{uuid}}", "{{seq}}", …] }]`).
 *
 * The §8.7 CI job (the previous release's api image under a 20 rps k6 probe) needs a release image; until then this
 * database-level probe is the zero-downtime evidence (D-TASK034-05).
 *
 * CLI: DATABASE_URL (the probe role, normally platform_app) and DATABASE_MIGRATOR_URL, both loopback or a Unix socket
 * on the same host and port; the migration is `prisma migrate deploy` through the pinned wrapper. Flags: `--rate`
 * (requests per second, default 20), `--warmup-ms` (5000), `--after-ms` (60000), `--max-in-flight` (16),
 * `--workload <file>`, `--report <file>`. Exit 0 = pass.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { databaseConnectionSettings } from '@platform/config';
import pg from 'pg';

import { REPO_ROOT } from './lint-migrations.js';
import { RehearsalError, qualifiedName, type SqlSession } from './rehearsal-manifest.js';
import { integerFlag, localDatabaseUrl, messageOf, parseFlags } from './rehearsal-cli.js';
import { quoteIdentifier } from './sql-text.js';

export const PROBE_REPORT_FORMAT = 'platform.zero-downtime-probe/v1';

export interface ProbeOperation {
  readonly name: string;
  readonly kind: 'read' | 'write';
  readonly sql: string;
  /** Parameter templates: `{{uuid}}` is a fresh UUID, `{{seq}}` the request number; anything else is passed as is. */
  readonly params?: readonly (string | number | boolean | null)[];
}

export type Phase = 'warmup' | 'during' | 'after';

export interface ProbeFailure {
  readonly operation: string;
  readonly phase: Phase;
  readonly code: string;
  readonly message: string;
}

export interface ProbeOptions {
  readonly operations: readonly ProbeOperation[];
  /** Runs one operation with its bound parameters; rejects on failure. */
  readonly execute: (operation: ProbeOperation, params: readonly unknown[]) => Promise<void>;
  /** The migration under test. */
  readonly migrate: () => Promise<void>;
  readonly ratePerSecond: number;
  readonly warmupMs: number;
  readonly afterMs: number;
  readonly maxInFlight: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly uuid?: () => string;
}

export interface PhaseCounts {
  readonly requests: number;
  readonly failures: number;
}

export interface ProbeReport {
  readonly format: typeof PROBE_REPORT_FORMAT;
  readonly verdict: 'pass' | 'fail' | 'invalid-workload' | 'migration-failed';
  readonly requests: number;
  readonly failures: number;
  readonly saturated: number;
  readonly phases: Readonly<Record<Phase, PhaseCounts>>;
  readonly migrationMs: number;
  readonly migrationError: string | null;
  readonly latencyMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly operations: readonly { readonly name: string; readonly kind: string; readonly requests: number; readonly failures: number }[];
  /** The first failures (at most 20). */
  readonly samples: readonly ProbeFailure[];
}

const SAMPLE_LIMIT = 20;
const MESSAGE_LIMIT = 160;

/** Binds the parameter templates of one request. */
export function bindParams(operation: ProbeOperation, sequence: number, uuid: () => string): unknown[] {
  return (operation.params ?? []).map((param) => {
    if (param === '{{uuid}}') return uuid();
    if (typeof param === 'string' && param.includes('{{seq}}')) return param.replaceAll('{{seq}}', String(sequence));
    return param;
  });
}

/** Nearest-rank percentile of sorted values (0 for none). */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] as number;
}

const failureOf = (error: unknown): { code: string; message: string } => {
  const code = (error as { code?: unknown } | null)?.code;
  return {
    code: typeof code === 'string' && /^[0-9A-Z]{5}$|^E[A-Z]{2,15}$/.test(code) ? code : 'ERROR',
    message: messageOf(error).replace(/\s+/g, ' ').slice(0, MESSAGE_LIMIT),
  };
};

/** Runs the probe; never rejects for a failing request or migration (both are in the report). */
export async function runZeroDowntimeProbe(options: ProbeOptions): Promise<ProbeReport> {
  if (options.operations.length === 0) throw new RehearsalError('the probe needs at least one operation');
  if (!(options.ratePerSecond > 0) || options.maxInFlight < 1) throw new RehearsalError('rate and max-in-flight must be positive');
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const uuid = options.uuid ?? randomUUID;
  const interval = 1000 / options.ratePerSecond;
  let phase: Phase = 'warmup';
  const counts: Record<Phase, { requests: number; failures: number }> = {
    warmup: { requests: 0, failures: 0 },
    during: { requests: 0, failures: 0 },
    after: { requests: 0, failures: 0 },
  };
  const perOperation = options.operations.map((operation) => ({ name: operation.name, kind: operation.kind, requests: 0, failures: 0 }));
  const samples: ProbeFailure[] = [];
  const latencies: number[] = [];
  const inFlight = new Set<Promise<void>>();
  let sequence = 0;
  let saturated = 0;

  const launch = (): void => {
    const index = sequence % options.operations.length;
    const operation = options.operations[index] as ProbeOperation;
    const stats = perOperation[index] as { requests: number; failures: number };
    sequence += 1;
    const params = bindParams(operation, sequence, uuid);
    const started = now();
    const request = options.execute(operation, params).then(
      () => {
        latencies.push(now() - started);
        counts[phase].requests += 1;
        stats.requests += 1;
      },
      (error: unknown) => {
        latencies.push(now() - started);
        counts[phase].requests += 1;
        counts[phase].failures += 1;
        stats.requests += 1;
        stats.failures += 1;
        if (samples.length < SAMPLE_LIMIT) samples.push({ operation: operation.name, phase, ...failureOf(error) });
      },
    );
    const tracked = request.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
  };

  let next = now();
  const drive = async (done: () => boolean): Promise<void> => {
    while (!done()) {
      if (inFlight.size >= options.maxInFlight) saturated += 1;
      else launch();
      next += interval;
      const wait = next - now();
      if (wait <= 0) next = now(); // behind schedule: no burst to catch up
      // Always yield, even when behind: the requests and the migration settle on the event loop.
      await sleep(Math.max(0, wait));
    }
  };

  const warmupEnd = now() + options.warmupMs;
  await drive(() => now() >= warmupEnd);
  await Promise.allSettled([...inFlight]);
  const warmupFailures = counts.warmup.failures;

  phase = 'during';
  let migrationDone = false;
  let migrationError: string | null = null;
  const migrationStart = now();
  const migration = options.migrate().then(
    () => undefined,
    (error: unknown) => {
      migrationError = messageOf(error).replace(/\s+/g, ' ').slice(0, 300);
    },
  );
  const settled = migration.finally(() => {
    migrationDone = true;
  });
  await drive(() => migrationDone);
  await settled;
  const migrationMs = Math.round(now() - migrationStart);

  phase = 'after';
  const afterEnd = now() + options.afterMs;
  await drive(() => now() >= afterEnd);
  await Promise.allSettled([...inFlight]);

  const sorted = [...latencies].sort((a, b) => a - b);
  const failures = counts.during.failures + counts.after.failures;
  const verdict =
    warmupFailures > 0
      ? 'invalid-workload'
      : migrationError !== null
        ? 'migration-failed'
        : failures > 0 || saturated > 0
          ? 'fail'
          : 'pass';
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    format: PROBE_REPORT_FORMAT,
    verdict,
    requests: counts.warmup.requests + counts.during.requests + counts.after.requests,
    failures,
    saturated,
    phases: counts,
    migrationMs,
    migrationError,
    latencyMs: { p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), max: round(sorted.at(-1) ?? 0) },
    operations: perOperation,
    samples,
  };
}

/** Tables (and their columns) the current role may read, with the column-level privilege honoured. */
export const READABLE_COLUMNS_SQL = `SELECT n.nspname AS schema, c.relname AS name,
       ARRAY(SELECT a.attname FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
              ORDER BY a.attnum)::pg_catalog.text[] AS columns
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
   AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
 ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`;

/** One `SELECT <columns as of now> FROM <table> LIMIT 1` per readable table (tables without a readable column skipped). */
export function readOperations(rows: readonly { schema: string; name: string; columns: readonly string[] }[]): ProbeOperation[] {
  return rows
    .filter((row) => row.columns.length > 0)
    .map((row) => ({
      name: `read ${row.schema}.${row.name}`,
      kind: 'read' as const,
      sql: `SELECT ${row.columns.map(quoteIdentifier).join(', ')} FROM ${qualifiedName(row.schema, row.name)} LIMIT 1`,
    }));
}

/** The default workload: the old code's reads, captured before the migration. */
export async function catalogReadWorkload(session: SqlSession): Promise<ProbeOperation[]> {
  return readOperations(await session.query<{ schema: string; name: string; columns: string[] }>(READABLE_COLUMNS_SQL));
}

/** Validates a workload file (a boundary). */
export function parseWorkload(raw: unknown): ProbeOperation[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new RehearsalError('the workload must be a non-empty JSON array of operations');
  return raw.map((entry: unknown, index) => {
    const value = entry as Record<string, unknown> | null;
    const bad = (field: string): never => {
      throw new RehearsalError(`workload[${String(index)}]: ${field} is missing or invalid`);
    };
    if (value === null || typeof value !== 'object') return bad('the entry');
    if (typeof value['name'] !== 'string' || value['name'] === '') bad('name');
    if (value['kind'] !== 'read' && value['kind'] !== 'write') bad('kind');
    if (typeof value['sql'] !== 'string' || value['sql'].trim() === '') bad('sql');
    const params = value['params'];
    if (
      params !== undefined &&
      !(Array.isArray(params) && params.every((param) => param === null || ['string', 'number', 'boolean'].includes(typeof param)))
    ) {
      bad('params');
    }
    return {
      name: value['name'] as string,
      kind: value['kind'] as 'read' | 'write',
      sql: value['sql'] as string,
      ...(params === undefined ? {} : { params: params as ProbeOperation['params'] & object }),
    };
  });
}

/** Per-request limits of the probe pool: a blocked query fails within seconds instead of hanging the run. */
export const PROBE_POOL_LIMITS = { connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000 } as const;

/** Side effects of main, injectable for the unit tests. */
export interface ProbeDependencies {
  readonly pool: (
    connectionString: string,
    max: number,
  ) => { query(sql: string, params: unknown[]): Promise<unknown>; end(): Promise<void> };
  readonly deploy: (env: NodeJS.ProcessEnv) => Promise<void>;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, text: string) => void;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
}

const DEPLOY_TIMEOUT_MS = 10 * 60_000;

/** `prisma migrate deploy` through the pinned wrapper, asynchronously (the probe keeps running meanwhile). */
export function prismaDeploy(env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'tools', 'deps', 'prisma-cli.mjs'), 'migrate', 'deploy'], {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), DEPLOY_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new RehearsalError(`prisma migrate deploy exited with ${String(code)}`));
    });
  });
}

export const PROBE_DEPENDENCIES: ProbeDependencies = {
  pool: (connectionString, max) => new pg.Pool({ ...databaseConnectionSettings(new URL(connectionString)), ...PROBE_POOL_LIMITS, max }),
  deploy: prismaDeploy,
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text),
  write: (line) => process.stdout.write(`${line}\n`),
  writeError: (line) => process.stderr.write(`${line}\n`),
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: ProbeDependencies = PROBE_DEPENDENCIES,
): Promise<number> {
  try {
    const flags = parseFlags(argv, { values: ['rate', 'warmup-ms', 'after-ms', 'max-in-flight', 'workload', 'report'], switches: [] });
    const app = localDatabaseUrl(env, 'DATABASE_URL');
    const migrator = localDatabaseUrl(env, 'DATABASE_MIGRATOR_URL');
    if (
      app.endpoint.host !== migrator.endpoint.host ||
      app.endpoint.port !== migrator.endpoint.port ||
      app.endpoint.database !== migrator.endpoint.database
    ) {
      throw new RehearsalError('DATABASE_URL and DATABASE_MIGRATOR_URL must name the same host, port and database');
    }
    const maxInFlight = integerFlag(flags, 'max-in-flight', 16, 1, 256);
    const pool = deps.pool(app.url, maxInFlight);
    try {
      const reads = await catalogReadWorkload({
        query: async <T extends object>(sql: string) => ((await pool.query(sql, [])) as { rows: T[] }).rows,
      });
      const workloadFile = flags.values.get('workload');
      const extra = workloadFile === undefined ? [] : parseWorkload(JSON.parse(deps.readFile(workloadFile)) as unknown);
      const deployEnv = { ...env };
      delete deployEnv['SHADOW_DATABASE_URL'];
      const report = await runZeroDowntimeProbe({
        operations: [...reads, ...extra],
        execute: async (operation, params) => {
          await pool.query(operation.sql, [...params]);
        },
        migrate: () => deps.deploy(deployEnv),
        ratePerSecond: integerFlag(flags, 'rate', 20, 1, 1000),
        warmupMs: integerFlag(flags, 'warmup-ms', 5_000, 0, 600_000),
        afterMs: integerFlag(flags, 'after-ms', 60_000, 0, 3_600_000),
        maxInFlight,
      });
      const reportFile = flags.values.get('report');
      if (reportFile !== undefined) deps.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
      const line = `${report.verdict.toUpperCase()}: ${String(report.requests)} requests, ${String(report.failures)} failed, ${String(report.saturated)} saturated; migration ${String(report.migrationMs)} ms; p95 ${String(report.latencyMs.p95)} ms`;
      if (report.verdict === 'pass') {
        deps.write(`[db:zero-downtime-probe] ${line}`);
        return 0;
      }
      const first = report.samples[0];
      deps.writeError(
        `[db:zero-downtime-probe] ${line}${report.migrationError === null ? '' : `; ${report.migrationError}`}${first === undefined ? '' : `; first failure: ${first.operation} (${first.phase}, ${first.code})`}`,
      );
      return 1;
    } finally {
      await pool.end();
    }
  } catch (error) {
    deps.writeError(`[db:zero-downtime-probe] ${messageOf(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
