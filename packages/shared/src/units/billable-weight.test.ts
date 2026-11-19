import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isAppError } from '../errors/app-error.js';
import { billableWeight, billableWeightRule, type BillableWeightRule, DEFAULT_BILLABLE_WEIGHT_RULES } from './billable-weight.js';
import { type CanonicalPackage, displayLength, displayWeight, normalisePackage, toGrams, toMillimetres } from './units.js';

const METRIC = DEFAULT_BILLABLE_WEIGHT_RULES.METRIC;
const IMPERIAL = DEFAULT_BILLABLE_WEIGHT_RULES.IMPERIAL;

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

/** The VALIDATION_ERROR issues a call throws. */
function issuesOf(run: () => unknown): readonly { pointer: string; code: string }[] {
  const error = thrown(run);
  if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw new Error('expected VALIDATION_ERROR');
  return (error.errors ?? []).map(({ pointer, code }) => ({ pointer, code }));
}

const metric = (weight: number | string, length: number | string, width: number | string, height: number | string) =>
  normalisePackage({ unitSystem: 'METRIC', weight, length, width, height });
const imperial = (weight: number | string, length: number | string, width: number | string, height: number | string) =>
  normalisePackage({ unitSystem: 'IMPERIAL', weight, length, width, height });

describe('billable weight (US-139)', () => {
  it('[AT-US-139-01] volumetric weight exceeds actual: 50 x 40 x 30 cm, 4 kg, divisor 5000, 0.5 kg -> 12.0 kg', () => {
    const { perPackage, totalG } = billableWeight([metric(4, 50, 40, 30)], METRIC);
    expect(perPackage[0]).toEqual({ actualG: 4000, volumetricG: 12_000, billableG: 12_000 });
    expect(displayWeight(perPackage[0]?.volumetricG ?? 0, 'kg')).toBe('12.0');
    expect(displayWeight(totalG, 'kg')).toBe('12.0');
  });

  it('[AT-US-139-02] actual exceeds volumetric and rounds up to the increment: 30 x 20 x 10 cm, 2.1 kg -> 2.5 kg', () => {
    const { perPackage } = billableWeight([metric(2.1, 30, 20, 10)], METRIC);
    expect(perPackage[0]).toEqual({ actualG: 2100, volumetricG: 1200, billableG: 2500 });
    expect(displayWeight(perPackage[0]?.volumetricG ?? 0, 'kg')).toBe('1.2');
    expect(displayWeight(perPackage[0]?.billableG ?? 0, 'kg')).toBe('2.5');
  });

  it('[AT-US-139-03] sum over packages: 2.5 kg + 3.0 kg -> 5.5 kg', () => {
    const { perPackage, totalG } = billableWeight([metric('2.1', 30, 20, 10), metric('3', 10, 10, 10)], METRIC);
    expect(perPackage.map((entry) => entry.billableG)).toEqual([2500, 3000]);
    expect(totalG).toBe(5500);
    expect(displayWeight(totalG, 'kg')).toBe('5.5');
  });

  it('[AT-US-139-04] imperial uses divisor 139 and a 1 lb increment: 20 x 16 x 12 in, 5 lb -> 27.6 lb volumetric, 28 lb', () => {
    const pkg = imperial(5, 20, 16, 12);
    const { perPackage, totalG } = billableWeight([pkg], IMPERIAL);
    expect(displayWeight(perPackage[0]?.volumetricG ?? 0, 'lb')).toBe('27.6');
    expect(totalG).toBe(toGrams(28, 'lb'));
    expect(displayWeight(totalG, 'lb')).toBe('28.0');
  });

  it('[AT-US-139-05] metric and imperial entry of the same package give identical grams, millimetres and billable weight', () => {
    const fromMetric = normalisePackage({ unitSystem: 'METRIC', weight: '2', length: '30', width: '20', height: '10' });
    const fromImperial = imperial('4.409', '11.811', '7.874', '3.937');
    expect(fromMetric).toEqual({ weightG: 2000, lengthMm: 300, widthMm: 200, heightMm: 100 });
    expect(fromImperial).toEqual(fromMetric);
    for (const rule of [METRIC, IMPERIAL]) {
      expect(billableWeight([fromImperial], rule)).toEqual(billableWeight([fromMetric], rule));
    }
  });

  it('[AT-US-139-06] a zero or negative dimension is rejected with a validation error naming the field', () => {
    expect(
      issuesOf(() => normalisePackage({ unitSystem: 'METRIC', weight: 1, length: 0, width: 10, height: -5 }, '/body/packages/0')),
    ).toEqual([
      { pointer: '/body/packages/0/length', code: 'OUT_OF_RANGE' },
      { pointer: '/body/packages/0/height', code: 'OUT_OF_RANGE' },
    ]);
    const canonical: CanonicalPackage = { weightG: 1000, lengthMm: 100, widthMm: 0, heightMm: -1 };
    expect(issuesOf(() => billableWeight([canonical], METRIC, '/packages'))).toEqual([
      { pointer: '/packages/0/width_mm', code: 'OUT_OF_RANGE' },
      { pointer: '/packages/0/height_mm', code: 'OUT_OF_RANGE' },
    ]);
  });

  it('bills exactly 5 lb for exactly 5 lb entered (the gram ladder, never 6 lb)', () => {
    const { totalG } = billableWeight([imperial(5, 2, 2, 2)], IMPERIAL);
    expect(totalG).toBe(toGrams(5, 'lb'));
  });

  it('maps the carrier_services weight columns to a rule per unit system', () => {
    const terms = {
      volumetricDivisorMetric: 6000,
      volumetricDivisorImperial: 166,
      weightIncrementMetricG: 1000,
      weightIncrementImperialCentiLb: 50,
    };
    expect(billableWeightRule(terms, 'METRIC')).toEqual({ unitSystem: 'METRIC', divisor: 6000, incrementG: 1000 });
    expect(billableWeightRule(terms, 'IMPERIAL')).toEqual({ unitSystem: 'IMPERIAL', divisor: 166, incrementCentiLb: 50 });
  });

  it.each<[string, BillableWeightRule]>([
    ['a zero divisor', { unitSystem: 'METRIC', divisor: 0, incrementG: 500 }],
    ['a fractional increment', { unitSystem: 'METRIC', divisor: 5000, incrementG: 0.5 }],
    ['a zero imperial increment', { unitSystem: 'IMPERIAL', divisor: 139, incrementCentiLb: 0 }],
  ])('refuses a malformed rule (%s) as a programming error', (_name, rule) => {
    expect(() => billableWeight([metric(1, 1, 1, 1)], rule)).toThrow(RangeError);
  });

  it('refuses an empty package list and a result outside the safe integer range', () => {
    expect(issuesOf(() => billableWeight([], METRIC, '/packages'))).toEqual([{ pointer: '/packages', code: 'TOO_SHORT' }]);
    const huge = { weightG: 1, lengthMm: Number.MAX_SAFE_INTEGER, widthMm: Number.MAX_SAFE_INTEGER, heightMm: 2 };
    expect(issuesOf(() => billableWeight([metric(1, 1, 1, 1), huge], METRIC))).toEqual([{ pointer: '/1', code: 'OUT_OF_RANGE' }]);
  });

  it('@property: billable is the smallest increment step not below max(actual, volumetric), summed exactly', () => {
    const pkg = fc.record({
      weightG: fc.integer({ min: 1, max: 1_000_000 }),
      lengthMm: fc.integer({ min: 1, max: 3000 }),
      widthMm: fc.integer({ min: 1, max: 3000 }),
      heightMm: fc.integer({ min: 1, max: 3000 }),
    });
    fc.assert(
      fc.property(fc.array(pkg, { minLength: 1, maxLength: 5 }), fc.constantFrom(METRIC, IMPERIAL), (packages, rule) => {
        const result = billableWeight(packages, rule);
        const step = (n: number): number => (rule.unitSystem === 'METRIC' ? n * rule.incrementG : toGrams(n, 'lb'));
        let total = 0;
        result.perPackage.forEach((entry, index) => {
          const floor = Math.max(entry.actualG, entry.volumetricG);
          expect(entry.actualG).toBe(packages[index]?.weightG);
          expect(entry.billableG).toBeGreaterThanOrEqual(floor);
          const steps =
            rule.unitSystem === 'METRIC' ? entry.billableG / rule.incrementG : Math.round((entry.billableG * 100_000) / 45_359_237);
          expect(step(steps)).toBe(entry.billableG);
          expect(steps === 1 || step(steps - 1) < floor).toBe(true);
          total += entry.billableG;
        });
        expect(result.totalG).toBe(total);
      }),
      { seed: 7606, numRuns: 1000 },
    );
  });
});

