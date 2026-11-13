// Image build-time preflight of the worker runtime stage (TASK-014; ADR-0022 am. 13; platform.md §3.2 runtime row and
// image invariants): `RUN node dist/preflight.js` imports every compiled production module of this app and every entry
// point of every @platform/* package it depends on, without `--conditions`. It proves that the `default` export
// condition resolves to `dist` (never `src`), that the pruned production install (`--omit=dev --omit=optional`) holds
// every runtime dependency, and that no test file or fixture reached the image. It never imports main.js (no config,
// no listener) or the healthcheck entry. A failure exits 1 and fails `docker build`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Entry scripts with process-level effects: never imported by the preflight. */
export const ENTRY_FILES = Object.freeze(['main.js', 'healthcheck.js', 'preflight.js']);
/** Export subpaths that are test helpers, not runtime code (@platform/config/testing). */
export const SKIPPED_EXPORTS = Object.freeze(['./testing']);
const TEST_ARTIFACT = /(?:^|[\\/])(?:__fixtures__|fixtures|tests|spikes)(?:[\\/]|$)|\.test\.[^\\/]+$/;

export interface PreflightOptions {
  /** Directory holding the compiled app (`apps/<app>/dist`). */
  readonly distDir: string;
  /** The app's package.json; its `@platform/*` dependencies are imported through their `exports`. */
  readonly appManifest: string;
  /** Test seam: the module loader (default: dynamic `import()`). */
  readonly load?: (specifier: string) => Promise<unknown>;
  /** Test seam: resolves a bare specifier to a file URL (default: `import.meta.resolve`). */
  readonly resolveSpecifier?: (specifier: string) => string;
}

export interface PreflightResult {
  readonly modules: number;
  readonly entryPoints: readonly string[];
}

export class PreflightError extends Error {
  override readonly name = 'PreflightError';
  /** The preflight's own reason text (built here from dist paths and specifiers only). */
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.reason = reason;
  }
}

/** Every file below `dir` (relative, `/`-separated); throws when a test file, fixture or spike is among them. */
export function cleanTree(dir: string): string[] {
  const all = readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((rel) => rel.split(sep).join('/'));
  const artifacts = all.filter((rel) => TEST_ARTIFACT.test(rel));
  if (artifacts.length > 0) throw new PreflightError(`test artifacts in ${dir}: ${artifacts.slice(0, 5).join(', ')}`);
  return all;
}

/** Compiled JavaScript modules below `distDir` (sorted, relative), entry scripts excluded. */
export function productionModules(distDir: string): string[] {
  return cleanTree(distDir)
    .filter((rel) => rel.endsWith('.js') && !ENTRY_FILES.includes(rel))
    .sort();
}

/** Finds `node_modules/<name>/package.json` the way Node resolves packages, walking up from `fromDir`. */
function packageManifest(name: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new PreflightError(`${name} is not installed`);
  }
}

/** Every JavaScript entry point (`name` + export subpath) of the app's `@platform/*` dependencies. */
export function platformEntryPoints(appManifest: string): string[] {
  const manifest = JSON.parse(readFileSync(appManifest, 'utf8')) as { dependencies?: Record<string, string> };
  const names = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@platform/'));
  return names.sort().flatMap((name) => {
    const depManifest = packageManifest(name, dirname(appManifest));
    const depDist = join(dirname(depManifest), 'dist');
    if (existsSync(depDist)) cleanTree(depDist);
    const dep = JSON.parse(readFileSync(depManifest, 'utf8')) as { exports?: Record<string, unknown> };
    return Object.entries(dep.exports ?? { '.': {} })
      .filter(([subpath, target]) => !subpath.includes('*') && !SKIPPED_EXPORTS.includes(subpath) && typeof target !== 'string')
      .map(([subpath]) => `${name}${subpath.slice(1)}`);
  });
}

export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  const load = options.load ?? ((specifier: string) => import(specifier));
  const resolveSpecifier = options.resolveSpecifier ?? ((specifier: string) => import.meta.resolve(specifier));
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

/** Entry: prints one summary line; any failure exits 1 and so fails `docker build`. */
async function run(distDir: string): Promise<number> {
  try {
    const result = await preflight({ distDir, appManifest: join(distDir, '..', 'package.json') });
    process.stdout.write(`[preflight] ok: ${result.modules} module(s), entry points ${result.entryPoints.join(' ')}\n`);
    return 0;
  } catch (error) {
    // Build log only: the preflight's own reason (a dist path or a specifier) and the error classes, never a caught
    // message (PR20-SEC-13); `docker build` shows the failing module from the reason.
    const reason = error instanceof PreflightError ? error.reason : undefined;
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.name : undefined;
    const name = error instanceof Error ? error.name : typeof error;
    process.stderr.write(`${JSON.stringify({ event: 'preflight.failed', error: name, reason, cause })}\n`);
    return 1;
  }
}

if (import.meta.main === true) {
  void run(dirname(fileURLToPath(import.meta.url))).then((code) => {
    process.exitCode = code;
  });
}
