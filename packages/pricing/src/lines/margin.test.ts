import { describe, expect, it } from '@jest/globals';
import { isMoneyError, money } from '@platform/shared';
import fc from 'fast-check';

import { price, runPricing } from '../engine.js';
import { isPricingError } from '../errors.js';
import { DEFAULT_RULE, pricingInput } from '../tests/fixtures.js';
import type { MarginRule, PricingInput } from '../types.js';
import { baseFreightStep } from './base-freight.js';
import { compareMarginRules, MARGIN_CODE, MARGIN_LABEL_KEY, marginRules, marginStep, selectMarginRule } from './margin.js';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return isPricingError(error) || isMoneyError(error) ? error.code : 'OTHER';
  }
  return undefined;
}

const rule = (overrides: Partial<MarginRule>): MarginRule => ({ ...DEFAULT_RULE, isDefault: false, priority: 0, ...overrides });
const withConfig = (input: PricingInput, marginRulesValue: unknown): PricingInput =>
  ({ ...input, config: { version: input.config.version, marginRules: marginRulesValue } }) as PricingInput;

describe('default margin pricing (US-140)', () => {
  it('[AT-US-140-01] Mock cost 2000 USD with only the default rule: CARRIER 2000, MARGIN 300, net 2300 USD', () => {
    const result = price(pricingInput(2000));
    expect(result.lines.map((line) => [line.code, line.source, line.amount])).toEqual([
      ['BASE_FREIGHT', 'CARRIER', money(2000, 'USD')],
      [MARGIN_CODE, 'MARGIN', money(300, 'USD')],
    ]);
    expect(result.totals.net).toEqual(money(2300, 'USD'));
    expect(result.totals.gross).toEqual(money(2300, 'USD'));
    expect(result.explanation.entries).toEqual([
      {
        ruleType: 'MARGIN',
        ruleKey: 'default-margin',
        configVersion: 'seed-2026-11-12',
        outcome: 'FIRED',
        inputs: { carrierCode: null, serviceCode: null, priority: -1000, isDefault: true, rateBps: 1500, rateDecimal: null },
        effectMinor: 300,
      },
    ]);
    expect(result.explanation.rejectedCandidateCount).toBe(0);
  });

  it('[AT-US-140-02] every line has code, label key, amount, currency, tax amount, tax code and source', () => {
    const { lines } = price(pricingInput(2000));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(['amount', 'code', 'informational', 'labelKey', 'source', 'taxAmount', 'taxCode']);
      expect(line.code).toMatch(/^[A-Z][A-Z0-9_]*$/u);
      expect(line.labelKey).toMatch(/^charges\.[a-z_]+$/u);
      expect(line.amount.currency).toBe('USD');
      expect(line.taxAmount).toEqual(money(0, 'USD'));
      expect(line.taxCode).toBeNull();
    }
    expect(lines[1]?.labelKey).toBe(MARGIN_LABEL_KEY);
  });

  describe('[AT-US-140-03] a configuration without a default margin rule fails with PRICING_CONFIG_INVALID', () => {
    it.each<[string, unknown]>([
      ['no rules at all', []],
      ['only a carrier rule', [rule({ ruleKey: 'mock-10', carrierCode: 'MOCK', rate: { bps: 1000 } })]],
      ['no marginRules array', undefined],
      ['marginRules not an array', { 0: DEFAULT_RULE }],
      ['two default rules', [DEFAULT_RULE, { ...DEFAULT_RULE, ruleKey: 'default-2' }]],
    ])('%s', (_name, rules) => {
      expect(codeOf(() => price(withConfig(pricingInput(2000), rules)))).toBe('PRICING_CONFIG_INVALID');
    });
  });

  it('[AT-US-140-04] zero carrier cost: the margin line is 0 and the total is 0, not negative', () => {
    const result = price(pricingInput(0));
    expect(result.lines[1]).toMatchObject({ code: MARGIN_CODE, amount: money(0, 'USD') });
    expect(result.totals.net).toEqual(money(0, 'USD'));
    expect(result.totals.gross).toEqual(money(0, 'USD'));
  });

  it('[AT-US-140-05] a rule for carrier MOCK with 10 % overrides the default: the margin is 200, not 300', () => {
    const mock = rule({ ruleKey: 'mock-10', carrierCode: 'MOCK', rate: { bps: 1000 } });
    const result = price(pricingInput(2000, 'USD', 'USD', [DEFAULT_RULE, mock]));
    expect(result.lines[1]?.amount).toEqual(money(200, 'USD'));
    expect(result.totals.net).toEqual(money(2200, 'USD'));
    expect(result.explanation.entries[0]).toMatchObject({ ruleKey: 'mock-10', effectMinor: 200 });
    // The default matched too and lost: one rejected candidate.
    expect(result.explanation.rejectedCandidateCount).toBe(1);
    // A rule for another carrier does not match: the default applies.
    const otherCarrier = rule({ ruleKey: 'dhl-5', carrierCode: 'DHL_EXPRESS', rate: { bps: 500 } });
    expect(price(pricingInput(2000, 'USD', 'USD', [DEFAULT_RULE, otherCarrier])).lines[1]?.amount).toEqual(money(300, 'USD'));
  });
});

