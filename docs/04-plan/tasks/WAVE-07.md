# WAVE-07 — M1 non-DC Must, NFR verification tasks and the M1 exit-demo journeys

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M1** · Priority band: **Must non-DC**

Tasks: **33** (S 12 / M 21; opus 8 / sonnet 25; demo-critical 0) in **9** batches of ≤ 4 parallel tasks. Estimated effort ≈ 81 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** All 218 Must stories merged; M1 demo journey green; NFR tasks evidence committed; lane C `release-candidate` run; ready for P6 (G3).

**Stories completed in this wave (33):** US-013, US-027, US-055, US-112, US-136, US-137, US-141, US-143, US-146, US-151, US-152, US-157, US-167, US-168, US-176, US-177, US-183, US-184, US-187, US-206, US-226, US-236, US-237, US-243, US-244, US-245, US-249, US-256, US-257, US-281, US-285, US-291, US-293.

> **★ CHECKPOINT G3-ready** — all Must stories merged; orchestrator hands over to P6 (qa-lead, security-analyst, performance-engineer) for G3 while Wave 8 continues.

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 7.1 | TASK-186 Sessions list and remote sign-out API<br>TASK-187 Re-authentication primitive, auth_time and age-based step-up<br>TASK-188 Redacted raw carrier payload retention<br>TASK-189 Pre-rendered public pages per locale | identity-session<br>identity-reauth<br>pkg-carriers-raw<br>web-public |
| 7.2 | TASK-190 Anonymous rate-shopping budget, daily carrier quota guard and per-organisation share<br>TASK-191 Fixture hygiene, adapter README docs-check and live-sandbox opt-in<br>TASK-192 Margin rule selection and precedence; discount stacking rule<br>TASK-193 Sessions page | mod-quotes-rateshop, pkg-carriers-gateway<br>pkg-carriers-fixtures<br>pkg-pricing<br>web-account-security, admin-sessions |
| 7.3 | TASK-194 Expired quote with one-action re-quote; rate-relevant change creates a new quote<br>TASK-195 Address validation against country rules; required tax and identity references<br>TASK-196 Prohibited and restricted items<br>TASK-197 Re-authentication prompt | mod-quotes, web-quote-results<br>mod-shipments-validation, web-wizard-step1<br>mod-compliance, mod-customs<br>fe-reauth |
| 7.4 | TASK-198 Included liability cover line<br>TASK-199 Dangerous-goods attestation, explicit screening status and carrier customs field mapping in adapters<br>TASK-200 Partial capture for multi-shipment orders<br>TASK-201 Quote widget units toggle and live billable weight | pkg-pricing<br>mod-customs, carrier-dhl, carrier-fedex, carrier-ups<br>mod-payments-core<br>web-home |
| 7.5 | TASK-202 Versioned seed-based pricing configuration<br>TASK-203 Schedule a pickup after booking; cancel pickup when a shipment is cancelled<br>TASK-204 Carrier tracking polling with adaptive intervals and stale flag<br>TASK-205 Fail-closed download audit | pkg-pricing, prisma-seed<br>mod-pickups<br>mod-tracking-poll<br>mod-documents-download |
| 7.6 | TASK-206 Pricing property-based tests<br>TASK-207 Batch track calls per carrier account with backoff and pending handling<br>TASK-208 Mock carrier tracking scenarios on an injected clock<br>TASK-209 Drafts list, resume, delete and 30-day expiry | pkg-pricing-tests<br>mod-tracking-poll<br>pkg-carriers-mock<br>mod-shipments-drafts, web-account-drafts |
| 7.7 | TASK-210 Rate-limit public tracking lookups<br>TASK-211 Tenant isolation on every account route<br>TASK-212 CI gate for template and variable parity across locales<br>TASK-213 Address only booking-organisation users | mod-tracking-public<br>tests-account-iso<br>notif-parity<br>mod-notifications |
| 7.8 | TASK-214 Observability<br>TASK-215 Terraform modules and overlays validated with Checkov<br>TASK-216 k6 M1 profiles<br>TASK-217 Web performance gates | api-metrics, worker-metrics, infra-obs<br>infra-tf<br>tests-load<br>tests-web-perf |
| 7.9 | TASK-218 M1 exit-demo journeys | e2e-demo |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

## Task specifications

### TASK-186 — Sessions list and remote sign-out API (customer and staff)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-193) | US-027 (M1 Must) Sessions list and remote sign-out (API and My sessions page) |
| REQs | REQ-AUTH-021, REQ-AUTH-022, REQ-ADMIN-007 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | D-047 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-095, TASK-067 |
| Batch · locks | 7.1 · identity-session |
| Branch | `feat/TASK-186-sessions-list-remote-sign-out` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/identity/session/list.*

