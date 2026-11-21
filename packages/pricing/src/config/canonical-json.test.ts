import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isPricingError } from '../errors.js';
import { canonicalJson } from './canonical-json.js';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return isPricingError(error) ? error.code : 'OTHER';
  }
  return undefined;
}

describe('canonicalJson (R1-m2, D-TASK080-15)', () => {
  it('sorts object keys at every depth, keeps array order and writes no white space', () => {
    const value = { b: 1, a: { d: [3, { z: true, y: null }], c: 'x' }, A: -0.5 };
    expect(canonicalJson(value)).toBe('{"A":-0.5,"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}');
    expect(canonicalJson(Object.create(null) as object)).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
    const separator = `a"${String.fromCharCode(0x2028)}`;
    expect(canonicalJson(separator)).toBe(JSON.stringify(separator));
  });

  it('a copy with its keys inserted in another order has the same text', () => {
    const forward = { version: 'v', marginRules: [{ ruleKey: 'k', rate: { bps: 1 }, priority: 0 }] };
    const reversed = { marginRules: [{ priority: 0, rate: { bps: 1 }, ruleKey: 'k' }], version: 'v' };
    expect(canonicalJson(reversed)).toBe(canonicalJson(forward));
  });

  it('orders integer-like keys as text too (JSON.stringify would put them first)', () => {
    expect(canonicalJson({ '': '', 10: 1, 9: 2, a: 3 })).toBe('{"":"","10":1,"9":2,"a":3}');
  });

  it('@property: any JSON value parses back to itself, and a copy with reversed key insertion has the same text', () => {
    const reversedCopy = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversedCopy);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, member]) => [key, reversedCopy(member)]),
      );
    };
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonicalJson(value);
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
        expect(canonicalJson(reversedCopy(value))).toBe(text);
      }),
      { seed: 8015, numRuns: 1000 },
    );
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['a member that is undefined', { a: undefined }],
    ['a hole in an array', new Array<number>(2)],
    ['a function', () => 1],
    ['a bigint', 1n],
    ['a symbol', Symbol('s')],
    ['NaN', Number.NaN],
    ['Infinity', { rate: Number.POSITIVE_INFINITY }],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a class instance', new (class Rule {})()],
  ])('refuses %s with PRICING_CONFIG_INVALID', (_name, value) => {
    expect(codeOf(() => canonicalJson(value))).toBe('PRICING_CONFIG_INVALID');
  });
});
