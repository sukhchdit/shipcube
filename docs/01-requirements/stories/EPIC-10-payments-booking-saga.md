# EPIC-10 — Payments and booking saga

- **Goal:** An order is paid by authorise-then-capture and booked with the carrier exactly once, with every state change audited, so that a captured payment never exists without a booked shipment and a retry never buys a second label.
- **Milestone(s):** M0+M1. The M0 slice (US-197..US-205: state machine, history, Mock gateway, payment record, order number, Mock-carrier saga via API -> queue -> worker, idempotent replay, compensation, createShipment failure handling) is separable and depends only on Mock providers. US-206..US-219 are M1.
- **REQ areas covered:** REQ-PAY (all rows 001-019) and the REQ-BOOK rows listed below.
- **REQ-BOOK split:** EPIC-10 owns REQ-BOOK-016, 018, 019, 020, 021, 022, 023, 024, 025, 026, 030. EPIC-09 owns REQ-BOOK-001..015, 017, 027, 028, 029 (wizard, drafts, order model, confirmation page, self-service cancellation). Each REQ-BOOK row is linked in exactly one of the two coverage tables.
- **Exit-demo contribution:** PRD 6.1 scenario "One mock booking flows API -> queue -> worker" (US-197..US-205). PRD 6.2 payment steps: Stripe test card with 3-D Secure, PAID, BOOKED, LABEL_READY (US-208..US-214).
- **Depends on epics:** EPIC-01 (PLAT: queue, outbox, worker), EPIC-02 (AUTH), EPIC-03 (ORG/RBAC/RLS), EPIC-04 (AUDIT), EPIC-05 (UI/I18N), EPIC-06 (CARR: Mock carrier, adapters), EPIC-07 (PRICE: snapshots), EPIC-08 (QUOTE: expiry), EPIC-09 (wizard/order), EPIC-11 (documents), EPIC-12 (pickup), EPIC-15 (NOTIF), EPIC-16 (API/SEC: Idempotency-Key, problem+json, rate limit), EPIC-17 (DATA).

## Conventions used in the acceptance criteria

- "customer" = signed-in user with `shipment:create` and `payment:create` (Owner, Admin, Shipper); "Viewer" lacks both. 401 `AUTH_REQUIRED`, 403 `AUTHZ_DENIED`, 404 `NOT_FOUND` for other organisations (DR-A26). Idempotency per DR-A20 (replay header `Idempotent-Replayed: true`, mismatch 422 `IDEMPOTENCY_KEY_REUSED`, in progress 409 `IDEMPOTENCY_IN_PROGRESS`).
- Order numbers: `<ISO alpha-2 origin>-<8 digits><Luhn check digit>` per REQ-DATA-015 / DR-A24, for example `US-123456782` (payload 12345678, check digit 2).
- Mock gateway tokens: `mock_ok`, `mock_decline`, `mock_3ds`, `mock_3ds_fail`, `mock_capture_fail`, `mock_refund_fail`. Mock carrier directives (`X-Mock-Scenario`): `fail=booking|void|pickup|cancel_pickup`, `error=<canonical code>`, `latency=<ms>`.
- Stripe scenarios run against recorded fixtures; the single `@live-sandbox` scenario (COND-SANDBOX-DEMO) is on US-214.
- Guarantees G1-G4 are DR-B04. "UI standard" = en/es/fr, six screen states, 360 px (one step per screen, sticky primary action, sticky price summary) and 1280 px, keyboard operable, axe clean.
- Domain error codes without a stated HTTP status use 422 (assumption logged in the Handoff Report).

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-197 | Shipment state machine core | M0 | Must | M | EPIC-01 | REQ-BOOK-018 | DC |
| US-198 | Transition history and same-transaction audit | M0 | Must | S | US-197, EPIC-04 | REQ-BOOK-019 | DC |
| US-199 | Payment gateway interface and deterministic Mock gateway | M0 | Must | M | EPIC-01 | REQ-PAY-001, REQ-PAY-002 | DC |
| US-200 | Payment record with status history | M0 | Must | S | US-199 | REQ-PAY-003 | DC |
| US-201 | Order number allocation | M0 | Must | S | EPIC-17 | REQ-BOOK-026 | DC |
| US-202 | Mock booking saga end to end (API, queue, worker) | M0 | Must | M | US-197, US-198, US-199, US-200, US-201, EPIC-06 | REQ-BOOK-020 | DC |
| US-203 | Saga idempotent replay and one carrier shipment | M0 | Must | M | US-202 | REQ-BOOK-021 | DC |
| US-204 | Saga compensation on permanent failure | M0 | Must | M | US-202 | REQ-BOOK-022 |  |
| US-205 | createShipment retry, definitive rejection and ambiguous outcome | M0 | Must | S | US-204 | REQ-BOOK-023 |  |
| US-206 | Partial capture for multi-shipment orders | M1 | Must | S | US-204 | REQ-BOOK-024 |  |
| US-207 | Booking progress status and event stream | M1 | Must | S | US-202 | REQ-BOOK-025 | DC |
| US-208 | Checkout gate: verified email, unexpired quotes, complete steps | M1 | Must | M | US-201, EPIC-02, EPIC-09 | REQ-BOOK-016, REQ-PAY-007 | DC |
| US-209 | Server-computed amount and authorise-then-capture | M1 | Must | M | US-199, US-200, US-208 | REQ-PAY-006, REQ-PAY-008 | DC |
| US-210 | Stripe adapter: test keys only, fixture-backed | M1 | Must | M | US-199 | REQ-PAY-004, REQ-PAY-017 | DC |
| US-211 | No card data on the Platform API, card-only methods | M1 | Must | S | US-209 | REQ-PAY-005, REQ-PAY-019 |  |
| US-212 | 3-D Secure, declines and attempt limit | M1 | Must | M | US-209, US-210 | REQ-PAY-009, REQ-PAY-010 | DC |
| US-213 | Webhook verification, deduplication and replay | M1 | Must | M | US-210 | REQ-PAY-011, REQ-PAY-012 | DC |
| US-214 | Checkout screen (step 6) with test-mode indicator | M1 | Must | M | US-209, US-211, US-212 | REQ-PAY-016, REQ-PAY-017 | DC |
| US-215 | EXCEPTION handling and automatic void retry | M1 | Should | M | US-204 | REQ-BOOK-030 |  |
| US-216 | Automatic full refund after cancellation | M1 | Should | M | US-215, EPIC-09 | REQ-PAY-013 |  |
| US-217 | Saved payment methods | M1 | Should | M | US-210 | REQ-PAY-014 |  |
| US-218 | Payment receipt | M1 | Should | S | US-209, EPIC-15 | REQ-PAY-015 |  |
| US-219 | Authorisation and capture sweeper | M1 | Should | S | US-204 | REQ-PAY-018 |  |

