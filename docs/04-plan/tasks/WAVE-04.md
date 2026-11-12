# WAVE-04 — M1 demo-critical I: reference data and compliance packs, pricing v1, DHL/FedEx/UPS adapters, streaming results, home and results UI

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M1** · Priority band: **Must DC (+ non-DC enablers)**

Tasks: **24** (S 5 / M 19; opus 6 / sonnet 18; demo-critical 14) in **7** batches of ≤ 4 parallel tasks. Estimated effort ≈ 64.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Guest quote streams from 4 carriers (Mock + 3 fixture adapters) sorted with badges in the browser; contract suite green x4; lane B `wave` evidence; lane C `wave-end` if within the monthly cap (tier 2).

**Stories completed in this wave (24):** US-054 (DC), US-056 (DC), US-057, US-058, US-059, US-109 (DC), US-119 (DC), US-127 (DC), US-128 (DC), US-129, US-130, US-131 (DC), US-132 (DC), US-133 (DC), US-134, US-135 (DC), US-142, US-147, US-148, US-149, US-158 (DC), US-159 (DC), US-160 (DC), US-161 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 4.1 | TASK-122 Seed sample datasets<br>TASK-123 Compliance pack store, immutability and resolution<br>TASK-124 Carrier service reference data<br>TASK-125 Pre-rendered home page with quote widget | prisma-seed<br>mod-compliance<br>mod-carriers-ref<br>web-home |
| 4.2 | TASK-126 Order-number sequences per country scope and zone-table seam<br>TASK-127 Seed compliance packs<br>TASK-128 Platform carrier accounts and credential handling<br>TASK-129 Fuel surcharge and carrier surcharge pass-through | mod-orders<br>mod-compliance<br>mod-carriers-accounts<br>pkg-pricing |
| 4.3 | TASK-130 Pack-derived data<br>TASK-131 Carrier OAuth token caching<br>TASK-132 Carrier resilience<br>TASK-133 FX conversion with snapshot | mod-compliance<br>pkg-carriers-oauth<br>pkg-carriers-gateway<br>pkg-pricing-fx |
| 4.4 | TASK-134 Tax per origin-country compliance pack<br>TASK-135 DHL Express<br>TASK-136 Rate response cache<br>TASK-137 Home quote hero and sticky mobile action bar | pkg-pricing<br>carrier-dhl<br>mod-quotes-rateshop<br>web-home |
| 4.5 | TASK-138 Immutable charge lines and price explanation<br>TASK-139 FedEx REST adapter, fixture-backed<br>TASK-140 UPS REST adapter, fixture-backed<br>TASK-141 Streaming rate results | pkg-pricing<br>carrier-fedex<br>carrier-ups<br>mod-quotes |
| 4.6 | TASK-142 Progressive results with static skeletons and partial-results notice<br>TASK-143 Country-driven address layout<br>TASK-144 Result option card and itemised price breakdown | web-quote-results<br>ui-address<br>web-quote-card |
| 4.7 | TASK-145 Sort by cheapest, fastest and best value with Cheapest/Fastest badges | web-quote-results |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

## Task specifications

### TASK-122 — Seed sample datasets: holidays, transit days, HS sample list, reasons for export, Incoterms

| Field | Value |
|---|---|
| Stories (completes) | US-054 **DC** (M1 Must) Seed sample datasets: holidays, transit days, HS list, reasons for export, Incoterms |
| REQs | REQ-DATA-008, REQ-DATA-009, REQ-DATA-010, REQ-DATA-012, REQ-DATA-013 |
| NFRs | — |
| Spikes / security / decisions | D-015 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-023, TASK-070 |
| Batch · locks | 4.1 · prisma-seed |
| Branch | `feat/TASK-122-seed-sample-datasets-holidays-transit` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/reference.prisma + migration
- prisma/seed/reference/{holidays,transit,hs-sample,reasons,incoterms}.ts
- reference endpoints for the new lists

**Acceptance tests to write**
- All US-054 scenarios (sample labelled)
- AT-US-054-01 … AT-US-054-08: all 8 scenarios of US-054, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-123 — Compliance pack store, immutability and resolution

| Field | Value |
|---|---|
| Stories (completes) | US-057 (M1 Must) Compliance pack store, immutability and resolution |
| REQs | REQ-COMP-001, REQ-COMP-002 |
| NFRs | NFR-PRIV-005 |
| Spikes / security / decisions | D-020 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-023, TASK-029 |
| Batch · locks | 4.1 · mod-compliance |
| Branch | `feat/TASK-123-compliance-pack-store-immutability-resolution` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-147 -> US-149 -> US-150/US-159 (DC).

**Files / modules**
- prisma/schema/compliance.prisma + migration (insert-only versions)
- apps/api/src/modules/compliance/{resolver.ts, repository.ts}

