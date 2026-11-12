# EPIC-07 — Pricing engine v1

- **Goal:** Every quote and booked shipment carries a deterministic, itemised, explainable price built from carrier cost, margin, discounts, fuel, surcharges, cover, tax and FX, and a booked price can never change afterwards.
- **Milestone(s):** M0+M1
- **REQ areas covered:** REQ-PRICE (REQ-PRICE-001 to REQ-PRICE-021)
- **Exit-demo contribution:** PRD 6.1 "Guest gets a mock quote" (itemised USD price with default 15% margin); PRD 6.2 outline (cheapest ordering by gross price, itemised breakdown with tax and FX lines, price snapshot on the booked shipment).
- **Depends on epics:** EPIC-01 (PLAT: monorepo, lint rules, CI coverage gates), EPIC-04 (AUDIT: denied UPDATE entries, shipment CREATE entry), EPIC-06 (carrier cost input), EPIC-08 (quote persists output), EPIC-09 (BOOK: snapshot on booked shipment), EPIC-17 (DATA/COMP: FX seed, tax compliance packs)

Conventions. Pricing is a pure library in `packages/pricing`; there is no pricing endpoint in M1, so library stories carry `Permission path: not applicable — pure library` plus a second negative scenario. Evaluation order follows DR-B07; rounding follows DR-B11 (half away from zero, at line level, totals never re-rounded). Amounts are written as integer minor units (USD 1000 = 10.00 USD).

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-138 | Pure pricing engine with integer money and rounding | M0 | Must | M | EPIC-01 | REQ-PRICE-001, REQ-PRICE-002 |
| US-139 | Billable weight calculation | M0 | Must | S | US-138 | REQ-PRICE-004 |
| US-140 | Default margin pricing as itemised lines | M0 | Must | S | US-138, EPIC-06 | REQ-PRICE-003 |
| US-141 | Margin rule selection and precedence | M1 | Must | S | US-140 | REQ-PRICE-005 |
| US-142 | Fuel surcharge and carrier surcharge pass-through | M1 | Must | M | US-140 | REQ-PRICE-006, REQ-PRICE-007 |
| US-143 | Included liability cover line | M1 | Must | S | US-140, EPIC-06 | REQ-PRICE-008 |
| US-144 | Optional protection cover and price floor | M1 | Should | M | US-142, US-143 | REQ-PRICE-009, REQ-PRICE-018 |
| US-145 | Customer discounts and coupons | M1 | Should | M | US-146 | REQ-PRICE-010, REQ-PRICE-011 |
| US-146 | Discount stacking rule | M1 | Must | S | US-141 | REQ-PRICE-013 |
| US-147 | Tax per origin-country compliance pack | M1 | Must | M | US-142, EPIC-17 | REQ-PRICE-014 |
| US-148 | FX conversion with snapshot | M1 | Must | S | US-138, EPIC-17 | REQ-PRICE-015 |
| US-149 | Immutable charge lines and explanation | M1 | Must | M | US-142, US-147, US-148 | REQ-PRICE-016 |
| US-150 | Immutable price snapshot on booked shipment | M1 | Must | M | US-149, EPIC-09, EPIC-04 | REQ-PRICE-017 |
| US-151 | Property-based tests and coverage gate | M1 | Must | M | US-149 | REQ-PRICE-019 |
| US-152 | Versioned seed-based pricing configuration | M1 | Must | M | US-141, US-142 | REQ-PRICE-020 |
| US-153 | Volume-tier discount and M2 seam variants | M1 | Could | S | US-146, US-152 | REQ-PRICE-012, REQ-PRICE-021 |

## Stories

### US-138 — Pure pricing engine with integer money and rounding
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-PRICE-001, REQ-PRICE-002
- **As a** developer **I want** a pure pricing function over integer minor-unit money **so that** the same inputs always give byte-identical prices and no rounding drift is possible.
- **Notes:** Inputs: carrier cost quotes, shipment facts, pricing configuration, FX snapshot, tax rules, pricing date. No I/O, no `Date.now`, no random. Rates are decimal strings or integer ratios.

