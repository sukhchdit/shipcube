import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';
import { billableWeight, DEFAULT_BILLABLE_WEIGHT_RULES, isCurrencyCode, isMoneyError, type Money, money, negate } from '@platform/shared';
import fc from 'fast-check';

import { price, PRICING_STEPS, runPricing } from './engine.js';
import { isPricingError, PricingError } from './errors.js';
import { BASE_FREIGHT_CODE, baseFreightStep } from './lines/base-freight.js';
import { marginStep } from './lines/margin.js';
import { applyRate, type Rate } from './rounding.js';
import { appendEntry, appendLine } from './state.js';
import { pricingInput } from './tests/fixtures.js';
import type { ChargeLine, PricingInput, PricingStep } from './types.js';

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
  return isPricingError(error) || isMoneyError(error) ? error.code : undefined;
};

/** A test step: a percentage line of the base freight (the shape the margin step of US-140 takes). */
const rateStep =
  (code: string, source: ChargeLine['source'], rate: Rate): PricingStep =>
  (input, state) => {
    const amount = applyRate(input.carrierQuote.cost, rate);
    const line: ChargeLine = {
      code,
      labelKey: `charges.${code.toLowerCase()}`,
      source,
      amount,
      taxAmount: money(0, amount.currency),
      taxCode: null,
      informational: false,
    };
    return appendLine(state, line, input.request.sellCurrency);
  };

/** Every number anywhere in the tree, with its path. */
function numbersIn(value: unknown, path = '$'): [string, number][] {
  if (typeof value === 'number') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => numbersIn(item, `${path}[${index}]`));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([key, item]) => numbersIn(item, `${path}.${key}`));
  return [];
}

/** Every `{ amount, currency }` object in the tree. */
function moneyIn(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(moneyIn);
  if (typeof value !== 'object' || value === null) return [];
  const own = 'amount' in value && 'currency' in value ? [value] : [];
  return [...own, ...Object.values(value).flatMap(moneyIn)];
}

const arbitraryInput = fc
  .record({
    cost: fc.integer({ min: 0, max: 1e12 }),
    currency: fc.constantFrom('USD', 'INR', 'JPY', 'KWD', 'EUR', 'CLF'),
    bps: fc.integer({ min: -10_000, max: 100_000 }),
    weightG: fc.integer({ min: 1, max: 100_000 }),
    side: fc.integer({ min: 1, max: 1500 }),
  })
  .map(({ cost, currency, bps, weightG, side }) => {
    const packages = [{ weightG, lengthMm: side, widthMm: side, heightMm: side }];
    const input: PricingInput = {
      ...pricingInput(cost, currency),
      request: { sellCurrency: currency, packages, billableWeight: billableWeight(packages, DEFAULT_BILLABLE_WEIGHT_RULES.METRIC) },
    };
    return { input, bps, steps: [baseFreightStep, rateStep('MARGIN', 'MARGIN', { bps })] };
  });

