/**
 * Money error model (ADR-0009 §3, REQ-PRICE-002; TASK-076). Every code is internal-only (api/README.md §11 "Internal /
 * start-up only"): no valid request can cause one, so a route that meets it answers 500 INTERNAL_ERROR and logs the
 * code. Messages name currencies and the failed operation only, never an amount's owner or any personal value.
 *
 *  - `CURRENCY_MISMATCH`: arithmetic across two currencies without an explicit FX step (REQ-PRICE-002 note).
 *  - `CURRENCY_UNKNOWN`: a code outside the ISO 4217 table, so it has no exponent (ADR-0009 §3 "unknown codes throw").
 *  - `MONEY_INVALID`: an amount that is not a safe integer count of minor units, or a result outside the safe range.
 *  - `RATE_INVALID`: a ratio or decimal rate that is not an exact finite rational with a positive denominator.
 */
export const MONEY_ERROR_CODES = ['CURRENCY_MISMATCH', 'CURRENCY_UNKNOWN', 'MONEY_INVALID', 'RATE_INVALID'] as const;
export type MoneyErrorCode = (typeof MONEY_ERROR_CODES)[number];

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string = code) {
    super(message);
    this.code = code;
  }
}

export function isMoneyError(value: unknown): value is MoneyError {
  return value instanceof MoneyError;
}
