/**
 * Pipeline step 3, staff MFA gate (REQ-AUTH-018, threat model §4.3; contract stub of TASK-020). The stub cannot verify
 * a second factor, so it fails closed for staff (PR32-SEC-03, condition C3): an OPERATOR principal on a route without
 * `mfaGateExempt` answers 403. It answers the platform code `AUTHZ_DENIED`, not the contract's
 * `MFA_ENROLMENT_REQUIRED`: that code belongs to the auth module's catalogue, which the MFA task creates together with
 * the real gate (a stub never pre-claims another module's code). Tenant and anonymous principals pass. The MFA task
 * replaces this folder; routes declaring `mfaGateExempt` are the only ones it lets through without a verified factor.
 */
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import { principalOf } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';

export const mfaGate: RouteSlot = (route) => (_req: Request, res: Response, next: NextFunction) => {
  if (route.mfaGateExempt !== true && principalOf(res).actorScope === 'OPERATOR') {
    next(new AppError('AUTHZ_DENIED'));
    return;
  }
  next();
};
