/**
 * Public surface of the data platform (ADR-0005 amendment 10 items 1, 2, 6, 15; TASK-016).
 *
 * Repositories and services import from here. The root client factory (`./client.ts`) is deliberately not re-exported:
 * only the composition root builds the client and hands it to `createWithTenantTx`, which keeps it private.
 */
export { type AffectedRows, expectAffected } from './expect-affected.js';
export {
  DB_RETRY_AFTER_SECONDS,
  DbError,
  type DbErrorMapping,
  type DbErrorReason,
  type DbErrorStatus,
  type DbProblemCode,
  type DbSecurityEvent,
  isDatabaseError,
  mapDbError,
  toDbError,
} from './map-db-error.js';
export { TENANT_DB_OMITTED, type TenantDb, TenantDbAccessError } from './tenant-db.js';
export {
  type ActorScope,
  createWithTenantTx,
  DEFAULT_MAX_WAIT_MS,
  guestTokenHash,
  isInsideTenantTx,
  type SecurityEventDetail,
  type TenantContext,
  tenantTxOptionsFromConfig,
  TenantTxConfigError,
  type TenantTxRunner,
  type TransactionCapableClient,
  type TransactionOptions,
  type WithTenantTxDeps,
  type WithTenantTxOptions,
} from './with-tenant-tx.js';
