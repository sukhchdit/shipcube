/**
 * The composed API app as the drift and route-metadata checks walk it (api/README.md §15 input 1; TASK-017, PR #21
 * R1-m2; TASK-020): `createApp` with the real health routes, the real module registry and the docs UI enabled, walked
 * from its top-level router. Reached through TypeScript project references (tests/generated/tsconfig.json references
 * apps/api), so the type-checker and the boundaries lint see the dependency (D-TASK017-01 (6), PR #21 code review R1
 * item 2): no file-URL loading, no re-stated composition. Path-mounted routers are resolved against the two mount paths
 * app.ts uses, the docs mount is the one explicit exclusion, anything else mounted under a path is unrecognised.
 */
import type { Express } from 'express';

import { API_PREFIX, createApp, type ModuleRegistration } from '../../apps/api/src/app.js';
import { moduleRegistry } from '../../apps/api/src/modules/index.generated.js';
import type { TenantTxRunner } from '../../apps/api/src/platform/db/index.js';
import { healthRoutes } from '../../apps/api/src/platform/health/router.js';
import { DOCS_PATH } from '../../apps/api/src/platform/openapi/serve.js';
import type { RouteDescriptor } from '../../apps/api/src/platform/routing/define-route.js';
import { defaultPipelineSlots, type PipelineSlots } from '../../apps/api/src/platform/routing/pipeline.js';
import type { RouteSlot } from '../../apps/api/src/platform/routing/slot.js';
import { executeSlot } from '../../apps/api/src/platform/tx/execute.js';
import { OPENAPI_PATH } from '../../tools/openapi/contract.js';
import type { Mount, WalkOptions } from '../../tools/openapi/drift.js';

/** A readiness probe the walk never calls (the checks build routers, they do not serve requests). */
const unusedProbe = {
  readiness: () => Promise.reject(new Error('the drift check never calls a handler')),
  startDraining: () => undefined,
  draining: false,
};

const silentLogger = { info: () => undefined, debug: () => undefined, error: () => undefined };

/**
 * A runner the walk never calls: with it, createApp's boot check (PR32-SEC-05 (b)) passes for tenant-transaction routes
 * exactly as with the runtime's runner, and a request that does reach it fails loudly.
 */
export const unusedRunner: TenantTxRunner<unknown> = {
  transactionOptions: { maxWait: 1, timeout: 1 },
  probeFreshConnection: () => Promise.resolve(),
  withTenantTx: <R>(): Promise<R> => Promise.reject(new Error('api-mounts: the metadata checks never open a transaction')),
};

const passThrough: RouteSlot = () => (_req, _res, next) => {
  next();
};

/**
 * Slots for contract-shaped FIXTURE routes (route-metadata seeded defects): the audit, idempotency and rate-limit
 * stubs refuse at mount the metadata they cannot honour (PR32-SEC-03), which is right for an app and wrong for a test
 * that only compares a route's metadata with openapi.yaml. Never used for the real registry (`loadApiMounts()`).
 */
export function metadataFixtureSlots(): PipelineSlots {
  return {
    ...defaultPipelineSlots({ tenantTx: unusedRunner }),
    rateLimit: passThrough,
    idempotency: passThrough,
    execute: executeSlot({ tenantTx: unusedRunner, audit: () => Promise.resolve() }),
  };
}

export interface ApiMounts {
  /** `API_PREFIX` of apps/api/src/app.ts. */
  readonly apiPrefix: string;
  /** `DOCS_PATH` of apps/api/src/platform/openapi/serve.ts (excluded from the comparison). */
  readonly docsPath: string;
  /** The composed app (for the docs `allowedMethods` and pipeline-order assertions). */
  readonly app: Express;
  /** The composed app's top-level router, mounted at the root. */
  readonly mounts: Mount[];
  /** Mount paths the walker may resolve, and the excluded docs mount. */
  readonly walk: Required<WalkOptions>;
  /** Every route descriptor main.ts would mount (health + module registry). */
  readonly descriptors: readonly RouteDescriptor[];
}

/** Builds the composed app (docs enabled, nothing listens), as main.ts does. */
export function loadApiMounts(modules: readonly ModuleRegistration[] = moduleRegistry, pipeline?: PipelineSlots): ApiMounts {
  const health = healthRoutes({ probe: unusedProbe });
  const app = createApp({
    health,
    modules,
    tenantTx: unusedRunner,
    ...(pipeline === undefined ? {} : { pipeline }),
    logger: silentLogger,
    docs: { specPath: OPENAPI_PATH, apiMode: 'test', topBar: false },
  });
  return {
    apiPrefix: API_PREFIX,
    docsPath: DOCS_PATH,
    app,
    mounts: [{ prefix: '', router: app.router }],
    walk: { mountPaths: [API_PREFIX, DOCS_PATH], excluded: [DOCS_PATH] },
    descriptors: [...health, ...modules.flatMap((module) => module.routes)],
  };
}
