# EPIC-16 — API conventions and security controls

- **Goal:** Every endpoint of the platform follows one documented, tested contract (errors, pagination, idempotency, concurrency, rate limits, streaming) and every request, build and dependency passes a baseline of security controls (OWASP ASVS L2).
- **Milestone(s):** M0 (all but one story) + M1 (parity test in US-046)
- **REQ areas covered:** REQ-API, REQ-SEC (every REQ in these areas is linked below)
- **Exit-demo contribution:** PRD §6.1 "problem+json errors", "replaying the same request with the same Idempotency-Key returns the same order", CI skeleton running security scans; PRD §6.2 rate-shopping stream (SSE convention), quote/booking idempotency.
- **Depends on epics:** EPIC-01 (error handler, config, logging, CI), EPIC-02 (authentication, CSRF-protected endpoints), EPIC-03 (route metadata and permissions), EPIC-04 (audit of denied/failed outcomes), EPIC-08 (rate-stream endpoint consuming US-042)

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-034 | Contract-first OpenAPI 3.1 with CI cross-check and response validation | M0 | Must | M | EPIC-01, EPIC-03 | REQ-API-001, REQ-API-002, REQ-API-004 | DC |
| US-035 | API docs UI, generated client, deprecation headers and ApiMode seam | M0 | Should | M | US-034 | REQ-API-003, REQ-API-015, REQ-API-019, REQ-API-020 |  |
| US-036 | Error catalogue and validation error format | M0 | Must | M | US-034, US-007 | REQ-API-005, REQ-API-006 |  |
| US-037 | Cursor pagination, filtering and sorting | M0 | Must | M | US-036 | REQ-API-007, REQ-API-008 |  |
| US-038 | Idempotency keys | M0 | Must | M | US-036, EPIC-03 | REQ-API-009, REQ-API-010, REQ-API-011 | DC |
| US-039 | ETags and optimistic concurrency | M0 | Must | M | US-036 | REQ-API-012, REQ-API-013 |  |
| US-040 | Redis-backed rate limiting and headers | M0 | Must | M | US-036 | REQ-API-014, REQ-SEC-005, REQ-SEC-006 |  |
| US-041 | Data representation rules | M0 | Must | S | US-034 | REQ-API-016 |  |
| US-042 | Server-sent events convention | M0 | Must | M | US-036 | REQ-API-017, REQ-API-018 | DC |
| US-043 | Security headers, HSTS and Content-Security-Policy | M0 | Must | M | EPIC-01 | REQ-SEC-001, REQ-SEC-002, REQ-SEC-003 |  |
| US-044 | CSRF protection and CORS allow-list | M0 | Must | M | US-036, EPIC-02 | REQ-SEC-004, REQ-SEC-014 |  |
| US-045 | Input hardening: unknown fields, body size, content types, timeouts | M0 | Must | M | US-036 | REQ-SEC-007, REQ-SEC-015 |  |
| US-046 | Static safeguards: parameterised SQL, HTML-injection lint and Joi/Zod parity | M0 | Must | M | EPIC-01 | REQ-SEC-008, REQ-SEC-009, REQ-SEC-016 |  |
| US-047 | SSRF-safe outbound client and security events | M0 | Must | M | US-008, EPIC-04 | REQ-SEC-010, REQ-SEC-012 |  |
| US-048 | Secrets hygiene and CI security scanning | M0 | Must | M | EPIC-01 | REQ-SEC-011, REQ-SEC-013 |  |

## Stories

### US-034 — Contract-first OpenAPI 3.1 with CI cross-check and response validation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01, EPIC-03
- **Linked REQs:** REQ-API-001, REQ-API-002, REQ-API-004
- **As a** developer **I want** one OpenAPI document that CI proves matches the mounted routes and every API test response **so that** the contract can never drift from behaviour.
- **Notes:** All business endpoints under `/api/v1`; health outside. Each operation names its permission and idempotency requirement through extensions, lists error codes and has request/response examples. Cross-check set: document, route metadata (REQ-RBAC-005) and Joi schemas. Shared Supertest helper validates status, headers and body (including problem+json).

#### Acceptance criteria
Permission path: not applicable — build and test tooling with no principal; a second negative scenario is included.
```gherkin
Feature: Contract-first OpenAPI 3.1 with CI cross-check and response validation
  Scenario: Consistent contract passes
    Given every mounted route is documented and every documented operation is implemented
    When the contract check runs in CI
    Then it passes and the OpenAPI lint reports no errors

  Scenario Outline: Contract drift fails CI
    Given "<drift>"
    When the contract check runs
    Then it exits non-zero naming the path and method
    Examples:
      | drift                                              |
      | a mounted route is missing from the document       |
      | a documented operation has no implementation       |
      | an operation lacks a request or response example   |
      | an operation lacks its list of error codes         |
      | an operation lacks its permission extension        |

  Scenario: Version prefix
    When GET /api/v2/anything is called
    Then the response is 404 NOT_FOUND problem+json
    And GET /health/live is reachable without the prefix

  Scenario: Response deviating from the contract fails the test
    Given an endpoint returns an extra header-less 201 where the document says 200
    When the Supertest helper validates the response
    Then the API test fails with the deviation described

  Scenario: Problem+json bodies are validated too
    When a 404 test response lacks the "code" member
    Then the helper fails the test
```

