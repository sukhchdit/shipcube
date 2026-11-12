# WAVE-01 — M0 demo-critical I: platform runtime, tenancy, identity and sessions, design-system foundations

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Must DC (+ non-DC enablers)**

Tasks: **40** (S 7 / M 33; opus 17 / sonnet 23; demo-critical 32) in **10** batches of ≤ 4 parallel tasks. Estimated effort ≈ 109.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Lane B `wave` evidence; staff and customer sign-in API + screens work in compose; generated suites green incl. new identity/org routes; lane C `wave-end` if within the monthly cap (priority tier 2, PLAN.md §8).

**Stories completed in this wave (42):** US-009 (DC), US-010 (DC), US-011 (DC), US-015 (DC), US-016 (DC), US-017 (DC), US-018 (DC), US-020 (DC), US-023 (DC), US-024 (DC), US-025 (DC), US-030 (DC), US-031 (DC), US-036, US-037, US-038 (DC), US-040, US-042 (DC), US-044, US-052 (DC), US-053 (DC), US-061 (DC), US-062 (DC), US-063 (DC), US-068 (DC), US-070, US-076 (DC), US-078 (DC), US-080 (DC), US-101 (DC), US-103, US-104, US-106, US-107 (DC), US-108 (DC), US-110 (DC), US-115 (DC), US-116 (DC), US-117 (DC), US-274 (DC), US-276 (DC), US-284 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 1.1 | TASK-035 Named BullMQ queues with retries and dead-letter queues; job payload v2 validated at dequeue<br>TASK-036 Error catalogue and validation error format<br>TASK-037 Organisation types, single operator organisation, personal organisation and type-checked memberships<br>TASK-038 Design tokens | worker-queues<br>shared-errors<br>mod-organisations<br>ui-tokens |
| 1.2 | TASK-039 Idempotent job processing<br>TASK-040 Idempotency keys<br>TASK-041 Valkey-backed rate limiting per class with RateLimit headers<br>TASK-042 Localisable strings, en/es/fr parity and ICU messages | worker-queues<br>api-idempotency<br>api-ratelimit<br>i18n-core |
| 1.3 | TASK-043 Transactional outbox writer and at-least-once relay<br>TASK-044 Server-sent events convention<br>TASK-045 Cursor pagination, filtering and sorting<br>TASK-046 Control sizing, interaction states and reduced motion | outbox<br>api-sse<br>api-pagination<br>ui-base |
| 1.4 | TASK-047 Tenant context in worker jobs resolved from PostgreSQL<br>TASK-048 CSRF protection, CORS allow-list and Origin check on login/register/reset/verify<br>TASK-049 Register an account<br>TASK-050 Locale-aware formatting, time zones and collation helpers | worker-ctx<br>api-csrf<br>identity-core<br>i18n-format |
| 1.5 | TASK-051 Guest-capable tables and atomic claim<br>TASK-052 Sign in with email and password<br>TASK-053 Responsive layout primitives, no horizontal scroll, table-to-card pattern<br>TASK-054 Six screen states through shared components | prisma-rls<br>identity-core<br>ui-layout<br>ui-states |
| 1.6 | TASK-055 Refresh cookie rotation, reuse detection and 30-day absolute cap<br>TASK-056 Active organisation context and GET /api/v1/me<br>TASK-057 TOTP enrolment and id-secret recovery codes<br>TASK-058 Inline form validation, error summary and semantic markup | identity-session<br>mod-organisations<br>identity-mfa<br>ui-forms |
| 1.7 | TASK-059 Verify email address<br>TASK-060 Request pipeline order, 401/403 outcomes, live permission resolution<br>TASK-061 MFA challenge at sign-in<br>TASK-062 Locale resolution, persistence and system-message locale | identity-core<br>api-authz<br>identity-mfa<br>fe-locale |
| 1.8 | TASK-063 Mandatory TOTP for operator members, e-mailed first-enrolment code outside local/test, 24 h deadline<br>TASK-064 Permission-aware UI helper can() and frontend route guard<br>TASK-065 Client token handling<br>TASK-066 Seed currencies and FX snapshots | identity-mfa<br>fe-authz<br>fe-session<br>prisma-seed |
| 1.9 | TASK-067 Admin app route guard, staff-only admission, MFA gate and 30-minute sliding admin refresh<br>TASK-068 Customer web shell<br>TASK-069 Admin shell<br>TASK-070 Public read-only reference endpoints complete | identity-session, api-mfa-gate<br>web-shell<br>admin-shell<br>mod-admin-settings-reference |
| 1.10 | TASK-071 Staff sign-in, MFA challenge and TOTP enrolment screens<br>TASK-072 Customer auth screens<br>TASK-073 Audit viewer API<br>TASK-074 Notification provider interface, Mailpit transport in non-production only, BullMQ send job with retries and DLQ | admin-auth<br>web-auth<br>mod-audit-viewer<br>mod-notifications |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

## Task specifications

### TASK-035 — Named BullMQ queues with retries and dead-letter queues; job payload v2 validated at dequeue

