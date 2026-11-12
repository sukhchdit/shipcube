# EPIC-09 — Booking wizard, customs and basket

- **Goal:** A signed-in customer turns a selected quote option into a complete, valid, customs-compliant shipment draft (wizard steps 1-5), reviews it in an order basket and sees the confirmation page (step 7) after booking.
- **Milestone(s):** M0+M1 (US-173 is M0; all others M1)
- **REQ areas covered:** REQ-BOOK (rows listed below), REQ-CUST (all rows 001-015)
- **REQ-BOOK split:** EPIC-09 owns REQ-BOOK-001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 017, 027, 028, 029. EPIC-10 owns REQ-BOOK-016, 018, 019, 020, 021, 022, 023, 024, 025, 026, 030 (state machine, saga, checkout gate, order numbering, exception handling, progress stream). Each REQ-BOOK row is linked in exactly one of the two coverage tables.
- **Exit-demo contribution:** PRD 6.2 (wizard steps 1-7 on 360 px and 1280 px, customs lines with an HS code, extras, review/basket, confirmation page with documents and pickup reference). US-173 supports PRD 6.1 (direction/content type stored on the M0 mock booking).
- **Depends on epics:** EPIC-02 (AUTH: register, sign-in, email verification), EPIC-03 (ORG/RBAC/RLS), EPIC-04 (AUDIT), EPIC-05 (UI/I18N), EPIC-08 (QUOTE: quote, selected option, claim), EPIC-07 (PRICE: stored snapshot, coupon), EPIC-06 (CARR: validateAddress, uploadCustomsDocuments, capabilities), EPIC-14 (ACCT: address book), EPIC-16 (API/SEC: problem+json, ETag, Idempotency-Key), EPIC-17 (DATA/COMP: country reference data, compliance packs, prohibited lists, commodity sample list), EPIC-10 (saga and checkout), EPIC-11 (documents), EPIC-12 (pickup).

## Conventions used in the acceptance criteria

- Roles: "customer" means a signed-in user with `shipment:create` (Owner, Admin or Shipper). "Viewer" holds `shipment:read` but not `shipment:create`. Permission-denied responses are 403 `AUTHZ_DENIED`; unauthenticated responses are 401 `AUTH_REQUIRED`; another organisation's resource is 404 `NOT_FOUND` (RLS), all as `application/problem+json` (DR-A26).
- Domain error codes with no stated HTTP status in the REQ rows (for example `ADDRESS_COUNTRY_MISMATCH`, `CUSTOMS_CURRENCY_MIXED`) are returned as 422 (assumption A-B-09-1, logged in the Handoff Report).
- Audit entries carry actor, entity, action, outcome, correlation ID and are written in the same transaction as the change. Restricted personal data (tax/ID references, addresses) never appears in audit values (masked) or logs.
- "UI standard" scenarios are the common block for every UI story: locales en/es/fr with no missing keys, the six screen states (loading, empty, error, partial, permission-denied, offline) where they apply, 360 px (one step per screen, sticky primary action, sticky price summary) and 1280 px (multi-section layout, sticky price summary), keyboard operability, touch targets of at least 44 px and zero serious or critical axe violations.

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-171 | Guest sign-in gate and quote claim at wizard start | M1 | Must | M | EPIC-02, EPIC-08 | REQ-BOOK-001 |
| US-172 | Server-side draft shipment, resume and optimistic concurrency | M1 | Must | M | US-171, EPIC-16 | REQ-BOOK-002 |
| US-173 | Shipment direction, content type and package type | M0 | Must | S | EPIC-17 | REQ-BOOK-027, REQ-BOOK-028 |
| US-174 | Responsive wizard shell and step navigation | M1 | Must | M | US-172, EPIC-05 | REQ-BOOK-003 |
| US-175 | Step 1: sender and receiver details with address book | M1 | Must | M | US-172, US-174, EPIC-14 | REQ-BOOK-005 |
| US-176 | Step 1: address validation against country rules | M1 | Must | S | US-175, EPIC-17 | REQ-BOOK-006 |
| US-177 | Step 1: required tax and identity references | M1 | Must | S | US-175, EPIC-17 | REQ-BOOK-008 |
| US-178 | Step 1: carrier address suggestions | M1 | Should | S | US-176, EPIC-06 | REQ-BOOK-007 |
| US-179 | Autosave and offline edit queue | M1 | Should | M | US-172 | REQ-BOOK-004 |
| US-180 | Step 2: contents, customs applicability and document declaration | M1 | Must | M | US-173, US-174, EPIC-17 | REQ-BOOK-009, REQ-CUST-001, REQ-CUST-002 |
| US-181 | Step 2: customs lines and reason for export | M1 | Must | M | US-180 | REQ-CUST-003, REQ-CUST-004 |
| US-182 | Step 2: commodity code search and format validation | M1 | Must | S | US-181, EPIC-17 | REQ-CUST-006, REQ-CUST-007 |
| US-183 | Step 2: prohibited and restricted item check | M1 | Must | M | US-180, EPIC-17 | REQ-CUST-009 |
| US-184 | Dangerous-goods attestation and explicit screening status | M1 | Must | S | US-180 | REQ-CUST-010, REQ-CUST-011 |
| US-185 | Incoterm choice and de-minimis hint | M1 | Should | S | US-181, EPIC-06 | REQ-CUST-005, REQ-CUST-008 |
| US-186 | Commercial and pro-forma invoice content and carrier customs documents | M1 | Must | M | US-181, EPIC-11 | REQ-CUST-012, REQ-CUST-013 |
| US-187 | Carrier customs field mapping inside adapters | M1 | Must | S | US-181, EPIC-06 | REQ-CUST-015 |
| US-188 | Paperless customs upload with printed-copy fallback | M1 | Should | S | US-186, EPIC-06 | REQ-CUST-014 |
| US-189 | Step 3: collection mode choice | M1 | Must | S | US-174, EPIC-12 | REQ-BOOK-010 |
| US-190 | Step 4: extras, cover and references | M1 | Should | M | US-174, EPIC-07 | REQ-BOOK-011 |
| US-191 | Step 5: review with itemised price and edit-back | M1 | Must | M | US-175, US-181, US-189 | REQ-BOOK-012 |
| US-192 | Order basket model: 1-10 shipments, one currency | M1 | Must | S | US-172 | REQ-BOOK-013 |
| US-193 | Add and remove shipments in the open order | M1 | Should | S | US-192 | REQ-BOOK-014 |
| US-194 | Coupon entry on the review step | M1 | Should | S | US-191, EPIC-07 | REQ-BOOK-015 |
| US-195 | Step 7: confirmation page | M1 | Must | M | US-191, EPIC-10, EPIC-11, EPIC-12 | REQ-BOOK-017 |
| US-196 | Self-service shipment cancellation | M1 | Should | M | EPIC-10, EPIC-11, EPIC-12 | REQ-BOOK-029 |