**Acceptance tests to write**
- All US-057 scenarios
- AT-US-057-01 … AT-US-057-12: all 12 scenarios of US-057, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-124 — Carrier service reference data (services, capabilities, label formats)

| Field | Value |
|---|---|
| Stories (completes) | US-127 **DC** (M1 Must) Carrier service reference data |
| REQs | REQ-CARR-021 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-075, TASK-023 |
| Batch · locks | 4.1 · mod-carriers-ref |
| Branch | `feat/TASK-124-carrier-service-reference-data` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/carriers.prisma + migration (carrier_services)
- prisma/seed/reference/carrier-services.ts
- apps/api/src/modules/carriers/catalogue/**

**Acceptance tests to write**
- All US-127 scenarios
- AT-US-127-01 … AT-US-127-05: all 5 scenarios of US-127, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-125 — Pre-rendered home page with quote widget (guest token in localStorage with TTL)

| Field | Value |
|---|---|
| Stories (completes) | US-158 **DC** (M1 Must) Pre-rendered home page with quote widget |
| REQs | REQ-QUOTE-023 |
| NFRs | NFR-WEB-001, NFR-WEB-005 |
| Spikes / security / decisions | SEC-P3-15, D-ARCH-012, D-026 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-068, TASK-093, TASK-058, TASK-091 |
| Batch · locks | 4.1 · web-home |
| Branch | `feat/TASK-125-pre-rendered-home-page-quote` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/routes/$lang._index.tsx
- apps/web/app/features/quote-widget/**
- apps/web/locales/*/quote.json

**Acceptance tests to write**
- All US-158 scenarios (S-W01)
- SEC-TC-54 (client part): after claim, sign-out, 404 and expiry sweep no qt: entry remains; at most 20 kept; token never in URL/history/Referer
- AT-US-158-01 … AT-US-158-08: all 8 scenarios of US-158, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Remove the walking-skeleton dev-countries route (tracked here)
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-126 — Order-number sequences per country scope and zone-table seam

| Field | Value |
|---|---|
| Stories (completes) | US-056 **DC** (M1 Must) Order-number sequences and zone table seam |
| REQs | REQ-DATA-015, REQ-DATA-017 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-088, TASK-122 |
| Batch · locks | 4.2 · mod-orders |
| Branch | `feat/TASK-126-order-number-sequences-per-country` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/orders.prisma + migration (scopes, zones, zone_countries empty)
- prisma/seed/reference/sequences.ts

**Acceptance tests to write**
- All US-056 scenarios
- AT-US-056-01 … AT-US-056-08: all 8 scenarios of US-056, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-127 — Seed compliance packs (unreviewed) with audited loading

| Field | Value |
|---|---|
| Stories (completes) | US-058 (M1 Must) Seed compliance packs with audited loading |
| REQs | REQ-COMP-003, REQ-COMP-008 |
| NFRs | NFR-AUDIT-006 |
| Spikes / security / decisions | D-020 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-123, TASK-029 |
| Batch · locks | 4.2 · mod-compliance |
| Branch | `feat/TASK-127-seed-compliance-packs-audited-loading` |
| Priority | Must |

