// Customs-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const customsCatalogue = {
  /** Commodity code is not 6, 8 or 10 digits (or a length the destination pack rejects). (REQ-CUST-007, US-182) */
  COMMODITY_CODE_FORMAT: { status: 422, title: 'Commodity code format' },
  /** All customs lines of a shipment must use one currency. (REQ-CUST-003, A-073) */
  CUSTOMS_CURRENCY_MIXED: { status: 422, title: 'Customs currency mixed' },
  /** Sum of line net weights exceeds total actual package weight. (REQ-CUST-003, A-073) */
  CUSTOMS_WEIGHT_EXCEEDS_PACKAGE: { status: 422, title: 'Customs weight exceeds package' },
  /** No-dangerous-goods attestation missing (current wording version). (REQ-CUST-010) */
  DG_ATTESTATION_REQUIRED: { status: 422, title: 'Dangerous-goods attestation required' },
  /** Description or commodity chapter matches a PROHIBITED entry; no override (DR-B24). (REQ-CUST-009, DR-B24) */
  ITEM_PROHIBITED: { status: 422, title: 'Item prohibited' },
} as const satisfies ModuleCatalogue;
