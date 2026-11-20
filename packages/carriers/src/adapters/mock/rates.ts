/**
 * Pure rating of the Mock carrier (AT-US-122-01/02/06): price = f(billable weight, lane zone, service) on integer
 * minor units, nothing else. Billable weight is the larger of actual and volumetric weight, summed over the packages
 * and rounded up to 500 g; a request beyond the Mock limits is a no-service verdict, never an exception.
 */
import { add, BPS_PER_UNIT, type Money, money, mulRatio, percentage, ratio } from '@platform/shared';

import type { CarrierErrorCode } from '../../canonical/codes.js';
import type { PackageSpec } from '../../canonical/types.js';
import { CarrierContractError } from '../../errors.js';
import {
  BILLABLE_STEP_G,
  FUEL_SURCHARGE_PERCENT,
  MAX_DIMENSIONS_MM,
  MAX_PACKAGE_WEIGHT_G,
  MAX_SHIPMENT_WEIGHT_G,
  MOCK_CURRENCY,
  MOCK_SERVICES,
  type MockServiceCode,
  type MockZone,
  VOLUMETRIC_DIVISOR_MM3_PER_G,
  ZONE_STEP_MINOR,
} from './constants.js';

const PERMILLE = 1000;
const MS_PER_DAY = 86_400_000;
const SHIP_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Defects of the package list as a contract problem (positive safe integers, at least one package). */
export function assertPackages(packages: readonly PackageSpec[]): void {
  const issues: string[] = [];
  packages.forEach((spec, index) => {
    for (const key of ['weightG', 'lengthMm', 'widthMm', 'heightMm'] as const) {
      if (!Number.isSafeInteger(spec[key]) || spec[key] <= 0) issues.push(`packages[${String(index)}].${key} must be a positive integer`);
    }
  });
  if (issues.length > 0) throw new CarrierContractError('invalid packages', issues);
}

/** The Mock limit a package list breaks, or undefined when every limit holds (checked before any multiplication). */
export function limitViolation(
  packages: readonly PackageSpec[],
): Extract<CarrierErrorCode, 'WEIGHT_EXCEEDED' | 'DIMENSION_EXCEEDED'> | undefined {
  const total = packages.reduce((sum, spec) => sum + spec.weightG, 0);
  if (total > MAX_SHIPMENT_WEIGHT_G || packages.some((spec) => spec.weightG > MAX_PACKAGE_WEIGHT_G)) return 'WEIGHT_EXCEEDED';
  const limit = [MAX_DIMENSIONS_MM.lengthMm, MAX_DIMENSIONS_MM.widthMm, MAX_DIMENSIONS_MM.heightMm].sort((a, b) => b - a);
  const tooBig = packages.some((spec) =>
    [spec.lengthMm, spec.widthMm, spec.heightMm].sort((a, b) => b - a).some((side, index) => side > (limit[index] ?? 0)),
  );
  return tooBig ? 'DIMENSION_EXCEEDED' : undefined;
}

/** Billable weight in grams: max(actual, volumetric) per package, summed, rounded up to the 500 g step (at least one). */
export function billableWeightG(packages: readonly PackageSpec[]): number {
  const grams = packages.reduce((sum, spec) => {
    const volumetric = Math.ceil((spec.lengthMm * spec.widthMm * spec.heightMm) / VOLUMETRIC_DIVISOR_MM3_PER_G);
    return sum + Math.max(spec.weightG, volumetric);
  }, 0);
  return Math.max(1, Math.ceil(grams / BILLABLE_STEP_G)) * BILLABLE_STEP_G;
}

export interface MockPrice {
  readonly base: Money;
  readonly fuel: Money;
  readonly total: Money;
}

/**
 * Integer price of one service: flat fee plus the zone rate per 500 g step, plus 12 % fuel. All arithmetic goes through
 * the Money helpers of `@platform/shared` (one rounding per product, halves away from zero; platform/money-arith).
 */
export function priceService(service: MockServiceCode, zone: MockZone, billableG: number): MockPrice {
  const spec = MOCK_SERVICES[service];
  const step = mulRatio(money(ZONE_STEP_MINOR[zone], MOCK_CURRENCY), ratio(spec.stepPermille, PERMILLE));
  const base = add(money(spec.baseMinor, MOCK_CURRENCY), mulRatio(step, ratio(billableG / BILLABLE_STEP_G)));
  const fuel = percentage(base, FUEL_SURCHARGE_PERCENT * (BPS_PER_UNIT / 100));
  return { base, fuel, total: add(base, fuel) };
}

/** ISO 8601 instant `days` after the ship date at 00:00 UTC; derived from the request only (no clock). */
export function estimatedDelivery(shipDate: string, days: number): string | undefined {
  if (!SHIP_DATE.test(shipDate)) return undefined;
  const start = Date.parse(`${shipDate}T00:00:00.000Z`);
  return Number.isNaN(start) ? undefined : new Date(start + days * MS_PER_DAY).toISOString();
}
