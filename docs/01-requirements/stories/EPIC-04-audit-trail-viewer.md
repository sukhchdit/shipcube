# EPIC-04 — Audit trail and admin audit viewer

- **Goal:** Every meaningful action is recorded automatically, tamper-evidently and in the same transaction as the change, and authorised staff can inspect it in a minimal read-only viewer.
- **Milestone(s):** M0+M1
- **REQ areas covered:** REQ-AUDIT (every REQ in this area is linked by at least one story below)
- **Exit-demo contribution:** PRD §6.1 M0 exit demo: audit capture of LOGIN/CREATE/state transitions with chain verification, immutability tests, "RBAC and audit test generators pass", audit viewer list + detail with filters ("audit entries appear in the viewer", D-008).
- **Depends on epics:** EPIC-01 (PLAT: scheduler, health, Postgres), EPIC-02 (AUTH/ADMIN: sign-in events, admin app), EPIC-03 (route metadata, RLS, operator scope, `audit:read`), EPIC-05 (shell, tokens, i18n, six states), EPIC-16 (API: pagination, problem+json)

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-086 | Automatic audit capture driven by route descriptors | M0 | Must | M | US-067, EPIC-03 | REQ-AUDIT-001, REQ-AUDIT-006 | DC |
| US-087 | Action types, actor types and complete entry fields | M0 | Must | M | US-086 | REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 | DC |
| US-088 | Same-transaction writes and outcome semantics | M0 | Must | M | US-086 | REQ-AUDIT-004, REQ-AUDIT-010 | DC |
| US-089 | Fail-closed sensitive reads and downloads | M0 | Must | S | US-086, US-088 | REQ-AUDIT-005 |  |
| US-090 | Field-level diffs and no-op updates | M0 | Must | S | US-086 | REQ-AUDIT-007 |  |
| US-091 | Redaction and field classification | M0 | Must | M | US-086 | REQ-AUDIT-008, REQ-AUDIT-009 |  |
| US-092 | Per-stream hash chain | M0 | Must | M | US-087, US-091 | REQ-AUDIT-012 | DC |
| US-093 | Chain verification job and health degradation | M0 | Must | S | US-092, EPIC-01 | REQ-AUDIT-013 |  |
| US-094 | Database-enforced immutability and its tests | M0 | Must | M | US-087, US-074 | REQ-AUDIT-014, REQ-AUDIT-015 | DC |
| US-095 | Monthly partitions, indexes and partition-creation job | M0 | Must | M | US-087, EPIC-01 | REQ-AUDIT-016, REQ-AUDIT-017 | DC |
| US-096 | Audit test generator | M0 | Must | M | US-067, US-071, US-092 | REQ-AUDIT-024 | DC |
| US-097 | Audit viewer: filterable list | M0 | Must | M | US-095, US-076, US-110 | REQ-AUDIT-019, REQ-AUDIT-023 | DC |
| US-098 | Audit viewer: entry detail with diff, and audited viewing | M0 | Must | M | US-097 | REQ-AUDIT-020, REQ-AUDIT-022 | DC |
| US-099 | Entity history view and panel | M1 | Should | S | US-098 | REQ-AUDIT-021 |  |
| US-100 | Reason-required mechanism and archiver seam | M0 | Should | S | US-086, US-095 | REQ-AUDIT-025, REQ-AUDIT-018 |  |

## Stories

### US-086 — Automatic audit capture driven by route descriptors
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-067, EPIC-03
- **Linked REQs:** REQ-AUDIT-001, REQ-AUDIT-006
- **As a** developer **I want** middleware to write audit entries from each route's descriptor **so that** feature code never has to remember to audit.
- **Notes:** Descriptor states action, entity name, entity-ID resolver, sensitivity (`SENSITIVE`/`NORMAL`) and reason-required. `NONE` only with written justification and only for the closed list in REQ-AUDIT-006 (D-043): public reference-data reads, health endpoints, static documents, `GET /auth/csrf`, `POST /security/csp-report` and the pure calculators `GET /reference/volumetric` and `GET /reference/fx-rates/convert`. List `GET` writes one `VIEW` per request with filter summary and result count (DR-A13); detail `GET` one `VIEW` per entity returned.

