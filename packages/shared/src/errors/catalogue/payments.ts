// Payments-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const paymentsCatalogue = {
  /** Request carries a PAN, expiry or CVC-like field; use hosted fields only. (REQ-PAY-005) */
  CARD_DATA_NOT_ACCEPTED: { status: 400, title: 'Card data not accepted' },
  /** Only CARD (incl. saved card) is offered in M1. (REQ-PAY-019) */
  PAYMENT_METHOD_NOT_AVAILABLE: { status: 400, title: 'Payment method not available' },
  /**
   * Gateway webhook signature or timestamp (300 s tolerance) failed verification; nothing processed. Proposed code
   * (REQ-PAY-011 states 400 without a code). (REQ-PAY-011 (proposed))
   */
  WEBHOOK_SIGNATURE_INVALID: { status: 400, title: 'Webhook signature invalid' },
  /** Client-supplied expected amount differs from the server-computed order total. (REQ-PAY-006) */
  AMOUNT_MISMATCH: { status: 409, title: 'Amount mismatch' },
  /** Order total below the gateway minimum charge. (REQ-PAY-006) */
  AMOUNT_BELOW_MINIMUM: { status: 422, title: 'Amount below minimum' },
  /** More than 5 payment attempts for the order in one hour. (REQ-PAY-010) */
  PAYMENT_ATTEMPTS_EXCEEDED: { status: 429, title: 'Payment attempts exceeded' },
  /** Gateway unreachable or circuit open while creating/confirming a payment. (REQ-PAY-010) */
  GATEWAY_UNAVAILABLE: { status: 503, title: 'Payment gateway unavailable' },
} as const satisfies ModuleCatalogue;
