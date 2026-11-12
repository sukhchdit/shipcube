# EPIC-14 — Customer account

- **Goal:** A signed-in customer can find, understand and manage their shipments, drafts, addresses, preferences, security settings and team from one tenant-safe account area.
- **Milestone(s):** M1
- **REQ areas covered:** REQ-ACCT (REQ-ACCT-001 to REQ-ACCT-020)
- **Exit-demo contribution:** PRD §6.2 (M1 demo): the account shipment list shows the order with charges, documents and timeline. Cancel entry point supports the cancellation demo (mechanics in EPIC-09).
- **Depends on epics:** EPIC-02 (AUTH: sessions, MFA, password, re-authentication), EPIC-03 (ORG/RBAC/RLS), EPIC-04 (AUDIT), EPIC-05 (UI/I18N), EPIC-09 (BOOK: drafts, state machine, cancellation, CUST), EPIC-08 (QUOTE), EPIC-10 (PAY), EPIC-11 (DOC), EPIC-13 (TRACK), EPIC-15 (NOTIF), EPIC-16 (API/SEC), EPIC-17 (DATA: pagination, query-plan tests)

All UI stories below share these standing acceptance lines, restated as scenarios where the story is a screen: en/es/fr strings with locale date, number and currency formats; the six screen states (loading, empty, error, partial, permission-denied, offline); 360 px and 1280 px layouts (tables collapse to cards below 768 px); keyboard operability with visible focus; axe-core clean.

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-254 | Shipments list with search, filters and cursor pagination | M1 | Must | M | EPIC-09, EPIC-17 | REQ-ACCT-002 | DC |
| US-255 | Shipment detail with timeline, charges, documents and tracking | M1 | Must | M | US-254, EPIC-13, EPIC-11 | REQ-ACCT-003 | DC |
| US-256 | Drafts list, resume, delete and 30-day expiry | M1 | Must | M | EPIC-09 | REQ-ACCT-004 |  |
| US-257 | Tenant isolation on every account route | M1 | Must | S | EPIC-03 | REQ-ACCT-020 |  |
| US-258 | Dashboard with recent shipments, actions needed and monthly spend | M1 | Should | M | US-254, EPIC-10 | REQ-ACCT-001 |  |
| US-259 | Saved quotes list | M1 | Should | S | EPIC-08 | REQ-ACCT-005 |  |
| US-260 | Repeat a past shipment | M1 | Should | S | US-255, EPIC-09 | REQ-ACCT-006 |  |
| US-261 | Cancel shipment entry point on the detail screen | M1 | Should | S | US-255, EPIC-09 | REQ-ACCT-007 |  |
| US-262 | Address book create, edit, delete and search | M1 | Should | M | EPIC-09, EPIC-17 | REQ-ACCT-008 |  |
| US-263 | Default sender address | M1 | Should | S | US-262 | REQ-ACCT-009 |  |
| US-264 | Address book CSV import parsed in the browser | M1 | Could | M | US-262 | REQ-ACCT-010 |  |
| US-265 | Payment methods screen | M1 | Should | S | EPIC-10 | REQ-ACCT-011 |  |
| US-266 | Notification preferences with consent records | M1 | Should | S | EPIC-15 | REQ-ACCT-012 |  |
| US-267 | Security settings screen | M1 | Should | S | EPIC-02 | REQ-ACCT-013 |  |
| US-268 | Organisation profile and team invitations | M1 | Should | M | EPIC-02, EPIC-03, EPIC-15 | REQ-ACCT-014 |  |
| US-269 | Protect the last Owner and block self role change | M1 | Should | S | US-268 | REQ-ACCT-015 |  |
| US-270 | Privacy data export | M1 | Could | S | EPIC-02 | REQ-ACCT-016 |  |
| US-271 | Privacy account deletion request | M1 | Could | S | US-270, EPIC-02 | REQ-ACCT-017 |  |
| US-272 | Locale, display currency and unit preferences | M1 | Should | S | EPIC-05 | REQ-ACCT-018 |  |
| US-273 | No navigation or routes for out-of-scope account areas | M1 | Should | S | EPIC-05 | REQ-ACCT-019 |  |

## Stories

### US-254 — Shipments list with search, filters and cursor pagination
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-09, EPIC-17
- **Linked REQs:** REQ-ACCT-002
- **Linked NFRs (optional):** NFR-PERF-002
- **As a** shipper **I want** to list and find my organisation's shipments **so that** I can quickly open the one I need.
- **Notes:** Cursor pagination default 25, max 100; sort creation time descending; search by tracking number, order number, customer reference and receiver name (partial, case-insensitive); filters status, carrier, direction, destination country, creation date range. Index and query-plan test required (EPIC-17). Saved views not in M1. Audit: list view writes `VIEW` (entity shipment, sensitive per DR-A12).

#### Acceptance criteria
```gherkin
Feature: Shipments list
  Background:
    Given user "ana@acme.test" with role "Shipper" in organisation "Acme" with 60 shipments

  Scenario: Default list is newest first with 25 rows
    When Ana opens "GET /v1/shipments"
    Then the response is 200 with 25 items sorted by creation time descending and a "next" cursor

  Scenario: Cursor pagination walks all items without duplicates
    When Ana follows the cursor until it is empty
    Then 60 distinct shipments are returned across 3 pages

  Scenario: Page size is capped at 100
    When Ana requests "limit=500"
    Then at most 100 items are returned or the response is 400 "VALIDATION_ERROR" with pointer "/limit"

  Scenario Outline: Search and filter
    When Ana searches or filters by <input>
    Then only matching shipments of "Acme" are returned
    Examples:
      | input |
      | tracking number "MOCK1234567890" |
      | order number "US-000000123" |
      | customer reference "PO-7788" |
      | receiver name partial "mari" matching "Maria Lopez" case-insensitively |
      | status "IN_TRANSIT" |
      | carrier "DHL" |
      | direction "EXPORT" |
      | destination country "DE" |
      | created between 2026-11-01 and 2026-11-10 |

  Scenario: Invalid filter value
    When Ana filters by status "BANANA"
    Then the response is 400 with problem code "VALIDATION_ERROR" and pointer "/status"

  Scenario: Search never crosses tenants
    Given organisation "Beta" has a shipment for receiver "Mariano"
    When Ana searches "mari"
    Then no shipment of "Beta" is returned

  Scenario: Unauthenticated
    When a client without a session requests the list
    Then the response is 401 with problem code "AUTH_REQUIRED"

  Scenario: Role without shipment:read
    Given a user whose role lacks "shipment:read"
    Then the response is 403 with problem code "AUTHZ_DENIED"

  Scenario: Audit entry for the list view
    When Ana opens the list
    Then an audit entry with action "VIEW" and entity "shipment" exists with the filter parameters but without receiver names

  Scenario: Query plan uses an index
    When the list query runs with each supported filter on 100000 seeded rows
    Then the query-plan test shows an index scan and no sequential scan

  Scenario Outline: UI states, locales and responsive layout
    When the list is shown in locale "<locale>" at "<viewport>" in state "<state>"
    Then the "<state>" view is rendered (rows, skeleton, empty with "get a quote" action, error with retry, partial banner, permission-denied, offline banner)
    And at 1280 px rows are a table and at 360 px each row is a card with status, order number and receiver
    Examples:
      | locale | viewport | state |
      | en | 1280 px | loaded |
      | es | 360 px | empty |
      | fr | 360 px | error |

  Scenario: Keyboard and axe
    Then filters, rows and pagination are keyboard operable and axe-core reports no violations
```

