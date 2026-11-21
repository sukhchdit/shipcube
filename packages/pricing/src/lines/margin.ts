/**
 * Margin line (ADR-0015 §2 step 2, DR-B07/DR-B08, REQ-PRICE-003; US-140, TASK-080). Exactly one margin rule is chosen
 * from the configuration snapshot and applied to the base freight line, rounded once at line level (DR-B11), as the
 * `MARGIN` line after `BASE_FREIGHT`.
 *
 * The configuration must hold exactly one default rule (priority -1000, every dimension null; seeded as 15 %, A-060):
 * pricing without it fails with PRICING_CONFIG_INVALID (REQ-PRICE-003), so a quote always has a margin rule.
 *
 * Selection is the M0 subset of DR-B08: higher priority first, then specificity (a service match before a carrier
 * match), then the lowest rule key. US-141 adds the other dimensions (carrier account, lane, customer segment, content
 * type, weight band, date range) and the effective-from tie-break by extending {@link compareMarginRules} and
 * {@link marginRuleMatches}; the order of the existing keys stays.
 *
 * Rules are read like lines (`state.ts`, PR076-SEC-05): every field once, from an own property, into a validated and
 * frozen copy; an error message names the rule's position, never a value from the configuration.
 */
import { compareRatio, type Money, ratio, zero } from '@platform/shared';

import { PricingError } from '../errors.js';
import { applyRate, rateRatio, type Rate } from '../rounding.js';
import { appendEntry, appendLine } from '../state.js';
import type { ChargeLine, ExplanationInput, MarginRule, PricingInput, PricingState, PricingStep } from '../types.js';
import { BASE_FREIGHT_CODE } from './base-freight.js';

export const MARGIN_CODE = 'MARGIN';
export const MARGIN_LABEL_KEY = 'charges.margin';
/** DR-B08: the seeded default rule has this priority and matches everything. */
export const DEFAULT_MARGIN_PRIORITY = -1000;

const ZERO_RATIO = ratio(0);

function own(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function configInvalid(message: string): never {
  throw new PricingError('PRICING_CONFIG_INVALID', message);
}

const isDimension = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length > 0);

/** A frozen copy of the rate's one own key; `rateRatio` then refuses a malformed value. */
function rateCopy(value: unknown, where: string): Rate {
  if (typeof value !== 'object' || value === null) configInvalid(`${where}: rate must be an object`);
  const hasBps = Object.hasOwn(value, 'bps');
  if (hasBps === Object.hasOwn(value, 'decimal')) configInvalid(`${where}: a rate has exactly one of bps and decimal`);
  const copy: Rate = hasBps ? { bps: own(value, 'bps') as number } : { decimal: own(value, 'decimal') as string };
  if (compareRatio(rateRatio(copy), ZERO_RATIO) < 0) configInvalid(`${where}: a margin rate must not be negative`);
  return Object.freeze(copy);
}

/** A validated, frozen copy of one margin rule. */
function marginRule(value: unknown, index: number): MarginRule {
  const where = `margin rule ${index}`;
  const ruleKey = own(value, 'ruleKey');
  const priority = own(value, 'priority');
  const carrierCode = own(value, 'carrierCode');
  const serviceCode = own(value, 'serviceCode');
  const isDefault = own(value, 'isDefault');
  if (typeof ruleKey !== 'string' || ruleKey.length === 0) configInvalid(`${where}: rule key must be a non-empty string`);
  if (!Number.isSafeInteger(priority)) configInvalid(`${where}: priority must be an integer`);
  if (!isDimension(carrierCode) || !isDimension(serviceCode)) configInvalid(`${where}: a dimension is null or a non-empty string`);
  if (typeof isDefault !== 'boolean') configInvalid(`${where}: isDefault must be a boolean`);
  const rate = rateCopy(own(value, 'rate'), where);
  if (isDefault && (priority !== DEFAULT_MARGIN_PRIORITY || carrierCode !== null || serviceCode !== null)) {
    configInvalid(`${where}: the default rule has priority ${DEFAULT_MARGIN_PRIORITY} and no dimension`);
  }
  return Object.freeze({ ruleKey, priority: priority as number, carrierCode, serviceCode, rate, isDefault });
}