#### Acceptance criteria
Permission path: not applicable — pure library with no principal; a second negative scenario is included.
```gherkin
Feature: Pure pricing engine and integer money
  Scenario: Identical inputs give byte-identical output
    Given a fixed input set including pricing date 2026-11-12
    When the engine runs twice, in different processes and at different wall-clock times
    Then the two serialised outputs are byte-identical

  Scenario: Lint forbids impure imports
    Given a source file in packages/pricing importing "node:fs", "axios", "crypto.randomUUID" or using Date.now()
    When lint runs
    Then lint fails naming the rule

  Scenario: Percentage rounding half away from zero
    Given a base amount 1050 USD minor units and a 15% rule
    Then the margin line is 158 (157.5 rounds away from zero)
    And a negative adjustment of -157.5 rounds to -158

  Scenario: No floating point on money
    When the engine is run under a test that replaces Number arithmetic results for non-integers with failures
    Then every monetary value in the output is an integer with an ISO 4217 code

  Scenario: Mixed currencies without FX step
    Given a USD amount added to an INR amount
    Then the engine throws CURRENCY_MISMATCH

  Scenario: Currency exponents
    Given amounts in JPY (exponent 0) and USD (exponent 2)
    Then minor units are produced with each currency's exponent
```

### US-139 — Billable weight calculation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-138
- **Linked REQs:** REQ-PRICE-004
- **As a** guest shipper **I want** the billable weight computed the way carriers do **so that** the price matches what the carrier will charge.
- **Notes:** Volumetric = L x W x H / divisor (5000 cm3 per kg metric, 139 in3 per lb imperial, from service reference data). Billable per package = greater of actual and volumetric rounded up to the increment (default 0.5 kg or 1 lb). Shipment billable = sum of packages. Internal integer grams and millimetres (DR-B05, DR-B06). Shared helper used by the quote widget (US-157).

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Billable weight
  Scenario: Volumetric weight exceeds actual
    Given a package 50 x 40 x 30 cm, actual 4 kg, divisor 5000 and increment 0.5 kg
    Then volumetric weight is 12.0 kg and billable weight is 12.0 kg

  Scenario: Actual exceeds volumetric and rounds up to increment
    Given a package 30 x 20 x 10 cm, actual 2.1 kg, divisor 5000, increment 0.5 kg
    Then volumetric is 1.2 kg and billable weight is 2.5 kg

  Scenario: Sum over packages
    Given two packages with billable 2.5 kg and 3.0 kg
    Then shipment billable weight is 5.5 kg

  Scenario: Imperial uses divisor 139 and 1 lb increment
    Given a package 20 x 16 x 12 in, actual 5 lb, divisor 139
    Then volumetric is 27.6 lb and billable weight is 28 lb

  Scenario: Metric and imperial parity
    Given the same physical package entered as 2000 g, 300 x 200 x 100 mm and as 4.409 lb, 11.811 x 7.874 x 3.937 in
    Then both normalise to identical grams and millimetres and produce identical billable weight

  Scenario: Invalid dimension
    Given a package with a zero or negative dimension
    Then the engine rejects it with a validation error naming the field
```

### US-140 — Default margin pricing as itemised lines
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-138, EPIC-06
- **Linked REQs:** REQ-PRICE-003
- **As a** guest shipper **I want** a Mock quote priced with the default margin and itemised **so that** I see a real total with its parts in M0.
- **Notes:** Default margin rule: 15% over carrier cost (ASSUMED seed, GAP-B-05), priority -1000, matches everything.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Default margin pricing
  Scenario: Mock cost priced with 15% margin
    Given carrier cost 2000 USD minor units, no configured rule other than the default
    When the engine runs
    Then the output has a CARRIER base line of 2000 and a MARGIN line of 300
    And net total is 2300 USD

  Scenario: Output is itemised
    Then every line has code, label key, amount, currency, tax amount, tax code and source

  Scenario: Missing default rule fails
    Given a pricing configuration with no default margin rule
    Then pricing fails with PRICING_CONFIG_INVALID

  Scenario: Zero carrier cost
    Given carrier cost 0
    Then the margin line is 0 and the total is 0, not negative

  Scenario: Specific rule overrides the default
    Given a rule for carrier MOCK with 10%
    Then the margin line is 200, not 300
```