Counts: 23 stories. Must 18 (US-197..US-214), Should 5 (US-215..US-219), Could 0.

## Stories

### US-197 — Shipment state machine core
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-BOOK-018
- **As a** developer **I want** one service-layer state machine **so that** no code path can move a shipment through an illegal state.
- **Notes:** Transition table DR-B01. CLAIM_OPEN exists but nothing in M1 enters it.

#### Acceptance criteria
```gherkin
Feature: Shipment state machine core
  Scenario Outline: Permitted transitions succeed
    Given a shipment in <from>
    When the service layer requests a transition to <to>
    Then the shipment is in <to>
    Examples:
      | from            | to              |
      | DRAFT           | QUOTED          |
      | QUOTED          | PENDING_PAYMENT |
      | PENDING_PAYMENT | PAID            |
      | PAID            | BOOKING         |
      | BOOKING         | BOOKED          |
      | BOOKED          | LABEL_READY     |
      | BOOKING         | EXCEPTION       |
      | CANCELLED       | VOIDED          |
      | VOIDED          | REFUNDED        |

  Scenario Outline: Illegal transitions are rejected unchanged
    Given a shipment in <from>
    When a transition to <to> is requested
    Then the response is 409 "ILLEGAL_STATE_TRANSITION" and the shipment state and version are unchanged
    Examples:
      | from      | to          |
      | DRAFT     | BOOKED      |
      | PAID      | LABEL_READY |
      | DELIVERED | IN_TRANSIT  |
      | REFUNDED  | CANCELLED   |

  Scenario: Exhaustive matrix
    Then a generated test covers every ordered pair of the 19 states and permits exactly the pairs of DR-B01

  Scenario: State cannot be set directly through the API
    When a customer sends PATCH /shipments/{id} with {"state":"BOOKED"}
    Then the response is 400 "VALIDATION_ERROR" (unknown field) and the state is unchanged

  Scenario: Cancel needs the permission
    When a Viewer or a role without "shipment:cancel" requests cancel
    Then the response is 403 "AUTHZ_DENIED"; an unauthenticated call gets 401 "AUTH_REQUIRED"; another organisation's shipment gets 404 "NOT_FOUND"

  Scenario: Concurrent transitions
    Given two workers request different transitions from BOOKED at once
    Then exactly one commits and the other receives 409 "ILLEGAL_STATE_TRANSITION" or 412 "CONCURRENCY_CONFLICT"
```

### US-198 — Transition history and same-transaction audit
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-197, EPIC-04
- **Linked REQs:** REQ-BOOK-019
- **As a** Compliance Auditor **I want** every state change recorded with who, why and when **so that** I can prove what happened to a shipment.

#### Acceptance criteria
```gherkin
Feature: Transition history and audit
  Scenario: Every transition writes history and audit together
    When a shipment moves PENDING_PAYMENT to PAID by trigger PAYMENT_EVENT
    Then one history row holds shipment, from-state, to-state, trigger, actor type and ID, correlation ID, timestamp and reason code
    And one audit entry with action UPDATE on entity "shipment", from-state, to-state, trigger and actor exists in the same transaction

  Scenario Outline: Triggers
    When a transition is caused by <cause>
    Then the history trigger is <trigger>
    Examples:
      | cause                      | trigger        |
      | customer cancels           | USER_ACTION    |
      | worker finishes a saga step| SAGA_STEP      |
      | carrier tracking event     | CARRIER_EVENT  |
      | gateway webhook            | PAYMENT_EVENT  |
      | saga deadline of 30 minutes| SYSTEM_TIMEOUT |

  Scenario: Audit write failure rolls the transition back
    Given the audit insert fails
    Then the state change and history row are rolled back and the response is 500 "AUDIT_WRITE_FAILED"

  Scenario: History is append-only
    When any database role attempts UPDATE or DELETE on a history row
    Then it fails and an audit entry records the denied attempt

  Scenario: Timeline read permission
    Then the timeline is returned with "shipment:read"; a role without it gets 403 "AUTHZ_DENIED"; unauthenticated 401; another organisation 404 "NOT_FOUND"
    And a timeline read writes VIEW on "shipment"
```

### US-199 — Payment gateway interface and deterministic Mock gateway
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-PAY-001, REQ-PAY-002
- **As a** developer **I want** a gateway interface and a Mock gateway **so that** the M0 saga and all payment failure paths run without Stripe.

#### Acceptance criteria
Permission path: not applicable — library and in-process adapter exercised by the system actor and contract tests; end-user permission scenarios are in US-209 and US-211. A second negative scenario is included.
```gherkin
Feature: Gateway interface and Mock gateway
  Scenario: Mock is the default without a Stripe key
    Given no Stripe key is configured in a non-production environment
    Then the Mock gateway is registered and active

  Scenario Outline: Token selects a deterministic outcome
    When an authorisation of 4200 USD minor units is requested with token <token>
    Then the result is <result>
    Examples:
      | token             | result                                     |
      | mock_ok           | AUTHORISED                                 |
      | mock_decline      | declined with CARD_DECLINED                |
      | mock_3ds          | REQUIRES_ACTION with a client secret       |
      | mock_3ds_fail     | FAILED after the challenge is failed       |
      | mock_capture_fail | AUTHORISED, then capture fails             |
      | mock_refund_fail  | CAPTURED, then refund fails                |

  Scenario: Every state-changing call carries money and an idempotency key
    When capture, void or refund is called without an idempotency key or with a non-integer amount
    Then the call is rejected with a typed error before reaching the gateway

  Scenario: Repeating a call with the same key returns the same result
    When authorise is called twice with the same idempotency key
    Then one authorisation exists and both calls return it

  Scenario: Partial capture
    Given an authorisation of 10000
    When 6000 is captured
    Then the status is PARTIALLY_CAPTURED and the remaining 4000 can be voided

  Scenario: Mock tokens are rejected in production
    Given the environment is production
    When the token "mock_ok" is used
    Then the request is rejected and the Mock gateway is not registered

  Scenario: Contract suite
    Then the same gateway contract suite passes against the Mock gateway and, in US-210, the Stripe fixtures
```

### US-200 — Payment record with status history
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-199
- **Linked REQs:** REQ-PAY-003
- **As a** finance officer **I want** one payment record per order with a status history **so that** every money movement is traceable.