describe('margin rule selection (DR-B08, M0 subset)', () => {
  const input = pricingInput(2000);

  it('prefers higher priority, then a service match over a carrier match, then the lower rule key', () => {
    const carrier = rule({ ruleKey: 'b-carrier', carrierCode: 'MOCK' });
    const service = rule({ ruleKey: 'c-service', serviceCode: 'MOCK_EXPRESS' });
    const both = rule({ ruleKey: 'd-both', carrierCode: 'MOCK', serviceCode: 'MOCK_EXPRESS' });
    const urgent = rule({ ruleKey: 'z-urgent', priority: 10 });
    const twin = rule({ ruleKey: 'a-carrier', carrierCode: 'MOCK' });
    expect(selectMarginRule([DEFAULT_RULE, carrier, service, urgent], input).rule.ruleKey).toBe('z-urgent');
    expect(selectMarginRule([DEFAULT_RULE, carrier, service], input).rule.ruleKey).toBe('c-service');
    expect(selectMarginRule([DEFAULT_RULE, service, both], input).rule.ruleKey).toBe('d-both');
    expect(selectMarginRule([DEFAULT_RULE, carrier, twin], input)).toEqual({ rule: twin, rejected: 2 });
    expect(compareMarginRules(twin, twin)).toBe(0);
    expect(compareMarginRules(carrier, twin)).toBe(1);
    expect(compareMarginRules(twin, carrier)).toBe(-1);
  });

  it('ignores rules for another service', () => {
    const otherService = rule({ ruleKey: 'economy', serviceCode: 'MOCK_ECONOMY', priority: 99 });
    expect(selectMarginRule([DEFAULT_RULE, otherService], input)).toEqual({ rule: DEFAULT_RULE, rejected: 0 });
  });

  it('accepts a decimal rate and reports it in the explanation', () => {
    const decimal = rule({ ruleKey: 'mock-dec', carrierCode: 'MOCK', rate: { decimal: '0.125' } });
    const result = price(pricingInput(2000, 'USD', 'USD', [DEFAULT_RULE, decimal]));
    expect(result.lines[1]?.amount).toEqual(money(250, 'USD'));
    expect(result.explanation.entries[0]?.inputs).toMatchObject({ rateBps: null, rateDecimal: '0.125' });
  });

  it('@property: the selection does not depend on the order of the rules', () => {
    const arbitraryRule = fc.record({
      ruleKey: fc.string({ minLength: 1, maxLength: 6 }),
      priority: fc.integer({ min: -2000, max: 2000 }),
      carrierCode: fc.constantFrom(null, 'MOCK', 'DHL_EXPRESS'),
      serviceCode: fc.constantFrom(null, 'MOCK_EXPRESS', 'MOCK_ECONOMY'),
      bps: fc.integer({ min: 0, max: 10_000 }),
    });
    const arbitraryRules = fc
      .uniqueArray(arbitraryRule, { selector: (item) => item.ruleKey, maxLength: 8 })
      .map((raw): MarginRule[] => [
        DEFAULT_RULE,
        ...raw
          .filter((item) => item.ruleKey !== DEFAULT_RULE.ruleKey)
          .map(({ bps, ...rest }) => ({ ...rest, rate: { bps }, isDefault: false })),
      ])
      .chain((rules) => fc.tuple(fc.constant(rules), fc.shuffledSubarray(rules, { minLength: rules.length, maxLength: rules.length })));
    fc.assert(
      fc.property(arbitraryRules, ([rules, shuffled]) => {
        expect(selectMarginRule(rules, input)).toEqual(selectMarginRule(shuffled, input));
      }),
      { seed: 8001, numRuns: 1000 },
    );
  });

  it('@property: the margin is the default rate of the base freight, rounded once, never negative, and lines sum to net', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.integer({ min: 0, max: 100_000 }), (cost, bps) => {
        const result = price(pricingInput(cost, 'USD', 'USD', [{ ...DEFAULT_RULE, rate: { bps } }]));
        const margin = BigInt(result.lines[1]?.amount.amount ?? -1);
        const twiceError = 2n * 10_000n * margin - 2n * BigInt(cost) * BigInt(bps);
        expect(margin >= 0n).toBe(true);
        expect(twiceError <= 10_000n && twiceError >= -10_000n).toBe(true);
        expect(BigInt(result.totals.net.amount)).toBe(BigInt(cost) + margin);
      }),
      { seed: 8002, numRuns: 1000 },
    );
  });
});

