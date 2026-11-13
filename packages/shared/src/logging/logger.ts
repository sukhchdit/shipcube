// The platform logger on Pino 10 (US-008 AT-US-008-04/05, REQ-PLAT-011/012, NFR-OBS-001, NFR-PRIV-001; ADR-0016 §15;
// TASK-010). One JSON line per call with the mandatory keys of AT-US-008-05, the per-line context, the redacted fields
// and the serialised thrown value. Security events (written by the security-event sink, security-event.ts) get
// `event_type: "security"`, the per-event attribute allow-list and scalar-only snake_case attributes, and are written
// whatever the configured level (PR20-SEC-04). A log call never throws: a failure writes a minimal fallback line.
import { pino, type Logger as PinoLogger } from 'pino';

import { CORRELATION_ID_PATTERN } from '../correlation/correlation-id.js';
import { normaliseKey, redactValue } from './redaction.js';
import { securityEventFields, SECURITY_EVENT_NAME } from './security-event.js';
import { isSecurityEventFields } from './security-mark.js';
import { serializeThrown } from './serializers/error.js';
import { escapeLineBreakers, MAX_KEY_LENGTH } from './string-redaction.js';
import type { CreateLoggerOptions, LineLevel, LogContext, LogFields, PlatformLogger } from './types.js';

/** Keys every line carries (AT-US-008-05). */
export const MANDATORY_KEYS = ['timestamp', 'level', 'message', 'service', 'version', 'correlation_id', 'org_id', 'actor_id'] as const;

/** Key of a security line counting the attributes the per-event allow-list dropped. */
export const DROPPED_ATTRIBUTES_KEY = 'dropped_attributes';

/**
 * Keys fields and bindings can never set, compared in normalised form (`Correlation-Id`, `correlationId` and
 * `correlation_id` are all the same reserved key, PR20-SEC-08 (d)).
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set<string>(
  [...MANDATORY_KEYS, 'request_id', 'client_correlation_id', 'event', 'event_type', 'err', DROPPED_ATTRIBUTES_KEY].map(normaliseKey),
);
const CORRELATION_KEY = normaliseKey('correlation_id');

/**
 * The coarse IP every security event may carry (api/README.md §13 header): only an IPv4 /24 or IPv6 /48 prefix, never a
 * precise address (a precise value is dropped and counted like any unlisted attribute).
 */
const COARSE_IP_KEY = 'ip_coarse';
const COARSE_IP = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}0\/24$|^[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,2}::\/48$/i;

export const SECURITY_EVENT_PREFIX = 'security.';
/** Message of the fallback line written when a line cannot be built or written. */
export const SERIALIZATION_FAILED = 'log.serialization_failed';

const MAX_EVENT_LENGTH = 128;
const MAX_CONTEXT_LENGTH = 128;
/** Event names the fallback line repeats (dotted lower-case identifiers chosen by code). */
const FALLBACK_EVENT = /^[a-z][a-z0-9_.]{0,127}$/;

type Fields = Record<string, unknown>;

/** `sqlState` -> `sql_state`, `HTTPStatus` -> `http_status`; already snake_case keys are unchanged. Input capped. */
export function toSnakeCase(key: string): string {
  return (key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .toLowerCase();
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Redacted fields as a record (non-object fields are ignored). */
function redactFields(fields: LogFields | undefined): Fields {
  if (fields === undefined) return {};
  const redacted = redactValue(fields);
  return typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted) ? { ...redacted } : {};
}

function isReserved(key: string): boolean {
  return RESERVED_KEYS.has(normaliseKey(key));
}

/** The record without the keys only the logger writes. */
function withoutReserved(fields: Fields): Fields {
  const output: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!isReserved(key)) output[key] = value;
  }
  return output;
}

/**
 * A valid correlation ID carried in the fields (`correlationId` of a runtime security event, `correlation_id` of
 * `outboundCallFields`): used as the line's `correlation_id` only when the context has none (PR20-SEC-10).
 */
function fieldCorrelationId(fields: Fields): string | undefined {
  for (const [key, value] of Object.entries(fields)) {
    if (normaliseKey(key) === CORRELATION_KEY && typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)) return value;
  }
  return undefined;
}

/**
 * Security attributes: only the event's allow-listed keys (security-event.ts SECURITY_EVENT_FIELDS, snake_case) with
 * scalar values; everything else, bindings included, is dropped and counted (PR #20 m2, PR20-SEC-05).
 */
function securityAttributes(event: string, fields: Fields): Fields {
  const allowed = new Set(securityEventFields(event));
  const output: Fields = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (normaliseKey(key) === CORRELATION_KEY) continue;
    const snake = toSnakeCase(key);
    const coarseIp = snake === COARSE_IP_KEY && typeof value === 'string' && COARSE_IP.test(value);
    if (coarseIp || (allowed.has(snake) && isScalar(value) && !isReserved(snake))) output[snake] = value;
    else dropped += 1;
  }
  if (dropped > 0) output[DROPPED_ATTRIBUTES_KEY] = dropped;
  return output;
}

function contextValue(value: unknown): string | null {
  return typeof value === 'string' ? escapeLineBreakers(value.slice(0, MAX_CONTEXT_LENGTH)) : null;
}

