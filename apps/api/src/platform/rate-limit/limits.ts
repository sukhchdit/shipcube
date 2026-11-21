/**
 * Rate limiting (REQ-API-014, REQ-SEC-005, DR-A22, ADR-0016 am. 1, 12 and 13, api/README §7; TASK-020 contract stubs,
 * TASK-041 the Valkey-backed limiter). Two seams:
 * - `ipLimiter`: the step-0 coarse per-IP limiter. createApp mounts it PATH-LESS before `routes`, hence before the
 *   OPTIONS responder and the /api/docs mount (PR21-SEC-01 step 5, PR21-SEC-06, D-ORCH-024 (5)); a limiter mounted
 *   under a path would fail the drift walk by design. It counts every request except the orchestrator probes
 *   (`/health/*`, class `none`): 120/min per IP ("unauthenticated 120/min/IP") for every request, and against a per-IP
 *   ceiling of ten times the `authenticated` limit when a request under /api/v1 presents a credential header. The ceiling
 *   is chosen by the presence of the header, not by its validity: it bounds a flood per IP, it does not tell a forged
 *   credential from a valid one (ADR-0016 am. 12 items 3 and 4). The two API-prefix conditions below are exact (A1).
 *   A request that takes the ceiling also reads the IP's failed-authentication budget in the same store call, and is
 *   refused while that budget is spent (ADR-0016 am. 12 item 4, am. 13 item 2; authn-failed.ts spends it).
 * - `routeRateLimit`: pipeline step 5, the per-class limit of the route's `rateLimit` (per IP, or per user for the
 *   `authenticated` class), after authorisation (DR-A08).
 * Both come in two forms. Without a {@link RateLimitKit} (test compositions) `ipLimiter()` passes through and
 * `routeRateLimit` refuses, when it is mounted, a route of a class whose limit is a security control rather than
 * capacity protection (PR32-SEC-03, condition C3): `auth` (the brute-force limit README §7 keeps even during a Valkey
 * outage) and `email-send` (mail abuse). With a kit (startApi) both are real; the answers are 429 RATE_LIMITED with
 * `Retry-After` and the three draft-06 `RateLimit-*` headers, which every limited response carries. A response that
 * passed both stages carries the reading of the route's class; a step-0 429 carries the step-0 reading.
 *
 * The client IP is `req.ip`, which Express derives from the trusted proxy chain only (`trust proxy` = TRUST_PROXY_HOPS,
 * app.ts), and IPv6 is counted by /64.
 */
import { AppError, type CredentialHeaders, presentedKinds } from '@platform/shared';
import type { SecurityEventSink } from '@platform/shared/logging';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { RateLimitClass, RouteDescriptor } from '../routing/define-route.js';
import { principalOf } from '../routing/route-state.js';
import { SlotNotImplementedError, type RouteSlot } from '../routing/slot.js';
import type { StoreBreaker } from './breaker.js';
import type { RateLimitCounter, StepZeroLabel } from './counter.js';
import type { InFlightLedger } from './in-flight.js';
import type { RateDecision, RateLimiter, RateReading } from './limiter.js';
import { AUTHN_FAILED_RULE, authnFailedRule, classPolicy, clientIpKey, type RateLimitSettings, stepZeroRule } from './policy.js';

/** Classes the pass-through stub may not serve (PR32-SEC-03). */
export const SECURITY_RATE_LIMIT_CLASSES: readonly RateLimitClass[] = Object.freeze(['auth', 'email-send']);

