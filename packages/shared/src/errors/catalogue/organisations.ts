// Organisations-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const organisationsCatalogue = {
  /** Attempt to create a PARTNER or second OPERATOR organisation, or change an organisation type. (REQ-ORG-001) */
  ORG_TYPE_NOT_ALLOWED: { status: 422, title: 'Organisation type not allowed' },
} as const satisfies ModuleCatalogue;
