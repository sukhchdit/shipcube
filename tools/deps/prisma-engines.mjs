// @ts-check
/**
 * Pinned Prisma schema engine (ADR-0023 amendment J item 2, D-ARCH-041, PR1-SEC-02, SEC-TC-64).
 *
 * The native `schema-engine` executes DDL as the migrator role, so its bytes are pinned like a lockfile entry:
 * `tools/deps/prisma-engines.json` holds the SHA-256 of the gunzipped binary per binary target, recorded from two
 * independent environments. This module is the only code that ever places that binary on disk, and Prisma's own
 * downloader never runs:
 *
 *   1. Refuse to start when the inherited environment redirects Prisma's engine source, version, checksum handling,
 *      binary path or target list (`FORBIDDEN_ENGINE_ENV`, completed from the locked Prisma 7.10.1 sources).
 *   2. Require `manifest.enginesVersion` to equal the installed `@prisma/engines-version` and `manifest.source` to equal
 *      `ENGINE_ORIGIN`; the origin is a constant here, never an environment variable or configuration key.
 *   3. Resolve the binary target with the `@prisma/get-platform` that `@prisma/engines` itself uses; a target missing
 *      from the manifest fails closed.
 *   4. Offline/cached mode: an existing `node_modules/@prisma/engines/schema-engine-<target>[.exe]` whose SHA-256 equals
 *      the manifest is used as is (no network).
 *   5. Otherwise fetch `<target>/schema-engine[.exe].gz` and its `.gz.sha256` from `ENGINE_ORIGIN` only (HTTPS, 60 s
 *      timeout, 3 retries with exponential backoff and jitter, redirects only within the origin), check the transport
 *      hash, gunzip, check the binary against the manifest (the trust anchor), then write it atomically with mode 0755.
 *      Any failure deletes every `schema-engine*` file in the engines directory and reports expected and actual hashes.
 *
 * The per-user Prisma cache (`%APPDATA%\Prisma`, `~/.cache/prisma`) is never read, written or trusted. Children of
 * Prisma get `PRISMA_SCHEMA_ENGINE_BINARY=<verified path>` and `CHECKPOINT_DISABLE=1` (`prismaChildEnv`), which makes
 * the CLI's `ensureNeededBinariesExist()` return before it looks at the cache or the network.
 *
 * Plain ESM with `node:` imports only: it runs from `deps:rebuild` right after `npm ci --ignore-scripts`.
 *
 *   node tools/deps/prisma-engines.mjs                 ensure (cached or fetch), print the verified path
 *   node tools/deps/prisma-engines.mjs --verify-only   hash compare only, never the network
 *   node tools/deps/prisma-engines.mjs --record [--engines-version=<40 hex>] [--targets=a,b]
 *                                                      recording procedure (am. J item 2 (b)): prints hashes, writes nothing
 */
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

/** The single network origin `deps:rebuild` may contact. Changing it requires an amendment of ADR-0023 am. J item 2. */
export const ENGINE_ORIGIN = 'https://binaries.prisma.sh/all_commits/';

/**
 * Variables that redirect Prisma's engine source, version, checksum handling, binary path or target list. Each is
 * read by the locked Prisma 7.10.1 sources (file references in the TASK-003 report) or named by ADR-0023 am. J (c):
 * - PRISMA_ENGINES_MIRROR, PRISMA_BINARIES_MIRROR (deprecated alias): download origin (fetch-engine getDownloadUrl).
 * - PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: skips the checksum when the .sha256 is missing (fetch-engine download).
 * - BINARY_DOWNLOAD_VERSION: replaces the engines commit to download (fetch-engine download).
 * - PRISMA_SCHEMA_ENGINE_BINARY, PRISMA_MIGRATION_ENGINE_BINARY (deprecated alias): binary path override (fetch-engine env).
 * - PRISMA_CLI_BINARY_TARGETS: list of targets the CLI downloads (@prisma/engines ensureNeededBinariesExist).
 * - PRISMA_QUERY_ENGINE_LIBRARY, PRISMA_QUERY_ENGINE_BINARY, PRISMA_FMT_BINARY: engine paths of earlier Prisma majors;
 *   not read at 7.10.1, refused so that a downgrade cannot reintroduce them silently (am. J (c) list).
 * `PRISMA_SCHEMA_ENGINE_BINARY` is tolerated only when it already names the verified file (the `migrate` image sets it,
 * am. J (e)); any other value is refused.
 */
