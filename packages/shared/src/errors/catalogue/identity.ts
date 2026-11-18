// Identity-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const identityCatalogue = {
  /**
   * Refresh token past the absolute session cap or (admin) the 30-minute idle limit; sign in again. (REQ-AUTH-007,
   * REQ-ADMIN-004, SEC-P3-01, SEC-P3-11)
   */
  SESSION_EXPIRED: { status: 401, title: 'Session expired' },
  /** Checkout, payment and document email require a verified account email. (REQ-BOOK-016, REQ-PAY-007, D-009) */
  EMAIL_NOT_VERIFIED: { status: 403, title: 'Email not verified' },
  /**
   * Staff first TOTP enrolment outside local/test requires the e-mailed enrolment code; request one via
   * `requestTotpEnrolmentCode`. Missing, wrong, expired or used code; wrong codes count against the per-user MFA lock
   * (`MFA_LOCKED`). (REQ-AUTH-018, SEC-P3-14)
   */
  MFA_ENROLMENT_CODE_REQUIRED: { status: 403, title: 'MFA enrolment code required' },
  /** Deletion refused while the user owns shipments not in a final state. (REQ-ACCT-017, US-271) */
  ACCOUNT_HAS_ACTIVE_SHIPMENTS: { status: 409, title: 'Account has active shipments' },
} as const satisfies ModuleCatalogue;