#### Acceptance criteria
```gherkin
Feature: Descriptor-driven capture
  Scenario: Mutation is audited without feature code
    Given a route descriptor {action CREATE, entity "address", resolver, sensitivity SENSITIVE}
    When a Shipper POSTs a valid address Then exactly one audit entry with action "CREATE", entity "address" and the new entity ID exists and the handler never imported the audit writer

  Scenario: Incomplete descriptor
    When a descriptor lacks entity name or resolver, or uses "NONE" with no justification
    Then the route fails to mount and the router test fails naming method and path

  Scenario: Writer imported outside allow-list
    Given a feature module imports the audit writer
    Then the lint/test rule fails the build; allow-listed callers are packages/audit, auth events, system jobs and config changes

  Scenario: List view granularity
    When a user GETs a list returning 37 rows Then one "VIEW" entry records the filter summary and result_count 37, not per-row values

  Scenario: Permission denied
    Given a Viewer calls a mutating route Then no business entry exists and a "PERMISSION_DENIED" entry with outcome "DENIED" is written

  Scenario: NONE routes
    When GET /health/live, a public reference-data route, GET /auth/csrf, POST /security/csp-report or GET /reference/volumetric is called Then no audit entry is written

  Scenario: NONE outside the closed list is rejected
    Given a tenant route descriptor declares action NONE with a justification
    When the router test runs Then it fails naming the route, because NONE is allowed only for the REQ-AUDIT-006 list
```

### US-087 — Action types, actor types and complete entry fields
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-086
- **Linked REQs:** REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011
- **As a** Compliance Auditor **I want** every entry to carry who, what, where, when and outcome **so that** events can be reconstructed.
- **Notes:** Actions: `CREATE`, `UPDATE`, `DELETE`, `VIEW`, `DOWNLOAD`, `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `TOKEN_REUSE_DETECTED`, `MFA_ENROLLED`, `MFA_FAILED`, `MFA_RECOVERY_USED`, `SESSION_REVOKED`, `PERMISSION_DENIED`, `EXPORT`, `ON_BEHALF_ACTION`, `CONFIG_CHANGE`, `API_KEY_USE`, `STATE_TRANSITION` (enumeration in `packages/shared`; `EXPORT`, `ON_BEHALF_ACTION` and `API_KEY_USE` emitted from M2/M3; `MFA_RECOVERY_USED` and `SESSION_REVOKED` added by D-043 / ADR-0008 amendment). Actor types `USER`, `API_KEY`, `SYSTEM_JOB`, `ANONYMOUS`. IP from trusted proxy chain only (EC-A12).

#### Acceptance criteria
```gherkin
Feature: Audit entry content
  Scenario: All fields present on a user action
    When the seeded customer Owner signs in Then the "LOGIN" entry stores entry ID, occurred_at (database clock, UTC), user ID, role names at that time, actor type "USER", organisation ID, on-behalf-of null, IP, parsed device/browser, raw user agent, source app "web", correlation ID, session ID, entity "session", outcome "SUCCESS", previous-entry hash and entry hash

  Scenario: Shipment state transition
    When a shipment moves DRAFT to QUOTED Then a "STATE_TRANSITION" entry records old and new state

  Scenario: Actor types
    Then a worker job entry has actor type "SYSTEM_JOB" with job name and originating correlation ID; a guest quote has "ANONYMOUS" with IP and user agent; user ID is null for anonymous

  Scenario: Spoofed forwarded header
    Given a request with a forged X-Forwarded-For from an untrusted hop Then the stored IP is the first untrusted hop's address

  Scenario: Unknown action type
    When code writes action "FOO" Then the type check fails and the database enum rejects it

  Scenario: Failed login for unknown account
    Then a "LOGIN_FAILED" entry is written with actor type "ANONYMOUS", outcome "DENIED" and no user ID

  Scenario: Recovery code and remote revocation have their own action types
    When a user signs in with a recovery code Then an "MFA_RECOVERY_USED" entry exists for that user
    When a user revokes another of their own sessions from the sessions screen Then a "SESSION_REVOKED" entry names the revoked session ID, and the user's own logout still writes "LOGOUT"

  Scenario: Permission path: audit entry fields are not readable without "audit:read"
    Given a Shipper requests entry fields via the viewer API Then 403 "AUTHZ_DENIED"
