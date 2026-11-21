/**
 * Pipeline step 4, authorisation (REQ-RBAC-006, threat model §4.3, D-ARCH-107 (6) = PR32-SEC-02 condition C2,
 * D-ARCH-110, ADR-0006 am. 17; skeleton of TASK-020, live permission resolution and the operator cross-tenant scope are
 * TASK-060). Two gates, in order:
 * 1. Credential gate, for every permission value, `public` included: the route's set must contain the principal's
 *    `credential`, else 401 `AUTH_REQUIRED`. The `public` marker waives the permission only, never the authentication
 *    the route declares, so an authenticator that calls `next()` without a principal cannot open a signature,
 *    refresh-cookie or guest-token route.
 * 2. Permission gate: `public` passes, except that a `session` principal on a dual-mode route (`permissionAuthenticated`)
 *    must hold that permission (403); a catalogue `signatureOnly` permission (the payment-gateway webhooks) is held by
 *    the provider's signature principal, which has no actor and is never `authenticated`: a `signature` credential
 *    (else 401) holding it (else 403 `AUTHZ_DENIED`); `authenticated` needs a user actor (401); every other catalogued
 *    permission needs a user actor (401) holding it in the active organisation (403 `AUTHZ_DENIED`, the platform
 *    catalogue code; R3-n6: never redeclared by a module).
 * A 403 `AUTHZ_DENIED` is audited (REQ-AUDIT-010, REQ-RBAC-007; TASK-029): with an audit capture configured, one
 * PERMISSION_DENIED entry with outcome DENIED and the required permission is written in its own transaction before the
 * 403 is answered; if it cannot be written the request answers that failure instead (500 / 503), never an unaudited
 * denial. Before it writes, the slot takes one unit of the actor's denial budget (T-39, D-ARCH-142, D-SECT39-01; rate-limit/
 * denial-budget.ts): denial N+1 of a 60 s window writes ONE aggregated entry and answers 429 RATE_LIMITED, later denials
 * of the window write nothing and answer 429. No entity id is recorded (pre-validation, PR42-SEC-15). A 401 is an authentication outcome, not audited here.
 * Defence in depth for SEC-TC-29: an authenticated response (no `anonymous` in the set, or a non-anonymous credential)
 * is marked `private, no-store` here too, whatever the authn slot did.
 */
import { PERMISSION_DEFINITIONS } from '@platform/authz';
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { AuditCapture } from '../audit/capture.js';
import type { DenialBudget, DenialSubject, DenialVerdict } from '../rate-limit/denial-budget.js';
import { requestContextOf } from '../context/request-context.js';
import type { Principal, RouteDescriptor, RouteInput } from '../routing/define-route.js';
import { markPrivateResponse, principalOf, routeTemplateOf } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { tenantContextOf, transportOf } from '../tx/execute.js';

/** The catalogue permissions only a provider signature satisfies (ADR-0008 am. 4, `signatureOnly`). */
const SIGNATURE_ONLY: ReadonlySet<string> = new Set(
  PERMISSION_DEFINITIONS.filter((definition) => definition.signatureOnly === true).map((definition) => definition.key),
);

/** The permission gate's refusal for a catalogued (non-marker) permission, or undefined when it is satisfied. */
function catalogueRefusal(permission: string, principal: Principal): AppError | undefined {
  if (SIGNATURE_ONLY.has(permission)) {
    if (principal.credential !== 'signature') return new AppError('AUTH_REQUIRED');
    return principal.permissions.has(permission) ? undefined : new AppError('AUTHZ_DENIED');
  }
  if (!principal.authenticated) return new AppError('AUTH_REQUIRED');
  if (permission !== 'authenticated' && !principal.permissions.has(permission)) return new AppError('AUTHZ_DENIED');
  return undefined;
}

/** The (empty) input of a denied request: authorisation runs before validation, so nothing was validated (DR-A08). */
const NOT_VALIDATED: RouteInput = Object.freeze({
  params: Object.freeze({}),
  query: Object.freeze({}),
  body: undefined,
  headers: Object.freeze({}),
});

/** The principal facts the denial budget keys on (organisation, actor or credential kind; no request data). */
const subjectOf = (principal: Principal): DenialSubject =>
  Object.freeze({
    orgId: principal.orgId,
    actorId: principal.actorId,
    credential: principal.credential,
    authenticated: principal.authenticated,
  });

/** 429 RATE_LIMITED of the denial budget: Retry-After plus the three RateLimit-* headers (D-SECT39-01 item 5). */
function refuseOverBudget(res: Response, next: NextFunction, limit: number, retryAfterSeconds: number): void {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', '0');
  res.setHeader('RateLimit-Reset', String(retryAfterSeconds));
  next(new AppError('RATE_LIMITED'));
}

