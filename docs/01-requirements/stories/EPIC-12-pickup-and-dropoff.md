# EPIC-12 — Pickup scheduling and drop-off

- **Goal:** A customer chooses a realistic collection date and window (or a drop-off point), the carrier is asked to collect, and the customer always sees a reference and what to do next, with pickup problems never undoing a paid booking.
- **Milestone(s):** M1
- **REQ areas covered:** REQ-PICK (all rows 001-014)
- **Exit-demo contribution:** PRD 6.2: "pickup date + window" in wizard step 3 and "a pickup reference is shown" on the confirmation page.
- **Depends on epics:** EPIC-06 (CARR: `schedulePickup`, `cancelPickup`, `findServicePoints`, capabilities), EPIC-03 (RBAC/RLS), EPIC-04 (AUDIT), EPIC-05 (UI/I18N), EPIC-08 (QUOTE: cut-off countdown uses the same function), EPIC-09 (wizard step 3, confirmation page, cancellation), EPIC-10 (saga, state machine), EPIC-11 (pickup confirmation document), EPIC-15 (NOTIF), EPIC-17 (DATA: holidays, time zones).

## Conventions used in the acceptance criteria

- Roles: "customer" = user with `pickup:schedule`, `pickup:cancel` and `pickup:read` (Owner, Admin, Shipper); "Viewer" has `pickup:read` only. 401 `AUTH_REQUIRED`, 403 `AUTHZ_DENIED`, other organisation 404 `NOT_FOUND`.
- Rules: DR-B25 (date computation), DR-B03 steps 5, DR-B18, EC-B17, EC-B18, EC-B25. Sample figures: sender zone `America/New_York`, carrier serves Monday to Friday, booking cut-off 17:00 local, earliest ready time 08:00, latest close time 18:00, lead time 120 minutes, horizon 14 calendar days. US national holiday sample: 2026-12-25 (Friday), flagged `unreviewed`.
- Tests use a fixed clock. Mock carrier directives: `fail=pickup`, `fail=cancel_pickup`.
- Error codes: `PICKUP_DATE_INVALID` 422, `PICKUP_WINDOW_INVALID` 422, `PICKUP_ALREADY_SCHEDULED` 409, `ILLEGAL_STATE_TRANSITION` 409. Canonical carrier reason `PICKUP_UNAVAILABLE`.
- Audit: scheduling writes `CREATE` on `pickup`; reschedule and cancel write `UPDATE`; viewing writes `VIEW`.
- "UI standard" = en/es/fr, six screen states, 360 px (one step per screen, sticky primary action, sticky price summary) and 1280 px, keyboard operable, axe clean.

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-232 | Pickup date and window rules | M1 | Must | M | EPIC-06, EPIC-17 | REQ-PICK-002, REQ-PICK-003, REQ-PICK-004 |
| US-233 | Pickup record and instructions | M1 | Must | S | US-232 | REQ-PICK-001, REQ-PICK-012 |
| US-234 | Step 3 pickup date and window picker | M1 | Must | M | US-232, US-233, EPIC-09 | REQ-PICK-001, REQ-PICK-002, REQ-PICK-004 |
| US-235 | Schedule pickup in the booking saga | M1 | Must | M | US-233, EPIC-10, EPIC-11 | REQ-PICK-005, REQ-PICK-006 |
| US-236 | Schedule a pickup after the booking | M1 | Must | S | US-235 | REQ-PICK-007 |
| US-237 | Cancel pickup when a shipment is cancelled | M1 | Must | S | US-235, EPIC-09 | REQ-PICK-008 |
| US-238 | Reschedule an active pickup | M1 | Should | S | US-236 | REQ-PICK-009 |
| US-239 | Drop-off service points and drop-off confirmation | M1 | Must | M | US-233, EPIC-09 | REQ-PICK-010, REQ-PICK-013 |
| US-240 | Service point map and combined pickups | M1 | Could | S | US-239, US-235 | REQ-PICK-011, REQ-PICK-014 |

Counts: 9 stories. Must 7 (US-232..US-237, US-239), Should 1 (US-238), Could 1 (US-240).

## Stories

