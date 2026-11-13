// Express application factory (ADR-0003, ADR-0016, US-007, US-035, US-067). Pure composition apart from the docs
// router, which reads its files once at creation: main.ts supplies the health routes, the module registry, the
// tenant-transaction runner and the options, and owns the listener. Order (platform/routing/pipeline.ts, api/README
// §15 assertion 11): request context -> security basics -> step-0 per-IP limiter and CORS preflight, both PATH-LESS
// -> JSON body parser -> routes [OPTIONS responder -> API docs (when enabled) -> health (root) -> module routes under
// /api/v1] -> 405/404 fallback -> problem+json handler (last). Every route is a `defineRoute` descriptor mounted by
// `mountRoutes`, which runs the per-route pipeline (authn -> MFA -> authz -> rate limit -> validate -> idempotency ->
// If-Match -> handler + audit in one tenant transaction); no raw handler can be mounted. The docs router sits inside
// `routes` so OPTIONS and 405 answer for it like for every other path (PR #21 N5). The drift and route-metadata
// checks walk this composed stack and exclude only DOCS_PATH (api/README.md §15); a limiter, CORS or Helmet layer
// mounted under a path would fail them by design (D-ORCH-024 (5)).
import express, { type Express } from 'express';

import type { ApiMode } from './platform/context/api-mode.js';
import { requestContextMiddleware } from './platform/context/request-context.js';
import { corsPreflight } from './platform/cors/preflight.js';
import type { TenantTxRunner } from './platform/db/index.js';
import { problemHandler, type ErrorLogFields, type ErrorLogger } from './platform/errors/problem-handler.js';
import { optionsResponder, routeFallback } from './platform/http/fallback.js';
import { jsonBodyParser } from './platform/http/json-body.js';
import { createDocsRouter, DOCS_PATH, type DocsOptions } from './platform/openapi/serve.js';
import { ipLimiter } from './platform/rate-limit/limits.js';
import type { RouteDescriptor } from './platform/routing/define-route.js';
import { defaultPipelineSlots, mountRoutes, type PipelineSlots } from './platform/routing/pipeline.js';
import { createRuntimeLog } from './platform/runtime/log.js';

/** Prefix of every business endpoint (REQ-API-001). */
export const API_PREFIX = '/api/v1';

/** One module's routes, as listed by modules/index.generated.ts. Paths are relative to /api/v1. */
export interface ModuleRegistration {
  readonly name: string;
  readonly routes: readonly RouteDescriptor[];
}

/** Minimal logger seam until Pino arrives (TASK-010); platform/runtime `RuntimeLog` satisfies it. */
export interface AppLogger extends ErrorLogger {
  info(event: string, fields?: ErrorLogFields): void;
}

export interface AppDependencies {
  /** `healthRoutes({ probe })`: mounted at the root, before /api/v1, anonymous and without a rate limit. */
  readonly health: readonly RouteDescriptor[];
  readonly modules: readonly ModuleRegistration[];
  /**
   * `RuntimeServices.tenantTx` (platform/db/runtime.ts): the runner of the one tenant transaction per request. Absent,
   * every `transaction: 'tenant'` route answers 503; `transaction: 'none'` routes (health) work without it.
   */
  readonly tenantTx?: TenantTxRunner<unknown> | undefined;
  /** Test seam: replaces the pipeline slots (defaults to `defaultPipelineSlots({ tenantTx })`). */
  readonly pipeline?: PipelineSlots;
  /** Defaults to the JSON-line runtime log on stdout, which records scalar fields only. */
  readonly logger?: AppLogger;
  /** `https://docs.<domain>/problems/` for problem `type` URIs; defaults to the openapi example domain. */
  readonly problemTypeBase?: string;
  /** Request body limit (body-parser size string or bytes); default 1 MB (ADR-0016 §4). */
  readonly bodyLimit?: string | number;
  /** ApiMode of every request context (`resolveApiMode(APP_ENV)`, REQ-API-020); default `test`. */
  readonly apiMode?: ApiMode;
  /** Swagger UI at /api/docs (`docsOptionsFrom(config, specPath)`); absent = not mounted (404), REQ-API-003. */
  readonly docs?: DocsOptions;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  const logger = deps.logger ?? createRuntimeLog('api', process.stdout);
  const slots = deps.pipeline ?? defaultPipelineSlots({ tenantTx: deps.tenantTx });

  app.use(requestContextMiddleware(deps.apiMode === undefined ? {} : { apiMode: deps.apiMode }));
  app.disable('x-powered-by');
  app.use(ipLimiter());
  app.use(corsPreflight());
  app.use(jsonBodyParser(deps.bodyLimit === undefined ? {} : { limit: deps.bodyLimit }));

  const routes = express.Router();
  routes.use(optionsResponder(routes));
  if (deps.docs !== undefined) routes.use(DOCS_PATH, createDocsRouter(deps.docs));
  mountRoutes(routes, deps.health, slots);
  const api = express.Router();
  mountRoutes(
    api,
    deps.modules.flatMap((module) => module.routes),
    slots,
  );
  routes.use(API_PREFIX, api);
  app.use(routes);

  app.use(routeFallback(routes));
  app.use(problemHandler({ logger, ...(deps.problemTypeBase === undefined ? {} : { typeBase: deps.problemTypeBase }) }));
  return app;
}
