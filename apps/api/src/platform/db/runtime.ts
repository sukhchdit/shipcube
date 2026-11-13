/**
 * Runtime database composition of the API and the worker (PR11-SEC-09 items 1-4, D-ORCH-014 (c)/(d); TASK-016
 * reconciliation with TASK-006).
 *
 * The one place outside platform/db tests that builds runtime database objects: the `pg` pool, the
 * session-integrity guard (dedicated start-up connection, PR-0009 M1), the `database` readiness check and, when the
 * generated client class is supplied, the Prisma client and the `withTenantTx` runner. `platform/runtime/**` and the
 * health tests import this module, never `./client.ts` (eslint `db-root-client` boundary, no carve-out). The pool and
 * the root Prisma client never leave this module: callers get the runner, the readiness check, the start-up step and
 * the closeable resources.
 *
 * Wiring (PR11-SEC-09):
 *  - `createWithTenantTx` gets no `env`, so `process.env` is checked for `PGOPTIONS` (item 2); this module refuses
 *    `PGOPTIONS` before it builds anything, whether or not a runner is built (pg reads it too);
 *  - start-up runs `probeFreshConnection()` as the FIRST query on the pool, before the dedicated-connection integrity
 *    check and before the process listens or takes work (item 3); until a probe has passed, the readiness check
 *    re-runs it and reports the database not ready;
 *  - sinks (item 4): security events go to the security-event sink (logging/security-events.ts, TASK-010) as
 *    `security.<event>` with exactly `correlationId`/`sqlState`; the original database error goes to the
 *    `onDbError` hook, whose log line serialises it as { name, code, originalCode, kind }
 *    only; the `db_session_context_leak` counter is kept here (`sessionContextLeaks()`) until the metrics pipeline
 *    exports it; `markNotReady` LATCHES: nothing but a restart clears it (a leaked backend stays in the process pool,
 *    and the 5-minute integrity re-check must not make readiness flap back to ready). A tampered tenant-context
 *    default found by the integrity guard latches as well.
 *
 * The generated client: apps/* cannot import it yet (data-model §7.2, the alias is a principal-architect call), so
 * `Client` is optional and the API and the worker run without a runner until the first consumer (TASK-020, `tx`
 * pipeline slot) supplies it. Without a runner no tenant transaction can run, so there is nothing to probe.
 */
import type { Config, Service } from '@platform/config';

import { createAuditChainCheck } from '../health/checks/audit-chain.js';
import { createAuditPartitionsCheck, isPartitionsUnavailable } from '../health/checks/audit-partitions.js';
import type { CatalogReader } from '../health/checks/catalog-reader.js';
import { securityEventSinkFrom } from '../logging/security-events.js';
import type { RuntimeLog } from '../runtime/log.js';
import { READINESS_CHECK_TIMEOUT_MS, type ReadinessCheck } from '../runtime/readiness.js';
import type { Closeable } from '../runtime/shutdown.js';
import { createDatabaseAdapter, createDatabasePool, type DatabaseClientOptions, type PrismaClientConstructor } from './client.js';
import { dedicatedConnector } from './dedicated-connection.js';
import { type ExtendableClient, withStandardColumns } from './extensions/standard-columns.js';
import { createDatabaseCheck } from './health-check.js';
import {
  createSessionIntegrityGuard,
  type SessionIntegrityGuard,
  startIntegrityMonitor,
  type IntegrityMonitor,
} from './session-integrity.js';
import {
  assertNoSessionOptions,
  createWithTenantTx,
  type RawQueryClient,
  tenantTxOptionsFromConfig,
  type TenantTxRunner,
  type TransactionCapableClient,
  type WithTenantTxOptions,
} from './with-tenant-tx.js';

export type { DatabaseClientOptions } from './client.js';