describe('unit conversion (DR-B06)', () => {
  it('converts kg, lb, cm, in, g and mm exactly and rounds halves up', () => {
    expect(toGrams('0.0005', 'kg')).toBe(1);
    expect(toGrams(1, 'lb')).toBe(454);
    expect(toGrams('1500', 'g')).toBe(1500);
    expect(toMillimetres('1', 'in')).toBe(25);
    expect(toMillimetres('0.06', 'in')).toBe(2); // 1.524 mm
    expect(toMillimetres(2.25, 'cm')).toBe(23); // 22.5 -> 23
    expect(toMillimetres('7', 'mm')).toBe(7);
  });

  it('reports the type, format and range of a bad value at the given pointer', () => {
    expect(issuesOf(() => toGrams('abc', 'kg', '/w'))).toEqual([{ pointer: '/w', code: 'INVALID_FORMAT' }]);
    expect(issuesOf(() => toGrams('0.0004', 'kg', '/w'))).toEqual([{ pointer: '/w', code: 'OUT_OF_RANGE' }]);
    expect(issuesOf(() => toMillimetres('9e20', 'cm'))).toEqual([{ pointer: '', code: 'OUT_OF_RANGE' }]);
    expect(issuesOf(() => toMillimetres(null as unknown as number, 'cm'))).toEqual([{ pointer: '', code: 'INVALID_TYPE' }]);
    expect(issuesOf(() => normalisePackage({ unitSystem: 'SI' as 'METRIC', weight: 1, length: 1, width: 1, height: 1 }, '/p'))).toEqual([
      { pointer: '/p/unit_system', code: 'INVALID_ENUM' },
    ]);
  });

  it('displays one decimal in kg, lb, cm and in, halves up', () => {
    expect(displayWeight(12_527, 'lb')).toBe('27.6');
    expect(displayWeight(50, 'kg')).toBe('0.1');
    expect(displayWeight(49, 'kg')).toBe('0.0');
    expect(displayWeight(-1500, 'kg')).toBe('-1.5');
    expect(displayLength(305, 'cm')).toBe('30.5');
    expect(displayLength(305, 'in')).toBe('12.0');
  });

  it('@property: an entry in tenths of kg and cm round-trips through the internal integers to the same display', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: 30_000 }), (tenthsKg, tenthsCm) => {
        const kg = `${Math.trunc(tenthsKg / 10)}.${tenthsKg % 10}`;
        const cm = `${Math.trunc(tenthsCm / 10)}.${tenthsCm % 10}`;
        expect(displayWeight(toGrams(kg, 'kg'), 'kg')).toBe(kg);
        expect(displayLength(toMillimetres(cm, 'cm'), 'cm')).toBe(cm);
      }),
      { seed: 7607, numRuns: 1000 },
    );
  });
});