**Acceptance tests to write**
- API scenarios of US-027
- Covers the scenarios of AT-US-027-01 … AT-US-027-07 that belong to its layer; US-027 closes in TASK-193

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-187 — Re-authentication primitive, auth_time and age-based step-up (X-Reauth-Proof)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-197) | US-291 (M1 Must) Re-authentication primitive, `auth_time` and age-based step-up |
| REQs | REQ-AUTH-020, REQ-AUTH-025 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-COND-01, SEC-P3-01, D-046, D-ARCH-017 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-061, TASK-055 |
| Batch · locks | 7.1 · identity-reauth |
| Branch | `feat/TASK-187-re-authentication-primitive-auth-time` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/identity/reauth/**
- apps/api/src/platform/auth/step-up.ts (x-reauth-max-age)

**Acceptance tests to write**
- API scenarios of US-291
- SEC-TC-37 (step-up part): listed operations without proof -> 401 REAUTH_REQUIRED; auth_time > 12 h on member/invitation routes -> 401
- Covers the scenarios of AT-US-291-01 … AT-US-291-13 that belong to its layer; US-291 closes in TASK-197

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-188 — Redacted raw carrier payload retention ($blob descriptors, allow-listed tracking fields)

| Field | Value |
|---|---|
| Stories (completes) | US-136 (M1 Must) Redacted raw payload retention |
| REQs | REQ-CARR-018 |
| NFRs | NFR-PRIV-001 |
| Spikes / security / decisions | SEC-P3-13, D-ARCH-026, PR6-SEC-02, PR6-SEC-06, PR6-SEC-07, D-ARCH-068, PR20-SEC-14, D-ORCH-025, D-ARCH-084 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-135, TASK-139, TASK-140, TASK-019 |
| Batch · locks | 7.1 · pkg-carriers-raw |
| Branch | `feat/TASK-188-redacted-raw-carrier-payload-retention` |
| Priority | Must |

**Files / modules**
- packages/carriers/src/raw-payload/**

**Acceptance tests to write**
- All US-136 scenarios
- SEC-TC-52 (storage part): no base64 blob > 1 kB and no sentinel name/address/tax ID in raw-carrier-payloads
- PR6-SEC-02 item 2 + R2.4 (ADR-0010 am. 11 item 8; D-ARCH-068): the request redactor deny-list is PER CARRIER, loaded from each adapter typed `sensitive-fields.ts` (never one generic list); matching is case-insensitive on the leaf key plus exact paths for ambiguous `Name`/`name` leaves; WHOLE PARTY CONTAINERS are removed rather than leaf by leaf (DHL `contactInformation`, address lines, `shipmentNotification`; UPS `Phone`, `FaxNumber`, the `InternationalForms.Contacts` parties; FedEx `contact`); a completeness test fails when a README "Sensitive fields" path has no sentinel in the fixtures, and the SEC-TC-52/AC-45 sentinel run proves no sentinel survives in the stored JSON, Pino output, error messages, HTTP responses or the in-memory OTel exporter
- PR6-SEC-06 / PR6-SEC-07 item 2: the canonical output and the stored payload carry no carrier-supplied URL (`LabelURL`, `packageDocuments[].url`, `trackingUrl`, `cancelPickupUrl` are dropped by the redactor); token-endpoint requests and responses are never captured
- PR20-SEC-02 item 5 / PR20-SEC-14 (D-ORCH-025 (2); D-ARCH-084): the per-carrier sensitive-fields.ts lists are the single source for BOTH the raw-payload redactor and the shared Pino redaction parts (the logger loads them; no second list), and the completeness test of the line above also covers the logger
- AT-US-136-01 … AT-US-136-10: all 10 scenarios of US-136, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-189 — Pre-rendered public pages per locale (legal, help, prohibited-items shell, track shell; hreflang, caching)

| Field | Value |
|---|---|
| Stories (completes) | US-112 (M1 Must) Pre-rendered public pages per locale |
| REQs | REQ-UI-019 |
| NFRs | NFR-WEB-005 |
| Spikes / security / decisions | D-026, D-ARCH-015 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-125, TASK-111, TASK-180 |
| Batch · locks | 7.1 · web-public |
| Branch | `feat/TASK-189-pre-rendered-public-pages-per` |
| Priority | Must |

**Files / modules**
- apps/web/react-router.config.ts prerender list
- apps/web/app/routes/$lang.legal.*.tsx
- apps/web/app/routes/$lang.help.*.tsx

**Acceptance tests to write**
- All US-112 scenarios
- AT-US-112-01 … AT-US-112-08: all 8 scenarios of US-112, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-190 — Anonymous rate-shopping budget, daily carrier quota guard and per-organisation share

| Field | Value |
|---|---|
| Stories (completes) | US-293 (M1 Must) Anonymous rate-shopping budget and daily carrier quota guard |
| REQs | REQ-CARR-022, REQ-CARR-023 |
| NFRs | NFR-RES-007 |
| Spikes / security / decisions | SEC-COND-02, SEC-COND-07, SEC-P3-02, SEC-P3-29, D-048 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-132, TASK-136, TASK-141, TASK-041 |
| Batch · locks | 7.2 · mod-quotes-rateshop, pkg-carriers-gateway |
| Branch | `feat/TASK-190-anonymous-rate-shopping-budget-daily` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/quotes/rate-shopper/budget.ts
- packages/carriers/src/gateway/quota-guard.ts

**Acceptance tests to write**
- All US-293 scenarios
- SEC-TC-41: at (100 - reserve) % anonymous fan-out stops; carrier_quota_pressure at 70 % and 90 %
- SEC-TC-62: unverified = anonymous; quote-create 30/min; 10 % org share
- AT-US-293-01 … AT-US-293-15: all 15 scenarios of US-293, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-191 — Fixture hygiene, adapter README docs-check and live-sandbox opt-in (CARRIER_LIVE_SANDBOX=1)

| Field | Value |
|---|---|
| Stories (completes) | US-137 (M1 Must) Fixture hygiene, adapter README docs-check and live-sandbox opt-in |
| REQs | REQ-CARR-019, REQ-CARR-020 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | T-QA-10, COND-SANDBOX-DEMO |
| Specialist · model | test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-135, TASK-139, TASK-140, TASK-101 |
| Batch · locks | 7.2 · pkg-carriers-fixtures |
| Branch | `feat/TASK-191-fixture-hygiene-adapter-readme-docs` |
| Priority | Must |

**Files / modules**
- packages/carriers/test/fixtures/**
- tools/carriers/readme-docs-check.ts
- root script test:contract:live
- tests/load config test (no carrier host in k6 scripts or environment)

**Acceptance tests to write**
- All US-137 scenarios
- ADR-0010 am. 11 item 4 (D-ARCH-057): readme-docs-check requires the line "Diffed against official spec by a person: yes (date, role) | no" in every real adapter README besides Docs URL, API version, Date checked, Sandbox quirks and Sources; the lane B evidence report counts fixtures flagged `"_fixture": "synthesised"` per adapter; "no" does not fail the check but is listed under COND-SANDBOX-DEMO
- PR #6 code review R2-n1 / PR6-SEC-12 h (ADR-0010 am. 11 item 4 as clarified 2026-11-12; D-ARCH-068): the canonical subsection heading is "PII and redaction" — readme-docs-check matches a heading that starts with that text case-insensitively (a parenthetical suffix passes; "Personal data and secrets" fails), and requires the Docs URL row to carry a specification commit SHA (`@ <sha>`) for repository sources or "not pinnable · retrieved <date>" for web pages; negative fixtures for a renamed heading and a SHA-less repository Docs URL
- PR6-SEC-10 (sandbox hygiene): the live run (`CARRIER_LIVE_SANDBOX=1`) documents a per-run call budget (one or two calls per operation) and runs single-threaded; `test:load` targets the Mock carrier only and a configuration test asserts that no carrier host appears in the k6 scripts or their environment
- AT-US-137-01 … AT-US-137-08: all 8 scenarios of US-137, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-192 — Margin rule selection and precedence; discount stacking rule

| Field | Value |
|---|---|
| Stories (completes) | US-141 (M1 Must) Margin rule selection and precedence<br>US-146 (M1 Must) Discount stacking rule |
| REQs | REQ-PRICE-005, REQ-PRICE-013 |
| NFRs | NFR-QUAL-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-138 |
| Batch · locks | 7.2 · pkg-pricing |
| Branch | `feat/TASK-192-margin-rule-selection-precedence-discount` |
| Priority | Must |

**Files / modules**
- packages/pricing/src/rules/{margin-selection.ts, stacking.ts}

**Acceptance tests to write**
- All US-141 and US-146 scenarios
- AT-US-141-01 … AT-US-141-07: all 7 scenarios of US-141, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-146-01 … AT-US-146-06: all 6 scenarios of US-146, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-193 — Sessions page (web security area) and My sessions (admin)

| Field | Value |
|---|---|
| Stories (completes) | US-027 (M1 Must) Sessions list and remote sign-out (API and My sessions page) |
| REQs | REQ-AUTH-021, REQ-AUTH-022, REQ-ADMIN-007 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-186, TASK-077 |
| Batch · locks | 7.2 · web-account-security, admin-sessions |
| Branch | `feat/TASK-193-sessions-page-my-sessions` |
| Priority | Must |

**Files / modules**
- apps/web/app/routes/account/security/sessions.tsx
- apps/admin/app/routes/sessions.tsx

**Acceptance tests to write**
- All US-027 scenarios (S-C07, S-D08)
- AT-US-027-01 … AT-US-027-07: all 7 scenarios of US-027, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-194 — Expired quote with one-action re-quote; rate-relevant change creates a new quote

| Field | Value |
|---|---|
| Stories (completes) | US-167 (M1 Must) Expired quote and one-action re-quote<br>US-168 (M1 Must) Rate-relevant change creates a new quote |
| REQs | REQ-QUOTE-017, REQ-QUOTE-018 |
| NFRs | — |
| Spikes / security / decisions | D-UX-015 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-146, TASK-142, TASK-149 |
| Batch · locks | 7.3 · mod-quotes, web-quote-results |
| Branch | `feat/TASK-194-expired-quote-one-action-re` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/quotes/requote.*
- apps/web/app/features/quote-results/expired/**

**Acceptance tests to write**
- All US-167 and US-168 scenarios
- AT-US-167-01 … AT-US-167-09: all 9 scenarios of US-167, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-168-01 … AT-US-168-08: all 8 scenarios of US-168, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-195 — Address validation against country rules; required tax and identity references

| Field | Value |
|---|---|
| Stories (completes) | US-176 (M1 Must) Step 1: address validation against country rules<br>US-177 (M1 Must) Step 1: required tax and identity references |
| REQs | REQ-BOOK-006, REQ-BOOK-008 |
| NFRs | — |
| Spikes / security / decisions | D-013 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-159, TASK-130 |
| Batch · locks | 7.3 · mod-shipments-validation, web-wizard-step1 |
| Branch | `feat/TASK-195-address-validation-against-country-rules` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/shipments/validation/**
- apps/web/app/features/wizard/step-1/validation/**

**Acceptance tests to write**
- All US-176 and US-177 scenarios
- AT-US-176-01 … AT-US-176-07: all 7 scenarios of US-176, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-177-01 … AT-US-177-06: all 6 scenarios of US-177, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-196 — Prohibited and restricted items: data with public lookup endpoint and wizard step-2 check

| Field | Value |
|---|---|
| Stories (completes) | US-055 (M1 Must) Prohibited and restricted items with public lookup<br>US-183 (M1 Must) Step 2: prohibited and restricted item check |
| REQs | REQ-DATA-011, REQ-CUST-009 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-123, TASK-154 |
| Batch · locks | 7.3 · mod-compliance, mod-customs |
| Branch | `feat/TASK-196-prohibited-restricted-items-data-public` |
| Priority | Must |

**Files / modules**
- prisma/seed/reference/prohibited-items.ts
- apps/api/src/modules/customs/prohibited-checker.*
- apps/api/src/modules/compliance/prohibited/**

**Acceptance tests to write**
- All US-055 and US-183 scenarios
- AT-US-055-01 … AT-US-055-08: all 8 scenarios of US-055, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-183-01 … AT-US-183-09: all 9 scenarios of US-183, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-197 — Re-authentication prompt (web and admin)

| Field | Value |
|---|---|
| Stories (completes) | US-291 (M1 Must) Re-authentication primitive, `auth_time` and age-based step-up |
| REQs | REQ-AUTH-020, REQ-AUTH-025 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | SEC-COND-01 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-187, TASK-065 |
| Batch · locks | 7.3 · fe-reauth |
| Branch | `feat/TASK-197-re-authentication-prompt` |
| Priority | Must |

**Files / modules**
- packages/ui/src/session/ReauthDialog/**

**Acceptance tests to write**
- All US-291 scenarios
- AT-US-291-01 … AT-US-291-13: all 13 scenarios of US-291, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-198 — Included liability cover line

| Field | Value |
|---|---|
| Stories (completes) | US-143 (M1 Must) Included liability cover line |
| REQs | REQ-PRICE-008 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-138 |
| Batch · locks | 7.4 · pkg-pricing |
| Branch | `feat/TASK-198-included-liability-cover-line` |
| Priority | Must |

**Files / modules**
- packages/pricing/src/lines/cover.ts

**Acceptance tests to write**
- All US-143 scenarios
- AT-US-143-01 … AT-US-143-05: all 5 scenarios of US-143, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-199 — Dangerous-goods attestation, explicit screening status and carrier customs field mapping in adapters

| Field | Value |
|---|---|
| Stories (completes) | US-184 (M1 Must) Dangerous-goods attestation and explicit screening status<br>US-187 (M1 Must) Carrier customs field mapping inside adapters |
| REQs | REQ-CUST-010, REQ-CUST-011, REQ-CUST-015 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-154, TASK-135, TASK-139, TASK-140 |
| Batch · locks | 7.4 · mod-customs, carrier-dhl, carrier-fedex, carrier-ups |
| Branch | `feat/TASK-199-dangerous-goods-attestation-explicit-screening` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/customs/dg.*
- packages/carriers/src/adapters/*/customs-mapping.ts

