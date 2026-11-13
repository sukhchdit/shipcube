// Serialises anything a caller can throw into the `err` key of a log line (US-007 AT-US-007-03, US-008, PR7-SEC-03
// item 3; TASK-010). Database errors get the identifier-only shape of prisma-error.ts; other errors keep their name,
// redacted message and redacted, frame-capped stack; non-errors their type and a redacted string form. Thrown values
// are untrusted: only own data properties are read (the V8 stack accessor is the one exception, see readStack) and an
// inspection that throws degrades to `{ name: 'Error' }`, so serialising can never throw into the caller.
import { types } from 'node:util';

import { constructorName, hasOwnKey, isObjectLike, ownDataProperty, ownString } from '../own-property.js';
import { redactString, sanitiseKey } from '../string-redaction.js';
import { errorName, isDatabaseError, serializeDatabaseError } from './prisma-error.js';

/** The `err` value of a log line. Database errors carry only `name`, `code`, `originalCode` and `kind`. */
export interface SerializedError {
  readonly name: string;
  readonly message?: string;
  readonly stack?: string;
  readonly code?: string;
  readonly originalCode?: string;
  readonly kind?: string;
  readonly cause?: SerializedError;
  /** Redacted string form of a thrown non-error. */
  readonly value?: string;
  /** Joi validation errors: the failing paths and rule types only, never the rejected values (PR20-SEC-12, L-13). */
  readonly details?: readonly SerializedValidationDetail[];
}

/** One Joi validation detail: the path (keys sanitised) and the rule type, never the value or the message. */
export interface SerializedValidationDetail {
  readonly path: string;
  readonly type: string;
}

/** Causes serialised below the thrown value. */
export const MAX_CAUSE_DEPTH = 3;
/** Stack frames kept; the header is rebuilt from the name and the redacted message. */
export const MAX_STACK_FRAMES = 20;
/** Characters of a raw stack read before it is split into frames (bounds the cost of huge stacks, PR20-SEC-07). */
export const MAX_RAW_STACK_LENGTH = 16_384;
/** Joi details kept per validation error. */
export const MAX_VALIDATION_DETAILS = 20;

const SHORT_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const STACK_FRAME = /^\s+at /;
const JOI_RULE_TYPE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_PATH_SEGMENTS = 16;
const MAX_HEADER_MESSAGE_LENGTH = 256;

/**
 * V8's own `stack` accessor, shared by every Error of this realm (Error, its subclasses, `captureStackTrace`). A stack
 * accessor is invoked only when it IS this function: a bound or Proxy-wrapped user getter also prints as
 * `[native code]`, so a `toString` check is not enough (PR #20 m1, PR20-SEC-09). Errors of another realm have another
 * accessor and are logged without a stack.
 */
const V8_STACK_GETTER: unknown = ((): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(new Error(), 'stack');
    return descriptor === undefined ? undefined : Reflect.get(descriptor, 'get');
  } catch {
    return undefined;
  }
})();

function safeInstanceOfError(value: unknown): boolean {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/** Native errors (any realm), Error subclasses and objects with an own string `message`. */
export function isErrorLike(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  return types.isNativeError(value) || safeInstanceOfError(value) || ownString(value, 'message') !== undefined;
}

/**
 * The stack of an error. Node 24 exposes `stack` as an own accessor installed by V8, so a data property is read
 * directly and an accessor is invoked only when it is V8's own accessor (identity check), never a user getter.
 */
function readStack(value: object): string | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'stack');
    if (descriptor === undefined) return undefined;
    if ('value' in descriptor) return typeof descriptor.value === 'string' ? descriptor.value : undefined;
    const getter: unknown = Reflect.get(descriptor, 'get');
    if (typeof getter !== 'function' || getter !== V8_STACK_GETTER) return undefined;
    const stack: unknown = Reflect.apply(getter, value, []);
    return typeof stack === 'string' ? stack : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `header` followed by the first MAX_STACK_FRAMES `at` frames of `stack`. V8 fixes the stack header at the first
 * `.stack` read, so the original header can carry a message scrubbed later: it is rebuilt from the current, redacted
 * message instead (PR20-SEC-09). The raw stack is cut before it is split (PR20-SEC-07).
 */
