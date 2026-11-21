/**
 * Pricing engine contract (ADR-0015 §1, openapi `ChargeLine`, `PriceTotals`, `PricingExplanation`; TASK-076). Every
 * value the engine needs is in `PricingInput`; the `pricing` module loads configuration, FX and tax and passes them in.
 * This task lands the integer-money core: the request's canonical packages and billable weight, the carrier cost, the
 * configuration version and the pricing instant. Later tasks extend the input (lane, content type, FX snapshot, tax
 * rule, cover) and add steps; the result shape is the price snapshot stored on quote options (REQ-PRICE-017).
 *
 * Field names are camelCase here; the API layer maps them to the snake_case schema.
 */
import type { BillableWeight, CanonicalPackage, Money } from '@platform/shared';

import type { Rate } from './rounding.js';

/**
 * Semantic version of the engine's arithmetic and step order; recorded in every result. 1.1.0 (TASK-080) adds the
 * margin step after the base freight line.
 */
export const ENGINE_VERSION = '1.1.0';

export interface PricingRequest {
  /** ISO 4217 currency of every charge line and total. */
  readonly sellCurrency: string;
  /** Canonical packages, integer grams and millimetres (DR-B06). */
  readonly packages: readonly CanonicalPackage[];
  /** Computed by `billableWeight` of `@platform/shared` and re-validated by the engine (ADR-0015 §3). */
  readonly billableWeight: BillableWeight;
}

export const COST_SOURCES = ['LIVE', 'RATE_CARD'] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export interface CarrierCostQuote {
  /** RATE_CARD is accepted by the type and refused at runtime until M2 (ADR-0015 §5). */
  readonly source: CostSource;
  readonly carrierCode: string;
  readonly serviceCode: string;
  /** Carrier cost in its own currency, minor units. */
  readonly cost: Money;
}

/**
 * One margin rule (data-model `margin_rules`, DR-B08; US-140, TASK-080). A null dimension matches any value. The M0
 * dimensions are carrier and service; US-141 adds carrier account, lane, customer segment, content type, weight band
 * and date range, and US-152 adds fixed-amount margins.
 */
export interface MarginRule {
  readonly ruleKey: string;
  /** Higher wins (DR-B08); the default rule has -1000. */
  readonly priority: number;
  readonly carrierCode: string | null;
  readonly serviceCode: string | null;
  /** Percentage over the base freight: `{ bps: 1500 }` is 15 %. Never negative. */
  readonly rate: Rate;
  /** Exactly one rule per configuration is the default: priority -1000 and every dimension null (REQ-PRICE-003). */
  readonly isDefault: boolean;
}

/** The materialised configuration version (ADR-0015 §4); further rule sets join it in later tasks. */
export interface PricingConfigSnapshot {
  readonly version: string;
  readonly marginRules: readonly MarginRule[];
}

export interface PricingInput {
  readonly request: PricingRequest;
  readonly carrierQuote: CarrierCostQuote;
  readonly config: PricingConfigSnapshot;
  /** Pricing instant, ISO 8601 UTC (`...Z`). The engine never reads a clock. */
  readonly now: string;
}

export const LINE_SOURCES = ['CARRIER', 'MARGIN', 'FUEL', 'COVER', 'DISCOUNT', 'COUPON', 'TAX'] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

/** One immutable charge line (REQ-PRICE-016); every amount is integer minor units in the sell currency. */
export interface ChargeLine {
  /** `^[A-Z][A-Z0-9_]*$`: BASE_FREIGHT, MARGIN, a canonical surcharge, COVER, INCLUDED_COVER, DISCOUNT, COUPON. */
  readonly code: string;
  /** i18n key, never a translated string. */
  readonly labelKey: string;
  readonly source: LineSource;
  readonly amount: Money;
  readonly taxAmount: Money;
  readonly taxCode: string | null;
  /** Zero-priced informational line (included cover). */
  readonly informational: boolean;
}

export const RULE_TYPES = ['MARGIN', 'FUEL', 'SURCHARGE', 'COVER', 'DISCOUNT', 'COUPON', 'VOLUME_TIER', 'FLOOR', 'TAX', 'FX'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export type ExplanationInput = string | number | boolean | null;

export interface ExplanationEntry {
  readonly ruleType: RuleType;
  readonly ruleKey: string;
  readonly configVersion: string;
  readonly outcome: 'FIRED' | 'REJECTED';
  /** The inputs the rule used (no personal data). */
  readonly inputs: Readonly<Record<string, ExplanationInput>>;
  /** Signed effect on the net total, minor units of the sell currency. */
  readonly effectMinor: number;
}

export const PRICING_WARNINGS = ['FX_STALE', 'PRICE_FLOOR_APPLIED', 'FUEL_NONE', 'FUEL_INCLUDED_BY_CARRIER'] as const;
export type PricingWarning = (typeof PRICING_WARNINGS)[number];

export interface PricingExplanation {
  readonly engineVersion: string;
  readonly configVersion: string;
  readonly entries: readonly ExplanationEntry[];
  readonly rejectedCandidateCount: number;
  readonly warnings: readonly PricingWarning[];
}

/** `net` = sum of lines; `tax` = sum of line taxes; `gross` = net + tax; `discount` = discounts as a positive amount. */
export interface PriceTotals {
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly discount: Money;
}

export interface PricingResult {
  readonly engineVersion: string;
  readonly configVersion: string;
  readonly sellCurrency: string;
  readonly lines: readonly ChargeLine[];
  readonly totals: PriceTotals;
  readonly billableWeight: BillableWeight;
  readonly explanation: PricingExplanation;
}

/** What the steps build, in order. */
export interface PricingState {
  readonly lines: readonly ChargeLine[];
  readonly entries: readonly ExplanationEntry[];
  readonly rejectedCandidateCount: number;
  readonly warnings: readonly PricingWarning[];
}

/** One evaluation step (ADR-0015 §2 order); pure: returns a new state, never mutates its arguments. */
export type PricingStep = (input: PricingInput, state: PricingState) => PricingState;
