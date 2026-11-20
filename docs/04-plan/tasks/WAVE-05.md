# WAVE-05 — M1 demo-critical II: booking wizard, customs, basket, documents, pickups

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M1** · Priority band: **Must DC (+ non-DC enablers)**

Tasks: **20** (S 4 / M 16; opus 5 / sonnet 15; demo-critical 19) in **6** batches of ≤ 4 parallel tasks. Estimated effort ≈ 54 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Wizard steps 1-5 complete for a claimed quote; documents rendered and downloadable; lane B `wave` evidence; lane C `wave-end` run green.

**Stories completed in this wave (22):** US-072, US-166 (DC), US-171 (DC), US-172 (DC), US-174 (DC), US-175 (DC), US-180 (DC), US-181 (DC), US-182 (DC), US-186 (DC), US-189 (DC), US-191 (DC), US-192 (DC), US-220 (DC), US-221, US-222 (DC), US-223 (DC), US-224 (DC), US-225 (DC), US-232 (DC), US-233 (DC), US-234 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 5.1 | TASK-146 Claim a quote when booking starts; start-booking API with sign-in gate<br>TASK-147 Document model and private encrypted object storage<br>TASK-148 Pickup date and window rules | mod-quotes<br>mod-documents-core<br>mod-pickups |
| 5.2 | TASK-149 Server-side draft shipment, resume and optimistic concurrency<br>TASK-150 Document versioning<br>TASK-151 Pickup record and instructions<br>TASK-152 Guest sign-in gate UI with BookingContextCard, returning to the wizard with the quote claimed | mod-shipments<br>mod-documents-core<br>mod-pickups<br>web-booking-gate |
| 5.3 | TASK-153 Order basket model<br>TASK-154 Customs API<br>TASK-155 Carrier label stored in every offered format<br>TASK-156 Responsive wizard shell and step navigation | mod-orders<br>mod-customs<br>mod-documents-label<br>web-wizard-shell |
| 5.4 | TASK-157 Commodity code search and format validation<br>TASK-158 Asynchronous document generation job<br>TASK-159 Wizard step 1<br>TASK-160 Wizard step 2 UI | mod-customs, ui-combobox<br>mod-documents-render<br>web-wizard-step1<br>web-wizard-step2 |
| 5.5 | TASK-161 Commercial and pro-forma invoice content and carrier customs documents<br>TASK-162 Pre-signed download URL after permission and tenant check; download/export routes with their own permission<br>TASK-163 Wizard step 3 | mod-documents-render<br>mod-documents-download<br>web-wizard-step3, ui-calendar |
| 5.6 | TASK-164 Wizard step 5<br>TASK-165 Document list and re-download from shipment detail | web-wizard-review<br>mod-documents-download, web-docs |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

Shared hot files (D-ORCH-118, D-ARCH-147): `api-tenant-db` = `apps/api/src/platform/db/tenant-db.*`, `apps/api/src/platform/db/with-tenant-tx.*`, `apps/api/src/platform/db/raw-statement.*`; `api-tx-execute` = `apps/api/src/platform/tx/**`; `api-platform-core` = `apps/api/src/app.*`, `apps/api/src/start-api.*`, `apps/api/src/main.*`; `api-routing` = `apps/api/src/platform/routing/pipeline.*`; `lint` = `eslint.config.mjs`. A card whose planned files name one of them holds that lock (the generator fails otherwise); a PR that needs such a file without holding the lock stops and asks the orchestrator for it first, so two in-flight PRs never edit the same shared file.

## Task specifications

### TASK-146 — Claim a quote when booking starts; start-booking API with sign-in gate

