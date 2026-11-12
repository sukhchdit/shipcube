// Serialises anything a caller can throw into the `err` key of a log line (US-007 AT-US-007-03, US-008, PR7-SEC-03
// item 3; TASK-010). Database errors get the identifier-only shape of prisma-error.ts; other errors keep their name,
// redacted message and redacted, frame-capped stack; non-errors their type and a redacted string form. Thrown values
// are untrusted: only own data properties are read (the V8 stack accessor is the one exception, see readStack) and an
// inspection that throws degrades to `{ name: 'Error' }`, so serialising can never throw into the caller.
import { types } from 'node:util';

import { constructorName, hasOwnKey, isObjectLike, ownDataProperty, ownString } from '../own-property.js';
import { redactString } from '../string-redaction.js';
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
}

/** Causes serialised below the thrown value. */
export const MAX_CAUSE_DEPTH = 3;
/** Stack frames kept (header lines are kept too). */
export const MAX_STACK_FRAMES = 20;

const SHORT_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const STACK_FRAME = /^\s+at /;

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

function isNativeFunction(fn: unknown): boolean {
  try {
    return typeof fn === 'function' && Function.prototype.toString.call(fn).endsWith('{ [native code] }');
  } catch {
    return false;
  }
}

/**
 * The stack of an error. Node 24 exposes `stack` as an own accessor installed by V8, so a data property is read
 * directly and an accessor is invoked only when it is native code (V8's), never a user-defined getter.
 */
function readStack(value: object): string | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'stack');
    if (descriptor === undefined) return undefined;
    if ('value' in descriptor) return typeof descriptor.value === 'string' ? descriptor.value : undefined;
    const getter: unknown = Reflect.get(descriptor, 'get');
    if (typeof getter !== 'function' || !isNativeFunction(getter)) return undefined;
    const stack: unknown = Reflect.apply(getter, value, []);
    return typeof stack === 'string' ? stack : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the header lines and the first MAX_STACK_FRAMES frames. */
function capFrames(stack: string): string {
  const kept: string[] = [];
  let frames = 0;
  let omitted = 0;
  for (const line of stack.split('\n', 1000)) {
    if (!STACK_FRAME.test(line)) {
      if (frames === 0) kept.push(line);
    } else if (frames < MAX_STACK_FRAMES) {
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

function serializeError(value: object, depth: number): SerializedError {
  const message = ownString(value, 'message');
  const stack = readStack(value);
  const code = ownDataProperty(value, 'code');
  const hasCause = depth < MAX_CAUSE_DEPTH && hasOwnKey(value, 'cause');
  const cause = hasCause ? serializeAt(ownDataProperty(value, 'cause'), depth + 1) : undefined;
  return {
    name: errorName(value),
    ...(message === undefined ? {} : { message: redactString(message) }),
    ...(stack === undefined ? {} : { stack: redactString(capFrames(stack)) }),
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
