/**
 * Units of weight and length (ADR-0009 §4, DR-B06, REQ-PRICE-004, REQ-QUOTE-005; TASK-076). Weights are held as
 * integer grams and dimensions as integer millimetres. Entry values (kg or lb, cm or in) convert exactly, with
 * 1 lb = 453.59237 g and 1 in = 25.4 mm, and round once to the nearest gram or millimetre, halves up; display rounds to
 * one decimal in kg or lb and cm or in. No floating-point arithmetic: values are exact rationals (`../money/ratio`).
 *
 * The same physical package entered in metric or imperial therefore normalises to identical integers (AT-US-139-05),
 * so the unit toggle changes entry and display only (REQ-QUOTE-005). Used by the API (quote input) and the browser
 * quote widget (US-157), so this module has no Node or server import.
 */
import { AppError, type ValidationIssue } from '../errors/app-error.js';
import { multiplyRatio, parseDecimal, type Ratio, ratio, roundHalfAwayFromZero } from '../money/ratio.js';

export const UNIT_SYSTEMS = ['METRIC', 'IMPERIAL'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export type WeightUnit = 'g' | 'kg' | 'lb';
export type LengthUnit = 'mm' | 'cm' | 'in';

/** Grams per pound, exactly (international avoirdupois pound). */
export const GRAMS_PER_POUND: Ratio = ratio(45_359_237n, 100_000n);
/** Millimetres per inch, exactly. */
export const MILLIMETRES_PER_INCH: Ratio = ratio(254n, 10n);

const GRAMS_PER: Readonly<Record<WeightUnit, Ratio>> = { g: ratio(1), kg: ratio(1000), lb: GRAMS_PER_POUND };
const MILLIMETRES_PER: Readonly<Record<LengthUnit, Ratio>> = { mm: ratio(1), cm: ratio(10), in: MILLIMETRES_PER_INCH };

/** Entry and display units of each system. */
export const SYSTEM_UNITS: Readonly<Record<UnitSystem, { readonly weight: WeightUnit; readonly length: LengthUnit }>> = {
  METRIC: { weight: 'kg', length: 'cm' },
  IMPERIAL: { weight: 'lb', length: 'in' },
};

/** Canonical package: positive integer grams and millimetres. */
export interface CanonicalPackage {
  readonly weightG: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

/** A package as entered: decimals in the units of `unitSystem` (kg and cm, or lb and in). */
export interface PackageEntry {
  readonly unitSystem: UnitSystem;
  readonly weight: number | string;
  readonly length: number | string;
  readonly width: number | string;
  readonly height: number | string;
}

/** VALIDATION_ERROR (400) whose issues name each failing field by its JSON pointer. */
export function validationError(issues: readonly ValidationIssue[]): AppError {
  return new AppError('VALIDATION_ERROR', { errors: issues });
}

type Conversion = { readonly value: number } | { readonly issue: Omit<ValidationIssue, 'pointer'> };

/** Exact conversion to a positive safe integer of the internal unit, rounded once, halves up. */
function toInternal(value: unknown, factor: Ratio, field: string): Conversion {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { issue: { code: 'INVALID_TYPE', message: `${field} must be a number` } };
  }
  const parsed = parseDecimal(value);
  if (parsed === undefined) return { issue: { code: 'INVALID_FORMAT', message: `${field} must be a finite decimal number` } };
  const rounded = roundHalfAwayFromZero(multiplyRatio(parsed, factor));
  if (rounded <= 0n) return { issue: { code: 'OUT_OF_RANGE', message: `${field} must be greater than 0` } };
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return { issue: { code: 'OUT_OF_RANGE', message: `${field} is too large` } };
  return { value: Number(rounded) };
}

function convertOne(value: unknown, factor: Ratio, field: string, pointer: string): number {
  const result = toInternal(value, factor, field);
  if ('issue' in result) throw validationError([{ pointer, ...result.issue }]);
  return result.value;
}

/** Entry weight -> positive integer grams (halves up); VALIDATION_ERROR at `pointer` otherwise. */
export function toGrams(value: number | string, unit: WeightUnit, pointer = ''): number {
  return convertOne(value, GRAMS_PER[unit], 'weight', pointer);
}

/** Entry length -> positive integer millimetres (halves up); VALIDATION_ERROR at `pointer` otherwise. */
export function toMillimetres(value: number | string, unit: LengthUnit, pointer = ''): number {
  return convertOne(value, MILLIMETRES_PER[unit], 'dimension', pointer);
}

/**
 * Normalises an entered package to integer grams and millimetres. Every invalid field is reported, each with its own
 * pointer (`<pointer>/weight`, `/length`, `/width`, `/height`), in one VALIDATION_ERROR (AT-US-139-06).
 */
export function normalisePackage(entry: PackageEntry, pointer = ''): CanonicalPackage {
  if (!(UNIT_SYSTEMS as readonly unknown[]).includes(entry.unitSystem)) {
    throw validationError([{ pointer: `${pointer}/unit_system`, code: 'INVALID_ENUM', message: 'unit_system must be METRIC or IMPERIAL' }]);
  }
  const units = SYSTEM_UNITS[entry.unitSystem];
  const issues: ValidationIssue[] = [];
  const convert = (field: string, value: unknown, factor: Ratio): number => {
    const result = toInternal(value, factor, field);
    if ('value' in result) return result.value;
    issues.push({ pointer: `${pointer}/${field}`, ...result.issue });
    return 0;
  };
  const canonical: CanonicalPackage = {
    weightG: convert('weight', entry.weight, GRAMS_PER[units.weight]),
    lengthMm: convert('length', entry.length, MILLIMETRES_PER[units.length]),
    widthMm: convert('width', entry.width, MILLIMETRES_PER[units.length]),
    heightMm: convert('height', entry.height, MILLIMETRES_PER[units.length]),
  };
  if (issues.length > 0) throw validationError(issues);
  return Object.freeze(canonical);
}

/** One-decimal display text of an internal integer in a display unit, halves up (DR-B06): 12527 g in lb -> "27.6". */
function display(internal: number, perUnit: Ratio): string {
  const tenths = roundHalfAwayFromZero(ratio(BigInt(internal) * 10n * perUnit.denominator, perUnit.numerator));
  const sign = tenths < 0n ? '-' : '';
  const digits = String(tenths < 0n ? -tenths : tenths).padStart(2, '0');
  return `${sign}${digits.slice(0, -1)}.${digits.slice(-1)}`;
}

/** Grams -> one-decimal kg or lb text. */
export function displayWeight(grams: number, unit: Exclude<WeightUnit, 'g'>): string {
  return display(grams, GRAMS_PER[unit]);
}

/** Millimetres -> one-decimal cm or in text. */
export function displayLength(millimetres: number, unit: Exclude<LengthUnit, 'mm'>): string {
  return display(millimetres, MILLIMETRES_PER[unit]);
}
