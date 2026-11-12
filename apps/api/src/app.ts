// Express application factory (ADR-0003, ADR-0016, US-007, US-035). Pure composition apart from the docs router,
// which reads its files once at creation: main.ts supplies the health router, the module registry and the options,
// and owns the listener. Order: request context -> security basics -> JSON body parser -> API docs (when enabled) ->
// OPTIONS responder -> health (root) -> module routers under /api/v1 -> 405/404 fallback -> problem+json handler
// (last). Pipeline slots (authn, authz, rate limit, validation, idempotency, audit, deprecation headers) arrive with
// defineRoute (TASK-020); Pino request logging with TASK-010; Helmet headers and CORS with their security tasks.
import express, { type Express, type Router } from 'express';

import type { ApiMode } from './platform/context/api-mode.js';
import { requestContextMiddleware } from './platform/context/request-context.js';
import { problemHandler, type ErrorLogFields, type ErrorLogger } from './platform/errors/problem-handler.js';
import { optionsResponder, routeFallback } from './platform/http/fallback.js';
import { jsonBodyParser } from './platform/http/json-body.js';
import { createDocsRouter, DOCS_PATH, type DocsOptions } from './platform/openapi/serve.js';
import { createRuntimeLog } from './platform/runtime/log.js';

/** Prefix of every business endpoint (REQ-API-001). */
export const API_PREFIX = '/api/v1';

/** One module's router, as listed by modules/index.generated.ts. Paths inside the router are relative to /api/v1. */
export interface ModuleRegistration {
  readonly name: string;
  readonly router: Router;
}

/** Minimal logger seam until Pino arrives (TASK-010); platform/runtime `RuntimeLog` satisfies it. */
export interface AppLogger extends ErrorLogger {
  info(event: string, fields?: ErrorLogFields): void;
}

export interface AppDependencies {
  /** Mounted at the root, before /api/v1, before authentication, without a rate limit. */
  readonly healthRouter: Router;
  readonly modules: readonly ModuleRegistration[];
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

  app.use(requestContextMiddleware(deps.apiMode === undefined ? {} : { apiMode: deps.apiMode }));
  app.disable('x-powered-by');
  app.use(jsonBodyParser(deps.bodyLimit === undefined ? {} : { limit: deps.bodyLimit }));
  if (deps.docs !== undefined) app.use(DOCS_PATH, createDocsRouter(deps.docs));

  const routes = express.Router();
  routes.use(optionsResponder(routes));
  routes.use(deps.healthRouter);
  const api = express.Router();
  for (const module of deps.modules) api.use(module.router);
  routes.use(API_PREFIX, api);
  app.use(routes);

  app.use(routeFallback(routes));
  app.use(problemHandler({ logger, ...(deps.problemTypeBase === undefined ? {} : { typeBase: deps.problemTypeBase }) }));
  return app;
}
