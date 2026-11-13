// Redaction of structured log fields (US-008 AT-US-008-04/05, REQ-PLAT-012, NFR-PRIV-001; SEC-TC-31; PR6-SEC-02 item 3;
// PR20-SEC-01/02/07; TASK-010). `redactValue` deep-walks any value into a bounded, JSON-safe copy: sensitive and PII keys
// become REDACTED, body and URL keys OMITTED, strings pass the string redactor, errors the error serializer. Only own
// enumerable data properties are read (getters are never invoked). Live HTTP and stream objects (`req`, `res`, sockets:
// every EventEmitter) are never walked, `[name, value]` pairs in arrays (`rawHeaders`, `Object.entries(headers)`) are
// classified by the name, and depth, keys, array items, total nodes and the characters processed per call are capped.
import { EventEmitter } from 'node:events';
import { types } from 'node:util';

import { hasOwnKey, isObjectLike, ownString } from './own-property.js';
import { serializeThrown } from './serializers/error.js';
import {
  isOmittedKey,
  isPiiKey,
  isSensitiveChildKey,
  isSensitiveKey,
  MAX_STRING_LENGTH,
  OMITTED,
  REDACTED,
  redactString,
  sanitiseKey,
  TRUNCATION_SUFFIX,
} from './string-redaction.js';

export {
  escapeLineBreakers,
  isOmittedKey,
  isPiiKey,
  isSensitiveChildKey,
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
/** Values visited per call; later values are written as TRUNCATED. */
export const MAX_NODES = 2000;
/**
 * String and key characters processed per call (the per-line budget, PR #20 m5, PR20-SEC-07): once spent, later values
 * are TRUNCATED and later keys summarised, so one call costs milliseconds and its fields stay near 16 KiB, below the
 * Docker json-file line split, whatever is logged.
 */
export const MAX_LINE_CHARS = 16_384;

export const TRUNCATED = '[Truncated]';
export const CIRCULAR = '[Circular]';
export const BINARY = '[Binary]';
export const UNSUPPORTED = '[Unsupported]';
export const UNREADABLE = '[Unreadable]';
/** Key under which an object's surplus key count is written. */
export const MORE_KEY = '[more]';

const more = (count: number): string => `[+${String(count)} more]`;

/** Aggregate counters (`distinct_address_count`, `addressCount`) are numbers, not PII; `email_account` is not one. */
const COUNT_SUFFIX = /(?:[_\-. ]count|[a-z0-9]Count)$/;

interface WalkState {
  readonly ancestors: Set<object>;
  nodes: number;
  /** Characters processed so far (string inputs and keys); see MAX_LINE_CHARS. */
  chars: number;
}

function budgetSpent(state: WalkState): boolean {
  return state.chars >= MAX_LINE_CHARS;
}

function isBinary(value: object): boolean {
  return types.isAnyArrayBuffer(value) || types.isArrayBufferView(value);
}

function isUnsupportedCollection(value: object): boolean {
  return types.isMap(value) || types.isSet(value) || types.isWeakMap(value) || types.isWeakSet(value);
}

/**
 * Live HTTP and stream objects: IncomingMessage, ServerResponse, ClientRequest, Socket, TLSSocket and every other
 * EventEmitter. Their own properties hold raw headers, parsed URLs with query strings and back-references to each
 * other, so they are never walked (PR20-SEC-01): log the fields you need (method, route template, status) instead.
 */
function isLiveObject(value: object): boolean {
  return value instanceof EventEmitter;
}

/** Errors (any realm) and error-like objects: an own string `message` together with an own `stack`. */
function isErrorInstance(value: object): boolean {
  if (types.isNativeError(value) || value instanceof Error) return true;
  return ownString(value, 'message') !== undefined && hasOwnKey(value, 'stack');
}

/** PII-named keys (general lines too, PR20-SEC-02), except aggregate counters. */
function isPiiField(key: string): boolean {
  return isPiiKey(key) && !COUNT_SUFFIX.test(key);
}

/** The marker a value under `key` is written as, or undefined when the value is walked. */
function keyMarker(key: string, parentKey: string | undefined): string | undefined {
  if (isOmittedKey(key)) return OMITTED;
  if (isSensitiveKey(key) || isPiiField(key)) return REDACTED;
  if (parentKey !== undefined && isSensitiveChildKey(parentKey, key)) return REDACTED;
  return undefined;
}

/** A string redacted and cut to the remaining budget (redacted first, so a cut never exposes a partial secret). */
function walkString(value: string, state: WalkState): string {
  if (budgetSpent(state)) return TRUNCATED;
  const remaining = MAX_LINE_CHARS - state.chars;
  const redacted = redactString(value);
  state.chars += Math.max(Math.min(value.length, MAX_STRING_LENGTH), redacted.length);
  return redacted.length > remaining ? `${redacted.slice(0, remaining)}${TRUNCATION_SUFFIX}` : redacted;
}

/** Own data item `index` of an array; undefined for holes and accessors. */
function arrayItem(value: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, index);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Items of an array. An item that follows a string naming a sensitive or omitted key is written as that key's marker,
 * so the alternating `[name, value, …]` of `rawHeaders` / `rawTrailers` and the `[name, value]` tuples of
 * `Object.entries(headers)` are redacted like an object would be (PR20-SEC-01 item 2).
 */
function walkArray(value: readonly unknown[], depth: number, state: WalkState): unknown[] {
  const length = value.length;
  const output: unknown[] = [];
  let previous: unknown;
  for (let index = 0; index < Math.min(length, MAX_ITEMS); index += 1) {
    const item = arrayItem(value, index);
    const marker = typeof previous === 'string' ? pairMarker(previous) : undefined;
    output.push(marker ?? walk(item, depth + 1, state, undefined));
    previous = item;
  }
  if (length > MAX_ITEMS) output.push(more(length - MAX_ITEMS));
  return output;
}

function pairMarker(name: string): string | undefined {
  if (isOmittedKey(name)) return OMITTED;
  return isSensitiveKey(name) ? REDACTED : undefined;
}

function walkObject(value: object, depth: number, state: WalkState, parentKey: string | undefined): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys = Object.keys(value);
  let written = 0;
  for (const key of keys.slice(0, MAX_KEYS)) {
    if (budgetSpent(state)) break;
    written += 1;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const child: unknown = descriptor.value;
    if (typeof child === 'function' || typeof child === 'symbol') continue;
    const outputKey = sanitiseKey(key);
    state.chars += outputKey.length;
    output[outputKey] = keyMarker(key, parentKey) ?? walk(child, depth + 1, state, key);
  }
  if (keys.length > written) output[MORE_KEY] = more(keys.length - written);
  return output;
}

