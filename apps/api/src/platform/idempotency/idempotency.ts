/**
 * Pipeline step 7a, idempotency (REQ-API-009..011, DR-A20, api/README §5; ADR-0014; TASK-040, replacing the TASK-020
 * contract stub). Per route, from its `x-idempotency` mode:
 *  - `not-applicable` (safe methods, authentication routes, webhooks and the ADR-0014 amendment 1 one-time-secret
 *    routes `createQuote`, `createQuoteShare`, `enrolTotp`, `activateTotp`, `regenerateRecoveryCodes`): pass-through;
 *    an `Idempotency-Key` sent anyway is ignored, so such a route never creates a row (SEC-TC-04, SEC-TC-53);
 *  - `required`: a missing key is 400 `IDEMPOTENCY_KEY_REQUIRED` (AT-US-038-02);
 *  - `optional`: a missing key runs the request without idempotency;
 *  - a malformed key is 400 `VALIDATION_ERROR` on either mode (AT-US-038-03).
 * With a key, the slot records the idempotent request (key, method, concrete path, fingerprint over the validated
 * input; request.ts). The claim, the replay, the completion and the release run in the tx slot (tx/execute.ts), which
 * holds the runtime's tenant-transaction runner and the store: the key is claimed in its own transaction before the
 * route's phases, so a replay or a conflict answers without running `load`, `call` or the handler.
 *
 * Mount-time refusals (PR32-SEC-03 posture, a wiring bug never a request error): an idempotent mode on a safe method
 * or on a `transaction: 'none'` route (which has no database to hold the key) throws {@link IdempotencyRouteError};
 * the tx slot refuses an idempotent route when the composition supplied no store (`IdempotencyNotWiredError`).
 */
import { AppError } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import { inputOf, routeTemplateOf } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import {
  concretePathOf,
  fingerprintOf,
  IDEMPOTENCY_KEY_HEADER,
  isIdempotentMethod,
  parseIdempotencyKey,
  pathOf,
  setIdempotencyRequest,
} from './request.js';

/** A route whose metadata the idempotency store cannot honour (refused when it is mounted). */
export class IdempotencyRouteError extends Error {
  constructor(
    readonly operationId: string,
    reason: string,
  ) {
    super(`route ${operationId}: ${reason}`);
    this.name = 'IdempotencyRouteError';
  }
}

export const idempotency: RouteSlot = (route) => {
  if (route.idempotency === 'not-applicable') {
    return (_req: Request, _res: Response, next: NextFunction) => {
      next();
    };
  }
  const method = route.method.toUpperCase();
  if (!isIdempotentMethod(method)) {
    throw new IdempotencyRouteError(route.operationId, `idempotency ${route.idempotency} on the safe method ${method}`);
  }
  if (route.transaction === 'none') {
    throw new IdempotencyRouteError(route.operationId, `idempotency ${route.idempotency} needs the tenant transaction`);
  }
  const required = route.idempotency === 'required';
  return (req: Request, res: Response, next: NextFunction) => {
    const key = parseIdempotencyKey(req.get(IDEMPOTENCY_KEY_HEADER));
    if (key === undefined) {
      if (required) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
      next();
      return;
    }
    const input = inputOf(res);
    const template = routeTemplateOf(res);
    const path = template === undefined ? pathOf(req.originalUrl) : concretePathOf(template, input.params);
    setIdempotencyRequest(res, { key, method, path, fingerprint: fingerprintOf(method, path, input) });
    next();
  };
};