#### Acceptance criteria
```gherkin
Feature: Payment record
  Scenario: Record created with history
    When an order is authorised
    Then one payment exists with amount, currency, gateway, gateway references and status AUTHORISED, and a history row CREATED -> AUTHORISED

  Scenario Outline: DR-B27 transitions
    Given a payment in <from>
    When the status changes to <to>
    Then the outcome is <outcome>
    Examples:
      | from       | to         | outcome  |
      | CREATED    | AUTHORISED | accepted |
      | AUTHORISED | CAPTURED   | accepted |
      | CAPTURED   | AUTHORISED | rejected |
      | VOIDED     | CAPTURED   | rejected |
      | REFUND_FAILED | REFUND_PENDING | accepted |

  Scenario: Raw payload is not stored on the row
    Then a redacted copy is stored in object storage and the payment row holds only its reference

  Scenario: Read permission
    Then "payment:read" returns the record; a role without it gets 403 "AUTHZ_DENIED"; unauthenticated gets 401; another organisation gets 404 "NOT_FOUND"

  Scenario: Audit
    Then each status change writes UPDATE on "payment" and viewing writes VIEW; no card data or gateway secret appears in audit values
```

### US-201 — Order number allocation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-17
- **Linked REQs:** REQ-BOOK-026
- **As a** customer **I want** a short unique order number **so that** I can quote it to support and see it on documents.
- **Notes:** DR-B22 with format ruling REQ-DATA-015 / DR-A24 (Luhn check digit). Gaps allowed; not a tax invoice number.

#### Acceptance criteria
```gherkin
Feature: Order number allocation
  Scenario: Allocated when checkout starts
    When checkout starts for an order with origin US
    Then the order number matches ^US-[0-9]{8}[0-9]$ and its last digit is the valid Luhn check digit of the 8-digit payload (for example "US-123456782")

  Scenario: One sequence per origin country
    When orders start checkout for US and IN
    Then each country's payload increments independently

  Scenario: Concurrent allocation is unique
    When 50 checkouts start simultaneously for origin US
    Then 50 distinct order numbers exist

  Scenario: Never reused and gaps allowed
    Given a checkout transaction rolled back after allocation
    Then that number is never issued again

  Scenario: Not consumed by a blocked checkout
    Given the account email is unverified
    When checkout is attempted
    Then the response is 403 "EMAIL_NOT_VERIFIED" and no order number is allocated

  Scenario: Same order keeps its number on retry
    When checkout is started twice for the same order with the same Idempotency-Key
    Then the second response replays the first and shows the same order number

  Scenario: Permission paths
    Then unauthenticated gets 401 "AUTH_REQUIRED", a Viewer gets 403 "AUTHZ_DENIED", another organisation's order gets 404 "NOT_FOUND"

  Scenario: Audit
    Then allocation writes an UPDATE on "order" containing the number
```

### US-202 — Mock booking saga end to end (API, queue, worker)
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-197, US-198, US-199, US-200, US-201, EPIC-06
- **Linked REQs:** REQ-BOOK-020
- **As a** signed-in customer **I want** to book a Mock quote through the API **so that** the platform proves the full booking path in M0 (PRD 6.1).
- **Notes:** Saga steps per DR-B03: authorise, create carrier shipment, capture, generate documents, schedule pickup, notify. Triggered via the outbox. M0 uses the Mock carrier and Mock gateway only.

#### Acceptance criteria
```gherkin
Feature: Mock booking saga
  Background:
    Given a signed-in customer with "shipment:create" and "payment:create" and a complete shipment from an unexpired Mock quote

  Scenario: Happy path through the worker
    When the customer POSTs the booking with Idempotency-Key "k1" and token "mock_ok"
    Then the response is 202 with the order number
    And the shipment moves DRAFT -> QUOTED -> PENDING_PAYMENT -> PAID -> BOOKING -> BOOKED -> LABEL_READY
    And the worker called the Mock carrier createShipment exactly once
    And payment status is CAPTURED for the booked amount
    And the saga persisted each step outcome with attempt counts

  Scenario: Restarted worker resumes at the first incomplete step
    Given the worker is killed after the carrier shipment was created and before capture
    When it restarts
    Then it resumes at the capture step and makes no second carrier call

  Scenario: Missing Idempotency-Key
    When the booking is sent without the header
    Then the response is 400 "IDEMPOTENCY_KEY_REQUIRED"

  Scenario: Expired quote
    Given the quote expired 1 minute ago
    Then the response is 409 "QUOTE_EXPIRED" and no authorisation exists

  Scenario: Unauthenticated, Viewer and cross-tenant
    Then an unauthenticated booking gets 401 "AUTH_REQUIRED", a Viewer gets 403 "AUTHZ_DENIED", another organisation's quote gets 404 "NOT_FOUND"

  Scenario: Every transition is audited
    Then the audit viewer lists one UPDATE entry per transition above with trigger, actor (user then system worker), correlation ID and outcome SUCCESS, plus carrier_call entries for the Mock call

  Scenario: Saga deadline
    Given the Mock carrier stalls with "latency=30000" beyond the 30-minute saga deadline
    Then the shipment is moved by trigger SYSTEM_TIMEOUT and the authorisation is released
```

### US-203 — Saga idempotent replay and one carrier shipment
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-202
- **Linked REQs:** REQ-BOOK-021
- **As the** operator **I want** retries and duplicate deliveries to never buy a second label **so that** guarantee G2 (DR-B04) holds.

#### Acceptance criteria
```gherkin
Feature: Idempotent booking
  Scenario: Replay with the same key returns the same order
    Given booking "k1" succeeded
    When the same request is sent again within 24 hours
    Then the response is the stored response with header "Idempotent-Replayed: true", the same order number, and still one carrier shipment

  Scenario: Same key with a different body
    When key "k1" is reused with a different shipment
    Then the response is 422 "IDEMPOTENCY_KEY_REUSED" and nothing changes

  Scenario: Same key while the first request is in progress
    Then the second request gets 409 "IDEMPOTENCY_IN_PROGRESS"

  Scenario: Retry never buys a second label
    Given the booking attempt record with client reference "CR-1" was persisted before the first carrier call
    When the job is delivered twice and the worker restarts mid-saga
    Then the Mock carrier holds exactly one shipment and one label for "CR-1", and every retry passes "CR-1"
    And the audit trail shows one booking

  Scenario: Carrier without idempotent create
    Given the capability "idempotent create" is false and the first call timed out
    Then the saga does not auto-retry the call (see US-205)

  Scenario: 5xx responses are not stored
    Given the first attempt fails with 500
    Then retrying with the same key runs the booking again

  Scenario: Permission paths
    Then replay across organisations never leaks: the same key from another organisation is treated as new (key scope includes organisation and actor); unauthenticated gets 401; a Viewer gets 403 "AUTHZ_DENIED"
```