```

### US-088 — Same-transaction writes and outcome semantics
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-086
- **Linked REQs:** REQ-AUDIT-004, REQ-AUDIT-010
- **As a** Compliance Auditor **I want** entries to commit atomically with the change and record denials and failures **so that** the trail never lies.
- **Notes:** EC-A19, EC-A21; DR-A09, DR-A10. `FAILED` entries use a separate transaction. 400 schema failures are logged, not audited (GAP-A-09).

#### Acceptance criteria
```gherkin
Feature: Atomic audit and outcomes
  Scenario: Audit insert fails
    Given the audit insert is forced to fail When a Shipper creates an address
    Then 500 "AUDIT_WRITE_FAILED" is returned and the business row does not exist

  Scenario: Business insert fails
    Given the business insert is forced to fail Then no audit entry exists

  Scenario: Retry is safe
    When the client retries with the same Idempotency-Key after AUDIT_WRITE_FAILED Then the change and exactly one entry are created

  Scenario: Authorised mutation ends 409, 422 or 5xx
    Then an entry with outcome "FAILED" is written in a separate transaction

  Scenario: Schema validation failure
    When the body fails validation with 400 "VALIDATION_ERROR" Then no audit entry is written and a WARN log with correlation ID exists

  Scenario: Permission denial
    Then outcome "DENIED" is recorded

  Scenario: No partition for current month
    Then the mutation returns 500 "AUDIT_WRITE_FAILED" and nothing persists (fail closed)

  Scenario: Permission path: not applicable — transaction semantics have no principal difference. Second negative: concurrent mutation
    Given two parallel mutations, one rolls back Then only the committed one has an entry
```

### US-089 — Fail-closed sensitive reads and downloads
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-086, US-088
- **Linked REQs:** REQ-AUDIT-005
- **As a** Compliance Auditor **I want** sensitive views and downloads to be released only after being logged **so that** no personal data leaves unrecorded.
- **Notes:** Sensitive list DR-A12 (user profile, session, membership, organisation profile, address, quote, shipment, customs data, documents, payment method, audit entries). Non-sensitive reads are best-effort, logged at ERROR on failure, never blocking.

#### Acceptance criteria
Permission path: covered by scenario "Unauthorised sensitive read".
```gherkin
Feature: Fail-closed reads
  Scenario: Sensitive view recorded before release
    When a Shipper views a shipment Then a "VIEW" entry exists before the response body is released

  Scenario: Audit unavailable on sensitive read
    Given audit writes fail When a Shipper views a shipment Then 503 "AUDIT_UNAVAILABLE" with no shipment data in the body

  Scenario: Non-sensitive read does not block
    Given audit writes fail When a user reads a NORMAL entity Then 200 is returned and an ERROR log is emitted

  Scenario: Download
    Then the "DOWNLOAD" entry with document ID and version exists before the pre-signed URL is released

  Scenario: Unauthorised sensitive read
    Given a Viewer without "shipment:read" Then 403 "AUTHZ_DENIED" and no "VIEW" entry for the entity
```

### US-090 — Field-level diffs and no-op updates
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-086
- **Linked REQs:** REQ-AUDIT-007
- **As a** Compliance Auditor **I want** exactly what changed stored deterministically **so that** changes can be compared and hashed reliably.
- **Notes:** EC-A25, DR-A16. `audit_noop` flag.

#### Acceptance criteria
```gherkin
Feature: Diffs
  Scenario: Update stores only changed fields
    Given an address with city "Austin" When city changes to "Dallas" and postcode is unchanged
    Then old value {"city":"Austin"} and new value {"city":"Dallas"} are stored with keys in deterministic order

  Scenario: Create and delete
    Then a create stores the full new value; a delete stores the last old value

  Scenario: No-op update
    When an update changes nothing Then 200 with the current ETag, version is not bumped and no entry is written

  Scenario: No-op on a route flagged audit_noop
    Then an entry with an empty diff is written

  Scenario: Same diff, same bytes
    Given two updates with identical changes Then the stored JSON text is byte-identical

  Scenario: Permission path: not applicable — storage format with no principal. Second negative: unserialisable value
    Given a value that cannot be serialised Then the request fails 500 "AUDIT_WRITE_FAILED" and the change rolls back