### US-141 — Margin rule selection and precedence
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-140
- **Linked REQs:** REQ-PRICE-005
- **As an** operator **I want** exactly one margin rule chosen by explicit precedence **so that** the price is predictable and explainable.
- **Notes:** Dimensions: carrier, service, carrier account, content type, weight band, lane, customer segment, date range; null matches any. Order DR-B08: higher numeric priority, then specificity (service, carrier account, carrier, lane both countries, lane destination only, lane origin only, customer segment, content type, weight band, date range), then later effective-from, then lowest rule key.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Margin rule precedence
  Scenario: Priority beats specificity
    Given rule A priority 10 matching all and rule B priority 0 matching carrier DHL_EXPRESS
    Then rule A wins

  Scenario: Specificity ordering at equal priority
    Given rules R1 (service-specific), R2 (carrier-specific), R3 (lane-specific) all matching at priority 0
    Then R1 wins; with R1 removed R2 wins over R3

  Scenario: Later effective-from breaks specificity ties
    Given two equally specific rules effective 2026-01-01 and 2026-06-01
    Then the 2026-06-01 rule wins

  Scenario: Rule key breaks the final tie
    Given two otherwise identical rules with keys "m-02" and "m-01"
    Then "m-01" wins

  Scenario: Non-matching rule is rejected and counted
    Given a rule for content type DOCUMENT and a PARCEL request
    Then the explanation records the winning rule and the count of rejected candidates

  Scenario: Rule order independence
    Given the same rules supplied in reversed order
    Then the winner and output are identical

  Scenario: Expired date range
    Given a rule whose date range ended before the pricing date
    Then it is not a candidate
```

### US-142 — Fuel surcharge and carrier surcharge pass-through
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-140
- **Linked REQs:** REQ-PRICE-006, REQ-PRICE-007
- **As a** guest shipper **I want** fuel and carrier surcharges shown as separate lines without double counting **so that** I understand exactly what I pay.
- **Notes:** Fuel is a configured percentage of discounted base freight by date range and carrier. Omitted when the carrier already returns a fuel line (EC-B20). Pass-through surcharges at converted cost with no margin by default, source `CARRIER`, canonical code; margin on surcharges is a per-rule flag defaulting to false.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Fuel and pass-through surcharges
  Scenario: Fuel on discounted base freight
    Given a configured fuel row of 10% for DHL_EXPRESS covering the pricing date and discounted base freight 2000
    Then a FUEL line of 200 with source FUEL is added

  Scenario: Carrier already includes fuel
    Given the carrier cost response contains a FUEL line and a 10% fuel row also matches
    Then only the carrier's fuel line is passed through
    And the explanation contains FUEL_INCLUDED_BY_CARRIER

  Scenario: No matching fuel row
    Then no fuel line is added and the explanation contains FUEL_NONE

  Scenario: Pass-through at cost, no margin
    Given a carrier surcharge REMOTE_AREA of 500
    Then a separate line REMOTE_AREA of 500 with source CARRIER is present and no margin is applied to it

  Scenario: Margin on surcharges flag
    Given the winning rule sets margin_on_surcharges=true with 15%
    Then the REMOTE_AREA line is 575 and the margin amount is itemised

  Scenario: Unmapped surcharge
    Given a carrier surcharge with code CARRIER_OTHER
    Then it is passed through with that code and its label key

  Scenario: Overlapping fuel ranges are invalid
    Given two fuel rows for DHL_EXPRESS with overlapping date ranges
    Then configuration validation fails
```

### US-143 — Included liability cover line
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-140, EPIC-06
- **Linked REQs:** REQ-PRICE-008
- **As a** guest shipper **I want** to see the cover each service already includes **so that** I can compare protection, not only price.
- **Notes:** Zero-priced informational line. Percentage terms show the percentage (declared value unknown at quote time); per-kg terms compute from billable weight; fixed terms show the amount in the sell currency via the FX snapshot.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Included liability cover
  Scenario: Per-kilogram term
    Given a liability term of USD 20.00 per kg and billable weight 2.5 kg
    Then a COVER line with amount 0 and information "maximum covered USD 50.00" is present

  Scenario: Percentage term
    Given a liability term of 100% of declared value
    Then the line states "100% of declared value" and amount 0

  Scenario: Fixed term in another currency
    Given a fixed term of EUR 100.00 and an FX rate EUR to USD of 1.100000
    Then the line states a maximum of USD 110.00

  Scenario: Cover line does not alter totals
    Then net and gross totals are unchanged by the included cover line

  Scenario: Missing liability term
    Given a service with no liability term
    Then no cover line is emitted and no error is raised
