/**
 * Pipeline step 3, staff MFA gate (REQ-AUTH-018, threat model §4.3; contract stub of TASK-020). Pass-through: no
 * principal can be an operator yet (the authn stub only yields the anonymous principal), so there is nothing to gate.
 * The MFA task replaces this folder; routes declaring `mfaGateExempt` are the only ones it will let through without a
 * verified second factor.
 */
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';

export const mfaGate: RouteSlot = () => (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
