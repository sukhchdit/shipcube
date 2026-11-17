// Express application factory (ADR-0003, ADR-0016, US-007, US-008, US-035, US-067). Pure composition apart from the
// docs router, which reads its files once at creation: main.ts supplies the health routes, the module registry, the
// tenant-transaction runner, the logger and the options, and owns the listener. Order (platform/routing/pipeline.ts,
// api/README §15 assertion 11): request context -> access log -> security basics -> step-0 per-IP limiter and CORS
// preflight, both PATH-LESS -> JSON body parser -> routes [OPTIONS responder -> API docs (when enabled; `routePrefix`
// is its first layer) -> health (root) -> module routes under /api/v1 (`routePrefix` first, then `mountRoutes`)] ->
// 405/404 fallback -> problem+json handler (last). Every route is a `defineRoute` descriptor mounted by
// `mountRoutes`, which runs the per-route pipeline (authn -> MFA -> authz -> rate limit -> validate -> idempotency ->
// If-Match -> handler + audit in one tenant transaction); no raw handler can be mounted. The docs router sits inside
// `routes` so OPTIONS and 405 answer for it like for every other path (PR #21 N5). The drift and route-metadata
// checks walk this composed stack and exclude only DOCS_PATH (api/README.md §15); a limiter, CORS or Helmet layer
// mounted under a path would fail them by design (D-ORCH-024 (3), (5)).
import type { Config } from '@platform/config';
import express, { type Express } from 'express';

import type { ApiMode } from './platform/context/api-mode.js';
import { requestContextMiddleware } from './platform/context/request-context.js';
import { corsPreflight } from './platform/cors/preflight.js';
import type { TenantTxRunner } from './platform/db/index.js';
import { problemHandler, type ErrorLogger } from './platform/errors/problem-handler.js';
import { optionsResponder, routeFallback } from './platform/http/fallback.js';
import { jsonBodyParser } from './platform/http/json-body.js';
import { requestLogContext } from './platform/logging/correlation.js';
import { requestLogger, routePrefix, type AccessLogFields } from './platform/logging/request-logger.js';
import { createDocsRouter, DOCS_PATH, type DocsOptions } from './platform/openapi/serve.js';
import { ipLimiter } from './platform/rate-limit/limits.js';
import type { RouteDescriptor } from './platform/routing/define-route.js';
import {
  assertPipelineReady,
  assertRouteBindings,
  defaultPipelineSlots,
  mountRoutes,
  type PipelineSlots,
} from './platform/routing/pipeline.js';
import { createRuntimeLog } from './platform/runtime/log.js';
import { type AfterCommitQueue, createAfterCommitQueue } from './platform/tx/after-commit.js';

/** Prefix of every business endpoint (REQ-API-001). */
export const API_PREFIX = '/api/v1';

/** One module's routes, as listed by modules/index.generated.ts. Paths are relative to /api/v1. */
export interface ModuleRegistration {
  readonly name: string;
  readonly routes: readonly RouteDescriptor[];
}

/** The logger seam of the app; the platform logger (platform/runtime `createRuntimeLog`) satisfies it. */
export interface AppLogger extends ErrorLogger {
  info(event: string, fields?: AccessLogFields): void;
  debug(event: string, fields?: AccessLogFields): void;
}