export const FORBIDDEN_ENGINE_ENV = Object.freeze([
  'PRISMA_ENGINES_MIRROR',
  'PRISMA_BINARIES_MIRROR',
  'PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING',
  'BINARY_DOWNLOAD_VERSION',
  'PRISMA_SCHEMA_ENGINE_BINARY',
  'PRISMA_MIGRATION_ENGINE_BINARY',
  'PRISMA_CLI_BINARY_TARGETS',
  'PRISMA_QUERY_ENGINE_LIBRARY',
  'PRISMA_QUERY_ENGINE_BINARY',
  'PRISMA_FMT_BINARY',
]);

export const FETCH_TIMEOUT_MS = 60_000;
export const FETCH_RETRIES = 3;
const MAX_REDIRECTS = 5;
const MAX_GZ_BYTES = 128 * 1024 * 1024;
const MAX_SHA_BYTES = 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;
/** Targets the repository runs on (am. J item 2 (a)); further targets need a reviewed manifest change. */
export const RECORD_TARGETS = Object.freeze(['debian-openssl-3.0.x', 'windows']);

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'tools', 'deps', 'prisma-engines.json');

export class EngineError extends Error {
  /**
   * @param {string} message
   * @param {boolean} [fatal] true when retrying cannot help (refused redirect, HTTP 4xx); the fetch loop stops at once
   */
  constructor(message, fatal = false) {
    super(message);
    this.name = 'EngineError';
    this.fatal = fatal;
  }
}

/** @param {Buffer} data */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** @param {string} target */
export const engineFileName = (target) => `schema-engine-${target}${target === 'windows' ? '.exe' : ''}`;

/** @param {string} enginesVersion @param {string} target */
export const engineUrl = (enginesVersion, target) =>
  `${ENGINE_ORIGIN}${enginesVersion}/${target}/schema-engine${target === 'windows' ? '.exe' : ''}.gz`;

/**
 * Names of forbidden variables present in `env` (case-insensitive, as Windows treats names). A variable counts as set
 * when it is defined at all, even empty.
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} [verifiedPath] absolute path of the verified engine; an equal PRISMA_SCHEMA_ENGINE_BINARY is tolerated
 * @returns {string[]}
 */
export function forbiddenEnv(env, verifiedPath) {
  const forbidden = new Set(FORBIDDEN_ENGINE_ENV);
  return Object.keys(env)
    .filter((key) => env[key] !== undefined && forbidden.has(key.toUpperCase()))
    .filter((key) => {
      if (key.toUpperCase() !== 'PRISMA_SCHEMA_ENGINE_BINARY' || verifiedPath === undefined) return true;
      return !samePath(resolve(String(env[key])), verifiedPath);
    })
    .sort();
}

/** @param {string} a @param {string} b */
function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * @typedef {{ enginesVersion: string, source: string, schemaEngine: Record<string, { sha256: string }> }} EngineManifest
 */

/**
 * Reads and validates the manifest. Refuses a manifest whose `source` differs from `ENGINE_ORIGIN`.
 * @param {string} path
 * @returns {EngineManifest}
 */
