# EPIC-13 — Tracking and public tracking page

- **Goal:** Customers and their receivers can see where a shipment is, from carrier events normalised into one canonical taxonomy, without any personal data leaking to anonymous visitors.
- **Milestone(s):** M1
- **REQ areas covered:** REQ-TRACK (REQ-TRACK-001 to REQ-TRACK-015)
- **Exit-demo contribution:** PRD §6.2 (M1 demo): public tracking page shows the tracking number with status and city-level location only; account timeline shows tracking events; Mock scenarios walk IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED and EXCEPTION and trigger milestone emails (EPIC-15).
- **Depends on epics:** EPIC-06 (CARR: `track` operation, Mock scenarios REQ-CARR-005, circuit breaker), EPIC-09 (BOOK: state machine DR-B01, history), EPIC-01 (PLAT: worker, outbox, clock), EPIC-03 (ORG/RBAC/RLS), EPIC-04 (AUDIT), EPIC-05 (UI/I18N), EPIC-16 (API/SEC: rate limiter, problem+json), EPIC-15 (NOTIF: milestone emails)

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-241 | Map carrier tracking events to the canonical taxonomy | M1 | Must | M | EPIC-06 | REQ-TRACK-001 | DC |
| US-242 | Store events once, order them, and drive shipment state forward | M1 | Must | M | US-241, EPIC-09 | REQ-TRACK-002, REQ-TRACK-005 | DC |
| US-243 | Poll carrier tracking with adaptive intervals and stale flag | M1 | Must | M | US-242, EPIC-01 | REQ-TRACK-003 |  |
| US-244 | Batch track calls per carrier account with backoff and pending handling | M1 | Must | M | US-243, EPIC-06 | REQ-TRACK-004 |  |
| US-245 | Mock carrier tracking scenarios on an injected clock | M1 | Must | S | EPIC-06 | REQ-TRACK-014 |  |
| US-246 | Emit milestone notification events once per shipment and status | M1 | Should | S | US-242, EPIC-01 | REQ-TRACK-007 |  |
| US-247 | Public tracking lookup by tracking or order number | M1 | Must | M | US-242, EPIC-16 | REQ-TRACK-008, REQ-TRACK-012 | DC |
| US-248 | Public tracking page exposes city-level data only | M1 | Must | M | US-247, EPIC-05 | REQ-TRACK-011 | DC |
| US-249 | Rate-limit public tracking lookups | M1 | Must | S | US-247, EPIC-16 | REQ-TRACK-010 |  |
| US-250 | Public tracking by customer reference plus receiver postcode | M1 | Should | S | US-247 | REQ-TRACK-009 |  |
| US-251 | Authenticated full tracking timeline | M1 | Must | M | US-242, EPIC-03, EPIC-05 | REQ-TRACK-013 | DC |
| US-252 | Accept signed carrier push notifications | M1 | Should | M | US-242 | REQ-TRACK-006 |  |
| US-253 | Manual tracking refresh limited to once per 5 minutes | M1 | Could | S | US-243 | REQ-TRACK-015 |  |

## Stories

### US-241 — Map carrier tracking events to the canonical taxonomy
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-06
- **Linked REQs:** REQ-TRACK-001
- **Linked NFRs (optional):** NFR-OBS-001
- **As a** platform developer **I want** every carrier tracking event mapped at the adapter boundary to one canonical status and stored with its raw form **so that** customers see consistent statuses regardless of carrier and support can always see the original data.
- **Notes:** Taxonomy and mapping per DR-B18: INFO_RECEIVED, PICKED_UP, DROPPED_OFF, IN_TRANSIT, CUSTOMS_HOLD, CUSTOMS_CLEARED, OUT_FOR_DELIVERY, DELIVERY_ATTEMPTED, DELIVERED, EXCEPTION, RETURN_INITIATED, RETURNED_TO_SENDER, CANCELLED. Raw payload retention is REQ-CARR-018 (EPIC-06); this story stores the event row. Out of scope: shipment state changes (US-242).

