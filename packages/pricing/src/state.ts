/**
 * Pricing state helpers for steps (ADR-0015 §2; TASK-076; code review R1-m3, PR076-SEC-03..05). A step returns a new
 * state built with these helpers; the engine runs every line and entry through them again before the result is built,
 * so whatever reaches the stored price snapshot (REQ-PRICE-017) is checked at runtime, not only by the types:
 *
 *  - each field is read **once**, from an own property (no inherited value), into a copy; the copy is validated and
 *    frozen, so an accessor cannot answer one value to the check and another to the copy;
 *  - lines: an upper-case code, a non-empty label key, a known source, integer minor units in the sell currency for the
 *    amount and the tax amount (CURRENCY_MISMATCH otherwise: a cost in another currency needs the FX step first), a
 *    tax code that is null or a non-empty string, a boolean `informational`;
 *  - entries: a known rule type and outcome, non-empty rule key and configuration version, integer `effectMinor`, and
 *    `inputs` whose own values are strings, booleans, null or finite numbers;
 *  - a code or key appears in an error message only after it has been validated.
 */
import { assertCurrencyCode, assertSameCurrency, isMoney, type Money, MoneyError, zero } from '@platform/shared';

import { PricingError } from './errors.js';
import {
  type ChargeLine,
  type ExplanationEntry,
  type ExplanationInput,
  LINE_SOURCES,
  PRICING_WARNINGS,
  type PricingState,
  type PricingWarning,
  RULE_TYPES,
} from './types.js';

const LINE_CODE = /^[A-Z][A-Z0-9_]*$/u;
const OUTCOMES: readonly string[] = ['FIRED', 'REJECTED'];

export const EMPTY_STATE: PricingState = Object.freeze({
  lines: Object.freeze([]),
  entries: Object.freeze([]),
  rejectedCandidateCount: 0,
  warnings: Object.freeze([]),
});

/** The own property of `value`, read once; undefined when it is missing or inherited. */
function own(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function invalid(message: string): never {
  throw new PricingError('PRICING_INPUT_INVALID', message);
}

/** A frozen copy of an own-property Money, or MONEY_INVALID. */
function moneyCopy(value: unknown, what: string): Money {
  const copy = { amount: own(value, 'amount'), currency: own(value, 'currency') };
  if (!isMoney(copy)) throw new MoneyError('MONEY_INVALID', `${what} must be integer minor units with an ISO 4217 code`);
  return Object.freeze(copy);
}

/** A validated, frozen copy of the line in the sell currency. */
export function chargeLine(line: ChargeLine, sellCurrency: string): ChargeLine {
  const sell = zero(assertCurrencyCode(sellCurrency));
  const code = own(line, 'code');
  if (typeof code !== 'string' || !LINE_CODE.test(code)) invalid('charge line code must match ^[A-Z][A-Z0-9_]*$');
  const labelKey = own(line, 'labelKey');
  const source = own(line, 'source');
  const taxCode = own(line, 'taxCode');
  const informational = own(line, 'informational');
  if (!isNonEmptyString(labelKey)) invalid(`line ${code}: label key must be a non-empty string`);
  if (typeof source !== 'string' || !(LINE_SOURCES as readonly string[]).includes(source)) invalid(`line ${code}: unknown source`);
  if (!(taxCode === null || isNonEmptyString(taxCode))) invalid(`line ${code}: tax code must be null or a non-empty string`);
  if (typeof informational !== 'boolean') invalid(`line ${code}: informational must be a boolean`);
  const amount = moneyCopy(own(line, 'amount'), `line ${code} amount`);
  const taxAmount = moneyCopy(own(line, 'taxAmount'), `line ${code} tax amount`);
  assertSameCurrency(sell, amount);
  assertSameCurrency(sell, taxAmount);
  return Object.freeze({ code, labelKey, source: source as ChargeLine['source'], amount, taxAmount, taxCode, informational });
}

/** The state with the line appended. */
export function appendLine(state: PricingState, line: ChargeLine, sellCurrency: string): PricingState {
  return Object.freeze({ ...state, lines: Object.freeze([...state.lines, chargeLine(line, sellCurrency)]) });
}

function inputsCopy(value: unknown, ruleKey: string): Readonly<Record<string, ExplanationInput>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`explanation ${ruleKey}: inputs must be an object`);
  const copy: Record<string, ExplanationInput> = {};
  for (const [key, item] of Object.entries(value)) {
    const valid =
      item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
    if (!valid) invalid(`explanation ${ruleKey}: inputs hold strings, booleans, null or finite numbers only`);
    copy[key] = item as ExplanationInput;
  }
  return Object.freeze(copy);
}

/** A validated, frozen copy of the explanation entry with a fixed key order. */
export function explanationEntry(entry: ExplanationEntry): ExplanationEntry {
  const ruleKey = own(entry, 'ruleKey');
  if (!isNonEmptyString(ruleKey)) invalid('explanation rule key must be a non-empty string');
  const ruleType = own(entry, 'ruleType');
  const configVersion = own(entry, 'configVersion');
  const outcome = own(entry, 'outcome');
  const effectMinor = own(entry, 'effectMinor');
  if (typeof ruleType !== 'string' || !(RULE_TYPES as readonly string[]).includes(ruleType))
    invalid(`explanation ${ruleKey}: unknown rule type`);
  if (!isNonEmptyString(configVersion)) invalid(`explanation ${ruleKey}: configuration version is required`);
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) invalid(`explanation ${ruleKey}: outcome must be FIRED or REJECTED`);
  if (!Number.isSafeInteger(effectMinor))
    throw new MoneyError('MONEY_INVALID', `explanation ${ruleKey}: effect must be integer minor units`);
  return Object.freeze({
    ruleType: ruleType as ExplanationEntry['ruleType'],
    ruleKey,
    configVersion,
    outcome: outcome as ExplanationEntry['outcome'],
    inputs: inputsCopy(own(entry, 'inputs'), ruleKey),
    effectMinor: effectMinor as number,
  });
}

/** The state with the explanation entry appended. */
export function appendEntry(state: PricingState, entry: ExplanationEntry): PricingState {
  return Object.freeze({ ...state, entries: Object.freeze([...state.entries, explanationEntry(entry)]) });
}

/** The validated count of rejected rule candidates (openapi `minimum: 0`). */
export function rejectedCandidateCount(state: PricingState): number {
  const count = own(state, 'rejectedCandidateCount');
  if (!Number.isSafeInteger(count) || (count as number) < 0) invalid('rejected candidate count must be a non-negative integer');
  return count as number;
}

/** A frozen copy of the warnings, each one of `PRICING_WARNINGS`. */
export function warnings(state: PricingState): readonly PricingWarning[] {
  const list = own(state, 'warnings');
  if (!Array.isArray(list)) invalid('warnings must be an array');
  const copy = [...(list as unknown[])];
  if (!copy.every((warning) => typeof warning === 'string' && (PRICING_WARNINGS as readonly string[]).includes(warning))) {
    invalid('warnings must be values of PRICING_WARNINGS');
  }
  return Object.freeze(copy as PricingWarning[]);
}
