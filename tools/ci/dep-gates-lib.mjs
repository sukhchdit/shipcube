// @ts-check
/**
 * Shared model for the lane A dependency gates (TASK-007): lockfile parsing, production/dev closures, workspace
 * matching, dependency resolution, dated registers and the common CLI plumbing of `check-lockfile`, `check-dep-age`,
 * `licence-check` and `check-audit`.
 *
 * Controls: ADR-0023 am. F items 2-3, am. I item 7, am. J items 1 (b), 3 and 4; D-ARCH-003 rev 2-4; D-ARCH-020;
 * D-ARCH-040; SEC-FU-PR1 (closures are computed from the lockfile `dev` / `optional` / `devOptional` flags, which is
 * what `npm ci --omit=dev --omit=optional` installs, never from `npm ls`).
 *
 * Plain ESM, `node:` built-ins only, no network. The only child process is `git show <ref>:package-lock.json`
 * (argument vector, no shell, 30 s timeout).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

/**
 * @typedef {{
 *   version?: string, name?: string, resolved?: string, integrity?: string, link?: boolean,
 *   dev?: boolean, optional?: boolean, devOptional?: boolean, peer?: boolean, inBundle?: boolean,
 *   license?: unknown, licenses?: unknown, deprecated?: string, private?: boolean,
 *   dependencies?: Record<string, string>, optionalDependencies?: Record<string, string>,
 *   peerDependencies?: Record<string, string>, devDependencies?: Record<string, string>,
 *   workspaces?: string[]
 * }} LockEntry
 * @typedef {{ lockfileVersion?: unknown, packages?: Record<string, LockEntry> }} Lockfile
 * @typedef {{ rule: string, message: string, location: string }} Finding
 * @typedef {{ name: string, version: string, keys: string[], production: boolean, integrities: Set<string> }} Tuple
 */

export const NPM_REGISTRY = 'https://registry.npmjs.org/';
const DAY_MS = 86_400_000;
const GIT_TIMEOUT_MS = 30_000;

/** Package name for a lockfile key (`node_modules/a/node_modules/@s/b` -> `@s/b`); `undefined` for folder keys. */
export function packageNameFromKey(/** @type {string} */ key) {
  const index = key.lastIndexOf('node_modules/');
  return index < 0 ? undefined : key.slice(index + 'node_modules/'.length);
}

/** Real package name: aliases (`node_modules/x` -> `npm:@s/y@1`) carry it in `name` (ADR-0023 am. I item 7). */
export function entryName(/** @type {string} */ key, /** @type {LockEntry} */ entry) {
  return entry.name ?? packageNameFromKey(key) ?? key;
}

/** A folder entry (workspace or `file:` directory) has no `node_modules/` segment; `''` is the root project. */
export function isFolderKey(/** @type {string} */ key) {
  return key !== '' && !key.includes('node_modules/');
}

/** Installed by `npm ci --omit=dev --omit=optional` (D-ARCH-038, SEC-FU-PR1 note 1). */
export function inProductionClosure(/** @type {LockEntry} */ entry) {
  return entry.dev !== true && entry.optional !== true && entry.devOptional !== true;
}

/** `apps/*` style workspace globs: `*` stays inside one path segment, `**` crosses segments. */
export function matchesWorkspace(/** @type {string} */ dir, /** @type {readonly string[]} */ globs) {
  return globs.some((glob) => {
    const source = glob
      .replace(/\/+$/, '')
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    return new RegExp(`^${source}$`).test(dir);
  });
}

/** Workspace globs from the lockfile root entry (`packages[""].workspaces`), which mirrors the root package.json. */
export function workspaceGlobs(/** @type {Lockfile} */ lock) {
  const globs = lock.packages?.['']?.workspaces;
  return Array.isArray(globs) ? globs.filter((glob) => typeof glob === 'string') : [];
}

/** Registry-sourced package entries: not the root, not a folder, not a link, not bundled inside a parent tarball. */
export function* registryEntries(/** @type {Lockfile} */ lock) {
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === '' || isFolderKey(key) || entry.link === true || entry.inBundle === true) continue;
    yield /** @type {[string, LockEntry]} */ ([key, entry]);
  }
}

