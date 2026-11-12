// `@platform/api/runtime`: the process-agnostic runtime the worker shares with the API (ADR-0003, PR #2 m8).
// No Express here: database pool and adapter factories, the Valkey factory, readiness primitives, graceful
// shutdown and the start-up log. Re-exports only.
export {
  APP_ROLE_CONNECTION_LIMIT,
  createDatabaseAdapter,
  createDatabaseClient,
  createDatabasePool,
  DatabaseConfigError,
  type DatabaseClientOptions,
  type PrismaClientConstructor,
} from '../db/client.js';
export { createDatabaseCheck, type QueryablePool } from '../db/health-check.js';
export { createValkeyCheck, createValkeyClient, type PingableClient, type ValkeyClientOptions } from '../valkey/client.js';
export { buildValkeyOptions, reconnectDelayMs, VALKEY_DEFAULTS, ValkeyConfigError, type ValkeyOptionsInput } from '../valkey/options.js';
export { createRuntimeLog, type LogFields, type LogSink, type RuntimeLog } from './log.js';
export {
  assertReadinessChecks,
  createReadinessProbe,
  DRAINING_REPORT,
  evaluateReadiness,
  isCriticalComponent,
  LIVENESS_BODY,
  pendingCheck,
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
export {
  createRuntimeServices,
  databaseOptionsFrom,
  readinessChecks,
  type DatabasePool,
  type RuntimeServices,
  type ValkeyClient,
} from './services.js';
export { createShutdown, DRAIN_TIMEOUT_MS, RESOURCE_CLOSE_TIMEOUT_MS, type Closeable, type ShutdownOptions } from './shutdown.js';
