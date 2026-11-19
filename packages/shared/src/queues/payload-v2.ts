// Job payload v2 (ADR-0013 amendment 1 items 1-3; SEC-P3-12, SEC-TC-50; REQ-RLS-008; TASK-035): identifiers only,
// `{ v: 2, kind, id, correlation_id, trace_context }`. No org_id, no actor_id, no business data: the worker resolves
// the tenant context from PostgreSQL (`platform.job_context(kind, id)`, TASK-047), so a forged or edited job cannot act
// inside another tenant. Validated at dequeue against the queue's schema (closed object, no conversion); anything
// else is a non-retryable PAYLOAD_INVALID. The forgery signal and the bounds of the check are PR64-SEC-06 (TASK-039).
import Joi from 'joi';

import { CORRELATION_ID_PATTERN } from '../correlation/correlation-id.js';
import type { JobKind, QueueDefinition } from './queue-definition.js';

export const PAYLOAD_VERSION = 2;

/** W3C trace context of the producing span (NFR-OBS-002); null when the producer had none. */
export interface TraceContext {
  readonly traceparent: string;
  readonly tracestate?: string;
}

export interface JobPayloadV2 {
  readonly v: typeof PAYLOAD_VERSION;
  readonly kind: JobKind;
  /** The UUID of the authoritative row the kind names (an outbox event id, a saga id, ...). */
  readonly id: string;
  /** Copied from the originating request or outbox row by the producer, never generated there (D-062). */
  readonly correlation_id: string;
  readonly trace_context: TraceContext | null;
}

/** The aggregate a job is about, plus the optional step that makes the job ID unique (saga steps). */
export interface JobRef {
  readonly kind: JobKind;
  readonly id: string;
  readonly step?: string;
}

/** A lower-case canonical UUID (any version; the platform mints UUIDv7). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `traceparent` of W3C Trace Context level 1: version 00, non-zero ids. */
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;
const STEP = /^[a-z0-9_-]{1,40}$/;

/**
 * Deterministic job ID from the business key (ADR-0013 §2, DR-A25): `<kind>.<id>` or `<kind>.<id>.<step>`. BullMQ 6
 * refuses a custom id with `:` unless it has exactly three parts, so `.` separates them (D-TASK035-02).
 */
export const JOB_ID_PATTERN = /^[a-z_]+\.[0-9a-f-]{36}(?:\.[a-z0-9_-]{1,40})?$/;

export function jobIdFor(ref: JobRef): string {
  if (!UUID.test(ref.id)) throw new TypeError('job id must be a lower-case UUID');
  if (ref.step !== undefined && !STEP.test(ref.step)) throw new TypeError('job step must be 1-40 of [a-z0-9_-]');
  return ref.step === undefined ? `${ref.kind}.${ref.id}` : `${ref.kind}.${ref.id}.${ref.step}`;
}

