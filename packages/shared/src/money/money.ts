/**
 * Integer minor-unit money (ADR-0009 §3, REQ-PRICE-002, DR-B11, NFR-DATA-001; TASK-076). `Money` is
 * `{ amount, currency }`: `amount` is a safe integer count of the currency's minor units, branded `Minor` so that the
 * type-aware `platform/money-arith` lint rule reports any `number` arithmetic on it outside this folder, and `currency`
 * is an ISO 4217 code of {@link CURRENCY_EXPONENTS}. These helpers are the only place that does arithmetic on minor
 * units:
 *
 *  - `add`, `sub`, `sum` and `compare` refuse two currencies with CURRENCY_MISMATCH (no implicit FX);
 *  - `mulRatio`, `percentage` and `convert` multiply exactly and round **once**, halves away from zero (DR-B11);
 *  - `allocate` splits an amount without losing or creating a minor unit (largest remainder);
 *  - every result is checked to be a safe integer (MONEY_INVALID otherwise), so overflow can never round silently.
 *
 * Values are frozen plain objects with the keys in the order `amount`, `currency`, so equal values serialise to
 * byte-identical JSON.
 */
import { assertCurrencyCode, currencyExponent, isCurrencyCode } from './currency.js';
import { MoneyError } from './errors.js';
import { decimalRatio, parseDecimal, type Ratio, ratio, roundHalfAwayFromZero } from './ratio.js';

/** A safe integer count of minor units. Only the helpers of this folder create one from a `number`. */
export type Minor = number & { readonly __brand: 'Minor' };

export interface Money {
  readonly amount: Minor;
  readonly currency: string;
}

/** Basis points per unit: 1500 bps = 15 %. */
export const BPS_PER_UNIT = 10_000;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** The value as `Minor`, or MONEY_INVALID unless it is a safe integer. `-0` becomes `0`. */
export function minor(value: number): Minor {
  if (!Number.isSafeInteger(value)) throw new MoneyError('MONEY_INVALID', 'amount must be a safe integer of minor units');
  return (value === 0 ? 0 : value) as Minor;
}

function fromBigInt(value: bigint): Minor {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new MoneyError('MONEY_INVALID', 'amount is outside the safe integer range');
  return minor(Number(value));
}

function make(amount: Minor, currency: string): Money {
  return Object.freeze({ amount, currency });
}

/** A validated Money value: MONEY_INVALID for a non-integer amount, CURRENCY_UNKNOWN for an unknown code. */
export function money(amount: number, currency: string): Money {
  return make(minor(amount), assertCurrencyCode(currency));
}

export function zero(currency: string): Money {
  return money(0, currency);
}

/** True for a plain `{ amount, currency }` object holding a safe integer and a known ISO 4217 code. */
export function isMoney(value: unknown): value is Money {
  if (typeof value !== 'object' || value === null) return false;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  return Number.isSafeInteger(amount) && isCurrencyCode(currency);
}

/** CURRENCY_MISMATCH unless both values share one currency. */
export function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new MoneyError('CURRENCY_MISMATCH', `cannot combine ${left.currency} with ${right.currency} without an FX step`);
  }
}

export function add(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return make(minor(left.amount + right.amount), left.currency);
}

export function sub(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return make(minor(left.amount - right.amount), left.currency);
}

export function negate(value: Money): Money {
  return make(minor(0 - value.amount), value.currency);
}

/** The sum of the values in `currency` (zero for none); CURRENCY_MISMATCH for any value in another currency. */
export function sum(currency: string, values: Iterable<Money>): Money {
  let total = zero(currency);
  for (const value of values) total = add(total, value);
  return total;
}

export function compare(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  if (left.amount < right.amount) return -1;
  return left.amount > right.amount ? 1 : 0;
}

export function equals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amount === right.amount;
}

export function isZero(value: Money): boolean {
  return value.amount === 0;
}

export function isNegative(value: Money): boolean {
  return value.amount < 0;
}