### US-204 — Saga compensation on permanent failure
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-202
- **Linked REQs:** REQ-BOOK-022
- **As the** operator **I want** failures to unwind money and carrier state **so that** no customer is charged for a shipment that does not exist (guarantee G1).
- **Notes:** DR-B03, EC-B02, EC-B03.

#### Acceptance criteria
```gherkin
Feature: Saga compensation
  Scenario: Carrier booking fails permanently
    Given Mock "fail=booking;error=INVALID_ADDRESS"
    When the booking runs
    Then the authorisation is voided, no capture occurs, no carrier shipment exists, the shipment returns to DRAFT with canonical error "INVALID_ADDRESS" and the customer is notified

  Scenario: Capture fails after the carrier shipment exists
    Given token "mock_capture_fail"
    Then the carrier shipment is cancelled, the authorisation is voided and the shipment goes CANCELLED then VOIDED
    And the customer is never charged

  Scenario: Guarantee G1 - no captured payment without a booked shipment
    Given failure is injected at each of the steps authorise, create, capture, documents, pickup and notify in turn
    Then in every run either (payment CAPTURED and shipment in BOOKED or later) or (payment not CAPTURED and shipment not BOOKED)

  Scenario: Void of the carrier shipment fails during compensation
    Given Mock "fail=void" and token "mock_capture_fail"
    Then the shipment goes to EXCEPTION flagged "needs_review", the authorisation is still voided and no charge exists

  Scenario: Steps 4 to 6 never undo the booking
    Given document generation fails permanently
    Then the shipment stays BOOKED with documents pending and no compensation runs

  Scenario: Permission paths
    Then a customer cannot trigger compensation directly: POST /sagas/{id}/compensate returns 404 "NOT_FOUND" (no such route) and the compensation actor is always "system"

  Scenario: Audit
    Then each compensation effect writes an audit entry (UPDATE on "payment" VOIDED, carrier_call cancelShipment, UPDATE on "shipment") with trigger SAGA_STEP and the failing step
```

### US-205 — createShipment retry, definitive rejection and ambiguous outcome
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-204
- **Linked REQs:** REQ-BOOK-023
- **As a** customer **I want** transient carrier failures retried and unclear outcomes handled safely **so that** I am neither double-booked nor left charged.
- **Notes:** `CARRIER_BUSY` (bulkhead overflow or quota-guard refusal, US-130, US-293) is a local admission rejection with no network call: retryable and non-ambiguous, outside the 5 transient retries (REQ-BOOK-023, DR-B03 step 2, EC-B48, D-048). A guest flood can delay a paid booking but never fail it before the 30-minute deadline.

#### Acceptance criteria
```gherkin
Feature: createShipment failure handling
  Scenario: Transient failure is retried with backoff
    Given the Mock carrier fails the first 2 createShipment calls with TIMEOUT on a carrier with idempotent create
    Then the saga retries with delays based on base 2 s, factor 2, full jitter and 60 s cap, succeeds on attempt 3 and creates one shipment

  Scenario: Retries are bounded
    Given the carrier fails every call transiently
    Then after 5 retries the saga treats the failure as permanent and compensates (US-204)

  Scenario: Definitive rejection
    Given Mock "fail=booking;error=SERVICE_UNAVAILABLE" returned as a definitive rejection
    Then the shipment returns to DRAFT with that canonical code, the authorisation is released and the customer is notified

  Scenario: Ambiguous outcome on a non-idempotent carrier
    Given the capability "idempotent create" is false and the call times out
    Then the saga does not retry, releases the authorisation, moves the shipment to EXCEPTION, flags "needs_review", increments the exception metric and raises an alert

  Scenario: Whole saga deadline
    Then a saga exceeding 30 minutes is stopped with trigger SYSTEM_TIMEOUT

  Scenario: Permission paths
    Then the retry policy is system-only configuration: a customer calling it directly gets 404 "NOT_FOUND"; unauthenticated 401

  Scenario: CARRIER_BUSY from the transactional bulkhead is retried without counting against transient retries
    Given the transactional pool of the carrier account is full and createShipment is rejected locally with CARRIER_BUSY (no network call is made)
    When the saga step runs repeatedly
    Then each rejection is retried with full-jitter backoff (2 s base, 60 s cap) until the 30-minute saga deadline
    And these rejections do not count against the 5 transient retries
    And the shipment never enters DRAFT or EXCEPTION because of CARRIER_BUSY
    And the authorisation is not released while the saga is still retrying

  Scenario: A quota-guard refusal is treated like CARRIER_BUSY
    Given the carrier account's daily quota is above 90 percent and the guard refuses a non-transactional call, or the transactional pool refuses locally
    When createShipment is rejected with a local admission rejection
    Then it is classified retryable and non-ambiguous, not as a definitive rejection or an ambiguous outcome
    And it is retried with backoff until the saga deadline

  Scenario: Booking succeeds once the pool frees within the deadline
    Given createShipment is rejected with CARRIER_BUSY 4 times and then admitted
    Then exactly one carrier shipment is created, payment is captured once and the shipment reaches BOOKED
    And the transient retry counter is still 0

  Scenario: Deadline passes while the carrier stays busy
    Given the carrier account stays busy for longer than 30 minutes
    When the saga deadline passes
    Then the saga compensates with trigger SYSTEM_TIMEOUT
    And the authorisation is released
    And the shipment returns to DRAFT with the canonical code CARRIER_BUSY and the customer is notified
    And one transition-history and audit entry records the DRAFT transition with trigger SYSTEM_TIMEOUT

  Scenario: Guest flood does not block a paid booking
    Given a guest rate-shopping flood saturates the rates pool of the carrier account (Mock latency on rates)
    When a paid booking reaches saga step 2 for the same account
    Then createShipment is admitted through the separate transactional pool and the shipment reaches BOOKED
```

### US-206 — Partial capture for multi-shipment orders
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-204
- **Linked REQs:** REQ-BOOK-024
- **As a** business customer **I want** only booked shipments charged when one fails **so that** I pay for what I received.
- **Notes:** EC-B15, DR-B33.