function capFrames(header: string, stack: string): string {
  const kept: string[] = [header];
  let frames = 0;
  let omitted = 0;
  const raw = stack.length > MAX_RAW_STACK_LENGTH ? stack.slice(0, MAX_RAW_STACK_LENGTH) : stack;
  for (const line of raw.split('\n', 1000)) {
    if (!STACK_FRAME.test(line)) continue;
    if (frames < MAX_STACK_FRAMES) {
      kept.push(line);
      frames += 1;
    } else {
      omitted += 1;
    }
  }
  if (omitted > 0) kept.push(`    ... ${String(omitted)} more frames`);
  return kept.join('\n');
}

/** String form of a primitive, without relying on Object's default stringification. */
function primitiveText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'symbol':
      return value.toString();
    default:
      return typeof value;
  }
}

function serializeNonError(value: unknown): SerializedError {
  if (value === null) return { name: 'null', value: 'null' };
  if (isObjectLike(value)) {
    return { name: typeof value, value: `[${typeof value} ${constructorName(value) ?? 'unknown'}]` };
  }
  return { name: typeof value, value: redactString(primitiveText(value)) };
}

function pathSegment(segment: unknown): string {
  if (typeof segment === 'number') return String(segment);
  return typeof segment === 'string' ? sanitiseKey(segment) : '?';
}

/** A Joi `ValidationError`: its message echoes the rejected value (`"x" with value "…"`), so paths and types only. */
function joiDetails(value: object, name: string): SerializedValidationDetail[] | undefined {
  if (name !== 'ValidationError') return undefined;
  const details = ownDataProperty(value, 'details');
  if (!Array.isArray(details)) return undefined;
  return details.slice(0, MAX_VALIDATION_DETAILS).map((detail: unknown) => {
    const path = ownDataProperty(detail, 'path');
    const type = ownString(detail, 'type');
    return {
      path: Array.isArray(path) ? path.slice(0, MAX_PATH_SEGMENTS).map(pathSegment).join('.') : '',
      type: type !== undefined && JOI_RULE_TYPE.test(type) ? type : 'unknown',
    };
  });
}

function serializeError(value: object, depth: number): SerializedError {
  const name = errorName(value);
  const details = joiDetails(value, name);
  if (details !== undefined) return { name, details };
  const raw = ownString(value, 'message');
  const message = raw === undefined ? undefined : redactString(raw);
  const stack = readStack(value);
  const code = ownDataProperty(value, 'code');
  const hasCause = depth < MAX_CAUSE_DEPTH && hasOwnKey(value, 'cause');
  const cause = hasCause ? serializeAt(ownDataProperty(value, 'cause'), depth + 1) : undefined;
  // The full message is in `message`; the header repeats at most its start (PR20-SEC-07).
  const header = message === undefined || message === '' ? name : `${name}: ${message.slice(0, MAX_HEADER_MESSAGE_LENGTH)}`;
  return {
    name,
    ...(message === undefined ? {} : { message }),
    ...(stack === undefined ? {} : { stack: redactString(capFrames(header, stack)) }),
    ...(typeof code === 'string' && SHORT_CODE.test(code) ? { code } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
}

function serializeAt(thrown: unknown, depth: number): SerializedError {
  try {
    if (!isObjectLike(thrown)) return serializeNonError(thrown);
    if (isDatabaseError(thrown)) return serializeDatabaseError(thrown);
    return isErrorLike(thrown) ? serializeError(thrown, depth) : serializeNonError(thrown);
  } catch {
    return { name: 'Error' };
  }
}

/** The `err` value for anything thrown (Errors, database errors, non-errors, hostile Proxies). Never throws. */
export function serializeThrown(thrown: unknown): SerializedError {
  return serializeAt(thrown, 0);
}