| Field | Value |
|---|---|
| Stories (completes) | US-009 **DC** (M0 Must) Named queues with retries and dead-letter queue |
| REQs | REQ-PLAT-013 |
| NFRs | NFR-RES-004 |
| Spikes / security / decisions | SEC-P3-12 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-006, TASK-010, TASK-005 |
| Batch · locks | 1.1 · worker-queues |
| Branch | `feat/TASK-035-named-bullmq-queues-retries-dead` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/shared/src/queues/{<module>.ts queue names aggregated by index, payload-v2.ts (Joi)}
- apps/worker/src/platform/queues/**
- apps/api/src/platform/queues/producer.ts

**Acceptance tests to write**
- All US-009 scenarios
- Payload v2 carries identifiers only ({v,kind,id,correlation_id,trace_context}); invalid payload -> DLQ without processing
- Crash/restart test: 0 lost jobs (NFR-RES-004)
- AT-US-009-01 … AT-US-009-05: all 5 scenarios of US-009, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-036 — Error catalogue and validation error format (problem+json codes, field errors)

| Field | Value |
|---|---|
| Stories (completes) | US-036 (M0 Must) Error catalogue and validation error format |
| REQs | REQ-API-005, REQ-API-006 |
| NFRs | NFR-SEC-009 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-017, TASK-020 |
| Batch · locks | 1.1 · shared-errors |
| Branch | `feat/TASK-036-error-catalogue-validation-error-format` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-038/US-040/US-042/US-044 (DC chain).

**Files / modules**
- packages/shared/src/errors/catalogue/platform.ts
- apps/api/src/platform/validation/joi-to-problem.ts
- apps/{web,admin} error-code -> i18n key map (common namespace)

**Acceptance tests to write**
- All US-036 scenarios
- AT-US-036-01 … AT-US-036-06: all 6 scenarios of US-036, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-037 — Organisation types, single operator organisation, personal organisation and type-checked memberships

| Field | Value |
|---|---|
| Stories (completes) | US-061 **DC** (M0 Must) Organisation types and the single operator organisation<br>US-062 **DC** (M0 Must) Personal organisation and memberships with type-checked roles |
| REQs | REQ-ORG-001, REQ-ORG-002, REQ-ORG-003, REQ-ORG-004 |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-013, TASK-016, TASK-029, TASK-032 |
| Batch · locks | 1.1 · mod-organisations |
| Branch | `feat/TASK-037-organisation-types-single-operator-organisation` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/organisations.prisma + migration (organisations, memberships; RLS from manifest)
- apps/api/src/modules/organisations/{service,repository,policies,events,index}.ts

**Acceptance tests to write**
- All US-061 and US-062 scenarios
- AT-US-061-01 … AT-US-061-05: all 5 scenarios of US-061, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-062-01 … AT-US-062-06: all 6 scenarios of US-062, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-038 — Design tokens (DTCG) compiled to Tailwind 4 theme, token lint

| Field | Value |
|---|---|
| Stories (completes) | US-101 **DC** (M0 Must) Design tokens and token lint |
| REQs | REQ-UI-001 |
| NFRs | NFR-A11Y-005 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-004, TASK-002 |
| Batch · locks | 1.1 · ui-tokens |
| Branch | `feat/TASK-038-design-tokens-compiled-tailwind-4` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/ui/tokens/tokens.json (from docs/02-ux/design-system/tokens.json)
- packages/ui/src/theme/** (CSS variables, Tailwind preset)
- tools/ui/token-lint.ts

**Acceptance tests to write**
- All US-101 scenarios (raw colour/spacing literals rejected by token lint)
- AT-US-101-01 … AT-US-101-05: all 5 scenarios of US-101, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-039 — Idempotent job processing (job_executions) and singleton scheduled jobs

| Field | Value |
|---|---|
| Stories (completes) | US-010 **DC** (M0 Must) Idempotent job processing and scheduled jobs |
| REQs | REQ-PLAT-014, REQ-PLAT-015 |
| NFRs | NFR-RES-004, NFR-SCALE-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-035 |
| Batch · locks | 1.2 · worker-queues |
| Branch | `feat/TASK-039-idempotent-job-processing-singleton-scheduled` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/platform.prisma + migration (job_executions)
- apps/worker/src/platform/jobs/{idempotent-processor.ts, schedulers.ts}

**Acceptance tests to write**
- All US-010 scenarios (duplicate job id -> single effect; scheduler singleton across 2 workers)
- AT-US-010-01 … AT-US-010-07: all 7 scenarios of US-010, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-040 — Idempotency keys (encrypted stored responses, not-applicable one-time-secret routes)

| Field | Value |
|---|---|
| Stories (completes) | US-038 **DC** (M0 Must) Idempotency keys |
| REQs | REQ-API-009, REQ-API-010, REQ-API-011 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | SEC-P3-10, D-ARCH-023 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-036, TASK-016, TASK-029 |
| Batch · locks | 1.2 · api-idempotency |
| Branch | `feat/TASK-040-idempotency-keys` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/platform.prisma + migration (idempotency_keys)
- apps/api/src/platform/idempotency/**
- tests/contract/x-idempotency.test.ts

**Acceptance tests to write**
- All US-038 scenarios
- SEC-TC-04: createQuote/createQuoteShare never create an idempotency_keys row; stored bodies are ciphertext
- SEC-TC-53 (contract part): x-idempotency not-applicable on every ADR-0014 am. 1 one-time-secret route
- AT-US-038-01 … AT-US-038-09: all 9 scenarios of US-038, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-041 — Valkey-backed rate limiting per class with RateLimit headers

| Field | Value |
|---|---|
| Stories (completes) | US-040 (M0 Must) Redis-backed rate limiting and headers |
| REQs | REQ-API-014, REQ-SEC-005, REQ-SEC-006 |
| NFRs | NFR-SEC-005 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.2 · api-ratelimit |
| Branch | `feat/TASK-041-valkey-backed-rate-limiting-per` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-155 (DC) and US-022.

**Files / modules**
- apps/api/src/platform/rate-limit/** (classes: auth, email-send, quote-create, public-read, ...)
- packages/config rate-limit keys

**Acceptance tests to write**
- All US-040 scenarios (429 problem+json, RateLimit-* headers, shared across 2 API replicas)
- AT-US-040-01 … AT-US-040-17: all 17 scenarios of US-040, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-042 — Localisable strings, en/es/fr parity and ICU messages (i18next-icu), namespaces

| Field | Value |
|---|---|
| Stories (completes) | US-115 **DC** (M0 Must) Localisable strings, en/es/fr parity and ICU messages |
| REQs | REQ-I18N-001, REQ-I18N-002, REQ-I18N-003, REQ-I18N-013 |
| NFRs | NFR-I18N-001, NFR-I18N-002 |
| Spikes / security / decisions | D-ARCH-014 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-004, TASK-002 |
| Batch · locks | 1.2 · i18n-core |
| Branch | `feat/TASK-042-localisable-strings-en-es-fr` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/ui/src/i18n/** (init, ICU, namespaces)
- apps/{web,admin}/locales/{en,es,fr}/common.json
- tools/i18n/parity.test.ts

**Acceptance tests to write**
- All US-115 scenarios (missing key in es or fr fails CI; literal string in JSX fails lint)
- AT-US-115-01 … AT-US-115-09: all 9 scenarios of US-115, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-043 — Transactional outbox writer and at-least-once relay (SKIP LOCKED batches -> BullMQ)

| Field | Value |
|---|---|
| Stories (completes) | US-011 **DC** (M0 Must) Transactional outbox and at-least-once relay |
| REQs | REQ-PLAT-016, REQ-PLAT-017 |
| NFRs | NFR-RES-004, NFR-SCALE-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-039, TASK-016 |
| Batch · locks | 1.3 · outbox |
| Branch | `feat/TASK-043-transactional-outbox-writer-at-least` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/platform.prisma + migration (outbox_events)
- apps/api/src/platform/outbox/writer.ts
- apps/worker/src/processors/outbox-relay/**
- packages/shared/src/events/<module>.ts (aggregated index)

**Acceptance tests to write**
- All US-011 scenarios (event committed with the business row; relay crash -> redelivery, consumers idempotent)
- AT-US-011-01 … AT-US-011-06: all 6 scenarios of US-011, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-044 — Server-sent events convention (framing, heartbeats, Last-Event-ID, close semantics)

| Field | Value |
|---|---|
| Stories (completes) | US-042 **DC** (M0 Must) Server-sent events convention |
| REQs | REQ-API-017, REQ-API-018 |
| NFRs | NFR-PERF-003 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.3 · api-sse |
| Branch | `feat/TASK-044-server-sent-events-convention` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/sse/**
- packages/ui/src/sse/fetch-sse-parser.ts

**Acceptance tests to write**
- All US-042 scenarios
- AT-US-042-01 … AT-US-042-08: all 8 scenarios of US-042, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-045 — Cursor pagination, filtering and sorting (keyset, signed cursors)

| Field | Value |
|---|---|
| Stories (completes) | US-037 (M0 Must) Cursor pagination, filtering and sorting |
| REQs | REQ-API-007, REQ-API-008 |
| NFRs | NFR-PERF-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.3 · api-pagination |
| Branch | `feat/TASK-045-cursor-pagination-filtering-sorting` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-097 (DC audit viewer list).

**Files / modules**
- apps/api/src/platform/pagination/**
- packages/ui/src/components/Pagination/**

**Acceptance tests to write**
- All US-037 scenarios
- AT-US-037-01 … AT-US-037-10: all 10 scenarios of US-037, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-046 — Control sizing, interaction states and reduced motion (base components)

| Field | Value |
|---|---|
| Stories (completes) | US-103 (M0 Must) Control sizing, interaction states and reduced motion |
| REQs | REQ-UI-003, REQ-UI-004, REQ-UI-005 |
| NFRs | NFR-A11Y-004, NFR-A11Y-006 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-038 |
| Batch · locks | 1.3 · ui-base |
| Branch | `feat/TASK-046-control-sizing-interaction-states-reduced` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-107 (DC).

**Files / modules**
- packages/ui/src/components/{Button,Input,Select,Checkbox,Link,Dialog (Radix)}/**

**Acceptance tests to write**
- All US-103 scenarios
- AT-US-103-01 … AT-US-103-07: all 7 scenarios of US-103, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-047 — Tenant context in worker jobs resolved from PostgreSQL (platform.job_context)

| Field | Value |
|---|---|
| Stories (completes) | US-078 **DC** (M0 Must) Tenant context in worker jobs |
| REQs | REQ-RLS-008 |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | SEC-P3-12, D-ARCH-025 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-043, TASK-016 |
| Batch · locks | 1.4 · worker-ctx |
| Branch | `feat/TASK-047-tenant-context-worker-jobs-resolved` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/migrations/<ts>_platform_job_context (SECURITY DEFINER, owner platform_definer, catalog C11)
- apps/worker/src/platform/job-context.ts

**Acceptance tests to write**
- All US-078 scenarios
- SEC-TC-20 (mandatory): processor resolves org_id from PostgreSQL; a forged org_id in Redis has no effect
- SEC-TC-50 (payload part): job payloads in Redis contain identifiers only
- AT-US-078-01 … AT-US-078-04: all 4 scenarios of US-078, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-048 — CSRF protection, CORS allow-list and Origin check on login/register/reset/verify

| Field | Value |
|---|---|
| Stories (completes) | US-044 (M0 Must) CSRF protection and CORS allow-list |
| REQs | REQ-SEC-004, REQ-SEC-014 |
| NFRs | NFR-SEC-008 |
| Spikes / security / decisions | SEC-P3-18 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.4 · api-csrf |
| Branch | `feat/TASK-048-csrf-protection-cors-allow-list` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-018 (DC).

**Files / modules**
- apps/api/src/platform/csrf/** (HMAC over session_id || app)
- apps/api/src/platform/http/cors.ts

**Acceptance tests to write**
- All US-044 scenarios
- SEC-TC-58: foreign Origin on loginUser/registerUser/resetPassword/verifyEmail -> 403 CSRF_REJECTED; text/plain -> 415
- SEC-TC-09 cookie/CSRF assertions (completed with the refresh task)
- AT-US-044-01 … AT-US-044-07: all 7 scenarios of US-044, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-049 — Register an account: compliant password, peppered bcrypt pre-hash, personal org, registration throttling

| Field | Value |
|---|---|
| Stories (completes) | US-015 **DC** (M0 Must) Register an account with a compliant password |
| REQs | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003 |
| NFRs | NFR-SEC-003 |
| Spikes / security / decisions | SEC-P3-05, SEC-P3-16, D-049, D-ARCH-042 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-037, TASK-041, TASK-029, TASK-043, TASK-040 |
| Batch · locks | 1.4 · identity-core |
| Branch | `feat/TASK-049-register-an-account-compliant-password` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/identity.prisma + migration (users, user_credentials, email_tokens)
- apps/api/src/modules/identity/core/{routes,controller,service,repository,schemas,events}.ts
- packages/shared/assets/breached-passwords-10k.txt

**Acceptance tests to write**
- All US-015 API scenarios (UI in the customer auth screens task)
- SEC-TC-46: 6th distinct address from one IP within an hour -> 429 + registration_probe; 4th registration for one identifier -> 429; identical responses for new/existing (timing <= 100 ms)
- SEC-TC-55 (pre-hash part): bcrypt input is base64(HMAC(pepper, pw)), 44 chars
- ADR-0023 am. J item 4 and D-ARCH-042 (ADR-0006 am. 16, ADR-0025 PR1-SEC amendment): password hashing sits behind a `PasswordHasher` port (`hash`, `verify`, `needsRehash`; pre-hash, cost floor, dummy-hash constant-time compare). Its single implementation module is the only importer of `bcrypt`/`bcryptjs`, which the TASK-002 import-confinement lint rule enforces. `bcrypt@6.0.0` stays under its `tools/ci/maintenance-exceptions.json` entry (expires 2027-05-11; exit = `bcryptjs` in a `worker_threads` pool behind the same port)
- AT-US-015-01 … AT-US-015-12: all 12 scenarios of US-015, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-050 — Locale-aware formatting, time zones and collation helpers (Intl only)

| Field | Value |
|---|---|
| Stories (completes) | US-116 **DC** (M0 Must) Locale-aware formatting, time zones and collation |
| REQs | REQ-I18N-004, REQ-I18N-011, REQ-I18N-014 |
| NFRs | NFR-I18N-004 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-042 |
| Batch · locks | 1.4 · i18n-format |
| Branch | `feat/TASK-050-locale-aware-formatting-time-zones` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/shared/src/intl/** (money, dates, units, useGrouping always)
- packages/ui/src/hooks/useFormat.ts

**Acceptance tests to write**
- All US-116 scenarios
- AT-US-116-01 … AT-US-116-10: all 10 scenarios of US-116, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-051 — Guest-capable tables and atomic claim (guest-token RLS branch, WITH CHECK)

| Field | Value |
|---|---|
| Stories (completes) | US-080 **DC** (M0 Must) Guest-capable tables and atomic claim |
| REQs | REQ-RLS-013 |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | SPK-03 |
| Specialist · model | database-engineer · opus |
| Complexity | S |
| Depends on | TASK-016 |
| Batch · locks | 1.5 · prisma-rls |
| Branch | `feat/TASK-051-guest-capable-tables-atomic-claim` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/sql/policy-templates/guest-capable.sql
- GUEST_CAPABLE class support in render-rls.ts and tools/db/table-classes/*.json
- prisma/tests/rls/guest-claim.int.test.ts

**Acceptance tests to write**
- All US-080 scenarios
- AT-US-080-01 … AT-US-080-07: all 7 scenarios of US-080, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-052 — Sign in with email and password: ES256 access token, session, LOGIN audit, authenticator middleware

| Field | Value |
|---|---|
| Stories (completes) | US-017 **DC** (M0 Must) Sign in with email and password |
| REQs | REQ-AUTH-005 |
| NFRs | NFR-SEC-003, NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-26 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-049, TASK-048 |
| Batch · locks | 1.5 · identity-core |
| Branch | `feat/TASK-052-sign-email-password-es256-access` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/identity.prisma + migration (sessions)
- apps/api/src/modules/identity/core/login.*
- apps/api/src/platform/auth/authenticator.ts (jose verify + revocation check)
- auth_lookup_credential call sites limited to identity/core

**Acceptance tests to write**
- All US-017 API scenarios (constant-time compare for unknown email)
- LOGIN audit entry with actor, IP and outcome
- AT-US-017-01 … AT-US-017-06: all 6 scenarios of US-017, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-053 — Responsive layout primitives, no horizontal scroll, table-to-card pattern

| Field | Value |
|---|---|
| Stories (completes) | US-107 **DC** (M0 Must) Responsive layout, no horizontal scroll, table-to-card |
| REQs | REQ-UI-011, REQ-UI-012 |
| NFRs | NFR-A11Y-004, NFR-COMPAT-003 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-046 |
| Batch · locks | 1.5 · ui-layout |
| Branch | `feat/TASK-053-responsive-layout-primitives-no-horizontal` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/ui/src/layout/**
- packages/ui/src/components/DataTable/** (TanStack Table 9, card mode)

**Acceptance tests to write**
- All US-107 scenarios (5 breakpoints, 320 px reflow)
- AT-US-107-01 … AT-US-107-05: all 5 scenarios of US-107, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-054 — Six screen states through shared components (loading, empty, error, partial, permission-denied, offline)

| Field | Value |
|---|---|
| Stories (completes) | US-104 (M0 Must) Six screen states through shared components |
| REQs | REQ-UI-006, REQ-UI-007 |
| NFRs | NFR-A11Y-002 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-046, TASK-042 |
| Batch · locks | 1.5 · ui-states |
| Branch | `feat/TASK-054-six-screen-states-through-shared` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-097/US-031 screens (DC).

**Files / modules**
- packages/ui/src/components/ScreenState/**
- packages/ui/src/components/Skeleton/** (static, no shimmer)

**Acceptance tests to write**
- All US-104 scenarios
- AT-US-104-01 … AT-US-104-09: all 9 scenarios of US-104, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-055 — Refresh cookie rotation, reuse detection and 30-day absolute cap

| Field | Value |
|---|---|
| Stories (completes) | US-018 **DC** (M0 Must) Refresh cookie, rotation and reuse detection |
| REQs | REQ-AUTH-006, REQ-AUTH-007, REQ-AUTH-008 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-01, SEC-COND-01, D-046 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-052, TASK-048 |
| Batch · locks | 1.6 · identity-session |
| Branch | `feat/TASK-055-refresh-cookie-rotation-reuse-detection` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/identity.prisma + migration (refresh_tokens)
- apps/api/src/modules/identity/session/**
- Valkey revocation set auth:revoked:<sid>

**Acceptance tests to write**
- All US-018 scenarios
- SEC-TC-09: __Host-rt_web/__Host-rt_admin, Path=/, HttpOnly, Secure, SameSite=Strict; CSRF = HMAC(session_id || app)
- SEC-TC-38: refresh at absolute age 30 d + 1 s -> 401 SESSION_EXPIRED; sliding never extends the cap; auth_time unchanged
- AT-US-018-01 … AT-US-018-11: all 11 scenarios of US-018, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-056 — Active organisation context and GET /api/v1/me (permissions, locale, memberships)

| Field | Value |
|---|---|
| Stories (completes) | US-063 **DC** (M0 Must) Active organisation context and `GET /api/v1/me` |
| REQs | REQ-ORG-005 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-037, TASK-052 |
| Batch · locks | 1.6 · mod-organisations |
| Branch | `feat/TASK-056-active-organisation-context-get-api` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/organisations/me/**

**Acceptance tests to write**
- All US-063 scenarios
- AT-US-063-01 … AT-US-063-05: all 5 scenarios of US-063, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-057 — TOTP enrolment and id-secret recovery codes

| Field | Value |
|---|---|
| Stories (completes) | US-023 **DC** (M0 Must) TOTP enrolment and recovery codes |
| REQs | REQ-AUTH-015, REQ-AUTH-016 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-16, D-ARCH-013 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-052 |
| Batch · locks | 1.6 · identity-mfa |
| Branch | `feat/TASK-057-totp-enrolment-id-secret-recovery` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/identity.prisma + migration (mfa_factors, recovery_codes)
- apps/api/src/modules/identity/mfa/enrol.*

**Acceptance tests to write**
- All US-023 scenarios
- SEC-TC-55 (recovery part): id-secret form, one HMAC compare per attempt, per-code salt
- SEC-TC-12: recovery code is a single HMAC lookup; p95 isolation assertion kept
- AT-US-023-01 … AT-US-023-08: all 8 scenarios of US-023, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-058 — Inline form validation, error summary and semantic markup (RHF + Zod form kit)

| Field | Value |
|---|---|
| Stories (completes) | US-106 (M0 Must) Inline form validation and semantic markup |
| REQs | REQ-UI-010, REQ-UI-022 |
| NFRs | NFR-A11Y-001, NFR-MAINT-003 |
| Spikes / security / decisions | D-UX-013, D-UX-021 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-046, TASK-042 |
| Batch · locks | 1.6 · ui-forms |
| Branch | `feat/TASK-058-inline-form-validation-error-summary` |
| Priority | Must |

> Scheduling note: Non-DC enabler of the DC sign-in screens.

**Files / modules**
- packages/ui/src/forms/** (Field, ErrorSummary, DecimalInput)

**Acceptance tests to write**
- All US-106 scenarios
- AT-US-106-01 … AT-US-106-08: all 8 scenarios of US-106, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-059 — Verify email address (single-use hashed token, resend limits, revoke other sessions)

| Field | Value |
|---|---|
| Stories (completes) | US-016 **DC** (M0 Must) Verify email address |
| REQs | REQ-AUTH-004 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SEC-P3-06, D-050 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-052, TASK-055, TASK-049 |
| Batch · locks | 1.7 · identity-core |
| Branch | `feat/TASK-059-verify-email-address` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/identity/core/verify.*

**Acceptance tests to write**
- All US-016 scenarios (#token= fragment links per D-ARCH-011)
- SEC-TC-47 (verify part): victim redeeming the link revokes the attacker session (next refresh -> 401 SESSION_REVOKED)
- AT-US-016-01 … AT-US-016-10: all 10 scenarios of US-016, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-060 — Request pipeline order, 401/403 outcomes, live permission resolution (5 s cache) and operator cross-tenant scope

| Field | Value |
|---|---|
| Stories (completes) | US-068 **DC** (M0 Must) Request pipeline order, 401/403 outcomes and live permission resolution<br>US-076 **DC** (M0 Must) Operator cross-tenant scope |
| REQs | REQ-RBAC-006, REQ-RBAC-008, REQ-RLS-006 |
| NFRs | NFR-SEC-011, NFR-TENANT-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-056, TASK-020, TASK-013 |
| Batch · locks | 1.7 · api-authz |
| Branch | `feat/TASK-060-request-pipeline-order-401-403` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/authz/{authorise-mw.ts, permission-cache.ts, operator-scope.ts}

**Acceptance tests to write**
- All US-068 and US-076 scenarios
- AT-US-068-01 … AT-US-068-06: all 6 scenarios of US-068, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-076-01 … AT-US-076-04: all 4 scenarios of US-076, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Security-critical path (apps/api/src/platform/**)
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-061 — MFA challenge at sign-in (TOTP or recovery code)

| Field | Value |
|---|---|
| Stories (completes) | US-024 **DC** (M0 Must) MFA challenge at sign-in |
| REQs | REQ-AUTH-017 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-057 |
| Batch · locks | 1.7 · identity-mfa |
| Branch | `feat/TASK-061-mfa-challenge-at-sign` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/identity/mfa/challenge.*

**Acceptance tests to write**
- All US-024 API scenarios
- AT-US-024-01 … AT-US-024-07: all 7 scenarios of US-024, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-062 — Locale resolution, persistence and system-message locale (LocaleSwitcher)

| Field | Value |
|---|---|
| Stories (completes) | US-117 **DC** (M0 Must) Locale resolution, persistence and system-message locale |
| REQs | REQ-I18N-006, REQ-I18N-007, REQ-I18N-008 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-042, TASK-056 |
| Batch · locks | 1.7 · fe-locale |
| Branch | `feat/TASK-062-locale-resolution-persistence-system-message` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/ui/src/i18n/resolve-locale.ts
- packages/ui/src/components/LocaleSwitcher/**
- apps/api user locale preference passthrough (PATCH /me preferences)

**Acceptance tests to write**
- All US-117 scenarios
- AT-US-117-01 … AT-US-117-09: all 9 scenarios of US-117, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-063 — Mandatory TOTP for operator members, e-mailed first-enrolment code outside local/test, 24 h deadline

| Field | Value |
|---|---|
| Stories (completes) | US-025 **DC** (M0 Must) Mandatory TOTP enrolment for operator members |
| REQs | REQ-AUTH-018 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-14, D-ARCH-027 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-061, TASK-037, TASK-043 |
| Batch · locks | 1.8 · identity-mfa |
| Branch | `feat/TASK-063-mandatory-totp-operator-members-e` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/identity/mfa/staff-enrolment.*
- housekeeping rule for the 24 h deadline (scheduled with the jobs framework)

**Acceptance tests to write**
- All US-025 scenarios
- SEC-TC-56 and SEC-TC-03 (extended): first staff enrolment with APP_ENV=staging and no e-mailed code -> 403; no enrolment after 24 h -> restricted; non-local seed creates staff without passwords
- AT-US-025-01 … AT-US-025-14: all 14 scenarios of US-025, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-064 — Permission-aware UI helper can() and frontend route guard

| Field | Value |
|---|---|
| Stories (completes) | US-070 (M0 Must) Permission-aware UI helper and frontend route guard |
| REQs | REQ-RBAC-009, REQ-RBAC-010 |
| NFRs | NFR-SEC-011 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-056 |
| Batch · locks | 1.8 · fe-authz |
| Branch | `feat/TASK-064-permission-aware-ui-helper-can` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-110 (DC).

**Files / modules**
- packages/ui/src/authz/{can.ts, RequirePermission.tsx}

**Acceptance tests to write**
- All US-070 scenarios
- AT-US-070-01 … AT-US-070-06: all 6 scenarios of US-070, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-065 — Client token handling: access token in memory, single-flight refresh across tabs, admin input-driven idle timeout

| Field | Value |
|---|---|
| Stories (completes) | US-020 **DC** (M0 Must) Client-side token handling with single-flight refresh |
| REQs | REQ-AUTH-010 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-11, D-ARCH-024 |
| Specialist · model | frontend-developer · opus |
| Complexity | M |
| Depends on | TASK-055 |
| Batch · locks | 1.8 · fe-session |
| Branch | `feat/TASK-065-client-token-handling-access-token` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/ui/src/session/** (Axios interceptor, BroadcastChannel single-flight, idle clock)

**Acceptance tests to write**
- All US-020 scenarios
- SEC-TC-39 (client part): admin idle 30 min -> silent refresh stops, logout, sign-in shown; warning alertdialog at 28 min; background refetch is not activity
- AT-US-020-01 … AT-US-020-06: all 6 scenarios of US-020, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-066 — Seed currencies and FX snapshots

| Field | Value |
|---|---|
| Stories (completes) | US-052 **DC** (M0 Must) Seed currencies and FX snapshots |
| REQs | REQ-DATA-006, REQ-DATA-014 |
| NFRs | NFR-DATA-001 |
| Spikes / security / decisions | D-019 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-023 |
| Batch · locks | 1.8 · prisma-seed |
| Branch | `feat/TASK-066-seed-currencies-fx-snapshots` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/reference.prisma (currencies, fx_snapshots) + migration
- prisma/seed/reference/{currencies,fx}.ts

**Acceptance tests to write**
- All US-052 scenarios
- AT-US-052-01 … AT-US-052-07: all 7 scenarios of US-052, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-067 — Admin app route guard, staff-only admission, MFA gate and 30-minute sliding admin refresh

| Field | Value |
|---|---|
| Stories (completes) | US-030 **DC** (M0 Must) Admin app route guard and staff-only admission |
| REQs | REQ-ADMIN-001, REQ-ADMIN-003 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-P3-11, D-ARCH-024 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-063, TASK-055, TASK-060 |
| Batch · locks | 1.9 · identity-session, api-mfa-gate |
| Branch | `feat/TASK-067-admin-app-route-guard-staff` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/auth/mfa-gate.ts
- apps/api/src/modules/identity/session/admin-policy.*

**Acceptance tests to write**
- All US-030 API scenarios
- SEC-TC-39 (server part): an admin refresh token idle > 30 min -> 401 SESSION_EXPIRED
- AT-US-030-01 … AT-US-030-06: all 6 scenarios of US-030, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-068 — Customer web shell (header, account menu, footer, environment chip, skip links)

| Field | Value |
|---|---|
| Stories (completes) | US-108 **DC** (M0 Must) Customer web shell |
| REQs | REQ-UI-013 |
| NFRs | NFR-A11Y-003 |
| Spikes / security / decisions | D-UX-020 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-053, TASK-062, TASK-065 |
| Batch · locks | 1.9 · web-shell |
| Branch | `feat/TASK-068-customer-web-shell` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/layouts/**
- apps/web/locales/*/shell.json

