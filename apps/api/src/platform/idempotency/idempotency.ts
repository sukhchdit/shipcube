/**
 * Pipeline step 7a, idempotency (REQ-API-009..011, DR-A20, api/README §5; contract stub of TASK-020, the encrypted
 * key store is TASK-040). Pass-through for `not-applicable` routes; a route with `idempotency: required` or `optional`
 * is refused when it is mounted (PR32-SEC-03, condition C3), so no unsafe route can accept duplicate requests before
 * TASK-040 (duplicate-label and duplicate-payment guardrails). The route-metadata test pins each route's mode to the
 * contract's `x-idempotency`.
 */
import type { NextFunction, Request, Response } from 'express';

import { SlotNotImplementedError, type RouteSlot } from '../routing/slot.js';

export const idempotency: RouteSlot = (route) => {
  if (route.idempotency !== 'not-applicable') {
    throw new SlotNotImplementedError('idempotency', route.operationId, `idempotency ${route.idempotency}`, 'TASK-040');
  }
  return (_req: Request, _res: Response, next: NextFunction) => {
    next();
  };
};