#### Acceptance criteria
```gherkin
Feature: Partial capture
  Scenario: Second of three bookings fails
    Given an order of three shipments authorised for 3 x 4000 USD minor units and Mock "fail=booking" applies to shipment 2
    When the saga runs
    Then shipments 1 and 3 are BOOKED and captured for 4000 each, the remaining 4000 of the authorisation is released, shipment 2 is DRAFT with its error, and the payment is PARTIALLY_CAPTURED

  Scenario: Customer view
    Then the confirmation page shows per-shipment results and the amount actually charged (8000)

  Scenario: All fail
    Given every shipment fails
    Then the authorisation is fully voided and no capture exists

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED", another organisation's order gets 404 "NOT_FOUND"

  Scenario: Audit
    Then the payment UPDATE entry records captured and released amounts
```

### US-207 — Booking progress status and event stream
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-202
- **Linked REQs:** REQ-BOOK-025
- **As a** customer **I want** to watch my booking progress **so that** I know it is working.

#### Acceptance criteria
```gherkin
Feature: Booking progress
  Scenario: Steps update within 2 seconds
    When the saga completes the step "create carrier shipment"
    Then the status resource and the server-sent event stream show it as "done" within 2 seconds, other steps "pending" or "failed"

  Scenario: Polling fallback
    Given server-sent events are blocked
    Then the client polls every 3 seconds and shows the same status

  Scenario: Failed step
    Given a step failed
    Then it shows "failed" with the canonical reason and the next action

  Scenario: Permission paths
    Then "shipment:read" is required (403 "AUTHZ_DENIED" otherwise), unauthenticated gets 401, another organisation's shipment gets 404 "NOT_FOUND" on both the status resource and the stream

  Scenario: UI states
    Then the confirmation page shows loading, error, offline (stream reconnect) and permission-denied states in en/es/fr, axe clean at 360 px and 1280 px
```

### US-208 — Checkout gate: verified email, unexpired quotes, complete steps
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-201, EPIC-02, EPIC-09
- **Linked REQs:** REQ-BOOK-016, REQ-PAY-007
- **As the** operator **I want** checkout blocked until the account is verified and every shipment is valid **so that** unverified or stale orders never reach payment (D-009).
- **Notes:** EC-B05, EC-B43. Server-side rule; the UI mirrors it.

#### Acceptance criteria
```gherkin
Feature: Checkout gate
  Scenario: All conditions met
    Given verified email, unexpired quotes and complete steps 1 to 5 for every shipment
    When checkout starts
    Then the order moves to checkout, the order number is allocated and shipments go QUOTED -> PENDING_PAYMENT

  Scenario: Unverified email
    When an unverified user starts checkout
    Then the response is 403 "EMAIL_NOT_VERIFIED" with a resend-verification action, no order number is consumed and drafts and addresses remain editable
    And creating a payment directly also returns 403 "EMAIL_NOT_VERIFIED"

  Scenario: Expired quote
    Given one shipment's quote expired
    Then the response is 409 "QUOTE_EXPIRED", that shipment returns to DRAFT, no authorisation is created and the user is offered a re-quote showing the price difference

  Scenario: Incomplete step
    Given step 3 is incomplete
    Then the response is 422 "VALIDATION_ERROR" naming the blocking shipment and step, and the UI shows a resolve action

  Scenario: Prohibited item re-checked at checkout
    Given the prohibited list changed after step 2
    Then the response is 422 "ITEM_PROHIBITED" and checkout is blocked

  Scenario: Missing DG attestation
    Then the response is 422 "DG_ATTESTATION_REQUIRED"

  Scenario: Permission paths
    Then unauthenticated gets 401 "AUTH_REQUIRED", a Viewer gets 403 "AUTHZ_DENIED", another organisation's order gets 404 "NOT_FOUND"

  Scenario: Audit
    Then a blocked checkout writes an audit entry with outcome DENIED and the blocking code; a successful start writes UPDATE on "order"

  Scenario: UI standard
    Then the blocking messages and actions are announced and pass the UI standard (en/es/fr, 360 px and 1280 px)
```

### US-209 — Server-computed amount and authorise-then-capture
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-199, US-200, US-208
- **Linked REQs:** REQ-PAY-006, REQ-PAY-008
- **As the** operator **I want** the charged amount computed on the server and funds held, not taken, until the carrier confirms **so that** customers are never charged for failed bookings.

#### Acceptance criteria
```gherkin
Feature: Amount and authorise-then-capture
  Scenario: Amount from stored snapshots
    Given an order of two shipments with gross totals 4000 and 2500 USD minor units
    When the customer pays with token "mock_ok"
    Then the authorised amount is 6500 USD and any client-supplied amount is ignored

  Scenario: Client amount differs
    When the client sends amount 100
    Then the response is 409 "AMOUNT_MISMATCH"

  Scenario: Amount below the gateway minimum
    Given the order total is 40 USD cents
    Then the response is 422 "AMOUNT_BELOW_MINIMUM"

  Scenario: Authorise without capture, capture after carrier confirmation
    Then the payment is AUTHORISED when the shipment is PAID, and CAPTURED only after the carrier confirms (BOOKED)

  Scenario: Authorisation released after 30 minutes
    Given an authorisation without capture for 30 minutes
    Then it is cancelled and the payment becomes VOIDED

  Scenario: Permission paths
    Then "payment:create" is required (403 "AUTHZ_DENIED" for Viewer), unauthenticated gets 401, another organisation's order gets 404 "NOT_FOUND"

  Scenario: Audit
    Then creating the payment, authorisation, capture and void each write a payment audit entry (PAYMENT_EVENT triggers on the shipment) with no card data

  Scenario: Idempotency
    Then repeating the payment request with the same Idempotency-Key creates one authorisation
```

### US-210 — Stripe adapter: test keys only, fixture-backed
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-199
- **Linked REQs:** REQ-PAY-004, REQ-PAY-017
- **As the** operator **I want** a Stripe adapter that can never touch live money **so that** development and demos are safe (CLAUDE.md section 5).
- **Notes:** The live Stripe test run including 3DS test cards is COND-SANDBOX-DEMO, covered by the tagged scenario in US-214.