Counts: 26 stories. Must 18 (US-171..177, 180..184, 186, 187, 189, 191, 192, 195), Should 8 (US-178, 179, 185, 188, 190, 193, 194, 196), Could 0.

## Stories

### US-171 — Guest sign-in gate and quote claim at wizard start
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-02, EPIC-08
- **Linked REQs:** REQ-BOOK-001
- **As a** guest shipper **I want** to keep my selected quote option while I register or sign in **so that** I do not lose my price when the wizard asks for an account (D-009).
- **Notes:** Quote claim rule is REQ-QUOTE-016 (EPIC-08); this story is the wizard-side gate. Edge case EC-B04. Unverified email still allows steps 1-5 (verification is enforced at checkout, US-208).

#### Acceptance criteria
```gherkin
Feature: Guest sign-in gate and quote claim at wizard start
  Background:
    Given a guest holds an unclaimed quote Q1 with a selected option O1

  Scenario: Selected option survives registration and verification
    When the guest presses "Book" on O1
    Then they are redirected to register or sign in
    When they register, verify their email via the mail catcher and return
    Then the wizard opens at step 1 with O1 still selected
    And Q1 is claimed by the new account's organisation

  Scenario: Saving step 1 without a session is rejected
    When an unauthenticated client sends PUT /shipments/{id}/steps/1
    Then the response is 401 "AUTH_REQUIRED" and nothing is stored

  Scenario: Quote already claimed by another organisation
    Given Q1 is claimed by organisation B
    When a customer of organisation A starts a booking from Q1
    Then the response is 409 "QUOTE_ALREADY_CLAIMED" and no shipment is created

  Scenario: Viewer cannot start a booking
    Given a signed-in Viewer without "shipment:create"
    When they save step 1 for Q1
    Then the response is 403 "AUTHZ_DENIED" and Q1 stays unclaimed

  Scenario: Claim is audited
    When the claim succeeds
    Then one audit entry exists with action UPDATE, entity "quote", outcome SUCCESS and the new owner organisation, written in the claim transaction

  Scenario: Unverified user can continue the wizard
    Given the account email is not yet verified
    When the user completes step 1
    Then the draft is saved and no "EMAIL_NOT_VERIFIED" error is raised before checkout
```

### US-172 — Server-side draft shipment, resume and optimistic concurrency
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-171, EPIC-16
- **Linked REQs:** REQ-BOOK-002
- **As a** customer **I want** my progress saved on the server and resumable from any device **so that** I can finish a booking later without re-entering data.
- **Notes:** ETag/version handling per REQ-API; EC-B26. Step completion is validated server-side regardless of client validation.

#### Acceptance criteria
```gherkin
Feature: Server-side draft shipment, resume and optimistic concurrency
  Scenario: First save of step 1 creates a DRAFT
    Given a customer with a claimed quote
    When they save step 1 with valid data
    Then a shipment in state DRAFT exists with the step 1 data and version 1
    And GET /shipments/{id} returns the draft with an ETag

  Scenario: Resume at the first incomplete step on another device
    Given steps 1 and 2 are complete and step 3 is empty
    When the customer signs in on a second device and opens the draft
    Then the wizard opens at step 3 with steps 1 and 2 data shown

  Scenario: Server-side validation overrides client validation
    When a client posts step 2 with a contents description of 2 characters
    Then the response is 400 "VALIDATION_ERROR" with a pointer to "/contents/description" and the step stays incomplete

  Scenario: Stale save from a second tab
    Given tab A and tab B loaded version 3
    When tab A saves and tab B then saves with If-Match version 3
    Then tab B receives 412 "CONCURRENCY_CONFLICT" with the newer version and no data is overwritten
    And the UI shows the newer draft and asks the user to review

  Scenario: Another organisation's draft
    When a customer of organisation B requests the draft of organisation A
    Then the response is 404 "NOT_FOUND"

  Scenario: Viewer cannot edit, unauthenticated cannot read
    Then a Viewer saving a step gets 403 "AUTHZ_DENIED" and an unauthenticated request gets 401 "AUTH_REQUIRED"

  Scenario: Draft mutations are audited
    When the draft is created and a step is saved
    Then audit entries exist: CREATE on "shipment", then UPDATE on "shipment" per save, each with outcome SUCCESS and the version
    And a denied save by a Viewer writes an entry with outcome DENIED
```

### US-173 — Shipment direction, content type and package type
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-17
- **Linked REQs:** REQ-BOOK-027, REQ-BOOK-028
- **As a** developer **I want** direction, content type and package type stored on every shipment **so that** service selection and compliance rules work now and pallets/freight can be added later.
- **Notes:** Launch countries come from reference data. Test fixtures include one non-launch origin country. Used by the M0 mock booking.

#### Acceptance criteria
```gherkin
Feature: Shipment direction, content type and package type
  Scenario Outline: Direction is derived from origin and destination
    When a shipment is created with origin <origin> and destination <destination>
    Then its direction is "<direction>"
    Examples:
      | origin       | destination | direction |
      | US           | IN          | EXPORT    |
      | IN           | US          | EXPORT    |
      | NON_LAUNCH   | IN          | IMPORT    |
      | US           | US          | DOMESTIC  |

  Scenario: Content type and package type are stored
    When a shipment is created with content type "DOCUMENT" and one package of package_type "ENVELOPE"
    Then the shipment stores content_type "DOCUMENT" and the package stores package_type "ENVELOPE"
    And a PARCEL shipment with "PARCEL_BOX" is also accepted

  Scenario: Unknown package type is rejected
    When a shipment is created with package_type "PALLET"
    Then the response is 400 "VALIDATION_ERROR" with a pointer to the package_type field

  Scenario: Missing content type is rejected
    When a shipment is created with no content type
    Then the response is 400 "VALIDATION_ERROR"

  Scenario: Unauthenticated creation is refused
    When an unauthenticated client creates a shipment
    Then the response is 401 "AUTH_REQUIRED"

  Scenario: Viewer creation is refused
    When a Viewer creates a shipment
    Then the response is 403 "AUTHZ_DENIED"

  Scenario: Direction is part of the creation audit entry
    When a shipment is created
    Then the shipment CREATE audit entry contains direction, content_type and the package types
```

