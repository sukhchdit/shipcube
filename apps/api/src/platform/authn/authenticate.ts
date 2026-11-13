/**
 * Pipeline step 2, authentication (threat model §4.3, DR-A08; contract stub of TASK-020). Anonymous routes get the
 * anonymous principal. Every other authentication kind (`session`, `quote-token`, `signature`) fails closed with 401
 * `AUTH_REQUIRED` until its authenticator lands (session: TASK-052; guest quote token: TASK-091; webhook signatures:
 * the payment and carrier webhook tasks), so a route declared as authenticated can never be reached unauthenticated.
 * Responses of non-anonymous routes carry `Cache-Control: private, no-store` from this step on, 401s included
 * (SEC-TC-29, T-06, ASVS 8.2.1).
 */
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';
import { ANONYMOUS, setPrincipal } from '../routing/route-state.js';

/** SEC-TC-29: authenticated responses are never stored by the browser or a shared cache. */
export const AUTHENTICATED_CACHE_CONTROL = 'private, no-store';

export const authenticate: RouteSlot = (route) => (_req: Request, res: Response, next: NextFunction) => {
  if (route.auth === 'anonymous') {
    setPrincipal(res, ANONYMOUS);
    next();
    return;
  }
  res.setHeader('Cache-Control', AUTHENTICATED_CACHE_CONTROL);
  next(new AppError('AUTH_REQUIRED'));
};