### US-255 — Shipment detail with timeline, charges, documents and tracking
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-254, EPIC-13, EPIC-11
- **Linked REQs:** REQ-ACCT-003
- **As a** shipper **I want** a single page with everything about a shipment **so that** I can answer questions without contacting support.
- **Notes:** Shows status and state history, tracking events (US-251), itemised charge lines with tax and totals from the stored snapshot (never recomputed, REQ-PRICE-017), sender and receiver snapshots, contents and customs (restricted references masked), collection details, payment summary (needs `payment:read`), documents with downloads (download authorisation and audit are EPIC-11; this story links the buttons). Viewing writes `VIEW` (sensitive, fail-closed per REQ-AUDIT-005).

#### Acceptance criteria
```gherkin
Feature: Shipment detail
  Background:
    Given user "ana@acme.test" with role "Shipper" in organisation "Acme"
    And a BOOKED shipment "S1" with charge lines base 100.00, fuel 12.00, tax 22.40, total 134.40 EUR

  Scenario: Detail shows all sections
    When Ana opens "GET /v1/shipments/S1"
    Then the response is 200 with status, history timeline, tracking events, charge lines, totals, sender and receiver snapshots, contents, collection, and documents
    And the receiver tax ID is masked to its last 2 characters

  Scenario: Prices come from the stored snapshot
    Given pricing configuration changed after booking
    When Ana opens the detail
    Then the totals still equal 134.40 EUR and the snapshot hash equals the stored hash

  Scenario: Payment summary requires payment:read
    Given a user with role "Shipper" (no "payment:read")
    When the user opens the detail
    Then the response omits the payment summary and the UI hides that section

  Scenario: Unauthenticated
    When an unauthenticated client requests the detail
    Then the response is 401 with problem code "AUTH_REQUIRED"

  Scenario: Cross-tenant identifier
    Given "S9" belongs to organisation "Beta"
    When Ana requests "GET /v1/shipments/S9"
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Role without shipment:read
    Given a user whose role lacks "shipment:read"
    Then the response is 403 with problem code "AUTHZ_DENIED"

  Scenario: Audit VIEW entry
    When Ana opens the detail
    Then an audit entry with action "VIEW", entity "shipment", ID "S1" and actor Ana exists
    And the entry contains no addresses or tax references

  Scenario: Audit unavailable fails closed
    Given the audit write fails
    When Ana opens the detail
    Then the response is 503 with problem code "AUDIT_UNAVAILABLE" and no shipment data

  Scenario: Documents pending then ready
    Given the label is still generating
    Then the documents section shows a pending state and updates without reload when the label becomes ready

  Scenario: Document download uses the audited download route
    When Ana selects "Download label"
    Then the request goes to the document download route of EPIC-11 and the account page issues no direct storage URL

  Scenario: Failed carrier tracking shows partial state
    Given tracking is temporarily unavailable
    Then the tracking section shows a partial-state notice with retry while other sections render

  Scenario Outline: Locales and responsive layouts
    When the detail is shown in "<locale>" at "<viewport>"
    Then amounts use the locale currency format and charge tables collapse to cards below 768 px
    Examples:
      | locale | viewport |
      | en | 1280 px |
      | es | 360 px |
      | fr | 360 px |

  Scenario: Keyboard and axe
    Then all actions are keyboard reachable and axe-core reports no violations
```

### US-256 — Drafts list, resume, delete and 30-day expiry
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-09
- **Linked REQs:** REQ-ACCT-004
- **As a** shipper **I want** to see, resume or delete my unfinished shipments **so that** I do not lose work.
- **Notes:** Shows step reached and last-edit time. Delete is a soft transition to CANCELLED (DR-B01). Expiry after 30 days without edit (configuration `DRAFT_EXPIRY_DAYS=30`, ASSUMED GAP-B-33) by a worker job. Permission `shipment:create`. Audit `UPDATE` with trigger (USER_ACTION or SYSTEM_TIMEOUT).

#### Acceptance criteria
```gherkin
Feature: Drafts
  Background:
    Given user "ana@acme.test" with role "Shipper" in organisation "Acme" with drafts at step 2 and step 4

  Scenario: List drafts with step and last edit
    When Ana opens "GET /v1/shipments?state=DRAFT"
    Then each draft shows the step reached and last-edit time

  Scenario: Resume opens the first incomplete step
    When Ana selects "Resume" on the step 2 draft
    Then the wizard opens at the first incomplete step

  Scenario: Delete moves the draft to CANCELLED
    When Ana deletes a draft and confirms
    Then the draft state is "CANCELLED" with trigger "USER_ACTION"
    And it no longer appears in the drafts list

  Scenario: Draft expires after 30 days
    Given a draft last edited 30 days and 1 minute ago
    When the expiry job runs
    Then the draft state is "CANCELLED" with trigger "SYSTEM_TIMEOUT" and reason "DRAFT_EXPIRED"

  Scenario: Draft edited 29 days ago is kept
    When the expiry job runs
    Then the draft remains "DRAFT"

  Scenario: Expiry job is idempotent
    When the expiry job runs twice
    Then each expired draft has exactly one transition row

  Scenario: Cannot delete a non-draft through the draft route
    When Ana deletes a BOOKED shipment via the drafts route
    Then the response is 409 with problem code "ILLEGAL_STATE_TRANSITION"

  Scenario: Viewer cannot delete
    Given a user with role "Viewer"
    Then the delete and resume actions are absent and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Unauthenticated and cross-tenant
    Then an unauthenticated delete returns 401 "AUTH_REQUIRED" and deleting another organisation's draft returns 404 "NOT_FOUND"

  Scenario: Audit entries
    When a draft is deleted
    Then an audit entry with action "UPDATE", entity "shipment", from-state "DRAFT", to-state "CANCELLED" and the actor exists in the same transaction

  Scenario: Empty state and responsive
    Given no drafts
    Then an empty state offers "get a quote" in en, es and fr and the list renders as cards at 360 px and a table at 1280 px; axe-core reports no violations
```

