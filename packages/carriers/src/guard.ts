/**
 * The capability guard (REQ-CARR-003, ADR-0010 §Interface and am. 11 items 2-3, D-ARCH-057). `guardAdapter` checks an
 * adapter once, at registration, and returns a frozen facade over it:
 *  - the declaration is cloned first (plain data only) and the clone is validated and frozen, so the guard decides on
 *    exactly what was checked; registration fails, naming each defect, when a required operation is missing, the
 *    declaration is not plain data, incomplete or malformed, or an operation declared supported has no implementation
 *    (AT-US-121-06);
 *  - a call to an operation declared unsupported (an optional operation, `cancelShipment` with
 *    `operations.cancelShipment = false`, `recoverLabel`) is answered with `CarrierError(CAPABILITY_NOT_SUPPORTED)`
 *    before the adapter is reached, so no network I/O can happen (AT-US-121-03, AT-US-121-07). The error is terminal
 *    for the caller: no retry, never `EXCEPTION` (REQ-BOOK-029);
 *  - every call's context is read once into a frozen copy validated by `createCarrierContext` (account of the adapter's
 *    carrier, the account's own environment, valid deadline, locale and scenario), and the adapter receives that copy,
 *    never the caller's object (PR075-SEC-01);
 *  - labels the adapter returns are re-checked (PR075-SEC-03): `recoverLabel` refuses an invalid or unrequested label;
 *    `createShipment` never throws after the carrier accepted the shipment (a throw would invite a retry and a
 *    duplicate label), so an invalid label is dropped and logged with codes only, and the saga recovers the format.
 * All eleven operations are bound at registration; later changes to the adapter object do not move the facade.
 */
import type { CarrierAdapter, GuardedCarrierAdapter } from './adapter.js';
import { capabilityIssues, type CarrierCapabilities } from './capabilities.js';
import { type DocumentFormat, isCarrierCode } from './canonical/codes.js';
import type { LabelDocument } from './canonical/types.js';
import { type CarrierAccountRef, type CarrierContext, contextIssues, createCarrierContext } from './context.js';
import { CarrierContractError, CarrierError } from './errors.js';
import { createLabelDocument } from './labels.js';
import type { NormaliseLogger } from './normalise/normalise.js';
import {
  type CarrierOperation,
  type DeclaredOperation,
  DECLARED_OPERATIONS,
  OPTIONAL_OPERATIONS,
  REQUIRED_OPERATIONS,
} from './operations.js';

export interface GuardOptions {
  /** Receives one `carrier.label.dropped` line per invalid label dropped from a `createShipment` answer. */
  readonly logger?: NormaliseLogger;
}

export const LABEL_DROPPED_EVENT = 'carrier.label.dropped';

/** Reads a member without binding it (a presence check only). */
const hasFunction = (target: object, key: string): boolean => typeof (target as Record<string, unknown>)[key] === 'function';
const LOGGABLE_FORMAT = /^[A-Za-z0-9_]{1,16}$/u;
const loggableFormat = (value: unknown): string => (typeof value === 'string' && LOGGABLE_FORMAT.test(value) ? value : '(unprintable)');

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Reads the declaration once and clones it; a throwing or non-plain `capabilities()` is a registration defect. */
function readCapabilities(adapter: CarrierAdapter): { capabilities?: unknown; issues: string[] } {
  if (!hasFunction(adapter, 'capabilities')) return { issues: ['missing required operation capabilities'] };
  let declared: unknown;
  try {
    declared = adapter.capabilities();
  } catch {
    return { issues: ['capabilities() threw'] };
  }
  try {
    return { capabilities: structuredClone(declared), issues: [] };
  } catch {
    return { issues: ['capabilities() must return plain data (it holds a function or another value that cannot be cloned)'] };
  }
}

