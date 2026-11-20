# WAVE-07 — M1 non-DC Must, NFR verification tasks, the M1 exit-demo journeys and the organisation routes that complete US-061 and US-062 (D-PM-068)

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M1** · Priority band: **Must non-DC**

Tasks: **38** (S 13 / M 25; opus 10 / sonnet 28; demo-critical 0) in **11** batches of ≤ 4 parallel tasks. Estimated effort ≈ 94.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** All 218 Must stories merged, US-061 and US-062 included (TASK-224 and TASK-231; all eleven scenarios pass in `ac-trace.json`, otherwise product-manager applies the rung-4 fallback of D-PM-068); M1 demo journey green; NFR tasks evidence committed; lane C `release-candidate` run; ready for P6 (G3).

**Stories completed in this wave (40):** US-013, US-027, US-055, US-061 (DC), US-062 (DC), US-081, US-082, US-083, US-084, US-085, US-112, US-136, US-137, US-141, US-143, US-146, US-151, US-152, US-157, US-167, US-168, US-176, US-177, US-183, US-184, US-187, US-206, US-226, US-236, US-237, US-243, US-244, US-245, US-249, US-256, US-257, US-281, US-285, US-291, US-293.

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
| 7.8 | TASK-214 Observability<br>TASK-215 Terraform modules and overlays validated with Checkov<br>TASK-216 k6 M1 profiles<br>TASK-217 Web performance gates | api-metrics, worker-metrics, infra-obs, infra-compose, worker-queues<br>infra-tf<br>tests-load<br>tests-web-perf |
| 7.9 | TASK-218 M1 exit-demo journeys<br>TASK-224 Switch active organisation; organisation profile and creating a business organisation<br>TASK-282 Developer README and CONTRIBUTING<br>TASK-294 TASK-W0-FLAKE-3-F | e2e-demo<br>mod-organisations<br>docs-dev<br>quality-tools, tests-harness |
| 7.10 | TASK-227 Invite members into a business organisation; accept an invitation | mod-organisations |
| 7.11 | TASK-231 Manage members with last-Owner and individual-organisation safeguards | mod-organisations |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

