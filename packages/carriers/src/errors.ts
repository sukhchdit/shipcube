/**
 * The structured error of the carrier layer (REQ-CARR-003, REQ-CARR-007, DR-B30). Every failure that leaves an adapter
 * or the capability guard is a `CarrierError` with a canonical code; the message is the canonical English text of that
 * code, never the carrier's own wording, so nothing downstream (logs, problem responses, customer e-mails) can echo raw
 * carrier text. The carrier's own error code is kept, bounded and shape-checked, for operator diagnosis only; raw
 * request and response bodies are never attached (the redacted raw-payload store of ADR-0010 am. 8 is their one copy).
 */
import { CARRIER_ERROR_MESSAGES, type CarrierErrorCode } from './canonical/codes.js';
import type { CarrierOperation } from './operations.js';

/** A carrier error code survives only in this shape (letters, digits, `_ - . :`, ≤ 64 chars); anything else is dropped. */
const CARRIER_RAW_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;

export interface CarrierErrorOptions {
  /** Carrier code (`DHL_EXPRESS`, `MOCK`), when known. */
  readonly carrier?: string;
  /** The adapter operation that failed. */
  readonly operation?: CarrierOperation;
  /** The carrier's own error code (diagnosis only; dropped unless it matches a safe code shape). */
  readonly carrierErrorCode?: string;
  /** Underlying failure, for the server log only. Never serialised. */
  readonly cause?: unknown;
}

/** The safe, serialisable view of a CarrierError. */
export interface CarrierErrorJson {
  readonly code: CarrierErrorCode;
  readonly carrier?: string;
  readonly operation?: CarrierOperation;
  readonly carrierErrorCode?: string;
}

export class CarrierError extends Error {
  readonly code: CarrierErrorCode;
  declare readonly carrier?: string;
  declare readonly operation?: CarrierOperation;
  declare readonly carrierErrorCode?: string;

  constructor(code: CarrierErrorCode, options: CarrierErrorOptions = {}) {
    super(CARRIER_ERROR_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CarrierError';
    this.code = code;
    if (options.carrier !== undefined) this.carrier = options.carrier;
    if (options.operation !== undefined) this.operation = options.operation;
    if (options.carrierErrorCode !== undefined && CARRIER_RAW_CODE.test(options.carrierErrorCode)) {
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
 * tables, context construction): a programming or configuration defect found at start-up, never a carrier answer.
 * `issues` name every defect found, so one run reports them all.
 */
export class CarrierContractError extends Error {
  readonly issues: readonly string[];

  constructor(subject: string, issues: readonly string[]) {
    super(`${subject}: ${issues.join('; ')}`);
    this.name = 'CarrierContractError';
    this.issues = Object.freeze([...issues]);
  }
}