#### Acceptance criteria
Permission path: covered by scenario "Event ingestion is a system job and has no user-facing route".
```gherkin
Feature: Map carrier tracking events to the canonical taxonomy
  Background:
    Given a booked Mock shipment with tracking number "MOCK1234567890"

  Scenario: A known carrier code maps to a canonical status and keeps the original
    Given the Mock carrier returns an event with carrier code "OD" and description "Out for delivery today"
    When the tracking pipeline ingests the event
    Then a stored event has canonical status "OUT_FOR_DELIVERY"
    And the stored event keeps carrier code "OD", the original description and the raw payload reference

  Scenario Outline: Every taxonomy status is reachable from a fixture event
    When the pipeline ingests a fixture event whose canonical mapping is "<status>"
    Then the stored event has canonical status "<status>"
    Examples:
      | status |
      | INFO_RECEIVED | 
      | PICKED_UP |
      | DROPPED_OFF |
      | IN_TRANSIT |
      | CUSTOMS_HOLD |
      | CUSTOMS_CLEARED |
      | OUT_FOR_DELIVERY |
      | DELIVERY_ATTEMPTED |
      | DELIVERED |
      | EXCEPTION |
      | RETURN_INITIATED |
      | RETURNED_TO_SENDER |
      | CANCELLED |

  Scenario: An unmapped carrier code is never dropped
    Given the carrier returns an event with code "ZZ99" that has no mapping
    When the pipeline ingests the event
    Then a stored event exists with canonical status "IN_TRANSIT" and flag "unmapped"
    And the metric "tracking_unmapped_event_total" increases by 1

  Scenario: Carrier-side CANCELLED changes no shipment state but raises an alert
    When the pipeline ingests an event mapped to "CANCELLED"
    Then the event is stored
    And the shipment state is unchanged
    And an alert metric for carrier-side cancellation is incremented

  Scenario: Event ingestion is a system job and has no user-facing route
    Given I am an unauthenticated visitor
    When I call "POST /v1/internal/tracking/events/ingest"
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Raw payload never reaches customer responses
    When an authenticated owner fetches the shipment tracking view
    Then the response body contains no raw payload field and no raw object path
```

### US-242 — Store events once, order them, and drive shipment state forward
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-241, EPIC-09
- **Linked REQs:** REQ-TRACK-002, REQ-TRACK-005
- **As a** customer **I want** my shipment status to follow carrier events in the right order without duplicates or backward moves **so that** the status I see is trustworthy.
- **Notes:** Transition rules DR-B01 and event mapping DR-B18. Each applied transition writes history and audit in the same transaction (REQ-BOOK-019, EPIC-09). Illegal event-driven transitions are logged and never shown to the user as errors. EC-B22.

#### Acceptance criteria
```gherkin
Feature: Store events once, order them, and drive shipment state forward
  Background:
    Given a shipment in state "PICKUP_SCHEDULED" owned by organisation "Acme"

  Scenario: Pickup event moves the shipment to IN_TRANSIT
    When a PICKED_UP event is ingested
    Then the shipment state is "IN_TRANSIT"
    And a state history row exists with from-state "PICKUP_SCHEDULED", to-state "IN_TRANSIT" and trigger "CARRIER_EVENT"

  Scenario: Walk through customs hold, out for delivery and delivered
    Given the shipment is "IN_TRANSIT"
    When events CUSTOMS_HOLD, CUSTOMS_CLEARED, OUT_FOR_DELIVERY and DELIVERED are ingested in order
    Then the shipment states in sequence are "CUSTOMS_HOLD", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"

  Scenario: Polling the same data twice creates no duplicates
    Given an event with carrier event ID "E-1" is already stored
    When the same event is ingested again
    Then exactly 1 stored event with carrier event ID "E-1" exists

  Scenario: Events without a carrier ID are de-duplicated by hash
    Given two events with identical tracking number, code, timestamp and location and no carrier event ID
    When both are ingested
    Then exactly 1 event is stored

  Scenario: Out-of-order events produce a time-ordered timeline
    When an event dated 12:00 is ingested after an event dated 14:00
    Then the timeline lists the 12:00 event before the 14:00 event
    And the shipment state reflects only forward movement

  Scenario: A late event after DELIVERED is stored but changes nothing
    Given the shipment is "DELIVERED"
    When an IN_TRANSIT event dated before the delivery is ingested
    Then the event is stored
    And the shipment state remains "DELIVERED"
    And no notification event is emitted
    And the ignored transition is logged with the event ID

  Scenario: An illegal transition is stored but not applied
    Given the shipment is "BOOKED"
    When a DELIVERED event is ingested
    Then the shipment state remains "BOOKED"
    And the log contains an entry "illegal event-driven transition" with the event ID
    And no error is shown to the user

  Scenario: Concurrent cancel and first scan are decided by the version check
    Given the shipment is "BOOKED" at version 7
    When a cancel and a PICKED_UP event both try to commit against version 7
    Then exactly one commits and the other is retried or rejected with "SHIPMENT_NOT_CANCELLABLE" for the cancel

  Scenario: Cross-tenant events cannot be attached by identifier guessing
    Given tracking number "MOCK-OTHER" belongs to organisation "Beta"
    When a poll job for organisation "Acme" receives an event for "MOCK-OTHER"
    Then the event is discarded and logged without modifying any shipment of "Beta"
```

