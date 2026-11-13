/**
 * Pipeline step 2, authentication (threat model §4.3, DR-A08, D-ARCH-107 (5); contract stub of TASK-020). A route whose
 * set contains `anonymous` gets the anonymous principal when the request presents no credential (no `Authorization`
 * header, refresh cookie or `X-Quote-Token`). Everything else fails closed with 401 `AUTH_REQUIRED` until the
 * authenticators land (bearer session: TASK-052; refresh cookie: TASK-055; guest quote token: TASK-091; webhook
 * signatures: TASK-171/261): a route declared as authenticated is never reached unauthenticated, and a credential on an
 * anonymous-capable route is never silently ignored. Responses that are authenticated in the D-ARCH-107 (5) sense (the
 * set has no `anonymous`, or the request presented a credential) are marked `private, no-store` from this step on, 401s
 * included (SEC-TC-29, T-06, ASVS 8.2.1).
 *
 * Stub-only, superseded by D-ARCH-109 (code review R2-m4, PR32-SEC-16): refusing a request on an `anonymous` route
 * because it carries a credential of a kind the route does not declare (a stale refresh cookie, an expired bearer)
 * follows D-ARCH-107 (5) verbatim. D-ARCH-109 rules that a foreign credential is ignored; TASK-020 part 020-B makes this
 * slot read only the declared kinds, before TASK-027 merges and TASK-052 starts. See credentials.ts.
 */
import { AppError, presentsCredential } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';
import { ANONYMOUS, markPrivateResponse, PRIVATE_CACHE_CONTROL, setPrincipal } from '../routing/route-state.js';

/** SEC-TC-29: authenticated responses are never stored by the browser or a shared cache. */
export const AUTHENTICATED_CACHE_CONTROL = PRIVATE_CACHE_CONTROL;

export const authenticate: RouteSlot = (route) => {
  const anonymousAllowed = route.auth.includes('anonymous');
  return (req: Request, res: Response, next: NextFunction) => {
    if (anonymousAllowed && !presentsCredential(req.headers)) {
      setPrincipal(res, ANONYMOUS);
      next();
      return;
    }
    markPrivateResponse(res);
    next(new AppError('AUTH_REQUIRED'));
  };
};
