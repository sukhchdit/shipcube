/**
 * Public surface of the data platform (ADR-0005 amendment 10 items 1, 2, 6, 15; TASK-016).
 *
 * Repositories and services import from here. The root client factory (`./client.ts`) is deliberately not re-exported:
 * the database composition (`./runtime.ts`, imported by `platform/runtime/**`) is its only runtime importer; it builds
 * the pool and the client and hands the client to `createWithTenantTx`, which keeps it private (D-ORCH-014 (d),
 * PR11-SEC-09 item 1; no `db-root-client` boundary carve-out).
 */
export { type AffectedRows, expectAffected } from './expect-affected.js';
// Types only (D-ARCH-103 (3)): the generated client's value exports (PrismaClient, Prisma.sql, Prisma.raw,
// Prisma.Decimal) have no path out of platform/db.
export type { AppDb, AppTransactionClient, Prisma } from './generated.js';
export {
  type ExtendableClient,
  type ServerColumn,
  serverStamped,
  type StandardColumnsExtension,
  standardColumnsExtension,
  withStandardColumns,
} from './extensions/standard-columns.js';
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
export {
  type AdmissionKey,
  type AdmissionKeyKind,
  admissionKeyOf,
  type AdmissionRejectReason,
  TENANT_ADMISSION_METRICS,
  type TenantAdmissionMetrics,
  type TenantAdmissionOptions,
  type TenantAdmissionSnapshot,
} from './tenant-admission.js';
export { TENANT_DB_OMITTED, type TenantDb, TenantDbAccessError } from './tenant-db.js';
export {
  type ActorScope,
  createWithTenantTx,
  DEFAULT_MAX_WAIT_MS,
  guestTokenHash,
  isInsideTenantTx,
  resolveAdmissionOptions,
  type SecurityEventDetail,
  type TenantContext,
  tenantTxOptionsFromConfig,
  TenantTxConfigError,
  type TenantTxRunner,
  type TransactionCapableClient,
  type TransactionOptions,
  type TransactionStamp,
  type WithTenantTxDeps,
  type WithTenantTxOptions,
} from './with-tenant-tx.js';