### US-243 — Poll carrier tracking with adaptive intervals and stale flag
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-242, EPIC-01
- **Linked REQs:** REQ-TRACK-003
- **As an** operator **I want** the worker to poll each shipment at an interval matched to its state **so that** customers get timely updates without hammering carrier APIs.
- **Notes:** DR-B19. Intervals are configuration (ASSUMED). Jitter plus or minus 10 percent on every next-poll time. No per-poll audit entry. Uses the injected clock.

#### Acceptance criteria
```gherkin
Feature: Adaptive tracking polling
  Scenario Outline: Interval by shipment state
    Given a shipment in state "<state>" whose last event was "<last_event_age>" ago
    When the scheduler computes the next poll time
    Then the base interval is "<interval>" with jitter within plus or minus 10 percent
    Examples:
      | state            | last_event_age | interval   |
      | BOOKED           | 1 hour         | 4 hours    |
      | LABEL_READY      | 1 hour         | 4 hours    |
      | PICKUP_SCHEDULED | 1 hour         | 4 hours    |
      | DROPPED_OFF      | 1 hour         | 4 hours    |
      | IN_TRANSIT       | 2 hours        | 30 minutes |
      | CUSTOMS_HOLD     | 2 hours        | 30 minutes |
      | OUT_FOR_DELIVERY | 1 hour         | 15 minutes |
      | IN_TRANSIT       | 25 hours       | 4 hours    |

  Scenario Outline: Polling stops in final states
    Given a shipment in state "<state>"
    When the scheduler runs
    Then the shipment is not scheduled for polling
    Examples:
      | state |
      | DELIVERED |
      | RETURNED_TO_SENDER |
      | VOIDED |
      | REFUNDED |
      | CANCELLED |

  Scenario: Stale after 60 days without events
    Given a shipment "IN_TRANSIT" with no event for 60 days
    When the scheduler runs
    Then polling stops and the shipment is flagged "tracking_stale"
    And the metric "tracking_stale_total" increases by 1

  Scenario: Carrier poll timeout does not record an event or change state
    Given the Mock carrier is configured with "fail=track"
    When the poll job runs
    Then no tracking event is stored
    And the shipment state is unchanged
    And the next poll is scheduled using the failure backoff

  Scenario: Jitter prevents synchronised polls
    Given 100 shipments in "OUT_FOR_DELIVERY"
    When their next poll times are computed
    Then every time lies between 13.5 and 16.5 minutes after the last poll and not all are equal

  Scenario: Poll jobs are system jobs with no HTTP surface
    Given I am an unauthenticated visitor
    When I request "POST /v1/internal/tracking/poll"
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Polling writes no per-poll audit entry
    When 10 polls return no new events
    Then the audit trail has 0 new entries for the shipment
    And each applied state transition has exactly one audit entry
```

### US-244 — Batch track calls per carrier account with backoff and pending handling
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-243, EPIC-06
- **Linked REQs:** REQ-TRACK-004
- **As an** operator **I want** due shipments grouped into capped batches with limited concurrency and graceful failure handling **so that** carrier rate limits and outages do not cause event loss or alert noise.
- **Notes:** Default batch cap 30 tracking numbers, overridable by adapter capability. Concurrency 2 per account. Backoff doubles up to 4 h. Honors circuit breaker (REQ-CARR-017). EC-B23.

#### Acceptance criteria
Permission path: not applicable — worker job with the system actor and no HTTP surface; the scenario "Shipments of different tenants share a batch without cross-assignment" covers the equivalent tenant-isolation check.
```gherkin
Feature: Batched tracking calls
  Scenario: Due shipments are grouped per account up to the adapter maximum
    Given 75 due shipments on one carrier account whose capability maximum is 30
    When the poll cycle runs
    Then 3 track calls are made with 30, 30 and 15 numbers

  Scenario: Concurrency is limited to 2 calls per account
    Given 10 batches are due for one account
    When the poll cycle runs
    Then at no time are more than 2 track calls in flight for that account

  Scenario: Call failure backs off without recording an event
    Given the account's track call times out
    When the poll cycle completes
    Then no tracking event is stored
    And the account's next poll delay doubles from its base interval, capped at 4 hours

  Scenario: Ten consecutive failures raise an alert
    Given 10 consecutive track call failures for one account
    Then the alert "tracking_account_failing" fires for that account

  Scenario: Freshly created label unknown to the carrier is pending, not an error
    Given a label created 2 hours ago and the carrier answers "not found"
    When the poll runs
    Then no error is logged at ERROR level and no event is stored
    And the shipment remains pollable

  Scenario: Persistent not-found after 48 hours raises the stale-tracking alert
    Given a label created 49 hours ago and the carrier answers "not found"
    When the poll runs
    Then the alert "tracking_stale_label" fires for the shipment

  Scenario: Open circuit breaker skips the account
    Given the breaker for the account is open
    When the poll cycle runs
    Then no carrier call is made for that account and its shipments stay scheduled

  Scenario: Shipments of different tenants share a batch without cross-assignment
    Given due shipments of organisations "Acme" and "Beta" on the same platform carrier account
    When the carrier returns events for both
    Then each event is stored only on its own shipment
```

