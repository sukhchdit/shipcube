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
import type { AuditPrivacy } from '@platform/audit';
import { findRouteBindingViolations, type RouteBindingViolation } from '@platform/authz';
import type { Config } from '@platform/config';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { type AuditCaptureLog, createAuditCapture } from '../audit/capture.js';
import { authenticate } from '../authn/authenticate.js';
import { authoriseSlot } from '../authz/authorise.js';
import { etag } from '../etag/etag.js';
import { idempotency } from '../idempotency/idempotency.js';
import { deprecationHeaderValues } from '../openapi/deprecation.js';
import { mfaGate } from '../mfa/mfa-gate.js';
import { RATE_LIMIT_DEFAULTS } from '@platform/config';
import type { RateLimitCounter } from '../rate-limit/counter.js';
import { createDenialBudget, type DenialBudget, type DenialBudgetLog } from '../rate-limit/denial-budget.js';
import { routeRateLimit } from '../rate-limit/limits.js';
import type { ScriptClient } from '../rate-limit/store.js';
import { type ExecuteOptions, executeSlot } from '../tx/execute.js';
import { validate } from '../validate/slot.js';
import { isDefinedRoute, type RouteDescriptor } from './define-route.js';
import { registerRouteHandler } from './route-registry.js';
import { setRouteDescriptor } from './route-state.js';
import { type RouteSlot, SlotNotImplementedError } from './slot.js';

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

/**
 * The production slots' options. The tx slot's `audit` test seam (it replaces the whole mounted capture) is not one of
 * them: a test that needs it builds `executeSlot` itself (PR #56 security review, §6 NOTE).
 */
export interface PipelineOptions extends Omit<ExecuteOptions, 'audit'> {
  /**
   * The validated configuration of the audit capture (TASK-029): with it, the tx slot captures every audited route and
   * the authorisation slot audits denials, through one writer whose head-row lock waits `DB_AUDIT_LOCK_TIMEOUT_MS`.
   * This file is the capture's one composition point (PR56-SEC-02): the factory is exported nowhere else.
   */
  readonly auditConfig?: Pick<Config, 'DB_AUDIT_LOCK_TIMEOUT_MS'>;
  /** Where the capture reports an entry it could not write (class-only fields; createApp passes its logger). */
  readonly auditLog?: AuditCaptureLog;
  /**
   * The vault tokeniser, the `ip_hash` index and the user-agent parser (`createAuditPrivacy`, startApi; D-SEC-PR56-01
   * condition 1, D-ARCH-141; TASK-028). Without them the capture refuses every audited route and every route that can
   * answer 403 at mount (D-TASK029-21, the backstop).
   */
  readonly auditPrivacy?: AuditPrivacy;
  /** The step-5 rate-limit slot over the rate-limit kit (createApp builds it); absent, the TASK-020 stub (test compositions). */
  readonly rateLimit?: RouteSlot;
  /**
   * T-39 denial budget (D-SECT39-01 item 6): built here whenever this composition builds the audit capture (`auditConfig`),
   * from the runtime's Valkey client (absent, per instance only) and `AUTHZ_DENIAL_BUDGET_PER_MIN` (default 20). A
   * composition that passes its own `capture` gets a budget only through `denialBudget`.
   */
  readonly valkey?: ScriptClient | undefined;
  readonly authzDenialBudgetPerMin?: number;
  readonly denialBudget?: DenialBudget;
  readonly denialLog?: DenialBudgetLog;
  readonly denialCounter?: RateLimitCounter;
  readonly onStoreUnavailable?: (scope: string) => void;
}

/** The capture options that carry personal values: the writer's tokeniser and IP index, and the parser. */
const privacyOptions = (privacy: AuditPrivacy | undefined) =>
  privacy === undefined
    ? {}
    : { writer: { tokeniser: privacy.tokeniser, ipIndex: privacy.ipIndex }, parseUserAgent: privacy.parseUserAgent };

