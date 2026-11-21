/**
 * The pure pricing engine (ADR-0015, REQ-PRICE-001/002/004, DR-B07, DR-B11, NFR-DATA-001; US-138, TASK-076).
 *
 * `price(input)` is a pure function: no I/O, no clock, no randomness, no locale, no floating point on money. Every
 * monetary value is an integer count of minor units with an ISO 4217 code, built only by the `@platform/shared` money
 * helpers; each percentage is rounded once, at line level, halves away from zero (`rounding.ts`); totals are exact sums
 * of the rounded lines and are never rounded again. The result is a deep-frozen tree of plain objects whose key order
 * is fixed by construction, so the same input serialises to byte-identical JSON in any process, at any time
 * (AT-US-138-01).
 *
 * Evaluation runs the steps of `PRICING_STEPS` in the DR-B07 order: the base freight line (TASK-076), then the margin
 * line (US-140, TASK-080); the discount, floor, fuel, surcharge, cover, tax and FX steps join the list in their own
 * tasks, each built with the `state.ts` helpers that enforce the line invariants.
 */
import { add, assertCurrencyCode, isMoney, isNegative, type Money, MoneyError, negate, sum } from '@platform/shared';

import { validatedBillableWeight } from './billable-weight.js';
import { PricingError } from './errors.js';
import { baseFreightStep } from './lines/base-freight.js';
import { marginStep } from './lines/margin.js';
import { chargeLine, checkedState, EMPTY_STATE, explanationEntry, rejectedCandidateCount, warnings } from './state.js';
import {
  type ChargeLine,
  COST_SOURCES,
  ENGINE_VERSION,
  type PriceTotals,
  type PricingInput,
  type PricingResult,
  type PricingStep,
} from './types.js';

/** ISO 8601 UTC instant (`2026-11-12T10:00:00Z`, optional fraction). */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

/** The evaluation order (DR-B07). Later tasks insert their steps here. */
export const PRICING_STEPS: readonly PricingStep[] = Object.freeze([baseFreightStep, marginStep]);

const DISCOUNT_SOURCES: ReadonlySet<string> = new Set(['DISCOUNT', 'COUPON']);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function validateInput(input: PricingInput): void {
  if (!isNonEmptyString(input.config.version)) throw new PricingError('PRICING_CONFIG_INVALID', 'configuration version is required');
  if (!ISO_UTC_INSTANT.test(input.now)) throw new PricingError('PRICING_INPUT_INVALID', 'now must be an ISO 8601 UTC instant');
  assertCurrencyCode(input.request.sellCurrency);
  const { source, carrierCode, serviceCode, cost } = input.carrierQuote;
  if (!(COST_SOURCES as readonly string[]).includes(source)) throw new PricingError('PRICING_INPUT_INVALID', 'unknown cost source');
  if (source === 'RATE_CARD') throw new PricingError('COST_SOURCE_NOT_SUPPORTED', 'RATE_CARD cost source is not supported before M2');
  if (!isNonEmptyString(carrierCode) || !isNonEmptyString(serviceCode)) {
    throw new PricingError('PRICING_INPUT_INVALID', 'carrier and service codes are required');
  }
  if (!isMoney(cost)) throw new MoneyError('MONEY_INVALID', 'carrier cost must be integer minor units with an ISO 4217 code');
  if (isNegative(cost)) throw new PricingError('PRICING_INPUT_INVALID', 'carrier cost must not be negative');
}

function totalsOf(lines: readonly ChargeLine[], currency: string): PriceTotals {
  const net = sum(
    currency,
    lines.map((line): Money => line.amount),
  );
  const tax = sum(
    currency,
    lines.map((line): Money => line.taxAmount),
  );
  const discount = negate(
    sum(
      currency,
      lines.filter((line) => DISCOUNT_SOURCES.has(line.source)).map((line): Money => line.amount),
    ),
  );
  return Object.freeze({ net, tax, gross: add(net, tax), discount });
}

/** Runs `steps` over a validated input. Exposed for step tests; production code calls {@link price}. */
export function runPricing(input: PricingInput, steps: readonly PricingStep[]): PricingResult {
  validateInput(input);
  const billableWeight = validatedBillableWeight(input.request.packages, input.request.billableWeight);
  const state = steps.reduce((current, step) => checkedState(step(input, current)), EMPTY_STATE);
  const { sellCurrency } = input.request;
  const configVersion = input.config.version;
  // Re-validated and re-copied here as well, so no step can leave a float, a foreign currency or a mutable object.
  const lines = Object.freeze(state.lines.map((line) => chargeLine(line, sellCurrency)));
  return Object.freeze({
    engineVersion: ENGINE_VERSION,
    configVersion,
    sellCurrency,
    lines,
    totals: totalsOf(lines, sellCurrency),
    billableWeight,
    explanation: Object.freeze({
      engineVersion: ENGINE_VERSION,
      configVersion,
      entries: Object.freeze(state.entries.map(explanationEntry)),
      rejectedCandidateCount: rejectedCandidateCount(state),
      warnings: warnings(state),
    }),
  });
}

/** Prices one carrier quote (ADR-0015 §1). Pure and deterministic. */
export function price(input: PricingInput): PricingResult {
  return runPricing(input, PRICING_STEPS);
}