| Field | Value |
|---|---|
| Stories (completes) | US-166 **DC** (M1 Must) Claim a quote when booking starts |
| Stories (partial; completed by TASK-152) | US-171 **DC** (M1 Must) Guest sign-in gate and quote claim at wizard start |
| REQs | REQ-QUOTE-016, REQ-BOOK-001 |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | D-ARCH-162, D-SD-003, D-ARCH-191 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-087, TASK-091, TASK-052, TASK-059 |
| Batch · locks | 5.1 · mod-quotes |
| Branch | `feat/TASK-146-claim-quote-when-booking-starts` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/quotes/claim/**
- apps/api/src/modules/shipments/start-booking.*

**Acceptance tests to write**
- All US-166 scenarios
- US-171 API scenarios (claim is atomic; selected option preserved)
- The claim is the ONE statement of data-model 4.3 as amended 2026-11-19 (D-ARCH-162): a claim written as separate statements fails with 23503 by design
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: claimQuote, createShipment (optional) (D-SD-007)
- AT-US-166-01 … AT-US-166-08: all 8 scenarios of US-166, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-171-01 … AT-US-171-06 that belong to its layer; US-171 closes in TASK-152

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-147 — Document model and private encrypted object storage

| Field | Value |
|---|---|
| Stories (completes) | US-220 **DC** (M1 Must) Document model and private encrypted storage |
| REQs | REQ-DOC-001, REQ-DOC-005, REQ-DOC-006 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SPK-05, D-025, PR30-SEC-02, PR30-SEC-07, PR30-SEC-09, PR30-SEC-10, D-ARCH-097, D-SEC-TM-01, D-ARCH-180 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-019, TASK-029, TASK-016 |
| Batch · locks | 5.1 · mod-documents-core |
| Branch | `feat/TASK-147-document-model-private-encrypted-object` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/documents.prisma + migration
- apps/api/src/modules/documents/{service,repository}.ts
- apps/api/src/modules/documents/{storage-facade.ts, document-keys.ts, storage-policy.test.ts}
- apps/api/src/platform/storage/{object-storage.port.ts, s3-object-storage.ts} (hardening edits of D-ARCH-097; the api-storage lock is free in wave 5)

**Acceptance tests to write**
- All US-220 scenarios (SHA-256 stored, SSE-S3, private bucket)
- DOWNLOAD, KEY AND METADATA CONTRACT (ADR-0021 am. 3, D-ARCH-097; PR #30 security r2 PR30-SEC-02, -07, -09, -10, code review r1 n2 and r2 flag 1; DUE WITH THIS TASK, binding on TASK-155 and TASK-162): (1) the documents module owns ONE storage facade (modules/documents/storage-facade.ts) and it is the only code outside platform/storage that touches RuntimeServices.storage: putDocument and presignDownload(document, ttl) — presignDownload reads the bucket, key, versionId and responseContentType from the RLS-visible document row (the type stored at put time from the detected format, never request, carrier or user text), builds the disposition with attachmentDisposition (item 3) and NEVER sets allowInline; (2) allowInline: a repository test (modules/documents/storage-policy.test.ts) fails when allowInline appears in apps or packages source outside apps/api/src/platform/storage and its tests — allowInline: true with an active content type (text/html, image/svg+xml, application/xhtml+xml, any +xml type, application/xml, a script type) is the XSS-by-document path; there is no M1 caller, and an inline preview needs an ADR-0021 amendment, a facade method restricted to an allow-list of passive types (application/pdf, image/png, image/jpeg) and a security record; (3) attachmentDisposition(name) is one pure function exported by platform/storage that returns attachment; filename="<ASCII fallback>"; filename*=UTF-8 followed by two single quotes and the RFC 5987 percent-encoded name, where the name is composed only from server-held parts (document type, shipment reference, version, an extension from a closed set) and the fallback keeps only letters, digits, dot, underscore and hyphen; the port check is anchored on ASCII (no Unicode trim) and refuses an inline token anywhere after the type; unit cases: U+00A0 before attachment, attachment; x; inline, U+2028, a quote, a backslash, CR and LF, a 300-character name and an all-non-ASCII name; (4) ONE typed key builder (modules/documents/document-keys.ts) is the only code that constructs a key string — UUID-typed parts and closed enums, the organisation id taken from the tenant context and never from request input, the grammar of ADR-0021 Decision 2; the port additionally rejects a . segment, an empty segment and a trailing / (the store answers 400 to two of those), caps the total metadata bytes (names plus values) at 2048 with INVALID_ARGUMENT before any I/O instead of an S3 MetadataTooLarge reported as UNEXPECTED, and imports the bucket predicate from the single S3_BUCKET definition of packages/config; (5) result precision (PR30-SEC-10): get().contentLength is the number of bytes read, an SDK-detected checksum mismatch on the response is INTEGRITY_MISMATCH instead of UNEXPECTED, and put compares the echoed ChecksumSHA256 with the digest it sent when the response carries one (the contract suites on RustFS now and on real S3 before G4-production pin that it is carried)
- SEC-TC-75 (proposed ID, D-SEC-TM-01; qa-lead adopts it through required_cases_pending with checkpoint G3): the storage-policy repository tests of items (1) to (4) above carry [SEC-TC-75]
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (documents; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- AT-US-220-01 … AT-US-220-07: all 7 scenarios of US-220, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-148 — Pickup date and window rules (cut-off, holidays, time zones)

| Field | Value |
|---|---|
| Stories (completes) | US-232 **DC** (M1 Must) Pickup date and window rules |
| REQs | REQ-PICK-002, REQ-PICK-003, REQ-PICK-004 |
| NFRs | NFR-DATA-002 |
| Spikes / security / decisions | D-014 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-122, TASK-075 |
| Batch · locks | 5.1 · mod-pickups |
| Branch | `feat/TASK-148-pickup-date-window-rules` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/pickups/availability/**

**Acceptance tests to write**
- All US-232 scenarios
- AT-US-232-01 … AT-US-232-10: all 10 scenarios of US-232, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-149 — Server-side draft shipment, resume and optimistic concurrency

| Field | Value |
|---|---|
| Stories (completes) | US-172 **DC** (M1 Must) Server-side draft shipment, resume and optimistic concurrency |
| REQs | REQ-BOOK-002 |
| NFRs | NFR-DATA-003 |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-146, TASK-096, TASK-100, TASK-084 |
| Batch · locks | 5.2 · mod-shipments |
| Branch | `feat/TASK-149-server-side-draft-shipment-resume` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/shipments.prisma (parties, packages) + migration
- apps/api/src/modules/shipments/draft/**

**Acceptance tests to write**
- All US-172 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: createShipment, updateShipment (optional) (D-SD-007)
- AT-US-172-01 … AT-US-172-07: all 7 scenarios of US-172, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-150 — Document versioning

| Field | Value |
|---|---|
| Stories (completes) | US-221 (M1 Must) Document versioning |
| REQs | REQ-DOC-004 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-147 |
| Batch · locks | 5.2 · mod-documents-core |
| Branch | `feat/TASK-150-document-versioning` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-223 (DC).

**Files / modules**
- apps/api/src/modules/documents/versioning.*

**Acceptance tests to write**
- All US-221 scenarios
- AT-US-221-01 … AT-US-221-07: all 7 scenarios of US-221, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-151 — Pickup record and instructions

| Field | Value |
|---|---|
| Stories (completes) | US-233 **DC** (M1 Must) Pickup record and instructions |
| REQs | REQ-PICK-001, REQ-PICK-012 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-180 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-148, TASK-032 |
| Batch · locks | 5.2 · mod-pickups |
| Branch | `feat/TASK-151-pickup-record-instructions` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/pickups.prisma + migration
- apps/api/src/modules/pickups/{routes,service,repository}.ts

**Acceptance tests to write**
- All US-233 scenarios
- JOB CONTEXT CASE (D-ARCH-180; ADR-0013 amendment 4 item 23): add the platform.job_context case of the kind this table serves (pickups; live and soft-deleted organisation) and the definer read of data-model 4.3 (definerRead in the manifest); without the policy the function sees no row and every job of the kind ends as JOB_CONTEXT_NOT_FOUND
- AT-US-233-01 … AT-US-233-08: all 8 scenarios of US-233, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-152 — Guest sign-in gate UI with BookingContextCard, returning to the wizard with the quote claimed

| Field | Value |
|---|---|
| Stories (completes) | US-171 **DC** (M1 Must) Guest sign-in gate and quote claim at wizard start |
| REQs | REQ-BOOK-001 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | D-ARCH-195, D-SD-007 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-146, TASK-072, TASK-144 |
| Batch · locks | 5.2 · web-booking-gate |
| Branch | `feat/TASK-152-guest-sign-gate-ui-bookingcontextcard` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/booking-gate/**

**Acceptance tests to write**
- All US-171 scenarios (S-A01, S-A02, S-B01 entry)
- IDEMPOTENCY KEY LIFETIME IN THE CLIENT (ADR-0026 item 4 as amended; ADR-0014 amendment 6; D-ARCH-195): one key per submission; it is reused only for the automatic retry of that submission (network failure, 5xx, 429, 409 IDEMPOTENCY_IN_PROGRESS, after a token refresh, with a fresh re-authentication proof); any other answer ends the key and the draft drops it; test: after a 422 the next submit sends a new key; the helper built here is the one later wizard, checkout and account forms use (D-SD-007 names this the first frontend card that sends the header)
- AT-US-171-01 … AT-US-171-06: all 6 scenarios of US-171, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-153 — Order basket model: 1-10 shipments, one currency

| Field | Value |
|---|---|
| Stories (completes) | US-192 **DC** (M1 Must) Order basket model: 1-10 shipments, one currency |
| REQs | REQ-BOOK-013 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-149, TASK-126 |
| Batch · locks | 5.3 · mod-orders |
| Branch | `feat/TASK-153-order-basket-model-1-10` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/orders/basket/**

**Acceptance tests to write**
- All US-192 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: createOrder (required), addOrderShipment (optional) (D-SD-007)
- AT-US-192-01 … AT-US-192-05: all 5 scenarios of US-192, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-154 — Customs API: contents, applicability, document declaration, customs lines and reason for export

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-160, TASK-160) | US-180 **DC** (M1 Must) Step 2: contents, customs applicability and document declaration<br>US-181 **DC** (M1 Must) Step 2: customs lines and reason for export |
| REQs | REQ-BOOK-009, REQ-CUST-001, REQ-CUST-002, REQ-CUST-003, REQ-CUST-004 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-149, TASK-130, TASK-122 |
| Batch · locks | 5.3 · mod-customs |
| Branch | `feat/TASK-154-customs-api-contents-applicability-document` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/customs.prisma + migration
- apps/api/src/modules/customs/**

**Acceptance tests to write**
- API scenarios of US-180 and US-181
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: replaceShipmentCustoms (optional) (D-SD-007)
- Covers the scenarios of AT-US-180-01 … AT-US-180-08 that belong to its layer; US-180 closes in TASK-160
- Covers the scenarios of AT-US-181-01 … AT-US-181-09 that belong to its layer; US-181 closes in TASK-160

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-155 — Carrier label stored in every offered format

| Field | Value |
|---|---|
| Stories (completes) | US-222 **DC** (M1 Must) Carrier label stored in every offered format |
| REQs | REQ-DOC-002 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-150, TASK-135, TASK-139, TASK-140 |
| Batch · locks | 5.3 · mod-documents-label |
| Branch | `feat/TASK-155-carrier-label-stored-every-offered` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/documents/labels/**

**Acceptance tests to write**
- All US-222 scenarios (PDF + PNG where offered)
- ADR-0010 am. 11 item 3 (D-ARCH-057 rev 2): the saga document step (ADR-0014 step 4) stores every format the service offers; for each offered format missing from createShipment's result it calls the carrier port's `recoverLabel` when `capabilities().operations.recoverLabel` is true (UPS PDF_4X6), with step-4 retry/exception semantics (shipment stays BOOKED, operator alert; never a second createShipment); raster carrier output is never stored as a document; the contingency raster -> PDF converter (R-ARCH-25), if ever needed, lives in this module (owner of pdfkit, ADR-0003/0019), not in packages/carriers
- AT-US-222-01 … AT-US-222-10: all 10 scenarios of US-222, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-156 — Responsive wizard shell and step navigation (autosave hooks, If-Match)

| Field | Value |
|---|---|
| Stories (completes) | US-174 **DC** (M1 Must) Responsive wizard shell and step navigation |
| REQs | REQ-BOOK-003 |
| NFRs | NFR-COMPAT-003 |
| Spikes / security / decisions | D-UX-006 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-149, TASK-053, TASK-054 |
| Batch · locks | 5.3 · web-wizard-shell |
| Branch | `feat/TASK-156-responsive-wizard-shell-step-navigation` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/routes/book/**
- apps/web/app/features/wizard/shell/**
- apps/web/locales/*/wizard.json

