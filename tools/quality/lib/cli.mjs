// @ts-check
/**
 * Small CLI helpers shared by the traceability tools (TASK-277): argument parsing without a dependency, deterministic
 * JSON output, the default repository root, log-safe output lines and the confined, link-refusing output writer.
 */
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root of this checkout (tools/quality/lib/ is three levels below it). */
export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Committed lane B evidence (check-evidence hashes every file in it); the tools never write below it. */
export const EVIDENCE_PATH = 'docs/05-quality/tests/runs';

/** Upper bound of one stderr line (a message may carry a repository-controlled fragment). */
const MAX_ERR_LINE = 2_000;

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
 * A value made safe for one log line: control characters (C0 including CR and LF, DEL, C1) and the Unicode line and
 * paragraph separators become a space, so no physical line of output can start a GitHub workflow command
 * (PR35-SEC-03; the `clean` rule of tools/ci/openapi-breaking.mjs).
 * @param {string} value
 */
export function clean(value) {
  return Array.from(value, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? ' ' : ch;
  }).join('');
}

/**
 * Wraps an Io so every stderr message is one cleaned, bounded line and every stdout line is cleaned. stdout keeps its
 * line feeds because the tools print `stableJson` documents there, whose strings JSON already escapes.
 * @param {Io} io
 * @returns {Io}
 */
export function safeIo(io) {
  return {
    out: (text) => io.out(text.split('\n').map(clean).join('\n')),
    err: (text) => io.err(clean(text).slice(0, MAX_ERR_LINE)),
  };
}

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
 * Root-relative path segments of `path`, or undefined when it is the root itself or outside it.
 * @param {string} root absolute
 * @param {string} path absolute
 * @returns {string[] | undefined}
 */
export function segmentsBelow(root, path) {
  const rel = relative(root, path);
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return undefined;
  return rel.split(sep);
}

/**
 * The first existing path component strictly below `root`, up to and including `path`, that is a symbolic link or a
 * junction (root-relative, `/`-separated); undefined when there is none. A missing component ends the walk.
 * @param {string} root absolute
 * @param {string} path absolute path inside root
 */
export function firstLink(root, path) {
  const segments = segmentsBelow(root, path) ?? [];
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return undefined;
    }
    if (stat.isSymbolicLink()) return segments.slice(0, index + 1).join('/');
  }
  return undefined;
}

/**
 * Resolves an output path (`--out` relative to the working directory, or the tool's default relative to the root) and
 * confines it (PR35-SEC-01): a file strictly inside the root and outside the committed evidence tree.
 * @param {string} root absolute
 * @param {string | undefined} requested `--out` value
 * @param {string} fallback root-relative, `/`-separated default
 * @returns {string} absolute path
 */
export function resolveOutput(root, requested, fallback) {
  const out = requested === undefined ? join(root, ...fallback.split('/')) : resolve(requested);
  const segments = segmentsBelow(root, out);
  if (segments === undefined) throw new UsageError('--out must name a file inside --root');
  if (EVIDENCE_PATH.split('/').every((part, i) => segments[i]?.toLowerCase() === part))
    throw new UsageError(`--out must not be inside ${EVIDENCE_PATH} (committed evidence: every file there needs a hash)`);
  return out;
}

/**
 * Writes `text` to a path returned by `resolveOutput` without following links (PR35-SEC-01): every existing component
 * below the root must be a real directory (missing ones are created), an existing target must be a regular file, and
 * the bytes go to a fresh temporary file that is renamed over the target, so a link (hard, symbolic or junction)
 * planted at the target is replaced, never written through.
 * @param {string} root absolute
 * @param {string} out absolute, from resolveOutput
 * @param {string} text
 */
export function writeOutput(root, out, text) {
  const segments = segmentsBelow(root, out);
  if (segments === undefined) throw new UsageError('--out must name a file inside --root');
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const last = index === segments.length - 1;
    const where = segments.slice(0, index + 1).join('/');
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      if (!last) mkdirSync(current);
      continue;
    }
    if (stat.isSymbolicLink()) throw new UsageError(`--out: ${where} is a symbolic link or junction (links are not followed)`);
    if (last ? !stat.isFile() : !stat.isDirectory())
      throw new UsageError(`--out: ${where} is not a ${last ? 'regular file' : 'directory'}`);
  }
  const temp = `${out}.${process.pid}.tmp`;
  // `wx` fails on an existing name, so the temporary file is always one this call created (and may remove).
  writeFileSync(temp, text, { flag: 'wx', mode: 0o644 });
  try {
    renameSync(temp, out);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
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