/** `name@version` tuples of the registry entries, with their closure and integrities. */
export function tuplesOf(/** @type {Lockfile} */ lock) {
  /** @type {Map<string, Tuple>} */
  const tuples = new Map();
  for (const [key, entry] of registryEntries(lock)) {
    const name = entryName(key, entry);
    const version = entry.version ?? '(no version)';
    const id = `${name}@${version}`;
    const tuple = tuples.get(id) ?? { name, version, keys: [], production: false, integrities: new Set() };
    tuple.keys.push(key);
    tuple.production ||= inProductionClosure(entry);
    if (typeof entry.integrity === 'string') tuple.integrities.add(entry.integrity);
    tuples.set(id, tuple);
  }
  return tuples;
}

/** Names declared by the root project or a workspace folder (direct dependencies, any dependency field). */
export function directDependencyNames(/** @type {Lockfile} */ lock) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key !== '' && !isFolderKey(key)) continue;
    for (const field of /** @type {const} */ (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])) {
      for (const name of Object.keys(entry[field] ?? {})) if (!name.startsWith('@platform/')) names.add(name);
    }
  }
  return names;
}

/**
 * Node's resolution over lockfile keys: the nearest `node_modules/<dep>` walking up from `fromKey`; link entries
 * are followed to their folder. Returns `undefined` for an unresolved (for example uninstalled optional) edge.
 */
