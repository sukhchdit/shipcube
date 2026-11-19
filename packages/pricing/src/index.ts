// Public entry point of @platform/pricing. Pure pricing engine (ADR-0015).
// Exports are added by the tasks that implement this package.
export { validatedBillableWeight } from './billable-weight.js';
export { PRICING_STEPS, price, runPricing } from './engine.js';
export { PRICING_ERROR_CODES, PricingError, isPricingError, type PricingErrorCode } from './errors.js';
export { BASE_FREIGHT_CODE, BASE_FREIGHT_LABEL_KEY, baseFreightStep } from './lines/base-freight.js';
export { applyRate, rateRatio, type Rate } from './rounding.js';
export { EMPTY_STATE, appendEntry, appendLine, chargeLine, explanationEntry } from './state.js';
export {
  COST_SOURCES,
  ENGINE_VERSION,
  LINE_SOURCES,
  PRICING_WARNINGS,
  RULE_TYPES,
  type CarrierCostQuote,
  type ChargeLine,
  type CostSource,
  type ExplanationEntry,
  type ExplanationInput,
  type LineSource,
  type PriceTotals,
  type PricingConfigSnapshot,
  type PricingExplanation,
  type PricingInput,
  type PricingRequest,
  type PricingResult,
  type PricingState,
  type PricingStep,
  type PricingWarning,
  type RuleType,
} from './types.js';