export interface AppDependencies {
  /** `healthRoutes({ probe })`: mounted at the root, before /api/v1, anonymous and without a rate limit. */
  readonly health: readonly RouteDescriptor[];
  readonly modules: readonly ModuleRegistration[];
  /**
   * `RuntimeServices.tenantTx` (platform/db/runtime.ts): the runner of the one tenant transaction per request. Absent,
   * createApp refuses any `transaction: 'tenant'` route (`PipelineNotReadyError`); `transaction: 'none'` routes
   * (health) work without it.
   */
  readonly tenantTx?: TenantTxRunner<unknown> | undefined;
  /**
   * Test seam: replaces the pipeline slots (defaults to `defaultPipelineSlots({ tenantTx })`). With replaced slots the
   * runner check is the test's own business; the binding check still runs.
   */
  readonly pipeline?: PipelineSlots;
  /** Defaults to the redacted platform logger on stdout with the request context on every line. */
  readonly logger?: AppLogger;
  /** `https://docs.<domain>/problems/` for problem `type` URIs; defaults to the openapi example domain. */
  readonly problemTypeBase?: string;
  /** Request body limit (body-parser size string or bytes); default 1 MB (ADR-0016 §4). */
  readonly bodyLimit?: string | number;
  /**
   * ApiMode of every request context (`resolveApiMode(APP_ENV)`, REQ-API-020); default `test`. `live` (APP_ENV
   * production, and only then) also selects the production route bindings (PR8-SEC-05 (d)).
   */
  readonly apiMode?: ApiMode;
  /** Swagger UI at /api/docs (`docsOptionsFrom(config, specPath)`); absent = not mounted (404), REQ-API-003. */
  readonly docs?: DocsOptions;
  /**
   * Runs the routes' `afterCommit` phases (ADR-0003 amendment 2026-11-13). startApi (start-api.ts) passes the
   * process's queue and drains it at shutdown; defaults to a queue over `logger` (tests).
   */
  readonly afterCommit?: AfterCommitQueue;
  /**
   * The validated configuration of the audit capture (TASK-029; startApi passes the process's): audited routes are
   * captured and denials audited. Absent (tests), an audited route is refused when it is mounted.
   */
  readonly auditConfig?: Pick<Config, 'DB_AUDIT_LOCK_TIMEOUT_MS'>;
}

/**
 * Boot checks of every composition (PR32-SEC-05 (b)), before anything is mounted: each route was declared with
 * `defineRoute` (`mountRoutes` refuses others), every tenant-transaction route has the runner, the route bindings hold
 * for this mode (PR8-SEC-05), and every slot stub can honour the metadata (`SlotNotImplementedError`, PR32-SEC-03).
 */
function assertBootable(deps: AppDependencies, routes: readonly RouteDescriptor[]): void {
  if (deps.pipeline === undefined) assertPipelineReady(routes, deps.tenantTx);
  assertRouteBindings(routes, { production: deps.apiMode === 'live' });
}

export function createApp(deps: AppDependencies): Express {
  const moduleRoutes = deps.modules.flatMap((module) => module.routes);
  assertBootable(deps, [...deps.health, ...moduleRoutes]);
  const app = express();
  const logger = deps.logger ?? createRuntimeLog('api', process.stdout, { context: requestLogContext });
  const afterCommit = deps.afterCommit ?? createAfterCommitQueue(logger);
  const slots =
    deps.pipeline ??
    defaultPipelineSlots({
      tenantTx: deps.tenantTx,
      afterCommit,
      ...(deps.auditConfig === undefined ? {} : { auditConfig: deps.auditConfig, auditLog: logger }),
    });

  app.use(requestContextMiddleware(deps.apiMode === undefined ? {} : { apiMode: deps.apiMode }));
  app.use(requestLogger(logger));
  app.disable('x-powered-by');
  app.use(ipLimiter());
  app.use(corsPreflight());
  app.use(jsonBodyParser(deps.bodyLimit === undefined ? {} : { limit: deps.bodyLimit }));

  const routes = express.Router();
  routes.use(optionsResponder(routes));
  if (deps.docs !== undefined) routes.use(DOCS_PATH, createDocsRouter(deps.docs));
  mountRoutes(routes, deps.health, slots);
  const api = express.Router();
  api.use(routePrefix(API_PREFIX));
  mountRoutes(api, moduleRoutes, slots);
  routes.use(API_PREFIX, api);
  app.use(routes);

  app.use(routeFallback(routes));
  app.use(problemHandler({ logger, ...(deps.problemTypeBase === undefined ? {} : { typeBase: deps.problemTypeBase }) }));
  return app;
}
