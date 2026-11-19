import { describe, expect, it } from '@jest/globals';
import { type BillableWeight, type CanonicalPackage, money } from '@platform/shared';

import { validatedBillableWeight } from './billable-weight.js';
import { isPricingError } from './errors.js';
import { applyRate, rateRatio } from './rounding.js';
import { pricingInput } from './tests/fixtures.js';

const { packages, billableWeight } = pricingInput().request;
const PKG = packages[0] as CanonicalPackage;
const ENTRY = billableWeight.perPackage[0] ?? { actualG: 0, volumetricG: 0, billableG: 0 };

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return isPricingError(error) ? error.code : undefined;
  }
  return undefined;
}

describe('validatedBillableWeight (ADR-0015 §3)', () => {
  it('copies a valid weight with a fixed key order', () => {
    const reordered = { totalG: 2500, perPackage: [{ billableG: 2500, volumetricG: 1200, actualG: 2100 }] } as BillableWeight;
    expect(JSON.stringify(validatedBillableWeight(packages, reordered))).toBe(
      '{"perPackage":[{"actualG":2100,"volumetricG":1200,"billableG":2500}],"totalG":2500}',
    );
  });

  it.each<[string, readonly CanonicalPackage[], BillableWeight]>([
    ['no package', [], { perPackage: [], totalG: 0 }],
    ['more entries than packages', packages, { perPackage: [ENTRY, ENTRY], totalG: 5000 }],
    ['a missing entry', [PKG, PKG], { perPackage: [ENTRY], totalG: 2500 }],
    ['a non-integer package', [{ ...PKG, lengthMm: 1.5 }], billableWeight],
    ['non-integer grams', packages, { perPackage: [{ ...ENTRY, billableG: 2500.5 }], totalG: 2500.5 }],
    ['an actual weight that differs from the package', packages, { perPackage: [{ ...ENTRY, actualG: 2000 }], totalG: 2500 }],
    ['billable below actual', packages, { perPackage: [{ ...ENTRY, billableG: 2000 }], totalG: 2000 }],
    ['billable below volumetric', packages, { perPackage: [{ ...ENTRY, volumetricG: 3000 }], totalG: 2500 }],
    ['a wrong total', packages, { perPackage: [ENTRY], totalG: 3000 }],
    [
      'a total outside the safe range',
      [
        { ...PKG, weightG: 1 },
        { ...PKG, weightG: 1 },
      ],
      {
        perPackage: [
          { actualG: 1, volumetricG: 1, billableG: Number.MAX_SAFE_INTEGER },
          { actualG: 1, volumetricG: 1, billableG: Number.MAX_SAFE_INTEGER },
        ],
        totalG: Number.MAX_SAFE_INTEGER * 2,
      },
    ],
  ])('refuses %s with PRICING_INPUT_INVALID', (_name, pkgs, weight) => {
    expect(codeOf(() => validatedBillableWeight(pkgs, weight))).toBe('PRICING_INPUT_INVALID');
  });
});

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
});
