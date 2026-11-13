/**
 * Request-pipeline order skeleton (DR-A08, ADR-0003 "Route metadata", threat model §4.3, api/README §15 assertion 11;
 * TASK-020). App level (app.ts): request context (1) -> step-0 per-IP limiter and CORS preflight, path-less ->
 * JSON body -> routes [OPTIONS responder -> /api/docs -> health -> /api/v1 modules] -> 405/404 -> problem+json.
 * Per route, in this fixed order: route context -> authenticate (2) -> MFA gate (3) -> authorise (4) -> rate limit (5)
 * -> validate (6) -> idempotency (7a) -> If-Match/ETag (7b) -> execute = handler + audit in one tenant transaction
 * (8-10). Each step is a slot from its own platform/<slot>/ folder; `mountRoutes` is the only way a handler reaches
 * a router, and it registers every mounted route (route-registry.ts), so the route-metadata test can prove that no
 * handler bypassed `defineRoute`.
 */
import { findRouteBindingViolations, type RouteBindingViolation } from '@platform/authz';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { authenticate } from '../authn/authenticate.js';
import { authorise } from '../authz/authorise.js';
import { etag } from '../etag/etag.js';
import { idempotency } from '../idempotency/idempotency.js';
import { deprecationHeaderValues } from '../openapi/deprecation.js';
import { mfaGate } from '../mfa/mfa-gate.js';
import { routeRateLimit } from '../rate-limit/limits.js';
import { type ExecuteOptions, executeSlot } from '../tx/execute.js';
import { validate } from '../validate/slot.js';
import type { RouteDescriptor } from './define-route.js';
import { registerRouteHandler } from './route-registry.js';
import { setRouteDescriptor } from './route-state.js';
import type { RouteSlot } from './slot.js';

/** The per-route steps, in pipeline order; the name of each Express handler is `route:<step>`. */
export const ROUTE_PIPELINE = [
  'context',
  'authenticate',
  'mfaGate',
  'authorise',
  'rateLimit',
  'validate',
  'idempotency',
  'etag',
  'execute',
] as const;
export type RoutePipelineStep = (typeof ROUTE_PIPELINE)[number];

export type PipelineSlots = Readonly<Record<Exclude<RoutePipelineStep, 'context'>, RouteSlot>>;

/** The production slots; `execute` needs the runtime's tenant-transaction runner. */
export function defaultPipelineSlots(options: ExecuteOptions): PipelineSlots {
  return {
    authenticate,
    mfaGate,
    authorise,
    rateLimit: routeRateLimit,
    validate,
    idempotency,
    etag,
    execute: executeSlot(options),
  };
}

/**
 * Step `context`: records the descriptor and the full template (`req.baseUrl` of the literal mounts + leaf path) and,
 * for a deprecated route, sets Deprecation/Sunset/Link on every response, problems included (US-035 AT-US-035-04).
 */
const contextSlot: RouteSlot = (route) => {
  const deprecation: Readonly<Record<string, string>> = route.deprecated === undefined ? {} : deprecationHeaderValues(route.deprecated);
  return (req: Request, res: Response, next: NextFunction) => {
    setRouteDescriptor(res, route, `${req.baseUrl}${route.path === '/' ? '' : route.path}` || '/');
    for (const [name, value] of Object.entries(deprecation)) res.setHeader(name, value);
    next();
  };
};

const named = (name: string, handler: RequestHandler): RequestHandler => Object.defineProperty(handler, 'name', { value: name });

/** The Express handlers of one route, in `ROUTE_PIPELINE` order. */
export function routeHandlers(route: RouteDescriptor, slots: PipelineSlots): RequestHandler[] {
  return ROUTE_PIPELINE.map((step) => named(`route:${step}`, (step === 'context' ? contextSlot : slots[step])(route)));
}

export class PipelineNotReadyError extends Error {
  constructor(readonly operationIds: readonly string[]) {
    super(`no tenant-transaction runner, but ${String(operationIds.length)} route(s) need one: ${operationIds.join(', ')}`);
    this.name = 'PipelineNotReadyError';
  }
}

/**
 * Boot check (PR #11 code review R3-m1 (iii), PR #11 security review R3.6): an app that mounts any
 * `transaction: 'tenant'` route must have the runtime's runner, so such a route can never answer 503 in a deployed
 * process. Called by main.ts before the listener opens.
 */
export function assertPipelineReady(routes: readonly RouteDescriptor[], tenantTx: unknown): void {
  const needing = routes.filter((route) => route.transaction === 'tenant').map((route) => route.operationId);
  if (needing.length > 0 && tenantTx === undefined) throw new PipelineNotReadyError(needing);
}

export class RouteBindingError extends Error {
  constructor(readonly violations: readonly RouteBindingViolation[]) {
    super(`route bindings violate PR8-SEC-05: ${violations.map((violation) => violation.message).join('; ')}`);
    this.name = 'RouteBindingError';
  }
}

/**
 * Boot twin of the route-metadata test (PR8-SEC-05 (a)-(d)): refuses to start an app whose routes bind a permission
 * to the wrong tenancy or authentication, or that mounts the mock gateway webhook in production.
 */
export function assertRouteBindings(routes: readonly RouteDescriptor[], env: { readonly production: boolean }): void {
  const violations = findRouteBindingViolations(
    routes.map(({ method, path, permission, tenancy, auth }) => ({ method, path, permission, tenancy, auth })),
    env,
  );
  if (violations.length > 0) throw new RouteBindingError(violations);
}

/** Mounts every route on `router` through the pipeline and registers it; returns the router. */
export function mountRoutes(router: Router, routes: readonly RouteDescriptor[], slots: PipelineSlots): Router {
  for (const route of routes) {
    const handlers = routeHandlers(route, slots);
    const last = handlers.at(-1);
    if (last !== undefined) registerRouteHandler(last, route);
    router[route.method](route.path, ...handlers);
  }
  return router;
}