### US-232 — Pickup date and window rules
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-06, EPIC-17
- **Linked REQs:** REQ-PICK-002, REQ-PICK-003, REQ-PICK-004
- **As a** customer **I want** only dates and windows the carrier can actually serve **so that** my pickup is not rejected afterwards.
- **Notes:** DR-B25. Carrier constraints come from `capabilities()`; there is no availability query, so rules plus reference data plus runtime rejection (US-235).

#### Acceptance criteria
```gherkin
Feature: Pickup date and window rules
  Background:
    Given sender zone "America/New_York", booking cut-off 17:00, latest window close 18:00 and lead time 120 minutes

  Scenario Outline: Earliest pickup date
    Given the local time is <now> on Monday 2026-11-16
    Then the earliest selectable date is <earliest>
    Examples:
      | now   | earliest   |
      | 14:00 | 2026-11-16 |
      | 15:00 | 2026-11-16 |
      | 15:01 | 2026-11-17 |
      | 18:30 | 2026-11-17 |

  Scenario: Weekend skipped
    Given it is Friday 2026-11-20 16:00 local
    Then the earliest selectable date is Monday 2026-11-23

  Scenario: Holiday is not selectable
    Given 2026-12-25 is a pickup-unavailable holiday for the US
    Then the date is disabled in the picker
    When a client posts date 2026-12-25 directly
    Then the response is 422 "PICKUP_DATE_INVALID"

  Scenario: Date beyond the 14-day horizon
    When a client posts a date 15 days ahead
    Then the response is 422 "PICKUP_DATE_INVALID"

  Scenario Outline: Window validation
    When the window <window> is posted for a future valid date
    Then the outcome is <outcome>
    Examples:
      | window        | outcome                        |
      | 09:00-13:00   | accepted                       |
      | 13:00-17:00   | accepted                       |
      | 10:00-12:00   | accepted (custom, 2 hours)     |
      | 10:00-11:30   | 422 "PICKUP_WINDOW_INVALID"    |
      | 07:00-12:00   | 422 "PICKUP_WINDOW_INVALID"    |
      | 14:00-19:00   | 422 "PICKUP_WINDOW_INVALID"    |

  Scenario: Same-day window must start after the lead time
    Given it is 13:00 local and the date is today
    When the window 14:00-18:00 is posted
    Then the response is 422 "PICKUP_WINDOW_INVALID"; 15:00-18:00 is accepted

  Scenario: Holiday reference data
    Then holidays are seeded for 2026 and 2027 for the launch countries, flagged "unreviewed", and only national holidays of the sender's country apply

  Scenario: Same function as the results page
    Then the cut-off countdown on the quote results (REQ-QUOTE-007) shows the same earliest date for the same clock

  Scenario: Permission paths
    Then unauthenticated gets 401 "AUTH_REQUIRED", a Viewer attempting to select gets 403 "AUTHZ_DENIED", another organisation's draft gets 404 "NOT_FOUND"

  Scenario: Audit
    Then a rejected date or window writes an audit entry with outcome FAILED and the code
```

### US-233 — Pickup record and instructions
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-232
- **Linked REQs:** REQ-PICK-001, REQ-PICK-012
- **As a** customer **I want** my pickup saved with my local date, window and driver instructions **so that** the courier arrives at the right time and place.

#### Acceptance criteria
```gherkin
Feature: Pickup record and instructions
  Scenario: Record stores local date and zone
    When a pickup is saved for date 2026-11-17, zone "America/New_York", window 09:00-13:00
    Then the record holds the local date, the IANA zone, local start and end, the sender address and contact, instructions and (after scheduling) the carrier reference
    And the window is displayed as "09:00-13:00 EST"

  Scenario: Pickup address is the sender address
    Then the pickup address equals the sender snapshot of the shipment

  Scenario: Instructions are cleaned
    When the instructions contain "<b>Ring bell</b>" and a control character
    Then they are stored as plain text "Ring bell" with markup and control characters removed

  Scenario: Instructions limit
    When the instructions have 201 characters
    Then the response is 400 "VALIDATION_ERROR"

  Scenario: Carrier truncation keeps the full text
    Given the carrier maximum is 75 characters and the instructions have 150
    Then the carrier receives the first 75 characters and the pickup record shows all 150

  Scenario: Output is encoded
    Then instructions are rendered as text and never as markup in the UI, documents and emails

  Scenario: Permission paths
    Then saving needs "pickup:schedule" (403 "AUTHZ_DENIED" for a Viewer), unauthenticated gets 401, another organisation's pickup gets 404 "NOT_FOUND"

  Scenario: Audit
    Then creating writes CREATE on "pickup" and viewing writes VIEW on "pickup"
```

