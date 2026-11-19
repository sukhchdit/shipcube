/**
 * Rate limiting (REQ-API-014, REQ-SEC-005, DR-A22, ADR-0016 am. 1, api/README §7; TASK-020 contract stubs, TASK-041 the
 * Valkey-backed limiter). Two seams:
 * - `ipLimiter`: the step-0 coarse per-IP limiter. createApp mounts it PATH-LESS before `routes`, hence before the
 *   OPTIONS responder and the /api/docs mount (PR21-SEC-01 step 5, PR21-SEC-06, D-ORCH-024 (5)); a limiter mounted
 *   under a path would fail the drift walk by design. It counts every request except the orchestrator probes
 *   (`/health/*`, class `none`): 120/min per IP when no credential is presented ("unauthenticated 120/min/IP"), and the
 *   ten times the `authenticated` limit per IP when one is, so a flood of forged credentials cannot bypass it. It runs before the
 *   authentication slot, so a flood never reaches bcrypt or JWT verification.
 * - `routeRateLimit`: pipeline step 5, the per-class limit of the route's `rateLimit` (per IP, or per user for the
 *   `authenticated` class), after authorisation (DR-A08).
 * Both come in two forms. Without a {@link RateLimitKit} (test compositions) `ipLimiter()` passes through and
 * `routeRateLimit` refuses, when it is mounted, a route of a class whose limit is a security control rather than
 * capacity protection (PR32-SEC-03, condition C3): `auth` (the brute-force limit README §7 keeps even during a Valkey
 * outage) and `email-send` (mail abuse). With a kit (startApi) both are real; the answers are 429 RATE_LIMITED with
 * `Retry-After` and the three draft-06 `RateLimit-*` headers, which every limited response carries.
 *
 * The client IP is `req.ip`, which Express derives from the trusted proxy chain only (`trust proxy` = TRUST_PROXY_HOPS,
 * app.ts), and IPv6 is counted by /64.
 */
import { AppError, presentsCredential } from '@platform/shared';
import type { SecurityEventSink } from '@platform/shared/logging';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { RateLimitClass } from '../routing/define-route.js';
import { principalOf } from '../routing/route-state.js';
import { SlotNotImplementedError, type RouteSlot } from '../routing/slot.js';
import type { RateLimitCounter } from './counter.js';
import type { RateDecision, RateLimiter, RateReading } from './limiter.js';
import { classPolicy, clientIpKey, type RateLimitSettings, stepZeroRule } from './policy.js';

/** Classes the pass-through stub may not serve (PR32-SEC-03). */
export const SECURITY_RATE_LIMIT_CLASSES: readonly RateLimitClass[] = Object.freeze(['auth', 'email-send']);

/** Everything the real limiters need, composed once per process (createRateLimitKit, kit.ts). */
export interface RateLimitKit {
  readonly limiter: RateLimiter;
  readonly settings: RateLimitSettings;
  readonly counter: RateLimitCounter;
  /** The security-event sink: `rate_limit_auth` on a refused `auth` request. */
  readonly events: SecurityEventSink;
}

/** The orchestrators' liveness and readiness probes (class `none`, README §7) are never counted. */
const isProbe = (path: string): boolean => path === '/health/live' || path === '/health/ready';

/** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (REQ-API-014, draft-06 names; no X-RateLimit-*). */
function setLimitHeaders(res: Response, reading: RateReading): void {
  res.setHeader('RateLimit-Limit', String(reading.limit));
  res.setHeader('RateLimit-Remaining', String(reading.remaining));
  res.setHeader('RateLimit-Reset', String(reading.resetSeconds));
}

/** Applies a decision: headers always (when the store answered), then 429 with Retry-After on a refusal. */
function answer(decision: RateDecision, res: Response, next: NextFunction, onRefused: () => void): void {
  if (decision.reading !== undefined) setLimitHeaders(res, decision.reading);
  if (decision.allowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', String(decision.retryAfterSeconds));
  onRefused();
  next(new AppError('RATE_LIMITED'));
}

/** The passive step-0 limiter of compositions without a kit. */
function passThrough(): RequestHandler {
  return function ipLimiter(_req: Request, _res: Response, next: NextFunction): void {
    next();
  };
}

export function ipLimiter(kit?: RateLimitKit): RequestHandler {
  if (kit === undefined) return passThrough();
  return function ipLimiter(req: Request, res: Response, next: NextFunction): void {
    if (isProbe(req.path)) {
      next();
      return;
    }
    const credentialed = presentsCredential(req.headers);
    const rule = stepZeroRule(clientIpKey(req.ip), credentialed, kit.settings);
    kit.limiter
      .consume([rule], { onStoreFailure: 'fail-open', scope: 'rate-limit' })
      .then((decision) => answer(decision, res, next, () => kit.counter.refused(credentialed ? 'authenticated' : 'unauthenticated')), next);
  };
}

/** The contract stub: passes, except for the security classes it cannot honour (PR32-SEC-03). */
export const routeRateLimit: RouteSlot = (route) => {
  if (SECURITY_RATE_LIMIT_CLASSES.includes(route.rateLimit)) {
    throw new SlotNotImplementedError('rate-limit', route.operationId, `rate-limit class ${route.rateLimit}`, 'TASK-041');
  }
  return (_req: Request, _res: Response, next: NextFunction) => {
    next();
  };
};

/** Pipeline step 5 over the kit: the rules of the route's class, consumed per request. */
export function createRouteRateLimit(kit: RateLimitKit): RouteSlot {
  return (route) => {
    if (route.rateLimit === 'none') {
      return (_req: Request, _res: Response, next: NextFunction) => {
        next();
      };
    }
    const klass = route.rateLimit;
    return (req: Request, res: Response, next: NextFunction) => {
      const principal = principalOf(res);
      const subject = { ip: clientIpKey(req.ip), ...(principal.authenticated ? { userId: principal.actorId } : {}) };
      const { rules, onStoreFailure } = classPolicy(klass, subject, kit.settings);
      kit.limiter.consume(rules, { onStoreFailure, scope: 'rate-limit' }).then(
        (decision) =>
          answer(decision, res, next, () => {
            kit.counter.refused(klass);
            // A refused brute-force-class request is a security event (AT-US-040-10); the coarse IP is not an attribute yet.
            if (klass === 'auth') kit.events.emit('rate_limit_auth', { class: klass, key_type: 'ip' });
          }),
        next,
      );
    };
  };
}
