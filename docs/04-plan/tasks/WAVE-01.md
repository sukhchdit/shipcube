# WAVE-01 — M0 demo-critical I: platform runtime, tenancy, identity and sessions, design-system foundations

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Must DC (+ non-DC enablers)**

Tasks: **40** (S 7 / M 33; opus 17 / sonnet 23; demo-critical 33) in **10** batches of ≤ 4 parallel tasks. Estimated effort ≈ 109.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Lane B `wave` evidence; staff and customer sign-in API + screens work in compose; generated suites green incl. new identity/org routes; lane C `wave-end` if within the monthly cap (priority tier 2, PLAN.md §8).

**Stories completed in this wave (43):** US-009 (DC), US-010 (DC), US-011 (DC), US-015 (DC), US-016 (DC), US-017 (DC), US-018 (DC), US-020 (DC), US-023 (DC), US-024 (DC), US-025 (DC), US-030 (DC), US-031 (DC), US-036, US-037, US-038 (DC), US-040, US-042 (DC), US-044, US-052 (DC), US-053 (DC), US-061 (DC), US-062 (DC), US-063 (DC), US-068 (DC), US-070, US-076 (DC), US-078 (DC), US-080 (DC), US-087 (DC), US-101 (DC), US-103, US-104, US-106, US-107 (DC), US-108 (DC), US-110 (DC), US-115 (DC), US-116 (DC), US-117 (DC), US-274 (DC), US-276 (DC), US-284 (DC).

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
| Spikes / security / decisions | SEC-P3-12, D-062, D-ARCH-084, D-TASK020-91, D-ORCH-073, D-ARCH-136 |
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
- AT-US-008-03 job-payload hop (D-062): payload v2 `correlation_id` is populated by the producer from the originating request or outbox context — never generated by the producer — and the worker binds it as the logger correlation_id for the whole job (re-proving the TASK-010 binding on the real payload v2); TASK-047 edits of job-context.ts must keep this binding — this line and the TASK-092 end-to-end test catch a regression
- WORKER ENTRY POINT (D-ORCH-073; D-TASK020-73..76 for the api; D-TASK020-91; PR #54 code review R1-n6; PR #39 R2-n2; D-ARCH-136): the first PR that changes apps/worker/src/main.ts carries this, and this task is the first planned one (it wires the queues into the worker runtime) — the worker start-up composition moves into an injectable startWorker(deps) module without top-level await, main.ts becomes startWorker().catch(raiseStartupError), both are covered by executed tests (entry-points.test.ts pins moved, a main.ts body pin), and the stale line-27 comment is fixed to name the exit code installProcessErrorHandlers chooses (1, or 78 for a runtime configuration error) — no coverage exclusion, waiver, ignore comment or threshold change; TASK-283 does not touch main.ts (images only)
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
| Spikes / security / decisions | D-TASK017-01, D-ARCH-084 |
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
- D-TASK017-01 (3) (D-ARCH-084): api/README §15 assertion 6 lands here — every `x-error-codes` entry exists in the error catalogue and has a response for its status, and each module routeErrors set is a subset of the x-error-codes of its operations; the catalogue-membership check PR #21 deferred is activated in the contract test
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
| Spikes / security / decisions | DR-A14, PR11-SEC-03, PR11-SEC-06, PR11-SEC-07, PR11-SEC-10, D-TASK016-01, D-ARCH-071, D-ARCH-072, D-ARCH-074, PR26-SEC-03, D-ARCH-091, D-SEC-PR26-01, D-SEC-TM-01, PR43-SEC-05, PR43-SEC-06, PR43-SEC-09, D-SEC-PR43-01, D-SEC-PR43-02, D-ARCH-123, D-ARCH-125, D-067, PR43-SEC-11, PR52-SEC-01, D-ARCH-137 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-013, TASK-016, TASK-024, TASK-029, TASK-032 |
| Batch · locks | 1.1 · mod-organisations |
| Branch | `feat/TASK-037-organisation-types-single-operator-organisation` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/organisations.prisma + migration (organisations, memberships; RLS rendered from the manifest, pasted verbatim)
- tools/db/table-classes/organisations.json (organisations TENANT policySet dr-a14-organisations definerRead; memberships TENANT policySet dr-a14-memberships definerRead; invitations TENANT definerRead)
- migration: prisma/sql/function-templates/app-is-operator.sql applied verbatim after both RLS blocks (GRANT EXECUTE ON platform.app_actor_id() TO platform_definer before SET ROLE)
- prisma/tests/catalog adaptations (plantProbe, C11 helper expectation, C3 derived set)
- apps/api/src/modules/organisations/{service,repository,policies,events,index}.ts

**Acceptance tests to write**
- All US-061 and US-062 scenarios
- PREREQUISITES CHECK before the first CREATE POLICY migration (D-ARCH-072, D-ARCH-074): TASK-024 has merged the DR-A14 templates and `policySet`, rule 9 renderer equality, the C3 derived set and the C11 converse; PR #11 (TASK-016) has merged the rule 16 operator-atom exemption (PR11-SEC-03 item 1), rule 11 session-form-only, rule 15 SET-ROLE-only and rule 9 grant-after-FORCE (PR11-SEC-07) — if any is missing this task reports BLOCKED naming the item; no local loosening of the linter, no inline disable, no hand-written policy
- DR-A14 APPLICATION (data-model §4.3 as amended 2026-11-13; D-ARCH-072): the `organisations` and `memberships` RLS blocks are rendered by `tools/db/render-rls.ts` from the manifest entries (`policySet`) and pasted verbatim — `p_organisations__active` / `__member_read` (positive list `IN ('ACTIVE','SUSPENDED')`) / `__operator` / `__definer_read`, `p_memberships__tenant` / `__own_read` / `__operator` / `__definer_read`; migration order follows the prefix-safety principle (data-model §8.3): CREATE TABLE → ENABLE + FORCE → policies → GRANT (rule 9 b), then the `app_is_operator()` template inside one `SET ROLE platform_definer; … RESET ROLE;` block after both definer-read policies, preceded by `GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer` as the migrator (D-TASK016-01 decision 3 accepted, D-ARCH-071); `down.sql` is prefix-idempotent (rule 17) and the up-down-up prefix check passes
- Catalog adaptation (PR #11 `plantProbe`, C11, C3): the probe no longer plants `memberships`/`organisations` nor renders `app_is_operator()` (the real objects exist); C11 expects `platform.app_actor_id()` EXECUTE for `platform_app`, `platform_migrator` AND `platform_definer`, and `platform.app_is_operator()` owned by `platform_definer`, SECURITY DEFINER, fixed search_path, EXECUTE for `platform_app` only; the C3 derived set includes the DR-A14 policies; `memberships` policies contain no subquery (recursion invariant); C2 special-cases `organisations` on `id`; C12 context probes (org A sees its organisation and memberships only; an actor sees own memberships across orgs; a customer with `app.actor_scope = OPERATOR` forced still sees nothing of org B because `app_is_operator()` is false)
- MERGE CONDITION (PR11-SEC-10; PR #11 security review §5 ruling 5; D-ARCH-072): security-analyst signs off the rendered DR-A14 policies in the change-scoped review — positive status lists, exact EXISTS shapes, no context value under coalesce/NOT/IS DISTINCT FROM, recursion invariant, grant order — before merge
- STANDARD-COLUMNS GUARD APPLICATION (PR26-SEC-03; D-ARCH-091; data-model §7.6 amendment of 2026-11-13; ADR-0009 am. 1): the PREREQUISITES CHECK above also requires that TASK-024 has merged `prisma/sql/function-templates/std-columns-guard.sql`, the manifest-driven `trg_<table>__std_columns` rendering and catalog C15 — if any is missing this task reports BLOCKED naming it. The FIRST migration that creates a runtime-writable standard-column table creates platform.std_columns_guard() from the template verbatim (as the migrator, plain CREATE FUNCTION, SECURITY INVOKER) and the rendered trigger on every STD table it creates (organisations, memberships, invitations, and users if created here), pasted verbatim and never hand-written; C15 has its first instances and the planted-forgery matrix is green on them; DUE before this task merges (merge condition, security sign-off together with the DR-A14 policies). The other checks that the PR #26 security record section 5 assigns to this task stay binding (D-SEC-PR26-01): PR26-SEC-01 and -02 closed in PR #26, the PR26-SEC-06 parity assertion (every model field whose dbName is one of the eight server column names id, created_at, updated_at, created_by, updated_by, version, org_id, on_behalf_of_org_id is named as the extension expects, and the converse), a planted-row control for an UPDATE that re-parents org_id, the first on_behalf_of_org_id column with ck_<table>__on_behalf_null_m1 (the catalog-std rule gets its first instance), and users rows with is_system for exactly the two reserved ids (PR26-SEC-04)
- SEC-TC-74 (proposed ID, D-SEC-TM-01; adoption note 1): the planted-forgery matrix required above carries [SEC-TC-74] and is part of the evidence run of this PR; it is a merge condition, earlier than any checkpoint
- MERGE PREREQUISITES FROM PR #43 (D-SEC-PR43-01/02, D-ORCH-063/064; D-ARCH-125): before this task merges (a) PR #43 code review R1-m3 is fixed — the DR-A14 probe layer (tests/generated/rls/probe.ts DR_A14_DDL and the C3 users table) creates and grants tables individually by PROBE_ENTRIES, so the real organisations and memberships of this migration do not collide (42P07) and the generated suite stays green with users still planted; (b) PR43-SEC-05 — linter rule 7 refuses ENABLE REPLICA | ALWAYS TRIGGER | RULE, C15 (a) committed asserts the full per-row trigger shape (enabled O, row, BEFORE, INSERT and UPDATE, not DELETE or TRUNCATE) and that no other enabled BEFORE INSERT/UPDATE ROW trigger sorts after trg_<t>__std_columns on an in-scope table, and the generator listing returns tgenabled; (c) PR43-SEC-06 — both lanes refuse SET, set_config and routine SET of standard_conforming_strings and backslash_quote (catalog: no pg_proc.proconfig or pg_db_role_setting names them), query_to_xml, query_to_xmlschema, query_to_xml_and_xmlschema, ts_stat and ts_rewrite are treated like EXECUTE in rule 16 and DYNAMIC_SQL_SQL, containsEscapeString returns true beyond the depth cap, both dynamic-SQL allow-lists are keyed by name plus the SHA-256 of the normalised body; (d) PR43-SEC-09 (b) — _prisma_migrations and bootstrap_migrations gain runtimeReadOnly in tools/db/table-classes/platform.json; (e) PR #43 record section 6 — the real users, memberships and organisations are listed with policySet and definerRead, and trg_organisations__type_immutable and ux_organisations__single_operator ship in the same migration as app_is_operator(); (a)-(d) are PR #43 fix-cycle items where cheap, otherwise this task lands them first and its PR body says which
- NO INVITED MEMBERSHIP (D-ARCH-123; product-manager D-067; PR43-SEC-09 (a); data-model memberships and invitations notes of 2026-11-14): this task writes memberships only as ACTIVE (registration, personal organisation); the dr-a14-memberships set is unchanged; invitations is a TENANT table and the whole pending state of an invitation (TASK-227 creates no membership before acceptance); the membership_status CHECK keeps INVITED as a reserved value and a C12 probe asserts that no fixture or seed writes it
- MERGE PREREQUISITE TASK-290 (TASK-024-F rlsfu; D-ORCH-074; D-ARCH-137): PR43-SEC-11 (inside a BEGIN ATOMIC body the splitter counts case and begin atomic labels as openers and a later top-level END resynchronises it, so a hostile statement after such a routine lints clean) is fixed by TASK-290 before this task merges, OR this task proves in its PR body that it adds no BEGIN ATOMIC routine and the reviewer records it; the PR52-SEC-01 shadow-init KEEP fix also lives in TASK-290 and is a merge prerequisite of any task that adds a prisma/bootstrap/*.sql file after PR #52 (D-ARCH-135)
- AT-US-061-01 … AT-US-061-05: all 5 scenarios of US-061, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-062-01 … AT-US-062-06: all 6 scenarios of US-062, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- memberships.user_id references users(id), which TASK-049 creates later (identity.prisma, lock identity-core): senior-developer decides at dispatch whether this task also creates the minimal `users` table of data-model §3.1 with its `dr-a14-users` policy set (then it takes lock identity-core for this batch) or TASK-049 adds the FK as NOT VALID + VALIDATE (rule 6); the decision is recorded in DECISIONS.md and the users policy set ships with whichever task creates the table
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
| Spikes / security / decisions | SEC-P3-10, D-ARCH-023, PR19-SEC-01, D-ARCH-080 |
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
- PR19-SEC-01 CONSUMER (D-ARCH-080; FIRST writable SYSTEM model): idempotency_keys is reached only through the platform/idempotency port via systemDelegates(tx) (TASK-020 mechanism) — never from a module repository; the lint allow-list names apps/api/src/platform/idempotency/**; the port is the only writer and reader of the ciphertext response bodies
- PRECONDITION (D-ARCH-104): TASK-020 part 020-B is merged (the runner and the AppDb types exist); the idempotency platform folder takes AppDb as a type and imports no value from the generated client
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
| Stories (partial; completed by TASK-073) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| REQs | REQ-API-014, REQ-SEC-005, REQ-SEC-006, REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 |
| NFRs | NFR-SEC-005 |
| Spikes / security / decisions | PR21-SEC-01, D-ARCH-084, D-ARCH-125, PR48-SEC-06, D-TASK027-11, D-ARCH-134 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.2 · api-ratelimit |
| Branch | `feat/TASK-041-valkey-backed-rate-limiting-per` |
| Priority | Must · demo-critical |

> Scheduling note: Non-DC enabler of US-155 (DC) and US-022.

**Files / modules**
- apps/api/src/platform/rate-limit/** (classes: auth, email-send, quote-create, public-read, ...)
- packages/config rate-limit keys

**Acceptance tests to write**
- All US-040 scenarios (429 problem+json, RateLimit-* headers, shared across 2 API replicas)
- PR21-SEC-01 step 5 (PR #21 security review; D-ARCH-084; owner resolved here, not TASK-108): the step-0 per-IP limiter (ADR-0016 am. 1) fills the pipeline slot TASK-020 fixed BEFORE `routes` (path-less), so /api/docs/* is limited like every other public route; the TASK-020 pipeline-order test stays green and a test proves a docs path returns 429 after the step-0 budget
- AT-US-087-04 (D-ARCH-125; PR #42 code review R1-m5; ADR-0016 am. item 1; EC-A12): this task owns the trusted proxy chain — the Express trust-proxy setting is derived from TRUST_PROXY_HOPS (hops or CIDRs of the edge) in the api composition, so req.ip is the first untrusted hop; api test: a request whose X-Forwarded-For carries a forged leading address from an untrusted hop yields req.ip (and therefore the audit entry IP that TASK-029 copies and the step-0 limiter key) equal to the first untrusted hop, never the forged value; the local edge proxy in Compose counts as one trusted hop; US-087 is partial here
- RBAC MATRIX SEAM (PR48-SEC-06; PR #48 code review R1-m3; D-TASK027-11; D-ARCH-134): when the step-0 per-IP limiter becomes real, the generated matrix (tests/generated/rbac) needs a seam to pass it — a createApp option reachable only from tests (no environment variable or configuration switch) plus a test that the production composition passes the real limiter; the seam is listed in the still-stubbed list of the matrix app (TASK-289) and retired like the credential seams when its owner lands
- AT-US-040-01 … AT-US-040-17: all 17 scenarios of US-040, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-087-01 … AT-US-087-08 that belong to its layer; US-087 closes in TASK-073

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
- PR #4 code review m2 + R3-n1 (routed to this task): during SPA-mode hydration the web root renders DEFAULT_LOCALE and switches after hydration (useSyncExternalStore pattern; isSpaMode from window.__reactRouterContext) so /es/no-such-page and every /es/account/... page hydrate without React #418; the served locale is captured ONCE before hydration (module-level SERVED_LANG = document.documentElement.lang) because later Suspense boundaries hydrate after the root has patched lang, and modules are isolated in the test; e2e cases on /es/no-such-page and admin lng=fr under the console-error guard (never allow-listed); the admin meta() cookie read at render stays; PR #4 code review R4-m1 joins this line if the TASK-015 Linux WebKit repeat run (--repeat-each=5) reproduces the SPA-fallback lang=en assertion (D-ARCH-084)
- PR #4 code review m6 (first lazy-route task — applies here if this task adds the first lazy route, otherwise to TASK-038 / the wizard): .size-limit.json splits into public initial (entry + root + locale layout + home chunks), authenticated initial (NFR-WEB-004 350 kB) and a per-file <= 150 kB lazy-chunk check, plus the manifest test that admin code is absent from the web bundle and vice versa
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
| Spikes / security / decisions | PR2-SEC-05, PR11-SEC-05, D-ARCH-074, D-062, PR19-SEC-01, D-ARCH-080, D-ARCH-084 |
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
- PR2-SEC-05 addendum / PR11-SEC-05 item 2 (ADR-0005 am. 10 item 2; D-ARCH-074): `apps/api/src/platform/outbox/writer.ts` takes the `TenantDb` of the business transaction and nothing else — no own PrismaClient, no `pg`/`pg-pool` import (negative lint fixture for this exact file); the worker relay reads `outbox_events` (SYSTEM, no RLS; `SKIP LOCKED` batches via $queryRaw with bound parameters) through the worker runtime runner under the SYSTEM actor context, never through a second pool or the root client
- AT-US-008-03 outbox hop (D-062): `outbox_events.correlation_id` is set by the writer from the request context of the business transaction, and the relay copies that value into the `correlation_id` of the payload v2 job it enqueues — a correlation ID never changes between the row and the job (test: row value equals job payload value equals the originating X-Correlation-Id)
- PR19-SEC-01 CONSUMER (D-ARCH-080): outbox_events is reached only through the platform/outbox port via systemDelegates(tx) — no module repository addresses it (the TASK-020 lint rule allow-lists apps/api/src/platform/outbox/** and the worker relay); the writer signature stays TenantDb-only as the line above requires
- D-ARCH-106 (ADR-0005 am. 11 item 18): outbox.publish(db, event) inside the handler transaction is the sanctioned way to cause an effect after commit (notifications, saga steps, Valkey writes that must follow a commit such as session revocation); a positive T-83 fixture pins it (outbox is never added to the lint names option) and apps/api/src/platform/outbox/writer.ts is a whole-file T-83 root
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
| Spikes / security / decisions | D-ORCH-023, D-ARCH-084, PR44-SEC-13, D-SEC-PR44-02, D-ORCH-076 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.3 · api-sse |
| Branch | `feat/TASK-044-server-sent-events-convention` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/sse/**
- packages/ui/src/sse/fetch-sse-parser.ts
- tests/api/helpers/expect-event-stream.ts

**Acceptance tests to write**
- All US-042 scenarios
- PR #21 code review R1-m5 remainder (D-ORCH-023 (1); api/README §16.4; D-ARCH-084): the `expectEventStream` helper in tests/api/helpers (framing, heartbeat and Last-Event-ID assertions validated against the contract) lands here as its first consumer
- D-ARCH-106 (ADR-0003 am. 2026-11-13): a stream is never produced inside a tenant transaction: the replay read is a short transaction and the stream body is completed after COMMIT through the stream hook of TASK-020 part 020-C, which this task consumes (this task defines the stream result type and the framing); this task does not start before part 020-C has merged
- PR44-SEC-13 (LOW, pre-existing since TASK-006; D-SEC-PR44-02; D-ORCH-076; DUE before this task merges — the first route that can fail after headers are sent): after headers are sent the problem handler passes the AppError to next() and Express 5 prints the unredacted server-only cause with console.error; the handler passes a code-only AppError (no cause, no meta, no message beyond the code) to next() and logs the redacted cause itself; unit test with a route that throws after res.write and a spy on console.error asserting that no cause text reaches it
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
| Spikes / security / decisions | SEC-P3-12, D-ARCH-025, D-062, PR19-SEC-01, D-ARCH-080, D-ARCH-086, D-ORCH-033 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-043, TASK-016 |
| Batch · locks | 1.4 · worker-ctx |
| Branch | `feat/TASK-047-tenant-context-worker-jobs-resolved` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/migrations/<ts>_platform_job_context (SECURITY DEFINER, owner platform_definer, catalog C11)
- apps/worker/src/platform/job-context.ts
- apps/worker/src/platform/db/ (worker withTenantTx twin: per-tenant admission bulkhead inherited from TASK-025, D-ARCH-086)

**Acceptance tests to write**
- All US-078 scenarios
- SEC-TC-20 (mandatory): processor resolves org_id from PostgreSQL; a forged org_id in Redis has no effect
- SEC-TC-50 (payload part): job payloads in Redis contain identifiers only
- D-062 note: this task is NOT an owner of AT-US-008-03 — its job-context.ts edits must keep the TASK-010 correlation binding (the TASK-035 line and the TASK-092 end-to-end test catch a regression); PR19-SEC-01 CONSUMER (D-ARCH-080): job_context and processed_events are reached in the worker only through the worker platform twin of systemDelegates
- ADMISSION BULKHEAD INHERITANCE (D-ARCH-086, D-ORCH-033 (4); data-model §7.7; TASK-025, batch 0.7, precedes this task): the worker withTenantTx twin admits at most DB_TENANT_MAX_CONCURRENT_TX concurrent job transactions per admission key per process BEFORE pool checkout, with the FIFO wait DB_TENANT_ADMISSION_WAIT_MS and queue depth 2 x cap — key rule as TASK-025 (the org_id resolved by platform.job_context; anonymous for an empty org id; operator for OPERATOR scope) — by reusing apps/api/src/platform/db/tenant-admission.ts (imported through the runtime door, or copied under a shared test that keeps both in lock-step; no second divergent implementation) and the TASK-025 configuration keys (no new keys); a rejection is the retryable 503 TENANT_CONCURRENCY_LIMIT, which surfaces to the BullMQ attempts and backoff policy (no new retry mechanism); test: with the cap at 2, three concurrent steps of one organisation make the third wait and then fail retryably while a step of another organisation completes (worker twin of the TASK-033 two-tenant scenario)
- D-ARCH-103: the worker twin takes AppDb, AppTransactionClient and Prisma as types from @platform/api/runtime and builds no client and no second composition; precondition: TASK-020 part 020-B is merged
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
| Spikes / security / decisions | SEC-P3-18, PR21-SEC-01, PR21-SEC-02, PR21-SEC-06, D-ORCH-023, D-ORCH-024, D-ARCH-084, PR43-SEC-01, D-SEC-PR43-01, D-ARCH-125 |
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
- PR21-SEC-06 / PR21-SEC-01 step 5 / PR21-SEC-02 (D-ORCH-023 (1), D-ORCH-024 (5); D-ARCH-084): the CORS preflight handler and the Origin allow-list live in the pipeline slot TASK-020 fixed BEFORE `routes` (before optionsResponder and the /api/docs mount), mounted PATH-LESS — a path-mounted CORS or limiter fails the drift walker by design; if this task adds Helmet it is mounted before the docs router and never overwrites the docs route CSP (otherwise TASK-111 owns it); the TASK-020 pipeline-order test and drift stay green
- PR43-SEC-01 C2 REVIEW REQUIREMENT (D-SEC-PR43-01; D-ARCH-125): this task mounts no tenant, user or guest route with a path parameter (getCsrfToken is [refresh-cookie]), so the reviewer records n/a; if a path-parameter route is added, its executable cross-tenant case (TASK-027 line) is required before merge
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
| Spikes / security / decisions | SEC-P3-05, SEC-P3-16, D-049, D-ARCH-042, DR-A14, PR11-SEC-10, D-ARCH-072, D-ORCH-039, PR43-SEC-01, D-SEC-PR43-01, D-ARCH-123, D-ARCH-125 |
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
- DR-A14 `users` policy set (data-model §4.3 as amended 2026-11-13; D-ARCH-072) — unless TASK-037 created `users` first (its dod): `users` is USER_OWNED with `policySet: dr-a14-users` in `tools/db/table-classes/identity.json` (definerRead); the block is rendered by `tools/db/render-rls.ts` and pasted verbatim in prefix-safe order (CREATE TABLE → ENABLE + FORCE → `p_users__own` keyed on `id = platform.app_actor_id()`, `p_users__org_member_read` with the positive list `m.status IN ('ACTIVE','SUSPENDED')` (INVITED removed 2026-11-14, D-ARCH-123), `p_users__operator`, `p_users__definer_read` → GRANT); the `memberships.user_id` FK is in place after this migration (NOT VALID + VALIDATE if added here, rule 6); `down.sql` prefix-idempotent (rule 17); C3 derived set and C12 probes cover `users` (a member of org A reads the rows of fellow ACTIVE/SUSPENDED members and never a REMOVED one, an invitee before acceptance (D-ARCH-123) or a stranger); MERGE CONDITION: security-analyst sign-off on the rendered policies (PR11-SEC-10)
- PR2-SEC-02 residual (PR #2 security review R2.4; password-hasher confinement, before or with the hasher module): the three bcrypt boundaries entries move to the END of BOUNDARIES_POLICIES so no later allow can override them; the coverage test becomes behavioural (lint import(bcrypt) at every matrix path and assert the bcrypt policy is in the boundaries/dependencies options); the hasher module exports only the PasswordHasher port (review checks it; a dedicated platform/password-hasher-only rule only if it adds local-binding re-export detection); the TASK-007 Semgrep backstop stays
- D-ARCH-106: password pre-hash and hashing run in the call phase (no transaction open) once TASK-020 part 020-C has merged; recommended and not lint-enforced, because an anonymous burst of hashes inside the transaction would fill the anonymous admission key of D-ARCH-086
- SEC-TC-14 (D-ORCH-039; threat model T-29; ADR-0006 am. 3 and 16; named on this sheet because the manifest parks it in required_cases_pending with this task as owner, checkpoint v0.1.0-m0): a unit test whose title carries [SEC-TC-14], run against the PasswordHasher port with the real pre-hash: two 100-byte passwords that share their first 72 bytes hash to distinct values and neither verifies against the hash of the other, while each verifies against its own (salted hashes differ even for equal input, so the cross-verify pair is the real assertion, and raw bcrypt over the bytes would make the pair collide); after this task merges qa-lead moves the ID from required_cases_pending back to unit.required_cases in the next activation PR
- PR43-SEC-01 C2 REVIEW REQUIREMENT (D-SEC-PR43-01; PR #43 code review R1-M2; D-ARCH-125): if PR #43 merged with a registration-only API_CASES set, no tenant, user or guest route with a path parameter of this task merges before the executable cases of the TASK-027 line exist; a bare operationId string never satisfies the gate; the reviewer checks the generated case list for every route this task mounts
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
| Spikes / security / decisions | SPK-03, PR7-SEC-04, PR7-SEC-13 |
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
- platform.guest_capable_guard() BEFORE UPDATE trigger (migrator-owned, not SECURITY DEFINER, SET search_path = pg_catalog, pg_temp) rendered with the policies

**Acceptance tests to write**
- All US-080 scenarios
- ADR-0005 am. 10 item 11 / data-model §4.3 as widened 2026-11-12 (PR7-SEC-04, PR7-SEC-12 d; D-ARCH-065): the trigger raises GUEST_DECLAIM_FORBIDDEN (23514) when OLD.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM OLD.org_id, and when NEW.guest_token_hash IS NOT NULL AND NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash; the four forbidden transitions (org -> NULL, org A -> org B, NULL -> hash, hash H1 -> H2) are each tested AS THE SUPERUSER so RLS is bypassed and the trigger alone is proven; the legitimate claim (NULL -> org with hash -> NULL) succeeds under the claim context; app.guest_token_hash is non-empty only on routes declaring `tenancy: guest` and on the claim operation (every other route binds the empty string)
- ADR-0005 am. 10 item 15 (PR7-SEC-13): the claim repository uses `expectAffected(result, 1)` for its state-transition UPDATE and the unit test shows that 0 affected rows raises (the service then re-reads -> 200 / 409 per ADR-0005 §Guest rows)
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
| Spikes / security / decisions | SEC-P3-26, PR20-SEC-05, PR20-SEC-13, D-ORCH-025, PR19-SEC-01, D-ARCH-080, D-ARCH-084, D-ARCH-109, D-TASK020-41, D-SEC-PR38-02, D-ARCH-113, D-ARCH-120, PR48-SEC-06, PR48-SEC-01, D-SEC-PR48-01, D-ARCH-134, D-ARCH-137 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-049, TASK-048, TASK-284, TASK-289 |
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
- FIRST SECURITY-EVENT EMITTER conditions (PR #20 security review R2.8; PR20-SEC-05; D-ORCH-025 (2)(3); D-ARCH-084): (a) `ip_coarse` comes only from the /24 (IPv4) or /48 (IPv6) helper — a precise address is dropped and counted; (b) enumerated attribute values (reason, key_type, ...) are UPPER_SNAKE catalogue identifiers; (c) `identifier_hash` is a hash, never a masked e-mail; (d) `session_id` RULING — a session id is an identifier, not a credential, PROVIDED the invariant holds that no cookie, token or URL ever carries the raw session id as a bearer value (the refresh cookie carries the opaque rotating token, the access JWT carries sid only inside its signed payload, CSRF = HMAC(session_id || app) needs the server key); this task with TASK-055 proves the invariant with a sentinel test and then lifts the fail-closed [REDACTED] for exactly refresh_token_reuse.session_id; (e) GATE: PR20-SEC-13 items 1-3 (cookie prefixes __Host-/__Secure- sensitive in free text, list-adjacency redaction, scheme-less request targets) are landed in PR #20 or a TASK-010 follow-up BEFORE this task or TASK-055 merges (first refresh cookie)
- PR19-SEC-01 CONSUMER (D-ARCH-080): login_attempt_counters is a SYSTEM model owned by the identity module — reached only from apps/api/src/modules/identity/core/** through systemDelegates(tx) (lint allow-list), never from another module
- D-ARCH-106/107: password verification runs in the call phase; the bearer authenticator sets credential session (authenticated true, actor from the verified sub), serves every route whose auth set contains session and never routes declaring refresh-cookie, and follows the ADR-0008 am. 4 rules: a present bearer is verified and never replaced by another alternative (401 ACCESS_TOKEN_EXPIRED, SESSION_REVOKED or AUTH_REQUIRED), and the bearer decides when X-Quote-Token also arrives
- D-ARCH-109 (ADR-0008 am. 5 item 1; PR32-SEC-16): the bearer authenticator reads Authorization only on routes whose auth set contains session; on [anonymous], [refresh-cookie] and [signature] routes the header is not parsed or verified, so an expired, revoked or malformed token cannot fail login, registration, refresh, logout, csrf, reference reads or public tracking (the web client may attach its token to every request); api tests: createSession and listCountries with an expired and with a malformed bearer give the normal result with the contract Cache-Control, refreshSession with an expired bearer proceeds to the cookie check, and a [session] route with a refresh cookie and no bearer is 401 AUTH_REQUIRED and the cookie is not consumed
- D-TASK020-41 / D-SEC-PR38-02 AUTHENTICATOR CONTRACT (ADR-0008 am. 6 item 2; D-ARCH-113): the bearer authenticator learns that a credential is present only through presentedKinds(req.headers, route.auth) from @platform/shared and reads the Authorization value itself only after that call reports session (it never reads cookie or x-quote-token, and no other module reads authorization); it builds principal.permissions with readonlySet from route-state.ts (a frozen read-only view, never a Set or an array); it calls markCredentialsRead(res) together with its decision, on the accept path and on every refusal (ACCESS_TOKEN_EXPIRED, SESSION_REVOKED, AUTH_REQUIRED, malformed token), the order relative to the header read being irrelevant; it never relies on its own markPrivateResponse for SEC-TC-29 on a refusal, because the problem handler decides from the route descriptor (declaresPrivateResponse(route.auth, headers)), so a bearer refused before any mark still answers 401 private, no-store; the slot replaces only platform/authn (the contract stub) and keeps the [SEC-TC-29] and declared-credentials api tests green; api tests: an expired bearer on a [session] route is 401 private, no-store while a spy shows the authenticator never called markPrivateResponse, markCredentialsRead was called exactly once per request on accept and on refuse, Set.prototype.add.call(principal.permissions, x) throws, and a fixture route that declares authorization in schema.headers fails at module load (020-C PR38-SEC-03, so no handler can ever receive the bearer)
- ADMISSION CLASS auth (D-ARCH-120; ADR-0007 am. 11 item 1; TASK-284 admitcls is a dependency of this task): createSession declares rate class auth, so its transactions are admitted under the auth reserve and a public flood cannot refuse sign-in; api test (TASK-284 merged): 15 slow public-class requests in flight leave createSession answering non-503 at its normal rate
- RBAC MATRIX SEAM RETIREMENT, bearer kind (PR48-SEC-06; PR #48 code review R1-m3; D-ARCH-134): this task deletes the bearer branch of resolvePrincipal in tests/generated/rbac/matrix-app.ts and presents a real test credential (an ES256 access token minted with the test key) through the real authenticate slot, so every [session] row of the matrix runs the production authenticator; the committed matrix is regenerated and its drift test is green; TRIPWIRE: the matrix app exports the list of still-stubbed credential kinds (TASK-289) and a test compares it with the authenticators mounted by createApp — a kind that is both mounted and stubbed fails; MERGE PREREQUISITE: TASK-289 (TASK-027-F: PR48-SEC-01, R1-m1, R1-n2 foreign-credential comparison) has merged — a dependency edge added by D-ARCH-137, so this task is not dispatched before it
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
| Spikes / security / decisions | SEC-P3-01, SEC-COND-01, D-046, PR20-SEC-13, D-ARCH-084, D-ARCH-109, PR32-SEC-16, D-TASK020-41, D-SEC-PR38-02, D-ARCH-113, PR38-SEC-03, PR48-SEC-06, PR48-SEC-01, D-ARCH-134 |
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
- GATE (PR #20 security review R2.8; D-ARCH-084): PR20-SEC-13 items 1-3 are landed before this task merges (first refresh cookie); the session_id invariant test of the TASK-052 line (d) covers the __Host-rt_* cookie values set here
- D-ARCH-107: refreshSession, logoutSession and getCsrfToken declare auth refresh-cookie, not session (they are called with an expired or absent access token); this task adds the cookie authenticator (credential refresh-cookie, authenticated true), and csrf true on the non-GET ones is mandatory (binding rule CSRF_COOKIE)
- D-ARCH-109 (ADR-0006 am. 17; ADR-0008 am. 5; PR32-SEC-16, code review R2-m4): the cookie authenticator reads __Host-rt_web and __Host-rt_admin only on routes whose auth set contains refresh-cookie (refreshSession, logoutSession, getCsrfToken); on every other route the cookie is not parsed, hashed or looked up, and a current, rotated, revoked or garbage cookie changes nothing: no 401, no family revocation, no TOKEN_REUSE_DETECTED, no security event, no change to Cache-Control; when both cookies arrive (Compose shares localhost across the web and admin ports) the one whose app matches the app of the request (host or edge virtual host, Origin must agree where the browser sends it) is read and the other is ignored unevaluated, and no match gives 401 AUTH_REQUIRED without touching token state; the two cookie names appear in exactly two modules, packages/shared/src/http/credentials.ts and the cookie module (a repository test greps for them); api tests: createSession, registerUser, createQuote, public tracking and listCountries with a stale cookie answer as without it, a [session] route with only a cookie is 401, and a rotated cookie sent to createSession revokes nothing
- D-TASK020-41 / D-SEC-PR38-02 AUTHENTICATOR CONTRACT (ADR-0008 am. 6 item 2; D-ARCH-113): the cookie authenticator learns that a refresh cookie is present only through presentedKinds(req.headers, route.auth), and parses the cookie header itself only after that, on the three refresh-cookie routes, to pick the one cookie by app (the TASK-055 D-ARCH-109 line); it builds the permissions of the refreshed principal with readonlySet; it calls markCredentialsRead(res) together with its decision for a current, rotated, revoked, expired or absent cookie alike; private, no-store on 401 SESSION_REVOKED, SESSION_EXPIRED and AUTH_REQUIRED comes from the descriptor test of the problem handler ([refresh-cookie] has no anonymous member, so every answer on the three routes is private whatever the authenticator marked); x-csrf-token is read by the csrf slot (TASK-048) and x-csrf-token, cookie and authorization are refused in schema.headers by 020-C (PR38-SEC-03), so no identity handler receives the cookie or the token; api tests: a reuse-detected cookie answers 401 private, no-store with the family revoked and markCredentialsRead called exactly once; a stale cookie plus a valid bearer on refreshSession takes the cookie path and the bearer is never parsed (spy)
- RBAC MATRIX SEAM RETIREMENT, refresh-cookie kind (PR48-SEC-06; PR #48 code review R1-m3; D-ARCH-134): this task deletes the refresh-cookie branch of resolvePrincipal in tests/generated/rbac/matrix-app.ts and presents real __Host-rt_web and __Host-rt_admin cookies (sessions created by the test) through the real cookie authenticator on the three refresh-cookie routes; the admin refresh cookie stays a foreign credential on every other route (TASK-289 rows); regenerated matrix, drift test green, still-stubbed-kinds tripwire of TASK-052 passes; PR48-SEC-01 must have merged (TASK-289) before this task merges (transitively enforced through TASK-052)
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
| Stories (partial; completed by TASK-073) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| REQs | REQ-AUTH-004, REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SEC-P3-06, D-050, D-ARCH-119 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-052, TASK-055, TASK-049, TASK-285 |
| Batch · locks | 1.7 · identity-core |
| Branch | `feat/TASK-059-verify-email-address` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/identity/core/verify.*

**Acceptance tests to write**
- All US-016 scenarios (#token= fragment links per D-ARCH-011)
- SEC-TC-47 (verify part): victim redeeming the link revokes the attacker session (next refresh -> 401 SESSION_REVOKED)
- AT-US-087-07 EMITTER (D-ARCH-119; REQ-AUTH-004; TASK-285 auditactions is a dependency of this task): one SESSION_REVOKED entry per session revoked by a successful verification, written through the writer against the widened CHECK; test: two other sessions exist, verification revokes both, two SESSION_REVOKED entries name the revoked session ids and the verifying session is untouched; US-087 is partial here
- AT-US-016-01 … AT-US-016-10: all 10 scenarios of US-016, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-087-01 … AT-US-087-08 that belong to its layer; US-087 closes in TASK-073

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
| Spikes / security / decisions | PR8-SEC-07, T-32, PR48-SEC-03, PR48-SEC-05, PR48-SEC-06, D-SEC-PR48-01, D-ORCH-092, D-ARCH-134, D-ARCH-137 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-056, TASK-020, TASK-013, TASK-289 |
| Batch · locks | 1.7 · api-authz |
| Branch | `feat/TASK-060-request-pipeline-order-401-403` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/authz/{authorise-mw.ts, permission-cache.ts, operator-scope.ts, effective-permissions.repository.ts}

**Acceptance tests to write**
- All US-068 and US-076 scenarios
- PR8-SEC-07 (ADR-0008 am. 3 item 5, D-ARCH-069): the effective-permission query joins organisations.type and keeps only roles whose scope matches the organisation type, requires an ACTIVE membership in the token active organisation and revoked_at IS NULL (in addition to the REQ-ORG-004 trigger of TASK-037); where the pure `effectivePermissions(roleKeys, roles)` helper is used it receives `expectedScope` and throws RoleScopeMismatchError on a mixed-scope set; integration test: a membership row linking an OPERATOR role inside a BUSINESS_CUSTOMER organisation (inserted as the migrator with the trigger disabled in a rolled-back transaction) yields no audit:read for that actor
- T-32 OWNER CONFIRMED (D-ARCH-134; PR48-SEC-05 item 4 and PR #48 security record 5.7; D-SEC-PR48-01 (2); D-ORCH-092; threat-model T-32, AC-06, R-03; ADR-0005 cross-tenant 404): (a) a platform gate after the permission gate and before any slot that can query — for route.tenancy = tenant and a path parameter orgId, req.params.orgId !== principal.orgId raises AppError(NOT_FOUND) (404 before any query), compared with the token active organisation only, never with a membership list (US-081 switch-organisation must not weaken it); (b) the R-03 build rule: on tenant routes only the whole-segment path parameter orgId may name an organisation — defineRoute or the route-metadata test refuses organisationId, orgID, targetOrgId or an orgId inside a segment, so the matrix enumeration cannot miss a route; (c) the [SEC-TC-01] registry case of tests/generated/rbac becomes the acceptance test of this gate, with the route-reached positive control of PR48-SEC-05 item 1 (the same caller with its own organisation first, x-rbac-matrix: authorised) and an AC-06 variant once the principal carries more than one organisation; DUE before the first {orgId} route merges (wave 8; holds by batch order)
- RBAC MATRIX AND LIVE PERMISSIONS (PR48-SEC-06; D-ARCH-134): role principals take permissions from ROLES through the matrix seam, so the matrix proves the gate on the seeded grants and not the live effective-permission query; when resolution goes live this task adds a seeded-database variant of the role columns (one row per role through the real resolver and the 5 s cache) or names the gap for G3 in its PR body; MERGE PREREQUISITE: TASK-289 (TASK-027-F) has moved the oracle to the @platform/authz/matrix subpath with the restricted-import and boundaries arm (PR48-SEC-03), so a production authorise cannot import the oracle — a dependency edge added by D-ARCH-137
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
| Stories (partial; completed by TASK-073) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| REQs | REQ-AUTH-017, REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | D-ARCH-119 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-057, TASK-285 |
| Batch · locks | 1.7 · identity-mfa |
| Branch | `feat/TASK-061-mfa-challenge-at-sign` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/identity/mfa/challenge.*

**Acceptance tests to write**
- All US-024 API scenarios
- AT-US-087-07 EMITTER (D-ARCH-119; REQ-AUTH-017; TASK-285 auditactions is a dependency of this task): a sign-in completed with a recovery code writes MFA_RECOVERY_USED for that user through the writer against the widened CHECK; test: the entry exists with the user id and the code is consumed; US-087 is partial here
- AT-US-024-01 … AT-US-024-07: all 7 scenarios of US-024, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-087-01 … AT-US-087-08 that belong to its layer; US-087 closes in TASK-073

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
| Spikes / security / decisions | SEC-P3-11, D-ARCH-024, D-ORCH-023, D-ARCH-084 |
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
- PR #21 code review R1-m5 remainder (D-ORCH-023 (1); api/README §17; D-ARCH-084): the typed `client.ts` over packages/shared/src/api/types.gen.ts (Axios; paths and operation types from the generated file) lands here as its first frontend consumer; the Axios interceptor of this task is built on it
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
| Spikes / security / decisions | D-019, D-ARCH-079 |
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
- PR #13 code review m4 (a) — first consumer of the Dataset contract extension for UUID foreign keys (prisma/README.md "Dataset contract limits"; prisma-seed lock): fx_snapshots rows reference parent ids generated per environment, so this task adds { fk: { column, table, naturalKey } } resolution (or deterministic seedId ids per data-model §9.3) to the seed framework with tests, honouring the HARD RULE never to list a column the runtime or a reviewer mutates
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
| Spikes / security / decisions | SEC-P3-11, D-ARCH-024, PR48-SEC-06, D-ARCH-134 |
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
- RBAC MATRIX SEAM RETIREMENT, +mfa seam (PR48-SEC-06; PR #48 code review R1-m3; D-ARCH-134): this task owns platform/auth/mfa-gate.ts, so it deletes the +mfa seam of tests/generated/rbac/matrix-app.ts and presents real MFA-satisfied and MFA-pending staff sessions through the real gate (the 403 MFA_ENROLMENT_REQUIRED rows of staff routes run the production gate); the matrix is regenerated and the still-stubbed-kinds tripwire of TASK-052 passes
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
| Stories (completes) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| Stories (partial; completed by TASK-081, TASK-081) | US-097 **DC** (M0 Must) Audit viewer: filterable list<br>US-098 **DC** (M0 Must) Audit viewer: entry detail with diff, and audited viewing |
| REQs | REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011, REQ-AUDIT-019, REQ-AUDIT-023, REQ-AUDIT-020, REQ-AUDIT-022 |
| NFRs | NFR-AUDIT-001, NFR-PERF-006 |
| Spikes / security / decisions | D-ARCH-125, D-TASK285-02, PR52-SEC-02, D-ORCH-099, D-ARCH-135 |
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
- AT-US-087-08 (D-ARCH-125; PR #42 code review R1-m5): a Shipper requesting entry fields through the viewer API gets 403 AUTHZ_DENIED (audit:read not held); this task COMPLETES US-087 (TASK-025 carries five scenarios, TASK-041 the forged-header one, TASK-285 with TASK-059/061 the two new action types)
- OPENAPI AUDIT ACTION ENUMS (D-TASK285-02; PR #52 code review R1-m1; PR52-SEC-02; D-ORCH-099; D-ARCH-135): the contract enums AuditEntry.action, AuditEntrySummary.action and filter[action] list 18 actions; the api-designer change request adding MFA_RECOVERY_USED and SESSION_REVOKED lands WITH this task (the first consumer of the enums; openapi:types regenerated; the contract change is a change request to api-designer, not an in-task edit) and the compile-time gap pin of packages/audit/src/actions.test.ts flips to equality in the same PR; DUE before this task merges — D-ORCH-099 said before TASK-059/061 emit, corrected by D-ARCH-135: emission is DB-side (the CHECK of TASK-285) and no route exposes entries before this viewer; api test: an entry carrying each new action is read back through the viewer and validates against the contract
- AT-US-087-01 … AT-US-087-08: all 8 scenarios of US-087, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
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