/** Pool options of `service` from the validated configuration (data-model §7.1; PR-0005 code review m7). */
export function databaseOptionsFrom(config: Config, service: Service): DatabaseClientOptions {
  return {
    connectionString: config.DATABASE_URL.reveal(),
    poolMax: config.DB_POOL_MAX,
    applicationName: service,
    idleTimeoutMs: config.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: config.DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
  };
}

/** Why the database component is latched not ready (until restart). */
export type NotReadyReason = 'db_session_context_leak' | 'db_session_default_tampered';

/** Thrown by the readiness check while latched or before the fresh-connection probe has passed. */
export class DatabaseNotReadyError extends Error {
  constructor(readonly reason: NotReadyReason | 'fresh_connection_unverified') {
    super(`database not ready: ${reason}`);
    this.name = 'DatabaseNotReadyError';
  }
}

export interface NotReadyLatch {
  /** Latches the first reason; later calls keep it. Never cleared (restart the process). */
  mark(reason: NotReadyReason): void;
  readonly reason: NotReadyReason | undefined;
}

export function createNotReadyLatch(onLatch: (reason: NotReadyReason) => void = () => undefined): NotReadyLatch {
  let latched: NotReadyReason | undefined;
  return {
    mark(reason) {
      if (latched !== undefined) return;
      latched = reason;
      onLatch(reason);
    },
    get reason() {
      return latched;
    },
  };
}

export interface DatabaseGate {
  readonly latch: NotReadyLatch;
  /** Runs the fresh-connection probe until it has passed once; resolves true when it has. */
  readonly freshProbe: () => Promise<boolean>;
}

/**
 * The `database` readiness check: latched → not ready; fresh-connection probe not yet passed → re-run it, not ready
 * while it fails; then `SELECT 1` and the session-integrity guard (`inner`).
 */
export function gatedDatabaseCheck(inner: ReadinessCheck, gate: DatabaseGate): ReadinessCheck {
  return Object.freeze({
    name: inner.name,
    critical: inner.critical,
    async check(signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const latched = gate.latch.reason;
      if (latched !== undefined) throw new DatabaseNotReadyError(latched);
      if (!(await gate.freshProbe())) throw new DatabaseNotReadyError(gate.latch.reason ?? 'fresh_connection_unverified');
      await inner.check(signal);
    },
  });
}

/** Class name of a thrown value for the log; never its message. */
const errorClass = (error: unknown): string => (error instanceof Error ? error.name : 'non-error');

/** The start-up session-integrity check (dedicated connection, NULL required). Logs and resolves; never rejects. */
export async function runStartupIntegrityCheck(integrity: Pick<SessionIntegrityGuard, 'recheck'>, log: RuntimeLog): Promise<boolean> {
  try {
    await integrity.recheck();
    log.info('db.session_integrity_ok', { component: 'database' });
    return true;
  } catch (error) {
    // Drift was already reported as a security event; anything else (database unreachable) is retried by readiness.
    log.warn('db.session_integrity_failed', { component: 'database', error: errorClass(error) });
    return false;
  }
}

/**
 * The start-up `audit_partitions` check (data-model §5.3 amendment item 3: at start-up and on the slow interval). Logs
 * and resolves; never rejects. Squats were already reported as security events by the check itself.
 */
export async function runStartupAuditPartitionsCheck(check: ReadinessCheck, log: RuntimeLog): Promise<boolean> {
  try {
    const outcome = await check.check(AbortSignal.timeout(READINESS_CHECK_TIMEOUT_MS));
    if (outcome === 'degraded') log.warn('audit.partitions_late', { component: 'audit_partitions' });
    else log.info('audit.partitions_ok', { component: 'audit_partitions' });
    return true;
  } catch (error) {
    const fields = isPartitionsUnavailable(error)
      ? { component: 'audit_partitions', missing: error.evaluation.missing.length, squatted: error.evaluation.squatted.length }
      : { component: 'audit_partitions', error: errorClass(error) };
    log.warn('audit.partitions_not_ready', fields);
    return false;
  }
}

