/**
 * The composed API app as the drift check walks it (api/README.md §15 input 1; TASK-017, PR #21 R1-m2): `createApp`
 * with the real health router, the real module registry and the docs UI enabled, walked from its top-level router
 * stack. Path-mounted routers are resolved against the two mount paths app.ts uses (`API_PREFIX`, `DOCS_PATH`), and
 * the docs mount is the one explicit exclusion; any other router or handler mounted directly on the app under a path
 * is reported as unrecognised. apps/api is loaded at run time by path: its sources are not package exports and are
 * not part of the tools TypeScript project (TS6307), so the shapes read here are narrowed at this boundary instead.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { OPENAPI_PATH, REPO_ROOT } from './contract.js';
import type { Mount, WalkOptions } from './drift.js';

const API_SRC = resolve(REPO_ROOT, 'apps', 'api', 'src');

const importApi = async (relativePath: string): Promise<Readonly<Record<string, unknown>>> =>
  (await import(pathToFileURL(resolve(API_SRC, relativePath)).href)) as Readonly<Record<string, unknown>>;

/** A readiness probe the walker never calls (the drift check builds routers, it does not serve requests). */
const unusedProbe = {
  readiness: () => Promise.reject(new Error('the drift check never calls a handler')),
  startDraining: () => undefined,
  draining: false,
};

const silentLogger = { info: () => undefined, debug: () => undefined, error: () => undefined };

function expectFunction(value: unknown, name: string): (...args: never[]) => unknown {
  if (typeof value !== 'function') throw new Error(`apps/api: ${name} is not a function`);
  return value as (...args: never[]) => unknown;
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`apps/api: ${name} is not a string`);
  return value;
}

export interface ApiMounts {
  /** `API_PREFIX` of apps/api/src/app.ts. */
  readonly apiPrefix: string;
  /** `DOCS_PATH` of apps/api/src/platform/openapi/serve.ts (excluded from the comparison). */
  readonly docsPath: string;
  /** The composed app's top-level router, mounted at the root. */
  readonly mounts: Mount[];
  /** Mount paths the walker may resolve, and the excluded docs mount. */
  readonly walk: Required<WalkOptions>;
}

/** Builds the composed app (docs enabled, nothing listens) and returns its router with the walk options. */
export async function loadApiMounts(): Promise<ApiMounts> {
  const [app, health, registry, docs] = await Promise.all([
    importApi('app.ts'),
    importApi('platform/health/router.ts'),
    importApi('modules/index.generated.ts'),
    importApi('platform/openapi/serve.ts'),
  ]);
  const apiPrefix = expectString(app.API_PREFIX, 'API_PREFIX');
  const docsPath = expectString(docs.DOCS_PATH, 'DOCS_PATH');
  if (!Array.isArray(registry.moduleRegistry)) throw new Error('apps/api: moduleRegistry is not an array');
  const createHealthRouter = expectFunction(health.createHealthRouter, 'createHealthRouter') as (options: {
    probe: typeof unusedProbe;
  }) => unknown;
  const createApp = expectFunction(app.createApp, 'createApp') as (deps: Readonly<Record<string, unknown>>) => unknown;
  const composed = createApp({
    healthRouter: createHealthRouter({ probe: unusedProbe }),
    modules: registry.moduleRegistry,
    logger: silentLogger,
    docs: { specPath: OPENAPI_PATH, apiMode: 'test', topBar: false },
  });
  const router = typeof composed === 'function' ? (composed as { router?: unknown }).router : undefined;
  if (router === undefined) throw new Error('apps/api: createApp() returned no Express app with a router');
  return {
    apiPrefix,
    docsPath,
    mounts: [{ prefix: '', router }],
    walk: { mountPaths: [apiPrefix, docsPath], excluded: [docsPath] },
  };
}