/** An error value in the fields, charged to the budget by the size of its message and stack. */
function serializedError(value: object, state: WalkState): unknown {
  const serialized = serializeThrown(value);
  state.chars += (serialized.message?.length ?? 0) + (serialized.stack?.length ?? 0) + serialized.name.length;
  return serialized;
}

function walkObjectLike(value: object, depth: number, state: WalkState, parentKey: string | undefined): unknown {
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (state.ancestors.has(value)) return CIRCULAR;
  if (isBinary(value)) return BINARY;
  if (types.isDate(value)) {
    const time = Date.prototype.getTime.call(value);
    return Number.isNaN(time) ? 'Invalid Date' : new Date(time).toISOString();
  }
  if (isUnsupportedCollection(value) || isLiveObject(value)) return UNSUPPORTED;
  if (isErrorInstance(value)) return serializedError(value, state);
  state.ancestors.add(value);
  try {
    return Array.isArray(value) ? walkArray(value, depth, state) : walkObject(value, depth, state, parentKey);
  } finally {
    state.ancestors.delete(value);
  }
}

function walk(value: unknown, depth: number, state: WalkState, parentKey: string | undefined): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) return TRUNCATED;
  switch (typeof value) {
    case 'string':
      return walkString(value, state);
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
      if (budgetSpent(state)) return TRUNCATED;
      try {
        return walkObjectLike(value, depth, state, parentKey);
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
  return walk(value, 0, { ancestors: new Set<object>(), nodes: 0, chars: 0 }, undefined);
}
