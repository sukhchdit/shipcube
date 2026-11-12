# EPIC-17 — Reference data, seed and compliance packs

- **Goal:** The platform starts with trustworthy, idempotently seeded reference data (countries, currencies, holidays, HS sample, Incoterms, prohibited items, FX, sequences, demo users) and versioned, clearly labelled compliance packs that pricing and customs logic consume as data.
- **Milestone(s):** M0+M1 (M0: seed framework, demo users, countries, regions, currencies, public reference endpoints; M1: sample datasets, prohibited items, sequences, FX, compliance packs)
- **REQ areas covered:** REQ-DATA, REQ-COMP (every REQ in these areas is linked below)
- **Exit-demo contribution:** PRD §6.1 (compose up with migrations and seed; seed users per role; countries, Mock services, sample pricing, compliance packs); PRD §6.2 (quote with tax snapshot, prohibited-items page, customs HS search, order numbers, privacy page).
- **Depends on epics:** EPIC-01 (compose and config), EPIC-03 (organisations, roles, users), EPIC-04 (CONFIG_CHANGE audit), EPIC-06/EPIC-07 (Mock carrier services and sample pricing configuration), EPIC-05 (privacy page, "unreviewed" badge rendering), EPIC-16 (ETag, rate limits)

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-049 | Idempotent reference and demo seed framework | M0 | Must | M | EPIC-01 | REQ-DATA-001, REQ-DATA-002 | DC |
| US-050 | Seed demo organisations, users and Mock configuration | M0 | Must | M | US-049, EPIC-03, EPIC-06, EPIC-07 | REQ-DATA-003 | DC |
| US-051 | Seed countries, regions and launch-country enablement | M0 | Must | M | US-049 | REQ-DATA-004, REQ-DATA-005, REQ-DATA-007 | DC |
| US-052 | Seed currencies and FX snapshots | M0 | Must | S | US-049 | REQ-DATA-006, REQ-DATA-014 | DC |
| US-053 | Public read-only reference endpoints | M0 | Must | M | US-051, US-052, EPIC-16 | REQ-DATA-016 | DC |
| US-054 | Seed sample datasets: holidays, transit days, HS list, reasons for export, Incoterms | M1 | Must | M | US-049, US-053 | REQ-DATA-008, REQ-DATA-009, REQ-DATA-010, REQ-DATA-012, REQ-DATA-013 | DC |
| US-055 | Prohibited and restricted items with public lookup | M1 | Must | M | US-049, US-057 | REQ-DATA-011 |  |
| US-056 | Order-number sequences and zone table seam | M1 | Must | M | EPIC-01 | REQ-DATA-015, REQ-DATA-017 | DC |
| US-057 | Compliance pack store, immutability and resolution | M1 | Must | M | US-049 | REQ-COMP-001, REQ-COMP-002 |  |
| US-058 | Seed compliance packs with audited loading | M1 | Must | M | US-057, EPIC-04 | REQ-COMP-003, REQ-COMP-008 |  |
| US-059 | Pack-derived data: unreviewed flag, tax rule and de-minimis | M1 | Must | M | US-057, US-058 | REQ-COMP-004, REQ-COMP-005, REQ-COMP-006 |  |
| US-060 | Privacy notice and consent rule endpoint | M1 | Should | S | US-058, EPIC-05 | REQ-COMP-007 |  |

## Stories