### US-257 — Tenant isolation on every account route
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-03
- **Linked REQs:** REQ-ACCT-020
- **As a** security engineer **I want** each account list and detail route proven to return only the caller's organisation data **so that** no customer can see another's information.
- **Notes:** Complements the RLS tests (EPIC-03); this story supplies the per-route denial cases for shipments, drafts, saved quotes, addresses, documents, payments, members and notification log. Permission path: cross-tenant 404 below.

#### Acceptance criteria
```gherkin
Feature: Account tenant isolation
  Background:
    Given organisations "Acme" and "Beta" each own one shipment, quote, address, document, payment method, member and notification log entry

  Scenario Outline: List endpoints return only own data
    When an "Acme" user calls the list "<route>"
    Then no item belonging to "Beta" appears
    Examples:
      | route |
      | /v1/shipments |
      | /v1/quotes |
      | /v1/address-book |
      | /v1/payment-methods |
      | /v1/org/members |
      | /v1/notifications |

  Scenario Outline: Foreign identifiers return 404
    When an "Acme" user calls "GET <route>" with a "Beta" identifier
    Then the response is 404 with problem code "NOT_FOUND" and a body identical to a non-existent identifier
    Examples:
      | route |
      | /v1/shipments/{id} |
      | /v1/quotes/{id} |
      | /v1/address-book/{id} |
      | /v1/documents/{id} |

  Scenario: Unauthenticated access is rejected
    When any account route is called without a session
    Then the response is 401 with problem code "AUTH_REQUIRED"

  Scenario: Search and filters cannot widen the tenant
    When an "Acme" user searches with the filter "organisation_id=Beta"
    Then the parameter is rejected with 400 "VALIDATION_ERROR" or ignored, and no "Beta" data is returned

  Scenario: Route test fails when an account route lacks a denial case
    Given a new account route is added without a cross-tenant test
    Then the CI route-coverage check fails
```

### US-258 — Dashboard with recent shipments, actions needed and monthly spend
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-254, EPIC-10
- **Linked REQs:** REQ-ACCT-001
- **As an** account owner **I want** a dashboard summarising recent activity, items needing action and this month's spend **so that** I see what needs attention.
- **Notes:** 5 most recent shipments; action items: drafts, PENDING_PAYMENT, LABEL_READY without a pickup, EXCEPTION; spend = captured amounts less refunds for the current calendar month per currency. Spend tile needs `payment:read`.

#### Acceptance criteria
```gherkin
Feature: Dashboard
  Scenario: Widgets show data
    Given an Owner of "Acme" with 8 shipments, 2 drafts, 1 EXCEPTION and captured 300.00 EUR less refunded 50.00 EUR this month
    When the dashboard loads
    Then it lists the 5 most recent shipments, an action list with 2 drafts and 1 exception, and spend "250.00 EUR"

  Scenario: Spend is shown per currency
    Given captured 100.00 USD and 80.00 EUR this month
    Then two spend figures are shown, one per currency, and are not summed

  Scenario: Spend tile hidden without payment:read
    Given a user with role "Shipper"
    Then the spend tile is absent from UI and API response

  Scenario: Empty state
    Given a new organisation with no data
    Then the dashboard shows the empty state with a "get a quote" action

  Scenario: Unauthenticated and cross-tenant
    Then an unauthenticated request returns 401 "AUTH_REQUIRED" and figures never include "Beta" data

  Scenario: Month boundary
    Given a capture at 2026-10-31T23:59:59Z viewed on 2026-11-01
    Then it is excluded from the current month spend

  Scenario: Audit
    When the dashboard loads
    Then payment-record reads write a "VIEW" audit entry on entity "payment" for users with payment:read

  Scenario: States, locales and responsive
    Then loading, error, partial (tile failure shows tile-level retry), permission-denied and offline states render, en/es/fr formats apply, tiles stack in one column at 360 px, and axe-core reports no violations
```

### US-259 — Saved quotes list
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** EPIC-08
- **Linked REQs:** REQ-ACCT-005
- **As a** shipper **I want** to see my saved quotes with their expiry **so that** I can reopen, refresh or remove them.
- **Notes:** Permission `quote:read`; delete needs `quote:delete`. Open of an expired quote leads to the re-quote flow (REQ-QUOTE-017, EPIC-08). Quote expiry stays 24 h from creation.

#### Acceptance criteria
```gherkin
Feature: Saved quotes
  Background:
    Given user "ana@acme.test" with role "Shipper" and saved quotes Q1 (active) and Q2 (expired)

  Scenario: List shows route, creation time and expiry
    When Ana opens saved quotes
    Then Q1 and Q2 are listed with route, creation time and expiry, and Q2 is marked "Expired"

  Scenario: Open an expired quote leads to re-quote
    When Ana opens Q2
    Then an expired notice with a "Re-quote" action is shown

  Scenario: Delete a quote
    When Ana deletes Q1 and confirms
    Then Q1 is no longer listed and an audit entry "DELETE" on entity "quote" exists

  Scenario: Role without quote:delete
    Given a user with role "Viewer"
    Then the delete action is absent and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant and unauthenticated
    Then another organisation's quote returns 404 "NOT_FOUND" and an unauthenticated call returns 401 "AUTH_REQUIRED"

  Scenario: Opening writes a VIEW audit entry
    When Ana opens Q1
    Then an audit entry with action "VIEW" and entity "quote" exists

  Scenario: Empty, locales and responsive
    Given no saved quotes
    Then an empty state is shown in en, es and fr, the list is a table at 1280 px and cards at 360 px, and axe-core reports no violations
```