/**
 * The client shape the runtime needs: a Prisma client over the shared pool that can be disconnected and extended per
 * transaction with the standard-columns extension (TASK-032).
 */
export interface RuntimeDatabaseClient<TTx> extends TransactionCapableClient<TTx>, ExtendableClient {
  $disconnect(): Promise<void>;
}

export interface DatabaseRuntimeInput<TTx extends RawQueryClient, TClient extends RuntimeDatabaseClient<TTx>> {
  readonly database: DatabaseClientOptions;
  readonly tx: WithTenantTxOptions;
  readonly log: RuntimeLog;
  /** The generated `PrismaClient` class; without it no runner is built (see the module comment). */
  readonly Client?: PrismaClientConstructor<TClient>;
  /** How long a passing session-integrity result is reused (default 5 min); the monitor timer keeps its own 5 min. */
  readonly integrityIntervalMs?: number;
}

/** The audit components of `HealthReady`, read from the catalogue through the runtime pool (TASK-021). */
export interface AuditReadinessChecks {
  readonly partitions: ReadinessCheck;
  readonly chain: ReadinessCheck;
}

export interface DatabaseRuntime<TTx> {
  /** The `database` component of `HealthReady`. */
  readonly readinessCheck: ReadinessCheck;
  /** The `audit_partitions` and `audit_chain` components (TASK-021; replace the TASK-006 stubs). */
  readonly auditChecks: AuditReadinessChecks;
  /** The tenant-transaction runner; `undefined` until the generated client is supplied. */
  readonly tenantTx: TenantTxRunner<TTx> | undefined;
  /**
   * Awaited before the process listens or takes work: the fresh-connection probe (first pool query), the
   * dedicated-connection integrity check, then the interval monitor. Never rejects: failures are logged, and readiness
   * keeps the database not ready (latched for a leak).
   */
  startup(): Promise<void>;
  /** Closed by graceful shutdown, in order. */
  readonly resources: readonly Closeable[];
  /** `db_session_context_leak` detections since start (exported as a metric with the metrics pipeline). */
  sessionContextLeaks(): number;
}