Shared hot files (D-ORCH-118, D-ARCH-147): `api-tenant-db` = `apps/api/src/platform/db/tenant-db.*`, `apps/api/src/platform/db/with-tenant-tx.*`, `apps/api/src/platform/db/raw-statement.*`; `api-tx-execute` = `apps/api/src/platform/tx/**`; `api-platform-core` = `apps/api/src/app.*`, `apps/api/src/start-api.*`, `apps/api/src/main.*`; `api-routing` = `apps/api/src/platform/routing/pipeline.*`; `lint` = `eslint.config.mjs`. A card whose planned files name one of them holds that lock (the generator fails otherwise); a PR that needs such a file without holding the lock stops and asks the orchestrator for it first, so two in-flight PRs never edit the same shared file.

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
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/modules/identity/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`, `apps/api/src/modules/identity/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
| Spikes / security / decisions | SEC-COND-02, SEC-COND-07, SEC-P3-02, SEC-P3-29, D-048, D-ARCH-178, PR041-SEC-03, D-SD-004 |
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
- ADMISSION STORE FAILURE (ADR-0010 amendment 13; D-ARCH-178; PR041-SEC-03): when the admission counters cannot be read or written, anonymous fan-out to the account and, for an account with CARRIER_DAILY_QUOTA above 0, rates-pool calls of verified callers are refused locally (LOCAL_REJECT, CARRIER_BUSY; cached results still served); transactional calls are never refused and are counted in process and added to the daily counter on recovery; store calls are bounded and share a breaker; event rate_limit_store_unavailable with scope carrier-admission at most once a minute; tests: with the store failing, a guest quote gets CARRIER_BUSY for the account and makes zero carrier calls, a booking still reaches the carrier, and the count of the outage is added afterwards; qa-lead adds this outage row to SEC-TC-41 when this task is dispatched
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
| Spikes / security / decisions | D-UX-015, D-ARCH-162, D-SD-003 |
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
- requote_of_quote_id is set only when the original quote belongs to the same organisation (D-ARCH-162); a guest quote carries NULL (ck_quotes__requote_org_only)
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
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
| Spikes / security / decisions | D-ARCH-170, D-SD-004 |
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
- the live billable weight uses the rule of the origin country unit system (REQ-QUOTE-006; ADR-0009 amendment 2 item 4; D-ARCH-170); the units toggle changes the displayed unit only; test: toggling units changes no weight beyond the unit conversion
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
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
| Spikes / security / decisions | D-ARCH-161, D-SD-003, D-SECPR039-01, PR039-SEC-03 |
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
- RECURRING JOB ID (ADR-0013 amendment 3 item 11; D-ARCH-161): the poll job id is tracking_poll.<schedule_id>.<occurrence>, the occurrence derived from the due time of that poll (1 to 40 characters of [a-z0-9_-]); an id without it is ignored by BullMQ while the previous poll of the same schedule is retained (24 hours completed, 7 days failed); test: two consecutive due polls of one shipment both run, and a second enqueue of the same occurrence is one job
- SCHEDULE CONDITIONS (D-SECPR039-01 ruling on D-TASK039-01, conditions (i) to (iv)): for every schedule this task adds, (i) parameters come from code or configuration, never from the job; (ii) a destructive or non-idempotent handler applies its own policy predicate (purges by age), and if it writes it runs through idempotentProcessor keyed by the occurrence id; (iii) SCHEDULE_NAMES stays closed, with the one-queue check and the processor refusal kept, and a name of at most 47 characters; (iv) a run-now action goes through the scheduler, never as a hand-made repeat: job
- ABORT-SIGNAL DISCIPLINE (PR039-SEC-03 (b), INFO; D-SECPR039-01): processors of this task pass the per-job AbortSignal to every awaited call that accepts one (database, carrier, HTTP), check it before each non-transactional side effect, and call throwIfAborted after the effect, so no work overlaps a retry after the per-job deadline
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
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`tests/generated/rls/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
| Spikes / security / decisions | ADR-0017, D-ARCH-043, PR6-SEC-03, PR6-SEC-12, PR20-SEC-17, D-ORCH-025, D-ARCH-084, D-ARCH-118, D-ARCH-125, PR64-SEC-04, D-ARCH-160, PR041-SEC-04, D-ARCH-177, D-SD-004 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-010, TASK-092, TASK-047, TASK-039 |
| Batch · locks | 7.8 · api-metrics, worker-metrics, infra-obs, infra-compose, worker-queues |
| Branch | `feat/TASK-214-observability-red-metrics-queue-breaker` |
| Priority | Should |

> Scheduling note: US-013 (M0 Should) delivered inside the NFR-OBS task; it no longer appears in the Should wave (D-PLAN-004).

**Files / modules**
- apps/{api,worker}/src/platform/telemetry/**
- infra/local/{otel,prometheus.yml,grafana}/**
- compose.yaml (observability profile; redis --maxmemory)
- apps/worker/src/platform/queues/metrics.ts (Valkey memory and oldest-waiting-age gauges; ADR-0013 amendment 3 item 12)

**Acceptance tests to write**
- All US-013 scenarios
- QUEUE AND VALKEY ALARMS (PR64-SEC-04; ADR-0013 amendment 3 items 12 to 14 and 16; D-ARCH-160; platform.md 8.2 and 8.5): (a) METRICS: the worker publishes platform_valkey_memory_used_bytes and platform_valkey_memory_max_bytes (used_memory and maxmemory of INFO memory; the worker ACL user has +info, the api user has not) and platform_queue_oldest_waiting_age_seconds{queue}, collected with the queue gauges under the same 2 s deadline and single-flight (PR64-SEC-03, PR64-SEC-12); when this task moves the worker metrics to @prometheus-io/client (ADR-0017 amendment 1) the names and label sets platform_queue_jobs{queue,state}, platform_queue_dead_letter_jobs{queue} and platform_queue_dead_lettered_total{queue} (the counter of TASK-039) do not change. (b) CEILING AND START-UP CHECK: compose.yaml adds --maxmemory ${REDIS_MAXMEMORY:-512mb} to the redis command (tools/compose/compose-stack.test.ts follows, and the amended note in platform.md 2.2 is then reduced to the command itself); at worker start maxmemory_policy of INFO memory must be noeviction or the worker refuses to start (ADR-0013 section 9), and a maxmemory of 0 logs WARN worker.valkey_maxmemory_unset when APP_ENV is not test. (c) FOUR ALERT RULES in the Prometheus rules of the compose observability profile, each with the labels severity and runbook: QueueDeadLetterNew = sum by (queue) (increase(platform_queue_dead_lettered_total[15m])) > 0, no for, severity page for the queues booking and payments and ticket for the others, RB-07; QueueDeadLetterDepthHigh = max by (queue) (platform_queue_dead_letter_jobs) >= 1600 (80 % of DEAD_LETTER_RETENTION.count), for 5m, page, RB-07; ValkeyMemoryHigh = max(platform_valkey_memory_used_bytes) / (max(platform_valkey_memory_max_bytes) > 0) >= 0.70, for 10m, ticket, RB-06; ValkeyMemoryCritical = the same ratio >= 0.85, for 5m, page, RB-06. TESTS: a lane A test pins the four names, expressions, for values and labels and derives 1600 from the exported DEAD_LETTER_RETENTION; a unit case for the start-up check (a policy other than noeviction refuses the start); the three new gauges appear on the worker /metrics in the integration suite
- One trace spans API -> queue -> worker -> Mock carrier (NFR-OBS-003); no high-cardinality labels (NFR-OBS-002)
- ADR-0023 am. J item 4, ADR-0017 am. 2 and D-ARCH-043 (PR1-SEC-07): add only the explicit OpenTelemetry instrumentations (http, undici, pg, ioredis, pino, express) and the AWS/container resource detectors, each through the cooldown, licence and age gates. Never re-add `@opentelemetry/auto-instrumentations-node` or the GCP/Azure/Alibaba detectors.
- PR6-SEC-03 item 2 / PR6-SEC-12 c (ADR-0017 §4 allow-list; ADR-0010 am. 11 item 8; D-ARCH-068): client spans for carrier and gateway calls carry `server.address`, `http.request.method`, `http.response.status_code` and the adapter route template (`url.template`) only — `url.full`, `url.path`, `url.query` and the legacy `http.url`/`http.target` are excluded by the span-processor allow-list (or undici auto-instrumentation is disabled for the carrier dispatcher and manual spans are created); the in-memory exporter test asserts a `requestorName` sentinel and an account-number sentinel never appear in any span attribute Afterwards `npm audit --omit=dev` reports 0 and `npm ls gcp-metadata` is empty
- PR #11 code review R3-m1 (ii) (first metrics task; D-ARCH-079): the leak counter sessionContextLeaks() exported by apps/api/src/platform/db/runtime.ts is published as the metric db_session_context_leak_total (api and worker) with an alert rule; the latched not-ready state stays visible in /health/ready
- PR #20 code review n8 / api/README §13 header (D-ORCH-025 (2); D-ARCH-084): the counter `security_events_total{event}` is published by the security sink for every catalogue and runtime event (label = event name only; no attribute label); PR20-SEC-17 — one per-line size budget charges `err` (cause chain) and the merged child bindings together with the fields (or err is capped at MAX_LINE_CHARS in total and child bindings at 2 KiB) so a line never exceeds the 16 KiB Docker json-file split, and the shipper partial-line handling is documented in the observability runbook
- IMAGE SIZE (D-ARCH-118 (e); ADR-0017 amendment 2026-11-14; rulings/wave-0-task-014-rulings.md section 4.3 (e); R-ARCH-31): no @opentelemetry/sdk-node — the SDK is assembled explicitly from sdk-trace-node, exporter-trace-otlp-http, resources, semantic-conventions and the five named instrumentations (registerInstrumentations); metrics stay on @prometheus-io/client; the CI exporter is InMemorySpanExporter of sdk-trace-base; the PR body shows @grpc/grpc-js, protobufjs and exporter-trace-otlp-grpc absent from the api and worker images and quotes the layer-sum delta against the TASK-283 baseline (expected about 8 MiB per image)
- RATE-LIMIT METRICS (D-ARCH-177; PR041-SEC-04; rulings/wave-1-task-041-rulings.md section 6 line 8): the rate-limit counters (labels: the classes, authz-denial, unauthenticated, step0-credentialed, step0-authn-failed) and the store-breaker state are exported; PR041-SEC-04: a key-count gauge for the rl: prefix next to the Valkey memory alarms of D-ARCH-160
- AT-US-013-01 … AT-US-013-06: all 6 scenarios of US-013, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-215 — Terraform modules and overlays validated with Checkov (never applied)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-OPS-004, NFR-SCALE-003 |
| Spikes / security / decisions | R-ARCH-13, D-002, D-ARCH-179, PR041-SEC-05, D-SD-004 |
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
- TRUST PROXY PIN (ADR-0016 amendment 12 item 9; D-ARCH-179; PR041-SEC-05): the api task definition sets TRUST_PROXY_HOPS=2; a Terraform test (or Checkov custom policy) fails unless that value, the CloudFront origin-facing prefix list on sg-alb and the ALB rule that refuses a request without X-Origin-Verify are all present; the post-deploy smoke step of PR041-SEC-05 (audit IP and access-log ip are never an ALB or CloudFront address) belongs to the first pipeline that deploys to a real target, a G4 precondition for a production release

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

### TASK-224 — Switch active organisation; organisation profile and creating a business organisation

| Field | Value |
|---|---|
| Stories (completes) | US-081 (M1 Should) Switch active organisation<br>US-082 (M1 Should) Organisation profile and creating a business organisation<br>US-061 **DC** (M0 Must) Organisation types and the single operator organisation |
| REQs | REQ-ORG-006, REQ-ORG-008, REQ-ORG-009, REQ-ORG-001 |
| NFRs | — |
| Spikes / security / decisions | D-028, D-ARCH-152, D-ORCH-131, D-PM-068, D-SD-001, PR65-SEC-02, D-SEC-PR65-01, D-ARCH-156, D-ORCH-137, D-SD-002 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-056, TASK-100 |
| Batch · locks | 7.9 · mod-organisations |
| Branch | `feat/TASK-224-switch-active-organisation-organisation-profile` |
| Priority | Must |

> Scheduling note: Scheduled in Wave 7 batch 7.9 by D-PM-068 and D-SD-001: it completes the M0 Must story US-061, so it is Must-band work due before G3 and not cuttable; its own Should stories US-081 and US-082 ride with it (a Should scenario that blocks the task may be deferred scenario by scenario while the routes ship); the ID keeps its Wave 8 numbering (idAt).

**Files / modules**
- apps/api/src/modules/organisations/{switch,profile}/**

**Acceptance tests to write**
- All US-081 and US-082 scenarios
- CONTRACT CHANGE FOR createOrganisation (D-ARCH-152: approved change request, exact YAML in rulings/wave-1-batch-1.1-rulings.md section 3.3, applied verbatim; api/README section 18 item 1: the contract changes in this PR, with the route): OrganisationCreateRequest gains the OPTIONAL property type - string, enum OPERATOR, BUSINESS_CUSTOMER, PARTNER, INDIVIDUAL, default BUSINESS_CUSTOMER; required and additionalProperties false do not change; OrganisationPatch stays without type; one more request example, type_refused; in api/README.md one line in the amendments list and the ORG_TYPE_NOT_ALLOWED row of section 11 reworded (a createOrganisation request for a type other than BUSINESS_CUSTOMER); npm run openapi:lint with 0 errors and npm run openapi:types, with the regenerated packages/shared/src/api/types.gen.ts in the same commit; the Joi schema mirrors the property (valid over the four values, default BUSINESS_CUSTOMER) and the handler passes the validated value to createOrganisation of TASK-037, which refuses everything but BUSINESS_CUSTOMER; the web form and its Zod schema never send type
- US-061 SCENARIOS THAT NEED THE ROUTES (D-ORCH-COORD-03 item 3, D-ORCH-131; D-ARCH-152), with the IDs in the test titles: AT-US-061-02 at the response - POST with type PARTNER, OPERATOR and INDIVIDUAL each answers 422 ORG_TYPE_NOT_ALLOWED and the organisations row count is unchanged, a value outside the enum answers 400 VALIDATION_ERROR, a request without type creates a BUSINESS_CUSTOMER organisation; AT-US-061-03 at the response - PATCH with type answers 400 VALIDATION_ERROR with sub-code UNKNOWN_FIELD; AT-US-061-04 - an anonymous POST answers 401 AUTH_REQUIRED; AT-US-061-05 - the refused PARTNER attempt leaves one audit entry with outcome FAILED, action CREATE and entity organisation, written outside the rolled-back transaction (REQ-AUDIT-010 writes no entry for a 400, which is why type must pass the schema). COMPLETES US-061 (D-PM-068); not cuttable; due before G3. TASK-037 carries the demo-critical part (AT-US-061-01 and the service and database halves of AT-US-061-02/03); if this task is unmerged at the Wave 7 exit, product-manager applies the rung-4 fallback of D-PM-068 (the route-level scenarios move to US-082 as appended scenarios) and the task returns to ladder rung 2
- PR65-SEC-02 (a) SWITCH ONLY INTO AN ACTIVE MEMBERSHIP (LOW, latent, CWE-269; D-SEC-PR65-01; D-ORCH-137; binding route condition): the organisation switch sets app.org_id only for an organisation in which the actor holds an ACTIVE membership, re-checked at the switch, never from a client value, a token claim or users.last_active_org_id alone; abuse case [PR65-SEC-02]: a customer switching to OPERATOR_ORG_ID gets 403 or 404 and no transaction opens with that context; createOrganisation is called with the creator as the transaction actor (rulings wave-1-pr65-r1 section 7; member = actor, D-ARCH-156)
- AT-US-081-01 … AT-US-081-05: all 5 scenarios of US-081, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-082-01 … AT-US-082-07: all 7 scenarios of US-082, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-061-01 … AT-US-061-05: US-061 completes here under the delivery split of D-PM-068: this task proves the scenarios that the card lines above assign to it and TASK-037 the rest, with the IDs in the test titles; the story is accepted when all 5 pass in `ac-trace.json` (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-282 — Developer README and CONTRIBUTING: verified command reference (install, build, typegen, db:generate, migrate, seed, test lanes, compose)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-105, D-SEC-PR38-01, D-ARCH-115, D-ORCH-001 |
| Specialist · model | technical-writer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-014, TASK-015, TASK-020 |
| Batch · locks | 7.9 · docs-dev |
| Branch | `feat/TASK-282-developer-readme-contributing-verified-command` |
| Priority | Enabler |

**Files / modules**
- README.md (repository root)
- CONTRIBUTING.md
- tools/repo/readme-commands.test.ts (every npm run script named in the two files exists in the root package.json; every documented repository path exists)

**Acceptance tests to write**
- D-ARCH-102..105 / D-SEC-PR38-01 (D-ARCH-115): the command reference lists npm run db:generate with when to run it (after a clone and after any prisma/schema change; nothing generates implicitly, npm run typegen only checks and fails with the text run npm run db:generate) and points to prisma/README.md for the import policy of @platform/prisma/client; it also lists npm ci --ignore-scripts, npm run deps:rebuild, npm run build, npm run typecheck, npm run lint, npm run format:check, the test lanes (test:unit, test:integration, test:api, test:e2e, test:coverage, quality:heavy --profile pr|wave|gate) and the compose commands of CLAUDE.md 2, with the Windows Node 24 PATH prefix note and the Docker Desktop requirement; the writer executes every command before documenting it and records the outputs in the PR body; CLAUDE.md 2 itself is edited only by the orchestrator
- Drift guard: tools/repo/readme-commands.test.ts runs in lane A (ci-policy suite) and fails when a documented npm run script is missing from package.json or a documented path does not exist

**DoD notes**
- Documentation task: no product code; the drift-guard test is the only code and needs no security record unless it touches an owned path
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-294 — TASK-W0-FLAKE-3-F: web prerender under host load (bounded-load measurement and the control decision), the under-load tables of the converted suites, and the lane B runner and test-lock leftovers

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-MAINT-002 |
| Spikes / security / decisions | D-ARCH-158, D-ARCH-146, D-ORCH-113, D-ORCH-124, D-ORCH-125, D-ORCH-127, D-TASK020-99, D-TASK288-15, D-TASK288-20, D-SEC-PR53-02, D-ORCH-139, D-SECPR291-02, D-SD-002 |
| Specialist · model | test-engineer · opus |
| Complexity | M |
| Depends on | TASK-291 |
| Batch · locks | 7.9 · quality-tools, tests-harness |
| Branch | `feat/TASK-294-task-w0-flake-3-f` |
| Priority | Enabler |

> Scheduling note: Late follow-up task (D-ARCH-158: re-specification of the TASK-291 prerender item under CLAUDE.md section 7) in the free slot of batch 7.9, so that it is due before the G3-ready checkpoint without holding the Wave 0 or Wave 1 exit; the orchestrator tracks it under its alias TASK-W0-FLAKE-3-F and may dispatch either part once TASK-291 has merged — part 294-A as a dedicated job of the serial lane B queue when the host is otherwise idle, and at once when the interim rule of docs/07-ops/CI-CD.md section 1 trips.

**Files / modules**
- docs/05-quality/performance/TASK-294-prerender-under-load.md (part 294-A: the measurement record — method, host spec, load recipe, raw tables, decision row)
- docs/07-ops/CI-CD.md (part 294-A: the interim section of section 1 is rewritten to the outcome)
- tools/quality/heavy.mjs (+ test) (part 294-B: pre-flight refusal of untracked run directories; the bounded build retry ONLY under decision row 2)
- tools/quality/inventory.mjs (+ test) (part 294-B: reference runs come from tracked run directories only)
- tools/test-support/{fs-lock.test.ts, lock-children.ts, fs-lock.ts} (part 294-B: PR #57 code review R3-n1, R3-n3 and R3-n2)
- tools/deps/prisma-engines.int.test.ts (part 294-B: D-TASK288-20; one test file outside the locks of this task)
- tests/generated/{loopback-scan.ts, loopback-ratchet.test.ts, loopback-fetch-allowlist.json} (part 294-B: PR #71 code review R2-n1, R2-n2, R1-n2, R1-n3)

**Acceptance tests to write**
- PARTS (D-ARCH-158): part 294-A is a measurement with a record and a decision — no product code and no tooling code, a docs-only PR; part 294-B is the code part, its own PR, and it does not wait for 294-A unless decision row 2 applies; neither part changes the product build, which stays ONE un-retried react-router build (workspace script, Dockerfiles, lane A, lane C): no wrapper script, no patch, fork or overrides entry for @react-router/dev and no change of the three prerendered paths (D-ARCH-146; ADR-0023 amendment O item 2)
- 294-A FACTS TO START FROM (read from @react-router/dev 8.5.1 dist/vite.js for D-ARCH-158; they correct the phase list of the TASK-291 card): the build-time prerender awaits the Vite preview server BEFORE it issues any request, so the preview-server start is outside the timed window; each request then gets its own AbortSignal.timeout of 10 s with retryCount 0, and prerender.concurrency (default 1) is the only setting; the first request (/en/, ahead of /es/, /fr/ and the SPA fallback) also pays the lazy import of the server bundle, which is cached for the later requests; one Node process both serves and issues the request, so a starved event loop delays both ends; by the source the failing build prints Prerender: Request failed for /en/: The operation was aborted due to timeout (the plugin words it Request timed out for only when the request carries an aborted signal, which this version never sets); no failing log was kept, so the record quotes the real line of the first reproduced failure and corrects the signature of docs/07-ops/CI-CD.md section 1 if it differs
- 294-A METHOD (replaces the words "the PR #53 load method" of the TASK-291 card: the PR #53 tables were taken on the host as it was then saturated by parallel heavy runs, a state the serial queue of D-ORCH-125 ended and no agent may recreate): one dedicated job of the serial lane B queue on an otherwise idle host — the queue lock held, no Testcontainers container outside the job, no other agent build or test run; the load is synthetic, bounded and written down: CPU-bound child processes, one per logical core, plus one file-churn child on the repository volume; no second heavy run and no memory pressure on purpose; free memory stays at or above 7 GB and the job stops and reports when it does not; the measured command is the unmodified workspace build script of @platform/web; a preload that only records timestamps is allowed in the measurement and is committed nowhere; no wall-clock assertion is added to any suite (D-SEC-PR53-02)
- 294-A DELIVER (docs/05-quality/performance/TASK-294-prerender-under-load.md): (1) 20 builds on the idle host and 20 under the bounded load, each with pass or fail, the failing line, and the time of the first request split as far as observation allows into reaching the handler, the server-bundle import and the render — when the split cannot be observed without changing the plugin the record says so and gives the first-request total; with host spec, Node and package versions and the load recipe; (2) the uses of the interim re-run rule recorded since D-ARCH-158, counted from the DECISIONS entries; (3) for each suite TASK-291 converted (tests/generated/route-metadata.test.ts, tests/generated/rls/api-cases.test.ts, tests/generated/rls/cross-tenant.int.test.ts) and for one read-lock importer under prisma/tests, 20 runs under the same load with the pass count — or the reference to the TASK-291 PR body when it already carries that table at the merged head; (4) the rate of Testcontainers start failures seen in (3) (P1001, port not bound, a container lost mid-run; D-TASK288-15), which are host capacity and never a product finding
- 294-A DECISION (decidable from the record; 20 builds cannot show a rate under 1 % — no failure in 20 still leaves a 95 % upper bound near 14 % — so the rows use the idle headroom and the counts that contradict 1 %): ROW 1, application or configuration — the median first-request time on the idle host is above 1 s (less than a tenfold margin under the fixed 10 s), or the record shows a change in apps/web or its configuration that removes the failures under the same load: reported to the orchestrator with the numbers for an apps/web task (outside the locks of this task), and the interim rule stays until that task merges; ROW 2, runner retry — otherwise, when at least 2 of the 20 loaded builds fail with the signature or the interim rule has tripped (either contradicts a 1 % rate at about the 2 % level): the bounded retry of part 294-B; ROW 3, standing rule — otherwise no code, and the re-run rule becomes a standing operator rule; in every row this part rewrites the interim section of docs/07-ops/CI-CD.md section 1 to the outcome and the orchestrator records it in DECISIONS; a threshold is challenged with the data through the orchestrator, never set aside by the developer
- 294-B RETRY, ONLY UNDER ROW 2 (D-ARCH-146, unchanged): tools/quality/heavy.mjs repeats npm run build at most twice, ONLY when the output of the failed attempt carries the prerender request-timeout signature; build_clean is computed after the last attempt; a deterministic failure still fails three times; the attempt count is printed in the run log and in summary.md; no summary.json schema change (a machine-readable attempt count is a qa-lead follow-up with a schema bump); once it is on main the queue stops re-running on its own
- 294-B LEFTOVERS ROUTED TO W0-FLAKE-3 AND NOT BUILT BY TASK-291 (D-ARCH-158): (a) D-ORCH-127 — the heavy.mjs pre-flight refuses untracked run directories under docs/05-quality with a named reason (today the queue script moves them aside), and tools/quality/inventory.mjs takes its reference runs from tracked run directories only (a leftover directory became the newest-only reference and failed the TASK-290 run); (b) PR #57 code review R3-n1 — the EBUSY rename hook in tools/test-support/fs-lock.test.ts gives up after a bound and the case asserts that the call count stayed small (a magnitude check, not a wall-clock bound), so the R2-m1 mutant fails in about a second instead of hanging lane A; (c) R3-n3 — the IDLE children of tools/test-support/lock-children.ts exit when their parent goes away (an ipc disconnect handler, a parent-pid poll or a lifetime cap), so a killed Jest worker leaves no node process on the host; (d) R3-n2 — the residual (ii) JSDoc of tools/test-support/fs-lock.ts states the outcome with the wx owner file; (e) D-TASK288-20 — tools/deps/prisma-engines.int.test.ts restores or keeps the verified engine when the download fails, so a network outage no longer leaves a worktree without its Prisma engine (D-ORCH-137)
- DUE (D-ARCH-158): part 294-A before the lane B gate run of G3, earlier at the first idle-host window, and as the next queue job when the interim rule trips (a failed re-run, or its second use within 20 consecutive queue runs) — the prerender half does not need TASK-291 on main and then runs alone, the suite tables follow; part 294-B before G3; a red table in 294-A (3) is a defect against that suite for the holder of its lock, not a change in this task
- 294-B ALSO CARRIES THE PR #71 REVIEW NITS (D-ORCH-139; PR-0071-TASK-291-code-review.md): (1) R2-n1 - pin the allow-list exactly, expect(ALLOW_LIST.map((e) => e.file)).toEqual(PINNED_CEILING), so a converted file that leaves the JSON leaves the pin in the same diff and a re-add is a pinned-test edit; (2) R2-n2 = R1-m1 (ii) - the loopback marker is name-based: either detect the bypass shapes of the review (template origins such as origin, url and baseUrl, base + path concatenation, [::1] without .listen(, destructured, bracket and .call forms of fetch) with a probe test per shape, or record the accepted limit in the scanner JSDoc and DECISIONS; (3) R1-n1 - the nested-read stall in tools/test-support/fs-lock.ts (a nested read in one process while a foreign writer is queued waits for the writer deadline): make a nested read in a process that already holds the read lock re-entrant, or state the limit with a test that shows the named failure; (4) R1-n2 - prisma/tests/ becomes a scan root and prisma/tests/spikes/spk04/runner.ts is listed with lock label prisma-core, or prisma/tests/spikes/ is excluded by name; (5) R1-n3 - strip comments with ts.createScanner (typescript is already a dependency) or state the regex limit in the JSDoc with the review probe as a test. The CODEOWNERS line /tests/generated/loopback-* stays; the pinned ceiling only shrinks (D-SECPR291-01)
- CONSUMER.INT FALLBACK (D-ORCH-139): if TASK-039 has merged without the [AT-US-009-04] race fix of its card (assert the dead-letter record only after settledFailure), part 294-B makes that fix in apps/worker/src/platform/queues/consumer.int.test.ts with the assertions unchanged; otherwise this line lapses

**DoD notes**
- Part 294-A is docs-only (lane A light mode, no heavy-lane evidence of its own): raw timings are attached as tables, the record names what could not be observed, and it adds no suite, no assertion and no build flag; the reviewer checks the decision row against the tables
- Part 294-B changes tools/quality (security-critical path, CODEOWNERS) and tools/test-support: a security record, and the lane B run of its head through the serial queue is the proof; tools/deps/prisma-engines.int.test.ts is one test file outside the locks of this task — edited only when no in-flight PR holds tools/deps, and the PR body says so (D-ORCH-118)
- A deviation from the method, a threshold or the part order is ruled through the orchestrator before the record merges: a developer decision does not replace a card deliverable (code review r1 of TASK-291, R1-M1)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`tools/test-support/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-227 — Invite members into a business organisation; accept an invitation