### US-260 — Repeat a past shipment
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-255, EPIC-09
- **Linked REQs:** REQ-ACCT-006
- **As a** shipper **I want** to create a new draft from a past shipment **so that** I do not retype recurring shipments.
- **Notes:** Copies sender, receiver, packages, contents, customs lines, references. Excludes pickup, price, documents. Starts a fresh quote. Cancelled shipments may be repeated. Permission `shipment:create`.

#### Acceptance criteria
```gherkin
Feature: Repeat shipment
  Background:
    Given user "ana@acme.test" with role "Shipper" and a DELIVERED shipment "S1" with 2 packages, 3 customs lines and reference "PO-7788"

  Scenario: Repeat creates a prefilled draft and a new quote
    When Ana selects "Repeat" on "S1"
    Then a new DRAFT exists with the same sender, receiver, packages, contents, customs lines and references
    And it has no pickup, price or documents
    And a new quote request is started and the wizard opens at the quote results

  Scenario: Cancelled shipment can be repeated
    Given shipment "S2" is CANCELLED
    When Ana repeats "S2"
    Then a new DRAFT is created

  Scenario: The original is unchanged
    Then "S1" state, price snapshot and documents are unchanged

  Scenario: Repeat of a lane that no longer returns a service
    Given the new quote returns no options
    Then the draft remains and the user sees alternatives or a "no service" notice

  Scenario: Viewer cannot repeat
    Given a user with role "Viewer"
    Then the action is absent and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant and unauthenticated
    Then repeating another organisation's shipment returns 404 "NOT_FOUND" and an unauthenticated call returns 401 "AUTH_REQUIRED"

  Scenario: Audit
    When Ana repeats "S1"
    Then an audit entry "CREATE" on entity "shipment" for the new draft references the source shipment ID

  Scenario: Restricted references are not copied in clear
    Given "S1" has a receiver tax ID
    Then the new draft requires the tax ID to be confirmed or re-entered and the masked value is not logged
```

### US-261 — Cancel shipment entry point on the detail screen
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-255, EPIC-09
- **Linked REQs:** REQ-ACCT-007
- **As a** shipper **I want** a clear cancel action on the shipment detail **so that** I can cancel a booked shipment and see the refund outcome.
- **Notes:** Cancellation mechanics, window (DR-B20), refund (DR-B21) and error `SHIPMENT_NOT_CANCELLABLE` are EPIC-09 (REQ-BOOK-029/030). This story covers the account UI only: visibility by state and permission `shipment:cancel`, confirmation dialog with refund amount and currency, reason codes CHANGED_MIND, WRONG_ADDRESS, WRONG_SERVICE, OTHER (optional text up to 200 characters), outcome display.

#### Acceptance criteria
```gherkin
Feature: Cancel entry point
  Background:
    Given user "ana@acme.test" with role "Shipper" and a LABEL_READY shipment "S1" paid 134.40 EUR

  Scenario: Action visible only for cancellable states
    Then "Cancel shipment" is shown for BOOKED, LABEL_READY and PICKUP_SCHEDULED
    And it is absent for IN_TRANSIT, DELIVERED and CANCELLED

  Scenario: Confirmation dialog states refund and requires a reason
    When Ana opens the dialog
    Then it shows "134.40 EUR" and a required reason selector with CHANGED_MIND, WRONG_ADDRESS, WRONG_SERVICE, OTHER
    And confirming without a reason shows a field error and sends no request

  Scenario: Note longer than 200 characters
    When Ana enters 201 characters in the note
    Then the form shows a validation error and the request is not sent

  Scenario Outline: Outcome is displayed
    Given the cancellation ends as "<outcome>"
    Then the detail shows "<message>"
    Examples:
      | outcome | message |
      | cancelled | Cancelled |
      | voided | Label voided |
      | refund pending | Refund pending |
      | refunded | Refunded |
      | could not be cancelled | Cancellation could not be completed |

  Scenario: Role without shipment:cancel
    Given a user with role "Viewer"
    Then the action is absent and "POST /v1/shipments/{id}/cancel" returns 403 with problem code "AUTHZ_DENIED"

  Scenario: Cross-tenant and unauthenticated
    Then a foreign shipment returns 404 "NOT_FOUND" and an unauthenticated call returns 401 "AUTH_REQUIRED"

  Scenario: Double click is idempotent
    When Ana confirms twice with the same Idempotency-Key
    Then one cancellation is recorded and the second response equals the first

  Scenario: Race with first scan
    Given the carrier first scan commits before the cancel
    Then the dialog shows "SHIPMENT_NOT_CANCELLABLE" localised and the state is unchanged

  Scenario: Locales, responsive and a11y
    Then the dialog is localised in en, es and fr, is a full-screen sheet at 360 px, traps focus, closes with Escape, and axe-core reports no violations
```

### US-262 — Address book create, edit, delete and search
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** EPIC-09, EPIC-17
- **Linked REQs:** REQ-ACCT-008
- **As a** shipper **I want** a shared address book **so that** I can reuse sender and receiver details.
- **Notes:** Permissions `address_book:read`, `address_book:manage`. Label up to 50 characters; validation per REQ-BOOK-006 country rules. 500 entries per organisation (ASSUMED GAP-B-32). Soft delete. Editing never changes booked shipments (snapshots). Audit `CREATE`/`UPDATE`/`DELETE` on `address_book` entity.

#### Acceptance criteria
```gherkin
Feature: Address book
  Background:
    Given user "ana@acme.test" with role "Shipper" in organisation "Acme"

  Scenario: Create an entry
    When Ana saves label "Berlin office" with a valid DE address, contact and residential flag false
    Then the response is 201 and the entry is listed for all members with "address_book:read"
    And an audit entry "CREATE" on entity "address_book" exists

  Scenario: Invalid address
    When Ana saves a DE address with postcode "ABC"
    Then the response is 400 with problem code "VALIDATION_ERROR" and pointer "/postcode"

  Scenario: Label length boundary
    When Ana saves a label of 51 characters
    Then the response is 400 with pointer "/label"
    And a label of exactly 50 characters is accepted

  Scenario: 501st entry is refused
    Given the organisation has 500 entries
    When Ana creates another
    Then the response is 409 with problem code "LIMIT_EXCEEDED" and the limit 500 in the detail

  Scenario: Edit does not alter booked shipments
    When Ana edits the street of an entry used by a BOOKED shipment
    Then that shipment's sender snapshot is unchanged and an audit entry "UPDATE" exists with changed field names

  Scenario: Soft delete
    When Ana deletes an entry
    Then it disappears from the list and an audit entry "DELETE" exists, while past shipments still show their snapshots

  Scenario Outline: Search
    When Ana searches by <field> "<term>"
    Then matching entries of "Acme" only are returned
    Examples:
      | field | term |
      | name | mari |
      | company | acme |
      | city | berl |
      | label | office |

  Scenario: Viewer can read but not manage
    Given a user with role "Viewer"
    Then the list loads, the create/edit/delete controls are absent and direct calls return 403 "AUTHZ_DENIED"

  Scenario: Unauthenticated and cross-tenant
    Then unauthenticated calls return 401 "AUTH_REQUIRED" and a foreign entry ID returns 404 "NOT_FOUND"

  Scenario: Concurrent edit
    Given two sessions edit the same entry with the same version
    Then the second save returns 412 and the UI shows the newer data

  Scenario: Reads are audited
    When Ana opens an entry detail
    Then an audit entry "VIEW" on entity "address_book" exists (sensitive entity DR-A12)

  Scenario: States, locales and responsive
    Then the six states render, labels are localised in en, es and fr, the list is cards at 360 px and a table at 1280 px, forms are keyboard operable and axe-core reports no violations
```

