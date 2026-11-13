/**
 * Process log of the api and the worker (US-008, REQ-PLAT-011/012, NFR-OBS-001; TASK-010). A thin factory over the
 * shared Pino logger (`@platform/shared/logging`): one redacted JSON line per event with the mandatory keys
 * (`timestamp`, `level`, `message`, `service`, `version`, `correlation_id`, `org_id`, `actor_id`), the correlation
 * fields read from the caller's context provider for every line, and the thrown value of `error()` serialised by the
 * PR7-SEC-03 serializer (database errors as `{ name, code, originalCode, kind }` only; other errors with redacted
 * message and stack, AT-US-007-03). Only lines whose fields the security-event sink branded are security events
 * (`event_type: "security"`, written whatever the level; `createSecurityEventSink`, PR20-SEC-08 (b)): the runtime's
 * database security events (session integrity, TASK-016 `onSecurityEvent`) reach the security log through
 * `securityEventSinkFrom(log)` (platform/logging/security-events.ts, PR #11 R3-m1). A plain call named `security.<x>`
 * is an ordinary line (PR #20 R2-n4).
 */
import { readFileSync } from 'node:fs';

import { createLogger, type LogContext, type LogLevel, type PlatformLogger } from '@platform/shared/logging';

/** Scalar fields chosen by code: event names, ports, durations, error class names (CLAUDE.md §9). */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

/** The narrow logging seam the runtime modules (services, readiness, shutdown) depend on. */
export interface RuntimeLog {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields, thrown?: unknown): void;
  error(event: string, fields?: LogFields, thrown?: unknown): void;
}

export interface LogSink {
  write(line: string): unknown;
}

export interface RuntimeLogOptions {
  /** Running build version for the `version` key; default {@link UNKNOWN_VERSION}. */
  readonly version?: string;
  /** `APP_LOG_LEVEL`; default `info`. */
  readonly level?: LogLevel;
  /** Correlation context for every line (the api's request context, the worker's job context). */
  readonly context?: () => LogContext | undefined;
  /** Clock (tests). */
  readonly now?: () => Date;
}

export const UNKNOWN_VERSION = '0.0.0-unknown';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,64})?$/;

/** The `version` of a package.json (the service's own manifest, read once at start-up); never throws. */
export function readPackageVersion(packageJson: URL): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJson, 'utf8'));
    const version = typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
    return typeof version === 'string' && VERSION_PATTERN.test(version) ? version : UNKNOWN_VERSION;
  } catch {
    // A missing or unreadable manifest must not stop the process; the line says the version is unknown.
    return UNKNOWN_VERSION;
  }
}

/** The service logger. It satisfies RuntimeLog, the app's AppLogger and the problem handler's ErrorLogger. */
export function createRuntimeLog(service: string, sink: LogSink, options: RuntimeLogOptions = {}): PlatformLogger {
  return createLogger({
    service,
    version: options.version ?? UNKNOWN_VERSION,
    destination: sink,
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
