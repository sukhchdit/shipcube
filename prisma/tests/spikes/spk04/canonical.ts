/**
 * SPK-04 (TASK-018) THROWAWAY: a small exact RFC 8785 (JCS) serialiser for the audit-chain prototype.
 *
 * `canonicalize` is not a dependency of this workspace (data-model §5.4 names it for packages/audit, TASK-030), so the
 * spike carries its own: object keys sorted by UTF-16 code units, strings and finite numbers serialised with the
 * ECMAScript `JSON.stringify` rules (RFC 8785 §3.2.2.2/§3.2.2.3), arrays in order, no whitespace. Non-finite numbers,
 * `undefined`, functions, symbols, bigints and non-plain objects are rejected rather than silently dropped.
 */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Reflect.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** UTF-16 code-unit order (RFC 8785 §3.2.3); the default string comparison of JavaScript. */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError('non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalize(item)).join(',')}]`;
      if (!isPlainObject(value)) throw new CanonicalJsonError('non-plain object');
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .sort(byCodeUnits)
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
      return `{${members.join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(`unsupported ${typeof value}`);
  }
}