#### Acceptance criteria
Permission path: not applicable — start-up validation and adapter behaviour run as the system; there is no end-user principal. A second negative scenario is included.
```gherkin
Feature: Stripe adapter
  Scenario: Test key accepted
    Given a configured key with prefix "sk_test_" (secret reference)
    Then the adapter starts and reports livemode false

  Scenario: Live key forbidden
    Given a configured key with a live-mode prefix
    Then start-up aborts with "PAYMENT_LIVE_KEY_FORBIDDEN" naming the setting only and no network call is made

  Scenario: Fixture-backed by default
    Given no Stripe key is configured
    Then create, confirm, capture, cancel, refund, retrieve and webhook payload cases pass against recorded or synthesised fixtures and the gateway contract suite passes

  Scenario: Live Stripe test API only when enabled
    Given STRIPE_TEST_LIVE is not "1"
    Then no request is sent to api.stripe.com in any test

  Scenario: Secrets never exposed
    Then the key value never appears in logs, audit values, API responses or errors

  Scenario: Fixtures contain no secrets or real data
    Then the secret scanner passes on all Stripe fixtures
```

### US-211 — No card data on the Platform API, card-only methods
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-209
- **Linked REQs:** REQ-PAY-005, REQ-PAY-019
- **As a** security analyst **I want** the Platform API to refuse card data **so that** the frontend stays within PCI DSS SAQ A.

#### Acceptance criteria
```gherkin
Feature: No card data, card only
  Scenario: Card-number-like field rejected
    When a payment request body contains "card_number": "4242424242424242"
    Then the response is 400 "CARD_DATA_NOT_ACCEPTED" and the field is redacted in logs and audit values

  Scenario Outline: Other card fields rejected
    When the body contains <field>
    Then the response is 400 "CARD_DATA_NOT_ACCEPTED"
    Examples:
      | field        |
      | "cvc": "123" |
      | "exp_month": 12 |
      | "cvv": "123" |

  Scenario: Unsupported method
    When the body names payment method "paypal", "wallet", "credit_account", "payment_link" or "offline"
    Then the response is 400 "PAYMENT_METHOD_NOT_AVAILABLE" and the UI never renders these options

  Scenario: Gateway token accepted
    When the body carries a gateway payment-method token
    Then the request proceeds

  Scenario: Permission paths
    Then unauthenticated gets 401, a Viewer gets 403 "AUTHZ_DENIED", another organisation's order gets 404 "NOT_FOUND"

  Scenario: Audit
    Then a rejected request writes an audit entry with outcome FAILED and the offending field names only
```

### US-212 — 3-D Secure, declines and attempt limit
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-209, US-210
- **Linked REQs:** REQ-PAY-009, REQ-PAY-010
- **As a** customer **I want** clear handling when my bank asks for authentication or declines **so that** I can retry.
- **Notes:** EC-B12, EC-B16.

#### Acceptance criteria
```gherkin
Feature: 3DS, declines and attempt limit
  Scenario: 3DS required then completed
    When the customer pays with token "mock_3ds" (Stripe fixture: 3DS required card)
    Then the payment is REQUIRES_ACTION with a client secret, the order stays PENDING_PAYMENT, and after the user completes authentication the payment is AUTHORISED and the shipments go PAID

  Scenario: 3DS failed or abandoned
    When authentication fails with "mock_3ds_fail"
    Then the payment is FAILED, the shipments return to QUOTED and the user sees a localised "authentication failed" message

  Scenario Outline: Declines map to canonical codes
    When the gateway returns <raw>
    Then the response code is <code> and the raw gateway text is not shown
    Examples:
      | raw                  | code                  |
      | card declined        | CARD_DECLINED         |
      | insufficient funds   | INSUFFICIENT_FUNDS    |
      | authentication failed| AUTHENTICATION_FAILED |
      | expired card         | EXPIRED_CARD          |
      | gateway outage       | GATEWAY_UNAVAILABLE   |

  Scenario: Sixth attempt in an hour
    Given 5 payment attempts for one order in the last hour
    When a sixth is made
    Then the response is 429 "PAYMENT_ATTEMPTS_EXCEEDED"

  Scenario: Saved card needing 3DS
    Given a saved card requires authentication on reuse
    Then the payment goes to REQUIRES_ACTION and no silent charge occurs

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED", another organisation's order gets 404 "NOT_FOUND"

  Scenario: Audit
    Then each attempt, status change and failure writes a payment audit entry with the canonical code
```

### US-213 — Webhook verification, deduplication and replay
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-210
- **Linked REQs:** REQ-PAY-011, REQ-PAY-012
- **As the** operator **I want** gateway webhooks verified and processed once **so that** payment state is reliable even with duplicates and reordering.
- **Notes:** EC-B11. Public route authenticated by signature, permission `webhook:stripe:receive`, actor type system. Run is test mode only (REQ-PAY-004), so a signed `livemode: true` event is rejected; an event-type allow-list decides what is applied and unknown types are stored and acknowledged only (REQ-PAY-012, D-052, SEC-P3-21).

#### Acceptance criteria
```gherkin
Feature: Webhooks
  Scenario: Valid signed event is stored and applied
    When a correctly signed event arrives with a timestamp within 300 seconds
    Then it is stored by gateway event ID before processing, the state is derived from the retrieved current gateway object, and the response is 200

  Scenario: Invalid signature
    When the signature does not match the raw body
    Then the response is 400, nothing is processed and an audit entry with outcome DENIED and the source IP is written

  Scenario: Timestamp outside tolerance
    When the timestamp is 301 seconds old
    Then the response is 400 and nothing is processed

  Scenario: Duplicate event
    When the same event ID arrives twice
    Then the response is 200 both times and side effects happen once

  Scenario: Webhook before the API response
    Given the webhook arrives before the confirm call returns
    Then the payment is applied, the later API response finds it AUTHORISED as a no-op, and the shipment moves PENDING_PAYMENT to PAID exactly once

  Scenario: Out-of-order events
    Then the final state matches the current gateway object regardless of arrival order

  Scenario: Replay by event ID
    When a developer replays a stored event by ID through the worker command
    Then no duplicate side effect occurs

  Scenario: Unknown event type
    Then it is stored and acknowledged with 200

  Scenario: Live-mode event is rejected
    Given a correctly signed fixture event with livemode true
    When it is posted to the webhook endpoint
    Then the response is 400 and the event is not processed
    And an audit entry with outcome DENIED and the source IP is written
    And a security log event is emitted with no secrets

  Scenario: Unknown event type is stored but never processed
    Given a correctly signed test-mode event of a type outside the event-type allow-list
    When it is posted
    Then the response is 200 and the event is stored by gateway event ID
    And no handler runs and no payment, shipment or refund state changes

  Scenario: Permission path
    Then the endpoint accepts only signature-authenticated callers; a request with a valid user token but no signature gets 400; an unsigned call never reaches a handler
```