### US-049 — Idempotent reference and demo seed framework
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-DATA-001, REQ-DATA-002
- **As a** developer **I want** a seed that upserts by natural key and separates reference data from demo data **so that** any environment can be seeded safely and repeatedly.
- **Notes:** `reference` seed runs in all environments; `demo` seed never when `APP_ENV=production`, and it refuses default `SEED_*` passwords whenever `APP_ENV` is not `local` (REQ-DATA-002 as amended by D-043 / ADR-0006 amendment 4; `APP_ENV` is the ADR-0018 environment key). Rows carry `source` (SEED, SAMPLE) and reviewed flags. Demo passwords come from `SEED_*` variables; defaults exist only in the Compose env file; passwords are never printed. DR-A27: updates in this run happen only by seed or migration.
- **Delivery split (D-061, 2026-11-13; PR #13 code review M1):** the story stays Must and demo-critical, but three tasks complete it, and it is Implemented only when all three are merged. AT-US-049-01, -03, -04 (×3), -06, -07, -08 → **TASK-023** (framework; met at framework level in PR #13, AT-01/-08 on probe tables until TASK-026 seeds countries). AT-US-049-02 → **TASK-014** (the Compose seed one-shot runs `db:seed` then `db:seed:demo` after `migrate`, `NODE_ENV=development` + `APP_ENV=local`; reference datasets present after `docker compose up --wait`); its "demo data are present" clause closes with TASK-089 together with US-003. AT-US-049-05, -09, -10-1, -10-2 → **TASK-089** (the real `DemoUserProvisioner` replaces the TASK-023 stand-in that writes nothing: users created with seeded passwords in local/test; staff created without passwords in staging with one SET_PASSWORD link per user visible in the mail catcher; `deferred = 0`; no password or token in stdout or logs).

#### Acceptance criteria
Permission path: not applicable — start-up tooling with no principal; a second negative scenario is included.
```gherkin
Feature: Idempotent reference and demo seed framework
  Scenario: Seed twice yields identical counts
    Given an empty database
    When the seed runs twice
    Then the row counts of every seeded table are identical after the second run
    And seeded rows carry a source value such as SEED or SAMPLE

  Scenario: Compose runs the seed automatically
    When "docker compose up" completes
    Then reference and demo data are present

  Scenario: Demo seed is skipped in production
    Given APP_ENV=production
    When the seed runs
    Then only reference data is loaded and no demo users exist

  Scenario Outline: Non-local environment with a default seed password aborts
    Given APP_ENV=<env> and SEED_SUPERADMIN_PASSWORD equals its local-only default
    When the demo seed is requested
    Then it aborts with an error naming the variable (name only) and creates nothing
    Examples:
      | env        |
      | test       |
      | staging    |
      | production |

  Scenario: Local environment accepts the defaults
    Given APP_ENV=local and every SEED_* variable equals its Compose default
    When the demo seed runs
    Then the demo users are created

  Scenario: Missing SEED variable
    Given SEED_CUSTOMER_PASSWORD is unset
    Then the demo seed fails fast listing the variable name

  Scenario: Passwords never printed
    Then neither stdout nor logs contain any seed password value

  Scenario: Natural-key upsert corrects drift
    Given a seeded country row was altered manually
    When the seed runs
    Then the row is restored to the seeded values without duplication

  Scenario: Staging seed creates staff without passwords (REQ-DATA-002, D-052)
    Given APP_ENV=staging and no SEED_* password variables are set
    When the demo seed runs
    Then the staff users are created without a password
    And each staff user is sent a set-password link through the reset flow, visible in the mail catcher
    And the seed read no SEED_* password variable and neither stdout nor logs contain a password or token value

  Scenario Outline: Local and test environments keep the seeded-password flow
    Given APP_ENV=<env> and every SEED_* variable is set
    When the demo seed runs
    Then the demo users are created with the seeded passwords and no set-password link is sent
    Examples:
      | env   |
      | local |
      | test  |
```

### US-050 — Seed demo organisations, users and Mock configuration
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-049, EPIC-03, EPIC-06, EPIC-07
- **Linked REQs:** REQ-DATA-003
- **As a** demo presenter or tester **I want** a ready set of users per role and the Mock carrier and sample pricing in place **so that** every exit-demo scenario can run immediately after `docker compose up`.
- **Notes:** Operator organisation with one user per operator role (8); "Acme Exports" (country US) with one user per customer role (5: Owner, Admin, Shipper, Finance, Viewer); one individual customer with a personal organisation; Mock carrier services and sample pricing configuration. Emails use the reserved `.example` domain; all seeded users have verified emails; staff must enrol TOTP at first sign-in (REQ-AUTH-018).

#### Acceptance criteria
```gherkin
Feature: Seed demo organisations, users and Mock configuration
  Scenario: Users and organisations exist
    When the demo seed has run
    Then the OPERATOR organisation has 8 users, one per operator role
    And "Acme Exports" (US) has 5 users, one per customer role
    And one individual customer has a personal INDIVIDUAL organisation

  Scenario: Seeded accounts are usable
    Then every seeded user has a verified email_verified_at and status ACTIVE
    And every seeded email ends with ".example"
    And every seeded staff user is required to enrol TOTP at first sign-in

  Scenario: Mock carrier and pricing are present
    Then the Mock carrier is enabled with its services and a sample pricing configuration, and DHL, FedEx and UPS are not enabled

  Scenario: Re-seeding does not duplicate or reset enrolled TOTP
    Given a staff user has enrolled TOTP
    When the seed runs again
    Then the user count is unchanged and TOTP remains active

  Scenario: Seeded customer cannot reach admin
    When the seeded Shipper signs in to the admin app
    Then the response is 401 INVALID_CREDENTIALS

  Scenario: Seeded roles hold only their matrix permissions
    When the seeded Viewer calls a mutating customer route
    Then the response is 403 AUTHZ_DENIED

  Scenario: Seed writes audit entries as system actor
    Then CREATE entries with actor type SYSTEM_JOB and job name "seed" exist for the created users
```

### US-051 — Seed countries, regions and launch-country enablement
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-049
- **Linked REQs:** REQ-DATA-004, REQ-DATA-005, REQ-DATA-007
- **As a** shipper **I want** accurate country, region and postcode rules for the countries I can ship to **so that** my addresses validate correctly.
- **Notes:** All ISO 3166-1 countries with alpha-2/3, numeric, names en/es/fr, ISO 4217 currency, unit system (US IMPERIAL: lb/in; others METRIC: kg/cm), postcode format (regex plus example) and location type (`POSTCODE_REQUIRED`, `POSTCODE_OPTIONAL`, `CITY_ONLY`). `shipping_enabled`: US, IN, GB, CA, AU, AE and EU member states (GAP-A-14). Regions: US 50 states + DC + territories, CA 10 provinces + 3 territories, IN 28 states + 8 union territories with ISO 3166-2 code; region required for US, CA, IN. Missing es/fr names fall back to English and are flagged for linguistic review.

#### Acceptance criteria
Permission path: not applicable — seed data loaded by migration/seed with no principal; the public read endpoints and their `public` permission are US-053. A second negative scenario is included.
```gherkin
Feature: Seed countries, regions and launch-country enablement
  Scenario: Countries are complete
    When the reference seed has run
    Then 249 ISO 3166-1 countries exist with alpha-2, alpha-3, numeric code and names in en, es and fr
    And US has unit system IMPERIAL and IN has METRIC

  Scenario Outline: Launch-country postcode formats
    Then the postcode regex of "<country>" accepts 5 valid examples and rejects 5 invalid examples
    Examples:
      | country |
      | US      |
      | IN      |
      | GB      |
      | CA      |

  Scenario: Shipping-enabled set
    Then shipping_enabled is true for US, IN, GB, CA, AU, AE and each EU member state and false for, e.g., KP

  Scenario: Non-enabled country cannot be selected
    When a quote request uses origin KP
    Then the response is 422 COUNTRY_NOT_SUPPORTED

  Scenario: Regions
    Then the US has 50 states plus DC and territories, CA has 10 provinces and 3 territories, IN has 28 states and 8 union territories, each with ISO 3166-2 code and names in en/es/fr
    And region_required is true for US, CA and IN and false for GB

  Scenario: Missing translation falls back and is flagged
    Given a region without a Spanish name
    Then its es name equals the English official name and it is flagged for linguistic review

  Scenario: Countries without a curated postcode format
    Then their location type is CITY_ONLY

  Scenario: Reference data is not editable at runtime
    When a customer or staff user calls PUT on a country
    Then the response is 405 METHOD_NOT_ALLOWED
```

### US-052 — Seed currencies and FX snapshots
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-049
- **Linked REQs:** REQ-DATA-006, REQ-DATA-014
- **As a** pricing engine **I want** currency exponents and immutable FX snapshots **so that** money is handled in integer minor units and conversions are reproducible.
- **Notes:** Currencies at least USD, INR, GBP, CAD, EUR, AUD, AED with minor-unit exponent. FX snapshot rows between USD, INR, GBP, CAD, EUR: base, quote, decimal-string rate, timestamp, source `SEED`; new snapshot rows, never in-place edits; consumers read the latest snapshot at or before the request time; behind a provider interface (D-019). FX snapshot content is M1.

#### Acceptance criteria
Permission path: not applicable — seed data consumed by services; a second negative scenario is included.
```gherkin
Feature: Seed currencies and FX snapshots
  Scenario: Currencies seeded
    Then USD, INR, GBP, CAD, EUR, AUD and AED exist with exponents 2, 2, 2, 2, 2, 2, 2 and a currency with exponent 0 would be handled

  Scenario: Unknown currency rejected
    When a money helper receives currency "XXY"
    Then it rejects it with a validation error

  Scenario: FX snapshot rows
    Then a rate exists for each ordered pair among USD, INR, GBP, CAD and EUR stored as a decimal with base, quote, rate, timestamp and source "SEED"

  Scenario: Latest snapshot at or before the request time
    Given snapshots at 10:00 and 12:00
    When a conversion is requested for 11:00
    Then the 10:00 snapshot is used

  Scenario: Rates are never edited in place
    When an update to an existing snapshot row is attempted by the application role
    Then it is rejected and a new row is the only way to change a rate

  Scenario: Re-seed does not create duplicates
    When the seed runs twice
    Then the snapshot row count is unchanged

  Scenario: No snapshot before the request time
    When a conversion is requested for a time earlier than every snapshot
    Then the result is an explicit "rate unavailable" error and no default rate is used
```

### US-053 — Public read-only reference endpoints
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-051, US-052, EPIC-16
- **Linked REQs:** REQ-DATA-016
- **As a** guest shipper **I want** reference lists served in my language without signing in **so that** forms populate instantly and cacheable.
- **Notes:** Datasets: countries, regions, currencies, holidays, reasons for export, Incoterms, HS search, prohibited items. Labels by `Accept-Language` (DR-A18: en, es, fr, fallback en). `ETag` and `Cache-Control: public, max-age=3600`. Descriptor `NONE` justification "public reference data". Limit 120/min/IP.

#### Acceptance criteria
Permission path: not applicable — public read-only endpoints under the `public` permission; the "without authentication → 200" and "read-only → 405" scenarios are the access-control assertions.
```gherkin
Feature: Public read-only reference endpoints
  Scenario: Localised countries without authentication
    When GET /api/v1/reference/countries is called with "Accept-Language: es" and no token
    Then the response is 200 with Spanish names, an ETag and "Cache-Control: public, max-age=3600"

  Scenario: Conditional request
    When the same request carries If-None-Match with the ETag
    Then the response is 304 with no body

  Scenario: Fallback locale
    When Accept-Language is "de"
    Then names are in English

  Scenario: Unknown dataset
    When GET /api/v1/reference/unknown is called
    Then the response is 404 NOT_FOUND problem+json

  Scenario: Read-only
    When POST /api/v1/reference/countries is called
    Then the response is 405 METHOD_NOT_ALLOWED with an Allow header

  Scenario: Rate limited per IP
    When 121 requests arrive from one IP within a minute
    Then the 121st returns 429 RATE_LIMITED with Retry-After

  Scenario: Pagination of large datasets
    When GET regions is requested with limit=500
    Then the response is 400 VALIDATION_ERROR

  Scenario: Not audited
    Then no audit entry is written (descriptor NONE, "public reference data")
```

### US-054 — Seed sample datasets: holidays, transit days, HS list, reasons for export, Incoterms
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-049, US-053
- **Linked REQs:** REQ-DATA-008, REQ-DATA-009, REQ-DATA-010, REQ-DATA-012, REQ-DATA-013
- **As a** shipper and staff member **I want** indicative holidays, transit times, HS headings, export reasons and Incoterms **so that** pickups, estimates and customs entries are guided, while sample data is clearly labelled.
- **Notes:** Holidays 2026-2027 for US, IN, GB, CA with country, optional region, local date, IANA zone, name, flag `SAMPLE`. Transit-day ranges (min/max business days) per carrier service and country pair: every Mock service on every enabled lane and indicative DHL Express/FedEx/UPS on US→IN, US→CA, US→GB, US domestic, IN→US, GB→US, CA→US; `SAMPLE`; missing entry yields "estimated delivery unavailable". HS: at least 200 six-digit headings with English descriptions, search by keyword or code prefix returns at most 20, validation of 6/8/10 digits, labelled `SAMPLE`. Reasons: SALE, GIFT, SAMPLE, REPAIR_RETURN, PERSONAL_EFFECTS, RETURNED_GOODS, TEMPORARY_EXPORT, DOCUMENTS (en/es/fr; DOCUMENTS only for document shipments). Incoterms 2020 eleven rules with en/es/fr labels, courier-usable flag for DAP and DDP, default DAP.

#### Acceptance criteria
Permission path: not applicable — seed tooling runs with no principal; negative scenarios cover invalid/duplicate data
```gherkin
Feature: Seed sample datasets
  Scenario: Holidays
    Then holidays for 2026 and 2027 exist for US, IN, GB and CA with local date, IANA zone, name and source SAMPLE
    And a regional holiday carries its region code, e.g. US-CA

  Scenario: Transit days
    Then every Mock service on every enabled lane has min and max business days with source SAMPLE
    And US→IN has indicative entries for DHL Express, FedEx and UPS
    When no entry exists for a lane
    Then the quote result shows "estimated delivery unavailable" and no invented value

  Scenario: HS search
    Then at least 200 six-digit headings exist
    When GET /api/v1/reference/hs?q=shirt is called
    Then at most 20 results are returned, each with a SAMPLE label
    And a search by code prefix "6109" returns matching headings

  Scenario Outline: Commodity code format
    When a user enters commodity code "<code>"
    Then the code is "<result>"
    Examples:
      | code         | result   |
      | 610910       | accepted |
      | 61091000     | accepted |
      | 6109100012   | accepted |
      | 61091        | rejected with 400 VALIDATION_ERROR |
      | 6109A0       | rejected with 400 VALIDATION_ERROR |

  Scenario: Reasons for export
    Then the eight codes exist with en, es and fr labels
    And DOCUMENTS is flagged as applicable only to document shipments

  Scenario: Incoterms
    Then the eleven Incoterms 2020 rules exist with en/es/fr labels
    And only DAP and DDP are flagged courier-usable and DAP is the default

  Scenario: Sample data is labelled for staff and customers
    Then every response containing holidays, transit days or HS entries includes source "SAMPLE"

  Scenario: Seed idempotent
    When the seed runs twice
    Then counts of each dataset are unchanged
```

### US-055 — Prohibited and restricted items with public lookup
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-049, US-057
- **Linked REQs:** REQ-DATA-011
- **As a** shipper **I want** to look up what cannot be shipped to a country or by a carrier **so that** I avoid a refused parcel.
- **Notes:** Entries per country and per carrier: category, name en/es/fr, status `PROHIBITED` or `RESTRICTED`, restriction note, match keywords or HS prefix, source label, unreviewed flag. Public lookup returns the union of the country entries from the active compliance pack and the carrier entries. Covers destinations of enabled launch lanes. Used by the public prohibited-items page and the inline booking check (EPIC-09).

#### Acceptance criteria
Permission path: not applicable — public anonymous lookup by design; the "Rate limited" scenario is the abuse path
```gherkin
Feature: Prohibited and restricted items with public lookup
  Scenario: Lookup by country
    When GET /api/v1/reference/prohibited-items?country=IN is called without authentication
    Then entries from the active IN compliance pack are returned with category, localised name, status, note and source
    And every entry has unreviewed true while reviewed_at is null

  Scenario: Union with carrier entries
    When the lookup includes carrier=MOCK
    Then the result contains country entries and carrier entries without duplicates

  Scenario: Localisation
    When Accept-Language is "fr"
    Then names are French

  Scenario: Unsupported country
    When country=KP is requested
    Then the response is 422 COUNTRY_NOT_SUPPORTED

  Scenario: Missing pack
    Given no pack exists for country BR
    Then the response states PACK_UNAVAILABLE and returns carrier entries only

  Scenario: Invalid parameter
    When country=INDIA is sent
    Then the response is 400 VALIDATION_ERROR at "/query/country"

  Scenario: Rate limited
    Then the 121st request per minute per IP returns 429 RATE_LIMITED

  Scenario: Seed covers launch lanes
    Then entries exist for IN, CA, GB and US destinations
```

### US-056 — Order-number sequences and zone table seam
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-DATA-015, REQ-DATA-017
- **As a** customer **I want** a unique, typo-resistant order number **so that** I can quote it to support and track by it.
- **Notes:** Format `<ISO alpha-2 origin>-<8-digit zero-padded sequence><Luhn mod 10 check digit>`; per (type, origin country); atomic, monotonic, unique, gaps allowed (DR-A24). Invoice and credit-note sequence types are defined but not allocated until M2. Zone and zone-country tables created empty for M2 (Could, seam only: no seed rows, no endpoints).

#### Acceptance criteria
Permission path: not applicable — internal sequence allocation with no user-facing route; negative scenarios cover concurrency and exhaustion
```gherkin
Feature: Order-number sequences and zone table seam
  Scenario: Format
    When the first order is allocated for origin US
    Then the number matches "^US-\d{8}\d$" and its last digit is a valid Luhn mod 10 check digit

  Scenario: Concurrency
    When 100 allocations run in parallel for origin IN
    Then 100 distinct numbers are returned in a strictly increasing sequence order

  Scenario: Gaps are allowed
    Given an allocation whose transaction rolled back
    Then later numbers remain unique and increasing

  Scenario: Separate sequences per country
    Then US and IN sequences advance independently

  Scenario: Invalid origin
    When allocation is requested for origin "XX"
    Then it fails with a validation error and no number is consumed

  Scenario: Invoice sequence not allocatable yet
    When allocation is requested for type INVOICE
    Then it fails with a not-implemented error

  Scenario: Check digit rejects typos
    Given order number US-000000421 with one digit changed
    Then the tracking-lookup validator reports an invalid number before any database query

  Scenario: Zone tables exist and are empty
    Then the zones and zone-country mapping tables exist with no rows and no endpoint is routed to them
```

### US-057 — Compliance pack store, immutability and resolution
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-049
- **Linked REQs:** REQ-COMP-001, REQ-COMP-002
- **As a** compliance owner **I want** versioned per-country packs that never change once published **so that** every decision can be reproduced from the version it used.
- **Notes:** Per country (ISO alpha-2 or `EU` template): integer version, `effective_from`, `reviewed_by`, `reviewed_at`, structured sections (tax rules, customs thresholds, prohibited/restricted items, privacy notice per locale, consent and cookie rule, retention periods). Unique per (country, version). Invalid section schema fails the seed. Resolution per DR-A23: greatest `effective_from` not later than the instant; EU member without national pack falls back to the `EU` template; otherwise `PACK_UNAVAILABLE`. Edits of a published version are rejected by a database trigger and the repository.

#### Acceptance criteria
Permission path: not applicable — data layer with no principal; a second negative scenario is included.
```gherkin
Feature: Compliance pack store, immutability and resolution
  Scenario: Pack structure and uniqueness
    Then a pack has country, version, effective_from, reviewed_by, reviewed_at and all seven sections (tax rules, customs thresholds, prohibited and restricted items, privacy notice per locale, consent and cookie rule, retention periods, party identity reference types)
    And a second row with the same (country, version) is rejected

  Scenario: Invalid section fails the seed
    Given a pack whose tax rule lacks "rate"
    When the seed runs
    Then the seed fails naming the pack and section and loads nothing from it

  Scenario: Resolution by instant
    Given IN version 1 effective 2026-01-01 and version 2 effective 2026-07-01
    When resolving for 2026-06-30 and for 2026-07-01
    Then version 1 and version 2 are returned respectively

  Scenario: EU fallback
    Given France has no national pack
    Then resolution returns the EU template

  Scenario: No applicable pack
    Given country BR is not in the EU and has no pack
    Then resolution reports PACK_UNAVAILABLE and returns no hidden default

  Scenario: Published version is immutable
    When an UPDATE of a published pack row is attempted through SQL as the application role
    Then the database trigger rejects it
    And the repository method rejects it with 409 CONFLICT

  Scenario: Change creates a new version
    When a corrected IN pack is loaded
    Then version 2 is created and version 1 is unchanged

  Scenario: Resolved version is recorded by consumers
    When a quote consumes the IN pack
    Then the quote stores the pack version number

  Scenario: Party identity reference types section (REQ-COMP-001, D-051)
    Then a pack has a party identity reference types section whose entries each have type code, label per locale (en, es, fr), format pattern, required-for direction and party, and "invoice_print" of FULL or MASKED
    And an entry without "invoice_print" is stored as MASKED

  Scenario: Invalid invoice_print value fails the seed
    Given a pack whose reference type has "invoice_print: PARTIAL"
    When the seed runs
    Then the seed fails naming the pack, section and type, and loads nothing from it

  Scenario: Seeded IN pack marks only the import receiver reference FULL
    When the seeded IN pack is loaded
    Then the import receiver reference type used for the US -> IN lane is FULL
    And every other seeded reference type in every pack is MASKED

  Scenario: Change to the FULL list is flagged unreviewed
    Given a new pack version changes the set of FULL reference types and "reviewed_by" is empty
    Then resolution reports "unreviewed: true" for that version
    And the flag clears only after "reviewed_by" is set
```

### US-058 — Seed compliance packs with audited loading
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-057, EPIC-04
- **Linked REQs:** REQ-COMP-003, REQ-COMP-008
- **As a** compliance owner **I want** draft packs for the launch countries and an audit record of every load **so that** the demo is functional and changes are traceable.
- **Notes:** Packs for US, IN, GB, CA and an EU template, each with: tax rules (rate, inclusive/exclusive display, label), de-minimis thresholds (amount, currency), prohibited/restricted entries, privacy notice en/es/fr, cookie and consent rule, retention periods (recorded, not enforced). Engineering-supplied draft, `reviewed_at` null. Labels: India GST, UK VAT, Canada GST/HST, US sales tax not collected on international shipping by default. Seed writes one `CONFIG_CHANGE` entry per pack version created by a system actor; none on a no-op re-run.

#### Acceptance criteria
Permission path: not applicable — seed job with no principal; the scenario "Pack content cannot be changed by API" (404, no such route) is the access-control assertion.
```gherkin
Feature: Seed compliance packs with audited loading
  Scenario: Packs present
    When the seed has run
    Then packs exist for US, IN, GB, CA and EU, each at version 1 with reviewed_at null

  Scenario Outline: Tax labels as data
    Then the tax rule of "<country>" has label "<label>"
    Examples:
      | country | label                               |
      | IN      | GST                                 |
      | GB      | VAT                                 |
      | CA      | GST/HST                             |
      | US      | sales tax (not collected on international shipping) |

  Scenario: Content completeness
    Then each pack has a privacy notice in en, es and fr, a consent rule, retention periods, prohibited entries and a de-minimis threshold in integer minor units with currency

  Scenario: Audit of loads
    Then one CONFIG_CHANGE entry per pack version exists with actor type SYSTEM_JOB, pack country, version and reviewed_at state null, outcome SUCCESS

  Scenario: Re-run is a no-op
    When the seed runs again
    Then no new CONFIG_CHANGE entries and no new pack rows are created

  Scenario: Pack content cannot be changed by API
    When a staff Super Admin calls PUT /api/v1/compliance-packs/IN
    Then the response is 404 NOT_FOUND because no such route exists in this run

  Scenario: Audit write failure aborts the load
    Given the audit insert fails
    Then the pack load rolls back
```

### US-059 — Pack-derived data: unreviewed flag, tax rule and de-minimis
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-057, US-058
- **Linked REQs:** REQ-COMP-004, REQ-COMP-005, REQ-COMP-006
- **As a** pricing and customs developer **I want** the resolved tax rule and de-minimis threshold provided as data and flagged when unreviewed **so that** logic stays free of country branches and users are never misled about legal status.
- **Notes:** `unreviewed: true` in every API response containing pack-derived data when `reviewed_at` is null; staff views render an "unreviewed" badge; customer-facing legal pages carry "draft, pending legal review" (GAP-A-13). Tax rule: rate, display mode, label, pack version supplied to `packages/pricing`, no I/O and no `if country === 'IN'` branches (lint/Semgrep rule). De-minimis: integer minor units plus currency and a document-exemption flag, consumed by EPIC-09/EPIC-10.

#### Acceptance criteria
```gherkin
Feature: Pack-derived data
  Scenario: Unreviewed flag in responses
    When a quote response includes a tax line derived from the IN pack
    Then the response contains "unreviewed": true and the pack version
    And after reviewed_at is set in a new pack version the flag is false

  Scenario: Badge in staff views
    When a staff user opens a view showing pack-derived data
    Then an "unreviewed" badge is rendered in en, es and fr at 360 px and 1280 px

  Scenario: Tax rule input for pricing
    When pricing is invoked for destination IN
    Then it receives rate, display mode, label and pack version as input data
    And packages/pricing performs no database or network call

  Scenario: Country branches are rejected
    Given pricing code containing "if (country === 'IN')"
    When Semgrep runs
    Then CI fails naming the rule

  Scenario: De-minimis exposure
    When the customs workflow resolves the destination GB
    Then it receives threshold amount in integer minor units, currency and the document-exemption flag

  Scenario: Missing pack
    Given the destination has no pack
    Then the tax rule input is absent with state PACK_UNAVAILABLE and the response carries unreviewed false only when a pack exists

  Scenario: Permission path
    When an unauthenticated caller requests a customer-facing legal page
    Then it renders with the in-page "draft, pending legal review" banner and no authentication is needed
```

### US-060 — Privacy notice and consent rule endpoint
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-058, EPIC-05
- **Linked REQs:** REQ-COMP-007
- **As a** guest visitor **I want** to read the privacy notice for my country in my language **so that** I understand how my data is used and cookie consent behaves correctly.
- **Notes:** Public endpoint, fallback locale `en`; consent rule `NOTICE_ONLY`, `OPT_IN` or `OPT_OUT` drives the cookie banner (EPIC-05); pre-rendered privacy page renders the notice with the unreviewed draft banner.

#### Acceptance criteria
```gherkin
Feature: Privacy notice and consent rule endpoint
  Scenario: Notice for country and locale
    When GET /api/v1/compliance/privacy?country=GB&locale=fr is called without authentication
    Then the response is 200 with the French notice, consent_rule, pack version and unreviewed true

  Scenario: Locale fallback
    Given the pack has no notice for locale "es"
    When locale=es is requested
    Then the English notice is returned with a locale field "en"

  Scenario: Invalid parameters
    When locale=de is requested
    Then it is treated as "en" and country=XXX returns 400 VALIDATION_ERROR

  Scenario: Pack unavailable
    When country=BR is requested
    Then the response carries state PACK_UNAVAILABLE and the EU template is not applied to non-EU countries

  Scenario: Privacy page
    Then the pre-rendered page shows the notice and a "draft, pending legal review" banner in en, es and fr

  Scenario: Cacheable public data
    Then the response has an ETag and is limited to 120 requests per minute per IP
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-DATA-001 | US-049 |
| REQ-DATA-002 | US-049 |
| REQ-DATA-003 | US-050 |
| REQ-DATA-004 | US-051 |
| REQ-DATA-005 | US-051 |
| REQ-DATA-006 | US-052 |
| REQ-DATA-007 | US-051 |
| REQ-DATA-008 | US-054 |
| REQ-DATA-009 | US-054 |
| REQ-DATA-010 | US-054 |
| REQ-DATA-011 | US-055 |
| REQ-DATA-012 | US-054 |
| REQ-DATA-013 | US-054 |
| REQ-DATA-014 | US-052 |
| REQ-DATA-015 | US-056 |
| REQ-DATA-016 | US-053 |
| REQ-DATA-017 | US-056 |
| REQ-COMP-001 | US-057 |
| REQ-COMP-002 | US-057 |
| REQ-COMP-003 | US-058 |
| REQ-COMP-004 | US-059 |
| REQ-COMP-005 | US-059 |
| REQ-COMP-006 | US-059 |
| REQ-COMP-007 | US-060 |
| REQ-COMP-008 | US-058 |
