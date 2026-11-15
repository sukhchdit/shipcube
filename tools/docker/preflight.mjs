// @ts-check
/**
 * Image build-time preflight of the api and worker runtime stages (TASK-014; ADR-0022 am. 13; platform.md §3.2 runtime
 * row and image invariants). The runtime stage copies it to /app/preflight.mjs and runs, after `USER 1000:1000`,
 *
 *   node /app/preflight.mjs /app/apps/<app>/dist [<app package.json>]
 *
 * It imports every compiled production module of the app and every entry point of every @platform/* package the app
 * depends on, without `--conditions`. It proves that the `default` export condition resolves to `dist` (never `src`),
 * that the pruned production install (`--omit=dev --omit=optional`) holds every runtime dependency, and that no test
 * file or fixture reached the image. It never imports main.js (no config, no listener). The app manifest defaults to
 * `<dist>/../package.json`. `@platform/*` specifiers resolve from /app/preflight.mjs, which walks /app/node_modules: the
 * same packages the app resolves from /app/apps/<app>/dist (npm workspaces hoist every @platform link to the root).
 * A failure exits 1 and fails `docker build`. It lives in tools/docker, not apps/<app>/src: it is an image build tool
 * that loads modules by computed path on purpose, never part of the served process.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Entry scripts with process-level effects: never imported by the preflight. */
export const ENTRY_FILES = Object.freeze(['main.js']);
/** Export subpaths that are test helpers, not runtime code (@platform/config/testing). */
export const SKIPPED_EXPORTS = Object.freeze(['./testing']);
const TEST_ARTIFACT = /(?:^|[\\/])(?:__fixtures__|fixtures|tests|spikes)(?:[\\/]|$)|\.test\.[^\\/]+$/;

/**
 * @typedef {object} PreflightOptions
 * @property {string} distDir Directory holding the compiled app (`apps/<app>/dist`).
 * @property {string} appManifest The app's package.json; its `@platform/*` dependencies are imported through their `exports`.
 * @property {(specifier: string) => Promise<unknown>} [load] Test seam: the module loader (default: dynamic `import()`).
 * @property {(specifier: string) => string} [resolveSpecifier] Test seam: resolves a bare specifier to a file URL
 *   (default: `import.meta.resolve`).
 */

/**
 * @typedef {object} PreflightResult
 * @property {number} modules
 * @property {readonly string[]} entryPoints
 */

export class PreflightError extends Error {
  /** @override */
  name = 'PreflightError';
  /** The preflight's own reason text (built here from dist paths and specifiers only). @type {string} */
  reason;

  /**
   * @param {string} reason
   * @param {{ cause?: unknown }} [options]
   */
  constructor(reason, options) {
    super(reason, options);
    this.reason = reason;
  }
}

/**
 * Every file below `dir` (relative, `/`-separated); throws when a test file, fixture or spike is among them.
 * @param {string} dir
 * @returns {string[]}
 */
export function cleanTree(dir) {
  const all = readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((rel) => rel.split(sep).join('/'));
  const artifacts = all.filter((rel) => TEST_ARTIFACT.test(rel));
  if (artifacts.length > 0) throw new PreflightError(`test artifacts in ${dir}: ${artifacts.slice(0, 5).join(', ')}`);
  return all;
}

/**
 * Compiled JavaScript modules below `distDir` (sorted, relative), entry scripts excluded.
 * @param {string} distDir
 * @returns {string[]}
 */
export function productionModules(distDir) {
  return cleanTree(distDir)
    .filter((rel) => rel.endsWith('.js') && !ENTRY_FILES.includes(rel))
    .sort();
}

/**
 * Finds `node_modules/<name>/package.json` the way Node resolves packages, walking up from `fromDir`.
 * @param {string} name
 * @param {string} fromDir
 * @returns {string}
 */
function packageManifest(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new PreflightError(`${name} is not installed`);
  }
}

/**
 * Every JavaScript entry point (`name` + export subpath) of the app's `@platform/*` dependencies.
 * @param {string} appManifest
 * @returns {string[]}
 */