### US-263 — Default sender address
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-262
- **Linked REQs:** REQ-ACCT-009
- **As a** shipper **I want** one address marked as the default sender **so that** step 1 of the wizard is prefilled.
- **Notes:** At most one default per organisation. Deleting the default clears it. Permission `address_book:manage`.

#### Acceptance criteria
```gherkin
Feature: Default sender
  Background:
    Given user "ana@acme.test" with role "Shipper" and entries A and B

  Scenario: Mark default and prefill
    When Ana marks A as default
    Then wizard step 1 of a new draft has A's details in the sender fields

  Scenario: Only one default
    Given A is the default
    When Ana marks B as default
    Then B is the default and A is not

  Scenario: Clear default
    When Ana clears the default
    Then new drafts have an empty sender

  Scenario: Deleting the default clears it
    When Ana deletes the default entry
    Then no default exists

  Scenario: Concurrent marking leaves exactly one default
    When two users mark different entries as default at the same time
    Then exactly one entry is the default afterwards

  Scenario: Viewer cannot set default
    Given a user with role "Viewer"
    Then the control is absent and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant and unauthenticated
    Then marking a foreign entry returns 404 "NOT_FOUND" and an unauthenticated call returns 401 "AUTH_REQUIRED"

  Scenario: Audit
    When Ana marks A as default
    Then an audit entry "UPDATE" on entity "address_book" records the previous and new default IDs
```

### US-264 — Address book CSV import parsed in the browser
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** M · **Depends on:** US-262
- **Linked REQs:** REQ-ACCT-010
- **As a** shipper **I want** to import addresses from a CSV **so that** I can onboard many contacts at once.
- **Notes:** File up to 1000 rows and 1 MB, parsed in the browser, submitted as structured JSON with a per-row validation report; only valid rows created after confirmation; duplicate detection by label plus postcode; one audit entry per created row. No file upload to the server (D-025).

#### Acceptance criteria
```gherkin
Feature: Address book CSV import
  Background:
    Given user "ana@acme.test" with role "Shipper"

  Scenario: Valid file import with confirmation
    When Ana selects a CSV with 3 valid rows
    Then a preview with a per-row report shows 3 valid rows
    And after she confirms, 3 entries are created and 3 audit entries "CREATE" exist

  Scenario: Mixed validity creates only valid rows
    Given a CSV with 2 valid rows and 1 row with an invalid postcode
    Then the report marks row 3 with its field error and only 2 entries are created on confirmation

  Scenario: File over 1 MB is rejected in the browser
    When Ana selects a 1.2 MB file
    Then an error is shown and no request is sent

  Scenario: More than 1000 rows
    When Ana selects a CSV with 1001 rows
    Then an error states the maximum of 1000 and nothing is imported

  Scenario: Duplicates by label plus postcode
    Given an existing entry "Berlin office" with postcode "10115"
    Then the matching CSV row is flagged duplicate and skipped

  Scenario: Import exceeding the 500-entry limit
    Given 499 entries exist and the CSV has 3 valid rows
    Then the import is refused with "LIMIT_EXCEEDED" or only 1 row is accepted as documented in the report

  Scenario: Server receives JSON only
    Then the network request is application/json with structured rows and no multipart file upload

  Scenario: Viewer denied
    Given a user with role "Viewer"
    Then the import control is absent and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Unauthenticated
    Then the import call returns 401 "AUTH_REQUIRED"

  Scenario: CSV injection characters
    Given a cell begins with "=" or "@"
    Then the value is stored as text and exported or displayed without formula execution

  Scenario: Locales, responsive and a11y
    Then the import dialog is localised in en, es and fr, usable at 360 px and 1280 px, keyboard operable, and axe-core reports no violations
```

### US-265 — Payment methods screen
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** EPIC-10
- **Linked REQs:** REQ-ACCT-011
- **As a** finance user **I want** to manage saved payment methods **so that** checkout is faster.
- **Notes:** Screen only; add/remove/default mechanics are REQ-PAY-014 (EPIC-10). Shows brand, last four digits and expiry only. Permission `payment_method:manage`. Test mode indicator shown. No card data touches Platform servers (EC-B30).

#### Acceptance criteria
```gherkin
Feature: Payment methods screen
  Background:
    Given user "olga@acme.test" with role "Admin" in organisation "Acme" with saved card "Visa 4242 exp 12/2028"

  Scenario: List shows only safe fields
    When Olga opens payment methods
    Then the list shows "Visa", "4242" and "12/2028" and nothing else of the card

  Scenario: Add via the gateway element
    When Olga adds the Stripe fixture test card
    Then the new method is listed and an audit entry "CREATE" on entity "payment_method" exists

  Scenario: Remove and set default
    When Olga sets another method as default and removes the first
    Then exactly one default exists and the removed method is not listed

  Scenario: Card-like fields in a request are rejected
    When a request body contains "card_number"
    Then the response is 400 with problem code "CARD_DATA_NOT_ACCEPTED"

  Scenario: Shipper denied
    Given a user with role "Shipper"
    Then the screen shows the permission-denied state and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant and unauthenticated
    Then a foreign method ID returns 404 "NOT_FOUND" and an unauthenticated call returns 401 "AUTH_REQUIRED"

  Scenario: View is audited
    When Olga opens the screen
    Then an audit entry "VIEW" on entity "payment_method" exists

  Scenario: States, locales and responsive
    Then loading, empty ("no saved methods"), error and offline states render in en, es and fr, cards stack at 360 px, and axe-core reports no violations

  Scenario: Changing a saved method opens the re-authentication dialog (REQ-PAY-014, US-217)
    When Olga adds, sets as default or removes a saved method and the API returns 401 "REAUTH_REQUIRED"
    Then the screen opens the re-authentication dialog
    And after Olga enters her password the screen retries the action and it succeeds

  Scenario: Listing needs no re-authentication
    When Olga opens the payment methods list
    Then the list is shown without a re-authentication dialog
```