**Acceptance tests to write**
- All US-108 scenarios
- AT-US-108-01 … AT-US-108-09: all 9 scenarios of US-108, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-069 — Admin shell (sidebar with implemented modules only, breadcrumb, locale switch)

| Field | Value |
|---|---|
| Stories (completes) | US-110 **DC** (M0 Must) Admin shell |
| REQs | REQ-UI-016 |
| NFRs | NFR-A11Y-003 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-053, TASK-062, TASK-064, TASK-065 |
| Batch · locks | 1.9 · admin-shell |
| Branch | `feat/TASK-069-admin-shell` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/admin/app/layouts/**
- apps/admin/locales/*/shell.json

**Acceptance tests to write**
- All US-110 scenarios
- AT-US-110-01 … AT-US-110-08: all 8 scenarios of US-110, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-070 — Public read-only reference endpoints complete (countries, regions, currencies, package types; ETag + caching)

| Field | Value |
|---|---|
| Stories (completes) | US-053 **DC** (M0 Must) Public read-only reference endpoints |
| REQs | REQ-DATA-016 |
| NFRs | NFR-PERF-006 |
| Spikes / security / decisions | D-041 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-026, TASK-066 |
| Batch · locks | 1.9 · mod-admin-settings-reference |
| Branch | `feat/TASK-070-public-read-only-reference-endpoints` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/admin-settings/reference/**

**Acceptance tests to write**
- All US-053 scenarios
- AT-US-053-01 … AT-US-053-08: all 8 scenarios of US-053, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-071 — Staff sign-in, MFA challenge and TOTP enrolment screens (admin app; uqr QR)

| Field | Value |
|---|---|
| Stories (completes) | US-031 **DC** (M0 Must) Staff sign-in, MFA challenge and enrolment screens |
| REQs | REQ-ADMIN-002 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | D-ARCH-013, D-UX-026 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-067, TASK-069, TASK-058, TASK-054 |
| Batch · locks | 1.10 · admin-auth |
| Branch | `feat/TASK-071-staff-sign-mfa-challenge-totp` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/admin/app/routes/auth/**
- apps/admin/locales/*/auth.json