```

### US-144 — Optional protection cover and price floor
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-142, US-143
- **Linked REQs:** REQ-PRICE-009, REQ-PRICE-018
- **As a** registered individual **I want** to add extra protection and be sure the price never falls below the carrier cost **so that** my parcel is covered and the platform is not undercut.
- **Notes:** Cover = greater of minimum charge and percentage of insured value (seed 2%, minimum 5.00 sell currency, maximum insurable 5000.00 USD equivalent, ASSUMED). Re-run on stored carrier cost; no new carrier call. Legal characterisation open (GAP-B-14). Price floor DR-B10; seed rules never set `allow_below_cost`.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Protection cover and price floor
  Scenario: Percentage above minimum
    Given insured value 1000.00 USD, 2% and minimum 5.00
    Then a COVER line of 2000 minor units is added

  Scenario: Minimum charge applies
    Given insured value 100.00 USD
    Then the COVER line is 500 (minimum), not 200

  Scenario: Maximum insurable exceeded
    Given insured value 5000.01 USD equivalent
    Then the engine returns COVER_VALUE_EXCEEDS_MAXIMUM and no price

  Scenario: Re-pricing uses stored cost
    When cover changes after the quote
    Then pricing is recomputed from stored carrier cost without any carrier call

  Scenario: Discount capped by price floor
    Given converted cost 2000, base margin giving 2300, and a coupon of 30% of base
    Then the discounted base freight is not below 2000
    And the explanation contains PRICE_FLOOR_APPLIED

  Scenario: Explicit allow_below_cost
    Given the matching rule sets allow_below_cost=true
    Then the discount is not capped and PRICE_FLOOR_APPLIED is absent

  Scenario: Seed rules never allow below cost
    When seed validation runs on the shipped seed
    Then no rule has allow_below_cost=true
```

### US-145 — Customer discounts and coupons
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-146
- **Linked REQs:** REQ-PRICE-010, REQ-PRICE-011
- **As a** business customer **I want** my organisation's discount and a coupon code applied **so that** I pay my agreed price.
- **Notes:** Discount by email domain (exact match on the part after the last `@`, case-insensitive) or organisation, active on pricing date (start inclusive, end exclusive), optional carrier and content-type restriction. Coupons case-insensitive after trimming. `COUPON_INVALID` for unknown and ineligible codes alike. Redemption counted at PAID, not on entry (EC-B24). Coupon application on the review step belongs to EPIC-09.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Discounts and coupons
  Scenario: Email-domain discount
    Given an active 5% discount for domain "acme.example" and account "a@ACME.example"
    Then a DISCOUNT line of -5% of base freight is present

  Scenario: Date bounds
    Given a discount ending 2026-12-01
    Then it applies on 2026-11-30 and not on 2026-12-01

  Scenario: Carrier restriction
    Given a discount restricted to FEDEX
    Then it does not apply to a DHL_EXPRESS option

  Scenario: Valid coupon
    Given coupon " Save10 " active, with remaining redemptions
    Then it applies as a COUPON line

  Scenario: Unknown and ineligible coupons are indistinguishable
    Then both "NOPE" and a coupon restricted to another carrier return COUPON_INVALID

  Scenario: Expired and exhausted coupons
    Then an expired coupon returns COUPON_EXPIRED and one with 0 remaining redemptions returns COUPON_EXHAUSTED

  Scenario: Coupon expires between review and checkout
    Given a coupon that expired after being applied
    When pricing runs at checkout
    Then the coupon is rejected with COUPON_EXPIRED and the total is recomputed without it
```

### US-146 — Discount stacking rule
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-141
- **Linked REQs:** REQ-PRICE-013
- **As a** business customer **I want** the combination of discounts that is best for me chosen automatically **so that** I always get the larger total discount without gaming.
- **Notes:** DR-B09: stackable discounts sum additively on base freight (not compounded); alternative is the single largest non-stackable; customer gets the larger total; total discount never exceeds base freight. Explanation lists both candidate totals and the chosen set.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Discount stacking
  Scenario: Stackable set wins
    Given base freight 10000, stackable 5% and 4%, and non-stackable 8%
    Then the stackable set (900) is applied and the 8% (800) is not

  Scenario: Non-stackable wins
    Given stackable 3% and 2% and non-stackable 10%
    Then the 10% discount (1000) is applied and the explanation lists candidates 500 and 1000

  Scenario: Additive, not compounded
    Given stackable 10% and 10% on base freight 10000
    Then the total discount is 2000, not 1900

  Scenario: Discount cannot exceed base freight
    Given stackable discounts totalling 120%
    Then the total discount equals the base freight and the total is not negative

  Scenario: Fixed amount discounts
    Given a fixed 500 stackable and a 3% stackable on base freight 10000
    Then the stackable total is 800

  Scenario: No eligible discount
    Then no DISCOUNT line is emitted
```