### US-266 — Notification preferences with consent records
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** EPIC-15
- **Linked REQs:** REQ-ACCT-012
- **As a** customer **I want** to choose whether I receive tracking update emails **so that** I control my inbox while still receiving security mail.
- **Notes:** `tracking_updates` default on, `marketing` default off; each change stored as a consent record (timestamp, source). Security and transactional emails cannot be turned off (REQ-NOTIF-007). M1 sends no marketing email. Own preferences only, permission `notification_pref:manage`. Flagged: the PRD demo mentions tracking preferences but the REQ is Should. Suppression behaviour is US-288.

#### Acceptance criteria
```gherkin
Feature: Notification preferences
  Background:
    Given user "ana@acme.test" with role "Shipper"

  Scenario: Defaults
    When Ana opens notification preferences for the first time
    Then "tracking_updates" is on and "marketing" is off
    And a note states security and transactional emails cannot be turned off

  Scenario: Toggle tracking updates writes a consent record
    When Ana turns "tracking_updates" off
    Then the preference is saved with a consent record containing timestamp and source "account_settings"
    And an audit entry "UPDATE" on entity "notification_pref" exists with old and new value

  Scenario: Unknown preference key
    When a request sets "security_notices" to false
    Then the response is 400 with problem code "VALIDATION_ERROR" and pointer "/security_notices"

  Scenario: Idempotent save
    When Ana saves the same value twice
    Then only one consent record is added

  Scenario: Only own preferences
    When Ana requests preferences of another user
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Role without notification_pref:manage
    Given a custom role lacking "notification_pref:manage"
    Then the toggles are read-only and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Unauthenticated
    Then the call returns 401 "AUTH_REQUIRED"

  Scenario: Locales, states and a11y
    Then labels are localised in en, es and fr, toggles have accessible names and state, error and offline states keep the previous value and show a retry, and axe-core reports no violations; layout works at 360 px and 1280 px
```

### US-267 — Security settings screen
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** EPIC-02
- **Linked REQs:** REQ-ACCT-013
- **As a** customer **I want** one screen for password, MFA and sessions **so that** I can secure my account.
- **Notes:** Screen and navigation only; operations and rules belong to REQ-AUTH-019 to REQ-AUTH-023 (EPIC-02). Shows warning when 2 or fewer recovery codes remain (REQ-AUTH-016). Remote sign-out takes effect within 5 s.

#### Acceptance criteria
```gherkin
Feature: Security settings screen
  Background:
    Given signed-in user "ana@acme.test"

  Scenario: Screen exposes the three sections
    When Ana opens "Security"
    Then it shows "Change password", "Two-factor authentication" and "Active sessions" with the current session flagged

  Scenario: Change password delegates to the auth operation
    When Ana submits the current and a new 14 character password
    Then the request goes to the auth password-change operation and success is announced in a live region

  Scenario: Weak password feedback
    When Ana submits a password found in the breached list
    Then the field shows the localised "PASSWORD_POLICY" message and no password is logged

  Scenario: MFA enrol and disable
    When Ana enrols TOTP and later disables it after re-authentication
    Then the screen reflects the status after each step

  Scenario: Remote sign-out
    When Ana signs out another session
    Then that session disappears from the list and its next request returns 401 within 5 seconds

  Scenario: Unauthenticated
    When a client without a session opens the route
    Then it is redirected to sign-in and the API returns 401 "AUTH_REQUIRED"

  Scenario: Foreign session ID
    When Ana signs out a session ID of another user
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Session list view is audited
    When Ana opens the sessions list
    Then an audit entry "VIEW" on entity "session" exists

  Scenario: States, locales and responsive
    Then the six states render, labels are localised in en, es and fr, sessions are cards at 360 px and a table at 1280 px, and axe-core reports no violations
```
Permission path: every authenticated user manages only own security; the unauthenticated and foreign-session scenarios above are the denials.

### US-268 — Organisation profile and team invitations
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** EPIC-02, EPIC-03, EPIC-15
- **Linked REQs:** REQ-ACCT-014
- **As an** account owner **I want** to view my organisation and invite, re-role and remove members **so that** colleagues can use the account with the right access.
- **Notes:** Permissions `org:read`, `org:member:manage`. Roles Owner, Admin, Shipper, Finance, Viewer. Invitation token valid 7 days (ASSUMED), single-use, in inviter's locale selection. Not offered for INDIVIDUAL organisations. Removing a member revokes their sessions in this organisation (REQ-AUTH-009). Audit `UPDATE` on `membership` with old and new role. Invitation email: TEAM_INVITATION (event mapping in US-277, EPIC-15); the link carries the token in the URL fragment and acceptance is `POST /invitations/accept {token}` (US-084, D-043).

