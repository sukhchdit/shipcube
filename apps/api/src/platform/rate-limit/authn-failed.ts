/**
 * The failed-authentication budget, spending side (PR041-SEC-02 (b); ADR-0016 amendment 12 item 4 and amendment 13;
 * D-ARCH-175, D-ARCH-182; rulings B1; TASK-041 part 041-B). A wrapper around the authentication slot, composed by
 * createApp around the default slot and around the `authenticate` test seam whenever the rate limiters are composed.
 * No authenticator calls the limiter, so none can forget to.
 *
 * - One unit of `rl:step0:authn-failed:<ip key>` (60 s, `RATE_LIMIT_PUBLIC_PER_MIN`) is spent when the slot refuses a
 *   request that presents a credential of a kind the route declares: `Authorization` for `session`, a refresh cookie for
 *   `refresh-cookie`, `X-Quote-Token` for `quote-token`, a provider signature header for `signature`. A credential the
 *   route does not declare is never read (D-ARCH-109) and never spends.
 * - A refusal is an {@link AppError} with a 4xx status out of the slot. The one exemption keys on the code
 *   `ACCESS_TOKEN_EXPIRED` alone (condition E4; D-SECPR041-02): a malformed token, a token without a usable `exp` and
 *   every other refusal spend (E2). A 5xx or a non-AppError is a fault of the server, not a refused credential.
 * - The spend never changes the answer of the request that failed: the refusal goes on unchanged once the spend has
 *   settled (bounded by the store timeout and the breaker; a store failure uses the per-instance fallback).
 * - The spend that reaches the limit emits `rate_limit_auth` with `class: 'authn-failed'` and `key_type: 'ip'`, once per
 *   key and window (ADR-0016 am. 12 item 6). Step 0 reads the budget (limits.ts `ipLimiter`).
 */
import { isAppError, presentedKinds } from '@platform/shared';
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';
import { presentsSignature, type RateLimitKit } from './limits.js';
import { authnFailedRule, clientIpKey } from './policy.js';

/** The `class` of the `rate_limit_auth` event of this budget: an event value only, never an `x-rate-limit-class`. */
export const AUTHN_FAILED_EVENT_CLASS = 'authn-failed';

/** The one refusal that spends nothing (E4): the expired access token, from the `exp` pre-check or the library's check. */
export const EXEMPT_REFUSAL_CODE = 'ACCESS_TOKEN_EXPIRED';

/** True when `error`, passed out of the authentication slot, is a refusal that spends one unit (E2, E4). */
export function spendsAuthnBudget(error: unknown): boolean {
  return isAppError(error) && error.status >= 400 && error.status < 500 && error.code !== EXEMPT_REFUSAL_CODE;
}

/** True when the request presents a credential of a kind `auth` declares (the kinds the slot reads, D-ARCH-109). */
export function presentsDeclaredCredential(auth: readonly string[], headers: Request['headers']): boolean {
  return presentedKinds(headers, auth).length > 0 || (auth.includes('signature') && presentsSignature(headers));
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';

/** Wraps `slot` so that its refusals spend the failed-authentication budget of the client IP. */
export function withAuthnFailedBudget(slot: RouteSlot, kit: RateLimitKit): RouteSlot {
  return (route) => {
    const inner = slot(route);
    const declared: readonly string[] = route.auth;
    return function authenticate(req: Request, res: Response, next: NextFunction): void {
      let settled = false;
      const done = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        if (!spendsAuthnBudget(error) || !presentsDeclaredCredential(declared, req.headers)) {
          next(error);
          return;
        }
        kit.limiter
          .spend(authnFailedRule(clientIpKey(req.ip), kit.settings), 'rate-limit')
          .then(({ reached }) => {
            if (reached) kit.events.emit('rate_limit_auth', { class: AUTHN_FAILED_EVENT_CLASS, key_type: 'ip' });
          })
          .catch(() => undefined)
          .finally(() => next(error));
      };
      // A synchronous throw and a rejected promise of the slot are refusals too: Express would pass them on past
      // the wrapper.
      try {
        const result: unknown = inner(req, res, done);
        if (isThenable(result)) result.then(undefined, done);
      } catch (error) {
        done(error);
      }
    };
  };
}