| Field | Value |
|---|---|
| Stories (completes) | US-083 (M1 Should) Invite members into a business organisation<br>US-084 (M1 Should) Accept an invitation |
| REQs | REQ-ORG-010, REQ-ORG-011 |
| NFRs | — |
| Spikes / security / decisions | SEC-COND-01, PR43-SEC-09, D-ARCH-123, D-067, D-PM-068, D-SD-001, D-ARCH-157, D-ARCH-154, D-ARCH-155, PR65-SEC-02, D-SEC-PR65-01, D-ORCH-137, D-SD-002 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-224, TASK-169, TASK-187 |
| Batch · locks | 7.10 · mod-organisations |
| Branch | `feat/TASK-227-invite-members-into-business-organisation` |
| Priority | Should |

> Scheduling note: Scheduled in Wave 7 batch 7.10 by D-PM-068 and D-SD-001: not cuttable while TASK-231 depends on it; the ID keeps its Wave 8 numbering (idAt).

**Files / modules**
- apps/api/src/modules/organisations/invitations/**

**Acceptance tests to write**
- All US-083 and US-084 scenarios
- INVITATION IS THE PENDING STATE (D-ARCH-123; product-manager D-067; PR43-SEC-09 (a)): inviting writes only the invitations row (PENDING, token hash, expires_at, role, locale) and never a memberships row nor a lookup of the address against users; 409 ALREADY_MEMBER compares the lower-cased address with the ACTIVE or SUSPENDED members of the inviting organisation only; acceptance creates the membership directly as ACTIVE with created_by = the accepting user (the actor of the acceptance transaction; D-ARCH-157 withdraws "created_by = the inviter", which platform.std_columns_guard refuses) and invitation_id set, the inviter being invitations.created_by reached through invitation_id and marks the invitation ACCEPTED in one transaction (audit: CREATE membership + UPDATE invitation, no token value); the pending-invitation list is served to holders of org:member:invite only (not org:read); api tests: after an invite no memberships row exists for the address, an organisation member cannot read the users row of the invitee before acceptance (RLS probe) and can after it
- NOT CUTTABLE WHILE TASK-231 DEPENDS ON IT (D-PM-068): member management needs the invite route (AT-US-085-05, inviting into an INDIVIDUAL organisation), so this task merges before G3 together with TASK-224 and TASK-231; US-083 and US-084 stay Should, and product-manager may defer one of their scenarios that blocks the task while the route ships; senior-developer may later propose dropping the members -> invite dependency (D-PM-068 alternatives), which would return this task to rung 2
- DISPATCH GATE (D-ARCH-157; D-ORCH-136/137): product-manager has updated the REQ-ORG-011 note and the two US-084 lines to "created_by = the accepting user, the invitation's created_by the inviter" before this task is dispatched; the AT-US-084 tests assert memberships.created_by = the accepting user and invitations.created_by = the inviter
- PR65-SEC-02 (a) ACCEPTANCE ONLY FROM A PENDING INVITATION (LOW, latent, CWE-269; D-SEC-PR65-01; binding route condition): acceptance inserts a membership only for a PENDING, unexpired invitation of the context organisation addressed to the accepting user's verified e-mail, and grants exactly the invitation's role (the database does not bind the role to invitations.role_id); abuse cases [PR65-SEC-02]: an expired, accepted or revoked invitation, an invitation of another organisation, an unverified or different e-mail, and a tampered role each create no membership
- RULINGS wave-1-pr65-r1 SECTION 7 (D-ARCH-155, D-ARCH-154): the service refuses an invitation into a non-BUSINESS_CUSTOMER organisation with 422 ORG_TYPE_RESTRICTION before the database does; acceptance runs as the accepting user; invitation_id must name an invitation of the same organisation (composite key)
- AT-US-083-01 … AT-US-083-12: all 12 scenarios of US-083, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-084-01 … AT-US-084-08: all 8 scenarios of US-084, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-231 — Manage members with last-Owner and individual-organisation safeguards

| Field | Value |
|---|---|
| Stories (completes) | US-085 (M1 Should) Manage members, last-Owner and individual-organisation safeguards<br>US-062 **DC** (M0 Must) Personal organisation and memberships with type-checked roles |
| REQs | REQ-ORG-012, REQ-ORG-013, REQ-ORG-014, REQ-ORG-002, REQ-ORG-003, REQ-ORG-004 |
| NFRs | NFR-SEC-011 |
| Spikes / security / decisions | SEC-COND-01, D-042, PR8-SEC-06, D-ARCH-069, D-ARCH-123, D-067, D-ORCH-131, D-PM-068, D-SD-001, PR65-SEC-04, D-SEC-PR65-01, D-ARCH-154, D-ORCH-137, D-SD-002 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-227, TASK-187 |
| Batch · locks | 7.11 · mod-organisations |
| Branch | `feat/TASK-231-manage-members-last-owner-individual` |
| Priority | Must |

> Scheduling note: Scheduled in Wave 7 batch 7.11 by D-PM-068 and D-SD-001: it completes the M0 Must story US-062, so it is Must-band work due before G3 and not cuttable; its own Should story US-085 rides with it; TASK-235 (team screens, US-268 and US-269) stays in Wave 8 and cuttable; the ID keeps its Wave 8 numbering (idAt).

**Files / modules**
- apps/api/src/modules/organisations/members/**
- apps/api/src/modules/organisations/members/assign-rank.property.test.ts (ASSIGNABLE_BY vs grants, fast-check)

**Acceptance tests to write**
- All US-085 scenarios
- PR8-SEC-06 consumer conditions (i)-(iv) (ADR-0008 am. 3 item 4; D-ARCH-069): a modify, suspend or remove passes `canAssignRole` for EVERY role the target member currently holds AND every role in the requested set (an Admin cannot act on an Owner+Viewer member through the Viewer role); `assignerRoleKeys` come from the actor ACTIVE membership in the TARGET organisation, read from the database, never from the token; the rank check is in addition to `org:member:invite`/`org:member:manage` and the 12 h step-up, never instead of them; self role change (REQ-ACCT-015) and LAST_OWNER (REQ-ORG-013) stay separate checks; AC-05 threat-model cases (Admin assigns Owner, Admin modifies an Owner, self role change) → 403/422
- PR #8 code review R2-n2: property test — for every allowed (assigner, target) pair in ASSIGNABLE_BY, `target.permissions ⊆ assigner.permissions` on the shipped catalogue; a mutated catalogue where the Admin loses a permission the Viewer keeps fails the property
- MEMBER LIST (D-ARCH-123; D-067): the member list holds ACTIVE and SUSPENDED memberships only (INVITED is reserved and never written); pending invitations are a separate list keyed by invitee e-mail (TASK-227), rendered only when the /me permissions include org:member:invite
- US-062 SCENARIOS DEFERRED FROM TASK-037 (D-ORCH-COORD-03 item 3, accepted in D-ORCH-131): AT-US-062-05 (permission denied on assigning roles) and AT-US-062-06 (audit of a membership change) need mounted member routes and are proven here, with the IDs in the test titles. COMPLETES US-062 (D-PM-068); not cuttable; due before G3. TASK-037 carries the demo-critical part (AT-US-062-01 to -04 and the change record of AT-US-062-06) and TASK-049 the creation clause of AT-US-062-06 at registration; if this task is unmerged at the Wave 7 exit, product-manager applies the rung-4 fallback of D-PM-068 (AT-US-062-05 and -06 move to US-085 as appended scenarios) and the task returns to ladder rung 2
- PR65-SEC-04 (d) ATTRIBUTION FROM THE ACTOR (INFO; D-SEC-PR65-01; PR #65 code review R2-n2, D-TASK037-27): membership_roles.granted_by and revoked_by, memberships.removed_by and accepted_by_user_id are derived from the transaction actor, never taken from the caller (today assignRole passes a caller-supplied grantedBy and the database binds only created_by and updated_by); one unit case per column with a mismatching caller value
- RULINGS wave-1-pr65-r1 SECTION 7 (D-ARCH-154): LAST_OWNER and owner-cap counts may rely on membership_roles.org_id (composite key); a removed member is re-added as a new row and REMOVED is never reversed
- AT-US-085-01 … AT-US-085-10: all 10 scenarios of US-085, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-062-01 … AT-US-062-06: US-062 completes here under the delivery split of D-PM-068: this task proves the scenarios that the card lines above assign to it and TASK-037, TASK-049 the rest, with the IDs in the test titles; the story is accepted when all 6 pass in `ac-trace.json` (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
