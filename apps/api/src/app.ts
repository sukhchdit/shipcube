// Express application factory (ADR-0003, ADR-0016, US-007, US-008). Pure composition, no I/O: main.ts supplies the
// health router, the module registry and the logger, and owns the listener. Order: request context -> access log ->
// security basics -> JSON body parser -> health (root) -> module routers under /api/v1 -> 405/404 fallback ->
// problem+json handler (last). Pipeline slots (authn, authz, rate limit, validation, idempotency, audit) arrive with
// defineRoute (TASK-020); Helmet headers and CORS with their security tasks; OpenAPI UI with TASK-017.
import express, { type Express, type Router } from 'express';

import { requestContextMiddleware } from './platform/context/request-context.js';
import { problemHandler, type ErrorLogger } from './platform/errors/problem-handler.js';
import { routeFallback } from './platform/http/fallback.js';
import { jsonBodyParser } from './platform/http/json-body.js';
import { requestLogContext } from './platform/logging/correlation.js';
import { requestLogger, routePrefix, type AccessLogFields } from './platform/logging/request-logger.js';
import { createRuntimeLog } from './platform/runtime/log.js';

/** Prefix of every business endpoint (REQ-API-001). */
export const API_PREFIX = '/api/v1';

/** One module's router, as listed by modules/index.generated.ts. Paths inside the router are relative to /api/v1. */
export interface ModuleRegistration {
  readonly name: string;
  readonly router: Router;
}

/** The logger seam of the app; the platform logger (platform/runtime `createRuntimeLog`) satisfies it. */
export interface AppLogger extends ErrorLogger {
  info(event: string, fields?: AccessLogFields): void;
}

export interface AppDependencies {
  /** Mounted at the root, before /api/v1, before authentication, without a rate limit. */
  readonly healthRouter: Router;
  readonly modules: readonly ModuleRegistration[];
  /** Defaults to the redacted platform logger on stdout with the request context on every line. */
  readonly logger?: AppLogger;
  /** `https://docs.<domain>/problems/` for problem `type` URIs; defaults to the openapi example domain. */
  readonly problemTypeBase?: string;
  /** Request body limit (body-parser size string or bytes); default 1 MB (ADR-0016 §4). */
  readonly bodyLimit?: string | number;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  const logger = deps.logger ?? createRuntimeLog('api', process.stdout, { context: requestLogContext });

  app.use(requestContextMiddleware());
  app.use(requestLogger(logger));
  app.disable('x-powered-by');
  app.use(jsonBodyParser(deps.bodyLimit === undefined ? {} : { limit: deps.bodyLimit }));

  const routes = express.Router();
  routes.use(deps.healthRouter);
  const api = express.Router();
  for (const module of deps.modules) api.use(module.router);
  routes.use(API_PREFIX, routePrefix(API_PREFIX), api);
  app.use(routes);

  app.use(routeFallback(routes));
  app.use(problemHandler({ logger, ...(deps.problemTypeBase === undefined ? {} : { typeBase: deps.problemTypeBase }) }));
  return app;
}