### US-214 — Checkout screen (step 6) with test-mode indicator
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-209, US-211, US-212
- **Linked REQs:** REQ-PAY-016, REQ-PAY-017
- **As a** customer **I want** a clear, safe payment screen **so that** I can pay by card, including 3-D Secure, on my phone.
- **Notes:** COND-SANDBOX-DEMO: the tagged scenario needs `STRIPE_TEST_LIVE=1` and a Stripe test key supplied outside the repo.

#### Acceptance criteria
```gherkin
Feature: Checkout screen
  Scenario: Pay with a card in hosted fields
    Given the order total of 65.00 USD and the Stripe fixture gateway
    When the customer enters a test card in the gateway's hosted fields and confirms
    Then the order is PAID, the booking progress is shown and the page navigates to the confirmation page on LABEL_READY

  Scenario: 3-D Secure challenge
    When the card requires 3DS
    Then the challenge is shown, completion continues the order and failure shows "authentication failed" with a retry

  Scenario: Test-mode indicator
    Given the active gateway is the Mock gateway or a test-mode Stripe account
    Then the checkout and confirmation pages show a visible "Test mode" label that is not colour-only and payment API responses contain "livemode": false

  Scenario: Sell currency shown
    Then the amount to be charged is shown in the order's sell currency regardless of display currency

  Scenario: Gateway unavailable
    Given the gateway returns GATEWAY_UNAVAILABLE
    Then an error state with retry is shown and the order stays PENDING_PAYMENT or returns to QUOTED

  Scenario: Pay twice by double click
    When the Pay button is pressed twice
    Then one authorisation exists (same Idempotency-Key)

  Scenario: Permission paths
    Then unauthenticated visitors are redirected to sign-in, a Viewer sees the permission-denied state and cannot pay (403 "AUTHZ_DENIED"), and another organisation's order is a not-found state

  Scenario: UI standard
    Then the screen passes the UI standard at 360 px (sticky Pay action and price summary) and 1280 px in en/es/fr, keyboard operable including the 3DS frame, with the six states, axe clean

  @live-sandbox
  Scenario: Stripe test card with 3DS against the live Stripe test API (COND-SANDBOX-DEMO)
    Given STRIPE_TEST_LIVE=1 and a Stripe test key supplied by environment
    When the customer pays with Stripe's documented 3DS-required test card and completes the challenge
    Then the PaymentIntent is authorised then captured after the Mock-or-sandbox carrier confirms, and the order reaches LABEL_READY
```

### US-215 — EXCEPTION handling and automatic void retry
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-204
- **Linked REQs:** REQ-BOOK-030
- **As a** customer **I want** to be told when a cancellation could not be completed **so that** I do not assume I was refunded.
- **Notes:** EC-B07, EC-B27. Staff retry is M2; M1 retries automatically every 4 hours for 24 hours (6 retries).

#### Acceptance criteria
```gherkin
Feature: EXCEPTION handling on void failure
  Scenario: Void fails during cancellation
    Given Mock "fail=void" and a LABEL_READY shipment being cancelled
    Then the shipment moves CANCELLED then EXCEPTION, no refund is issued, the label stays CURRENT, the shipment is flagged "needs_review", the exception metric rises and the customer is told the cancellation could not be completed

  Scenario: Shipment already in transit at void time
    Given the carrier reports the shipment already in transit
    Then the same outcome applies

  Scenario: Automatic retries
    Then the void is retried every 4 hours for 24 hours

  Scenario: Retry succeeds
    Given a retry succeeds
    Then the shipment moves EXCEPTION -> VOIDED, the label is voided and the refund proceeds (US-216)

  Scenario: Retries exhausted
    Given all retries fail
    Then the shipment stays EXCEPTION with "needs_review" and an alert is raised

  Scenario: Permission paths
    Then a customer cannot force the retry (404 "NOT_FOUND" for a retry route), unauthenticated gets 401, another organisation 404

  Scenario: Audit
    Then each transition and retry writes audit entries with trigger SAGA_STEP and the canonical error "CANNOT_VOID"
```

### US-216 — Automatic full refund after cancellation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-215, EPIC-09
- **Linked REQs:** REQ-PAY-013
- **As a** customer **I want** an automatic full refund after a cancellation **so that** I get my money back without contacting anyone.
- **Notes:** DR-B21, EC-B19, EC-B32.

#### Acceptance criteria
```gherkin
Feature: Automatic refund
  Scenario: Refund after void confirmation
    Given a captured shipment amount of 4000 USD minor units and a confirmed carrier void
    Then a refund of 4000 is created against the payment with its gateway reference, status REFUND_PENDING then REFUNDED, and the shipment goes VOIDED then REFUNDED

  Scenario: No refund before void confirmation
    Given the void is not confirmed
    Then no refund call is made

  Scenario: Refund failure is retried
    Given token "mock_refund_fail"
    Then the refund is retried 5 times with exponential backoff, then the payment becomes REFUND_FAILED, the user is notified that the refund is delayed, an alert is raised and the shipment stays VOIDED

  Scenario: Refund idempotency
    When the cancellation job runs twice
    Then exactly one refund exists (idempotency key from the cancellation ID)

  Scenario: Multi-shipment order
    Given an order of three shipments with captured amounts 4000 each
    When one is cancelled
    Then only 4000 is refunded and the others are untouched

  Scenario: Permission paths
    Then the refund is system-initiated; a customer calling a refund route directly gets 404 "NOT_FOUND"; payment details need "payment:read" (403 "AUTHZ_DENIED") and the owning organisation (404 otherwise)

  Scenario: Audit
    Then the refund and each status change write payment audit entries including actor system
```

### US-217 — Saved payment methods
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-210
- **Linked REQs:** REQ-PAY-014
- **As a** business customer **I want** to save and manage cards **so that** checkout is faster.
- **Notes:** Step-up per D-046 and REQ-PAY-014: setup/add, update (set default) and remove require a valid re-authentication proof in `X-Reauth-Proof` (`x-reauth-scope: payment_method.manage`, no age exemption); listing needs none. A saved-card checkout by a session whose `auth_time` is older than 12 h sets CVC re-collection (Stripe `payment_method_options.card.require_cvc_recollection = true`; the Mock gateway exposes the same flag); a new-card checkout is unaffected. MoSCoW stays Should because REQ-PAY-014 is Should.