### US-174 — Responsive wizard shell and step navigation
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-172, EPIC-05
- **Linked REQs:** REQ-BOOK-003
- **As a** customer on a phone or desktop **I want** a wizard laid out for my screen **so that** I can complete a booking comfortably.

#### Acceptance criteria
```gherkin
Feature: Responsive wizard shell and step navigation
  Scenario: Phone layout shows one step per screen
    Given a 360 px viewport
    When the customer opens the wizard at step 2
    Then only step 2 is shown with a progress indicator "2 of 7", a sticky primary action and a sticky price summary
    And all touch targets are at least 44 px

  Scenario: Desktop layout shows sections with a sticky price summary
    Given a 1280 px viewport
    Then the steps are shown as multi-section content with a sticky price summary and no horizontal scrolling

  Scenario: Back navigation keeps entered data
    Given the customer entered data in step 2
    When they press Back to step 1 and then Next
    Then step 2 still holds the entered data

  Scenario: Step jump beyond the first incomplete step is refused
    When the customer opens step 5 by URL while step 3 is incomplete
    Then the wizard shows step 3 with the message naming the missing step

  Scenario: Draft of another organisation or no session
    Then opening another organisation's draft URL shows a not-found state (404) and an unauthenticated visitor is redirected to sign-in

  Scenario: Viewer sees permission-denied state
    When a Viewer opens the wizard
    Then the permission-denied state is shown with no editable fields

  Scenario: UI standard
    Then the shell passes the UI standard (en/es/fr, six states, keyboard operable focus order, axe clean at 360 px and 1280 px)
```

### US-175 — Step 1: sender and receiver details with address book
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-172, US-174, EPIC-14
- **Linked REQs:** REQ-BOOK-005
- **As a** customer **I want** to enter or pick sender and receiver details **so that** the label has correct parties without re-typing.
- **Notes:** Parties stored as structured snapshots on the shipment. Address book selection needs `address_book:read`; saving to it needs `address_book:manage`.

#### Acceptance criteria
```gherkin
Feature: Step 1 sender and receiver details
  Scenario: Complete step 1 by typing
    Given a DRAFT shipment on step 1
    When the customer enters name, optional company, up to 3 address lines, city, state, postcode, country, phone "+14155550100", email and the residential flag for sender and receiver
    Then step 1 is marked complete and both parties are stored as structured snapshots

  Scenario: Select a party from the address book
    Given the address book holds an address "A1"
    When the customer selects A1 as sender
    Then the sender fields are filled from A1
    When A1 is edited later in the address book
    Then the booked or draft shipment snapshot is unchanged

  Scenario: Save entered receiver to the address book
    When the customer ticks "save to address book"
    Then an address book entry is created and the shipment keeps its own snapshot

  Scenario: Phone not in E.164 format
    When the customer enters phone "415 555 0100"
    Then the response is 400 "VALIDATION_ERROR" with a pointer to the phone field

  Scenario: A fourth address line is rejected
    When four address lines are sent
    Then the response is 400 "VALIDATION_ERROR" pointing at the address lines field

  Scenario: Role without address book manage cannot save to the book
    Given a role with "shipment:create" but without "address_book:manage"
    When the customer ticks "save to address book"
    Then the shipment step still saves and the address-book save returns 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant address book entry
    When a customer selects an address book entry of another organisation
    Then the response is 404 "NOT_FOUND"

  Scenario: Step 1 save is audited without personal values
    Then an UPDATE audit entry on "shipment" exists with changed field names and masked personal values

  Scenario: UI standard
    Then the step passes the UI standard at 360 px (one step per screen) and 1280 px in en, es and fr, with field errors announced to screen readers
```

### US-176 — Step 1: address validation against country rules
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-175, EPIC-17
- **Linked REQs:** REQ-BOOK-006
- **As a** customer **I want** immediate, specific address errors **so that** the carrier does not reject my booking later.

#### Acceptance criteria
```gherkin
Feature: Address validation
  Scenario: Valid US to IN addresses pass
    When the sender postcode is "10001" in US state "NY" and the receiver postcode is "400001" in IN state "Maharashtra"
    Then step 1 validation passes

  Scenario: Postcode pattern violation
    When the receiver postcode is "4000" for IN
    Then the response is 400 "VALIDATION_ERROR" with a pointer to the receiver postcode and a localised message

  Scenario: Required state missing
    When a US address omits the state
    Then validation fails with a field-level error on state

  Scenario: Field longer than the strictest carrier limit
    When an address line exceeds the maximum length from reference data
    Then validation fails with a field-level error naming the limit

  Scenario: Country differs from the selected quote option
    When the receiver country is "CA" while the option's destination is "IN"
    Then the response is 422 "ADDRESS_COUNTRY_MISMATCH"

  Scenario: Client and server share the rules
    Then the same invalid input is rejected identically by the browser form and by the API

  Scenario: Permission paths
    Then an unauthenticated call gets 401 "AUTH_REQUIRED", a Viewer gets 403 "AUTHZ_DENIED" and another organisation's draft gets 404 "NOT_FOUND"
```

### US-177 — Step 1: required tax and identity references
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-175, EPIC-17
- **Linked REQs:** REQ-BOOK-008
- **As an** importer-bound sender **I want** to be asked for the receiver identity or tax number the destination requires **so that** customs does not hold the parcel.
- **Notes:** Reference types and patterns are compliance-pack data. US to IN is the seeded case. Values are restricted personal data.

