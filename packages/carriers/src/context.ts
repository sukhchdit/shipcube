/**
 * `CarrierContext`: the argument every adapter operation receives (REQ-CARR-001, brief §4.3, ADR-0010 §Interface). It
 * carries the carrier account reference, the environment and the correlation ID. The environment is a property of the
 * account, never a global flag: `createCarrierContext` copies it from the account and reads no environment variable,
 * so sandbox and production accounts of one carrier coexist in one process (AT-US-121-04).
 */
import { isCorrelationId } from '@platform/shared';

import { type CarrierEnvironment, isCarrierCode, isCarrierEnvironment } from './canonical/codes.js';
import { CarrierContractError } from './errors.js';

/** Reference to one carrier account (data-model `carrier_accounts`); never carries a credential or a secret value. */
export interface CarrierAccountRef {
  /** `carrier_accounts.id`. */
  readonly id: string;
  /** `carrier_accounts.code` (`MOCK_DEFAULT`, `DHL_PLATFORM_SANDBOX`). */
  readonly code: string;
  /** `carriers.code` of the account's carrier. */
  readonly carrierCode: string;
  readonly environment: CarrierEnvironment;
}

export interface CarrierContext {
  readonly account: CarrierAccountRef;
  /** Always equal to `account.environment` (copied, never read from configuration). */
  readonly environment: CarrierEnvironment;
  /** ADR-0016 §15 correlation ID; carried into the outbound-call log line and the saga `carrier_call` audit entry. */
  readonly correlationId: string;
  /** BCP 47 language tag of the caller (`en`, `es`, `fr`, `en-US`). */
  readonly locale: string;
  /** Absolute deadline of the call; the resilience wrapper derives its timeout from it (TASK-132). */
  readonly deadlineAt: Date;
  /** Raw Mock scenario directive (DR-B29); parsed and honoured only by the Mock carrier when scenarios are enabled. */
  readonly mockScenario?: string;
}

export interface CarrierContextInput {
  readonly account: CarrierAccountRef;
  readonly correlationId: string;
  readonly deadlineAt: Date;
  readonly locale?: string;
  readonly mockScenario?: string;
}

const ACCOUNT_ID = /^[A-Za-z0-9-]{1,64}$/u;
const ACCOUNT_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
/** DR-B29 directives are short `key=value;...` strings; the Mock parser (TASK-079/US-123) validates the vocabulary. */
const MOCK_SCENARIO_MAX = 512;
const DEFAULT_LOCALE = 'en';

/** Issues of an account reference; empty when it is well-formed. */
export function accountRefIssues(account: unknown): string[] {
  if (typeof account !== 'object' || account === null) return ['account must be an object'];
  const { id, code, carrierCode, environment } = account as Partial<Record<keyof CarrierAccountRef, unknown>>;
  const issues: string[] = [];
  if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) issues.push('account.id must be 1..64 characters of [A-Za-z0-9-]');
  if (typeof code !== 'string' || !ACCOUNT_CODE.test(code)) issues.push('account.code must match ^[A-Z][A-Z0-9_]{1,63}$');
  if (!isCarrierCode(carrierCode)) issues.push('account.carrierCode must match ^[A-Z][A-Z0-9_]{1,31}$');
  if (!isCarrierEnvironment(environment)) issues.push('account.environment must be "sandbox" or "production"');
  return issues;
}

/** Builds a frozen, validated context; throws `CarrierContractError` naming every defect. */
export function createCarrierContext(input: CarrierContextInput): CarrierContext {
  const issues = accountRefIssues(input.account);
  if (!isCorrelationId(input.correlationId)) issues.push('correlationId must match the ADR-0016 §15 pattern');
  if (!(input.deadlineAt instanceof Date) || Number.isNaN(input.deadlineAt.getTime())) issues.push('deadlineAt must be a valid Date');
  const locale = input.locale ?? DEFAULT_LOCALE;
  if (!LOCALE.test(locale)) issues.push('locale must be a language tag such as "en" or "en-US"');
  if (input.mockScenario !== undefined && (typeof input.mockScenario !== 'string' || input.mockScenario.length > MOCK_SCENARIO_MAX)) {
    issues.push(`mockScenario must be a string of at most ${String(MOCK_SCENARIO_MAX)} characters`);
  }
  if (issues.length > 0) throw new CarrierContractError('invalid CarrierContext', issues);

  const account: CarrierAccountRef = Object.freeze({
    id: input.account.id,
    code: input.account.code,
    carrierCode: input.account.carrierCode,
    environment: input.account.environment,
  });
  return Object.freeze({
    account,
    environment: account.environment,
    correlationId: input.correlationId,
    locale,
    deadlineAt: new Date(input.deadlineAt.getTime()),
    ...(input.mockScenario === undefined ? {} : { mockScenario: input.mockScenario }),
  });
}

/**
 * Issues of a context handed to an adapter of `carrierCode`: well-formed, for that carrier, and with the environment
 * equal to the account's (a context assembled by hand cannot split the two).
 */
export function contextIssues(ctx: unknown, carrierCode: string): string[] {
  if (typeof ctx !== 'object' || ctx === null) return ['context must be an object'];
  const { account, environment, correlationId } = ctx as Partial<Record<keyof CarrierContext, unknown>>;
  const issues = accountRefIssues(account);
  if (issues.length === 0) {
    const ref = account as CarrierAccountRef;
    if (ref.carrierCode !== carrierCode) issues.push(`context account belongs to carrier ${ref.carrierCode}, not ${carrierCode}`);
    if (environment !== ref.environment) issues.push('context environment differs from the account environment');
  }
  if (!isCorrelationId(correlationId)) issues.push('correlationId must match the ADR-0016 §15 pattern');
  return issues;
}