/** W3C Trace Context level 1 `tracestate` list-member key (simple key, or `tenant@system`) and value alphabet. */
const TRACESTATE_KEY = /^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/;
const TRACESTATE_VALUE = /^[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/;
const TRACESTATE_MAX_MEMBERS = 32;

/**
 * True for a `tracestate` that follows the W3C grammar: at most 32 `key=value` members separated by commas (optional
 * white space around a member), no control characters (PR64-SEC-05). Every pattern is anchored with bounded
 * repetition and the white-space trim is a loop, so the check is linear in the input (PR64 probe P3: a regex trim
 * such as `/^[ \t]+|[ \t]+$/g` is quadratic on a blank run; `String#trim` also strips U+2028 and NBSP).
 */
export function isTracestate(text: string): boolean {
  const members = text.split(',');
  if (members.length > TRACESTATE_MAX_MEMBERS) return false;
  return members.every((raw) => {
    let start = 0;
    let end = raw.length;
    while (start < end && (raw[start] === ' ' || raw[start] === '\t')) start += 1;
    while (end > start && (raw[end - 1] === ' ' || raw[end - 1] === '\t')) end -= 1;
    const member = raw.slice(start, end);
    const eq = member.indexOf('=');
    return eq > 0 && TRACESTATE_KEY.test(member.slice(0, eq)) && TRACESTATE_VALUE.test(member.slice(eq + 1));
  });
}

const TRACE_CONTEXT = Joi.object({
  traceparent: Joi.string().pattern(TRACEPARENT).required(),
  tracestate: Joi.string()
    .max(512)
    .custom((value: string, helpers) => (isTracestate(value) ? value : helpers.error('any.invalid'))),
}).unknown(false);

/**
 * The closed schema of payloads on a queue with these kinds. A queue without kinds accepts no payload at all: its
 * `kind` is required and no value is valid, so a payload without `kind` is refused too (R1-m1).
 */
function buildPayloadSchema(definition: QueueDefinition): Joi.ObjectSchema {
  const kind =
    definition.kinds.length === 0
      ? Joi.any()
          .required()
          .custom((_value: unknown, helpers) => helpers.error('any.invalid'))
      : Joi.string()
          .valid(...definition.kinds)
          .required();
  return Joi.object({
    v: Joi.number().valid(PAYLOAD_VERSION).required(),
    kind,
    id: Joi.string().pattern(UUID).required(),
    correlation_id: Joi.string().pattern(CORRELATION_ID_PATTERN).required(),
    trace_context: TRACE_CONTEXT.allow(null).required(),
  })
    .unknown(false)
    .required()
    .prefs({ convert: false, abortEarly: false, errors: { wrap: { label: false } } });
}

const SCHEMAS = new WeakMap<QueueDefinition, Joi.ObjectSchema>();

/** The closed schema of payloads on this queue; built once per queue definition (R1-n1). */
export function payloadSchemaFor(definition: QueueDefinition): Joi.ObjectSchema {
  let schema = SCHEMAS.get(definition);
  if (schema === undefined) {
    schema = buildPayloadSchema(definition);
    SCHEMAS.set(definition, schema);
  }
  return schema;
}

export type PayloadValidation =
  | { readonly ok: true; readonly payload: JobPayloadV2 }
  | {
      readonly ok: false;
      /** `<path>: <joi type>` per issue: key paths and rule names only, never a value; at most MAX_ISSUES + 1 entries. */
      readonly issues: readonly string[];
      /** True when the payload carries tenant context (any spelling, any depth) or an own `__proto__`: a forgery signal. */
      readonly carriesTenantContext: boolean;
    };

/** Issues listed per refusal; the rest are summarised in one `(+N more)` entry (PR64-SEC-06). */
export const MAX_ISSUES = 20;
/** Own keys a payload may have before the check refuses it without running the schema (5 are allowed). */
export const MAX_PAYLOAD_KEYS = 32;
/** Bounds of the forgery-signal walk: nesting depth and keys examined. */
const SIGNAL_MAX_DEPTH = 4;
const SIGNAL_MAX_KEYS = 256;

/**
 * Tenant-context key spellings, compared after key folding (`normaliseKey`: NFKC, lower case, no
 * separators), so `ORG_ID`, `OrgId`, `orgID`, `org-id`, `tenant_id`, `organisation_id`, `actorID` and `actor_type` all
 * match (PR64-SEC-06).
 */
const TENANT_KEY = /^(?:org|organisation|organization|tenant|actor)(?:id|type)?$/;

/**
 * Key folding for the tenant-key comparison, as the logger folds keys (NFKC, lower case, only [a-z0-9]); the first 256
 * characters only, so a long key stays cheap. Local: the queues subpath may not import the logging module.
 */
function normaliseKey(key: string): string {
  return key
    .slice(0, 256)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The forgery signal (ADR-0013 am. 1 item 2; PR64-SEC-06): a tenant-context key at any depth (a bounded walk), or an
 * own `__proto__` key (which `JSON.parse` of the job data creates, and Joi's clone would silently drop).
 */
export function carriesTenantContext(value: unknown): boolean {
  let examined = 0;
  const walk = (node: unknown, depth: number): boolean => {
    if (depth > SIGNAL_MAX_DEPTH || typeof node !== 'object' || node === null) return false;
    for (const key of Object.keys(node)) {
      examined += 1;
      if (examined > SIGNAL_MAX_KEYS) return false;
      if (key === '__proto__' || TENANT_KEY.test(normaliseKey(key))) return true;
      if (walk((node as Record<string, unknown>)[key], depth + 1)) return true;
    }
    return false;
  };
  return walk(value, 0);
}

/** Caps an issue list at MAX_ISSUES entries plus one summary entry. */
export function capIssues(issues: readonly string[]): string[] {
  if (issues.length <= MAX_ISSUES) return [...issues];
  return [...issues.slice(0, MAX_ISSUES), `(+${String(issues.length - MAX_ISSUES)} more)`];
}

/**
 * Checks done before any schema: an own `__proto__` key is refused (a schema clone would drop it and accept the rest),
 * and a payload with more than MAX_PAYLOAD_KEYS own keys is refused without walking them (P1: 100k keys cost 489 ms
 * and a 2.4 MB message).
 */
export function structuralIssues(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const keys = Object.keys(value);
  if (keys.length > MAX_PAYLOAD_KEYS) return ['(root): object.max'];
  return keys.includes('__proto__') ? ['__proto__: object.unknown'] : [];
}

/** Validates a dequeued payload against its queue's schema. Never throws. */
export function validateJobPayload(definition: QueueDefinition, value: unknown): PayloadValidation {
  const signal = carriesTenantContext(value);
  const structural = structuralIssues(value);
  if (structural.length > 0) return { ok: false, issues: structural, carriesTenantContext: signal };
  const result = payloadSchemaFor(definition).validate(value);
  if (result.error === undefined && !signal) return { ok: true, payload: result.value as JobPayloadV2 };
  const issues = (result.error?.details ?? []).map((detail) => `${detail.path.join('.') || '(root)'}: ${detail.type}`);
  return { ok: false, issues: capIssues(issues), carriesTenantContext: signal };
}

/** True for a value that is a valid payload for a queue with these kinds. */
export function isJobPayloadV2(definition: QueueDefinition, value: unknown): value is JobPayloadV2 {
  return validateJobPayload(definition, value).ok;
}
