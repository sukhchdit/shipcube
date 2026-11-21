// Test inputs for the pricing engine (TASK-076). Synthetic values only.
import { billableWeight, DEFAULT_BILLABLE_WEIGHT_RULES, money, normalisePackage } from '@platform/shared';

import type { PricingInput } from '../types.js';

/** A one-package USD input with a LIVE carrier cost of `cost` minor units. */
export function pricingInput(cost = 1050, currency = 'USD', sellCurrency = currency): PricingInput {
  const packages = [normalisePackage({ unitSystem: 'METRIC', weight: '2.1', length: 30, width: 20, height: 10 })];
  return {
    request: { sellCurrency, packages, billableWeight: billableWeight(packages, DEFAULT_BILLABLE_WEIGHT_RULES.METRIC) },
    carrierQuote: { source: 'LIVE', carrierCode: 'MOCK', serviceCode: 'MOCK_EXPRESS', cost: money(cost, currency) },
    config: { version: 'seed-2026-11-12' },
    now: '2026-11-12T10:00:00Z',
  };
}
