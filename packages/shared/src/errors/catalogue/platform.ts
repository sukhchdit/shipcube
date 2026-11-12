// Framework-level error codes (US-007, REQ-PLAT-009/010, ADR-0016 §3). Codes and titles match the shared problem
// responses in docs/03-architecture/api/openapi.yaml; a published code is never reused for another meaning.
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const platformCatalogue = {
  /** Body is not parseable JSON, or the URL cannot be decoded. */
  MALFORMED_REQUEST: { status: 400, title: 'Malformed request' },
  /** Field validation failed; the problem carries `errors[]` (max 50). */
  VALIDATION_ERROR: { status: 400, title: 'Validation failed' },
  /** No (valid) principal on a route that needs one. */
  AUTH_REQUIRED: { status: 401, title: 'Authentication required' },
  /** Unknown route, or a resource the caller may not see (same response either way). */
  NOT_FOUND: { status: 404, title: 'Not found' },
  /** Known path, unsupported method; the response carries `Allow`. */
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method not allowed' },
  /** Body larger than the route limit (1 MB default). */
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large' },
  /** Content-Type outside the route allow-list. */
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type' },
  /** Any unexpected failure; the body only ever carries the generic detail. */
  INTERNAL_ERROR: { status: 500, title: 'Internal error' },
  /** A dependency is unavailable; generic detail, like every 5xx. */
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },
} as const satisfies ModuleCatalogue;