### US-245 — Mock carrier tracking scenarios on an injected clock
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-06
- **Linked REQs:** REQ-TRACK-014
- **As a** QA engineer **I want** the Mock carrier to produce deterministic tracking sequences by elapsed time **so that** e2e tests and demos can walk every milestone with a fake clock.
- **Notes:** Directives from REQ-CARR-005 / DR-B29: `track=happy_path|customs_hold|exception|return_to_sender|delayed|unknown_number`. Step size `MOCK_TRACK_STEP_SECONDS` default 60. Ignored in production (REQ-CARR-006, EPIC-06). Permission path: not applicable — test-support behaviour inside the Mock adapter, no principal.

#### Acceptance criteria
Permission path: not applicable — test-support behaviour inside the Mock adapter; the invalid-directive and production-mode scenarios above serve as the second negative paths.
```gherkin
Feature: Mock tracking scenarios
  Scenario: Happy path sequence by elapsed time
    Given a Mock label created at T0 with scenario "track=happy_path" and step 60 seconds
    When the injected clock is advanced step by step to T0+4 steps
    Then the events returned in order are label created, picked up, in transit, out for delivery, delivered

  Scenario Outline: Each scenario ends in its expected canonical status
    Given scenario "track=<scenario>"
    When the clock is advanced past the final step
    Then the last canonical status is "<final>"
    Examples:
      | scenario         | final              |
      | happy_path       | DELIVERED          |
      | customs_hold     | CUSTOMS_HOLD       |
      | exception        | EXCEPTION          |
      | return_to_sender | RETURNED_TO_SENDER |
      | delayed          | IN_TRANSIT         |

  Scenario: Unknown number scenario behaves like a carrier not-found
    Given scenario "track=unknown_number"
    When tracking is polled
    Then the adapter returns the canonical not-found result and no events

  Scenario: Same inputs and elapsed time give identical output
    When the same scenario is evaluated twice at the same elapsed time
    Then both outputs are byte-identical

  Scenario: Invalid directive is rejected
    When a shipment is created with header "X-Mock-Scenario: track=sideways"
    Then the response is 400 with problem code "MOCK_SCENARIO_INVALID"

  Scenario: Scenario is ignored in production mode
    Given the runtime environment is production
    When a request carries "X-Mock-Scenario: track=exception"
    Then the Mock carrier is not registered and no Mock tracking result appears
```

### US-246 — Emit milestone notification events once per shipment and status
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-242, EPIC-01
- **Linked REQs:** REQ-TRACK-007
- **As a** customer **I want** a notification event raised when my shipment is picked up, in transit, out for delivery, delivered or in exception **so that** I can be told by email without duplicates.
- **Notes:** Events `tracking.picked_up`, `tracking.in_transit` (first occurrence only), `tracking.out_for_delivery`, `tracking.delivered`, `tracking.exception` (DR-B28). Written to the outbox in the same transaction as the stored event. Email rendering is EPIC-15 (US-287). Flagged: PRD demo relies on milestone emails but REQ-TRACK-007 is Should.

