# EPIC-08 — Quote and comparison

- **Goal:** A guest or customer gets, understands, compares, saves, shares and (when needed) renews a priced quote for a parcel or document in under a minute without an account.
- **Milestone(s):** M0+M1
- **REQ areas covered:** REQ-QUOTE (REQ-QUOTE-001 to REQ-QUOTE-023)
- **Exit-demo contribution:** PRD 6.1 "Guest gets a mock quote" (quote within 1.5 s, itemised USD price, 24 h expiry stored); PRD 6.2 outline (results stream sorted cheapest with Cheapest and Fastest badges, select a service, itemised breakdown with tax and FX lines, quote claimed on sign-in).
- **Depends on epics:** EPIC-01 (PLAT), EPIC-03 (ORG/RBAC/RLS: `quote:*` permissions, tenant isolation), EPIC-04 (AUDIT), EPIC-05 (UI/I18N: design system, three locales), EPIC-06 (carrier fan-out and stream), EPIC-07 (pricing), EPIC-09 (BOOK: wizard step 1 claims the quote, re-quote entry), EPIC-10 (CUST: shared prohibited-items data), EPIC-14 (ACCT: display currency preference), EPIC-16 (API/SEC: rate limits, error catalogue), EPIC-17 (DATA/COMP: country reference data, FX seed, prohibited lists)

