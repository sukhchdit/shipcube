// Redaction of structured log fields (US-008 AT-US-008-04/05, REQ-PLAT-012, NFR-PRIV-001; SEC-TC-31; PR6-SEC-02 item 3;
// TASK-010). `redactValue` deep-walks any value into a bounded, JSON-safe copy: sensitive keys become REDACTED, body and
// URL keys OMITTED, strings pass the string redactor, errors the error serializer. Only own enumerable data properties
// are read (getters are never invoked); depth, keys, array items and total nodes are capped.
import { types } from 'node:util';

import { hasOwnKey, isObjectLike, ownString } from './own-property.js';
import { serializeThrown } from './serializers/error.js';
import { isOmittedKey, isSensitiveKey, OMITTED, REDACTED, redactString, sanitiseKey } from './string-redaction.js';

export {
  isOmittedKey,
  isSensitiveKey,
  maskEmails,
  MAX_STRING_LENGTH,
  normaliseKey,
  OMITTED,
  REDACTED,
  redactString,
  TRUNCATION_SUFFIX,
} from './string-redaction.js';

/** Objects nested deeper than this are written as TRUNCATED. */
export const MAX_DEPTH = 8;
/** Keys kept per object; the rest are summarised under MORE_KEY. */
export const MAX_KEYS = 100;
/** Items kept per array; the rest are summarised by a `[+N more]` item. */
export const MAX_ITEMS = 50;
/** Values visited per call; later values are written as TRUNCATED (bounds the size of one line). */
export const MAX_NODES = 2000;

export const TRUNCATED = '[Truncated]';
export const CIRCULAR = '[Circular]';
export const BINARY = '[Binary]';
export const UNSUPPORTED = '[Unsupported]';
export const UNREADABLE = '[Unreadable]';
/** Key under which an object's surplus key count is written. */
export const MORE_KEY = '[more]';

const more = (count: number): string => `[+${String(count)} more]`;

interface WalkState {
  readonly ancestors: Set<object>;
  nodes: number;
}

function isBinary(value: object): boolean {
  return types.isAnyArrayBuffer(value) || types.isArrayBufferView(value);
}

function isUnsupportedCollection(value: object): boolean {
  return types.isMap(value) || types.isSet(value) || types.isWeakMap(value) || types.isWeakSet(value);
}

/** Errors (any realm) and error-like objects: an own string `message` together with an own `stack`. */
function isErrorInstance(value: object): boolean {
  if (types.isNativeError(value) || value instanceof Error) return true;
  return ownString(value, 'message') !== undefined && hasOwnKey(value, 'stack');
}

function walkArray(value: readonly unknown[], depth: number, state: WalkState): unknown[] {
  const length = value.length;
  const output: unknown[] = [];
  for (let index = 0; index < Math.min(length, MAX_ITEMS); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    output.push(descriptor !== undefined && 'value' in descriptor ? walk(descriptor.value, depth + 1, state) : null);
  }
  if (length > MAX_ITEMS) output.push(more(length - MAX_ITEMS));
  return output;
}

function walkObject(value: object, depth: number, state: WalkState): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys = Object.keys(value);
  for (const key of keys.slice(0, MAX_KEYS)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const child: unknown = descriptor.value;
    if (typeof child === 'function' || typeof child === 'symbol') continue;
    const outputKey = sanitiseKey(key);
    if (isOmittedKey(key)) output[outputKey] = OMITTED;
    else if (isSensitiveKey(key)) output[outputKey] = REDACTED;
    else output[outputKey] = walk(child, depth + 1, state);
  }
  if (keys.length > MAX_KEYS) output[MORE_KEY] = more(keys.length - MAX_KEYS);
  return output;
}

function walkObjectLike(value: object, depth: number, state: WalkState): unknown {
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (state.ancestors.has(value)) return CIRCULAR;
  if (isBinary(value)) return BINARY;
  if (types.isDate(value)) {
    const time = Date.prototype.getTime.call(value);
    return Number.isNaN(time) ? 'Invalid Date' : new Date(time).toISOString();
  }
  if (isUnsupportedCollection(value)) return UNSUPPORTED;
  if (isErrorInstance(value)) return serializeThrown(value);
  state.ancestors.add(value);
  try {
    return Array.isArray(value) ? walkArray(value, depth, state) : walkObject(value, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

function walk(value: unknown, depth: number, state: WalkState): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) return TRUNCATED;
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
    case 'boolean':
    case 'undefined':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
    default:
      if (!isObjectLike(value)) return null;
      try {
        return walkObjectLike(value, depth, state);
      } catch {
        return UNREADABLE;
      }
  }
}

/**
 * A redacted, bounded, JSON-safe copy of `value` (log fields and bindings). Never throws: a value whose inspection
 * throws (a Proxy trap) is written as UNREADABLE.
 */
export function redactValue(value: unknown): unknown {
  return walk(value, 0, { ancestors: new Set<object>(), nodes: 0 });
}