/** The production slots; `execute` needs the runtime's tenant-transaction runner, the capture the audit config. */
export function defaultPipelineSlots(options: PipelineOptions): PipelineSlots {
  const {
    auditConfig,
    auditLog,
    auditPrivacy,
    rateLimit,
    valkey,
    authzDenialBudgetPerMin,
    denialBudget,
    denialLog,
    denialCounter,
    onStoreUnavailable,
    ...execute
  } = options;
  const capture =
    options.capture ??
    (auditConfig === undefined
      ? undefined
      : createAuditCapture({
          config: auditConfig,
          tenantTx: options.tenantTx,
          ...(auditLog === undefined ? {} : { log: auditLog }),
          ...privacyOptions(auditPrivacy),
        }));
  const withCapture = capture === undefined ? {} : { capture };
  const budget =
    denialBudget ??
    (options.capture === undefined && auditConfig !== undefined
      ? createDenialBudget({
          threshold: authzDenialBudgetPerMin ?? RATE_LIMIT_DEFAULTS.authzDenial.value,
          valkey,
          counter: denialCounter,
          log: denialLog,
          onStoreUnavailable,
        })
      : undefined);
  return {
    authenticate,
    mfaGate,
    authorise: authoriseSlot({ ...withCapture, ...(budget === undefined ? {} : { denialBudget: budget }) }),
    rateLimit: rateLimit ?? routeRateLimit,
    validate,
    idempotency,
    etag,
    execute: executeSlot({ ...execute, ...withCapture }),
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
 * Boot twin of the route-metadata test (PR8-SEC-05 (a)-(d), D-ARCH-107 (3)): refuses to start an app whose routes bind
 * a permission to the wrong tenancy or authentication set, declare an unlisted set, a wrong `permissionAuthenticated`
 * or an unsafe refresh-cookie route without CSRF, or that mounts the mock gateway webhook in production.
 */
export function assertRouteBindings(routes: readonly RouteDescriptor[], env: { readonly production: boolean }): void {
  const violations = findRouteBindingViolations(
    routes.map(({ method, path, permission, tenancy, auth, permissionAuthenticated, csrf }) => ({
      method,
      path,
      permission,
      tenancy,
      auth,
      permissionAuthenticated,
      csrf,
    })),
    env,
  );
  if (violations.length > 0) throw new RouteBindingError(violations);
}

export class UndefinedRouteError extends Error {
  constructor(readonly operationId: string) {
    super(`route ${operationId} was not returned by defineRoute (a hand-built or spread descriptor); mount refused`);
    this.name = 'UndefinedRouteError';
  }
}

/**
 * Mounts every route on `router` through the pipeline and registers it; returns the router. Only descriptors returned
 * by `defineRoute` are mounted (PR #32 m2, PR32-SEC-05 (a)): anything else throws `UndefinedRouteError` before a
 * single handler of the batch reaches the router.
 */
export function mountRoutes(router: Router, routes: readonly RouteDescriptor[], slots: PipelineSlots): Router {
  for (const route of routes) {
    if (!isDefinedRoute(route)) throw new UndefinedRouteError(String((route as { operationId?: unknown }).operationId));
  }
  for (const route of routes) {
    const handlers = routeHandlers(route, slots);
    const last = handlers.at(-1);
    if (last !== undefined) registerRouteHandler(last, route);
    router[route.method](route.path, ...handlers);
  }
  return router;
}

/** The log line of a refused composition: an event per error class, with route identities only (no PII, PR #32 n1). */
export interface BootFailure {
  readonly event: string;
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Maps a composition error of `createApp` to its boot log line, or undefined for anything else (rethrown by the
 * caller). Templates, operationIds, rule names and task ids are route metadata, not personal data.
 */
export function bootFailureOf(error: unknown): BootFailure | undefined {
  if (error instanceof RouteBindingError) {
    const violations = error.violations.map((violation) => `${violation.rule} ${violation.route}`).join('; ');
    return { event: 'api.route_bindings_refused', fields: { error: error.name, violations } };
  }
  if (error instanceof PipelineNotReadyError) {
    return { event: 'api.pipeline_not_ready', fields: { error: error.name, operations: error.operationIds.join(', ') } };
  }
  if (error instanceof SlotNotImplementedError) {
    const { slot, operationId, requirement, owner } = error;
    return { event: 'api.slot_not_implemented', fields: { error: error.name, slot, operation: operationId, requirement, owner } };
  }
  if (error instanceof UndefinedRouteError)
    return { event: 'api.route_not_defined', fields: { error: error.name, operation: error.operationId } };
  return undefined;
}
