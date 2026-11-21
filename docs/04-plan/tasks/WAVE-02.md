# WAVE-02 — M0 demo-critical II: commerce core on Mock (carriers, pricing, quotes, state machine, Mock gateway, saga), notification core, admin audit UI

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Must DC**

Tasks: **22** (S 3 / M 19; opus 8 / sonnet 14; demo-critical 20) in **6** batches of ≤ 4 parallel tasks. Estimated effort ≈ 61.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** 71 of the 74 M0 DC stories complete and US-061, US-062 and US-080 partial (the demo-critical part of US-061 and US-062, TASK-037, merged; completed by TASK-224 and TASK-231 in Wave 7, D-PM-068; the demo-critical part of US-080, TASK-051 and TASK-091, merged; completed by TASK-146 in Wave 5, D-PM-087) when part 044-B of TASK-044 is on main, otherwise 70 of the 74 with US-042 partial as well and part 044-B due before the `v0.1.0-m0` tag (D-PM-089); the exit record states which; PRD §6.1 steps executable manually in compose; lane B `wave` evidence; lane C `wave-end` run #2 green.

**Stories completed in this wave (31):** US-003 (DC), US-008, US-010 (DC), US-032 (DC), US-049 (DC), US-050 (DC), US-095 (DC), US-097 (DC), US-098 (DC), US-121 (DC), US-122 (DC), US-124 (DC), US-126 (DC), US-138 (DC), US-139 (DC), US-140 (DC), US-154 (DC), US-155 (DC), US-156 (DC), US-173 (DC), US-197 (DC), US-198 (DC), US-199 (DC), US-200 (DC), US-201 (DC), US-202 (DC), US-203 (DC), US-278 (DC), US-279 (DC), US-280 (DC), US-282 (DC).

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