#### Acceptance criteria
Permission path: not applicable — system job from the worker; no principal exists. The rollback scenario is the second negative path.
```gherkin
Feature: Milestone notification events
  Scenario Outline: First occurrence of a milestone emits one outbox event
    Given a shipment without a "<status>" milestone
    When a "<status>" event is stored
    Then exactly 1 outbox event "<event>" exists in the same transaction as the stored event
    Examples:
      | status           | event                      |
      | PICKED_UP        | tracking.picked_up         |
      | IN_TRANSIT       | tracking.in_transit        |
      | OUT_FOR_DELIVERY | tracking.out_for_delivery  |
      | DELIVERED        | tracking.delivered         |
      | EXCEPTION        | tracking.exception         |

  Scenario: Duplicate or repeated events never repeat the notification
    Given "tracking.delivered" was already emitted for the shipment
    When the same DELIVERED event is ingested again
    Then no additional outbox event is created

  Scenario: Second IN_TRANSIT event does not notify
    Given "tracking.in_transit" was emitted
    When another IN_TRANSIT event arrives
    Then no outbox event is created

  Scenario: Statuses outside the list emit nothing
    When a CUSTOMS_HOLD event is stored
    Then no tracking notification event is created

  Scenario: Event storage rolls back together with its outbox row
    Given the outbox insert fails
    When an OUT_FOR_DELIVERY event is ingested
    Then neither the stored event nor the outbox event persists

  Scenario: Late event after DELIVERED sends nothing
    Given the shipment is "DELIVERED"
    When a late PICKED_UP event is ingested
    Then no notification event is emitted
```

### US-247 — Public tracking lookup by tracking or order number
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-242, EPIC-16
- **Linked REQs:** REQ-TRACK-008, REQ-TRACK-012
- **As an** anonymous visitor (or receiver) **I want** to look up a shipment by tracking number or order number without logging in **so that** I can see its status.
- **Notes:** Permission `public`. An order number lists every shipment of the order. Not-found responses are identical for unknown and not-yet-trackable numbers (EC-B08). Audit: anonymous VIEW with tracking-number hash and IP, never the number (REQ area audit expectation).

#### Acceptance criteria
```gherkin
Feature: Public tracking lookup
  Scenario: Lookup by carrier tracking number
    Given shipment "MOCK1234567890" is IN_TRANSIT
    When an anonymous client calls "GET /v1/public/tracking/MOCK1234567890"
    Then the response is 200 with canonical status "IN_TRANSIT" and the event list

  Scenario: Lookup by order number lists every shipment
    Given order "US-000000123" has 3 shipments
    When an anonymous client looks up "US-000000123"
    Then the response is 200 listing 3 shipments, each with its own status

  Scenario: Unknown number
    When an anonymous client looks up "NOPE000"
    Then the response is 404 with problem code "TRACKING_NOT_FOUND"

  Scenario: Not-yet-trackable number is indistinguishable from unknown
    Given a draft shipment has no tracking number yet and a label-created shipment is hidden
    When both lookups are made
    Then both responses have status 404, identical body and the absolute response-time difference is below 50 ms in the test

  Scenario: Cancelled or voided shipments are not disclosed
    Given shipment "MOCK-VOID" is VOIDED
    When it is looked up publicly
    Then the response is 404 with problem code "TRACKING_NOT_FOUND"

  Scenario: Route declares the public permission and the page is noindex
    Then the route metadata permission is "public"
    And the result page response carries "X-Robots-Tag: noindex" and a robots meta of noindex

  Scenario: Page shell is pre-rendered and result is fetched client-side
    When "/track" is requested with JavaScript disabled
    Then the HTML contains the lookup form with labels and no shipment data

  Scenario: Audit trail records an anonymous VIEW without the number
    When an anonymous client looks up "MOCK1234567890"
    Then an audit entry exists with action "VIEW", actor type "ANONYMOUS", a SHA-256 tracking-number hash and the client IP
    And the audit entry does not contain the string "MOCK1234567890"

  Scenario: No existence information leaks across tenants
    Given "MOCK-BETA-1" belongs to another organisation
    When an anonymous client looks it up
    Then the response is the same as for any public lookup of an existing number and no organisation data appears
```

### US-248 — Public tracking page exposes city-level data only
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-247, EPIC-05
- **Linked REQs:** REQ-TRACK-011
- **As a** receiver **I want** a clear public tracking page showing status, times and city **so that** I know when to expect my parcel, while the sender's privacy is protected.
- **Notes:** DR-B31. Allowed: canonical status, event timestamp, localised canonical description, city and country code, carrier and service name, estimated delivery date. Forbidden: names, street lines, postcodes, phone, email, references, contents, prices, carrier free text, facility names. Six screen states, en/es/fr, 360 px and 1280 px.

