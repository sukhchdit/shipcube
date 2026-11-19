/**
 * Billable weight (DR-B05, DR-B06, ADR-0009 §4, REQ-PRICE-004; US-139, TASK-076). Computed on canonical integers:
 *
 *  - volumetric weight = L x W x H / divisor, rounded up to the next gram. The divisor is per unit system of the rule:
 *    cm³ per kg for METRIC (default 5000, so grams = mm³ / divisor) and in³ per lb for IMPERIAL (default 139, so grams
 *    = mm³ x 453.59237 / (25.4³ x divisor));
 *  - package billable weight = the greater of actual and volumetric weight, rounded up to the rule's increment
 *    (default 500 g, or 1 lb = 100 centi-lb). An increment that is not a whole number of grams (1 lb) is laddered in
 *    integer grams: step n weighs round-half-up(n x increment) grams, the value `toGrams(n, 'lb')` gives, and the
 *    package bills the smallest step not below its weight (so exactly 5 lb entered bills 5 lb, never 6);
 *  - shipment billable weight = the sum of the package billable weights.
 *
 * The rule (divisor and increment) comes from the service reference data (`carrier_services`) for the unit system the
 * caller chooses; the unit system of *entry* plays no part once the package is canonical, so metric and imperial entry
 * of the same package bill identically (AT-US-139-05). Pure and exact: `bigint` rationals only.
 */
import type { ValidationIssue } from '../errors/app-error.js';
import { ceilRatio, divideRatio, multiplyRatio, type Ratio, ratio, roundHalfAwayFromZero } from '../money/ratio.js';
import { type CanonicalPackage, GRAMS_PER_POUND, MILLIMETRES_PER_INCH, type UnitSystem, validationError } from './units.js';

export type BillableWeightRule =
  | { readonly unitSystem: 'METRIC'; readonly divisor: number; readonly incrementG: number }
  | { readonly unitSystem: 'IMPERIAL'; readonly divisor: number; readonly incrementCentiLb: number };

/** The documented defaults (A-059, GAP-B-04; data-model `carrier_services` column defaults). */
export const DEFAULT_BILLABLE_WEIGHT_RULES: Readonly<Record<UnitSystem, BillableWeightRule>> = Object.freeze({
  METRIC: Object.freeze({ unitSystem: 'METRIC', divisor: 5000, incrementG: 500 }),
  IMPERIAL: Object.freeze({ unitSystem: 'IMPERIAL', divisor: 139, incrementCentiLb: 100 }),
});

/** The weight columns of `carrier_services` (data-model §2). */
export interface CarrierServiceWeightTerms {
  readonly volumetricDivisorMetric: number;
  readonly volumetricDivisorImperial: number;
  readonly weightIncrementMetricG: number;
  readonly weightIncrementImperialCentiLb: number;
}

/** The service's rule for a unit system. */
export function billableWeightRule(terms: CarrierServiceWeightTerms, unitSystem: UnitSystem): BillableWeightRule {
  return unitSystem === 'METRIC'
    ? { unitSystem, divisor: terms.volumetricDivisorMetric, incrementG: terms.weightIncrementMetricG }
    : { unitSystem, divisor: terms.volumetricDivisorImperial, incrementCentiLb: terms.weightIncrementImperialCentiLb };
}

export interface PackageWeights {
  readonly actualG: number;
  readonly volumetricG: number;
  readonly billableG: number;
}

