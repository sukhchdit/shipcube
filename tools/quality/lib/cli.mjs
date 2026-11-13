// @ts-check
/**
 * Small CLI helpers shared by the traceability tools (TASK-277): argument parsing without a dependency, deterministic
 * JSON output and the default repository root.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root of this checkout (tools/quality/lib/ is three levels below it). */
export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * @typedef {{ out: (line: string) => void, err: (line: string) => void }} Io
 */

/** @type {Io} */
export const CONSOLE_IO = { out: (line) => console.log(line), err: (line) => console.error(line) };

/**
 * Parses `--flag value` pairs and boolean flags; anything else is a usage error.
 * @param {readonly string[]} argv
 * @param {readonly string[]} valueFlags
 * @param {readonly string[]} booleanFlags
 * @returns {Map<string, string | true>}
 */
export function parseArgs(argv, valueFlags, booleanFlags) {
  /** @type {Map<string, string | true>} */
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = /** @type {string} */ (argv[i]);
    if (args.has(flag)) throw new UsageError(`${flag} given twice`);
    if (booleanFlags.includes(flag)) args.set(flag, true);
    else if (valueFlags.includes(flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      args.set(flag, value);
      i += 1;
    } else throw new UsageError(`unknown argument ${flag}`);
  }
  return args;
}

/**
 * JSON with object keys sorted at every level, two-space indented, ending with a newline.
 * @param {unknown} value
 */
export function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(/** @type {Record<string, unknown>} */ (value)[key])]),
    );
  return value;
}

/**
 * Ratio rounded to 4 decimals (0 when the denominator is 0).
 * @param {number} numerator
 * @param {number} denominator
 */
export function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 10_000;
}
