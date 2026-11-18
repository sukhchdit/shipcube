// Orders-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const ordersCatalogue = {
  /** Shipment sell currency differs from the order currency. (REQ-BOOK-013, A-073) */
  ORDER_CURRENCY_MISMATCH: { status: 422, title: 'Order currency mismatch' },
} as const satisfies ModuleCatalogue;
