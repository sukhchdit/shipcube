// The correlation ID format of ADR-0016 §15 (US-008 AT-US-008-01/02, REQ-PLAT-011; PR #20 n2; TASK-010). Single
// source for the api request context, the worker job context and the logger, which all validate the same values.

/** An inbound `X-Correlation-Id` (or a job payload's `correlation_id`) is used only when it matches this pattern. */
export const CORRELATION_ID_PATTERN: RegExp = /^[A-Za-z0-9-]{8,64}$/;

/** True for a string in the ADR-0016 §15 correlation ID format. */
export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
}