```

### US-091 — Redaction and field classification
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-086
- **Linked REQs:** REQ-AUDIT-008, REQ-AUDIT-009
- **As a** security analyst **I want** secrets replaced with `[REDACTED]` before storing and every audited field classified **so that** the trail holds no secrets and can later support privacy erasure.
- **Notes:** Classes `PUBLIC`, `INTERNAL`, `PERSONAL`, `SENSITIVE_PERSONAL`, `SECRET`. Redaction markers are part of hashed content (DR-A09). Gateway tokens are secrets.

#### Acceptance criteria
```gherkin
Feature: Redaction and classification
  Scenario: Denylisted keys redacted
    When a user changes a password, TOTP secret, recovery codes, API token or an Authorization header is captured
    Then the entry holds "[REDACTED]" for each and the raw value appears in no column

  Scenario: Property test
    Given randomised objects with each denylisted key at random depth Then no raw value is persisted in any run

  Scenario: Classification tags
    Then each stored value carries its field's class (for example email "PERSONAL", postcode "PERSONAL", password hash "SECRET")

  Scenario: Unclassified field fails the build
    Given an audited entity gains a field without a classification Then the build test fails naming entity and field

  Scenario: Redaction happens before hashing
    Then the entry hash is computed over the redacted content

  Scenario: Permission path
    Given a Compliance Auditor views an entry containing redacted fields Then the viewer shows "[REDACTED]" and the API never returns the raw value to any role
```

### US-092 — Per-stream hash chain
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-087, US-091
- **Linked REQs:** REQ-AUDIT-012
- **As a** Compliance Auditor **I want** entries chained per audit stream **so that** any tampering is detectable.
- **Notes:** SHA-256 over RFC 8785 canonical JSON of the entry without its hash, concatenated with the previous hash; first previous hash is 64 zeros; one chain per organisation plus `SYSTEM`. EC-A22.

#### Acceptance criteria
```gherkin
Feature: Hash chain
  Scenario: First entry in a stream
    Then its previous hash is 64 zeros and its entry hash equals SHA-256(canonical entry ‖ previous hash)

  Scenario: Links
    Given entries E1, E2 in one stream Then E2.previous_hash equals E1.entry_hash

  Scenario: Concurrent writers
    When 50 parallel writes target one stream Then no two entries share a predecessor and the chain verifies

  Scenario: Per-organisation streams
    Then entries of organisation A and B form separate chains and entries without organisation form the SYSTEM chain

  Scenario: Duplicate hash
    Then entry_hash is unique and an insert with a duplicate fails

  Scenario: Permission path: not applicable — internal mechanism. Second negative: out-of-order insert
    Given an insert naming a stale previous hash Then it is rejected and the transaction rolls back with "AUDIT_WRITE_FAILED"
```

### US-093 — Chain verification job and health degradation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-092, EPIC-01
- **Linked REQs:** REQ-AUDIT-013
- **As an** operator **I want** scheduled verification of the chain **so that** tampering is detected within an hour.
- **Notes:** Incremental hourly since last verified entry; full nightly; schedule is configuration (ASSUMED); job registered once across worker instances (REQ-PLAT-015).

#### Acceptance criteria
```gherkin
Feature: Chain verification
  Scenario: Healthy chain
    When the hourly job runs Then a result row stores status OK, range verified and no broken entry

  Scenario: Break detected
    Given in a throwaway database a privileged role edits entry X When the job runs
    Then the result stores first broken entry ID X, an ERROR log is written, the alert metric increments and "/health/ready" reports the audit component "degraded"

  Scenario: Full nightly run covers all entries
    Then the nightly result verifies from the first entry of every stream

  Scenario: Multiple workers
    Given 3 worker instances Then exactly one verification runs per interval

  Scenario: Permission path: not applicable — system job. Second negative: job failure
    Given the database is unreachable Then the run is recorded FAILED, not OK