### US-234 — Step 3 pickup date and window picker
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-232, US-233, EPIC-09
- **Linked REQs:** REQ-PICK-001, REQ-PICK-002, REQ-PICK-004
- **As a** customer on my phone **I want** to pick a pickup date and window with my own time zone shown **so that** I can arrange collection easily.

#### Acceptance criteria
```gherkin
Feature: Step 3 pickup picker
  Scenario: Pick date and window
    Given collection mode PICKUP
    When the customer chooses the earliest date, the window "13:00-17:00" and types instructions
    Then step 3 is complete and the review step shows "13:00-17:00 EST" with the date in the user's locale format

  Scenario: Unavailable dates are disabled with a reason
    Then weekends, holidays and past cut-off dates are not selectable and each shows an accessible reason such as "Holiday"

  Scenario: Custom window
    When the customer sets 10:00-11:00
    Then an inline error "window must be at least 2 hours" is shown in the user's locale

  Scenario: Server rejects forced values
    When the client posts a holiday date
    Then the response is 422 "PICKUP_DATE_INVALID" and the UI shows the message beside the date

  Scenario: Permission paths
    Then unauthenticated visitors are redirected to sign-in, a Viewer sees the permission-denied state, and another organisation's draft is a not-found state

  Scenario: UI standard
    Then the picker passes the UI standard at 360 px (date list and window chips, sticky Next) and 1280 px (calendar), in en/es/fr, keyboard operable with a visible focus order, touch targets of at least 44 px, axe clean, and shows loading, error, offline and empty states
```

### US-235 — Schedule pickup in the booking saga
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-233, EPIC-10, EPIC-11
- **Linked REQs:** REQ-PICK-005, REQ-PICK-006
- **As a** customer **I want** the pickup requested automatically after my label is ready **so that** I do nothing more, and a pickup problem never cancels my booking.
- **Notes:** DR-B03 step 5, EC-B17. The carrier proof against sandboxes is COND-SANDBOX-DEMO and follows the carrier proof in EPIC-06.

#### Acceptance criteria
```gherkin
Feature: Pickup in the saga
  Scenario: Pickup scheduled after documents
    Given collection mode PICKUP and a shipment in LABEL_READY
    When the saga reaches the pickup step
    Then schedulePickup is called once, the returned reference (deterministic from the Mock) is stored, the shipment moves to PICKUP_SCHEDULED and the confirmation page and shipment detail show the reference and window

  Scenario: Idempotent re-run
    Given the saga already holds a pickup reference
    When the job is delivered again
    Then no second pickup is requested

  Scenario: Carrier rejects the pickup
    Given Mock "fail=pickup"
    Then the shipment stays LABEL_READY, the user is notified with the canonical reason "PICKUP_UNAVAILABLE", a "Schedule pickup" action is offered, and the booking, payment and label are untouched with no compensation

  Scenario: Drop-off shipments skip the step
    Given collection mode DROP_OFF
    Then no pickup is requested

  Scenario: Documents not ready
    Given label generation is still pending
    Then the pickup step waits and does not run before LABEL_READY

  Scenario: Permission path
    Then the step runs as the system actor on behalf of the booking user; the pickup status is visible with "pickup:read" (403 "AUTHZ_DENIED" otherwise), unauthenticated gets 401, another organisation gets 404 "NOT_FOUND"

  Scenario: Audit
    Then the success writes CREATE on "pickup" and UPDATE on "shipment" (trigger SAGA_STEP); a failure writes a carrier_call entry with outcome FAILED and no state change
```