export function resolveDependency(
  /** @type {Record<string, LockEntry>} */ packages,
  /** @type {string} */ fromKey,
  /** @type {string} */ dep,
) {
  let base = fromKey;
  for (;;) {
    const candidate = base === '' ? `node_modules/${dep}` : `${base}/node_modules/${dep}`;
    const entry = packages[candidate];
    if (entry !== undefined) {
      return entry.link === true && typeof entry.resolved === 'string' ? entry.resolved : candidate;
    }
    if (base === '') return undefined;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

/** Reverse edges: lockfile key -> keys of the entries that depend on it (installed edges only). */
export function dependentsIndex(/** @type {Lockfile} */ lock) {
  const packages = lock.packages ?? {};
  /** @type {Map<string, Set<string>>} */
  const index = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    if (entry.link === true) continue;
    const fields = /** @type {const} */ (['dependencies', 'optionalDependencies', 'peerDependencies']);
    const declared = fields.flatMap((field) => Object.keys(entry[field] ?? {}));
    if (key === '' || isFolderKey(key)) declared.push(...Object.keys(entry.devDependencies ?? {}));
    for (const dep of declared) {
      const target = resolveDependency(packages, key, dep);
      if (target === undefined) continue;
      const set = index.get(target) ?? new Set();
      set.add(key);
      index.set(target, set);
    }
  }
  return index;
}

/** Strict `YYYY-MM-DD` or ISO-8601 timestamp; anything else is a register error. */
export function parseDate(/** @type {unknown} */ value, /** @type {string} */ field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new RegisterError(`${field}: expected YYYY-MM-DD or an ISO-8601 timestamp, got ${JSON.stringify(value)}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RegisterError(`${field}: invalid date ${value}`);
  return date;
}

/** An entry expires AT `expires` (00:00Z of that day): on the expiry date it no longer applies. */
export function isExpired(/** @type {string} */ expires, /** @type {Date} */ now) {
  return now.getTime() >= parseDate(expires, 'expires').getTime();
}

export function daysUntil(/** @type {string} */ date, /** @type {Date} */ now) {
  return Math.floor((parseDate(date, 'date').getTime() - now.getTime()) / DAY_MS);
}

/** Usage, register or input-format error: the CLI exits 2. */
export class RegisterError extends Error {
  /** @override */
  name = 'RegisterError';
}

/**
 * Validates one register list: every entry is an object holding the required non-empty string fields; dated
 * fields parse. Returns the entries; a malformed register is a usage error (exit 2), never a silent pass.
 * @param {unknown} data @param {string} listKey @param {readonly string[]} required @param {readonly string[]} dates
 * @returns {Array<Record<string, unknown>>}
 */
export function validateRegister(data, listKey, required, dates) {
  if (typeof data !== 'object' || data === null) throw new RegisterError(`register is not a JSON object`);
  const list = /** @type {Record<string, unknown>} */ (data)[listKey];
  if (!Array.isArray(list)) throw new RegisterError(`register lacks the "${listKey}" array`);
  return list.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new RegisterError(`${listKey}[${index}] is not an object`);
    const entry = /** @type {Record<string, unknown>} */ (item);
    for (const field of required) {
      const value = entry[field];
      const ok = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
      if (!ok) throw new RegisterError(`${listKey}[${index}].${field} is required`);
    }
    for (const field of dates) if (entry[field] !== undefined) parseDate(entry[field], `${listKey}[${index}].${field}`);
    return entry;
  });
}

export function readJsonFile(/** @type {string} */ path) {
  return /** @type {unknown} */ (JSON.parse(readFileSync(path, 'utf8')));
}

export function readLockfile(/** @type {string} */ root) {
  return /** @type {Lockfile} */ (readJsonFile(join(root, 'package-lock.json')));
}

/** The base revision's lockfile through `git show` (argument vector, no shell; a ref may not start with `-`). */
export function readBaseLockfile(/** @type {string} */ root, /** @type {string} */ ref) {
  if (ref.startsWith('-') || /\s/.test(ref)) throw new RegisterError(`--base: invalid git ref ${JSON.stringify(ref)}`);
  const text = execFileSync('git', ['show', `${ref}:package-lock.json`], {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return /** @type {Lockfile} */ (JSON.parse(text));
}

/** Tuples present in `head` but not in `base` (the PR delta of SEC-TC-32 / am. F item 2). */
export function newTupleIds(/** @type {Lockfile} */ base, /** @type {Lockfile} */ head) {
  const before = tuplesOf(base);
  return new Set([...tuplesOf(head).keys()].filter((id) => !before.has(id)));
}

export const formatFinding = (/** @type {Finding} */ finding) => `${finding.rule}: ${finding.message} (${finding.location})`;

/** Markdown-safe table cell. */
export const cell = (/** @type {unknown} */ value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * Common CLI driver. `run` receives the parsed flags and returns findings, report-only notes and a Markdown
 * summary. Exit 0 = pass, 1 = policy finding(s), 2 = usage or internal error.
 * @param {string} tool
 * @param {import('node:util').ParseArgsConfig['options']} options
 * @param {(values: Record<string, string | boolean | undefined>) => Promise<{ findings: Finding[], notes: Finding[], markdown: string, json?: unknown }> | { findings: Finding[], notes: Finding[], markdown: string, json?: unknown }} run
 * @param {string[]} argv
 */
export async function runCli(tool, options, run, argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { root: { type: 'string' }, summary: { type: 'string' }, json: { type: 'boolean' }, ...options },
      strict: true,
      allowPositionals: false,
    });
    const flags = /** @type {Record<string, string | boolean | undefined>} */ (values);
    const root = typeof flags.root === 'string' ? flags.root : process.cwd();
    if (!existsSync(join(root, 'package.json'))) throw new RegisterError(`--root ${root} holds no package.json`);
    const result = await run({ ...flags, root });
    if (typeof flags.summary === 'string') appendFileSync(flags.summary, `${result.markdown}\n`);
    if (flags.json === true) {
      process.stdout.write(
        `${JSON.stringify({ tool, pass: result.findings.length === 0, findings: result.findings, notes: result.notes, ...(result.json === undefined ? {} : { data: result.json }) }, null, 2)}\n`,
      );
    } else {
      for (const finding of result.findings) process.stderr.write(`${formatFinding(finding)}\n`);
      for (const note of result.notes) process.stdout.write(`note ${formatFinding(note)}\n`);
      process.stdout.write(`${tool}: ${result.findings.length === 0 ? 'PASS' : `FAIL (${result.findings.length} finding(s))`}\n`);
    }
    return result.findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${tool}: error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
