import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isMoneyError } from './errors.js';
import {
  ceilRatio,
  compareRatio,
  decimalRatio,
  divideRatio,
  MAX_DECIMAL_EXPONENT,
  MAX_DECIMAL_LENGTH,
  multiplyRatio,
  parseDecimal,
  ratio,
  roundHalfAwayFromZero,
} from './ratio.js';

const r = (numerator: bigint, denominator = 1n) => ({ numerator, denominator });

describe('ratio', () => {
  it('reduces to lowest terms with a positive denominator and freezes the value', () => {
    expect(ratio(6, 4)).toEqual(r(3n, 2n));
    expect(ratio(-6n, 4n)).toEqual(r(-3n, 2n));
    expect(ratio(0, 7)).toEqual(r(0n, 1n));
    expect(ratio(5)).toEqual(r(5n));
    expect(Object.isFrozen(ratio(1, 2))).toBe(true);
  });

  it.each([
    ['a zero denominator', () => ratio(1, 0)],
    ['a negative denominator', () => ratio(1, -2)],
    ['a fractional numerator', () => ratio(1.5, 2)],
    ['an unsafe denominator', () => ratio(1, Number.MAX_SAFE_INTEGER + 1)],
  ])('refuses %s with RATE_INVALID', (_name, build) => {
    expect(build).toThrow(expect.objectContaining({ code: 'RATE_INVALID' }));
  });
});

describe('parseDecimal / decimalRatio', () => {
  it.each([
    ['0.15', r(3n, 20n)],
    ['-157.5', r(-315n, 2n)],
    ['+2', r(2n)],
    ['007.50', r(15n, 2n)],
    ['1.5e-3', r(3n, 2000n)],
    ['2E+2', r(200n)],
    ['-0', r(0n)],
    ['83.123456', ratio(83_123_456n, 1_000_000n)],
  ])('reads %s exactly', (text, expected) => {
    expect(parseDecimal(text)).toEqual(expected);
  });

  it('reads a number through its shortest round-trip text, never its binary value', () => {
    expect(parseDecimal(2.1)).toEqual(r(21n, 10n));
    expect(parseDecimal(0.1)).toEqual(r(1n, 10n));
    expect(parseDecimal(1e-7)).toEqual(r(1n, 10_000_000n));
    expect(parseDecimal(1.5e21)).toEqual(r(1_500_000_000_000_000_000_000n));
  });

  it.each([
    ['empty', ''],
    ['a bare dot', '.5'],
    ['a trailing dot', '5.'],
    ['letters', 'abc'],
    ['a comma decimal', '1,5'],
    ['white space', ' 1'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['null', null],
    ['an exponent beyond the bound', `1e${MAX_DECIMAL_EXPONENT + 1}`],
    ['a negative exponent beyond the bound', `1e-${MAX_DECIMAL_EXPONENT + 1}`],
    ['text beyond the length bound', '1'.repeat(MAX_DECIMAL_LENGTH + 1)],
  ])('answers undefined for %s', (_name, value) => {
    expect(parseDecimal(value)).toBeUndefined();
  });

  it('decimalRatio throws RATE_INVALID where parseDecimal answers undefined', () => {
    expect(decimalRatio('0.25')).toEqual(r(1n, 4n));
    let caught: unknown;
    try {
      decimalRatio('1/4');
    } catch (error) {
      caught = error;
    }
    expect(isMoneyError(caught) && caught.code).toBe('RATE_INVALID');
  });

  it('@property: every decimal string with up to 12 fraction digits round-trips exactly', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), fc.integer({ min: 0, max: 12 }), (digits, scale) => {
        const magnitude = (digits < 0n ? -digits : digits).toString().padStart(scale + 1, '0');
        const text = `${digits < 0n ? '-' : ''}${scale === 0 ? magnitude : `${magnitude.slice(0, -scale)}.${magnitude.slice(-scale)}`}`;
        const parsed = parseDecimal(text);
        expect(parsed).toEqual(ratio(digits, 10n ** BigInt(scale)));
      }),
      { seed: 7601, numRuns: 1000 },
    );
  });
});

describe('ratio arithmetic', () => {
  it('multiplies, divides and compares exactly', () => {
    expect(multiplyRatio(ratio(2, 3), ratio(9, 4))).toEqual(r(3n, 2n));
    expect(divideRatio(ratio(1, 2), ratio(-3, 4))).toEqual(r(-2n, 3n));
    expect(divideRatio(ratio(1, 2), ratio(3, 4))).toEqual(r(2n, 3n));
    expect(compareRatio(ratio(1, 3), ratio(1, 2))).toBe(-1);
    expect(compareRatio(ratio(2, 4), ratio(1, 2))).toBe(0);
    expect(compareRatio(ratio(3, 4), ratio(1, 2))).toBe(1);
  });

  it('refuses division by zero with RATE_INVALID', () => {
    expect(() => divideRatio(ratio(1), ratio(0))).toThrow(expect.objectContaining({ code: 'RATE_INVALID' }));
  });
});

describe('rounding', () => {
  it.each([
    [r(315n, 2n), 158n],
    [r(-315n, 2n), -158n],
    [r(1n, 2n), 1n],
    [r(-1n, 2n), -1n],
    [r(7n, 3n), 2n],
    [r(-7n, 3n), -2n],
    [r(5n, 3n), 2n],
    [r(4n), 4n],
    [r(0n), 0n],
  ])('roundHalfAwayFromZero(%o) = %s (DR-B11)', (value, expected) => {
    expect(roundHalfAwayFromZero(value)).toBe(expected);
  });

  it.each([
    [r(7n, 2n), 4n],
    [r(-7n, 2n), -3n],
    [r(6n, 2n), 3n],
    [r(1n, 1000n), 1n],
    [r(0n), 0n],
  ])('ceilRatio(%o) = %s', (value, expected) => {
    expect(ceilRatio(value)).toBe(expected);
  });

  it('@property: rounding is within half a unit, symmetric in sign, and ties go away from zero', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), fc.bigInt({ min: 1n, max: 10n ** 6n }), (numerator, denominator) => {
        const value = ratio(numerator, denominator);
        const rounded = roundHalfAwayFromZero(value);
        const twiceError = 2n * (rounded * value.denominator - value.numerator);
        const bound = value.denominator;
        expect(twiceError <= bound && twiceError >= -bound).toBe(true);
        expect(roundHalfAwayFromZero(ratio(-numerator, denominator))).toBe(-rounded);
        if (twiceError === bound || twiceError === -bound) expect(rounded * numerator >= 0n).toBe(true);
        const ceiling = ceilRatio(value);
        expect(ceiling * value.denominator >= value.numerator && (ceiling - 1n) * value.denominator < value.numerator).toBe(true);
      }),
      { seed: 7602, numRuns: 1000 },
    );
  });
});
