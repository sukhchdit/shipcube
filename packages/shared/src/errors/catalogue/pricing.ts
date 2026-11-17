// Pricing-module error codes (DR-A26 Part B, api/README.md §11; TASK-036). Codes, statuses and titles
// equal the shared problem responses of docs/03-architecture/api/openapi.yaml; the module that implements the routes
// owns this file from then on (PLAN.md §5 rule 2). A published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const pricingCatalogue = {
  /** Coupon has no remaining redemptions. (REQ-PRICE-011, EC-B24) */
  COUPON_EXHAUSTED: { status: 422, title: 'Coupon exhausted' },
  /** Coupon outside its active date range at pricing time. (REQ-PRICE-011, EC-B24) */
  COUPON_EXPIRED: { status: 422, title: 'Coupon expired' },
  /** Unknown or ineligible coupon (eligibility not disclosed). (REQ-PRICE-011) */
  COUPON_INVALID: { status: 422, title: 'Coupon invalid' },
  /** Insured value above the configured maximum insurable value. (REQ-PRICE-009) */
  COVER_VALUE_EXCEEDS_MAXIMUM: { status: 422, title: 'Cover value exceeds maximum' },
  /** No FX snapshot for the requested currency pair. (REQ-PRICE-015) */
  FX_RATE_UNAVAILABLE: { status: 422, title: 'FX rate unavailable' },
} as const satisfies ModuleCatalogue;