### US-147 — Tax per origin-country compliance pack
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-142, EPIC-17
- **Linked REQs:** REQ-PRICE-014
- **As a** guest shipper **I want** tax shown as separate amounts per line and in total **so that** the final price is clear and compliant with the origin country.
- **Notes:** Jurisdiction is the origin country (DR-B12). Pack supplies per-line-type taxability, rate, tax code, label and display mode (inclusive or exclusive). Zero-rated lines show 0 with their tax code. Unreviewed pack values carry an `unreviewed` flag. Inclusive tax part = gross - gross / (1 + rate) rounded half away from zero so net plus tax equals gross exactly (DR-B11).

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Tax per origin pack
  Scenario: Tax-exclusive display
    Given origin GB pack with 20% rate, exclusive display, taxable base line 1000
    Then the line has tax 200 with its tax code and gross is net + tax

  Scenario: Tax-inclusive display
    Given a pack with 20% rate and inclusive display, gross line 1200
    Then tax is 200 and net is 1000 and net + tax equals gross exactly

  Scenario: Zero-rated line
    Given a line type marked zero-rated in the origin pack
    Then tax amount is 0 and the tax code is shown

  Scenario: Origin decides, not destination
    Given origin US and destination IN
    Then the US pack is used

  Scenario: Unreviewed pack flag
    Given the origin pack is seeded unreviewed
    Then the output carries unreviewed=true

  Scenario: Missing pack for origin
    Given an origin country with no compliance pack
    Then pricing fails with COUNTRY_NOT_SUPPORTED and no price is returned

  Scenario: Rounding per line
    Given three lines of 333 at 7.5%
    Then tax is computed per line and rounded half away from zero, and the total tax is the sum of the rounded line taxes
```

### US-148 — FX conversion with snapshot
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-138, EPIC-17
- **Linked REQs:** REQ-PRICE-015
- **As a** guest shipper **I want** carrier cost converted into the currency of the origin country **so that** I pay in my own currency with a recorded rate.
- **Notes:** Sell currency by origin: US USD, IN INR, UK GBP, CA CAD, EU template EUR (D-019). Rate has 6 decimals; conversion multiplies minor units by the rate and rounds once. Rates from seeded `fx_rates` via a provider interface. Staleness DR-B13: older than 30 days adds `FX_STALE` and an `indicative` display flag but never blocks pricing (EC-B13). Cost currency, sell currency, rate and snapshot timestamp recorded on the quote.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: FX conversion
  Scenario: Carrier cost in INR sold in USD
    Given carrier cost INR 166000 (minor units 16600000), rate INR to USD 0.012000
    Then converted cost is USD 1992.00 (199200 minor units), rounded once
    And the quote records cost currency INR, sell currency USD, rate 0.012000 and the snapshot timestamp

  Scenario: Same currency needs no conversion
    Given carrier cost USD and origin US
    Then rate 1.000000 is recorded and no FX line is added

  Scenario: Missing pair
    Given no rate for the pair
    Then pricing fails with FX_RATE_UNAVAILABLE

  Scenario: Stale snapshot warns but does not block
    Given the snapshot timestamp is 31 days before the pricing date
    Then pricing succeeds, the explanation contains FX_STALE and display conversions carry indicative=true

  Scenario: Snapshot at 30 days is not stale
    Given a snapshot exactly 30 days old
    Then no FX_STALE warning is present

  Scenario: Sell currency by origin
    Then origins US, IN, UK, CA and a EU template country map to USD, INR, GBP, CAD and EUR
```