export interface BillableWeight {
  readonly perPackage: readonly PackageWeights[];
  readonly totalG: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const CENTI = ratio(1n, 100n);

/** Reference data is trusted configuration: a malformed rule is a programming or seed error, not a client error. */
function assertRule(rule: BillableWeightRule): void {
  const increment = rule.unitSystem === 'METRIC' ? rule.incrementG : rule.incrementCentiLb;
  if (!(Number.isSafeInteger(rule.divisor) && rule.divisor > 0 && Number.isSafeInteger(increment) && increment > 0)) {
    throw new RangeError('billable weight rule needs a positive integer divisor and increment');
  }
}

/** Cubic millimetres per volumetric gram. */
function cubicMillimetresPerGram(rule: BillableWeightRule): Ratio {
  if (rule.unitSystem === 'METRIC') return ratio(rule.divisor);
  const cubicInch = multiplyRatio(multiplyRatio(MILLIMETRES_PER_INCH, MILLIMETRES_PER_INCH), MILLIMETRES_PER_INCH);
  return divideRatio(multiplyRatio(cubicInch, ratio(rule.divisor)), GRAMS_PER_POUND);
}

/** The increment in (possibly fractional) grams. */
function incrementGrams(rule: BillableWeightRule): Ratio {
  return rule.unitSystem === 'METRIC'
    ? ratio(rule.incrementG)
    : multiplyRatio(multiplyRatio(ratio(rule.incrementCentiLb), CENTI), GRAMS_PER_POUND);
}

const PACKAGE_FIELDS = [
  ['weightG', 'weight_g'],
  ['lengthMm', 'length_mm'],
  ['widthMm', 'width_mm'],
  ['heightMm', 'height_mm'],
] as const;

function packageIssues(pkg: CanonicalPackage, pointer: string): ValidationIssue[] {
  return PACKAGE_FIELDS.flatMap(([key, field]) =>
    Number.isSafeInteger(pkg[key]) && pkg[key] > 0
      ? []
      : [{ pointer: `${pointer}/${field}`, code: 'OUT_OF_RANGE', message: `${field} must be a positive integer` }],
  );
}

function weighPackage(pkg: CanonicalPackage, perGram: Ratio, increment: Ratio): { volumetric: bigint; billable: bigint } {
  const volume = BigInt(pkg.lengthMm) * BigInt(pkg.widthMm) * BigInt(pkg.heightMm);
  const volumetric = ceilRatio(divideRatio(ratio(volume), perGram));
  const actual = BigInt(pkg.weightG);
  const weight = actual > volumetric ? actual : volumetric;
  // Smallest step n with round-half-up(n x increment) >= weight, i.e. n >= (2 x weight - 1) / (2 x increment).
  const steps = ceilRatio(divideRatio(ratio(2n * weight - 1n), multiplyRatio(ratio(2), increment)));
  const billable = roundHalfAwayFromZero(multiplyRatio(ratio(steps), increment));
  return { volumetric, billable };
}

/**
 * Volumetric and billable weight per package and the shipment total. VALIDATION_ERROR (pointer
 * `<pointer>/<index>/<field>`) for an empty list or a field that is not a positive integer, and OUT_OF_RANGE when a
 * result leaves the safe integer range.
 */
export function billableWeight(packages: readonly CanonicalPackage[], rule: BillableWeightRule, pointer = ''): BillableWeight {
  assertRule(rule);
  if (packages.length === 0) {
    throw validationError([{ pointer, code: 'TOO_SHORT', message: 'at least one package is required' }]);
  }
  const issues = packages.flatMap((pkg, index) => packageIssues(pkg, `${pointer}/${index}`));
  if (issues.length > 0) throw validationError(issues);
  const perGram = cubicMillimetresPerGram(rule);
  const increment = incrementGrams(rule);
  let total = 0n;
  const perPackage = packages.map((pkg, index): PackageWeights => {
    const { volumetric, billable } = weighPackage(pkg, perGram, increment);
    total += billable;
    if (volumetric > MAX_SAFE || total > MAX_SAFE) {
      throw validationError([{ pointer: `${pointer}/${index}`, code: 'OUT_OF_RANGE', message: 'package is too large' }]);
    }
    return Object.freeze({ actualG: pkg.weightG, volumetricG: Number(volumetric), billableG: Number(billable) });
  });
  return Object.freeze({ perPackage: Object.freeze(perPackage), totalG: Number(total) });
}