#### Acceptance criteria
```gherkin
Feature: Required tax and identity references
  Scenario: US to IN requires a receiver reference
    Given the pack for US to IN requires a receiver identity or tax reference
    When the customer completes step 1 without it
    Then step 1 is not complete and a field-level error names the missing reference

  Scenario: Well-formed reference completes the step
    When the customer enters a reference matching the pack pattern
    Then step 1 completes and the value is shown masked after entry

  Scenario: Malformed reference
    When the reference does not match the pack pattern
    Then the response is 400 "VALIDATION_ERROR" with a pointer to the reference field

  Scenario: Lane with no requirement
    Given a DOMESTIC US shipment
    Then no reference field is shown and none is required

  Scenario: Value never leaks
    Then the reference value does not appear in logs, audit values, notifications or the public tracking page, and the audit entry shows the field as masked

  Scenario: Permission paths
    Then unauthenticated gets 401 "AUTH_REQUIRED", Viewer gets 403 "AUTHZ_DENIED" and a cross-tenant draft gets 404 "NOT_FOUND"
```

### US-178 — Step 1: carrier address suggestions
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-176, EPIC-06
- **Linked REQs:** REQ-BOOK-007
- **As a** customer **I want** to see the carrier's corrected address next to mine **so that** I can avoid delivery failures.

#### Acceptance criteria
```gherkin
Feature: Carrier address suggestions
  Scenario: Suggestion shown and accepted
    Given the Mock carrier returns a corrected address for the entered receiver address
    When the customer presses "Use suggestion"
    Then the fields take the suggested values and the draft records "address_suggestion_accepted"

  Scenario: Customer keeps their entry
    When the customer presses "Keep mine"
    Then the entered address is stored unchanged

  Scenario: Suggestion times out
    Given Mock "latency=5000" on validateAddress
    Then after 3 s the step continues without a suggestion and is not blocked

  Scenario: Carrier without validateAddress
    Given the selected carrier declares validateAddress false
    Then no suggestion UI is shown and no carrier call is made

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED", another organisation's draft gets 404
```

### US-179 — Autosave and offline edit queue
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-172
- **Linked REQs:** REQ-BOOK-004
- **As a** customer on a poor connection **I want** my edits saved automatically **so that** nothing is lost.

#### Acceptance criteria
```gherkin
Feature: Autosave and offline queue
  Scenario: Autosave after one second of inactivity
    When the customer edits a field and stops typing for 1 second
    Then one save request is sent, the indicator shows "Saving" then "Saved", the step does not advance and no pricing call is made

  Scenario: Offline edits are queued and replayed in order
    Given the browser goes offline and the customer edits two fields in order
    When the connection returns
    Then both edits are sent in the original order and the indicator shows "Saved"

  Scenario: Version conflict on reconnect
    Given the draft changed on another device while offline
    When the queued edit is sent
    Then the per-field version check applies and a conflicting field shows the newer value with a review prompt

  Scenario: Invalid value is not silently dropped
    When an autosaved value fails server validation
    Then the field shows its error and the indicator shows "Not saved"

  Scenario: Permission and UI states
    Then a Viewer sees read-only fields, the offline state banner is shown while offline, and the UI standard holds in en/es/fr
```

### US-180 — Step 2: contents, customs applicability and document declaration
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-173, US-174, EPIC-17
- **Linked REQs:** REQ-BOOK-009, REQ-CUST-001, REQ-CUST-002
- **As a** customer **I want** step 2 to ask only for the contents information my shipment needs **so that** I am not burdened with customs data when it does not apply.

#### Acceptance criteria
```gherkin
Feature: Step 2 contents and customs applicability
  Scenario: PARCEL US to IN shows the customs section
    Given content type PARCEL, direction EXPORT and a pack lane rule "customs required"
    When the customer opens step 2
    Then a contents description field (3 to 100 characters) and the customs section are shown
    And step 2 cannot complete until the customs validations pass

  Scenario: Domestic parcel needs no customs
    Given a DOMESTIC PARCEL shipment
    Then the customs section is hidden and not required

  Scenario: Intra-EU parcel needs no customs
    Given a lane marked "customs not required" in the EU template pack
    Then the customs section is hidden and not required

  Scenario: DOCUMENT shipment shows the declaration instead
    Given content type DOCUMENT where the pack requires a non-commercial declaration
    Then the attestation "these items are documents with no commercial value" is required and no customs lines are offered
    When a client posts customs lines for a DOCUMENT shipment
    Then the response is 422 "VALIDATION_ERROR" rejecting the lines

  Scenario: Description length
    When the description has 2 or 101 characters
    Then the response is 400 "VALIDATION_ERROR" pointing at the description

  Scenario: Permission paths
    Then unauthenticated gets 401 "AUTH_REQUIRED", Viewer gets 403 "AUTHZ_DENIED", cross-tenant gets 404 "NOT_FOUND"

  Scenario: Step save is audited
    Then an UPDATE audit entry on "shipment" records step 2 completion and the declaration (without free text)

  Scenario: UI standard
    Then the step passes the UI standard at 360 px and 1280 px in en/es/fr
```

### US-181 — Step 2: customs lines and reason for export
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-180
- **Linked REQs:** REQ-CUST-003, REQ-CUST-004
- **As a** customer shipping goods abroad **I want** to list each item with value, weight and origin **so that** customs paperwork is correct.

#### Acceptance criteria
```gherkin
Feature: Customs lines and reason for export
  Scenario: Valid line and calculated declared value
    When the customer adds a line: description "Cotton shirts", quantity 3, unit value 12.50 USD, unit net weight 200 g, code "610910", country of manufacture "IN"
    Then the declared customs value is 37.50 USD and is not editable

  Scenario: Reason for export is mandatory
    When no reason for export is chosen
    Then step 2 is blocked with a field error; allowed values are SALE, GIFT, SAMPLE, PERSONAL_EFFECTS, REPAIR_RETURN, RETURNED_GOODS

  Scenario Outline: Line limits
    When a line has <field> = <value>
    Then the response is 400 "VALIDATION_ERROR" pointing at <field>
    Examples:
      | field         | value  |
      | quantity      | 0      |
      | quantity      | 100000 |
      | unit_value    | 0      |
      | description   | ab     |

  Scenario: Fifty-first line
    Given 50 lines exist
    When a 51st line is added
    Then it is refused with "VALIDATION_ERROR"

  Scenario: Mixed currencies
    When two lines use USD and INR
    Then the response is 422 "CUSTOMS_CURRENCY_MIXED" at the offending field

  Scenario: Net weights exceed package weight
    Given the package weighs 2 kg
    When net weights sum to 2.5 kg
    Then the response is 422 "CUSTOMS_WEIGHT_EXCEEDS_PACKAGE"

  Scenario: Permission paths
    Then unauthenticated gets 401, a role lacking "customs:manage" gets 403 "AUTHZ_DENIED", cross-tenant draft gets 404

  Scenario: Audit
    Then saving lines writes UPDATE on "shipment" with line count and declared value total

  Scenario: UI standard
    Then lines are editable on 360 px (one line card per row) and 1280 px (table), with errors per field, in en/es/fr
```

