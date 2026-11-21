// Test inputs for the pricing engine (TASK-076). Synthetic values only.
import { billableWeight, DEFAULT_BILLABLE_WEIGHT_RULES, money, normalisePackage } from '@platform/shared';

import type { MarginRule, PricingInput } from '../types.js';

/** The seeded default margin rule shape (A-060): 15 %, priority -1000, every dimension null. */
export const DEFAULT_RULE: MarginRule = {
  ruleKey: 'default-margin',
  priority: -1000,
  carrierCode: null,
  serviceCode: null,
  rate: { bps: 1500 },
  isDefault: true,
};

/** A one-package USD input with a LIVE MOCK/MOCK_EXPRESS carrier cost of `cost` minor units and `rules` as margin rules. */
export function pricingInput(
  cost = 1050,
  currency = 'USD',
  sellCurrency = currency,
  rules: readonly MarginRule[] = [DEFAULT_RULE],
): PricingInput {
  const packages = [normalisePackage({ unitSystem: 'METRIC', weight: '2.1', length: 30, width: 20, height: 10 })];
  return {
    request: { sellCurrency, packages, billableWeight: billableWeight(packages, DEFAULT_BILLABLE_WEIGHT_RULES.METRIC) },
    carrierQuote: { source: 'LIVE', carrierCode: 'MOCK', serviceCode: 'MOCK_EXPRESS', cost: money(cost, currency) },
    config: { version: 'seed-2026-11-12', marginRules: rules },
    now: '2026-11-12T10:00:00Z',
  };
}
