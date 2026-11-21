/**
 * Pricing engine error model (ADR-0015 §1 and §5, api/README.md §11 "Internal / start-up only"; TASK-076). The engine
 * is called by the `pricing` module with inputs the module loaded and validated, so a failure here is a configuration
 * or programming error: the module answers 500 INTERNAL_ERROR (or excludes the option) and logs the code. None of the
 * codes is in the error catalogue on purpose. Money failures (CURRENCY_MISMATCH, CURRENCY_UNKNOWN, MONEY_INVALID,
 * RATE_INVALID) propagate unchanged as `MoneyError` from `@platform/shared`.
 *
 *  - `PRICING_CONFIG_INVALID`: the configuration snapshot is unusable (US-140 adds "no default margin rule").
 *  - `PRICING_INPUT_INVALID`: the request or carrier quote breaks an engine invariant (for example a billable weight
 *    that is not integer grams, or below the actual weight).
 *  - `COST_SOURCE_NOT_SUPPORTED`: a RATE_CARD cost source before M2 (explicit, no silent stub; ADR-0015 §5).
 */
export const PRICING_ERROR_CODES = ['PRICING_CONFIG_INVALID', 'PRICING_INPUT_INVALID', 'COST_SOURCE_NOT_SUPPORTED'] as const;
export type PricingErrorCode = (typeof PRICING_ERROR_CODES)[number];

export class PricingError extends Error {
  override readonly name = 'PricingError';
  readonly code: PricingErrorCode;

  constructor(code: PricingErrorCode, message: string = code) {
    super(message);
    this.code = code;
  }
}

export function isPricingError(value: unknown): value is PricingError {
  return value instanceof PricingError;
}