**Acceptance tests to write**
- All US-184 and US-187 scenarios
- AT-US-184-01 … AT-US-184-07: all 7 scenarios of US-184, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-187-01 … AT-US-187-04: all 4 scenarios of US-187, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-200 — Partial capture for multi-shipment orders

| Field | Value |
|---|---|
| Stories (completes) | US-206 (M1 Must) Partial capture for multi-shipment orders |
| REQs | REQ-BOOK-024 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | R-ARCH-07 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-170, TASK-105, TASK-178 |
| Batch · locks | 7.4 · mod-payments-core |
| Branch | `feat/TASK-200-partial-capture-multi-shipment-orders` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/orders/booking-saga/partial-capture.*

**Acceptance tests to write**
- All US-206 scenarios
- AT-US-206-01 … AT-US-206-05: all 5 scenarios of US-206, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-201 — Quote widget units toggle and live billable weight

| Field | Value |
|---|---|
| Stories (completes) | US-157 (M1 Must) Quote widget units toggle and live billable weight |
| REQs | REQ-QUOTE-005, REQ-QUOTE-006 |
| NFRs | NFR-I18N-004 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-125, TASK-076 |
| Batch · locks | 7.4 · web-home |
| Branch | `feat/TASK-201-quote-widget-units-toggle-live` |
| Priority | Must |

