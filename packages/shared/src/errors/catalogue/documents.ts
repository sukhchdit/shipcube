// Documents-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const documentsCatalogue = {
  /** Voided label cannot be downloaded. (REQ-DOC-014) */
  DOCUMENT_VOIDED: { status: 410, title: 'Document voided' },
  /** Stored bytes no longer match the recorded SHA-256; download refused, alert raised. (REQ-DOC-009) */
  DOCUMENT_INTEGRITY_FAILURE: { status: 500, title: 'Document integrity failure' },
} as const satisfies ModuleCatalogue;
