/**
 * Pipeline step 2, authentication (threat model §4.3, DR-A08, D-ARCH-107 (5), D-ARCH-109, ADR-0008 am. 5; contract stub
 * of TASK-020). The slot reads the headers of the kinds in `route.auth` and no others (`presentedKinds`): a credential
 * of another kind, valid or not, is not parsed, not verified, not counted, cannot authenticate, cannot fail the request,
 * cannot choose the principal and does not change the response headers.
 *
 * A route whose set contains `anonymous` gets the anonymous principal when the request presents no credential of a
 * declared kind. Everything else fails closed with 401 `AUTH_REQUIRED` until the authenticators land (bearer session:
 * TASK-052; refresh cookie: TASK-055; guest quote token: TASK-091; webhook signatures: TASK-171/261): the stub verifies
 * nothing, so a route declared as authenticated is never reached unauthenticated and a declared credential is never
 * mistaken for its absence. The response is marked `private, no-store` (SEC-TC-29, T-06, ASVS 8.2.1) when the set has
 * no `anonymous` member or the request presented a declared credential, 401s included; a foreign credential does not
 * mark. The slot records that it read the credentials, so the problem handler trusts the mark from here on.
 */
import type { RouteAuth } from '@platform/authz';
import { AppError, presentedKinds } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';
import { ANONYMOUS, markCredentialsRead, markPrivateResponse, PRIVATE_CACHE_CONTROL, setPrincipal } from '../routing/route-state.js';

/** SEC-TC-29: authenticated responses are never stored by the browser or a shared cache. */
export const AUTHENTICATED_CACHE_CONTROL = PRIVATE_CACHE_CONTROL;

/**
 * The declared credential kinds the request presents. Typed `RouteAuth[]`: this assignment is the compile-time check
 * that @platform/shared's `PresentableKind` is a subset of the authz kinds (the shared package cannot import authz).
 */
const declaredPresented = (req: Request, auth: readonly RouteAuth[]): readonly RouteAuth[] => presentedKinds(req.headers, auth);

export const authenticate: RouteSlot = (route) => {
  const anonymousAllowed = route.auth.includes('anonymous');
  return (req: Request, res: Response, next: NextFunction) => {
    markCredentialsRead(res);
    if (anonymousAllowed && declaredPresented(req, route.auth).length === 0) {
      setPrincipal(res, ANONYMOUS);
      next();
      return;
    }
    markPrivateResponse(res);
    next(new AppError('AUTH_REQUIRED'));
  };
};
