// Carriers-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const carriersCatalogue = {
  /** X-Mock-Scenario (or MOCK: reference) has an unknown key or out-of-range value (DR-B29). (REQ-CARR-005) */
  MOCK_SCENARIO_INVALID: { status: 400, title: 'Mock scenario invalid' },
} as const satisfies ModuleCatalogue;