**Acceptance tests to write**
- All US-174 scenarios
- AT-US-174-01 … AT-US-174-07: all 7 scenarios of US-174, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-157 — Commodity code search and format validation (API + Combobox)

| Field | Value |
|---|---|
| Stories (completes) | US-182 **DC** (M1 Must) Step 2: commodity code search and format validation |
| REQs | REQ-CUST-006, REQ-CUST-007 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | D-UX-017 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-154, TASK-122 |
| Batch · locks | 5.4 · mod-customs, ui-combobox |
| Branch | `feat/TASK-157-commodity-code-search-format-validation` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/customs/hs-search.*
- packages/ui/src/components/Combobox/**

**Acceptance tests to write**
- All US-182 scenarios
- AT-US-182-01 … AT-US-182-07: all 7 scenarios of US-182, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-158 — Asynchronous document generation job (pdfkit render, store, hash)

| Field | Value |
|---|---|
| Stories (completes) | US-223 **DC** (M1 Must) Asynchronous document generation job |
| REQs | REQ-DOC-012 |
| NFRs | NFR-PERF-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-150, TASK-155, TASK-092, TASK-039 |
| Batch · locks | 5.4 · mod-documents-render |
| Branch | `feat/TASK-158-asynchronous-document-generation-job` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/worker/src/processors/documents/**
- apps/api/src/modules/documents/renderer/**

**Acceptance tests to write**
- All US-223 scenarios
- AT-US-223-01 … AT-US-223-08: all 8 scenarios of US-223, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-159 — Wizard step 1: sender and receiver details (address book picker appears when US-262 lands)

| Field | Value |
|---|---|
| Stories (completes) | US-175 **DC** (M1 Must) Step 1: sender and receiver details with address book |
| REQs | REQ-BOOK-005 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-156, TASK-143, TASK-149 |
| Batch · locks | 5.4 · web-wizard-step1 |
| Branch | `feat/TASK-159-wizard-step-1-sender-receiver` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/wizard/step-1/**

**Acceptance tests to write**
- All US-175 scenarios except the address-book selection, which is verified when US-262 lands (D-PLAN-006)
- AT-US-175-01 … AT-US-175-09: all 9 scenarios of US-175, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-160 — Wizard step 2 UI: contents, customs applicability, customs lines and reason for export

| Field | Value |
|---|---|
| Stories (completes) | US-180 **DC** (M1 Must) Step 2: contents, customs applicability and document declaration<br>US-181 **DC** (M1 Must) Step 2: customs lines and reason for export |
| REQs | REQ-BOOK-009, REQ-CUST-001, REQ-CUST-002, REQ-CUST-003, REQ-CUST-004 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-156, TASK-154 |
| Batch · locks | 5.4 · web-wizard-step2 |
| Branch | `feat/TASK-160-wizard-step-2-ui-contents` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/wizard/step-2/**

**Acceptance tests to write**
- All US-180 and US-181 scenarios end to end (S-B02)
- AT-US-180-01 … AT-US-180-08: all 8 scenarios of US-180, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-181-01 … AT-US-181-09: all 9 scenarios of US-181, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-161 — Commercial and pro-forma invoice content and carrier customs documents (FULL/MASKED receiver ID)

| Field | Value |
|---|---|
| Stories (completes) | US-186 **DC** (M1 Must) Commercial and pro-forma invoice content and carrier customs documents |
| REQs | REQ-CUST-012, REQ-CUST-013 |
| NFRs | NFR-PRIV-004 |
| Spikes / security / decisions | SEC-P3-09, D-051 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-158, TASK-154 |
| Batch · locks | 5.5 · mod-documents-render |
| Branch | `feat/TASK-161-commercial-pro-forma-invoice-content` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/documents/renderer/commercial-invoice.*

**Acceptance tests to write**
- All US-186 scenarios
- SEC-TC-52 (invoice part): FULL only for pack-designated types, MASKED otherwise
- AT-US-186-01 … AT-US-186-11: all 11 scenarios of US-186, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-162 — Pre-signed download URL after permission and tenant check; download/export routes with their own permission

| Field | Value |
|---|---|
| Stories (completes) | US-225 **DC** (M1 Must) Pre-signed download URL after permission and tenant check<br>US-072 (M1 Must) Download and export routes with their own permission |
| REQs | REQ-DOC-007, REQ-RBAC-012 |
| NFRs | NFR-SEC-011, NFR-SEC-013 |
| Spikes / security / decisions | SEC-P3-09, PR30-SEC-02, PR30-SEC-09, D-ARCH-097 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-147, TASK-060 |
| Batch · locks | 5.5 · mod-documents-download |
| Branch | `feat/TASK-162-pre-signed-download-url-after` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/documents/download/**

**Acceptance tests to write**
- All US-225 and US-072 scenarios
- SEC-TC-52 (permission part): Viewer gets 403 + PERMISSION_DENIED audit on getDocumentDownloadUrl
- DOWNLOAD ROUTE CHECKS (ADR-0021 am. 3 items 1 and 2, D-ARCH-097; PR #30 security r2 R2.7; routed from TASK-147): the route calls only the documents facade presignDownload (no direct storage call); the returned URL carries response-content-type equal to the stored type, response-content-disposition attachment, SignedHeaders host, an expiry of at most 300 s and the row versionId; Cache-Control: no-store on the download JSON; no log line and no response other than that one JSON body contains X-Amz-Signature or any other X-Amz parameter; tamper variants (dropping or changing a response-* parameter) get 403 from the store; an end-to-end fetch through the edge store vhost (TASK-014) shows 200, the forced type, attachment and X-Content-Type-Options: nosniff; the SEC-TC for the download path covers expiry, tamper, method restriction and the DOWNLOAD audit entry (AC-37, NFR-SEC-013)
- AT-US-225-01 … AT-US-225-08: all 8 scenarios of US-225, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-072-01 … AT-US-072-04: all 4 scenarios of US-072, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-163 — Wizard step 3: collection mode choice and pickup date/window picker (Calendar)

| Field | Value |
|---|---|
| Stories (completes) | US-189 **DC** (M1 Must) Step 3: collection mode choice<br>US-234 **DC** (M1 Must) Step 3 pickup date and window picker |
| REQs | REQ-BOOK-010, REQ-PICK-001, REQ-PICK-002, REQ-PICK-004 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | D-UX-017 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-156, TASK-151 |
| Batch · locks | 5.5 · web-wizard-step3, ui-calendar |
| Branch | `feat/TASK-163-wizard-step-3-collection-mode` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/wizard/step-3/**
- packages/ui/src/components/Calendar/**

**Acceptance tests to write**
- All US-189 and US-234 scenarios (S-B03)
- AT-US-189-01 … AT-US-189-07: all 7 scenarios of US-189, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-234-01 … AT-US-234-06: all 6 scenarios of US-234, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-164 — Wizard step 5: review with itemised price, edit-back and basket view

| Field | Value |
|---|---|
| Stories (completes) | US-191 **DC** (M1 Must) Step 5: review with itemised price and edit-back |
| REQs | REQ-BOOK-012 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-159, TASK-160, TASK-163, TASK-153, TASK-138 |
| Batch · locks | 5.6 · web-wizard-review |
| Branch | `feat/TASK-164-wizard-step-5-review-itemised` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/wizard/review/**

**Acceptance tests to write**
- All US-191 scenarios (S-B05)
- AT-US-191-01 … AT-US-191-08: all 8 scenarios of US-191, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-165 — Document list and re-download from shipment detail (API + component)

| Field | Value |
|---|---|
| Stories (completes) | US-224 **DC** (M1 Must) Document list and re-download from shipment detail |
| REQs | REQ-DOC-011 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-162 |
| Batch · locks | 5.6 · mod-documents-download, web-docs |
| Branch | `feat/TASK-165-document-list-re-download-shipment` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/documents/list.*
- apps/web/app/features/documents/**

**Acceptance tests to write**
- All US-224 scenarios
- AT-US-224-01 … AT-US-224-07: all 7 scenarios of US-224, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
