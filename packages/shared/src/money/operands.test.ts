// PR076-SEC-02 / PR076-SEC-03: the Money helpers check their operands (own data properties only), not only results.
import { describe, expect, it } from '@jest/globals';

import { isMoneyError } from './errors.js';
import {
  add,
  allocate,
  assertSameCurrency,
  compare,
  convert,
  equals,
  isMoney,
  isNegative,
  isZero,
  type Money,
  money,
  mulRatio,
  negate,
  sub,
  toMajorString,
} from './money.js';
import { ratio } from './ratio.js';

const forged = (amount: unknown, currency: unknown = 'USD'): Money => ({ amount, currency }) as unknown as Money;
const usd = (amount: number): Money => money(amount, 'USD');

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return isMoneyError(error) ? error.code : `not a MoneyError: ${String(error)}`;
  }
  return 'no throw';
}

describe('[PR076-SEC-02] Money helpers refuse forged operands with MONEY_INVALID', () => {
  it.each<[string, () => unknown]>([
    ['add of two 0.5 amounts', () => add(forged(0.5), forged(0.5))],
    ['sub of numeric strings', () => sub(forged('1050'), forged('1'))],
    ['compare of numeric strings (lexicographic)', () => compare(forged('9'), forged('10'))],
    ['add in a __proto__ currency', () => add(forged(1, '__proto__'), forged(1, '__proto__'))],
    ['equals of a bigint amount', () => equals(forged(1050n), usd(1050))],
    ['mulRatio of 0.5 (was a raw RangeError)', () => mulRatio(forged(0.5), ratio(1))],
    ['allocate of 0.5 (was a raw RangeError)', () => allocate(forged(0.5), [1, 1])],
    ['convert of a string amount', () => convert(forged('100'), '1.5', 'EUR')],
    ['toMajorString of 0.5 (printed 0..5)', () => toMajorString(forged(0.5))],
    ['negate of NaN', () => negate(forged(Number.NaN))],
    ['isZero of a string', () => isZero(forged('0'))],
    ['isNegative of a bigint', () => isNegative(forged(-1n))],
    ['assertSameCurrency with an unknown currency', () => assertSameCurrency(forged(1, 'XYZ'), usd(1))],
    ['a null operand', () => add(null as unknown as Money, usd(1))],
  ])('%s', (_name, run) => {
    expect(codeOf(run)).toBe('MONEY_INVALID');
  });

  it('builds the mismatch message only from validated currency codes (PR076-SEC-04)', () => {
    expect(codeOf(() => assertSameCurrency(forged(1, 'USD\nforged'), usd(1)))).toBe('MONEY_INVALID');
    expect(codeOf(() => add(usd(1), money(1, 'EUR')))).toBe('CURRENCY_MISMATCH');
  });
});

describe('[PR076-SEC-03] isMoney reads own data properties only', () => {
  it('refuses inherited and accessor properties', () => {
    expect(isMoney(Object.create({ amount: 1, currency: 'USD' }))).toBe(false);
    const accessor = Object.defineProperty({ currency: 'USD' }, 'amount', { get: () => 1, enumerable: true });
    expect(isMoney(accessor)).toBe(false);
    expect(isMoney({ amount: 1, currency: 'USD' })).toBe(true);
  });
});
