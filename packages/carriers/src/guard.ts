/**
 * The capability guard (REQ-CARR-003, ADR-0010 §Interface and am. 11 items 2-3, D-ARCH-057). `guardAdapter` checks an
 * adapter once, at registration, and returns a frozen facade over it:
 *  - registration fails, naming each defect, when a required operation is missing, the capability declaration is
 *    incomplete or malformed, or an operation declared supported has no implementation (AT-US-121-06);
 *  - a call to an operation declared unsupported (an optional operation, `cancelShipment` with
 *    `operations.cancelShipment = false`, `recoverLabel`) is answered with `CarrierError(CAPABILITY_NOT_SUPPORTED)`
 *    before the adapter is reached, so no network I/O can happen (AT-US-121-03, AT-US-121-07). The error is terminal
 *    for the caller: no retry, never `EXCEPTION` (REQ-BOOK-029);
 *  - every call's context must belong to the adapter's carrier, with the account's own environment.
 * `capabilities()` on the facade returns the snapshot taken at registration (deep-frozen), so the guard and every
 * caller decide on the same declaration for the life of the process.
 */
import type { CarrierAdapter, GuardedCarrierAdapter } from './adapter.js';
import { capabilityIssues, type CarrierCapabilities } from './capabilities.js';
import { isCarrierCode } from './canonical/codes.js';
import { contextIssues } from './context.js';
import { CarrierContractError, CarrierError } from './errors.js';
import {
  type CarrierOperation,
  type DeclaredOperation,
  DECLARED_OPERATIONS,
  OPTIONAL_OPERATIONS,
  REQUIRED_OPERATIONS,
} from './operations.js';

/** Reads a member without binding it (a presence check only; calls go through the adapter object). */
const hasFunction = (target: object, key: string): boolean => typeof (target as Record<string, unknown>)[key] === 'function';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Reads the declaration once; a throwing `capabilities()` is a registration defect, not a crash. */
function readCapabilities(adapter: CarrierAdapter): { capabilities?: unknown; issues: string[] } {
  if (!hasFunction(adapter, 'capabilities')) return { issues: ['missing required operation capabilities'] };
  try {
    return { capabilities: adapter.capabilities(), issues: [] };
  } catch {
    return { issues: ['capabilities() threw'] };
  }
}

/** Every registration defect of `adapter`; empty when it can be registered. Also returns the checked declaration. */
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

/** Validates `adapter` (throws `CarrierContractError` naming every defect) and returns its guarded facade. */
export function guardAdapter(adapter: CarrierAdapter): GuardedCarrierAdapter {
  const { issues, capabilities } = registrationIssues(adapter);
  const code = typeof adapter === 'object' && typeof adapter.code === 'string' ? adapter.code : '(no code)';
  if (capabilities === undefined || issues.length > 0) {
    throw new CarrierContractError(`carrier adapter ${code} cannot be registered`, issues);
  }
  const snapshot = deepFreeze(structuredClone(capabilities));
  const declared = new Set<string>(DECLARED_OPERATIONS);
  const supported = (operation: CarrierOperation): boolean =>
    !declared.has(operation) || snapshot.operations[operation as DeclaredOperation];

  /** The single entry of every call: capability first (no I/O on refusal), then the context, then the adapter. */
  const run = async <R>(operation: CarrierOperation, ctx: unknown, call: (() => Promise<R>) | undefined): Promise<R> => {
    if (!supported(operation) || call === undefined) throw new CarrierError('CAPABILITY_NOT_SUPPORTED', { carrier: code, operation });
    const problems = contextIssues(ctx, code);
    if (problems.length > 0) throw new CarrierContractError(`invalid CarrierContext for ${code}.${operation}`, problems);
    return call();
  };
  // Optional methods bound once; `run` refuses the call when the adapter has none.
  const validateAddress = adapter.validateAddress?.bind(adapter);
  const findServicePoints = adapter.findServicePoints?.bind(adapter);
  const uploadCustomsDocuments = adapter.uploadCustomsDocuments?.bind(adapter);
  const estimateLandedCost = adapter.estimateLandedCost?.bind(adapter);
  const recoverLabel = adapter.recoverLabel?.bind(adapter);

  const guarded: GuardedCarrierAdapter = {
    code,
    capabilities: () => snapshot,
    getRates: (req, ctx) => run('getRates', ctx, () => adapter.getRates(req, ctx)),
    createShipment: (req, ctx) => run('createShipment', ctx, () => adapter.createShipment(req, ctx)),
    cancelShipment: (ref, ctx) => run('cancelShipment', ctx, () => adapter.cancelShipment(ref, ctx)),
    schedulePickup: (req, ctx) => run('schedulePickup', ctx, () => adapter.schedulePickup(req, ctx)),
    cancelPickup: (ref, ctx) => run('cancelPickup', ctx, () => adapter.cancelPickup(ref, ctx)),
    track: (numbers, ctx) => run('track', ctx, () => adapter.track(numbers, ctx)),
    validateAddress: (address, ctx) => run('validateAddress', ctx, validateAddress && (() => validateAddress(address, ctx))),
    findServicePoints: (query, ctx) => run('findServicePoints', ctx, findServicePoints && (() => findServicePoints(query, ctx))),
    uploadCustomsDocuments: (req, ctx) =>
      run('uploadCustomsDocuments', ctx, uploadCustomsDocuments && (() => uploadCustomsDocuments(req, ctx))),
    estimateLandedCost: (req, ctx) => run('estimateLandedCost', ctx, estimateLandedCost && (() => estimateLandedCost(req, ctx))),
    recoverLabel: (ref, formats, ctx) => run('recoverLabel', ctx, recoverLabel && (() => recoverLabel(ref, formats, ctx))),
  };
  return Object.freeze(guarded);
}