**Files / modules**
- prisma/seed/reference/compliance-packs/** (US, IN, launch set)

**Acceptance tests to write**
- All US-058 scenarios (CONFIG_CHANGE audit per load)
- AT-US-058-01 … AT-US-058-07: all 7 scenarios of US-058, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-128 — Platform carrier accounts and credential handling (secret references, key_id)

| Field | Value |
|---|---|
| Stories (completes) | US-128 **DC** (M1 Must) Platform carrier accounts and credential handling |
| REQs | REQ-CARR-015 |
| NFRs | NFR-SEC-002 |
| Spikes / security / decisions | SEC-P3-08, D-012 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-075, TASK-005, TASK-113 |
| Batch · locks | 4.2 · mod-carriers-accounts |
| Branch | `feat/TASK-128-platform-carrier-accounts-credential-handling` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/carriers.prisma (carrier_accounts) + migration
- apps/api/src/modules/carriers/accounts/**

**Acceptance tests to write**
- All US-128 scenarios
- SEC-TC-49 (vault part): ciphertext columns carry key_id; retired key decrypts, new writes use current; AAD swap fails
- AT-US-128-01 … AT-US-128-07: all 7 scenarios of US-128, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-129 — Fuel surcharge and carrier surcharge pass-through

| Field | Value |
|---|---|
| Stories (completes) | US-142 (M1 Must) Fuel surcharge and carrier surcharge pass-through |
| REQs | REQ-PRICE-006, REQ-PRICE-007 |
| NFRs | NFR-DATA-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-080 |
| Batch · locks | 4.2 · pkg-pricing |
| Branch | `feat/TASK-129-fuel-surcharge-carrier-surcharge-pass` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-149 (-> DC US-150, US-159).

**Files / modules**
- packages/pricing/src/lines/{fuel.ts, surcharges.ts}

**Acceptance tests to write**
- All US-142 scenarios
- AT-US-142-01 … AT-US-142-07: all 7 scenarios of US-142, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-130 — Pack-derived data: unreviewed flag, tax rule and de-minimis

| Field | Value |
|---|---|
| Stories (completes) | US-059 (M1 Must) Pack-derived data: unreviewed flag, tax rule and de-minimis |
| REQs | REQ-COMP-004, REQ-COMP-005, REQ-COMP-006 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-127 |
| Batch · locks | 4.3 · mod-compliance |
| Branch | `feat/TASK-130-pack-derived-data-unreviewed-flag` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-147.

**Files / modules**
- apps/api/src/modules/compliance/derived/**
- packages/ui/src/components/UnreviewedBadge/**

**Acceptance tests to write**
- All US-059 scenarios
- AT-US-059-01 … AT-US-059-07: all 7 scenarios of US-059, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-131 — Carrier OAuth token caching (encrypted in Valkey until expiry - 60 s)

| Field | Value |
|---|---|
| Stories (completes) | US-129 (M1 Must) OAuth token caching |
| REQs | REQ-CARR-016 |
| NFRs | NFR-RES-001 |
| Spikes / security / decisions | SEC-P3-08, PR6-SEC-05, PR6-SEC-07, PR6-SEC-11, PR6-SEC-12, D-ARCH-067 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-128 |
| Batch · locks | 4.3 · pkg-carriers-oauth |
| Branch | `feat/TASK-131-carrier-oauth-token-caching` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-132/US-133 (DC).

**Files / modules**
- packages/carriers/src/auth/token-cache.ts
- packages/carriers/src/auth/token-endpoint-policy.ts (TokenEndpointPolicy { on403: carrier-cooldown | account-negative-cache }; applied from each adapter static TOKEN_ENDPOINT_POLICY)
- packages/config/src/schema.ts (+ .env.example): CARRIER_TOKEN_REFRESH_SKEW_S (60), CARRIER_TOKEN_TTL_MAX_S (3600), CARRIER_TOKEN_FAIL_TTL_S (60), CARRIER_TOKEN_BLOCKED_TTL_S (600), CARRIER_TOKEN_PENALTY_COOLDOWN_S (600), CARRIER_TOKEN_REQUESTS_PER_S (per carrier)

**Acceptance tests to write**
- All US-129 scenarios
- SEC-TC-50: Redis SCAN after OAuth contract tests finds no plaintext token pattern
- ADR-0010 am. 11 item 5 (D-ARCH-057): no hard-coded token lifetime — ttl = clamp(expires_in - CARRIER_TOKEN_REFRESH_SKEW_S, 0, CARRIER_TOKEN_TTL_MAX_S); `expires_in` parsed STRICTLY (`/^\d{1,6}$/`, so the UPS numeric string is accepted and anything else is not); a missing, non-numeric or <= skew `expires_in` makes the token uncacheable (one-shot use, metric carrier_token_uncacheable_total{account}, one warning per account per hour); no Redis key is ever written without a TTL; single in-flight refresh per account; fixtures token-expires-in-missing, token-expires-in-non-numeric, token-expires-in-below-skew (PR6-SEC-07)
- ADR-0010 am. 11 item 5 (a)-(b) token-endpoint failures (PR6-SEC-05, PR6-SEC-12 g; with TASK-132): negative cache `carrier:tokenfail:<account_id>` on 400/401 (CARRIER_TOKEN_FAIL_TTL_S = 60) → fail fast with the canonical AUTH_FAILED (DR-B30; the code REQ-CARR-016 names) and ops event carrier_token_auth_failed, counts toward the account breaker; global token-request bucket per carrier and egress shared across replicas (FedEx 1/s burst 3; CARRIER_TOKEN_REQUESTS_PER_S per carrier); token requests and responses are excluded from all body logging and raw-payload capture
- ADR-0010 am. 11 item 5 (c) as revised 2026-11-12 (PR6-SEC-11; D-ARCH-067): a token-endpoint 403 is handled by the adapter static TOKEN_ENDPOINT_POLICY, never by the status code alone — FedEx `carrier-cooldown`: carrier-wide cool-down CARRIER_TOKEN_PENALTY_COOLDOWN_S = 600 for all FedEx accounts on this egress, fail fast CARRIER_UNAVAILABLE, no retries, one probe after, event carrier_token_penalty; UPS `account-negative-cache`: 403 = Blocked Merchant, so only that account is negative-cached for CARRIER_TOKEN_BLOCKED_TTL_S = 600 (fail fast AUTH_FAILED), its breaker opens and an ops event fires while other UPS accounts keep working and no carrier-wide key is written; DHL has no token endpoint; a 403 is never read as "token expired, refresh"
- SEC-TC-68 (nock + fake clock): 200 concurrent getRates across three accounts with one failing account issue <= 13 token requests in 10 s; FedEx: one 403 → zero token requests during the cool-down, one probe after; UPS: a 403 on account A leaves accounts B and C obtaining tokens and rates inside the 600 s window, A fails fast with AUTH_FAILED, and no carrier-wide cool-down key exists
- AT-US-129-01 … AT-US-129-10: all 10 scenarios of US-129, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-132 — Carrier resilience: timeouts, idempotent-only retries, breaker, rates + transactional bulkheads

| Field | Value |
|---|---|
| Stories (completes) | US-130 (M1 Must) Resilience: timeouts, retries, circuit breaker and bulkhead |
| REQs | REQ-CARR-017 |
| NFRs | NFR-RES-001, NFR-RES-002, NFR-RES-003, NFR-RES-007 |
| Spikes / security / decisions | SEC-P3-02, SEC-COND-02, D-048, PR6-SEC-04, PR6-SEC-05, PR6-SEC-11, SEC-TC-67, D-ARCH-068 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-075, TASK-113 |
| Batch · locks | 4.3 · pkg-carriers-gateway |
| Branch | `feat/TASK-132-carrier-resilience-timeouts-idempotent-only` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-131..133 (DC).

**Files / modules**
- packages/carriers/src/gateway/{carrier-gateway.ts, bulkhead.ts, breaker.ts, retry.ts}
- packages/carriers/src/http/carrier-url.ts (carrierPath tagged template + carrierUrl; per-carrier identifier allow-patterns)

**Acceptance tests to write**
- All US-130 scenarios
- SEC-TC-26: separate transactional pool; saga succeeds during a rates flood
- PR6-SEC-04 / ADR-0010 am. 11 item 8 (D-ARCH-068): `carrierPath` validates every interpolated value against the carrier identifier allow-pattern (default `^[A-Za-z0-9]{1,35}$`; adapters tighten, e.g. UPS `^1Z[0-9A-Z]{16}$`) and throws INVALID_CARRIER_IDENTIFIER with zero network I/O; `carrierUrl(base, path, query)` builds from the adapter EGRESS base, sets query parameters only through URLSearchParams and throws URL_ESCAPE if the result leaves the base origin or prefix; adapters never string-concatenate paths, comma lists or query strings; batch tracking validates each element, joins validated elements only and maps the response BY REQUESTED tracking number, dropping unrequested ones
- SEC-TC-67 (fast-check property): arbitrary strings incl. `..`, `../..`, `%2e%2e`, `/`, `,`, `&`, `?`, `#`, CR/LF and Unicode used as tracking number, dispatch number, city or postcode are either rejected with CarrierInputError and zero nock requests, or yield a URL whose origin and prefix equal the base with exactly the expected segment count and exactly one accountNumber parameter; a batch input containing `,` is rejected; a response containing an unrequested number is not returned
- PR6-SEC-05 / PR6-SEC-11 (ADR-0010 am. 11 item 5, with TASK-131): the gateway consults the token negative cache and the carrier cool-down BEFORE any token or API request and fails fast (AUTH_FAILED for a negative-cached account, CARRIER_UNAVAILABLE for a cooled-down carrier), both counting toward the account breaker; a token-endpoint 403 under `account-negative-cache` opens only that account breaker
- AT-US-130-01 … AT-US-130-12: all 12 scenarios of US-130, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-133 — FX conversion with snapshot

| Field | Value |
|---|---|
| Stories (completes) | US-148 (M1 Must) FX conversion with snapshot |
| REQs | REQ-PRICE-015 |
| NFRs | NFR-DATA-001 |
| Spikes / security / decisions | D-019 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-076, TASK-066 |
| Batch · locks | 4.3 · pkg-pricing-fx |
| Branch | `feat/TASK-133-fx-conversion-snapshot` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-149.

**Files / modules**
- packages/pricing/src/fx/**

**Acceptance tests to write**
- All US-148 scenarios
- AT-US-148-01 … AT-US-148-06: all 6 scenarios of US-148, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-134 — Tax per origin-country compliance pack

| Field | Value |
|---|---|
| Stories (completes) | US-147 (M1 Must) Tax per origin-country compliance pack |
| REQs | REQ-PRICE-014 |
| NFRs | NFR-DATA-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-129, TASK-130 |
| Batch · locks | 4.4 · pkg-pricing |
| Branch | `feat/TASK-134-tax-per-origin-country-compliance` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-149.

**Files / modules**
- packages/pricing/src/lines/tax.ts

**Acceptance tests to write**
- All US-147 scenarios
- AT-US-147-01 … AT-US-147-07: all 7 scenarios of US-147, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-135 — DHL Express (MyDHL) adapter, fixture-backed

| Field | Value |
|---|---|
| Stories (completes) | US-131 **DC** (M1 Must) DHL Express (MyDHL) adapter |
| REQs | REQ-CARR-012 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | SPK-02, COND-SANDBOX-DEMO, PR6-SEC-02, PR6-SEC-03, PR6-SEC-04, PR6-SEC-06, D-ARCH-068 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-101, TASK-124, TASK-128, TASK-132, TASK-009 |
| Batch · locks | 4.4 · carrier-dhl |
| Branch | `feat/TASK-135-dhl-express-adapter-fixture-backed` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/carriers/src/adapters/dhl-express/** (incl. sensitive-fields.ts, EGRESS, README)
- packages/carriers/test/fixtures/dhl-express/**

**Acceptance tests to write**
- All US-131 scenarios; shared contract suite green; @live-sandbox variant tagged
- ADR-0010 am. 11 (SPK-02, D-ARCH-057): `capabilities().operations.cancelShipment = false`; `cancelShipment` returns CAPABILITY_NOT_SUPPORTED with no network I/O (contract case `cancel-capability-not-supported-no-io`); EGRESS rules = exact origin https://express.api.dhl.com with prefix /mydhlapi/test/ (sandbox) vs /mydhlapi/ (production) and a unit test that a sandbox context never emits a request outside /mydhlapi/test/; both tracking forms (single with GMT offsets, batch <= 200); `operations.recoverLabel = false`; fixtures flagged `"_fixture": "synthesised"`; README keeps the "Diffed against official spec by a person" line (no until a human diffs) and gains the "PII and redaction" subsection (requestorName and /rates query parameters stripped from logged URLs); trackingUrl/cancelPickupUrl never dereferenced
- ADR-0010 am. 11 item 9 (PR #6 code review n6): after an ambiguous createShipment (timeout/5xx) the shipment is EXCEPTION per DR-B04 G2 and a reconciliation lookup by shipper reference through tracking is the operator's resolution input; fixture `create-timeout-then-tracking-reconcile`
- PR #6 code review R2-n1/R2-n4 (ADR-0010 am. 11 items 4 and 11; D-ARCH-068): the README subsection is renamed to the canonical heading "PII and redaction" (a parenthetical suffix is allowed), §3.3 and §8 cite ADR-0010 am. 11 items 2 and 9 as decided (no "Recommended" / "amendment request" wording), the §9 fixture plan lists `create-timeout-then-tracking-reconcile`, and the Docs URL row carries the specification commit SHA where the source is a repository (web sources: "not pinnable · retrieved <date>")
- PR6-SEC-02 residual fields and container redaction (security review R2.4; ADR-0010 am. 11 item 8): `sensitive-fields.ts` and the README "Sensitive fields" table (path, class PER|SPER|SECRET|ACCOUNT_ID, handling) include `contactInformation.*` incl. `mobilePhone`, `postalAddress.addressLine1..3`, `registrationNumbers[]`, `shipmentNotification[].receiverId` (an e-mail address), `customerReferences[].value` (free text), `requestorName`, the Basic `Authorization` header and the account number; the redactor removes the whole `contactInformation`, address-line and `shipmentNotification` containers; DHL and FedEx paths are marked unverified until a person diffs the spec; AC-45 sentinels cover every table path incl. an IN_PAN sentinel and the Basic auth header
- PR6-SEC-03/04/06 (ADR-0010 am. 11 items 6 and 8): every URL is built with `carrierPath`/`carrierUrl` from the static EGRESS base (no per-account free-form base URL); `requestorName` is a fixed non-personal value from BRAND_* and `reason` a fixed enum (fixture pickup-cancel-requestorname-not-personal); `trackingView = all-checkpoints` (never -with-remarks), no proof-of-delivery call, `epod-detail-esig` off; `trackingUrl`/`cancelPickupUrl` never dereferenced (negative fixture shipment-carrier-urls-not-followed with 169.254.169.254); the sandbox-never-emits-production unit test covers `/mydhlapi/test/` vs `/mydhlapi/`
- AT-US-131-01 … AT-US-131-09: all 9 scenarios of US-131, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-136 — Rate response cache (costs only, 300 s, complete successful responses)

| Field | Value |
|---|---|
| Stories (completes) | US-134 (M1 Must) Rate response cache |
| REQs | REQ-CARR-010 |
| NFRs | NFR-PERF-003 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-083, TASK-014 |
| Batch · locks | 4.4 · mod-quotes-rateshop |
| Branch | `feat/TASK-136-rate-response-cache` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-135 (DC).

**Files / modules**
- apps/api/src/modules/quotes/rate-shopper/cache.ts

**Acceptance tests to write**
- All US-134 scenarios
- AT-US-134-01 … AT-US-134-06: all 6 scenarios of US-134, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-137 — Home quote hero and sticky mobile action bar

| Field | Value |
|---|---|
| Stories (completes) | US-109 **DC** (M1 Must) Home quote hero and sticky mobile action bar |
| REQs | REQ-UI-014, REQ-UI-015 |
| NFRs | NFR-WEB-003 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-125, TASK-068 |
| Batch · locks | 4.4 · web-home |
| Branch | `feat/TASK-137-home-quote-hero-sticky-mobile` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/home-hero/**

**Acceptance tests to write**
- All US-109 scenarios
- AT-US-109-01 … AT-US-109-07: all 7 scenarios of US-109, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-138 — Immutable charge lines and price explanation

| Field | Value |
|---|---|
| Stories (completes) | US-149 (M1 Must) Immutable charge lines and explanation |
| REQs | REQ-PRICE-016 |
| NFRs | NFR-QUAL-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-134, TASK-133, TASK-129 |
| Batch · locks | 4.5 · pkg-pricing |
| Branch | `feat/TASK-138-immutable-charge-lines-price-explanation` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-150/US-159 (DC).

**Files / modules**
- packages/pricing/src/{explanation.ts, snapshot.ts}

**Acceptance tests to write**
- All US-149 scenarios
- AT-US-149-01 … AT-US-149-06: all 6 scenarios of US-149, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-139 — FedEx REST adapter, fixture-backed

| Field | Value |
|---|---|
| Stories (completes) | US-132 **DC** (M1 Must) FedEx REST adapter |
| REQs | REQ-CARR-013 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | SPK-02, COND-SANDBOX-DEMO, PR6-SEC-02, PR6-SEC-04, PR6-SEC-05, PR6-SEC-07, PR6-SEC-11, D-ARCH-067, D-ARCH-068 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-101, TASK-124, TASK-131, TASK-132, TASK-009 |
| Batch · locks | 4.5 · carrier-fedex |
| Branch | `feat/TASK-139-fedex-rest-adapter-fixture-backed` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/carriers/src/adapters/fedex/** (incl. sensitive-fields.ts, EGRESS, TOKEN_ENDPOINT_POLICY, README)
- packages/carriers/test/fixtures/fedex/**

**Acceptance tests to write**
- All US-132 scenarios; shared contract suite green
- ADR-0010 am. 11 (SPK-02, D-ARCH-057): a 200 response with a non-empty `errors[]` is treated as an error; 429 honours Retry-After (else 10 s); EGRESS rules = exact origins https://apis-sandbox.fedex.com / https://apis.fedex.com (prefix /), and the ETD origins https://documentapitest.prod.fedex.com prefix /sandbox/ / https://documentapi.prod.fedex.com only while `uploadCustomsDocuments` is declared supported and verified on an official page (no suffix matching: the sandbox host contains "prod"); `labelResponseOptions = LABEL` (inline bytes), URL_ONLY kept as a negative fixture, `ship-pdf-label-url-only` withdrawn; `operations.recoverLabel = false`; `maxTrackingNumbersPerCall = 30`; `TOKEN_ENDPOINT_POLICY = { on403: carrier-cooldown }` — the FedEx token service penalises the shared public IP, so a token-endpoint 403 sets the carrier-wide cool-down (am. 11 item 5 c as revised 2026-11-12, PR6-SEC-11, D-ARCH-067; TASK-131 implements the cache, this adapter declares the policy; fixture token-403-ip-penalty-opens-breaker); fixtures flagged `"_fixture": "synthesised"`; README keeps the "Diffed against official spec by a person" line and the canonical "PII and redaction" subsection; sources cite a commit SHA
- PR #6 code review R2-n5/R2-n6 (README accuracy): "supports `x-customer-transaction-id`, optionally, on every API method" (F5 sends it only when options.customer_transaction_id is set), the Sources table discloses that the F11a-e URLs were reconstructed by re-running the searches on 2026-11-12, the "Decided:" sentence names option (a) of SPK-02 §4 item 3, and the header Verdict row mirrors the SPK-02 header (Rate, Ship, Cancel, Track and Address-resolve paths confirmed (secondary); FALLBACK applies to Pickup/Locations paths and to all field names)
- PR6-SEC-02 residual fields and container redaction (security review R2.4; ADR-0010 am. 11 item 8): `sensitive-fields.ts` and the README table include `contact.*` incl. `personName`, `phoneExtension`, `faxNumber`, notification `emailAddress`, `address.streetLines[]`, `shipper.tins[]`, `accountNumber.value`, and the token form fields `client_secret`, `child_key`, `child_secret`, `child_id` (shapes marked unverified until a person diffs the spec); the redactor removes the whole `contact` container; no SPOD documents are requested; AC-45 sentinels include `client_secret` and `child_secret` in the form body
- PR6-SEC-04/06 (ADR-0010 am. 11 items 6 and 8): every URL is built with `carrierPath`/`carrierUrl` from the static EGRESS base; carrier-supplied label and tracking URLs are never dereferenced (negative fixture ship-label-url-only-not-followed with 169.254.169.254); the sandbox-never-emits-production unit test covers both API and ETD origins
- AT-US-132-01 … AT-US-132-09: all 9 scenarios of US-132, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-140 — UPS REST adapter, fixture-backed

| Field | Value |
|---|---|
| Stories (completes) | US-133 **DC** (M1 Must) UPS REST adapter |
| REQs | REQ-CARR-014 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | SPK-02, COND-SANDBOX-DEMO, R-ARCH-25, PR6-SEC-02, PR6-SEC-04, PR6-SEC-06, PR6-SEC-11, D-ARCH-067, D-ARCH-068 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-101, TASK-124, TASK-131, TASK-132, TASK-009 |
| Batch · locks | 4.5 · carrier-ups |
| Branch | `feat/TASK-140-ups-rest-adapter-fixture-backed` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/carriers/src/adapters/ups/** (incl. sensitive-fields.ts, EGRESS, TOKEN_ENDPOINT_POLICY, README)
- packages/carriers/test/fixtures/ups/**

**Acceptance tests to write**
- All US-133 scenarios; shared contract suite green
- ADR-0010 am. 11 item 3 (SPK-02, PR #6 code review M1, D-ARCH-057 rev 2, R-ARCH-25): createShipment requests GIF (ZPL for thermal services) and returns labels: [] for the PDF formats — the GIF survives only as a `$blob` in the raw payload and is never a document; `labelFormats = [PDF_4X6, ZPL]`; `capabilities().operations.recoverLabel = true` and `recoverLabel(ref, [PDF_4X6])` calls POST /labels/v1/recovery with LabelImageFormat.Code = PDF (official, Shipping.yaml@fd57ca9:13479-13496; unverified in CIE → fixtures synthesised, COND-SANDBOX-DEMO); no pdfkit, no raster decoding and no PDF rendering in packages/carriers
- ADR-0010 am. 11 items 1, 5, 6 and 8: void = DELETE /shipments/v2409/void/cancel/{id}; token path /security/v1/oauth/token outside /api; `expires_in` parsed from a string and never defaulted; EGRESS rules = exact origin wwwcie.ups.com / onlinetools.ups.com with prefix /api/ and the EXACT path /security/v1/oauth/token (an entry without a trailing slash is an exact match — `/security/v1/oauth/tokenX` is refused; unit test: a sandbox context never emits a production URL); `maxTrackingNumbersPerCall = 1`; LabelURL never dereferenced (inline GraphicImage only, `LabelLinksIndicator` never set; negative fixture ship-labelurl-not-followed with 169.254.169.254); README "PII and redaction" subsection (canonical heading) and the Docs URL row carries `@ fd57ca9`; sources cite a commit SHA
- ADR-0010 am. 11 item 10 / R-ARCH-25 (PR #6 code review R2-n2; D-ARCH-068): the Label Recovery schema declares `LabelImageFormat.Code` as `minLength: 4, maxLength: 4` (Shipping.yaml@fd57ca9:13499-13500) against its own three-character examples — record the quirk in README §3.4 next to the `TrackingNumbers` one and do NOT validate the recovery request Code length against the published schema; the question is settled in CIE at COND-SANDBOX-DEMO
- ADR-0010 am. 11 item 5 (c) as revised 2026-11-12 (PR6-SEC-11; D-ARCH-067): `TOKEN_ENDPOINT_POLICY = { on403: account-negative-cache }` — a UPS token-endpoint 403 is "Blocked Merchant" (one account blocked or not enabled for the product), so TASK-131 negative-caches only that account for CARRIER_TOKEN_BLOCKED_TTL_S, opens its breaker and raises an ops event while other UPS accounts keep working; fixture `token-403-blocked-merchant` carries the note "per-account negative cache; other UPS accounts keep working; no carrier-wide cool-down"; `expires_in` and `issued_at` are strings (strict parse by TASK-131)
- PR6-SEC-02 residual fields and container redaction (security review R2.4; ADR-0010 am. 11 item 8): `sensitive-fields.ts` and the README table include `AttentionName`, `Name`, `Phone.Number`, `PhoneNumber`, `FaxNumber`, `EMailAddress`, `AddressLine`, `TaxIdentificationNumber`, `ShipperNumber`, the `InternationalForms.Contacts` parties (`ForwardAgent`, `UltimateConsignee`, `IntermediateConsignee`, `Producer`) and `AlternateDeliveryAddress` with leaf-key matching on `Name`/`AttentionName`/`AddressLine`/`Phone`; the redactor removes the whole `Phone`, `FaxNumber` and `Contacts` party containers; `returnSignature` and `returnPOD` stay false; AC-45 sentinels cover every table path
- PR6-SEC-04 (ADR-0010 am. 11 item 8): every URL is built with `carrierPath`/`carrierUrl`; the UPS identifier pattern for shipment ids is `^1Z[0-9A-Z]{16}$`; `transId` is the correlation UUID without hyphens (32 hex) and `transactionSrc` comes from BRAND_*; the void `trackingnumber` query value is set through URLSearchParams, never string-built
- AT-US-133-01 … AT-US-133-08: all 8 scenarios of US-133, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-141 — Streaming rate results (SSE, subscribe-only, per-IP stream cap) with fallback GET

| Field | Value |
|---|---|
| Stories (completes) | US-135 **DC** (M1 Must) Streaming rate results (SSE) with fallback GET |
| REQs | REQ-CARR-009 |
| NFRs | NFR-PERF-002, NFR-PERF-003 |
| Spikes / security / decisions | SEC-P3-02, D-ARCH-018 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-083, TASK-136, TASK-044 |
| Batch · locks | 4.5 · mod-quotes |
| Branch | `feat/TASK-141-streaming-rate-results-fallback-get` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/quotes/stream/**

**Acceptance tests to write**
- All US-135 scenarios
- SEC-TC-42: reopening the stream 10 times (incl. Last-Event-ID) causes 0 extra carrier calls; 3rd concurrent stream from one IP -> 429
- AT-US-135-01 … AT-US-135-12: all 12 scenarios of US-135, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-142 — Progressive results with static skeletons and partial-results notice

| Field | Value |
|---|---|
| Stories (completes) | US-160 **DC** (M1 Must) Progressive results with skeletons and partial notice |
| REQs | REQ-QUOTE-008 |
| NFRs | NFR-WEB-003 |
| Spikes / security / decisions | D-UX-008, D-UX-012 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-141, TASK-125 |
| Batch · locks | 4.6 · web-quote-results |
| Branch | `feat/TASK-142-progressive-results-static-skeletons-partial` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/routes/$lang.quote.$id.tsx
- apps/web/app/features/quote-results/**

**Acceptance tests to write**
- All US-160 scenarios (focus never moves; CLS <= 0.1)
- AT-US-160-01 … AT-US-160-08: all 8 scenarios of US-160, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-143 — Country-driven address layout (AddressForm)

| Field | Value |
|---|---|
| Stories (completes) | US-119 **DC** (M1 Must) Country-driven address layout |
| REQs | REQ-I18N-005 |
| NFRs | NFR-I18N-003 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-050, TASK-122, TASK-058 |
| Batch · locks | 4.6 · ui-address |
| Branch | `feat/TASK-143-country-driven-address-layout` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/ui/src/components/AddressForm/**

**Acceptance tests to write**
- All US-119 scenarios
- AT-US-119-01 … AT-US-119-09: all 9 scenarios of US-119, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-144 — Result option card and itemised price breakdown

| Field | Value |
|---|---|
| Stories (completes) | US-159 **DC** (M1 Must) Result option card and price breakdown |
| REQs | REQ-QUOTE-007, REQ-QUOTE-012 |
| NFRs | NFR-A11Y-002 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-141, TASK-138, TASK-054 |
| Batch · locks | 4.6 · web-quote-card |
| Branch | `feat/TASK-144-result-option-card-itemised-price` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/quote-results/{OptionCard,PriceBreakdown}/**

**Acceptance tests to write**
- All US-159 scenarios
- AT-US-159-01 … AT-US-159-10: all 10 scenarios of US-159, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-145 — Sort by cheapest, fastest and best value with Cheapest/Fastest badges

| Field | Value |
|---|---|
| Stories (completes) | US-161 **DC** (M1 Must) Sort by cheapest, fastest and best value with badges |
| REQs | REQ-QUOTE-009, REQ-QUOTE-011 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-142, TASK-144 |
| Batch · locks | 4.7 · web-quote-results |
| Branch | `feat/TASK-145-sort-cheapest-fastest-best-value` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/quote-results/sort/**

**Acceptance tests to write**
- All US-161 scenarios
- AT-US-161-01 … AT-US-161-09: all 9 scenarios of US-161, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
