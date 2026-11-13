# WAVE-03 — M0 non-DC Must: hardening, negative controls, saga compensation, a11y gate, release workflow, M0 demo journey

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Must non-DC**

Tasks: **28** (S 7 / M 21; opus 13 / sonnet 15; demo-critical 0) in **7** batches of ≤ 4 parallel tasks. Estimated effort ≈ 73.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** All 113 M0 Must stories merged; M0 demo journey green on 3 engines x 2 viewports; lane B `gate`-equivalent run; lane C `release-candidate` run green on the checkpoint SHA.

**Stories completed in this wave (22):** US-019, US-021, US-022, US-039, US-041, US-043, US-045, US-046, US-047, US-069, US-079, US-089, US-093, US-102, US-105, US-113, US-120, US-123, US-125, US-204, US-205, US-292.

> **★ CHECKPOINT v0.1.0-m0** — when this wave exits, release-manager cuts the `v0.1.0-m0` pre-release through `release.yml` (D-006): lane C `release-candidate` green on the tagged SHA, lane B evidence, lightweight dossier, no gate. M1 waves start only after the tag (back-fill of Wave 4 tasks whose dependencies are met may start earlier, see PLAN.md §6).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 3.1 | TASK-095 Logout and immediate revocation incl. revoke_sessions_for_user with DB fallback<br>TASK-096 ETags and optimistic concurrency<br>TASK-097 Mock scenario directives and production exclusion<br>TASK-098 Light and dark themes with contrast verification | identity-session<br>api-etag<br>pkg-carriers-mock<br>ui-theme |
| 3.2 | TASK-099 Password reset<br>TASK-100 Soft delete and optimistic locking<br>TASK-101 Shared adapter contract test suite<br>TASK-102 Offline handling and outcome toasts | identity-core<br>prisma-ext<br>pkg-carriers-contract<br>ui-feedback |
| 3.3 | TASK-103 Progressive delay and account lockout<br>TASK-104 Permission-denied audit and cross-tenant 404<br>TASK-105 Saga compensation on permanent failure and saga fault-matrix generator<br>TASK-106 Accessibility gate | identity-core<br>api-authz<br>mod-orders-saga<br>e2e-a11y |
| 3.4 | TASK-107 Unverified-account expiry<br>TASK-108 Input hardening<br>TASK-109 createShipment retry, definitive rejection and ambiguous outcome handling<br>TASK-110 Pseudo-locale overflow tests and logical CSS | identity-core<br>api-input<br>mod-orders-saga<br>i18n-pseudo |
| 3.5 | TASK-111 Security headers, HSTS and hash-based Content-Security-Policy<br>TASK-112 Static safeguards<br>TASK-113 SSRF-safe outbound HTTP client and security-event catalogue<br>TASK-114 Fail-closed sensitive reads and downloads | api-headers, infra-nginx<br>lint<br>api-egress<br>api-audit-mw |
| 3.6 | TASK-115 Data representation rules<br>TASK-116 Chain verification job, hourly ECDSA-signed anchors and health degradation<br>TASK-117 Password-reset screens and delay/lockout messages<br>TASK-118 Query-plan registry and N+1 guard | api-repr<br>worker-audit-maint<br>web-auth<br>tests-perf-db |
| 3.7 | TASK-119 Release workflow<br>TASK-120 k6 rate-shopping SSE profiles<br>TASK-121 M0 exit-demo journeys<br>TASK-281 ZAP baseline configuration and rules file | ci-workflows<br>tests-load<br>e2e-demo<br>security-dast |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

## Task specifications

### TASK-095 — Logout and immediate revocation incl. revoke_sessions_for_user with DB fallback

| Field | Value |
|---|---|
| Stories (completes) | US-019 (M0 Must) Logout and immediate revocation |
| REQs | REQ-AUTH-009 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-19 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-055, TASK-067 |
| Batch · locks | 3.1 · identity-session |
| Branch | `feat/TASK-095-logout-immediate-revocation-incl-revoke` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/identity/session/logout.*
- prisma function revoke_sessions_for_user

**Acceptance tests to write**
- All US-019 scenarios (revoked within 5 s)
- SEC-TC-59: with Valkey stopped, suspending a user revokes access within 5 s via the DB fallback
- AT-US-019-01 … AT-US-019-06: all 6 scenarios of US-019, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-096 — ETags and optimistic concurrency (If-Match, 412/428)

