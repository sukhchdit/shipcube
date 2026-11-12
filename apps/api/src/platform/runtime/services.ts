/**
 * Process infrastructure shared by the API and the worker (ADR-0003: the worker shares module code): the runtime
 * `pg` pool, the Valkey client, the readiness checks and probe, and the resources graceful shutdown closes.
 * Typed configuration in, live clients out; no `process` access here.
 */
import type { Config, Service } from '@platform/config';

import { createDatabasePool, type DatabaseClientOptions } from '../db/client.js';
import { dedicatedConnector } from '../db/dedicated-connection.js';
import { createDatabaseCheck } from '../db/health-check.js';
import {
  createSessionIntegrityGuard,
  type IntegrityMonitor,
  type SessionIntegrityGuard,
  startIntegrityMonitor,
} from '../db/session-integrity.js';
import { createValkeyCheck, createValkeyClient } from '../valkey/client.js';
import type { RuntimeLog } from './log.js';
import { createReadinessProbe, pendingCheck, type ReadinessCheck, type ReadinessProbe } from './readiness.js';
import type { Closeable } from './shutdown.js';

export type DatabasePool = ReturnType<typeof createDatabasePool>;
export type ValkeyClient = ReturnType<typeof createValkeyClient>;

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

/**
 * The five readiness components of openapi.yaml `HealthReady`. Object storage and the audit components are
 * pending until their clients exist: object storage with the S3 adapter (TASK-019), audit partitions and chain
 * verification with the audit store (TASK-021).
 */
export function readinessChecks(pool: DatabasePool, valkey: ValkeyClient, integrity?: SessionIntegrityGuard): readonly ReadinessCheck[] {
  return [
    createDatabaseCheck(pool, integrity),
    createValkeyCheck(valkey),
    pendingCheck('object_storage'),
    pendingCheck('audit_partitions'),
    pendingCheck('audit_chain'),
  ];
}

export interface RuntimeServices {
  readonly pool: DatabasePool;
  readonly valkey: ValkeyClient;
  readonly probe: ReadinessProbe;
  /** Closed by graceful shutdown after the drain. */
  readonly resources: readonly Closeable[];
  /**
   * Start-up checks, awaited by both entry points before they listen or take work (PR-0009 M1, PR9-SEC-05): the
   * session-integrity check on a dedicated new connection, then the interval monitor. Never rejects: a failure is
   * logged (and drift is a security event); readiness keeps the database not ready and re-checks on every probe.
   */
  startup(): Promise<void>;
}

export function createRuntimeServices(config: Config, service: Service, log: RuntimeLog): RuntimeServices {
  const pool = createDatabasePool(databaseOptionsFrom(config, service));
  // Idle-client errors (server restart, network) are emitted on the pool; without a listener they crash the process.
  pool.on('error', (error: Error) => log.warn('db.pool_error', { error: error.name }));
  const valkey = createValkeyClient({
    url: config.REDIS_URL.reveal(),
    connectionName: service,
    onError: (errorClass) => log.warn('valkey.error', { error: errorClass }),
  });
  // PR7-SEC-06 item 3 / PR7-SEC-02 item 2: drift is a security event and makes the database not ready.
  const integrity = createSessionIntegrityGuard({
    pool,
    connectDedicated: dedicatedConnector(databaseOptionsFrom(config, service)),
    onDrift: (findings) => {
      for (const finding of findings) log.warn(`security.${finding}`, { component: 'database' });
    },
  });
  let monitor: IntegrityMonitor | undefined;
  return {
    pool,
    valkey,
    probe: createReadinessProbe(readinessChecks(pool, valkey, integrity)),
    resources: [
      { name: 'session-integrity-monitor', close: () => monitor?.close() ?? Promise.resolve() },
      { name: 'database', close: () => pool.end() },
      { name: 'valkey', close: () => valkey.quit().then(() => undefined) },
    ],
    startup: async () => {
      monitor ??= startIntegrityMonitor(integrity);
      await runStartupIntegrityCheck(integrity, log);
    },
  };
}

/** The start-up session-integrity check (dedicated connection, NULL required). Logs and resolves; never rejects. */
export async function runStartupIntegrityCheck(integrity: Pick<SessionIntegrityGuard, 'recheck'>, log: RuntimeLog): Promise<boolean> {
  try {
    await integrity.recheck();
    log.info('db.session_integrity_ok', { component: 'database' });
    return true;
  } catch (error) {
    // Drift was already reported as a security event; anything else (database unreachable) is retried by readiness.
    log.warn('db.session_integrity_failed', { component: 'database', error: error instanceof Error ? error.name : 'non-error' });
    return false;
  }
}