**Acceptance tests to write**
- All US-031 scenarios (S-D01..S-D03)
- AT-US-031-01 … AT-US-031-08: all 8 scenarios of US-031, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-072 — Customer auth screens: register, verify (banner, cross-tab), sign in, MFA challenge

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-049, TASK-059, TASK-052, TASK-061) | US-015 **DC** (M0 Must) Register an account with a compliant password<br>US-016 **DC** (M0 Must) Verify email address<br>US-017 **DC** (M0 Must) Sign in with email and password<br>US-024 **DC** (M0 Must) MFA challenge at sign-in |
| REQs | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003, REQ-AUTH-004, REQ-AUTH-005, REQ-AUTH-017 |
| NFRs | NFR-A11Y-001, NFR-A11Y-003 |
| Spikes / security / decisions | D-UX-024, D-UX-026, D-045 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-068, TASK-058, TASK-054, TASK-059, TASK-061, TASK-052 |
| Batch · locks | 1.10 · web-auth |
| Branch | `feat/TASK-072-customer-auth-screens-register-verify` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/routes/auth/**
- apps/web/locales/*/auth.json

**Acceptance tests to write**
- UI scenarios of US-015, US-016, US-017, US-024 (S-A01, S-A02, S-A03, S-A06) in en/es/fr at 360/1280 px
- M0 demo step: seeded customer Owner signs in -> account dashboard shell; access token in memory only, refresh in HttpOnly cookie
- Covers the scenarios of AT-US-015-01 … AT-US-015-12 that belong to its layer; US-015 closes in TASK-049
- Covers the scenarios of AT-US-016-01 … AT-US-016-10 that belong to its layer; US-016 closes in TASK-059
- Covers the scenarios of AT-US-017-01 … AT-US-017-06 that belong to its layer; US-017 closes in TASK-052
- Covers the scenarios of AT-US-024-01 … AT-US-024-07 that belong to its layer; US-024 closes in TASK-061

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-073 — Audit viewer API: filterable list (keyset), entry detail with diff, chain status, audited VIEW

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-081, TASK-081) | US-097 **DC** (M0 Must) Audit viewer: filterable list<br>US-098 **DC** (M0 Must) Audit viewer: entry detail with diff, and audited viewing |
| REQs | REQ-AUDIT-019, REQ-AUDIT-023, REQ-AUDIT-020, REQ-AUDIT-022 |
| NFRs | NFR-AUDIT-001, NFR-PERF-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-045, TASK-060, TASK-029, TASK-030, TASK-031 |
| Batch · locks | 1.10 · mod-audit-viewer |
| Branch | `feat/TASK-073-audit-viewer-api-filterable-list` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/audit/{routes,controller,service,repository,schemas}.ts