### US-149 — Immutable charge lines and explanation
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-142, US-147, US-148
- **Linked REQs:** REQ-PRICE-016
- **As a** guest shipper **I want** an itemised price with a machine-readable explanation **so that** the breakdown shown to me and to support staff is complete and consistent.
- **Notes:** Line sources: `CARRIER`, `MARGIN`, `FUEL`, `COVER`, `DISCOUNT`, `COUPON`, `TAX`. Labels are i18n keys, not translated strings. Explanation lists every rule that fired or was rejected with type, key, configuration version, inputs used and effect in minor units.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Charge lines and explanation
  Scenario: Ordered immutable lines with totals
    Given a Mock quote with margin, fuel, a surcharge and 20% tax
    Then the output is an ordered list of lines with code, label key, amount, currency, tax amount, tax code and source
    And attempting to mutate the returned object fails (frozen)

  Scenario: Sums reconcile
    Then the sum of line amounts equals net total and net plus tax equals gross for 1000 generated cases

  Scenario: Explanation of rules
    Then the explanation lists the margin rule selected, the rejected candidate count, the fuel row used, the discount set chosen and each with config version and effect in minor units

  Scenario: Labels are keys
    Then every label is an i18n key present in en, es and fr catalogues

  Scenario: No negative total
    Given discounts exceeding the base
    Then total is not negative and the capped effect is explained

  Scenario: Unknown line source rejected
    Given an input producing a line with an unlisted source
    Then the engine throws PRICING_CONFIG_INVALID
```

### US-150 — Immutable price snapshot on booked shipment
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-149, EPIC-09, EPIC-04
- **Linked REQs:** REQ-PRICE-017
- **As a** finance user **I want** the price of a booked shipment frozen and tamper-evident **so that** later rule or FX changes never alter what was charged.
- **Notes:** Stores pricing output, engine version, configuration version and FX snapshot with a SHA-256 hash. The snapshot is part of the shipment `CREATE` audit entry. Booked price unchanged by later rules (EC-B14).

#### Acceptance criteria
```gherkin
Feature: Booked price snapshot
  Scenario: Snapshot stored with hash and versions
    Given a shipment is booked from a priced option
    Then the shipment holds the pricing output, engine version, configuration version, FX snapshot and a SHA-256 hash of the stored bytes
    And the shipment CREATE audit entry includes the snapshot reference

  Scenario: Later rule change does not alter a booked price
    Given the margin seed changes to version 2 after booking
    Then the booked snapshot, hash and configuration version are unchanged

  Scenario: Update attempt is denied and audited
    When any caller attempts to UPDATE the snapshot
    Then the operation fails with an error
    And an audit entry with outcome DENIED and action UPDATE exists

  Scenario: Delete attempt is denied and audited
    When any caller attempts to DELETE the snapshot
    Then it fails and an audit entry with outcome DENIED and action DELETE exists

  Scenario: Hash verifies integrity
    When the stored bytes are re-hashed
    Then the SHA-256 equals the stored hash

  Scenario: Role without shipment:read
    Given a user whose role lacks shipment:read
    When they request the shipment pricing snapshot
    Then the response is 403 with code AUTHZ_DENIED

  Scenario: Cross-tenant
    Given organisation B requests organisation A's shipment snapshot
    Then the response is 404 with code NOT_FOUND
```

### US-151 — Property-based tests and coverage gate
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-149
- **Linked REQs:** REQ-PRICE-019
- **As a** developer **I want** property-based tests and a coverage gate on the pricing package **so that** regressions in money logic are caught automatically.
- **Notes:** At least 1000 generated cases per property in CI. Coverage 95% line and branch on `packages/pricing`.

#### Acceptance criteria
Permission path: not applicable — test tooling with no principal; second negative scenario included.
```gherkin
Feature: Pricing property tests
  Scenario: Required properties run
    When the CI pricing suite runs
    Then properties exist and pass for determinism, line sum equals net, net plus tax equals gross, no negative total, billable at least actual weight, billable monotonic in dimensions, metric and imperial parity, rule-order independence and idempotent re-pricing
    And each property ran at least 1000 generated cases

  Scenario: Coverage gate
    When coverage is measured on packages/pricing
    Then line coverage is at least 95% and branch coverage at least 95%

  Scenario: Coverage below gate fails the build
    Given a change that leaves 94% branch coverage
    Then the CI job fails

  Scenario: Failing property gives a reproducible seed
    Given a deliberately broken rounding function
    Then the property run fails and prints the seed and shrunk counterexample

  Scenario: Case count below minimum
    Given configuration of 100 cases per property
    Then the CI check fails