/**
 * The validated margin rules of a configuration snapshot: PRICING_CONFIG_INVALID unless they are an array of valid rules
 * with unique keys and exactly one default rule (AT-US-140-03).
 */
export function marginRules(config: unknown): readonly MarginRule[] {
  const list = own(config, 'marginRules');
  if (!Array.isArray(list)) configInvalid('the configuration has no margin rules');
  const rules = [...(list as unknown[])].map(marginRule);
  if (new Set(rules.map((rule) => rule.ruleKey)).size !== rules.length) configInvalid('margin rule keys must be unique');
  const defaults = rules.filter((rule) => rule.isDefault).length;
  if (defaults !== 1) configInvalid(`the configuration needs exactly one default margin rule, found ${defaults}`);
  return Object.freeze(rules);
}

/** Whether a rule applies to the quote: a null dimension matches any value. */
export function marginRuleMatches(rule: MarginRule, input: PricingInput): boolean {
  const { carrierCode, serviceCode } = input.carrierQuote;
  return (rule.carrierCode === null || rule.carrierCode === carrierCode) && (rule.serviceCode === null || rule.serviceCode === serviceCode);
}

const specified = (value: string | null): number => (value === null ? 0 : 1);
const byKey = (left: string, right: string): number => {
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

/** DR-B08 order, M0 subset: negative when `left` wins. Priority, then service, then carrier, then the lower rule key. */
export function compareMarginRules(left: MarginRule, right: MarginRule): number {
  if (left.priority !== right.priority) return left.priority > right.priority ? -1 : 1;
  const service = specified(right.serviceCode) - specified(left.serviceCode);
  if (service !== 0) return service;
  const carrier = specified(right.carrierCode) - specified(left.carrierCode);
  if (carrier !== 0) return carrier;
  return byKey(left.ruleKey, right.ruleKey);
}

/** The winning rule and the number of other matching candidates. The default rule always matches. */
export function selectMarginRule(rules: readonly MarginRule[], input: PricingInput): { rule: MarginRule; rejected: number } {
  const candidates = rules.filter((rule) => marginRuleMatches(rule, input)).sort(compareMarginRules);
  const [rule] = candidates;
  if (rule === undefined) configInvalid('no margin rule matches');
  return { rule, rejected: candidates.length - 1 };
}

function baseFreight(state: PricingState): Money {
  const line = state.lines.find((candidate) => candidate.code === BASE_FREIGHT_CODE);
  if (line === undefined) throw new PricingError('PRICING_INPUT_INVALID', 'the margin step needs the base freight line');
  return line.amount;
}

function rateInputs(rate: Rate): Record<string, ExplanationInput> {
  return 'bps' in rate ? { rateBps: rate.bps, rateDecimal: null } : { rateBps: null, rateDecimal: rate.decimal };
}

export const marginStep: PricingStep = (input, state) => {
  const { rule, rejected } = selectMarginRule(marginRules(input.config), input);
  const base = baseFreight(state);
  const amount = applyRate(base, rule.rate);
  const line: ChargeLine = {
    code: MARGIN_CODE,
    labelKey: MARGIN_LABEL_KEY,
    source: 'MARGIN',
    amount,
    taxAmount: zero(amount.currency),
    taxCode: null,
    informational: false,
  };
  const withLine = appendLine(state, line, input.request.sellCurrency);
  const withEntry = appendEntry(withLine, {
    ruleType: 'MARGIN',
    ruleKey: rule.ruleKey,
    configVersion: input.config.version,
    outcome: 'FIRED',
    inputs: {
      carrierCode: rule.carrierCode,
      serviceCode: rule.serviceCode,
      priority: rule.priority,
      isDefault: rule.isDefault,
      ...rateInputs(rule.rate),
    },
    effectMinor: amount.amount,
  });
  return Object.freeze({ ...withEntry, rejectedCandidateCount: withEntry.rejectedCandidateCount + rejected });
};
