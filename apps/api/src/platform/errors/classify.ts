// Maps anything a handler or middleware can throw to a catalogue code, without trusting the thrown value
// (US-007, AT-US-007-03). Thrown values may be non-Errors, Proxies whose traps throw, or objects with throwing
// getters, so every read is an own-data-property read inside a guard: getters are never invoked and a throwing trap
// degrades to INTERNAL_ERROR. Only AppError, DbError and the known framework failures keep a 4xx status.
import { AppError, ERROR_CATALOGUE, type ErrorCode, isErrorCode } from '@platform/shared';

import { DbError } from '../db/index.js';

/** body-parser 2.x error `type` values (http-errors) mapped to catalogue codes; everything else is a 500. */
const BODY_PARSER_CODES: Readonly<Record<string, ErrorCode>> = {
  'entity.parse.failed': 'MALFORMED_REQUEST',
  'request.aborted': 'MALFORMED_REQUEST',
  'request.size.invalid': 'MALFORMED_REQUEST',
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'encoding.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
  'charset.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
};

export type Classified =
  /** An AppError: its catalogue code and client-safe fields, plus `Retry-After` when it carries a valid one (PR #44 R1-M1). */
  | { readonly kind: 'app'; readonly error: AppError; readonly retryAfterSeconds?: number }
  | { readonly kind: 'framework'; readonly code: ErrorCode }
  /** A data-layer failure (PR11-SEC-09 item 6): only its code and `Retry-After` reach the client, never its reason. */
  | { readonly kind: 'db'; readonly code: ErrorCode; readonly retryAfterSeconds?: number }
  | { readonly kind: 'unexpected' };

/** Upper bound for a `Retry-After` (the data layer and the request deadline send 1 s); anything outside 1..MAX is not sent. */
const MAX_RETRY_AFTER_SECONDS = 3600;

/** Value of an own data property; undefined for accessors, missing keys and values whose inspection throws. */
export function ownDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function safeInstanceOf(value: unknown, type: abstract new (...args: never[]) => unknown): boolean {
  try {
    return value instanceof type;
  } catch {
    return false;
  }
}

/**
 * A DbError answers with the catalogue entry of its `code`, provided that entry has the DbError's `status`; any other
 * shape (forged, accessor-backed or out-of-catalogue fields) fails safe to INTERNAL_ERROR. `Retry-After` is kept only
 * for a retryable DbError with an integer number of seconds in 1..MAX_RETRY_AFTER_SECONDS.
 */
function classifyDbError(value: unknown): Classified {
  const code = ownDataProperty(value, 'code');
  if (!isErrorCode(code) || ERROR_CATALOGUE[code].status !== ownDataProperty(value, 'status')) {
    return { kind: 'db', code: 'INTERNAL_ERROR' };
  }
  const retryAfter = ownDataProperty(value, 'retryable') === true ? retryAfterOf(value) : undefined;
  return retryAfter === undefined ? { kind: 'db', code } : { kind: 'db', code, retryAfterSeconds: retryAfter };
}

/** An own `retryAfterSeconds` data property that is an integer in 1..MAX_RETRY_AFTER_SECONDS; otherwise undefined. */
function retryAfterOf(value: unknown): number | undefined {
  const seconds = ownDataProperty(value, 'retryAfterSeconds');
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS
    ? seconds
    : undefined;
}

/** An AppError keeps `Retry-After` only on a 503 (a retryable outage), never on a client error. */
function classifyAppError(value: AppError): Classified {
  const retryAfter = ownDataProperty(value, 'status') === 503 ? retryAfterOf(value) : undefined;
  return retryAfter === undefined ? { kind: 'app', error: value } : { kind: 'app', error: value, retryAfterSeconds: retryAfter };
}

export function classifyThrown(value: unknown): Classified {
  if (safeInstanceOf(value, AppError)) return classifyAppError(value as AppError);
  if (safeInstanceOf(value, DbError)) return classifyDbError(value);
  if (!safeInstanceOf(value, Error)) return { kind: 'unexpected' };
  // router 2.x: a path parameter that cannot be percent-decoded is a URIError with status 400.
  if (safeInstanceOf(value, URIError) && ownDataProperty(value, 'status') === 400) {
    return { kind: 'framework', code: 'MALFORMED_REQUEST' };
  }
  const type = ownDataProperty(value, 'type');
  const code = typeof type === 'string' && Object.hasOwn(BODY_PARSER_CODES, type) ? BODY_PARSER_CODES[type] : undefined;
  return code === undefined ? { kind: 'unexpected' } : { kind: 'framework', code };
}

/** Class name of the thrown value for the server log; never its message. */
export function thrownClassName(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object' && typeof value !== 'function') return typeof value;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    const constructor = ownDataProperty(prototype, 'constructor');
    const name = ownDataProperty(constructor, 'name');
    return typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : 'object';
  } catch {
    return 'unknown';
  }
}
