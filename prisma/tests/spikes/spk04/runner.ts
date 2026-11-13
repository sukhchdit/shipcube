/**
 * SPK-04 (TASK-018; R-ARCH-04; NFR-AUDIT-005, NFR-PERF-001) THROWAWAY runner of the audit write A/B benchmark.
 *
 *   npm exec --no -- tsx prisma/tests/spikes/spk04/runner.ts        (Docker required; run under the host Docker lock)
 *
 * Lifecycle (D-ARCH-089, SPK-04 §8): deleted by the TASK-280 PR, after the arm loop, the CPU sampler, the verdict and the
 * evidence writer are ported to tests/load. Harness-only: nothing under apps/** or packages/** imports this file, it counts
 * toward no coverage, it ships in no image, and the `SPK04_AUDIT` switch of server.ts exists nowhere else. Every path it
 * reads is listed in paths.ts and checked by paths.test.ts (a unit test), so a moved file fails lane A, not TASK-280.
 *
 * 1. Starts PostgreSQL 18 (the pinned harness image), applies the REAL bootstrap lane (`prisma/bootstrap`: 00..02, then
 *    10-audit.sql, then 90-audit-ddl-guard.sql, TASK-021, which owns audit_entries, audit_stream_heads, data_subjects and
 *    audit_pii_vault), every migration as the migrator, the tenant business table (fixtures/30-spk04-business.sql), then
 *    seeds 100 orgs.
 * 2. For each repetition and arm (off, on, batched): starts two server.ts replicas in that mode on loopback, runs k6
 *    (Docker, image pinned by digest) for a discarded warm-up, resets the replica stats, runs the measured window while
 *    sampling host CPU every second and `docker stats` of the Postgres container once, then stops the replicas.
 * 3. Verifies integrity as the superuser (chain recompute, immutability as platform_app and as the superuser, ENABLE ALWAYS
 *    triggers, the RLS state of the product design, partitions) and writes the evidence: host-spec.json,
 *    k6-audit-ab.summary.json, summary.json, summary.md. The step fails closed: if it throws or any check is not ok the
 *    verdict is INTEGRITY_FAILED and the process exits 1 (after the evidence is written).
 *
 * Environment: SPK04_RATE (300), SPK04_WARMUP_S (20), SPK04_MEASURE_S (120), SPK04_REPS (2), SPK04_OUT (default
 * docs/05-quality/performance/spikes/SPK-04/<UTC stamp>_<sha7>), SPK04_PORT_BASE (4101).
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, release, tmpdir, totalmem, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import pg from 'pg';

import { findRepoRoot } from '../../../../tools/test-support/process.js';
import { PlatformPostgres, POSTGRES_IMAGE } from '../../harness/postgres.js';
import { type AuditEntry, entryHash, uuidv7, ZERO_HASH_HEX } from './chain.js';
import type { Op, OpSamples, Seed, StatsBody } from './server.js';
import { harnessPaths } from './paths.js';
import {
  type Arm,
  type ArmMeasurement,
  decide,
  delta,
  type FinalVerdict,
  finalVerdict,
  integrityFailures,
  percentile,
  pooled,
  type Repetition,
  validity,
} from './verdict.js';

const run = promisify(execFile);
const repoRoot = findRepoRoot();
const paths = harnessPaths(repoRoot);
/** grafana/k6 v2.2.0 (commit 00a9a1b7f5, image created 2026-08-10), pinned by digest (the 2.2.0 tag now resolves to another index digest). */
const K6_IMAGE = 'grafana/k6@sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec';
const OPS: readonly Op[] = ['create', 'update', 'detail', 'list', 'login_failed'];
const ARMS: readonly Arm[] = ['off', 'on', 'batched'];
const DB = 'spk04';
const ORG_COUNT = 100;
const ORDERS_PER_ORG = 20;
const SUBJECTS_PER_ORG = 3;
const POOL_MAX = 10;
const REPLICAS = 2;

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : Number(raw);
};
const RATE = num('SPK04_RATE', 300);
const WARMUP_S = num('SPK04_WARMUP_S', 20);
const MEASURE_S = num('SPK04_MEASURE_S', 120);
const REPS = num('SPK04_REPS', 2);
const PORT_BASE = num('SPK04_PORT_BASE', 4101);

const log = (message: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
};

async function git(args: readonly string[]): Promise<string> {
  return (await run('git', ['-C', repoRoot, ...args])).stdout.trim();
}