/** `value * factor`, rounded once to the minor unit, halves away from zero (DR-B11). */
export function mulRatio(value: Money, factor: Ratio): Money {
  const exact = ratio(BigInt(value.amount) * factor.numerator, factor.denominator);
  return make(fromBigInt(roundHalfAwayFromZero(exact)), value.currency);
}

/** `value * bps / 10 000`, rounded once (DR-B11): 1050 at 1500 bps is 158 (157.5 away from zero). */
export function percentage(value: Money, bps: number): Money {
  return mulRatio(value, ratio(bps, BPS_PER_UNIT));
}

/**
 * Splits `value` in proportion to non-negative integer `weights` (at least one positive) so that the parts sum to
 * `value` exactly: each part is the truncated share, and the remaining minor units go one each to the largest
 * remainders, ties to the lower index. Deterministic; signs follow `value`.
 */
export function allocate(value: Money, weights: readonly number[]): Money[] {
  const ws = weights.map((weight) => {
    if (!Number.isSafeInteger(weight) || weight < 0) throw new MoneyError('RATE_INVALID', 'weights must be non-negative safe integers');
    return BigInt(weight);
  });
  const total = ws.reduce((acc, weight) => acc + weight, 0n);
  if (total === 0n) throw new MoneyError('RATE_INVALID', 'at least one weight must be positive');
  const amount = BigInt(value.amount);
  const sign = amount < 0n ? -1n : 1n;
  const magnitude = sign * amount;
  const shares = ws.map((weight) => (magnitude * weight) / total);
  const remainders = ws.map((weight, index) => ({ index, remainder: (magnitude * weight) % total }));
  let left = magnitude - shares.reduce((acc, share) => acc + share, 0n);
  remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of remainders) {
    if (left === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    left -= 1n;
  }
  return shares.map((share) => make(fromBigInt(sign * share), value.currency));
}

/**
 * FX conversion (DR-B11): the source minor units times the rate (target major units per source major unit, an exact
 * decimal such as `"83.123456"` or a ratio), scaled by the two exponents and rounded once to the target minor unit,
 * halves away from zero. RATE_INVALID for a rate that is not positive.
 */
export function convert(value: Money, rate: Ratio | string, to: string): Money {
  const factor = typeof rate === 'string' ? decimalRatio(rate) : rate;
  if (factor.numerator <= 0n) throw new MoneyError('RATE_INVALID', 'FX rate must be positive');
  const target = assertCurrencyCode(to);
  const shift = currencyExponent(target) - currencyExponent(value.currency);
  const scale = 10n ** BigInt(shift < 0 ? -shift : shift);
  const exact =
    shift >= 0
      ? ratio(BigInt(value.amount) * factor.numerator * scale, factor.denominator)
      : ratio(BigInt(value.amount) * factor.numerator, factor.denominator * scale);
  return make(fromBigInt(roundHalfAwayFromZero(exact)), target);
}

/**
 * Money from a major-unit decimal (`"12.34"` USD -> 1234, `"1234"` JPY -> 1234, `"1.234"` KWD -> 1234). Exact:
 * MONEY_INVALID when the value has more fraction digits than the currency's exponent allows, or is not a decimal.
 */
export function fromMajor(value: string | number, currency: string): Money {
  const code = assertCurrencyCode(currency);
  const parsed = parseDecimal(value);
  if (parsed === undefined) throw new MoneyError('MONEY_INVALID', 'major amount must be a finite decimal');
  const scaled = ratio(parsed.numerator * 10n ** BigInt(currencyExponent(code)), parsed.denominator);
  if (scaled.denominator !== 1n) throw new MoneyError('MONEY_INVALID', `amount has more fraction digits than ${code} allows`);
  return make(fromBigInt(scaled.numerator), code);
}

/** The major-unit decimal text with exactly the currency's exponent of fraction digits (1234 USD -> "12.34"). */
export function toMajorString(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const digits = String(Math.abs(value.amount)).padStart(exponent + 1, '0');
  const sign = value.amount < 0 ? '-' : '';
  if (exponent === 0) return `${sign}${digits}`;
  const cut = digits.length - exponent;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}
