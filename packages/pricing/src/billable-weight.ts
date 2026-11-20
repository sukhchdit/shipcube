/**
 * Billable weight as the engine sees it (ADR-0015 §3, DR-B05/B06, REQ-PRICE-004; US-139, TASK-076). The weight is
 * computed once, by `billableWeight` of `@platform/shared` (the helper the quote widget shares, US-157), and passed in;
 * the engine re-validates it and copies it into the result in a fixed key order, so the stored snapshot does not
 * depend on how the caller built its objects.
 *
 * Invariants (PRICING_INPUT_INVALID otherwise): at least one package; every package and weight is a positive safe
 * integer of grams or millimetres (a canonical package has volume, so its volumetric weight is at least 1 g); exactly
 * one weight entry per package with `actualG` equal to the package weight; `billableG` not below the actual or the
 * volumetric weight; `totalG` the exact sum of the package billable weights.
 */
import type { BillableWeight, CanonicalPackage, PackageWeights } from '@platform/shared';

import { PricingError } from './errors.js';

const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function fail(reason: string): never {
  throw new PricingError('PRICING_INPUT_INVALID', `billable weight: ${reason}`);
}

function checkPackage(pkg: CanonicalPackage, weights: PackageWeights | undefined, index: number): PackageWeights {
  if (![pkg.weightG, pkg.lengthMm, pkg.widthMm, pkg.heightMm].every(isPositiveInteger)) {
    fail(`package ${index} is not positive integer grams and millimetres`);
  }
  if (weights === undefined) return fail(`package ${index} has no weight entry`);
  const { actualG, volumetricG, billableG } = weights;
  if (![actualG, volumetricG, billableG].every(isPositiveInteger)) fail(`package ${index} weights are not positive integer grams`);
  if (actualG !== pkg.weightG) fail(`package ${index} actual weight differs from the package`);
  if (billableG < actualG || billableG < volumetricG) fail(`package ${index} bills less than its actual or volumetric weight`);
  return Object.freeze({ actualG, volumetricG, billableG });
}

/** The validated billable weight, copied with a fixed key order. */
export function validatedBillableWeight(packages: readonly CanonicalPackage[], weight: BillableWeight): BillableWeight {
  if (packages.length === 0) fail('at least one package is required');
  if (weight.perPackage.length > packages.length) fail('more weight entries than packages');
  const perPackage = packages.map((pkg, index) => checkPackage(pkg, weight.perPackage[index], index));
  const total = perPackage.reduce((sum, entry) => sum + entry.billableG, 0);
  if (!Number.isSafeInteger(total) || total !== weight.totalG) fail('total is not the sum of the package billable weights');
  return Object.freeze({ perPackage: Object.freeze(perPackage), totalG: total });
}