**Acceptance tests to write**
- API scenarios of US-097 and US-098 (operator scope, filters by org + date, one VIEW entry per list request)
- Covers the scenarios of AT-US-097-01 … AT-US-097-10 that belong to its layer; US-097 closes in TASK-081
- Covers the scenarios of AT-US-098-01 … AT-US-098-08 that belong to its layer; US-098 closes in TASK-081

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-074 — Notification provider interface, Mailpit transport in non-production only, BullMQ send job with retries and DLQ

| Field | Value |
|---|---|
| Stories (completes) | US-274 **DC** (M1 Must) Notification provider interface with channel enumeration<br>US-276 **DC** (M1 Must) Local mail catcher only in non-production<br>US-284 **DC** (M1 Must) BullMQ send job with retries and dead-letter queue |
| REQs | REQ-NOTIF-001, REQ-NOTIF-003, REQ-NOTIF-013 |
| NFRs | NFR-RES-004 |
| Spikes / security / decisions | D-018 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-043, TASK-039, TASK-014 |
| Batch · locks | 1.10 · mod-notifications |
| Branch | `feat/TASK-074-notification-provider-interface-mailpit-transport` |
| Priority | Must · demo-critical |

> Scheduling note: M1 demo-critical stories pulled into M0: US-015/016/021 (M0 Must) need e-mail delivery (D-PLAN-003).

**Files / modules**
- apps/api/src/modules/notifications/provider/{notification-provider.ts, smtp-provider.ts}
- apps/worker/src/processors/notifications/send.*

**Acceptance tests to write**
- All US-274, US-276 and US-284 scenarios
- AT-US-274-01 … AT-US-274-06: all 6 scenarios of US-274, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-276-01 … AT-US-276-06: all 6 scenarios of US-276, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-284-01 … AT-US-284-08: all 8 scenarios of US-284, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
