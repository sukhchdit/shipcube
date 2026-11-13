# EPIC-06 — Carrier integration layer

- **Goal:** Any carrier (Mock now, DHL Express, FedEx and UPS in M1) can be priced, called and tracked through one resilient, normalised contract, so a quote is answered within the deadlines even when a carrier is slow or down.
- **Milestone(s):** M0+M1
- **REQ areas covered:** REQ-CARR (REQ-CARR-001 to REQ-CARR-023)
- **Exit-demo contribution:** PRD 6.1 "Guest gets a mock quote" (Mock adapter, fan-out, scenarios, contract suite) and "One mock booking" (idempotent Mock create); PRD 6.2 outline (three fixture-backed adapters streaming results, labels per carrier) and the COND-SANDBOX-DEMO scenario.
- **Depends on epics:** EPIC-01 (PLAT: monorepo, lint boundary rules, Redis, queues, object storage, config validation), EPIC-04 (AUDIT: `carrier_call` entries), EPIC-16 (API/SEC: problem+json, SSE framing REQ-API-017, rate limits), EPIC-17 (DATA/COMP: country and service reference data, secret scanner), EPIC-07 (pricing consumes carrier cost), EPIC-08 (quote consumes the stream), EPIC-09 (BOOK: booking jobs call the adapters)