Shared hot files (D-ORCH-118, D-ARCH-147): `api-tenant-db` = `apps/api/src/platform/db/tenant-db.*`, `apps/api/src/platform/db/with-tenant-tx.*`, `apps/api/src/platform/db/raw-statement.*`; `api-tx-execute` = `apps/api/src/platform/tx/**`; `api-platform-core` = `apps/api/src/app.*`, `apps/api/src/start-api.*`, `apps/api/src/main.*`; `api-routing` = `apps/api/src/platform/routing/pipeline.*`; `lint` = `eslint.config.mjs`. A card whose planned files name one of them holds that lock (the generator fails otherwise); a PR that needs such a file without holding the lock stops and asks the orchestrator for it first, so two in-flight PRs never edit the same shared file.

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
| Spikes / security / decisions | D-ARCH-180, D-ARCH-183, D-ARCH-184, D-QG-002, R-ARCH-37, SEC-P3-08, D-SD-006, D-ARCH-189, D-ARCH-190, D-SECPR043-01, D-SD-007 |
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
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (notification_log, the notification row table of data-model 4.2; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- HANDLER RULES (ADR-0004 amendment 2 items 12 and 15; R-ARCH-37; D-ARCH-184): a handler registers by type, claims processed_events (consumer, event_id) in the transaction of its effect, does database work only and names its follow-up job by a row it wrote; it reads the current state of the aggregate and never derives state from the order of events; test: two events of one aggregate delivered in reverse end in the same state (the published_at predicate of the token_enc overwrite is withdrawn by D-ARCH-190: see TOKEN OVERWRITE); the handler is written as apply and followUps (ADR-0004 amendment 3 item 20); followUps never misses a row that still needs its job
- TOKEN OVERWRITE (ADR-0004 amendment 3 item 21; D-ARCH-190; QG-043-C3): after the send is recorded the consumer removes token_enc with one UPDATE by event id through a port under apps/*/src/platform/outbox, without a published_at predicate, and fails the job unless exactly one row was updated; the overwrite is a step of its own, so a retry never sends twice; tests: the token is removed (a) while an open relay tick still holds the event row and (b) after a relay tick that rolled back, the relay then publishes the row once and two events of the aggregate keep their order in the queue; an overwrite that updates no row fails the job; no column of this task is a foreign key onto outbox_events
- TOKEN_ENC HOUSEKEEPING OWNER (ADR-0004 amendment 1, SEC-P3-08; D-ARCH-183; D-QG-002 QG-043-C6; owner assigned by D-SD-006): this task builds the 24 h housekeeping that removes payload.token_enc and token_enc_key_id from outbox events older than 24 h; it takes pg_advisory_xact_lock(478216878200) in the transaction of its statement (ADR-0004 amendment 2 item 14); it is a scheduled job under the D-SECPR039-01 conditions (age predicate in its own SQL, batches, idempotentProcessor keyed by the occurrence id, a closed SCHEDULE_NAMES entry of at most 47 characters); tests: a row 23 h old keeps its token, a row 25 h old loses it and nothing else of the payload changes, and the statement waits for a held relay lock
- SECURITY CONDITIONS T078-1 TO T078-5 (D-SECPR043-01; QG-043-C3 confirmed): T078-1 the statement is SET payload = payload - token_enc together with version = version + 1 and the standard columns the guard requires (updated_at, updated_by), WHERE id = the event id; every SET expression is relative to the row, and the id is the only predicate (no published_at, no version equal to the read value, no test that the payload still holds token_enc); T078-2 its own short transaction that holds no other row lock while it waits, its wait bounded by lock_timeout, the job retry repeats it, and the 24 h housekeeping is the accepted backstop only after the retries are exhausted; T078-3 one port under apps/*/src/platform/outbox/** that takes only the event id (callers never pass SQL, columns or a payload), and this task migration adds payload to the column-level UPDATE grant of PR043-SEC-05; T078-4 the overwrite logs the event id and the row count only, never the token, the ciphertext or the payload, token_enc stays in the redaction set and becomes SEC in the classification registry; T078-5 tests besides those above: a retry after a committed overwrite counts one row and succeeds, and an overwrite after the 24 h housekeeping already removed the field counts one row
- AT-US-278-01 … AT-US-278-07: all 7 scenarios of US-278, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-079 — Deterministic Mock carrier (rates, createShipment with label, cancel, track baseline)

| Field | Value |
|---|---|
| Stories (completes) | US-122 **DC** (M0 Must) Deterministic Mock carrier |
| REQs | REQ-CARR-004 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | D-062, D-ARCH-084, D-SD-003, PR075-SEC-14, D-SECPR075-03, D-SD-004, PR076-SEC-06, D-SECPR076-01 |
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
- AT-US-121-02 ON THE REAL MOCK (TASK-075 code review R1-n9): capabilityIssues runs on the real Mock declaration under the same AT id; TASK-075 proved the validator on a fake
- LABEL FIXTURES (TASK-075 code review R3-m1; PR075-SEC-14; D-SECPR075-03): the adapter returns raw { format, content } and never builds a LabelDocument itself; every real PDF and ZPL label fixture of this adapter passes createLabelDocument and the sniffers (a blank or BOM lead byte and a %PDF- marker past offset 0 included in the fixture review)
- PR076-SEC-06 (INFO, CWE-693; D-SECPR076-01): if this task adds the first subpath export to @platform/carriers (a ./testing entry for the Mock adapter is the likely one), it also adds the any-spelling control: a repository test that pins the carriers exports map to its entries and refuses app and package imports of the subpath outside tests, or a boundaries dependency.source arm (that one edits eslint.config.mjs and needs the lint lock from the orchestrator); if not, the line moves to the first task that adds one
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
| Spikes / security / decisions | D-010, D-TASK075-02, D-TASK075-10, D-SD-003, D-ARCH-168 |
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
- CARRIER MONEY IS ADR-0009 MONEY (TASK-075 code review R1-m6; D-TASK075-10): CarrierMoney in packages/carriers/src/canonical/types.ts becomes the Money shape of ADR-0009 section 3 from @platform/shared (amount as branded minor units, ISO 4217 currency), so the pricing boundary needs no field mapping; a shared carrier decimal string to minor units helper without parseFloat
- CANONICAL VOCABULARIES TO packages/shared (D-TASK075-02, accepted for TASK-075 with the planned move; first consumer is this task): CARRIER_ERROR_CODES, TRACKING_STATUSES, DOCUMENT_FORMATS and the surcharge codes move from packages/carriers to packages/shared, with a parity test against the OpenAPI enums in packages/shared/src/api/types.gen.ts (ADR-0010 amendment 12 item 2; D-ARCH-168): packages/carriers re-exports each moved list so no adapter import changes; the request and response types of the port stay in packages/carriers; the moved lists go to the browser-safe side of packages/shared
- AT-US-140-01 … AT-US-140-05: all 5 scenarios of US-140, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
- packages/ui/src/components/Pagination/** (part B of TASK-045, D-TASK045-01)

**Acceptance tests to write**
- UI scenarios of US-097 and US-098 (S-D05, S-D06; filters in URL, apply on submit)
- M0 demo step "Audit entries appear in the viewer"
- PAGINATION COMPONENT (D-TASK045-01, part B of TASK-045; D-SD-011): this task builds the UI Pagination component in packages/ui/src/components/Pagination for cursor pages (next and previous from the cursors of the list response, no page numbers or totals unless include_total is asked), with all strings in en/es/fr, keyboard and screen-reader states, 360 px and 1280 px layouts and a unit test; later list screens reuse it
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
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-083 — Rate-shopping fan-out with per-carrier deadlines and partial results

| Field | Value |
|---|---|
| Stories (completes) | US-126 **DC** (M0 Must) Rate-shopping fan-out with deadlines and partial results |
| REQs | REQ-CARR-008 |
| NFRs | NFR-PERF-002, NFR-PERF-003, NFR-RES-006 |
| Spikes / security / decisions | D-SD-006, D-ARCH-222, D-QG-007, D-SD-012 |
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
- PR #77 code review n9: the DR-B34 eligibility compares package dimensions orientation-free, with the same rule as the Mock limitViolation (best as a shared helper in packages/carriers/src/capabilities.ts), so a 100 x 1200 x 800 box that the Mock would quote is not excluded
- EXPLANATION ENTRIES STAY OPERATOR-SIDE (D-SECPR080-01 routing; TASK-080 security record PR-0081 section 8): the explanation entries of PricingResult (rule key, rate, priority) are classified INT, so a customer-facing response carries the charge lines only, unless a ruling says otherwise; the task that serialises PricingResult into a quote response asserts that no explanation field reaches it
- FAN-OUT SIGNAL (ADR-0010 amendment 14; ADR-0016 amendment 14 item 5; D-ARCH-222): the fan-out takes one AbortSignal, the one its caller passes (the afterCommit signal of createQuote: the shutdown drain or the afterCommit deadline), and hands it to CarrierContext; the phrase AbortSignal cancels within 1 s on this card means that signal; the fan-out service has no parameter for a request signal or a stream signal, and a reader of the quote that goes away cancels nothing
- DISPATCH GATE, A STOP AND A FAN-OUT IN FLIGHT (D-QG-007 QG-044-C6; principal-architect; before this task is dispatched): a ruling says what a stop does to a fan-out in flight: either the fan-out is not aborted at the drain and runs to its 5 s overall deadline (far below the 25 s drain bound), or the cut is accepted and the two-instance test of TASK-141 (its STREAM DISCIPLINE line) says which instance ran createQuote and what complete reports for the carriers that were cut; the ruling names the two signals apart: the drain signal of ADR-0003 rule (m) aborts before the listener closes, the shutdown drain of the afterCommit phase aborts after it; the FAN-OUT SIGNAL line follows the ruling
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
| Spikes / security / decisions | D-030, D-ARCH-180, D-ARCH-184, D-ARCH-185, R-ARCH-37 |
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
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (shipments; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- EVENT TYPE SEQUENCING (ADR-0004 amendment 2 item 12; D-ARCH-184): the event file packages/shared/src/events/<module>.ts merges only after outbox-relay has its processor (TASK-047); the TASK-043 worker test fails otherwise; and the PUBLISH RULE (ADR-0004 amendment 2 item 14; R-ARCH-37; D-ARCH-185): outbox.publish is called after the write that locks the aggregate row (the UPDATE of the transition or the INSERT of a new aggregate), or after SELECT ... FOR UPDATE on that row when the transaction only adds child rows; code-reviewer checks each publisher against it
- AT-US-197-01 … AT-US-197-06: all 6 scenarios of US-197, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-198-01 … AT-US-198-05: all 5 scenarios of US-198, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-085 — Payment gateway interface, deterministic Mock gateway and payment record with status history

| Field | Value |
|---|---|
| Stories (completes) | US-199 **DC** (M0 Must) Payment gateway interface and deterministic Mock gateway<br>US-200 **DC** (M0 Must) Payment record with status history |
| REQs | REQ-PAY-001, REQ-PAY-002, REQ-PAY-003 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | D-011, PR40-SEC-05, D-ARCH-115, D-ARCH-180, D-ARCH-202, D-ARCH-205, D-QG-004, D-SD-010, D-SECPR040-04, D-PM-086 |
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
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (payments; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- SIMULATED GATEWAY (ADR-0012 amendment 6; ADR-0003 amendment 2026-11-20 rule (j) as corrected; D-ARCH-205; QG-040-C7): the interface of ADR-0012 section 1 keeps one authorise; capabilities().simulated is true for the Mock gateway and false for every other adapter; the Mock answers mock_ok and the other outcome tokens synchronously, as US-199 says; the gateway contract suite gains one assertion that runs for every adapter with simulated false: authorise never returns AUTHORISED and creates its intent unconfirmed (first run on the Stripe fixtures of TASK-167); configuration keeps refusing the Mock gateway in production; DISPATCH (D-SD-010): QG-040-C7 is answered by D-ARCH-205, the concurrence of security-analyst on its item (c) is D-SECPR040-04 (conditions C-1 and C-2 below), and the confirmation of product-manager on its item (d) is D-PM-086 (US-199 and AT-US-202-01 read as written) (INTENT IN TWO STEPS of D-ARCH-202 is withdrawn and not folded)
- SIMULATED GATEWAY SECURITY CONDITIONS (D-SECPR040-04 C-1 and C-2; SEC-TC-24; T-71): C-1 simulated is a constant of the adapter class, never configuration or request input; the composition refuses any payment adapter whose capabilities().simulated is true when APP_ENV=production, so the refusal keys on the capability and not only on the provider name; SEC-TC-24 gains that case: an adapter declaring simulated: true in a production composition ends the start; C-2 the suite assertion runs for every adapter registered with simulated: false, and a planted adapter returning AUTHORISED from authorise makes the suite fail (a negative control)
- AT-US-199-01 … AT-US-199-07: all 7 scenarios of US-199, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-200-01 … AT-US-200-05: all 5 scenarios of US-200, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
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
| Spikes / security / decisions | D-ARCH-162, D-ARCH-163, D-SD-003, D-ARCH-168, D-SD-004, D-ARCH-180, D-ARCH-184, D-ARCH-185, R-ARCH-37, D-ARCH-208, D-ARCH-215, D-ARCH-216, PR051-SEC-04, D-SD-011, D-QG-007, D-SD-012 |
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
- QUOTE TABLES AS AMENDED 2026-11-19 (D-ARCH-162, D-ARCH-163; data-model 3.10; rulings/wave-1-r-arch-34-operator-rulings.md section 2.8): ux_quotes__org_id_id and ux_quotes__guest_token_hash_id; quote_packages and quote_options reference quotes through the owner-bound pair with no single-column key; ux_quote_packages__org_quote_seq (partial on org_id IS NOT NULL) and ux_quote_packages__guest_quote_seq replace ux_quote_packages__quote_seq and ix_quote_packages__org_quote; requote_of_quote_id has the composite key through org_id, ck_quotes__requote_org_only and the entry fk_quotes__requote_of_quote_id in TENANT_REFERENCE_EXCEPTIONS; every read and write of a child carries the owner predicate next to quote_id; C16 is the gate
- CANONICAL LISTS (ADR-0010 amendment 12 item 2; D-ARCH-168; data-model 1.7): a canonical list that packages/carriers already holds is moved to packages/shared and re-exported, never written a second time
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (quotes; also the soft-deleted quote: the row resolves, and the processor reads it in the tenant transaction, finds it deleted and completes without effect; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- EVENT TYPE SEQUENCING (ADR-0004 amendment 2 item 12; D-ARCH-184): the event file packages/shared/src/events/<module>.ts merges only after outbox-relay has its processor (TASK-047); the TASK-043 worker test fails otherwise; and the PUBLISH RULE (ADR-0004 amendment 2 item 14; R-ARCH-37; D-ARCH-185): outbox.publish is called after the write that locks the aggregate row (the UPDATE of the transition or the INSERT of a new aggregate), or after SELECT ... FOR UPDATE on that row when the transaction only adds child rows; code-reviewer checks each publisher against it
- UNIQUE KEYS ARE NULLS DISTINCT (D-ARCH-208, D-ARCH-215; ADR-0005 amendment 15 item 38; data-model 4.7 U2 as amended 2026-11-21): a uniqueness rule that holds for guest rows and for organisation rows is two indexes, one per owner column, each created with the default NULLS DISTINCT; never NULLS NOT DISTINCT, which C16 (b) reports on a nullable owner column; and never one index over both owner columns: C16 (b) reports that index only under NULLS NOT DISTINCT, and under the default NULLS DISTINCT it passes C16 (b) and enforces nothing, because the owner CHECK leaves one owner column NULL on every row; that shape is caught by the review of the migration against data-model 3.10 and by the duplicate cases, which this task runs on the real quote_packages table as platform_app: a second package with a seq the same quote already holds is refused with 23505 ux_quote_packages__guest_quote_seq for a guest row (case G6 of rulings section 2.7) and with 23505 ux_quote_packages__org_quote_seq for an organisation row (case T5), and a free seq is accepted for both (cases G5 and T4); the entry fk_quotes__requote_of_quote_id of TENANT_REFERENCE_EXCEPTIONS names its CHECK ck_quotes__requote_org_only, which C16 verifies (D-ARCH-209)
- C16 (c) AND (d) (D-QG-005 conditions QG-051-C1 (a) and QG-051-C6; D-ARCH-215, D-ARCH-216; data-model 4.6 C16 as amended 2026-11-21; rulings section 8.12): arms (c) and (d) of C16 are merged before this task opens its PR (they are TASK-298, plan fold D-SD-011; MERGE PREREQUISITE); every relation of the quote models states onDelete: Restrict and onUpdate: Restrict, because Prisma defaults an optional relation, which both relations of an owner-bound pair are, to SetNull on delete and Cascade on update; no constraint of this migration is NOT ENFORCED and none is left NOT VALID
- OWNER COLUMN ASSIGNER (PR051-SEC-04, INFO, CWE-696; D-SECPR051-01; D-QG-005 QG-051-C2): the de-claim guard trigger of TASK-051 is the only refusal for a childless quote and for a child moved under the guest quote, and a later-sorting BEFORE UPDATE trigger that assigns an owner column bypasses it; a catalog assertion lists every BEFORE UPDATE row trigger of a GUEST_CAPABLE table and reports one, other than the guard itself, whose function assigns NEW.org_id or NEW.guest_token_hash (an assigner row for owner columns), with a planted assigning trigger on a probe table that is reported and rolled back; the quote tables have none; the template pin of the guard trigger is TASK-051 (code review R1-m2)
- DISPATCH GATE, PERSISTED EVENT SEQUENCE (D-QG-007 QG-044-C7; principal-architect with database-engineer; before this task is dispatched, and in any case before TASK-141 is dispatched): data-model gives the per-quote event sequence a place: the column or table that carries it, unique per quote, with its allocation rule when two carriers answer at once, and the rule for carrier_error (persisted with a number, or sent without an id like error); quote_options of data-model 3.10 has no sequence column, one carrier_result event holds several options and carrier_error has no row; the ruling names the card (this task or TASK-083) that builds it, and this card gains the line; if carrier_error is ruled to be sent without an id, the REQ-CARR-009 note and the US-135 note return to product-manager (D-PM-089)
- AT-US-154-01 … AT-US-154-09: all 9 scenarios of US-154, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-173-01 … AT-US-173-07: all 7 scenarios of US-173, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-088 — Order number allocation (number_sequences, UPDATE ... RETURNING)

| Field | Value |
|---|---|
| Stories (completes) | US-201 **DC** (M0 Must) Order number allocation |
| REQs | REQ-BOOK-026 |
| NFRs | NFR-SCALE-002 |
| Spikes / security / decisions | D-032, D-ARCH-180 |
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
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (orders; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- AT-US-201-01 … AT-US-201-08: all 8 scenarios of US-201, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-089 — Seed demo organisations, users per role and Mock configuration

| Field | Value |
|---|---|
| Stories (completes) | US-050 **DC** (M0 Must) Seed demo organisations, users and Mock configuration<br>US-003 **DC** (M0 Must) One-command local environment<br>US-049 **DC** (M0 Must) Idempotent reference and demo seed framework |
| REQs | REQ-DATA-003, REQ-PLAT-005, REQ-DATA-001, REQ-DATA-002 |
| NFRs | NFR-OPS-001 |
| Spikes / security / decisions | D-022, SEC-P3-14, D-061, PR13-SEC-02, PR13-SEC-08, D-ARCH-079, D-ARCH-151, D-ARCH-153, D-PM-070, PR65-SEC-02, D-SEC-PR65-01, D-ARCH-156, D-ORCH-137, D-SD-002, D-ARCH-165, D-SD-003 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-023, TASK-037, TASK-049, TASK-079, TASK-080, TASK-013, TASK-014, TASK-051 |
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
- OPERATOR ORGANISATION IS NOT SEEDED (D-ARCH-151; ADR-0005 amendment 12; data-model 9.1 and 9.3 as amended 2026-11-18; supersedes D-TASK037-04): the one OPERATOR organisation exists from the TASK-037 migration in every environment; the demo seed resolves it by OPERATOR_ORG_ID from @platform/shared, never inserts or renames an organisation of type OPERATOR, and the seed id for the operator organisation is withdrawn; AT-US-061-01 is NOT owned here (it stays on TASK-037); US-050 scenario 1 is unchanged (the OPERATOR organisation has 8 users). A staff user takes two tenant transactions, because a transaction has one app.org_id: the registration path of TASK-049 in the context of the personal organisation, then the ACTIVE membership and the operator role through the organisations service in the context of OPERATOR_ORG_ID; a test shows that a re-run after a failure between the two finds the user by e-mail and adds the missing membership. The staff-provisioning function (user without credentials outside local and test, membership, role, SET_PASSWORD link) is exported from the service layer and is not private to prisma/seed/demo, because the M5 first-staff command reuses it (D-ARCH-153, R-ARCH-33); no raw SQL and no migrator connection writes users, organisations or memberships
- OPERATOR STAFF GRANT (D-ARCH-165; rulings/wave-1-r-arch-34-operator-rulings.md section 3.4): per staff user the seed runs the registration path, then writes the grant through the migrator connection of the seed CLI (INSERT INTO public.operator_staff_grants ... ON CONFLICT (user_id) DO NOTHING, created_by and updated_by = the SYSTEM actor), then adds the ACTIVE membership and the operator role in the context of OPERATOR_ORG_ID with the staff user as actor; the staff-provisioning function exported from the service layer takes the grant step as a one-method port whose only implementation is in the seed lane, and a repository test shows no module under apps/ implements it; tests: a self-join into the operator organisation without a grant gives P0001, the provisioned join succeeds, a re-run after a failure between any two steps completes, and exactly the 8 staff users have a grant; the grant migration is TASK-051 (dependency added by D-SD-003), merged before this task opens its PR
- MEMBER = ACTOR IN EVERY SEED TRANSACTION (rulings wave-1-pr65-r1 section 7; D-ARCH-156): every transaction that inserts a membership has app.actor_id = the member (the second staff transaction and the Acme members); the seed never inserts a membership for a user under another actor
- STAFF GRANT READS (PR051-SEC-05, INFO, CWE-200; D-SECPR051-01; D-QG-005 QG-051-C2): the staff list is readable by every session and module (ruled); the repository test of OPERATOR STAFF GRANT also covers reads: no file under apps/ or packages/ outside the seed lane reads the operatorStaffGrant model or the operator_staff_grants table, with a positive control planted in the test
- AT-US-050-01 … AT-US-050-07: all 7 scenarios of US-050, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-003-01 … AT-US-003-04: all 4 scenarios of US-003, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-049-01 … AT-US-049-10: all 10 scenarios of US-049, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-090 — Audit partition pre-creation scheduled job and maintenance queue

| Field | Value |
|---|---|
| Stories (completes) | US-095 **DC** (M0 Must) Monthly partitions, indexes and partition-creation job |
| REQs | REQ-AUDIT-016, REQ-AUDIT-017 |
| NFRs | NFR-AUDIT-002 |
| Spikes / security / decisions | D-ARCH-093, PR24-SEC-10, D-ARCH-099, D-SECPR039-01, D-SD-004 |
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
- SCHEDULE CONDITIONS (D-SECPR039-01 ruling on D-TASK039-01, conditions (i) to (iv)): for every schedule this task adds, (i) parameters come from code or configuration, never from the job; (ii) a destructive or non-idempotent handler applies its own policy predicate (purges by age), and if it writes it runs through idempotentProcessor keyed by the occurrence id; (iii) SCHEDULE_NAMES stays closed, with the one-queue check and the processor refusal kept, and a name of at most 47 characters; (iv) a run-now action goes through the scheduler, never as a hand-made repeat: job
- AT-US-095-01 … AT-US-095-06: all 6 scenarios of US-095, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-091 — Guest quoting with capability token and rate limits (createQuote not idempotency-stored)

| Field | Value |
|---|---|
| Stories (completes) | US-155 **DC** (M0 Must) Guest quoting with access token and rate limits |
| Stories (partial; completed by TASK-141, TASK-146) | US-040 (M0 Must) Redis-backed rate limiting and headers<br>US-080 **DC** (M0 Must) Guest-capable tables and atomic claim |
| REQs | REQ-QUOTE-002, REQ-API-014, REQ-SEC-005, REQ-SEC-006, REQ-RLS-013 |
| NFRs | NFR-PERF-002, NFR-SEC-005 |
| Spikes / security / decisions | SEC-P3-10, SEC-P3-15, D-ARCH-012, D-ARCH-109, D-TASK020-41, D-SEC-PR38-02, D-ARCH-113, PR38-SEC-03, PR48-SEC-04, PR48-SEC-06, D-SEC-PR48-01, D-ARCH-134, D-ARCH-175, D-SD-004, D-PM-078, D-SD-005, D-ARCH-213, D-SECPR051-01, D-QG-005, D-PM-087, D-SD-011, D-ARCH-222, D-PM-088, D-SECPR041B-02, PR041-SEC-16, D-SD-012, D-ARCH-230, D-ARCH-234, D-QG-009, D-QA-023, D-SD-015, D-ARCH-241, D-QG-010, D-SD-015 |
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
- D-TASK020-41 / D-SEC-PR38-02 AUTHENTICATOR CONTRACT (ADR-0008 am. 6 item 2; D-ARCH-113): the quote-token authenticator learns that X-Quote-Token is present only through presentedKinds(req.headers, route.auth) on getQuote and streamQuoteResults (when session is also present the bearer authenticator decides and the token header is never read, spy), builds the guest principal permissions with readonlySet holding exactly the quote read permissions the route needs, calls markCredentialsRead(res) together with its decision, and answers a missing or malformed token with 404 NOT_FOUND (A-078) whose private, no-store comes from the descriptor test ([session, quote-token] has no anonymous member), not from the authenticator; COMPANION CASE (ADR-0008 am. 6 item 1 (b)): on claimQuote, saveQuote and createShipment, whose auth set is exactly [session], x-quote-token is declared in schema.headers as the contract declares the QuoteToken header parameter there (route-metadata companion parity, 020-C), and the handler compares the SHA-256 of the presented value with the stored guest_token hash in constant time (this sentence is reconciled by the seam ruling of the DISPATCH GATE, QG-051-C5; rulings section 8.8), never stores or logs the raw value and never treats it as authentication; on every other route schema.headers may not name it (defineRoute refuses it at module load); api tests: a bearer plus a token on getQuote ignores the token, a token alone yields a guest principal whose permissions view throws on mutation, a malformed token is 404 private, no-store (the claimQuote wrong-token test moved to TASK-146, WRONG TOKEN ON CLAIM, D-PM-087)
- PR48-SEC-04 deny-404 (LOW; D-SEC-PR48-01 (4); D-ARCH-134; DUE before this task merges): the RBAC matrix generator gains the outcome deny-404 (REFUSALS[deny-404] = { status: 404, code: NOT_FOUND }, symbol 404, private, no-store); for a route whose auth set is exactly [session, quote-token] rule 1 gives deny-404 when no usable credential is presented (none, a refresh cookie, an expired bearer) and rule 2 gives a guest principal for a well-formed unknown token (the handler answers 404) and deny-404 for a malformed one — ADR-0008 am. 5 item 1 and A-078; the committed matrix is regenerated (the 8 cells of getQuote and streamQuoteResults change from 401), the D-ARCH-107 test title no longer calls 401 the expected answer, the US-155 wrong-token and missing-token api tests and the matrix agree, and the security record of this PR covers tests/generated/rbac (owned path)
- RBAC MATRIX SEAM RETIREMENT, quote-token kind (PR48-SEC-06; PR #48 code review R1-m3; D-ARCH-134): this task deletes the quote-token branch of resolvePrincipal in tests/generated/rbac/matrix-app.ts and presents a real X-Quote-Token (a guest quote minted by the test) through the real authenticate slot; regenerated matrix, drift test green, the still-stubbed-kinds tripwire of TASK-052 passes
- GUEST TOKEN COST (ADR-0016 amendment 12 item 4; D-ARCH-175): the guest authenticator does no I/O; it derives the token hash, and the quote row is matched by the handler query after the step-5 class limit; a refusal the authenticator raises itself is counted by the wrapper of TASK-041; test: a forged X-Quote-Token causes no database call before the public class limit has been consumed
- [AT-US-040-04] and [AT-US-040-03-5] at POST /quotes (D-PM-078): a verified signed-in user is limited by the quote-create class (the 31st quote in a minute and the 301st in an hour answer 429 RATE_LIMITED with Retry-After although the user is far below 600 authenticated requests a minute; the 1001st in an hour by the users of one organisation answers 429 and a user of another organisation is not affected), and a guest POST /quotes is counted only against the guest per-IP class (20/min, 100/h)
- DISPATCH GATE (D-ARCH-213; rulings section 8.8): principal-architect rules the pipeline seam that puts a guest token hash into the transaction context for createQuote by an anonymous caller and for the claim operations (a note on the route descriptor of ADR-0003, with security-analyst) before this task is dispatched (D-QG-005 condition QG-051-C5: the ruling is verified by quality-gatekeeper as a D-QG entry and names the task and lock that build the seam under apps/api/src/platform; product has no objection to ruling cases (a) and (b) first if case (c) takes longer, D-PM-087)
- GUEST BINDING, ROUTE SIDE (D-TASK051-07; D-ARCH-213; SEC-TC-81; ADR-0005 amendment 10 items 8 and 11; data-model 4.3): the transaction context carries a non-empty guestTokenHash only on getQuote and streamQuoteResults for a guest principal (the hash the quote-token authenticator derived), on createQuote for an anonymous caller (the hash of the token minted for this request) and on the claim operations of TASK-146; a session caller on getQuote or streamQuoteResults binds the empty string; the hash is derived server-side by guestTokenHash and no handler, service or repository supplies it; api test over the mounted route table: on every operation other than getQuote, streamQuoteResults, createQuote, claimQuote, saveQuote and createShipment a request that presents a well-formed X-Quote-Token is given a recorded context whose guestTokenHash is the empty string
- US-080 HTTP HALVES (D-ARCH-213; the database halves are on TASK-051): [AT-US-080-01] getQuote with the guest token returns the quote; [AT-US-080-02] the token of another guest, a guessed token, a bearer of another organisation and the quote id alone answer 404 NOT_FOUND; the tests go through the mounted getQuote on the real quote tables and carry the IDs in their titles; a test of AT-US-155-01 to -03 that asserts the same thing may carry both IDs; US-080 is partial here and closes in TASK-146 (D-PM-087)
- SEC-TC-81 (D-SECPR051-01; qa-lead): the route-side guest binding is a required_cases_pending row with the owners TASK-091 and TASK-146; the tests of GUEST BINDING, ROUTE SIDE carry the tag; qa-lead moves the row from pending to required in the first manifest commit after the second of the two tasks merges
- FAN-OUT IS NOT TIED TO A READER (ADR-0010 amendment 14; ADR-0016 amendment 14 item 5; D-ARCH-222; TASK-044 code review R1-m6): createQuote starts the fan-out in afterCommit under the afterCommit signal and the rate-shopping deadlines only; no request signal and no stream signal reaches it; test with the Mock latency scenario: the caller of createQuote disconnects right after the 201 and a getQuote reader disconnects while a carrier call is in flight, every call still completes, its result is persisted and a later getQuote returns it; this task mounts no stream operation (streamQuoteResults is mounted by TASK-141), so the follow-ups that the TASK-044 review dates before TASK-091 (R1-M1, R1-m5) are due with TASK-044 part 044-B, before TASK-141 is dispatched
- STORE OUTAGE CASE (REQ-SEC-006; D-PM-088; PR041-SEC-03): the quote service consumes quoteCreateRules with onStoreFailure fallback; api test through POST /quotes for a verified caller with the store failing: the 31st quote of one user within a minute on one instance answers 429 RATE_LIMITED
- AUTHENTICATION SLOT OUTCOME (PR041-SEC-16 (a) LOW, CWE-772; D-SECPR041B-02; D-ORCH-159; code review n8 widened by D-SECPR041B-01): the authentication slot reports its outcome only by calling next once, throwing or rejecting, and never writes the response; one api row per refused shape: failed count +1, held count back to 0; every refused presented credential is a 4xx AppError (here: the refusals the quote-token authenticator raises itself, such as a malformed X-Quote-Token); ASYNC SLOT (ADR-0016 amendment 13 item 6 Release; D-ARCH-230; PR041-SEC-16): the authenticator is an async function that awaits its work and reports before it returns (next once, a throw or a rejection); it never starts or ends the response (setting a header such as Set-Cookie or Cache-Control is allowed) and starts no work that reports after its promise has settled; the wrapper of TASK-041 answers 500 for a slot whose promise fulfils without an outcome and writes api.authn_slot_unreported, so each row per refused shape also asserts that this line was not written; optional: an ESLint restriction on res.status, json, send, end, redirect, write, writeHead and flushHeaders in the authenticator module of this task; NO CALLBACK FORM (ADR-0016 amendment 13 item 6 Release, the callback form; D-ARCH-234; D-QG-009 QG-041B-C7 (b)): the authenticator never returns without a promise before it has reported, because the wrapper waits for such a slot without a limit and cannot end it, so a unit it never reports stays held until the process restarts; that form is for test seams only; a unit row calls the handler of the slot for each accepted and each refused shape and asserts that the outcome has been reported when the handler returns or, when the handler returns a promise, when that promise fulfils
- ONE CLIENT ADDRESS (TEST-STRATEGY 1.6 section 10.4 rule 1; D-QA-023; QG-041B-C7 (c)): the limiter rows of this task run in process with a fresh limiter per harness (a new FakeValkey and counter, its own address through fromIp, rateLimit passThrough where a suite does not test limits); no limiter, Valkey key space or app instance is shared across test files, and a case that proves a listed limit sends in sequence or in groups that fit the in-flight room; code-reviewer checks it
- LIMIT BEFORE EFFECT (ADR-0016 amendment 13 item 6 Answer, Before any effect; D-ARCH-241; D-QG-010 follow-up 2): the limit is consumed before the first effect of the request, that is before a call phase, before a message or a job is queued and before a write that would stay, or it is counted inside the one transaction that holds the only effect of the request and that the refusal rolls back; the refusal is thrown as 429 RATE_LIMITED with Retry-After, so nothing is stored under an Idempotency-Key; the one thing that may be spent by then is the re-authentication proof of a route with reauth metadata (changePassword, disableTotp, regenerateRecoveryCodes, requestPrivacyExport), and the same request sent again is then answered 401 REAUTH_REQUIRED; test: a request that the limit refuses leaves no row, no outbox event and no audit entry, makes no provider call and queues no job or message (spies and row counts), and the same request is served after the wait, with the same Idempotency-Key where the operation takes one and with a fresh proof where the route has reauth metadata Placed here (D-SD-015): the per-user and per-organisation rules of quote-create on createQuote (quoteCreateRules).
- AT-US-155-01 … AT-US-155-11: all 11 scenarios of US-155, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-040-01 … AT-US-040-17 that belong to its layer; US-040 closes in TASK-141
- Covers the scenarios of AT-US-080-01 … AT-US-080-07 that belong to its layer; US-080 closes in TASK-146

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-092 — Mock booking saga end to end (API -> outbox -> queue -> worker -> Mock carrier)

| Field | Value |
|---|---|
| Stories (completes) | US-202 **DC** (M0 Must) Mock booking saga end to end (API, queue, worker)<br>US-008 (M0 Must) Correlation ID and structured, redacted logging<br>US-010 **DC** (M0 Must) Idempotent job processing and scheduled jobs |
| REQs | REQ-BOOK-020, REQ-PLAT-011, REQ-PLAT-012, REQ-PLAT-014, REQ-PLAT-015 |
| NFRs | NFR-OBS-003, NFR-PERF-004, NFR-RES-005 |
| Spikes / security / decisions | D-031, D-062, D-ARCH-084, D-SD-003, PR039-SEC-03, D-SD-004, D-ARCH-180, D-ARCH-184, D-ARCH-185, R-ARCH-37, PR079-SEC-03, D-SECPR079-01, D-SD-006, D-ARCH-191, D-ARCH-202, D-ARCH-205, D-QG-004, D-PM-086, D-SD-010 |
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
- AT-US-010-01 (US-010 delivery split, D-SD-003; this task COMPLETES US-010): given the M0 mock-booking job for shipment S1, delivering the same job twice leaves exactly one Mock carrier shipment for S1 and exactly one audit entry for the booking transition; AT-US-010-02 to -06 are proven by TASK-039 and AT-US-010-07 by TASK-047
- ABORT-SIGNAL DISCIPLINE (PR039-SEC-03 (b), INFO; D-SECPR039-01): processors of this task pass the per-job AbortSignal to every awaited call that accepts one (database, carrier, HTTP), check it before each non-transactional side effect, and call throwIfAborted after the effect, so no work overlaps a retry after the per-job deadline
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (saga_executions; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- CANDIDATE FUNCTION saga_due_candidates (when this task builds it; otherwise TASK-094): the function does not filter on organisations.deleted_at (D-ARCH-180; ADR-0013 amendment 4 item 21): it settles, cancels, expires or retries existing work, which a soft-deleted organisation still owns
- EVENT TYPE SEQUENCING (ADR-0004 amendment 2 item 12; D-ARCH-184): the event file packages/shared/src/events/<module>.ts merges only after outbox-relay has its processor (TASK-047); the TASK-043 worker test fails otherwise; and the PUBLISH RULE (ADR-0004 amendment 2 item 14; R-ARCH-37; D-ARCH-185): outbox.publish is called after the write that locks the aggregate row (the UPDATE of the transition or the INSERT of a new aggregate), or after SELECT ... FOR UPDATE on that row when the transaction only adds child rows; code-reviewer checks each publisher against it
- CALL RECORD CHANNEL (PR #77 code review m1; PR079-SEC-03; D-SECPR079-01; with principal-architect before dispatch): callRecords() of the Mock is diagnostic and test evidence on the raw adapter only (the guarded registry facade has none) and a per-process ring ordered by completion; principal-architect decides the channel the saga uses to cite carrier calls (for example an injected onCall(record) sink port, like the logger) before this task and before DHL, FedEx and UPS copy the pattern; the saga matches records by the ctx.correlationId it created; if the channel changes the Mock adapter, this task asks the orchestrator for the pkg-carriers-mock lock and also validates maxCallRecords as a positive safe integer
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: checkoutOrder, confirmPayment (required) (D-SD-007)
- CHECKOUT CALL, MOCK (ADR-0012 amendment 6; ADR-0003 amendment 2026-11-20 rule (k); D-ARCH-205): the call phase of checkoutOrder asks the Mock gateway with the key auth:<order_id>:<order_version>:<attempt>; on AUTHORISED the handler writes the payment as AUTHORISED, moves the shipments to PAID and publishes payment.authorised in its one transaction, and no step confirms afterwards (AT-US-202-01); mock_3ds answers REQUIRES_ACTION and confirmPayment derives the outcome; fault test: the handler transaction fails after call, no payment row exists, the retry with the same Idempotency-Key gets the same Mock result and the saga starts once; the rows of checkoutOrder and confirmPayment in the call table are added by TASK-096
- IF-MATCH UNTIL TASK-096 (ADR-0003 amendment 2026-11-20 rule (i), owner line; D-ARCH-202 sequencing; D-SD-010): step 7b is a pass-through until TASK-096 merges, so checkoutOrder enforces no If-Match until then and no stale-on-arrival check runs before call; load returns the order id and version (the source TASK-096 declares) and the handler writes through the conditional write of ADR-0014 amendment 7; no test asserts that If-Match is ignored or that 428 is absent; TASK-096 retrofits the check before call and its tests (RETROFIT on TASK-096); if TASK-096 is on main when this task is dispatched, this task declares the version source and writes the 428 and 412 tests itself
- AT-US-202-01 STATUS LITERAL (D-PM-086): the checkout step of AT-US-202-01 expects 201 with the created payment, as the contract answers checkoutOrder, not 202; the story file edit is held and lands on main before this task is dispatched; the test asserts 201
- SAGA STEP UNIQUE KEY (D-QG-005 condition QG-051-C2; rulings/wave-1-r-arch-34-operator-rulings.md section 8.10 items 5 and 7; ADR-0005 amendment 15 item 38, rule B1; D-SD-011): data-model 3.12 and 6.3 draw ux_saga_steps__saga_step_shipment ON (saga_id, step, shipment_id) NULLS NOT DISTINCT on the TENANT table saga_steps; it holds no owner column, so C16 (b) reports it; this task creates it with org_id leading, ON (org_id, saga_id, step, shipment_id) NULLS NOT DISTINCT, which C16 (b) passes because org_id is NOT NULL (rule B1); every other unique index of saga_executions and saga_steps holds org_id; every relation of the two tables states onDelete: Restrict and onUpdate: Restrict (item 37; C16 (d) of TASK-298); C16 is the gate; principal-architect corrects the sketch of data-model 3.12 and 6.3 when this task is dispatched
- AT-US-202-01 … AT-US-202-07: all 7 scenarios of US-202, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-008-01 … AT-US-008-06: all 6 scenarios of US-008, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-010-01 … AT-US-010-07: all 7 scenarios of US-010, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-279 — Playwright harness: 8 projects, CSP/header/console listeners, route inventory, state helpers, keyboard-only mode, Mailpit client, PAN scanner, log collector, test-data CLI

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-A11Y-002, NFR-COMPAT-002, NFR-QUAL-006 |
| Spikes / security / decisions | T-QA-05, D-QA-023, D-SD-015 |
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
- ONE CLIENT ADDRESS (TEST-STRATEGY 1.6 section 10.4 rules 2 to 7; D-QA-023; QG-041B-C7 (c); D-PM-090 5 (d) and (e)): every stack suite reaches the API from one address, so the harness implements: (2) no limit proven against the stack by volume: no forged X-Forwarded-For outside the serial address-keying project, the UI 429 states served by page.route with a Retry-After above 1, and a journey that lowers a limit by configuration runs in its own serial project on its own stack; (3) refused credentials on purpose run in one serial project @authn-refusal (1 worker, at most 20 refused credentials per test), and a test-data CLI command clears the rate-limit keys of the run address afterwards (APP_ENV local or test only, never through HTTP); (4) one sign-in per worker and role with per-worker storage state, and never more than 20 credentialed requests in flight from helpers; (5) the limit values of a run are recorded, and RATE_LIMIT_PUBLIC_PER_MIN stays at its default in the gate run (the test overlay with devops-engineer); (6) helpers wait out a 429 RATE_LIMITED whose Retry-After is 2 s or less (Retry-After plus up to 1 s, at most 3 times) and fail the test at once on a longer one with the RateLimit-* headers in the message, and the harness never retries browser traffic; (7) the response recorder writes every 429 to e2e-429.json (route, Retry-After, RateLimit-* headers, test ID, provoking tag) and, once TASK-214 exports it, the step0-authn-inflight counter delta of the run; a hold refusal outside a provoking test fails section 15 item 25

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-093 — Quote input validation and package limits (limit-based exclusion reasons)

| Field | Value |
|---|---|
| Stories (completes) | US-156 **DC** (M0 Must) Quote input validation and package limits |
| REQs | REQ-QUOTE-003, REQ-QUOTE-004 |
| NFRs | NFR-SEC-009 |
| Spikes / security / decisions | D-ARCH-170, D-SD-004 |
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
- BILLABLE-WEIGHT RULE BY ORIGIN (ADR-0009 amendment 2 item 4; D-ARCH-170; TASK-076 code review R1-m5): the rule passed to the billable-weight helper is chosen by countries.unit_system of the quote origin country (IMPERIAL for a US origin, METRIC otherwise), never by the unit of entry; test: the package of AT-US-139-04 entered in inches and in centimetres bills the same weight for the same origin, 12,701 g for a US origin and 13,000 g for a metric origin with the default rules
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
| Spikes / security / decisions | PR039-SEC-03, D-SD-004 |
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
- ABORT-SIGNAL DISCIPLINE (PR039-SEC-03 (b), INFO; D-SECPR039-01): processors of this task pass the per-job AbortSignal to every awaited call that accepts one (database, carrier, HTTP), check it before each non-transactional side effect, and call throwIfAborted after the effect, so no work overlaps a retry after the per-job deadline
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
| Spikes / security / decisions | T-QA-06, SPK-04, R-ARCH-04, D-ORCH-031, D-ARCH-085, D-ARCH-088, D-ARCH-089, PR27-SEC-02, PR27-SEC-03, PR27-SEC-04, D-SEC-PR27-01, D-ARCH-100, D-QA-023, D-SD-015 |
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
- K6 SETUP HELPERS HONOUR RETRY-AFTER (TEST-STRATEGY 1.6 section 10.4 rules 5 and 6; D-QA-023): the k6 setup functions that sign in or seed through the API wait out a 429 RATE_LIMITED whose Retry-After is 2 s or less (Retry-After plus a random delay of up to 1 s, at most 3 times) and fail the setup at once on a longer one, with the RateLimit-* headers in the message; every limit value a run overrides is written to its output; the in-flight hold of a run from one address is read under card line 25 of the TASK-041 rulings (TASK-216)

**DoD notes**
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
