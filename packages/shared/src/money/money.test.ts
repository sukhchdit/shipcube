import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { CURRENCY_EXPONENTS, assertCurrencyCode, currencyExponent, isCurrencyCode } from './currency.js';
import { isMoneyError, MoneyError } from './errors.js';
import {
  add,
  allocate,
  compare,
  convert,
  equals,
  fromMajor,
  isMoney,
  isNegative,
  isZero,
  minor,
  type Money,
  money,
  mulRatio,
  negate,
  percentage,
  sub,
  sum,
  toMajorString,
  zero,
} from './money.js';
import { ratio } from './ratio.js';

const usd = (amount: number): Money => money(amount, 'USD');
const SAFE = Number.MAX_SAFE_INTEGER;

/** The error a call throws (for asserting the code without depending on the message). */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

const codeOf = (run: () => unknown): string | undefined => {
  const error = thrown(run);
  return isMoneyError(error) ? error.code : undefined;
};

describe('currencies (ISO 4217)', () => {
  it('knows the exponents of the platform currencies and the non-2 ones', () => {
    expect(['USD', 'INR', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'].map(currencyExponent)).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('BHD')).toBe(3);
    expect(currencyExponent('CLF')).toBe(4);
  });

  it('holds only upper-case three-letter codes with a 0..4 exponent', () => {
    expect(CURRENCY_EXPONENTS.size).toBeGreaterThan(150);
    for (const [code, exponent] of CURRENCY_EXPONENTS) {
      expect(code).toMatch(/^[A-Z]{3}$/u);
      expect([0, 2, 3, 4]).toContain(exponent);
    }
  });

  it.each(['XXX', 'usd', 'US', 'toString', 'constructor', '__proto__', 'XAU', ''])('refuses %p with CURRENCY_UNKNOWN', (code) => {
    expect(isCurrencyCode(code)).toBe(false);
    expect(codeOf(() => currencyExponent(code))).toBe('CURRENCY_UNKNOWN');
    expect(codeOf(() => assertCurrencyCode(code))).toBe('CURRENCY_UNKNOWN');
  });

  it('refuses a non-string code', () => {
    expect(isCurrencyCode(840)).toBe(false);
    expect(codeOf(() => assertCurrencyCode(undefined))).toBe('CURRENCY_UNKNOWN');
  });
});

describe('Money values', () => {
  it('are frozen { amount, currency } objects in that key order; -0 becomes 0', () => {
    const value = usd(1234);
    expect(JSON.stringify(value)).toBe('{"amount":1234,"currency":"USD"}');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.is(money(-0, 'USD').amount, 0)).toBe(true);
    expect(zero('JPY')).toEqual({ amount: 0, currency: 'JPY' });
  });

  it.each([
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an unsafe integer', SAFE + 1],
  ])('refuse %s with MONEY_INVALID', (_name, amount) => {
    expect(codeOf(() => money(amount, 'USD'))).toBe('MONEY_INVALID');
    expect(codeOf(() => minor(amount))).toBe('MONEY_INVALID');
  });

  it('refuse an unknown currency with CURRENCY_UNKNOWN', () => {
    expect(codeOf(() => money(1, 'ABC'))).toBe('CURRENCY_UNKNOWN');
  });

  it('isMoney accepts only a safe integer with a known code', () => {
    expect(isMoney(usd(5))).toBe(true);
    expect(isMoney({ amount: 5, currency: 'USD' })).toBe(true);
    expect(isMoney({ amount: 5.5, currency: 'USD' })).toBe(false);
    expect(isMoney({ amount: 5, currency: 'ABC' })).toBe(false);
    expect(isMoney({ amount: '5', currency: 'USD' })).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney(5)).toBe(false);
  });
});

