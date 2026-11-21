/**
 * Request validation slot (pipeline step 6, REQ-SEC-007, REQ-API-005/006, api/README §3 validation sub-codes; TASK-020).
 * Each route part (params, query, body, declared headers) is validated with the route's closed Joi schema; a part
 * without a schema must be empty. Failures become 400 `VALIDATION_ERROR` with `errors[]` of `{ pointer, code,
 * message }` where `message` is the fixed English text of the sub-code: Joi's rendered message never reaches the body
 * (PR20-SEC-12 / PR #20 L-13). As a second line, every schema is prepared with `SAFE_MESSAGES`, templates that never
 * interpolate the value (`{#value}`), so a Joi message that does get logged cannot carry request data either.
 */
import { AppError, MAX_VALIDATION_ISSUES, serverControlledFieldIssues, type ValidationIssue } from '@platform/shared';
import Joi from 'joi';

import type { RouteInput, RouteSchemas } from '../routing/define-route.js';

export type RequestPart = keyof RouteInput;

/** The api/README §3 sub-codes this slot emits; module rules (PASSWORD_POLICY, ...) are thrown by services. */
export const VALIDATION_SUB_CODES = {
  REQUIRED: 'Field is required.',
  UNKNOWN_FIELD: 'Field is not allowed.',
  INVALID_TYPE: 'Field has the wrong type.',
  INVALID_FORMAT: 'Field has an invalid format.',
  INVALID_ENUM: 'Field is not one of the allowed values.',
  OUT_OF_RANGE: 'Field is out of range.',
  TOO_SHORT: 'Field is too short.',
  TOO_LONG: 'Field is too long.',
} as const;
export type ValidationSubCode = keyof typeof VALIDATION_SUB_CODES;

/** Joi's built-in types; their definitions list every error code a schema can raise. */
const JOI_TYPES: readonly (() => Joi.Schema)[] = [
  () => Joi.any(),
  () => Joi.alternatives(),
  () => Joi.array(),
  () => Joi.binary(),
  () => Joi.boolean(),
  () => Joi.date(),
  () => Joi.function(),
  () => Joi.link(),
  () => Joi.number(),
  () => Joi.object(),
  () => Joi.string(),
  () => Joi.symbol(),
];

/** A template that interpolates the value: `{#value}`, `{{#value}}`, `{[.]}`, `{:[.]}` and friends. */
export const VALUE_REFERENCE = /#value|\[\.\]/;

/**
 * Every error code Joi's built-in types can raise, read from each type's definition (`_definition.messages`, Joi's
 * extension metadata). validate.test.ts pins that the list covers the codes routes use, so a Joi upgrade that moves
 * the field fails a test instead of silently leaving the default (value-interpolating) messages in place.
 */
function joiErrorCodes(): string[] {
  const codes = new Set<string>();
  for (const create of JOI_TYPES) {
    const definition: unknown = (create() as unknown as { _definition?: { messages?: unknown } })._definition;
    const messages = typeof definition === 'object' && definition !== null ? (definition as { messages?: unknown }).messages : undefined;
    if (typeof messages === 'object' && messages !== null) for (const code of Object.keys(messages)) codes.add(code);
  }
  return [...codes].sort();
}

/** One value-free template per Joi error code (labels are key paths, never values). */
export const SAFE_MESSAGES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(joiErrorCodes().map((code) => [code, `{{#label}} failed ${code}`])),
);

/** The schema with the value-free messages; `defineRoute` schemas go through this once, when the route is mounted. */
export function prepareSchema(schema: Joi.ObjectSchema): Joi.ObjectSchema {
  return schema.prefs({ messages: SAFE_MESSAGES, errors: { wrap: { label: false } } });
}

const EMPTY = Joi.object({});

/** Joi error type -> sub-code. Anything unrecognised is INVALID_FORMAT (never a raw Joi type). */
export function subCodeOf(type: string): ValidationSubCode {
  if (type === 'any.required') return 'REQUIRED';
  if (type === 'object.unknown') return 'UNKNOWN_FIELD';
  if (type === 'any.only' || type === 'any.invalid') return 'INVALID_ENUM';
  if (type.endsWith('.base')) return type === 'string.pattern.base' ? 'INVALID_FORMAT' : 'INVALID_TYPE';
  if (/^(?:number\.(?:min|max|greater|less|positive|negative|port|precision)|date\.(?:min|max|greater|less))$/.test(type))
    return 'OUT_OF_RANGE';
  if (/^(?:string|array|object)\.min$/.test(type) || type === 'string.empty') return 'TOO_SHORT';
  if (/^(?:string|array|object)\.max$/.test(type)) return 'TOO_LONG';
  return 'INVALID_FORMAT';
}

/** RFC 6901 escaping of one reference token. */
const pointerToken = (segment: string | number): string => String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

export function toIssues(part: RequestPart, error: Joi.ValidationError): ValidationIssue[] {
  return error.details.slice(0, MAX_VALIDATION_ISSUES).map((detail) => {
    const code = subCodeOf(detail.type);
    const pointer = `/${part}${detail.path.map((segment) => `/${pointerToken(segment)}`).join('')}`;
    return { pointer, code, message: VALIDATION_SUB_CODES[code] };
  });
}

