/**
 * Rate limiting (DR-A22, ADR-0016 am. 1, api/README §7; contract stubs of TASK-020, the Valkey-backed limiter is
 * TASK-041). Two seams:
 * - `ipLimiter`: the step-0 coarse per-IP limiter. createApp mounts it PATH-LESS before `routes`, hence before the
 *   OPTIONS responder and the /api/docs mount (PR21-SEC-01 step 5, PR21-SEC-06, D-ORCH-024 (5)); a limiter mounted
 *   under a path would fail the drift walk by design.
 * - `routeRateLimit`: pipeline step 5, the per-class limit of the route's `rateLimit` (and `rateLimitRoute`).
 * Both pass through until TASK-041 replaces this folder.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';

export function ipLimiter(): RequestHandler {
  return function ipLimiter(_req: Request, _res: Response, next: NextFunction): void {
    next();
  };
}

export const routeRateLimit: RouteSlot = () => (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