#### Acceptance criteria
```gherkin
Feature: Saved payment methods
  Scenario: Add via hosted setup
    When a user with "payment_method:manage" completes the gateway setup flow
    Then the method is stored with token, brand, last four digits and expiry month and year only

  Scenario: List, default and remove
    Then the user can list methods, set one default and remove one, and removal detaches it at the gateway

  Scenario: Limit of 10
    Given 10 saved methods exist
    When an 11th is added
    Then the response is 422 "VALIDATION_ERROR" naming the limit

  Scenario: Card data on the API
    Then any card number field is rejected with 400 "CARD_DATA_NOT_ACCEPTED"

  Scenario: Permission paths
    Then a role without "payment_method:manage" gets 403 "AUTHZ_DENIED", unauthenticated gets 401, another user's or organisation's method gets 404 "NOT_FOUND"

  Scenario: Audit
    Then add, default change and removal write audit entries on "payment_method" and listing writes VIEW

  Scenario Outline: Changing a saved method without a re-authentication proof is refused
    Given a signed-in user with "payment_method:manage" and no X-Reauth-Proof header
    When the user performs "<action>"
    Then the response is 401 application/problem+json with code REAUTH_REQUIRED naming scope payment_method.manage
    And no payment method is created, changed or removed and nothing changes at the gateway
    And a proof older than 5 minutes (REQ-AUTH-020) is refused the same way, however recently the user signed in
    Examples:
      | action                  |
      | setup / add a method    |
      | set a default method    |
      | remove a method         |

  Scenario: A valid re-authentication proof allows the change and is audited
    Given a user with "payment_method:manage" who completed re-authentication for scope payment_method.manage
    When the user adds, sets a default for and removes a method, each with X-Reauth-Proof
    Then each request succeeds
    And each writes an audit entry on "payment_method" with outcome SUCCESS in the same transaction

  Scenario: Listing needs no proof
    Given a signed-in user with "payment_method:manage" and no X-Reauth-Proof header
    When the user lists saved methods
    Then the response is 200 with brand, last four digits and expiry only

  Scenario: Saved-card checkout with a stale session requires CVC re-collection
    Given a user whose session auth_time is 13 hours old
    When checkout is started with a saved card (Stripe fixture and Mock gateway)
    Then the PaymentIntent carries payment_method_options.card.require_cvc_recollection true (Mock payment: require_cvc_recollection true)
    And the hosted fields collect the security code again before the payment is confirmed

  Scenario: Saved-card checkout with a fresh session does not require CVC re-collection
    Given a user whose session auth_time is 11 hours old
    When checkout is started with a saved card
    Then the payment carries require_cvc_recollection false
    And the saved card is used without a new code prompt unless 3-D Secure is demanded

  Scenario: New-card checkout is unaffected by auth_time
    Given a user whose session auth_time is 13 hours old
    When checkout is started with a new card
    Then the normal card entry flow runs and no extra re-authentication or CVC re-collection flag is added
```

### US-218 — Payment receipt
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-209, EPIC-15
- **Linked REQs:** REQ-PAY-015
- **As a** customer **I want** a receipt after payment **so that** I have a record.

#### Acceptance criteria
```gherkin
Feature: Receipt
  Scenario: Receipt after capture
    When the payment is CAPTURED
    Then the confirmation page and an email to the account address show order number, date, amount, currency, last four digits or method type and the per-shipment breakdown
    And both state "This is not a tax invoice"

  Scenario: Email in the user's locale
    Given the user locale is "fr"
    Then the mail catcher holds the French receipt

  Scenario: No receipt for failed payment
    Given the payment failed
    Then no receipt is sent

  Scenario: Duplicate delivery of the notification job
    Then only one receipt email is sent

  Scenario: Permission paths
    Then viewing the receipt needs "payment:read" (403 "AUTHZ_DENIED"), another organisation's order gets 404 "NOT_FOUND", unauthenticated 401
```

### US-219 — Authorisation and capture sweeper
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-204
- **Linked REQs:** REQ-PAY-018
- **As the** operator **I want** a safety net for crashes between saga steps **so that** guarantee G1 holds even after infrastructure failures.

#### Acceptance criteria
Permission path: not applicable — scheduled system job with no end-user principal. A second negative scenario is included.
```gherkin
Feature: Sweeper
  Scenario: Stale authorisation cancelled
    Given an authorisation older than 30 minutes without a booked shipment
    When the sweeper runs (every 5 minutes)
    Then the authorisation is cancelled and the payment is VOIDED

  Scenario: Captured payment, carrier shipment exists
    Given a CAPTURED payment whose shipment is not BOOKED after 10 minutes but a carrier shipment exists
    Then the sweeper completes the missing state change, raises an alert and writes an audit entry as actor system

  Scenario: Captured payment, no carrier shipment
    Given a CAPTURED payment with no carrier shipment after 10 minutes
    Then the sweeper refunds in full and raises an alert

  Scenario: Idempotent run
    When the sweeper runs twice over the same data
    Then exactly one repair or refund occurs

  Scenario: Healthy data untouched
    Then BOOKED shipments with CAPTURED payments and fresh authorisations are not modified

  Scenario: Crash between carrier confirmation and capture
    Given the worker crashed and cannot resume within 10 minutes
    Then the sweeper completes the capture or refunds
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-BOOK-016 | US-208 |
| REQ-BOOK-018 | US-197 |
| REQ-BOOK-019 | US-198 |
| REQ-BOOK-020 | US-202 |
| REQ-BOOK-021 | US-203 |
| REQ-BOOK-022 | US-204 |
| REQ-BOOK-023 | US-205 |
| REQ-BOOK-024 | US-206 |
| REQ-BOOK-025 | US-207 |
| REQ-BOOK-026 | US-201 |
| REQ-BOOK-030 | US-215 |
| REQ-PAY-001 | US-199 |
| REQ-PAY-002 | US-199 |
| REQ-PAY-003 | US-200 |
| REQ-PAY-004 | US-210 |
| REQ-PAY-005 | US-211 |
| REQ-PAY-006 | US-209 |
| REQ-PAY-007 | US-208 |
| REQ-PAY-008 | US-209 |
| REQ-PAY-009 | US-212 |
| REQ-PAY-010 | US-212 |
| REQ-PAY-011 | US-213 |
| REQ-PAY-012 | US-213 |
| REQ-PAY-013 | US-216 |
| REQ-PAY-014 | US-217 |
| REQ-PAY-015 | US-218 |
| REQ-PAY-016 | US-214 |
| REQ-PAY-017 | US-210, US-214 |
| REQ-PAY-018 | US-219 |
| REQ-PAY-019 | US-211 |

REQ-BOOK rows 001-015, 017, 027, 028 and 029 are covered in EPIC-09.