### US-035 — API docs UI, generated client, deprecation headers and ApiMode seam
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-034
- **Linked REQs:** REQ-API-003, REQ-API-015, REQ-API-019, REQ-API-020
- **As a** frontend developer **I want** browsable docs, a generated typed client and standard deprecation signalling **so that** integration is fast and breaking changes are announced.
- **Notes:** Swagger UI at `/api/docs` is on by default in local and test; staging and production opt in with `DOCS_ENABLED=true` (a production opt-in carries the PR21-SEC-02 conditions: cookieless docs origin, try-it-out off, `validatorUrl` null); wording aligned to the `DOCS_ENABLED` default by D-064 (D-ARCH-083, PR21-SEC-03), no scope change; public, descriptor `NONE` "API documentation". No deprecated route exists in this run; fixture only. ApiMode is `test` for every non-production request; seam only (keys are M3).

#### Acceptance criteria
```gherkin
Feature: API docs UI, generated client, deprecation headers and ApiMode seam
  Scenario: Docs enabled by configuration
    Given DOCS_ENABLED is true in the test environment
    When GET /api/docs is requested without authentication
    Then Swagger UI renders the current OpenAPI document

  Scenario: Docs off in production
    Given APP_ENV=production and DOCS_ENABLED unset
    Then GET /api/docs returns 404 NOT_FOUND

  Scenario: Stale generated client fails CI
    Given the OpenAPI document changed and the generated client was not regenerated
    When CI runs the client-drift check
    Then the run fails listing the changed files

  Scenario: Deprecated fixture operation carries headers
    Given a fixture operation marked deprecated with sunset 2027-06-30
    When it is called
    Then the response has Deprecation, Sunset and Link rel="deprecation" headers

  Scenario: Deprecated operation without sunset date fails the contract test
    Then the contract test exits non-zero

  Scenario: ApiMode is test in non-production
    When any request is handled in staging
    Then the request context ApiMode is "test"
```

### US-036 — Error catalogue and validation error format
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-034, US-007
- **Linked REQs:** REQ-API-005, REQ-API-006
- **As a** frontend developer **I want** a published catalogue of stable error codes and field-level validation errors **so that** the apps can show precise, localised messages.
- **Notes:** Catalogue (DR-A26) lives in packages/shared and is emitted into OpenAPI. Pointers address `/body/...`, `/query/...`, `/path/...`. Maximum 50 items. Codes are never reused for another meaning. UI mapping is REQ-UI-010.

#### Acceptance criteria
```gherkin
Feature: Error catalogue and validation error format
  Scenario: Errors are problem+json with derived type
    When any endpoint fails with 409 CONFLICT
    Then Content-Type is application/problem+json
    And code is "CONFLICT" and type is a URI derived from the code and documented in OpenAPI

  Scenario: All validation failures are reported
    When POST body has an invalid email, an empty name and limit=0 in the query
    Then the response is 400 VALIDATION_ERROR with errors containing "/body/email", "/body/name" and "/query/limit"
    And each item has a pointer, a stable sub-code and a message

  Scenario: Error list is capped
    When a request has 80 invalid fields
    Then the errors array contains exactly 50 items

  Scenario: Uncatalogued error fails the test suite
    Given a service throws an error with code "MY_NEW_ERROR" not in the catalogue
    When the catalogue test runs
    Then it fails naming the code

  Scenario: Catalogue is complete and stable
    Then every DR-A26 code with its status is present
    And a test fails when a published code's status changes

  Scenario: Permission-denied errors use the catalogue
    When a user without permission calls a protected route
    Then the response is 403 AUTHZ_DENIED in the same format and a PERMISSION_DENIED audit entry with outcome DENIED is written
```

### US-037 — Cursor pagination, filtering and sorting
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036
- **Linked REQs:** REQ-API-007, REQ-API-008
- **As a** frontend developer **I want** consistent cursor pagination, filters and sorts **so that** every list screen behaves the same and queries stay efficient.
- **Notes:** `limit` default 25, max 100 (audit viewer 50/200 per DR-A21); bounded global reference lists (countries, subdivisions, currencies, Incoterms, export reasons, holidays) may declare `x-max-limit` ≤ 300 so the full set fits one cacheable page; tenant lists never may (D-041, ADR-0016 amendment 5(d)). `next_cursor`, `has_more`; stable order with row ID tie-breaker; totals only when `include_total=true`. Filters `filter[field]=value`; sort `sort=field,-field`; allow-listed indexed fields only; multiple filters AND.

#### Acceptance criteria
Permission path: not applicable — shared list convention with no route of its own; the scenario "Cursor cannot cross tenants" covers the equivalent isolation check and route-level permissions are tested per list endpoint.
```gherkin
Feature: Cursor pagination, filtering and sorting
  Scenario: First page and next page
    Given 60 records visible to the caller
    When GET list with no parameters then with the returned cursor
    Then the first page has 25 items, has_more true and a next_cursor
    And the second page continues without overlap or gaps

  Scenario: Equal sort keys are stable
    Given 30 records with the same created_at
    Then paging through them returns each exactly once, ordered by ID tie-breaker

  Scenario Outline: Invalid pagination input
    When the request has "<input>"
    Then the response is 400 "<code>"
    Examples:
      | input              | code             |
      | limit=101          | VALIDATION_ERROR |
      | limit=0            | VALIDATION_ERROR |
      | cursor=tampered    | INVALID_CURSOR   |
      | cursor=expired     | INVALID_CURSOR   |

  Scenario Outline: Filter and sort allow-lists
    When the request has "<param>"
    Then the response is 400 "<code>"
    Examples:
      | param                      | code           |
      | filter[internal_notes]=x   | INVALID_FILTER |
      | sort=password_hash         | INVALID_SORT   |

  Scenario: Filters combine with AND and sort applies
    When filter[status]=BOOKED&filter[country]=IN&sort=-created_at
    Then only records matching both are returned newest first

  Scenario: Totals are opt-in
    Then the response has no total unless include_total=true is documented for the route

  Scenario: Bounded reference list allows a larger page
    Given GET /api/v1/reference/countries declares x-max-limit 300
    When limit=300 is requested
    Then the response is 200 with every enabled country in one page and has_more false
    And limit=301 returns 400 VALIDATION_ERROR

  Scenario: Tenant lists cannot raise the cap
    Given a tenant list route declares x-max-limit
    When the contract test runs
    Then it fails naming the route

  Scenario: List route without pagination fails the contract test
    Given a list route lacking limit and cursor parameters
    Then the contract test fails

  Scenario: Cursor cannot cross tenants
    Given a cursor issued to org A
    When org B presents it
    Then the response is 400 INVALID_CURSOR
```