#### Acceptance criteria
```gherkin
Feature: Public tracking page content
  Scenario: Page shows allowed fields only
    Given shipment "MOCK1234567890" has events in Hamburg and Leipzig with carrier free text "Signed by J. Smith at Dock 4"
    When a visitor opens the tracking page for it
    Then the page shows status, timestamps, localised canonical descriptions, "Hamburg, DE", carrier name, service name and estimated delivery date
    And the page does not contain "J. Smith", "Dock 4", a street, a postcode, a phone number, an email, a reference, contents or a price

  Scenario: Contract test on the response schema
    When the contract test inspects "GET /v1/public/tracking/{number}"
    Then the response schema contains none of the forbidden fields from DR-B31
    And a response with an extra field fails the contract test

  Scenario Outline: Localised canonical descriptions
    Given the visitor's locale is "<locale>"
    Then the status "OUT_FOR_DELIVERY" is described as "<text>"
    Examples:
      | locale | text |
      | en | Out for delivery |
      | es | En reparto |
      | fr | En cours de livraison |

  Scenario Outline: Screen states
    When the page is in state "<state>"
    Then it renders the "<state>" view with a text description and a recovery action where applicable
    Examples:
      | state |
      | loading |
      | empty (no search yet) |
      | error (network failure with retry) |
      | partial (some events pending) |
      | permission-denied (rate limited, retry-after shown) |
      | offline (offline banner with retry on reconnect) |

  Scenario: Responsive layouts
    When the page is viewed at 360 px and at 1280 px
    Then at 360 px the timeline is a single-column list and no horizontal scroll appears
    And at 1280 px the order shipment list renders as a table that collapses to cards below 768 px

  Scenario: Keyboard and accessibility
    When a keyboard-only user submits the lookup and moves through the timeline
    Then focus order is logical, focus indicators are visible, the result is announced in a live region and axe-core reports no violations

  Scenario: Stale estimate or missing city is handled
    Given an event has no city
    Then the event shows the country only and no placeholder text such as "undefined"

  Scenario: Anonymous visitor cannot reach authenticated detail via the public route
    When a visitor requests "GET /v1/shipments/{id}" without a session
    Then the response is 401 with problem code "AUTH_REQUIRED"
```

### US-249 — Rate-limit public tracking lookups
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-247, EPIC-16
- **Linked REQs:** REQ-TRACK-010
- **As a** security engineer **I want** public tracking lookups limited per IP **so that** attackers cannot enumerate tracking or order numbers.
- **Notes:** 30 requests per minute and 300 per hour per IP; unsuccessful lookups 10 per minute per IP. Redis-backed, configurable (ASSUMED). Returns 429 `RATE_LIMITED` with `Retry-After` and `RateLimit-*` headers (REQ-API-014, EPIC-16). EC-B08.

#### Acceptance criteria
Permission path: not applicable — anonymous `public` route; the limit itself is the access control exercised above.
```gherkin
Feature: Public tracking rate limits
  Scenario: Requests within limits succeed with limit headers
    When an IP makes 5 successful lookups in one minute
    Then every response is 200 and carries "RateLimit-Limit", "RateLimit-Remaining" and "RateLimit-Reset"

  Scenario: 31st lookup within a minute is limited
    When one IP makes 31 lookups within 60 seconds
    Then the 31st response is 429 with problem code "RATE_LIMITED" and a "Retry-After" header in seconds

  Scenario: 301st lookup within an hour is limited
    When one IP makes 301 lookups within one hour spread under 30 per minute
    Then the 301st response is 429 with problem code "RATE_LIMITED"

  Scenario: Eleventh unsuccessful lookup per minute is limited
    When one IP makes 11 lookups for unknown numbers within 60 seconds
    Then the 11th response is 429 with problem code "RATE_LIMITED"

  Scenario: Successful lookups do not consume the failed-lookup budget
    When one IP makes 20 successful lookups in a minute
    Then no response is rate limited by the failed-lookup rule

  Scenario: Limits are per IP
    Given IP A is rate limited
    When IP B performs a lookup
    Then IP B receives 200 or 404 and not 429

  Scenario: Limit resets after the window
    Given an IP is limited with "Retry-After: 30"
    When the clock advances 31 seconds
    Then the next lookup is not limited

  Scenario: Concurrent requests share one Redis counter
    When 50 simultaneous lookups come from one IP across 2 API instances
    Then no more than 30 succeed in the minute

  Scenario: Limited requests are counted but audited only as security events
    When a request is limited
    Then a security log entry with the IP and limit class exists and no number is logged in clear text
```

### US-250 — Public tracking by customer reference plus receiver postcode
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-247
- **Linked REQs:** REQ-TRACK-009
- **As a** receiver **I want** to look up a shipment by the sender's reference together with my postcode **so that** I can track without a tracking number.
- **Notes:** Endpoint `POST /api/v1/public/tracking/lookup {customer_reference, postcode}` (ADR-0016 amendment 2, D-043): the postcode is personal data, so it travels in a body, never in a URL; the server matches an HMAC of reference ‖ postcode in `tracking_index` and stores neither in clear (data-model.md §12). Tracking-number and order-number lookups stay `GET` (US-247). Customer references are not unique across organisations (GAP-B-15). The postcode is used only as a matcher and is never echoed. EC-B39.

