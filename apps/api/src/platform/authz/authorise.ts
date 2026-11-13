/**
 * Pipeline step 4, authorisation (REQ-RBAC-006, threat model §4.3, D-ARCH-107 (6) = PR32-SEC-02 condition C2; skeleton
 * of TASK-020, live permission resolution and the operator cross-tenant scope are TASK-060). Two gates, in order:
 * 1. Credential gate, for every permission value, `public` included: the route's set must contain the principal's
 *    `credential`, else 401 `AUTH_REQUIRED`. The `public` marker waives the permission only, never the authentication
 *    the route declares, so an authenticator that calls `next()` without a principal cannot open a signature,
 *    refresh-cookie or guest-token route.
 * 2. Permission gate: `public` passes, except that a `session` principal on a dual-mode route (`permissionAuthenticated`)
 *    must hold that permission (403); `authenticated` needs a user actor (401); a catalogued permission needs a user
 *    actor (401) holding it in the active organisation (403 `AUTHZ_DENIED`, the platform catalogue code; R3-n6: never
 *    redeclared by a module).
 * Defence in depth for SEC-TC-29: an authenticated response (no `anonymous` in the set, or a non-anonymous credential)
 * is marked `private, no-store` here too, whatever the authn slot did.
 */
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';
import { markPrivateResponse, principalOf } from '../routing/route-state.js';

export const authorise: RouteSlot = (route) => {
  const anonymousAllowed = route.auth.includes('anonymous');
  return (_req: Request, res: Response, next: NextFunction) => {
    const principal = principalOf(res);
    if (!anonymousAllowed || principal.credential !== 'anonymous') markPrivateResponse(res);
    if (!route.auth.includes(principal.credential)) {
      next(new AppError('AUTH_REQUIRED'));
      return;
    }
    if (route.permission === 'public') {
      const required = route.permissionAuthenticated;
      const denied = required !== undefined && principal.credential === 'session' && !principal.permissions.has(required);
      next(denied ? new AppError('AUTHZ_DENIED') : undefined);
      return;
    }
    if (!principal.authenticated) {
      next(new AppError('AUTH_REQUIRED'));
      return;
    }
    if (route.permission !== 'authenticated' && !principal.permissions.has(route.permission)) {
      next(new AppError('AUTHZ_DENIED'));
      return;
    }
    next();
  };
};