### US-038 — Idempotency keys
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036, EPIC-03
- **Linked REQs:** REQ-API-009, REQ-API-010, REQ-API-011
- **As a** customer or integrator **I want** safe retries of booking and other unsafe operations **so that** a flaky connection never creates a duplicate order or charge.
- **Notes:** Header 1-255 printable ASCII; stored 24 h with SHA-256 request fingerprint, scoped by org, actor, method, path. Required on operations that create orders, payments or bookings. Authentication endpoints not-applicable. 5xx and 429 are not stored. Keys are server-side records, outside the audit chain (DR-A-IETF draft, GAP-A-18). Audit (D-PM-081; REQ-AUDIT-010 as amended): the refusals of the key protocol that precede the handler write no audit entry and are logged only, with code and correlation ID and never the key value. These are 409 IDEMPOTENCY_IN_PROGRESS, 422 IDEMPOTENCY_KEY_REUSED and a retry whose stored response cannot be read back (500, with an ERROR-level operational event). A new request whose claim fails because the key store fails is a 5xx and writes the FAILED entry of any other 5xx. A 4xx is replayed whether the handler returned it or raised it; the scenario "4xx responses are replayed" (AT-US-038-07) stands as written. Delivery split (D-PM-082; TASK-040 code review m1 and m2): TASK-040 is delivered in two parts and does not complete this story with the first. Part 040-A proves the mechanism through the real pipeline slots in a test composition, on fixture routes: AT-US-038-02 to -09, and of AT-US-038-01 the same status and body, the replay header, one handler run and no second audit entry. Part 040-B completes the story: the key store is wired into the production composition, AT-US-038-01 is proven there on a route that writes a row and publishes an event (after the replay: one row, one audit entry, one outbox event), the rate-limit half of AT-US-038-06 is proven against the real limiter if part 040-A used a stand-in, and expired keys are purged (REQ-API-009). Until part 040-B merges the API refuses to mount a route whose contract makes the key required or optional, so nothing runs unprotected. The booking-route forms of these scenarios are AT-US-202-03 and AT-US-203-01 to -03, owned by the booking tasks. Both parts are Wave 1, so the story is complete at `v0.1.0-m0`. Priority, milestone, DC tag, scenario titles and count (9) are unchanged.

