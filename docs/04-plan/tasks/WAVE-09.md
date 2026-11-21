# WAVE-09 — Could stories (cuttable via PRD §7.1 ladder rung 1)

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M1** · Priority band: **Could** · **CUTTABLE** (PRD §7.1 ladder rung 1)

Tasks: **7** (S 5 / M 2; opus 1 / sonnet 6; demo-critical 0) in **2** batches of ≤ 4 parallel tasks. Estimated effort ≈ 13.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Only started when no Must/Should is at risk.

**Stories completed in this wave (8):** US-153, US-231, US-240, US-253, US-264, US-270, US-271, US-290.

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 9.1 | TASK-269 Volume-tier discount and M2 seam variants<br>TASK-270 ZPL label output<br>TASK-271 Service point map and combined pickups<br>TASK-272 Manual tracking refresh limited to once per 5 minutes | pkg-pricing<br>mod-documents-label<br>mod-pickups<br>mod-tracking-poll |
| 9.2 | TASK-273 Address book CSV import parsed in the browser<br>TASK-274 Privacy data export and account deletion request<br>TASK-275 SMS and WhatsApp channel seam | web-account-addressbook<br>identity-privacy, web-account-privacy<br>mod-notifications |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

Shared hot files (D-ORCH-118, D-ARCH-147): `api-tenant-db` = `apps/api/src/platform/db/tenant-db.*`, `apps/api/src/platform/db/with-tenant-tx.*`, `apps/api/src/platform/db/raw-statement.*`; `api-tx-execute` = `apps/api/src/platform/tx/**`; `api-platform-core` = `apps/api/src/app.*`, `apps/api/src/start-api.*`, `apps/api/src/main.*`; `api-routing` = `apps/api/src/platform/routing/pipeline.*`; `lint` = `eslint.config.mjs`. A card whose planned files name one of them holds that lock (the generator fails otherwise); a PR that needs such a file without holding the lock stops and asks the orchestrator for it first, so two in-flight PRs never edit the same shared file.

## Task specifications

### TASK-269 — Volume-tier discount and M2 seam variants

| Field | Value |
|---|---|
| Stories (completes) | US-153 (M1 Could) Volume-tier discount and M2 seam variants |
| REQs | REQ-PRICE-012, REQ-PRICE-021 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-202, TASK-192 |
| Batch · locks | 9.1 · pkg-pricing |
| Branch | `feat/TASK-269-volume-tier-discount-m2-seam` |
| Priority | Could · cuttable |

**Files / modules**
- packages/pricing/src/discounts/volume-tier.ts

**Acceptance tests to write**
- All US-153 scenarios
- AT-US-153-01 … AT-US-153-05: all 5 scenarios of US-153, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-270 — ZPL label output

| Field | Value |
|---|---|
| Stories (completes) | US-231 (M1 Could) ZPL label output |
| REQs | REQ-DOC-015 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-155, TASK-252 |
| Batch · locks | 9.1 · mod-documents-label |
| Branch | `feat/TASK-270-zpl-label-output` |
| Priority | Could · cuttable |

**Files / modules**
- apps/api/src/modules/documents/labels/zpl.*

**Acceptance tests to write**
- All US-231 scenarios
- AT-US-231-01 … AT-US-231-03: all 3 scenarios of US-231, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-271 — Service point map and combined pickups

| Field | Value |
|---|---|
| Stories (completes) | US-240 (M1 Could) Service point map and combined pickups |
| REQs | REQ-PICK-011, REQ-PICK-014 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-008 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-245, TASK-178, TASK-248 |
| Batch · locks | 9.1 · mod-pickups |
| Branch | `feat/TASK-271-service-point-map-combined-pickups` |
| Priority | Could · cuttable |

**Files / modules**
- apps/api/src/modules/pickups/combined.*

**Acceptance tests to write**
- All US-240 scenarios (list only; map not rendered per D-UX-027)
- AT-US-240-01 … AT-US-240-05: all 5 scenarios of US-240, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-272 — Manual tracking refresh limited to once per 5 minutes

| Field | Value |
|---|---|
| Stories (completes) | US-253 (M1 Could) Manual tracking refresh limited to once per 5 minutes |
| REQs | REQ-TRACK-015 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191, D-ARCH-202, D-SD-010, D-ARCH-241, D-QG-010, D-SD-015 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-204 |
| Batch · locks | 9.1 · mod-tracking-poll |
| Branch | `feat/TASK-272-manual-tracking-refresh-limited-once` |
| Priority | Could · cuttable |

**Files / modules**
- apps/api/src/modules/tracking/manual-refresh.*