### US-182 — Step 2: commodity code search and format validation
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-181, EPIC-17
- **Linked REQs:** REQ-CUST-006, REQ-CUST-007
- **As a** customer **I want** to find an HS code by keyword or prefix **so that** I can fill customs lines without a broker.

#### Acceptance criteria
```gherkin
Feature: Commodity code search and format validation
  Scenario: Keyword search
    When an anonymous or signed-in client searches "shirt" (at least 2 characters)
    Then at most 20 results are returned with code and localised description, labelled "sample data", and p95 latency is at most 300 ms

  Scenario: Selecting a result fills the line
    Given the line description is empty
    When the customer selects result "610910"
    Then the code and the description are filled

  Scenario: Query too short
    When the query is "a"
    Then the response is 400 "VALIDATION_ERROR"

  Scenario Outline: Code format
    When the code "<code>" is entered
    Then the outcome is <outcome>
    Examples:
      | code          | outcome                                                  |
      | 6109.10       | accepted (dots stripped, 6 digits)                       |
      | 61091000      | accepted (8 digits)                                      |
      | 6109100       | 422 "COMMODITY_CODE_FORMAT" (7 digits)                   |
      | 61A910        | 422 "COMMODITY_CODE_FORMAT"                              |
      | 99999999      | accepted with a non-blocking "not in sample list" warning |

  Scenario: Length not accepted by the destination pack
    Given the destination pack accepts only 6 and 8 digits
    When a 10-digit code is entered
    Then the response is 422 "COMMODITY_CODE_FORMAT"

  Scenario: Search is public, validation requires permission
    Then the search works without a session (rate limited to 120 per minute per IP) and a Viewer saving a line gets 403 "AUTHZ_DENIED"

  Scenario: Locales
    Then search results return descriptions in en, es and fr matching the page locale
```

### US-183 — Step 2: prohibited and restricted item check
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-180, EPIC-17
- **Linked REQs:** REQ-CUST-009
- **As a** customer **I want** to be warned or blocked when my item cannot be shipped **so that** I do not pay for a shipment that will be refused.
- **Notes:** DR-B24, EC-B10. Server enforces at step 2 completion and again at checkout (US-208).

#### Acceptance criteria
```gherkin
Feature: Prohibited and restricted item check
  Scenario: Inline prohibited match blocks continuation
    Given a seeded prohibited term for destination IN
    When the customer types that term in the contents description and 400 ms pass
    Then an inline error names the list entry and the Continue action is disabled

  Scenario: Server enforces when the client check is bypassed
    When the term is posted directly to step 2 completion
    Then the response is 422 "ITEM_PROHIBITED" naming the list entry and not echoing the user's text
    And the user's text is absent from logs

  Scenario: Restricted match needs acknowledgement
    Given a seeded restricted term
    When the customer acknowledges the warning
    Then the acknowledgement is stored with user and timestamp and step 2 can complete

  Scenario: Match rules
    Then matching is case- and accent-insensitive, whole-word, in the user's locale plus English, uses seeded synonyms, and also matches the commodity-code chapter prefix of customs lines

  Scenario: Carrier list applies
    Given the selected carrier's list prohibits an item the destination list allows
    Then the item is blocked with "ITEM_PROHIBITED"

  Scenario: Clean text
    When the description is "Cotton shirts"
    Then no warning is shown

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED", cross-tenant 404

  Scenario: Audit
    Then a blocked attempt writes an audit entry with outcome DENIED and the list entry ID, and an acknowledgement writes CREATE on "restricted_acknowledgement"

  Scenario: UI standard
    Then the inline messages are announced (aria-live), shown in en/es/fr and axe clean at 360 px and 1280 px
```

### US-184 — Dangerous-goods attestation and explicit screening status
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-180
- **Linked REQs:** REQ-CUST-010, REQ-CUST-011
- **As the** operator **I want** every shipment to carry a no-dangerous-goods attestation and an explicit screening status **so that** we have a defensible record and no silent stub.

#### Acceptance criteria
```gherkin
Feature: DG attestation and screening status
  Scenario: Attestation recorded
    When the customer ticks "I confirm this shipment contains no dangerous goods" shown with examples (lithium batteries, aerosols, flammable liquids, compressed gas)
    Then an attestation is stored with user, timestamp and wording version

  Scenario: Booking blocked without attestation
    When checkout is started for a shipment without the attestation
    Then the response is 422 "DG_ATTESTATION_REQUIRED"

  Scenario: Applies to documents and domestic shipments
    Given a DOMESTIC DOCUMENT shipment
    Then the attestation is still required

  Scenario: Screening status is explicit
    When a shipment is booked
    Then the API returns screening_status "NOT_SCREENED" and the booking decision is unchanged by it
    And a contract test asserts the field on every booked shipment with enumeration NOT_SCREENED, CLEARED, REVIEW, BLOCKED

  Scenario: Other screening values are unreachable in M1
    When a client tries to set screening_status "CLEARED"
    Then the response is 400 "VALIDATION_ERROR"

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED", cross-tenant gets 404

  Scenario: Audit
    Then recording the attestation writes CREATE on "dg_attestation" with the wording version
```

### US-185 — Incoterm choice and de-minimis hint
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-181, EPIC-06
- **Linked REQs:** REQ-CUST-005, REQ-CUST-008
- **As a** customer **I want** to choose who pays duties and see a duties hint **so that** the receiver is not surprised.

