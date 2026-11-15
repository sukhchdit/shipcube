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
 * denial. No entity id is recorded (pre-validation, PR42-SEC-15). A 401 is an authentication outcome, not audited here.
 * Defence in depth for SEC-TC-29: an authenticated response (no `anonymous` in the set, or a non-anonymous credential)
 * is marked `private, no-store` here too, whatever the authn slot did.
 */
import { PERMISSION_DEFINITIONS } from '@platform/authz';
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { AuditCapture } from '../audit/capture.js';
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

/** Answers `refusal`; an AUTHZ_DENIED is written to the audit trail first when a capture is configured. */
function refuse(
  capture: AuditCapture | undefined,
  route: RouteDescriptor,
  req: Request,
  res: Response,
  next: NextFunction,
  refusal: AppError,
): void {
  if (capture === undefined || refusal.code !== 'AUTHZ_DENIED') {
    next(refusal);
    return;
  }
  const principal = principalOf(res);
  const correlationId = requestContextOf(res)?.correlationId ?? '';
  const request = Object.freeze({
    route,
    input: NOT_VALIDATED,
    principal,
    correlationId,
    transport: transportOf(req, routeTemplateOf(res) ?? route.path),
  });
  const written = (async () => capture.denied(request, tenantContextOf(principal, correlationId)))();
  written.then(() => next(refusal), next);
}

export interface AuthoriseOptions {
  /** The audit capture of the composition (TASK-029); without it denials are not audited (test compositions). */
  readonly capture?: AuditCapture;
}

export function authoriseSlot(options: AuthoriseOptions = {}): RouteSlot {
  return (route) => authoriseRoute(route, options.capture);
}

function authoriseRoute(route: RouteDescriptor, capture: AuditCapture | undefined) {
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
      if (denied) refuse(capture, route, req, res, next, new AppError('AUTHZ_DENIED'));
      else next();
      return;
    }
    const refusal = catalogueRefusal(route.permission, principal);
    if (refusal === undefined) next();
    else refuse(capture, route, req, res, next, refusal);
  };
}

/** The slot without audit capture (test compositions; production uses `authoriseSlot({ capture })`). */
export const authorise: RouteSlot = authoriseSlot();