Conventions used below. Carrier call, cache and stream scenarios run against the Mock carrier and `nock` fixtures (D-003). Errors are `application/problem+json` with the stated `code` (DR-A26 plus Part B codes). SSE framing follows REQ-API-017 (`text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, monotonically increasing `id`, 15 s comment heartbeat). Event names follow REQ-CARR-009 (`carrier_result`, `carrier_error`, `complete`); see the conflict note in the handoff.

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-121 | CarrierAdapter contract, CarrierContext and capability guard | M0 | Must | M | EPIC-01 | REQ-CARR-001, REQ-CARR-002, REQ-CARR-003 | DC |
| US-122 | Deterministic Mock carrier | M0 | Must | M | US-121 | REQ-CARR-004 | DC |
| US-123 | Mock scenario directives and production exclusion | M0 | Must | M | US-122, EPIC-16 | REQ-CARR-005, REQ-CARR-006 |  |
| US-124 | Normalisation to canonical codes | M0 | Must | S | US-121 | REQ-CARR-007 | DC |
| US-125 | Shared adapter contract test suite | M0 | Must | M | US-122, US-124 | REQ-CARR-011 |  |
| US-126 | Rate-shopping fan-out with deadlines and partial results | M0 | Must | M | US-122, US-124, EPIC-03 | REQ-CARR-008 | DC |
| US-127 | Carrier service reference data | M1 | Must | S | US-121, EPIC-17 | REQ-CARR-021 | DC |
| US-128 | Platform carrier accounts and credential handling | M1 | Must | S | US-121, EPIC-01 | REQ-CARR-015 | DC |
| US-129 | OAuth token caching | M1 | Must | S | US-128 | REQ-CARR-016 |  |
| US-130 | Resilience: timeouts, retries, circuit breaker and bulkhead | M1 | Must | M | US-121 | REQ-CARR-017 |  |
| US-131 | DHL Express (MyDHL) adapter | M1 | Must | M | US-125, US-127, US-128, US-130 | REQ-CARR-012 | DC |
| US-132 | FedEx REST adapter | M1 | Must | M | US-125, US-127, US-129, US-130 | REQ-CARR-013 | DC |
| US-133 | UPS REST adapter | M1 | Must | M | US-125, US-127, US-129, US-130 | REQ-CARR-014 | DC |
| US-134 | Rate response cache | M1 | Must | S | US-126, EPIC-01 | REQ-CARR-010 |  |
| US-135 | Streaming rate results (SSE) with fallback GET | M1 | Must | M | US-126, US-134, EPIC-16 | REQ-CARR-009 | DC |
| US-136 | Redacted raw payload retention | M1 | Must | S | US-131, EPIC-01 | REQ-CARR-018 |  |
| US-137 | Fixture hygiene, adapter README docs-check and live-sandbox opt-in | M1 | Must | S | US-125, US-131, US-132, US-133 | REQ-CARR-019, REQ-CARR-020 |  |
| US-293 | Anonymous rate-shopping budget and daily carrier quota guard | M1 | Must | M | US-126, US-130, US-134, EPIC-16 | REQ-CARR-022, REQ-CARR-023 |  |

## Stories

### US-121 — CarrierAdapter contract, CarrierContext and capability guard
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-CARR-001, REQ-CARR-002, REQ-CARR-003
- **Linked NFRs (optional):** none
- **As a** developer **I want** one typed `CarrierAdapter` interface with a mandatory capability declaration and a safe guard for unsupported optional operations **so that** onboarding a carrier needs only an adapter, a capability declaration and seed data.
- **Notes:** Interface lives in `packages/carriers`. Required ops: `getRates`, `createShipment`, `cancelShipment`, `schedulePickup`, `cancelPickup`, `track`; optional: `validateAddress`, `findServicePoints`, `uploadCustomsDocuments`, `estimateLandedCost`, `recoverLabel` (ADR-0010 am. 11, D-ARCH-062). `capabilities()` also carries `operations.cancelShipment: boolean`; a required operation declared unsupported (DHL Express `cancelShipment`, D-ARCH-057) is answered by the same `CAPABILITY_NOT_SUPPORTED` guard with no I/O. `CarrierContext` carries carrier account reference, environment (`sandbox` or `production`, a property of the account, never a global flag) and correlation ID. `estimateLandedCost` is a seam only. No pickup-availability query exists (GAP-B-01).

#### Acceptance criteria
Permission path: not applicable — build-time library with no principal; a second negative scenario is included.
```gherkin
Feature: CarrierAdapter contract and capabilities
  Scenario: Adapter exposes required and optional operations with a context
    Given an adapter registered in packages/carriers
    When the type check and the interface test run
    Then every required operation accepts a CarrierContext with accountRef, environment and correlationId
    And capabilities() returns a boolean for each of validateAddress, findServicePoints, uploadCustomsDocuments, estimateLandedCost and recoverLabel
    And capabilities() returns a boolean operations.cancelShipment

  Scenario: Capabilities describe services, limits and pickup constraints
    When capabilities() is called on the Mock adapter
    Then each service lists canonical code, directions, content types, max weight per package and per shipment, max dimensions, volumetric divisor per unit system, booking cut-off time with IANA zone, drop-off, pickup, DDP, paperless and label formats
    And the result lists max tracking numbers per call, push tracking flag, idempotent-create flag and pickup constraints (days served, earliest ready, latest close, minimum window length)

  Scenario: Unsupported optional operation fails without a network call
    Given an adapter whose capabilities() declares findServicePoints=false
    And network access is monitored
    When findServicePoints is invoked
    Then the call fails with the structured error CAPABILITY_NOT_SUPPORTED
    And zero outbound network requests are made
    # repeated as a unit test per optional operation

  Scenario: Environment is read from the account, not a global flag
    Given a CarrierContext with environment "production" and a context with environment "sandbox"
    When the same adapter is called with each context
    Then the base URL used is selected from the context environment only
    And no global environment variable changes that selection

  Scenario: Wire formats cannot leak out of the package
    Given a source file outside packages/carriers that imports a carrier wire-format type
    When the lint boundary rule runs
    Then lint fails naming the file and the forbidden import

  Scenario: Adapter missing a required operation is rejected at registration
    Given an adapter object without track
    When it is registered
    Then registration fails with a message naming the missing operation

  Scenario: Required operation declared unsupported fails without a network call
    Given an adapter whose capabilities() declares operations.cancelShipment=false
    And network access is monitored
    When cancelShipment is invoked
    Then the call fails with the structured error CAPABILITY_NOT_SUPPORTED
    And zero outbound network requests are made
    # contract case cancel-capability-not-supported-no-io (D-ARCH-057)
```

### US-122 — Deterministic Mock carrier
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-121
- **Linked REQs:** REQ-CARR-004
- **As a** developer **I want** a Mock carrier `MOCK` that returns deterministic rates, labels and tracking numbers **so that** quotes, bookings and tests work with no real carrier (D-003).
- **Notes:** Services `MOCK_EXPRESS` (1-3 transit days), `MOCK_STANDARD` (3-5), `MOCK_ECONOMY` (5-9); documents and parcels; export, import and domestic. Price is a deterministic function of billable weight, lane zone and service. Labels are generated PDFs marked "MOCK - NOT A VALID LABEL". Tracking number derived from the client reference.

#### Acceptance criteria
Permission path: not applicable — library adapter with no principal; second negative scenario included.
```gherkin
Feature: Mock carrier
  Scenario: Three services priced deterministically
    Given a parcel request US 10001 to IN 400001, 2 kg, 30x20x10 cm
    When getRates is called on MOCK twice
    Then both responses contain MOCK_EXPRESS, MOCK_STANDARD and MOCK_ECONOMY
    And transit days are within 1-3, 3-5 and 5-9 respectively
    And the two responses are byte-identical

  Scenario: Price changes only with weight, zone or service
    Given two requests identical except billable weight 2.0 kg and 2.5 kg
    When getRates is called for each
    Then the 2.5 kg price is greater than or equal to the 2.0 kg price for every service
    And repeating each request returns the same price

  Scenario: Tracking number is stable for a client reference
    Given a createShipment with client reference "SHP-123-A1"
    When createShipment is called twice with that reference
    Then both calls return the same tracking number and an identical label PDF
    And the label PDF text contains "MOCK - NOT A VALID LABEL"

  Scenario: Documents, imports and domestic lanes are served
    When getRates is called for DOCUMENT export, IN to US import and US to US domestic
    Then each returns at least one Mock service

  Scenario: Optional operations are supported except landed cost
    When capabilities() is read
    Then validateAddress, findServicePoints and uploadCustomsDocuments are true
    And estimateLandedCost is false

  Scenario: Request outside Mock limits returns no service
    Given a package of 1000 kg
    When getRates is called
    Then the Mock returns no services with reason WEIGHT_EXCEEDED, not an exception
```

### US-123 — Mock scenario directives and production exclusion
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-122, EPIC-16
- **Linked REQs:** REQ-CARR-005, REQ-CARR-006
- **As a** QA engineer **I want** to drive the Mock carrier with scenario directives and know it can never appear in production **so that** slow, failing and tracking-milestone cases are testable and no test carrier prices a real customer.
- **Notes:** Vocabulary per DR-B29: `latency=<0..30000 ms>`, `fail=<rates|booking|void|pickup|cancel_pickup|track>`, `error=<canonical code>`, `rates=empty`, `track=<happy_path|customs_hold|exception|return_to_sender|delayed|unknown_number>`, separated by semicolons. Source: `X-Mock-Scenario` header or customer reference beginning `MOCK:`. Gating is by the explicit flags `MOCK_CARRIER_ENABLED` and `MOCK_SCENARIOS_ENABLED` (default true only when `APP_ENV` is `local` or `test`), not by `NODE_ENV` (REQ-CARR-006, D-052, SEC-P3-21). The compose demo runs `APP_ENV=local`. No state is mutated, so no audit scenario applies.

#### Acceptance criteria
Permission path: not applicable — Mock directives are request hints with no principal; the "Directives are ignored and stripped when scenarios are disabled" and "Production start-up is refused" scenarios are the safety path
```gherkin
Feature: Mock scenario directives
  Scenario: Latency directive delays every call
    Given a rate request with header "X-Mock-Scenario: latency=6000"
    When the Mock carrier answers
    Then the Mock call takes at least 6000 ms
    And the fan-out marks MOCK as TIMEOUT at 4000 ms while other carriers still return

  Scenario: Failure with canonical error
    Given the directive "fail=booking;error=SERVICE_UNAVAILABLE"
    When createShipment is called on MOCK
    Then it fails with canonical error SERVICE_UNAVAILABLE
    And the same directive and inputs give the same outcome on a repeat

  Scenario: Reference-based directive
    Given a shipment customer reference "MOCK:fail=void"
    When cancelShipment is called
    Then it fails and no header is needed

  Scenario: Empty rates and tracking milestones
    Given directive "rates=empty"
    Then getRates returns zero services with status NO_SERVICE
    Given directive "track=customs_hold"
    Then track returns the canonical CUSTOMS_HOLD milestone sequence

  Scenario: Unknown directive is rejected
    Given header "X-Mock-Scenario: latency=40000;foo=bar"
    When the request is submitted
    Then the response is 400 application/problem+json with code MOCK_SCENARIO_INVALID
    And no carrier call is made

  Scenario: Flags default to true only in local and test
    Given MOCK_CARRIER_ENABLED and MOCK_SCENARIOS_ENABLED are unset
    When the configuration is loaded with APP_ENV=local and again with APP_ENV=test
    Then both flags resolve to true in each case
    When the configuration is loaded with APP_ENV=staging and again with APP_ENV=production
    Then both flags resolve to false in each case

  Scenario: Staging without the flags has no Mock
    Given APP_ENV=staging and neither MOCK_CARRIER_ENABLED nor MOCK_SCENARIOS_ENABLED is set
    When the adapter registry, the capability listing and a rate-shopping fan-out are inspected
    Then MOCK is absent from all three
    And no Mock option appears in any rate response

  Scenario: Directives are ignored and stripped when scenarios are disabled
    Given APP_ENV=staging and MOCK_SCENARIOS_ENABLED is unset
    When a rate request carries "X-Mock-Scenario: fail=rates"
    Then the directive has no effect and the header is not echoed
    And the edge proxy strips the X-Mock-Scenario header before it reaches the API
    # Permission path: directive header is accepted from any caller only where scenarios are enabled (local, test); the disabled behaviour above is the control

  Scenario: Production start-up is refused with the Mock enabled
    Given APP_ENV=production and MOCK_CARRIER_ENABLED=true
    When the API process starts
    Then start-up is refused with the error code MOCK_FORBIDDEN_IN_PRODUCTION
    And the same refusal occurs for APP_ENV=production with MOCK_SCENARIOS_ENABLED=true

  Scenario: Compose demo stack keeps directives working
    Given the docker compose demo stack runs with APP_ENV=local
    When a rate request carries "X-Mock-Scenario: latency=6000"
    Then the directive is honoured and MOCK is listed in the adapter registry

  Scenario: Boundary values of latency
    Given "latency=0" and "latency=30000" are accepted
    And "latency=30001" and "latency=-1" return MOCK_SCENARIO_INVALID
```

### US-124 — Normalisation to canonical codes
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-121
- **Linked REQs:** REQ-CARR-007
- **As a** developer **I want** every carrier service, surcharge, error and tracking event mapped to Platform canonical codes at the adapter boundary **so that** the rest of the system and customer messages never depend on carrier wording.
- **Notes:** Codes per DR-B30. Unmapped surcharge to `CARRIER_OTHER` (original label kept in the raw field); unmapped error to `CARRIER_UNKNOWN_ERROR`; unmapped service dropped and logged with carrier and account.

#### Acceptance criteria
Permission path: not applicable — pure mapping library; second negative scenario included.
```gherkin
Feature: Canonical code normalisation
  Scenario: Mapped service, surcharge and error
    Given a carrier response with a known service, surcharge "Remote Area Delivery" and error "Invalid postal code"
    When the adapter normalises it
    Then the service has a canonical code (carrier code plus carrier service code) and tier EXPRESS, STANDARD or ECONOMY
    And the surcharge code is REMOTE_AREA and the error code is POSTCODE_INVALID

  Scenario: Unmapped service is dropped and logged
    Given a response containing service code "XYZ_UNKNOWN" for carrier DHL_EXPRESS account acct-1
    When normalised
    Then the service is absent from customer results
    And one log entry records carrier DHL_EXPRESS, account acct-1 and service code XYZ_UNKNOWN

  Scenario: Unmapped surcharge becomes CARRIER_OTHER
    Given a surcharge labelled "Weird Fee" with no mapping
    When normalised
    Then the line code is CARRIER_OTHER and the raw field keeps "Weird Fee"

  Scenario: Unmapped error becomes CARRIER_UNKNOWN_ERROR
    Given an error with an unrecognised code
    When normalised
    Then the canonical code is CARRIER_UNKNOWN_ERROR
    And the customer-facing message is chosen from the canonical code, not the raw carrier text

  Scenario: Every canonical code is in the catalogue
    When the mapping tables are checked against DR-B30
    Then each mapped value is one of the listed service tiers, surcharge codes or error codes
```

### US-125 — Shared adapter contract test suite
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-122, US-124
- **Linked REQs:** REQ-CARR-011
- **As a** developer **I want** one contract suite in `tests/contract` that every adapter must pass unchanged **so that** a new carrier is proven by running the suite, not by bespoke tests.
- **Notes:** Runs against Mock in M0; real-adapter fixtures join in M1 (US-131 to US-133).

#### Acceptance criteria
Permission path: not applicable — test tooling with no principal; second negative scenario included.
```gherkin
Feature: Adapter contract suite
  Scenario: Suite passes for the Mock adapter
    When the contract suite runs with the Mock adapter
    Then cases pass for rates (success, no service, auth failure, timeout), createShipment (success with label, validation error, duplicate client reference), cancelShipment (success, refused), schedulePickup and cancelPickup, and track (delivered, in transit, exception, unknown number)

  Scenario: Capability honesty is verified
    Given an adapter that declares uploadCustomsDocuments=false
    When the suite runs
    Then calling it yields CAPABILITY_NOT_SUPPORTED
    And an adapter declaring true but not implementing it fails the suite

  Scenario: Suite is adapter-agnostic
    Given a new adapter registered with only an adapter, a capability declaration and fixtures
    When the suite runs
    Then no suite file is edited to make it run

  Scenario: Duplicate client reference does not create a second shipment
    Given createShipment was called with client reference R
    When it is called again with R
    Then one tracking number is returned and the carrier's shipment count for R is 1

  Scenario: A failing adapter fails CI
    Given an adapter that returns a non-canonical error code
    When the suite runs in CI
    Then the job fails naming the case
```

### US-126 — Rate-shopping fan-out with deadlines and partial results
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-122, US-124, EPIC-03
- **Linked REQs:** REQ-CARR-008
- **As a** guest shipper **I want** every eligible carrier asked in parallel with firm deadlines **so that** I get prices quickly and one slow carrier never blocks the others.
- **Notes:** Per-carrier deadline 4000 ms, overall 5000 ms (configuration). Status per carrier: `OK`, `NO_SERVICE`, `TIMEOUT`, `ERROR`. Runs under `quote:create` (granted to anonymous and all roles). Late responses discarded and never cached (DR-B16, EC-B01). First result p95 at most 1.5 s, complete at most 5 s with the Mock latency profile.

#### Acceptance criteria
Permission path: not applicable — internal fan-out service; `quote:create` is granted to the anonymous principal and every role, so there is no deny path, and the quote routes that invoke it carry their own permission scenarios (US-155).
```gherkin
Feature: Rate-shopping fan-out
  Scenario: Parallel fan-out returns all carriers' results
    Given MOCK and three fixture adapters are enabled
    When a US to IN parcel rate request is made
    Then all four carriers are called concurrently
    And the response lists each carrier with status OK and its priced options

  Scenario: Slow carrier times out without blocking others
    Given MOCK is driven with "latency=6000"
    When the rate request runs
    Then MOCK is reported TIMEOUT at about 4000 ms
    And the other carriers' options are returned and the whole call completes by 5000 ms
    And the late MOCK response is discarded and not cached

  Scenario: Carrier filtered out by declared services
    Given a 120 kg parcel and carriers whose per-package maximum is below 120 kg
    When the request runs
    Then those carriers are reported NO_SERVICE without being called

  Scenario: Carrier error is isolated
    Given one adapter throws CARRIER_UNKNOWN_ERROR
    Then its status is ERROR with the canonical code and the others are OK

  Scenario: Overall deadline marks outstanding carriers
    Given two carriers still outstanding at 5000 ms
    Then both are marked TIMEOUT and results received so far are returned

  Scenario: Disabled carrier account is skipped
    Given the FedEx account is NOT_CONFIGURED
    When the request runs
    Then FedEx is not called and does not appear in the statuses as an error

  Scenario: Quote performance with the Mock latency profile
    Given the Mock latency profile
    When 50 rate requests run
    Then first-result p95 is at most 1500 ms and completion p95 at most 5000 ms

  Scenario: Fan-out is audited per carrier call only for system jobs
    Given a customer-initiated rate request
    Then no carrier_call audit entry is written because carrier_call entries are for booking, cancellation and pickup jobs
```

### US-127 — Carrier service reference data
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-121, EPIC-17
- **Linked REQs:** REQ-CARR-021
- **As a** developer **I want** per-service reference data seeded for Mock and at least three services each for DHL Express, FedEx and UPS **so that** limits, divisors, cut-offs and liability drive both capabilities and pricing from one source.
- **Notes:** Seed values come from public documentation and are flagged `unreviewed`. Divisors include imperial 139 and metric 5000.

#### Acceptance criteria
Permission path: not applicable — seed data loaded by migration/seed job; second negative scenario included.
```gherkin
Feature: Carrier service reference data
  Scenario: Seed covers all carriers
    When the seed runs on an empty database
    Then Mock services and at least 3 services each for DHL_EXPRESS, FEDEX and UPS exist
    And every row has carrier, canonical code, name, direction, content type, weight and dimension limits, divisor per unit system, cut-off time and zone, liability term, drop-off, pickup, DDP and paperless flags

  Scenario: Divisors and flags
    Then every service has a metric divisor (default 5000) and an imperial divisor (default 139)
    And every row carries the flag unreviewed=true

  Scenario: Single source of truth
    When capabilities() is called for each adapter
    Then service limits, divisors and flags equal the reference data rows

  Scenario: Seed is idempotent
    When the seed runs twice
    Then the row count is unchanged

  Scenario: Invalid row is rejected
    Given a seed row with a negative maximum weight or an unknown IANA zone
    When validation runs
    Then the seed fails naming the row
```

### US-128 — Platform carrier accounts and credential handling
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-121, EPIC-01
- **Linked REQs:** REQ-CARR-015
- **As an** operator **I want** exactly one platform-owned sandbox account per carrier configured through secret references **so that** carrier secrets never touch the database, logs or API responses.
- **Notes:** Accounts without credentials are disabled and reported `NOT_CONFIGURED` (D-003, D-012). Admin screens are M2. Status listing is for staff/system use.

#### Acceptance criteria
```gherkin
Feature: Platform carrier accounts
  Scenario: Three sandbox accounts from configuration
    Given secret references are set for DHL_EXPRESS, FEDEX and UPS
    When the application starts
    Then exactly one account per carrier exists with environment "sandbox"
    And only references (names) are stored, never values

  Scenario: Missing secret disables the account
    Given FedEx is enabled but its secret reference is unset
    When the carrier status listing is requested
    Then FEDEX appears as NOT_CONFIGURED and is excluded from fan-out
    And start-up logs the missing reference name only

  Scenario: Start-up fails for an enabled account lacking its secret
    Given an account is explicitly marked enabled=required without a secret reference
    Then configuration validation fails at start-up reporting names only

  Scenario: Secrets never leak
    Given a carrier call fails with an auth error
    When logs, audit values, the API error body and database columns are scanned for the secret value
    Then no match is found

  Scenario: Only Mock keeps the system usable
    Given no carrier credentials are supplied
    Then the system starts and rate shopping returns Mock results

  Scenario: Permission denied on the status listing
    Given a customer-role user
    When they request the carrier status listing
    Then the response is 403 with code AUTHZ_DENIED

  Scenario: Unauthenticated listing
    When an anonymous caller requests the status listing
    Then the response is 401 with code AUTH_REQUIRED
```

### US-129 — OAuth token caching
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-128
- **Linked REQs:** REQ-CARR-016
- **As a** developer **I want** OAuth access tokens cached and refreshed once per account **so that** carrier calls do not request a token each time and a burst never floods the token endpoint.
- **Notes:** Cached in Redis until 60 s before stated expiry (`ttl = clamp(expires_in − CARRIER_TOKEN_REFRESH_SKEW_S, 0, CARRIER_TOKEN_TTL_MAX_S)`, defaults 60 / 3600; missing or non-numeric `expires_in` makes the token uncacheable, never a default lifetime); one in-flight refresh; on 401 discard and retry once. Token-endpoint failures (D-ARCH-062, PR6-SEC-05/07, SEC-TC-68): 400/401 from the token endpoint is negative-cached per account for `CARRIER_TOKEN_FAIL_TTL_S=60` (fail fast with `AUTH_FAILED`, counts toward the breaker); token requests per carrier go through a shared bucket `CARRIER_TOKEN_REQUESTS_PER_S` (FedEx 1/s, burst 3); a token-endpoint 403 is handled by the adapter's static `TOKEN_ENDPOINT_POLICY` (D-ARCH-067, D-060, ADR-0010 am. 11 item 5(c)) — FedEx `carrier-cooldown`: carrier-wide `CARRIER_TOKEN_PENALTY_COOLDOWN_S=600` (no FedEx token request, every FedEx account fails fast with `CARRIER_UNAVAILABLE`, event `carrier_token_penalty`, one probe after), never treated as "refresh"; UPS `account-negative-cache`: 403 = "Blocked Merchant" for that account only, `CARRIER_TOKEN_BLOCKED_TTL_S=600`, fail fast `AUTH_FAILED`, its breaker opens, ops event, other UPS accounts unaffected and no carrier-wide key; DHL Express (HTTP Basic) has no token endpoint. `AUTH_FAILED` = "fix the credentials", `CARRIER_UNAVAILABLE` = "wait". Token value never logged.

#### Acceptance criteria
Permission path: not applicable — internal client concern with no principal; second negative scenario included.
```gherkin
Feature: OAuth token cache
  Scenario: Token reused until 60 s before expiry
    Given a token stated to expire in 3600 s
    When calls are made at 10 s and at 3500 s
    Then one token request was made
    And at 3541 s a new token is requested

  Scenario: Single in-flight refresh
    Given no cached token
    When 50 simultaneous calls are made for one account
    Then exactly one token request is sent and all 50 calls use the result

  Scenario: 401 triggers one retry with a new token
    Given the carrier returns 401 for the cached token
    When a call is made
    Then the cached token is discarded and a new one fetched
    And the call is retried once and succeeds

  Scenario: Persistent 401 does not loop
    Given the carrier returns 401 for every token
    Then the call ends after one retry with canonical error AUTH_FAILED

  Scenario: Token never logged
    When all logs of all scenarios in this feature are scanned
    Then no token value appears

  Scenario: Token endpoint rejects the credentials
    Given the token endpoint answers 401 for account acct-fedex
    When 20 calls are made within 60 s
    Then exactly one token request is sent
    And every call fails fast with canonical error AUTH_FAILED
    And the failures count toward the breaker of acct-fedex

  Scenario: FedEx token endpoint 403 starts a carrier-wide cool-down (policy carrier-cooldown)
    Given the FedEx token endpoint answers 403 for account acct-fedex-a
    When calls are made for any FedEx account during the next 600 s
    Then no further FedEx token request is sent
    And the calls fail fast with canonical error CARRIER_UNAVAILABLE
    And one security event "carrier_token_penalty" names the carrier and the cool-down end time
    And exactly one probe token request is sent after the cool-down ends

  Scenario: UPS token endpoint 403 on account A leaves accounts B and C working (policy account-negative-cache, SEC-TC-68 UPS case)
    Given UPS accounts acct-ups-a, acct-ups-b and acct-ups-c with no cached token
    And the UPS token endpoint answers 403 "Blocked Merchant" for acct-ups-a and 200 for the others
    When calls are made for all three accounts during the next 600 s
    Then calls for acct-ups-a fail fast with canonical error AUTH_FAILED after exactly one token request
    And the circuit breaker of acct-ups-a opens and an operations event names acct-ups-a
    And calls for acct-ups-b and acct-ups-c succeed with their own tokens
    And no carrier-wide cool-down key exists for carrier UPS

  Scenario: Token requests are rate-limited per carrier
    Given 10 FedEx accounts with no cached token and a bucket of 1 request per second with burst 3
    When all 10 request a token at once
    Then at most 3 token requests are sent in the first second and the rest wait their turn

  Scenario: Missing expires_in is never cached
    Given the token response omits expires_in
    Then the token is used for the call, is not cached and a rate-limited warning is logged
```

### US-130 — Resilience: timeouts, retries, circuit breaker and bulkhead
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-121
- **Linked REQs:** REQ-CARR-017
- **As a** shipper **I want** carrier calls to be bounded, retried safely and isolated per account **so that** one failing carrier degrades only itself.
- **Notes:** Timeouts: rates 4 s, tracking 10 s, cancel 10 s, pickup 15 s, createShipment 20 s. Retry base 200 ms, factor 2, full jitter, at most 2 retries, only for `getRates`, `track`, `findServicePoints`, `validateAddress`, `cancelShipment`, `cancelPickup`. Breaker per account opens at 50% failures over the last 20 calls (min 10) or 5 consecutive failures; half-open probe after 30 s. Two bulkhead pools per carrier account (D-048, replacing the single pool of 10): `rates` = 6 (`CARRIER_BULKHEAD_RATES=6`: `getRates`, `findServicePoints`, `validateAddress`) and `transactional` = 4 (`CARRIER_BULKHEAD_TRANSACTIONAL=4`: `createShipment`, `cancelShipment`, `schedulePickup`, `cancelPickup`, `track`, `recoverLabel`), so booking, cancellation, pickup and tracking never queue behind rate shopping. Overflow (queue wait beyond the operation deadline) yields `CARRIER_BUSY`, a local admission rejection that the saga treats as retryable (REQ-BOOK-023, US-205). The anonymous share of the `rates` pool is US-293. All values are configuration (ASSUMED defaults, A-037; NFR-RES-003; D-048). No entity is mutated, so no audit scenario applies.

#### Acceptance criteria
Permission path: not applicable — internal resilience wrapper with no principal; second negative scenario included.
```gherkin
Feature: Carrier call resilience
  Scenario: Timeout per operation
    Given a carrier that never answers
    When getRates, track, cancelShipment, schedulePickup and createShipment are called
    Then they time out at 4 s, 10 s, 10 s, 15 s and 20 s respectively

  Scenario: Idempotent operation is retried with backoff
    Given getRates fails twice with a transient error then succeeds
    When called
    Then 3 attempts occur with delays drawn from [0,200] ms and [0,400] ms
    And the call succeeds

  Scenario: Non-idempotent operations are never retried
    Given createShipment and schedulePickup each fail with a transient error
    Then each is attempted exactly once

  Scenario: Retries stop at the overall deadline
    Given the rate-shopping overall deadline of 5000 ms is reached during backoff
    Then no further retry is made

  Scenario: Breaker opens on failure ratio
    Given 10 calls of which 5 failed within the last 20
    Then the breaker opens
    When the next call is made
    Then it yields status ERROR with code CARRIER_UNAVAILABLE in under 50 ms without calling the carrier

  Scenario: Breaker opens on consecutive failures and half-opens
    Given 5 consecutive failures
    Then the breaker opens and after 30 s one probe call is allowed
    And a successful probe closes the breaker

  Scenario: Two bulkhead pools per account
    Given the configuration CARRIER_BULKHEAD_RATES=6 and CARRIER_BULKHEAD_TRANSACTIONAL=4
    When the pool assignment of each operation is inspected for one carrier account
    Then getRates, findServicePoints and validateAddress use the rates pool of 6
    And createShipment, cancelShipment, schedulePickup, cancelPickup, track and recoverLabel use the transactional pool of 4

  Scenario: Hung rate calls do not delay createShipment
    Given 6 getRates calls are in flight and hung for one account (Mock latency=30000)
    When createShipment is called for the same account
    Then it is admitted immediately through the transactional pool without queueing
    And its admission wait is under 50 ms

  Scenario: Rates pool overflow waits and then yields CARRIER_BUSY
    Given 6 getRates calls are in flight for one account
    When a 7th concurrent getRates call arrives
    Then it waits in the rates queue
    And if the queue wait exceeds the operation deadline of 4000 ms it fails with CARRIER_BUSY without calling the carrier

  Scenario: Transactional pool overflow
    Given 4 createShipment calls are in flight for one account
    When a 5th transactional call arrives and the queue wait exceeds its operation deadline
    Then it fails with CARRIER_BUSY without a network call

  Scenario: Pool metrics are exposed
    Given calls have queued and been rejected in both pools
    When the metrics endpoint is scraped
    Then queue depth is exposed per pool (rates, transactional)
    And rejects are exposed per pool and per caller class (anonymous, authenticated, system)

  Scenario: Breakers are independent per account
    Given the DHL breaker is open
    Then FedEx calls proceed normally
```

### US-131 — DHL Express (MyDHL) adapter
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-125, US-127, US-128, US-130
- **Linked REQs:** REQ-CARR-012
- **As a** guest shipper **I want** DHL Express prices and bookings **so that** I can compare and ship with DHL.
- **Notes:** HTTP Basic against `https://express.api.dhl.com/mydhlapi/test`. Implements all required operations plus optional operations the sandbox supports. Paths and API version confirmed from current official documentation at implementation time (REQ-CARR-019). Proven against `nock` fixtures; live proof is COND-SANDBOX-DEMO (D-003).

#### Acceptance criteria
```gherkin
Feature: DHL Express adapter
  Scenario: Rates from fixtures
    Given the DHL fixtures are loaded and the sandbox account uses Basic auth
    When getRates is called for US 10001 to IN 400001, 2 kg
    Then at least 3 DHL services are returned with canonical codes and carrier cost in minor units
    And requests target https://express.api.dhl.com/mydhlapi/test

  Scenario: Full required-operation set
    When createShipment, cancelShipment, schedulePickup, cancelPickup and track run against fixtures
    Then each returns the canonical shape and the shared contract suite passes unchanged

  Scenario: Carrier validation error is normalised
    Given a fixture returning an invalid postcode error
    Then the adapter returns POSTCODE_INVALID and not raw carrier text

  Scenario: Carrier timeout
    Given the fixture delays 5 s
    Then getRates yields TIMEOUT after 4 s

  Scenario: Authentication failure
    Given the fixture returns 401
    Then the adapter returns AUTH_FAILED and no secret appears in logs

  Scenario: Credentials absent
    Given no DHL secret reference
    Then the adapter is NOT_CONFIGURED and getRates is not attempted

  Scenario: Permission path
    Given an anonymous guest triggers rate shopping under quote:create
    Then the DHL adapter is called with the platform account, never a user credential
    # Permission path otherwise not applicable — adapter has no principal

  Scenario: Audit of booking-time call
    Given a booking job calls createShipment on DHL
    Then one audit entry CREATE on entity carrier_call exists with carrier DHL_EXPRESS, operation, outcome and correlation ID and no payload

  @live-sandbox
  Scenario: Live sandbox label (COND-SANDBOX-DEMO)
    Given CARRIER_LIVE_SANDBOX=1 and sandbox credentials are supplied
    When the contract suite runs against the DHL sandbox
    Then a real sandbox label is returned
```

### US-132 — FedEx REST adapter
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-125, US-127, US-129, US-130
- **Linked REQs:** REQ-CARR-013
- **As a** guest shipper **I want** FedEx prices and bookings **so that** I can compare and ship with FedEx.
- **Notes:** OAuth 2.0 client credentials against `https://apis-sandbox.fedex.com`. REST only; legacy SOAP must not be used. Fixture-backed; COND-SANDBOX-DEMO for live proof.

#### Acceptance criteria
```gherkin
Feature: FedEx adapter
  Scenario: Rates from fixtures
    Given the FedEx fixtures and a cached OAuth token
    When getRates is called for US 10001 to IN 400001, 2 kg
    Then at least 3 FedEx services are returned with canonical codes
    And requests target https://apis-sandbox.fedex.com

  Scenario: Full required-operation set
    When create, cancel, pickup schedule/cancel and track run against fixtures
    Then the shared contract suite passes unchanged

  Scenario: No SOAP
    When the adapter source and fixtures are scanned for SOAP endpoints or WSDL references
    Then none are found

  Scenario: Token expiry mid-call
    Given a fixture 401 followed by success on a fresh token
    Then the call succeeds after one token refresh

  Scenario: Carrier refuses cancellation
    Given a fixture where cancel is refused
    Then the adapter returns CANNOT_VOID

  Scenario: Rate-limited by carrier
    Given a fixture 429
    Then the adapter returns RATE_LIMITED and the call is retried at most 2 times for getRates

  Scenario: Permission path
    Given an anonymous guest triggers rate shopping under quote:create
    Then the platform account credentials are used, never exposed in the response
    # Otherwise not applicable — adapter has no principal

  Scenario: Audit of booking-time call
    Given a cancellation job calls cancelShipment on FedEx
    Then one audit entry UPDATE on carrier_call exists with carrier FEDEX, operation, outcome and correlation ID and no payload

  @live-sandbox
  Scenario: Live sandbox label (COND-SANDBOX-DEMO)
    Given CARRIER_LIVE_SANDBOX=1 and FedEx sandbox credentials
    Then the contract suite returns a real sandbox label
```

### US-133 — UPS REST adapter
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-125, US-127, US-129, US-130
- **Linked REQs:** REQ-CARR-014
- **As a** guest shipper **I want** UPS prices and bookings **so that** I can compare and ship with UPS.
- **Notes:** OAuth 2.0 client credentials against `https://wwwcie.ups.com`. Version path segments read from current official docs at implementation time. Legacy XML services must not be used. COND-SANDBOX-DEMO.

#### Acceptance criteria
```gherkin
Feature: UPS adapter
  Scenario: Rates from fixtures
    When getRates is called for US 10001 to IN 400001, 2 kg against UPS fixtures
    Then at least 3 UPS services are returned with canonical codes
    And requests target https://wwwcie.ups.com

  Scenario: Full required-operation set
    When create, cancel, pickup schedule/cancel and track run against fixtures
    Then the shared contract suite passes unchanged

  Scenario: No legacy XML
    When the adapter source and fixtures are scanned for XML service endpoints
    Then none are found

  Scenario: Unknown tracking number
    Given a fixture reporting no tracking information
    Then track returns the unknown-number outcome and not an exception

  Scenario: Invalid address
    Given a fixture returning an address error
    Then the adapter returns INVALID_ADDRESS

  Scenario: Permission path
    Given an anonymous guest triggers rate shopping under quote:create
    Then the UPS call uses the platform account only
    # Otherwise not applicable — adapter has no principal

  Scenario: Audit of booking-time call
    Given a booking job calls createShipment on UPS
    Then one audit entry CREATE on carrier_call exists with carrier UPS and no payload

  @live-sandbox
  Scenario: Live sandbox label (COND-SANDBOX-DEMO)
    Given CARRIER_LIVE_SANDBOX=1 and UPS sandbox credentials
    Then the contract suite returns a real sandbox label
```

### US-134 — Rate response cache
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-126, EPIC-01
- **Linked REQs:** REQ-CARR-010
- **As a** guest shipper **I want** repeated identical searches answered instantly **so that** I get fast prices without every customer's discount leaking to another.
- **Notes:** Redis, TTL `RATE_CACHE_TTL_SECONDS=300`, key per DR-B15 (origin, destination, packages in grams and millimetres, content type, residential flag, ship date, carrier account set, Mock scenario). Only carrier cost is cached; pricing applied afterwards.

#### Acceptance criteria
Permission path: not applicable — internal cache with no principal; second negative scenario included.
```gherkin
Feature: Rate cache
  Scenario: Identical request is served from cache
    Given an identical request was fully answered 100 s ago
    When it is repeated
    Then no carrier call is made, results carry cached=true and a log entry records the hit

  Scenario: Expiry after 300 s
    When the request is repeated at 301 s
    Then carriers are called again and cached=false

  Scenario: Metric and imperial entry share a key
    Given the same physical package entered as 2 kg 30x20x10 cm and as 4.4 lb 11.8x7.9x3.9 in
    Then both normalise to the same grams and millimetres and the same key

  Scenario: Customer discounts are not shared
    Given customer A with a discount and customer B without request the same lane
    When both are served, one from cache
    Then each sees prices computed from the cached carrier cost with their own discount

  Scenario: Partial or failed responses are not cached
    Given one carrier timed out
    Then the response is not stored and the next identical request calls carriers again

  Scenario: Different Mock scenario means different key
    Given the same request with "latency=100" and without
    Then they use different keys
```

### US-135 — Streaming rate results (SSE) with fallback GET
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-126, US-134, EPIC-16
- **Linked REQs:** REQ-CARR-009
- **As a** guest shipper **I want** prices to appear as each carrier answers **so that** I never wait for the slowest carrier.
- **Notes:** Event types `carrier_result` (priced options), `carrier_error` (carrier code and canonical code, no raw text) and `complete` (counts per status and elapsed ms). Each event has a monotonically increasing `id`. Stream closes after `complete` or at 6 s. Resume from `Last-Event-ID` not required; fallback GET returns what has completed. Guest authorised by quote token (REQ-API-017). Fan-out happens exactly once, at `POST /quotes` (US-126); the stream and the GET only replay stored results. Concurrent open streams are capped at 2 per IP (anonymous) and 5 per user (DR-A22, NFR-SEC-005, D-048; NFR-RES-007).

#### Acceptance criteria
```gherkin
Feature: Rate stream
  Scenario: Events arrive per carrier then complete
    Given a quote created with MOCK and three fixture adapters
    When the client opens the stream
    Then the response has Content-Type text/event-stream, Cache-Control no-cache and X-Accel-Buffering no
    And one carrier_result event arrives per answering carrier with increasing ids
    And a complete event reports counts per status and elapsed milliseconds
    And the stream then closes

  Scenario: Slow carrier yields carrier_error
    Given MOCK with "latency=6000"
    Then a carrier_error event with carrier MOCK and code TIMEOUT arrives by 5 s
    And complete arrives by 5 s and the stream is closed by 6 s

  Scenario: Events contain no raw carrier text or personal data
    Then no event data field includes raw carrier messages, names or street lines

  Scenario: Fallback GET returns what has completed
    Given SSE is blocked
    When the client calls GET on the same quote
    Then the response lists completed carrier results and the status of pending carriers
    And a later GET returns the final set

  Scenario: Heartbeat
    Given a carrier that answers after 4 s
    Then a comment heartbeat is emitted at least every 15 s

  Scenario: Wrong guest token
    When the stream is opened with a token that does not match the quote
    Then the response is 404 with code NOT_FOUND

  Scenario: Cross-tenant stream
    Given a claimed quote of organisation A
    When a user of organisation B opens the stream
    Then the response is 404 with code NOT_FOUND

  Scenario: Role without quote:read on a claimed quote
    Given a signed-in user whose role lacks quote:read
    Then the response is 403 with code AUTHZ_DENIED

  Scenario: Audit of the quote created by the stream request
    When the quote is created for the stream
    Then one audit entry CREATE on entity quote exists in the same transaction

  Scenario: Opening, reopening and resuming a stream makes no carrier calls
    Given a quote created by POST /quotes whose fan-out made one call per enabled Mock carrier account
    And the Mock call counter is read after the POST
    When the stream is opened, then reopened 10 times, including 5 reopenings that send a Last-Event-ID header
    Then the Mock call counter is unchanged (0 extra carrier calls)
    And each reopening replays the stored results and the complete event only

  Scenario: Third concurrent stream from one anonymous IP is refused
    Given two streams are open from one anonymous IP
    When the same IP opens a third concurrent stream
    Then the response is 429 application/problem+json with code RATE_LIMITED and a Retry-After header
    And the two open streams are unaffected

  Scenario: Sixth concurrent stream for one authenticated user is refused
    Given five streams are open for one authenticated user
    When that user opens a sixth concurrent stream
    Then the response is 429 application/problem+json with code RATE_LIMITED
    And closing one stream allows the next open to succeed
```

### US-136 — Redacted raw payload retention
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-131, EPIC-01
- **Linked REQs:** REQ-CARR-018
- **As a** compliance auditor **I want** raw carrier request and response stored with personal data and credentials redacted **so that** disputes can be investigated without holding personal data.
- **Notes:** Stored for `createShipment`, `cancelShipment`, `schedulePickup`, `cancelPickup`, in object storage and linked to the shipment; raw tracking-event payload stored with the event. Object path never exposed to customers; staff access is M2. Rate payloads retained only on failure (Could, sampled). Redaction tests use synthetic data only. Redaction by field name plus blob replacement plus allow-list for tracking and response payloads (REQ-CARR-018, D-052, SEC-P3-13, SEC-TC-52).

#### Acceptance criteria
```gherkin
Feature: Raw payload retention
  Scenario: Booking payloads stored and redacted
    Given a createShipment call with sender "Test Sender", street "1 Fake St", phone "+15550100", email "a@example.test" and tax id "TAX-000"
    When the call completes
    Then request and response objects exist in object storage linked to the shipment
    And name, street lines, phone, email and tax/ID references are replaced by redaction markers
    And no credential or token appears in either object

  Scenario: Cancel and pickup calls are stored
    When cancelShipment, schedulePickup and cancelPickup run
    Then each stores one request and one response object

  Scenario: Tracking event payload stored with the event
    Given a tracking event is ingested
    Then its raw payload is stored with that event id

  Scenario: Redaction failure blocks storage
    Given the redactor throws on an unexpected field type
    Then nothing is stored unredacted and the failure is logged without payload

  Scenario: Customers cannot read raw objects
    Given a customer-role user requests the raw payload of their own shipment
    Then the response is 403 with code AUTHZ_DENIED and the object path is never in any customer API response

  Scenario: Cross-tenant
    Given a user of organisation B requests a raw payload of organisation A's shipment
    Then the response is 404 with code NOT_FOUND

  Scenario: Customs truncation marker
    Given a customs description longer than the carrier maximum
    Then the raw record marks the truncation while the Platform record keeps the full text

  Scenario: Base64 documents are replaced by a blob reference
    Given a createShipment request or response containing a base64 label, invoice or PDF field of 200 kB
    When the payload is stored
    Then the stored object has that field replaced by {"$blob": {"sha256", "size", "media_type", "document_id"?}}
    And size equals the decoded byte length, sha256 equals the digest of the decoded bytes and media_type is "application/pdf"
    And document_id is present when the document was persisted as a Platform document

  Scenario: Property test finds no sentinel text or long base64 run in any stored object
    Given a generated PDF containing the sentinel text "SENTINEL-NAME-9F3A" embedded as a base64 field in synthetic createShipment payloads
    When 100 generated payloads are stored through the redactor
    Then no stored object contains the sentinel text, in plain form or after base64 decoding of any field
    And no stored object contains a base64 run longer than 1 kB

  Scenario: Tracking and response payloads are allow-list redacted
    Given a tracking response with canonical code "DELIVERED", an ISO timestamp, carrier reference "TRK-000123", city "Mumbai", country "IN", "signed by" name "Test Receiver" and a free-text note
    When the payload is stored with the tracking event and a createShipment response is stored
    Then canonical codes, timestamps, carrier references, city and country are kept
    And the "signed by" name and the free text are replaced by "[REDACTED]"
    And every other field outside the allow-list is "[REDACTED]"
```

### US-137 — Fixture hygiene, adapter README docs-check and live-sandbox opt-in
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-125, US-131, US-132, US-133
- **Linked REQs:** REQ-CARR-019, REQ-CARR-020
- **As a** developer **I want** clean, labelled fixtures, adapter READMEs recording the docs version checked, and a single opt-in switch for live sandbox runs **so that** CI is safe by default and the post-release sandbox demo is one command.
- **Notes:** README fields: docs URL (with the commit SHA of the pinned specification), API version, date checked, sandbox quirks, "PII and redaction" subsection, and `Diffed against official spec by a person: yes (date, role) | no` (D-ARCH-057 item 1.4). `no` is allowed in this run and listed under COND-SANDBOX-DEMO; the evidence report counts synthesised fixtures per adapter. Synthesised fixtures labelled as such. Live suite only with `CARRIER_LIVE_SANDBOX=1` (COND-SANDBOX-DEMO); nightly schedule only when credentials exist.

#### Acceptance criteria
Permission path: not applicable — repository tooling with no principal; second negative scenario included.
```gherkin
Feature: Fixtures, README and live-sandbox opt-in
  Scenario: Fixtures pass the shared suite
    When the contract suite runs for DHL, FedEx and UPS fixtures
    Then all cases pass

  Scenario: Fixtures contain no secrets or real personal data
    When the secret scanner runs on all fixture files
    Then it reports zero findings

  Scenario: Fixture with a secret fails CI
    Given a fixture containing a bearer token pattern
    Then the scanner job fails naming the file

  Scenario: README records documentation provenance
    When each adapter README is parsed
    Then it contains docs URL with a specification commit SHA, API version, date checked, sandbox quirks, a "PII and redaction" subsection and the line "Diffed against official spec by a person"
    And the line's value is "yes (date, role)" or "no"
    And synthesised fixtures are labelled "synthesised"

  Scenario: README missing a field fails the docs check
    Given a README without "date checked" or without the "Diffed against official spec by a person" line
    Then the docs-check job fails naming the file and the field

  Scenario: Live suite is skipped by default
    Given CARRIER_LIVE_SANDBOX is unset
    When the live suites are invoked
    Then every test is reported "skipped: no live sandbox" and the job passes

  @live-sandbox
  Scenario: Live sandbox runs when opted in (COND-SANDBOX-DEMO)
    Given CARRIER_LIVE_SANDBOX=1 and credentials for DHL, FedEx and UPS
    When the single documented command is executed
    Then one label is booked with each carrier

  Scenario: Not yet diffed by a person is allowed but reported
    Given an adapter README with "Diffed against official spec by a person: no"
    When the docs check and the evidence report run
    Then the docs check passes
    And the evidence report lists that adapter under COND-SANDBOX-DEMO with its count of synthesised fixtures
```

### US-293 — Anonymous rate-shopping budget and daily carrier quota guard
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-126, US-130, US-134, EPIC-16
- **Linked REQs:** REQ-CARR-022, REQ-CARR-023
- **Linked NFRs (optional):** NFR-RES-007
- **As an** operator protecting paid bookings and the sandbox carrier accounts, and as a guest shipper, **I want** anonymous rate shopping bounded by a global per-account budget and a daily quota guard **so that** a distributed guest flood can neither starve paid bookings nor get a carrier account suspended, while guests still get cached results and the other carriers' prices.
- **Notes:** Admission control inside the carrier layer; there is no principal-facing route. Defaults are configuration (A-094, A-099, D-048, D-053): `CARRIER_ANON_CALLS_PER_MIN=120` per account (Redis token bucket shared by all API replicas), anonymous callers hold at most 3 of the 6 `rates` slots, `CARRIER_DAILY_QUOTA` per account (`0` disables the guard, the Mock default; seed 500 for the DHL sandbox), `CARRIER_QUOTA_RESERVE_PCT=40`, `CARRIER_QUOTA_ORG_SHARE_PCT=10`. An anonymous caller is a guest **or a signed-in user in `PENDING_VERIFICATION`** (SEC-P3-29, D-053); the class is decided per request from the user status. Each organisation's `rates`-pool calls to an account are capped at 10 % of that account's daily quota (off when the quota is `0`; never applies to transactional calls); beyond it the organisation gets `CARRIER_BUSY` or cached results and `carrier_quota_org_share_exhausted` fires at most once per organisation per account per minute. The `quote-create` rate class (30/min + 300/h per user, 1,000/h per organisation) on authenticated `POST /quotes` is enforced by the limiter of US-040, not here. A refusal is a local admission rejection (`LOCAL_REJECT`: `CARRIER_BUSY`, no network call) with the REQ-BOOK-023 saga semantics (US-205). Security events `carrier_anon_budget_exhausted`, `carrier_quota_pressure` and `carrier_quota_org_share_exhausted` per REQ-SEC-012. Audit: not required (no entity mutation; the state is a Redis counter and metrics). Not demo-critical. Tests: SEC-TC-40 (k6 flood), SEC-TC-41 (day counter), SEC-TC-62 (unverified-as-anonymous, `quote-create`, organisation share).

#### Acceptance criteria
Permission path: not applicable — admission control inside the carrier layer, no principal-facing route
```gherkin
Feature: Anonymous rate-shopping budget and daily carrier quota guard
  Background:
    Given the Mock carrier with CARRIER_ANON_CALLS_PER_MIN=120 and a rates pool of 6 for account acct-mock
    And the other carrier accounts answer normally

  Scenario: Guest flood does not starve paid bookings
    Given 50 source IPs each send guest quotes at the per-IP limit of 20 per minute with Mock "latency=3000"
    When 20 authenticated orders are booked concurrently during the flood
    Then all 20 orders reach BOOKED within the 30-minute saga deadline
    And no saga step ends with the shipment in DRAFT or EXCEPTION
    And guests beyond the budget receive carrier_error {code: CARRIER_BUSY} for that carrier, or cached results, within the 5000 ms deadline
    And the other carriers still answer those guest quotes
    And the partial-results UI shows the busy carrier's inline notice and the banner "some carriers did not respond"

  Scenario: Token bucket is shared across API replicas
    Given two API replicas share one Redis
    When replica 1 and replica 2 each receive 100 anonymous rate calls for acct-mock within one minute
    Then at most 120 anonymous carrier calls reach acct-mock in that minute in total
    And the remaining anonymous calls receive carrier_error {code: CARRIER_BUSY} or cached results

  Scenario: Anonymous callers hold at most half of the rates slots
    Given 3 anonymous getRates calls are in flight for acct-mock
    When a 4th anonymous getRates call arrives
    Then it is answered with carrier_error {code: CARRIER_BUSY} immediately without a carrier call
    And an authenticated getRates call is still admitted into the remaining 3 slots

  Scenario: Exhaustion raises one security event per minute and a reject counter
    Given the anonymous bucket for acct-mock is exhausted
    When 500 further anonymous calls are rejected within one minute
    Then exactly one security event carrier_anon_budget_exhausted is logged for acct-mock in that minute
    And the reject counter labelled caller_class=anonymous increases by 500

  Scenario: Verified users' quotes are unaffected by the anonymous budget
    Given the anonymous bucket and the anonymous slots for acct-mock are exhausted
    When a signed-in user whose e-mail is verified requests a quote
    Then acct-mock is called and returns status OK
    And no CARRIER_BUSY is produced for that user

  Scenario: An unverified signed-in user is an anonymous caller for the carrier budget
    Given the anonymous bucket for acct-mock is exhausted
    And a signed-in user whose status is PENDING_VERIFICATION
    When that user requests a quote
    Then acct-mock is answered with carrier_error {code: CARRIER_BUSY} or cached results without a carrier call, exactly like a guest
    And the reject counter labelled caller_class=anonymous increases
    When the user verifies their e-mail and requests a quote with the same session
    Then the quote is counted as verified and acct-mock is called

  Scenario: One organisation cannot use more than its share of an account's daily quota
    Given CARRIER_DAILY_QUOTA=500 and CARRIER_QUOTA_ORG_SHARE_PCT=10 for acct-dhl
    And verified users of organisation A have caused 50 rates calls to acct-dhl today while the account counter is 120 (24 percent)
    When a user of organisation A requests a quote
    Then acct-dhl is answered with carrier_error {code: CARRIER_BUSY} or cached results for organisation A without a carrier call
    And one security event carrier_quota_org_share_exhausted for organisation A and acct-dhl is emitted, and at most one per minute however many further calls are refused
    And a quote by a user of organisation B still calls acct-dhl and returns OK
    And a createShipment, cancelShipment, schedulePickup and track by organisation A on acct-dhl are still admitted

  Scenario: The organisation share resets with the day counter and is off when the guard is off
    Given organisation A exhausted its share of acct-dhl at 23:59:59 UTC
    When the fake clock passes 00:00:00 UTC
    Then a quote by organisation A calls acct-dhl again
    Given CARRIER_DAILY_QUOTA=0 for acct-mock
    When organisation A causes 1000 rates calls to acct-mock in a day
    Then no organisation-share refusal and no carrier_quota_org_share_exhausted event occurs

  Scenario: Anonymous fan-out stops at 60 percent of the daily quota
    Given a fake clock at 10:00 UTC, CARRIER_DAILY_QUOTA=500 and CARRIER_QUOTA_RESERVE_PCT=40
    And the day counter for acct-dhl is 299
    When an anonymous quote fans out
    Then acct-dhl is called
    When the counter reaches 300 (60 percent)
    Then the next anonymous quote receives carrier_error {code: CARRIER_BUSY} or cached results for acct-dhl without a carrier call
    And an authenticated quote still calls acct-dhl
    And a createShipment on acct-dhl is still admitted

  Scenario: Quota pressure alarms fire once at 70 and once at 90 percent
    Given the day counter for acct-dhl is 349
    When calls take it to 350 (70 percent)
    Then one security event carrier_quota_pressure with threshold 70 is emitted and the alarm metric is set
    And further calls below 450 emit no new carrier_quota_pressure event
    When the counter reaches 450 (90 percent)
    Then one carrier_quota_pressure event with threshold 90 is emitted
    And no more than 2 carrier_quota_pressure events exist for acct-dhl that day

  Scenario: Above 90 percent only transactional calls continue
    Given the day counter for acct-dhl is 451
    When an authenticated quote, a createShipment, a cancelShipment, a schedulePickup and a track call target acct-dhl
    Then the authenticated quote receives carrier_error {code: CARRIER_BUSY} for acct-dhl and the other carriers answer
    And createShipment, cancelShipment, schedulePickup and track are admitted and called

  Scenario: Guard is disabled with a quota of zero
    Given CARRIER_DAILY_QUOTA=0 for acct-mock, the Mock default
    When 1000 anonymous and authenticated calls are made in a day within the other limits
    Then no quota refusal and no carrier_quota_pressure event occurs

  Scenario: Counter resets at 00:00 UTC
    Given the day counter for acct-dhl is 460 at 23:59:59 UTC
    When the fake clock passes 00:00:00 UTC
    Then the counter is 0 and an anonymous quote calls acct-dhl again

  Scenario: Usage is exposed as a gauge
    Given the day counter for acct-dhl is 250
    When the metrics endpoint is scraped
    Then a gauge for acct-dhl reports usage 250 of 500 (50 percent)

  Scenario: Redis unavailable falls back to per-instance counting
    Given Redis is unreachable for the anonymous token bucket
    When anonymous rate calls arrive on one API instance
    Then the bucket counts per instance with the same limit of 120 per minute
    And an ERROR-level security event is logged naming the degraded limiter and no secrets
    And authenticated and transactional calls continue and 20 concurrent bookings still reach BOOKED
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-CARR-001 | US-121 |
| REQ-CARR-002 | US-121 |
| REQ-CARR-003 | US-121 |
| REQ-CARR-004 | US-122 |
| REQ-CARR-005 | US-123 |
| REQ-CARR-006 | US-123 |
| REQ-CARR-007 | US-124 |
| REQ-CARR-008 | US-126 |
| REQ-CARR-009 | US-135 |
| REQ-CARR-010 | US-134 |
| REQ-CARR-011 | US-125 |
| REQ-CARR-012 | US-131 |
| REQ-CARR-013 | US-132 |
| REQ-CARR-014 | US-133 |
| REQ-CARR-015 | US-128 |
| REQ-CARR-016 | US-129 |
| REQ-CARR-017 | US-130 |
| REQ-CARR-018 | US-136 |
| REQ-CARR-019 | US-137 |
| REQ-CARR-020 | US-137 |
| REQ-CARR-021 | US-127 |
| REQ-CARR-022 | US-293 |
| REQ-CARR-023 | US-293 |

All 22 Must REQs are linked by Must stories; REQ-CARR-020 (Should) is linked by Must story US-137, whose other REQ (REQ-CARR-019) is Must, so the story priority is not above its highest linked REQ.
