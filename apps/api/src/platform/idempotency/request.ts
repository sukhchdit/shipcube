/**
 * The idempotent request of one HTTP call (REQ-API-009..011, DR-A20, api/README §5; ADR-0014; TASK-040): the parsed
 * `Idempotency-Key`, the method, the concrete path and the request fingerprint. Pure: no I/O, no key material.
 *
 * - Key: 1 to 255 printable ASCII characters without space (`\x21`-`\x7E`, data-model §6.2 `ck_idempotency_keys__key`).
 *   A malformed key is 400 `VALIDATION_ERROR` at `/headers/idempotency-key` (AT-US-038-03); a missing key on an
 *   `x-idempotency: required` route is 400 `IDEMPOTENCY_KEY_REQUIRED` (AT-US-038-02).
 * - Fingerprint: SHA-256 of the RFC 8785 (JCS) canonical JSON of `{ method, path, query, body }` over the VALIDATED
 *   input (the validate slot ran before), so the canonical (sorted) query and the canonical body decide, not their
 *   spelling on the wire. The same key with another fingerprint is 422 `IDEMPOTENCY_KEY_REUSED` (AT-US-038-04).
 *
 * The slot (idempotency.ts) records the request in `res.locals` under a branded value; the tx slot reads it back with
 * {@link idempotencyRequestOf}, which ignores anything this module did not create.
 */
import { createHash } from 'node:crypto';

import { jcs, type JsonValue } from '@platform/audit';
import { AppError } from '@platform/shared';
import type { Response } from 'express';

import type { RouteInput } from '../routing/define-route.js';
import { VALIDATION_SUB_CODES, type ValidationSubCode } from '../validate/validate.js';

/** The request header (lower case, as Node exposes it). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** The response header of a replay (api/README §5 "Replay"). */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

const KEY_CHARACTERS = /^[\x21-\x7E]+$/;
const KEY_POINTER = `/headers/${IDEMPOTENCY_KEY_HEADER}`;

/** The unsafe methods an idempotency key protects (`ck_idempotency_keys__method`). */
export const IDEMPOTENT_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type IdempotentMethod = (typeof IDEMPOTENT_METHODS)[number];

export const isIdempotentMethod = (method: string): method is IdempotentMethod =>
  (IDEMPOTENT_METHODS as readonly string[]).includes(method);

export interface IdempotencyRequest {
  readonly key: string;
  readonly method: IdempotentMethod;
  /** The concrete request path, query excluded (`/api/v1/shipments/0193…/cancel`). */
  readonly path: string;
  /** SHA-256 (32 bytes) of the canonical request. */
  readonly fingerprint: Uint8Array<ArrayBuffer>;
}

const invalidKey = (code: ValidationSubCode): AppError =>
  new AppError('VALIDATION_ERROR', { errors: [{ pointer: KEY_POINTER, code, message: VALIDATION_SUB_CODES[code] }] });

/**
 * The key of the `Idempotency-Key` header, or `undefined` when the header is absent. Throws 400 `VALIDATION_ERROR`
 * for an empty, too long or otherwise malformed value (a repeated header arrives joined by `, `, so it is malformed).
 */
export function parseIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.length === 0) throw invalidKey('TOO_SHORT');
  if (raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw invalidKey('TOO_LONG');
  if (!KEY_CHARACTERS.test(raw)) throw invalidKey('INVALID_FORMAT');
  return raw;
}

/** A JSON-safe copy of a validated value (a converted `Date` becomes its ISO text, `undefined` members vanish). */
const toJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

/** SHA-256 of JCS({ method, path, query, body }) over the validated input. */
export function fingerprintOf(method: IdempotentMethod, path: string, input: RouteInput): Uint8Array<ArrayBuffer> {
  const canonical = jcs(toJson({ method, path, query: input.query, body: input.body ?? null }));
  return new Uint8Array(createHash('sha256').update(canonical, 'utf8').digest());
}

/** The concrete path of a request URL: the query (and a fragment, never sent) removed. */
export const pathOf = (originalUrl: string): string => originalUrl.split(/[?#]/u, 1)[0] ?? '';

/**
 * The normalised concrete path of a request (code review n3): the matched route TEMPLATE (mount prefix + path) with each
 * `:name` segment replaced by the VALIDATED parameter, percent-encoded. A trailing slash, another percent-encoding or
 * another spelling that Express routes to the same handler gives the same path; parameter values keep the case their
 * Joi schema produced (a schema that lower-cases UUIDs makes the scope case-insensitive for them).
 */
/** The text of a validated path parameter (a string, number or boolean; anything else in its JSON form). */
const segmentText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : (JSON.stringify(value ?? '') ?? '');

export function concretePathOf(template: string, params: Readonly<Record<string, unknown>>): string {
  return template.replace(/:([A-Za-z0-9_]+)/gu, (_segment, name: string) => encodeURIComponent(segmentText(params[name])));
}

const STATE = 'routeIdempotency';
const BRANDED = new WeakSet<object>();

/** Records the request's idempotent request (the idempotency slot only). */
export function setIdempotencyRequest(res: Response, request: IdempotencyRequest): void {
  const frozen = Object.freeze({ ...request });
  BRANDED.add(frozen);
  (res.locals as Record<string, unknown>)[STATE] = frozen;
}

/** The idempotent request the slot recorded, or `undefined` (no key, a `not-applicable` route, or a foreign value). */
export function idempotencyRequestOf(res: Response): IdempotencyRequest | undefined {
  const value = (res.locals as Record<string, unknown>)[STATE];
  return typeof value === 'object' && value !== null && BRANDED.has(value) ? (value as IdempotencyRequest) : undefined;
}
