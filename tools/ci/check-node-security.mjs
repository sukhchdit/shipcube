// @ts-check
/**
 * Node security-release comparison (PR87-SEC-01 (b); D-SECCHORE-01; D-DEVOPS-005). Local and zero hosted minutes:
 * the operator runs it at session start, before each lane B wave run and before G3/G4 (docs/07-ops/CI-CD.md section 6).
 *
 * It reads the version of the `node:` base of every repository Dockerfile (they are byte-identical, check-dockerfiles
 * runtime-codename (b)) and compares it with the newest release of the same major that nodejs.org marks
 * `security: true` in https://nodejs.org/dist/index.json. Dependabot's 7-day cooldown delays a security release by a
 * week (#50 offered 26.13.0 five days after 26.13.1), so a pin behind that release is a hand bump (section 6).
 *
 *   node tools/ci/check-node-security.mjs [--root <dir>] [--index <index.json>]
 *
 * Exit 0: the pin is at or above the newest security release of its major. Exit 1: it is behind (the message names
 * both versions). Exit 2: the check could not run (no or several node pins, unreadable index, network failure):
 * fail closed, never a silent pass. `--index` reads a saved copy of index.json instead of the network (tests, offline).
 * The GET has a 20 s timeout and 3 attempts with exponential backoff and jitter (idempotent read).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { findDockerfiles, instructions, nodeTagVersion, stages, versionParts } from './check-dockerfiles.mjs';

export const NODE_INDEX_URL = 'https://nodejs.org/dist/index.json';
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_ATTEMPTS = 3;

/** @typedef {{ version: string, date?: string, security?: boolean }} IndexEntry */

/** @param {readonly number[]} a @param {readonly number[]} b @returns {number} */
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Thrown when the check cannot run (exit 2). */
export class CheckError extends Error {}

/**
 * The distinct `node:` base versions of the repository Dockerfiles; exactly one full `x.y.z` is required.
 * @param {string} root @returns {string}
 */
export function pinnedNodeVersion(root) {
  const versions = new Set();
  for (const file of findDockerfiles(root)) {
    for (const stage of stages(instructions(readFileSync(join(root, file), 'utf8')))) {
      if (/^(?:docker\.io\/)?(?:library\/)?node:/.test(stage.from)) versions.add(nodeTagVersion(stage.from) ?? stage.from);
    }
  }
  const list = [...versions];
  if (list.length !== 1)
    throw new CheckError(`expected one node base version across the Dockerfiles, found ${list.length}: ${list.join(', ')}`);
  const [version = ''] = list;
  if (versionParts(version)?.length !== 3) throw new CheckError(`node base version ${version} is not a full MAJOR.MINOR.PATCH`);
  return version;
}

/**
 * Compares a pinned version with the releases of its major in nodejs.org's index.json.
 * @param {unknown} index the parsed index.json @param {string} pinned `x.y.z`
 * @returns {{ major: number, pinned: string, newest: string, newestSecurity: string | undefined, newestSecurityDate: string | undefined, behind: boolean }}
 */
export function nodeSecurityStatus(index, pinned) {
  const pin = versionParts(pinned);
  if (pin?.length !== 3) throw new CheckError(`pinned version ${pinned} is not a full MAJOR.MINOR.PATCH`);
  if (!Array.isArray(index)) throw new CheckError('index.json is not an array');
  const major = /** @type {number} */ (pin[0]);
  /** @type {{ parts: number[], entry: IndexEntry }[]} */
  const releases = [];
  for (const raw of /** @type {unknown[]} */ (index)) {
    if (typeof raw !== 'object' || raw === null || typeof (/** @type {IndexEntry} */ (raw).version) !== 'string') {
      throw new CheckError('index.json has an entry without a string version');
    }
    const entry = /** @type {IndexEntry} */ (raw);
    const parts = versionParts(entry.version);
    if (parts?.length === 3 && parts[0] === major) releases.push({ parts, entry });
  }
  if (releases.length === 0) throw new CheckError(`index.json lists no release of Node ${String(major)}`);
  releases.sort((a, b) => compare(b.parts, a.parts));
  const security = releases.find((r) => r.entry.security === true);
  const fmt = (/** @type {number[]} */ p) => p.join('.');
  return {
    major,
    pinned,
    newest: fmt(/** @type {{ parts: number[] }} */ (releases[0]).parts),
    newestSecurity: security === undefined ? undefined : fmt(security.parts),
    newestSecurityDate: security?.entry.date,
    behind: security !== undefined && compare(pin, security.parts) < 0,
  };
}

/**
 * GET index.json with a timeout and bounded retries (backoff and jitter; a GET is idempotent).
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, retryDelayMs?: number }} [options] @returns {Promise<unknown>}
 */
export async function fetchNodeIndex(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchImpl(NODE_INDEX_URL, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
      });
      if (response.ok) return /** @type {unknown} */ (await response.json());
      if (response.status !== 429 && response.status < 500) throw new CheckError(`GET ${NODE_INDEX_URL}: HTTP ${response.status}`);
      if (attempt >= FETCH_ATTEMPTS) throw new CheckError(`GET ${NODE_INDEX_URL}: HTTP ${response.status} after ${attempt} attempts`);
    } catch (error) {
      if (error instanceof CheckError) throw error;
      if (attempt >= FETCH_ATTEMPTS) throw new CheckError(`GET ${NODE_INDEX_URL} failed after ${attempt} attempts: ${String(error)}`);
    }
    await new Promise((done) => {
      setTimeout(done, retryDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * retryDelayMs));
    });
  }
}

/**
 * The CLI without process side effects: returns the exit code and the lines to print.
 * @param {string[]} argv @param {{ fetchImpl?: typeof fetch }} [options] @returns {Promise<{ code: number, out: string, err: string }>}
 */
export async function run(argv, options = {}) {
  const flag = (/** @type {string} */ name) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : undefined;
  };
  try {
    const root = resolve(flag('--root') ?? '.');
    const indexFile = flag('--index');
    const pinned = pinnedNodeVersion(root);
    const index =
      indexFile === undefined
        ? await fetchNodeIndex(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl, retryDelayMs: 1 })
        : /** @type {unknown} */ (JSON.parse(readFileSync(indexFile, 'utf8')));
    const s = nodeSecurityStatus(index, pinned);
    const facts = `pinned node:${s.pinned}; newest ${String(s.major)}.x ${s.newest}; newest security release ${s.newestSecurity ?? 'none'}${s.newestSecurityDate ? ` (${s.newestSecurityDate})` : ''}`;
    if (s.behind) {
      return {
        code: 1,
        out: '',
        err: `[check-node-security] BEHIND: ${facts}. Hand-bump all five FROM lines to the security release (docs/07-ops/CI-CD.md section 6).\n`,
      };
    }
    return { code: 0, out: `[check-node-security] OK: ${facts}\n`, err: '' };
  } catch (error) {
    return { code: 2, out: '', err: `[check-node-security] ERROR: ${error instanceof Error ? error.message : String(error)}\n` };
  }
}

if (import.meta.main === true) {
  // No top-level await: the Jest transform loads this module as CommonJS.
  void run(process.argv.slice(2)).then((result) => {
    process.stdout.write(result.out);
    process.stderr.write(result.err);
    process.exitCode = result.code;
  });
}