#### Acceptance criteria
```gherkin
Feature: Organisation profile and team
  Background:
    Given Owner "olga@acme.test" of company organisation "Acme" (country DE, default currency EUR)

  Scenario: View profile
    When Olga opens the organisation page
    Then name "Acme", country "DE" and default currency "EUR" are shown

  Scenario: Invite a member
    When Olga invites "sam@acme.test" as "Shipper" with locale "fr"
    Then an invitation is created valid for 7 days and a TEAM_INVITATION email in French appears in the mail catcher addressed only to "sam@acme.test"

  Scenario: Invitation is single-use and expires
    Given the invitation was accepted once
    When the link is used again, or 8 days later
    Then the response is 400 "TOKEN_INVALID" or 410 "TOKEN_EXPIRED" respectively

  Scenario: Invalid email or role
    When Olga invites "not-an-email" or role "SuperUser"
    Then the response is 400 with problem code "VALIDATION_ERROR" and the matching pointer

  Scenario: Change role and remove member
    When Olga changes Sam to "Viewer" and later removes Sam
    Then audit entries "UPDATE" on entity "membership" record old role "Shipper" and new role "Viewer"
    And Sam's sessions in "Acme" are revoked and the next request returns 401

  Scenario: INDIVIDUAL organisation
    Given an INDIVIDUAL organisation
    Then team management controls are absent and a direct invite call returns 403 with problem code "AUTHZ_DENIED"

  Scenario: Shipper cannot manage members
    Given a user with role "Shipper"
    Then the team page is read-only or hidden and "POST /v1/org/invitations" returns 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant and unauthenticated
    Then a foreign membership ID returns 404 "NOT_FOUND" and an unauthenticated call returns 401 "AUTH_REQUIRED"

  Scenario: Duplicate pending invitation
    When Olga invites an address that already has a pending invitation
    Then the earlier invitation is superseded and exactly one is valid

  Scenario: Audit for profile and member list views
    When Olga opens the organisation page and member list
    Then audit entries "VIEW" on entities "organisation" and "membership" exist

  Scenario: States, locales and responsive
    Then the six states render, labels are localised in en, es and fr, members are cards at 360 px and a table at 1280 px, and axe-core reports no violations

  Scenario Outline: Stale session needs re-authentication for member changes (REQ-ORG-010, REQ-ORG-012, D-046)
    Given Olga's session has "auth_time" 13 hours ago and she sends no re-authentication proof
    When she performs "<action>"
    Then the API returns 401 "REAUTH_REQUIRED" for scope "org.member.manage" with max_age 43200 and nothing changes
    And the screen opens the re-authentication dialog
    When Olga enters her password and the proof is issued
    Then the screen retries the action and it succeeds
    Examples:
      | action                  |
      | invite a member         |
      | resend an invitation    |
      | change a member's role  |
      | remove a member         |

  Scenario: Recently authenticated session is not prompted
    Given Olga's session has "auth_time" 11 hours ago
    When she invites, resends, changes a role and removes a member
    Then no re-authentication dialog appears and every action succeeds

  Scenario: Viewing the member list never prompts
    Given Olga's session has "auth_time" 13 hours ago
    When she opens the organisation page and the member list
    Then the data is shown without a re-authentication dialog
```

### US-269 — Protect the last Owner and block self role change
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-268
- **Linked REQs:** REQ-ACCT-015
- **As an** account owner **I want** the system to prevent leaving the organisation without an Owner **so that** the account cannot be orphaned.
- **Notes:** `422 LAST_OWNER`. A member may not change their own role. Role changes are critical actions requiring re-authentication (EPIC-02). EC-B46.

#### Acceptance criteria
```gherkin
Feature: Last Owner protection
  Background:
    Given organisation "Acme" with sole Owner "olga@acme.test" and Admin "adam@acme.test"

  Scenario: Demoting the last Owner is refused
    When Adam demotes Olga to "Admin"
    Then the response is 422 with problem code "LAST_OWNER" and the roles are unchanged

  Scenario: Removing the last Owner is refused
    When Adam removes Olga
    Then the response is 422 with problem code "LAST_OWNER"

  Scenario: Self role change is refused
    When Olga changes her own role to "Admin"
    Then the response is 403 with problem code "AUTHZ_DENIED" and nothing changes

  Scenario: Two Owners allow demotion
    Given a second Owner exists
    When one Owner is demoted
    Then the response is 200 and exactly one Owner remains

  Scenario: Concurrent demotion of the last two Owners
    When two Owners demote each other at the same time
    Then at least one Owner remains and one request fails with "LAST_OWNER"

  Scenario: Shipper cannot change roles
    Given a user with role "Shipper"
    Then the call returns 403 "AUTHZ_DENIED"

  Scenario: Denied attempts are audited
    When a refused change is attempted
    Then an audit entry with outcome "DENIED" and the reason code exists for entity "membership"
```

### US-270 — Privacy data export
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** EPIC-02
- **Linked REQs:** REQ-ACCT-016
- **As a** customer **I want** to download a JSON export of my data **so that** I can exercise my right of access.
- **Notes:** Lists profile, memberships, addresses, shipments, quotes, preferences and consent records. Excludes other users' data and restricted references (tax/ID). One-time download audited as `DOWNLOAD`. Permission `privacy:export`. Synthetic data only in tests.

#### Acceptance criteria
```gherkin
Feature: Privacy export
  Background:
    Given user "ana@acme.test" with role "Owner"

  Scenario: Request and download once
    When Ana requests an export and opens the download link
    Then a JSON file with sections profile, memberships, addresses, shipments, quotes, preferences and consent records is returned
    And an audit entry "DOWNLOAD" on entity "privacy_export" exists

  Scenario: Link is one-time
    When Ana opens the same link again
    Then the response is 410 with problem code "DOWNLOAD_EXPIRED"

  Scenario: Export excludes other users and restricted references
    Then the file contains no data of other members and no tax or identity references

  Scenario: Role without privacy:export is denied
    Given a user with role "Shipper"
    Then the response is 403 with problem code "AUTHZ_DENIED"

  Scenario: Unauthenticated and cross-tenant
    Then an unauthenticated request returns 401 "AUTH_REQUIRED" and a link of another user returns 404 "NOT_FOUND"

  Scenario: Audit unavailable fails closed
    Given the audit write fails
    Then no link or file is delivered and the response is 503 "AUDIT_UNAVAILABLE"

  Scenario: Repeated request within a minute
    When Ana submits two export requests within 60 seconds
    Then the second returns 429 "RATE_LIMITED" with "Retry-After"

  Scenario: Export request and download require a re-authentication proof (REQ-ACCT-016, D-046)
    Given Ana's session is 5 minutes old
    When she requests an export without "X-Reauth-Proof"
    Then the response is 401 "REAUTH_REQUIRED" for scope "privacy.export" with no age exemption
    And opening a download link without "X-Reauth-Proof" also returns 401 "REAUTH_REQUIRED"

  Scenario: Valid proof accepts the request and audits the one-time download
    Given Ana holds a valid proof for scope "privacy.export"
    When she requests the export and, with a valid proof, opens the download link
    Then the request is accepted
    And the download is served once and an audit entry "DOWNLOAD" on entity "privacy_export" exists

  Scenario: Viewer cannot export
    Given a user with role "Viewer" who lacks "privacy:export"
    Then the request returns 403 "AUTHZ_DENIED" and no export is created
```
Notes on UI: localised in en, es and fr, six states, 360 px and 1280 px, keyboard operable, axe clean.