### US-236 — Schedule a pickup after the booking
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-235
- **Linked REQs:** REQ-PICK-007
- **As a** customer **I want** to request a pickup myself when the automatic one failed **so that** my parcel still gets collected.

#### Acceptance criteria
```gherkin
Feature: Manual pickup scheduling
  Scenario: Schedule from LABEL_READY
    Given a LABEL_READY shipment without an active pickup
    When the customer posts a valid date and window with Idempotency-Key "p1"
    Then a pickup is scheduled, the reference is stored and the shipment moves to PICKUP_SCHEDULED

  Scenario: Replay
    When the same request is repeated with key "p1"
    Then the response is a replay with "Idempotent-Replayed: true" and one pickup exists

  Scenario: Active pickup exists
    Then the response is 409 "PICKUP_ALREADY_SCHEDULED"

  Scenario: Wrong state
    Given the shipment is IN_TRANSIT
    Then the response is 409 "ILLEGAL_STATE_TRANSITION"

  Scenario: Invalid date or window
    Then the response is 422 "PICKUP_DATE_INVALID" or "PICKUP_WINDOW_INVALID"

  Scenario: Carrier rejects again
    Given Mock "fail=pickup"
    Then the shipment stays LABEL_READY and the response is a problem+json with the canonical reason

  Scenario: Permission paths
    Then a Viewer gets 403 "AUTHZ_DENIED", unauthenticated gets 401 "AUTH_REQUIRED", another organisation's shipment gets 404 "NOT_FOUND"

  Scenario: Audit
    Then success writes CREATE on "pickup" and the state change is audited with trigger USER_ACTION
```

### US-237 — Cancel pickup when a shipment is cancelled
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-235, EPIC-09
- **Linked REQs:** REQ-PICK-008
- **As a** customer **I want** the driver told not to come when I cancel **so that** nobody turns up for a cancelled parcel.
- **Notes:** EC-B18. Cancellation itself is US-196.

#### Acceptance criteria
```gherkin
Feature: Cancel pickup on shipment cancellation
  Scenario: Pickup cancelled first
    Given a PICKUP_SCHEDULED shipment is cancelled
    Then cancelPickup is called, the pickup is recorded as cancelled and the cancellation continues to the carrier void

  Scenario: Pickup cancel fails
    Given Mock "fail=cancel_pickup"
    Then the pickup is flagged "pickup_cancel_failed", the void and refund continue, and the customer is notified that a driver may still attend

  Scenario: Shipment without a pickup
    Given collection mode DROP_OFF or no active pickup
    Then no cancelPickup call is made

  Scenario: Idempotent cancel
    When the cancellation is repeated
    Then cancelPickup is not called twice for the same pickup

  Scenario: Permission paths
    Then the cancel needs "pickup:cancel" or "shipment:cancel" (403 "AUTHZ_DENIED" for a Viewer), unauthenticated gets 401, another organisation gets 404 "NOT_FOUND"

  Scenario: Audit
    Then the pickup status change writes UPDATE on "pickup" and the failure writes a carrier_call entry with outcome FAILED
```

### US-238 — Reschedule an active pickup
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-236
- **Linked REQs:** REQ-PICK-009
- **As a** customer **I want** to move my pickup **so that** I can change plans without cancelling.

#### Acceptance criteria
```gherkin
Feature: Reschedule pickup
  Scenario: New first, old cancelled after confirmation
    Given an active pickup starting 2026-11-17 09:00 and the time is 06:30 local (more than 2 hours before)
    When the customer reschedules to 2026-11-18 13:00-17:00
    Then schedulePickup for the new slot is confirmed before cancelPickup for the old one, the new reference is stored and the confirmation document gets a new version

  Scenario: New request fails
    Given Mock "fail=pickup"
    Then the old pickup is untouched and the customer sees the canonical reason

  Scenario: Too late
    Given the time is 07:30 local, less than 2 hours before the window
    Then the response is 422 "PICKUP_WINDOW_INVALID" explaining the 2-hour rule

  Scenario: Permission paths
    Then a Viewer gets 403 "AUTHZ_DENIED", unauthenticated 401, another organisation 404 "NOT_FOUND"

  Scenario: Audit
    Then the reschedule writes UPDATE on "pickup" with old and new local date and window
```