describe('arithmetic in one currency', () => {
  it('adds, subtracts, negates, sums and compares', () => {
    expect(add(usd(1050), usd(158))).toEqual(usd(1208));
    expect(sub(usd(1050), usd(1208))).toEqual(usd(-158));
    expect(negate(usd(158))).toEqual(usd(-158));
    expect(negate(usd(0)).amount).toBe(0);
    expect(sum('USD', [usd(1), usd(2), usd(3)])).toEqual(usd(6));
    expect(sum('USD', [])).toEqual(usd(0));
    expect(compare(usd(1), usd(2))).toBe(-1);
    expect(compare(usd(2), usd(2))).toBe(0);
    expect(compare(usd(3), usd(2))).toBe(1);
    expect(equals(usd(2), usd(2))).toBe(true);
    expect(equals(usd(2), money(2, 'CAD'))).toBe(false);
    expect(isZero(usd(0))).toBe(true);
    expect(isNegative(usd(-1))).toBe(true);
    expect(isNegative(usd(0))).toBe(false);
  });

  it('[AT-US-138-05] mixed currencies without an FX step throw CURRENCY_MISMATCH', () => {
    const inr = money(1000, 'INR');
    expect(codeOf(() => add(usd(1000), inr))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => sub(usd(1000), inr))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => compare(usd(1000), inr))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => sum('USD', [usd(1), inr]))).toBe('CURRENCY_MISMATCH');
    const error = thrown(() => add(usd(1000), inr));
    expect(error).toBeInstanceOf(MoneyError);
    expect((error as MoneyError).message).toBe('cannot combine USD with INR without an FX step');
  });

  it('refuses a result outside the safe integer range with MONEY_INVALID (never a silent float)', () => {
    expect(codeOf(() => add(usd(SAFE), usd(1)))).toBe('MONEY_INVALID');
    expect(codeOf(() => sub(usd(-SAFE), usd(2)))).toBe('MONEY_INVALID');
    expect(codeOf(() => mulRatio(usd(SAFE), ratio(3, 2)))).toBe('MONEY_INVALID');
    expect(codeOf(() => mulRatio(usd(-SAFE), ratio(3, 2)))).toBe('MONEY_INVALID');
  });
});

describe('percentages and ratios (DR-B11)', () => {
  it('[AT-US-138-03] 15 % of 1050 is 158 (157.5 away from zero); -15 % is -158', () => {
    expect(percentage(usd(1050), 1500)).toEqual(usd(158));
    expect(percentage(usd(1050), -1500)).toEqual(usd(-158));
    expect(percentage(usd(-1050), 1500)).toEqual(usd(-158));
    expect(mulRatio(usd(1050), ratio(15, 100))).toEqual(usd(158));
  });

  it('rounds once, below and above the half', () => {
    expect(percentage(usd(1049), 1500)).toEqual(usd(157)); // 157.35
    expect(percentage(usd(1051), 1500)).toEqual(usd(158)); // 157.65
    expect(percentage(usd(0), 1500)).toEqual(usd(0));
  });

  it('refuses a fractional bps value with RATE_INVALID', () => {
    expect(codeOf(() => percentage(usd(100), 12.5))).toBe('RATE_INVALID');
  });

  it('@property: a percentage is the exact value rounded half away from zero, and odd in the base', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.integer({ min: -100_000, max: 100_000 }), (amount, bps) => {
        const result = percentage(usd(amount), bps);
        expect(Number.isSafeInteger(result.amount)).toBe(true);
        const exact2 = 2n * BigInt(amount) * BigInt(bps); // twice the exact value, in units of 1/10 000
        const twiceError = 2n * 10_000n * BigInt(result.amount) - exact2;
        expect(twiceError <= 10_000n && twiceError >= -10_000n).toBe(true);
        expect(percentage(usd(-amount), bps).amount).toBe(0 - result.amount);
      }),
      { seed: 7603, numRuns: 1000 },
    );
  });
});

