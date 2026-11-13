// `@platform/api/runtime`: the process-agnostic runtime the worker shares with the API (ADR-0003, PR #2 m8).
// No Express here: the database runtime composition (platform/db/runtime.ts; the pool and the root client never
// leave platform/db, D-ORCH-014 (d)), the Valkey factory, readiness primitives, graceful shutdown and the start-up
// log. Re-exports only.
export {
  createDatabaseRuntime,
  createNotReadyLatch,
  DatabaseNotReadyError,
  databaseOptionsFrom,
  databaseRuntimeFromConfig,
  type DatabaseClientOptions,
  type DatabaseRuntime,
  type DatabaseRuntimeInput,
  type NotReadyReason,
} from '../db/runtime.js';
export { createValkeyCheck, createValkeyClient, type PingableClient, type ValkeyClientOptions } from '../valkey/client.js';
export { buildValkeyOptions, reconnectDelayMs, VALKEY_DEFAULTS, ValkeyConfigError, type ValkeyOptionsInput } from '../valkey/options.js';
export {
  createRuntimeLog,
  readPackageVersion,
  UNKNOWN_VERSION,
  type LogFields,
  type LogSink,
  type RuntimeLog,
  type RuntimeLogOptions,
} from './log.js';
export {
  assertReadinessChecks,
  createReadinessProbe,
  DRAINING_REPORT,
  evaluateReadiness,
  isCriticalComponent,
  LIVENESS_BODY,
  pendingCheck,
  READINESS_CACHE_TTL_MS,
  READINESS_CHECK_TIMEOUT_MS,
  READINESS_COMPONENTS,
  READINESS_DEADLINE_MS,
  type ReadinessBody,
  type ReadinessCheck,
  type ReadinessComponent,
  type ReadinessOptions,
  type ReadinessProbe,
  type ReadinessReport,
} from './readiness.js';
export { createRuntimeServices, readinessChecks, type RuntimeServices, type ValkeyClient } from './services.js';
export {
  exitAfterFlush,
  installProcessErrorHandlers,
  type ExitAfterFlushOptions,
  type FlushableStream,
  type ProcessErrorHandlerOptions,
  type ProcessErrorSource,
} from './process-errors.js';
export { createShutdown, DRAIN_TIMEOUT_MS, RESOURCE_CLOSE_TIMEOUT_MS, type Closeable, type ShutdownOptions } from './shutdown.js';
