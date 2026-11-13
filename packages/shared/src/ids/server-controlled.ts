/**
 * Server-controlled fields (REQ-RLS-009, REQ-ORG-007, REQ-SEC-007; US-064, EC-A18). The server sets the standard
 * columns, the tenant key and the on-behalf seam; a client that sends any of them gets 400 `VALIDATION_ERROR` with
 * sub-code `UNKNOWN_FIELD` and nothing is persisted (AT-US-064-03). The request-validation slot rejects them at the
 * HTTP boundary; the standard-columns Prisma extension (apps/api `platform/db/extensions`) rejects them again in
 * repository input (defence in depth), using the same list and the same issue shape.
 */
import type { ValidationIssue } from '../errors/app-error.js';

/** API (snake_case) names of the fields only the server may set. */
export const SERVER_CONTROLLED_FIELDS = Object.freeze([
  'id',
  'org_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
  'on_behalf_of_org_id',
] as const);

export type ServerControlledField = (typeof SERVER_CONTROLLED_FIELDS)[number];

/** Validation sub-code for a field the endpoint does not accept (api README, validation sub-codes). */
export const UNKNOWN_FIELD = 'UNKNOWN_FIELD';

const SERVER_FIELDS: ReadonlySet<string> = new Set(SERVER_CONTROLLED_FIELDS);

/** True when `name` is a server-controlled API field name. */
export function isServerControlledField(name: string): name is ServerControlledField {
  return SERVER_FIELDS.has(name);
}

/**
 * One `UNKNOWN_FIELD` issue per server-controlled field present as an OWN property of `body` (top level; nested
 * resources are validated by their own schema). Names are reported in {@link SERVER_CONTROLLED_FIELDS} order, so
 * the result is deterministic; a non-object body yields no issue (its shape is the schema's concern).
 */
export function serverControlledFieldIssues(body: unknown, pointerPrefix = '/body'): ValidationIssue[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return [];
  return SERVER_CONTROLLED_FIELDS.filter((name) => Object.hasOwn(body, name)).map((name) => ({
    pointer: `${pointerPrefix}/${name}`,
    code: UNKNOWN_FIELD,
    message: `${name} is set by the server and must not be sent`,
  }));
}
