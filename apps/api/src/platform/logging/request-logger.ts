// Access log (US-008 AT-US-008-06, REQ-PLAT-012, NFR-OBS-001; ADR-0016 amendment 2; PR6-SEC-03 item 1). One
// `http.request` line per request with method, ROUTE TEMPLATE, status and duration only: never the URL, path, query
// string or fragment (one-time tokens and identifiers stay out of logs), never headers, never a body. The correlation
// fields come from the request context through the logger's context provider. TASK-020 (defineRoute) sets
// `res.locals.routeTemplate` precisely; until then the template is the mount prefix recorded by `routePrefix` plus the
// matched Express route pattern (`req.route.path`, e.g. `/shipments/:shipmentId`), or null when no route matched.
// Known gap until TASK-020 (PR #20 n6): a router nested under a path (`router.use('/x', sub)`) contributes the leaf
// pattern only, so `/api/v1` + `/:id` hides `/x`; TASK-020 sets `res.locals.routeTemplate` for every route. Health
// probes (`/health/*`) are logged at `debug`, so the probe interval does not flood the `info` log (PR #20 n7).
import { AsyncLocalStorage } from 'node:async_hooks';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Scalar access-log fields; `route` is null when no route matched. */
export type AccessLogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface AccessLogger {
  info(event: string, fields?: AccessLogFields): void;
  debug(event: string, fields?: AccessLogFields): void;
}

export interface RequestLoggerOptions {
  /** Monotonic clock in nanoseconds (tests). */
  readonly now?: () => bigint;
}

const ROUTE_PREFIX_KEY = 'routePrefix';
const ROUTE_TEMPLATE_KEY = 'routeTemplate';

/**
 * The first, path-less layer of a mounted router (`api.use(routePrefix(API_PREFIX))`, then `routes.use(API_PREFIX,
 * api)`): records the static mount prefix, which Express no longer exposes in `req.baseUrl` once an error has unwound
 * the router. It is never mounted under a path itself, because the drift check reports a path-mounted non-router layer
 * (D-ORCH-024 (3), AT-US-034-01).
 */
export function routePrefix(prefix: string): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.locals[ROUTE_PREFIX_KEY] = prefix;
    next();
  };
}

function patternOf(req: Request): string | undefined {
  const route: unknown = (req as { route?: unknown }).route;
  if (typeof route !== 'object' || route === null) return undefined;
  const path: unknown = (route as { path?: unknown }).path;
  return typeof path === 'string' ? path : undefined;
}

/** The route template of a finished request, or null when no route matched (404, 405, refused before routing). */
export function routeTemplateOf(req: Request, res: Response): string | null {
  const explicit: unknown = res.locals[ROUTE_TEMPLATE_KEY];
  if (typeof explicit === 'string') return explicit;
  const pattern = patternOf(req);
  if (pattern === undefined) return null;
  const prefix: unknown = res.locals[ROUTE_PREFIX_KEY];
  return `${typeof prefix === 'string' ? prefix : ''}${pattern}`;
}

const NS_PER_MS = 1_000_000n;
const HEALTH_PREFIX = '/health/';

function isHealthRoute(route: string | null): boolean {
  return route !== null && route.startsWith(HEALTH_PREFIX);
}

export function requestLogger(logger: AccessLogger, options: RequestLoggerOptions = {}): RequestHandler {
  const now = options.now ?? ((): bigint => process.hrtime.bigint());
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = now();
    let logged = false;
    // Bound to the request's async context: 'finish'/'close' fire from socket callbacks that may have lost it.
    const log = AsyncLocalStorage.bind((aborted: boolean): void => {
      if (logged) return;
      logged = true;
      const elapsed = now() - started;
      const route = routeTemplateOf(req, res);
      const write = isHealthRoute(route) ? logger.debug.bind(logger) : logger.info.bind(logger);
      write('http.request', {
        method: req.method,
        route,
        status: res.statusCode,
        duration_ms: Number(elapsed / NS_PER_MS) + Number(elapsed % NS_PER_MS) / 1e6,
        ...(aborted ? { aborted: true } : {}),
      });
    });
    res.once('finish', () => log(false));
    res.once('close', () => log(!res.writableFinished));
    next();
  };
}