export function readManifest(path) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new EngineError(`cannot read the engine manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new EngineError('engine manifest must be a JSON object');
  const manifest = /** @type {Record<string, unknown>} */ (raw);
  const unknownKeys = Object.keys(manifest).filter((key) => !['$comment', 'enginesVersion', 'source', 'schemaEngine'].includes(key));
  if (unknownKeys.length > 0) throw new EngineError(`engine manifest has unknown keys: ${unknownKeys.join(', ')}`);
  const { enginesVersion, source, schemaEngine } = manifest;
  if (typeof enginesVersion !== 'string' || !COMMIT_HEX.test(enginesVersion)) {
    throw new EngineError('engine manifest enginesVersion must be a 40-character lowercase hex commit');
  }
  if (source !== ENGINE_ORIGIN) {
    throw new EngineError(`engine manifest source ${JSON.stringify(source)} differs from the fixed origin ${ENGINE_ORIGIN}`);
  }
  if (typeof schemaEngine !== 'object' || schemaEngine === null || Array.isArray(schemaEngine)) {
    throw new EngineError('engine manifest schemaEngine must be an object keyed by binary target');
  }
  /** @type {Record<string, { sha256: string }>} */
  const targets = {};
  for (const [target, entry] of Object.entries(schemaEngine)) {
    const hash = typeof entry === 'object' && entry !== null ? /** @type {Record<string, unknown>} */ (entry)['sha256'] : undefined;
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      throw new EngineError(`engine manifest schemaEngine.${target}.sha256 must be 64 lowercase hex characters`);
    }
    targets[target] = { sha256: hash };
  }
  if (Object.keys(targets).length === 0) throw new EngineError('engine manifest lists no binary target');
  return { enginesVersion, source, schemaEngine: targets };
}

/**
 * Follows the dependency chain the CLI itself uses: prisma workspace -> `prisma` -> `@prisma/engines` ->
 * `@prisma/engines-version` and `@prisma/get-platform` (the hoisted `@prisma/get-platform` may be another version).
 * @param {string} root repository root
 */
export function locateInstall(root) {
  try {
    const fromWorkspace = createRequire(join(root, 'prisma', 'package.json'));
    const cliManifest = fromWorkspace.resolve('prisma/package.json');
    const enginesManifest = createRequire(cliManifest).resolve('@prisma/engines/package.json');
    const fromEngines = createRequire(enginesManifest);
    const versionManifest = JSON.parse(readFileSync(fromEngines.resolve('@prisma/engines-version/package.json'), 'utf8'));
    const enginesVersion = versionManifest?.prisma?.enginesVersion;
    if (typeof enginesVersion !== 'string') throw new Error('@prisma/engines-version has no prisma.enginesVersion');
    return { enginesDir: dirname(enginesManifest), enginesVersion, getPlatformEntry: fromEngines.resolve('@prisma/get-platform') };
  } catch (error) {
    throw new EngineError(`cannot locate the installed Prisma engines: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Binary target of this host, from the `@prisma/get-platform` that `@prisma/engines` resolves.
 * @param {string} getPlatformEntry
 * @returns {Promise<string>}
 */
export async function detectTarget(getPlatformEntry) {
  const getPlatform = createRequire(getPlatformEntry)(getPlatformEntry);
  const target = await getPlatform.getBinaryTargetForCurrentPlatform();
  if (typeof target !== 'string' || target === '') throw new EngineError('could not determine the Prisma binary target');
  return target;
}

/** Removes every `schema-engine*` file (engine, partial downloads) from `dir`. @param {string} dir */
export function removeEngineFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('schema-engine')) rmSync(join(dir, name), { force: true });
  }
}

/** @param {string} dir */
function removePartialFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('schema-engine') && name.includes('.partial-')) rmSync(join(dir, name), { force: true });
  }
}

/**
 * @typedef {{ status: number, location?: string | undefined, body: Buffer }} TransportResponse
 * @typedef {(url: string, options: { timeoutMs: number, maxBytes: number }) => Promise<TransportResponse>} Transport
 */

/**
 * One HTTPS GET without redirect handling. HTTPS only; the body is capped at `maxBytes`.
 * @type {Transport}
 */