/** Projects the declared headers (lower-case names) of a header schema out of the request headers. */
function declaredHeaders(schema: Joi.ObjectSchema, headers: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const keys = Object.keys((schema.describe() as { keys?: Record<string, unknown> }).keys ?? {});
  return Object.fromEntries(keys.filter((key) => headers[key] !== undefined).map((key) => [key, headers[key]]));
}

/** Nesting below this depth is not searched (the closed schemas of define-route.ts refuse deeper schemas). */
const MAX_BODY_DEPTH = 32;

/**
 * PR26-SEC-04, PR #32 m8 / PR32-SEC-04: server-controlled fields (id, org_id, created_by, version, on_behalf_of_org_id,
 * ...) sent anywhere in the body, at the top, in a nested object or in any array item, are UNKNOWN_FIELD with the
 * shared message, whatever the route's schema says (camel-case spellings are already refused by the closed Joi
 * schemas). Linear in the body size, bounded in depth and in the number of issues.
 */
export function serverControlledIssues(body: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visit = (value: unknown, pointer: string, depth: number): void => {
    if (issues.length >= MAX_VALIDATION_ISSUES || depth > MAX_BODY_DEPTH || typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => visit(item, `${pointer}/${String(index)}`, depth + 1));
      return;
    }
    issues.push(...serverControlledFieldIssues(value, pointer));
    for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${pointerToken(key)}`, depth + 1);
  };
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) visit(body, '/body', 0);
  return issues.slice(0, MAX_VALIDATION_ISSUES);
}

export interface RawRequestParts {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
}

/** Prepared (value-free) schemas of one route, built once at mount time. */
export type PreparedSchemas = Readonly<Record<RequestPart, Joi.ObjectSchema | undefined>>;

export function prepareSchemas(schemas: RouteSchemas): PreparedSchemas {
  const prepare = (schema: Joi.ObjectSchema | undefined): Joi.ObjectSchema | undefined =>
    schema === undefined ? undefined : prepareSchema(schema);
  return { params: prepare(schemas.params), query: prepare(schemas.query), body: prepare(schemas.body), headers: prepare(schemas.headers) };
}

const listQueries = new WeakMap<Joi.ObjectSchema, boolean>();

/** A list query schema declares both pagination parameters, `limit` and `cursor` (US-037; AT-US-037-09). */
export function isListQuerySchema(schema: Joi.ObjectSchema | undefined): boolean {
  if (schema === undefined) return false;
  let list = listQueries.get(schema);
  if (list === undefined) {
    const keys = (schema.describe() as { keys?: Record<string, unknown> }).keys ?? {};
    list = Object.hasOwn(keys, 'limit') && Object.hasOwn(keys, 'cursor');
    listQueries.set(schema, list);
  }
  return list;
}

/** `filter[<name>]` (the API's simple query parser) or `filter` / `filter/<name>` (a nested parser). */
const FILTER_POINTER = /^\/query\/filter(?:\[|\/|$)/;

/**
 * A list route answers an unknown filter key with 400 INVALID_FILTER (REQ-API-008, api/README.md §4; D-TASK045-04): the
 * closed query schema declares the allow-listed `filter[...]` keys, so any other one is an unknown field. A filter
 * VALUE outside its schema stays VALIDATION_ERROR with its pointer. Other routes keep UNKNOWN_FIELD for every key.
 */
function hasUnknownFilter(schemas: PreparedSchemas, issues: readonly ValidationIssue[]): boolean {
  return isListQuerySchema(schemas.query) && issues.some((issue) => issue.code === 'UNKNOWN_FIELD' && FILTER_POINTER.test(issue.pointer));
}

/**
 * Validates every part and returns the converted input, or throws 400 VALIDATION_ERROR naming every issue (capped at
 * MAX_VALIDATION_ISSUES); on a list route an unknown filter key throws 400 INVALID_FILTER instead. A route without a
 * body schema accepts no body (undefined or `{}`).
 */
export function validateRequest(schemas: PreparedSchemas, raw: RawRequestParts): RouteInput {
  const issues: ValidationIssue[] = [];
  const run = (part: RequestPart, schema: Joi.ObjectSchema | undefined, value: unknown): Record<string, unknown> => {
    const result = (schema ?? EMPTY).validate(value ?? {}, { abortEarly: false, convert: true });
    if (result.error !== undefined) {
      issues.push(...toIssues(part, result.error));
      return {};
    }
    const validated: unknown = result.value;
    return validated as Record<string, unknown>;
  };
  const params = run('params', schemas.params, raw.params);
  const query = run('query', schemas.query, raw.query);
  const headers = schemas.headers === undefined ? {} : run('headers', schemas.headers, declaredHeaders(schemas.headers, raw.headers));
  const serverControlled = serverControlledIssues(raw.body);
  const body = schemas.body === undefined && raw.body === undefined ? undefined : run('body', schemas.body, raw.body);
  if (hasUnknownFilter(schemas, issues)) throw new AppError('INVALID_FILTER');
  if (issues.length > 0 || serverControlled.length > 0) {
    // The server-controlled issue (with its explicit message) replaces Joi's generic UNKNOWN_FIELD at the same pointer.
    const named = new Set(serverControlled.map((issue) => issue.pointer));
    throw new AppError('VALIDATION_ERROR', { errors: [...serverControlled, ...issues.filter((issue) => !named.has(issue.pointer))] });
  }
  return { params, query, body, headers };
}
