/** Helpers shared by the backend and the web build loaders. Pure: no process or file access. */

/** Environment input as received from the edge (`process.env`, a parsed file or a test record). */
export type EnvInput = Readonly<Record<string, string | undefined>>;

/**
 * Copies the entries of `env` named in `keys`, dropping unset and empty values: Compose passes `${VAR:-}` as an
 * empty string, which means "not configured".
 */
export function pickConfigured(env: EnvInput, keys: readonly string[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== '') picked[key] = value;
  }
  return picked;
}

const isPlainContainer = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);

/**
 * Freezes plain objects and arrays recursively. Class instances (`Secret`) freeze themselves, and typed arrays
 * cannot be frozen, so both are left as they are.
 */
export function deepFreeze<T>(value: T): T {
  if (isPlainContainer(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