describe('allocate', () => {
  it('splits without losing a minor unit; the remainder goes to the largest remainders, ties to the lower index', () => {
    expect(allocate(usd(100), [1, 1, 1]).map((part) => part.amount)).toEqual([34, 33, 33]);
    expect(allocate(usd(-100), [1, 1, 1]).map((part) => part.amount)).toEqual([-34, -33, -33]);
    expect(allocate(usd(5), [3, 7]).map((part) => part.amount)).toEqual([2, 3]); // 1.5 / 3.5: the tie goes to index 0
    expect(allocate(usd(10), [0, 1]).map((part) => part.amount)).toEqual([0, 10]);
  });

  it.each([
    ['no positive weight', [0, 0]],
    ['a negative weight', [1, -1]],
    ['a fractional weight', [0.5, 1]],
  ])('refuses %s with RATE_INVALID', (_name, weights) => {
    expect(codeOf(() => allocate(usd(10), weights))).toBe('RATE_INVALID');
  });

  it('@property: the parts sum to the whole and each is within one unit of its exact share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 8 }).filter((ws) => ws.some((w) => w > 0)),
        (amount, weights) => {
          const parts = allocate(usd(amount), weights);
          expect(sum('USD', parts)).toEqual(usd(amount));
          const total = weights.reduce((acc, w) => acc + w, 0);
          parts.forEach((part, index) => {
            const exact = BigInt(amount) * BigInt(weights[index] ?? 0);
            const scaled = BigInt(part.amount) * BigInt(total) - exact;
            expect(scaled < BigInt(total) && scaled > -BigInt(total)).toBe(true);
          });
        },
      ),
      { seed: 7604, numRuns: 1000 },
    );
  });
});

describe('convert (DR-B11 FX)', () => {
  it('multiplies by the rate, scales by the exponents and rounds once', () => {
    expect(convert(usd(1000), '83.123456', 'INR')).toEqual(money(83_123, 'INR')); // 831.23456 INR
    expect(convert(usd(1000), '150.5', 'JPY')).toEqual(money(1505, 'JPY')); // 10.00 USD -> 1505 JPY
    expect(convert(money(1505, 'JPY'), '0.0066445', 'USD')).toEqual(usd(1000)); // 999.997... cents
    expect(convert(usd(1000), ratio(1), 'KWD')).toEqual(money(10_000, 'KWD'));
    expect(convert(usd(-1000), '1.5', 'EUR')).toEqual(money(-1500, 'EUR'));
  });

  it('refuses a non-positive or malformed rate and an unknown target', () => {
    expect(codeOf(() => convert(usd(1), '0', 'INR'))).toBe('RATE_INVALID');
    expect(codeOf(() => convert(usd(1), '-1', 'INR'))).toBe('RATE_INVALID');
    expect(codeOf(() => convert(usd(1), 'abc', 'INR'))).toBe('RATE_INVALID');
    expect(codeOf(() => convert(usd(1), '1', 'ABC'))).toBe('CURRENCY_UNKNOWN');
  });
});

describe('major units', () => {
  it('[AT-US-138-06] produces minor units with each currency exponent (JPY 0, USD 2, KWD 3)', () => {
    expect(fromMajor('12.34', 'USD')).toEqual(usd(1234));
    expect(fromMajor('12.3', 'USD')).toEqual(usd(1230));
    expect(fromMajor('1234', 'JPY')).toEqual(money(1234, 'JPY'));
    expect(fromMajor('1.234', 'KWD')).toEqual(money(1234, 'KWD'));
    expect(fromMajor(10.5, 'USD')).toEqual(usd(1050));
    expect(codeOf(() => fromMajor('10.5', 'JPY'))).toBe('MONEY_INVALID');
    expect(codeOf(() => fromMajor('1.001', 'USD'))).toBe('MONEY_INVALID');
    expect(codeOf(() => fromMajor('ten', 'USD'))).toBe('MONEY_INVALID');
    expect(codeOf(() => fromMajor('1', 'ABC'))).toBe('CURRENCY_UNKNOWN');
  });

  it('formats minor units back as a plain decimal with the exponent of fraction digits', () => {
    expect(toMajorString(usd(1234))).toBe('12.34');
    expect(toMajorString(usd(5))).toBe('0.05');
    expect(toMajorString(usd(-5))).toBe('-0.05');
    expect(toMajorString(money(1234, 'JPY'))).toBe('1234');
    expect(toMajorString(money(-7, 'JPY'))).toBe('-7');
    expect(toMajorString(money(1234, 'KWD'))).toBe('1.234');
  });

  it('@property: fromMajor(toMajorString(x)) is x in every currency', () => {
    const codes = [...CURRENCY_EXPONENTS.keys()];
    fc.assert(
      fc.property(fc.integer({ min: -1e15, max: 1e15 }), fc.constantFrom(...codes), (amount, code) => {
        const value = money(amount, code);
        expect(fromMajor(toMajorString(value), code)).toEqual(value);
      }),
      { seed: 7605, numRuns: 1000 },
    );
  });
});
