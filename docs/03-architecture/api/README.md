# Platform API: contract and conventions

- **Contract:** [`openapi.yaml`](./openapi.yaml), OpenAPI **3.1.0**, `info.version` **1.0.0-m1**, base path `/api/v1`.
- **Scope:** every M0 and M1 endpoint (133 operations). M2 to M5 endpoints (ledger, invoicing, claims, partners, API keys, outbound webhooks, reports) are absent on purpose: there are no stub routes (brief §13 rule 5, REQ-ADMIN-009, REQ-ACCT-019).
- **Owner:** api-designer (P3). Conventions are fixed by [ADR-0016](../adr/ADR-0016-api-conventions.md), including its 2026-11-12 amendments (pre-auth limiter, secrets out of URLs, SSE resume). Other fixed inputs: P3 design brief ( endpoint skeleton, catalogues), REQUIREMENTS.md Parts A and B, DR-A01..A28, DR-B01..B34, ASSUMPTIONS.md, DECISIONS.md D-009..D-036.
- **Lint:** `npm run openapi:lint` (Redocly; *command name aligned 2026-11-13, SHEET-FOLD-2 — `npx` is forbidden by CLAUDE.md §2*). Current result: valid, 0 errors, 8 warnings (see [Lint status](#lint-status)).

**Amendments (2026-11-12, SEC-P3-01/02/10/11/14).** Contract changes from the P3 architecture security review (`docs/05-quality/security/P3-architecture-security-review.md`):

- **SEC-P3-01 (step-up and session cap).** The access token carries the OIDC claim `auth_time` (last password or MFA verification; persisted as `sessions.authenticated_at`; never renewed by refresh). Customer absolute session cap is 30 days (`AUTH_SESSION_ABSOLUTE_TTL=30d`, was 90 d). New vendor extension `x-reauth-max-age`. New re-auth scopes: `payment_method.manage` (always) on `createPaymentMethodSetup`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`; `privacy.export` (always) on `requestPrivacyExport`, `downloadPrivacyExport`; `org.member.manage` with `x-reauth-max-age: 43200` on `createInvitation`, `resendInvitation`, `updateMember`, `removeMember`. All ten list `REAUTH_REQUIRED`; `ReauthRequest.action_scope` accepts the three new scopes. Saved-card checkout uses CVC recollection: `Payment.cvc_recollection_required` (new required field). New 401 code `SESSION_EXPIRED` on `refreshSession`. Verification: SEC-TC-37, SEC-TC-38.
- **SEC-P3-11 (admin idle).** The admin refresh token has a 30-minute sliding idle lifetime (`AUTH_ADMIN_REFRESH_IDLE_TTL=30m`) inside the 12 h cap; idle refresh returns 401 `SESSION_EXPIRED`. Verification: SEC-TC-39.
- **SEC-P3-02 item 5 (streams).** `streamQuoteResults` and `streamBookingProgress` never trigger carrier fan-out; concurrent streams are capped at 2 per IP and 5 per user (429 `RATE_LIMITED`, `x-rate-limit-route`). Verification: SEC-TC-42.
- **SEC-P3-10 (idempotency drift).** `createQuote` and `createQuoteShare` are `x-idempotency: not-applicable` (no `Idempotency-Key`, no `Idempotent-Replayed`, no idempotency codes); `createQuoteShare` always mints a new token and revokes the previous share. §5 Scope rewritten. Verification: SEC-TC-53, SEC-TC-04.
- **SEC-P3-14 (staff first TOTP enrolment).** New operation `requestTotpEnrolmentCode` (`POST /auth/mfa/totp/enrolment-code`, 202, `email-send`, `x-mfa-gate-exempt`); `enrolTotp` accepts an optional body `{enrolment_code}`; new 403 code `MFA_ENROLMENT_CODE_REQUIRED`. Operation count 132 → 133. Verification: SEC-TC-56.

**Amendments (2026-11-12, G2-C3: SEC-P3-28/29/30/32/33).** Contract changes from the P3 remediation verification (§14.4 of the security review). Operation count unchanged (133).

- **SEC-P3-28 (CVC recollection outcome; ADR-0012 amendment 4).** With `cvc_recollection_required: true`, a payment is `AUTHORISED` only if the retrieved charge has `cvc_check = 'pass'`; otherwise the authorisation is voided and the payment is `FAILED/AUTHENTICATION_FAILED` (audited `UPDATE payment`, security event `cvc_recollection_failed`). One derivation function serves `checkoutOrder` (Mock), `confirmPayment` and both gateway webhooks. `CheckoutRequest.test_token` gains `mock_cvc_pass`, `mock_cvc_fail`, `mock_cvc_unavailable`; the never-implemented `mock_cvc_required` is withdrawn. New examples: `checkoutOrder` request `mock_saved_card_cvc_fail`, `confirmPayment` 200 `cvc_check_failed`. Verification: SEC-TC-37 (amended).
- **SEC-P3-29 (carrier quota; ADR-0010 amendment 10).** New rate class `quote-create` for verified authenticated `createQuote` callers; `createQuote` keeps `x-rate-limit-class: public-quote` and names `quote-create` in its `x-rate-limit-route` (ADR-0016 amendment 11; §7, §10). Users in `PENDING_VERIFICATION` count as anonymous. Per-organisation share of each carrier account's daily quota (`CARRIER_QUOTA_ORG_SHARE_PCT=10`). Verification: SEC-TC-62.
- **SEC-P3-30 (security events).** §13 gains eight events. Verification: SEC-TC-63.
- **SEC-P3-32 (share links).** `createQuoteShare` audits the implicit revocation (`x-audit.additional`: `UPDATE quote_share`) and is limited to 10 mints per quote per hour (429 `RATE_LIMITED`); `resolveSharedQuote` returns one byte-identical 404 for unknown, revoked, superseded and expired tokens (D-055; the v1.3 EC-B29 expired view with prefilled inputs is dropped, D-UX-034). Verification: SEC-TC-53 (amended).
- **SEC-P3-33 items 5 and 9.** `activateTotp` is definitively on the one-time-secret list (ADR-0014 amendment 4); idempotent replay on the `payment_method.manage` routes is served before the re-auth proof check (§5, §8).

The document is the source of truth (REQ-API-002). Route metadata (`defineRoute`), Joi schemas, the error catalogue in `packages/shared` and the generated frontend types are all checked against it in CI. See [Drift test](#route-metadata-and-openapi-drift-test).

---

## 1. Paths, resources and versioning

| Rule | Detail | Source |
|---|---|---|
| Prefix | All business endpoints sit under `/api/v1`. An unknown version prefix (`/api/v2/...`) returns 404 `NOT_FOUND`. | REQ-API-001 |
| Outside the prefix | `/health/live` and `/health/ready` (operation-level `servers` in the contract). `/metrics` runs on the internal listener and is not part of the public contract. `/api/docs` serves Swagger UI (swagger-ui-dist) over this document when `DOCS_ENABLED=true`: on by default in `local` and `test`; `staging` and `production` opt in with `DOCS_ENABLED=true` (the config default `localOnly`, PR21-SEC-03 ruling D-ARCH-083; REQ-API-003 and US-035 are aligned by product-manager). A production opt-in carries the PR21-SEC-02 conditions (cookieless docs origin, try-it-out off, `validatorUrl: null`). | REQ-PLAT-018, REQ-API-003 |
| Naming | Plural kebab-case nouns (`/address-book`, `/payment-method-setups`), camelCase path parameters (`{shipmentId}`), snake_case JSON members and query parameters. | ADR-0016 |
| Actions | Non-CRUD actions are POST sub-resources: `/shipments/{shipmentId}/cancel`, `/orders/{orderId}/checkout`, `/quotes/{quoteId}/claim`. | ADR-0016 |
| Secrets out of URLs | One-time and bearer-like tokens never appear in paths or query strings (ADR-0016 amendment 2). Email and share links carry the token in the URL **fragment** as `#token=<base64url>` on the unprefixed app routes `/verify-email`, `/reset-password`, `/invitations/accept` and `/q` (ADR-0006 amendment 8, ADR-0016 amendment 6; the link origin is `WEB_APP_ORIGIN` or, for operator staff, `ADMIN_APP_ORIGIN`, ADR-0006 amendment 9) and the SPA posts it in a body: `verifyEmail`, `resetPassword`, `acceptInvitation` (`POST /invitations/accept`), `resolveSharedQuote` (`POST /public/shared-quotes/resolve`). The postcode lookup is `lookupPublicTracking` (`POST /public/tracking/lookup`). Guest quotes use the `X-Quote-Token` header. | ADR-0016, threat model R-14 |
| Tenancy in paths | Tenant scope comes from the access token's active organisation, never from the path. `{orgId}` in `/organisations/{orgId}/...` must equal the active organisation. A different value gets 404, the same answer as a missing resource. | REQ-ORG-005, REQ-RBAC-007 |
| HTTP semantics | GET is safe. PUT replaces a whole resource, PATCH changes part of one, DELETE is a soft delete or a state transition. 201 + `Location` on create, 202 for accepted async work (cancel, document email, carrier push, tracking refresh), 204 when there is no body. | RFC 9110 |
| `operationId` | camelCase `<verb><Resource>`, unique (e.g. `createQuote`, `listShipments`, `getDocumentDownloadUrl`). | ADR-0016 |
| Versioning | The major version is in the path. Additive changes (new optional fields, new operations, new enum values on response-only enums that clients must tolerate) do not change the path. They bump `info.version` (minor). Breaking changes need `/api/v2` running alongside v1 for the deprecation window. `info.version` follows semver with a milestone pre-release tag (`1.0.0-m1`). Breaking changes are detected in CI by `oasdiff breaking` against the previous release tag (Docker image `tufin/oasdiff`, Apache-2.0; ADR-0016 §1). | REQ-API-002, REQ-API-015 |

### Deprecation and sunset (REQ-API-015, Could)

There are no deprecated operations in 1.0.0-m1. The mechanism exists and has a test fixture:

1. Mark the operation `deprecated: true` and add `x-sunset: <RFC 3339 date>` plus `x-deprecation-link: <url of migration notes>`.
2. Route metadata carries `deprecated: { sunset, link }`. The response middleware then adds:
   - `Deprecation: @<unix-seconds>` (RFC 9745)
   - `Sunset: <HTTP-date>` (RFC 8594)
   - `Link: <url>; rel="deprecation"`
3. The contract test fails if a deprecated operation has no `x-sunset`, or if the sunset date has passed while the route is still mounted.
4. First-party clients must migrate within one release. Partner-facing operations (M3) get a window of at least 6 months.

---

## 2. Representations (REQ-API-016)

| Type | Wire format | Notes |
|---|---|---|
| Identifiers | UUID string (UUIDv7, time-ordered) | ADR-0009 |
| Instants | ISO 8601 UTC ending in `Z`, e.g. `2026-11-12T14:30:00Z` | Pattern enforced in `Timestamp` |
| Local dates | `YYYY-MM-DD`, always paired with an IANA zone field (`time_zone`) | Pickup dates, holidays (REQ-RLS-012) |
| Local times | `HH:MM` | Pickup windows |
| Money | `{ "amount": <int64 minor units>, "currency": "USD" }` | Never a float. The exponent comes from the currency reference data (REQ-DATA-006). |
| Decimals | String: FX rates have exactly 6 decimals (`"83.650000"`); percentages and tax rates are `DecimalString` | DR-B11 |
| Weights and dimensions | Integer grams (`weight_g`) and millimetres (`*_mm`), plus a `display` block in the entry unit system | DR-B06. Input uses `PackageInput`, a `oneOf` on `unit_system` (METRIC kg/cm, IMPERIAL lb/in) with the DR-B34 limits. |
| Countries | ISO 3166-1 alpha-2. Subdivisions use ISO 3166-2 (`US-NY`). `EU` is allowed only for the compliance template. | |
| Labels | i18n keys (`label_key`) for charge lines and tracking descriptions. Reference data is localised by `Accept-Language` and answered with `Content-Language`. | REQ-I18N-001/006 |
| Restricted personal data | Tax and identity references are write-only (`TaxReferenceInput.value`, `writeOnly`) and come back masked (`value_masked`) | REQ-BOOK-008 |
| Server-controlled fields | `id`, `org_id`, `created_by`, `updated_by`, `version`, `on_behalf_of_org_id` and role or permission fields in a request: 400 `VALIDATION_ERROR` sub-code `UNKNOWN_FIELD`. `on_behalf_of_org_id` is always `null` in responses (seam). | REQ-SEC-007, REQ-ORG-007 |

All request and response object schemas declare `additionalProperties: false`. The response-validation helper therefore catches any field that leaks. This matters most for `PublicTracking` (the DR-B31 allow-list) and `SharedQuote` (no personal data).

---

## 3. Errors: RFC 9457 problem details

Every error is `application/problem+json`, built by one error handler (REQ-PLAT-009):

```json
{
  "type": "https://docs.platform.invalid/problems/VALIDATION_ERROR",
  "title": "Validation failed",
  "status": 400,
  "detail": "Validation failed.",
  "instance": "/api/v1/auth/register",
  "code": "VALIDATION_ERROR",
  "correlation_id": "c0ffee00-1234-4abc-9def-001122334455",
  "errors": [
    { "pointer": "/body/password", "code": "PASSWORD_POLICY", "message": "Password must be 12 to 128 characters and not in the breached list." },
    { "pointer": "/body/on_behalf_of_org_id", "code": "UNKNOWN_FIELD", "message": "Field is not allowed." }
  ]
}
```

- `type` is `https://docs.<domain>/problems/<CODE>` (ADR-0016 §3). `<domain>` comes from configuration, so the URI follows the brand; the developer portal (M3) serves one page per code.
- `code` is stable UPPER_SNAKE_CASE. A published code is never reused for another meaning (REQ-API-005). Clients render the localised text from `errors.<CODE>`, while `title` and `detail` stay in English for logs (REQ-I18N-001).
- 5xx bodies carry only the generic `detail` "An unexpected error occurred." and `correlation_id`. No stacks, SQL, paths, library text or provider text ever appear (REQ-PLAT-009, EC-A48).
- Extension members are a closed set, declared in `Problem`:

  | Member | When |
  |---|---|
  | `errors[]` | `VALIDATION_ERROR` (max 50) |
  | `current_etag` | `CONCURRENCY_CONFLICT` |
  | `mfa_challenge_token`, `mfa_methods` | `MFA_REQUIRED` |
  | `blocking_conditions[]` | checkout gate (REQ-BOOK-016) |
  | `prohibited_matches[]` | `ITEM_PROHIBITED` |
  | `limit` | `LIMIT_EXCEEDED` |

- Order of evaluation (DR-A08): authenticate (401) → staff MFA gate (403) → authorise (403, audited `PERMISSION_DENIED`) → rate limit (429) → validate (400) → idempotency and `If-Match` (400/409/412/422/428) → execute (404/409/410/422/5xx). Denied callers therefore learn nothing about the schema.
- A resource of another organisation or another guest token returns exactly the same 404 as a missing one. No `PERMISSION_DENIED` entry is written for it, because RLS hides the row; instead the repeated-404 counter feeds `cross_tenant_probe` (REQ-RBAC-007, EC-A08).
- Framework-level errors apply to every path and are not repeated per operation: unknown route 404 `NOT_FOUND`, wrong method 405 `METHOD_NOT_ALLOWED` with an `Allow` header (REQ-PLAT-010). The 405 `Allow` header lists every method the route supports, including `OPTIONS` (RFC 9110 §15.5.6). `OPTIONS` on a known route, including the `/api/docs` paths (mounted inside the same router), returns 204 with no body and the same `Allow` header. A route that supports only GET and HEAD therefore answers `Allow: GET, HEAD, OPTIONS` (AT-US-007-02). (amended 2026-11-13, D-063, D-ARCH-084)
- Shared problem responses (`components/responses/BadRequest`, `Unauthorized`, ..., `ServiceUnavailable`) carry one named example per code of that status. Each operation lists the subset it can return in `x-error-codes`.

### Validation sub-codes (`errors[].code`, under 400 `VALIDATION_ERROR`)

| Sub-code | Meaning |
|---|---|
| `REQUIRED` | Required field missing. |
| `UNKNOWN_FIELD` | Field not declared by the route schema, incl. server-controlled fields (REQ-SEC-007, REQ-ORG-007). |
| `INVALID_TYPE` | Wrong JSON type. |
| `INVALID_FORMAT` | Pattern/format mismatch (email, E.164 phone, UUID, date, postcode pattern of the country). |
| `INVALID_ENUM` | Value not in the allowed set. |
| `OUT_OF_RANGE` | Number outside min/max (e.g. limit > 100, package weight/dimension limits DR-B34). |
| `TOO_SHORT` | String/array shorter than minimum. |
| `TOO_LONG` | String/array longer than maximum. |
| `PASSWORD_POLICY` | Password length, breached-list or equals-email-local-part rule (REQ-AUTH-002, REQ-AUTH-023). |
| `RANGE_TOO_LARGE` | Audit date range longer than 31 days (REQ-AUDIT-019). |
| `REGION_REQUIRED` | State/province required by the country (REQ-DATA-007). |
| `POSTCODE_INVALID` | Postcode does not match the country pattern (REQ-BOOK-006). |
| `REFERENCE_REQUIRED` | Tax/identity reference required by the compliance pack is missing or malformed (REQ-BOOK-008). |

Pointers address `/body/...`, `/query/...`, `/params/...` (path parameters) and `/headers/...` (REQ-API-006, ADR-0016 §4). The frontend maps them onto form fields (REQ-UI-010).

---

## 4. Lists: pagination, filtering, sorting (REQ-API-007/008, DR-A21)

- Cursor pagination only. Request `limit` (default 25, max 100) and `cursor`. Response `{ items, next_cursor, has_more }`. Audit lists use a default of 50 and a max of 200. HS-code search and service points use a default and max of 20.
- An out-of-range `limit` (0, 101, non-numeric) is 400 `VALIDATION_ERROR`; it is never clamped. A tampered, expired or foreign cursor is 400 `INVALID_CURSOR`. Cursors are opaque and HMAC-signed, and they bind the sort, the filters and the tenant, so a cursor cannot cross tenants.
- Ordering is deterministic, with the row ID as tie-breaker. Total counts are not returned.
- Filtering uses `filter[<field>]=<value>` (OpenAPI `style: deepObject`). Each list operation declares an allow-list (`schema.additionalProperties: false`). Anything outside it is 400 `INVALID_FILTER`. Multiple filters combine with AND. Comma-separated values (e.g. `filter[status]=DRAFT,QUOTED`) mean "any of" where the field schema says so. Range filters use `_from` / `_to` suffixes.
- Sorting uses `sort=field,-field`, limited to the per-operation allow-list encoded as a `pattern`. Anything else is 400 `INVALID_SORT`. Allow-listed fields are indexed fields, and every list has a query-plan test (REQ-AUDIT-016, REQ-ACCT-002).
- Free-text search uses `q` (min 2 chars) where documented: shipments, address book, HS codes, prohibited items.
- A list `GET` writes one `VIEW` audit entry per request with the filter summary and result count, never row values (DR-A13).

**Known pressure point:** REQ-API-007 caps every list at 100 per page, so the country list (about 250 rows) needs three requests. Reference lists are cacheable (`Cache-Control: public, max-age=3600`, ETag), so the cost is small. A route-specific maximum for bounded reference sets is raised as a proposal in the handback.

---

## 5. Idempotency (REQ-API-009..011, DR-A20)

| Aspect | Rule |
|---|---|
| Header | `Idempotency-Key`: 1 to 255 printable ASCII characters (UUIDv4 recommended). A malformed key is 400 `VALIDATION_ERROR`. |
| Where | `x-idempotency: required` → missing key is 400 `IDEMPOTENCY_KEY_REQUIRED`. Required on: `createOrder`, `checkoutOrder`, `confirmPayment`, `schedulePickup`, `reschedulePickup`, `cancelShipment` (orders, payments, bookings and carrier-side effects). `optional` on every other unsafe operation except the one-time-secret routes below. `not-applicable` on safe methods, authentication routes (REQ-API-009 note), webhooks (de-duplicated by gateway or carrier event ID) and the routes whose response carries a one-time secret: `createQuote` (`guest_token`) and `createQuoteShare` (`share_token`) declare no `Idempotency-Key` parameter and no `Idempotent-Replayed` header; a retry creates a new quote or mints a new share token (ADR-0014 amendment 1, SEC-P3-10). |
| Scope | Organisation, or the guest-token hash, or (anonymous routes) the client IP /64 HMAC — plus actor, method, route path and key (`scope_hash`). The same key from two organisations or two users is independent (EC-A29). Stored response bodies are encrypted at rest (AES-256-GCM, `key_id`, AAD = table ‖ column ‖ scope_hash ‖ key_id). Routes whose response carries a one-time secret are `not-applicable` and never stored: `createQuote`, `createQuoteShare`, `enrolTotp`, `activateTotp` (the recovery codes) and `regenerateRecoveryCodes`. *Amended 2026-11-12 (SEC-P3-33 item 5):* `activateTotp` is on the ADR-0014 one-time-secret list (ADR-0014 amendment 4), no longer only proposed. The drift test asserts that every route on the ADR-0014 one-time-secret list is `not-applicable` (SEC-TC-53). |
| Fingerprint | SHA-256 of method, path, canonical (sorted) query and RFC 8785 canonical body. |
| Replay | Same key and same fingerprint within 24 h → the stored status, headers and body are returned with `Idempotent-Replayed: true`. No business action runs, and no second audit entry or outbox event is written. |
| Replay and re-auth proof | *Amended 2026-11-12 (SEC-P3-33 item 9).* On the four `payment_method.manage` routes (`createPaymentMethodSetup`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`; `x-idempotency: optional`, single-use `X-Reauth-Proof`), the idempotency lookup runs **before** the re-auth proof check. A replay (same scope, actor, key and fingerprint) is served from the store without checking or consuming a proof, so a client retry with the already-consumed proof still gets the original response. Any **new** execution (no key, a new key, or a key whose stored record has expired) needs a fresh, unconsumed proof, otherwise 401 `REAUTH_REQUIRED`. A key reused with a different fingerprint still gets 422 `IDEMPOTENCY_KEY_REUSED`, and the proof is not consumed. |
| Conflicts | Same key with a different fingerprint → 422 `IDEMPOTENCY_KEY_REUSED`. Same key while the first request is still running → 409 `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1`. |
| Not stored | 5xx and 429 responses, so a retry executes again (EC-A30). After 24 h the key counts as new. Records are hard-deletable rows outside the audit chain. |
| End to end | Saga steps and gateway calls derive their own keys from business IDs (shipment ID as carrier client reference, refund key from shipment + cancellation ID). The client key protects only the HTTP request (DR-B04 G3). |

---

## 6. Optimistic concurrency (REQ-API-012/013, DR-A16)

- Every single-resource `GET` of a versioned resource returns a strong `ETag` of the form `"<id>:<version>"` (ADR-0016 §7); clients treat it as opaque. `If-None-Match` with a matching value gives 304 and no body.
- `PUT`, `PATCH` and `DELETE` on versioned resources declare a required `If-Match`. Missing: 428 `PRECONDITION_REQUIRED`. Stale: 412 `CONCURRENCY_CONFLICT` with `current_etag` in the body and an `ETag` header. Two concurrent updates from the same version: exactly one succeeds (EC-A26).
- A no-op update returns 200 with the current ETag, does not bump the version and writes no audit entry (EC-A25).
- POST actions that change a versioned aggregate (`cancelShipment`, `checkoutOrder`, `addOrderShipment`) also require `If-Match`. This is how the cancel-versus-first-scan race in DR-B20 / EC-B27 is decided.

---

## 7. Rate limiting (REQ-API-014, REQ-SEC-005, DR-A22, D-035)

Counters live in Redis and are shared by all API instances (express-rate-limit 8 + rate-limit-redis 6). Every route declares `x-rate-limit-class`, and route metadata carries the same value.

There are two stages (ADR-0016 amendment 1, threat model R-13). A coarse **per-IP pre-authentication limiter** (the route's `public` or `auth` budget) runs before authentication, so floods never reach bcrypt or JWT verification. The per-user limiter keeps its DR-A08 position after authorisation. IPv6 clients are keyed by their /64 prefix.

| Class | Key | Default limit (config, ASSUMED A-035) | Routes |
|---|---|---|---|
| `auth` | IP and account identifier | 10/min per IP **and** 5/min per account identifier | register, verify-email, login, MFA challenge, password reset, password change, reauth, TOTP enrol/activate/disable, recovery codes |
| `email-send` | account identifier and IP | 3/h per account identifier **and** 10/h per IP | resend-verification, password/forgot, TOTP enrolment code (`requestTotpEnrolmentCode`) |
| `public` | IP | 120/min per IP | reference, compliance, consents, shared-quote resolve, guest quote read and stream, refresh, logout, CSRF token |
| `public-quote` | IP (anonymous) | 20/min **and** 100/h per IP | `createQuote` for anonymous callers **and users in `PENDING_VERIFICATION`**, who are treated as anonymous: per-IP limits and the anonymous carrier budget of ADR-0010 amendments 2–3 and 10 (*amended 2026-11-12, SEC-P3-29*) |
| `quote-create` | user and organisation | 30/min **and** 300/h per user, **and** 1,000/h per organisation (configuration: `RATE_QUOTE_CREATE_PER_USER_PER_MIN`, `RATE_QUOTE_CREATE_PER_USER_PER_HOUR`, `RATE_QUOTE_CREATE_PER_ORG_PER_HOUR`) | `createQuote` for authenticated **verified** callers, declared in that route's `x-rate-limit-route` (*added 2026-11-12, SEC-P3-29, ADR-0010 amendment 10, ADR-0016 amendment 11*) |
| `public-tracking` | IP | 30/min **and** 300/h per IP; unsuccessful lookups 10/min per IP | `getPublicTracking`, `lookupPublicTracking` |
| `authenticated` | user | 600/min per user | every bearer route not listed above (not `createQuote`, which uses `quote-create` or `public-quote`) |
| `csp-report` | IP | 20/min per IP | `reportCspViolation` |
| `webhook` | source IP | **Proposed** 600/min per source IP (DR-A22 sets no value) | Stripe, Mock gateway and carrier push |
| `none` | n/a | not limited | `/health/live`, `/health/ready` (orchestrator probes) |

**`createQuote` class selection and carrier quota** (*amended 2026-11-12, SEC-P3-29, ADR-0010 amendment 10, ADR-0016 amendment 11*). `createQuote` is the only route with two classes. `x-rate-limit-class: public-quote` applies to anonymous callers and to users in `PENDING_VERIFICATION`. The authenticated class `quote-create` applies when a valid bearer token belongs to a verified user (`users.email_verified_at IS NOT NULL`, read server-side, never from the request); it is declared in the route's `x-rate-limit-route` value (`verified authenticated callers: class quote-create, ...`), which `defineRoute.rateLimit.route` must equal, so the drift test (§15 assertion 4) checks both classes. A verified caller's `createQuote` no longer counts in the 600/min `authenticated` class. Separately from HTTP rate limiting, the carrier budget protects each carrier account's daily quota:

- unverified users count as **anonymous** for the carrier budget (the anonymous bucket, its 50 % share and the 60 % stop of ADR-0010 amendments 2–3);
- each organisation may consume at most `CARRIER_QUOTA_ORG_SHARE_PCT` (default **10**) % of a carrier account's daily quota for rates-pool calls. Beyond it, that organisation receives `carrier_error {code: CARRIER_BUSY}` or cached results for that carrier (other organisations still fan out), and the security event `carrier_quota_org_share_exhausted` fires at most once a minute per carrier account and organisation. Transactional (booking) calls are never refused by the share. The quote itself is still created (201); no 429 is returned for the quota share. Verification: SEC-TC-62.

Route-specific limits are declared in `x-rate-limit-route` and run in addition to the class limit:

| Operation | Limit | Status and code |
|---|---|---|
| `requestPrivacyExport` | 1/min per user | 429 `RATE_LIMITED` |
| `emailShipmentDocuments` | 5 per shipment per hour | 429 `RATE_LIMITED` |
| `refreshShipmentTracking` | 1 per shipment per 5 min | 429 `RATE_LIMITED` |
| `checkoutOrder` | 5 attempts per order per hour (a business rule). A payment failed by the CVC rule (SEC-P3-28) counts as an attempt. | 429 `PAYMENT_ATTEMPTS_EXCEEDED` |
| `createQuoteShare` | 10 mints per quote per rolling hour (`QUOTE_SHARE_MINTS_PER_HOUR=10`, configuration, D-055), counted in PostgreSQL inside the minting transaction (data-model §3.10, `ix_quote_shares__quote_created`) (*added 2026-11-12, SEC-P3-32, ADR-0016 amendment 11*). The refused mint revokes nothing. | 429 `RATE_LIMITED` with `Retry-After` |
| `streamQuoteResults`, `streamBookingProgress` | At most 2 concurrent open streams per client IP (/64) and 5 per user, counted across both stream routes and all replicas in Redis (`SSE_MAX_STREAMS_PER_IP`, `SSE_MAX_STREAMS_PER_USER`; SEC-P3-02, R-15, T-47). Refused before the stream opens. | 429 `RATE_LIMITED` with `Retry-After` |

**Headers.** Every rate-limited response carries the three separate headers `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds) required by REQ-API-014. In express-rate-limit 8 these separate headers are produced by `standardHeaders: 'draft-6'`; `'draft-7'` (named in ADR-0016 §8) emits a single combined `RateLimit` header plus `RateLimit-Policy`. The contract follows REQ-API-014, and the mismatch is raised with the principal-architect. When a class has two windows (minute and hour), the headers describe the window closest to exhaustion. A 429 adds `Retry-After` in seconds. Login throttling has its own codes, separate from rate limiting: 429 `ACCOUNT_DELAYED` (2 s doubling to 60 s after 5 failures) and 429 `ACCOUNT_LOCKED` (15 min after 10 failures), both with `Retry-After` (DR-A02).

**Redis outage.** Authentication-class limits fall back to per-instance in-memory counters and log an ERROR security event. All other classes fail open (REQ-SEC-006).

**Caching.** Authenticated responses default to `Cache-Control: no-store` (ADR-0016 amendment 1). Public reference data uses `public, max-age=3600` with ETags (REQ-DATA-016).

**IP.** The client IP is the first untrusted hop from the configured trusted-proxy list. Spoofed `X-Forwarded-For` values are ignored (EC-A12).

---

## 8. Authentication, sessions, CSRF and special headers

| Mode | Used by | Mechanism (security scheme) |
|---|---|---|
| Customer web | `apps/web` | `bearerAuth`: ES256 JWT, 15 min, in memory only. Refresh cookie `__Host-rt_web` (`refreshCookieWeb`): HttpOnly, Secure, SameSite=Strict, `Path=/`, no Domain (the `__Host-` prefix requires it). The server reads it only on `/auth/csrf`, `/auth/refresh` and `/auth/logout`, the three operations whose `security` is the cookie; on every other route it is ignored, current or stale, and neither refuses nor marks the response (ADR-0006 amendments 1 and 17; ADR-0008 amendment 5). 30 d sliding, 30 d absolute cap (`AUTH_SESSION_ABSOLUTE_TTL`); `AUTH_REFRESH_TTL` may never exceed the cap. A refresh past the cap returns 401 `SESSION_EXPIRED` (SEC-P3-01). The access token carries `auth_time` (OIDC claim: last password or MFA verification, persisted as `sessions.authenticated_at`; set at login, updated by the MFA challenge and by `createReauthProof`, copied unchanged by refresh). Login body `client_app: "web"`. |
| Staff admin | `apps/admin` | Same bearer token. Cookie `__Host-rt_admin` (`refreshCookieAdmin`) with a 12 h absolute cap (REQ-ADMIN-004) and a 30-minute sliding idle lifetime of the admin refresh token (`AUTH_ADMIN_REFRESH_IDLE_TTL=30m`) inside the 12 h cap; idle → 401 `SESSION_EXPIRED` (SEC-P3-11). The admin SPA stops silent refresh after 30 minutes without user input (ADR-0026). `client_app: "admin"` is refused with the generic `INVALID_CREDENTIALS` for non-operator users (REQ-ADMIN-003). A staff session without TOTP is limited to routes flagged `x-mfa-gate-exempt` (`requestTotpEnrolmentCode`, `enrolTotp`, `activateTotp`, `getMe`); every other route returns 403 `MFA_ENROLMENT_REQUIRED` (REQ-AUTH-018). Outside `APP_ENV ∈ {local, test}` a staff user's **first** TOTP enrolment needs the 6-digit e-mailed code from `requestTotpEnrolmentCode` (10 min, single-use) in the `enrolTotp` body; without it, 403 `MFA_ENROLMENT_CODE_REQUIRED` (SEC-P3-14). |
| Guest | quote widget | `quoteToken`: header `X-Quote-Token` (256-bit base64url) returned once by `createQuote`. Never put in URLs, logs or audit values. A wrong or missing token, or a token for a claimed quote, returns 404 (A-078). Accepted on `getQuote` and `streamQuoteResults`, and on `claimQuote`, `saveQuote` and `createShipment` together with the bearer token for the claim. Share links resolve through `POST /public/shared-quotes/resolve` with the token in the body. Browser-side the web app keeps it in `localStorage` as `qt:<quoteId>` → `{token, expires_at}` and deletes it on claim, expiry, sign-out or 404 (ADR-0026 amendment 1; no cookie, no URL). |
| Webhooks | gateways, carriers | `stripeSignature` (`Stripe-Signature` over the raw body, 300 s tolerance), `mockGatewaySignature` (`X-Mock-Signature`: HMAC-SHA256 of timestamp + raw body, non-production only), `carrierSignature` (`X-Carrier-Signature`: per-adapter algorithm). Signatures are verified before the body is parsed into the domain. |

- **Refresh and logout** are cookie-authenticated and need both an allow-listed `Origin` and an `X-CSRF-Token` header (`csrfToken`) matching the signed token from `getCsrfToken`: `base64url(HMAC-SHA256(CSRF_KEY, session_id || app))`, recomputed on verification with no server state (ADR-0006 amendment 2). `getCsrfToken` itself is authenticated by the refresh cookie. Failure: 403 `CSRF_REJECTED` and security event `csrf_rejected` (REQ-SEC-004). Bearer routes are not cookie-authenticated and are exempt; the contract marks the cookie routes `x-csrf: true`.
- **Rotation and reuse.** Every refresh rotates the token in its family. Presenting a rotated or revoked token revokes the whole family and session: 401 `SESSION_REVOKED`, audit `TOKEN_REUSE_DETECTED`, security event `refresh_token_reuse`. Revocation reaches access tokens within 5 s through the Redis `revoked:sid` set (REQ-AUTH-009).
- **Expired access token.** 401 `ACCESS_TOKEN_EXPIRED` → the client refreshes once (single-flight across tabs) and retries once (REQ-AUTH-010, EC-A11).
- **Re-authentication.** `createReauthProof` returns a 5-minute, single-use proof bound to the session and an `action_scope`, and updates the session's `authenticated_at` (so the next access token carries a fresh `auth_time`). Routes with `x-reauth-scope` require it in `X-Reauth-Proof` and otherwise answer 401 `REAUTH_REQUIRED`. When a route also declares `x-reauth-max-age` (seconds), it accepts **either** a valid proof for the scope **or** an access token whose `now − auth_time ≤ x-reauth-max-age`; such routes declare the header as optional (`ReauthProofConditional`). Without `x-reauth-max-age` a proof is always required (`ReauthProof`, required header). Scopes in M1 (REQ-AUTH-020):
  - always required: `auth.password.change`, `mfa.totp.disable`, `mfa.recovery_codes.regenerate`, `privacy.delete`, `privacy.export` (`requestPrivacyExport`, `downloadPrivacyExport`), `payment_method.manage` (`createPaymentMethodSetup`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`);
  - required when `auth_time` is older than 12 h (`x-reauth-max-age: 43200`): `org.member.manage` (`createInvitation`, `resendInvitation`, `updateMember`, `removeMember`).

  *Amended 2026-11-12 (SEC-P3-33 item 9):* **proof versus idempotent replay.** The `payment_method.manage` routes are `x-idempotency: optional` and their proof is single-use. The idempotency middleware runs before the re-auth check: a replay (same scope, actor, key and fingerprint, §5) is served from the store and neither checks nor consumes a proof; any new execution needs a fresh proof (401 `REAUTH_REQUIRED` otherwise). The proof is consumed only when the request executes.

  The MFA-weakening scopes require a TOTP proof when MFA is active, never a password alone (ADR-0006 amendment 3). **Saved-card checkout** uses no proof: when a saved payment method is used and `auth_time` is older than 12 h, `checkoutOrder` returns `cvc_recollection_required: true` and creates the PaymentIntent with `payment_method_options.card.require_cvc_recollection=true`, so the Payment Element collects the CVC inside the Stripe iframe (no PCI scope change; SEC-P3-01). *Amended 2026-11-12 (SEC-P3-28, ADR-0012 amendment 4):* the payment is `AUTHORISED` only if the retrieved charge has `payment_method_details.card.checks.cvc_check = 'pass'`. Any other value (`fail`, `unavailable`, `unchecked`, absent) voids the authorisation (manual capture, no money moves) and sets the payment `FAILED` with `failure_code: AUTHENTICATION_FAILED`: audited `UPDATE payment`, security event `cvc_recollection_failed`, shipments back to `QUOTED`, the attempt counted toward the 5-per-hour cap. One derivation function serves `checkoutOrder` (Mock), `confirmPayment` and the Stripe and Mock webhooks. The client then offers another card or `createReauthProof`, which advances `auth_time`, so the retried checkout needs no CVC. Mock outcomes: `test_token` `mock_cvc_pass`, `mock_cvc_fail`, `mock_cvc_unavailable` (they behave as `mock_ok` when no recollection is required). **Fallback:** if this step-up is not delivered together with the payments and organisation stories, `AUTH_REFRESH_TTL=7d` (inside the 30-day absolute cap) becomes the configuration default and D-038 is re-opened (ADR-0006 amendment 12).
- **Dual-mode routes and `auth` sets.** `createQuote`, `getQuote` and `streamQuoteResults` declare `x-permission: public` (guest branch) and `x-permission-authenticated: quote:create|quote:read`; `defineRoute` carries the latter as `permissionAuthenticated`. The route's `auth` is the operation's `security` list read one to one (ADR-0008 amendment 4, D-ARCH-107): `createQuote` is `[anonymous, session]` (`security: [{}, bearerAuth]`), `getQuote` and `streamQuoteResults` are `[session, quote-token]` (`[bearerAuth, quoteToken]`), and the refresh, logout and CSRF routes are `[refresh-cookie]`, never `session`, because they are called with an expired or absent access token. Rules: a bearer token that is present must be valid and is never replaced by the guest branch (401 `ACCESS_TOKEN_EXPIRED`, `SESSION_REVOKED` or `AUTH_REQUIRED`); when a bearer token and `X-Quote-Token` both arrive the bearer decides; with no usable credential `getQuote` and `streamQuoteResults` answer 404 `NOT_FOUND` (A-078) and `createQuote` takes the guest branch; the permission named in `x-permission-authenticated` is checked in the active organisation for the bearer branch only. The authorisation step first requires that the principal's credential is one the route declares, `public` routes included. The RBAC matrix generator tests both branches and a credential outside the set.
- **A route reads only the credential kinds it declares** (ADR-0008 amendment 5, ADR-0006 amendment 17; PR32-SEC-16). A bearer, a refresh cookie or an `X-Quote-Token` that the route's `security` does not list is not parsed, verified or counted: it cannot authenticate, cannot fail the request and does not change `Cache-Control`. So an expired or malformed bearer on an `[anonymous]` route (login, registration, reference lists, public tracking) is ignored; an expired bearer on `refreshSession`, `logoutSession` or `getCsrfToken` is ignored; a refresh cookie, current or stale, on any other route is ignored, and on a `[session]` route it never replaces the bearer (401 `AUTH_REQUIRED`). "A present bearer must be valid" applies only to the three sets that contain `session`. `private, no-store` follows the credentials the route declares (and any route whose set has no `anonymous`); a request that carries only foreign credentials gets the contract's own `Cache-Control`, so the reference lists keep `public, max-age=3600` for a signed-in browser. The web client may therefore attach its access token to every request. Credential headers never reach a handler either: `defineRoute` refuses a `schema.headers` that names `authorization`, `cookie`, `x-csrf-token`, `x-reauth-proof`, a provider signature header, or `x-quote-token` outside the `[session]` companion case of `claimQuote`, `saveQuote` and `createShipment` (ADR-0008 amendment 6; PR38-SEC-03; TASK-020 part 020-C). The real authenticators read credential presence only through `presentedKinds`, build permissions with `readonlySet` and call `markCredentialsRead` together with their decision; the problem handler takes the declared-credential test from the route descriptor, so a refused credential is `private, no-store` whatever the authenticator marked.
- **`X-Mock-Scenario`** (DR-B29, REQ-CARR-005). Semicolon-separated `key=value` directives, for example `latency=6000;fail=booking`. Keys: `latency` (0..30000 ms), `fail` (`rates|booking|void|pickup|cancel_pickup|track`), `error` (a canonical carrier code), `rates=empty`, `track` (`happy_path|customs_hold|exception|return_to_sender|delayed|unknown_number`). It is also read from a shipment `customer_reference` starting with `MOCK:`. Unknown keys or out-of-range values: 400 `MOCK_SCENARIO_INVALID`. The header is ignored, and the Mock carrier is absent, in production (REQ-CARR-006, EC-B41). It is declared on every operation that reaches a carrier.
- **`X-Correlation-Id`.** Accepted inbound when it matches `^[A-Za-z0-9-]{8,64}$`, otherwise generated. Always echoed, and propagated to logs, audit, outbox, jobs and carrier calls (REQ-PLAT-011).
- **`Accept-Language`.** Resolved to en/es/fr (q-values honoured, `es-MX` → `es`, otherwise `en`) for localised labels. The authenticated user's stored locale takes precedence for emails (DR-A18).
- **Registration and sessions.** `registerUser` never issues tokens or cookies (202, identical for new and existing addresses, EC-A01). The web app signs the new user in immediately with a separate `loginUser` call using the credentials still in memory and falls back to the sign-in panel on `INVALID_CREDENTIALS` (ADR-0006 amendment 10). Signing in before verification is allowed; checkout stays gated by `EMAIL_NOT_VERIFIED` (D-009).
- **`X-Robots-Tag: noindex`.** Sent on every API response (ADR-0016 amendment 6); the frontends add it on the admin app and on tracking results with a `number` parameter (ADR-0026 amendment 5).

---

## 9. Server-sent events (REQ-API-017/018, REQ-CARR-009, REQ-BOOK-025)

| Property | Contract |
|---|---|
| Endpoints | `GET /quotes/{quoteId}/stream` (`streamQuoteResults`) and `GET /orders/{orderId}/booking-progress/stream` (`streamBookingProgress`) |
| Response headers | `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `X-Correlation-Id` |
| Framing | Every event has a monotonically increasing integer `id:`, a named `event:` and a single-line JSON `data:`. A comment heartbeat `: heartbeat` is sent at least every 15 s. |
| Rate-shopping events | `carrier_result` → `SseCarrierResult` {carrier_code, status OK/NO_SERVICE, options[QuoteOption], exclusions, cached, elapsed_ms}; `carrier_error` → `SseCarrierError` {carrier_code, state `timeout`/`error`, code (DR-B30), elapsed_ms}; `complete` → `SseComplete` {counts per status, carriers[{carrier_code, status}], option_count, elapsed_ms}; `error` → `SseError` {code, correlation_id} |
| Booking events | `step_update` → `SseStepUpdate` {shipment_id, step, status, error_code, shipment_state}; `complete` → `BookingProgress`; `error` → `SseError` |
| Deadlines | Per carrier 4 s, overall 5 s. `complete` is sent by 5 s; outstanding carriers are reported as `carrier_error` with state `timeout` and are never cached (DR-B16). |
| Carrier quota | *Amended 2026-11-12 (SEC-P3-29).* When the quoting organisation has used its `CARRIER_QUOTA_ORG_SHARE_PCT` share of a carrier account's daily quota (or the caller is anonymous or unverified and the anonymous budget is spent), that carrier is not called: the stream sends `carrier_result` with `cached: true` if a cached result exists, otherwise `carrier_error` with state `error` and code `CARRIER_BUSY`. `complete` then reports that carrier with status `OK` (cached) or `ERROR` (counted under `ERROR`); `SseComplete` carries no code, so the `CARRIER_BUSY` reason is read from the `carrier_error` event or from `Quote.carrier_statuses[].error_code` on `getQuote`. Other carriers are unaffected. |
| Termination | The server closes within 1 s after `complete` or `error`. The hard cap is 30 s, and rate shopping normally closes by 6 s. On client disconnect, in-flight upstream calls are cancelled within 1 s (AbortSignal through `CarrierContext`). |
| Reconnect | `streamQuoteResults` accepts `Last-Event-ID`. Results are persisted as they arrive, so a client reconnecting to **any** replica gets the missed events replayed from the database before live ones. The event id is the per-quote sequence number (ADR-0016 amendment 3). `getQuote` remains the non-streaming fallback. `streamBookingProgress` has no resume: clients reconnect and receive the current state, or poll `getBookingProgress` every 3 s. |
| Caps | Opening or reopening a stream never triggers carrier fan-out or saga work: rate-shopping fan-out happens once, at `POST /quotes` (`createQuote`), and booking carrier calls are driven by the saga after checkout. The streams only replay persisted state and subscribe (SEC-P3-02 item 5; SEC-TC-42: 10 reopenings cause 0 extra carrier calls). At most 2 concurrent open streams per client IP (/64) and 5 per user across both stream routes (`SSE_MAX_STREAMS_PER_IP`, `SSE_MAX_STREAMS_PER_USER`, Redis counters released on close); the next one gets 429 `RATE_LIMITED` with `Retry-After` before the stream opens (R-15, T-47). |
| Auth | EventSource cannot send headers, so the web app uses a fetch-based SSE reader that sends `Authorization: Bearer` or `X-Quote-Token`. Cross-tenant and wrong-token requests get 404 before the stream opens. |
| Privacy | Events contain no personal data and no raw carrier text, only canonical codes. |
| Contract | The payload schemas are listed under `x-sse-events` on each stream operation and live in `components/schemas` (`Sse*`). Redocly reports them as unused because they are only referenced from a vendor extension (see lint status). |

---

## 10. Vendor extensions

| Extension | On | Values | Checked against |
|---|---|---|---|
| `x-requirements` | every operation | REQ IDs | traceability.md |
| `x-permission` | every operation | catalogue string (`resource:action[:qualifier]`), `public` or `authenticated` | `defineRoute.permission`, `packages/authz` catalogue |
| `x-permission-justification` | `public` / `authenticated` | text (required) | REQ-RBAC-005 |
| `x-permission-authenticated` | dual-mode routes | catalogue string checked when a bearer token is present | `defineRoute.permissionAuthenticated` (§15 row 12); RBAC matrix generator |
| `x-permission-status` | proposed permissions | `proposed` | must be empty before G2 closes (see handback) |
| `x-audit` | every operation | `{action, entity, sensitivity: SENSITIVE/NORMAL/NONE, reasonRequired, justification?, additional?}`. `action: NONE` only with a justification. `additional` (*added 2026-11-12, SEC-P3-28/32*) lists further audit entries the operation writes in the same transaction, each `{action, entity, sensitivity, when}`: `createQuoteShare` (`UPDATE quote_share` for the implicitly revoked share) and `checkoutOrder` (`UPDATE payment` when a required CVC check fails on a synchronous Mock authorisation). | `defineRoute.audit` (REQ-AUDIT-006); the audit test generator asserts each `additional` entry under its `when` condition |
| `x-idempotency` | every operation | `required` / `optional` / `not-applicable` | `defineRoute.idempotency` |
| `x-rate-limit-class` | every operation | see §7 | `defineRoute.rateLimit.class` |
| `x-rate-limit-route` | some | extra route limit (text). On `createQuote` it also names the authenticated class `quote-create` for verified callers (§7; *amended 2026-11-12, SEC-P3-29*) | `defineRoute.rateLimit.route` |
| `x-tenancy` | every operation | `tenant` / `operator-cross-tenant` / `guest` / `public` / `user` (own user rows: me, sessions, auth) | `defineRoute.tenancy` |
| `x-error-codes` | every operation | catalogue codes | error catalogue + response statuses |
| `x-milestone`, `x-moscow` | every operation | M0/M1, Must/Should/Could | REQUIREMENTS.md |
| `x-csrf` | cookie routes | `true` | CSRF middleware mount |
| `x-mfa-gate-exempt` | MFA enrolment routes (`requestTotpEnrolmentCode`, `enrolTotp`, `activateTotp`) and `getMe` | `true` | staff MFA gate allow-list |
| `x-reauth-scope` | re-auth routes (14 in M1, see §8) | scope string | `defineRoute.reauth.scope` |
| `x-reauth-max-age` | re-auth routes that accept a recent sign-in instead of a proof (`org.member.manage` routes) | integer seconds (`43200` = 12 h). Only together with `x-reauth-scope`: the route accepts either a valid `X-Reauth-Proof` for the scope or an access token whose `now − auth_time ≤ x-reauth-max-age`. Absent: a proof is always required. | `defineRoute.reauth.maxAgeSeconds`; the parameter is `ReauthProofConditional` (optional) when present and `ReauthProof` (required) when absent |
| `x-sse-events` | stream routes | event name → schema | SSE test helper |
| `x-response-allow-list` | `getPublicTracking`, `lookupPublicTracking` | `DR-B31` | forbidden-field contract test |
| `x-environments` | `receiveMockGatewayWebhook` | environments where the route is mounted | production-mode route test |

---

## 11. Error-code catalogue

The catalogue lives in `packages/shared/src/errors/catalogue/` (one `<module>.ts` file per module, aggregated by `index.ts`; each entry is a code with its `status` and `title`). It is the single list the error handler accepts: a thrown error without a catalogue entry fails a test (REQ-API-005). The parity test `tests/generated/error-catalogue.test.ts` (unit lane, `npm run test:unit`) asserts that the codes, statuses and titles equal the examples under `components/responses` in `openapi.yaml`, that the code and status of every row of the table below equal the catalogue (both directions), and that every code thrown through `new AppError(...)` or carried by a domain error class is catalogued or listed under "Codes that are not HTTP problem codes". There is no script that regenerates the examples or the table: a new code is added to the catalogue, its example and its table row by hand, and the test names whichever of them is missing. `METHOD_NOT_ALLOWED` is framework-level and is the one catalogue code without a shared response example (§3), and each example's `type` URI must be derived from its code. The domain-error scan is a regex scan: it sees only a literal first argument of `new <Name>Error(` or `super(`, and it exempts by class a few infrastructure error classes whose codes never reach an HTTP problem body (`AuditWriteError`, `ObjectStorageError`, `SecretFileError`, `NonRetryableError`; the list is `EXEMPT_ERROR_CLASSES` in the test). The "Source" column below is the requirement or decision that introduced the code; it is documentation, not a catalogue field.

Status rule (A-073): a domain code with no stated HTTP status maps to **422**.

| Code | HTTP | Meaning | Source |
|---|---|---|---|
| `CARD_DATA_NOT_ACCEPTED` | 400 | Request carries a PAN, expiry or CVC-like field; use hosted fields only. | REQ-PAY-005 |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Operation marked x-idempotency: required was called without Idempotency-Key. | REQ-API-009, DR-A26 |
| `INVALID_CURSOR` | 400 | Pagination cursor tampered, expired or issued for another query. | REQ-API-007, DR-A26 |
| `INVALID_FILTER` | 400 | filter[field] names a field or operator outside the route allow-list. | REQ-API-008, DR-A26 |
| `INVALID_SORT` | 400 | sort names a field outside the route allow-list. | REQ-API-008, DR-A26 |
| `MALFORMED_REQUEST` | 400 | Body is not parseable JSON (or not the declared media type syntax). | REQ-PLAT-010, DR-A26 |
| `MOCK_SCENARIO_INVALID` | 400 | X-Mock-Scenario (or MOCK: reference) has an unknown key or out-of-range value (DR-B29). | REQ-CARR-005 |
| `PAYMENT_METHOD_NOT_AVAILABLE` | 400 | Only CARD (incl. saved card) is offered in M1. | REQ-PAY-019 |
| `TOKEN_INVALID` | 400 | One-time token (verification, reset, invitation) unknown, used, revoked or superseded. | REQ-AUTH-004, REQ-AUTH-012, REQ-ORG-011, DR-A26 |
| `VALIDATION_ERROR` | 400 | One or more fields failed schema or rule validation; see errors[] (pointer, sub-code, message), max 50 items. | REQ-API-006, DR-A26 |
| `WEBHOOK_SIGNATURE_INVALID` | 400 | Gateway webhook signature or timestamp (300 s tolerance) failed verification; nothing processed. Proposed code (REQ-PAY-011 states 400 without a code). | REQ-PAY-011 (proposed) |
| `ACCESS_TOKEN_EXPIRED` | 401 | Bearer token past exp; client refreshes once and retries. | DR-A08, EC-A11, DR-A26 |
| `AUTH_REQUIRED` | 401 | No valid credentials for a protected route (also unsigned carrier push). | REQ-RBAC-006, DR-A26 |
| `INVALID_CREDENTIALS` | 401 | Unknown email, wrong password, non-permitted account type or app; identical response for all. | REQ-AUTH-005, REQ-ADMIN-003, DR-A26 |
| `MFA_INVALID` | 401 | Wrong, replayed or out-of-window TOTP or recovery code. | REQ-AUTH-017, EC-A06, DR-A26 |
| `MFA_REQUIRED` | 401 | Password correct; complete the MFA challenge with the returned mfa_challenge_token (5 min, single-use). | REQ-AUTH-017, DR-A26 |
| `REAUTH_REQUIRED` | 401 | Route needs a fresh X-Reauth-Proof bound to this session and action scope. | REQ-AUTH-020, DR-A26 |
| `SESSION_EXPIRED` | 401 | Refresh token past the absolute session cap or (admin) the 30-minute idle limit; sign in again. | REQ-AUTH-007, REQ-ADMIN-004, SEC-P3-01, SEC-P3-11 |
| `SESSION_REVOKED` | 401 | Session or refresh family revoked (logout, reuse detection, password reset, removal). | REQ-AUTH-008, REQ-AUTH-009, DR-A26 |
| `AUTHZ_DENIED` | 403 | Caller lacks the route permission in the active organisation (PERMISSION_DENIED audited). | REQ-RBAC-006, REQ-RBAC-007, DR-A26 |
| `CSRF_REJECTED` | 403 | Cookie-authenticated request without allow-listed Origin or matching X-CSRF-Token. | REQ-SEC-004, DR-A26 |
| `EMAIL_NOT_VERIFIED` | 403 | Checkout, payment and document email require a verified account email. | REQ-BOOK-016, REQ-PAY-007, D-009 |
| `INVITATION_EMAIL_MISMATCH` | 403 | Signed-in verified email differs from the invited address. | REQ-ORG-011, DR-A26 |
| `MFA_ENROLMENT_CODE_REQUIRED` | 403 | Staff first TOTP enrolment outside local/test requires the e-mailed enrolment code; request one via `requestTotpEnrolmentCode`. Missing, wrong, expired or used code; wrong codes count against the per-user MFA lock (`MFA_LOCKED`). | REQ-AUTH-018, SEC-P3-14 |
| `MFA_ENROLMENT_REQUIRED` | 403 | Operator-org member without active TOTP may only call MFA enrolment routes. | REQ-AUTH-018, DR-A26 |
| `NOT_FOUND` | 404 | Resource absent, soft-deleted, or owned by another organisation / guest token (indistinguishable). | REQ-RBAC-007, REQ-RLS-007, DR-A26 |
| `TRACKING_NOT_FOUND` | 404 | Unknown or not-yet-trackable public lookup; identical body and timing for every miss. | REQ-TRACK-012 |
| `METHOD_NOT_ALLOWED` | 405 | Path exists but not for this method; Allow header lists methods (framework level). | REQ-PLAT-010, DR-A26 |
| `ACCOUNT_HAS_ACTIVE_SHIPMENTS` | 409 | Deletion refused while the user owns shipments not in a final state. | REQ-ACCT-017, US-271 |
| `ALREADY_MEMBER` | 409 | Invited email already has an ACTIVE membership. | REQ-ORG-010, DR-A26 |
| `AMOUNT_MISMATCH` | 409 | Client-supplied expected amount differs from the server-computed order total. | REQ-PAY-006 |
| `CONFLICT` | 409 | Internal optimistic-concurrency or uniqueness conflict not caused by If-Match. | REQ-RLS-011, DR-A26 |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Same Idempotency-Key still executing; Retry-After: 1. | REQ-API-011, DR-A20, DR-A26 |
| `ILLEGAL_STATE_TRANSITION` | 409 | Requested change is not permitted from the current shipment/order state (DR-B01); body may list blocking_conditions. | REQ-BOOK-018, REQ-PICK-007, DR-B01 |
| `PICKUP_ALREADY_SCHEDULED` | 409 | An active pickup exists; reschedule instead. | REQ-PICK-007 |
| `QUOTE_ALREADY_CLAIMED` | 409 | Quote is owned by another organisation; claim is once-only. | REQ-RLS-013, REQ-QUOTE-016, DR-A26 |
| `QUOTE_EXPIRED` | 409 | Quote past expires_at; re-quote with the same inputs. | REQ-QUOTE-017, REQ-PAY-007 |
| `SHIPMENT_NOT_CANCELLABLE` | 409 | State or tracking history outside the cancellation window (DR-B20). | REQ-BOOK-029, DR-B20 |
| `DOCUMENT_VOIDED` | 410 | Voided label cannot be downloaded. | REQ-DOC-014 |
| `DOWNLOAD_EXPIRED` | 410 | One-time download (privacy export) already consumed or expired. | REQ-ACCT-016, DR-A26 |
| `TOKEN_EXPIRED` | 410 | One-time token past its lifetime (verification 24 h, reset 60 min, invitation 7 d). | REQ-AUTH-004, REQ-AUTH-012, REQ-ORG-011, DR-A26 |
| `CONCURRENCY_CONFLICT` | 412 | If-Match does not match the current ETag; body carries current_etag. | REQ-API-013, REQ-RLS-011, DR-A26 |
| `PAYLOAD_TOO_LARGE` | 413 | Body above the route limit (default 1 MB). | REQ-SEC-015, DR-A26 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type not declared by the route. | REQ-SEC-015, DR-A26 |
| `ADDRESS_COUNTRY_MISMATCH` | 422 | Sender/receiver country differs from the selected quote option lane. | REQ-BOOK-006, A-073 |
| `AMOUNT_BELOW_MINIMUM` | 422 | Order total below the gateway minimum charge. | REQ-PAY-006 |
| `COMMODITY_CODE_FORMAT` | 422 | Commodity code is not 6, 8 or 10 digits (or a length the destination pack rejects). | REQ-CUST-007, US-182 |
| `COUNTRY_NOT_SUPPORTED` | 422 | Origin or destination country is not shipping_enabled. | REQ-DATA-005, DR-A26 |
| `COUPON_EXHAUSTED` | 422 | Coupon has no remaining redemptions. | REQ-PRICE-011, EC-B24 |
| `COUPON_EXPIRED` | 422 | Coupon outside its active date range at pricing time. | REQ-PRICE-011, EC-B24 |
| `COUPON_INVALID` | 422 | Unknown or ineligible coupon (eligibility not disclosed). | REQ-PRICE-011 |
| `COVER_VALUE_EXCEEDS_MAXIMUM` | 422 | Insured value above the configured maximum insurable value. | REQ-PRICE-009 |
| `CUSTOMS_CURRENCY_MIXED` | 422 | All customs lines of a shipment must use one currency. | REQ-CUST-003, A-073 |
| `CUSTOMS_WEIGHT_EXCEEDS_PACKAGE` | 422 | Sum of line net weights exceeds total actual package weight. | REQ-CUST-003, A-073 |
| `DG_ATTESTATION_REQUIRED` | 422 | No-dangerous-goods attestation missing (current wording version). | REQ-CUST-010 |
| `FX_RATE_UNAVAILABLE` | 422 | No FX snapshot for the requested currency pair. | REQ-PRICE-015 |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same Idempotency-Key with a different request fingerprint within 24 h. | REQ-API-011, DR-A20, DR-A26 |
| `ITEM_PROHIBITED` | 422 | Description or commodity chapter matches a PROHIBITED entry; no override (DR-B24). | REQ-CUST-009, DR-B24 |
| `LAST_OWNER` | 422 | Change would leave a customer organisation without an ACTIVE Owner. | REQ-ORG-013, DR-A26 |
| `LIMIT_EXCEEDED` | 422 | A configured count limit would be exceeded (10 owned orgs, 3 invitation resends, 10 shipments per order, 10 saved methods, 500 address-book entries). | A-073, DR-A26 |
| `ORDER_CURRENCY_MISMATCH` | 422 | Shipment sell currency differs from the order currency. | REQ-BOOK-013, A-073 |
| `ORG_TYPE_NOT_ALLOWED` | 422 | Attempt to create a PARTNER or second OPERATOR organisation, or change an organisation type. | REQ-ORG-001 |
| `ORG_TYPE_RESTRICTION` | 422 | Operation not permitted for this organisation type (e.g. inviting into an INDIVIDUAL org). | REQ-ORG-014, DR-A26 |
| `PICKUP_DATE_INVALID` | 422 | Date not served, a holiday, past cut-off or beyond the 14-day horizon. | REQ-PICK-002, EC-B25 |
| `PICKUP_WINDOW_INVALID` | 422 | Window outside carrier bounds, shorter than 120 min, or before now + lead time. | REQ-PICK-004, DR-B25 |
| `REASON_REQUIRED` | 422 | Route requires a typed reason of at least 10 characters (mechanism; M2 signed actions). | REQ-AUDIT-025, DR-A26 |
| `ROLE_NOT_ALLOWED_FOR_ORG_TYPE` | 422 | Role does not belong to the organisation type. | REQ-ORG-004, DR-A26 |
| `PRECONDITION_REQUIRED` | 428 | If-Match header missing on PUT/PATCH/DELETE of a versioned resource. | REQ-API-013, DR-A26 |
| `ACCOUNT_DELAYED` | 429 | Progressive delay after 5 consecutive failures; Retry-After 2..60 s. | REQ-AUTH-013, DR-A02, DR-A26 |
| `ACCOUNT_LOCKED` | 429 | 15-minute lock after 10 consecutive failures; Retry-After. | REQ-AUTH-014, DR-A02, DR-A26 |
| `MFA_LOCKED` | 429 | Challenge locked 15 min after 5 consecutive wrong codes. | REQ-AUTH-017, DR-A02, DR-A26 |
| `PAYMENT_ATTEMPTS_EXCEEDED` | 429 | More than 5 payment attempts for the order in one hour. | REQ-PAY-010 |
| `RATE_LIMITED` | 429 | Rate-limit class or route limit exceeded; Retry-After in seconds. | REQ-API-014, DR-A22, DR-A26 |
| `AUDIT_WRITE_FAILED` | 500 | Same-transaction audit insert failed; mutation rolled back; safe to retry with the same Idempotency-Key. | REQ-AUDIT-004, DR-A26 |
| `DOCUMENT_INTEGRITY_FAILURE` | 500 | Stored bytes no longer match the recorded SHA-256; download refused, alert raised. | REQ-DOC-009 |
| `INTERNAL_ERROR` | 500 | Unhandled error; generic detail plus correlation_id only. | REQ-PLAT-009, DR-A26 |
| `AUDIT_UNAVAILABLE` | 503 | SENSITIVE view/download could not be audited; no data released (fail closed). | REQ-AUDIT-005, REQ-DOC-008, DR-A26 |
| `GATEWAY_UNAVAILABLE` | 503 | Gateway unreachable or circuit open while creating/confirming a payment. | REQ-PAY-010 |
| `SERVICE_UNAVAILABLE` | 503 | Dependency unavailable or request exceeded 30 s. | REQ-SEC-015, EC-A32, DR-A26 |

### Codes that are not HTTP problem codes

| Namespace | Values | Where they appear |
|---|---|---|
| Carrier canonical errors (DR-B30) | `INVALID_ADDRESS`, `POSTCODE_INVALID`, `SERVICE_UNAVAILABLE`, `WEIGHT_EXCEEDED`, `DIMENSION_EXCEEDED`, `PROHIBITED_ITEM`, `CUSTOMS_DATA_INVALID`, `AUTH_FAILED`, `RATE_LIMITED`, `TIMEOUT`, `CARRIER_UNAVAILABLE`, `CARRIER_BUSY`, `DUPLICATE_SHIPMENT`, `CANNOT_VOID`, `PICKUP_UNAVAILABLE`, `CAPABILITY_NOT_SUPPORTED`, `CARRIER_UNKNOWN_ERROR` | `carrier_error.code`, `carrier_statuses[].error_code`, `shipment.last_error.code`, `pickup.failure_code`, `booking_error_code`. `SERVICE_UNAVAILABLE` and `RATE_LIMITED` share names with HTTP codes but are a separate namespace (schema `CarrierErrorCode`). |
| Payment failure codes (REQ-PAY-010) | `CARD_DECLINED`, `INSUFFICIENT_FUNDS`, `AUTHENTICATION_FAILED`, `EXPIRED_CARD`, `GATEWAY_UNAVAILABLE` | `Payment.failure_code` on a FAILED payment (200 response). `GATEWAY_UNAVAILABLE` is also a 503 problem code when the gateway cannot be reached. |
| Coupon status | `COUPON_INVALID`, `COUPON_EXPIRED`, `COUPON_EXHAUSTED` | `Order.coupon.status` after re-pricing at checkout (EC-B24); 422 problem codes on `applyOrderCoupon` |
| Rate-shopping exclusion reasons | `WEIGHT_EXCEEDED`, `DIMENSION_EXCEEDED`, `CONTENT_TYPE_NOT_SUPPORTED`, `DIRECTION_NOT_SUPPORTED` | `carrier_statuses[].exclusions[].reason` (REQ-QUOTE-004, EC-B09) |
| Compliance state | `PACK_UNAVAILABLE` | `state` field of `CompliancePackPublic`, `Quote.tax_pack`, `ProhibitedItemList.pack` (200, never a hidden default; DR-A23) |
| Pricing explanation warnings | `FX_STALE`, `PRICE_FLOOR_APPLIED`, `FUEL_NONE`, `FUEL_INCLUDED_BY_CARRIER` | `PricingExplanation.warnings` |
| Internal / start-up only | `PRICING_CONFIG_INVALID`, `CURRENCY_MISMATCH`, `NOT_SUPPORTED_IN_M1`, `PAYMENT_LIVE_KEY_FORBIDDEN`, `NOTIFICATION_PROVIDER_FORBIDDEN`, `CHANNEL_NOT_AVAILABLE`, `MISSING_TENANT_CONTEXT`, `SSRF_BLOCKED` | Engine, config validation, worker DLQ reasons and security events. Never returned by the API: they surface as 500 `INTERNAL_ERROR` or 503, or as a carrier status. |
| Audit reasons | `NOT_STAFF`, `SESSION_EXPIRED`, `DRAFT_EXPIRED` | audit `reason` / transition `reason_code` values. The audit reason `SESSION_EXPIRED` denotes the same event as the 401 problem code `SESSION_EXPIRED` (refresh past the absolute cap or the admin idle limit). |

---

## 12. Domain-event catalogue

Events are written to `outbox_events` in the same transaction as the state change (REQ-PLAT-016). Each event has an envelope and a type-specific `payload`:

```json
{
  "id": "<uuidv7 = BullMQ jobId>", "type": "shipment.state_changed", "schema_version": 1,
  "occurred_at": "2026-11-12T14:30:00Z", "aggregate_type": "shipment", "aggregate_id": "<uuid>",
  "org_id": "<uuid|null>", "actor": { "type": "USER|SYSTEM_JOB|ANONYMOUS", "id": "<uuid|null>" },
  "correlation_id": "...", "trace_context": "<W3C traceparent>", "recipient_locale": "en|es|fr|null",
  "payload": { }
}
```

`recipient_locale` is captured when the event is created and not re-read at send time (REQ-I18N-008). Payloads hold identifiers and canonical values only. Names, addresses, phone numbers, tax references and raw tokens are not stored in clear. The one-time token that an email link needs (verification, reset, invitation) is carried as `token_enc`, AES-256-GCM with the outbox payload key, and the notification consumer erases it after sending. See the handback for the architect confirmation this needs.

| Event `type` | Producer module | Consumers | Payload summary | Notification template (DR-B28) |
|---|---|---|---|---|
| `auth.email_verification` | identity | notifications | user_id, token_enc, expires_at | EMAIL_VERIFICATION (always sent) |
| `auth.password_reset` | identity | notifications | user_id, token_enc, expires_at | PASSWORD_RESET (always) |
| `auth.security_event` | identity | notifications | user_id, `variant` (NEW_DEVICE_SIGN_IN, PASSWORD_CHANGED, PASSWORD_RESET_COMPLETED, MFA_ENABLED, MFA_DISABLED, RECOVERY_CODE_USED, ACCOUNT_LOCKED, SESSION_REVOKED), occurred_at, coarse device and IP | SECURITY_NOTICE.<variant> (always) |
| `org.invitation_created` | organisations | notifications | invitation_id, org_id, role, invitee email (the recipient), token_enc, expires_at | TEAM_INVITATION |
| `quote.created` | quotes | metrics (no M1 business consumer) | quote_id, lane (origin/destination country), content_type, package_count, guest flag | none |
| `quote.claimed` | quotes | metrics | quote_id, org_id | none |
| `shipment.state_changed` | shipments | tracking (start/stop/re-time polling, DR-B19), dashboard cache | shipment_id, from_state, to_state, trigger, reason_code, version | none |
| `order.checkout_started` | orders | booking (saga deadline timer) | order_id, order_number, amount | none |
| `payment.authorised` | payments | booking (start or resume the saga) | payment_id, order_id, amount | none |
| `payment.authorisation_released` | payments | orders (status), booking | payment_id, order_id, released_amount, reason | none |
| `payment.captured` | payments | notifications, orders | payment_id, order_id, captured_amount, shipment_ids | PAYMENT_RECEIPT |
| `payment.capture_failed` | payments | booking (compensation: void, release) | payment_id, order_id, shipment_id, failure_code | none |
| `payment.refunded` | payments | notifications, shipments (VOIDED → REFUNDED) | refund_id, payment_id, shipment_id, amount | REFUND_ISSUED |
| `payment.refund_failed` | payments | notifications, alerting | refund_id, shipment_id, attempts | REFUND_FAILED |
| `shipment.booked` | shipments (saga) | documents (generate), tracking (schedule first poll) | shipment_id, order_id, carrier_code, service_code, tracking_number | none |
| `shipment.booking_failed` | shipments (saga) | notifications | shipment_id, order_id, carrier canonical code, outcome DRAFT/EXCEPTION | BOOKING_FAILED |
| `shipment.label_ready` | shipments | booking (pickup step) | shipment_id, label document_ids | none |
| `shipment.cancelled` | shipments | pickups (cancel), carriers (void job), notifications | shipment_id, reason_code, refund_expected | SHIPMENT_CANCELLED |
| `shipment.voided` | shipments | payments (refund), documents (void label) | shipment_id, carrier_code | none |
| `order.booked` | orders (saga notify step) | notifications | order_id, order_number, shipments[{shipment_id, tracking_number, pickup_ref or service_point}] | BOOKING_CONFIRMATION |
| `document.generated` | documents | shipments (BOOKED → LABEL_READY for labels), customs upload (paperless) | document_id, shipment_id, type, version, sha256 | none |
| `pickup.scheduled` | pickups | notifications, documents (pickup confirmation) | pickup_id, shipment_id, local_date, time_zone, window, carrier_reference | PICKUP_SCHEDULED |
| `pickup.cancelled` | pickups | notifications | pickup_id, shipment_id, carrier_cancel_failed | PICKUP_CANCELLED |
| `pickup.failed` | pickups | notifications | pickup_id, shipment_id, carrier canonical code | PICKUP_FAILED |
| `tracking.event_received` | tracking | shipments (forward transition, DR-B18), metrics | tracking_event_id, shipment_id, canonical_status, occurred_at | none |
| `tracking.picked_up` | tracking | notifications | shipment_id, order_number, tracking_number, carrier_code, city, country_code | TRACKING_PICKED_UP (subject to `tracking_updates`) |
| `tracking.in_transit` | tracking | notifications | as above (first occurrence only) | TRACKING_IN_TRANSIT (preference) |
| `tracking.out_for_delivery` | tracking | notifications | as above | TRACKING_OUT_FOR_DELIVERY (preference) |
| `tracking.delivered` | tracking | notifications | as above | TRACKING_DELIVERED (preference) |
| `tracking.exception` | tracking | notifications | as above | TRACKING_EXCEPTION (preference) |
| `audit.chain_broken` | audit (worker) | alerting, readiness | stream_id, first_broken_entry_id, verification_id | none |
| `featureflag.changed` | admin-settings | flag cache invalidation | key, version | none |
| `config.changed` | admin-settings, compliance, seed | caches (pricing config, compliance packs) | config_type, version | none |

Recipients (DR-B28, REQ-NOTIF-015): the booking user for shipment, order, payment, pickup and tracking events; the invited address for invitations; the account for authentication events. Never the sender or receiver contacts.

**Delivery guarantees**

- **At least once.** The relay polls `published_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED` in batches of 100 every 500 ms, enqueues to BullMQ with `jobId = event id`, and marks the event published only after the queue accepts it (REQ-PLAT-017).
- **Ordering.** Events are published in creation order per aggregate. Consumers run concurrently, so they must not rely on arrival order: they check the aggregate `version` or current state (for example DR-B01 transition guards; webhooks derive state from the retrieved gateway object).
- **Deduplication.** Each consumer records `processed_events(consumer, event_id)` in its own transaction. Notification jobs use an idempotency key of event ID + template + recipient (REQ-NOTIF-014).
- **Retries and DLQ.** 5 attempts with exponential backoff from 2 s plus jitter (notifications: 30 s base). After that the job moves to `<queue>:dead` with redacted data, the reason and the attempt count. Non-retryable errors (validation, `MISSING_TENANT_CONTEXT`, permission) skip retries. DLQ depth is exported as a metric with an alert, and a worker command replays a dead-lettered job by ID (DR-A25, REQ-PLAT-013).
- **Versioning.** `schema_version` starts at 1. Additive payload changes keep the version and consumers ignore unknown fields. A breaking change publishes `schema_version: 2` alongside version 1 for one release, after which version 1 is retired. Event `type` names are never reused.

---

## 13. Security log event catalogue

Each event is a structured Pino line with `event_type=security`, a stable `event` name, `correlation_id`, `org_id`, `actor_id` and coarse IP. Secrets, tokens and raw identifiers never appear. Each event also increments `security_events_total{event}` (REQ-SEC-012). Owners of these two promises (amended 2026-11-13, SHEET-FOLD-2): the coarse IP is produced by the first authentication emitter (TASK-052), through a shared helper that truncates to the /24 (IPv4) or /48 (IPv6) network; a precise address is dropped, never logged. The `security_events_total{event}` counter is published by the US-013 metrics task (TASK-214).

The table below is the request-path catalogue checked by SEC-TC-63: 22 events (14 original plus the eight added on 2026-11-12 for SEC-P3-30). The runtime integrity events raised by platform code follow in their own table under "Runtime integrity events" and are not part of this parity. *Amended 2026-11-12 (SEC-P3-30):* the contract test **SEC-TC-63** asserts that the set of security-event names exported by `packages/shared` equals the `event` column of this table, in both directions; an event emitted in code but missing here, or listed here but not exported, fails the test. REQ-SEC-012 names the same set.

| `event` | Emitted when | Extra fields | Related audit action | Source |
|---|---|---|---|---|
| `login_failed` | Any failed password login (unknown email, wrong password, NOT_STAFF, suspended) | reason (internal), account identifier hash | LOGIN_FAILED | REQ-AUTH-013, REQ-ADMIN-003 |
| `account_locked` | 10th consecutive failure sets the 15-min lock | identifier hash, lock_until | ACCOUNT_LOCKED | REQ-AUTH-014 |
| `mfa_failed` | Wrong or replayed TOTP or recovery code | method | MFA_FAILED | REQ-AUTH-017 |
| `mfa_locked` | 5 consecutive wrong codes lock the challenge | lock_until | MFA_FAILED | REQ-AUTH-017 |
| `refresh_token_reuse` | Rotated or revoked refresh token presented | family_id, session_id | TOKEN_REUSE_DETECTED | REQ-AUTH-008 |
| `permission_denied` | Authorisation fails for an authenticated caller | route template, required permission | PERMISSION_DENIED | REQ-RBAC-007 |
| `csrf_rejected` | Cookie route without allow-listed Origin or a matching CSRF token | route, origin | DENIED entry | REQ-SEC-004 |
| `ssrf_blocked` | Outbound client refuses a destination or redirect | host, reason | none | REQ-SEC-010 |
| `rate_limit_auth` | `auth` or `email-send` class limit hit | class, key type | none | REQ-SEC-012 |
| `cross_tenant_probe` | More than 20 404s per user per minute | count | none (RLS hides rows) | REQ-SEC-012, A-042 |
| `webhook_signature_invalid` | Stripe, Mock or carrier signature or timestamp check fails | provider | CREATE webhook_event, DENIED | REQ-PAY-011, REQ-TRACK-006 |
| `audit_write_failed` | Same-transaction audit insert fails (500) or a SENSITIVE read fails closed (503) | route, entity | none (by definition) | REQ-AUDIT-004/005 |
| `audit_chain_broken` | Verification finds a broken link | stream_id, first_broken_entry_id | (`audit.chain_broken` event) | REQ-AUDIT-013 |
| `live_key_forbidden` | Start-up finds a live-mode Stripe key or a production carrier/payment endpoint | key name only | none | REQ-PAY-004 |
| `registration_probe` | More than 5 distinct normalised e-mail addresses registered from one IP within an hour; the request gets 429 `RATE_LIMITED` (the response for new and existing addresses stays identical otherwise) | distinct_address_count, window; coarse IP only, no address or address hash | none (the refused request creates no user) | ADR-0006 amendment 15, D-049, REQ-SEC-012, REQ-AUTH-001, EC-A52 |
| `carrier_anon_budget_exhausted` | The anonymous share of a carrier account's `rates` pool or its global anonymous token bucket (`CARRIER_ANON_CALLS_PER_MIN`) is exhausted; guests and `PENDING_VERIFICATION` users get `CARRIER_BUSY` or cached results for that carrier. At most once per carrier account per minute | carrier_code, account_id, budget (`share` or `bucket`) | none | ADR-0010 amendments 2 and 10, REQ-CARR-022 |
| `carrier_quota_pressure` | A carrier account's daily quota usage (`CARRIER_DAILY_QUOTA`) crosses 70 % or 90 %; once per threshold per account per UTC day | carrier_code, account_id, threshold (70 or 90), used, quota | none | ADR-0010 amendment 3, REQ-CARR-023 |
| `carrier_quota_org_share_exhausted` | An organisation has used its `CARRIER_QUOTA_ORG_SHARE_PCT` (10 %) share of a carrier account's daily quota for rates-pool calls; its further quotes get `CARRIER_BUSY` or cached results for that carrier. At most once per carrier account and organisation per minute | carrier_code, account_id, share_pct, used (the organisation is the standard `org_id` field) | none | ADR-0010 amendment 10, SEC-P3-29, REQ-CARR-023 |
| `job_context_mismatch` | A worker job's payload carries `org_id` or `actor_id` (schema violation), or no `job_context` row resolves to exactly one tenant context; the job goes to the DLQ as non-retryable without touching tenant data | queue, job_name, job_id, reason (`PAYLOAD_TENANT_FIELD` or `JOB_CONTEXT_NOT_FOUND`) | none (no tenant context is opened) | ADR-0013 amendment 2, REQ-PLAT-014, T-73 |
| `webhook_livemode_rejected` | A correctly signed Stripe webhook event has `livemode: true`; answered 400, not processed | provider, gateway event ID | CREATE webhook_event, DENIED | ADR-0012 amendment 3, REQ-PAY-012 |
| `audit_anchor_missing` | The audit verifier (`ANCHOR_MISSING`) finds an anchor-log gap, duplicate, out-of-order record, broken `prev_anchor_hash`, or a table/sink disagreement; run `FAILED`, `/health/ready` degraded | verification_id, anchor_seq_from, anchor_seq_to, failure_kind | none (verification run record) | data-model §5.6, ADR-0007 amendment 7, REQ-AUDIT-013 |
| `cvc_recollection_failed` | A saved-card payment with `cvc_recollection_required: true` has a retrieved `cvc_check` other than `pass` (`fail`, `unavailable`, `unchecked`, absent); the authorisation is voided and the payment `FAILED/AUTHENTICATION_FAILED`. Emitted by the shared derivation on `checkoutOrder` (Mock), `confirmPayment` and the gateway webhooks | payment_id, order_id, gateway, cvc_check value | UPDATE payment | ADR-0012 amendment 4, SEC-P3-28, REQ-PAY-014 |

### Runtime integrity events (not part of the SEC-TC-63 table parity)

*Added 2026-11-13 (SHEET-FOLD-2, D-ARCH-081..084).* These events are raised by platform runtime code, not by a request-path emitter. They are exported as `RUNTIME_SECURITY_EVENTS` from `packages/shared/src/logging/security-event.ts` (TASK-010, D-TASK010-01 change request; D-SEC-PR20-01) and are always logged at level `error` (D-ORCH-025 (1)). Their attribute allow-list is per event, as listed below. It is pinned by the apps/api type-level exhaustiveness test (`SessionIntegrityFinding | DbSecurityEvent` assignable to `RuntimeSecurityEventName`) and by the `SECURITY_EVENT_FIELDS` test, not by the main-table parity. They carry `correlation_id` when a request or job context exists, and never carry PostgreSQL message text, role names or credentials (ADR-0005 amendment 10 item 6).

| Source | Event | Emitted when | Allowed fields | Level |
|---|---|---|---|---|
| `apps/api/src/platform/db/runtime.ts` (TASK-016) | `db_session_default_tampered` | A `platform_app` session default (`search_path`, `role`, `statement_timeout` …) differs from `EXPECTED_ROLE_SETTINGS` at start-up or on the slow readiness interval; readiness latches not-ready | sql_state | error |
| same | `db_role_setting_drift` | A role-level setting drifted from the bootstrap value (PR7-SEC-06) | sql_state | error |
| same | `db_session_context_leak` | The in-statement leak detector finds `app.*` context after a transaction ended (PR7-SEC-14); counted by `db_session_context_leak_total` (TASK-214) | sql_state | error |
| same (`mapDbError`) | `db_privilege_denied` | SQLSTATE `42501` outside the audit-immutability and partition-guard prefixes: a grant misconfiguration, surfaced as 500 | sql_state | error |
| same (`mapDbError`) | `rls_write_rejected` | A write refused by a row-level-security policy (`42501` / `44000` under the RLS prefix); reachable only through a code or configuration defect, never by a client | sql_state | error |
| `mapDbError` (TASK-021) | `audit_mutation_rejected` | Trigger-raised `42501` / `23514` with the `AUDIT_IMMUTABLE:` / `AUDIT_VAULT_IMMUTABLE:` message prefix: an UPDATE/DELETE/TRUNCATE attempt on an audit table (data-model §5.2; derived from the prefix, never from the text) | sql_state | error |
| `apps/api/src/platform/health/checks/audit-partitions.ts` and `ensure_audit_partitions` via `mapDbError` (TASK-021) | `audit_partition_squatted` | A `pg_class` / `pg_type` object in `public` matching `^audit_entries_[0-9]{4}_[0-9]{2}$` is not an attached `platform_audit_owner` partition, or `ensure_audit_partitions` raises `AUDIT_PARTITION_NAME_TAKEN` / `AUDIT_PARTITION_BOUNDS_MISMATCH`; readiness `audit_partitions` = `unavailable` (data-model §5.3 item 3, D-ARCH-076, D-ARCH-081). Emitted once per object, not once per poll | partition_name, kind, reason, sql_state | error |

---

## 14. Permissions used by the contract

All strings come from REQ-RBAC-001/014 and the Part B scope notes. `public` and `authenticated` are markers, and each one carries `x-permission-justification`. Two strings were proposed by api-designer and **accepted by principal-architect on 2026-11-12** (ADR-0008 amendment): `carrier:status:read` (operator-only) and `webhook:mock_gateway:receive` (non-production only). No `x-permission-status: proposed` remains.

| Permission | Operations |
|---|---|
| `address_book:manage` | 4: POST /organisations/{orgId}/address-book; PUT /organisations/{orgId}/address-book/{entryId}; DELETE /organisations/{orgId}/address-book/{entryId}; POST /organisations/{orgId}/address-book/import |
| `address_book:read` | 2: GET /organisations/{orgId}/address-book; GET /organisations/{orgId}/address-book/{entryId} |
| `audit:read` | 4: GET /audit/entries; GET /audit/entries/{auditEntryId}; GET /audit/entities/{entityName}/{entityId}/history; GET /audit/chain/status |
| `carrier:status:read` | 1: GET /carriers/status |
| `customs:manage` | 2: PUT /shipments/{shipmentId}/customs; POST /shipments/{shipmentId}/customs/check |
| `document:download` | 1: GET /documents/{documentId}/download |
| `document:email` | 1: POST /shipments/{shipmentId}/documents/{documentId}/email |
| `document:read` | 1: GET /shipments/{shipmentId}/documents |
| `featureflag:manage` | 3: GET /admin/feature-flags; POST /admin/feature-flags; PATCH /admin/feature-flags/{flagKey} |
| `notification:read` | 2: GET /me/notifications; GET /me/notifications/{notificationId} |
| `notification_pref:manage` | 2: GET /me/notification-preferences; PUT /me/notification-preferences |
| `order:read` | 2: GET /orders; GET /orders/{orderId} |
| `org:member:invite` | 4: POST /organisations/{orgId}/invitations; GET /organisations/{orgId}/invitations; DELETE /organisations/{orgId}/invitations/{invitationId}; POST /organisations/{orgId}/invitations/{invitationId}/resend |
| `org:member:manage` | 2: PATCH /organisations/{orgId}/members/{membershipId}; DELETE /organisations/{orgId}/members/{membershipId} |
| `org:read` | 2: GET /organisations/{orgId}; GET /organisations/{orgId}/members |
| `org:update` | 1: PATCH /organisations/{orgId} |
| `payment:create` | 2: POST /orders/{orderId}/checkout; POST /payments/{paymentId}/confirm |
| `payment:read` | 2: GET /orders/{orderId}/payment; GET /payments/{paymentId} |
| `payment_method:manage` | 5: GET /me/payment-methods; POST /me/payment-method-setups; POST /me/payment-methods; PATCH /me/payment-methods/{paymentMethodId}; DELETE /me/payment-methods/{paymentMethodId} |
| `pickup:cancel` | 1: DELETE /shipments/{shipmentId}/pickup |
| `pickup:read` | 2: GET /shipments/{shipmentId}/pickup/availability; GET /shipments/{shipmentId}/pickup |
| `pickup:schedule` | 2: POST /shipments/{shipmentId}/pickup; PUT /shipments/{shipmentId}/pickup |
| `privacy:delete` | 1: POST /me/privacy/delete |
| `privacy:export` | 2: POST /me/privacy/export; GET /me/privacy/exports/{exportId}/download |
| `quote:create` | 2: POST /quotes/{quoteId}/claim; POST /quotes/{quoteId}/save |
| `quote:delete` | 1: DELETE /quotes/{quoteId} |
| `quote:read` | 1: GET /quotes |
| `quote:share` | 2: POST /quotes/{quoteId}/share; DELETE /quotes/{quoteId}/share |
| `session:manage` | 3: GET /me/sessions; DELETE /me/sessions/{sessionId}; DELETE /me/sessions |
| `shipment:cancel` | 1: POST /shipments/{shipmentId}/cancel |
| `shipment:create` | 12: POST /shipments; PATCH /shipments/{shipmentId}; DELETE /shipments/{shipmentId}; POST /shipments/{shipmentId}/repeat; POST /shipments/{shipmentId}/address-suggestions; GET /shipments/{shipmentId}/service-points; POST /shipments/{shipmentId}/tracking/refresh; POST /orders; POST /orders/{orderId}/shipments; DELETE /orders/{orderId}/shipments/{shipmentId}; PUT /orders/{orderId}/coupon; DELETE /orders/{orderId}/coupon |
| `shipment:read` | 7: GET /me/dashboard; GET /shipments; GET /shipments/{shipmentId}; GET /shipments/{shipmentId}/timeline; GET /shipments/{shipmentId}/customs; GET /orders/{orderId}/booking-progress; GET /orders/{orderId}/booking-progress/stream |
| `tracking:read` | 1: GET /shipments/{shipmentId}/tracking |
| `webhook:mock_gateway:receive` | 1: POST /webhooks/mock-gateway |
| `webhook:stripe:receive` | 1: POST /webhooks/stripe |

Notes:
- `shipment:create` covers draft creation and editing, orders, basket, coupon, repeat, address suggestions and service points (REQ-BOOK scope note: "create and edit drafts, book"). Orders have no `order:create` permission in the catalogue.
- `refreshShipmentTracking` declares `shipment:create`. A-074 requires `tracking:read` + `shipment:create`, and every seeded holder of `shipment:create` also holds `tracking:read`. Route metadata carries one permission, and the RBAC matrix test asserts the seed invariant.
- Catalogue permissions that no M1 route uses: `shipment:create:on_behalf`, `refund:approve`, `audit:export` (M2 seams).

---

## 15. Route metadata and OpenAPI drift test

**Goal (REQ-API-002, REQ-RBAC-005).** The set of mounted routes, the set of documented operations and the Joi schemas must be identical. The test fails naming every offending `METHOD path`.

**Inputs**

1. **Route registry.** `defineRoute({ operationId, method, path, permission, permissionAuthenticated?, audit, schema: { params, query, body, headers }, rateLimit, idempotency, tenancy, auth, reauth?, deprecated?, mfaGateExempt?, csrf?, transaction?, load?, call?, handler, afterCommit? })` registers each route in an in-process registry (`apps/api/src/platform/routing/route-registry.ts`, TASK-020 sheet; amended 2026-11-13) at mount time. `auth` is one credential kind or a set (ADR-0008 amendment 4); `transaction` is `tenant` (default) or `none`; a route that needs an external result adds `load`, `call` and `afterCommit` around `handler` (ADR-0003 amendment 2026-11-13, ADR-0005 amendment 11; TASK-020 part 020-C): the tx slot runs `load` in one read-only tenant transaction (a write fails with SQLSTATE 25006), `call` with no transaction, no database handle and an `AbortSignal` (request deadline, client disconnect; the deadline is enforced: at 20 s, or when the client already left, the slot stops waiting and answers a retryable 503 `SERVICE_UNAVAILABLE` with `Retry-After`, D-ORCH-069), `handler` plus the audit hook in the one write transaction (a result with both `body` and `stream` rolls it back), sends the result (a stream result is completed here, after COMMIT, under the same deadline), then schedules `afterCommit` once committed (its context carries an `AbortSignal` aborted at shutdown or at its 20 s deadline; at most 1 000 pending, above that dropped and logged as `api.after_commit_dropped`; logged as `api.after_commit_failed` on a throw, drained at shutdown). `defineRoute` refuses `load` without `call`, `load` or `call` on `transaction: none`, and a `schema.headers` that names a `CREDENTIAL_HEADER_NAMES` entry (`@platform/shared`; case-insensitive), except `x-quote-token` when `auth` is exactly `[session]` (D-ARCH-113, §8). The test builds the Express 5 app without listening, then:
   - reads the registry; and
   - walks the **composed** `createApp(...)` from `app.router` (recursively into mounted routers) to find every handler, resolving mounts only against the literal paths `/api/v1` and `/api/docs`. A handler not registered through `defineRoute` fails the test, which catches a raw `router.get`. `/api/docs` is the sole exclusion (the internal `/metrics` listener is not on this app). Any path-mounted non-router layer, array, optional-group or RegExp mount, or sub-app is reported as `unrecognised-route` (PR #21 R1-M1, R2-m1, R3-m1; D-ORCH-024 (4), D-ORCH-026). Rate limiters, CORS and Helmet are therefore mounted path-less, inside the target router or before `routes`, never under a path (D-ORCH-024 (5)).
2. **Contract.** `openapi.yaml` is parsed with `yaml` and bundled with Redocly (`@redocly/openapi-core` `bundle({ dereference: true })`). Paths get the server base path (`/api/v1`) except for operations with their own `servers` (health).

**Normalisation.** Express `:param` and OpenAPI `{param}` both become `{}`, so `GET /api/v1/shipments/{}` is the comparison key. Methods are upper-cased.

**Assertions**

| # | Assertion | Failure message example |
|---|---|---|
| 1 | Key sets are equal and counts match (`registry.length === operations.length`, currently **133**) | `Missing in openapi.yaml: POST /api/v1/foo`; `Documented but not mounted: GET /api/v1/bar` |
| 2 | `x-permission` equals `route.permission`. The value is in the `packages/authz` catalogue, or is `public`/`authenticated` with a non-empty `x-permission-justification`. No `x-permission-status: proposed` remains on `main`. | `PATCH /api/v1/shipments/{}: permission shipment:update not in catalogue` |
| 3 | `x-audit` deep-equals `route.audit` {action, entity, sensitivity, reasonRequired, additional}. `NONE` requires a justification (REQ-AUDIT-006). | `POST /api/v1/quotes/{}/share: audit additional UPDATE quote_share missing in route metadata` |
| 4 | `x-idempotency`, `x-rate-limit-class`, `x-rate-limit-route`, `x-tenancy`, `x-reauth-scope`, `x-reauth-max-age`, `x-mfa-gate-exempt`, `x-csrf` equal the metadata. `x-reauth-max-age` appears only with `x-reauth-scope`; a route with `x-reauth-scope` references `ReauthProof` (no max-age) or `ReauthProofConditional` (with max-age) and lists `REAUTH_REQUIRED`. | `POST /api/v1/organisations/{}/invitations: reauth maxAgeSeconds 43200 not in openapi.yaml` |
| 9 | One-time-secret routes (ADR-0014 amendments 1 and 4: `createQuote`, `createQuoteShare`, `enrolTotp`, `activateTotp`, `regenerateRecoveryCodes`) are `x-idempotency: not-applicable`, declare no `Idempotency-Key` parameter and no `Idempotent-Replayed` header (SEC-TC-53) | `POST /api/v1/quotes: one-time-secret route must be not-applicable` |
| 5 | Schema parity (header parameters the pipeline owns excluded; `X-Quote-Token` is excluded only where the operation's `security` lists `quoteToken`, and elsewhere `schema.headers` declares it exactly where the contract declares the `QuoteToken` parameter, D-ARCH-113): for path, query, headers and body, the Joi schema (`schema.describe()`) and the OpenAPI schema have the same property names, the same required set, closed objects on both sides (`unknown(false)` / `additionalProperties: false`), and the same enums, min/max, lengths and patterns. Implemented as an in-house comparator over `Joi.describe()` output; no new dependency. | `POST /api/v1/quotes body: Joi requires ship_date, OpenAPI does not` |
| 6 | Every `x-error-codes` entry exists in the error catalogue, and the operation has a response for its status. Every code the module's error factory can throw for that route (each module exports `routeErrors`) is a subset of `x-error-codes`. | `checkoutOrder can throw AMOUNT_MISMATCH but does not list it` |
| 7 | Every operation has a success response example, a request example when it has a body, `x-requirements`, `x-milestone` and `x-moscow` (REQ-API-002) | |
| 8 | `operationId` values are unique and camelCase. A deprecated operation has `x-sunset` (REQ-API-015). | |
| 10 | The excluded `/api/docs` mount answers only GET and HEAD (and OPTIONS 204) on the allow-listed docs paths; any other method is 405 `METHOD_NOT_ALLOWED` and any other path under it 404 (PR21-SEC-06 TASK-020 check; `allowedMethods` assertion over the composed app). Added 2026-11-13. | `POST /api/docs/openapi.yaml: expected 405 METHOD_NOT_ALLOWED, got 200`; `GET /api/docs/oauth2-redirect.html: expected 404 NOT_FOUND, got 200` |
| 11 | Pipeline order: the step-0 per-IP limiter (ADR-0016 am. 1) and the CORS preflight handler precede `optionsResponder` and the `/api/docs` mount (PR21-SEC-01 step 5, PR21-SEC-06). Added 2026-11-13. | `pipeline order: optionsResponder (index 3) precedes ipLimiter (index 5)` |
| 12 | Authentication parity (added 2026-11-13, D-ARCH-107): the set of the operation's effective `security` alternatives (`{}` = anonymous, `bearerAuth` = session, `refreshCookieWeb`/`refreshCookieAdmin` = refresh-cookie, `quoteToken` = quote-token, `*Signature` = signature) equals `route.auth`, and `x-permission-authenticated` equals `route.permissionAuthenticated` (present exactly on the dual-mode routes: permission `public` and `auth` `[anonymous, session]` or `[session, quote-token]`). `transaction: none` operations equal the pinned list. | `GET /api/v1/quotes/{}: auth [session] but security is [session, quote-token]`; `POST /api/v1/quotes: x-permission-authenticated quote:create not in route metadata` |

The same registry feeds the RBAC matrix generator (REQ-RBAC-011: route × seeded role, unauthenticated, cross-tenant) and the audit test generator (REQ-AUDIT-024). The OpenAPI `x-tenancy` value selects the cross-tenant case. The test runs in the unit stage (no database) as `npm run test:contract`.

---

## 16. Response-validation helper for Supertest (REQ-API-004)

`tests/api/helpers/` (`contract-validator.ts`, `expect-contract.ts`; *path as implemented in PR #21, D-TASK017-01 (1); amended 2026-11-13 — the earlier `tests/support/contract.ts` name is withdrawn*) exports `api(app)`, a thin wrapper around `supertest(app)`. Every request it makes is validated against the contract after the response arrives. A lint rule forbids importing `supertest` anywhere else in API tests, so no test can bypass validation.

1. **Setup (once per worker).** Bundle and dereference `openapi.yaml`, then compile with Ajv 2020 (`ajv/dist/2020`, strict mode, `allErrors`). The formats used by the contract (`date-time`, `date`, `uuid`, `email`, `uri`, `int64`) are registered in-house with `ajv.addFormat` in `tests/api/helpers/formats.ts`. Validators are cached per operation, status and media type.
2. **Operation resolution.** From the actual method and the matched Express route template (`req.route.path`, exposed through the `X-Route-Template` test-only response header, or through the registry lookup by method and path). Unknown operation: fail.
3. **Checks on every response**
   - The status is declared for the operation, or is a framework status (404 unknown route, 405).
   - `Content-Type` matches the declared media type (`application/json`, `application/problem+json`, `text/event-stream`). 204 and 304 have no body.
   - The body validates against the schema. All schemas are closed, so extra fields fail.
   - Declared headers are present: `X-Correlation-Id` always; `ETag` where declared; `RateLimit-*` on rate-limited classes; `Location` on 201; `Idempotent-Replayed: true` on a replay; `Retry-After` on 429 and on 409 `IDEMPOTENCY_IN_PROGRESS`.
   - Problem bodies: `code` is in the operation's `x-error-codes`, `status` equals the catalogue status, `type` equals `https://docs.<domain>/problems/<code>`, and 5xx `detail` is generic.
4. **SSE.** `expectEventStream(res)` parses the stream. It checks that ids increase strictly, every event name is in `x-sse-events` and its `data` validates against the referenced schema, the stream ends with `complete` or `error`, and the end-to-close interval is ≤ 1 s.
5. **Failure output.** Operation ID, status and Ajv errors with JSON pointers, plus a redacted body excerpt.
6. **Coverage report.** The helper records each (operationId, status) pair it sees. `npm run test:api` writes `reports/api-contract-coverage.json`, and CI lists documented but unexercised pairs. Unexercised success responses fail the run; unexercised error statuses are reported.

New test dependency (dev only): `ajv` 8 (MIT, last release 2026-04). Rejected: `ajv-formats` (no release since 2024-03, which breaks the 18-month maintenance rule in CLAUDE.md §5, so the formats are implemented in-house as above) and `jest-openapi` (last release 2022-05, no OpenAPI 3.1 support).

---

## 17. Frontend type generation (REQ-API-019)

- **Generator:** `openapi-typescript` 7 (MIT, 7.13.0, last release 2026-06; dev dependency): `npm run openapi:types` (= `tsx tools/openapi/types.ts`, which runs openapi-typescript on `docs/03-architecture/api/openapi.yaml` into `packages/shared/src/api/types.gen.ts` with `--alphabetize --immutable`; PR #21, D-TASK017-01) (path per ADR-0016 §1). The output is committed.
- **Client:** a typed wrapper over axios 1 (fixed stack) in `packages/shared/src/api/client.ts`, keyed by `paths` and `operations` from the generated file (`ApiRequest<'checkoutOrder'>`, `ApiResponse<'checkoutOrder', 201>`). It attaches the in-memory bearer token, `X-Correlation-Id` and `Idempotency-Key` (generated per user action and reused on retry for `x-idempotency` routes). It handles `ACCESS_TOKEN_EXPIRED` with a single-flight refresh, and maps problem `errors[]` pointers onto form fields (REQ-UI-010).
- **SSE client:** an in-house fetch + `ReadableStream` event parser (about 100 lines, `packages/shared/src/api/sse.ts`). It sends headers, which EventSource cannot, and needs no new dependency. Event payload types come from `components['schemas']['SseCarrierResult']` and so on.
- **Zod parity:** Zod 4 form schemas are hand-written from the `packages/shared` constants (REQ-SEC-008). A type test (`tsd`-style `satisfies`) asserts that `z.infer<>` of each request schema is assignable to the generated request type.
- **CI gate:** `npm run openapi:types` regenerates the file and `git diff --exit-code packages/shared/src/api/types.gen.ts` fails when the contract changed without regenerated types.

---

## 18. Contract change process

1. Change `openapi.yaml` in the same PR as the route, Joi schema and tests (contract first).
2. Run `npm run openapi:lint` (0 errors), the drift and contract tests (`tools/openapi`, unit lane; the `npm run test:contract` alias runs both) and the error-catalogue parity test `tests/generated/error-catalogue.test.ts` (unit lane), `npm run openapi:types`.
3. In CI, `oasdiff breaking` against the previous release tag must report no breaking changes on `/api/v1`. A breaking change needs a superseding ADR and the deprecation mechanism in §1.
4. New error codes go into the `packages/shared` catalogue first. Codes are never renamed or reused.
5. New permissions go into the `packages/authz` catalogue first (REQ-RBAC-001). The seed matrix and the RBAC matrix test update automatically.

---

## Lint status

`npm run openapi:lint`: **valid, 0 errors, 8 warnings** (re-run 2026-11-12 after the SEC-P3-01/02/10/11/14 amendments and again after the G2-C3 amendments SEC-P3-28/29/30/32/33; 133 operations; the warning set is unchanged). Examples were also validated with a stricter scratch config (`recommended-strict` + `no-invalid-media-type-examples` with `allowAdditionalProperties: false`), and every example conforms; that run reports only the same 8 findings, raised to errors by the strict preset.

| Warnings | Rule | Reason accepted |
|---|---|---|
| 1 | `no-server-example.com` | The local server `http://localhost:3000/api/v1` is required for compose and Swagger UI. |
| 2 | `operation-4xx-response` | `/health/live` and `/health/ready` have no 4xx by design (probes, not rate-limited). |
| 5 | `no-unused-components` | `SseCarrierResult`, `SseCarrierError`, `SseComplete`, `SseError`, `SseStepUpdate` are referenced only from `x-sse-events`. OpenAPI 3.1 has no item schema for `text/event-stream`. |

---

## Appendix: operation index

Total: 133

| Tag | Operations |
|---|---|
| identity | 18 |
| me | 10 |
| organisations | 17 |
| reference | 13 |
| compliance | 3 |
| quotes | 10 |
| shipments | 9 |
| customs | 3 |
| documents | 3 |
| pickups | 6 |
| tracking | 4 |
| orders | 11 |
| payments | 7 |
| notifications | 4 |
| carriers | 1 |
| audit | 4 |
| feature-flags | 4 |
| security | 1 |
| webhooks | 3 |
| health | 2 |

| Method | Path | operationId | x-permission | x-audit | x-idempotency | x-rate-limit-class | x-tenancy | MS | MoSCoW |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/auth/register` | registerUser | `public` | CREATE user (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/verify-email` | verifyEmail | `public` | UPDATE user (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/resend-verification` | resendVerificationEmail | `public` | CREATE email_verification_token (NORMAL) | not-applicable | email-send | user | M0 | Must |
| POST | `/auth/login` | loginUser | `public` | LOGIN session (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/mfa/challenge` | completeMfaChallenge | `public` | LOGIN session (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/refresh` | refreshSession | `public` | UPDATE session (SENSITIVE) | not-applicable | public | user | M0 | Must |
| POST | `/auth/logout` | logoutSession | `public` | LOGOUT session (SENSITIVE) | not-applicable | public | user | M0 | Must |
| GET | `/auth/csrf` | getCsrfToken | `public` | NONE | not-applicable | public | user | M0 | Must |
| POST | `/auth/password/forgot` | requestPasswordReset | `public` | CREATE password_reset_token (NORMAL) | not-applicable | email-send | user | M0 | Must |
| POST | `/auth/password/reset` | resetPassword | `public` | UPDATE user_credential (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/password/change` | changePassword | `authenticated` | UPDATE user_credential (SENSITIVE) | not-applicable | auth | user | M1 | Should |
| POST | `/auth/reauth` | createReauthProof | `authenticated` | CREATE reauth_proof (NORMAL) | not-applicable | auth | user | M1 | Should |
| POST | `/auth/switch-organisation` | switchOrganisation | `authenticated` | UPDATE session (SENSITIVE) | not-applicable | authenticated | user | M1 | Should |
| POST | `/auth/mfa/totp/enrolment-code` | requestTotpEnrolmentCode | `authenticated` | CREATE mfa_enrolment_code (NORMAL) | not-applicable | email-send | user | M0 | Must |
| POST | `/auth/mfa/totp/enrol` | enrolTotp | `authenticated` | CREATE mfa_enrolment (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/mfa/totp/activate` | activateTotp | `authenticated` | MFA_ENROLLED user_mfa (SENSITIVE) | not-applicable | auth | user | M0 | Must |
| POST | `/auth/mfa/totp/disable` | disableTotp | `authenticated` | UPDATE user_mfa (SENSITIVE) | not-applicable | auth | user | M1 | Should |
| POST | `/auth/mfa/recovery-codes/regenerate` | regenerateRecoveryCodes | `authenticated` | UPDATE recovery_codes (SENSITIVE) | not-applicable | auth | user | M1 | Should |
| GET | `/me` | getMe | `authenticated` | VIEW user (SENSITIVE) | not-applicable | authenticated | user | M0 | Must |
| PATCH | `/me` | updateMe | `authenticated` | UPDATE user (SENSITIVE) | optional | authenticated | user | M1 | Should |
| GET | `/me/organisations` | listMyOrganisations | `authenticated` | VIEW membership (SENSITIVE) | not-applicable | authenticated | user | M1 | Should |
| GET | `/me/sessions` | listMySessions | `session:manage` | VIEW session (SENSITIVE) | not-applicable | authenticated | user | M1 | Should |
| DELETE | `/me/sessions/{sessionId}` | revokeMySession | `session:manage` | DELETE session (SENSITIVE) | optional | authenticated | user | M1 | Should |
| DELETE | `/me/sessions` | revokeOtherSessions | `session:manage` | DELETE session (SENSITIVE) | optional | authenticated | user | M1 | Should |
| GET | `/me/dashboard` | getDashboard | `shipment:read` | VIEW dashboard (NORMAL) | not-applicable | authenticated | tenant | M1 | Should |
| POST | `/me/privacy/export` | requestPrivacyExport | `privacy:export` | CREATE privacy_export (SENSITIVE) | optional | authenticated | user | M1 | Could |
| GET | `/me/privacy/exports/{exportId}/download` | downloadPrivacyExport | `privacy:export` | DOWNLOAD privacy_export (SENSITIVE) | not-applicable | authenticated | user | M1 | Could |
| POST | `/me/privacy/delete` | requestAccountDeletion | `privacy:delete` | DELETE user (SENSITIVE) | optional | authenticated | user | M1 | Could |
| POST | `/organisations` | createOrganisation | `authenticated` | CREATE organisation (SENSITIVE) | optional | authenticated | user | M1 | Should |
| GET | `/organisations/{orgId}` | getOrganisation | `org:read` | VIEW organisation (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| PATCH | `/organisations/{orgId}` | updateOrganisation | `org:update` | UPDATE organisation (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| GET | `/organisations/{orgId}/members` | listMembers | `org:read` | VIEW membership (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| PATCH | `/organisations/{orgId}/members/{membershipId}` | updateMember | `org:member:manage` | UPDATE membership (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| DELETE | `/organisations/{orgId}/members/{membershipId}` | removeMember | `org:member:manage` | DELETE membership (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| POST | `/organisations/{orgId}/invitations` | createInvitation | `org:member:invite` | CREATE invitation (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| GET | `/organisations/{orgId}/invitations` | listInvitations | `org:member:invite` | VIEW invitation (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| DELETE | `/organisations/{orgId}/invitations/{invitationId}` | revokeInvitation | `org:member:invite` | DELETE invitation (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| POST | `/organisations/{orgId}/invitations/{invitationId}/resend` | resendInvitation | `org:member:invite` | UPDATE invitation (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| POST | `/invitations/accept` | acceptInvitation | `authenticated` | CREATE membership (SENSITIVE) | optional | authenticated | user | M1 | Should |
| GET | `/organisations/{orgId}/address-book` | listAddressBookEntries | `address_book:read` | VIEW address_book_entry (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| POST | `/organisations/{orgId}/address-book` | createAddressBookEntry | `address_book:manage` | CREATE address_book_entry (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| GET | `/organisations/{orgId}/address-book/{entryId}` | getAddressBookEntry | `address_book:read` | VIEW address_book_entry (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| PUT | `/organisations/{orgId}/address-book/{entryId}` | replaceAddressBookEntry | `address_book:manage` | UPDATE address_book_entry (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| DELETE | `/organisations/{orgId}/address-book/{entryId}` | deleteAddressBookEntry | `address_book:manage` | DELETE address_book_entry (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| POST | `/organisations/{orgId}/address-book/import` | importAddressBookEntries | `address_book:manage` | CREATE address_book_entry (SENSITIVE) | optional | authenticated | tenant | M1 | Could |
| GET | `/reference/countries` | listCountries | `public` | NONE | not-applicable | public | public | M0 | Must |
| GET | `/reference/currencies` | listCurrencies | `public` | NONE | not-applicable | public | public | M0 | Must |
| GET | `/reference/fx-rates` | listFxRates | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/incoterms` | listIncoterms | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/export-reasons` | listExportReasons | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/carriers` | listCarriers | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/countries/{countryCode}` | getCountry | `public` | NONE | not-applicable | public | public | M0 | Must |
| GET | `/reference/countries/{countryCode}/subdivisions` | listSubdivisions | `public` | NONE | not-applicable | public | public | M0 | Must |
| GET | `/reference/fx-rates/convert` | convertCurrency | `public` | NONE | not-applicable | public | public | M1 | Could |
| GET | `/reference/hs-codes` | searchHsCodes | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/prohibited-items` | listProhibitedItems | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/holidays` | listHolidays | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/reference/volumetric` | calculateVolumetricWeight | `public` | NONE | not-applicable | public | public | M1 | Could |
| GET | `/compliance/packs/{packCountry}` | getCompliancePack | `public` | NONE | not-applicable | public | public | M1 | Must |
| GET | `/compliance/legal/{packCountry}/{legalDocument}` | getLegalDocument | `public` | NONE | not-applicable | public | public | M1 | Should |
| POST | `/consents` | recordConsent | `public` | CREATE consent_record (NORMAL) | optional | public | public | M1 | Should |
| POST | `/quotes` | createQuote | `public` | CREATE quote (SENSITIVE) | not-applicable | public-quote | guest | M0 | Must |
| GET | `/quotes` | listSavedQuotes | `quote:read` | VIEW quote (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| GET | `/quotes/{quoteId}` | getQuote | `public` | VIEW quote (SENSITIVE) | not-applicable | public | guest | M0 | Must |
| GET | `/quotes/{quoteId}/stream` | streamQuoteResults | `public` | VIEW quote (SENSITIVE) | not-applicable | public | guest | M1 | Must |
| POST | `/quotes/{quoteId}/claim` | claimQuote | `quote:create` | UPDATE quote (SENSITIVE) | optional | authenticated | tenant | M1 | Must |
| POST | `/quotes/{quoteId}/save` | saveQuote | `quote:create` | UPDATE quote (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| DELETE | `/quotes/{quoteId}` | deleteSavedQuote | `quote:delete` | DELETE quote (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| POST | `/quotes/{quoteId}/share` | createQuoteShare | `quote:share` | CREATE quote_share (NORMAL) | not-applicable | authenticated | tenant | M1 | Should |
| DELETE | `/quotes/{quoteId}/share` | revokeQuoteShare | `quote:share` | DELETE quote_share (NORMAL) | optional | authenticated | tenant | M1 | Should |
| POST | `/public/shared-quotes/resolve` | resolveSharedQuote | `public` | VIEW quote_share (NORMAL) | not-applicable | public | public | M1 | Should |
| POST | `/shipments` | createShipment | `shipment:create` | CREATE shipment (SENSITIVE) | optional | authenticated | tenant | M0 | Must |
| GET | `/shipments` | listShipments | `shipment:read` | VIEW shipment (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/shipments/{shipmentId}` | getShipment | `shipment:read` | VIEW shipment (SENSITIVE) | not-applicable | authenticated | tenant | M0 | Must |
| PATCH | `/shipments/{shipmentId}` | updateShipment | `shipment:create` | UPDATE shipment (SENSITIVE) | optional | authenticated | tenant | M1 | Must |
| DELETE | `/shipments/{shipmentId}` | deleteDraftShipment | `shipment:create` | STATE_TRANSITION shipment (SENSITIVE) | optional | authenticated | tenant | M1 | Must |
| POST | `/shipments/{shipmentId}/cancel` | cancelShipment | `shipment:cancel` | STATE_TRANSITION shipment (SENSITIVE) | required | authenticated | tenant | M1 | Should |
| GET | `/shipments/{shipmentId}/timeline` | listShipmentTransitions | `shipment:read` | VIEW shipment_transition (NORMAL) | not-applicable | authenticated | tenant | M1 | Must |
| POST | `/shipments/{shipmentId}/repeat` | repeatShipment | `shipment:create` | CREATE shipment (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| POST | `/shipments/{shipmentId}/address-suggestions` | suggestShipmentAddress | `shipment:create` | VIEW shipment (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Should |
| GET | `/shipments/{shipmentId}/customs` | getShipmentCustoms | `shipment:read` | VIEW customs (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| PUT | `/shipments/{shipmentId}/customs` | replaceShipmentCustoms | `customs:manage` | UPDATE shipment (SENSITIVE) | optional | authenticated | tenant | M1 | Must |
| POST | `/shipments/{shipmentId}/customs/check` | checkShipmentCustoms | `customs:manage` | VIEW customs (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/shipments/{shipmentId}/documents` | listShipmentDocuments | `document:read` | VIEW document (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| POST | `/shipments/{shipmentId}/documents/{documentId}/email` | emailShipmentDocuments | `document:email` | DOWNLOAD document (SENSITIVE) | optional | authenticated | tenant | M1 | Should |
| GET | `/documents/{documentId}/download` | getDocumentDownloadUrl | `document:download` | DOWNLOAD document (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/shipments/{shipmentId}/pickup/availability` | getPickupAvailability | `pickup:read` | VIEW pickup_availability (NORMAL) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/shipments/{shipmentId}/pickup` | getShipmentPickup | `pickup:read` | VIEW pickup (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| POST | `/shipments/{shipmentId}/pickup` | schedulePickup | `pickup:schedule` | CREATE pickup (SENSITIVE) | required | authenticated | tenant | M1 | Must |
| PUT | `/shipments/{shipmentId}/pickup` | reschedulePickup | `pickup:schedule` | UPDATE pickup (SENSITIVE) | required | authenticated | tenant | M1 | Should |
| DELETE | `/shipments/{shipmentId}/pickup` | cancelPickup | `pickup:cancel` | UPDATE pickup (SENSITIVE) | optional | authenticated | tenant | M1 | Must |
| GET | `/shipments/{shipmentId}/service-points` | listServicePoints | `shipment:create` | VIEW service_point (NORMAL) | not-applicable | authenticated | tenant | M1 | Should |
| GET | `/shipments/{shipmentId}/tracking` | getShipmentTracking | `tracking:read` | VIEW shipment_tracking (SENSITIVE) | not-applicable | authenticated | tenant | M1 | Must |
| POST | `/shipments/{shipmentId}/tracking/refresh` | refreshShipmentTracking | `shipment:create` | UPDATE shipment_tracking (NORMAL) | optional | authenticated | tenant | M1 | Could |
| GET | `/public/tracking` | getPublicTracking | `public` | VIEW shipment_tracking (NORMAL) | not-applicable | public-tracking | public | M1 | Must |
| POST | `/public/tracking/lookup` | lookupPublicTracking | `public` | VIEW shipment_tracking (NORMAL) | not-applicable | public-tracking | public | M1 | Should |
| POST | `/orders` | createOrder | `shipment:create` | CREATE order (NORMAL) | required | authenticated | tenant | M0 | Must |
| GET | `/orders` | listOrders | `order:read` | VIEW order (NORMAL) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/orders/{orderId}` | getOrder | `order:read` | VIEW order (NORMAL) | not-applicable | authenticated | tenant | M0 | Must |
| POST | `/orders/{orderId}/shipments` | addOrderShipment | `shipment:create` | UPDATE order (NORMAL) | optional | authenticated | tenant | M1 | Should |
| DELETE | `/orders/{orderId}/shipments/{shipmentId}` | removeOrderShipment | `shipment:create` | UPDATE order (NORMAL) | optional | authenticated | tenant | M1 | Should |
| PUT | `/orders/{orderId}/coupon` | applyOrderCoupon | `shipment:create` | UPDATE order (NORMAL) | optional | authenticated | tenant | M1 | Should |
| DELETE | `/orders/{orderId}/coupon` | removeOrderCoupon | `shipment:create` | UPDATE order (NORMAL) | optional | authenticated | tenant | M1 | Should |
| POST | `/orders/{orderId}/checkout` | checkoutOrder | `payment:create` | CREATE payment (NORMAL) | required | authenticated | tenant | M0 | Must |
| GET | `/orders/{orderId}/payment` | getOrderPayment | `payment:read` | VIEW payment (NORMAL) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/orders/{orderId}/booking-progress` | getBookingProgress | `shipment:read` | VIEW booking_progress (NORMAL) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/orders/{orderId}/booking-progress/stream` | streamBookingProgress | `shipment:read` | VIEW booking_progress (NORMAL) | not-applicable | authenticated | tenant | M1 | Must |
| GET | `/payments/{paymentId}` | getPayment | `payment:read` | VIEW payment (NORMAL) | not-applicable | authenticated | tenant | M0 | Must |
| POST | `/payments/{paymentId}/confirm` | confirmPayment | `payment:create` | UPDATE payment (NORMAL) | required | authenticated | tenant | M1 | Must |
| GET | `/me/payment-methods` | listPaymentMethods | `payment_method:manage` | VIEW payment_method (SENSITIVE) | not-applicable | authenticated | user | M1 | Should |
| POST | `/me/payment-method-setups` | createPaymentMethodSetup | `payment_method:manage` | CREATE payment_method_setup (NORMAL) | optional | authenticated | user | M1 | Should |
| POST | `/me/payment-methods` | createPaymentMethod | `payment_method:manage` | CREATE payment_method (SENSITIVE) | optional | authenticated | user | M1 | Should |
| PATCH | `/me/payment-methods/{paymentMethodId}` | updatePaymentMethod | `payment_method:manage` | UPDATE payment_method (SENSITIVE) | optional | authenticated | user | M1 | Should |
| DELETE | `/me/payment-methods/{paymentMethodId}` | deletePaymentMethod | `payment_method:manage` | DELETE payment_method (SENSITIVE) | optional | authenticated | user | M1 | Should |
| GET | `/me/notification-preferences` | getNotificationPreferences | `notification_pref:manage` | VIEW notification_preferences (NORMAL) | not-applicable | authenticated | user | M1 | Should |
| PUT | `/me/notification-preferences` | replaceNotificationPreferences | `notification_pref:manage` | UPDATE notification_preferences (NORMAL) | optional | authenticated | user | M1 | Should |
| GET | `/me/notifications` | listMyNotifications | `notification:read` | VIEW notification (SENSITIVE) | not-applicable | authenticated | user | M1 | Should |
| GET | `/me/notifications/{notificationId}` | getMyNotification | `notification:read` | VIEW notification (SENSITIVE) | not-applicable | authenticated | user | M1 | Should |
| GET | `/carriers/status` | listCarrierStatuses | `carrier:status:read` | VIEW carrier_account (NORMAL) | not-applicable | authenticated | operator-cross-tenant | M1 | Must |
| GET | `/audit/entries` | listAuditEntries | `audit:read` | VIEW audit_entry (SENSITIVE) | not-applicable | authenticated | operator-cross-tenant | M0 | Must |
| GET | `/audit/entries/{auditEntryId}` | getAuditEntry | `audit:read` | VIEW audit_entry (SENSITIVE) | not-applicable | authenticated | operator-cross-tenant | M0 | Must |
| GET | `/audit/entities/{entityName}/{entityId}/history` | listEntityAuditHistory | `audit:read` | VIEW audit_entry (SENSITIVE) | not-applicable | authenticated | operator-cross-tenant | M1 | Should |
| GET | `/audit/chain/status` | getAuditChainStatus | `audit:read` | VIEW audit_chain_verification (NORMAL) | not-applicable | authenticated | operator-cross-tenant | M0 | Must |
| GET | `/feature-flags` | evaluateFeatureFlags | `authenticated` | VIEW feature_flag (NORMAL) | not-applicable | authenticated | tenant | M0 | Should |
| GET | `/admin/feature-flags` | listFeatureFlags | `featureflag:manage` | VIEW feature_flag (NORMAL) | not-applicable | authenticated | operator-cross-tenant | M0 | Should |
| POST | `/admin/feature-flags` | createFeatureFlag | `featureflag:manage` | CONFIG_CHANGE feature_flag (NORMAL) | optional | authenticated | operator-cross-tenant | M0 | Should |
| PATCH | `/admin/feature-flags/{flagKey}` | updateFeatureFlag | `featureflag:manage` | CONFIG_CHANGE feature_flag (NORMAL) | optional | authenticated | operator-cross-tenant | M0 | Should |
| POST | `/security/csp-report` | reportCspViolation | `public` | NONE | not-applicable | csp-report | public | M0 | Must |
| POST | `/webhooks/stripe` | receiveStripeWebhook | `webhook:stripe:receive` | CREATE webhook_event (NORMAL) | not-applicable | webhook | public | M1 | Must |
| POST | `/webhooks/mock-gateway` | receiveMockGatewayWebhook | `webhook:mock_gateway:receive` | CREATE webhook_event (NORMAL) | not-applicable | webhook | public | M0 | Must |
| POST | `/webhooks/carriers/{carrierCode}` | receiveCarrierPush | `public` | CREATE tracking_push (NORMAL) | not-applicable | webhook | public | M1 | Should |
| GET | `/health/live` | getLiveness | `public` | NONE | not-applicable | none | public | M0 | Must |
| GET | `/health/ready` | getReadiness | `public` | NONE | not-applicable | none | public | M0 | Must |
