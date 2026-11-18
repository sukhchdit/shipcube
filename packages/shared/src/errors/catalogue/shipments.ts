// Shipments-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const shipmentsCatalogue = {
  /**
   * Requested change is not permitted from the current shipment/order state (DR-B01); body may list
   * blocking_conditions. (REQ-BOOK-018, REQ-PICK-007, DR-B01)
   */
  ILLEGAL_STATE_TRANSITION: { status: 409, title: 'Illegal state transition' },
  /** State or tracking history outside the cancellation window (DR-B20). (REQ-BOOK-029, DR-B20) */
  SHIPMENT_NOT_CANCELLABLE: { status: 409, title: 'Shipment not cancellable' },
  /** Sender/receiver country differs from the selected quote option lane. (REQ-BOOK-006, A-073) */
  ADDRESS_COUNTRY_MISMATCH: { status: 422, title: 'Address country mismatch' },
} as const satisfies ModuleCatalogue;