/** Everything the real limiters need, composed once per process (createRateLimitKit, kit.ts). */
export interface RateLimitKit {
  readonly limiter: RateLimiter;
  readonly settings: RateLimitSettings;
  readonly counter: RateLimitCounter;
  /**
   * The security-event sink: `rate_limit_auth` on the first refusal of a key and window in the `auth` and `email-send`
   * classes, and on the spend that exhausts the failed-authentication budget (class `authn-failed`).
   */
  readonly events: SecurityEventSink;
  /** The process breaker of the store (ADR-0016 am. 12 item 7): createApp hands it to the denial budget too. */
  readonly breaker: StoreBreaker;
  /** The per-instance in-flight ledger of the failed-authentication gate (in-flight.ts; D-TASK041-18). */
  readonly inFlight: InFlightLedger;
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

/** True for `/api/v1` and `/api/v1/...` (exact and case-sensitive; a path in another spelling takes the anonymous rule). */
const underPrefix = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/** The three provider signature headers (openapi.yaml `securitySchemes`; lower-case, as Node delivers them). */
export const SIGNATURE_HEADER_NAMES = Object.freeze(['stripe-signature', 'x-mock-signature', 'x-carrier-signature'] as const);

const nonBlank = (value: string | readonly string[] | undefined): boolean =>
  value !== undefined && (typeof value === 'string' ? [value] : value).some((item) => item.trim() !== '');

/** True when the request carries a non-blank provider signature header (presence only, never validity). */
export const presentsSignature = (headers: CredentialHeaders): boolean => SIGNATURE_HEADER_NAMES.some((name) => nonBlank(headers[name]));

/** What createApp tells the step-0 limiter about the mounted API (the limiter does not import app.ts). */
export interface StepZeroOptions {
  /** `/api/v1` (API_PREFIX). */
  readonly apiPrefix: string;
  /** The exact full paths of the routes that declare `refresh-cookie` ({@link refreshCookieRoutePaths}). */
  readonly refreshCookiePaths: ReadonlySet<string>;
}

/**
 * The step-0 selector (ADR-0016 am. 12 item 3, am. 13 item 1; D-ARCH-174, D-ARCH-182; rulings A1, B1 R1, B2): the
 * credentialed rule only for a non-OPTIONS request under the prefix that presents an `Authorization` header, an
 * `X-Quote-Token`, a provider signature header, or a refresh cookie on exactly the path of a route that declares
 * `refresh-cookie`. A request that carries only the cookie anywhere else (sign-in, public reads, another spelling of a
 * cookie path) takes the unauthenticated budget. `presentsCredential` of `@platform/shared` is not used here: the problem
 * handler keeps it for cache marking.
 */
export function selectsCredentialedRule(req: Pick<Request, 'method' | 'path' | 'headers'>, options: StepZeroOptions): boolean {
  if (req.method === 'OPTIONS' || !underPrefix(req.path, options.apiPrefix)) return false;
  if (presentedKinds(req.headers, ['session', 'quote-token']).length > 0 || presentsSignature(req.headers)) return true;
  return options.refreshCookiePaths.has(req.path) && presentedKinds(req.headers, ['refresh-cookie']).length > 0;
}

/** The counter label of a step-0 refusal (TASK-214 exports them). */
function stepZeroLabel(credentialed: boolean, decision: RateDecision): StepZeroLabel {
  if (!credentialed) return 'unauthenticated';
  return decision.reading?.rule === AUTHN_FAILED_RULE ? 'step0-authn-failed' : 'step0-credentialed';
}

/**
 * The step-0 limiter over the kit. A request that takes the credentialed ceiling ({@link selectsCredentialedRule}) is
 * counted and checked against the IP's failed-authentication budget in one store call; while that budget is spent it is
 * answered 429 with the rest of the failed window, valid credentials included (ADR-0016 am. 13 item 2, the accepted
 * scope). Everything else (API docs, OPTIONS, paths outside the prefix, a cookie-only request off the cookie routes)
 * takes the anonymous budget, whatever headers it carries, and is never refused by the failed-authentication budget.
 *
 * A parallel burst would read the same settled count, so a credentialed request is also admitted against the IP's
 * in-flight ledger (in-flight.ts; R1-M1, D-TASK041-18): it holds one unit from here until the authentication slot's
 * outcome is known (authn-failed.ts releases it, after a spend has landed) or, if the slot is never reached, until the
 * response closes. While `settled + held` reaches the limit it is answered 429 with `Retry-After: 1`. A request whose
 * response closed before the store answered (an aborted client) is never admitted, so an abort cannot skip the hold.
 */
export function ipLimiter(kit: RateLimitKit | undefined, options: StepZeroOptions): RequestHandler {
  if (kit === undefined) return passThrough();
  return function ipLimiter(req: Request, res: Response, next: NextFunction): void {
    if (isProbe(req.path)) {
      next();
      return;
    }
    const credentialed = selectsCredentialedRule(req, options);
    const ip = clientIpKey(req.ip);
    const rule = stepZeroRule(ip, credentialed, kit.settings);
    const consumeOptions = { onStoreFailure: 'fail-open', scope: 'rate-limit' } as const;
    let decided: Promise<RateDecision>;
    if (credentialed) {
      const gate = authnFailedRule(ip, kit.settings);
      let closed = false;
      res.once('close', () => {
        closed = true;
        kit.inFlight.release(res);
      });
      const admit = (settled: number): boolean => !closed && kit.inFlight.admit(ip, settled, gate.limit, res);
      decided = kit.limiter.consumeGated(rule, gate, { ...consumeOptions, admit });
    } else {
      decided = kit.limiter.consume([rule], consumeOptions);
    }
    decided.then((decision) => answer(decision, res, next, () => kit.counter.refused(stepZeroLabel(credentialed, decision)))).catch(next);
  };
}

/** A `refresh-cookie` route whose path is not literal (a parameter or pattern): step 0 matches cookie routes exactly. */
export class RefreshCookiePathError extends Error {
  constructor(
    readonly operationId: string,
    readonly path: string,
  ) {
    super(`refresh-cookie route ${operationId} has the non-literal path ${path}: step 0 selects the cookie by exact path`);
    this.name = 'RefreshCookiePathError';
  }
}

/** A literal path: one or more `/segment` of unreserved characters; no parameter, wildcard, group or escape. */
const LITERAL_PATH = /^(?:\/[A-Za-z0-9._~-]+)+$/u;

/**
 * The exact full paths of the module routes that declare `refresh-cookie` (`getCsrfToken`, `refreshSession`,
 * `logoutSession`; ADR-0016 am. 13 item 1). createApp derives them from the mounted routes at boot and refuses a
 * cookie route with a non-literal path, so step 0 can match every cookie route by its exact path. The Express routers
 * are case-insensitive and not strict, so another spelling of a cookie path (`/api/v1/auth/refresh/`,
 * `/API/V1/auth/refresh`) is still served; such a request takes the unauthenticated budget instead (am. 13 item 1).
 */
export function refreshCookieRoutePaths(routes: readonly RouteDescriptor[], apiPrefix: string): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const route of routes) {
    if (!(route.auth as readonly string[]).includes('refresh-cookie')) continue;
    if (!LITERAL_PATH.test(route.path)) throw new RefreshCookiePathError(route.operationId, route.path);
    paths.add(`${apiPrefix}${route.path}`);
  }
  return paths;
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
      kit.limiter
        .consume(rules, { onStoreFailure, scope: 'rate-limit' })
        .then((decision) =>
          answer(decision, res, next, () => {
            kit.counter.refused(klass);
            // The first refusal of a key and window is a security event (AT-US-040-10, ADR-0016 am. 12 item 6); the
            // counter counts every refusal. The coarse IP is not an attribute yet.
            if (SECURITY_RATE_LIMIT_CLASSES.includes(klass) && !decision.allowed && decision.first) {
              kit.events.emit('rate_limit_auth', { class: klass, key_type: 'ip' });
            }
          }),
        )
        .catch(next);
    };
  };
}