**Files / modules**
- apps/web/app/features/quote-widget/units/**

**Acceptance tests to write**
- All US-157 scenarios
- AT-US-157-01 … AT-US-157-07: all 7 scenarios of US-157, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-202 — Versioned seed-based pricing configuration

| Field | Value |
|---|---|
| Stories (completes) | US-152 (M1 Must) Versioned seed-based pricing configuration |
| REQs | REQ-PRICE-020 |
| NFRs | — |
| Spikes / security / decisions | D-010 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-192, TASK-129 |
| Batch · locks | 7.5 · pkg-pricing, prisma-seed |
| Branch | `feat/TASK-202-versioned-seed-based-pricing-configuration` |
| Priority | Must |

**Files / modules**
- prisma/seed/reference/pricing/**
- packages/pricing/src/config/**

**Acceptance tests to write**
- All US-152 scenarios
- PR #13 code review m4 (a) / prisma/README.md "Dataset contract limits": pricing rules reference pricing_config_versions ids — uses the fk / seedId resolution extension (TASK-066) and declares no runtime-mutated column
- AT-US-152-01 … AT-US-152-06: all 6 scenarios of US-152, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-203 — Schedule a pickup after booking; cancel pickup when a shipment is cancelled

| Field | Value |
|---|---|
| Stories (completes) | US-236 (M1 Must) Schedule a pickup after the booking<br>US-237 (M1 Must) Cancel pickup when a shipment is cancelled |
| REQs | REQ-PICK-007, REQ-PICK-008 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-178 |
| Batch · locks | 7.5 · mod-pickups |
| Branch | `feat/TASK-203-schedule-pickup-after-booking-cancel` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/pickups/{schedule-later,cancel-on-shipment-cancelled}.*

**Acceptance tests to write**
- All US-236 and US-237 scenarios (cancellation event emitted by a service-level test until US-196 lands)
- AT-US-236-01 … AT-US-236-08: all 8 scenarios of US-236, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-237-01 … AT-US-237-06: all 6 scenarios of US-237, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-204 — Carrier tracking polling with adaptive intervals and stale flag

| Field | Value |
|---|---|
| Stories (completes) | US-243 (M1 Must) Poll carrier tracking with adaptive intervals and stale flag |
| REQs | REQ-TRACK-003 |
| NFRs | NFR-RES-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-172, TASK-039 |
| Batch · locks | 7.5 · mod-tracking-poll |
| Branch | `feat/TASK-204-carrier-tracking-polling-adaptive-intervals` |
| Priority | Must |

**Files / modules**
- apps/worker/src/processors/tracking-poll/**

**Acceptance tests to write**
- All US-243 scenarios
- AT-US-243-01 … AT-US-243-07: all 7 scenarios of US-243, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-205 — Fail-closed download audit

| Field | Value |
|---|---|
| Stories (completes) | US-226 (M1 Must) Fail-closed download audit |
| REQs | REQ-DOC-008 |
| NFRs | NFR-AUDIT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-162, TASK-114 |
| Batch · locks | 7.5 · mod-documents-download |
| Branch | `feat/TASK-205-fail-closed-download-audit` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/documents/download/audit.*

**Acceptance tests to write**
- All US-226 scenarios
- AT-US-226-01 … AT-US-226-06: all 6 scenarios of US-226, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-206 — Pricing property-based tests (>= 1,000 cases) and coverage gate

| Field | Value |
|---|---|
| Stories (completes) | US-151 (M1 Must) Property-based tests and coverage gate |
| REQs | REQ-PRICE-019 |
| NFRs | NFR-QUAL-002, NFR-QUAL-003 |
| Spikes / security / decisions | — |
| Specialist · model | test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-138, TASK-198, TASK-192 |
| Batch · locks | 7.6 · pkg-pricing-tests |
| Branch | `feat/TASK-206-pricing-property-based-tests-coverage` |
| Priority | Must |

**Files / modules**
- packages/pricing/test/properties/**
- stryker.config.mjs (packages/pricing)

**Acceptance tests to write**
- All US-151 scenarios
- AT-US-151-01 … AT-US-151-05: all 5 scenarios of US-151, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-207 — Batch track calls per carrier account with backoff and pending handling

| Field | Value |
|---|---|
| Stories (completes) | US-244 (M1 Must) Batch track calls per carrier account with backoff and pending handling |
| REQs | REQ-TRACK-004 |
| NFRs | NFR-RES-003 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-204 |
| Batch · locks | 7.6 · mod-tracking-poll |
| Branch | `feat/TASK-207-batch-track-calls-per-carrier` |
| Priority | Must |

**Files / modules**
- apps/worker/src/processors/tracking-poll/batch.*

**Acceptance tests to write**
- All US-244 scenarios
- AT-US-244-01 … AT-US-244-08: all 8 scenarios of US-244, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-208 — Mock carrier tracking scenarios on an injected clock

| Field | Value |
|---|---|
| Stories (completes) | US-245 (M1 Must) Mock carrier tracking scenarios on an injected clock |
| REQs | REQ-TRACK-014 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-097, TASK-168 |
| Batch · locks | 7.6 · pkg-carriers-mock |
| Branch | `feat/TASK-208-mock-carrier-tracking-scenarios-an` |
| Priority | Must |

**Files / modules**
- packages/carriers/src/adapters/mock/tracking/**

**Acceptance tests to write**
- All US-245 scenarios
- AT-US-245-01 … AT-US-245-06: all 6 scenarios of US-245, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-209 — Drafts list, resume, delete and 30-day expiry (API + UI)

| Field | Value |
|---|---|
| Stories (completes) | US-256 (M1 Must) Drafts list, resume, delete and 30-day expiry |
| REQs | REQ-ACCT-004 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-149, TASK-183 |
| Batch · locks | 7.6 · mod-shipments-drafts, web-account-drafts |
| Branch | `feat/TASK-209-drafts-list-resume-delete-30` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/shipments/drafts/**
- apps/web/app/routes/account/drafts.tsx
- housekeeping draft expiry

**Acceptance tests to write**
- All US-256 scenarios
- AT-US-256-01 … AT-US-256-11: all 11 scenarios of US-256, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-210 — Rate-limit public tracking lookups

| Field | Value |
|---|---|
| Stories (completes) | US-249 (M1 Must) Rate-limit public tracking lookups |
| REQs | REQ-TRACK-010 |
| NFRs | NFR-SEC-005 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-176 |
| Batch · locks | 7.7 · mod-tracking-public |
| Branch | `feat/TASK-210-rate-limit-public-tracking-lookups` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/tracking/public/rate-limit.*

**Acceptance tests to write**
- All US-249 scenarios
- AT-US-249-01 … AT-US-249-09: all 9 scenarios of US-249, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-211 — Tenant isolation on every account route (generated suite coverage)

| Field | Value |
|---|---|
| Stories (completes) | US-257 (M1 Must) Tenant isolation on every account route |
| REQs | REQ-ACCT-020 |
| NFRs | NFR-SEC-011, NFR-TENANT-001 |
| Spikes / security / decisions | — |
| Specialist · model | test-engineer · opus |
| Complexity | S |
| Depends on | TASK-185, TASK-209, TASK-024 |
| Batch · locks | 7.7 · tests-account-iso |
| Branch | `feat/TASK-211-tenant-isolation-every-account-route` |
| Priority | Must |

**Files / modules**
- tests/generated/rls/account-routes.api.test.ts

**Acceptance tests to write**
- All US-257 scenarios
- AT-US-257-01 … AT-US-257-05: all 5 scenarios of US-257, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-212 — CI gate for template and variable parity across locales

| Field | Value |
|---|---|
| Stories (completes) | US-281 (M1 Must) CI gate for template and variable parity across locales |
| REQs | REQ-NOTIF-017 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-082, TASK-169 |
| Batch · locks | 7.7 · notif-parity |
| Branch | `feat/TASK-212-ci-gate-template-variable-parity` |
| Priority | Must |

**Files / modules**
- tools/i18n/template-parity.test.ts

**Acceptance tests to write**
- All US-281 scenarios
- AT-US-281-01 … AT-US-281-06: all 6 scenarios of US-281, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-213 — Address only booking-organisation users

| Field | Value |
|---|---|
| Stories (completes) | US-285 (M1 Must) Address only booking-organisation users |
| REQs | REQ-NOTIF-015 |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-169, TASK-179 |
| Batch · locks | 7.7 · mod-notifications |
| Branch | `feat/TASK-213-address-only-booking-organisation-users` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/notifications/recipients.*

**Acceptance tests to write**
- All US-285 scenarios
- AT-US-285-01 … AT-US-285-07: all 7 scenarios of US-285, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-214 — Observability: RED metrics, queue/breaker metrics, OTel traces API -> queue -> worker -> carrier, graceful shutdown, compose observability profile

| Field | Value |
|---|---|
| Stories (completes) | US-013 (M0 Should) Telemetry seam and graceful shutdown |
| REQs | REQ-PLAT-019, REQ-PLAT-022 |
| NFRs | NFR-AVAIL-002, NFR-OBS-002, NFR-OBS-003 |
| Spikes / security / decisions | ADR-0017, D-ARCH-043, PR6-SEC-03, PR6-SEC-12, PR20-SEC-17, D-ORCH-025, D-ARCH-084 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-010, TASK-092, TASK-047 |
| Batch · locks | 7.8 · api-metrics, worker-metrics, infra-obs |
| Branch | `feat/TASK-214-observability-red-metrics-queue-breaker` |
| Priority | Should |

> Scheduling note: US-013 (M0 Should) delivered inside the NFR-OBS task; it no longer appears in the Should wave (D-PLAN-004).

**Files / modules**
- apps/{api,worker}/src/platform/telemetry/**
- infra/local/{otel,prometheus.yml,grafana}/**

**Acceptance tests to write**
- All US-013 scenarios
- One trace spans API -> queue -> worker -> Mock carrier (NFR-OBS-003); no high-cardinality labels (NFR-OBS-002)
- ADR-0023 am. J item 4, ADR-0017 am. 2 and D-ARCH-043 (PR1-SEC-07): add only the explicit OpenTelemetry instrumentations (http, undici, pg, ioredis, pino, express) and the AWS/container resource detectors, each through the cooldown, licence and age gates. Never re-add `@opentelemetry/auto-instrumentations-node` or the GCP/Azure/Alibaba detectors.
- PR6-SEC-03 item 2 / PR6-SEC-12 c (ADR-0017 §4 allow-list; ADR-0010 am. 11 item 8; D-ARCH-068): client spans for carrier and gateway calls carry `server.address`, `http.request.method`, `http.response.status_code` and the adapter route template (`url.template`) only — `url.full`, `url.path`, `url.query` and the legacy `http.url`/`http.target` are excluded by the span-processor allow-list (or undici auto-instrumentation is disabled for the carrier dispatcher and manual spans are created); the in-memory exporter test asserts a `requestorName` sentinel and an account-number sentinel never appear in any span attribute Afterwards `npm audit --omit=dev` reports 0 and `npm ls gcp-metadata` is empty
- PR #11 code review R3-m1 (ii) (first metrics task; D-ARCH-079): the leak counter sessionContextLeaks() exported by apps/api/src/platform/db/runtime.ts is published as the metric db_session_context_leak_total (api and worker) with an alert rule; the latched not-ready state stays visible in /health/ready
- PR #20 code review n8 / api/README §13 header (D-ORCH-025 (2); D-ARCH-084): the counter `security_events_total{event}` is published by the security sink for every catalogue and runtime event (label = event name only; no attribute label); PR20-SEC-17 — one per-line size budget charges `err` (cause chain) and the merged child bindings together with the fields (or err is capped at MAX_LINE_CHARS in total and child bindings at 2 KiB) so a line never exceeds the 16 KiB Docker json-file split, and the shipper partial-line handling is documented in the observability runbook
- AT-US-013-01 … AT-US-013-06: all 6 scenarios of US-013, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-215 — Terraform modules and overlays validated with Checkov (never applied)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-OPS-004, NFR-SCALE-003 |
| Spikes / security / decisions | R-ARCH-13, D-002 |
| Specialist · model | devops-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-015 |
| Batch · locks | 7.8 · infra-tf |
| Branch | `feat/TASK-215-terraform-modules-overlays-validated-checkov` |
| Priority | Enabler |

**Files / modules**
- infra/terraform/modules/** + envs/** per platform.md §6
- .checkov.yaml with documented suppressions

**Acceptance tests to write**
- terraform fmt/validate and Checkov clean in lane A iac job; no apply step in ci.yml (policy test)

**DoD notes**
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-216 — k6 M1 profiles (booking, tracking, lists, SEC-TC-40 flood) and compose --scale duplicate-effect test

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-PERF-001, NFR-PERF-004, NFR-PERF-005, NFR-PERF-007, NFR-RES-007, NFR-SCALE-002 |
| Spikes / security / decisions | SEC-TC-40, SEC-COND-02 |
| Specialist · model | performance-engineer · opus |
| Complexity | M |
| Depends on | TASK-190, TASK-182, TASK-176, TASK-183 |
| Batch · locks | 7.8 · tests-load |
| Branch | `feat/TASK-216-k6-m1-profiles-compose-scale` |
| Priority | Enabler |

**Files / modules**
- tests/load/{booking.js, tracking.js, lists.js, flood.js}
- tests/scale/duplicate-effects.int.test.ts

**Acceptance tests to write**
- SEC-TC-40: guest flood from 50 IPs while 20 orders book -> all BOOKED
- NFR-PERF-004/005 thresholds on the reference host; 0 duplicate audit/side effects over 1,000 bookings at --scale api=2 worker=2

**DoD notes**
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-217 — Web performance gates: Lighthouse CI on pre-rendered routes and size-limit budgets per route

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-WEB-001, NFR-WEB-002, NFR-WEB-003, NFR-WEB-004, NFR-WEB-005 |
| Spikes / security / decisions | T-QA-09 |
| Specialist · model | performance-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-189, TASK-125 |
| Batch · locks | 7.8 · tests-web-perf |
| Branch | `feat/TASK-217-web-performance-gates-lighthouse-ci` |
| Priority | Enabler |

**Files / modules**
- tests/web-perf/lighthouserc.json
- .size-limit.json per-route budgets

**Acceptance tests to write**
- Lighthouse >= 90 performance / 95 a11y on public routes (mobile, slow 4G); LCP <= 2.5 s; CLS <= 0.1

**DoD notes**
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-218 — M1 exit-demo journeys: book and pay end to end with DHL, FedEx and UPS (fixtures), en/es/fr x 360/1280

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-COMPAT-002, NFR-QUAL-006 |
| Spikes / security / decisions | PRD §6.2, COND-SANDBOX-DEMO |
| Specialist · model | e2e-test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-182, TASK-185, TASK-180, TASK-179, TASK-181, TASK-152, TASK-145, TASK-137 |
| Batch · locks | 7.9 · e2e-demo |
| Branch | `feat/TASK-218-m1-exit-demo-journeys-book` |
| Priority | Enabler |

**Files / modules**
- tests/e2e/demo/m1-exit.spec.ts (Mailpit API, Stripe fixture 3DS)

**Acceptance tests to write**
- PRD §6.2 Scenario Outline green for 3 carriers x 3 locales x 2 viewports on Chromium, Firefox, WebKit (lane B gate profile); live-sandbox scenario tagged and skipped without credentials

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
