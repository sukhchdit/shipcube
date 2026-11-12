// The platform logger on Pino 10 (US-008 AT-US-008-04/05, REQ-PLAT-011/012, NFR-OBS-001, NFR-PRIV-001; ADR-0016 §15;
// TASK-010). One JSON line per call with the mandatory keys of AT-US-008-05, the per-line context, the redacted fields
// and the serialised thrown value. Security events (`security.<name>`) get `event_type: "security"`, a PII key filter
// and scalar-only snake_case attributes. A log call never throws: a failure writes a minimal fallback line instead.
import { pino, type Logger as PinoLogger } from 'pino';

import { normaliseKey, redactValue } from './redaction.js';
import { serializeThrown } from './serializers/error.js';
import type { CreateLoggerOptions, LineLevel, LogContext, LogFields, PlatformLogger } from './types.js';

/** Keys every line carries (AT-US-008-05). */
export const MANDATORY_KEYS = ['timestamp', 'level', 'message', 'service', 'version', 'correlation_id', 'org_id', 'actor_id'] as const;

/** Keys fields and bindings can never set. */
const RESERVED_KEYS: ReadonlySet<string> = new Set<string>([
  ...MANDATORY_KEYS,
  'request_id',
  'client_correlation_id',
  'event',
  'event_type',
  'err',
]);

export const SECURITY_EVENT_PREFIX = 'security.';
/** Message of the fallback line written when a line cannot be built or written. */
export const SERIALIZATION_FAILED = 'log.serialization_failed';

/** Normalised-key substrings and exact keys that security events never carry (raw PII). */
const PII_KEY_PARTS: readonly string[] = ['email', 'phone', 'firstname', 'lastname', 'fullname', 'address', 'postcode', 'zip'];
const PII_EXACT_KEYS: ReadonlySet<string> = new Set(['ip', 'name']);

const MAX_EVENT_LENGTH = 128;
const MAX_CONTEXT_LENGTH = 128;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

type Fields = Record<string, unknown>;

/**
 * PII-named keys, except aggregate counters: `distinct_address_count` of registration_probe (api/README.md §13) is a
 * number, not an address.
 */
function isPiiKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (normalised.endsWith('count')) return false;
  return PII_EXACT_KEYS.has(normalised) || PII_KEY_PARTS.some((part) => normalised.includes(part));
}

/** `sqlState` -> `sql_state`, `HTTPStatus` -> `http_status`; already snake_case keys are unchanged. */
export function toSnakeCase(key: string): string {
  return key
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

/** The record without the keys only the logger writes. */
function withoutReserved(fields: Fields): Fields {
  const output: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!RESERVED_KEYS.has(key)) output[key] = value;
  }
  return output;
}

interface SecurityAttributes {
  readonly fields: Fields;
  readonly correlationId?: string;
}

/** PII keys dropped, values reduced to scalars, keys in snake_case; a correlation attribute is lifted out. */
function securityAttributes(fields: Fields): SecurityAttributes {
  const output: Fields = {};
  let correlationId: string | undefined;
  for (const [key, value] of Object.entries(fields)) {
    if (normaliseKey(key) === 'correlationid') {
      if (typeof value === 'string' && CORRELATION_ID.test(value)) correlationId = value;
      continue;
    }
    const snake = toSnakeCase(key);
    if (isPiiKey(key) || !isScalar(value) || RESERVED_KEYS.has(snake)) continue;
    output[snake] = value;
  }
  return correlationId === undefined ? { fields: output } : { fields: output, correlationId };
}

function contextValue(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, MAX_CONTEXT_LENGTH) : null;
}

/** Shared state of a logger and its children. */
interface LoggerCore {
  readonly pino: PinoLogger;
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

function writeFallback(core: LoggerCore, level: LineLevel): void {
  try {
    const line = {
      level,
      timestamp: core.now().toISOString(),
      message: SERIALIZATION_FAILED,
      service: core.options.service,
      version: core.options.version,
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
    try {
      if (!this.core.pino.isLevelEnabled(level)) return;
      const name = typeof event === 'string' ? event.slice(0, MAX_EVENT_LENGTH) : 'log.invalid_event';
      this.core.pino[level](this.line(name, fields, thrown), name);
    } catch {
      writeFallback(this.core, level);
    }
  }

  private line(name: string, fields: LogFields | undefined, thrown: unknown): Fields {
    const context = readContext(this.core);
    const merged = { ...this.bindings, ...redactFields(fields) };
    const isSecurity = name.startsWith(SECURITY_EVENT_PREFIX);
    const security = isSecurity ? securityAttributes(merged) : undefined;
    const correlationId = contextValue(context?.correlationId) ?? security?.correlationId ?? null;
    const requestId = contextValue(context?.requestId);
    const clientCorrelationId = contextValue(context?.clientCorrelationId);
    return {
      correlation_id: correlationId,
      org_id: contextValue(context?.orgId),
      actor_id: contextValue(context?.actorId),
      ...(requestId === null ? {} : { request_id: requestId }),
      ...(clientCorrelationId === null ? {} : { client_correlation_id: clientCorrelationId }),
      ...(isSecurity ? { event_type: 'security', event: name.slice(SECURITY_EVENT_PREFIX.length) } : { event: name }),
      ...(security === undefined ? withoutReserved(merged) : security.fields),
      ...(thrown === undefined ? {} : { err: serializeThrown(thrown) }),
    };
  }
}

/** The platform logger (see PlatformLogger in types.ts for the line contract). */
export function createLogger(options: CreateLoggerOptions): PlatformLogger {
  const now = options.now ?? (() => new Date());
  const instance = pino(
    {
      level: options.level ?? 'info',
      messageKey: 'message',
      base: { service: options.service, version: options.version },
      timestamp: () => `,"timestamp":"${now().toISOString()}"`,
      formatters: { level: (label: string) => ({ level: label }) },
      // `err` is already serialised by serializeThrown; Pino's std serializer would reshape it.
      serializers: { err: (value: unknown) => value },
    },
    { write: (line: string) => options.destination.write(line) },
  );
  return new PlatformPinoLogger({ pino: instance, options, now }, {});
}