| Field | Value |
|---|---|
| Stories (completes) | US-039 (M0 Must) ETags and optimistic concurrency |
| REQs | REQ-API-012, REQ-API-013 |
| NFRs | NFR-DATA-003 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 3.1 · api-etag |
| Branch | `feat/TASK-096-etags-optimistic-concurrency` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/etag/**
- packages/ui/src/components/ConflictDialog/**

**Acceptance tests to write**
- All US-039 scenarios
- AT-US-039-01 … AT-US-039-07: all 7 scenarios of US-039, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-097 — Mock scenario directives and production exclusion (X-Mock-Scenario stripped outside local)

| Field | Value |
|---|---|
| Stories (completes) | US-123 (M0 Must) Mock scenario directives and production exclusion |
| REQs | REQ-CARR-005, REQ-CARR-006 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | SEC-P3-21 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-079, TASK-014 |
| Batch · locks | 3.1 · pkg-carriers-mock |
| Branch | `feat/TASK-097-mock-scenario-directives-production-exclusion` |
| Priority | Must |

**Files / modules**
- packages/carriers/src/adapters/mock/scenarios/**
- infra/local/edge strip rule test

**Acceptance tests to write**
- All US-123 scenarios
- AT-US-123-01 … AT-US-123-11: all 11 scenarios of US-123, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-098 — Light and dark themes with contrast verification

| Field | Value |
|---|---|
| Stories (completes) | US-102 (M0 Must) Light and dark themes with contrast verification |
| REQs | REQ-UI-002 |
| NFRs | NFR-A11Y-005 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-038, TASK-046 |
| Batch · locks | 3.1 · ui-theme |
| Branch | `feat/TASK-098-light-dark-themes-contrast-verification` |
| Priority | Must |

**Files / modules**
- packages/ui/src/theme/dark.css
- packages/ui/src/components/ThemeSwitcher/**
- tools/ui/contrast.test.ts

**Acceptance tests to write**
- All US-102 scenarios
- AT-US-102-01 … AT-US-102-06: all 6 scenarios of US-102, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-099 — Password reset (reset verifies the mailbox)

| Field | Value |
|---|---|
| Stories (completes) | US-021 (M0 Must) Password reset |
| REQs | REQ-AUTH-011, REQ-AUTH-012 |
| NFRs | NFR-SEC-003 |
| Spikes / security / decisions | SEC-P3-06, D-050 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-059, TASK-086 |
| Batch · locks | 3.2 · identity-core |
| Branch | `feat/TASK-099-password-reset` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/identity/core/reset.*

**Acceptance tests to write**
- All US-021 API scenarios
- SEC-TC-47 (reset part): a successful reset sets email_verified_at
- AT-US-021-01 … AT-US-021-07: all 7 scenarios of US-021, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-100 — Soft delete and optimistic locking (version-conditional updates)

| Field | Value |
|---|---|
| Stories (completes) | US-079 (M0 Must) Soft delete and optimistic locking |
| REQs | REQ-RLS-010, REQ-RLS-011 |
| NFRs | NFR-DATA-003 |
| Spikes / security / decisions | PR26-SEC-08, D-ARCH-091, D-ARCH-092 |
| Specialist · model | database-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-032, TASK-096 |
| Batch · locks | 3.2 · prisma-ext |
| Branch | `feat/TASK-100-soft-delete-optimistic-locking` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/db/extensions/{soft-delete.ts, optimistic-lock.ts}

**Acceptance tests to write**
- All US-079 scenarios
- STANDARD-COLUMNS FOLLOW-UPS (PR #26 security PR26-SEC-08 (a), code review n5; D-ARCH-091, D-ARCH-092; data-model §7.6 amendment of 2026-11-13): the standard-columns extension stays INNERMOST (applied last; the soft-delete and optimistic-lock extensions wrap it); deleted_at and deleted_by join SERVER_CONTROLLED_FIELDS, SERVER_FIELD_API_NAMES and serverControlledFieldIssues, and the standard-columns guard platform.std_columns_guard() is extended by a reviewed CREATE OR REPLACE migration (when deleted_at is set, deleted_by = the actor; a soft delete is an UPDATE and bumps version and updated_by) with new C15 cases; where.version and the 412/409 mapping per data-model §7.6; optional: updated_at onto the database clock (data-model §7.6 item 5)
- AT-US-079-01 … AT-US-079-08: all 8 scenarios of US-079, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-101 — Shared adapter contract test suite (parameterised over Mock and recorded fixtures)

| Field | Value |
|---|---|
| Stories (completes) | US-125 (M0 Must) Shared adapter contract test suite |
| REQs | REQ-CARR-011 |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | T-QA-10 |
| Specialist · model | test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-097, TASK-075 |
| Batch · locks | 3.2 · pkg-carriers-contract |
| Branch | `feat/TASK-101-shared-adapter-contract-test-suite` |
| Priority | Must |

**Files / modules**
- packages/carriers/test/contract/**

**Acceptance tests to write**
- All US-125 scenarios (Mock passes the full suite)
- AT-US-125-01 … AT-US-125-05: all 5 scenarios of US-125, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-102 — Offline handling and outcome toasts

| Field | Value |
|---|---|
| Stories (completes) | US-105 (M0 Must) Offline handling and outcome toasts |
| REQs | REQ-UI-008, REQ-UI-009 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | D-UX-010 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-054 |
| Batch · locks | 3.2 · ui-feedback |
| Branch | `feat/TASK-102-offline-handling-outcome-toasts` |
| Priority | Must |

**Files / modules**
- packages/ui/src/components/{Toast,OfflineBanner}/**

**Acceptance tests to write**
- All US-105 scenarios
- AT-US-105-01 … AT-US-105-08: all 8 scenarios of US-105, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-103 — Progressive delay and account lockout

| Field | Value |
|---|---|
| Stories (completes) | US-022 (M0 Must) Progressive delay and account lockout |
| REQs | REQ-AUTH-013, REQ-AUTH-014 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-099, TASK-041, TASK-052 |
| Batch · locks | 3.3 · identity-core |
| Branch | `feat/TASK-103-progressive-delay-account-lockout` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/identity/core/lockout.*

**Acceptance tests to write**
- All US-022 API scenarios
- AT-US-022-01 … AT-US-022-07: all 7 scenarios of US-022, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-104 — Permission-denied audit and cross-tenant 404

| Field | Value |
|---|---|
| Stories (completes) | US-069 (M0 Must) Permission-denied audit and cross-tenant 404 |
| REQs | REQ-RBAC-007 |
| NFRs | NFR-AUDIT-006, NFR-SEC-011 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-060, TASK-029, TASK-024 |
| Batch · locks | 3.3 · api-authz |
| Branch | `feat/TASK-104-permission-denied-audit-cross-tenant` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/authz/denied-audit.ts

**Acceptance tests to write**
- All US-069 scenarios
- AT-US-069-01 … AT-US-069-05: all 5 scenarios of US-069, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-105 — Saga compensation on permanent failure and saga fault-matrix generator

| Field | Value |
|---|---|
| Stories (completes) | US-204 (M0 Must) Saga compensation on permanent failure |
| REQs | REQ-BOOK-022 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | T-QA-07, R-ARCH-07 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-094, TASK-097 |
| Batch · locks | 3.3 · mod-orders-saga |
| Branch | `feat/TASK-105-saga-compensation-permanent-failure-saga` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/orders/booking-saga/compensation.*
- tests/generated/saga/fault-matrix.int.test.ts

**Acceptance tests to write**
- All US-204 scenarios
- Fault matrix (ADR-0014): every step x failure cell -> no captured payment without a shipment, no second label
- AT-US-204-01 … AT-US-204-07: all 7 scenarios of US-204, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-106 — Accessibility gate: axe scans on every navigation and keyboard-operability specs

| Field | Value |
|---|---|
| Stories (completes) | US-113 (M0 Must) Accessibility gate: axe scans and keyboard operability |
| REQs | REQ-UI-020, REQ-UI-021 |
| NFRs | NFR-A11Y-001, NFR-A11Y-002, NFR-A11Y-003 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-054, TASK-058, TASK-004 |
| Batch · locks | 3.3 · e2e-a11y |
| Branch | `feat/TASK-106-accessibility-gate-axe-scans-every` |
| Priority | Must |

**Files / modules**
- tests/e2e/a11y/**
- tests/e2e/fixtures/keyboard.ts

**Acceptance tests to write**
- All US-113 scenarios
- AT-US-113-01 … AT-US-113-07: all 7 scenarios of US-113, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-107 — Unverified-account expiry (7 days) and pre-hijack recovery

| Field | Value |
|---|---|
| Stories (completes) | US-292 (M0 Must) Unverified-account expiry and pre-hijack recovery |
| REQs | REQ-AUTH-026 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-06, D-050 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-103, TASK-059, TASK-039 |
| Batch · locks | 3.4 · identity-core |
| Branch | `feat/TASK-107-unverified-account-expiry-pre-hijack` |
| Priority | Must |

**Files / modules**
- apps/worker/src/processors/housekeeping/unverified-expiry.*

**Acceptance tests to write**
- All US-292 scenarios
- SEC-TC-47 (expiry part): unverified 7 days -> DEACTIVATED; address can register again
- AT-US-292-01 … AT-US-292-07: all 7 scenarios of US-292, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-108 — Input hardening: unknown fields, body size, content types, timeouts (abuse suite from the generator task stays green)

| Field | Value |
|---|---|
| Stories (completes) | US-045 (M0 Must) Input hardening: unknown fields, body size, content types, timeouts |
| REQs | REQ-SEC-007, REQ-SEC-015 |
| NFRs | NFR-SEC-009, NFR-SEC-011 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-036, TASK-020, TASK-278 |
| Batch · locks | 3.4 · api-input |
| Branch | `feat/TASK-108-input-hardening-unknown-fields-body` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/http/hardening.ts

**Acceptance tests to write**
- All US-045 scenarios
- AT-US-045-01 … AT-US-045-07: all 7 scenarios of US-045, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-109 — createShipment retry, definitive rejection and ambiguous outcome handling

| Field | Value |
|---|---|
| Stories (completes) | US-205 (M0 Must) createShipment retry, definitive rejection and ambiguous outcome |
| REQs | REQ-BOOK-023 |
| NFRs | NFR-RES-002, NFR-RES-005 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-105 |
| Batch · locks | 3.4 · mod-orders-saga |
| Branch | `feat/TASK-109-createshipment-retry-definitive-rejection-ambiguous` |
| Priority | Must |

**Files / modules**
- apps/api/src/modules/orders/booking-saga/create-shipment-step.*

**Acceptance tests to write**
- All US-205 scenarios (no auto-retry after send; EXCEPTION + needs_review on ambiguity)
- AT-US-205-01 … AT-US-205-11: all 11 scenarios of US-205, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-110 — Pseudo-locale overflow tests and logical CSS

| Field | Value |
|---|---|
| Stories (completes) | US-120 (M0 Must) Pseudo-locale overflow tests and logical CSS |
| REQs | REQ-I18N-009, REQ-I18N-010 |
| NFRs | NFR-I18N-003 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-042, TASK-053 |
| Batch · locks | 3.4 · i18n-pseudo |
| Branch | `feat/TASK-110-pseudo-locale-overflow-tests-logical` |
| Priority | Must |

**Files / modules**
- packages/ui/src/i18n/pseudo.ts
- tests/e2e/pseudo-locale.spec.ts

**Acceptance tests to write**
- All US-120 scenarios (+30 % expansion without clipping)
- AT-US-120-01 … AT-US-120-06: all 6 scenarios of US-120, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-111 — Security headers, HSTS and hash-based Content-Security-Policy (from SPK-06)

| Field | Value |
|---|---|
| Stories (completes) | US-043 (M0 Must) Security headers, HSTS and Content-Security-Policy |
| REQs | REQ-SEC-001, REQ-SEC-002, REQ-SEC-003 |
| NFRs | NFR-SEC-006 |
| Spikes / security / decisions | SPK-06, SEC-P3-24 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-022, TASK-014 |
| Batch · locks | 3.5 · api-headers, infra-nginx |
| Branch | `feat/TASK-111-security-headers-hsts-hash-based` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/http/security-headers.ts
- infra/nginx/*.conf.template
- infra/local/edge/*.conf

**Acceptance tests to write**
- All US-043 scenarios
- CSP violation listener: 0 violations on all pages
- PR4-SEC-02 / PR4-SEC-06 (header suite) + PR #4 m5: the header/response suite runs against BOTH the web and admin images, including a non-matching Host (other.example) and Host: localhost, asserting Permissions-Policy, enforcing CSP with frame-ancestors none, HSTS off-local, X-Content-Type-Options: nosniff and Server: nginx without a version; the canonical origin in pre-rendered HTML equals the configured VITE_PUBLIC_ORIGIN
- AT-US-043-01 … AT-US-043-06: all 6 scenarios of US-043, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-112 — Static safeguards: parameterised SQL rule, HTML-injection lint, Joi/Zod parity test, auth_lookup_credential call-site lint

| Field | Value |
|---|---|
| Stories (completes) | US-046 (M0 Must) Static safeguards: parameterised SQL, HTML-injection lint and Joi/Zod parity |
| REQs | REQ-SEC-008, REQ-SEC-009, REQ-SEC-016 |
| NFRs | NFR-MAINT-003, NFR-SEC-002 |
| Spikes / security / decisions | SEC-P3-26 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-002, TASK-017 |
| Batch · locks | 3.5 · lint |
| Branch | `feat/TASK-112-static-safeguards-parameterised-sql-rule` |
| Priority | Must |

**Files / modules**
- tools/eslint-rules/{no-raw-sql-concat,auth-lookup-call-sites}.mjs
- .semgrep/*.yml
- tools/parity/joi-zod-parity.test.ts

**Acceptance tests to write**
- All US-046 scenarios
- PR2-SEC-04 (LOW; no-innerhtml deny-list gaps): the HTML-injection lint also reports srcdoc / JSX srcDoc, Range#createContextualFragment, DOMParser#parseFromString, Element#setHTMLUnsafe / Document.parseHTMLUnsafe, Object.assign(el, { innerHTML }) and window.document.write (not only the bare document identifier); fixtures bad-srcdoc.tsx, bad-contextual-fragment.ts, bad-window-document-write.ts listed in the negative-fixture table; the .semgrep innerHTML pack covers the same sink list
- AT-US-046-01 … AT-US-046-05: all 5 scenarios of US-046, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-113 — SSRF-safe outbound HTTP client and security-event catalogue

| Field | Value |
|---|---|
| Stories (completes) | US-047 (M0 Must) SSRF-safe outbound client and security events |
| REQs | REQ-SEC-010, REQ-SEC-012 |
| NFRs | NFR-RES-001, NFR-SEC-010 |
| Spikes / security / decisions | SEC-P3-30, PR6-SEC-01, PR6-SEC-03, PR6-SEC-07, PR6-SEC-12, SEC-TC-66, D-ARCH-068, T-83, D-ARCH-074, D-SEC-PR20-01, PR20-SEC-10, PR20-SEC-14, PR20-SEC-15, D-ORCH-025, D-ARCH-084 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-010, TASK-029 |
| Batch · locks | 3.5 · api-egress |
| Branch | `feat/TASK-113-ssrf-safe-outbound-http-client` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/egress/outbound-http-client.ts (undici dispatcher, allow-list, DNS pinning, timeouts)
- apps/api/src/platform/egress/egress-rules.ts (EgressRule { origin, pathPrefixes, tier }, egressAllowed(target, rules, ctx), rule-set assembly from enabled carrier accounts + Stripe)
- packages/shared/src/logging/security-event.ts (the catalogue landed here in PR #20 — D-SEC-PR20-01; this task EXTENDS it, never a second file)

**Acceptance tests to write**
- All US-047 scenarios
- SEC-TC-63: security-event names in packages/shared equal the api README §13 table incl. the eight SEC-P3-30 names
- PR6-SEC-01 / ADR-0010 am. 11 item 6 as made precise 2026-11-12 (PR #6 code review R2-n3, PR6-SEC-12 b/f; D-ARCH-068): rules are `EgressRule { origin, pathPrefixes, tier }` assembled at start-up as the union over ENABLED carrier accounts of each adapter static `EGRESS[account.environment]` plus the Stripe rules — no environment variable can add a rule; `egressAllowed` requires `https:`, no credentials, no port, `origin === rule.origin`, refuses `%2f`/`%5c`/`%2e` after WHATWG normalisation, matches an entry ending in `/` by `pathname.startsWith` (segment boundary) and an entry without a trailing `/` as an EXACT path, requires `rule.tier === ctx.environment` for the calling account, and re-checks every redirect hop; start-up refuses any production-tier rule unless APP_ENV = production (names only, never values)
- SEC-TC-66 (PR6-SEC-01 verification; sandbox rule set): blocked with SSRF_BLOCKED + `ssrf_blocked` event — `https://express.api.dhl.com/mydhlapi/shipments/X/tracking`, `…/mydhlapi/test/../shipments/X/tracking` (string-concatenated then `new URL`), `…/mydhlapi/test/%2e%2e/shipments`, `…/mydhlapi/testX/rates`, `…/mydhlapi/test/..%2Fshipments`, `https://wwwcie.ups.com/security/v1/oauth/tokenX`, `…/security/v1/oauth/token/x`, `https://wwwcie.ups.com/security/v1/other`; allowed — `…/mydhlapi/test/rates`, `https://wwwcie.ups.com/security/v1/oauth/token`; a local or test environment containing a production-tier rule refuses to start
- PR6-SEC-03 item 1 / PR6-SEC-02 item 3 / PR6-SEC-07 item 2 (ADR-0010 am. 11 item 8): the client records `server.address`, the method and an adapter-supplied ROUTE TEMPLATE (`DELETE /mydhlapi/test/pickups/{id}`) in logs and spans — never `url.full`, `url.path`, `url.query`, `http.url` or `http.target`; error mapping drops any `cause.message` that contains a URL; request and response bodies are never logged at any level; token-endpoint requests and responses are excluded from all body logging and raw capture (FedEx secrets travel in the form body); in-memory span exporter and log capture tests assert that a `requestorName` sentinel, an account-number sentinel and a `client_secret` sentinel never appear
- T-83 extension (D-ARCH-074): the `OutboundHttpClient` member names (and the exported factory name) are added to the `platform/no-external-calls-in-tenant-tx` list owned by TASK-020, with a negative fixture that calls the client inside a `withTenantTx` callback; the client is never handed a `TenantDb`
- PR2-SEC-04 (LOW; outbound-http-via-client gaps): HTTP_MODULES gains http2/node:http2 and net/tls connect/createConnection; NewExpression of the globals WebSocket and EventSource is reported; any READ of the global fetch identifier (not only calls: an alias, globalThis lookup or Reflect.apply) is reported through the existing isGlobal check; a literal dynamic import() of the HTTP modules is tracked; fixtures bad-http2.ts, bad-websocket.ts, bad-fetch-alias.ts; the .semgrep outbound-HTTP pack covers the same sink list and runs with --disable-nosem
- PR #20 fc1 routings (D-ORCH-025 (2); D-SEC-PR20-01; D-ARCH-084): PR6-SEC-02 item 3 / PR6-SEC-03 item 1 client halves — OutboundHttpClient records the adapter ROUTE TEMPLATE taken from the EGRESS/route registry (never a free string; a test asserts {...} placeholders for parametrised routes) and drops any cause.message containing a URL (PR20-SEC-10); PR20-SEC-14 PII-class gaps on general lines — an exact IP key set (clientip, remoteip, sourceip, userip, ipaddress, xforwardedfor, forwardedfor, forwarded, xrealip, cfconnectingip, trueclientip) plus username and login in PII_EXACT_KEYS, iban/accountnumber/bankaccount/routingnumber as parts (or delegated to the carrier lists), parentKey passed through walkArray, pairMarker reusing keyMarker; PR20-SEC-15 — isSecurityEventFields refuses a Proxy (node:util types.isProxy) before the brand read, comment corrected, unit test; SEC-TC-63 compares the request-path catalogue with the api/README §13 main table and the runtime events with the §13 runtime table
- AT-US-047-01 … AT-US-047-08: all 8 scenarios of US-047, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-114 — Fail-closed sensitive reads and downloads (503 AUDIT_UNAVAILABLE)

| Field | Value |
|---|---|
| Stories (completes) | US-089 (M0 Must) Fail-closed sensitive reads and downloads |
| REQs | REQ-AUDIT-005 |
| NFRs | NFR-AUDIT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-029, TASK-073 |
| Batch · locks | 3.5 · api-audit-mw |
| Branch | `feat/TASK-114-fail-closed-sensitive-reads-downloads` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/audit/sensitive-read.ts

**Acceptance tests to write**
- All US-089 scenarios
- AT-US-089-01 … AT-US-089-05: all 5 scenarios of US-089, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-115 — Data representation rules (money minor units, ISO dates, enums, nulls) enforced by contract tests

| Field | Value |
|---|---|
| Stories (completes) | US-041 (M0 Must) Data representation rules |
| REQs | REQ-API-016 |
| NFRs | NFR-DATA-001, NFR-DATA-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-017, TASK-036 |
| Batch · locks | 3.6 · api-repr |
| Branch | `feat/TASK-115-data-representation-rules-enforced-contract` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/serialisation/**
- tests/contract/representation.test.ts

**Acceptance tests to write**
- All US-041 scenarios
- AT-US-041-01 … AT-US-041-05: all 5 scenarios of US-041, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-116 — Chain verification job, hourly ECDSA-signed anchors and health degradation

| Field | Value |
|---|---|
| Stories (completes) | US-093 (M0 Must) Chain verification job and health degradation |
| REQs | REQ-AUDIT-013 |
| NFRs | NFR-AUDIT-003 |
| Spikes / security / decisions | SEC-COND-03, SPK-08, R-ARCH-18, PR12-SEC-04, PR12-SEC-05, D-TASK012-02, D-ARCH-076, D-ARCH-077, D-ARCH-079, PR30-SEC-06, D-ARCH-093, D-ARCH-094, PR30-SEC-03, D-SEC-PR30-02, D-ARCH-096 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-030, TASK-090, TASK-039 |
| Batch · locks | 3.6 · worker-audit-maint |
| Branch | `feat/TASK-116-chain-verification-job-hourly-ecdsa` |
| Priority | Must |

**Files / modules**
- apps/worker/src/processors/audit-maintenance/{verify.ts, anchor.ts}
- local anchor sink (RustFS bucket audit-anchors)
- apps/api/src/platform/runtime/services.ts (additive: worker-only anchorSink member, D-ARCH-094; coordinate if a concurrent batch edits it)
- apps/worker/src/processors/audit-maintenance/anchor-sink.ts (AnchorSinkWriter: putIfAbsent + isWritten(key, digest); AnchorSinkReader: read(key) returning bytes; D-ARCH-096)
- packages/config/src/{schema.ts, keys.ts} + .env.example + compose.env (additive: the two worker-only AUDIT_ANCHOR_SINK_*_REF secret references; coordinate with any batch editing packages/config)

**Acceptance tests to write**
- All US-093 scenarios
- SEC-TC-17 and SEC-TC-44 (amended): tampered entry -> CHECKPOINT_SIGNATURE_INVALID; deleted/reordered anchor or malleated signature -> ANCHOR_MISSING; anchor written hourly
- ANCHOR FORMAT AS RATIFIED (data-model §5.5/§5.6 as amended 2026-11-13; SPK-08 A-1..A-7; ADR-0007 am. 9; D-ARCH-077; hash inputs — fixed before the first anchor is written): heads_digest over the snapshot sorted by the 16 raw UUID bytes, item stream_id(16) || be64(entry_count) || head_hash(32), empty set = SHA-256 of the empty string; created_at = clock_timestamp() read in the anchor transaction, rendered by PostgreSQL as YYYY-MM-DD"T"HH24:MI:SS.US"Z" in UTC and re-read in that form; sink line = RFC 8785 JCS of { anchor_seq (JSON number), checkpoint_entry_id (lower-case UUID), created_at, heads_digest / prev_anchor_hash / anchor_hash (lower-case hex), algorithm, key_id, signature (base64 DER) } plus newline, compared as a STRING; DER parsed strictly (non-minimal integers and long-form lengths rejected; a WebCrypto path converts DER -> P1363); A-1: steps (i)-(iii) run to completion, every failing step emits its event, failure_kind by precedence CHECKPOINT_SIGNATURE_INVALID > CHECKPOINT_HEAD_MISMATCH > ANCHOR_MISSING > chain kinds, audit_chain_verifications gains failure_kinds text[] and details, a table/sink content mismatch carries detail code ANCHOR_SINK_MISMATCH, audit_anchor_missing pages like audit_chain_broken; A-6: a missing sink record is tolerated only for the newest anchor whose signed created_at lies within [now - 15 min, now + 2 min], a future-dated anchor fails; A-7: step (iii) runs on the latest anchor that passed (i) and (ii)
- AF-9/AF-12 qualifier + PR12-SEC-05 b/f + PR12-SEC-04 tripwire (D-ARCH-077, D-ARCH-076): the hourly run is incremental and detects anchored head-row changes; the NIGHTLY run starts every stream at seq 1 from ZERO32 and IGNORES last_verified_* (platform_app can update it); SEC-TC-44 variant (d) "behind-head rewrite, head row intact" (hourly: no failure, documented; nightly: PREV_HASH_MISMATCH / HASH_MISMATCH) plus the algorithm != ECDSA_P256_SHA256 and malleated (r, n-s) signature rows, test titles carrying SEC-TC-44; the audit_chain readiness check is secondary (platform_app can write audit_chain_verifications) — the security event is the primary signal; the hourly verifier also asserts evtenabled of both event triggers and tgenabled of every audit trigger and partition clone (= A, ENABLE ALWAYS) and emits audit_chain_broken on any change
- SPK-08 §8.1 PORT-THEN-DELETE (PR #12 code review M3; D-TASK012-02 (1); due at this task merge, batch 3.6, and in any case before G3): this PR ports prisma/tests/spikes/spk08-anchor.int.test.ts (SEC-TC-44 (a)-(c), ANCHOR-02/06/07 incl. the >= 11-anchor ORDER-BY regression of AF-1, plus the PR12-SEC-05 b variants) into its verifier integration suite and the golden vectors into a packages/audit unit test, and prisma/tests/spikes/spk08/anchor-prototype.ts (headsDigest, anchorHash, derToP1363, sinkLine JCS, verifier steps) into product code in packages/audit with unit tests, then DELETES both files in the SAME commit as the port
- ANCHOR SINK CONDITIONS (PR #30 code review R1-m6, security PR30-SEC-06; ADR-0021 am. 2; data-model §5.2 amendment of 2026-11-13; D-ARCH-093, D-ARCH-094): (1) the sink is built from its OWN secret references and the audit-anchors bucket as Pick<ObjectStorage, putIfAbsent | head | get> (no put, no delete) and exposed as a worker-only anchorSink member of RuntimeServices — never from the documents RuntimeServices.storage, which PR #30 or the first documents consumer (TASK-147) exposes for documents only; a composition test asserts that the anchor credential keys and bucket differ from storage (values may coincide in Compose); (2) THIS task owns the putIfAbsent retry semantics, not the port: the sink line is a pure function of the audit_anchors row, so a retry re-sends identical bytes; created:true is done; created:false — the normal result of a retry whose first attempt succeeded and whose response was lost (412 on If-None-Match: *), or of a concurrent writer — asks the sink wrapper isWritten(key, digest), which decides from bytes the store vouches for and NEVER from the metadata claim (ADR-0021 am. 2 item 3 as replaced 2026-11-13, D-ARCH-096; PR #30 security r2 R2.5, D-SEC-PR30-02): head().checksumSha256 (the SHA-256 the store verified when the object was written through the port, lowercase hex) is compared with the digest of the line this run just built; when it is absent (an object not written through the port, or a composite checksum that the adapter drops) get() is called and the sha256 the adapter RECOMPUTED over the bytes is compared; head().sha256 is the metadata claim of whoever wrote the object and is never read; equal is success; different, absent after the 412, or get() throwing INTEGRITY_MISMATCH or TOO_LARGE is ANCHOR_SINK_MISMATCH (alert, never an overwrite, never retried as transient); UNAVAILABLE from either call is retried inside the sink window; the writer passes the digest of its line as sha256 to putIfAbsent so that the store verifies it on receipt; the wrapper that anchor.ts receives has exactly putIfAbsent and isWritten(key, digest) and the one that verify.ts receives has exactly read(key) returning bytes (the verifier keeps its byte-exact table/sink comparison, A-1 and A-6) — no head and no hash-returning member is reachable from either file, enforced by a type-level test and by a grep test that neither file reads the sha256 of a head result; loopback unit tests with a store that applies the first PUT, drops its response and answers 412 to the retry (created:false, both requests carry If-None-Match: *) and then the branches: checksum equal, checksum different, checksum absent with get() equal and different, an object written with the SDK default CRC32 (checksumSha256 undefined, get fallback), and a PRE-SEEDED attacker object whose metadata claims the digest of the line while the bytes differ — the RustFS contract case of R2.5 (head().sha256 equals, head().checksumSha256 does not, get() throws INTEGRITY_MISMATCH) ends in ANCHOR_SINK_MISMATCH with the foreign bytes untouched; (3) AWS answers a concurrent conditional write with 409 ConditionalRequestConflict (RustFS cannot produce it, R-ARCH-05): it is retryable with jittered backoff inside the 15-minute sink retry window, never success and never created:false without the head comparison — unit rows with a fake store returning 409 then 200 and 409 then 412 (the adapter maps 409 ConditionalRequestConflict and 400 RequestTimeout to UNAVAILABLE, BadDigest to INTEGRITY_MISMATCH and ExpiredToken to ACCESS_DENIED — landed in PR #30, head 5f45a8b, code review r2 error-map probe and security r2 R2.3 row 4, merge pending; ACCESS_DENIED, INTEGRITY_MISMATCH and INVALID_ARGUMENT are not retried and fail the run closed with an alert; ADR-0021 am. 2 item 4 as replaced, D-ARCH-096); (4) the hourly tripwire also asserts to_regprocedure(platform.audit_ddl_guard()) IS NOT NULL (R2-n3 detection until the next guard version exempts by evtfoid); (5) the worker IAM wording of ADR-0021 am. 2 (PutObject plus GetObject and ListBucket on anchors/, no delete, no bypass) is carried by COND-G4-PROD, no code; (6) FAIL-CLOSED CREDENTIAL PAIR (ADR-0021 am. 2 item 6, D-ARCH-096; PR #30 code review r2 flag 3, security r2 R2.7): when AUDIT_ANCHOR_SINK is an s3: URL its two secret references AUDIT_ANCHOR_SINK_ACCESS_KEY_ID_REF and AUDIT_ANCHOR_SINK_SECRET_ACCESS_KEY_REF (worker only; added to the packages/config schema, the key register, .env.example and compose.env by this task) must both resolve or both be unset; exactly one is an AnchorSinkConfigError that names the two keys and never a value, thrown by the worker composition BEFORE any client, pool or queue is created; the pair is one more row of the CREDENTIAL_PAIRS table of the TASK-014 configuration guard (exit 78, reason storage.credentialPair), so that the worker exits 78 at configuration load and the composition throw is defence in depth; unset anchor references NEVER fall back to the STORAGE_* references (a composition test that sets only the STORAGE pair asserts that the s3: sink then refuses to start); in staging and production both anchor references are refused by the same hardened-environment rule (the IAM task role is the identity, ADR-0021 am. 2 item 1) and the anchor bucket must differ from STORAGE_BUCKET_DOCUMENTS; the file: sink of Compose and local needs no credentials, so the rule applies to the s3: form that the integration tests run against RustFS and that M5 uses
- AT-US-093-01 … AT-US-093-05: all 5 scenarios of US-093, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-117 — Password-reset screens and delay/lockout messages (customer web)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-099, TASK-103) | US-021 (M0 Must) Password reset<br>US-022 (M0 Must) Progressive delay and account lockout |
| REQs | REQ-AUTH-011, REQ-AUTH-012, REQ-AUTH-013, REQ-AUTH-014 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-072, TASK-099, TASK-103 |
| Batch · locks | 3.6 · web-auth |
| Branch | `feat/TASK-117-password-reset-screens-delay-lockout` |
| Priority | Must |

**Files / modules**
- apps/web/app/routes/auth/reset/**
- apps/web/locales/*/auth.json

