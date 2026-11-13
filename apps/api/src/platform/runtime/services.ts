/**
 * Process infrastructure shared by the API and the worker (ADR-0003: the worker shares module code): the database
 * runtime (platform/db/runtime.ts: pool, session-integrity guard, `database` readiness check and, once the generated
 * client is wired, the tenant-transaction runner), the object-storage adapter (platform/storage, SPK-05), the Valkey
 * client, the readiness checks and probe, and the resources graceful shutdown closes. Typed configuration in, live
 * clients out; no `process` access here. The pool and the root client stay inside platform/db (D-ORCH-014 (d),
 * PR11-SEC-09 item 1): this module never imports platform/db/client.ts.
 */
import type { Config, Secret, Service } from '@platform/config';

import { databaseRuntimeFromConfig } from '../db/runtime.js';
import { createObjectStorageCheck } from '../health/checks/object-storage.js';
import type { ObjectStorage } from '../storage/object-storage.port.js';
import { objectStorageFromConfig } from '../storage/s3-object-storage.js';
import { createValkeyCheck, createValkeyClient } from '../valkey/client.js';
import type { RuntimeLog } from './log.js';
import { createReadinessProbe, pendingCheck, type ReadinessCheck, type ReadinessProbe } from './readiness.js';
import type { Closeable } from './shutdown.js';

export type ValkeyClient = ReturnType<typeof createValkeyClient>;

/**
 * The five readiness components of openapi.yaml `HealthReady`. The audit components are pending until the audit
 * store exists (audit partitions and chain verification: TASK-021). `object_storage` is a `HeadBucket` on the
 * documents bucket.
 */
export function readinessChecks(database: ReadinessCheck, valkey: ValkeyClient, objectStorage: ReadinessCheck): readonly ReadinessCheck[] {
  return [database, createValkeyCheck(valkey), objectStorage, pendingCheck('audit_partitions'), pendingCheck('audit_chain')];
}

export interface RuntimeServices {
  readonly valkey: ValkeyClient;
  /**
   * The documents object storage (one client, `STORAGE_*`; closed with `resources`). Never the audit anchor sink, which
   * has its own credential and bucket (ADR-0021 am. 2 item 2, TASK-116).
   */
  readonly storage: ObjectStorage;
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

export function createRuntimeServices(
  config: Config,
  service: Service,
  log: RuntimeLog,
  secrets: ReadonlyMap<string, Secret<string>>,
): RuntimeServices {
  // First: a half-written credential pair throws StorageConfigError before any pool or client exists (PR30-SEC-04).
  const storage = objectStorageFromConfig(config, secrets);
  const database = databaseRuntimeFromConfig(config, service, log);
  const valkey = createValkeyClient({
    url: config.REDIS_URL.reveal(),
    connectionName: service,
    onError: (errorClass) => log.warn('valkey.error', { error: errorClass }),
  });
  return {
    valkey,
    storage,
    probe: createReadinessProbe(
      readinessChecks(
        database.readinessCheck,
        valkey,
        // The error class only (ObjectStorageError code): never the endpoint, bucket, key or a credential (R1-m5).
        createObjectStorageCheck(storage, config.STORAGE_BUCKET_DOCUMENTS, (code) => log.warn('object_storage.error', { error: code })),
      ),
    ),
    resources: [
      ...database.resources,
      { name: 'valkey', close: () => valkey.quit().then(() => undefined) },
      { name: 'object_storage', close: () => Promise.resolve(storage.destroy()) },
    ],
    startup: () => database.startup(),
  };
}