export function createDatabaseRuntime<TTx extends RawQueryClient, TClient extends RuntimeDatabaseClient<TTx>>(
  input: DatabaseRuntimeInput<TTx, TClient>,
): DatabaseRuntime<TTx> {
  const { log } = input;
  // Security events go to the security-event sink with exactly { correlationId, sqlState } (D-ARCH-079, R3-m1).
  const security = securityEventSinkFrom(log);
  // PR11-SEC-09 item 2 / PR9-SEC-03: refused before any pool or client exists (pg reads PGOPTIONS as well).
  assertNoSessionOptions(process.env);
  const latch = createNotReadyLatch((reason) => log.error('db.not_ready_latched', { component: 'database', reason }));
  const pool = createDatabasePool(input.database);
  // Idle-client errors (server restart, network) are emitted on the pool; without a listener they crash the process.
  pool.on('error', (error: Error) => log.warn('db.pool_error', { error: error.name }));
  const integrity = createSessionIntegrityGuard({
    pool,
    connectDedicated: dedicatedConnector(input.database),
    ...(input.integrityIntervalMs === undefined ? {} : { intervalMs: input.integrityIntervalMs }),
    onDrift: (findings) => {
      for (const finding of findings) security.emit(finding);
      if (findings.includes('db_session_default_tampered')) latch.mark('db_session_default_tampered');
    },
  });

  let leaks = 0;
  // The Prisma client shares the runtime pool (one pool per process, data-model §7.1).
  const client: TClient | undefined =
    input.Client === undefined ? undefined : new input.Client({ adapter: createDatabaseAdapter(pool), errorFormat: 'minimal' });
  let tenantTx: TenantTxRunner<TTx> | undefined;
  if (client !== undefined) {
    tenantTx = createWithTenantTx<TTx>(client, input.tx, {
      onSecurityEvent: (event, detail) =>
        security.emit(event, {
          ...(detail.correlationId === undefined ? {} : { correlationId: detail.correlationId }),
          ...(detail.sqlState === undefined ? {} : { sqlState: detail.sqlState }),
        }),
      // The original error, serialised by the platform logger as { name, code, originalCode, kind } only (TASK-010).
      onDbError: (error, mapping) => {
        const fields = { component: 'database', reason: mapping.reason, status: mapping.status, retryable: mapping.retryable };
        if (mapping.status >= 500) log.error('db.error_mapped', fields, error);
        else log.warn('db.error_mapped', fields, error);
      },
      countSessionContextLeak: () => {
        leaks += 1;
      },
      markNotReady: (reason) => latch.mark(reason),
      // Server-controlled standard columns, bound per transaction (data-model §7.6, ADR-0005 am. 10 item 5).
      scopeClient: (stamp) => withStandardColumns(client, stamp),
    });
  }

  let freshProbePassed = tenantTx === undefined;
  let freshProbeInflight: Promise<boolean> | undefined;
  const freshProbe = (): Promise<boolean> => {
    if (freshProbePassed || tenantTx === undefined) return Promise.resolve(true);
    const runner = tenantTx;
    freshProbeInflight ??= runner
      .probeFreshConnection()
      .then(
        () => {
          freshProbePassed = true;
          log.info('db.fresh_connection_ok', { component: 'database' });
          return true;
        },
        (error: unknown) => {
          // A leak already raised its security event and latched; anything else (unreachable) is retried.
          log.warn('db.fresh_connection_failed', { component: 'database', error: errorClass(error) });
          return false;
        },
      )
      .finally(() => {
        freshProbeInflight = undefined;
      });
    return freshProbeInflight;
  };

  // The audit checks read the catalogue as platform_app; a squat is a security event (data-model §5.3 item 3) at level
  // error, a fail-closed signal that must alert (D-ORCH-025 (1); code review PR #24 R1-m2). It goes through the
  // security-event sink (D-ARCH-081 (4)), whose allow-list is the api/README §13 runtime-events row (partition_name,
  // kind, reason, sql_state; never an owner); the logger writes the camelCase keys in snake_case.
  const catalog: CatalogReader = { query: (text) => pool.query(text) };
  const auditChecks: AuditReadinessChecks = {
    partitions: createAuditPartitionsCheck(catalog, {
      onSquatted: (object) =>
        security.emit('audit_partition_squatted', { partitionName: object.name, kind: object.kind, reason: object.reason }),
    }),
    chain: createAuditChainCheck(catalog),
  };

  let monitor: IntegrityMonitor | undefined;
  return {
    readinessCheck: gatedDatabaseCheck(createDatabaseCheck(pool, integrity), { latch, freshProbe }),
    auditChecks,
    tenantTx,
    startup: async () => {
      await freshProbe();
      await runStartupIntegrityCheck(integrity, log);
      await runStartupAuditPartitionsCheck(auditChecks.partitions, log);
      monitor ??= startIntegrityMonitor(integrity);
    },
    resources: [
      { name: 'session-integrity-monitor', close: () => monitor?.close() ?? Promise.resolve() },
      ...(client === undefined ? [] : [{ name: 'prisma', close: () => client.$disconnect() }]),
      { name: 'database', close: () => pool.end() },
    ],
    sessionContextLeaks: () => leaks,
  };
}

/** `createDatabaseRuntime` from the validated configuration of `service`. */
export function databaseRuntimeFromConfig<TTx extends RawQueryClient, TClient extends RuntimeDatabaseClient<TTx>>(
  config: Config,
  service: Service,
  log: RuntimeLog,
  Client?: PrismaClientConstructor<TClient>,
): DatabaseRuntime<TTx> {
  return createDatabaseRuntime<TTx, TClient>({
    database: databaseOptionsFrom(config, service),
    tx: tenantTxOptionsFromConfig(config),
    log,
    ...(Client === undefined ? {} : { Client }),
  });
}
