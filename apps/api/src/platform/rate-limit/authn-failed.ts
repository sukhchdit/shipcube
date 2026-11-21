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
 * - The in-flight unit step 0 holds for the request (in-flight.ts; R1-M1, D-TASK041-18) is marked as entered before
 *   the slot is called, so a client that disconnects no longer frees it (D-ARCH-226, R2-M1). Once the slot's outcome is
 *   known (after the spend, when there is one) the wrapper releases it, whether or not the client is still there, so a
 *   parallel burst is bounded by the budget too. A request whose unit the close already released (its client left
 *   between step 0 and the slot) is not authenticated and goes no further (D-TASK041-20).
 * - A slot that ends without an outcome is ended by the wrapper (change C-4, D-ARCH-230, PR041-SEC-16): when it answered
 *   the client itself the unit is released, nothing is spent and nothing more is called; when nothing was answered the
 *   wrapper reports an error through its own outcome path (500, no spend, the unit released). Either case writes the
 *   error line `api.authn_slot_unreported` at most once a minute per operation and instance. Nothing about the
 *   response releases an entered unit: neither its close nor its `finish` (a request timer may answer while the slot
 *   still runs).
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

/** The error line of a slot that ended without an outcome (C-4): an application log line, not a security event. */
export const SLOT_UNREPORTED_EVENT = 'api.authn_slot_unreported';

/** The error the wrapper reports for a slot that ended without an outcome and answered nothing (500, no spend). */
export const SLOT_UNREPORTED_MESSAGE = 'The authentication slot ended without an outcome';

/** How often the error line may be written per operation and instance (the pattern of `createOutageReporter`). */
export const SLOT_UNREPORTED_INTERVAL_MS = 60_000;

/** The logger seam of the wrapper (the app logger satisfies it): the one error line, scalar fields chosen by code. */
export interface AuthnSlotLog {
  error(event: string, fields?: Readonly<Record<string, string | number>>): void;
}

export interface AuthnFailedBudgetOptions {
  readonly log: AuthnSlotLog;
  /** The clock of the once-a-minute rule of the error line (tests); default `Date.now`. */
  readonly now?: () => number;
}

/**
 * Wraps `slot` so that its refusals spend the failed-authentication budget of the client IP.
 *
 * The contract of the slot (ADR-0016 amendment 13 item 6, Release; D-ARCH-230): an outcome is `next` called once (with
 * or without an error), a synchronous throw or a rejection of the promise it returns. An authenticator never starts or
 * ends the response (setting a header is allowed). A slot that has not reported when it returns returns a promise that
 * stays pending until it reports; a slot that returns no promise may report later from a callback, and the wrapper
 * waits for it while nothing has been answered. A slot that ends without an outcome (its promise fulfils, or it
 * returns no promise after answering the client itself) is ended here, as the module comment describes.
 */
export function withAuthnFailedBudget(slot: RouteSlot, kit: RateLimitKit, options: AuthnFailedBudgetOptions): RouteSlot {
  const now = options.now ?? Date.now;
  // When the error line was last written, per operation of this app (one wrapper per createApp, so per instance). The
  // keys are the operation ids of the mounted routes: a fixed set.
  const lineWrittenAt = new Map<string, number>();
  return (route) => {
    const inner = slot(route);
    const declared: readonly string[] = route.auth;
    const writeLine = (res: Response): void => {
      const at = now();
      const previous = lineWrittenAt.get(route.operationId);
      if (previous !== undefined && at - previous < SLOT_UNREPORTED_INTERVAL_MS) return;
      lineWrittenAt.set(route.operationId, at);
      // The status the slot (or whatever answered) wrote; absent when nothing was written. No request data.
      options.log.error(SLOT_UNREPORTED_EVENT, {
        operation_id: route.operationId,
        ...(res.headersSent ? { status: res.statusCode } : {}),
      });
    };
    return function authenticate(req: Request, res: Response, next: NextFunction): void {
      // From here only the outcome releases the unit (D-ARCH-226). A unit the close already released means the client
      // left after admission: the response is closed and nobody waits for it, so the slot is not entered at all, else
      // it would run outside the hold (D-TASK041-20). The access line recorded the abort at the close.
      if (!kit.inFlight.enter(res)) return;
      let settled = false;
      // The outcome is known: the in-flight unit step 0 holds for this request (in-flight.ts) is released, after the
      // spend has landed when there is one, so the next step-0 reading counts this refusal either way. This holds
      // whether or not the client is still connected.
      const done = (error?: unknown): void => {
        // Only the first outcome counts; a later call or a rejection that arrives after it is dropped on purpose.
        if (settled) return;
        settled = true;
        if (!spendsAuthnBudget(error) || !presentsDeclaredCredential(declared, req.headers)) {
          kit.inFlight.release(res);
          next(error);
          return;
        }
        kit.limiter
          .spend(authnFailedRule(clientIpKey(req.ip), kit.settings), 'rate-limit')
          .then(({ reached }) => {
            if (reached) kit.events.emit('rate_limit_auth', { class: AUTHN_FAILED_EVENT_CLASS, key_type: 'ip' });
          })
          // `spend` never rejects; only a throwing event sink lands here. It must not change the answer, and the
          // sink is the logger itself, so there is nowhere else to report it.
          .catch(() => undefined)
          .finally(() => {
            kit.inFlight.release(res);
            next(error);
          });
      };
      // The slot ended without an outcome (C-4). It answered the client itself: the unit is released, nothing is
      // spent and nothing more is called (a later report is dropped). Nothing was answered: the wrapper reports an
      // error through its own outcome path, so the problem handler answers 500, nothing is spent, the unit is released.
      const endedWithoutOutcome = (): void => {
        if (settled) return;
        writeLine(res);
        if (res.headersSent) {
          settled = true;
          kit.inFlight.release(res);
          return;
        }
        done(new Error(SLOT_UNREPORTED_MESSAGE));
      };
      // A synchronous throw and a rejected promise of the slot are refusals too: Express would pass them on past
      // the wrapper. A promise rejected with a falsy value is an error, as the Express 5 router makes it (R1-m1); a
      // falsy synchronous throw is one too (stricter than the router, which would continue the request). A promise
      // that fulfils before an outcome, and a plain return after the slot answered the client, end the slot.
      try {
        const result: unknown = inner(req, res, done);
        if (isThenable(result)) {
          result.then(endedWithoutOutcome, (error: unknown) => done(error || new Error('Rejected promise')));
        } else if (res.headersSent) {
          endedWithoutOutcome();
        }
      } catch (error) {
        done(error || new Error('Thrown falsy value'));
      }
    };
  };
}
