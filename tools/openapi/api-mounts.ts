/**
 * The routers the API mounts, as the drift check walks them (api/README.md §15; TASK-017): the health router at the
 * root and every `moduleRegistry` router under `API_PREFIX`, exactly as `createApp` mounts them. apps/api is loaded at
 * run time by path: its sources are not package exports and are not part of the tools TypeScript project (TS6307), so
 * the shapes read here are narrowed at this boundary instead.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from './contract.js';
import type { Mount } from './drift.js';

const API_SRC = resolve(REPO_ROOT, 'apps', 'api', 'src');

const importApi = async (relativePath: string): Promise<Readonly<Record<string, unknown>>> =>
  (await import(pathToFileURL(resolve(API_SRC, relativePath)).href)) as Readonly<Record<string, unknown>>;

/** A readiness probe the walker never calls (the drift check builds routers, it does not serve requests). */
const unusedProbe = {
  readiness: () => Promise.reject(new Error('the drift check never calls a handler')),
  startDraining: () => undefined,
  draining: false,
};

function expectFunction(value: unknown, name: string): (...args: never[]) => unknown {
  if (typeof value !== 'function') throw new Error(`apps/api: ${name} is not a function`);
  return value as (...args: never[]) => unknown;
}

export interface ApiMounts {
  /** `API_PREFIX` of apps/api/src/app.ts. */
  readonly apiPrefix: string;
  readonly mounts: Mount[];
}

/** Loads apps/api and returns its mounts: health at the root, each module router under the API prefix. */
export async function loadApiMounts(): Promise<ApiMounts> {
  const [app, health, registry] = await Promise.all([
    importApi('app.ts'),
    importApi('platform/health/router.ts'),
    importApi('modules/index.generated.ts'),
  ]);
  const prefix = app.API_PREFIX;
  const modules = registry.moduleRegistry;
  if (typeof prefix !== 'string') throw new Error('apps/api: API_PREFIX is not a string');
  if (!Array.isArray(modules)) throw new Error('apps/api: moduleRegistry is not an array');
  const createHealthRouter = expectFunction(health.createHealthRouter, 'createHealthRouter') as (options: {
    probe: typeof unusedProbe;
  }) => unknown;
  const mounts: Mount[] = [
    { prefix: '', router: createHealthRouter({ probe: unusedProbe }) },
    ...(modules as readonly unknown[]).map((module, index) => {
      const router = typeof module === 'object' && module !== null ? (module as { router?: unknown }).router : undefined;
      if (router === undefined) throw new Error(`apps/api: moduleRegistry[${index}] has no router`);
      return { prefix, router };
    }),
  ];
  return { apiPrefix: prefix, mounts };
}