**Acceptance tests to write**
- UI scenarios of US-021 and US-022 (S-A04, S-A05, S-A01 lockout copy) in en/es/fr
- Covers the scenarios of AT-US-021-01 … AT-US-021-07 that belong to its layer; US-021 closes in TASK-099
- Covers the scenarios of AT-US-022-01 … AT-US-022-07 that belong to its layer; US-022 closes in TASK-103

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-118 — Query-plan registry and N+1 guard (Prisma query counter, EXPLAIN tests at volume)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-PERF-006 |
| Spikes / security / decisions | — |
| Specialist · model | performance-engineer · opus |
| Complexity | M |
| Depends on | TASK-032, TASK-045, TASK-276 |
| Batch · locks | 3.6 · tests-perf-db |
| Branch | `feat/TASK-118-query-plan-registry-n-1` |
| Priority | Enabler |

**Files / modules**
- tests/perf-db/{registry.ts, query-plans.int.test.ts} (uses the query counter of the test-harness task)

**Acceptance tests to write**
- NFR-PERF-006: registered list queries use index scans at 100k rows; any request > 12 queries fails the API suite

**DoD notes**
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-119 — Release workflow: GHCR promotion, Trivy re-scan, SBOMs, git-cliff notes, pre-release support (v0.1.0-m0)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-OPS-003, NFR-SEC-002 |
| Spikes / security / decisions | D-005, D-006, SEC-P3-25 |
| Specialist · model | devops-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-015, TASK-014 |
| Batch · locks | 3.7 · ci-workflows |
| Branch | `feat/TASK-119-release-workflow-ghcr-promotion-trivy` |
| Priority | Enabler |