Conventions. Permissions: `quote:create` (anonymous principal and all roles), `quote:read` (own organisation's quotes), `quote:share`, `quote:delete`; public routes declare permission `public`. Guest quotes are read with an access token (at least 128 bits); a wrong or missing token returns 404 `NOT_FOUND`. Errors are `application/problem+json`. Audit: quote creation `CREATE` on `quote`; opening a saved quote `VIEW`; share link create/revoke `CREATE`/`DELETE` on `quote_share`; anonymous shared-link view `VIEW` with actor type anonymous and token ID (not the token).

UI standard (referred to below as "the UI standard"). Every UI story passes these checks, expressed as a scenario outline in each story: locales en, es, fr (no hard-coded strings, no layout overflow at 360 px with the longest locale); viewports 360 px (single column, touch targets at least 44 px) and 1280 px; six screen states where applicable (loading/skeleton, empty, error, partial results with a carrier-unavailable notice, permission-denied, offline); full keyboard operability with visible focus; axe-core reports zero violations at WCAG 2.2 AA.

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-154 | Quote entity with 24 h expiry | M0 | Must | M | EPIC-01, EPIC-04, US-140 | REQ-QUOTE-001 | DC |
| US-155 | Guest quoting with access token and rate limits | M0 | Must | M | US-154, EPIC-16 | REQ-QUOTE-002 | DC |
| US-156 | Quote input validation and package limits | M0 | Must | M | US-154, EPIC-17, EPIC-06 | REQ-QUOTE-003, REQ-QUOTE-004 | DC |
| US-157 | Quote widget units toggle and live billable weight | M1 | Must | M | US-139, US-158, EPIC-05 | REQ-QUOTE-005, REQ-QUOTE-006 |  |
| US-158 | Pre-rendered home page with quote widget | M1 | Must | M | US-156, EPIC-05 | REQ-QUOTE-023 | DC |
| US-159 | Result option card and price breakdown | M1 | Must | M | US-135, US-149, EPIC-05 | REQ-QUOTE-007, REQ-QUOTE-012 | DC |
| US-160 | Progressive results with skeletons and partial notice | M1 | Must | M | US-135, US-158 | REQ-QUOTE-008 | DC |
| US-161 | Sort by cheapest, fastest and best value with badges | M1 | Must | M | US-160 | REQ-QUOTE-009, REQ-QUOTE-011 | DC |
| US-162 | Filter results with URL state | M1 | Should | S | US-160 | REQ-QUOTE-010 |  |
| US-163 | Compare up to three options | M1 | Should | S | US-159, US-161 | REQ-QUOTE-013 |  |
| US-164 | Save a quote and reopen it | M1 | Should | M | US-166, EPIC-03 | REQ-QUOTE-014 |  |
| US-165 | Share a quote by link | M1 | Should | M | US-154, EPIC-03 | REQ-QUOTE-015 |  |
| US-166 | Claim a quote when booking starts | M1 | Must | S | US-154, EPIC-03, EPIC-09 | REQ-QUOTE-016 | DC |
| US-167 | Expired quote and one-action re-quote | M1 | Must | M | US-166, US-160, EPIC-09 | REQ-QUOTE-017 |  |
| US-168 | Rate-relevant change creates a new quote | M1 | Must | S | US-154, EPIC-09 | REQ-QUOTE-018 |  |
| US-169 | Display currency switcher and indicative converter | M1 | Should | M | US-148, EPIC-14 | REQ-QUOTE-019, REQ-QUOTE-022 |  |
| US-170 | Public prohibited-items lookup and volumetric calculator | M1 | Should | M | EPIC-10, EPIC-17, US-139 | REQ-QUOTE-020, REQ-QUOTE-021 |  |

## Stories

### US-154 — Quote entity with 24 h expiry
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01, EPIC-04, US-140
- **Linked REQs:** REQ-QUOTE-001
- **As a** guest shipper **I want** every price request stored as a quote that stays valid for 24 hours **so that** the price I saw does not change while I decide.
- **Notes:** Persists normalised inputs, priced options, pricing and FX snapshots, creation time, expiry = creation + `QUOTE_TTL_HOURS` (24). States ACTIVE, EXPIRED (derived), CLAIMED (DR-B14). Separate from any shipment. No deletion of expired quotes during the run.

#### Acceptance criteria
```gherkin
Feature: Quote entity
  Scenario: Mock quote stored with expiry
    Given a guest requests US 10001 to IN 400001, parcel, 2 kg, 30x20x10 cm
    When the rate request completes
    Then a quote exists holding normalised inputs, the priced options, the pricing configuration version, the FX snapshot and creation time
    And expiresAt equals createdAt plus 24 hours

  Scenario: First Mock result within 1.5 s
    Given the Mock carrier with default latency
    Then at least one Mock service with an itemised USD price is returned within 1500 ms

  Scenario: Quote is separate from shipments
    Then no shipment row is created by quoting

  Scenario: Expiry is derived from time
    Given a quote created 24 h and 1 s ago
    Then its state is EXPIRED and its row is still present

  Scenario: TTL is configuration
    Given QUOTE_TTL_HOURS=2
    Then a new quote expires after 2 hours

  Scenario: Quote prices never change
    Given a quote with total USD 23.00
    When margin configuration changes
    Then reading the quote still returns USD 23.00

  Scenario: Cross-tenant read
    Given a claimed quote of organisation A
    When a user of organisation B requests it
    Then the response is 404 NOT_FOUND

  Scenario: Role without quote:read
    Given a signed-in user whose role lacks quote:read requests an organisation quote
    Then the response is 403 AUTHZ_DENIED

  Scenario: Audit of creation and view
    When a quote is created
    Then one audit entry CREATE on entity quote exists written in the same transaction as the quote
    When a signed-in user with quote:read opens a saved quote
    Then one audit entry VIEW on entity quote exists
```

### US-155 — Guest quoting with access token and rate limits
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-154, EPIC-16
- **Linked REQs:** REQ-QUOTE-002
- **As a** guest shipper **I want** to get and re-open a quote with no account **so that** I see prices before any sign-up (D-009).
- **Notes:** Permission `public`. Access token at least 128 bits, unguessable, returned to the creating client. Limits 20 requests per minute and 100 per hour per IP (configuration, ASSUMED, A-035; identical in NFR-SEC-005 per D-035). 429 `RATE_LIMITED` with `Retry-After`. Wrong or missing token returns 404 (GAP-B-27, A-078). The token stops being honoured 7 days after the quote's expiry (404 thereafter) although the row is retained for 90 days (D-045, A-085, D-052). The per-IP limits are the first line only; the global anonymous carrier budget and daily quota guard (US-293, REQ-CARR-022/023, D-048) bound total guest carrier load, and an exhausted budget shows as `CARRIER_BUSY` per carrier, never as 429. A signed-in user calls `POST /quotes` under the `quote-create` class (30/min + 300/h per user, 1,000/h per organisation, US-040, D-053); a signed-in user still in `PENDING_VERIFICATION` is counted as an anonymous caller by the carrier budget (SEC-P3-29, US-293).

#### Acceptance criteria
Permission path: not applicable — `public` permission with a capability token; the "Wrong token" and "Missing token" → 404 scenarios are the access-control assertions (A-078).
```gherkin
Feature: Guest quoting
  Scenario: Guest creates and reads a quote
    Given an anonymous visitor
    When they POST a valid quote request
    Then the response is 201 with a quote id and an access token of at least 128 bits of entropy
    And the same visitor can GET the quote using that token

  Scenario: Wrong token
    When another visitor GETs the quote with a different token
    Then the response is 404 with code NOT_FOUND

  Scenario: Missing token
    When the quote is requested without a token and without a session
    Then the response is 404 with code NOT_FOUND

  Scenario: Per-minute limit
    Given 20 quote requests from one IP within a minute
    When a 21st request arrives
    Then the response is 429 with code RATE_LIMITED and a Retry-After header in seconds

  Scenario: Per-hour limit
    Given 100 requests from one IP within an hour, spaced under the per-minute limit
    Then the 101st is 429 RATE_LIMITED

  Scenario: Different IP is not limited
    Then a request from another IP succeeds

  Scenario: Idempotent creation
    Given a POST with Idempotency-Key K succeeded
    When the same request is replayed with K
    Then the stored response is returned with header Idempotent-Replayed true and no second quote

  Scenario: Token does not leak
    Then the token never appears in logs, audit values or URLs of the page referrer

  Scenario: Audit of anonymous creation
    Then an audit entry CREATE on entity quote exists with actor type anonymous

  Scenario: Guest access token stops being honoured 7 days after quote expiry
    Given a guest quote created at T with expires_at T+24 h and a valid access token
    When the quote is read with that token at T+24 h plus 7 days minus 1 minute (fake clock)
    Then the response is 200 and the quote is shown as expired
    When it is read with the same token at T+24 h plus 7 days plus 1 minute
    Then the response is 404 with code NOT_FOUND, identical in status, body and headers to a wrong-token response
    And the quote row still exists in the database until the 90-day purge

  Scenario: Per-IP limits are the first line and the anonymous carrier budget applies on top
    Given a guest below the per-IP limits of 20 per minute and 100 per hour
    And the anonymous carrier budget of US-293 is exhausted for one carrier account
    When the guest creates a quote
    Then the response is 201 and not 429
    And the quote result stream contains carrier_error {code: CARRIER_BUSY} for that carrier, or cached results for it
    And the other carriers' results are returned normally
```

### US-156 — Quote input validation and package limits
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-154, EPIC-17, EPIC-06
- **Linked REQs:** REQ-QUOTE-003, REQ-QUOTE-004
- **As a** guest shipper **I want** my inputs checked against country rules and service limits and to be told which limit excluded which service **so that** I fix problems instead of seeing silent gaps.
- **Notes:** Input validation (REQ-QUOTE-003) is M0; limit-based service exclusion (REQ-QUOTE-004) is M1. 1 to 20 packages; weight 0.1 kg to 1000 kg (or lb equivalent); each dimension 1 cm to 300 cm (or inch equivalent) (ASSUMED, GAP-B-20). Domestic quotes allowed.

#### Acceptance criteria
Permission path: not applicable — validation of a `public` route; anonymous may create and there is no deny path for `quote:create` (the scenario of that name documents this). Token-based read access is covered by US-155.
```gherkin
Feature: Quote input validation
  Scenario: Valid parcel input
    Given origin US 10001, destination IN 400001, parcel, residential=false, one package 2 kg 30x20x10 cm
    Then the quote is accepted

  Scenario: Postcode missing where the country requires it
    Given destination IN without a postcode
    Then the response is 400 VALIDATION_ERROR with a pointer to /destination/postcode

  Scenario: Postcode pattern invalid
    Given destination IN postcode "ABC"
    Then 400 VALIDATION_ERROR with pointer /destination/postcode

  Scenario: Domestic quote
    Given origin and destination both US
    Then the quote is accepted

  Scenario: Package count boundaries
    Then 1 and 20 packages are accepted and 0 and 21 return 400 VALIDATION_ERROR

  Scenario: Weight and dimension boundaries
    Then 0.1 kg and 1000 kg and 1 cm and 300 cm are accepted
    And 0.09 kg, 1000.1 kg, 0.9 cm and 300.1 cm return 400 VALIDATION_ERROR with a pointer to the field

  Scenario: Pound and inch equivalents
    Then 0.22 lb is accepted as at least 0.1 kg and 2205 lb is rejected as above 1000 kg

  Scenario: Unsupported country
    Given destination country "ZZ"
    Then 422 COUNTRY_NOT_SUPPORTED

  Scenario: Exceeding every service
    Given one 120 kg parcel and one 200 cm side parcel
    Then the option list is empty with reasons WEIGHT_EXCEEDED or DIMENSION_EXCEEDED per carrier and a prompt to split the shipment

  Scenario: Some services excluded with reasons
    Given a 70 kg parcel that exceeds one service's maximum but not another's
    Then the exceeded service is absent and the response states WEIGHT_EXCEEDED for it

  Scenario: Document limit
    Given content type DOCUMENT above the service document weight limit
    Then that service is excluded with WEIGHT_EXCEEDED

  Scenario: Anonymous may create; no deny path for quote:create
    Given an anonymous principal and each seeded role
    Then every one can create a quote and a payload with unknown fields returns 400 VALIDATION_ERROR
```

### US-157 — Quote widget units toggle and live billable weight
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-139, US-158, EPIC-05
- **Linked REQs:** REQ-QUOTE-005, REQ-QUOTE-006
- **As a** guest shipper **I want** sensible default units, a metric/imperial toggle and a live volumetric and billable weight **so that** I understand what I will be charged before I search.
- **Notes:** Default imperial for US origin, metric otherwise. Conversion on toggle uses exact constants 1 lb = 0.45359237 kg, 1 in = 2.54 cm, internal integer grams and millimetres (DR-B06). Toggle never changes a stored quote. Live values debounced at most 150 ms, shared helper with pricing. Divisor shown is the lowest-cost default for the origin unit system until services return.

#### Acceptance criteria
```gherkin
Feature: Widget units and live billable weight
  Scenario: Default units by origin
    When origin is US
    Then the unit system defaults to imperial (lb, in)
    When origin is IN
    Then it defaults to metric (kg, cm)

  Scenario: Toggle converts to the same physical size
    Given a package 2 kg 30x20x10 cm in metric
    When the user toggles to imperial
    Then the fields show 4.4 lb 11.8 x 7.9 x 3.9 in
    And the stored integer values remain 2000 g and 300 x 200 x 100 mm

  Scenario: Live weights
    Given a package 50 x 40 x 30 cm actual 4 kg
    When the user edits a dimension
    Then within 150 ms of the last keystroke volumetric 12.0 kg and billable 12.0 kg are displayed per package and in total
    And the values equal the pricing helper's output

  Scenario: Invalid value
    Given weight "abc" or a negative number
    Then an inline localised error is shown and the live weight is not updated

  Scenario: Toggle does not alter a saved quote
    Given a stored quote
    When the user toggles units on the page
    Then the stored quote and its prices are unchanged

  Scenario: Permission path (anonymous allowed)
    Given an anonymous visitor
    Then the widget and live weights work without sign-in
    And a signed-in role lacking quote:create does not exist, so no deny state applies

  Scenario Outline: UI standard for the widget weights
    Given the locale <locale> and the viewport <width>
    Then the units toggle and live weights are fully visible without horizontal scroll
    And every control is operable by keyboard with visible focus
    And axe reports zero WCAG 2.2 AA violations
    And the offline state shows a localised notice and keeps entered values
    Examples:
      | locale | width |
      | en     | 360   |
      | es     | 360   |
      | fr     | 1280  |
```

### US-158 — Pre-rendered home page with quote widget
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-156, EPIC-05
- **Linked REQs:** REQ-QUOTE-023
- **As a** guest shipper **I want** the home page and quote form to appear instantly **so that** I can start a quote on a slow phone connection.
- **Notes:** Static HTML shell with the form pre-rendered; results, wizard, checkout and account routes are client-rendered (D-026). LCP at most 2.5 s on the pre-rendered home (Lighthouse CI).

#### Acceptance criteria
```gherkin
Feature: Pre-rendered home with quote widget
  Scenario: Form is in the HTML
    When the home page HTML is fetched with JavaScript disabled
    Then the labels and fields for origin, destination, content type, residential flag, package weight and dimensions are present

  Scenario: LCP budget
    When Lighthouse CI runs on the pre-rendered home
    Then LCP is at most 2.5 s

  Scenario: Slow JavaScript
    Given the JavaScript bundle takes 5 s to load
    Then the fields are visible and focusable before hydration and entered values survive hydration

  Scenario: Results routes are client-rendered
    Then /quote results, wizard, checkout and account routes are not pre-rendered

  Scenario: Validation errors are localised
    Given an empty destination
    When the form is submitted
    Then a localised error is attached to the field and announced to screen readers

  Scenario: Submitting offline
    Given the browser is offline
    Then a localised offline notice is shown and the entered values are kept

  Scenario: Permission path (public page)
    Given an anonymous visitor
    Then the page is served with permission public and no redirect to sign-in

  Scenario Outline: UI standard for the home page
    Given locale <locale> and viewport <width>
    Then the widget, empty and error states render without overflow
    And all controls are keyboard operable with visible focus and axe reports zero WCAG 2.2 AA violations
    Examples:
      | locale | width |
      | en     | 360   |
      | es     | 1280  |
      | fr     | 360   |
```

### US-159 — Result option card and price breakdown
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-135, US-149, EPIC-05
- **Linked REQs:** REQ-QUOTE-007, REQ-QUOTE-012
- **As a** guest shipper **I want** each option to show what matters and to open an itemised breakdown **so that** I can choose confidently and see tax and FX lines.
- **Notes:** Card shows carrier logo, service name, total in display currency, estimated delivery date (transit days, next valid pickup date per REQ-PICK-002, destination holidays), transit days, collection or drop-off availability, included cover, booking cut-off countdown (origin local time; replaced by next-day pickup after cut-off) and printer hint. "Printer not required" only for QR or label-free drop-off. Breakdown rendered from stored charge lines, with no recomputation in the browser.

#### Acceptance criteria
```gherkin
Feature: Result option card and breakdown
  Scenario: Card content
    Given results from MOCK and the three fixture adapters
    Then each card shows logo, service name, total price, estimated delivery date, transit days, collection/drop-off availability, included cover, cut-off countdown and a printer hint

  Scenario: Printer not required only when offered
    Given a service with QR drop-off and one without
    Then only the QR drop-off service shows "printer not required"

  Scenario: Cut-off countdown
    Given the origin local time is 16:30 and the cut-off is 17:00
    Then the countdown shows 30 minutes
    When the origin local time passes 17:00
    Then the countdown disappears and the next-day pickup is shown

  Scenario: Itemised breakdown on demand
    When the user opens the breakdown of an option
    Then every charge line is listed: base freight, margin-included total, fuel, surcharges, cover, discounts, tax and the FX conversion line with rate and snapshot timestamp
    And the applied-rules explanation is shown in the display currency
    And net plus tax equals gross as displayed

  Scenario: No client recomputation
    Then the breakdown amounts equal the stored charge lines byte for byte

  Scenario: Stale FX flag
    Given the FX snapshot is 31 days old
    Then converted display amounts are marked indicative

  Scenario: Expired quote
    Given the quote is expired
    Then the cards show an expired notice and the select action is replaced by re-quote

  Scenario: Wrong guest token
    When the results page loads with a mismatched token
    Then the permission-denied state is shown (404 behind the scenes) with a link to start a new quote

  Scenario: Role without quote:read
    Given a signed-in user lacking quote:read opens an organisation quote
    Then the permission-denied state is shown (403 AUTHZ_DENIED)

  Scenario Outline: UI standard for cards and breakdown
    Given locale <locale> and viewport <width>
    Then cards stack in one column at 360 px and in a list with a side column at 1280 px
    And the breakdown opens as a keyboard-operable disclosure with focus management and axe reports zero violations
    And dates, numbers and currency use the locale format
    Examples:
      | locale | width |
      | en     | 360   |
      | es     | 1280  |
      | fr     | 360   |
```

### US-160 — Progressive results with skeletons and partial notice
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-135, US-158
- **Linked REQs:** REQ-QUOTE-008
- **As a** guest shipper **I want** results to appear as each carrier answers **so that** I can act on the first prices while others finish.
- **Notes:** Skeleton count equals the number of carriers still pending. Inline per-carrier notice for timeout or error. Banner "some carriers did not respond" when the final status has any non-OK carrier (EC-B01). Partial results remain selectable. Falls back to GET polling when SSE is blocked.

#### Acceptance criteria
```gherkin
Feature: Progressive results
  Scenario: Results appear per carrier with skeletons
    Given MOCK, DHL_EXPRESS, FEDEX and UPS are enabled and each answers at different times
    When the results page opens
    Then 4 skeleton placeholders are shown initially
    And each answer replaces one skeleton and the skeleton count equals the carriers still pending

  Scenario: Timeout gives inline notice and banner
    Given MOCK is driven with "latency=6000"
    Then by 5 s an inline notice for MOCK states it did not respond
    And a banner "some carriers did not respond" is shown
    And the other carriers' options remain selectable

  Scenario: All carriers fail
    Given every carrier returns ERROR
    Then the error state is shown with a retry action and no skeletons remain

  Scenario: No services match
    Given a request exceeding all limits
    Then the empty state explains limits per carrier and offers to edit the packages

  Scenario: SSE blocked
    Given the event stream cannot connect
    Then the page polls the fallback GET and renders results as they complete

  Scenario: Offline
    Given the browser goes offline mid-stream
    Then a localised offline notice is shown and received results stay visible

  Scenario: Wrong guest token and role without quote:read
    Then a mismatched token shows the permission-denied state (404) and a role lacking quote:read shows it (403 AUTHZ_DENIED)

  Scenario Outline: UI standard for progressive results
    Given locale <locale> and viewport <width>
    Then loading, empty, error, partial, permission-denied and offline states are each rendered correctly
    And skeletons are announced with a polite live region, controls are keyboard operable and axe reports zero violations
    Examples:
      | locale | width |
      | en     | 360   |
      | es     | 1280  |
      | fr     | 1280  |
```

### US-161 — Sort by cheapest, fastest and best value with badges
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-160
- **Linked REQs:** REQ-QUOTE-009, REQ-QUOTE-011
- **As a** guest shipper **I want** results sorted by price, speed or value with Cheapest and Fastest labels **so that** the best choice is obvious (PRD 6.2: sorted cheapest with badges).
- **Notes:** Cheapest = lowest gross price (ties fewer transit days); fastest = fewest transit days (ties lower price); best value = lowest score 0.6 x (price / lowest price) + 0.4 x (transit days / lowest transit days), ties lower price then carrier code alphabetically (DR-B17). Default sort best value. Badges provisional until `complete` or 5 s. REQ-QUOTE-011 is Should but sits on the M1 demo path (cheapest-with-badges), hence the story is Must by REQ-QUOTE-009.

#### Acceptance criteria
```gherkin
Feature: Sort and badges
  Scenario: Default sort is best value
    Given options A (gross 2000, 5 days), B (3000, 2 days), C (2500, 3 days)
    Then scores are A 0.6x1 + 0.4x2.5 = 1.60, B 0.6x1.5 + 0.4x1 = 1.30, C 0.6x1.25 + 0.4x1.5 = 1.35
    And the order is B, C, A

  Scenario: Cheapest and fastest sorts with ties
    Given two options priced 2000 with transit 4 and 2 days
    When sorted by cheapest
    Then the 2-day option is first
    When sorted by fastest with equal transit days
    Then the lower price is first

  Scenario: Best-value tie-break by carrier code
    Given equal score, equal price
    Then the carrier code alphabetically first wins

  Scenario: Badges and shared badge
    Then the lowest gross option is labelled Cheapest and the fewest-days option Fastest
    And one option can carry both badges
    And badges have a text alternative and are not conveyed by colour alone

  Scenario: Provisional badges
    Given the stream has not sent complete
    Then badges are marked provisional
    When complete arrives or 5 s elapse
    Then the provisional marking is removed

  Scenario: Re-sort on arrival does not move focus
    Given the user focuses or hovers an option
    When a cheaper option arrives
    Then the focused item keeps its on-screen position and focus is not lost

  Scenario: Invalid sort parameter
    When the URL contains sort=colour
    Then the default best-value sort is used and API calls return 400 INVALID_SORT

  Scenario: Permission path
    Given a mismatched guest token or a role lacking quote:read
    Then the sort controls are not rendered; the page shows permission-denied (404 / 403 AUTHZ_DENIED)

  Scenario Outline: UI standard for sort and badges
    Given locale <locale> and viewport <width>
    Then the sort control and badges are localised, keyboard operable and axe clean
    Examples:
      | locale | width |
      | en     | 1280  |
      | es     | 360   |
      | fr     | 360   |
```

### US-162 — Filter results with URL state
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-160
- **Linked REQs:** REQ-QUOTE-010
- **As a** guest shipper **I want** to filter by carrier, speed, collection mode and features **so that** I only see options that suit me.
- **Notes:** Filter state held in the URL query; bookmarkable; survives reload. Hidden-count with one-action reset.

#### Acceptance criteria
```gherkin
Feature: Result filters
  Scenario: Filter by carrier and speed
    When the user selects carrier FEDEX and speed express
    Then only FedEx express options remain and the count of hidden results is shown

  Scenario: Collection mode and features
    When the user selects drop-off and "printer not required"
    Then only matching options remain

  Scenario: URL state survives reload
    Given filters applied
    Then the URL query contains them and a reload restores the same view

  Scenario: One-action reset
    When the user activates "reset filters"
    Then all options show again and the query is cleared

  Scenario: Filters hide everything
    Then the empty state shows the hidden count and the reset action

  Scenario: Unknown filter value
    When the URL contains speed=teleport
    Then the value is ignored and the API returns 400 INVALID_FILTER

  Scenario: Responsive and accessible
    Given locales en, es and fr at 360 px and 1280 px
    Then filters open in a keyboard-operable panel, changes are announced in a live region and axe reports zero violations
```

### US-163 — Compare up to three options
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-159, US-161
- **Linked REQs:** REQ-QUOTE-013
- **As a** guest shipper **I want** to put up to three options side by side **so that** I can weigh price, speed, cover and surcharges.
- **Notes:** Client view over the stored quote; no extra carrier call.

#### Acceptance criteria
```gherkin
Feature: Compare options
  Scenario: Compare three
    When the user selects 3 options and opens compare
    Then price, transit days, delivery date, cover, collection mode and surcharges are shown side by side
    And no carrier or pricing request is made

  Scenario: Fourth selection refused
    Given 3 options are selected
    When the user selects a fourth
    Then an inline localised message appears and the selection remains 3

  Scenario: Deselect and replace
    When one option is deselected
    Then another can be selected

  Scenario: Compare after expiry
    Given the quote expired while comparing
    Then compare remains readable with an expired notice and re-quote action

  Scenario: Layout and accessibility
    Given en, es and fr at 360 px and 1280 px
    Then at 360 px the comparison scrolls horizontally with sticky labels or stacks by option, controls are keyboard operable and axe reports zero violations

  Scenario: Permission-denied state
    Given a mismatched guest token
    Then compare is not reachable and the permission-denied state is shown
```

### US-164 — Save a quote and reopen it
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-166, EPIC-03
- **Linked REQs:** REQ-QUOTE-014
- **As a** registered individual **I want** to save a quote and reopen it later **so that** I can book when ready.
- **Notes:** Requires sign-in and `quote:create`. Saving a guest quote after sign-in assigns it under the same once-only rule as claiming (US-166). Saved quotes are not extended; expiry stays 24 h from creation. `quote:delete` for own saved quotes.

#### Acceptance criteria
```gherkin
Feature: Saved quotes
  Scenario: Save and list
    Given a signed-in user with quote:create viewing a quote
    When they save it
    Then it appears under saved quotes with route, packages and best price

  Scenario: Reopen active quote
    When they open a saved quote
    Then the stored options and prices are shown unchanged
    And an audit entry VIEW on entity quote exists

  Scenario: Reopen expired quote
    Given the quote is past expiry
    Then an expired notice with a re-quote action is shown and the expiry is not extended

  Scenario: Save guest quote after sign-in
    Given a guest quote with token T
    When the user signs in and saves it
    Then the quote is owned by the user's organisation and T stops working

  Scenario: Already claimed by another organisation
    Then saving returns 409 QUOTE_ALREADY_CLAIMED

  Scenario: Delete own saved quote
    When a user with quote:delete deletes it
    Then it disappears from the list and an audit entry DELETE on quote exists

  Scenario: Unauthenticated
    When an anonymous visitor calls the save endpoint
    Then the response is 401 AUTH_REQUIRED

  Scenario: Role without permission
    Given a role lacking quote:delete
    Then delete returns 403 AUTHZ_DENIED

  Scenario: Cross-tenant
    Then another organisation's saved quote returns 404 NOT_FOUND

  Scenario: Layout and locales
    Given en, es and fr at 360 px and 1280 px
    Then the list shows loading, empty, error and permission-denied states, is keyboard operable and axe clean
```

### US-165 — Share a quote by link
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-154, EPIC-03
- **Linked REQs:** REQ-QUOTE-015
- **As a** registered individual **I want** to share a read-only quote link **so that** a colleague or friend can see options and prices without my personal data.
- **Notes:** Permission `quote:share`. Token at least 128 bits, carried in the share link's URL fragment and resolved with `POST /api/v1/public/shared-quotes/resolve {token}` (ADR-0016 amendment 2, D-043); the token never appears in a path, query string, access log or Referer. Shared view shows countries and cities, packages, content type, options and prices; no postcode, name, address, email, reference or other personal data. Read-only, expires with the quote. Mint-and-revoke (ADR-0014 amendment 4, SEC-P3-10; conditions per SEC-P3-32, D-055): every creation mints a new token and revokes the previous active share in the same transaction, writing CREATE plus an UPDATE (`revoked_at`, reason `SUPERSEDED`) on `quote_share`; an explicit revoke writes DELETE; at most 10 mints per quote per hour (`QUOTE_SHARE_MINTS_PER_HOUR=10`), then 429. Resolve returns one byte-identical 404 `NOT_FOUND` for an unknown, revoked, superseded or expired token (EC-B29); the shared page then shows "this shared quote is no longer available" with a link to start a new quote (no prefilled inputs; the earlier "expired with inputs prefilled" view is dropped). SEC-TC-53 (amended).

#### Acceptance criteria
```gherkin
Feature: Share a quote
  Scenario: Create a link
    Given the owner holds quote:share
    When they create a share link
    Then a token of at least 128 bits is returned and an audit entry CREATE on entity quote_share exists

  Scenario: Anonymous view shows only permitted data
    When an anonymous visitor opens the link
    Then the page reads the token from the URL fragment and posts it to POST /api/v1/public/shared-quotes/resolve
    And origin/destination countries and cities, packages, content type, options and prices are shown
    And the response contains no postcode, name, address, email or reference
    And an audit entry VIEW exists with actor type anonymous and the token ID but not the token

  Scenario: Token never travels in a URL
    When the share link is opened
    Then the request the browser sends to the server carries no token in path or query, the access log holds no token, and a GET with the token in the path or query returns 404 NOT_FOUND

  Scenario: Revoke
    When the owner revokes the link
    Then the link returns 404 NOT_FOUND and an audit entry DELETE on quote_share exists

  Scenario: Creating a second link mints a new token and revokes the previous one with its own audit entry
    Given an active share link L1 for the quote
    When the owner (or another member holding quote:share) creates a share link again
    Then a new token L2 is returned with 201 and L1 resolves to 404 NOT_FOUND
    And in the same transaction an audit entry CREATE on quote_share for L2 and an audit entry UPDATE on quote_share for L1 (revoked_at set, reason SUPERSEDED, the acting member as actor) exist
    And an Idempotency-Key header on the request is ignored (no replay; a retry mints again)

  Scenario: Mint cap per quote
    Given 10 share links were created for the same quote within the last hour
    When an 11th is created
    Then the response is 429 RATE_LIMITED with Retry-After and the 10th link still resolves

  Scenario Outline: Unknown, revoked, superseded and expired tokens are indistinguishable
    When POST /api/v1/public/shared-quotes/resolve is called with a token that is "<state>"
    Then the response is 404 NOT_FOUND and its status, headers (except Date and request IDs) and body bytes are identical across all four states
    And the response contains no quote inputs and no personal data
    Examples:
      | state       |
      | unknown     |
      | revoked     |
      | superseded  |
      | expired     |

  Scenario: Expired quote on the shared page
    Given the quote has expired
    When the link is opened
    Then the page shows "this shared quote is no longer available" with a link to start a new quote and shows no prices and no prefilled inputs

  Scenario: Read-only
    Then no select, save or book action is offered on the shared view

  Scenario: Role without quote:share
    Given a user whose role lacks quote:share
    When they create a share link
    Then the response is 403 AUTHZ_DENIED

  Scenario: Cross-tenant
    Given the quote belongs to another organisation
    Then creating a link returns 404 NOT_FOUND

  Scenario: Locale and layout
    Given en, es and fr at 360 px and 1280 px
    Then the shared view and the copy-link control are keyboard operable, announce the copy result and are axe clean
```

### US-166 — Claim a quote when booking starts
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-154, EPIC-03, EPIC-09
- **Linked REQs:** REQ-QUOTE-016
- **As a** registered individual **I want** my guest quote to become mine when I start booking **so that** it survives sign-in and stays private.
- **Notes:** Claim happens when wizard step 1 is first saved (requires sign-in). Owner is set once and is irreversible (DR-B14). After claim the guest token stops working; the quote is readable only by that organisation (RLS). Error code `QUOTE_ALREADY_CLAIMED` per the REQ.

#### Acceptance criteria
```gherkin
Feature: Claim a quote
  Scenario: Claim at step 1
    Given a guest quote with token T and a selected option
    When the user registers, verifies and saves wizard step 1
    Then the quote owner is set to the user's organisation
    And the selected option is still selected

  Scenario: Guest token stops working
    Given the quote was claimed
    When T is used to read the quote
    Then the response is 404 NOT_FOUND

  Scenario: Claimed by a different organisation
    Given the quote is claimed by organisation A
    When a user of organisation B starts booking from it
    Then the response is 409 QUOTE_ALREADY_CLAIMED and ownership is unchanged

  Scenario: Claim is idempotent for the same organisation
    When organisation A saves step 1 again
    Then the response is success and the owner is unchanged

  Scenario: Concurrent claims
    Given organisations A and B submit step 1 at the same instant
    Then exactly one succeeds and the other receives 409 QUOTE_ALREADY_CLAIMED

  Scenario: Unauthenticated claim attempt
    When an anonymous visitor calls the claim route
    Then the response is 401 AUTH_REQUIRED

  Scenario: Cross-tenant read after claim
    Then organisation B reading the quote receives 404 NOT_FOUND

  Scenario: Audit
    Then an audit entry UPDATE on entity quote records the owner change with actor and outcome in the same transaction
```

### US-167 — Expired quote and one-action re-quote
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-166, US-160, EPIC-09
- **Linked REQs:** REQ-QUOTE-017
- **As a** registered individual **I want** a one-action re-quote with the price change shown **so that** an expired price never surprises me at checkout.
- **Notes:** Booking from an expired quote returns 409 `QUOTE_EXPIRED` (EC-B05). Re-quote reuses inputs, runs a fresh rate shop (cache permitting). If the service no longer exists, alternatives are shown.

#### Acceptance criteria
```gherkin
Feature: Expired quote and re-quote
  Scenario: Booking from an expired quote is refused
    Given a claimed quote 25 hours old
    When the user continues to booking
    Then the response is 409 QUOTE_EXPIRED and no authorisation is created

  Scenario: One-action re-quote with price difference
    Given the expired option was UPS Standard at USD 23.00
    When the user chooses re-quote
    Then a new quote is created with the same inputs and the old quote is unchanged
    And the page shows the old and new price and the difference of USD 1.50 before the user continues

  Scenario: Service no longer returned
    Given the same service is absent in the new results
    Then alternatives are listed with a notice and nothing is auto-selected

  Scenario: Re-quote with carrier timeout
    Given MOCK with "latency=6000"
    Then partial results and the partial notice are shown

  Scenario: Re-quote rate-limited
    Given the IP limit of 20 per minute is exceeded
    Then a localised message with a retry time is shown (429 RATE_LIMITED)

  Scenario: Cross-tenant re-quote
    Given another organisation's quote id
    Then the response is 404 NOT_FOUND

  Scenario: Role without quote:create
    Given a role lacking quote:create
    Then the response is 403 AUTHZ_DENIED
    # all seeded roles hold quote:create; scenario applies to custom roles

  Scenario: Audit
    Then the re-quote writes CREATE on entity quote for the new quote and the refusal writes a denied or failed outcome entry

  Scenario Outline: UI standard for the re-quote screen
    Given locale <locale> and viewport <width>
    Then the expired notice, price-difference summary and action are localised, keyboard operable and axe clean
    Examples:
      | locale | width |
      | en     | 360   |
      | es     | 1280  |
      | fr     | 360   |
```

### US-168 — Rate-relevant change creates a new quote
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-154, EPIC-09
- **Linked REQs:** REQ-QUOTE-018
- **As a** registered individual **I want** a changed weight or destination to produce a new quote without altering the old one **so that** prices always match the inputs.
- **Notes:** Rate-relevant: country, location, content type, residential flag, package weight or dimension, ship date. Non-rate inputs (references, descriptions) never re-quote. Draft returns QUOTED to DRAFT (DR-B01) and the selected option is invalidated.

#### Acceptance criteria
```gherkin
Feature: New quote on rate-relevant change
  Scenario: Weight change
    Given a draft with quote Q1 and a selected option
    When the user changes package weight from 2 kg to 3 kg
    Then a new quote Q2 is created, Q1 is unchanged and the draft returns to DRAFT with no selected option

  Scenario: Each rate-relevant field
    Then changing country, postcode, content type, residential flag, a dimension or ship date each creates a new quote

  Scenario: Non-rate change
    When the user edits a reference or description
    Then no new quote is created and the selection stays

  Scenario: Same value re-saved
    When the user saves the same weight
    Then no new quote is created

  Scenario: Invalid new input
    When the user enters weight 1000.1 kg
    Then 400 VALIDATION_ERROR is returned and the existing quote and selection are unchanged

  Scenario: Cross-tenant draft
    Then editing another organisation's draft returns 404 NOT_FOUND

  Scenario: Role without shipment:create
    Then the change returns 403 AUTHZ_DENIED

  Scenario: Audit
    Then CREATE on entity quote and UPDATE on the shipment (QUOTED to DRAFT) are written
```

### US-169 — Display currency switcher and indicative converter
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-148, EPIC-14
- **Linked REQs:** REQ-QUOTE-019, REQ-QUOTE-022
- **As a** guest shipper **I want** to see prices in my preferred currency and convert amounts **so that** I understand cost without confusing what I will be charged.
- **Notes:** Currencies USD, INR, GBP, CAD, EUR from the quote's FX snapshot. Converted amounts labelled "approximately". Only the quote's sell currency is charged; checkout shows the sell-currency amount. Persisted as user preference (EPIC-14). Converter page (Could) is public, shows snapshot timestamp and source, labelled "indicative rates", moves no money.

#### Acceptance criteria
```gherkin
Feature: Currency switcher and converter
  Scenario: Switch display currency
    Given a quote with sell currency USD and INR display selected
    Then each amount shows "approximately" INR using the quote's FX snapshot rate
    And the charged currency remains USD

  Scenario: Persistence for signed-in users
    When a signed-in user selects GBP
    Then the preference is stored and used on the next visit

  Scenario: Guest preference
    Then a guest's choice lasts for the session only

  Scenario: Stale snapshot
    Given the snapshot is 31 days old
    Then converted amounts are labelled indicative

  Scenario: Unsupported currency
    When the URL contains currency=JPY
    Then it is ignored and the sell currency is shown (API returns 400 VALIDATION_ERROR)

  Scenario: Converter
    When a visitor converts 100.00 USD to INR on the converter page
    Then the result uses the stored rate and shows the snapshot timestamp, source and "indicative rates"

  Scenario: Converter invalid amount
    When the amount is negative or "abc"
    Then a localised inline error is shown

  Scenario: Converter rate limit
    Given 120 requests per minute from one IP are exceeded
    Then 429 RATE_LIMITED is returned

  Scenario: Locale and layout
    Given en, es and fr at 360 px and 1280 px
    Then the switcher and converter are keyboard operable, announce changed amounts and are axe clean
```

### US-170 — Public prohibited-items lookup and volumetric calculator
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** EPIC-10, EPIC-17, US-139
- **Linked REQs:** REQ-QUOTE-020, REQ-QUOTE-021
- **As a** guest shipper **I want** to check what I may send to a country and calculate volumetric weight **so that** I avoid prohibited items and billing surprises.
- **Notes:** Pre-rendered public pages (permission `public`). Prohibited lookup: search by keyword in the page locale, shows severity (prohibited, restricted), guidance text, source and pack review status; unreviewed data shows a visible "sample data" notice; same data as booking-time check (REQ-CUST-009). Anonymous views are not audited beyond the access log. Calculator (Could): dimensions, unit system and divisor selection; client-side calculation using the shared helper.

#### Acceptance criteria
```gherkin
Feature: Prohibited lookup and volumetric calculator
  Scenario: Keyword lookup
    Given destination IN and keyword "battery" in locale en
    Then matching entries show severity, guidance text, source and review status

  Scenario: Unreviewed data notice
    Given the list is seeded unreviewed
    Then a "sample data" notice is displayed

  Scenario: Localised search
    Given locale fr and keyword equivalent in French
    Then matches are found; accents and case are ignored

  Scenario: No match
    Then the empty state says nothing found and warns that absence is not clearance

  Scenario: Same data as booking check
    Then the entries returned equal the entries used by the booking-time check for the same country

  Scenario: Pre-rendered shell and public permission
    Then the page shell is static HTML and requires no sign-in
    And the lookup API enforces 120 requests per minute per IP, then 429 RATE_LIMITED

  Scenario: Invalid input
    Given a keyword of 1 character or a country not supported
    Then a localised validation message is shown (API 400 VALIDATION_ERROR / 422 COUNTRY_NOT_SUPPORTED)

  Scenario: Calculator
    Given 50 x 40 x 30 cm and divisor 5000
    Then volumetric weight 12.0 kg is shown, equal to the pricing helper
    And with inches 20 x 16 x 12 and divisor 139 it shows 27.6 lb

  Scenario: Calculator invalid input
    Given a zero dimension
    Then an inline error is shown and no result displayed

  Scenario: Offline and layout
    Given en, es and fr at 360 px and 1280 px
    Then the loading, empty, error and offline states render, controls are keyboard operable and axe reports zero violations
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-QUOTE-001 | US-154 |
| REQ-QUOTE-002 | US-155 |
| REQ-QUOTE-003 | US-156 |
| REQ-QUOTE-004 | US-156 |
| REQ-QUOTE-005 | US-157 |
| REQ-QUOTE-006 | US-157 |
| REQ-QUOTE-007 | US-159 |
| REQ-QUOTE-008 | US-160 |
| REQ-QUOTE-009 | US-161 |
| REQ-QUOTE-010 | US-162 |
| REQ-QUOTE-011 | US-161 |
| REQ-QUOTE-012 | US-159 |
| REQ-QUOTE-013 | US-163 |
| REQ-QUOTE-014 | US-164 |
| REQ-QUOTE-015 | US-165 |
| REQ-QUOTE-016 | US-166 |
| REQ-QUOTE-017 | US-167 |
| REQ-QUOTE-018 | US-168 |
| REQ-QUOTE-019 | US-169 |
| REQ-QUOTE-020 | US-170 |
| REQ-QUOTE-021 | US-170 |
| REQ-QUOTE-022 | US-169 |
| REQ-QUOTE-023 | US-158 |

Every Must REQ (001-009, 012, 016-018, 023) is linked by a Must story: US-154, US-155, US-156, US-157, US-158, US-159, US-160, US-161, US-166, US-167, US-168.
