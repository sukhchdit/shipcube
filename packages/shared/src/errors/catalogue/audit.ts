// Audit-module error codes (REQ-AUDIT-004, DR-A26, ADR-0007 amendment 10 item 2; TASK-025). Codes and titles match the
// shared problem responses in docs/03-architecture/api/openapi.yaml (`AuditWriteFailed`).
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const auditCatalogue = {
  /**
   * The same-transaction audit write failed, so the mutation was rolled back (nothing persists without its entry).
   * Non-retryable from the server's view; a client may retry with the same Idempotency-Key.
   */
  AUDIT_WRITE_FAILED: { status: 500, title: 'Audit write failed' },
} as const satisfies ModuleCatalogue;