### US-271 — Privacy account deletion request
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** US-270, EPIC-02
- **Linked REQs:** REQ-ACCT-017
- **As a** customer **I want** to request deletion of my account **so that** my data is removed when I no longer use the service.
- **Notes:** Permission `privacy:delete` (Owner only by default; Admin excluded). Requires re-authentication. Soft delete with 30-day grace; sign-in during grace cancels deletion. Refused while the user owns shipments not in final state (DELIVERED, RETURNED_TO_SENDER, CANCELLED, VOIDED, REFUNDED): `ACCOUNT_HAS_ACTIVE_SHIPMENTS`. Hard deletion jobs are out of scope. EC-B45.

#### Acceptance criteria
```gherkin
Feature: Account deletion request
  Background:
    Given Owner "ana@acme.test" with only final-state shipments

  Scenario: Request after re-authentication
    When Ana re-authenticates and confirms deletion
    Then the account is soft-deleted, all sessions are revoked and a grace period of 30 days is recorded
    And a security-notice email is sent and an audit entry "DELETE" exists

  Scenario: Sign-in during grace cancels deletion
    When Ana signs in on day 10
    Then the deletion is cancelled and a notice is shown

  Scenario: Active shipment blocks the request
    Given Ana owns an IN_TRANSIT shipment
    When she requests deletion
    Then the response is 409 with problem code "ACCOUNT_HAS_ACTIVE_SHIPMENTS" and no grace period starts

  Scenario: Re-authentication missing
    When the request lacks fresh re-authentication proof
    Then the response is 403 with problem code "REAUTH_REQUIRED"

  Scenario: Admin lacks privacy:delete
    Given a user with role "Admin"
    Then the action is absent and a direct call returns 403 "AUTHZ_DENIED"

  Scenario: Unauthenticated
    Then the call returns 401 "AUTH_REQUIRED"

  Scenario: Day 31 boundary
    Given grace ended 1 minute ago without sign-in
    Then the account is flagged for hard deletion by the later job and sign-in is refused

  Scenario: Repeat request is idempotent
    When Ana submits the request twice
    Then one grace period exists
```
Notes on UI: localised in en, es and fr, confirmation dialog with focus trap, 360 px and 1280 px, axe clean.

### US-272 — Locale, display currency and unit preferences
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** EPIC-05
- **Linked REQs:** REQ-ACCT-018
- **As a** customer **I want** to set my language, display currency and unit system **so that** screens and emails match my preferences.
- **Notes:** Persists per user: locale (en, es, fr), display currency (USD, INR, GBP, CAD, EUR), unit system. Defaults: browser language with fallback en; currency and units follow origin country. Emails use the stored locale (REQ-NOTIF-006). Own preferences only.

#### Acceptance criteria
```gherkin
Feature: Locale, currency and unit preferences
  Background:
    Given signed-in user "ana@acme.test" with browser language "es"

  Scenario: Defaults from browser language
    When Ana first opens preferences
    Then locale "es" is preselected

  Scenario: Unsupported browser language falls back to en
    Given browser language "de"
    Then locale "en" is preselected

  Scenario: Save applies everywhere
    When Ana selects locale "fr", currency "GBP" and units "metric"
    Then all screens render in French with GBP formats and kg/cm
    And the next email in the mail catcher is in French

  Scenario: Invalid value
    When a request sets locale "de" or currency "JPY"
    Then the response is 400 with problem code "VALIDATION_ERROR" and the matching pointer

  Scenario: Persistence across devices
    When Ana signs in from another browser
    Then the stored locale is applied

  Scenario: Preference change is audited
    Then an audit entry "UPDATE" on entity "user_preference" with old and new values exists

  Scenario: Unauthenticated and others' preferences
    Then an unauthenticated call returns 401 "AUTH_REQUIRED" and requesting another user's preferences returns 404 "NOT_FOUND"

  Scenario: Switching works at both sizes with a11y
    Then the selectors are usable at 360 px and 1280 px, announce changes via a live region, and axe-core reports no violations
```
Permission path: every authenticated user manages only own preferences; denial scenarios above (401, 404).

### US-273 — No navigation or routes for out-of-scope account areas
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** EPIC-05
- **Linked REQs:** REQ-ACCT-019
- **As a** product owner **I want** invoices, credit notes, wallet, claims and support tickets absent in M1 **so that** there are no silent stubs.
- **Notes:** Unknown routes return the standard 404. These areas arrive in M2/M4.

#### Acceptance criteria
```gherkin
Feature: Out-of-scope account areas are absent
  Scenario: No navigation entries
    Given a signed-in Owner
    When the account navigation renders
    Then it contains no entry for invoices, credit notes, wallet, claims or support tickets

  Scenario Outline: Routes return 404
    When an authenticated user requests "<path>"
    Then the response is 404 with problem code "NOT_FOUND"
    Examples:
      | path |
      | /v1/invoices |
      | /v1/credit-notes |
      | /v1/wallet |
      | /v1/claims |
      | /v1/support-tickets |

  Scenario: UI routes show the standard not-found page
    When a user opens "/account/wallet"
    Then the localised not-found page is shown in en, es and fr

  Scenario: OpenAPI contains none of these paths
    Then the generated OpenAPI document has no path under those prefixes

  Scenario: Unauthenticated gets the same 404 or 401 as any unknown route
    When an unauthenticated client requests "/v1/wallet"
    Then the response is 401 "AUTH_REQUIRED" or 404 consistently with other unknown authenticated prefixes, as documented
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-ACCT-001 | US-258 |
| REQ-ACCT-002 | US-254 |
| REQ-ACCT-003 | US-255 |
| REQ-ACCT-004 | US-256 |
| REQ-ACCT-005 | US-259 |
| REQ-ACCT-006 | US-260 |
| REQ-ACCT-007 | US-261 |
| REQ-ACCT-008 | US-262 |
| REQ-ACCT-009 | US-263 |
| REQ-ACCT-010 | US-264 |
| REQ-ACCT-011 | US-265 |
| REQ-ACCT-012 | US-266 |
| REQ-ACCT-013 | US-267 |
| REQ-ACCT-014 | US-268 |
| REQ-ACCT-015 | US-269 |
| REQ-ACCT-016 | US-270 |
| REQ-ACCT-017 | US-271 |
| REQ-ACCT-018 | US-272 |
| REQ-ACCT-019 | US-273 |
| REQ-ACCT-020 | US-257 |

Every Must REQ (REQ-ACCT-002, 003, 004, 020) is linked by at least one Must story (US-254, US-255, US-256, US-257).
