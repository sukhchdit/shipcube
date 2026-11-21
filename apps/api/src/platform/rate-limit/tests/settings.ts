/**
 * Test helper (TASK-041): the rate-limit configuration at its documented defaults, as `createApp({ rateLimit })` takes it.
 * Never imported by production code.
 */
import { RATE_LIMIT_DEFAULTS } from '@platform/config';

import type { RateLimitDependencies } from '../kit.js';

const value = (name: keyof typeof RATE_LIMIT_DEFAULTS): number => RATE_LIMIT_DEFAULTS[name].value;

export const DEFAULT_RATE_LIMIT_SETTINGS: RateLimitDependencies['settings'] = Object.freeze({
  RATE_LIMIT_PUBLIC_PER_MIN: value('public'),
  RATE_LIMIT_AUTH_PER_IP_PER_MIN: value('authIp'),
  RATE_LIMIT_AUTH_PER_ACCOUNT_PER_MIN: value('authAccount'),
  RATE_LIMIT_AUTHENTICATED_PER_MIN: value('authenticated'),
  RATE_LIMIT_WEBHOOK_PER_MIN: value('webhook'),
  RATE_LIMIT_CSP_REPORT_PER_MIN: value('cspReport'),
  RATE_LIMIT_PUBLIC_QUOTE_PER_MIN: value('publicQuoteMin'),
  RATE_LIMIT_PUBLIC_QUOTE_PER_HOUR: value('publicQuoteHour'),
  RATE_LIMIT_PUBLIC_TRACKING_PER_MIN: value('publicTrackingMin'),
  RATE_LIMIT_PUBLIC_TRACKING_PER_HOUR: value('publicTrackingHour'),
  RATE_LIMIT_EMAIL_SEND_PER_ADDRESS_PER_HOUR: value('emailAddress'),
  RATE_LIMIT_EMAIL_SEND_PER_IP_PER_HOUR: value('emailIp'),
  RATE_QUOTE_CREATE_PER_USER_PER_MIN: value('quoteUserMin'),
  RATE_QUOTE_CREATE_PER_USER_PER_HOUR: value('quoteUserHour'),
  RATE_QUOTE_CREATE_PER_ORG_PER_HOUR: value('quoteOrgHour'),
  SSE_MAX_STREAMS_PER_IP: value('streamsIp'),
  SSE_MAX_STREAMS_PER_USER: value('streamsUser'),
  AUTHZ_DENIAL_BUDGET_PER_MIN: value('authzDenial'),
});
