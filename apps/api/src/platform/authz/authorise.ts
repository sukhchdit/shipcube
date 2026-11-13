/**
 * Pipeline step 4, authorisation (REQ-RBAC-006, threat model §4.3; skeleton of TASK-020, live permission resolution
 * and the operator cross-tenant scope are TASK-060). `public` passes; `authenticated` needs an authenticated
 * principal (401 `AUTH_REQUIRED`); a catalogued permission needs an authenticated principal holding it in the active
 * organisation (401, then 403 `AUTHZ_DENIED`, the platform catalogue code; R3-n6: never redeclared by a module).
 */
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';
import { principalOf } from '../routing/route-state.js';

export const authorise: RouteSlot = (route) => (_req: Request, res: Response, next: NextFunction) => {
  if (route.permission === 'public') {
    next();
    return;
  }
  const principal = principalOf(res);
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