/** Shared state of a logger and its children. */
interface LoggerCore {
  readonly pino: PinoLogger;
  /** Writes security events at any level: APP_LOG_LEVEL never suppresses them (PR20-SEC-04). */
  readonly securityPino: PinoLogger;
  readonly options: CreateLoggerOptions;
  readonly now: () => Date;
}

function readContext(core: LoggerCore): LogContext | undefined {
  try {
    return core.options.context?.();
  } catch {
    return undefined;
  }
}

/** The security event name of a line written by the sink; undefined for every other line. */
function securityEventName(event: unknown, fields: LogFields | undefined): string | undefined {
  if (typeof event !== 'string' || !event.startsWith(SECURITY_EVENT_PREFIX) || !isSecurityEventFields(fields)) return undefined;
  const name = event.slice(SECURITY_EVENT_PREFIX.length);
  return SECURITY_EVENT_NAME.test(name) ? name : undefined;
}

/** Minimal line when a line cannot be built or written: mandatory keys (context keys null) and a safe event name. */
function writeFallback(core: LoggerCore, level: LineLevel, event: unknown, security: boolean): void {
  try {
    const name = typeof event === 'string' && FALLBACK_EVENT.test(event) ? event : undefined;
    const line = {
      level,
      timestamp: core.now().toISOString(),
      message: SERIALIZATION_FAILED,
      service: core.options.service,
      version: core.options.version,
      correlation_id: null,
      org_id: null,
      actor_id: null,
      ...(name === undefined ? {} : { event: name }),
      ...(security ? { event_type: 'security' } : {}),
    };
    core.options.destination.write(`${JSON.stringify(line)}\n`);
  } catch {
    // The destination itself is failing; there is nowhere left to report to, and a log call must not throw.
  }
}

class PlatformPinoLogger implements PlatformLogger {
  constructor(
    private readonly core: LoggerCore,
    private readonly bindings: Fields,
  ) {}

  fatal(event: string, fields?: LogFields, thrown?: unknown): void {
    this.write('fatal', event, fields, thrown);
  }

  error(event: string, fields?: LogFields, thrown?: unknown): void {
    this.write('error', event, fields, thrown);
  }

  warn(event: string, fields?: LogFields, thrown?: unknown): void {
    this.write('warn', event, fields, thrown);
  }

  info(event: string, fields?: LogFields, thrown?: unknown): void {
    this.write('info', event, fields, thrown);
  }

  debug(event: string, fields?: LogFields, thrown?: unknown): void {
    this.write('debug', event, fields, thrown);
  }

  trace(event: string, fields?: LogFields, thrown?: unknown): void {
    this.write('trace', event, fields, thrown);
  }

  child(bindings: LogFields): PlatformLogger {
    try {
      return new PlatformPinoLogger(this.core, { ...this.bindings, ...withoutReserved(redactFields(bindings)) });
    } catch {
      return this;
    }
  }

  isLevelEnabled(level: LineLevel): boolean {
    try {
      return this.core.pino.isLevelEnabled(level);
    } catch {
      return false;
    }
  }

  private write(level: LineLevel, event: string, fields: LogFields | undefined, thrown: unknown): void {
    const security = securityEventName(event, fields);
    try {
      const target = security === undefined ? this.core.pino : this.core.securityPino;
      if (!target.isLevelEnabled(level)) return;
      const name = typeof event === 'string' ? escapeLineBreakers(event.slice(0, MAX_EVENT_LENGTH)) : 'log.invalid_event';
      target[level](this.line(name, security, fields, thrown), name);
    } catch {
      writeFallback(this.core, level, event, security !== undefined);
    }
  }

  private line(name: string, security: string | undefined, fields: LogFields | undefined, thrown: unknown): Fields {
    const context = readContext(this.core);
    const merged = { ...this.bindings, ...redactFields(fields) };
    const correlationId = contextValue(context?.correlationId) ?? fieldCorrelationId(merged) ?? null;
    const requestId = contextValue(context?.requestId);
    const clientCorrelationId = contextValue(context?.clientCorrelationId);
    return {
      correlation_id: correlationId,
      org_id: contextValue(context?.orgId),
      actor_id: contextValue(context?.actorId),
      ...(requestId === null ? {} : { request_id: requestId }),
      ...(clientCorrelationId === null ? {} : { client_correlation_id: clientCorrelationId }),
      ...(security === undefined ? { event: name } : { event_type: 'security', event: security }),
      ...(security === undefined ? withoutReserved(merged) : securityAttributes(security, merged)),
      ...(thrown === undefined ? {} : { err: serializeThrown(thrown) }),
    };
  }
}

/** The platform logger (see PlatformLogger in types.ts for the line contract). */
export function createLogger(options: CreateLoggerOptions): PlatformLogger {
  const now = options.now ?? (() => new Date());
  const pinoOptions = {
    messageKey: 'message',
    base: { service: options.service, version: options.version },
    timestamp: () => `,"timestamp":"${now().toISOString()}"`,
    formatters: { level: (label: string) => ({ level: label }) },
    // `err` is already serialised by serializeThrown; Pino's std serializer would reshape it.
    serializers: { err: (value: unknown) => value },
  };
  const destination = { write: (line: string) => options.destination.write(line) };
  const instance = pino({ ...pinoOptions, level: options.level ?? 'info' }, destination);
  const securityPino = pino({ ...pinoOptions, level: 'trace' }, destination);
  return new PlatformPinoLogger({ pino: instance, securityPino, options, now }, {});
}
