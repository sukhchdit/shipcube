/**
 * The class table of the rate limiter (DR-A22, D-035, api/README §7; SEC-P3-29, SEC-P3-02 item 5; TASK-041): which
 * rules a route class consumes for a request, and how a class behaves when Valkey is unreachable. Values come from the
 * configuration (`RATE_LIMIT_*`, `RATE_QUOTE_CREATE_*`, `SSE_MAX_*`), defaults in `RATE_LIMIT_DEFAULTS`.
 *
 * Keys are internal identifiers and the IPv4 address or the IPv6 /64 of a client, kept for one window at most
 * (`clientIpKey`), user and organisation UUIDs, and, for the services that count per account or address, the keyed hash they compute themselves (never the
 * raw e-mail address, D-SECT39-01 item 4).
 */
import type { Config } from '@platform/config';
import { ipKeyGenerator } from 'express-rate-limit';
import { isIP } from 'node:net';

import type { RateLimitClass } from '../routing/define-route.js';
import type { RateRule, StoreFailureMode } from './limiter.js';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

export type RateLimitSettings = Pick<
  Config,
  | 'RATE_LIMIT_PUBLIC_PER_MIN'
  | 'RATE_LIMIT_AUTH_PER_IP_PER_MIN'
  | 'RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN'
  | 'RATE_LIMIT_AUTHENTICATED_PER_MIN'
  | 'RATE_LIMIT_WEBHOOK_PER_MIN'
  | 'RATE_LIMIT_CSP_REPORT_PER_MIN'
  | 'RATE_LIMIT_PUBLIC_QUOTE_PER_MIN'
  | 'RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR'
  | 'RATE_LIMIT_PUBLIC_TRACKING_PER_MIN'
  | 'RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR'
  | 'RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR'
  | 'RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR'
  | 'RATE_QUOTE_CREATE_PER_USER_PER_MIN'
  | 'RATE_QUOTE_CREATE_PER_USER_PER_HOUR'
  | 'RATE_QUOTE_CREATE_PER_ORG_PER_HOUR'
  | 'SSE_MAX_STREAMS_PER_IP'
  | 'SSE_MAX_STREAMS_PER_USER'
>;

/**
 * The counted subject of an IP: the IPv4 address (an IPv4-mapped IPv6 address unmapped), or the /64 prefix of an IPv6
 * address (README §7). Anything that is not an IP address shares one `unknown` key rather than creating one counter per
 * garbage value.
 */
export function clientIpKey(ip: string | undefined): string {
  if (ip === undefined || isIP(ip.replace(/%.*$/u, '')) === 0) return 'unknown';
  return ipKeyGenerator(ip.replace(/%.*$/u, ''), 64);
}

/** Who makes the request, as counter subjects. */
export interface RateSubject {
  /** `clientIpKey(req.ip)`. */
  readonly ip: string;
  /** The user actor's id; absent for an anonymous, guest-token or signature principal. */
  readonly userId?: string | undefined;
}

export interface ClassPolicy {
  readonly rules: readonly RateRule[];
  /** `fallback`: per-instance counters during a Valkey outage (security classes); `fail-open`: no limit (REQ-SEC-006). */
  readonly onStoreFailure: StoreFailureMode;
}

const rule = (name: string, key: string, limit: number, windowMs: number): RateRule => ({ name, key, limit, windowMs });

const NO_RULES: ClassPolicy = Object.freeze({ rules: Object.freeze([]), onStoreFailure: 'fail-open' as const });

/**
 * The route-class rules at pipeline step 5 (the per-IP part of `auth` and `email-send`, the per-user part of
 * `authenticated`). The per-account and per-address parts of `auth` and `email-send` need the validated body and are
 * consumed by the owning service with {@link authAccountRule} and {@link emailSendRules} (TASK-049, TASK-099).
 */
