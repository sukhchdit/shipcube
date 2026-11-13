/**
 * Pipeline step 7a, idempotency (REQ-API-009..011, DR-A20, api/README §5; contract stub of TASK-020, the encrypted
 * key store is TASK-040). Pass-through: no route with `idempotency: required` or `optional` is mounted yet, and the
 * route-metadata test already pins each route's mode to the contract's `x-idempotency`.
 */
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';

export const idempotency: RouteSlot = () => (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
