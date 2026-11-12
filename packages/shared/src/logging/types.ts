// Logging contract (US-008, REQ-PLAT-011/012, NFR-OBS-001, NFR-PRIV-001; ADR-0016 §15; TASK-010). Types only: the
// implementation is logger.ts (Pino 10), redaction.ts, serializers/ and security-event.ts. Server-only: this folder is
// published as the `@platform/shared/logging` subpath, never from the package root, so browser bundles and the pure
// packages (pricing) that import `@platform/shared` never pull Pino in.

/** Pino level labels; `APP_LOG_LEVEL` in @platform/config uses the same set. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
/** Levels a line can be written at (`silent` only disables output). */
export type LineLevel = Exclude<LogLevel, 'silent'>;

/**
 * Per-line context, read through `CreateLoggerOptions.context` for EVERY line (the api reads its AsyncLocalStorage
 * request context; the worker its job context). Missing values are written as JSON `null` for the mandatory keys.
 */
export interface LogContext {
  /** `correlation_id`: the echoed X-Correlation-Id (validated inbound value or a generated UUID). */
  readonly correlationId?: string;
  /** `request_id`: always server-generated (PR9-SEC-10, L-14); the audit shard key of TASK-030. */
  readonly requestId?: string;
  /** `client_correlation_id`: the inbound X-Correlation-Id, only when it passed the ADR-0016 §15 pattern. */
  readonly clientCorrelationId?: string;
  /** `org_id` of the active organisation (authn tasks fill it). */
  readonly orgId?: string;
  /** `actor_id` of the authenticated user or system actor (authn tasks fill it). */
  readonly actorId?: string;
}

/** Structured fields of one line. Values of any shape; the logger redacts them before writing (redaction.ts). */
export type LogFields = Readonly<Record<string, unknown>>;

/** Where lines go: `process.stdout` in the apps, an in-memory sink in tests. One complete JSON line per write. */
export interface LogDestination {
  write(line: string): unknown;
}

export interface CreateLoggerOptions {
  /** `service` key: `api` or `worker`. */
  readonly service: string;
  /** `version` key: the running build's version (package version or image tag). */
  readonly version: string;
  /** Default `info`. */
  readonly level?: LogLevel;
  readonly destination: LogDestination;
  /** Read for every line; may return undefined (start-up, shutdown, outside a request or job). */
  readonly context?: () => LogContext | undefined;
  /** Clock for the `timestamp` key (tests). */
  readonly now?: () => Date;
}

/**
 * The one logger seam. `event` is a stable dotted name chosen by code (`http.request`, `api.listening`), written as
 * both `message` and `event`. `fields` are redacted (keys and values) before writing. `thrown` is serialised by the
 * error serializer into `err`: database/Prisma/driver errors as `{ name, code, originalCode, kind }` only, other errors
 * as `{ name, message, stack }` with the message and stack run through the value redactor (AT-US-007-03).
 *
 * Every line carries the mandatory keys of AT-US-008-05: `timestamp` (UTC ISO 8601 with `Z`), `level` (label),
 * `message`, `service`, `version`, `correlation_id`, `org_id`, `actor_id`; plus `event`, and `request_id` /
 * `client_correlation_id` when known. Fields can never overwrite a mandatory key.
 */
export interface PlatformLogger {
  fatal(event: string, fields?: LogFields, thrown?: unknown): void;
  error(event: string, fields?: LogFields, thrown?: unknown): void;
  warn(event: string, fields?: LogFields, thrown?: unknown): void;
  info(event: string, fields?: LogFields, thrown?: unknown): void;
  debug(event: string, fields?: LogFields, thrown?: unknown): void;
  trace(event: string, fields?: LogFields, thrown?: unknown): void;
  /** A logger whose lines also carry `bindings` (redacted once, at bind time). */
  child(bindings: LogFields): PlatformLogger;
  isLevelEnabled(level: LineLevel): boolean;
}

/** Scalar attributes of a security event; never raw PII (keys and values pass the redactor and the PII key filter). */
export type SecurityEventAttrs = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Receiver of security events (`api/README.md` §13 catalogue, plus the runtime database events of TASK-016 that the
 * runtime log routes here by their `security.` prefix). Lines carry `event_type: "security"` and `event: <name>`.
 */
export interface SecurityEventSink {
  emit(name: string, attrs?: SecurityEventAttrs): void;
}
