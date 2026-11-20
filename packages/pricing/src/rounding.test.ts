import { describe, expect, it } from '@jest/globals';
import { money } from '@platform/shared';

import { isPricingError } from './errors.js';
import { applyRate, type Rate, rateRatio } from './rounding.js';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return isPricingError(error) ? error.code : undefined;
  }
  return undefined;
}

describe('rounding (DR-B11)', () => {
  it('reads bps and exact decimal rates', () => {
    expect(rateRatio({ bps: 1500 })).toEqual({ numerator: 3n, denominator: 20n });
    expect(rateRatio({ decimal: '0.15' })).toEqual({ numerator: 3n, denominator: 20n });
    expect(applyRate(money(1050, 'USD'), { bps: 1500 })).toEqual(money(158, 'USD'));
    expect(applyRate(money(1050, 'USD'), { decimal: '-0.15' })).toEqual(money(-158, 'USD'));
  });

  it('refuses a fractional bps value or a malformed decimal with PRICING_CONFIG_INVALID', () => {
    expect(codeOf(() => rateRatio({ bps: 15.5 }))).toBe('PRICING_CONFIG_INVALID');
    expect(codeOf(() => rateRatio({ decimal: '15%' }))).toBe('PRICING_CONFIG_INVALID');
  });

  it('[R1-n3] refuses a rate with both keys or neither', () => {
    expect(codeOf(() => rateRatio({ bps: 1500, decimal: '0.15' }))).toBe('PRICING_CONFIG_INVALID');
    expect(codeOf(() => rateRatio({} as unknown as Rate))).toBe('PRICING_CONFIG_INVALID');
    expect(codeOf(() => rateRatio(null as unknown as Rate))).toBe('PRICING_CONFIG_INVALID');
  });

  it('[PR076-SEC-03] reads own properties only: an inherited bps neither counts nor overrides an own decimal', () => {
    expect(codeOf(() => rateRatio(Object.create({ bps: 1500 }) as Rate))).toBe('PRICING_CONFIG_INVALID');
    const polluted = Object.assign(Object.create({ bps: 9999 }) as object, { decimal: '0.15' }) as Rate;
    expect(rateRatio(polluted)).toEqual({ numerator: 3n, denominator: 20n });
  });
});