### US-239 — Drop-off service points and drop-off confirmation
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-233, EPIC-09
- **Linked REQs:** REQ-PICK-010, REQ-PICK-013
- **As a** customer **I want** to find a nearby drop-off point and know what to bring **so that** I can hand over my parcel without waiting for a courier.
- **Notes:** The list (REQ-PICK-010) is Should; the confirmation behaviour (REQ-PICK-013) is Must, so the story is Must. Event mapping DR-B18.

#### Acceptance criteria
```gherkin
Feature: Drop-off
  Scenario: List nearby service points
    Given the service declares drop-off support and the adapter declares findServicePoints
    When the customer opens the drop-off option with sender postcode "10001"
    Then at most 20 points within 25 km are listed with name, address, distance, opening hours and carrier

  Scenario: Choose a point
    When the customer selects a point
    Then the point is stored as a snapshot on the shipment and collection mode is DROP_OFF

  Scenario: No points found or carrier failure
    Given the adapter returns none or fails
    Then "no drop-off points found" is shown with the pickup option

  Scenario: Confirmation page content
    Then the confirmation page shows the chosen point, the latest drop-off time for the service and what to bring, and no pickup is scheduled

  Scenario: Drop-off accepted
    When the carrier reports a DROPPED_OFF event
    Then the shipment moves to DROPPED_OFF and the timeline shows it

  Scenario: Event for a pickup shipment
    Given the shipment is PICKUP_SCHEDULED
    When a DROPPED_OFF event arrives
    Then it is stored and the shipment state is unchanged

  Scenario: Unsupported service
    When a client posts a service point for a service without drop-off support
    Then the response is 422 "VALIDATION_ERROR"

  Scenario: Permission paths
    Then selecting needs "shipment:create" (403 "AUTHZ_DENIED" for a Viewer), unauthenticated gets 401, another organisation's shipment gets 404 "NOT_FOUND"

  Scenario: Audit
    Then the choice writes UPDATE on "shipment" and the DROPPED_OFF transition is audited with trigger CARRIER_EVENT

  Scenario: UI standard
    Then the list passes the UI standard at 360 px and 1280 px in en/es/fr with loading, empty, error and offline states, keyboard operable, axe clean
```

### US-240 — Service point map and combined pickups
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** US-239, US-235
- **Linked REQs:** REQ-PICK-011, REQ-PICK-014
- **As a** customer **I want** a map of drop-off points and, as a business, one pickup for several parcels **so that** I save effort and duplicate pickup fees.
- **Notes:** The map is deferred when no zero-cost tile source satisfying its usage policy is chosen by the architect; the list stays complete without it.

#### Acceptance criteria
```gherkin
Feature: Map and combined pickups
  Scenario: Map beside the list
    Given a zero-cost tile source is available
    Then the service points also appear on a map and the list remains complete and keyboard operable

  Scenario: No tile source
    Given no tile source is configured
    Then only the list is shown and no external tile request is made

  Scenario: Combined pickup request
    Given three shipments of one order share carrier, sender address and window
    Then one carrier pickup request is made, each shipment keeps its own pickup record pointing to the shared reference

  Scenario: Different windows are not combined
    Given two shipments have different windows
    Then two pickup requests are made

  Scenario: Permission paths
    Then unauthenticated gets 401, a Viewer gets 403 "AUTHZ_DENIED", another organisation gets 404 "NOT_FOUND"
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-PICK-001 | US-233, US-234 |
| REQ-PICK-002 | US-232, US-234 |
| REQ-PICK-003 | US-232 |
| REQ-PICK-004 | US-232, US-234 |
| REQ-PICK-005 | US-235 |
| REQ-PICK-006 | US-235 |
| REQ-PICK-007 | US-236 |
| REQ-PICK-008 | US-237 |
| REQ-PICK-009 | US-238 |
| REQ-PICK-010 | US-239 |
| REQ-PICK-011 | US-240 |
| REQ-PICK-012 | US-233 |
| REQ-PICK-013 | US-239 |
| REQ-PICK-014 | US-240 |
