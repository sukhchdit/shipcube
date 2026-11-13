// Request context -> log context (US-008, REQ-PLAT-011, PR9-SEC-10). The logger calls this for every line, so a line
// written anywhere below the HTTP layer carries `correlation_id`, `request_id` and (when the client sent a valid one)
// `client_correlation_id` without threading `req` around. `org_id` / `actor_id` stay null until authentication
// (Wave 1) adds them to the request context.
import type { LogContext } from '@platform/shared/logging';

import { currentRequestContext, type RequestContext } from '../context/request-context.js';

export function logContextOf(context: RequestContext): LogContext {
  return {
    correlationId: context.correlationId,
    requestId: context.requestId,
    ...(context.clientCorrelationId === undefined ? {} : { clientCorrelationId: context.clientCorrelationId }),
  };
}

/** The log context of the request being handled, or undefined outside a request (start-up, shutdown). */
export function requestLogContext(): LogContext | undefined {
  const context = currentRequestContext();
  return context === undefined ? undefined : logContextOf(context);
}