/** Every registration defect of `adapter`; empty when it can be registered. Also returns the checked clone. */
export function registrationIssues(adapter: unknown): { issues: string[]; capabilities?: CarrierCapabilities } {
  if (typeof adapter !== 'object' || adapter === null) return { issues: ['adapter must be an object'] };
  const candidate = adapter as CarrierAdapter;
  const issues: string[] = [];
  if (!isCarrierCode(candidate.code)) issues.push('code must match ^[A-Z][A-Z0-9_]{1,31}$');
  for (const operation of REQUIRED_OPERATIONS) {
    if (!hasFunction(candidate, operation)) issues.push(`missing required operation ${operation}`);
  }
  const read = readCapabilities(candidate);
  issues.push(...read.issues);
  if (read.issues.length > 0) return { issues };
  const declared = capabilityIssues(read.capabilities, typeof candidate.code === 'string' ? candidate.code : '');
  issues.push(...declared);
  if (declared.length > 0) return { issues };
  const capabilities = read.capabilities as CarrierCapabilities;
  for (const operation of OPTIONAL_OPERATIONS) {
    if (capabilities.operations[operation] && !hasFunction(candidate, operation)) {
      issues.push(`operations.${operation} is declared true but the adapter has no ${operation}`);
    }
  }
  return issues.length > 0 ? { issues } : { issues, capabilities };
}

/**
 * Reads every field of a caller's context once and returns a frozen copy validated for `carrierCode`: getters, Proxy
 * traps and later mutation of the caller's object cannot reach the copy the adapter uses.
 */
export function snapshotContext(ctx: unknown, carrierCode: string, operation: CarrierOperation): CarrierContext {
  const refuse = (problems: readonly string[]): never => {
    throw new CarrierContractError(`invalid CarrierContext for ${carrierCode}.${operation}`, problems);
  };
  if (typeof ctx !== 'object' || ctx === null) return refuse(['context must be an object']);
  const { account, environment, correlationId, locale, deadlineAt, mockScenario } = ctx as Partial<Record<keyof CarrierContext, unknown>>;
  if (typeof account !== 'object' || account === null) return refuse(['account must be an object']);
  const {
    id,
    code,
    carrierCode: accountCarrier,
    environment: accountEnvironment,
  } = account as Partial<Record<keyof CarrierAccountRef, unknown>>;
  let copy: CarrierContext;
  try {
    copy = createCarrierContext({
      account: { id, code, carrierCode: accountCarrier, environment: accountEnvironment } as CarrierAccountRef,
      correlationId: correlationId as string,
      deadlineAt: deadlineAt as Date,
      ...(locale === undefined ? {} : { locale: locale as string }),
      ...(mockScenario === undefined ? {} : { mockScenario: mockScenario as string }),
    });
  } catch (error) {
    if (!(error instanceof CarrierContractError)) throw error;
    return refuse(error.issues);
  }
  // The caller's own `environment` (read once above) must agree with the account it names.
  const problems = contextIssues({ ...copy, environment }, carrierCode);
  return problems.length > 0 ? refuse(problems) : copy;
}