describe('margin rule validation (PRICING_CONFIG_INVALID)', () => {
  const input = pricingInput(2000);
  it.each<[string, unknown]>([
    ['an empty rule key', { ...DEFAULT_RULE, ruleKey: '' }],
    ['a fractional priority', { ...DEFAULT_RULE, priority: 1.5 }],
    ['an empty carrier code', { ...rule({ ruleKey: 'x' }), carrierCode: '' }],
    ['a non-boolean isDefault', { ...rule({ ruleKey: 'x' }), isDefault: 'yes' }],
    ['a negative rate', { ...rule({ ruleKey: 'x' }), rate: { bps: -1 } }],
    ['a negative decimal rate', { ...rule({ ruleKey: 'x' }), rate: { decimal: '-0.01' } }],
    ['a rate with both keys', { ...rule({ ruleKey: 'x' }), rate: { bps: 1, decimal: '0.1' } }],
    ['a rate with neither key', { ...rule({ ruleKey: 'x' }), rate: {} }],
    ['a rate that is not an object', { ...rule({ ruleKey: 'x' }), rate: 1500 }],
    ['a fractional bps', { ...rule({ ruleKey: 'x' }), rate: { bps: 0.5 } }],
    ['an inherited rule key', Object.create({ ruleKey: 'x' }) as unknown],
    ['a default rule with another priority', { ...DEFAULT_RULE, ruleKey: 'd2', priority: 0 }],
    ['a default rule with a carrier', { ...DEFAULT_RULE, ruleKey: 'd2', carrierCode: 'MOCK' }],
    ['a default rule with a service', { ...DEFAULT_RULE, ruleKey: 'd2', serviceCode: 'MOCK_EXPRESS' }],
  ])('refuses %s', (_name, bad) => {
    const rules = (bad as { isDefault?: unknown }).isDefault === true ? [bad] : [DEFAULT_RULE, bad];
    expect(codeOf(() => price(withConfig(input, rules)))).toBe('PRICING_CONFIG_INVALID');
  });

  it('refuses duplicate rule keys', () => {
    expect(codeOf(() => marginRules({ marginRules: [DEFAULT_RULE, rule({ ruleKey: DEFAULT_RULE.ruleKey })] }))).toBe(
      'PRICING_CONFIG_INVALID',
    );
  });

  it('returns frozen copies, read once from own properties', () => {
    let reads = 0;
    const flipping = {
      ...DEFAULT_RULE,
      get rate() {
        reads += 1;
        return reads === 1 ? { bps: 1500 } : { bps: 9_999_999 };
      },
    };
    const [copy] = marginRules({ marginRules: [flipping] });
    expect(copy?.rate).toEqual({ bps: 1500 });
    expect(reads).toBe(1);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy?.rate)).toBe(true);
  });

  it('needs the base freight line before it', () => {
    expect(codeOf(() => runPricing(input, [marginStep]))).toBe('PRICING_INPUT_INVALID');
    expect(runPricing(input, [baseFreightStep, marginStep]).lines).toHaveLength(2);
  });

  it('refuses a selection over rules none of which match (defensive: the default always matches)', () => {
    expect(codeOf(() => selectMarginRule([rule({ ruleKey: 'dhl', carrierCode: 'DHL_EXPRESS' })], input))).toBe('PRICING_CONFIG_INVALID');
  });
});
