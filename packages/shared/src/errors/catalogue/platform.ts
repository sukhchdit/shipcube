// Core error codes (DR-A26; US-007, US-036, REQ-API-005, REQ-PLAT-009/010, ADR-0016 §3; TASK-036). Codes, statuses and
// titles equal the shared problem responses of docs/03-architecture/api/openapi.yaml and api/README.md §11; a
// published code is never reused for another meaning or moved to another status (catalogue.test.ts pins both).
import type { ModuleCatalogue } from '../catalogue-entry.js';

export const platformCatalogue = {
  /** Operation marked x-idempotency: required was called without Idempotency-Key. (REQ-API-009, DR-A26) */
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, title: 'Idempotency key required' },
  /** Pagination cursor tampered, expired or issued for another query. (REQ-API-007, DR-A26) */
  INVALID_CURSOR: { status: 400, title: 'Invalid cursor' },
  /** filter[field] names a field or operator outside the route allow-list. (REQ-API-008, DR-A26) */
  INVALID_FILTER: { status: 400, title: 'Invalid filter' },
  /** sort names a field outside the route allow-list. (REQ-API-008, DR-A26) */
  INVALID_SORT: { status: 400, title: 'Invalid sort' },
  /** Body is not parseable JSON (or not the declared media type syntax). (REQ-PLAT-010, DR-A26) */
  MALFORMED_REQUEST: { status: 400, title: 'Malformed request' },
  /**
   * One-time token (verification, reset, invitation) unknown, used, revoked or superseded. (REQ-AUTH-004,
   * REQ-AUTH-012, REQ-ORG-011, DR-A26)
   */
  TOKEN_INVALID: { status: 400, title: 'Token invalid' },
  /**
   * One or more fields failed schema or rule validation; see errors[] (pointer, sub-code, message), max 50 items.
   * (REQ-API-006, DR-A26)
   */
  VALIDATION_ERROR: { status: 400, title: 'Validation failed' },
  /** Bearer token past exp; client refreshes once and retries. (DR-A08, EC-A11, DR-A26) */
  ACCESS_TOKEN_EXPIRED: { status: 401, title: 'Access token expired' },
  /** No valid credentials for a protected route (also unsigned carrier push). (REQ-RBAC-006, DR-A26) */
  AUTH_REQUIRED: { status: 401, title: 'Authentication required' },
  /**
   * Unknown email, wrong password, non-permitted account type or app; identical response for all. (REQ-AUTH-005,
   * REQ-ADMIN-003, DR-A26)
   */
  INVALID_CREDENTIALS: { status: 401, title: 'Invalid credentials' },
  /** Wrong, replayed or out-of-window TOTP or recovery code. (REQ-AUTH-017, EC-A06, DR-A26) */
  MFA_INVALID: { status: 401, title: 'MFA code invalid' },
  /**
   * Password correct; complete the MFA challenge with the returned mfa_challenge_token (5 min, single-use).
   * (REQ-AUTH-017, DR-A26)
   */
  MFA_REQUIRED: { status: 401, title: 'MFA required' },
  /** Route needs a fresh X-Reauth-Proof bound to this session and action scope. (REQ-AUTH-020, DR-A26) */
  REAUTH_REQUIRED: { status: 401, title: 'Re-authentication required' },
  /**
   * Session or refresh family revoked (logout, reuse detection, password reset, removal). (REQ-AUTH-008,
   * REQ-AUTH-009, DR-A26)
   */
  SESSION_REVOKED: { status: 401, title: 'Session revoked' },
  /**
   * Caller lacks the route permission in the active organisation (PERMISSION_DENIED audited). (REQ-RBAC-006,
   * REQ-RBAC-007, DR-A26)
   */
  AUTHZ_DENIED: { status: 403, title: 'Permission denied' },
  /** Cookie-authenticated request without allow-listed Origin or matching X-CSRF-Token. (REQ-SEC-004, DR-A26) */
  CSRF_REJECTED: { status: 403, title: 'CSRF check failed' },
  /** Signed-in verified email differs from the invited address. (REQ-ORG-011, DR-A26) */
  INVITATION_EMAIL_MISMATCH: { status: 403, title: 'Invitation email mismatch' },
  /** Operator-org member without active TOTP may only call MFA enrolment routes. (REQ-AUTH-018, DR-A26) */
  MFA_ENROLMENT_REQUIRED: { status: 403, title: 'MFA enrolment required' },
  /**
   * Resource absent, soft-deleted, or owned by another organisation / guest token (indistinguishable). (REQ-RBAC-007,
   * REQ-RLS-007, DR-A26)
   */
  NOT_FOUND: { status: 404, title: 'Not found' },
  /** Path exists but not for this method; Allow header lists methods (framework level). (REQ-PLAT-010, DR-A26) */
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method not allowed' },
  /** Invited email already has an ACTIVE membership. (REQ-ORG-010, DR-A26) */
  ALREADY_MEMBER: { status: 409, title: 'Already a member' },
  /** Internal optimistic-concurrency or uniqueness conflict not caused by If-Match. (REQ-RLS-011, DR-A26) */
  CONFLICT: { status: 409, title: 'Conflict' },
  /** Same Idempotency-Key still executing; Retry-After: 1. (REQ-API-011, DR-A20, DR-A26) */
  IDEMPOTENCY_IN_PROGRESS: { status: 409, title: 'Idempotent request in progress' },
  /** Quote is owned by another organisation; claim is once-only. (REQ-RLS-013, REQ-QUOTE-016, DR-A26) */
  QUOTE_ALREADY_CLAIMED: { status: 409, title: 'Quote already claimed' },
  /** One-time download (privacy export) already consumed or expired. (REQ-ACCT-016, DR-A26) */
  DOWNLOAD_EXPIRED: { status: 410, title: 'Download expired' },
  /**
   * One-time token past its lifetime (verification 24 h, reset 60 min, invitation 7 d). (REQ-AUTH-004, REQ-AUTH-012,
   * REQ-ORG-011, DR-A26)
   */
  TOKEN_EXPIRED: { status: 410, title: 'Token expired' },
  /** If-Match does not match the current ETag; body carries current_etag. (REQ-API-013, REQ-RLS-011, DR-A26) */
  CONCURRENCY_CONFLICT: { status: 412, title: 'Precondition failed' },
  /** Body above the route limit (default 1 MB). (REQ-SEC-015, DR-A26) */
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large' },
  /** Content-Type not declared by the route. (REQ-SEC-015, DR-A26) */
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type' },
  /** Origin or destination country is not shipping_enabled. (REQ-DATA-005, DR-A26) */
  COUNTRY_NOT_SUPPORTED: { status: 422, title: 'Country not supported' },
  /** Same Idempotency-Key with a different request fingerprint within 24 h. (REQ-API-011, DR-A20, DR-A26) */
  IDEMPOTENCY_KEY_REUSED: { status: 422, title: 'Idempotency key reused' },
  /** Change would leave a customer organisation without an ACTIVE Owner. (REQ-ORG-013, DR-A26) */
  LAST_OWNER: { status: 422, title: 'Last owner' },
  /**
   * A configured count limit would be exceeded (10 owned orgs, 3 invitation resends, 10 shipments per order, 10 saved
   * methods, 500 address-book entries). (A-073, DR-A26)
   */
  LIMIT_EXCEEDED: { status: 422, title: 'Limit exceeded' },
  /** Operation not permitted for this organisation type (e.g. inviting into an INDIVIDUAL org). (REQ-ORG-014, DR-A26) */
  ORG_TYPE_RESTRICTION: { status: 422, title: 'Organisation type restriction' },
  /** Route requires a typed reason of at least 10 characters (mechanism; M2 signed actions). (REQ-AUDIT-025, DR-A26) */
  REASON_REQUIRED: { status: 422, title: 'Reason required' },
  /** Role does not belong to the organisation type. (REQ-ORG-004, DR-A26) */
  ROLE_NOT_ALLOWED_FOR_ORG_TYPE: { status: 422, title: 'Role not allowed for organisation type' },
  /** If-Match header missing on PUT/PATCH/DELETE of a versioned resource. (REQ-API-013, DR-A26) */
  PRECONDITION_REQUIRED: { status: 428, title: 'Precondition required' },
  /** Progressive delay after 5 consecutive failures; Retry-After 2..60 s. (REQ-AUTH-013, DR-A02, DR-A26) */
  ACCOUNT_DELAYED: { status: 429, title: 'Sign-in delayed' },
  /** 15-minute lock after 10 consecutive failures; Retry-After. (REQ-AUTH-014, DR-A02, DR-A26) */
  ACCOUNT_LOCKED: { status: 429, title: 'Account locked' },
  /** Challenge locked 15 min after 5 consecutive wrong codes. (REQ-AUTH-017, DR-A02, DR-A26) */
  MFA_LOCKED: { status: 429, title: 'MFA locked' },
  /** Rate-limit class or route limit exceeded; Retry-After in seconds. (REQ-API-014, DR-A22, DR-A26) */
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  /** Unhandled error; generic detail plus correlation_id only. (REQ-PLAT-009, DR-A26) */
  INTERNAL_ERROR: { status: 500, title: 'Internal error' },
  /** Dependency unavailable or request exceeded 30 s. (REQ-SEC-015, EC-A32, DR-A26) */
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },
} as const satisfies ModuleCatalogue;
