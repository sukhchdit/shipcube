// Code review R1-m3, PR076-SEC-04 and PR076-SEC-05: what reaches the stored snapshot is re-validated at runtime.
import { describe, expect, it } from '@jest/globals';
import { isMoneyError, money } from '@platform/shared';

import { runPricing } from './engine.js';
import { isPricingError } from './errors.js';
import { baseFreightStep } from './lines/base-freight.js';
import { chargeLine, explanationEntry } from './state.js';
import { pricingInput } from './tests/fixtures.js';
import type { ChargeLine, ExplanationEntry, PricingState, PricingStep } from './types.js';

const LINE: ChargeLine = {
  code: 'FUEL',
  labelKey: 'charges.fuel',
  source: 'FUEL',
  amount: money(10, 'USD'),
  taxAmount: money(0, 'USD'),
  taxCode: null,
  informational: false,
};
const ENTRY: ExplanationEntry = {
  ruleType: 'FUEL',
  ruleKey: 'fuel-01',
  configVersion: 'v1',
  outcome: 'FIRED',
  inputs: { bps: 1500 },
  effectMinor: 10,
};

function thrown(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected an Error');
}

const codeOf = (run: () => unknown): string => {
  const error = thrown(run);
  return isPricingError(error) || isMoneyError(error) ? error.code : `raw ${error.name}`;
};

/** A step that leaves a raw (unvalidated) state behind, as a buggy step could. */
const rawState =
  (change: Partial<PricingState>): PricingStep =>
  (_input, state) => ({ ...state, ...change });

describe('[R1-m3] chargeLine re-validates every field of a line', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['a tax code object', { taxCode: { a: 1.5 } }, 'PRICING_INPUT_INVALID'],
    ['an empty tax code', { taxCode: '' }, 'PRICING_INPUT_INVALID'],
    ['a non-boolean informational', { informational: 'no' }, 'PRICING_INPUT_INVALID'],
    ['a missing label key (was a raw TypeError)', { labelKey: undefined }, 'PRICING_INPUT_INVALID'],
    ['a non-string code', { code: 7 }, 'PRICING_INPUT_INVALID'],
    ['a non-Money tax amount', { taxAmount: { amount: '0', currency: 'USD' } }, 'MONEY_INVALID'],
  ])('refuses %s', (_name, change, code) => {
    expect(codeOf(() => chargeLine({ ...LINE, ...change }, 'USD'))).toBe(code);
  });

  it('accepts a non-empty tax code and copies the line into frozen own data', () => {
    const line = chargeLine({ ...LINE, taxCode: 'ZERO_EXPORT', informational: true }, 'USD');
    expect(line).toEqual({ ...LINE, taxCode: 'ZERO_EXPORT', informational: true });
    expect(Object.isFrozen(line.amount)).toBe(true);
  });

  it('[PR076-SEC-04] puts a code in a message only after it is validated', () => {
    const error = thrown(() => chargeLine({ ...LINE, code: 'BAD\nuser@example.invalid' }, 'USD'));
    expect(error.message).not.toContain('example');
    expect(error.message).not.toContain('\n');
    expect(thrown(() => explanationEntry({ ...ENTRY, ruleKey: '' })).message).toBe('explanation rule key must be a non-empty string');
  });

  it('[PR076-SEC-03] ignores inherited fields', () => {
    const inherited = Object.assign(Object.create({ labelKey: 'charges.fuel' }) as object, { ...LINE, labelKey: undefined });
    expect(codeOf(() => chargeLine(inherited as ChargeLine, 'USD'))).toBe('PRICING_INPUT_INVALID');
  });

  it('refuses a line or an entry that is not an object with PRICING_INPUT_INVALID, never a raw TypeError', () => {
    expect(codeOf(() => chargeLine(null as unknown as ChargeLine, 'USD'))).toBe('PRICING_INPUT_INVALID');
    expect(codeOf(() => explanationEntry(undefined as unknown as ExplanationEntry))).toBe('PRICING_INPUT_INVALID');
  });
});

describe('[R1-m3] explanationEntry re-validates every field of an entry', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['an unknown rule type', { ruleType: 'BONUS' }, 'PRICING_INPUT_INVALID'],
    ['an unknown outcome', { outcome: 'MAYBE' }, 'PRICING_INPUT_INVALID'],
    ['an empty configuration version', { configVersion: '' }, 'PRICING_INPUT_INVALID'],
    ['inputs that are not an object', { inputs: ['a'] }, 'PRICING_INPUT_INVALID'],
    ['an object input value (would stay mutable)', { inputs: { nested: { a: 1 } } }, 'PRICING_INPUT_INVALID'],
    ['a non-finite input value', { inputs: { rate: Number.POSITIVE_INFINITY } }, 'PRICING_INPUT_INVALID'],
    ['a fractional effect', { effectMinor: 0.5 }, 'MONEY_INVALID'],
  ])('refuses %s', (_name, change, code) => {
    expect(codeOf(() => explanationEntry({ ...ENTRY, ...change }))).toBe(code);
  });

  it('copies inputs of every allowed kind into a frozen object', () => {
    const entry = explanationEntry({ ...ENTRY, inputs: { a: 'x', b: true, c: null, d: 1.5 } });
    expect(entry.inputs).toEqual({ a: 'x', b: true, c: null, d: 1.5 });
    expect(Object.isFrozen(entry.inputs)).toBe(true);
  });

  it('[PR076-SEC-05] reads effectMinor once: an accessor cannot pass the check with one value and copy another', () => {
    let reads = 0;
    const tricky = Object.defineProperty({ ...ENTRY }, 'effectMinor', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? 1 : 0.5;
      },
    });
    const result = runPricing(pricingInput(), [baseFreightStep, rawState({ entries: [tricky] })]);
    expect(result.explanation.entries[0]?.effectMinor).toBe(1);
    expect(reads).toBe(1);
  });
});

describe('[R1-m3] runPricing validates the counts and warnings a step leaves', () => {
  it.each<[string, Partial<PricingState>]>([
    ['a negative rejected-candidate count', { rejectedCandidateCount: -1 }],
    ['a fractional rejected-candidate count', { rejectedCandidateCount: 1.5 }],
    ['an unknown warning', { warnings: ['FX_STALE', 'NOPE'] as unknown as PricingState['warnings'] }],
    ['warnings that are not an array', { warnings: 'FX_STALE' as unknown as PricingState['warnings'] }],
  ])('refuses %s with PRICING_INPUT_INVALID', (_name, change) => {
    expect(codeOf(() => runPricing(pricingInput(), [baseFreightStep, rawState(change)]))).toBe('PRICING_INPUT_INVALID');
  });

  it('copies valid warnings into a frozen list', () => {
    const result = runPricing(pricingInput(), [baseFreightStep, rawState({ rejectedCandidateCount: 3, warnings: ['FX_STALE'] })]);
    expect(result.explanation.rejectedCandidateCount).toBe(3);
    expect(result.explanation.warnings).toEqual(['FX_STALE']);
    expect(Object.isFrozen(result.explanation.warnings)).toBe(true);
  });
});