**Acceptance tests to write**
- All US-253 scenarios
- D-ARCH-106: the manual refresh is load (shipment under RLS, last refresh time), call (carrier track, no transaction open) and handler (events and audit), or an outbox event with 202; the once-per-5-minutes limit is checked in load and re-checked in the handler
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: refreshShipmentTracking (optional) (D-SD-007)
- CALL CLASS (ADR-0003 amendment 2026-11-20 rules (j) to (l); D-ARCH-202): the operation gets its row in the call table of the route-metadata test (read, inert or reachable); an inert or reachable operation has a fault test (the handler transaction fails after call, the provider fake shows no hold, charge, booking or message that no row names, the next request converges); an effect that is right only if the state change commits is an outbox event and a worker step; on this card: refreshShipmentTracking is class read when it takes the load, call and handler form; the outbox form with 202 declares no call and has no row
- LIMIT BEFORE EFFECT (ADR-0016 amendment 13 item 6 Answer, Before any effect; D-ARCH-241; D-QG-010 follow-up 2): the limit is consumed before the first effect of the request, that is before a call phase, before a message or a job is queued and before a write that would stay, or it is counted inside the one transaction that holds the only effect of the request and that the refusal rolls back; the refusal is thrown as 429 RATE_LIMITED with Retry-After, so nothing is stored under an Idempotency-Key; the one thing that may be spent by then is the re-authentication proof of a route with reauth metadata (changePassword, disableTotp, regenerateRecoveryCodes, requestPrivacyExport), and the same request sent again is then answered 401 REAUTH_REQUIRED; test: a request that the limit refuses leaves no row, no outbox event and no audit entry, makes no provider call and queues no job or message (spies and row counts), and the same request is served after the wait, with the same Idempotency-Key where the operation takes one and with a fresh proof where the route has reauth metadata Placed here (D-SD-015): the route-specific limit of refreshShipmentTracking (once per 5 minutes).
- AT-US-253-01 … AT-US-253-06: all 6 scenarios of US-253, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-273 — Address book CSV import parsed in the browser

| Field | Value |
|---|---|
| Stories (completes) | US-264 (M1 Could) Address book CSV import parsed in the browser |
| REQs | REQ-ACCT-010 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-264 |
| Batch · locks | 9.2 · web-account-addressbook |
| Branch | `feat/TASK-273-address-book-csv-import-parsed` |
| Priority | Could · cuttable |

**Files / modules**
- apps/web/app/features/address-book/import/**

**Acceptance tests to write**
- All US-264 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: importAddressBookEntries (optional) (D-SD-007)
- AT-US-264-01 … AT-US-264-11: all 11 scenarios of US-264, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-274 — Privacy data export and account deletion request

| Field | Value |
|---|---|
| Stories (completes) | US-270 (M1 Could) Privacy data export<br>US-271 (M1 Could) Privacy account deletion request |
| REQs | REQ-ACCT-016, REQ-ACCT-017 |
| NFRs | NFR-PRIV-005 |
| Spikes / security / decisions | SEC-COND-01, D-027, D-ARCH-191, D-ARCH-241, D-QG-010, D-SD-015 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-187, TASK-039 |
| Batch · locks | 9.2 · identity-privacy, web-account-privacy |
| Branch | `feat/TASK-274-privacy-data-export-account-deletion` |
| Priority | Could · cuttable |

**Files / modules**
- apps/api/src/modules/identity/privacy/**
- apps/web/app/routes/account/privacy.tsx

**Acceptance tests to write**
- All US-270 and US-271 scenarios (SEC-TC-37 privacy-export part)
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: requestPrivacyExport, requestAccountDeletion (optional) (D-SD-007)
- LIMIT BEFORE EFFECT (ADR-0016 amendment 13 item 6 Answer, Before any effect; D-ARCH-241; D-QG-010 follow-up 2): the limit is consumed before the first effect of the request, that is before a call phase, before a message or a job is queued and before a write that would stay, or it is counted inside the one transaction that holds the only effect of the request and that the refusal rolls back; the refusal is thrown as 429 RATE_LIMITED with Retry-After, so nothing is stored under an Idempotency-Key; the one thing that may be spent by then is the re-authentication proof of a route with reauth metadata (changePassword, disableTotp, regenerateRecoveryCodes, requestPrivacyExport), and the same request sent again is then answered 401 REAUTH_REQUIRED; test: a request that the limit refuses leaves no row, no outbox event and no audit entry, makes no provider call and queues no job or message (spies and row counts), and the same request is served after the wait, with the same Idempotency-Key where the operation takes one and with a fresh proof where the route has reauth metadata Placed here (D-SD-015): the route-specific limit of requestPrivacyExport (1 a minute per user), the fourth operation of the named exception.
- AT-US-270-01 … AT-US-270-10: all 10 scenarios of US-270, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-271-01 … AT-US-271-08: all 8 scenarios of US-271, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/modules/identity/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-275 — SMS and WhatsApp channel seam

| Field | Value |
|---|---|
| Stories (completes) | US-290 (M1 Could) SMS and WhatsApp channel seam |
| REQs | REQ-NOTIF-016 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-074 |
| Batch · locks | 9.2 · mod-notifications |
| Branch | `feat/TASK-275-sms-whatsapp-channel-seam` |
| Priority | Could · cuttable |

**Files / modules**
- apps/api/src/modules/notifications/provider/channels.ts

**Acceptance tests to write**
- All US-290 scenarios
- AT-US-290-01 … AT-US-290-04: all 4 scenarios of US-290, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