#### Acceptance criteria
Permission path: not applicable — anonymous `public` route; cross-organisation and wrong-postcode scenarios above prove non-disclosure.
```gherkin
Feature: Public lookup by customer reference and postcode
  Scenario: Exactly one match returns the tracking result
    Given exactly one shipment has customer reference "PO-7788" and receiver postcode "20095"
    When a visitor POSTs reference "PO-7788" with postcode "20095" to /api/v1/public/tracking/lookup
    Then the response is 200 with the public tracking view

  Scenario: Postcode never travels in a URL
    When a visitor sends the reference and postcode as query parameters on a GET
    Then the response is 404 NOT_FOUND or 405 METHOD_NOT_ALLOWED and the access log contains no postcode

  Scenario: Reference without postcode is rejected
    When a visitor submits reference "PO-7788" only
    Then the response is 400 with problem code "VALIDATION_ERROR" and pointer "/postcode"

  Scenario: Wrong postcode answers like an unknown number
    When a visitor submits reference "PO-7788" with postcode "99999"
    Then the response is 404 "TRACKING_NOT_FOUND" with the standard body

  Scenario: Multiple matches across organisations disclose nothing
    Given shipments of two organisations share reference "PO-1" and postcode "10115"
    When a visitor submits that pair
    Then the response is identical to an unknown number

  Scenario: Postcode is never echoed
    When a successful reference lookup is made
    Then the response does not contain the postcode

  Scenario: Lookups count toward the public rate limits
    When 11 failed reference lookups are made within a minute from one IP
    Then the 11th response is 429 "RATE_LIMITED"

  Scenario: Audit records the hash only
    Then the anonymous VIEW entry stores a hash of the reference and not the reference or postcode
```

### US-251 — Authenticated full tracking timeline
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-242, EPIC-03, EPIC-05
- **Linked REQs:** REQ-TRACK-013
- **As a** shipper **I want** to see the full tracking timeline with carrier detail and my own time zone **so that** I can diagnose delays.
- **Notes:** Permission `tracking:read` (granted with `shipment:read`). Raw payloads hidden. Audit `VIEW` on `shipment_tracking`. Embedded in the shipment detail by US-255. Stale shipments (>60 days) show a stale notice.

#### Acceptance criteria
```gherkin
Feature: Authenticated tracking timeline
  Background:
    Given user "ana@acme.test" with role "Shipper" in organisation "Acme" and time zone "Europe/Madrid"

  Scenario: Owner sees the full timeline
    Given shipment "S1" of "Acme" has 5 events
    When Ana opens the tracking view of "S1"
    Then the response is 200 listing 5 events newest first with canonical status, carrier original description and code, location and estimated delivery date
    And each time is shown in "Europe/Madrid" with the zone label such as "CET"

  Scenario: Unauthenticated request
    When a client without a session requests the tracking view
    Then the response is 401 with problem code "AUTH_REQUIRED"

  Scenario: Cross-tenant request returns 404
    Given shipment "S9" belongs to organisation "Beta"
    When Ana requests its tracking view
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Role without tracking:read is denied
    Given a custom role without "tracking:read"
    When that user requests the tracking view
    Then the response is 403 with problem code "AUTHZ_DENIED"

  Scenario: Raw payloads are not shown
    Then the response contains no raw payload and no object storage path

  Scenario: Audit entry for the view
    When Ana opens the tracking view
    Then an audit entry exists with action "VIEW", entity "shipment_tracking", the shipment ID and actor Ana

  Scenario: Audit unavailable fails closed for the sensitive entity
    Given the audit write fails
    When Ana opens the tracking view
    Then the response is 503 with problem code "AUDIT_UNAVAILABLE" and no data

  Scenario: Empty, error and stale states
    Given a shipment with no events yet, then a carrier outage, then a shipment stale for 61 days
    Then the UI shows an empty state "No tracking updates yet", an error state with retry, and a stale notice respectively

  Scenario Outline: Locales and layouts
    When the timeline is rendered in locale "<locale>" at "<viewport>"
    Then labels, dates and times use locale formats and there is no horizontal scroll
    Examples:
      | locale | viewport |
      | en | 360 px |
      | es | 360 px |
      | fr | 1280 px |

  Scenario: Keyboard and axe
    Then the timeline is operable by keyboard and axe-core reports no violations
```