describe('price (US-138)', () => {
  it('prices the base freight as one CARRIER line with exact totals and the billable weight', () => {
    const result = runPricing(pricingInput(2000), [baseFreightStep]);
    expect(PRICING_STEPS).toEqual([baseFreightStep, marginStep]);
    expect(result.lines).toEqual([
      {
        code: BASE_FREIGHT_CODE,
        labelKey: 'charges.base_freight',
        source: 'CARRIER',
        amount: { amount: 2000, currency: 'USD' },
        taxAmount: { amount: 0, currency: 'USD' },
        taxCode: null,
        informational: false,
      },
    ]);
    expect(result.totals).toEqual({
      net: { amount: 2000, currency: 'USD' },
      tax: { amount: 0, currency: 'USD' },
      gross: { amount: 2000, currency: 'USD' },
      discount: { amount: 0, currency: 'USD' },
    });
    expect(result.billableWeight).toEqual({ perPackage: [{ actualG: 2100, volumetricG: 1200, billableG: 2500 }], totalG: 2500 });
    expect(result.explanation).toEqual({
      engineVersion: '1.1.0',
      configVersion: 'seed-2026-11-12',
      entries: [],
      rejectedCandidateCount: 0,
      warnings: [],
    });
    expect(result.sellCurrency).toBe('USD');
  });

  it('returns a deep-frozen result', () => {
    const result = price(pricingInput());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lines[0]?.amount)).toBe(true);
    expect(Object.isFrozen(result.billableWeight.perPackage[0])).toBe(true);
    expect(Object.isFrozen(result.explanation.warnings)).toBe(true);
  });

  describe('[AT-US-138-01] identical inputs give byte-identical output', () => {
    afterEach(() => {
      restoreClockAndRandom();
    });

    it('@property: twice in one process, with the clock, randomness and input key order perturbed', () => {
      fc.assert(
        fc.property(arbitraryInput, ({ input, steps }) => {
          const first = JSON.stringify(runPricing(input, steps));
          stubClockAndRandom();
          const reordered: PricingInput = JSON.parse(
            JSON.stringify({ now: input.now, config: input.config, carrierQuote: input.carrierQuote, request: input.request }),
          ) as PricingInput;
          const second = JSON.stringify(runPricing(reordered, steps));
          restoreClockAndRandom();
          expect(second).toBe(first);
        }),
        { seed: 7608, numRuns: 1000 },
      );
    });

    it('in different processes, time zones and locales, at different wall-clock times', () => {
      const input = pricingInput(123_457, 'INR');
      const child = join(__dirname, 'tests', 'price-child.ts');
      const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const run = (env: Record<string, string>): string => {
        const result = spawnSync(process.execPath, [tsx, '--conditions=@platform/source', child], {
          input: JSON.stringify(input),
          env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
          encoding: 'utf8',
          timeout: 60_000,
          windowsHide: true,
        });
        if (result.error !== undefined) throw result.error;
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        return result.stdout;
      };
      const first = run({ TZ: 'Pacific/Kiritimati', LANG: 'fr_FR.UTF-8' });
      const second = run({ TZ: 'America/Adak', LANG: 'en_US.UTF-8' });
      expect(first).toBe(JSON.stringify(price(input)));
      expect(second).toBe(first);
    }, 120_000);
  });

  it('[AT-US-138-03] @property: a 15 % rule on 1050 gives 158 and a -15 % adjustment gives -158 (halves away from zero)', () => {
    const result = runPricing(pricingInput(1050), [
      baseFreightStep,
      rateStep('MARGIN', 'MARGIN', { bps: 1500 }),
      rateStep('DISCOUNT', 'DISCOUNT', { decimal: '-0.15' }),
    ]);
    expect(result.lines.map((line) => [line.code, line.amount.amount])).toEqual([
      ['BASE_FREIGHT', 1050],
      ['MARGIN', 158],
      ['DISCOUNT', -158],
    ]);
    expect(result.totals.net).toEqual(money(1050, 'USD'));
    expect(result.totals.discount).toEqual(money(158, 'USD'));
    fc.assert(
      fc.property(arbitraryInput, ({ input, steps, bps }) => {
        const { lines, totals } = runPricing(input, steps);
        const base = BigInt(lines[0]?.amount.amount ?? 0);
        const margin = BigInt(lines[1]?.amount.amount ?? 0);
        // The margin is the exact percentage rounded once, halves away from zero.
        const twiceError = 2n * 10_000n * margin - 2n * base * BigInt(bps);
        expect(twiceError <= 10_000n && twiceError >= -10_000n).toBe(true);
        if (twiceError === 10_000n || twiceError === -10_000n) expect(margin * base * BigInt(bps) >= 0n).toBe(true);
        // Sum of lines = net, net + tax = gross: totals are sums of the rounded lines, never re-rounded.
        expect(BigInt(totals.net.amount)).toBe(base + margin);
        expect(totals.gross.amount).toBe(totals.net.amount + totals.tax.amount);
      }),
      { seed: 7609, numRuns: 1000 },
    );
  });

  describe('[AT-US-138-04] no floating point on money', () => {
    const saved = {
      math: { ...Object.getOwnPropertyDescriptors(Math) },
      parseFloat: globalThis.parseFloat,
      toFixed: Number.prototype.toFixed,
    };

    afterEach(() => {
      Object.defineProperties(Math, saved.math);
      globalThis.parseFloat = saved.parseFloat;
      Number.parseFloat = saved.parseFloat;
      Number.prototype.toFixed = saved.toFixed;
    });

    it('@property: with float helpers replaced by failures, every number in the output is a safe integer and every amount has an ISO 4217 code', () => {
      const fail = (): never => {
        throw new Error('floating-point helper used');
      };
      const results = fc.sample(arbitraryInput, { seed: 7610, numRuns: 1000 }).map(({ input, steps }) => {
        for (const name of Object.getOwnPropertyNames(Math)) {
          if (typeof (Math as unknown as Record<string, unknown>)[name] === 'function')
            Object.defineProperty(Math, name, { value: fail, configurable: true });
        }
        globalThis.parseFloat = fail;
        Number.parseFloat = fail;
        Number.prototype.toFixed = fail;
        try {
          return runPricing(input, steps);
        } finally {
          Object.defineProperties(Math, saved.math);
          globalThis.parseFloat = saved.parseFloat;
          Number.parseFloat = saved.parseFloat;
          Number.prototype.toFixed = saved.toFixed;
        }
      });
      for (const result of results) {
        const unsafe = numbersIn(result).filter(([, value]) => !Number.isSafeInteger(value) || Object.is(value, -0));
        expect(unsafe).toEqual([]);
        const amounts = moneyIn(result) as Money[];
        expect(amounts.length).toBeGreaterThanOrEqual(6);
        for (const value of amounts) expect(isCurrencyCode(value.currency) && Number.isSafeInteger(value.amount)).toBe(true);
      }
    });
  });

  it('[AT-US-138-05] @property: a cost in another currency without an FX step throws CURRENCY_MISMATCH', () => {
    expect(codeOf(() => price(pricingInput(1000, 'INR', 'USD')))).toBe('CURRENCY_MISMATCH');
    const foreignStep: PricingStep = (input, state) =>
      appendLine(
        state,
        {
          code: 'FUEL',
          labelKey: 'charges.fuel',
          source: 'FUEL',
          amount: money(10, 'USD'),
          taxAmount: money(0, 'INR'),
          taxCode: null,
          informational: false,
        },
        input.request.sellCurrency,
      );
    expect(codeOf(() => runPricing(pricingInput(1000, 'USD'), [baseFreightStep, foreignStep]))).toBe('CURRENCY_MISMATCH');
    fc.assert(
      fc.property(fc.constantFrom('USD', 'INR', 'JPY', 'EUR'), fc.constantFrom('USD', 'INR', 'JPY', 'EUR'), (cost, sell) => {
        fc.pre(cost !== sell);
        expect(codeOf(() => price(pricingInput(500, cost, sell)))).toBe('CURRENCY_MISMATCH');
      }),
      { seed: 7611, numRuns: 1000 },
    );
  });

  it('[AT-US-138-06] @property: amounts carry each currency exponent (JPY 0, USD 2, KWD 3)', () => {
    const jpy = runPricing(pricingInput(1050, 'JPY'), [baseFreightStep, rateStep('MARGIN', 'MARGIN', { bps: 1500 })]);
    expect(jpy.lines.map((line) => line.amount)).toEqual([money(1050, 'JPY'), money(158, 'JPY')]);
    const kwd = runPricing(pricingInput(1050, 'KWD'), [baseFreightStep, rateStep('MARGIN', 'MARGIN', { bps: 1500 })]);
    expect(kwd.totals.net).toEqual(money(1208, 'KWD'));
    fc.assert(
      fc.property(arbitraryInput, ({ input, steps }) => {
        const result = runPricing(input, steps);
        for (const value of moneyIn(result) as Money[]) expect(value.currency).toBe(input.request.sellCurrency);
      }),
      { seed: 7612, numRuns: 1000 },
    );
  });

  it('records explanation entries, warnings and the discount total from the steps', () => {
    const explained: PricingStep = (_input, state) => ({
      ...appendEntry(state, {
        ruleType: 'MARGIN',
        ruleKey: 'm-01',
        configVersion: 'v1',
        outcome: 'FIRED',
        inputs: { bps: 1500 },
        effectMinor: 158,
      }),
      rejectedCandidateCount: 2,
      warnings: ['FUEL_NONE'],
    });
    const result = runPricing(pricingInput(1000), [baseFreightStep, rateStep('COUPON', 'COUPON', { bps: -1000 }), explained]);
    expect(result.explanation.entries).toEqual([
      { ruleType: 'MARGIN', ruleKey: 'm-01', configVersion: 'v1', outcome: 'FIRED', inputs: { bps: 1500 }, effectMinor: 158 },
    ]);
    expect(result.explanation.rejectedCandidateCount).toBe(2);
    expect(result.explanation.warnings).toEqual(['FUEL_NONE']);
    expect(result.totals.discount).toEqual(negate(money(-100, 'USD')));
    expect(result.totals.net).toEqual(money(900, 'USD'));
  });

  it('re-validates lines and entries a step leaves in the state', () => {
    const raw =
      (line: Partial<ChargeLine>): PricingStep =>
      (_input, state) => ({
        ...state,
        lines: [
          ...state.lines,
          {
            code: 'X',
            labelKey: 'k',
            source: 'FUEL',
            amount: money(1, 'USD'),
            taxAmount: money(0, 'USD'),
            taxCode: null,
            informational: false,
            ...line,
          },
        ],
      });
    expect(codeOf(() => runPricing(pricingInput(), [raw({ amount: { amount: 1.5, currency: 'USD' } as Money })]))).toBe('MONEY_INVALID');
    expect(codeOf(() => runPricing(pricingInput(), [raw({ code: 'lower' })]))).toBe('PRICING_INPUT_INVALID');
    expect(codeOf(() => runPricing(pricingInput(), [raw({ source: 'OTHER' as ChargeLine['source'] })]))).toBe('PRICING_INPUT_INVALID');
    expect(codeOf(() => runPricing(pricingInput(), [raw({ labelKey: '' })]))).toBe('PRICING_INPUT_INVALID');
    const badEntry: PricingStep = (_input, state) =>
      appendEntry(state, { ruleType: 'FX', ruleKey: 'fx', configVersion: 'v1', outcome: 'FIRED', inputs: {}, effectMinor: 0.5 });
    expect(codeOf(() => runPricing(pricingInput(), [badEntry]))).toBe('MONEY_INVALID');
  });

  it.each<[string, (input: PricingInput) => PricingInput, string]>([
    ['an empty configuration version', (input) => ({ ...input, config: { ...input.config, version: '' } }), 'PRICING_CONFIG_INVALID'],
    ['a local time instead of UTC', (input) => ({ ...input, now: '2026-11-12T10:00:00+01:00' }), 'PRICING_INPUT_INVALID'],
    ['an unknown sell currency', (input) => ({ ...input, request: { ...input.request, sellCurrency: 'ABC' } }), 'CURRENCY_UNKNOWN'],
    [
      'a RATE_CARD cost source',
      (input) => ({ ...input, carrierQuote: { ...input.carrierQuote, source: 'RATE_CARD' } }),
      'COST_SOURCE_NOT_SUPPORTED',
    ],
    [
      'an unknown cost source',
      (input) => ({ ...input, carrierQuote: { ...input.carrierQuote, source: 'GUESS' as 'LIVE' } }),
      'PRICING_INPUT_INVALID',
    ],
    ['no carrier code', (input) => ({ ...input, carrierQuote: { ...input.carrierQuote, carrierCode: '' } }), 'PRICING_INPUT_INVALID'],
    ['no service code', (input) => ({ ...input, carrierQuote: { ...input.carrierQuote, serviceCode: '' } }), 'PRICING_INPUT_INVALID'],
    [
      'a float cost',
      (input) => ({ ...input, carrierQuote: { ...input.carrierQuote, cost: { amount: 10.5, currency: 'USD' } as Money } }),
      'MONEY_INVALID',
    ],
    [
      'a negative cost',
      (input) => ({ ...input, carrierQuote: { ...input.carrierQuote, cost: money(-1, 'USD') } }),
      'PRICING_INPUT_INVALID',
    ],
  ])('refuses %s', (_name, change, code) => {
    expect(codeOf(() => price(change(pricingInput())))).toBe(code);
  });

  it('prices a zero cost to zero totals, never negative', () => {
    expect(price(pricingInput(0)).totals.gross).toEqual(money(0, 'USD'));
    expect(new PricingError('PRICING_INPUT_INVALID').message).toBe('PRICING_INPUT_INVALID');
  });
});

// Clock and randomness stubs for AT-US-138-01: the engine must not read them.
const originals = { now: Date.now, random: Math.random };
function stubClockAndRandom(): void {
  Date.now = () => 4_102_444_800_000;
  Math.random = () => 0.999;
}
function restoreClockAndRandom(): void {
  Date.now = originals.now;
  Math.random = originals.random;
}