// --- database setup -------------------------------------------------------------------------------------------------
async function withClient<T>(client: pg.Client, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function inTransaction(client: pg.Client, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** The real bootstrap lane (runBootstrap applies 00..02, 10-audit.sql and 90-audit-ddl-guard.sql in order), then the migrations. */
async function setupDatabase(pgh: PlatformPostgres): Promise<void> {
  await pgh.createDatabase(DB);
  await pgh.bootstrap(DB, paths.bootstrapDir);
  const migrator = new pg.Client(pgh.migratorConnection(DB));
  await migrator.connect();
  await withClient(migrator, async (c) => {
    for (const dir of readdirSync(paths.migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()) {
      await inTransaction(c, readFileSync(join(paths.migrationsDir, dir, 'migration.sql'), 'utf8'));
    }
  });
  await withClient(await pgh.superuser(DB), (c) => inTransaction(c, readFileSync(paths.businessFixture, 'utf8')));
}

async function seedDatabase(pgh: PlatformPostgres): Promise<Seed> {
  const orgs = Array.from({ length: ORG_COUNT }, () => ({
    id: uuidv7(),
    userId: uuidv7(),
    subjects: Array.from({ length: SUBJECTS_PER_ORG }, () => uuidv7()),
    orders: Array.from({ length: ORDERS_PER_ORG }, () => uuidv7()),
  }));
  const systemShards = Array.from({ length: 16 }, (_, i) => `00000000-0000-7000-8000-${(0x100 + i).toString(16).padStart(12, '0')}`);
  await withClient(await pgh.superuser(DB), async (c) => {
    const orderIds = orgs.flatMap((o) => o.orders);
    const orderOrgs = orgs.flatMap((o) => o.orders.map(() => o.id));
    const orderUsers = orgs.flatMap((o) => o.orders.map(() => o.userId));
    await c.query(
      `INSERT INTO public.spk04_orders (id, org_id, created_at, created_by, updated_by, status, origin_country, dest_country,
              weight_grams, sender_name, sender_email, receiver_phone)
       SELECT t.id, t.org_id, pg_catalog.now() - (t.n * interval '1 minute'), t.user_id, t.user_id, 'DRAFT', 'US', 'IN', 1000,
              'Seed Sender', 'seed@example.test', '+15550000000'
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) WITH ORDINALITY AS t(id, org_id, user_id, n)`,
      [orderIds, orderOrgs, orderUsers],
    );
    await c.query(
      `INSERT INTO public.data_subjects (id, created_by, updated_by, kind, ref_id)
       SELECT t.id, t.user_id, t.user_id, 'CONTACT', pg_catalog.gen_random_uuid()
         FROM unnest($1::uuid[], $2::uuid[]) AS t(id, user_id)`,
      [orgs.flatMap((o) => o.subjects), orgs.flatMap((o) => o.subjects.map(() => o.userId))],
    );
    await c.query('ANALYZE public.spk04_orders, public.data_subjects');
  });
  return { orgs, systemShards };
}

// --- host and container facts ---------------------------------------------------------------------------------------
interface CpuTimes {
  idle: number;
  total: number;
}
const cpuTimes = (): CpuTimes =>
  cpus().reduce(
    (acc, c) => ({
      idle: acc.idle + c.times.idle,
      total: acc.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
    }),
    { idle: 0, total: 0 },
  );

function cpuSampler(): { stop: () => number[] } {
  const samples: number[] = [];
  let prev = cpuTimes();
  const timer = setInterval(() => {
    const cur = cpuTimes();
    const total = cur.total - prev.total;
    samples.push(total > 0 ? Math.round((1 - (cur.idle - prev.idle) / total) * 1000) / 10 : 0);
    prev = cur;
  }, 1000);
  return {
    stop: () => {
      clearInterval(timer);
      return samples;
    },
  };
}

async function hostSpec(pgh: PlatformPostgres): Promise<Record<string, unknown>> {
  const docker = async (args: readonly string[]): Promise<string> => (await run('docker', [...args])).stdout.trim();
  const settings = await withClient(await pgh.superuser(DB), async (c) => {
    const { rows } = await c.query<{ name: string; setting: string }>(
      `SELECT name, setting FROM pg_catalog.pg_settings WHERE name IN ('server_version','shared_buffers','max_connections',
         'synchronous_commit','fsync','wal_level','work_mem','effective_io_concurrency','checkpoint_timeout','max_wal_size')`,
    );
    return Object.fromEntries(rows.map((r) => [r.name, r.setting]));
  });
  return {
    cpuModel: cpus()[0]?.model,
    logicalCores: cpus().length,
    ramTotalGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    ramFreeGiBAtStart: Math.round((freemem() / 2 ** 30) * 10) / 10,
    os: `${osVersion()} ${release()}`,
    node: process.version,
    dockerServer: await docker(['version', '--format', '{{.Server.Version}}']),
    dockerVm: await docker(['info', '--format', '{{.NCPU}} CPUs, {{.MemTotal}} bytes']),
    postgresImage: POSTGRES_IMAGE,
    postgresSettings: settings,
    k6Image: K6_IMAGE,
    k6Version: await docker(['run', '--rm', K6_IMAGE, 'version']),
    replicas: REPLICAS,
    poolMaxPerReplica: POOL_MAX,
    txOptions: { statementTimeoutMs: 5000, lockTimeoutMs: 2000, idleInTransactionTimeoutMs: 15000, poolConnectionTimeoutMs: 5000 },
    bind: '127.0.0.1 (k6 container reaches it via host.docker.internal)',
  };
}

// --- replicas and k6 ------------------------------------------------------------------------------------------------
async function startReplicas(mode: Arm, seedFile: string, databaseUrl: string): Promise<ChildProcess[]> {
  const children = Array.from({ length: REPLICAS }, (_, i) =>
    spawn(process.execPath, ['--import', 'tsx', paths.serverEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SPK04_AUDIT: mode,
        SPK04_REPLICA: `r${String(i)}`,
        SPK04_PORT: String(PORT_BASE + i),
        SPK04_SEED: seedFile,
        SPK04_DATABASE_URL: databaseUrl,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  );
  for (let i = 0; i < REPLICAS; i += 1) {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${String(PORT_BASE + i)}/__health`)).ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`replica ${String(i)} did not start`);
      await sleep(250);
    }
  }
  return children;
}

async function stopReplicas(children: readonly ChildProcess[]): Promise<void> {
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', () => resolve());
          child.kill();
        }),
    ),
  );
}

const targets = (): string => Array.from({ length: REPLICAS }, (_, i) => `http://host.docker.internal:${String(PORT_BASE + i)}`).join(',');

interface K6Result {
  exitCode: number;
  summary: K6Summary;
}

interface K6Metric {
  values: Record<string, number>;
}
interface K6Summary {
  metrics: Record<string, K6Metric | undefined>;
}

async function k6(durationS: number): Promise<K6Result> {
  const args = [
    'run',
    '--rm',
    '-v',
    `${paths.k6ScriptDir}:/scripts:ro`,
    '-e',
    `RATE=${String(RATE)}`,
    '-e',
    `DURATION=${String(durationS)}s`,
  ];
  args.push('-e', `TARGETS=${targets()}`, '-e', `ORGS=${String(ORG_COUNT)}`, K6_IMAGE, 'run', '--quiet', '/scripts/spk04-audit.js');
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
  const exitCode = await new Promise<number>((resolve) => child.once('close', (code) => resolve(code ?? -1)));
  const match = /@@SPK04_SUMMARY@@([\s\S]*)@@END@@/.exec(out);
  if (match?.[1] === undefined) throw new Error(`k6 produced no summary (exit ${String(exitCode)}): ${err.slice(-2000)}`);
  // exit 99 = informational thresholds crossed; anything else non-zero is a failed run
  if (exitCode !== 0 && exitCode !== 99) throw new Error(`k6 failed with exit ${String(exitCode)}: ${err.slice(-2000)}`);
  return { exitCode, summary: JSON.parse(match[1]) as K6Summary };
}

async function replicaStats(): Promise<StatsBody[]> {
  return Promise.all(
    Array.from(
      { length: REPLICAS },
      async (_, i) => (await fetch(`http://127.0.0.1:${String(PORT_BASE + i)}/__stats`)).json() as Promise<StatsBody>,
    ),
  );
}

async function resetStats(): Promise<void> {
  for (let i = 0; i < REPLICAS; i += 1) await fetch(`http://127.0.0.1:${String(PORT_BASE + i)}/__reset`, { method: 'POST' });
}

// --- aggregation ----------------------------------------------------------------------------------------------------
const round = (value: number): number => Math.round(value * 100) / 100;
const pcts = (samples: readonly number[]): { p50: number; p95: number; p99: number; max: number } => ({
  p50: round(percentile(samples, 50)),
  p95: round(percentile(samples, 95)),
  p99: round(percentile(samples, 99)),
  max: round(percentile(samples, 100)),
});
const mean = (samples: readonly number[]): number =>
  samples.length === 0 ? 0 : round(samples.reduce((a, b) => a + b, 0) / samples.length);

function aggregateServer(bodies: readonly StatsBody[]): Record<string, unknown> {
  const merged = (op: Op): OpSamples => {
    const parts = bodies.map((b) => b[op]);
    return {
      total: parts.flatMap((p) => p.total),
      audit: parts.flatMap((p) => p.audit),
      lock: parts.flatMap((p) => p.lock),
      roundTrips: parts.flatMap((p) => p.roundTrips),
      hot: parts.flatMap((p) => p.hot),
      errors: parts.reduce((sum, p) => sum + p.errors, 0),
    };
  };
  const perOp: Record<string, unknown> = {};
  const hotLock: number[] = [];
  const hotAudit: number[] = [];
  const allAudit: number[] = [];
  const allLock: number[] = [];
  for (const op of OPS) {
    const s = merged(op);
    const hotIdx = s.hot.flatMap((h, i) => (h === 1 ? [i] : []));
    hotLock.push(...hotIdx.map((i) => s.lock[i] ?? 0));
    hotAudit.push(...hotIdx.map((i) => s.audit[i] ?? 0));
    allAudit.push(...s.audit);
    allLock.push(...s.lock);
    perOp[op] = {
      count: s.total.length,
      errors: s.errors,
      serverTotalMs: pcts(s.total),
      auditPhaseMs: pcts(s.audit),
      lockWaitMs: pcts(s.lock),
      roundTrips: { mean: mean(s.roundTrips), min: Math.min(...s.roundTrips), max: Math.max(...s.roundTrips) },
    };
  }
  const errorsByKind: Record<string, number> = {};
  for (const body of bodies) for (const [k, v] of Object.entries(body.errorsByKind)) errorsByKind[k] = (errorsByKind[k] ?? 0) + v;
  return {
    perOp,
    auditPhaseMs: pcts(allAudit),
    lockWaitMs: pcts(allLock),
    hotOrg: { count: hotLock.length, lockWaitMs: pcts(hotLock), auditPhaseMs: pcts(hotAudit) },
    errorsByKind,
  };
}

function k6Latency(summary: K6Summary, metric: string): { p50: number; p95: number; p99: number; count?: number } {
  const v = summary.metrics[metric]?.values ?? {};
  return { p50: round(v['p(50)'] ?? Number.NaN), p95: round(v['p(95)'] ?? Number.NaN), p99: round(v['p(99)'] ?? Number.NaN) };
}

function k6Arm(summary: K6Summary, cpu: readonly number[]): ArmMeasurement & Record<string, unknown> {
  const iterations = summary.metrics['iterations']?.values['count'] ?? 0;
  const dropped = summary.metrics['dropped_iterations']?.values['count'] ?? 0;
  const perOp = Object.fromEntries(OPS.map((op) => [op, k6Latency(summary, `http_req_duration{op:${op}}`)]));
  return {
    latency: k6Latency(summary, 'http_req_duration'),
    droppedRatio: iterations + dropped === 0 ? 0 : dropped / (iterations + dropped),
    cpuBusy: cpu,
    iterations,
    dropped,
    achievedRps: round(summary.metrics['http_reqs']?.values['rate'] ?? 0),
    errorRate: summary.metrics['http_req_failed']?.values['rate'] ?? 0,
    perOp,
    hot: k6Latency(summary, 'http_req_duration{hot:1}'),
    notHot: k6Latency(summary, 'http_req_duration{hot:0}'),
    cpu: { mean: mean(cpu), p95: round(percentile(cpu, 95)), samples: cpu.length },
  };
}

// --- integrity ------------------------------------------------------------------------------------------------------
interface EntryRow {
  id: string;
  us: string;
  stream_id: string;
  stream_seq: string;
  org_id: string | null;
  target_org_id: string | null;
  on_behalf_of_org_id: string | null;
  actor_type: AuditEntry['actorType'];
  user_id: string | null;
  api_key_id: string | null;
  job_name: string | null;
  actor_roles: string[];
  session_id: string | null;
  ip_token: string | null;
  ip_hash: string | null;
  ip_hash_key_id: string | null;
  ip_coarse: string | null;
  user_agent_token: string | null;
  ua_parsed: string | null;
  source_app: AuditEntry['sourceApp'];
  correlation_id: string;
  action: string;
  entity_name: string;
  entity_id: string | null;
  outcome: AuditEntry['outcome'];
  reason_token: string | null;
  reauth_proof_id: string | null;
  signature_meaning: string | null;
  http_method: string | null;
  route: string | null;
  old_value: string | null;
  new_value: string | null;
  details: string | null;
  pii_token_count: number;
  hash_version: number;
  prev: string;
  hash: string;
}

const parseJson = (text: string | null): AuditEntry['details'] => (text === null ? null : (JSON.parse(text) as AuditEntry['details']));

function toEntry(r: EntryRow): AuditEntry {
  return {
    id: r.id,
    occurredAtMicros: BigInt(r.us),
    streamId: r.stream_id,
    streamSeq: Number(r.stream_seq),
    orgId: r.org_id,
    targetOrgId: r.target_org_id,
    onBehalfOfOrgId: r.on_behalf_of_org_id,
    actorType: r.actor_type,
    userId: r.user_id,
    apiKeyId: r.api_key_id,
    jobName: r.job_name,
    actorRoles: r.actor_roles,
    sessionId: r.session_id,
    ipToken: r.ip_token,
    ipHash: r.ip_hash,
    ipHashKeyId: r.ip_hash_key_id,
    ipCoarse: r.ip_coarse,
    userAgentToken: r.user_agent_token,
    uaParsed: r.ua_parsed,
    sourceApp: r.source_app,
    correlationId: r.correlation_id,
    action: r.action,
    entityName: r.entity_name,
    entityId: r.entity_id,
    outcome: r.outcome,
    reasonToken: r.reason_token,
    reauthProofId: r.reauth_proof_id,
    signatureMeaning: r.signature_meaning,
    httpMethod: r.http_method,
    route: r.route,
    oldValue: parseJson(r.old_value),
    newValue: parseJson(r.new_value),
    details: parseJson(r.details),
    piiTokenCount: r.pii_token_count,
    hashVersion: r.hash_version,
  };
}

const ENTRY_SELECT = `SELECT id::text, ((extract(epoch FROM occurred_at) * 1000000)::bigint)::text AS us, stream_id::text,
  stream_seq::text, org_id::text, target_org_id::text, on_behalf_of_org_id::text, actor_type, user_id::text, api_key_id::text, job_name,
  actor_roles, session_id::text, ip_token::text, pg_catalog.encode(ip_hash, 'hex') AS ip_hash, ip_hash_key_id, ip_coarse::text,
  user_agent_token::text, ua_parsed, source_app, correlation_id, action, entity_name, entity_id, outcome, reason_token::text,
  reauth_proof_id::text, signature_meaning, http_method, route, old_value::text, new_value::text, details::text, pii_token_count,
  hash_version, pg_catalog.encode(prev_hash, 'hex') AS prev, pg_catalog.encode(entry_hash, 'hex') AS hash
  FROM public.audit_entries WHERE stream_id = $1::uuid ORDER BY audit_entries.stream_seq`; // the input column, not the ::text alias

async function attempt(client: pg.Client, sql: string): Promise<{ ok: boolean; code?: string; message?: string }> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    return { ok: true };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { ok: false, ...(e.code === undefined ? {} : { code: e.code }), ...(e.message === undefined ? {} : { message: e.message }) };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function integrity(pgh: PlatformPostgres, hotOrg: string): Promise<Record<string, unknown>> {
  const su = await pgh.superuser(DB);
  const app = new pg.Client(pgh.appConnection(DB));
  await app.connect();
  try {
    const heads = (
      await su.query<{ stream_id: string; entry_count: string; head_hash: string; head_entry_id: string | null; head_us: string | null }>(
        `SELECT stream_id::text, entry_count::text, pg_catalog.encode(head_hash, 'hex') AS head_hash, head_entry_id::text,
                ((extract(epoch FROM head_occurred_at) * 1000000)::bigint)::text AS head_us
           FROM public.audit_stream_heads`,
      )
    ).rows;
    const failures: string[] = [];
    let entries = 0;
    let recomputed = 0;
    let hotEntries = 0;
    for (const head of heads) {
      const rows = (await su.query<EntryRow>(ENTRY_SELECT, [head.stream_id])).rows;
      let prev = ZERO_HASH_HEX;
      let prevUs = -1n;
      rows.forEach((row, index) => {
        const where = `stream ${head.stream_id} seq ${row.stream_seq}`;
        if (Number(row.stream_seq) !== index + 1) failures.push(`${where}: gap (expected ${String(index + 1)})`);
        if (row.prev !== prev) failures.push(`${where}: prev_hash does not link`);
        if (BigInt(row.us) <= prevUs) failures.push(`${where}: occurred_at not increasing`);
        const recomputedHash = entryHash(toEntry(row), row.prev);
        if (recomputedHash !== row.hash) failures.push(`${where}: entry_hash mismatch`);
        recomputed += 1;
        prev = row.hash;
        prevUs = BigInt(row.us);
      });
      const last = rows.at(-1);
      if (String(rows.length) !== head.entry_count)
        failures.push(`stream ${head.stream_id}: head count ${head.entry_count} != ${String(rows.length)}`);
      if (last !== undefined && (last.hash !== head.head_hash || last.id !== head.head_entry_id || last.us !== head.head_us)) {
        failures.push(`stream ${head.stream_id}: head does not match the last entry`);
      }
      entries += rows.length;
      if (head.stream_id === hotOrg) hotEntries = rows.length;
    }
    const uniq = (
      await su.query<{ total: string; unique_hashes: string; streams: string }>(
        `SELECT count(*)::text AS total, count(DISTINCT entry_hash)::text AS unique_hashes, count(DISTINCT stream_id)::text AS streams
           FROM public.audit_entries`,
      )
    ).rows[0];
    const immutability = {
      app_update_entries: await attempt(app, 'UPDATE public.audit_entries SET route = route'),
      app_delete_entries: await attempt(app, 'DELETE FROM public.audit_entries'),
      app_update_vault: await attempt(app, 'UPDATE public.audit_pii_vault SET field = field'),
      app_delete_vault: await attempt(app, 'DELETE FROM public.audit_pii_vault'),
      superuser_update_entries_trigger: await attempt(su, 'UPDATE public.audit_entries SET route = route'),
      superuser_delete_entries_trigger: await attempt(su, 'DELETE FROM public.audit_entries'),
      superuser_update_vault_trigger: await attempt(su, 'UPDATE public.audit_pii_vault SET field = field'),
      superuser_delete_vault_trigger: await attempt(su, 'DELETE FROM public.audit_pii_vault'),
    };
    const triggers = (
      await su.query<{ rel: string; tgname: string; tgenabled: string }>(
        `SELECT c.relname AS rel, t.tgname, t.tgenabled FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname ~ '^(audit_|data_subjects)' ORDER BY 1, 2`,
      )
    ).rows;
    const eventTriggers = (
      await su.query<{ evtname: string; evtenabled: string }>('SELECT evtname, evtenabled FROM pg_catalog.pg_event_trigger ORDER BY 1')
    ).rows;
    const rls = (
      await su.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_catalog.pg_class
          WHERE relnamespace = 'public'::regnamespace AND relname IN ('audit_entries', 'spk04_orders') ORDER BY 1`,
      )
    ).rows;
    // Product design (data-model §5.2, PR12-SEC-08, ADR-0005): audit_entries is SYSTEM, so NO row-level security; the
    // tenant fixture table has ENABLE + FORCE. (The SPK-08 prototype that the recorded runs used had RLS on audit_entries.)
    const rlsOk =
      rls.length === 2 &&
      rls.every((r) =>
        r.relname === 'audit_entries' ? !r.relrowsecurity && !r.relforcerowsecurity : r.relrowsecurity && r.relforcerowsecurity,
      );
    const partitions = (
      await su.query<{ partition: string; entries: string }>(
        `SELECT tableoid::regclass::text AS partition, count(*)::text AS entries FROM public.audit_entries GROUP BY 1 ORDER BY 1`,
      )
    ).rows;
    const vault = (await su.query<{ n: string }>('SELECT count(*)::text AS n FROM public.audit_pii_vault')).rows[0]?.n;
    // data-model §5.4 step 3 literal form of the zero hash: is `'\x' || repeat('00', 32)` accepted for a bytea column?
    const zeroLiteral = await attempt(
      su,
      `INSERT INTO public.audit_stream_heads (id, stream_id, entry_count, head_hash, last_verified_seq, last_verified_hash, created_at,
         updated_at, created_by, updated_by, version)
       VALUES (pg_catalog.uuidv7(), pg_catalog.gen_random_uuid(), 0, '\\x' || pg_catalog.repeat('00', 32), 0, '\\x' || pg_catalog.repeat('00', 32),
         pg_catalog.now(), pg_catalog.now(), pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), 1)`,
    );
    // The row-level trigger legs only fire on existing rows: with an empty vault or no entries they would pass vacuously.
    const immutabilityOk =
      entries > 0 && Number(vault) > 0 && Object.entries(immutability).every(([, outcome]) => !outcome.ok && outcome.code === '42501');
    return {
      chain: {
        streams: heads.length,
        entries,
        recomputed,
        recomputeScope: 'full (every entry of every stream)',
        hotOrgEntries: hotEntries,
        failures: failures.slice(0, 50),
        failureCount: failures.length,
        entryHashGloballyUnique: uniq?.total === uniq?.unique_hashes,
        totals: uniq,
        ok: failures.length === 0 && uniq?.total === uniq?.unique_hashes,
      },
      immutability: { ok: immutabilityOk, attempts: immutability },
      triggers: {
        // Product state (D-ARCH-076, PR12-SEC-04 item 3): every audit trigger and both event triggers are ENABLE ALWAYS ('A').
        // An origin-mode ('O') trigger does not fire under session_replication_role = replica and is a failure here.
        ok:
          triggers.length > 0 &&
          triggers.every((t) => t.tgenabled === 'A') &&
          eventTriggers.length === 2 &&
          eventTriggers.every((t) => t.evtenabled === 'A'),
        triggers,
        eventTriggers,
      },
      rls: { ok: rlsOk, rls },
      partitions: { ok: partitions.length > 0 && partitions.every((p) => p.partition !== 'audit_entries'), partitions },
      vaultRows: Number(vault),
      dataModelZeroHashLiteral: zeroLiteral,
    };
  } finally {
    await app.end();
    await su.end();
  }
}

// --- main -----------------------------------------------------------------------------------------------------------
interface ArmRecord {
  k6: ReturnType<typeof k6Arm>;
  server: Record<string, unknown>;
  dockerStats: string;
  k6ExitCode: number;
}

function markdown(
  summary: Record<string, unknown>,
  records: Record<string, Record<Arm, ArmRecord>>,
  decision: ReturnType<typeof decide>,
  verdict: FinalVerdict,
  integrityProblems: readonly string[],
): string {
  const lines = [
    `# SPK-04 audit A/B run (${String(summary['stamp'])}, ${String(summary['sha'])}${summary['dirty'] ? ', dirty' : ''})`,
    '',
    `Rate ${String(RATE)} rps, warm-up ${String(WARMUP_S)} s (discarded), measured ${String(MEASURE_S)} s, ${String(REPS)} repetition(s), arms off/on/batched.`,
    '',
    '| rep | arm | p50 | p95 | p99 | Δp95 vs off | Δp99 vs off | rps | dropped | err | CPU mean | CPU>85% share | audit p95 | hot lock p95 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [rep, arms] of Object.entries(records)) {
    for (const arm of ARMS) {
      const r = arms[arm];
      const d = delta(r.k6.latency, arms.off.k6.latency);
      const server = r.server as { auditPhaseMs: { p95: number }; hotOrg: { lockWaitMs: { p95: number } } };
      const share = validity(r.k6).busySampleShare;
      lines.push(
        `| ${rep} | ${arm} | ${String(r.k6.latency.p50)} | ${String(r.k6.latency.p95)} | ${String(r.k6.latency.p99)} | ${arm === 'off' ? '–' : round(d.p95).toString()} | ${arm === 'off' ? '–' : round(d.p99).toString()} | ${String(r.k6['achievedRps'])} | ${(r.k6.droppedRatio * 100).toFixed(2)} % | ${((r.k6['errorRate'] as number) * 100).toFixed(2)} % | ${String((r.k6['cpu'] as { mean: number }).mean)} % | ${(share * 100).toFixed(1)} % | ${String(server.auditPhaseMs.p95)} | ${String(server.hotOrg.lockWaitMs.p95)} |`,
      );
    }
  }
  lines.push(
    '',
    `Pooled Δ on − off: p95 ${round(decision.onDelta.p95).toString()} ms, p99 ${round(decision.onDelta.p99).toString()} ms. Pooled Δ batched − off: p95 ${round(decision.batchedDelta.p95).toString()} ms, p99 ${round(decision.batchedDelta.p99).toString()} ms (budget 15 / 40 ms).`,
    '',
    `**Verdict: ${verdict}**${decision.invalid.length > 0 ? ` (invalid: ${decision.invalid.join('; ')})` : ''}`,
    '',
    integrityProblems.length > 0
      ? `Integrity: FAILED (${integrityProblems.join('; ')})`
      : `Integrity: ${JSON.stringify(Object.fromEntries(Object.entries(summary['integrity'] as Record<string, { ok?: boolean }>).map(([k, v]) => [k, v.ok ?? v])))}`,
    '',
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const sha = await git(['rev-parse', '--short=7', 'HEAD']);
  const dirty = (await git(['status', '--porcelain'])).length > 0;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const outDir = process.env['SPK04_OUT'] ?? join(repoRoot, 'docs', '05-quality', 'performance', 'spikes', 'SPK-04', `${stamp}_${sha}`);
  const work = mkdtempSync(join(tmpdir(), 'spk04-'));
  log(`SPK-04 rate ${String(RATE)} reps ${String(REPS)} -> ${outDir}`);
  const pgh = await PlatformPostgres.start();
  try {
    await setupDatabase(pgh);
    const seed = await seedDatabase(pgh);
    const seedFile = join(work, 'seed.json');
    writeFileSync(seedFile, JSON.stringify(seed));
    const host = await hostSpec(pgh);
    log(`database ready; host ${JSON.stringify(host)}`);
    const appUrl = pgh.appUrl(DB);
    const records: Record<string, Record<Arm, ArmRecord>> = {};
    const raw: Record<string, Record<string, unknown>> = {};
    const cpuSeries: Record<string, number[]> = {};
    for (let rep = 1; rep <= REPS; rep += 1) {
      const armRecords: Partial<Record<Arm, ArmRecord>> = {};
      for (const arm of ARMS) {
        const key = `rep${String(rep)}`;
        log(`${key} ${arm}: start`);
        await withClient(await pgh.superuser(DB), async (c) => {
          await c.query('CHECKPOINT');
        });
        const children = await startReplicas(arm, seedFile, appUrl);
        try {
          await k6(WARMUP_S);
          await resetStats();
          const sampler = cpuSampler();
          const statsTimer = sleep((MEASURE_S * 1000) / 2).then(async () => {
            try {
              return (await run('docker', ['stats', '--no-stream', '--format', '{{json .}}', pgh.container.getId()])).stdout.trim();
            } catch (error) {
              return `docker stats failed: ${String(error)}`;
            }
          });
          const measured = await k6(MEASURE_S);
          const cpu = sampler.stop();
          const dockerStats = await statsTimer;
          const server = aggregateServer(await replicaStats());
          armRecords[arm] = { k6: k6Arm(measured.summary, cpu), server, dockerStats, k6ExitCode: measured.exitCode };
          raw[`${key}.${arm}`] = { k6: measured.summary, server, dockerStats };
          cpuSeries[`${key}.${arm}`] = cpu;
          log(`${key} ${arm}: p95 ${String(armRecords[arm].k6.latency.p95)} p99 ${String(armRecords[arm].k6.latency.p99)} ms`);
        } finally {
          await stopReplicas(children);
        }
      }
      const { off, on, batched } = armRecords;
      if (off === undefined || on === undefined || batched === undefined) throw new Error('missing arm');
      records[`rep${String(rep)}`] = { off, on, batched };
    }
    log('integrity checks');
    const hotOrg = seed.orgs[0]?.id ?? '';
    const integrityResult = await integrity(pgh, hotOrg).catch((error: unknown) => ({ error: String(error) }));
    const repetitions: Repetition[] = Object.values(records).map((r) => ({ off: r.off.k6, on: r.on.k6, batched: r.batched.k6 }));
    const decision = decide(repetitions);
    // Fail closed (R1-m4): a throwing or failing integrity step overrides the benchmark verdict and sets a non-zero exit.
    const integrityProblems = integrityFailures(integrityResult);
    const verdict = finalVerdict(decision, integrityResult);
    const hotDelta = (arm: Arm) =>
      pooled(
        Object.values(records).map((r) =>
          delta(r[arm].k6['hot'] as ArmMeasurement['latency'], r.off.k6['hot'] as ArmMeasurement['latency']),
        ),
      );
    const summary = {
      spike: 'SPK-04',
      task: 'TASK-018',
      risk: 'R-ARCH-04',
      nfr: ['NFR-AUDIT-005', 'NFR-PERF-001'],
      stamp,
      sha,
      dirty,
      method: {
        rate: RATE,
        warmupSeconds: WARMUP_S,
        measureSeconds: MEASURE_S,
        repetitions: REPS,
        arms: ARMS,
        armOrder: 'off, on, batched within each repetition; CHECKPOINT before each arm',
        mix: { create: 35, update: 20, detail: 30, list: 10, login_failed: 5 },
        tenants: `${String(ORG_COUNT)} orgs; org 0 is HOT with 20 % of all traffic; ${String(ORDERS_PER_ORG)} orders and ${String(SUBJECTS_PER_ORG)} data subjects per org`,
        latencySource: 'k6 http_req_duration (client side, includes the Docker Desktop host.docker.internal hop)',
        pooling: 'pooled delta = mean of per-repetition deltas',
        budgets: { deltaP95Ms: 15, deltaP99Ms: 40 },
      },
      repetitions: Object.fromEntries(
        Object.entries(records).map(([rep, arms]) => [
          rep,
          Object.fromEntries(
            ARMS.map((arm) => {
              const k6Stats = { ...arms[arm].k6, cpuBusy: undefined }; // the series is in host-spec.json
              return [
                arm,
                {
                  k6: k6Stats,
                  validity: validity(arms[arm].k6),
                  deltaVsOff: arm === 'off' ? null : delta(arms[arm].k6.latency, arms.off.k6.latency),
                  server: arms[arm].server,
                },
              ];
            }),
          ),
        ]),
      ),
      decision,
      verdict,
      hotOrgPooledDelta: { on: hotDelta('on'), batched: hotDelta('batched') },
      integrity: integrityResult,
      integrityFailures: integrityProblems,
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'host-spec.json'), `${JSON.stringify({ ...host, cpuSeries }, null, 2)}\n`);
    writeFileSync(join(outDir, 'k6-audit-ab.summary.json'), `${JSON.stringify(raw, null, 2)}\n`);
    writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(outDir, 'summary.md'), markdown(summary, records, decision, verdict, integrityProblems));
    log(
      `verdict ${verdict}; on Δp95 ${String(round(decision.onDelta.p95))} Δp99 ${String(round(decision.onDelta.p99))}; batched Δp95 ${String(round(decision.batchedDelta.p95))} Δp99 ${String(round(decision.batchedDelta.p99))}`,
    );
    if (integrityProblems.length > 0) {
      log(`INTEGRITY_FAILED: ${integrityProblems.join('; ')}`);
      process.exitCode = 1;
    }
  } finally {
    await pgh.stop();
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