#### Acceptance criteria
```gherkin
Feature: Incoterm and de-minimis hint
  Scenario: DAP is the default with its consequence shown
    Then Incoterm "DAP" is preselected with the text "receiver pays duties and taxes"

  Scenario: DDP offered only when supported
    Given the service declares DDP support, the destination pack permits it and the adapter returned a "DUTIES_TAXES_ESTIMATE" charge line
    Then DDP is selectable with the text "sender pays duties and taxes"
    When any of those three conditions is false
    Then DDP is not offered, and a posted "DDP" returns 422 "VALIDATION_ERROR"

  Scenario: Hint below threshold
    Given a declared value converted to the pack's threshold currency is below the destination de-minimis threshold
    Then the hint "may be exempt from duties" is shown, flagged non-binding and "unreviewed" when the pack is unreviewed

  Scenario: Hint above threshold
    Then "duties and taxes are likely payable" is shown

  Scenario: No threshold means no hint
    Given the destination pack has no threshold
    Then no hint is shown

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED"
```

### US-186 — Commercial and pro-forma invoice content and carrier customs documents
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-181, EPIC-11
- **Linked REQs:** REQ-CUST-012, REQ-CUST-013
- **As a** customer **I want** a correct commercial or pro-forma invoice generated from my customs data **so that** I can attach it to the parcel.
- **Notes:** Generation is run by the document job (US-223, EPIC-11); this story owns invoice content and type selection. Language is English only.

#### Acceptance criteria
```gherkin
Feature: Invoice content and carrier customs documents
  Scenario: SALE produces a commercial invoice
    Given a booked shipment with reason for export "SALE" and 2 customs lines
    When the document job runs
    Then a PDF document of type COMMERCIAL_INVOICE exists containing sender, receiver, order number, shipment reference, date, Incoterm, currency, each line with code and country of manufacture, line and total values, reason for export and a signature statement, in English

  Scenario Outline: Other reasons produce a pro-forma invoice
    Given reason for export "<reason>"
    Then a PRO_FORMA_INVOICE is generated and no COMMERCIAL_INVOICE
    Examples:
      | reason           |
      | GIFT             |
      | SAMPLE           |
      | PERSONAL_EFFECTS |
      | REPAIR_RETURN    |
      | RETURNED_GOODS   |

  Scenario: Carrier-returned customs document is stored
    Given the carrier returns a customs declaration at shipment creation
    Then a CARRIER_CUSTOMS_DECLARATION document is linked to the shipment with hash and version
    And when the carrier returns none, no such document exists

  Scenario: Shipment without customs data
    Given a DOMESTIC shipment
    Then no invoice is generated

  Scenario: Other organisation cannot read the invoice
    When a customer of another organisation requests the invoice
    Then the response is 404 "NOT_FOUND"; unauthenticated gets 401 "AUTH_REQUIRED"; a role without "document:read" gets 403 "AUTHZ_DENIED"

  Scenario: Audit
    Then invoice generation writes CREATE on "document" with type, version and SHA-256
```

### US-187 — Carrier customs field mapping inside adapters
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-181, EPIC-06
- **Linked REQs:** REQ-CUST-015
- **As a** developer **I want** customs data mapped to each carrier's fields inside the adapter **so that** booking works per carrier while the Platform record stays complete.

Permission path: not applicable — adapter-internal mapping run by the system actor; there is no end-user principal. A second negative scenario is included instead.

#### Acceptance criteria
```gherkin
Feature: Carrier customs field mapping
  Scenario: Mapping passes the contract suite
    Given a customs fixture per carrier (DHL, FedEx, UPS) and the Mock carrier
    When the shared contract suite runs the customs mapping case
    Then each adapter emits the carrier's required customs fields including Incoterm and reason for export

  Scenario: Over-long description is truncated, full text kept
    Given a line description of 100 characters and a carrier maximum of 35
    When the adapter maps the line
    Then the carrier payload holds the first 35 characters, the Platform record keeps all 100 and the raw record is marked "truncated"

  Scenario: Missing mandatory carrier field
    Given a line without a country of manufacture reaches the adapter
    Then the adapter returns canonical error "CUSTOMS_DATA_INVALID" and makes no carrier call

  Scenario: Carrier rejects customs data
    Given Mock "error=CUSTOMS_DATA_INVALID"
    Then the booking fails with that canonical code and the saga compensation of US-204 runs
```

### US-188 — Paperless customs upload with printed-copy fallback
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-186, EPIC-06
- **Linked REQs:** REQ-CUST-014
- **As a** customer **I want** my invoice sent to the carrier electronically **so that** I do not need to print it.

#### Acceptance criteria
```gherkin
Feature: Paperless customs upload
  Scenario: Upload after booking
    Given the carrier declares paperless support
    When the shipment is booked
    Then uploadCustomsDocuments is called with the invoice and the outcome "UPLOADED" is recorded on the shipment

  Scenario: Upload failure never fails the booking
    Given the upload fails
    Then the shipment remains BOOKED/LABEL_READY, the failure is recorded, the confirmation page shows printed-copy instructions and the document job retries the upload

  Scenario: Carrier without paperless
    Given paperless support is false
    Then no upload is attempted and printed-copy instructions are shown

  Scenario: Audit
    Then each upload attempt writes a carrier_call audit entry with outcome and correlation ID and no payload

  Scenario: Permission paths
    Then the confirmation outcome is visible only with "shipment:read" (403 otherwise) and to the owning organisation (404 for others)
```

### US-189 — Step 3: collection mode choice
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-174, EPIC-12
- **Linked REQs:** REQ-BOOK-010
- **As a** customer **I want** to choose between courier pickup and drop-off **so that** the carrier collects my parcel the way I prefer.
- **Notes:** Pickup details are EPIC-12 (US-232..US-234); drop-off list is US-239.

#### Acceptance criteria
```gherkin
Feature: Step 3 collection mode
  Scenario: Pickup chosen
    When the customer chooses "Courier pickup"
    Then collection mode PICKUP is stored on the draft and the pickup date and window inputs are shown

  Scenario: Drop-off offered only when supported
    Given the selected service declares drop-off support
    Then "Drop-off" is shown; for a service without support it is not shown

  Scenario: Switching clears the other mode's data
    Given a pickup date and window are set
    When the customer switches to DROP_OFF
    Then the pickup data is cleared and the stored mode is DROP_OFF

  Scenario: Unsupported mode via API
    When a client posts DROP_OFF for a service without drop-off support
    Then the response is 422 "VALIDATION_ERROR"

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED", cross-tenant gets 404

  Scenario: Audit
    Then the mode change writes UPDATE on "shipment"

  Scenario: UI standard
    Then step 3 passes the UI standard at 360 px and 1280 px in en/es/fr
```

