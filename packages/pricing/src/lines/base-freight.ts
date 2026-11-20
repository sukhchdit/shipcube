/**
 * Base freight line (ADR-0015 §2 step 1; openapi `ChargeLine` example; TASK-076): the carrier cost as the first line,
 * source CARRIER. The cost must already be in the sell currency: until the FX step lands (US-148, TASK-133) a cost in
 * another currency fails with CURRENCY_MISMATCH rather than being converted implicitly (AT-US-138-05). Tax is zero
 * until the tax step (US-147) sets it per line.
 */
import { zero } from '@platform/shared';

import { appendLine } from '../state.js';
import type { PricingStep } from '../types.js';

export const BASE_FREIGHT_CODE = 'BASE_FREIGHT';
export const BASE_FREIGHT_LABEL_KEY = 'charges.base_freight';

export const baseFreightStep: PricingStep = (input, state) => {
  const { cost } = input.carrierQuote;
  return appendLine(
    state,
    {
      code: BASE_FREIGHT_CODE,
      labelKey: BASE_FREIGHT_LABEL_KEY,
      source: 'CARRIER',
      amount: cost,
      taxAmount: zero(cost.currency),
      taxCode: null,
      informational: false,
    },
    input.request.sellCurrency,
  );
};