```

### US-094 — Database-enforced immutability and its tests
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-087, US-074
- **Linked REQs:** REQ-AUDIT-014, REQ-AUDIT-015
- **As a** Compliance Auditor **I want** audit rows impossible to alter by any role **so that** the trail is evidence.
- **Notes:** Application role holds only INSERT and SELECT; `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers raise for every role including owner. EC-A23.

#### Acceptance criteria
```gherkin
Feature: Immutability
  Scenario: UPDATE, DELETE, TRUNCATE fail for every role
    When each of the application role, migration role and owner role issues UPDATE, DELETE and TRUNCATE on the audit table via SQL and via the application data layer
    Then every attempt fails with an exception and the row count and hashes are unchanged

  Scenario: Privileges
    Then the application role has exactly INSERT and SELECT on audit tables

  Scenario: Repository scan
    Given a migration or route containing a modifying statement against audit tables Then the CI scan fails

  Scenario: No edit or delete surface
    Then no API route, admin screen or migration offers to edit or delete audit rows (PUT/PATCH/DELETE on audit paths return 404 or 405)

  Scenario: Permission denied on dropping the trigger
    Given the application role runs DROP TRIGGER Then permission denied

  Scenario: Audit of the attempt
    Then a denied API attempt to delete an entry writes "PERMISSION_DENIED"
```

### US-095 — Monthly partitions, indexes and partition-creation job
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-087, EPIC-01
- **Linked REQs:** REQ-AUDIT-016, REQ-AUDIT-017
- **As an** operator **I want** audit data partitioned by month with viewer-supporting indexes and automatic partition creation **so that** queries stay fast and writes never fail for lack of a partition.
- **Notes:** Primary key includes occurred_at; no default partition. Initial migration creates the current month plus 3. EC-A21.

#### Acceptance criteria
```gherkin
Feature: Audit partitions
  Scenario: Partitioned layout and indexes
    Then the table is range-partitioned monthly on occurred_at with indexes for time, organisation+time, user+time, entity+entity ID+time, action+time

  Scenario: One-day filter prunes
    When EXPLAIN runs for a one-day range Then exactly 1 partition is scanned

  Scenario: Daily job is idempotent
    When the job runs twice Then partitions exist for the current month and next 3 months with no duplicates or errors

  Scenario: Readiness degrades
    Given fewer than 2 future months exist Then "/health/ready" reports the audit component "degraded"

  Scenario: Missing partition fails closed
    When an insert falls outside every partition Then it fails and the mutation returns 500 "AUDIT_WRITE_FAILED"

  Scenario: Permission path: not applicable — scheduled job. Second negative
    Given the application role lacks CREATE on schema Then partition creation runs under the privileged job role and the runtime role still cannot create tables
```

### US-096 — Audit test generator
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-067, US-071, US-092
- **Linked REQs:** REQ-AUDIT-024
- **As a** QA lead **I want** audit tests generated per route **so that** every route's audit behaviour is proven and cannot regress.
- **Notes:** Part of the M0 exit demo.

#### Acceptance criteria
```gherkin
Feature: Audit generator
  Scenario: Permitted role
    Given each route in metadata invoked as a permitted role Then exactly one entry exists with correct action, entity, outcome "SUCCESS", organisation and correlation ID in the same transaction

  Scenario: Forbidden role
    Then a forbidden role produces a "DENIED" entry and no business change

  Scenario: Chain valid afterwards
    Then chain verification passes after the whole generated run

  Scenario: Sensitive reads and downloads
    Then each produces an entry

  Scenario: NONE routes
    Then they are asserted to write no entry

  Scenario: Route without a generated case
    Given a new route Then CI fails naming it

  Scenario: Permission path: not applicable — test tooling. Second negative
    Given a route handler that calls the writer directly Then the generated test and the lint rule both fail
```