```

### US-152 — Versioned seed-based pricing configuration
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-141, US-142
- **Linked REQs:** REQ-PRICE-020
- **As an** operator **I want** margin rules, fuel rows, cover terms, discounts, coupons, tiers and FX rates loaded from versioned seed files **so that** pricing is configurable without an admin UI in M1 (D-010).
- **Notes:** New version is a new seed file, never an in-place edit of a published one. The active configuration version is recorded on every quote and booked shipment.

#### Acceptance criteria
Permission path: not applicable — seed loader with no principal; second negative scenario included.
```gherkin
Feature: Pricing configuration seed
  Scenario: Load and record version
    Given seed file "pricing-v1" with configuration version "v1"
    When the loader runs
    Then the rules are loaded and a new quote records configuration version "v1"

  Scenario: Loading is idempotent
    When the loader runs twice
    Then row counts are unchanged

  Scenario: Validation rejects bad seeds
    Given seeds with overlapping fuel ranges, no default rule, a -5% margin or currency "XXQ"
    Then each fails validation with a message naming the entry

  Scenario: Published seed cannot be edited in place
    Given "pricing-v1" is already loaded and its content hash differs from the file
    Then the loader fails with a message requiring a new version file

  Scenario: New version takes effect for new quotes only
    Given "pricing-v2" is loaded
    Then new quotes record "v2" and existing quotes and booked shipments still show "v1"

  Scenario: Seed values match ASSUMED defaults
    Then the shipped seed has default margin 15%, cover 2% with minimum 5.00 and maximum 5000.00 USD
```

### US-153 — Volume-tier discount and M2 seam variants
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** US-146, US-152
- **Linked REQs:** REQ-PRICE-012, REQ-PRICE-021
- **As an** operator **I want** a volume discount and typed seams for rate cards and operator surcharges **so that** growth discounts exist now and M2 adds variants without changing the engine signature.
- **Notes:** Tiers (ASSUMED): 10 shipments in the previous 30 days 3%, 50 shipments 5%. Count BOOKED or later, excludes cancelled, voided and refunded. Window GAP-B-31. Seam variants `RATE_CARD`, `REMOTE_AREA`, `PEAK`, `RESIDENTIAL`, `OVERSIZE` rejected with `NOT_SUPPORTED_IN_M1`.

#### Acceptance criteria
Permission path: not applicable — pure library; second negative scenario included.
```gherkin
Feature: Volume tier and seam variants
  Scenario: Tier applied
    Given an organisation with 12 booked shipments in the previous 30 days
    Then a 3% VOLUME discount is applied; with 50 shipments 5%

  Scenario: Cancelled shipments excluded
    Given 10 booked of which 2 are cancelled
    Then no tier applies

  Scenario: Below threshold
    Given 9 shipments
    Then no volume discount is applied

  Scenario: Seam variant rejected
    Given a cost source of type RATE_CARD or a surcharge of type PEAK
    Then the engine returns NOT_SUPPORTED_IN_M1

  Scenario: Engine signature unchanged
    Then the type definitions include the discriminated variants RATE_CARD, REMOTE_AREA, PEAK, RESIDENTIAL and OVERSIZE
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-PRICE-001 | US-138 |
| REQ-PRICE-002 | US-138 |
| REQ-PRICE-003 | US-140 |
| REQ-PRICE-004 | US-139 |
| REQ-PRICE-005 | US-141 |
| REQ-PRICE-006 | US-142 |
| REQ-PRICE-007 | US-142 |
| REQ-PRICE-008 | US-143 |
| REQ-PRICE-009 | US-144 |
| REQ-PRICE-010 | US-145 |
| REQ-PRICE-011 | US-145 |
| REQ-PRICE-012 | US-153 |
| REQ-PRICE-013 | US-146 |
| REQ-PRICE-014 | US-147 |
| REQ-PRICE-015 | US-148 |
| REQ-PRICE-016 | US-149 |
| REQ-PRICE-017 | US-150 |
| REQ-PRICE-018 | US-144 |
| REQ-PRICE-019 | US-151 |
| REQ-PRICE-020 | US-152 |
| REQ-PRICE-021 | US-153 |

Every Must REQ (001-008, 013-017, 019, 020) is linked by a Must story: US-138, US-139, US-140, US-141, US-142, US-143, US-146, US-147, US-148, US-149, US-150, US-151, US-152.