export function httpsGet(url, { timeoutMs, maxBytes }) {
  return new Promise((resolvePromise, reject) => {
    if (!url.startsWith('https://')) {
      reject(new EngineError(`refusing a non-HTTPS engine URL: ${url}`));
      return;
    }
    const req = request(url, { method: 'GET', headers: { 'user-agent': 'shipqube-deps-rebuild' } }, (res) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new EngineError(`response from ${url} exceeds ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, location: res.headers.location, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    const deadline = setTimeout(() => req.destroy(new EngineError(`timed out after ${timeoutMs} ms: ${url}`)), timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end();
  });
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * GET `url` (which must lie under `ENGINE_ORIGIN`) with retries and same-origin redirects.
 * @param {string} url
 * @param {{ transport?: Transport, sleep?: (ms: number) => Promise<unknown>, random?: () => number, maxBytes: number, log?: (line: string) => void }} options
 * @returns {Promise<Buffer>}
 */
export async function fetchFromOrigin(url, { transport = httpsGet, sleep = defaultSleep, random = Math.random, maxBytes, log = () => {} }) {
  const origin = new URL(ENGINE_ORIGIN);
  if (!url.startsWith(ENGINE_ORIGIN)) throw new EngineError(`refusing a URL outside ${ENGINE_ORIGIN}: ${url}`);
  /** @type {unknown} */
  let lastError;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const base = 500 * 2 ** (attempt - 1);
      await sleep(base + Math.floor(random() * base));
    }
    try {
      let current = url;
      for (let hop = 0; ; hop += 1) {
        const res = await transport(current, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes });
        if (res.status >= 300 && res.status < 400 && res.location !== undefined) {
          const next = new URL(res.location, current);
          if (next.protocol !== 'https:' || next.host !== origin.host) {
            throw new EngineError(`refusing a redirect outside ${origin.origin}: ${next.href}`, true);
          }
          if (hop >= MAX_REDIRECTS) throw new EngineError(`too many redirects for ${url}`, true);
          current = next.href;
          continue;
        }
        if (res.status === 200) return res.body;
        throw new EngineError(`GET ${current} answered HTTP ${res.status}`, !RETRYABLE_STATUS.has(res.status));
      }
    } catch (error) {
      if (error instanceof EngineError && error.fatal) throw error;
      lastError = error;
      log(
        `[prisma-engines] attempt ${attempt + 1} of ${FETCH_RETRIES + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new EngineError(`could not fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/**
 * Fetches one target's engine, checks the transport hash and returns the gunzipped bytes and their hashes.
 * @param {string} enginesVersion
 * @param {string} target
 * @param {Parameters<typeof fetchFromOrigin>[1]} fetchOptions
 */
export async function fetchEngine(enginesVersion, target, fetchOptions) {
  const url = engineUrl(enginesVersion, target);
  const [gz, shaFile] = await Promise.all([
    fetchFromOrigin(url, { ...fetchOptions, maxBytes: MAX_GZ_BYTES }),
    fetchFromOrigin(`${url}.sha256`, { ...fetchOptions, maxBytes: MAX_SHA_BYTES }),
  ]);
  const upstreamGzSha = shaFile.toString('utf8').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const gzSha = sha256(gz);
  if (!SHA256_HEX.test(upstreamGzSha) || upstreamGzSha !== gzSha) {
    throw new EngineError(
      `transport check failed for ${url}: expected (upstream .gz.sha256) ${upstreamGzSha || '<none>'}, actual ${gzSha}`,
    );
  }
  let binary;
  try {
    binary = gunzipSync(gz);
  } catch (error) {
    throw new EngineError(`cannot gunzip ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { url, gzSha256: gzSha, binary, sha256: sha256(binary) };
}

/**
 * @typedef {{
 *   root?: string,
 *   manifestPath?: string,
 *   env?: Record<string, string | undefined>,
 *   verifyOnly?: boolean,
 *   transport?: Transport,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (line: string) => void,
 *   install?: { enginesDir: string, enginesVersion: string, getPlatformEntry: string },
 *   target?: string,
 * }} EnsureOptions
 */

/**
 * Ensures a verified schema engine for this host and returns its absolute path. Production callers pass no options
 * except `verifyOnly`; `transport`, `install` and `target` are test seams (function parameters only, never read from
 * the environment or configuration), used by the SEC-TC-64 tests to work in temporary directories and to make the
 * origin unreachable without changing the origin itself.
 * @param {EnsureOptions} [options]
 * @returns {Promise<{ path: string, mode: 'cached' | 'fetched', target: string, sha256: string }>}
 */
export async function ensureEngine(options = {}) {
  const { root = REPO_ROOT, manifestPath = MANIFEST_PATH, env = process.env, verifyOnly = false, log = () => {} } = options;
  const refuse = (/** @type {string[]} */ names) =>
    new EngineError(`refusing to run: engine-redirecting variable(s) set in the environment: ${names.join(', ')}`);

  // (1) Refuse before any file or network access. PRISMA_SCHEMA_ENGINE_BINARY is decided once the target path is known.
  const early = forbiddenEnv(env).filter((key) => key.toUpperCase() !== 'PRISMA_SCHEMA_ENGINE_BINARY');
  if (early.length > 0) throw refuse(early);
  const install = options.install ?? locateInstall(root);
  const target = options.target ?? (await detectTarget(install.getPlatformEntry));
  const dest = join(install.enginesDir, engineFileName(target));
  const inherited = forbiddenEnv(env, dest);
  if (inherited.length > 0) throw refuse(inherited);
  // (2) Manifest and version equality.
  const manifest = readManifest(manifestPath);
  if (manifest.enginesVersion !== install.enginesVersion) {
    throw new EngineError(
      `engine manifest is stale: enginesVersion ${manifest.enginesVersion} != installed @prisma/engines-version ${install.enginesVersion}`,
    );
  }
  // (3) Target must be pinned.
  const expected = manifest.schemaEngine[target]?.sha256;
  if (expected === undefined) {
    throw new EngineError(
      `binary target ${target} is not in the engine manifest (pinned: ${Object.keys(manifest.schemaEngine).join(', ')})`,
    );
  }

  try {
    removePartialFiles(install.enginesDir);
    // (4) Offline/cached mode.
    if (existsSync(dest)) {
      const actual = sha256(readFileSync(dest));
      if (actual === expected) return { path: dest, mode: 'cached', target, sha256: actual };
      log(`[prisma-engines] ${dest} does not match the manifest (expected ${expected}, actual ${actual}); removing it`);
      rmSync(dest, { force: true });
    }
    if (verifyOnly) throw new EngineError(`no verified schema engine at ${dest} (--verify-only never fetches)`);

    // (5) Fetch from the fixed origin, transport check, trust-anchor check, atomic write.
    log(`[prisma-engines] fetching ${engineUrl(manifest.enginesVersion, target)}`);
    const fetched = await fetchEngine(manifest.enginesVersion, target, {
      ...(options.transport ? { transport: options.transport } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      log,
      maxBytes: MAX_GZ_BYTES,
    });
    if (fetched.sha256 !== expected) {
      throw new EngineError(`schema engine for ${target} does not match the manifest: expected ${expected}, actual ${fetched.sha256}`);
    }
    const partial = `${dest}.partial-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(partial, fetched.binary, { mode: 0o755, flag: 'wx' });
    chmodSync(partial, 0o755);
    if (sha256(readFileSync(partial)) !== expected) throw new EngineError(`written file ${partial} does not match the manifest`);
    renameSync(partial, dest);
    return { path: dest, mode: 'fetched', target, sha256: expected };
  } catch (error) {
    removeEngineFiles(install.enginesDir);
    throw error instanceof EngineError ? error : new EngineError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Re-hashes the engine after a Prisma child exits (defence in depth on top of the env-override short-circuit).
 * @param {string} path @param {string} expected
 */
export function reverifyEngine(path, expected) {
  const actual = existsSync(path) ? sha256(readFileSync(path)) : '<missing>';
  if (actual !== expected) {
    removeEngineFiles(dirname(path));
    throw new EngineError(`schema engine changed while Prisma ran: expected ${expected}, actual ${actual}; removed`);
  }
}

/**
 * Environment for every Prisma child: the verified engine path and no checkpoint telemetry.
 * @param {Record<string, string | undefined>} env @param {string} enginePath
 */
export function prismaChildEnv(env, enginePath) {
  const child = Object.fromEntries(Object.entries(env).filter(([key]) => !FORBIDDEN_ENGINE_ENV.includes(key.toUpperCase())));
  return { ...child, PRISMA_SCHEMA_ENGINE_BINARY: enginePath, CHECKPOINT_DISABLE: '1' };
}

/**
 * Recording procedure (am. J item 2 (b)): fetch every target from the fixed origin, check the transport hash, gunzip
 * and return the binary hashes. Writes nothing; run it on two independent environments and compare.
 * @param {{ enginesVersion: string, targets: readonly string[], transport?: Transport }} options
 */
export async function recordHashes({ enginesVersion, targets, transport }) {
  if (!COMMIT_HEX.test(enginesVersion)) throw new EngineError(`enginesVersion must be 40 hex characters: ${enginesVersion}`);
  const results = [];
  for (const target of targets) {
    const fetched = await fetchEngine(enginesVersion, target, { ...(transport ? { transport } : {}), maxBytes: MAX_GZ_BYTES });
    results.push({ target, url: fetched.url, gzSha256: fetched.gzSha256, bytes: fetched.binary.length, sha256: fetched.sha256 });
  }
  return { enginesVersion, source: ENGINE_ORIGIN, results };
}

/** @param {string[]} argv @param {string} name */
const flagValue = (argv, name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * The CLI as a function: returns the exit code (0 success, 1 any failure). `seams` is for tests only (see
 * `ensureEngine`); the script entry passes none.
 * @param {string[]} argv
 * @param {Omit<EnsureOptions, 'verifyOnly' | 'log'>} [seams]
 * @param {{ out?: (text: string) => void, err?: (text: string) => void }} [io]
 */
export async function run(argv, seams = {}, io = {}) {
  const out = io.out ?? ((/** @type {string} */ text) => process.stdout.write(text));
  const err = io.err ?? ((/** @type {string} */ text) => process.stderr.write(text));
  try {
    if (argv.includes('--record')) {
      const manifestPath = seams.manifestPath ?? MANIFEST_PATH;
      const pinned = existsSync(manifestPath) ? readManifest(manifestPath).enginesVersion : undefined;
      const enginesVersion = flagValue(argv, 'engines-version') ?? pinned;
      if (enginesVersion === undefined) throw new EngineError('--record needs --engines-version=<commit> when no manifest exists');
      const targets = flagValue(argv, 'targets')?.split(',') ?? [...RECORD_TARGETS];
      const record = await recordHashes({ enginesVersion, targets, ...(seams.transport ? { transport: seams.transport } : {}) });
      out(`${JSON.stringify(record, null, 2)}\n`);
      return 0;
    }
    const result = await ensureEngine({ ...seams, verifyOnly: argv.includes('--verify-only'), log: (line) => err(`${line}\n`) });
    out(`[prisma-engines] ${result.mode}: ${result.path} (${result.target}, sha256 ${result.sha256})\n`);
    return 0;
  } catch (error) {
    err(`[prisma-engines] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

// Library first: rebuild.mjs, prisma-cli.mjs and the SEC-TC-64 tests import this module (Jest's ESM loader does not
// set import.meta.main, and the entry scripts carry the Node >= 24.2 guard). Run as a script, it is the CLI above.
if (import.meta.main === true) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
