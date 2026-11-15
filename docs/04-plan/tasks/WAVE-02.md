# WAVE-02 — M0 demo-critical II: commerce core on Mock (carriers, pricing, quotes, state machine, Mock gateway, saga), notification core, admin audit UI

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Must DC**

Tasks: **22** (S 3 / M 19; opus 8 / sonnet 14; demo-critical 20) in **6** batches of ≤ 4 parallel tasks. Estimated effort ≈ 61.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** All 74 M0 DC stories merged; PRD §6.1 steps executable manually in compose; lane B `wave` evidence; lane C `wave-end` run #2 green.

**Stories completed in this wave (30):** US-003 (DC), US-008, US-032 (DC), US-049 (DC), US-050 (DC), US-095 (DC), US-097 (DC), US-098 (DC), US-121 (DC), US-122 (DC), US-124 (DC), US-126 (DC), US-138 (DC), US-139 (DC), US-140 (DC), US-154 (DC), US-155 (DC), US-156 (DC), US-173 (DC), US-197 (DC), US-198 (DC), US-199 (DC), US-200 (DC), US-201 (DC), US-202 (DC), US-203 (DC), US-278 (DC), US-279 (DC), US-280 (DC), US-282 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 2.1 | TASK-075 CarrierAdapter contract, CarrierContext, capability guard and normalisation to canonical codes<br>TASK-076 Pure pricing engine with integer money and rounding, billable weight<br>TASK-077 Admin landing page, permission-aware navigation and audit-viewer routes<br>TASK-078 Notification jobs created only from outbox events, idempotently | pkg-carriers-core<br>pkg-pricing<br>admin-nav<br>mod-notifications |
| 2.2 | TASK-079 Deterministic Mock carrier<br>TASK-080 Default margin pricing as itemised lines and sample pricing configuration<br>TASK-081 Audit viewer UI<br>TASK-082 Versioned templates with escaped, locale-aware rendering and recipient-locale fallback | pkg-carriers-mock<br>pkg-pricing<br>admin-audit<br>mod-notifications-templates |
| 2.3 | TASK-083 Rate-shopping fan-out with per-carrier deadlines and partial results<br>TASK-084 Shipment state machine core with transition history and same-transaction audit<br>TASK-085 Payment gateway interface, deterministic Mock gateway and payment record with status history<br>TASK-086 Verification, reset and security e-mails always sent | mod-quotes-rateshop<br>mod-shipments<br>mod-payments<br>mod-notifications |
| 2.4 | TASK-087 Quote entity with 24 h expiry; shipment direction, content type and package type<br>TASK-088 Order number allocation<br>TASK-089 Seed demo organisations, users per role and Mock configuration<br>TASK-090 Audit partition pre-creation scheduled job and maintenance queue | mod-quotes<br>mod-orders<br>prisma-seed<br>worker-audit-maint |
| 2.5 | TASK-091 Guest quoting with capability token and rate limits<br>TASK-092 Mock booking saga end to end<br>TASK-279 Playwright harness | mod-quotes<br>mod-orders-saga<br>e2e-harness |
| 2.6 | TASK-093 Quote input validation and package limits<br>TASK-094 Saga idempotent replay and exactly one carrier shipment<br>TASK-280 k6 harness | mod-quotes<br>mod-orders-saga<br>tests-load |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

## Task specifications

### TASK-075 — CarrierAdapter contract, CarrierContext, capability guard and normalisation to canonical codes