export function classPolicy(klass: RateLimitClass, subject: RateSubject, s: RateLimitSettings): ClassPolicy {
  const { ip, userId } = subject;
  switch (klass) {
    case 'none':
      return NO_RULES;
    case 'public':
      return { rules: [rule('public:ip', ip, s.RATE_LIMIT_PUBLIC_PER_MIN, MINUTE_MS)], onStoreFailure: 'fail-open' };
    case 'public-quote':
      return {
        rules: [
          rule('public-quote:ip:min', ip, s.RATE_LIMIT_PUBLIC_QUOTE_PER_MIN, MINUTE_MS),
          rule('public-quote:ip:hour', ip, s.RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR, HOUR_MS),
        ],
        onStoreFailure: 'fail-open',
      };
    case 'public-tracking':
      return {
        rules: [
          rule('public-tracking:ip:min', ip, s.RATE_LIMIT_PUBLIC_TRACKING_PER_MIN, MINUTE_MS),
          rule('public-tracking:ip:hour', ip, s.RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR, HOUR_MS),
        ],
        onStoreFailure: 'fail-open',
      };
    case 'auth':
      return { rules: [rule('auth:ip', ip, s.RATE_LIMIT_AUTH_PER_IP_PER_MIN, MINUTE_MS)], onStoreFailure: 'fallback' };
    case 'email-send':
      return { rules: [rule('email-send:ip', ip, s.RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR, HOUR_MS)], onStoreFailure: 'fallback' };
    case 'authenticated':
      // A principal without a user actor is counted against its IP, never against a user (AT-US-040-12).
      return {
        rules: [
          userId === undefined
            ? rule('authenticated:ip', ip, s.RATE_LIMIT_AUTHENTICATED_PER_MIN, MINUTE_MS)
            : rule('authenticated:user', userId, s.RATE_LIMIT_AUTHENTICATED_PER_MIN, MINUTE_MS),
        ],
        onStoreFailure: 'fail-open',
      };
    case 'webhook':
      return { rules: [rule('webhook:ip', ip, s.RATE_LIMIT_WEBHOOK_PER_MIN, MINUTE_MS)], onStoreFailure: 'fail-open' };
    case 'csp-report':
      return { rules: [rule('csp-report:ip', ip, s.RATE_LIMIT_CSP_REPORT_PER_MIN, MINUTE_MS)], onStoreFailure: 'fail-open' };
  }
}

/** The 5/min per account identifier of the `auth` class (`accountKey` is the service's keyed hash of the identifier). */
export function authAccountRule(accountKey: string, s: RateLimitSettings): RateRule {
  return rule('auth:account', accountKey, s.RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN, MINUTE_MS);
}

/** The `email-send` class: 3/h per normalised address and 10/h per IP (AT-US-040-13); both fall back per instance. */
export function emailSendRules(addressKey: string, ip: string, s: RateLimitSettings): readonly RateRule[] {
  return [
    rule('email-send:address', addressKey, s.RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR, HOUR_MS),
    rule('email-send:ip', ip, s.RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR, HOUR_MS),
  ];
}

/**
 * `quote-create` (SEC-P3-29, D-053): authenticated VERIFIED `createQuote` callers, instead of the 600/min `authenticated`
 * class: per user 30/min and 300/h, per organisation 1,000/h. The route's service selects it (it reads the verified
 * state server-side); anonymous and unverified callers stay in `public-quote`.
 */
export function quoteCreateRules(userId: string, orgId: string, s: RateLimitSettings): readonly RateRule[] {
  return [
    rule('quote-create:user:min', userId, s.RATE_QUOTE_CREATE_PER_USER_PER_MIN, MINUTE_MS),
    rule('quote-create:user:hour', userId, s.RATE_QUOTE_CREATE_PER_USER_PER_HOUR, HOUR_MS),
    rule('quote-create:org:hour', orgId, s.RATE_QUOTE_CREATE_PER_ORG_PER_HOUR, HOUR_MS),
  ];
}

/**
 * Per-IP ceiling of requests that present a credential at step 0: ten times the per-user limit, so users behind one NAT
 * keep their own per-user budget (AT-US-040-11), and a flood from one IP that presents credentials, valid or forged,
 * stops at this ceiling. It applies to a request under /api/v1 that is not OPTIONS (limits.ts).
 */
export const CREDENTIALED_IP_CEILING_FACTOR = 10;

/** The unauthenticated step-0 budget per IP (120/min); requests that present a credential have the ceiling above. */
export function stepZeroRule(ip: string, credentialed: boolean, s: RateLimitSettings): RateRule {
  return credentialed
    ? rule('step0:credentialed', ip, s.RATE_LIMIT_AUTHENTICATED_PER_MIN * CREDENTIALED_IP_CEILING_FACTOR, MINUTE_MS)
    : rule('step0:anonymous', ip, s.RATE_LIMIT_PUBLIC_PER_MIN, MINUTE_MS);
}

/**
 * The concurrency cap of the quote and booking event streams (README §7, D-048): 5 per user for an authenticated caller,
 * 2 per client IP (/64) for an anonymous one (a quote-token guest).
 */
export function streamSlotRule(subject: RateSubject, s: RateLimitSettings): { name: string; key: string; max: number } {
  return subject.userId === undefined
    ? { name: 'sse:ip', key: subject.ip, max: s.SSE_MAX_STREAMS_PER_IP }
    : { name: 'sse:user', key: subject.userId, max: s.SSE_MAX_STREAMS_PER_USER };
}