### US-097 — Audit viewer: filterable list
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-095, US-076, US-110
- **Linked REQs:** REQ-AUDIT-019, REQ-AUDIT-023
- **As a** Compliance Auditor **I want** to filter and page through audit entries in the admin app **so that** I can find who did what.
- **Notes:** Admin route `/audit` (REQ-ADMIN-006). Filters: date range, user, role, organisation, entity name, entity ID, action, IP, outcome; combined with AND; newest first; keyset pagination default 50 max 200; default range last 24 h, max 31 days (400 `VALIDATION_ERROR` sub-code `RANGE_TOO_LARGE`); filters in URL. Organisation filter uses operator scope (US-076). Table at 768 px and wider, cards below (REQ-UI-012). Timestamps in viewer zone with zone label.

#### Acceptance criteria
```gherkin
Feature: Audit list
  Scenario: Default view
    Given the Compliance Auditor opens "/audit" at 1280 px
    Then entries of the last 24 h appear newest first, 50 per page, in a table with the shared data component

  Scenario: Filters combine and reflect in URL
    When action "UPDATE", outcome "SUCCESS" and entity "address" are chosen Then only matching entries show and the URL query string contains the filters; reloading reproduces the view

  Scenario: Pagination limits
    When limit=200 Then up to 200 rows return; limit=201 gives 400 "VALIDATION_ERROR"; a tampered cursor gives 400 "INVALID_CURSOR"

  Scenario: Range over 31 days
    Then 400 "VALIDATION_ERROR" sub-code "RANGE_TOO_LARGE" with an inline message

  Scenario: Empty result
    Then the empty state shows an explanation and a "Clear filters" action that resets to the 24 h default

  Scenario: Mobile
    Given 360 px Then results show as stacked cards with the same field order and filters, sort and pagination are usable without horizontal page scroll

  Scenario: Six states
    Then loading skeletons, error with retry and correlation ID, partial notice, permission-denied and offline banner are each shown in the matching condition

  Scenario: Permission denied
    Given a customer Owner or a user without "audit:read" opens "/audit" Then the permission-denied state is shown with no request issued; the API returns 403 "AUTHZ_DENIED" with a "PERMISSION_DENIED" entry

  Scenario: Cross-tenant filter
    Given an operator with "audit:read" filters by organisation "Acme Exports" Then entries of that organisation return and the viewing entry records target organisation; a non-operator supplying organisation gets 403 "AUTHZ_DENIED"

  Scenario: Locales, keyboard, accessibility
    Then labels are shown in en, es and fr, all filters and rows are keyboard operable and axe reports zero serious or critical violations in light and dark themes
```

### US-098 — Audit viewer: entry detail with diff, and audited viewing
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-097
- **Linked REQs:** REQ-AUDIT-020, REQ-AUDIT-022
- **As a** Compliance Auditor **I want** to open an entry to see all fields and the field-level diff, with my own viewing recorded **so that** inspection is itself accountable.
- **Notes:** Route `/audit/entries/<id>` with breadcrumbs. Read-only. Redacted fields marked. Diff stacks vertically at 360 px; long values wrap. `VIEW` entry written after response data is fixed, with filter parameters and result count (never values); fail closed. Entries themselves are SENSITIVE (DR-A12).

#### Acceptance criteria
```gherkin
Feature: Audit entry detail
  Scenario: Detail shows all fields and diff
    When the auditor opens an UPDATE entry Then all stored fields, the old/new diff, and previous-entry and entry hashes are shown

  Scenario: Redacted fields marked
    Given an entry with a password change Then the field shows "[REDACTED]" with a text marker (not colour only)

  Scenario: Viewing is audited without looping
    When the list is opened with filter action="UPDATE" and returns 12 rows
    Then a "VIEW" entry for entity "audit_entry" records the filter parameters and result count 12 and no row values, and it appears in the next list view; opening the list does not generate a second entry

  Scenario: Audit write fails
    Given audit writes fail Then the list, detail and history requests return 503 "AUDIT_UNAVAILABLE" with no entry data

  Scenario: Unknown or cross-tenant entry
    Then a nonexistent ID or an entry of another organisation viewed without operator scope returns 404 "NOT_FOUND"

  Scenario: Permission denied
    Given a user without "audit:read" Then 403 "AUTHZ_DENIED" and a "PERMISSION_DENIED" entry

  Scenario: Responsive, locales and states
    Then at 360 px the diff stacks vertically and at 1280 px it is side by side; en, es and fr render; loading, error and not-found states exist; axe reports zero serious violations; Tab order follows visual order

  Scenario: Read-only
    Then the page offers no edit, delete or restore control
```