/**
 * Answers `refusal`; an AUTHZ_DENIED is written to the audit trail first, after it took one unit of the actor's denial
 * budget (T-39): denials 1..N are written and answer 403, denial N+1 writes ONE aggregated entry and answers 429, later
 * denials of the window write nothing and answer 429. Only this path spends the budget, so a permitted request never
 * gets a 429 from it.
 */
async function refuseDenied(
  options: AuthoriseOptions,
  capture: AuditCapture,
  route: RouteDescriptor,
  req: Request,
  res: Response,
  next: NextFunction,
  refusal: AppError,
): Promise<void> {
  const principal = principalOf(res);
  const budget = options.denialBudget;
  const verdict: DenialVerdict = budget === undefined ? UNMETERED : await budget.take(subjectOf(principal));
  if (verdict.kind === 'suppressed') {
    refuseOverBudget(res, next, budget?.threshold ?? 0, verdict.retryAfterSeconds);
    return;
  }
  const correlationId = requestContextOf(res)?.correlationId ?? '';
  const request = Object.freeze({
    route,
    input: NOT_VALIDATED,
    principal,
    correlationId,
    transport: transportOf(req, routeTemplateOf(res) ?? route.path),
  });
  try {
    await capture.denied(request, tenantContextOf(principal, correlationId), verdict.mark);
  } catch (error) {
    // The entry was not written: the request answers that failure (D-TASK029-06). The unit stays spent; a carry the
    // window-opening denial claimed goes back, so the next window's first entry still reports it.
    if (verdict.kind === 'individual') await verdict.restoreCarry?.();
    next(error);
    return;
  }
  if (verdict.kind === 'aggregated') refuseOverBudget(res, next, budget?.threshold ?? 0, verdict.retryAfterSeconds);
  else next(refusal);
}

/** Answers `refusal`; an AUTHZ_DENIED is audited first when a capture is configured. */
function refuse(
  options: AuthoriseOptions,
  route: RouteDescriptor,
  req: Request,
  res: Response,
  next: NextFunction,
  refusal: AppError,
): void {
  const { capture } = options;
  if (capture === undefined || refusal.code !== 'AUTHZ_DENIED') {
    next(refusal);
    return;
  }
  refuseDenied(options, capture, route, req, res, next, refusal).catch(next);
}

export interface AuthoriseOptions {
  /** The audit capture of the composition (TASK-029); without it denials are not audited (test compositions). */
  readonly capture?: AuditCapture;
  /**
   * The per-actor denial budget taken before each denial entry is written (T-39, TASK-041). The production pipeline
   * builds it whenever it builds the capture; absent (a test that passes its own capture) every denial is written.
   */
  readonly denialBudget?: DenialBudget;
}

/** The verdict of a composition without a budget: every denial is an ordinary individual entry. */
const UNMETERED: DenialVerdict = Object.freeze({ kind: 'individual', mark: Object.freeze({ kind: 'individual' as const }) });

export function authoriseSlot(options: AuthoriseOptions = {}): RouteSlot {
  return (route) => authoriseRoute(route, options);
}

/** A route whose authorisation can answer 403 AUTHZ_DENIED (`authenticated` and `public` alone never do). */
const canDeny = (route: RouteDescriptor): boolean =>
  route.permission === 'public' ? route.permissionAuthenticated !== undefined : route.permission !== 'authenticated';

function authoriseRoute(route: RouteDescriptor, options: AuthoriseOptions) {
  const { capture } = options;
  // Mount time (R1-m1, PR56-SEC-08 condition 2): a denial that could never be audited refuses the route.
  if (capture !== undefined && canDeny(route)) capture.mountDenials(route);
  const anonymousAllowed = route.auth.includes('anonymous');
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = principalOf(res);
    if (!anonymousAllowed || principal.credential !== 'anonymous') markPrivateResponse(res);
    if (!route.auth.includes(principal.credential)) {
      next(new AppError('AUTH_REQUIRED'));
      return;
    }
    if (route.permission === 'public') {
      const required = route.permissionAuthenticated;
      const denied = required !== undefined && principal.credential === 'session' && !principal.permissions.has(required);
      if (denied) refuse(options, route, req, res, next, new AppError('AUTHZ_DENIED'));
      else next();
      return;
    }
    const refusal = catalogueRefusal(route.permission, principal);
    if (refusal === undefined) next();
    else refuse(options, route, req, res, next, refusal);
  };
}

/** The slot without audit capture (test compositions; production uses `authoriseSlot({ capture })`). */
export const authorise: RouteSlot = authoriseSlot();
