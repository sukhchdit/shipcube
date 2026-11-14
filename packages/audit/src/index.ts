// Public entry point of @platform/audit. Audit writer, differ, redaction, classification registry and hash chain (ADR-0007).
// Re-exports only; exports are added by the tasks that implement this package.
export {
  AUDIT_RETRY_AFTER_SECONDS,
  auditErrorCause,
  AuditWriteError,
  isAuditWriteError,
  toAuditWriteError,
  type AuditErrorReason,
  type AuditFailureKind,
} from './errors.js';
