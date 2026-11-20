/**
 * Line-level rounding policy (DR-B11, REQ-PRICE-002, ADR-0015 §2 and "Alternatives": no floating-point percentages;
 * TASK-076). A rate is basis points or an exact decimal fraction, never a binary float. Each percentage amount is
 * computed exactly from the line's base and rounded once to the minor unit, halves away from zero, when the line is
 * created; totals are sums of rounded lines and are never rounded again (engine.ts).
 *
 * Examples (AT-US-138-03): 15 % of 1050 is 157.5 -> 158; -15 % of 1050 is -157.5 -> -158.
 */
import { BPS_PER_UNIT, type Money, mulRatio, parseDecimal, type Ratio, ratio } from '@platform/shared';

import { PricingError } from './errors.js';

/** `{ bps: 1500 }` is 15 %; `{ decimal: '0.15' }` is the same rate as an exact decimal fraction. */
export type Rate = { readonly bps: number } | { readonly decimal: string };

/**
 * The exact ratio of a rate; PRICING_CONFIG_INVALID for a non-integer bps value, a malformed decimal, or a rate with
 * both keys or neither (code review R1-n3). Only own properties count (PR076-SEC-03).
 */
export function rateRatio(rate: Rate): Ratio {
  const isObject = typeof rate === 'object' && rate !== null;
  const hasBps = isObject && Object.hasOwn(rate, 'bps');
  const hasDecimal = isObject && Object.hasOwn(rate, 'decimal');
  if (hasBps === hasDecimal) throw new PricingError('PRICING_CONFIG_INVALID', 'a rate has exactly one of bps and decimal');
  if ('bps' in rate && hasBps) {
    const { bps } = rate;
    if (!Number.isSafeInteger(bps)) throw new PricingError('PRICING_CONFIG_INVALID', 'rate bps must be an integer');
    return ratio(bps, BPS_PER_UNIT);
  }
  const parsed = parseDecimal((rate as { readonly decimal: string }).decimal);
  if (parsed === undefined) throw new PricingError('PRICING_CONFIG_INVALID', 'rate decimal must be a finite decimal string');
  return parsed;
}

/** `base x rate`, rounded once at line level, halves away from zero (DR-B11). */
export function applyRate(base: Money, rate: Rate): Money {
  return mulRatio(base, rateRatio(rate));
}