export function platformEntryPoints(appManifest) {
  const manifest = /** @type {{ dependencies?: Record<string, string> }} */ (JSON.parse(readFileSync(appManifest, 'utf8')));
  const names = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@platform/'));
  return names.sort().flatMap((name) => {
    const depManifest = packageManifest(name, dirname(appManifest));
    const depDist = join(dirname(depManifest), 'dist');
    if (existsSync(depDist)) cleanTree(depDist);
    const dep = /** @type {{ exports?: Record<string, unknown> }} */ (JSON.parse(readFileSync(depManifest, 'utf8')));
    return Object.entries(dep.exports ?? { '.': {} })
      .filter(([subpath, target]) => !subpath.includes('*') && !SKIPPED_EXPORTS.includes(subpath) && typeof target !== 'string')
      .map(([subpath]) => `${name}${subpath.slice(1)}`);
  });
}

/**
 * The argument must be an app's compiled output: a directory named `dist` holding main.js (a wrong path, such as the
 * app directory itself, would otherwise import `dist/main.js` as an ordinary module).
 * @param {string} distDir
 */
function assertAppDist(distDir) {
  const isDir = existsSync(distDir) && statSync(distDir).isDirectory();
  if (!isDir || basename(distDir) !== 'dist' || !existsSync(join(distDir, 'main.js'))) {
    throw new PreflightError(`${distDir} is not an app dist directory (expected apps/<app>/dist with main.js)`);
  }
}

/**
 * @param {PreflightOptions} options
 * @returns {Promise<PreflightResult>}
 */
export async function preflight(options) {
  const load = options.load ?? ((/** @type {string} */ specifier) => import(specifier));
  const resolveSpecifier = options.resolveSpecifier ?? ((/** @type {string} */ specifier) => import.meta.resolve(specifier));
  assertAppDist(options.distDir);
  const modules = productionModules(options.distDir);
  for (const rel of modules) {
    try {
      await load(pathToFileURL(join(options.distDir, rel)).href);
    } catch (cause) {
      throw new PreflightError(`cannot load dist/${rel}`, { cause });
    }
  }
  const entryPoints = platformEntryPoints(options.appManifest);
  for (const specifier of entryPoints) {
    const file = fileURLToPath(resolveSpecifier(specifier)).split(sep).join('/');
    if (!/\/dist\/[^/]+(?:\/[^/]+)*\.js$/.test(file) || /\/src\//.test(file)) {
      throw new PreflightError(`${specifier} resolves outside dist (${file}); the default export condition must point to dist`);
    }
    try {
      await load(specifier);
    } catch (cause) {
      throw new PreflightError(`cannot load ${specifier}`, { cause });
    }
  }
  return { modules: modules.length, entryPoints };
}

/**
 * The class name of a caught error, or undefined. Realm-independent (a loader error can come from another realm, where
 * `instanceof Error` is false) and restricted to an identifier, so no free text reaches the build log.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function errorClass(value) {
  const name = typeof value === 'object' && value !== null && 'name' in value ? value.name : undefined;
  return typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : undefined;
}

/**
 * Entry: prints one summary line; any failure exits 1 and so fails `docker build`.
 * @param {string[]} argv `<distDir> [<appManifest>]`
 * @param {Pick<PreflightOptions, 'load' | 'resolveSpecifier'>} [seams] test seams, passed through to `preflight`
 * @returns {Promise<number>}
 */
export async function main(argv, seams = {}) {
  if (argv.length < 1 || argv.length > 2 || argv.some((arg) => arg === '' || arg.startsWith('-'))) {
    process.stderr.write('usage: preflight.mjs <apps/<app>/dist> [<app package.json>]\n');
    return 1;
  }
  const distDir = resolve(argv[0] ?? '');
  const appManifest = argv[1] === undefined ? join(distDir, '..', 'package.json') : resolve(argv[1]);
  try {
    const result = await preflight({ ...seams, distDir, appManifest });
    process.stdout.write(`[preflight] ok: ${result.modules} module(s), entry points ${result.entryPoints.join(' ')}\n`);
    return 0;
  } catch (error) {
    // Build log only: the preflight's own reason (a dist path or a specifier) and the error classes, never a caught
    // message (PR20-SEC-13); `docker build` shows the failing module from the reason.
    const reason = error instanceof PreflightError ? error.reason : undefined;
    const cause = error instanceof Error ? errorClass(error.cause) : undefined;
    const name = error instanceof Error ? error.name : typeof error;
    process.stderr.write(`${JSON.stringify({ event: 'preflight.failed', error: name, reason, cause })}\n`);
    return 1;
  }
}

if (import.meta.main === true) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