**Files / modules**
- .github/workflows/release.yml
- compose.release.yaml
- cliff.toml
- docs/06-release/README.md (attestation wording, SEC-P3-25 item d)

**Acceptance tests to write**
- Dry run on a test tag in a fork-safe mode: guard rejects a SHA without a green lane C release-candidate run; promoted images start from GHCR and pass the smoke test (NFR-OPS-003)

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-120 — k6 rate-shopping SSE profiles (first result, complete, hung carrier)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-PERF-002, NFR-PERF-003, NFR-PERF-007 |
| Spikes / security / decisions | — |
| Specialist · model | performance-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-091, TASK-280 |
| Batch · locks | 3.7 · tests-load |
| Branch | `feat/TASK-120-k6-rate-shopping-sse-profiles` |
| Priority | Enabler |

**Files / modules**
- tests/load/scenarios/quote-sse.js (on the k6 harness)

**Acceptance tests to write**
- NFR-PERF-002 first result <= 1.5 s p95 and NFR-PERF-003 complete <= 5 s on the reference host; evidence under docs/05-quality/performance/runs/

**DoD notes**
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-121 — M0 exit-demo journeys (Playwright + API): sign-in both apps, guest quote, mock booking, audit viewer, generators

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-COMPAT-002, NFR-QUAL-006 |
| Spikes / security / decisions | PRD §6.1, D-006 |
| Specialist · model | e2e-test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-081, TASK-094, TASK-072, TASK-093, TASK-089 |
| Batch · locks | 3.7 · e2e-demo |
| Branch | `feat/TASK-121-m0-exit-demo-journeys-sign` |
| Priority | Enabler |

**Files / modules**
- tests/e2e/demo/m0-exit.spec.ts
- tests/api/demo/m0-exit.api.test.ts

**Acceptance tests to write**
- PRD §6.1 all five scenarios green on Chromium, Firefox, WebKit at 360 and 1280 px (lane B wave profile)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-281 — ZAP baseline configuration and rules file (reasons and decision IDs) for lane B wave/gate

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-SEC-002 |
| Spikes / security / decisions | T-QA-09 |
| Specialist · model | devops-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-111, TASK-014 |
| Batch · locks | 3.7 · security-dast |
| Branch | `feat/TASK-281-zap-baseline-configuration-rules-file` |
| Priority | Enabler |

**Files / modules**
- tests/security/zap/{zap-baseline.conf, rules.tsv}
- quality:heavy hook (wave/gate)

**Acceptance tests to write**
- ZAP baseline against the compose stack: 0 High; every ignored rule has a reason and a decision ID
- Result converted to JUnit for the manifest

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
