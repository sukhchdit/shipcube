// Public entry point of @platform/audit. Audit writer, differ, redaction, classification registry and hash chain (ADR-0007).
// Re-exports only; exports are added by the tasks that implement this package.
export {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTRY_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_SOURCE_APPS,
  DENIED_ONLY_ACTIONS,
  isAuditActorType,
  isAuditEntryAction,
  isAuditOutcome,
  isAuditSourceApp,
  isPiiClassification,
  PII_CLASSIFICATIONS,
  type AuditActorType,
  type AuditEntryAction,
  type AuditOutcome,
  type AuditSourceApp,
  type PiiClassification,
} from './actions.js';
export {
  pii,
  PII_MARKER,
  PiiValue,
  isAuditEntityId,
  isAuditRouteTemplate,
  isAuditUaParsed,
  prepareEntry,
  systemShardStreamId,
  type AuditActor,
  type AuditEntryInput,
  type AuditOrigin,
  type AuditValue,
  type DataSubjectRef,
  type IpIndex,
  type PiiValueInput,
  type PreparedEntry,
} from './entry.js';
export {
  canonicalEntry,
  computeEntryHash,
  formatMicros,
  HASH_VERSION,
  jcs,
  nextOccurredAt,
  ZERO_HASH_HEX,
  type AuditRowDraft,
  type ChainPosition,
  type JsonValue,
} from './entry-hash.js';
export {
  AUDIT_RETRY_AFTER_SECONDS,
  auditErrorCause,
  AuditWriteError,
  isAuditWriteError,
  toAuditWriteError,
  type AuditErrorReason,
  type AuditFailureKind,
} from './errors.js';
export { canonicalIp, coarseNetwork } from './network.js';
export {
  createPrismaAuditStore,
  type AppendedEntry,
  type AppendOptions,
  type AuditSqlPort,
  type AuditStore,
  type EntryHasher,
  type PrismaAuditStoreOptions,
  type VaultRow,
} from './store/prisma-store.js';
export { createAuditWriter, type AuditWriter, type AuditWriterOptions, type PiiTokeniser } from './writer.js';