### US-190 — Step 4: extras, cover and references
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-174, EPIC-07
- **Linked REQs:** REQ-BOOK-011
- **As a** customer **I want** to add cover and references **so that** my parcel is protected and I can match it to my own records.

#### Acceptance criteria
```gherkin
Feature: Step 4 extras
  Scenario: Add additional cover
    Given insured value 100.00 USD and a 2 percent rate with minimum 5.00
    When the customer enables cover
    Then the server recomputes the price using stored carrier cost with no new carrier call and the summary adds a 5.00 USD cover line

  Scenario: Insured value above maximum
    When the insured value exceeds the maximum insurable value
    Then "COVER_VALUE_EXCEEDS_MAXIMUM" is shown, the previous price is kept and no cover line is added

  Scenario: References
    When the customer enters customer reference "PO-2026/11.A"
    Then it is saved; a value of 31 characters or containing "<" is rejected with "VALIDATION_ERROR"; at most 3 reference fields are accepted

  Scenario: Delivery options limited to priced carrier options
    Then only delivery options returned with a price in the rate response are shown

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer 403 "AUTHZ_DENIED", cross-tenant 404

  Scenario: Audit
    Then cover and reference changes write UPDATE on "shipment"

  Scenario: UI standard
    Then the step passes the UI standard in en/es/fr at 360 px and 1280 px
```

### US-191 — Step 5: review with itemised price and edit-back
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-175, US-181, US-189
- **Linked REQs:** REQ-BOOK-012
- **As a** customer **I want** to review everything and the full price before paying **so that** there are no surprises.

#### Acceptance criteria
```gherkin
Feature: Step 5 review and basket
  Scenario: Review shows everything
    Then the page shows sender, receiver, contents, customs summary, collection, extras, the itemised price (base, fuel, surcharges, cover, discounts, tax, total), currency and quote expiry time
    And the price equals the stored snapshot, not a browser recomputation

  Scenario: Edit an earlier step
    When the customer chooses "Edit" on sender
    Then step 1 opens with data and returning to step 5 shows the updates

  Scenario: Editing a rate-relevant field re-quotes
    When the customer changes the package weight from step 5
    Then a new quote is created, the previous option is invalidated and the draft returns to DRAFT until a new option is selected

  Scenario: Incomplete earlier step
    Given step 2 is incomplete
    Then "Continue to payment" is disabled with the missing step named

  Scenario: Expired quote
    Given the quote expired
    Then the page shows "quote expired" with a re-quote action

  Scenario: Permission paths
    Then unauthenticated gets 401, Viewer gets 403 "AUTHZ_DENIED" and cross-tenant gets 404

  Scenario: Audit
    Then opening the review of a shipment writes VIEW on "shipment"

  Scenario: UI standard
    Then the page passes the UI standard (sticky price summary at 360 px and 1280 px, en/es/fr, six states)
```

### US-192 — Order basket model: 1-10 shipments, one currency
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-172
- **Linked REQs:** REQ-BOOK-013
- **As a** customer **I want** several shipments in one order paid once **so that** I pay a single charge.
- **Notes:** DR-B33, EC-B28. The 10-shipment maximum is configuration.

#### Acceptance criteria
Permission path: covered by scenario "Another organisation's order".
```gherkin
Feature: Order basket model
  Scenario: Shipment joins the open order
    When a customer completes step 5 of a shipment
    Then it belongs to an open order of 1 shipment in the sell currency USD

  Scenario: Eleventh shipment refused
    Given an open order with 10 shipments
    When an 11th is added
    Then the response is 422 "VALIDATION_ERROR" naming the maximum of 10

  Scenario: Mixed currency refused
    Given a USD order
    When an INR shipment is added
    Then the response is 422 "ORDER_CURRENCY_MISMATCH" and the user is offered a separate order

  Scenario: Another organisation's order
    Then the response is 404 "NOT_FOUND"; unauthenticated 401 "AUTH_REQUIRED"; Viewer adding 403 "AUTHZ_DENIED"

  Scenario: Audit
    Then creating the order and adding a shipment write CREATE/UPDATE on "order" with shipment count and currency
```

### US-193 — Add and remove shipments in the open order
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-192
- **Linked REQs:** REQ-BOOK-014
- **As a** business customer **I want** to add another shipment and remove one **so that** I can ship several parcels in one checkout.

#### Acceptance criteria
```gherkin
Feature: Add and remove shipments
  Scenario: Add another shipment with sender prefilled
    When the customer chooses "Add another shipment"
    Then a new draft starts with the sender details copied and the order total updates after it is added

  Scenario: Remove recalculates
    When the customer removes shipment 2 of 3 before checkout
    Then the order total is recalculated and the removed draft stays in the drafts list

  Scenario: Remove the last shipment
    When the only shipment is removed
    Then the basket is empty and the user returns to the quote widget

  Scenario: Remove after checkout started
    Given the order is PENDING_PAYMENT
    Then removal returns 409 "CONFLICT"

  Scenario: Permission paths
    Then Viewer gets 403 "AUTHZ_DENIED", unauthenticated 401, cross-tenant 404

  Scenario: Audit
    Then add and remove write UPDATE on "order"
```

### US-194 — Coupon entry on the review step
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-191, EPIC-07
- **Linked REQs:** REQ-BOOK-015
- **As a** customer **I want** to apply a coupon **so that** I get my discount.

#### Acceptance criteria
```gherkin
Feature: Coupon on review
  Scenario: Valid coupon
    When the customer enters " save10 " (trimmed, case-insensitive)
    Then the discount appears per eligible shipment, the total drops and no carrier call is made

  Scenario Outline: Invalid coupon
    When the code is <state>
    Then the error is "<code>" with a localised message
    Examples:
      | state                        | code             |
      | unknown or ineligible        | COUPON_INVALID   |
      | past its end date            | COUPON_EXPIRED   |
      | out of redemptions           | COUPON_EXHAUSTED |

  Scenario: Remove coupon
    When the customer removes the coupon
    Then the original total is restored

  Scenario: Coupon expires before payment
    Given a coupon applied on review expired
    When checkout is started
    Then the order total is recomputed without it and shown before the customer pays, and no redemption is counted

  Scenario: Permission paths
    Then unauthenticated 401, Viewer 403 "AUTHZ_DENIED", cross-tenant 404
```

