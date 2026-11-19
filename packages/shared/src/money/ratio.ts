/**
 * Exact rationals for money and units (ADR-0009 §3 and §4, DR-B06, DR-B11, REQ-PRICE-002; TASK-076). Rates are decimal
 * strings or integer ratios, never binary floats: a `Ratio` is a reduced fraction of two `bigint`s with a positive
 * denominator, so every product is exact and a value is rounded exactly once, by the caller's rounding rule.
 *
 * A JavaScript `number` is accepted as a decimal only through its shortest round-trip text (`String(2.1)` is `"2.1"`),
 * which is the value the user typed; its binary approximation never takes part in arithmetic.
 */
import { MoneyError } from './errors.js';

/** `numerator / denominator`, reduced, `denominator > 0`. Frozen. */
export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Longest decimal text accepted (a bound on the BigInt work an untrusted string can cause). */
export const MAX_DECIMAL_LENGTH = 64;
/** Largest decimal exponent accepted, in either direction (`1e400`, `1e-400`). */
export const MAX_DECIMAL_EXPONENT = 400;

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,4}))?$/u;

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function toBigInt(value: bigint | number, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new MoneyError('RATE_INVALID', `${what} must be a safe integer`);
  return BigInt(value);
}

/** The reduced ratio `numerator / denominator`; RATE_INVALID unless both are integers and the denominator is positive. */
export function ratio(numerator: bigint | number, denominator: bigint | number = 1n): Ratio {
  const top = toBigInt(numerator, 'numerator');
  const bottom = toBigInt(denominator, 'denominator');
  if (bottom <= 0n) throw new MoneyError('RATE_INVALID', 'denominator must be positive');
  const divisor = greatestCommonDivisor(top, bottom);
  return Object.freeze({ numerator: top / divisor, denominator: bottom / divisor });
}

/**
 * The exact value of a decimal string (`"0.15"`, `"-157.5"`, `"1.5e-3"`) or of a finite number's shortest round-trip
 * text, or `undefined` when the value is not such a decimal. Never throws.
 */
export function parseDecimal(value: unknown): Ratio | undefined {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value;
  } else {
    return undefined;
  }
  if (text.length > MAX_DECIMAL_LENGTH) return undefined;
  const match = DECIMAL_PATTERN.exec(text);
  if (match === null) return undefined;
  const [, sign = '', whole = '', fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  if (exponent > MAX_DECIMAL_EXPONENT || exponent < -MAX_DECIMAL_EXPONENT) return undefined;
  const magnitude = BigInt(`${whole}${fraction}`);
  const digits = sign === '-' ? -magnitude : magnitude;
  const scale = exponent - fraction.length;
  return scale >= 0 ? ratio(digits * 10n ** BigInt(scale)) : ratio(digits, 10n ** BigInt(-scale));
}

/** As {@link parseDecimal}, but RATE_INVALID instead of `undefined`. */
export function decimalRatio(value: string | number): Ratio {
  const parsed = parseDecimal(value);
  if (parsed === undefined) throw new MoneyError('RATE_INVALID', 'rate must be a finite decimal');
  return parsed;
}

export function multiplyRatio(left: Ratio, right: Ratio): Ratio {
  return ratio(left.numerator * right.numerator, left.denominator * right.denominator);
}

/** `left / right`; RATE_INVALID when `right` is zero. */
export function divideRatio(left: Ratio, right: Ratio): Ratio {
  if (right.numerator === 0n) throw new MoneyError('RATE_INVALID', 'division by zero');
  const sign = right.numerator < 0n ? -1n : 1n;
  return ratio(sign * left.numerator * right.denominator, left.denominator * absolute(right.numerator));
}

export function compareRatio(left: Ratio, right: Ratio): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  if (difference < 0n) return -1;
  return difference > 0n ? 1 : 0;
}

/** Nearest integer, halves away from zero (DR-B11): 157.5 -> 158, -157.5 -> -158. */
export function roundHalfAwayFromZero(value: Ratio): bigint {
  const { numerator, denominator } = value;
  const quotient = absolute(numerator) / denominator;
  const remainder = absolute(numerator) % denominator;
  const magnitude = 2n * remainder >= denominator ? quotient + 1n : quotient;
  return numerator < 0n ? -magnitude : magnitude;
}

/** Smallest integer not below the value (DR-B06 "rounded up to the next gram"). */
export function ceilRatio(value: Ratio): bigint {
  const { numerator, denominator } = value;
  const quotient = numerator / denominator;
  return numerator % denominator > 0n ? quotient + 1n : quotient;
}
