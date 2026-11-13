// Brand of security-event field objects (PR20-SEC-08 (b), PR20-SEC-04; TASK-010). Only the security-event sink
// (security-event.ts) attaches it, and only the logger reads it: a line becomes a security event (`event_type:
// "security"`, written whatever APP_LOG_LEVEL says) only when the sink wrote it, never because a caller named an event
// `security.<x>`. Package-private: index.ts does not re-export this module.

const SECURITY_EVENT_MARK: unique symbol = Symbol('platform.logging.securityEvent');

/** Brands `fields` (a fresh object the sink owns) with the non-enumerable security-event mark and returns it. */
export function markSecurityEvent<T extends object>(fields: T): T {
  Object.defineProperty(fields, SECURITY_EVENT_MARK, { value: true, enumerable: false });
  return fields;
}

/** True when `fields` was branded by the security-event sink; false for anything else, including hostile Proxies. */
export function isSecurityEventFields(fields: unknown): boolean {
  if (typeof fields !== 'object' || fields === null) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(fields, SECURITY_EVENT_MARK);
    return descriptor !== undefined && 'value' in descriptor && descriptor.value === true;
  } catch {
    return false;
  }
}
