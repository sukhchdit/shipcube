/**
 * Process infrastructure shared by the API and the worker (ADR-0003: the worker shares module code): the database
 * runtime (platform/db/runtime.ts: pool, session-integrity guard, `database` readiness check and, once the generated
 * client is wired, the tenant-transaction runner), the Valkey client, the readiness checks and probe, and the
 * resources graceful shutdown closes. Typed configuration in, live clients out; no `process` access here. The pool and
 * the root client stay inside platform/db (D-ORCH-014 (d), PR11-SEC-09 item 1): this module never imports
 * platform/db/client.ts.
 */
import type { Config, Service } from '@platform/config';

import { databaseRuntimeFromConfig } from '../db/runtime.js';
import { createValkeyCheck, createValkeyClient } from '../valkey/client.js';
import type { RuntimeLog } from './log.js';
import { createReadinessProbe, pendingCheck, type ReadinessCheck, type ReadinessProbe } from './readiness.js';
import type { Closeable } from './shutdown.js';

export type ValkeyClient = ReturnType<typeof createValkeyClient>;

/**
 * The five readiness components of openapi.yaml `HealthReady`. Object storage and the audit components are
 * pending until their clients exist: object storage with the S3 adapter (TASK-019), audit partitions and chain
 * verification with the audit store (TASK-021).
 */
export function readinessChecks(database: ReadinessCheck, valkey: ValkeyClient): readonly ReadinessCheck[] {
  return [
    database,
    createValkeyCheck(valkey),
    pendingCheck('object_storage'),
    pendingCheck('audit_partitions'),
    pendingCheck('audit_chain'),
  ];
}

export interface RuntimeServices {
  readonly valkey: ValkeyClient;
  readonly probe: ReadinessProbe;
  /** Closed by graceful shutdown after the drain. */
  readonly resources: readonly Closeable[];
  /**
   * Start-up checks, awaited by both entry points before they listen or take work (PR-0009 M1, PR9-SEC-05,
   * PR11-SEC-09 item 3): the fresh-connection probe as the first pool query (once a runner exists), the
   * session-integrity check on a dedicated new connection, then the interval monitor. Never rejects: a failure is
   * logged (drift and leaks are security events) and readiness keeps the database not ready.
   */
  startup(): Promise<void>;
}

export function createRuntimeServices(config: Config, service: Service, log: RuntimeLog): RuntimeServices {
  const database = databaseRuntimeFromConfig(config, service, log);
  const valkey = createValkeyClient({
    url: config.REDIS_URL.reveal(),
    connectionName: service,
    onError: (errorClass) => log.warn('valkey.error', { error: errorClass }),
  });
  return {
    valkey,
    probe: createReadinessProbe(readinessChecks(database.readinessCheck, valkey)),
    resources: [...database.resources, { name: 'valkey', close: () => valkey.quit().then(() => undefined) }],
    startup: () => database.startup(),
  };
}
