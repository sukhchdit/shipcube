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
import type { AuditPrivacy } from '@platform/audit';
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
import { createRateLimitKit, denialOutageReporter, type RateLimitDependencies } from './platform/rate-limit/kit.js';
import { createRouteRateLimit, ipLimiter, type RateLimitKit } from './platform/rate-limit/limits.js';
import { createRateLimitCounter } from './platform/rate-limit/counter.js';
import { securityEventSinkFrom } from './platform/logging/security-events.js';
import type { RouteDescriptor } from './platform/routing/define-route.js';
import {
  assertPipelineReady,
  assertRouteBindings,
  defaultPipelineSlots,
  mountRoutes,
  type PipelineSlots,
} from './platform/routing/pipeline.js';
import type { RouteSlot } from './platform/routing/slot.js';
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
  /** Optional (test loggers): the security events of the rate limiter fall back to `error` without it. */
  warn?(event: string, fields?: AccessLogFields): void;
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
  /**
   * The capture's vault tokeniser, `ip_hash` index and user-agent parser (`createAuditPrivacy` over AUDIT_VAULT_KEY,
   * AUDIT_VAULT_HMAC_KEY and AUDIT_INDEX_KEY; startApi builds it; D-SEC-PR56-01 condition 1, D-ARCH-141; TASK-028).
   * Used only with `auditConfig`. Absent, the capture refuses every audited route and every route that can answer 403
   * when it is mounted (D-TASK029-21).
   */
  readonly auditPrivacy?: AuditPrivacy;
  /**
   * Test seam: replaces ONLY the authentication slot of the default pipeline (the rest, the audit capture included, is
   * still composed from these dependencies), so a test can drive the production composition to a 403 before the
   * session authenticator (TASK-052) exists. startApi never sets it; with `pipeline` it is ignored; createApp refuses
   * it in `live` mode (AuthenticateSeamError). Retired with TASK-052 (the real authenticator replaces the stub).
   * @internal
   */
  readonly authenticate?: RouteSlot;
  /**
   * Hops of reverse proxy trusted for the client IP (`TRUST_PROXY_HOPS`; the local edge proxy is one hop, CloudFront +
   * ALB two): Express sets `trust proxy` from it, so `req.ip` (the step-0 limiter key and the audit entry IP) is the first
   * untrusted hop, never a forged leading X-Forwarded-For address (EC-A12, AT-US-087-04). Default 0: no proxy trusted.
   */
  readonly trustProxyHops?: number;
  /**
   * The rate limiters (TASK-041): the configuration and the process's Valkey client. startApi always passes it; absent
   * (test compositions, the RBAC matrix app: the seam that keeps the generated matrix below the per-IP budget) the
   * step-0 limiter passes through and the step-5 slot is the TASK-020 stub. The denial budget (T-39) does not depend on
   * it: the pipeline builds one whenever it builds the audit capture.
   */
  readonly rateLimit?: RateLimitDependencies;
}

/**
 * Boot checks of every composition (PR32-SEC-05 (b)), before anything is mounted: each route was declared with
 * `defineRoute` (`mountRoutes` refuses others), every tenant-transaction route has the runner, the route bindings hold
 * for this mode (PR8-SEC-05), and every slot stub can honour the metadata (`SlotNotImplementedError`, PR32-SEC-03).
 */
/** A live composition that replaces the authentication slot (PR #61 dup-review R1-m6): refused at boot. */
export class AuthenticateSeamError extends Error {
  constructor() {
    super('the authentication test seam (AppDependencies.authenticate) is refused in live mode');
    this.name = 'AuthenticateSeamError';
  }
}

function assertBootable(deps: AppDependencies, routes: readonly RouteDescriptor[]): void {
  if (deps.authenticate !== undefined && deps.apiMode === 'live') throw new AuthenticateSeamError();
  if (deps.pipeline === undefined) assertPipelineReady(routes, deps.tenantTx);
  assertRouteBindings(routes, { production: deps.apiMode === 'live' });
}

/** The production slots over these dependencies (the capture gets the audit config and the privacy dependencies). */
function defaultSlots(
  deps: AppDependencies,
  afterCommit: AfterCommitQueue,
  logger: AppLogger,
  kit: RateLimitKit | undefined,
  events: ReturnType<typeof securityEventSinkFrom>,
): PipelineSlots {
  const slots = defaultPipelineSlots({
    ...(kit === undefined ? {} : { rateLimit: createRouteRateLimit(kit) }),
    valkey: deps.rateLimit?.valkey,
    ...(deps.rateLimit === undefined ? {} : { authzDenialBudgetPerMin: deps.rateLimit.settings.AUTHZ_DENIAL_BUDGET_PER_MIN }),
    denialCounter: kit?.counter ?? createRateLimitCounter(),
    denialLog: { warn: (event, fields) => (logger.warn ?? logger.error).call(logger, event, fields) },
    onStoreUnavailable: denialOutageReporter(events),
    tenantTx: deps.tenantTx,
    afterCommit,
    ...(deps.auditConfig === undefined
      ? {}
      : {
          auditConfig: deps.auditConfig,
          auditLog: logger,
          ...(deps.auditPrivacy === undefined ? {} : { auditPrivacy: deps.auditPrivacy }),
        }),
  });
  return deps.authenticate === undefined ? slots : { ...slots, authenticate: deps.authenticate };
}

export function createApp(deps: AppDependencies): Express {
  const moduleRoutes = deps.modules.flatMap((module) => module.routes);
  assertBootable(deps, [...deps.health, ...moduleRoutes]);
  const app = express();
  const logger = deps.logger ?? createRuntimeLog('api', process.stdout, { context: requestLogContext });
  const afterCommit = deps.afterCommit ?? createAfterCommitQueue(logger);
  const events = securityEventSinkFrom({
    warn: (event, fields) => (logger.warn ?? logger.error).call(logger, event, fields),
    error: (event, fields) => logger.error(event, fields),
  });
  const kit = deps.rateLimit === undefined ? undefined : createRateLimitKit(deps.rateLimit, events);
  const slots = deps.pipeline ?? defaultSlots(deps, afterCommit, logger, kit, events);

  app.set('trust proxy', deps.trustProxyHops ?? 0);

  app.use(requestContextMiddleware(deps.apiMode === undefined ? {} : { apiMode: deps.apiMode }));
  app.use(requestLogger(logger));
  app.disable('x-powered-by');
  app.use(ipLimiter(kit));
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