### US-252 — Accept signed carrier push notifications
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-242
- **Linked REQs:** REQ-TRACK-006
- **As an** operator **I want** carriers to push tracking events to a verified endpoint **so that** updates arrive faster than polling.
- **Notes:** One endpoint per carrier; signature or shared secret verification; same mapping, de-duplication and transition pipeline as polled events. Proven with signed fixtures; live proof COND-SANDBOX-DEMO. Secrets referenced only through secret manager. Polling stays the fallback.

#### Acceptance criteria
```gherkin
Feature: Carrier push ingestion
  Scenario: Valid signed push is processed through the shared pipeline
    Given a signed fixture event for carrier "DHL" tracking number "DHL123"
    When it is posted to "/v1/webhooks/tracking/dhl"
    Then the response is 202
    And the event is mapped, de-duplicated and may transition the shipment like a polled event

  Scenario: Unsigned or wrongly signed push is rejected
    When a push is posted with a missing or invalid signature
    Then the response is 401 with problem code "AUTH_REQUIRED" and nothing is stored

  Scenario: Replayed push is idempotent
    When the same signed push is posted twice
    Then exactly 1 event is stored

  Scenario: Unknown tracking number is accepted silently
    When a validly signed push references no known shipment
    Then the response is 202 and no event is stored

  Scenario: Oversized or malformed payload
    When a validly signed push has malformed JSON
    Then the response is 400 with problem code "VALIDATION_ERROR"

  Scenario: Route declares public permission with its own signature check
    Then the route metadata permission is "public" and the signature check runs before any parsing of the body into the domain

  Scenario: Secrets never appear in logs
    When a push is rejected
    Then the log entry contains the carrier code and reason and no secret or signature value

  @live-sandbox
  Scenario: Live sandbox push (COND-SANDBOX-DEMO)
    Given sandbox credentials and a public URL are supplied
    When the carrier sandbox sends a real tracking push
    Then the shipment timeline updates
```
Permission path: covered by the 401 scenario for unverified requests; the route is `public` with its own signature check.

### US-253 — Manual tracking refresh limited to once per 5 minutes
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** US-243
- **Linked REQs:** REQ-TRACK-015
- **As a** shipper **I want** to refresh tracking on demand **so that** I get the latest status before contacting the receiver.
- **Notes:** Shares the poll pipeline. Triggers a carrier call, so it needs `tracking:read` plus `shipment:create` (default assumption, not stated in the REQ) and ownership.

#### Acceptance criteria
```gherkin
Feature: Manual tracking refresh
  Scenario: Refresh outside the window triggers a poll
    Given the last manual refresh of shipment "S1" was 6 minutes ago
    When the owner posts "POST /v1/shipments/{S1}/tracking/refresh"
    Then the response is 202 and a poll runs through the normal pipeline

  Scenario: Second refresh inside 5 minutes is limited
    Given the owner refreshed 2 minutes ago
    When the owner refreshes again
    Then the response is 429 with problem code "RATE_LIMITED" and "Retry-After" of about 180 seconds

  Scenario: Final-state shipment
    Given the shipment is DELIVERED
    When the owner requests a refresh
    Then the response is 200 with a no-op body "polling_stopped" and no carrier call is made

  Scenario: Unauthenticated
    When an unauthenticated client requests a refresh
    Then the response is 401 with problem code "AUTH_REQUIRED"

  Scenario: Cross-tenant
    When a user requests a refresh for another organisation's shipment
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Viewer role denied
    Given a user with role "Viewer" who holds "tracking:read" but not "shipment:create"
    Then the refresh control is absent in the UI
    And a direct call returns 403 with problem code "AUTHZ_DENIED"
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-TRACK-001 | US-241 |
| REQ-TRACK-002 | US-242 |
| REQ-TRACK-003 | US-243 |
| REQ-TRACK-004 | US-244 |
| REQ-TRACK-005 | US-242 |
| REQ-TRACK-006 | US-252 |
| REQ-TRACK-007 | US-246 |
| REQ-TRACK-008 | US-247 |
| REQ-TRACK-009 | US-250 |
| REQ-TRACK-010 | US-249 |
| REQ-TRACK-011 | US-248 |
| REQ-TRACK-012 | US-247 |
| REQ-TRACK-013 | US-251 |
| REQ-TRACK-014 | US-245 |
| REQ-TRACK-015 | US-253 |

Every Must REQ (TRACK-001, 002, 003, 004, 005, 008, 010, 011, 012, 013, 014) is linked by at least one Must story.
