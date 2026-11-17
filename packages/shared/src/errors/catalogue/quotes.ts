// Quotes-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const quotesCatalogue = {
  /** Quote past expires_at; re-quote with the same inputs. (REQ-QUOTE-017, REQ-PAY-007) */
  QUOTE_EXPIRED: { status: 409, title: 'Quote expired' },
} as const satisfies ModuleCatalogue;
