import { describe, expect, it } from '@jest/globals';
import { isMoney, money } from '@platform/shared';
import fc from 'fast-check';

import { CarrierError } from '../errors.js';
import { carrierDecimalToMoney } from './money.js';

function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('carrierDecimalToMoney (R1-m6, D-TASK075-10; TASK-080)', () => {
  it.each<[string, string, number]>([
    ['12.34', 'USD', 1234],
    ['1234', 'JPY', 1234],
    ['0', 'USD', 0],
    ['0.5', 'USD', 50],
    ['1.234', 'KWD', 1234],
    ['-3.10', 'USD', -310],
    ['12.340', 'USD', 1234],
  ])('"%s" %s -> %i minor units, an ADR-0009 Money', (value, currency, amount) => {
    const result = carrierDecimalToMoney(value, currency);
    expect(result).toEqual(money(amount, currency));
    expect(isMoney(result)).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ['more fraction digits than USD allows', '12.345', 'USD'],
    ['a fraction on JPY', '12.5', 'JPY'],
    ['an exponent', '1e3', 'USD'],
    ['an empty string', '', 'USD'],
    ['white space', ' 12.34', 'USD'],
    ['a plus sign', '+12.34', 'USD'],
    ['a trailing dot', '12.', 'USD'],
    ['a leading dot', '.5', 'USD'],
    ['a grouping comma', '1,234.00', 'USD'],
    ['a number instead of text', 12.34, 'USD'],
    ['an unknown currency', '12.34', 'ABC'],
    ['an amount beyond the safe-integer range', '9'.repeat(30), 'USD'],
  ])('refuses %s as invalid carrier data (CARRIER_UNKNOWN_ERROR, value never echoed)', (_name, value, currency) => {
    const error = refusal(() => carrierDecimalToMoney(value as string, currency));
    expect(error).toBeInstanceOf(CarrierError);
    expect(error).toMatchObject({ code: 'CARRIER_UNKNOWN_ERROR' });
    const text = `${(error as Error).message} ${JSON.stringify(error)} ${JSON.stringify((error as Error).cause)}`;
    if (typeof value === 'string' && value.length > 1) expect(text).not.toContain(value.trim());
    expect((error as Error).cause).toMatchObject({ code: expect.stringMatching(/^(MONEY_INVALID|CURRENCY_UNKNOWN)$/u) });
  });

  it('@property: the minor units of a USD amount round-trip through its two-decimal text', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (amount) => {
        const sign = amount < 0 ? '-' : '';
        const digits = String(Math.abs(amount)).padStart(3, '0');
        const text = `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
        expect(carrierDecimalToMoney(text, 'USD')).toEqual(money(amount, 'USD'));
      }),
      { seed: 8003, numRuns: 1000 },
    );
  });
});
