/**
 * Pricing state helpers for steps (ADR-0015 §2; TASK-076). A step returns a new state built with these helpers, which
 * enforce the line invariants at the point a line is created: integer minor units (`isMoney`), the sell currency for
 * both the amount and the tax amount (CURRENCY_MISMATCH otherwise: a cost in another currency needs the FX step
 * first), a well-formed code and a frozen copy with a fixed key order.
 */
import { assertCurrencyCode, assertSameCurrency, isMoney, MoneyError, zero } from '@platform/shared';

import { PricingError } from './errors.js';
import { LINE_SOURCES, type ChargeLine, type ExplanationEntry, type PricingState } from './types.js';

const LINE_CODE = /^[A-Z][A-Z0-9_]*$/u;

export const EMPTY_STATE: PricingState = Object.freeze({
  lines: Object.freeze([]),
  entries: Object.freeze([]),
  rejectedCandidateCount: 0,
  warnings: Object.freeze([]),
});

/** A validated, frozen copy of the line in the sell currency. */
export function chargeLine(line: ChargeLine, sellCurrency: string): ChargeLine {
  const sell = zero(assertCurrencyCode(sellCurrency));
  if (!isMoney(line.amount) || !isMoney(line.taxAmount)) {
    throw new MoneyError('MONEY_INVALID', `line ${line.code}: amounts must be integer minor units with an ISO 4217 code`);
  }
  assertSameCurrency(sell, line.amount);
  assertSameCurrency(sell, line.taxAmount);
  if (!LINE_CODE.test(line.code) || !(LINE_SOURCES as readonly string[]).includes(line.source) || line.labelKey.length === 0) {
    throw new PricingError('PRICING_INPUT_INVALID', 'charge line needs an upper-case code, a known source and a label key');
  }
  return Object.freeze({
    code: line.code,
    labelKey: line.labelKey,
    source: line.source,
    amount: Object.freeze({ amount: line.amount.amount, currency: line.amount.currency }),
    taxAmount: Object.freeze({ amount: line.taxAmount.amount, currency: line.taxAmount.currency }),
    taxCode: line.taxCode,
    informational: line.informational,
  });
}

/** The state with the line appended. */
export function appendLine(state: PricingState, line: ChargeLine, sellCurrency: string): PricingState {
  return Object.freeze({ ...state, lines: Object.freeze([...state.lines, chargeLine(line, sellCurrency)]) });
}

/** A validated, frozen copy of the explanation entry with a fixed key order. */
export function explanationEntry(entry: ExplanationEntry): ExplanationEntry {
  if (!Number.isSafeInteger(entry.effectMinor)) {
    throw new MoneyError('MONEY_INVALID', `explanation ${entry.ruleKey}: effect must be integer minor units`);
  }
  return Object.freeze({
    ruleType: entry.ruleType,
    ruleKey: entry.ruleKey,
    configVersion: entry.configVersion,
    outcome: entry.outcome,
    inputs: Object.freeze({ ...entry.inputs }),
    effectMinor: entry.effectMinor,
  });
}

/** The state with the explanation entry appended. */
export function appendEntry(state: PricingState, entry: ExplanationEntry): PricingState {
  return Object.freeze({ ...state, entries: Object.freeze([...state.entries, explanationEntry(entry)]) });
}
