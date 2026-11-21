/**
 * The canonical JSON text of a pricing configuration (code review R1-m2, D-TASK080-15; TASK-080): the bytes whose
 * SHA-256 is a version's `content_sha256` (data-model §3.9). It does not depend on how the object was built, so US-152,
 * which materialises a configuration from rule rows, reproduces the hash of the same rules:
 *  - object keys in ascending UTF-16 code-unit order (the order of `Array.prototype.sort` without a comparator),
 *    at every depth; array order is kept (rule order is data);
 *  - no white space; strings and numbers as `JSON.stringify` writes them;
 *  - only JSON values: `null`, booleans, finite numbers, strings, arrays and plain objects. `undefined`, a function, a
 *    symbol, a bigint, a non-finite number, an object with an `undefined` member or any non-plain object (a `Date`, a
 *    `Map`, a class instance) is refused with PRICING_CONFIG_INVALID, never silently dropped or converted.
 * Pure: no I/O, no clock; the hash itself is taken by the caller (the pricing package has no crypto).
 */
import { PricingError } from '../errors.js';

const invalid = (reason: string): never => {
  throw new PricingError('PRICING_CONFIG_INVALID', `configuration is not canonical JSON: ${reason}`);
};

/** Ascending UTF-16 code-unit order; the keys of one object are distinct, so no two compare equal. */
const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : 1);

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : invalid('a non-finite number');
  if (typeof value !== 'object') return invalid('a value that is not JSON');
  // Array.from reads a hole as undefined, which is refused (map would keep it and join would write `[,1]`).
  if (Array.isArray(value)) return `[${Array.from(value as readonly unknown[], (item) => canonical(item)).join(',')}]`;
  if (!isPlainObject(value)) return invalid('a non-plain object');
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort(byCodeUnit)
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
  return `{${members.join(',')}}`;
}

/** The canonical JSON text of `value` (sorted keys, no white space); throws PRICING_CONFIG_INVALID on a non-JSON value. */
export function canonicalJson(value: unknown): string {
  return canonical(value);
}
