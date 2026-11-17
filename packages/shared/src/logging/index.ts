// `@platform/shared/logging` subpath (US-008, REQ-PLAT-011/012, NFR-OBS-001, NFR-PRIV-001; TASK-010). Server-only:
// re-exports only, never from the package root (Pino stays out of browser bundles and pure packages).
export * from './types.js';
export {
  createLogger,
  DROPPED_ATTRIBUTES_KEY,
  MANDATORY_KEYS,
  SECURITY_EVENT_PREFIX,
  SERIALIZATION_FAILED,
  toSnakeCase,
} from './logger.js';
export {
  BINARY,
  CIRCULAR,
  escapeLineBreakers,
  hasCredentialShape,
  isOmittedKey,
  isPiiKey,
  isSensitiveChildKey,
  isSensitiveKey,
  maskEmails,
  MAX_DEPTH,
  MAX_ITEMS,
  MAX_KEYS,
  MAX_LINE_CHARS,
  MAX_NODES,
  MAX_STRING_LENGTH,
  MORE_KEY,
  normaliseKey,
  OMITTED,
  REDACTED,
  redactString,
  redactValue,
  TRUNCATED,
  TRUNCATION_SUFFIX,
  UNREADABLE,
  UNSUPPORTED,
} from './redaction.js';
export {
  MAX_CAUSE_DEPTH,
  MAX_RAW_STACK_LENGTH,
  MAX_STACK_FRAMES,
  MAX_VALIDATION_DETAILS,
  serializeThrown,
  type SerializedError,
  type SerializedValidationDetail,
} from './serializers/error.js';
export { isDatabaseError, serializeDatabaseError, type SerializedDatabaseError } from './serializers/prisma-error.js';
export { outboundCallFields, type OutboundCallLog } from './outbound.js';
export {
  createSecurityEventSink,
  INVALID_SECURITY_EVENT,
  isSecurityEventName,
  RUNTIME_SECURITY_EVENTS,
  SECURITY_EVENT_FIELDS,
  SECURITY_EVENT_LEVEL,
  SECURITY_EVENT_NAME,
  SECURITY_EVENTS,
  securityEvent,
  securityEventFields,
  securityEventLevel,
  type RuntimeSecurityEventName,
  type SecurityEventLevel,
  type SecurityEventLogger,
  type SecurityEventName,
} from './security-event.js';