#### Acceptance criteria
Permission path: not applicable — cross-cutting middleware with no route of its own; the scenario "Keys are scoped to the caller" covers the equivalent check (another caller's key is never replayed) and route-level permissions are tested on the operations that require the key.
```gherkin
Feature: Idempotency keys
  Scenario: Replay returns the stored response with no new effect
    Given the customer Owner booked with Idempotency-Key "7f1c0c1e-8d1a-4a77-9a1e-2f3d4c5b6a70" and got 201
    When the identical request is sent again
    Then the response has the same status and body with header "Idempotent-Replayed: true"
    And no second order, audit entry or outbox event exists

  Scenario: Key required on booking
    When POST booking is sent without Idempotency-Key
    Then the response is 400 IDEMPOTENCY_KEY_REQUIRED

  Scenario: Invalid key format
    When the key is 256 characters or contains a control character
    Then the response is 400 VALIDATION_ERROR

  Scenario: Same key, different body
    When the key is reused with a different request body
    Then the response is 422 IDEMPOTENCY_KEY_REUSED

  Scenario: Concurrent duplicate
    Given the first request with key K is still being processed
    When a second request with key K arrives
    Then the response is 409 IDEMPOTENCY_IN_PROGRESS with Retry-After 1

  Scenario: Server errors and rate limits are not stored
    Given the first request with key K returned 500
    When the request is retried with key K
    Then it is executed again

  Scenario: 4xx responses are replayed
    Given the first request returned 422
    Then the retry replays the 422 with Idempotent-Replayed true

  Scenario: Keys are scoped to the caller
    When user B of another org uses the same key value on the same path
    Then B's request is executed independently and never receives A's response

  Scenario: Expiry
    Given the key was stored 24 h and 1 s ago
    Then a request with it is processed as new
```

### US-039 — ETags and optimistic concurrency
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036
- **Linked REQs:** REQ-API-012, REQ-API-013
- **As a** staff or customer user **I want** conflicting edits detected **so that** I never silently overwrite someone else's change.
- **Notes:** Strong ETag from resource ID and `version` (DR-A16); `If-Match` required on PUT/PATCH/DELETE of versioned resources; 412 carries the current ETag. A no-op update does not bump version.

#### Acceptance criteria
```gherkin
Feature: ETags and optimistic concurrency
  Scenario: ETag on single-resource GET and conditional GET
    When GET /api/v1/addresses/{id} is called
    Then the response has a strong ETag
    When it is repeated with If-None-Match set to that ETag
    Then the response is 304 with no body

  Scenario: Update with matching If-Match
    When PATCH is sent with the current ETag
    Then the response is 200 with a new ETag and version increased by exactly 1

  Scenario: Missing If-Match
    When PATCH is sent without If-Match
    Then the response is 428 PRECONDITION_REQUIRED

  Scenario: Stale If-Match
    Given another user updated the resource
    When PATCH is sent with the old ETag
    Then the response is 412 CONCURRENCY_CONFLICT carrying the current ETag
    And the resource is unchanged

  Scenario: No-op update
    When PATCH sends values identical to the stored ones with the current ETag
    Then version and ETag are unchanged and no audit entry is written

  Scenario: Cross-tenant resource
    When org B sends If-Match for org A's resource
    Then the response is 404 NOT_FOUND

  Scenario: Concurrent updates
    When two updates with the same ETag are sent simultaneously
    Then exactly one succeeds with 200 and the other receives 412
```

### US-040 — Redis-backed rate limiting and headers
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036
- **Linked REQs:** REQ-API-014, REQ-SEC-005, REQ-SEC-006
- **As an** operator **I want** shared, per-route request limits with standard headers **so that** brute force and abuse are throttled consistently across instances.
- **Notes:** DR-A22 defaults (configuration): unauthenticated 120/min/IP; authentication routes 10/min/IP and 5/min/account identifier; refresh, logout and CSRF-token routes are `public` class 120/min/IP (D-043); authenticated 600/min/user; public reference and lookup routes 120/min/IP; webhooks 600/min per source IP; CSP report 20/min/IP; email-sending routes (verification resend, reset request and accepted registrations, D-049) 3/h per normalised address and 10/h per IP; registration allows at most 5 distinct addresses per IP per hour (`registration_probe` beyond); concurrent quote SSE streams 2 per IP (anonymous) and 5 per user (D-048); authenticated `POST /quotes` is the `quote-create` class at 30/min and 300/h per user and 1,000/h per organisation instead of the 600/min authenticated class (D-053, SEC-P3-29); `POST /quotes/{id}/share` is capped at 10 per quote per hour (D-055). Headers are the three draft-06 names (REQ-API-014, D-052). Two stages (DR-A08, ADR-0016 amendments 1 and 12; D-PM-073): before routing and authentication a route-agnostic per-IP limit counts every request except the two health probes, against 120/min per IP without a credential header (also for `OPTIONS`, the API docs and any path outside `/api/v1`) and against a per-IP ceiling of ten times the authenticated limit (6,000/min) when a request under `/api/v1` presents one; from TASK-041 part 041-B it also holds a failed-authentication budget of 120/min per IP, and while that is spent credentialed requests from the IP get 429 before authentication. The limits of the route's class, per IP or per user, run after authorisation and before validation. The earlier sentence "the per-IP limit of the route's class runs before authentication" is withdrawn. The title of the scenario "Per-IP limit is applied before authentication" (AT-US-040-06) is unchanged because it is a key of `gherkin-test-map.md`; it reads as "the per-IP limit of the auth class refuses before any authentication work", which is what its Then-step asserts: login is an anonymous route, so no password hash comparison or token verification precedes the class limit. The scenario "Rate-limit hit on auth routes is a security event" (AT-US-040-10) is met by one `rate_limit_auth` log event per key and window, at the first refusal, plus a counter that counts every refusal (13 logins from one IP in a minute: three 429 answers, one event, counter 3). IPv6 keyed by /64. EC-A12: only configured trusted proxies' `X-Forwarded-For` hops are honoured. Redis outage (REQ-SEC-006 as amended by D-PM-074): the `auth` and `email-send` classes and, from part 041-B, `public-quote`, `public-tracking`, `quote-create` and the failed-authentication budget use per-instance in-memory counters and an ERROR security event is logged; the other classes and the route-agnostic limit fail open (ASSUMED GAP-A-19, A-053). Delivery split (D-PM-078; TASK-041 code review R1-m7 and R2-C3): TASK-041 does not complete this story. It proves through mounted routes AT-US-040-01, -02, -03 (rows login per IP, authenticated per user, CSP report per IP), -05 to -12 and -17; its tests of the rule helpers and of the stream slots prove the engine, not the scenario. A scenario is accepted only on a test that goes through the route it names: AT-US-040-03 row "login per account identifier" on the login route (TASK-052, which also repeats AT-US-040-06 against the real password hasher); AT-US-040-13 and -14 on `POST /auth/register` (TASK-049); AT-US-040-04 and AT-US-040-03 row "quote-create per user" on `POST /quotes` (TASK-091); AT-US-040-15 and -16 on the quote stream route (TASK-141, with the same tests as AT-US-135-11 and -12), which completes the story. The stream route is M1 work, so the story is partial at `v0.1.0-m0` with those two scenarios open and complete before G3 (PRD §7). Priority, milestone and scenarios are unchanged.

#### Acceptance criteria
```gherkin
Feature: Redis-backed rate limiting and headers
  Scenario: Limit headers on limited routes
    When GET /api/v1/reference/countries is called
    Then the response has RateLimit-Limit 120, RateLimit-Remaining 119 and RateLimit-Reset

  Scenario: Exceeding the limit
    When 121 unauthenticated requests arrive from one IP within a minute
    Then the 121st returns 429 RATE_LIMITED with Retry-After in seconds

  Scenario Outline: Class-specific limits
    When "<count>" requests of class "<class>" arrive within a minute
    Then request number <count> is rejected with 429 RATE_LIMITED
    Examples:
      | class                         | count |
      | login per IP                  | 11    |
      | login per account identifier  | 6     |
      | authenticated per user        | 601   |
      | CSP report per IP             | 21    |
      | quote-create per user         | 31    |

  Scenario: Authenticated quote creation is the quote-create class, not the authenticated class
    Given a verified signed-in user who created 30 quotes within the last minute
    When they create a 31st quote
    Then the response is 429 RATE_LIMITED with Retry-After although the user is far below 600 authenticated requests per minute
    Given a user who created 300 quotes within the last hour spread under 30 per minute
    When they create a 301st quote
    Then the response is 429 RATE_LIMITED
    Given the users of one organisation created 1000 quotes within the last hour, each user below their own limits
    When any user of that organisation creates another quote
    Then the response is 429 RATE_LIMITED and a user of a different organisation is not affected
    And a guest POST /quotes is counted only against the guest per-IP class (20/min, 100/h)

  Scenario: Counters are shared across instances
    Given two API instances
    When 60 requests go to each from one IP
    Then the 121st request overall is rejected

  Scenario: Per-IP limit is applied before authentication
    Given one IP has exhausted the auth class limit
    When an 11th login arrives with a syntactically valid body
    Then the response is 429 RATE_LIMITED and no password hash comparison or token verification is performed (verified by the instrumented counter)

  Scenario: Refresh, logout and CSRF are in the public class
    When 11 refresh requests arrive from one IP within a minute
    Then none is rejected for rate limiting, and the 121st request of the public class from that IP is

  Scenario: Spoofed X-Forwarded-For is ignored
    When a client sends "X-Forwarded-For: 1.2.3.4" from an untrusted hop
    Then limits and audit use the real connecting IP

  Scenario: Redis down
    Given Redis is unreachable
    When 11 login requests arrive from one IP
    Then the 11th is rejected using the in-memory counter and an ERROR security event is logged
    And a public reference-data request succeeds (fail open)

  Scenario: Rate-limit hit on auth routes is a security event
    Then a security log event "rate_limit_auth" is emitted and counted

  Scenario: Limits apply per user, not shared between users
    Given user A exhausted 600 requests
    Then user B in the same IP still succeeds

  Scenario: Unauthenticated route class used when no principal
    Then a request without token is counted against its IP, never against a user

  Scenario: Registration is counted in both the auth and the email-send class
    Given 3 accepted registrations for one normalised address within the last hour
    When a 4th accepted registration for that address arrives
    Then the response is 429 RATE_LIMITED with Retry-After (email-send class, 3 per hour per address)
    Given 10 accepted registrations from one IP within the last hour for distinct addresses
    When an 11th arrives from that IP
    Then the response is 429 RATE_LIMITED (email-send class, 10 per hour per IP)
    And the 11th registration from one IP within a minute is also rejected by the auth class (10/min/IP)

  Scenario: Sixth distinct address from one IP is a registration probe
    Given one IP registered 5 distinct normalised addresses within the last hour
    When it registers a 6th distinct address
    Then the response is 429 RATE_LIMITED
    And one security event "registration_probe" is emitted and its counter increments

  Scenario Outline: Concurrent quote SSE streams are capped
    Given <existing> open quote streams for the same <scope>
    When another stream is opened
    Then the response is 429 RATE_LIMITED and the existing streams are unaffected
    Examples:
      | existing | scope                        |
      | 2        | anonymous IP (3rd stream)    |
      | 5        | authenticated user (6th)     |

  Scenario: Closing a stream frees its slot
    Given an anonymous IP with 2 open streams
    When one stream completes and another is opened
    Then the new stream is accepted

  Scenario: Rate-limit headers use the three draft-06 names
    When any rate-limited route responds
    Then the response has RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset
    And it has no X-RateLimit-* and no combined RateLimit or RateLimit-Policy header
```

### US-041 — Data representation rules
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-034
- **Linked REQs:** REQ-API-016
- **As a** frontend developer **I want** uniform formats for time, money, IDs and countries **so that** values are never mis-parsed or rounded.
- **Notes:** Timestamps ISO 8601 UTC with Z; dates `YYYY-MM-DD` plus IANA zone; UUID strings; money `{amount:int minor units, currency:ISO 4217}`; alpha-2 countries; decimal values such as FX rates are strings (DR-A19).

#### Acceptance criteria
Permission path: not applicable — contract-level rule validated by tests with no principal; a second negative scenario is included.
```gherkin
Feature: Data representation rules
  Scenario: Conforming representations
    When a quote is returned
    Then created_at matches "^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$"
    And money is {"amount": 4599, "currency": "USD"} with an integer amount
    And ids are UUIDs and country codes are two uppercase letters

  Scenario: Non-integer money fails the contract test
    Given a schema where money.amount is typed as a decimal number
    When the contract test runs
    Then it fails naming the field

  Scenario: Floating-point rate is rejected
    Given an FX rate field typed as number
    Then the contract test fails and requires a decimal string

  Scenario Outline: Invalid input formats
    When a request sends "<value>" for "<field>"
    Then the response is 400 VALIDATION_ERROR with that pointer
    Examples:
      | field     | value                 |
      | pickup_on | 2026-13-01            |
      | country   | usa                   |
      | amount    | 12.5                  |
      | currency  | usd                   |

  Scenario: Date-only values are not converted
    Then a pickup date 2026-12-24 with zone "Asia/Kolkata" is returned unchanged
```

### US-042 — Server-sent events convention
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036
- **Linked REQs:** REQ-API-017, REQ-API-018
- **As a** frontend developer **I want** a consistent event-stream protocol with bounded lifetime **so that** the rate-shopping stream can show results progressively without leaking connections or work.
- **Notes:** Headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; monotonically increasing `id`; events `carrier_result`, `carrier_error` (state ok, timeout, error), `complete`, `error`; heartbeat comment every 15 s; max 30 s; closes within 1 s of `complete` or `error`; authorised by bearer header via fetch client or a guest quote token; no personal data in events. Consumed by EPIC-08.

#### Acceptance criteria
```gherkin
Feature: Server-sent events convention
  Scenario: Stream format
    When a client opens a test event stream
    Then the response has Content-Type text/event-stream, Cache-Control no-cache and X-Accel-Buffering no
    And event ids increase strictly and each named event has JSON data

  Scenario: Completion closes the stream
    When the server sends "complete"
    Then the connection closes within 1 s

  Scenario: Fatal error
    When the server sends "error"
    Then the stream closes within 1 s

  Scenario: Heartbeat
    Given a stream idle for 16 s
    Then at least one comment line ": heartbeat" was received

  Scenario: Maximum duration
    Given an upstream that never completes
    Then the server sends error and closes at 30 s

  Scenario: Client abort cancels upstream work
    When the client disconnects at 1 s
    Then in-flight Mock carrier calls are cancelled within 1 s

  Scenario: Unauthenticated stream
    When the stream is opened without bearer token or quote token
    Then the response is 401 AUTH_REQUIRED problem+json and not an event stream

  Scenario: Events contain no personal data
    Then no event payload contains an address line, name, email or phone
```

### US-043 — Security headers, HSTS and Content-Security-Policy
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-SEC-001, REQ-SEC-002, REQ-SEC-003
- **As a** security analyst **I want** browser-enforced protections on every response **so that** clickjacking, sniffing and script injection are mitigated.
- **Notes:** Headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`; no `X-Powered-By` or version banners. CSP enforcing (not report-only). HSTS max-age at least 31536000 with includeSubDomains; HTTP redirects to HTTPS except local development. Payment-provider origin added with EPIC-11.

#### Acceptance criteria
Permission path: not applicable — response headers apply to every route regardless of principal; negative scenarios cover misconfiguration
```gherkin
Feature: Security headers, HSTS and Content-Security-Policy
  Scenario Outline: Headers present on API and both Nginx images
    When "<target>" serves any response
    Then it carries nosniff, the Referrer-Policy, Permissions-Policy, COOP same-origin and X-Frame-Options DENY
    And it has no X-Powered-By header and no server version in Server
    Examples:
      | target       |
      | API          |
      | web Nginx    |
      | admin Nginx  |

  Scenario: CSP content
    When the web app index is fetched
    Then Content-Security-Policy contains default-src 'self', object-src 'none', base-uri 'self', frame-ancestors 'none'
    And script-src has no 'unsafe-inline' and no 'unsafe-eval' and uses nonces or hashes
    And connect-src lists only the configured API origin

  Scenario: Inline script is blocked
    Given a page that injects an inline script without nonce
    When loaded in Chromium
    Then the script does not run and a violation is reported

  Scenario: Violation report endpoint
    When a CSP violation report is posted without authentication
    Then the response is 204 and a log entry is written
    And the 21st report per minute per IP returns 429 RATE_LIMITED

  Scenario: HSTS and HTTPS redirect
    Given NODE_ENV=staging
    When http://host/ is requested
    Then it redirects to https and Strict-Transport-Security has max-age at least 31536000 and includeSubDomains
    And on localhost development no redirect occurs

  Scenario: ZAP baseline
    Then the baseline scan does not flag missing CSP, clickjacking or sniffing protections
```

### US-044 — CSRF protection and CORS allow-list
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036, EPIC-02
- **Linked REQs:** REQ-SEC-004, REQ-SEC-014
- **As a** security analyst **I want** cookie-authenticated endpoints guarded against cross-site requests and CORS limited to known origins **so that** a malicious site cannot act on a signed-in user's behalf.
- **Notes:** Applies to refresh and logout: Origin in allow-list plus `X-CSRF-Token` matching a server-issued token. Bearer endpoints are exempt, documented per route. Preflight cached 600 s. Allow-list holds exact origins. SameSite=Strict is additional.

#### Acceptance criteria
```gherkin
Feature: CSRF protection and CORS allow-list
  Scenario: Valid cookie-authenticated request
    When POST /api/v1/auth/refresh carries the cookie, Origin "https://app.example" (allow-listed) and the issued X-CSRF-Token
    Then the response is 200

  Scenario Outline: CSRF rejection
    When the request has "<defect>"
    Then the response is 403 CSRF_REJECTED, a CSRF security event is logged and a PERMISSION_DENIED audit entry with outcome DENIED is written
    Examples:
      | defect                              |
      | no X-CSRF-Token                     |
      | token of another session            |
      | Origin not in the allow-list        |
      | missing Origin header               |

  Scenario: Bearer endpoints are exempt
    When a bearer-authenticated POST has no CSRF token
    Then the CSRF check is not applied

  Scenario: Allowed origin receives credentials headers
    When a preflight arrives from an allow-listed origin
    Then Access-Control-Allow-Origin echoes that exact origin, Access-Control-Allow-Credentials is true and Access-Control-Max-Age is 600

  Scenario: Unlisted origin gets no CORS headers
    When a request arrives from "https://evil.example" or "https://app.example.evil.example"
    Then no Access-Control-* headers are returned

  Scenario: Wildcard with credentials is impossible
    Given the allow-list is configured as "*"
    When the api starts
    Then start-up fails naming the key CORS_ALLOWED_ORIGINS

  Scenario: Unauthenticated caller hitting refresh
    Then the response is 401 AUTH_REQUIRED after CSRF checks pass
```

### US-045 — Input hardening: unknown fields, body size, content types, timeouts
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-036
- **Linked REQs:** REQ-SEC-007, REQ-SEC-015
- **As a** security analyst **I want** strict request schemas and resource limits **so that** mass assignment and oversized or slow requests are rejected.
- **Notes:** Server-controlled fields (id, org_id, created_by, updated_by, version, on_behalf_of_org_id, role/permission fields) are never accepted from clients (EC-A18). Body max 1 MB (configurable per route); undeclared content type 415; request over 30 s 503 `SERVICE_UNAVAILABLE` except event streams. No file-upload endpoints in M1.

#### Acceptance criteria
```gherkin
Feature: Input hardening
  Scenario Outline: Unknown and server-controlled fields are rejected
    When a create request body contains "<field>"
    Then the response is 400 VALIDATION_ERROR with sub-code UNKNOWN_FIELD at pointer "/body/<field>"
    And nothing is persisted
    Examples:
      | field               |
      | org_id              |
      | created_by          |
      | version             |
      | on_behalf_of_org_id |
      | role                |
      | extra_field         |

  Scenario: Unknown query and path parameters
    When GET list has ?debug=true
    Then the response is 400 VALIDATION_ERROR with sub-code UNKNOWN_FIELD at "/query/debug"

  Scenario: Body size
    When a 1 MB + 1 byte body is posted
    Then the response is 413 PAYLOAD_TOO_LARGE
    And a route configured for 2 MB accepts a 1.5 MB body

  Scenario: Content type
    When a JSON route receives Content-Type application/xml
    Then the response is 415 UNSUPPORTED_MEDIA_TYPE

  Scenario: Request timeout
    Given a handler that takes 31 s
    Then the response is 503 SERVICE_UNAVAILABLE at about 30 s
    And an event-stream route is exempt

  Scenario: Mass assignment attempt by a customer user
    When the customer Owner tries to PATCH their membership with a role field
    Then 400 UNKNOWN_FIELD is returned and no role change is recorded

  Scenario: Unauthenticated mass assignment
    Then the unauthenticated request is rejected with 401 AUTH_REQUIRED before schema errors are revealed on protected routes
```

### US-046 — Static safeguards: parameterised SQL, HTML-injection lint and Joi/Zod parity
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-SEC-008, REQ-SEC-009, REQ-SEC-016
- **As a** developer **I want** CI to block injection-prone code and validator drift **so that** common vulnerabilities cannot be merged.
- **Notes:** Semgrep and lint rules for raw SQL (allowed only in migrations and reviewed parameterised repository functions); unsafe HTML injection APIs only in a single reviewed sanitising component; shared limits, enums and regexes in packages/shared; parity test for address, parcel and customs-item schemas (M1, schemas owned by EPIC-09/EPIC-07).

#### Acceptance criteria
Permission path: not applicable — static analysis and test tooling with no principal; a second negative scenario is included.
```gherkin
Feature: Static safeguards
  Scenario Outline: Unsafe code is rejected
    Given a source file containing "<pattern>"
    When the Semgrep and lint stage runs
    Then it exits non-zero naming the rule
    Examples:
      | pattern                                              |
      | a raw query built with string concatenation          |
      | a template literal passing req.query into raw SQL    |
      | dangerouslySetInnerHTML outside the sanitiser        |

  Scenario: Allowed usage passes
    Given a reviewed parameterised raw query in a repository file and the sanitising component
    Then the stage passes

  Scenario: Validators agree on samples
    Given the shared address, parcel and customs-item samples including boundary lengths and invalid enum values
    When the parity test runs
    Then Joi and Zod accept and reject exactly the same inputs

  Scenario: Parity drift fails
    Given the Zod address schema allows 36 characters in line 1 and Joi allows 35
    Then the parity test fails naming the sample

  Scenario: Limits come from one place
    Then no numeric length limit literal for address fields exists outside packages/shared
```

### US-047 — SSRF-safe outbound client and security events
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-008, EPIC-04
- **Linked REQs:** REQ-SEC-010, REQ-SEC-012
- **As a** security analyst **I want** one hardened outbound HTTP client and stable security events **so that** server-side request forgery is blocked and attacks are observable.
- **Notes:** https only, host allow-list per environment, refuse loopback, private, link-local, unique-local (including 169.254.169.254) after DNS resolution, refuse redirects leaving allow-list, timeout and response-size cap; error `SSRF_BLOCKED`. Internal services use dedicated clients. Security events: login failure, account lock, MFA failure, refresh-token reuse, permission denial, CSRF rejection, SSRF block, rate-limit hit on auth routes, repeated cross-tenant 404s (more than 20 per user per minute, ASSUMED), registration probing (`registration_probe`), carrier quota pressure (`carrier_quota_pressure`) and anonymous carrier-budget exhaustion (`carrier_anon_budget_exhausted`) (D-049, D-048, D-052 h). Names must appear in the event catalogue (`api/README.md` section 13). Field `event_type=security`, stable event name, no secrets.

#### Acceptance criteria
```gherkin
Feature: SSRF-safe outbound client and security events
  Scenario: Allow-listed https host succeeds
    Given sandbox.carrier.example is on the allow-list
    When the client calls https://sandbox.carrier.example/rates
    Then the call proceeds with the configured timeout

  Scenario Outline: Blocked destinations
    When the client is asked to call "<url>"
    Then it raises SSRF_BLOCKED without sending the request
    Examples:
      | url                                          |
      | http://sandbox.carrier.example/rates         |
      | https://not-listed.example/                  |
      | https://169.254.169.254/latest/meta-data     |
      | https://localhost/                           |
      | https://10.0.0.5/                            |

  Scenario: DNS rebinding to a private address
    Given an allow-listed host resolving to 127.0.0.1
    Then SSRF_BLOCKED is raised

  Scenario: Redirect leaving the allow-list
    Given the allowed host redirects to https://evil.example
    Then the redirect is refused with SSRF_BLOCKED

  Scenario: Response size cap
    Given a response larger than the cap
    Then the call fails with a bounded error and does not buffer the whole body

  Scenario: SSRF block is a security event
    Then a log with event_type=security, name "ssrf_blocked" and no URL credentials is emitted and a counter increments

  Scenario Outline: Other security events are emitted
    When "<trigger>" occurs
    Then exactly one security log event "<event>" with no secrets is written and its counter increments
    Examples:
      | trigger                      | event                  |
      | wrong password               | login_failed           |
      | account locked               | account_locked         |
      | wrong TOTP code              | mfa_failed             |
      | refresh token reuse          | token_reuse_detected   |
      | permission denial            | permission_denied      |
      | CSRF rejection               | csrf_rejected          |
      | 21 cross-tenant 404s in 1 min| cross_tenant_404_burst |
      | 6th distinct registration address from one IP in an hour | registration_probe |
      | carrier daily quota reaches the 70 % or 90 % threshold   | carrier_quota_pressure |
      | anonymous carrier call budget exhausted                  | carrier_anon_budget_exhausted |

  Scenario: Permission path
    Given an unprivileged user requests another org's resource 21 times in a minute
    Then each returns 404 NOT_FOUND and one burst event is logged without a PERMISSION_DENIED audit entry
```

### US-048 — Secrets hygiene and CI security scanning
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-SEC-011, REQ-SEC-013
- **As a** security analyst **I want** secrets kept out of the repository and every build scanned **so that** vulnerable or unlicensed components and leaked credentials never ship.
- **Notes:** Scans: Semgrep, Gitleaks, dependency audit, licence check against the allow-list (MIT, Apache-2.0, BSD-2/3-Clause, ISC, MPL-2.0, Unlicense, CC0-1.0), Trivy image scan, CycloneDX SBOM. Fail on Critical/High with a fix or non-allow-listed licence. Waivers recorded in DECISIONS.md with expiry.

#### Acceptance criteria
Permission path: not applicable — CI tooling with no principal; a second negative scenario is included.
```gherkin
Feature: Secrets hygiene and CI security scanning
  Scenario: Clean repository passes
    When the security stage runs
    Then Semgrep, Gitleaks, dependency audit, licence check and Trivy pass and a CycloneDX SBOM artefact is produced

  Scenario: Config key missing from .env.example
    Given a config key not present in .env.example
    Then CI fails naming the key

  Scenario: Placeholders only
    Then .env.example contains only placeholder values

  Scenario: Committed secret is detected
    Given a commit containing a value shaped like an AWS access key
    Then Gitleaks fails the run

  Scenario: Production refuses placeholder secrets
    Given NODE_ENV=production and JWT_SECRET equals its placeholder
    When the api starts
    Then start-up fails naming JWT_SECRET (name only)

  Scenario Outline: Findings gate the pipeline
    Given a dependency with "<finding>"
    Then the pipeline "<result>"
    Examples:
      | finding                                  | result  |
      | High vulnerability with a fix available  | fails   |
      | Critical vulnerability with no fix       | passes and is tracked with a due date |
      | GPL-3.0 licence                          | fails   |
      | MIT licence                              | passes  |

  Scenario: Waiver
    Given a waiver in DECISIONS.md with a past expiry date
    Then the finding fails the pipeline again
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-API-001 | US-034 |
| REQ-API-002 | US-034 |
| REQ-API-003 | US-035 |
| REQ-API-004 | US-034 |
| REQ-API-005 | US-036 |
| REQ-API-006 | US-036 |
| REQ-API-007 | US-037 |
| REQ-API-008 | US-037 |
| REQ-API-009 | US-038 |
| REQ-API-010 | US-038 |
| REQ-API-011 | US-038 |
| REQ-API-012 | US-039 |
| REQ-API-013 | US-039 |
| REQ-API-014 | US-040 |
| REQ-API-015 | US-035 |
| REQ-API-016 | US-041 |
| REQ-API-017 | US-042 |
| REQ-API-018 | US-042 |
| REQ-API-019 | US-035 |
| REQ-API-020 | US-035 |
| REQ-SEC-001 | US-043 |
| REQ-SEC-002 | US-043 |
| REQ-SEC-003 | US-043 |
| REQ-SEC-004 | US-044 |
| REQ-SEC-005 | US-040 |
| REQ-SEC-006 | US-040 |
| REQ-SEC-007 | US-045 |
| REQ-SEC-008 | US-046 |
| REQ-SEC-009 | US-046 |
| REQ-SEC-010 | US-047 |
| REQ-SEC-011 | US-048 |
| REQ-SEC-012 | US-047 |
| REQ-SEC-013 | US-048 |
| REQ-SEC-014 | US-044 |
| REQ-SEC-015 | US-045 |
| REQ-SEC-016 | US-046 |