### US-099 — Entity history view and panel
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-098
- **Linked REQs:** REQ-AUDIT-021
- **As a** Compliance Auditor **I want** the chronological history of one record **so that** I can follow its life.
- **Notes:** Route `/audit/entities/<entity>/<id>`; reusable panel; no embedding page exists in the admin app in this run beyond the viewer.

#### Acceptance criteria
```gherkin
Feature: Entity history
  Scenario: History in order
    Given shipment S has CREATE, STATE_TRANSITION and UPDATE entries When the auditor opens "/audit/entities/shipment/<S>"
    Then entries are listed oldest to newest with breadcrumbs and links to each detail

  Scenario: Empty history
    Given an entity with no entries Then the empty state is shown

  Scenario: Request audited
    Then a "VIEW" entry records entity name, ID and result count and fails closed on write failure (503 "AUDIT_UNAVAILABLE")

  Scenario: Permission denied
    Given a customer user Then the permission-denied state is shown and the API returns 403 "AUTHZ_DENIED"

  Scenario: Panel reuse
    Then the component renders identically when mounted inside a test detail page, at 360 and 1280 px, in en, es and fr
```

### US-100 — Reason-required mechanism and archiver seam
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-086, US-095
- **Linked REQs:** REQ-AUDIT-025, REQ-AUDIT-018
- **As a** compliance lead **I want** the reason-required mechanism and an archiving seam in place **so that** M2 signed actions and M5 archiving need no rework.
- **Notes:** No route uses reason-required in this run; archiver is an interface plus nullable `archived_at` per partition (Could, M1). No partition is dropped or detached; no S3 Object Lock bucket is created.

#### Acceptance criteria
```gherkin
Feature: Reason and archive seams
  Scenario: Reason required but missing
    Given a test route with reason-required When the reason is absent or has 9 characters Then 422 "REASON_REQUIRED" and no change

  Scenario: Reason accepted and stored
    When the reason has 10 characters Then it is stored in the audit entry's reason field

  Scenario: Archiver seam
    Then an archiver interface exists, each partition has a nullable archived_at, and no code path drops or detaches a partition (scan test)

  Scenario: Permission path: not applicable — mechanism only. Second negative
    Given a caller without the route's permission and a missing reason Then 403 "AUTHZ_DENIED" is returned first (authorisation before validation)
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-AUDIT-001 | US-086 |
| REQ-AUDIT-002 | US-087 |
| REQ-AUDIT-003 | US-087 |
| REQ-AUDIT-004 | US-088 |
| REQ-AUDIT-005 | US-089 |
| REQ-AUDIT-006 | US-086 |
| REQ-AUDIT-007 | US-090 |
| REQ-AUDIT-008 | US-091 |
| REQ-AUDIT-009 | US-091 |
| REQ-AUDIT-010 | US-088 |
| REQ-AUDIT-011 | US-087 |
| REQ-AUDIT-012 | US-092 |
| REQ-AUDIT-013 | US-093 |
| REQ-AUDIT-014 | US-094 |
| REQ-AUDIT-015 | US-094 |
| REQ-AUDIT-016 | US-095 |
| REQ-AUDIT-017 | US-095 |
| REQ-AUDIT-018 | US-100 |
| REQ-AUDIT-019 | US-097 |
| REQ-AUDIT-020 | US-098 |
| REQ-AUDIT-021 | US-099 |
| REQ-AUDIT-022 | US-098 |
| REQ-AUDIT-023 | US-097 |
| REQ-AUDIT-024 | US-096 |
| REQ-AUDIT-025 | US-100 |

All 22 Must REQs of REQ-AUDIT are covered by Must stories (US-086 to US-098). REQ-AUDIT-021 and REQ-AUDIT-025 (Should) and REQ-AUDIT-018 (Could) are covered by the Should stories US-099 and US-100.