### US-195 — Step 7: confirmation page
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-191, EPIC-10, EPIC-11, EPIC-12
- **Linked REQs:** REQ-BOOK-017
- **As a** customer **I want** a confirmation with everything I need next **so that** I can print the label and know when the courier comes.

#### Acceptance criteria
```gherkin
Feature: Confirmation page
  Scenario: Booked order with a pickup
    Given an order "US-12345678X" with a shipment in LABEL_READY and a scheduled pickup
    Then the page shows the order number, carrier, service, tracking number, status, label and customs document downloads, an email-documents action, pickup reference and window in sender local time, next-step instructions, a tracking link and the paid amount
    And "Test mode" is shown when the gateway is Mock or Stripe test

  Scenario: Documents still generating
    Given label generation is pending
    Then the page shows a pending state and updates without reload when documents are ready

  Scenario: Drop-off shipment
    Given collection mode DROP_OFF
    Then the service point, latest drop-off time and what to bring are shown instead of a pickup reference

  Scenario: Pickup failed
    Given the pickup failed after booking
    Then the page shows a "Schedule pickup" action and the booking remains valid

  Scenario: Page reachable later
    Then the same page opens from the shipment detail

  Scenario: Permission paths
    Then another organisation's order gives 404 "NOT_FOUND", unauthenticated 401 "AUTH_REQUIRED", a role without "shipment:read" 403 "AUTHZ_DENIED"

  Scenario: Audit
    Then opening the page writes VIEW on "shipment"

  Scenario: UI standard
    Then the page passes the UI standard (en/es/fr, six states including offline, 360 px and 1280 px, keyboard operable, axe clean)
```

### US-196 — Self-service shipment cancellation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** EPIC-10, EPIC-11, EPIC-12
- **Linked REQs:** REQ-BOOK-029
- **As a** customer **I want** to cancel a booked shipment before collection and get my money back **so that** a mistake costs nothing (D-017).
- **Notes:** DR-B20, DR-B21, EC-B19, EC-B27. Void-failure handling is US-215; refund is US-216; label void is US-229; pickup cancel is US-237.

#### Acceptance criteria
```gherkin
Feature: Self-service cancellation
  Scenario Outline: Cancellable states
    Given a shipment in <state> with no PICKED_UP or later tracking event
    When a user with "shipment:cancel" cancels with reason "CHANGED_MIND"
    Then the shipment goes to CANCELLED, the pickup is cancelled, the carrier shipment is voided, the label is voided and the full amount is refunded, ending in REFUNDED
    Examples:
      | state            |
      | BOOKED           |
      | LABEL_READY      |
      | PICKUP_SCHEDULED |

  Scenario: Draft, quoted or pending payment
    Given a shipment in DRAFT, QUOTED or PENDING_PAYMENT
    When it is cancelled
    Then it becomes CANCELLED with no carrier call and no refund

  Scenario: Reason code required
    When no reason is sent or the reason is "BORED"
    Then the response is 422 "REASON_REQUIRED"; note text over 200 characters returns 400 "VALIDATION_ERROR"

  Scenario: Already in transit
    Given a PICKED_UP event is recorded
    When the customer cancels
    Then the response is 409 "SHIPMENT_NOT_CANCELLABLE"

  Scenario: Cancel and first scan race
    Given the cancel and a first-scan event are processed concurrently
    Then the version check lets exactly one win; a losing cancel reports "SHIPMENT_NOT_CANCELLABLE"

  Scenario: Repeating the cancel is idempotent
    When the same cancel is sent twice with the same Idempotency-Key
    Then the second response is a replay with header "Idempotent-Replayed: true" and one cancellation and one refund exist

  Scenario: Same key with different reason
    When the key is reused with reason "OTHER"
    Then the response is 422 "IDEMPOTENCY_KEY_REUSED"

  Scenario: Permission paths
    Then a Viewer gets 403 "AUTHZ_DENIED", unauthenticated 401, another organisation 404 "NOT_FOUND"

  Scenario: Audit
    Then each effect writes UPDATE with the reason code: shipment to CANCELLED, VOIDED, REFUNDED, each with trigger USER_ACTION or SAGA_STEP

  Scenario: Multi-shipment order
    When one of three shipments is cancelled
    Then only that shipment's amount is refunded
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-BOOK-001 | US-171 |
| REQ-BOOK-002 | US-172 |
| REQ-BOOK-003 | US-174 |
| REQ-BOOK-004 | US-179 |
| REQ-BOOK-005 | US-175 |
| REQ-BOOK-006 | US-176 |
| REQ-BOOK-007 | US-178 |
| REQ-BOOK-008 | US-177 |
| REQ-BOOK-009 | US-180 |
| REQ-BOOK-010 | US-189 |
| REQ-BOOK-011 | US-190 |
| REQ-BOOK-012 | US-191 |
| REQ-BOOK-013 | US-192 |
| REQ-BOOK-014 | US-193 |
| REQ-BOOK-015 | US-194 |
| REQ-BOOK-017 | US-195 |
| REQ-BOOK-027 | US-173 |
| REQ-BOOK-028 | US-173 |
| REQ-BOOK-029 | US-196 |
| REQ-CUST-001 | US-180 |
| REQ-CUST-002 | US-180 |
| REQ-CUST-003 | US-181 |
| REQ-CUST-004 | US-181 |
| REQ-CUST-005 | US-185 |
| REQ-CUST-006 | US-182 |
| REQ-CUST-007 | US-182 |
| REQ-CUST-008 | US-185 |
| REQ-CUST-009 | US-183 |
| REQ-CUST-010 | US-184 |
| REQ-CUST-011 | US-184 |
| REQ-CUST-012 | US-186 |
| REQ-CUST-013 | US-186 |
| REQ-CUST-014 | US-188 |
| REQ-CUST-015 | US-187 |

REQ-BOOK rows 016, 018-026 and 030 are covered in EPIC-10.