| Field | Value |
|---|---|
| Stories (completes) | US-121 **DC** (M0 Must) CarrierAdapter contract, CarrierContext and capability guard<br>US-124 **DC** (M0 Must) Normalisation to canonical codes |
| REQs | REQ-CARR-001, REQ-CARR-002, REQ-CARR-003, REQ-CARR-007 |
| NFRs | NFR-MAINT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-001, TASK-002 |
| Batch · locks | 2.1 · pkg-carriers-core |
| Branch | `feat/TASK-075-carrieradapter-contract-carriercontext-capability-guard` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/carriers/src/{adapter.ts, context.ts, capabilities.ts, normalise/**}
- packages/carriers/src/adapters/<carrier>/egress.ts contract (EGRESS rules per environment: exact origin + path prefixes + tier; derived from enabled accounts, no env override)

**Acceptance tests to write**
- All US-121 and US-124 scenarios
- ADR-0010 am. 11 items 2, 3 and 6 (D-ARCH-057 rev 2): `capabilities().operations` carries a boolean for every optional operation, for `cancelShipment` and for the new optional `recoverLabel(ref, formats, ctx)` (idempotent, retryable, transactional pool); the guard answers CAPABILITY_NOT_SUPPORTED without network I/O for any operation declared unsupported (unit test per operation incl. cancelShipment and recoverLabel); `LabelDocument.format` is a `document_format` value only (PDF_4X6 | PDF_A4 | PDF_LETTER | ZPL) — raster output never leaves the adapter except as a raw-payload `$blob`; each real adapter exports `EGRESS: { sandbox: EgressRule[], production: EgressRule[] }` (`{ origin, pathPrefixes, tier }`, exact origins, no wildcards) and the outbound rule set is the union over enabled accounts of EGRESS[account.environment] plus the Stripe rules — no configuration key can add a rule; `packages/config` refuses a carrier account with environment = production unless APP_ENV = production; carrier-supplied URLs are never dereferenced
- D-ARCH-106 (ADR-0005 am. 11 item 20): the binding names under which module code receives the carrier port (carriers, carrierGateway) are added to the names option of platform/no-external-calls-in-tenant-tx with one fixture, in the PR that first wires the port into module code
- AT-US-121-01 … AT-US-121-07: all 7 scenarios of US-121, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-124-01 … AT-US-124-05: all 5 scenarios of US-124, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-076 — Pure pricing engine with integer money and rounding, billable weight

| Field | Value |
|---|---|
| Stories (completes) | US-138 **DC** (M0 Must) Pure pricing engine with integer money and rounding<br>US-139 **DC** (M0 Must) Billable weight calculation |
| REQs | REQ-PRICE-001, REQ-PRICE-002, REQ-PRICE-004 |
| NFRs | NFR-DATA-001, NFR-QUAL-002 |
| Spikes / security / decisions | PR40-SEC-05, D-ARCH-115 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-001, TASK-002 |
| Batch · locks | 2.1 · pkg-pricing |
| Branch | `feat/TASK-076-pure-pricing-engine-integer-money` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/shared/src/money/**
- packages/pricing/src/{engine.ts, billable-weight.ts, rounding.ts}

**Acceptance tests to write**
- All US-138 and US-139 scenarios (fast-check properties)
- PR #2 code review m10 (routed here): when the branded Minor type lands in packages/shared/src/money/**, tools/eslint-rules/money-arith.mjs gains a type-aware branch (parserServices -> checker: an operand type carrying the Minor brand is reported) with the name heuristic kept as fallback and a typed negative fixture
- PR40-SEC-05 / PR #40 code review R1-m4 (a) (D-ARCH-115): this task lands the first measured packages/pricing and packages/shared/src/money sources, which activates their 95/95 critical scopes in tools/ci/coverage-gate.mjs; the PR body quotes the merged lines and branches of both scopes from the lane B evidence, and in the first activation checkpoint after it merges qa-lead adds coverage gate: packages/pricing lines, coverage gate: packages/pricing branches, coverage gate: packages/shared/src/money lines and coverage gate: packages/shared/src/money branches to unit.required_cases (manifest-only PR with a security record)
- AT-US-138-01 … AT-US-138-06: all 6 scenarios of US-138, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-139-01 … AT-US-139-06: all 6 scenarios of US-139, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- 95 % coverage on packages/pricing
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-077 — Admin landing page, permission-aware navigation and audit-viewer routes

| Field | Value |
|---|---|
| Stories (completes) | US-032 **DC** (M0 Must) Admin landing page, permission-aware navigation and audit-viewer routes |
| REQs | REQ-ADMIN-005, REQ-ADMIN-006, REQ-ADMIN-009 |
| NFRs | NFR-A11Y-002 |
| Spikes / security / decisions | D-UX-022 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-071, TASK-064 |
| Batch · locks | 2.1 · admin-nav |
| Branch | `feat/TASK-077-admin-landing-page-permission-aware` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/admin/app/routes/{_index.tsx, audit/*.tsx (route shells)}

**Acceptance tests to write**
- All US-032 scenarios (S-D04; no placeholder pages)
- AT-US-032-01 … AT-US-032-07: all 7 scenarios of US-032, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-078 — Notification jobs created only from outbox events, idempotently

| Field | Value |
|---|---|
| Stories (completes) | US-278 **DC** (M1 Must) Create notification jobs only from outbox events, idempotently |
| REQs | REQ-NOTIF-014 |
| NFRs | NFR-RES-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-074, TASK-043, TASK-047 |
| Batch · locks | 2.1 · mod-notifications |
| Branch | `feat/TASK-078-notification-jobs-created-only-outbox` |
| Priority | Must · demo-critical |

> Scheduling note: M1 DC enabler pulled into M0 (D-PLAN-003).

**Files / modules**
- apps/worker/src/processors/notifications/from-outbox.*
- prisma/schema/notifications.prisma + migration (notification_jobs)

**Acceptance tests to write**
- All US-278 scenarios
- AT-US-278-01 … AT-US-278-07: all 7 scenarios of US-278, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-079 — Deterministic Mock carrier (rates, createShipment with label, cancel, track baseline)

| Field | Value |
|---|---|
| Stories (completes) | US-122 **DC** (M0 Must) Deterministic Mock carrier |
| REQs | REQ-CARR-004 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | D-062, D-ARCH-084 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-075 |
| Batch · locks | 2.2 · pkg-carriers-mock |
| Branch | `feat/TASK-079-deterministic-mock-carrier` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/carriers/src/adapters/mock/**

**Acceptance tests to write**
- All US-122 scenarios (same input -> same output; one shipment per client reference)
- AT-US-008-03 Mock-carrier hop (D-062): every Mock adapter operation emits exactly one outbound carrier-call log line through the TASK-010 `outboundCallFields` allow-list with correlation_id = CarrierContext.correlationId and no request or response body, and the call record it returns carries that correlation ID so the saga carrier_call audit entry can cite it — this lands the PR #20 code review §5 rule "carrier adapters must use outboundCallFields" on the first adapter, which DHL, FedEx and UPS copy
- D-ARCH-106 (ADR-0005 am. 11 item 21): the Mock latency scenario is the instrument of the runtime twin of the T-83 lint: the API test lanes run with DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS=1000, so a route that keeps a transaction open across a carrier call fails a test
- AT-US-122-01 … AT-US-122-06: all 6 scenarios of US-122, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-080 — Default margin pricing as itemised lines and sample pricing configuration

| Field | Value |
|---|---|
| Stories (completes) | US-140 **DC** (M0 Must) Default margin pricing as itemised lines |
| REQs | REQ-PRICE-003 |
| NFRs | NFR-DATA-001 |
| Spikes / security / decisions | D-010 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-076, TASK-075 |
| Batch · locks | 2.2 · pkg-pricing |
| Branch | `feat/TASK-080-default-margin-pricing-as-itemised` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/pricing/src/lines/margin.ts
- prisma/schema/pricing.prisma + migration (pricing_config_versions minimal)
- prisma/seed/reference/pricing-sample.ts

**Acceptance tests to write**
- All US-140 scenarios (15 % default margin, itemised USD)
- AT-US-140-01 … AT-US-140-05: all 5 scenarios of US-140, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-081 — Audit viewer UI: filterable list and entry detail with field diff, hashes and chain status

| Field | Value |
|---|---|
| Stories (completes) | US-097 **DC** (M0 Must) Audit viewer: filterable list<br>US-098 **DC** (M0 Must) Audit viewer: entry detail with diff, and audited viewing |
| REQs | REQ-AUDIT-019, REQ-AUDIT-023, REQ-AUDIT-020, REQ-AUDIT-022 |
| NFRs | NFR-A11Y-002, NFR-COMPAT-002 |
| Spikes / security / decisions | D-UX-023 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-073, TASK-077, TASK-054 |
| Batch · locks | 2.2 · admin-audit |
| Branch | `feat/TASK-081-audit-viewer-ui-filterable-list` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/admin/app/routes/audit/**
- apps/admin/locales/*/audit.json

**Acceptance tests to write**
- UI scenarios of US-097 and US-098 (S-D05, S-D06; filters in URL, apply on submit)
- M0 demo step "Audit entries appear in the viewer"
- AT-US-097-01 … AT-US-097-10: all 10 scenarios of US-097, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-098-01 … AT-US-098-08: all 8 scenarios of US-098, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-082 — Versioned templates with escaped, locale-aware rendering and recipient-locale fallback

| Field | Value |
|---|---|
| Stories (completes) | US-279 **DC** (M1 Must) Versioned templates with escaped, locale-aware rendering<br>US-280 **DC** (M1 Must) Resolve recipient locale with fallback to en |
| REQs | REQ-NOTIF-005, REQ-NOTIF-006 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-074 |
| Batch · locks | 2.2 · mod-notifications-templates |
| Branch | `feat/TASK-082-versioned-templates-escaped-locale-aware` |
| Priority | Must · demo-critical |

> Scheduling note: M1 DC enabler pulled into M0 (D-PLAN-003).

**Files / modules**
- apps/api/src/modules/notifications/templates/** (en/es/fr)
- prisma/schema/notifications.prisma (templates) + migration

**Acceptance tests to write**
- All US-279 and US-280 scenarios
- AT-US-279-01 … AT-US-279-08: all 8 scenarios of US-279, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-280-01 … AT-US-280-07: all 7 scenarios of US-280, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-083 — Rate-shopping fan-out with per-carrier deadlines and partial results

| Field | Value |
|---|---|
| Stories (completes) | US-126 **DC** (M0 Must) Rate-shopping fan-out with deadlines and partial results |
| REQs | REQ-CARR-008 |
| NFRs | NFR-PERF-002, NFR-PERF-003, NFR-RES-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-079, TASK-080 |
| Batch · locks | 2.3 · mod-quotes-rateshop |
| Branch | `feat/TASK-083-rate-shopping-fan-out-per` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/quotes/rate-shopper/**

**Acceptance tests to write**
- All US-126 scenarios (hung carrier -> named partial at 4 s; overall 5 s; AbortSignal cancels within 1 s)
- D-ARCH-106: no tenant transaction is open while carriers are called; the caller persists each result in its own short tenant transaction as it arrives
- AT-US-126-01 … AT-US-126-08: all 8 scenarios of US-126, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-084 — Shipment state machine core with transition history and same-transaction audit

| Field | Value |
|---|---|
| Stories (completes) | US-197 **DC** (M0 Must) Shipment state machine core<br>US-198 **DC** (M0 Must) Transition history and same-transaction audit |
| REQs | REQ-BOOK-018, REQ-BOOK-019 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-030 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-029, TASK-032, TASK-043 |
| Batch · locks | 2.3 · mod-shipments |
| Branch | `feat/TASK-084-shipment-state-machine-core-transition` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/shipments.prisma + migration (shipments, shipment_state_history)
- apps/api/src/modules/shipments/{state-machine.ts, service.ts, repository.ts, events.ts}

**Acceptance tests to write**
- All US-197 and US-198 scenarios (transition table DR-B01)
- AT-US-197-01 … AT-US-197-06: all 6 scenarios of US-197, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-198-01 … AT-US-198-05: all 5 scenarios of US-198, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-085 — Payment gateway interface, deterministic Mock gateway and payment record with status history

| Field | Value |
|---|---|
| Stories (completes) | US-199 **DC** (M0 Must) Payment gateway interface and deterministic Mock gateway<br>US-200 **DC** (M0 Must) Payment record with status history |
| REQs | REQ-PAY-001, REQ-PAY-002, REQ-PAY-003 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | D-011, PR40-SEC-05, D-ARCH-115 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-032, TASK-029 |
| Batch · locks | 2.3 · mod-payments |
| Branch | `feat/TASK-085-payment-gateway-interface-deterministic-mock` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/payments.prisma + migration (payments, payment_status_history)
- apps/api/src/modules/payments/{gateway/payment-gateway.ts, gateway/mock-gateway.ts, service.ts, repository.ts}

**Acceptance tests to write**
- All US-199 and US-200 scenarios
- D-ARCH-106 (ADR-0005 am. 11 item 20): the binding names under which module code receives the payment gateway (paymentGateway, gateway) are added to the names option of the T-83 lint with one fixture; every gateway call runs in a call phase or in the worker, never inside a tenant transaction
- PR40-SEC-05 / PR #40 code review R1-m4 (a) (D-ARCH-115): the D-QA-003 money-path scope of tools/ci/coverage-gate.mjs and TEST-STRATEGY 8 is the folder apps/api/src/modules/payments/service/**, while this task lists apps/api/src/modules/payments/service.ts, a file the scope does not match; before merging, place the money-moving service code under apps/api/src/modules/payments/service/** (preferred) or ask qa-lead to re-point the scope with a D-QA decision, so the scope activates with this task; the PR body quotes the merged lines and branches of the scope, and in the first activation checkpoint after it merges qa-lead adds coverage gate: apps/api/src/modules/payments/service lines and branches to unit.required_cases (manifest-only PR with a security record)
- AT-US-199-01 … AT-US-199-07: all 7 scenarios of US-199, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-200-01 … AT-US-200-05: all 5 scenarios of US-200, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-086 — Verification, reset and security e-mails always sent (auth event -> template map subset)

| Field | Value |
|---|---|
| Stories (completes) | US-282 **DC** (M1 Must) Verification, reset and security mails always sent |
| Stories (partial; completed by TASK-169) | US-277 **DC** (M1 Must) Map every domain event to exactly one template |
| REQs | REQ-NOTIF-007, REQ-NOTIF-004 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | D-050 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-082, TASK-078, TASK-049, TASK-059 |
| Batch · locks | 2.3 · mod-notifications |
| Branch | `feat/TASK-086-verification-reset-security-e-mails` |
| Priority | Must · demo-critical |

> Scheduling note: M1 DC story pulled into M0 (D-PLAN-003).

**Files / modules**
- apps/api/src/modules/notifications/event-map/auth.ts
- templates auth.* (en/es/fr)

**Acceptance tests to write**
- All US-282 scenarios (verification e-mail arrives in Mailpit in the user locale)
- US-015/US-016 e-mail assertions now executable end to end
- AT-US-282-01 … AT-US-282-10: all 10 scenarios of US-282, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-277-01 … AT-US-277-06 that belong to its layer; US-277 closes in TASK-169

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-087 — Quote entity with 24 h expiry; shipment direction, content type and package type

| Field | Value |
|---|---|
| Stories (completes) | US-154 **DC** (M0 Must) Quote entity with 24 h expiry<br>US-173 **DC** (M0 Must) Shipment direction, content type and package type |
| REQs | REQ-QUOTE-001, REQ-BOOK-027, REQ-BOOK-028 |
| NFRs | NFR-DATA-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-083, TASK-051, TASK-029, TASK-070 |
| Batch · locks | 2.4 · mod-quotes |
| Branch | `feat/TASK-087-quote-entity-24-h-expiry` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/quotes.prisma + migration (quotes, quote_packages, quote_options; GUEST_CAPABLE)
- apps/api/src/modules/quotes/{routes,controller,service,repository,schemas,events}.ts

**Acceptance tests to write**
- All US-154 and US-173 scenarios
- AT-US-154-01 … AT-US-154-09: all 9 scenarios of US-154, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-173-01 … AT-US-173-07: all 7 scenarios of US-173, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-088 — Order number allocation (number_sequences, UPDATE ... RETURNING)

| Field | Value |
|---|---|
| Stories (completes) | US-201 **DC** (M0 Must) Order number allocation |
| REQs | REQ-BOOK-026 |
| NFRs | NFR-SCALE-002 |
| Spikes / security / decisions | D-032 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-023, TASK-032 |
| Batch · locks | 2.4 · mod-orders |
| Branch | `feat/TASK-088-order-number-allocation` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/orders.prisma + migration (number_sequences, orders minimal)
- apps/api/src/modules/orders/numbering/**

**Acceptance tests to write**
- All US-201 scenarios (no gaps under 2 replicas, format per D-032)
- AT-US-201-01 … AT-US-201-08: all 8 scenarios of US-201, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-089 — Seed demo organisations, users per role and Mock configuration

| Field | Value |
|---|---|
| Stories (completes) | US-050 **DC** (M0 Must) Seed demo organisations, users and Mock configuration<br>US-003 **DC** (M0 Must) One-command local environment<br>US-049 **DC** (M0 Must) Idempotent reference and demo seed framework |
| REQs | REQ-DATA-003, REQ-PLAT-005, REQ-DATA-001, REQ-DATA-002 |
| NFRs | NFR-OPS-001 |
| Spikes / security / decisions | D-022, SEC-P3-14, D-061, PR13-SEC-02, PR13-SEC-08, D-ARCH-079 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-023, TASK-037, TASK-049, TASK-079, TASK-080, TASK-013, TASK-014 |
| Batch · locks | 2.4 · prisma-seed |
| Branch | `feat/TASK-089-seed-demo-organisations-users-per` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/seed/demo/**
- compose.env SEED_* placeholders

**Acceptance tests to write**
- All US-050 scenarios
- US-003 completion: first `docker compose up` ends healthy and seeded within the NFR-OPS-001 budget
- AT-US-049-05, -09, -10-1, -10-2 (D-061 item 2; this task COMPLETES US-049 — TASK-023 framework, TASK-014 AT-02; dependency on TASK-014 added): the real DemoUserProvisioner replaces the TASK-023 DEFERRED_PROVISIONER (D-TASK023-01 (04), temporary per D-ORCH-016 (2)); local/test create the demo users with the seeded passwords and send no link; staging creates staff without a password and sends one SET_PASSWORD link per staff user through the reset flow, visible in Mailpit, having read no SEED_* variable; the summary reports deferred = 0; no password or token value in stdout or logs (the TASK-023 fast-check secrecy properties are extended to the real provider; PR #13 n4: the planned SEED_* values and the decoded URL password are pushed into the redaction secrets set; PR13-SEC-08: planSecrets covers seeded-password plans only — set-password tokens never enter an error message, or the provisioner adds them to the redaction list); the TASK-023 test asserting created: 0, deferred: 14 is replaced; PR13-SEC-02 GATE: the assertNotLocalOnEcs refusal test (APP_ENV local|test with a non-empty ECS_CONTAINER_METADATA_URI / _V4 -> SEED_ENVIRONMENT_INVALID, exit 1 before connecting) exists on main before DEFERRED_PROVISIONER is replaced (met in PR #13 fix cycle 1; re-assert); PR #13 n3: the provisioner wiring passes a pg.Client, never a pg.Pool (BEGIN, the advisory lock and COMMIT must share one connection); the "demo data are present" clause of AT-US-049-02 and US-003 AT-01 close here
- AT-US-050-01 … AT-US-050-07: all 7 scenarios of US-050, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-003-01 … AT-US-003-04: all 4 scenarios of US-003, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-049-01 … AT-US-049-10: all 10 scenarios of US-049, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-090 — Audit partition pre-creation scheduled job and maintenance queue

| Field | Value |
|---|---|
| Stories (completes) | US-095 **DC** (M0 Must) Monthly partitions, indexes and partition-creation job |
| REQs | REQ-AUDIT-016, REQ-AUDIT-017 |
| NFRs | NFR-AUDIT-002 |
| Spikes / security / decisions | D-ARCH-093, PR24-SEC-10, D-ARCH-099 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-039, TASK-021 |
| Batch · locks | 2.4 · worker-audit-maint |
| Branch | `feat/TASK-090-audit-partition-pre-creation-scheduled` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/worker/src/processors/audit-maintenance/partitions.*
- docs/07-ops/runbooks/audit-partition-squat.md

**Acceptance tests to write**
- US-095 job scenarios (current + 3 months always exist; failure raises health degradation)
- SQUAT RUNBOOK (data-model §5.2 amendment of 2026-11-13; PR #24 code review R2-n1; D-ARCH-093): docs/07-ops/runbooks/audit-partition-squat.md says what the audit_partition_squatted event and the audit_partitions readiness unavailable mean (kind, reason, partition_name), carries the per-kind removal table — droppable by the migrator: type, enum, range/multirange, domain, composite type, sequence, procedure, aggregate; refused by the sql_drop branch and needing a superuser to suspend platform_audit_ddl_guard_drop, DROP, and ENABLE ALWAYS again in ONE transaction: table, view, materialised view, index, function — the post-checks (evtenabled A on both event triggers, ensure_audit_partitions(3) ok, readiness back to ok), the operator-log and second-reviewer requirement, and the rule that prisma/bootstrap/90-audit-ddl-guard.sql is never edited for a runbook change; rehearsed on a local database for one droppable kind and one table squat (the rehearsal transcript goes into the PR report)
- CIC LEFTOVER SECTION OF THE RUNBOOK (PR24-SEC-10 LOW, PR #24 security r2; data-model §5.2 amendment of 2026-11-13, second block; D-ARCH-099): the runbook covers a refused CREATE INDEX CONCURRENTLY under an audit name — the guard refuses it with 42501, but the build phases are already committed and leave an INVALID (indisvalid false) migrator-owned index under the audit name, after which every other DDL by the migrator is refused by the end-of-command invariant and DROP INDEX is refused by sql_drop even for a superuser; detection: readiness audit_partitions unavailable with kind i, plus the audit_partition_squatted event; recovery with exactly ONE leftover: as the migrator ALTER INDEX the leftover RENAME TO a non-audit name, then DROP INDEX the renamed index; recovery with TWO OR MORE leftovers (renaming either is refused while the other remains; DROP INDEX a, b and DROP TABLE of the carrying table are refused) or whenever the rename is refused: cluster-superuser break-glass in ONE transaction — BEGIN; SET LOCAL event_triggers = off; DROP INDEX each leftover; COMMIT — never ALTER ROLE or ALTER DATABASE ... SET event_triggers; afterwards evtenabled = A on both event triggers, ensure_audit_partitions(3) succeeds and readiness is back to ok; the runbook also corrects the R2-n1 break-glass: with only the sql_drop trigger disabled, dropping ONE of several squats is still refused by the end-of-command invariant, so every squat is dropped in the same DROP command or the SET LOCAL form is used; prevention: DATABASE_MIGRATOR_URL exists only in the migrate/seed job environment (PR13-SEC-08) and a direct session with that credential is an operator-log event; at M5 whether the RDS master can set event_triggers is COND-G4-PROD M5 check (d), and until it is known the runbook states that the two-leftover recovery on RDS is unproven; rehearsed on a local database with one leftover and with two (transcript in the PR report)
- AT-US-095-01 … AT-US-095-06: all 6 scenarios of US-095, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-091 — Guest quoting with capability token and rate limits (createQuote not idempotency-stored)

| Field | Value |
|---|---|
| Stories (completes) | US-155 **DC** (M0 Must) Guest quoting with access token and rate limits |
| REQs | REQ-QUOTE-002 |
| NFRs | NFR-PERF-002, NFR-SEC-005 |
| Spikes / security / decisions | SEC-P3-10, SEC-P3-15, D-ARCH-012, D-ARCH-109, D-TASK020-41, D-SEC-PR38-02, D-ARCH-113, PR38-SEC-03, PR48-SEC-04, PR48-SEC-06, D-SEC-PR48-01, D-ARCH-134 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-087, TASK-041, TASK-044 |
| Batch · locks | 2.5 · mod-quotes |
| Branch | `feat/TASK-091-guest-quoting-capability-token-rate` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/quotes/guest-token/**

**Acceptance tests to write**
- All US-155 scenarios
- SEC-TC-54 (server part): token rejected 7 days after quote expiry; never logged
- M0 demo step "Guest gets a mock quote" via API/Swagger within 1.5 s
- D-ARCH-107 (ADR-0008 am. 4): the quote-token authenticator applies to routes whose auth set contains quote-token (getQuote, streamQuoteResults): a bearer, when present, decides alone; otherwise a well-formed X-Quote-Token yields a guest principal (credential quote-token, authenticated false, no actor, guestTokenHash = lowercase hex SHA-256) and a missing or malformed token answers 404 NOT_FOUND with private, no-store, never 401 (A-078); createQuote (auth anonymous or session, permissionAuthenticated quote:create) branches on principal.credential. D-ARCH-106 (ADR-0003 am. 2026-11-13): createQuote starts the fan-out in its afterCommit phase (best-effort, in process, not durable): a fan-out lost to a crash must end as per-carrier timeouts at the 5 s deadline, never as a stream that does not complete (test); no tenant transaction is open while carriers are called
- D-ARCH-109 (ADR-0008 am. 5 item 1): X-Quote-Token is read as a credential only on routes whose auth set contains quote-token; createQuote ignores the header (it returns the token and never takes one), and on claimQuote, saveQuote and createShipment the header is a declared companion that the handler checks against the quote, never an authenticator; a refresh cookie on getQuote or streamQuoteResults is ignored (404 when there is no bearer and no token)
- D-TASK020-41 / D-SEC-PR38-02 AUTHENTICATOR CONTRACT (ADR-0008 am. 6 item 2; D-ARCH-113): the quote-token authenticator learns that X-Quote-Token is present only through presentedKinds(req.headers, route.auth) on getQuote and streamQuoteResults (when session is also present the bearer authenticator decides and the token header is never read, spy), builds the guest principal permissions with readonlySet holding exactly the quote read permissions the route needs, calls markCredentialsRead(res) together with its decision, and answers a missing or malformed token with 404 NOT_FOUND (A-078) whose private, no-store comes from the descriptor test ([session, quote-token] has no anonymous member), not from the authenticator; COMPANION CASE (ADR-0008 am. 6 item 1 (b)): on claimQuote, saveQuote and createShipment, whose auth set is exactly [session], x-quote-token is declared in schema.headers as the contract declares the QuoteToken header parameter there (route-metadata companion parity, 020-C), and the handler compares the SHA-256 of the presented value with the stored guest_token hash in constant time, never stores or logs the raw value and never treats it as authentication; on every other route schema.headers may not name it (defineRoute refuses it at module load); api tests: a bearer plus a token on getQuote ignores the token, a token alone yields a guest principal whose permissions view throws on mutation, a malformed token is 404 private, no-store, and claimQuote with a wrong token is 404 while the quote stays unclaimed
- PR48-SEC-04 deny-404 (LOW; D-SEC-PR48-01 (4); D-ARCH-134; DUE before this task merges): the RBAC matrix generator gains the outcome deny-404 (REFUSALS[deny-404] = { status: 404, code: NOT_FOUND }, symbol 404, private, no-store); for a route whose auth set is exactly [session, quote-token] rule 1 gives deny-404 when no usable credential is presented (none, a refresh cookie, an expired bearer) and rule 2 gives a guest principal for a well-formed unknown token (the handler answers 404) and deny-404 for a malformed one — ADR-0008 am. 5 item 1 and A-078; the committed matrix is regenerated (the 8 cells of getQuote and streamQuoteResults change from 401), the D-ARCH-107 test title no longer calls 401 the expected answer, the US-155 wrong-token and missing-token api tests and the matrix agree, and the security record of this PR covers tests/generated/rbac (owned path)
- RBAC MATRIX SEAM RETIREMENT, quote-token kind (PR48-SEC-06; PR #48 code review R1-m3; D-ARCH-134): this task deletes the quote-token branch of resolvePrincipal in tests/generated/rbac/matrix-app.ts and presents a real X-Quote-Token (a guest quote minted by the test) through the real authenticate slot; regenerated matrix, drift test green, the still-stubbed-kinds tripwire of TASK-052 passes
- AT-US-155-01 … AT-US-155-11: all 11 scenarios of US-155, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-092 — Mock booking saga end to end (API -> outbox -> queue -> worker -> Mock carrier)

| Field | Value |
|---|---|
| Stories (completes) | US-202 **DC** (M0 Must) Mock booking saga end to end (API, queue, worker)<br>US-008 (M0 Must) Correlation ID and structured, redacted logging |
| REQs | REQ-BOOK-020, REQ-PLAT-011, REQ-PLAT-012 |
| NFRs | NFR-OBS-003, NFR-PERF-004, NFR-RES-005 |
| Spikes / security / decisions | D-031, D-062, D-ARCH-084 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-084, TASK-085, TASK-088, TASK-079, TASK-047, TASK-040, TASK-043 |
| Batch · locks | 2.5 · mod-orders-saga |
| Branch | `feat/TASK-092-mock-booking-saga-end-end` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/orders.prisma + migration (saga_executions, saga_steps)
- apps/api/src/modules/orders/booking-saga/**
- apps/worker/src/processors/booking/**

**Acceptance tests to write**
- All US-202 scenarios (DRAFT -> ... -> LABEL_READY; Mock carrier called exactly once)
- AT-US-008-03 END TO END (D-062; this task COMPLETES US-008): one integration test titled with AT-US-008-03 POSTs the M0 booking with X-Correlation-Id: demo-booking-0001, runs the saga through the worker on the Mock carrier and asserts that exactly that value appears in the api log lines, every audit entry of the booking (STATE_TRANSITION entries and the carrier_call entry), the outbox row, the BullMQ payload v2, the worker log lines and the Mock carrier call record; US-008 reads Implemented only when TASK-010, TASK-029, TASK-035, TASK-043, TASK-079 and this task are merged
- AT-US-202-01 … AT-US-202-07: all 7 scenarios of US-202, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-008-01 … AT-US-008-06: all 6 scenarios of US-008, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-279 — Playwright harness: 8 projects, CSP/header/console listeners, route inventory, state helpers, keyboard-only mode, Mailpit client, PAN scanner, log collector, test-data CLI

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-A11Y-002, NFR-COMPAT-002, NFR-QUAL-006 |
| Spikes / security / decisions | T-QA-05 |
| Specialist · model | e2e-test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-014, TASK-068, TASK-069, TASK-074 |
| Batch · locks | 2.5 · e2e-harness |
| Branch | `feat/TASK-279-playwright-harness-8-projects-csp` |
| Priority | Enabler |

**Files / modules**
- tests/e2e/{playwright.config.ts projects, fixtures/**, helpers/mailpit.ts, helpers/pan-scanner.ts, tools/test-data-cli.ts}

**Acceptance tests to write**
- 8 projects run; listeners fail a test on CSP violation, missing security header or console error
- Mailpit client reads a verification e-mail by recipient

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-093 — Quote input validation and package limits (limit-based exclusion reasons)

| Field | Value |
|---|---|
| Stories (completes) | US-156 **DC** (M0 Must) Quote input validation and package limits |
| REQs | REQ-QUOTE-003, REQ-QUOTE-004 |
| NFRs | NFR-SEC-009 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-091, TASK-070 |
| Batch · locks | 2.6 · mod-quotes |
| Branch | `feat/TASK-093-quote-input-validation-package-limits` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/quotes/schemas.ts
- packages/shared/src/limits/** (shared with Zod)

**Acceptance tests to write**
- All US-156 scenarios
- AT-US-156-01 … AT-US-156-12: all 12 scenarios of US-156, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-094 — Saga idempotent replay and exactly one carrier shipment

| Field | Value |
|---|---|
| Stories (completes) | US-203 **DC** (M0 Must) Saga idempotent replay and one carrier shipment |
| REQs | REQ-BOOK-021 |
| NFRs | NFR-RES-005, NFR-SCALE-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-092 |
| Batch · locks | 2.6 · mod-orders-saga |
| Branch | `feat/TASK-094-saga-idempotent-replay-exactly-one` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/orders/booking-saga/replay.*

**Acceptance tests to write**
- All US-203 scenarios (same Idempotency-Key -> same order, no second booking; worker crash mid-step)
- AT-US-203-01 … AT-US-203-07: all 7 scenarios of US-203, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-280 — k6 harness: scenarios and profiles, handleSummary to JSON + JUnit, host-spec.json, volume seeder

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-AUDIT-005, NFR-PERF-001, NFR-PERF-006, NFR-PERF-007 |
| Spikes / security / decisions | T-QA-06, SPK-04, R-ARCH-04, D-ORCH-031, D-ARCH-085, D-ARCH-088, D-ARCH-089, PR27-SEC-02, PR27-SEC-03, PR27-SEC-04, D-SEC-PR27-01, D-ARCH-100 |
| Specialist · model | performance-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-014, TASK-276 |
| Batch · locks | 2.6 · tests-load |
| Branch | `feat/TASK-280-k6-harness-scenarios-profiles-handlesummary` |
| Priority | Enabler |

**Files / modules**
- tests/load/{compose.k6.yml, lib/**, profiles/**, seed-volume.ts}
- root script test:load
- tests/load/audit-ab.js (ported from tests/load/spikes/spk04-audit.js)
- tests/load/lib/{arm-loop, cpu-sampler, verdict (+ unit test), evidence-writer} (ported from prisma/tests/spikes/spk04/{runner.ts, verdict.ts})

**Acceptance tests to write**
- A k6 run writes JSON + JUnit + host-spec.json; INCONCLUSIVE when dropped_iterations > 1 % or host CPU > 85 % for > 10 % of the run
- Volume seeder creates 100k/1M-row datasets for list and query-plan tests
- SPK-04 audit-ab SCENARIO (TEST-STRATEGY §7.10; NFR-AUDIT-005 method as reworded 2026-11-13; ADR-0007 am. 10 item 6; D-ARCH-088): the NFR-PERF-001 mix with a HOT-TENANT SHARE of 20 % of all traffic on one organisation stream, the fail-closed VIEW second transaction inside the route latency, audit on (release api image) versus the build-time -bench image (never a runtime flag), >= 2 repetitions per rate with RANDOMISED arm order, the delta computed PER REPETITION; pass = mean of the valid per-repetition deltas within budget (p95 <= 15 ms, p99 <= 40 ms) and no valid repetition over twice the budget; the INCONCLUSIVE rule is applied per repetition; the summary reports hot-stream lock-wait p95 (audit_lock_wait_ms, TASK-030) and the SERVICE_UNAVAILABLE / AUDIT_LOCK_TIMEOUT / TENANT_CONCURRENCY_LIMIT counts per arm
- CLEAN 300 RPS RUN BEFORE G3 (D-ORCH-031 (2); STATUS Top Risk 6; ADR-0007 am. 10 item 4 trigger): one audit-ab run at 300 rps on a quiet or native-Linux Docker host with host-spec.json recorded and both repetitions valid — exit: budget met AND hot-stream lock-wait p95 <= 5 ms AND zero pool-exhaustion SERVICE_UNAVAILABLE; if not met, principal-architect decides lever (b) hot-tenant sub-streams by superseding amendment before G3; the A-029 re-baseline (150 rps clean with audit on on the shared Windows host) is recorded with the run
- SPK-04 LIFECYCLE (D-ARCH-089): once audit-ab drives the real api and -bench images, port tests/load/spikes/spk04-audit.js to tests/load/audit-ab.js and the runner arm loop, CPU sampler, verdict logic (+ its unit test) and evidence writer into tests/load/lib, then DELETE prisma/tests/spikes/spk04/** (server.ts, runner.ts, verdict.ts, verdict.test.ts, fixtures/**) and tests/load/spikes/** in the same commit
- HARNESS HARDENING ON PORT (PR27-SEC-03 and -04 INFO, PR27-SEC-02 INFO and PR #27 code review R1-m4; D-SEC-PR27-01; D-ARCH-100 item 4): the replica starter ported into tests/load/lib passes an explicit environment built from an allow-list (PATH, SYSTEMROOT, TEMP, TMP, NODE_ENV and the SPK04_* or AUDIT_AB_* keys), never the whole process environment — a unit test over the spawn options shows that a canary variable set in the test process is absent in the child; the load server binds the constant 127.0.0.1 and the SPK04_BIND override is deleted (the same two edits are made in prisma/tests/spikes/spk04/server.ts and runner.ts if those files are touched before the lifecycle deletion), with a grep test that server.ts reads no process.env other than SPK04_* names; the k6 container runs with --cap-drop=ALL --security-opt=no-new-privileges --read-only --tmpfs /tmp --pids-limit=256 --memory=1g on a user-defined network (or --add-host=host.docker.internal:host-gateway on Linux) instead of the default bridge, with --pull=never after a one-time pull by digest, and the image digest lives in one constant that a test compares with host-spec.json and the manifest; a unit test over the docker run argument list asserts the flags, an image reference that matches @sha256: followed by 64 hex digits, no -e key outside the allow-list and a read-only script mount; the -v mount pattern is not copied into .github/workflows; the integrity step of audit-ab asserts the PRODUCT state (no audit_entries RLS row, tgenabled A on every audit trigger, evtenabled A on both event triggers, the four superuser legs plus TRUNCATE) and never the SPK-08 prototype values FORCE RLS, O and O — a planted ENABLE TRIGGER in origin mode makes it fail, and an exception inside the integrity step fails the run closed with an INTEGRITY_FAILED verdict instead of exit 0

**DoD notes**
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