/** Validates `adapter` (throws `CarrierContractError` naming every defect) and returns its guarded facade. */
export function guardAdapter(adapter: CarrierAdapter, options: GuardOptions = {}): GuardedCarrierAdapter {
  const { issues, capabilities } = registrationIssues(adapter);
  const code = typeof adapter === 'object' && isCarrierCode(adapter.code) ? adapter.code : '(invalid code)';
  if (capabilities === undefined || issues.length > 0) {
    throw new CarrierContractError(`carrier adapter ${code} cannot be registered`, issues);
  }
  const snapshot = deepFreeze(capabilities);
  const declared = new Set<string>(DECLARED_OPERATIONS);
  const supported = (operation: CarrierOperation): boolean =>
    !declared.has(operation) || snapshot.operations[operation as DeclaredOperation];

  /** The single entry of every call: capability first (no I/O on refusal), then the context copy, then the adapter. */
  const run = async <R>(operation: CarrierOperation, ctx: unknown, call: ((ctx: CarrierContext) => Promise<R>) | undefined): Promise<R> => {
    if (!supported(operation) || call === undefined) throw new CarrierError('CAPABILITY_NOT_SUPPORTED', { carrier: code, operation });
    return call(snapshotContext(ctx, code, operation));
  };

  /** Re-checks returned labels; `requested` given = refuse (recoverLabel), absent = drop and log (createShipment). */
  const checkedLabels = (operation: CarrierOperation, labels: unknown, requested?: readonly DocumentFormat[]): LabelDocument[] =>
    (Array.isArray(labels) ? (labels as unknown[]) : []).flatMap((label) => {
      const { format, content } = (typeof label === 'object' && label !== null ? label : {}) as { format?: unknown; content?: unknown };
      try {
        const document = createLabelDocument(typeof format === 'string' ? format : '', content);
        if (requested !== undefined && !requested.includes(document.format)) {
          throw new CarrierContractError('label not requested', [document.format]);
        }
        return [document];
      } catch (error) {
        if (!(error instanceof CarrierContractError)) throw error;
        if (requested !== undefined)
          throw new CarrierContractError(`${code}.${operation} returned an invalid label`, [loggableFormat(format)]);
        options.logger?.warn(LABEL_DROPPED_EVENT, { carrier: code, operation, format: loggableFormat(format) });
        return [];
      }
    });

  const getRates = adapter.getRates.bind(adapter);
  const createShipment = adapter.createShipment.bind(adapter);
  const cancelShipment = adapter.cancelShipment.bind(adapter);
  const schedulePickup = adapter.schedulePickup.bind(adapter);
  const cancelPickup = adapter.cancelPickup.bind(adapter);
  const track = adapter.track.bind(adapter);
  const validateAddress = adapter.validateAddress?.bind(adapter);
  const findServicePoints = adapter.findServicePoints?.bind(adapter);
  const uploadCustomsDocuments = adapter.uploadCustomsDocuments?.bind(adapter);
  const estimateLandedCost = adapter.estimateLandedCost?.bind(adapter);
  const recoverLabel = adapter.recoverLabel?.bind(adapter);

  const guarded: GuardedCarrierAdapter = {
    code,
    capabilities: () => snapshot,
    getRates: (req, ctx) => run('getRates', ctx, (c) => getRates(req, c)),
    createShipment: (req, ctx) =>
      run('createShipment', ctx, async (c) => {
        const result = await createShipment(req, c);
        return Object.freeze({ ...result, labels: checkedLabels('createShipment', result.labels) });
      }),
    cancelShipment: (ref, ctx) => run('cancelShipment', ctx, (c) => cancelShipment(ref, c)),
    schedulePickup: (req, ctx) => run('schedulePickup', ctx, (c) => schedulePickup(req, c)),
    cancelPickup: (ref, ctx) => run('cancelPickup', ctx, (c) => cancelPickup(ref, c)),
    track: (numbers, ctx) => run('track', ctx, (c) => track(numbers, c)),
    validateAddress: (address, ctx) => run('validateAddress', ctx, validateAddress && ((c) => validateAddress(address, c))),
    findServicePoints: (query, ctx) => run('findServicePoints', ctx, findServicePoints && ((c) => findServicePoints(query, c))),
    uploadCustomsDocuments: (req, ctx) =>
      run('uploadCustomsDocuments', ctx, uploadCustomsDocuments && ((c) => uploadCustomsDocuments(req, c))),
    estimateLandedCost: (req, ctx) => run('estimateLandedCost', ctx, estimateLandedCost && ((c) => estimateLandedCost(req, c))),
    recoverLabel: (ref, formats, ctx) =>
      run('recoverLabel', ctx, recoverLabel && (async (c) => checkedLabels('recoverLabel', await recoverLabel(ref, formats, c), formats))),
  };
  return Object.freeze(guarded);
}
