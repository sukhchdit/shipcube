/**
 * The structured errors of the carrier layer (REQ-CARR-003, REQ-CARR-007, DR-B30).
 *
 * `CarrierError` carries a canonical code. Its message is the canonical English text of that code, never the carrier's
 * wording, so a problem response or customer e-mail built from it cannot echo raw carrier text. The capability guard
 * throws it for an unsupported operation, and `normaliseError` builds it from a carrier failure. The guard passes other
 * adapter failures through unchanged; the resilience gateway (TASK-132) converts every non-`CarrierError` failure to
 * `CARRIER_UNKNOWN_ERROR` (with `safeCause`) and treats a `CarrierContractError` thrown before the adapter is reached as
 * local and non-ambiguous.
 *
 * Every field is checked at run time, not only by the type: an unknown code becomes `CARRIER_UNKNOWN_ERROR`, a carrier
 * or operation outside its shape is dropped, the carrier's own error code survives only as a short safe code, and the
 * `cause` is reduced to `{ name, code? }`, so no message, URL path or carrier text can reach a log line through it
 * (ADR-0010 am. 11 item 8). Raw request and response bodies are never attached; the redacted raw-payload store of
 * ADR-0010 am. 8 is their one copy.
 */
import { CARRIER_ERROR_MESSAGES, type CarrierErrorCode, isCarrierCode, isCarrierErrorCode } from './canonical/codes.js';
import { CARRIER_OPERATIONS, type CarrierOperation } from './operations.js';

/** A carrier error code or a cause code survives only in this shape (letters, digits, `_ - . :`, ≤ 64 chars). */
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

/** The loggable part of an underlying failure: its class name and a safe code, never its message. */
export interface SafeCause {
  readonly name: string;
  readonly code?: string;
}

/** Reduces an underlying failure to `{ name, code? }` (`{ name: 'Error', code: 'ECONNRESET' }`); undefined for none. */
export function safeCause(cause: unknown): SafeCause | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (typeof cause !== 'object') return Object.freeze({ name: 'Error' });
  const { name, code } = cause as { name?: unknown; code?: unknown };
  return Object.freeze({
    name: typeof name === 'string' && SAFE_NAME.test(name) ? name : 'Error',
    ...(typeof code === 'string' && SAFE_CODE.test(code) ? { code } : {}),
  });
}

export interface CarrierErrorOptions {
  /** Carrier code (`DHL_EXPRESS`, `MOCK`), when known; dropped unless it has the carrier-code shape. */
  readonly carrier?: string;
  /** The adapter operation that failed; dropped unless it is a contract operation. */
  readonly operation?: CarrierOperation;
  /** The carrier's own error code (diagnosis only; dropped unless it is a short safe string code). */
  readonly carrierErrorCode?: string;
  /** Underlying failure; only `safeCause(cause)` is kept. */
  readonly cause?: unknown;
}

/** The safe, serialisable view of a CarrierError. */
export interface CarrierErrorJson {
  readonly code: CarrierErrorCode;
  readonly carrier?: string;
  readonly operation?: CarrierOperation;
  readonly carrierErrorCode?: string;
}

const OPERATIONS: ReadonlySet<string> = new Set(CARRIER_OPERATIONS);

export class CarrierError extends Error {
  readonly code: CarrierErrorCode;
  declare readonly carrier?: string;
  declare readonly operation?: CarrierOperation;
  declare readonly carrierErrorCode?: string;

  constructor(code: CarrierErrorCode, options: CarrierErrorOptions = {}) {
    const canonical: CarrierErrorCode = isCarrierErrorCode(code) ? code : 'CARRIER_UNKNOWN_ERROR';
    const cause = safeCause(options.cause);
    super(CARRIER_ERROR_MESSAGES[canonical], cause === undefined ? undefined : { cause });
    this.name = 'CarrierError';
    this.code = canonical;
    if (isCarrierCode(options.carrier)) this.carrier = options.carrier;
    if (typeof options.operation === 'string' && OPERATIONS.has(options.operation)) this.operation = options.operation;
    if (typeof options.carrierErrorCode === 'string' && SAFE_CODE.test(options.carrierErrorCode)) {
      this.carrierErrorCode = options.carrierErrorCode;
    }
  }

  toJSON(): CarrierErrorJson {
    return {
      code: this.code,
      ...(this.carrier === undefined ? {} : { carrier: this.carrier }),
      ...(this.operation === undefined ? {} : { operation: this.operation }),
      ...(this.carrierErrorCode === undefined ? {} : { carrierErrorCode: this.carrierErrorCode }),
    };
  }
}

export function isCarrierError(value: unknown): value is CarrierError {
  return value instanceof CarrierError;
}

/**
 * Failure of the carrier layer's own contract checks (registration, capability declaration, mapping tables, egress
 * tables, context construction): a programming or configuration defect found before any carrier call, never a carrier
 * answer. `issues` name every defect found, so one run reports them all.
 */
export class CarrierContractError extends Error {
  readonly issues: readonly string[];

  constructor(subject: string, issues: readonly string[]) {
    super(`${subject}: ${issues.join('; ')}`);
    this.name = 'CarrierContractError';
    this.issues = Object.freeze([...issues]);
  }
}
