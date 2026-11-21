# WAVE-00 — Walking skeleton, CI lanes, toolchain, generator frameworks, spikes

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Foundation (DC enablers)**

Tasks: **47** (S 15 / M 32; opus 30 / sonnet 17; demo-critical 21) in **13** batches of ≤ 4 parallel tasks. Estimated effort ≈ 118.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Lane A green on main; lane B `wave` evidence; lane C `wave-end` run #1 green; SPK-01..08 findings recorded; generators (route metadata, RBAC matrix, RLS cross-tenant, audit + immutability) green on all existing routes; thin slice e2e green; dependency-auditor baseline (R-ARCH-12) requested.

**Stories completed in this wave (26):** US-001 (DC), US-002 (DC), US-004 (DC), US-005, US-006, US-007, US-012 (DC), US-034 (DC), US-035, US-048, US-051 (DC), US-064, US-065 (DC), US-066 (DC), US-067 (DC), US-071 (DC), US-074 (DC), US-075 (DC), US-077, US-086 (DC), US-088 (DC), US-090, US-091, US-092 (DC), US-094 (DC), US-096 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 0.1 | TASK-001 SPK-01 toolchain spike and workspace foundation | root |
| 0.2 | TASK-002 Lint, format and layering rules with negative fixtures<br>TASK-003 Prisma 7 + PostgreSQL 18 baseline<br>TASK-004 Web and admin app scaffolds<br>TASK-005 Typed, validated configuration and key/secret register | lint<br>prisma-core<br>web-core, admin-core, e2e-core<br>pkg-config |
| 0.3 | TASK-006 API and worker runtime skeleton<br>TASK-007 CI lane A fast-lane workflow and supply-chain install hardening<br>TASK-008 SPK-03 spike<br>TASK-009 SPK-02 spike | api-platform-core, worker-platform-core<br>ci-workflows<br>spike-03<br>carriers-docs |
| 0.4 | TASK-010 Structured, redacted logging with correlation IDs<br>TASK-011 Lane B local heavy lane and evidence integrity<br>TASK-012 SPK-08 spike<br>TASK-013 Typed permission catalogue, seeded roles via versioned migration, role-permission matrix document, privilege-escalation guard | logging, api-platform-core<br>quality-tools<br>spike-08<br>pkg-authz |
| 0.5 | TASK-014 Hardened multi-stage images and Docker Compose skeleton<br>TASK-015 SPK-07 + lane C full lane, coverage and diff-coverage gates, security-integration job, ci:minutes<br>TASK-016 Row-level security foundations<br>TASK-017 Contract-first OpenAPI pipeline | infra-compose<br>ci-workflows<br>prisma-rls, prisma-core, pkg-config, lint, api-tenant-db<br>api-openapi, shared-api-types |
| 0.6 | TASK-018 SPK-04 spike<br>TASK-019 SPK-05 spike<br>TASK-020 Mandatory route metadata<br>TASK-021 Audit store SQL | spike-04<br>api-storage<br>api-routing, pkg-authz, lint, prisma-core<br>prisma-bootstrap-audit |
| 0.7 | TASK-022 SPK-06 spike<br>TASK-023 Idempotent reference and demo seed framework<br>TASK-024 Generated cross-tenant isolation test suite<br>TASK-025 Audit writer core | web-build-csp, web-core, admin-core, pkg-config, lint<br>prisma-seed<br>tests-gen-rls, prisma-rls, prisma-core<br>pkg-audit-core |
| 0.8 | TASK-026 Walking-skeleton slice<br>TASK-027 RBAC matrix test generator<br>TASK-028 Audit redaction and field classification registry<br>TASK-029 Automatic audit capture driven by route descriptors | mod-admin-settings-reference, web-core, ui-api<br>tests-gen-rbac<br>pkg-audit-redaction, api-platform-core, api-routing<br>api-audit-mw, api-tenant-db, api-tx-execute, lint |
| 0.9 | TASK-030 Per-stream audit hash chain<br>TASK-031 Audit field-level diffs and no-op update suppression<br>TASK-032 Server-controlled standard columns, UTC time and on-behalf seam<br>TASK-276 Test harness | pkg-audit-chain, lint, api-tenant-db<br>pkg-audit-diff, pkg-audit-redaction<br>prisma-ext<br>tests-harness |
| 0.10 | TASK-033 Audit test generator and immutability-per-role suite<br>TASK-034 Backup/restore rehearsal and zero-downtime migration probe tooling<br>TASK-277 Test-ID traceability tooling<br>TASK-278 Generated abuse suite | tests-gen-audit<br>db-tools-backup, prisma-core<br>quality-trace<br>tests-gen-abuse |
| 0.11 | TASK-283 api/worker image headroom<br>TASK-284 Anonymous admission classes<br>TASK-285 Audit action vocabulary v2<br>TASK-286 CI-minutes stage 2 | infra-compose, lint<br>api-db-admission, api-tenant-db, api-tx-execute, api-routing<br>prisma-bootstrap-audit<br>ci-workflows |
| 0.12 | TASK-287 Incremental fast lane<br>TASK-288 TASK-W0-FLAKE-2<br>TASK-289 TASK-027-F<br>TASK-290 TASK-024-F | ci-workflows<br>root, tests-harness<br>tests-gen-rbac, pkg-authz, lint<br>tests-gen-rls, prisma-core |
| 0.13 | TASK-291 TASK-W0-FLAKE-3<br>TASK-293 TASK-290-F | tests-harness, api-routing, tests-gen-rls<br>prisma-core |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

Shared hot files (D-ORCH-118, D-ARCH-147): `api-tenant-db` = `apps/api/src/platform/db/tenant-db.*`, `apps/api/src/platform/db/with-tenant-tx.*`, `apps/api/src/platform/db/raw-statement.*`; `api-tx-execute` = `apps/api/src/platform/tx/**`; `api-platform-core` = `apps/api/src/app.*`, `apps/api/src/start-api.*`, `apps/api/src/main.*`; `api-routing` = `apps/api/src/platform/routing/pipeline.*`; `lint` = `eslint.config.mjs`. A card whose planned files name one of them holds that lock (the generator fails otherwise); a PR that needs such a file without holding the lock stops and asks the orchestrator for it first, so two in-flight PRs never edit the same shared file.

## Task specifications

### TASK-001 — SPK-01 toolchain spike and workspace foundation (npm workspaces, TS strict, Jest, .npmrc, deps:rebuild)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-002) | US-001 **DC** (M0 Must) Monorepo layout, layering lint, strict TypeScript and root scripts |
| REQs | REQ-PLAT-001, REQ-PLAT-002, REQ-PLAT-003 |
| NFRs | NFR-MAINT-002, NFR-OPS-003 |
| Spikes / security / decisions | SPK-01, SEC-COND-04, SEC-P3-04, R-ARCH-01, R-ARCH-17, R-ARCH-20 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | — |
| Batch · locks | 0.1 · root |
| Branch | `feat/TASK-001-spk-01-toolchain-spike-workspace` |
| Priority | Must · demo-critical |

**Files / modules**
- package.json
- package-lock.json
- .npmrc (ignore-scripts, engine-strict, save-exact, fund=false, update-notifier=false)
- .node-version (24)
- .gitattributes
- .gitignore
- tsconfig.base.json
- tsconfig.json (references)
- jest.config.ts (projects unit|integration|api)
- .swcrc (REMOVED 2026-11-13 by PR #17, PR17-SEC-01, D-TASK007-04: the @swc/jest options are inline in jest.config.ts with swcrc:false and any .swcrc is a workflow-policy finding; PR #17 code review R2-n2)
- apps/{api,worker,web,admin}/package.json + tsconfig.json
- packages/{shared,ui,carriers,pricing,audit,authz,config}/package.json + tsconfig.json + src/index.ts
- prisma/package.json
- tests/{e2e,load,generated}/package.json
- apps/api/src/modules/<module>/ folder skeletons (ADR-0003)
- tools/repo/structure.test.ts
- tools/deps/rebuild.mjs (allow-list: bcrypt, prisma generate, playwright install)
- tools/deps/ignore-scripts.test.ts
- spikes/SPK-01/ (throwaway hello: Prisma 7 adapter-pg query, RR8 prerender build) — deleted before merge
- docs/04-plan/spikes/SPK-01.md

**Acceptance tests to write**
- US-001 "Repository structure is complete" and "Missing folder fails the structure test"
- US-001 "Root scripts fail on defects" (typecheck exits non-zero on an injected type error; all root scripts exist)
- SEC-TC-45 (local part): a fixture package with a marker-writing postinstall leaves no marker after `npm ci`; `npm run deps:rebuild` yields a working bcrypt
- SPK-01 exit (Windows host): `npm run typecheck && npm run test:unit && npm run build` green under the Node 24 PATH prefix; Prisma 7 + @prisma/adapter-pg hello query against a PG 18 container; React Router 8 prerender hello build; findings + version pins in SPK-01.md (ubuntu half closed by the lane A task)
- Covers the scenarios of AT-US-001-01 … AT-US-001-05 that belong to its layer; US-001 closes in TASK-002

**DoD notes**
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- Timebox 1 day; spike code under spikes/ is removed before merge, only the foundation and SPK-01.md remain
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/authz/**`, `packages/audit/**`, `packages/config/**`, `prisma/**`, `apps/api/src/modules/identity/**`, `package-lock.json`, `jest.config.ts`, `tools/deps/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-002 — Lint, format and layering rules with negative fixtures (ESLint 10 flat, boundaries, import-x, i18next, jsx-a11y, Stylelint, Prettier)

| Field | Value |
|---|---|
| Stories (completes) | US-001 **DC** (M0 Must) Monorepo layout, layering lint, strict TypeScript and root scripts |
| REQs | REQ-PLAT-001, REQ-PLAT-002, REQ-PLAT-003 |
| NFRs | NFR-A11Y-006, NFR-DATA-001, NFR-I18N-001, NFR-I18N-003, NFR-I18N-004, NFR-MAINT-001, NFR-MAINT-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-001 |
| Batch · locks | 0.2 · lint |
| Branch | `feat/TASK-002-lint-format-layering-rules-negative` |
| Priority | Must · demo-critical |

**Files / modules**
- eslint.config.mjs
- tools/eslint-rules/{money-arith,no-tofixed-tolocalestring,outbound-http-via-client,audit-writer-allowlist,no-innerhtml,any-justification,node-path-only}.mjs
- stylelint.config.mjs (stylelint-use-logical, hover-in-media)
- .prettierrc, .prettierignore
- commitlint.config.mjs
- tests/fixtures/lint/** (one negative fixture per rule)
- tools/lint/negative-fixtures.test.ts

**Acceptance tests to write**
- US-001 Scenario Outline "Each layering rule is enforced by a seeded negative fixture" (3 rows)
- US-001 "Unjustified any suppression is rejected"
- One negative fixture per custom local rule fails lint with the rule name; `npm run lint` passes on the clean tree with --max-warnings 0
- AT-US-001-01 … AT-US-001-05: all 5 scenarios of US-001, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-003 — Prisma 7 + PostgreSQL 18 baseline: bootstrap lane, DB roles, Testcontainers harness, migration linter, up-down-up driver

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-016) | US-074 **DC** (M0 Must) RLS enabled and forced on every tenant-owned table, separate DB roles |
| REQs | REQ-RLS-001, REQ-RLS-002, REQ-RLS-005 |
| NFRs | NFR-AVAIL-003, NFR-DATA-004 |
| Spikes / security / decisions | SPK-01, R-ARCH-03, SEC-P3-03 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-001 |
| Batch · locks | 0.2 · prisma-core |
| Branch | `feat/TASK-003-prisma-7-postgresql-18-baseline` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma.config.ts (schema folder, migrations, shadow DB, tables.external)
- prisma/schema/_base.prisma (generator prisma-client, output prisma/generated)
- prisma/bootstrap/{00-roles.sql, 01-schemas.sql} (platform_migrator, platform_app, platform_definer, platform_audit_owner, platform_schema_owner per data-model §4.4 and D-ARCH-033; the migrator does not own the database, D-ARCH-045; schema platform; trusted extensions; global default privileges, D-ARCH-046; search_path rules; names per data-model §8.1, D-ARCH-048)
- tools/db/bootstrap.ts + ledger public.bootstrap_migrations
- tools/db/lint-migrations.ts (header block, rule 2, rule 10, rule 12 no audit DDL, rule 13, contract-declared-reversible; rules 3-9, 11 and 14 are TASK-016, D-ARCH-049)
- tools/db/up-down-up.ts
- prisma/tests/harness/** (PG 18 Testcontainers, template-DB cloning, runtime role)
- apps/api/src/platform/db/client.ts (adapter-pg factory, pool sizing)
- root scripts db:migrate, db:migrate:deploy, db:reset

**Acceptance tests to write**
- Bootstrap runner applies files in order, is idempotent and fails on a changed SHA-256 of an applied file
- Migration linter rejects a migration without header, with audit DDL, or with a contract step declared reversible
- up -> down -> up green on the baseline migration (NFR-DATA-004)
- Integration project connects as platform_app (not migrator); `npm run deps:rebuild` regenerates the Prisma client with scripts disabled
- Records for SPK-03/SPK-08: partialIndexes preview status at 7.10 and whether the shadow-DB init hook exists
- Covers the scenarios of AT-US-074-01 … AT-US-074-05 that belong to its layer; US-074 closes in TASK-016

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `apps/api/src/platform/**`, `tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-004 — Web and admin app scaffolds (React Router 8 framework mode, Vite 8, Tailwind 4, Playwright + axe harness, size-limit)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-COMPAT-001, NFR-COMPAT-002, NFR-WEB-004, NFR-WEB-005 |
| Spikes / security / decisions | SPK-01 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-001 |
| Batch · locks | 0.2 · web-core, admin-core, e2e-core |
| Branch | `feat/TASK-004-web-admin-app-scaffolds` |
| Priority | Enabler |

**Files / modules**
- apps/web/{react-router.config.ts (ssr:false, prerender /{en,es,fr}), vite.config.ts, app/root.tsx, app/routes/*}
- apps/admin/** (SPA, ssr:false)
- packages/ui/src/index.ts (empty kit + Tailwind preset placeholder)
- infra/nginx/{web,admin}.conf.template (SPA fallback)
- tests/e2e/{playwright.config.ts (3 engines x 360/1280), fixtures/axe.ts, smoke.spec.ts}
- .size-limit.json
- apps/{web,admin} RTL unit project

**Acceptance tests to write**
- `react-router build` pre-renders /en, /es, /fr with <title>, lang and hreflang in HTML; / is not pre-rendered (ADR-0026 am. 4)
- Admin SPA builds; Playwright smoke passes on Chromium, Firefox, WebKit at 360 and 1280 px with 0 serious/critical axe violations
- size-limit budgets configured and enforced in `npm run build`

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-005 — Typed, validated configuration and key/secret register (packages/config)

| Field | Value |
|---|---|
| Stories (completes) | US-002 **DC** (M0 Must) Typed, validated configuration |
| REQs | REQ-PLAT-004 |
| NFRs | NFR-OPS-005, NFR-SEC-002 |
| Spikes / security / decisions | SEC-P3-08 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-001 |
| Batch · locks | 0.2 · pkg-config |
| Branch | `feat/TASK-005-typed-validated-configuration-key-secret` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/config/src/{schema.ts (Joi), load-config.ts, keys.ts (key_id register), secret-refs.ts}
- .env.example (placeholders only)
- compose.env (local-only values, marked)
- tools/config/env-example-parity.test.ts

**Acceptance tests to write**
- All US-002 scenarios
- SEC-TC-49 (config part): the schema rejects two identical key values; every key entry has a key_id
- SEC-TC-51 (startup part): with APP_ENV=staging, startup is refused when any secret equals a placeholder
- .env.example parity with the schema (NFR-OPS-005)
- AT-US-002-01 … AT-US-002-04: all 4 scenarios of US-002, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Security-critical path (packages/config/**): hosted security-integration job applies once it exists
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-006 — API and worker runtime skeleton: Express 5 bootstrap, RequestContext, AppError + problem+json handler, health endpoints, module registry

| Field | Value |
|---|---|
| Stories (completes) | US-007 (M0 Must) Central error handler and framework error mapping<br>US-012 **DC** (M0 Must) Liveness and readiness endpoints |
| REQs | REQ-PLAT-009, REQ-PLAT-010, REQ-PLAT-018 |
| NFRs | NFR-AVAIL-002, NFR-SEC-009 |
| Spikes / security / decisions | PR7-SEC-02, PR7-SEC-03, PR7-SEC-06 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-001, TASK-003, TASK-005 |
| Batch · locks | 0.3 · api-platform-core, worker-platform-core |
| Branch | `feat/TASK-006-api-worker-runtime-skeleton-express` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/{main.ts, app.ts, platform/http/**, platform/context/**, platform/errors/**, platform/health/**}
- apps/worker/src/{main.ts, platform/health/**}
- packages/shared/src/errors/{app-error.ts, catalogue/index.ts (glob aggregation of catalogue/<module>.ts)}
- apps/api/src/modules/index.generated.ts (build-time discovery of modules/*/routes.ts; no hand-edited registry)

**Acceptance tests to write**
- All US-007 scenarios (framework errors mapped to RFC 9457, no internals leaked)
- All US-012 scenarios (/health/live, /health/ready with DB + Valkey checks) for api and worker
- PR7-SEC-03 items 2 and 4 (ADR-0005 am. 10 item 6; added while in flight, D-ORCH-011 routing): the problem+json handler never copies `message`, `originalMessage`, `detail`, `hint` or `meta` from a Prisma or driver error into a response (test: a P2039/P2010 with a table name and an input value in the message yields a body without either); `createDatabaseClient` passes `errorFormat: minimal` explicitly in every environment (Prisma defaults to colorless outside NODE_ENV=production, which echoes call-site arguments) — if TASK-016 lands first it owns this line and TASK-006 verifies it
- PR7-SEC-06 item 3 + PR7-SEC-02 item 2 (ADR-0005 am. 10 items 4 and 12; added while in flight): /health/ready compares `pg_db_role_setting` for current_user with the expected set (one shared constant: search_path, idle_in_transaction_session_timeout, lock_timeout; TASK-016 adds the statement_timeout backstop row) at start-up and on a slow interval and reports not-ready plus security event `db_role_setting_drift` on any difference (`default_transaction_read_only = on` included); the start-up probe also reads the four `app.*` keys on a fresh connection and reports not-ready plus `db_session_default_tampered` unless all are NULL
- AT-US-007-01 … AT-US-007-05: all 5 scenarios of US-007, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-012-01 … AT-US-012-05: all 5 scenarios of US-012, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Establishes the discovery-based module registry and per-module error catalogue (PLAN.md §5 rule 2)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-007 — CI lane A fast-lane workflow and supply-chain install hardening (SPK-01 ubuntu half)

| Field | Value |
|---|---|
| Stories (completes) | US-005 (M0 Must) CI pipeline skeleton<br>US-048 (M0 Must) Secrets hygiene and CI security scanning |
| REQs | REQ-PLAT-007, REQ-SEC-011, REQ-SEC-013 |
| NFRs | NFR-OPS-003, NFR-SEC-002, NFR-SEC-012 |
| Spikes / security / decisions | SPK-01, SEC-COND-04, SEC-P3-04, SEC-P3-22, SEC-P3-31, SEC-P3-08, D-ARCH-010, D-ARCH-020, R-ARCH-12, D-ARCH-040, D-ARCH-041, D-ARCH-044, PR1-SEC-12, PR1-SEC-13, PR8-SEC-13, PR5-SEC-04, PR2-SEC-01, D-ARCH-069 |
| Specialist · model | devops-engineer · opus |
| Complexity | M |
| Depends on | TASK-001, TASK-002, TASK-005 |
| Batch · locks | 0.3 · ci-workflows |
| Branch | `feat/TASK-007-ci-lane-fast-lane-workflow` |
| Priority | Must |

**Files / modules**
- .github/workflows/ci.yml (pull_request fast lane: changes, fast-lane job, ci-gate; incremental)
- tools/ci/check-migration-immutability.mjs (base-ref, A-only on prisma/migrations; PR8-SEC-13)
- .github/CODEOWNERS (PR5-SEC-04, PR2-SEC-01, PR8-SEC-11/13)
- tools/ci/{check-install-flags.mjs, check-lockfile.mjs (registry + sha512), check-dep-age.mjs (7-day cooldown), dependency-overrides.json, check-workflow-policy.mjs, licence-check.mjs (D-ARCH-003 rev 2)}
- .github/dependabot.yml (cooldown)
- .semgrep/*.yml (raw SQL, outbound HTTP, innerHTML, country branches)
- .gitleaks.toml
- tools/hooks/pre-commit + hooks:install

**Acceptance tests to write**
- All US-005 scenarios (stage order, failing unit test skips build/scans)
- All US-048 scenarios (Gitleaks, npm audit + osv, Semgrep, secret hygiene)
- SEC-TC-32 (extended) and SEC-TC-45 (CI part): marker absent after the CI install; non-registry lockfile entry fails lane A; a version younger than 7 days is rejected
- SEC-TC-51 (workflow part): CARRIER_*/STRIPE_* secrets only in jobs with environment carrier-sandbox; no pull_request/push job references it
- SEC-TC-64 (part): gate tooling runs from the base ref; `npx --no-install` only
- SPK-01 exit (ubuntu half): typecheck + unit + build green on ubuntu-latest
- ADR-0023 am. J item 1 (D-ARCH-040): `check-install-flags` asserts the exact `@platform:registry=https://registry.invalid/` line in the root `.npmrc` and in every `tools/isolated/*/.npmrc`; a Dockerfile `npm ci`/`npm install` in a stage that has not copied `package-lock.json` and `.npmrc` fails
- `check-lockfile` `@platform/*` rules (am. J item 1 b, PR1-SEC-13, R2-n4): every key under `node_modules/@platform/` is `link: true` whose `resolved` is a workspace directory and carries no `integrity` (npm lockfile v3 link entries always carry `resolved`); any non-link entry whose `name` starts with `@platform/`, whose key path contains `node_modules/@platform/` or whose `resolved` contains `/@platform/` fails. Negative fixtures: (i) a non-link `node_modules/@platform/shared` entry with an npmjs `resolved` URL, (ii) an alias `node_modules/x` with `name: "@platform/shared"`. Lane A writes a lockfile delta summary (new name@version tuples, integrity changes, moves into the production closure) to the job summary
- PR1-SEC-12 (round-2 review R2.6): signature verification runs as `npm audit signatures --@platform:registry=https://registry.npmjs.org/`. `check-workflow-policy` allows `--@platform:registry=` only on `npm audit signatures`, and rejects it and any `npm_config_@platform:registry` environment entry on `ci`, `install`, `exec`, `outdated`, `update` and `view` (negative fixtures: `npm ci --@platform:registry=…` and `npm audit signatures || true`). The freshness/age gate is lockfile-driven, skips `link: true` entries and never shells out to `npm outdated`. `.github/dependabot.yml` ignores `@platform/*`; the first run is checked for `private_source_not_reachable`
- am. J item 2 (e) (D-ARCH-041): `check-workflow-policy` rejects the engine-redirecting variables listed by TASK-003 (at least `PRISMA_ENGINES_MIRROR`, `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`, `PRISMA_SCHEMA_ENGINE_BINARY`, `PRISMA_QUERY_ENGINE_LIBRARY`, `PRISMA_QUERY_ENGINE_BINARY`, `PRISMA_FMT_BINARY`, `BINARY_DOWNLOAD_VERSION`, `PRISMA_CLI_BINARY_TARGETS`) and `npm_config_ignore_scripts=false`. `check-no-raw-prisma` (inside `check-install-flags`) rejects a bare `prisma` in package.json scripts, workflows, Dockerfiles and compose files. Engine caches are keyed by `enginesVersion` + runner OS and re-verified on restore
- am. J items 3–4 (D-ARCH-003 rev 4, D-ARCH-042, D-ARCH-043): `licence-check` uses named exceptions in `tools/ci/licence-exceptions.json` (only `elkjs@0.11.1` EPL-2.0 via prisma → @prisma/studio-core, dev closure; another EPL-2.0 package fails, negative fixture). `tools/ci/maintenance-exceptions.json` holds `bcrypt@6.0.0` (direct-stale, expires 2027-05-11) and `node-abort-controller@3.1.1` (deprecated-transitive via bullmq). The freshness gate fails an expired entry and goes live only with the register
- am. J item 5 (D-ARCH-044): every workflow sets `NPM_CONFIG_IGNORE_SCRIPTS: "true"`, `CHECKPOINT_DISABLE: "1"` and `SCARF_ANALYTICS: "false"` at workflow level (`check-workflow-policy` requires them). After `npm run build`, the job requires empty `git status --porcelain`, proven by a negative fixture whose build script touches `package.json`
- PR8-SEC-13 / PR #8 code review R2-n3 (ADR-0008 am. 3 item 7, D-ARCH-069; added while in flight — if this task has already passed review when the line lands, TASK-016 is the fallback owner): lane A runs `tools/ci/check-migration-immutability.mjs` from the base ref — `git diff --name-status --no-renames <base>...HEAD -- prisma/migrations` must contain `A` entries only (`migration_lock.toml` allow-listed), failing with "applied migrations are immutable (D-SEC-PR8-01/02)"; a negative fixture branch that modifies an existing `migration.sql` fails and one that only adds a directory passes
- CODEOWNERS (PR5-SEC-04, PR2-SEC-01, PR8-SEC-11, PR8-SEC-13; added while in flight): `.github/CODEOWNERS` requires a second reviewer on `packages/authz/**`, `tools/authz/**`, `prisma/migrations/**`, `prisma/bootstrap/**`, and the lint-control files (`eslint.config.mjs`, `tools/eslint-rules/**`, `.semgrep/**`, `tools/ci/**`, `tools/db/lint-migrations.ts`, `.github/workflows/**`, `.gitleaks.toml`); `check-workflow-policy` asserts the file exists and covers those paths
- AT-US-005-01 … AT-US-005-06: all 6 scenarios of US-005, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-048-01 … AT-US-048-07: all 7 scenarios of US-048, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Lane A must be green on its own PR; dependency-auditor baseline run (R-ARCH-12) requested from security-analyst after merge
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-008 — SPK-03 spike: RLS with Prisma 7 interactive transactions and pooled connections

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | SPK-03, R-ARCH-03 |
| Specialist · model | database-engineer · opus |
| Complexity | S |
| Depends on | TASK-003 |
| Batch · locks | 0.3 · spike-03 |
| Branch | `feat/TASK-008-spk-03-spike-rls-prisma` |
| Priority | Enabler |

**Files / modules**
- prisma/tests/spikes/spk03-rls-tx.int.test.ts
- docs/04-plan/spikes/SPK-03.md

**Acceptance tests to write**
- SPK-03 exit: (a) context isolation across pooled connections, (b) unset context -> 0 rows, (c) guest claim UPDATE under both policies, (d) set_config overhead <= 1 ms p95 — all green on PG 18 Testcontainers; go/fallback recorded

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-009 — SPK-02 spike: carrier API documentation capture (DHL MyDHL, FedEx REST, UPS REST) into adapter READMEs

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-QUAL-005 |
| Spikes / security / decisions | SPK-02, R-ARCH-02 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-001 |
| Batch · locks | 0.3 · carriers-docs |
| Branch | `feat/TASK-009-spk-02-spike-carrier-api` |
| Priority | Enabler |

**Files / modules**
- packages/carriers/src/adapters/{dhl-express,fedex,ups}/README.md (API version, base paths, auth, rate/ship/track/pickup operations, date checked, open questions)
- docs/04-plan/spikes/SPK-02.md

**Acceptance tests to write**
- SPK-02 exit: three READMEs complete with version + date checked (brief §13 rule 6); fixture plan per operation listed; no credentials or PII in any file (Gitleaks clean)

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-010 — Structured, redacted logging with correlation IDs (Pino) incl. Cookie/Set-Cookie redaction

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-092) | US-008 (M0 Must) Correlation ID and structured, redacted logging |
| REQs | REQ-PLAT-011, REQ-PLAT-012 |
| NFRs | NFR-OBS-001, NFR-PRIV-001 |
| Spikes / security / decisions | SEC-P3-23, PR7-SEC-03, PR6-SEC-02, D-062, D-ORCH-023, PR21-SEC-07, D-ARCH-084 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-006, TASK-005 |
| Batch · locks | 0.4 · logging, api-platform-core |
| Branch | `feat/TASK-010-structured-redacted-logging-correlation-ids` |
| Priority | Must |

**Files / modules**
- packages/shared/src/logging/{logger.ts, redaction.ts, security-event.ts, serializers/prisma-error.ts}
- apps/api/src/platform/logging/{request-logger.ts, correlation.ts}
- apps/worker/src/platform/logging/**
- wiring in apps/api/src/app.ts

**Acceptance tests to write**
- AT-US-008-01, -02, -04, -05 and -06 plus the api and worker LOG-LINE hops of AT-US-008-03 (D-062: US-008 is completed by TASK-092; the audit hop is TASK-029, the outbox hop TASK-043, the job-payload hop TASK-035, the Mock-carrier hop TASK-079; the AT-US-008-03 test of this task keeps its title with the suffix "(api and worker log lines; end to end in TASK-092)")
- SEC-TC-31 (extended, app part): Cookie/Set-Cookie/Authorization sentinels never appear in API log output
- securityEvent(name, attrs) helper emits the catalogue name and never raw PII
- PR7-SEC-03 item 3 (ADR-0005 am. 10 item 6): a Pino serializer logs Prisma/driver errors as `{ name, code, originalCode, kind }` only — never `message`, `originalMessage`, `detail`, `hint`, `meta` or the rendered query (test: a P2039 whose message carries a table name and an input value logs neither)
- PR6-SEC-02 item 3 / PR6-SEC-03 item 1 (ADR-0010 am. 11 item 8): the logger never records carrier request or response bodies at any level; outbound log lines carry carrier code, account id, operation, route template, status, duration, error code and correlation id only — never `url.full`, `url.path` or `url.query`; redaction keys cover `Authorization` (Basic and Bearer), form-body `client_secret`/`child_secret`, and token responses
- PR #11 code review R3-m1 (i) + PR #11 security review R3.6 (D-ARCH-079): the runtime `security.*` events raised by apps/api/src/platform/db/runtime.ts (db_session_default_tampered, db_role_setting_drift, db_session_context_leak, rls_write_rejected) are re-pointed from the runtime log to this security logger (securityEvent helper) carrying exactly { event, correlationId, sqlState } — never the PostgreSQL text; the `onDbError` redacting hook deferred by TASK-016 (PR #11 DEFERRED list) lands here
- POST-MERGE FOLLOW-UP (not a PR #20 fix-cycle item; D-ORCH-023 (1), D-ARCH-084): PR21-SEC-07 (b) — the failure-excerpt redaction of tests/api/helpers/contract-validator.ts reads the single Pino redaction key source of this package (one list, shared) and its local key-family regex (proof, code, recovery, provisioning, signature, key) is retired into that source; if PR #20 merges without it, TASK-020 lands it as the TASK-017 follow-up (FALLBACK clause on its sheet)
- Covers the scenarios of AT-US-008-01 … AT-US-008-06 that belong to its layer; US-008 closes in TASK-092

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-011 — Lane B local heavy lane and evidence integrity (quality:heavy, summary.json schema, check-evidence, required-suites manifest, prune)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-OPS-003, NFR-QUAL-006 |
| Spikes / security / decisions | T-QA-01, D-QA-001, D-ARCH-010, D-ARCH-021, SEC-P3-07, SEC-P3-31, R-ARCH-16, D-ARCH-082 |
| Specialist · model | devops-engineer · opus |
| Complexity | M |
| Depends on | TASK-007 |
| Batch · locks | 0.4 · quality-tools |
| Branch | `feat/TASK-011-lane-b-local-heavy-lane` |
| Priority | Enabler |

**Files / modules**
- tools/quality/{heavy.mjs (--profile pr|wave|gate; one JUnit per suite; k6/Lighthouse/ZAP/Trivy/Gitleaks/Stryker converted to JUnit), check-evidence.mjs (manifest rules TEST-STRATEGY §9.2), prune.mjs, summary.schema.json}
- tools/quality/required-suites.json (moved verbatim from docs/05-quality/tests/required-suites.json, D-QA-001)
- docs/05-quality/README.md (evidence layout, naming, retention, 5 MB cap)
- ci.yml step quality:check-evidence (base-ref copy)
- root scripts quality:heavy, quality:fastlane, quality:check-evidence, quality:prune

**Acceptance tests to write**
- SEC-TC-48: check-evidence FAILs on verdict PASS with JUnit failures > 0, a missing required security suite, skipped > 0 in a security suite, untracked files in code paths, any SKIP_* variable recorded, evidence older than a change to openapi.yaml
- R-ARCH-16 negative tests: tampered attachment hash, dirty tree, non-ancestor SHA -> rejected
- summary.json records node_version, lockfile SHA-256, Testcontainers digests, host spec
- R-ARCH-21 / ADR-0023 am. I item 4: quality:heavy records build_clean (empty git status --porcelain after npm run build) in summary.json and check-evidence refuses a PASS verdict without it
- POST-MERGE NOTE (D-ARCH-082; PR #23 is not reopened for it): the evidence schema path tools/quality/summary.schema.json is RATIFIED (ADR-0023 am. K item 2 strikes the am. B path); the activation protocol is manifest-only PRs by qa-lead at the W0-ACT-1, Wave-0-exit, v0.1.0-m0 and G3 checkpoints while the checker keeps reading the BASE manifest (SEC-P3-31) and quality:heavy runs only `active` suites (planned suites appear in summary.md only, never as JUnit) — if PR #23 merged with a different behaviour a light devops follow-up PR aligns it; `tooling_inputs` must name tools/quality/required-suites.json and tools/quality/summary.schema.json (qa-lead, D-TASK011-01 (5))

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-012 — SPK-08 spike: audit owner separation, identity-based DDL event trigger and ECDSA-signed anchors on PG 18

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-AUDIT-002, NFR-AUDIT-003 |
| Spikes / security / decisions | SPK-08, SEC-COND-03, SEC-COND-05, R-ARCH-18 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-003 |
| Batch · locks | 0.4 · spike-08 |
| Branch | `feat/TASK-012-spk-08-spike-audit-owner` |
| Priority | Enabler |

**Files / modules**
- prisma/tests/spikes/spk08-audit-owner.int.test.ts
- prisma/tests/spikes/spk08-anchor.int.test.ts
- docs/04-plan/spikes/SPK-08.md

**Acceptance tests to write**
- SPK-08 exit: SEC-TC-43 prototype green (migrator cannot disable triggers/RLS/detach; dynamic-SQL bypass blocked by the event trigger; ensure_audit_partitions still works)
- SEC-TC-44 prototype green (tampered entry -> CHECKPOINT_SIGNATURE_INVALID; deleted anchor -> ANCHOR_MISSING)
- Three checks recorded: rds_superuser can create the event triggers; Prisma 7 shadow DB receives bootstrap-lane objects; no Prisma-generated DDL is blocked by the guard

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-013 — Typed permission catalogue, seeded roles via versioned migration, role-permission matrix document, privilege-escalation guard

| Field | Value |
|---|---|
| Stories (completes) | US-065 **DC** (M0 Must) Typed permission catalogue<br>US-066 **DC** (M0 Must) Seeded roles, role-permission matrix document and privilege-escalation guard test |
| REQs | REQ-RBAC-001, REQ-RBAC-014, REQ-RBAC-002, REQ-RBAC-003, REQ-RBAC-004 |
| NFRs | NFR-SEC-011, NFR-TENANT-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-003 |
| Batch · locks | 0.4 · pkg-authz |
| Branch | `feat/TASK-013-typed-permission-catalogue-seeded-roles` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/authz/src/{permissions/<module>.ts + permissions/index.ts (aggregated), roles.ts, authorise.ts, matrix-doc.ts}
- prisma/schema/authz.prisma + migration (permissions, roles, role_permissions; GLOBAL)
- docs/03-architecture/generated/role-permission-matrix.md (generated, read-only)

**Acceptance tests to write**
- All US-065 and US-066 scenarios
- Privilege-escalation guard test: no customer role holds an operator permission; matrix document regenerates identically (drift test)
- AT-US-065-01 … AT-US-065-05: all 5 scenarios of US-065, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-066-01 … AT-US-066-12: all 12 scenarios of US-066, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- 95 % coverage gate on packages/authz
- Security-critical path: security-integration job
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/authz/**`, `prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-014 — Hardened multi-stage images and Docker Compose skeleton (bootstrap + migrate one-shots, Valkey ACL, RustFS, Mailpit, local edge)

| Field | Value |
|---|---|
| Stories (completes) | US-004 **DC** (M0 Must) Hardened multi-stage container images |
| Stories (partial; completed by TASK-089, TASK-089) | US-003 **DC** (M0 Must) One-command local environment<br>US-049 **DC** (M0 Must) Idempotent reference and demo seed framework |
| REQs | REQ-PLAT-006, REQ-PLAT-005, REQ-DATA-001, REQ-DATA-002 |
| NFRs | NFR-OPS-001, NFR-OPS-002, NFR-SEC-007 |
| Spikes / security / decisions | D-061, PR13-SEC-08, PR13-SEC-09, PR4-SEC-02, PR4-SEC-12, PR9-SEC-15, PR9-SEC-17, PR9-SEC-16, PR3-SEC-06, D-ARCH-079, SEC-P3-20, SEC-P3-21, SEC-P3-23, SEC-P3-08, SEC-P3-04, D-ARCH-040, D-ARCH-041, D-ARCH-044, D-TASK017-01, PR20-SEC-04, D-ORCH-023, D-ORCH-025, D-ARCH-084, PR30-SEC-04, PR30-SEC-08, PR30-SEC-11, PR27-SEC-01, PR28-SEC-03, D-ARCH-100, D-SEC-PR38-02, D-ARCH-115 |
| Specialist · model | devops-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-004, TASK-006, TASK-010, TASK-003 |
| Batch · locks | 0.5 · infra-compose |
| Branch | `feat/TASK-014-hardened-multi-stage-images-docker` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/{api,worker,web,admin}/Dockerfile, prisma/Dockerfile (migrate) — npm ci --ignore-scripts + deps:rebuild, non-root, digest-pinned bases
- compose.yaml, compose.debug.yaml
- infra/local/valkey/users.acl
- infra/local/edge/*.conf (bound 127.0.0.1, strips X-Mock-Scenario outside local, log format without Cookie)
- .hadolint.yaml
- tests/compose/compose-up.test.ts (NFR-OPS-001 timing)
- packages/config/src/guards.ts (credentialPairGuard over CREDENTIAL_PAIRS; STORAGE_PUBLIC_ENDPOINT companion rule; D-ARCH-100)
- .dockerignore + tools/ci/check-dockerignore.test.ts (matcher test, D-ARCH-100)
- infra/local/edge/storage.conf (store vhost in front of STORAGE_PUBLIC_ENDPOINT: Host passthrough, GET/HEAD only, nosniff)
- api and worker runtime stages copy prisma/package.json and prisma/dist/client (JavaScript) beside the packages dist folders, and never prisma/generated, prisma/schema, prisma/migrations, prisma/bootstrap, prisma/seed or prisma/tests (D-ARCH-105; platform.md 3.2 paragraph of 2026-11-13); .dockerignore keeps prisma/client/tsconfig.json visible to the build stage

**Acceptance tests to write**
- All US-004 scenarios (non-root, size budgets, no secrets in layers)
- US-003 scenarios for stack start and idempotent second up (seed content completed by the seed tasks)
- SEC-TC-34 (extended): edge bound to 127.0.0.1 by default
- SEC-TC-45 (Dockerfile part): marker absent after image install
- Valkey default user off; api/worker/healthcheck ACL users only
- ADR-0023 am. J item 2 (e) and ADR-0022 am. 14 b (D-ARCH-041): the `migrate` image fetches and verifies the schema engine in its build stage through `deps:rebuild`. It sets `ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x CHECKPOINT_DISABLE=1`, and its entrypoint runs `node tools/deps/prisma-cli.mjs` in `--verify-only` mode before `migrate deploy`. SEC-TC-64 (vi): `docker run --network none <migrate> prisma --version` exits 0, and `api`/`worker` hold no `node_modules/@prisma/engines` and no `schema-engine*`
- am. J items 1 (c), 5 and 6 and ADR-0022 am. 14 a, c–f (D-ARCH-040, D-ARCH-044): image installs run from the repository root with the root `package-lock.json` and `.npmrc` (`--workspace=apps/<app>`). `web`/`admin` build stages run with `NPM_CONFIG_OFFLINE=true` and compare the SHA-256 of `package.json` and `package-lock.json` before and after the build. Images set `ENV CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false`. No `npm rebuild` appears in any Dockerfile: a bcrypt prebuild that fails to load is a build failure
- Entrypoint preflight (D-ORCH-007 item 2; PR3-SEC-13, PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8, D-ARCH-061): with APP_ENV staging or production the api/worker entrypoint refuses NODE_OPTIONS outside the option-name allow-list, any PG* variable (at least PGOPTIONS) and NODE_ENV != production, exits 78 within 5 s before any application code runs, and `--disable-sigusr1` is set; container test: `docker run -e APP_ENV=staging -e NODE_OPTIONS=--inspect-wait=0.0.0.0:9229 <image>` and `-e NODE_ENV=development` each exit 78 and nothing listens on 9229
- AT-US-049-02 (D-061 item 2; PR #13 code review M1/n7; this task OWNS the scenario): the Compose seed one-shot runs db:seed then db:seed:demo after migrate with NODE_ENV=development and APP_ENV=local (D-TASK023-01 (02) refuses NODE_ENV=production with a local/test APP_ENV), the one-shot image carries tsx plus the @platform/source sources or runs a built dist (record the tooling-image closure), and the test asserts that after `docker compose up --wait` every reference dataset registered at that time is present with one reference_dataset_versions row each; the "demo data are present" clause of AT-02 closes with TASK-089 together with US-003 AT-01
- PR13-SEC-08 / PR13-SEC-06 + PR3-SEC-06 (seed one-shot env, ordering, per-service env): DATABASE_MIGRATOR_URL appears only in the migrate/seed job environment, DATABASE_BOOTSTRAP_URL only in the bootstrap one-shot, AUDIT_ANCHOR_SIGNING_KEY worker-only and the private JWT_SIGNING_KEYS never in the worker — per-service `environment:` or split env files, never one compose.env for every service; hardened runtime images set NODE_ENV=production; ordering snapshot -> migrate -> seed
- PR13-SEC-09 (LOW) + PR #13 code review R2-n2/R2-n3/m1 + PR9-SEC-17 + PR9-SEC-16 remainder + PR #9 r1 n5 — ONE TLS implementation: tlsConfig, readRootCertificate and withoutQuery move from apps/api/src/platform/db/client.ts into @platform/config (hasOnlyRuntimeDatabaseUrlParams exported too) and the api pool, the worker, prisma/seed/migrator-connection.ts and tools/db/bootstrap.ts all import them, so sslmode=no-verify|bogus, a PGSSLMODE fallback (ssl is always explicit: false, or { rejectUnauthorized: true, ca? }), a relative/directory/system/missing sslrootcert and NODE_TLS_REJECT_UNAUTHORIZED != 1 are refused everywhere — exit 1 (seed) / 78 (runtime) naming only DATABASE_MIGRATOR_URL / DATABASE_URL, never a path or value; readRootCertificate opens ONCE (O_RDONLY|O_NONBLOCK), fstat-checks the descriptor is a regular file and bounds the bytes actually read to 1 MiB (a procfs file reporting size 0 and a FIFO are refused without blocking), and the CA path is confined to a CA directory; the seed and bootstrap pg.Client set query_timeout = STATEMENT_TIMEOUT_MS + 10000 and keepAlive: true and register a pg error listener (tools/db/bootstrap.ts has the m1 gap); the seed is a checkToolingEnv caller (PR3-SEC-14): APP_ENV staging|production requires exactly one sslmode=verify-full; this lands after PR #11 merges (D-ORCH-020) — PR #11 does not touch these helpers
- PR #9 code review R3-m1 + PR #11 code review R3-m2 (orchestrator ruling): a DatabaseConfigError (sslmode / sslnegotiation / sslrootcert VALUE or file-system failures) or TenantTxConfigError (PGOPTIONS set) thrown by createRuntimeServices in apps/api and apps/worker main.ts exits 78 with a structured log line naming the variable (DATABASE_URL / PGOPTIONS), never exit 1 with a raw stack; a main-level or config-loader test proves both; additionally a value predicate exported from @platform/config (sslmode in {disable, allow, prefer, require, verify-ca, verify-full}, sslnegotiation in {postgres, direct}, direct implies TLS, sslrootcert absolute and not system) runs inside databaseUrlParamsGuard
- PR4-SEC-02 / PR4-SEC-12 (BINDING) + PR1-SEC-03 (d): the web and admin Dockerfiles run `rm -f /etc/nginx/conf.d/default.conf` and clean /usr/share/nginx/html/* before copying the template and ONLY build/client/ (never build/server/); image test: `nginx -T` contains exactly one server block; `curl -H "Host: localhost"` and `-H "Host: other.example"` against /en/ both return X-Content-Type-Options: nosniff and Server: nginx without a version; /usr/share/nginx/html/50x.html is absent; any IPv6 listen is default_server too; the template comment is reworded to "answers requests whose Host matches no server_name; TASK-014 deletes the stock default.conf, which would still take Host: localhost and IPv6"
- PR9-SEC-15 (LOW; TASK-007 merged without it): npm is taken out of the Prisma child chain — tools/deps/prisma-cli.mjs and rebuild.mjs resolve the prisma bin through createRequire(prisma/package.json) and spawn process.execPath directly (no `npm exec`, so an .npmrc script-shell or node-options cannot choose code), and tools/deps/npm-cli.mjs stops trusting npm_execpath (Node-install-relative candidates only, or a path inside dirname(process.execPath)); unit: the Prisma argv contains no npm-cli.js; integration: a scratch .npmrc with script-shell=<marker> and node-options=--require <probe> leaves no marker after runPrisma([--version]) while the positive control under plain `npm exec` writes it
- D-TASK017-01 (7) / PR #21 code review R1 merge condition 5 (D-ORCH-023 (1); D-ARCH-084): the api image ships docs/03-architecture/api/openapi.yaml at <app root>/docs/03-architecture/api/openapi.yaml relative to apps/api/dist/main.js (compose sets DOCS_ENABLED=true, so without the file the api container exits 78 with DocsSpecError); image test: against the running compose api, GET /api/docs/openapi.json answers 200 and the served document is byte-equal to the repository contract at the image SHA; the contract is public and needs no allowlist
- PR20-SEC-04 item 2 (D-ORCH-025 (2); D-ARCH-084): APP_LOG_LEVEL clamp — the config schema refuses APP_LOG_LEVEL in {error, fatal, silent} when APP_ENV is staging or production (exit 78 naming only the variable; local and test keep the full range) and the entrypoint preflight of this task lists APP_LOG_LEVEL next to NODE_OPTIONS and PG*; config test: APP_LOG_LEVEL=silent with APP_ENV=production is refused; the security sink already bypasses the level gate (PR #20), so the clamp protects the ordinary error lines and the fatal process-error line
- CONFIG HALF OF PR30-SEC-04 AND PR30-SEC-11 (D-ARCH-100 item 1; ADR-0021 am. 2 item 6 and am. 3; PR #30 security r2): packages/config guards.ts gains credentialPairGuard driven by a CREDENTIAL_PAIRS table (STORAGE_ACCESS_KEY_ID_REF with STORAGE_SECRET_ACCESS_KEY_REF; TASK-116 appends the anchor-sink pair): exactly one member of a pair configured is an issue with code inconsistent and rule storage.credentialPair on each configured key (keys only, never a value), and loadRuntimeConfigOrExit exits 78 with a structured line naming the keys and the reason code — this replaces the uncaught StorageConfigError of PR30-SEC-11 for the configuration case, the adapter-level throw stays as defence in depth, and both main.ts files keep installProcessErrorHandlers above createRuntimeServices; in staging and production BOTH references are refused (code forbidden-in-environment, rule storage.staticCredentials) with no override switch — the IAM task role is the identity there, and a switch is added only by an ADR-0021 amendment if a non-IAM store is ever chosen for staging; STORAGE_PUBLIC_ENDPOINT is required (code missing, through companionGuard) whenever STORAGE_ENDPOINT is set, in every environment, because the pre-signed URL otherwise carries the in-network host; tests: one reference exits 78 with the key names and no value, both references with APP_ENV=production exit 78, STORAGE_ENDPOINT without STORAGE_PUBLIC_ENDPOINT exits 78, the Compose environment (both endpoints, both references, local-only values) and an AWS-shaped environment (neither endpoint, neither reference) load cleanly
- RUSTFS COMPOSE SERVICE AND STORE VHOST (PR30-SEC-08 (b); PR #30 code review follow-up for the compose rustfs service and bucket init; platform.md section 2.2 as amended 2026-11-13; D-ARCH-100 item 2): the rustfs service pins rustfs/rustfs:1.0.4 by the multi-arch index digest that PR #30 pins in storage/tests/rustfs.ts (a test compares the two), publishes only 127.0.0.1:9000 (the console port 9001 is not published, and the console CORS default of * is not inherited: RUSTFS_CONSOLE_CORS_ALLOWED_ORIGINS is set to an empty allow-list or the console is disabled, whichever the pinned image supports), takes its root credentials from the same secret references as STORAGE_ACCESS_KEY_ID_REF and STORAGE_SECRET_ACCESS_KEY_REF (file provider, local-only values from compose.env), has the /health check, and storage-init keeps its bucket list of platform.md section 2.2 (the audit-anchors bucket is not created in Compose, whose anchor sink is the file: volume; the s3: sink is exercised by integration tests, which create the bucket themselves); the edge proxy gets a store vhost in front of STORAGE_PUBLIC_ENDPOINT that passes the Host header through unchanged (the pre-signed URL signs Host), forwards only GET and HEAD, and adds X-Content-Type-Options: nosniff (ADR-0021 am. 3 item 1); image test: a pre-signed GET through the edge host returns 200 with the forced content type, the attachment disposition and nosniff, a PUT or DELETE with the GET URL returns 403 or 405, and a request whose Host differs returns 403
- DOCKER CONTEXT HYGIENE (PR27-SEC-01 LOW, D-SEC-PR27-01; PR28-SEC-03 item 6; PR30-SEC-08 (b); D-ARCH-100 item 3; due before the first image-building PR merges): .dockerignore at the repository root excludes **/tests, **/spikes, **/fixtures, **/*.test.ts, **/*.test.js, .claude, .git, .env*, node_modules, coverage, *.pem, *.key and docs, with the single exception !docs/03-architecture/api/openapi.yaml that the api image ships (see the openapi line above); every Dockerfile copies explicit paths only — for the migrate image prisma/migrations, prisma/bootstrap, prisma/seed, prisma/schema and prisma.config.ts — and never COPY . . or COPY prisma ./prisma; a lane A static test beside check-install-flags (tools/ci/check-dockerignore.test.ts) parses .dockerignore with a Docker-compatible matcher (written in-house in at most 80 lines, or a package that passes the dependency gates) and asserts that prisma/tests/spikes/spk04/server.ts, prisma/tests/spikes/spk08/10-audit.sql, tests/load/spikes/spk04-audit.js, apps/api/src/platform/storage/tests/rustfs.ts and .claude/settings.json are ignored, that the openapi.yaml exception is NOT ignored while every other docs/ path is, and that no Dockerfile COPYs ., ./ or the bare prisma directory; the image suite runs find / on every image for paths matching prisma/tests, tests/load, storage/tests, spikes and *.test.js (excluding /proc) and expects no output
- D-ARCH-105 generated Prisma client in the images: the runtime-stage preflight of ADR-0022 am. 13 (dist/preflight.js) imports @platform/prisma/client, which proves the default condition resolves to prisma/dist/client without --conditions; the image find check finds no prisma/generated directory and no schema-engine file in api and worker; node_modules/@platform/prisma in the image links to a directory holding only package.json and dist; if this task merges before TASK-020 part 020-B, part 020-B adds these COPY lines and the preflight import in its own PR
- REVIEW REQUIREMENT FOR PR #39 (D-SEC-PR38-02; D-ARCH-115; this task is in flight, so this is a merge check, not new scope): the api and worker images hold no compiled test or test-seam code: tools/docker/prune-dist.mjs removes dist/**/*.test.js (with maps and declarations), the query counter (apps/api/dist/platform/db/query-counter.js, its map and declaration; PR #34 security review checkpoint) and every dist/**/tests/ directory outside node_modules, which covers apps/api/dist/platform/routing/tests/** (fixture-route.js, loopback.js) and the module tests/ helpers; tests/compose/images.stack.test.ts asserts all three in its image find (the pattern list gains -path */routing/tests* next to *.test.js and query-counter.*, and a generic -path */dist/*/tests/* if no node_modules package trips it), and tools/docker/prune-dist.test.ts carries the platform/routing/tests/fixture-route.js case; if PR #39 already does all of this the line is satisfied as is
- AT-US-004-01 … AT-US-004-04: all 4 scenarios of US-004, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-003-01 … AT-US-003-04 that belong to its layer; US-003 closes in TASK-089
- Covers the scenarios of AT-US-049-01 … AT-US-049-10 that belong to its layer; US-049 closes in TASK-089

**DoD notes**
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`, `prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-015 — SPK-07 + lane C full lane, coverage and diff-coverage gates, security-integration job, ci:minutes

| Field | Value |
|---|---|
| Stories (completes) | US-006 (M0 Must) Coverage gate |
| REQs | REQ-PLAT-008 |
| NFRs | NFR-MAINT-004, NFR-OPS-003, NFR-QUAL-001, NFR-QUAL-002 |
| Spikes / security / decisions | COND-E2E-FF, PR4-SEC-08, PR4-SEC-11, PR10-SEC-16, PR10-SEC-17, PR10-SEC-18, PR10-SEC-19, PR10-SEC-20, PR10-SEC-21, PR17-SEC-02, PR17-SEC-07, PR17-SEC-08, PR17-SEC-09, PR17-SEC-10, D-ORCH-019, D-ORCH-021, D-ARCH-079, SPK-07, D-ARCH-010, D-ARCH-021, R-ARCH-15, R-ARCH-19, PR11-SEC-08, D-TASK016-01, D-ARCH-074, D-ORCH-023, PR21-SEC-04, PR4-SEC-13, D-ARCH-084, PR31-SEC-01, PR31-SEC-02, PR31-SEC-03, PR31-SEC-05, PR31-M1, PR31-M2, PR31-M3, D-ORCH-038, D-SEC-PR31-01, PR24-SEC-04, PR26-SEC-07, PR30-SEC-08, D-ARCH-098, D-SEC-PR33-02, D-SEC-PR35-01, D-ORCH-047, D-SEC-PR40-01, D-ORCH-057, D-ARCH-115, D-ARCH-132, D-ARCH-137, PR55-SEC-11, PR59-SEC-02, D-SEC-PR55-02, D-SEC-PR59-01, D-ARCH-145, PR287C1-SEC-02, D-SECPR287C1-01, D-SD-002, PR075-SEC-02, PR64-SEC-09, D-SECPR039-01, D-SD-004, PR295-SEC-01, D-SECPR295-01, D-SD-006, D-SECPR040-01, D-SECPR043-02, D-SD-008 |
| Specialist · model | devops-engineer · opus |
| Complexity | M |
| Depends on | TASK-011, TASK-007 |
| Batch · locks | 0.5 · ci-workflows |
| Branch | `feat/TASK-015-spk-07-lane-c-full` |
| Priority | Must |

**Files / modules**
- .github/workflows/ci.yml (workflow_dispatch profiles wave-end|release-candidate; integration, images, e2e-stack sharded, iac, inventory cross-check; security-integration job on security-critical paths)
- .github/workflows/nightly.yml (workflow_dispatch only, no schedule)
- jest.config.ts coverage thresholds 85/75 global, 95/95 pricing/audit/authz
- tools/ci/diff-coverage.mjs
- tools/ci/ci-minutes.mjs (npm run ci:minutes)
- docs/04-plan/spikes/SPK-07.md
- tools/ci/check-tree-modes.mjs (+ test; lane A tree invariant, D-ARCH-098)
- tools/quality/{check-evidence.mjs, lib/host.mjs, lib/convert.mjs, lib/manifest.mjs} (+ tests; D-ARCH-098)
- tools/repo/{git-submodule-flag.test.ts, temp-cleanup.test.ts, temp-cleanup.allow.json}
- .github/CODEOWNERS additions (D-ARCH-098 item 6)

**Acceptance tests to write**
- All US-006 scenarios
- SPK-07 exit: fast lane <= 15 job-min on a typical PR and <= 20 min wall-clock; security-integration <= 12 job-min; check-evidence negative fixtures rejected; `npm run ci:minutes` prints month usage
- Diff-coverage gate fails a PR whose changed files are below 85/75 (95 in pricing/audit/authz)
- C-1 (ADR-0005 am. 10 W-1 and item 13; D-TASK016-01; PR #11 code review §4 ruling 2 and security review §5 ruling 2; D-ARCH-074; DUE BEFORE G3): the hosted `security-integration` job this task creates runs the spike file `prisma/tests/spikes/spk03-rls-tx.int.test.ts` on ubuntu-latest with `SPK03_BENCH=1` and uploads `SPK03_REPORT` as a job artifact that carries `d_overhead_ms` (without the flag the (d) block is skipped and C-1 would be "done" with no measurement); the measured end-to-end per-transaction delta is recorded in SPK-03 §4 and ADR-0005 am. 10 W-1 (recorded, never asserted; performance-engineer verifies against the per-request budget at P6); then, in the SAME commit, the spike file is deleted AND its exact-file entry in `TENANT_CONTEXT_EXEMPTIONS` (eslint.config.mjs) is removed — a stale entry would exempt any future file at that path (PR11-SEC-08); until that commit the spike runs only against throw-away test databases
- COND-E2E-FF (D-ORCH-019, D-ORCH-020; due before G3): the lane C e2e-stack job runs the firefox-mobile and firefox-desktop Playwright projects on ubuntu-latest and they are green (the Windows host blocks the Firefox install with EPERM and is not worked around); evidence handed to qa-lead; PR4-SEC-08 residual: deps:rebuild refuses an inherited PLAYWRIGHT_*DOWNLOAD_HOST in its Playwright step (forbiddenEnv is Prisma-only today) and `--with-deps` stays confined to lane C; PR #4 code review R3-n6: a CI globalTimeout so the WebKit close hang fails the job with a clear message (qa-lead records the known issue in TEST-STRATEGY §11); PR #4 code review R4-m1 (D-ARCH-084): the same Linux run also executes webkit-desktop and webkit-mobile with --repeat-each=5 (at least 10 runs in total) and attaches the trace of any failure — if the SPA-fallback lang=en assertion reproduces it belongs with R3-n1 under TASK-042 (capture the served locale once), otherwise qa-lead closes it in TEST-STRATEGY §11 next to R3-n6
- PR4-SEC-11 / PR #4 R3-M1 generalisation + PR17-SEC-09 (due before the first Wave-1 feature merge): a repo test asserts that every path jest.config.ts references (testEnvironment, setupFiles*, moduleNameMapper targets, transform modules, globalSetup/globalTeardown) falls under a CODEOWNERS pattern (fixture: a config whose testEnvironment points to an unowned folder fails); jest.config.ts common and tools/lint/jest.base-fixtures.config.json set modulePathIgnorePatterns [<rootDir>/.*/dist/, <rootDir>/.*/build/, /__mocks__/] (suites use jest.mock(name, factory) — Jest 30 otherwise uses any __mocks__/<pkg> under roots as the module for a bare require in EVERY suite, which would let an unowned file replace @platform/authz or pg in the RBAC, audit and RLS suites), **/__mocks__/ joins CODEOWNERS and REQUIRED_CODEOWNED_PATHS, repository rule jest-manual-mocks rejects any __mocks__ directory and any tracked node_modules/ segment, the ci-policy.test.ts key allow-list is updated, and a test planting <tmp>/apps/x/__mocks__/<pkg>.js still resolves the real module
- PR10-SEC-16/17/18 + PR #10 code review R2-m2/m3/m4 (before this task adds or refactors workflows): Semgrep scans a clean `git archive` export with every non-root .semgrepignore and .gitignore deleted (or run-semgrep exits 2 on any nested scope file), policy rule nested-scope-file, scanned-file count printed next to the base count, run-semgrep.int.test.ts seeded fetch() + nested .semgrepignore negative control; check-workflow-policy: scans-isolation becomes an allow-list (node only on "$GATE_*"; bash, sh, make, python, ./, relative tools/, $PWD, $(pwd) and the quoted "$GITHUB_WORKSPACE"/ form rejected; docker run only for "$GITLEAKS_IMAGE"), gitleaks-hardening parses --mount source= as well as -v/--volume, allows exactly the .git and .gitleaks.toml sources, requires --exit-code 1 and rejects --baseline-path / --gitleaks-ignore-path / --max-target-megabytes, `set +e` and a trailing || after the gitleaks segment; required-gates pins both extraction steps (git archive "$RANGE_BASE" branch with its exact condition; GATE_*/GATES_DIR only under $RUNNER_TEMP) and GITLEAKS_IMAGE to ghcr.io/gitleaks/gitleaks:, with anchored gate run lines (no ||, ;, set +e, --report-only, --event); untrusted-expression drops env.*, steps/needs outputs and matrix.* from SAFE_EXPRESSION (or an explicit output-name allow-list), checks with.args / with.entrypoint of docker:// steps and forbids the issues trigger; the scans setup-node step sets package-manager-cache: false (rule + fixture ci-scans-setup-node-auto-cache.yml); one failing fixture per probe row; the ci.yml header and D-TASK007-02 (11) wording say "regression tripwire; adversarial edits are covered by the .github/ record"
- PR10-SEC-19/20/21 + PR #10 code review R2-m1, R2-n1..n5, R2-n7, r1 n1: check-security-owned-paths fails when ANY record of the PR has a last verdict outside the allow-list, skips HTML comment blocks like fences, matches head rows exactly (Branch / head, Head, Head / range), fails a PR whose diff adds or changes a record named for a different PR number, and binds head SHAs only to the round that holds the last Verdict row (PR10-SEC-21 test: round-1 FAIL names Y, round-2 PASS names X, head = X plus a revert of the owned paths to Y -> missing); REQUIRED_CODEOWNED_PATHS equals the CODEOWNERS security-owned set (test), with /.gitattributes, **/.gitattributes, **/.semgrepignore, **/.gitignore and /.claude/commands/ owned (the orchestrator rejects PR diffs touching another agent memory directory); check-install-flags gains REIFY_COMMANDS (update, dedupe, uninstall, link, audit fix) requiring canonical --ignore-scripts, treats a word containing $ or a backtick after --ignore-scripts as an override, and runs the FORBIDDEN_CHAR test on compose files and Dockerfiles; the npm alias drift test asserts a superset; patternToRegExp maps a leading **/ to an optional directory prefix; TASK-ID regexes accept four digits; a lane C integration test runs the pinned gitleaks image over a temp repo for the allow-marker, .gitleaksignore and merge-only-secret cases; before CI_MAIN_FAST_LANE=true a docs-only push is still secret-scanned (drop paths-ignore for scans or add a dispatch-only full-history gitleaks run); local ./ actions are walked when actions are added
- PR17-SEC-02/07/08/10 + the CR-in-summary note + PR #17 code review R2-m1/R2-n1/R2-n3/n5 (D-ORCH-021; at the latest before G3, and before any further gate is pinned): the lint-fixture harness emits line, column and messageId per finding, Violation tuples carry the expected line and noWeakening requires a distinct finding at that line (fixture-expectations.test.ts: R expected at line 3 against [(R,7),(R,9)] -> missing; [(R,3),(new,5)] -> extras [new]); logText splits on CR as well as LF; yaml-subset fails closed on a folded scalar with a more-indented or empty line and required gates demand a literal `run: |` for pinned steps (F0-F2 fixtures); FORBIDDEN_ENV gains BASH_ENV, ENV, PATH, SHELLOPTS, BASHOPTS, PS4, IFS and the BASH_FUNC_ prefix at workflow, job, step and container level, $GITHUB_PATH writes and non-allow-listed or computed $GITHUB_ENV names are findings, the RANGE_BASE/RANGE_HEAD job env values are pinned, the exact step-env rule applies to every gate (empty allow-list when gate.env is undefined); lint-script step matchers are anchored full-step regexes rejecting ; | & $( backticks < and >, extra steps allowed only after the last base step; a bad-raw-any fixture (or EFFECTIVE_RULES) proves @typescript-eslint/no-explicit-any is on and the harness asserts linterOptions.reportUnusedDisableDirectives = 2; commandLines does not trimEnd a line ending in a backslash; the LINT_CONTROLS classifier includes package-lock.json so a lock-only plugin bump runs the base-ref step; the step-env comment says "(step level; job-level env is the D-TASK007-04 residual)"
- PR #2 code review m7 (routed here with the suppression-count script): platform/any-justification requires a TASK-\d{3,} id in the suppression description and applies the same check to suppressions of @typescript-eslint/no-non-null-assertion (and ban-ts-comment), with negative fixtures
- PR #21 code review R1-m6 / NFR-MAINT-004 (D-ORCH-023 (1); D-ARCH-084; DUE BEFORE THE v0.1.0-m0 TAG — in this task or in the release-pipeline task that precedes the tag, never deferred past the first release): a lane A job `openapi-breaking` runs oasdiff (pinned container image or the npm wrapper, through the cooldown, licence Apache-2.0 and age gates; invoked with `npm exec --no --` or `docker run` of a digest-pinned image) comparing docs/03-architecture/api/openapi.yaml at the PR head with the contract at the latest release tag — while no tag exists the job prints "no release tag" and exits 0, from v0.1.0-m0 on it fails on any breaking change unless the PR carries the api/README §18 deprecation record; a seeded fixture (an operation removed from a copy of the contract) fails the check; the tools/openapi README "append-only" sentence reads as a process rule caught by this job (D-ORCH-024 (4))
- PR4-SEC-13 (INFO; PR #4 security review R3.6; D-ARCH-084; with PR10-SEC-17 and PR17-SEC-08): (1) a porcelain gate straight after the Lint step and before Type-check — a typegen-phase rewrite of tracked files is caught because only owned code runs after ESLint inside npm run lint (fixture: a workspace typegen script that appends a rule override to eslint.config.mjs fails the lane); (2) root `typegen` is exactly `npm exec --no -w apps/web -w apps/admin -- react-router typegen` (no `--workspaces --if-present`, so an unowned workspace package.json script no longer runs inside lint and typecheck) and the lint wiring test pins that string and rejects the --workspaces form; (3) CODEOWNERS lines for /prisma.config.ts and /apps/*/vite.config.ts (the envPrefix control of PR4-SEC-01 lives there) with REQUIRED_CODEOWNED_PATHS and its test updated; the ADR-0023 am. K item 1 residual note is the architect side
- PR21-SEC-04 remainder (PR #21 security review R2.4; D-ARCH-084): the coverage exclusion `!**/*.generated.ts` is anchored to the known generator outputs (exact paths or one generated folder each) and tools/repo/coverage-scope.test.ts asserts that every exclusion is an exact path or a known generated folder
- TOOLS/QUALITY HARDENING (D-ARCH-098 item 1; D-SEC-PR31-01; PR #31 security r1 PR31-SEC-01, -03, -05 and code review M1, M3, N1, N2; DUE BEFORE G3 and in the next change to tools/quality; code-owned paths, so the PR carries a security record): (a) PR31-SEC-01 — every git diff and git status invocation of tools/quality and tools/ci passes --ignore-submodules=none before the revisions (check-evidence changedPaths, changedEntries and the porcelain call, lib/host.mjs changedPaths and status, check-migration-immutability, check-security-owned-paths twice, check-porcelain) because a .gitmodules with ignore = all hides a gitlink change from them; a repo test tools/repo/git-submodule-flag.test.ts fails when such an argument list lacks the flag; check-evidence tests: a .gitmodules with ignore = all for a note path plus a 160000 entry at that path added after the evidence commit gives stale 1 path, and a gitlink-only change at a code path with the same .gitmodules still selects unit; (b) PR31-SEC-03 — the 13-case table gains zz.md.sh and zz.mdx under .claude/agent-memory/qa-lead (both stale), the mutant list gains the glob .claude/agent-memory/*/*.md*, and a test states the backslash asymmetry (selection normalises a backslash, isAgentMemoryNote refuses it) so that a later edit cannot make the two diverge unnoticed; (c) M1 — the prefix replacement of scrubPaths ends at a path boundary (negative lookahead on [A-Za-z0-9_~.$-] for the regex branch and for the split branch, which becomes a regex): a list prefix for the host account Alice leaves no trace of xavier in a path of the account AliceXavier in plain, forward-slash and JSON-escaped 8.3 spellings (the generic belt then takes the whole name), and a /tmp prefix does not consume /tmpfoo; (d) M3 — the belt name class admits a space when a separator follows (tried first, falling back to the current class), so a profile directory with a space in its name becomes <home> in full, one test case; (e) N1 — a hostScrubList case in which env LOCALAPPDATA or TMP is a path different from homeDir and tmpDir kills the surviving env-values mutant; (f) PR31-SEC-05 — a verifier-side host-path scan in check-evidence (base-ref copy): a run directory whose files match the same three shapes that the belt rewrites (a drive-letter Users path, a /Users/ or /home/ profile path, an 8.3 segment) fails the check with a count only and never the matched text; the shapes are shared constants exported by lib/convert.mjs, so an honestly scrubbed run cannot match; fixture runs with each shape fail and the committed run passes; the exotic spellings that survive today (a doubly JSON-escaped path, a percent-encoded drive, a URL-encoded user directory, a bare 8.3 segment without a preceding separator, plus a UNC profile and a percent-encoded file: URL from code review N2) are either closed in the belt or pinned as named belt limits in the README paragraph, one test each
- LANE A TREE INVARIANT (PR31-SEC-02 LOW, PR #31 security r1; D-ARCH-098 item 2; DUE BEFORE G3): tools/ci/check-tree-modes.mjs runs from the base-ref copy of tools/ci like the other gates and fails when git ls-tree -r -z on the head tree lists any entry of mode 120000 (symlink) or 160000 (gitlink), or a mode 100755 entry whose path is not matched by an allow-list that lives in the check itself (tools/hooks/* today: commit-msg and pre-commit are the only executable entries of the tree); it uses plumbing that no .gitmodules or diff setting can filter and covers every path, so a memory-only PR is judged too; it is wired as a required gate (CI_REQUIRED_GATES, so removing it from ci.yml fails check-workflow-policy); the allow-list is code-owned (a new executable file is a reviewed edit); tests build trees with plumbing: a symlink, a gitlink and an unlisted 100755 file each FAIL, a tree with only the two hooks PASSES, a gitlink under .claude/agent-memory FAILS
- CHECKPOINT NARROWING FOR THE v0.1.0-m0 REGRESSION (PR #31 code review M2; D-ARCH-098 item 4; DUE BEFORE THE v0.1.0-m0 TAG): the gate profile without a flag is G3 and G4 only; check-evidence --profile gate accepts --checkpoint with the values Wave-0 exit, v0.1.0-m0 and G3 (the order of CHECKPOINTS; default G3; refused with the pr and wave profiles, exit 2) and narrows two things from that one input: pending entries are reached when their checkpoint is at or below the named one (checkpointsReached takes the checkpoint), and gate rule 5 blocks only on suites whose new optional manifest field required_from (the same three values, default G3, validated by the parser and set by qa-lead in the activation PRs) is at or below the named checkpoint; the release workflow R0 step for v0.1.0-m0 passes --checkpoint v0.1.0-m0 and nothing else does; the G3 gate command in TEST-STRATEGY section 15 carries no --checkpoint; tests: at v0.1.0-m0 a G3 entry (SEC-TC-22 today) is not reached and a planned suite with required_from G3 does not block, at G3 both do, no flag equals G3, --checkpoint with pr or wave exits 2, an unknown value exits 2; README Suite activation and TEST-STRATEGY sections 4.2, 9.2 and 9.3 describe it (written as planned behaviour on 2026-11-13); the alternative of a decision ID on every G3 entry plus a deferred_at_gate row for every later suite is rejected (dozens of manifest rows and a security record for each tag)
- TEMP-DIRECTORY CLEANUP CHECK (D-ORCH-038 (2); D-ARCH-098 item 5; due before the Wave-0-exit activation PR): tools/repo/temp-cleanup.test.ts scans every .ts and .mjs file under apps, packages, prisma, tests and tools with the TypeScript compiler API and fails on a deletion call (rm, rmSync, rmdir, rmdirSync, unlink, unlinkSync, fs.promises.rm, rimraf) whose target expression contains tmpdir(), os.tmpdir, a TEMP, TMP or TMPDIR environment read or a /tmp literal, or is an identifier (or a join of one) whose only initialiser is such an expression — one level of aliasing; targets derived from mkdtemp or mkdtempSync (directly, through a variable, or through an array that mkdtemp results are pushed into) pass; a finding is waived only by an exact-path entry with a reason in tools/repo/temp-cleanup.allow.json (code-owned); positive controls: rmSync of tmpdir() joined with a fixed name and a loop over readdirSync(tmpdir()) fail, rmSync of a mkdtempSync directory passes; the existing tests pass the check unchanged or are fixed in the same PR; the other half of D-ORCH-038 (lock holders re-verify their owner file before heavy commands) is an orchestrator procedure and not part of this task
- CODEOWNERS AND RUNNER-IMAGE COMPLETENESS (already routed to this task by D-SEC-PR24-01 PR24-SEC-04, D-SEC-PR26-01 PR26-SEC-07 and D-SEC-PR30-01 PR30-SEC-08 (a) and (c), but not on the sheet until D-ARCH-098; due before the Wave-0-exit activation PR; CODEOWNERS is itself an owned path, so the PR carries a security record): .github/CODEOWNERS and REQUIRED_CODEOWNED_PATHS gain /prisma/ (whole), /tools/db/, /prisma.config.ts, /apps/api/src/platform/ (at least db/, health/checks/ and storage/), /packages/shared/src/ids/, /packages/audit/ and **/package.json, with check-security-owned-paths cases that a change to apps/api/src/platform/health/checks/audit-partitions.ts and one to tools/db/table-classes/audit.json each require a record; check-migration-immutability extends to prisma/bootstrap/*.sql (modified or deleted files refused, added files allowed; PR #24 code review R1-m3); tools/quality/suite-runners.json testcontainers_images gains the RustFS image with the digest that PR #30 pins in storage/tests/rustfs.ts (a test reads that constant, so the two cannot drift)
- QUALITY:HEAVY ATTACHMENT HOOK FOR THE TRACEABILITY REPORTS (D-SEC-PR35-01 correction of D-TASK277-03; PR #35 code review R1-m3; part 015-B; DUE BEFORE G3; tools/quality is code-owned, so the PR carries a security record): D-TASK277-03 said check-evidence rejects ac-trace.json, but ac-trace.json and flake-report.json are already on its fixed-file allow-list; what rejects them in a run directory is the rule that every file there needs a SHA-256 in summary.json. quality:heavy therefore runs quality:trace and quality:flake-report after the suites of a wave or gate run and records both outputs as attachments with their SHA-256 in summary.json (no hand-copied file), so the G3 run directory carries the traceability evidence and check-evidence accepts it; tests: a run with the hook passes check-evidence, a hand-added unlisted ac-trace.json still fails, and the output path stays confined to the run directory (PR35-SEC-01)
- GITLEAKS-FULL RUNNER REQUIREMENTS (PR33-SEC-08; part 015-B; DUE before gitleaks-full leaves planned): the runner extracts the baseline file from the base or gate ref with git show, validates every non-comment line with the same regex and the exact count before mounting, mounts it read-only with --gitleaks-ignore-path, scans the ancestry of the gate SHA and not --all, keeps --network none and --ignore-gitleaks-allow, and has integration cases for 17 baseline lines (0 findings), 16 lines (1 finding) and a commit-less path:rule:line line (rejected before the scan)
- MERGED-COVERAGE HOOK (D-ORCH-047 (2); PR #33 code review R1-m4; PR33-SEC-06; split out of part 015-B into its own small devops-engineer PR; DUE before TASK-025 merges, the first task whose critical code is covered only by integration tests): the lane B evidence step runs test:coverage merged across the Jest projects and then coverage:gate and coverage:diff on that merged summary, so the gate no longer counts unit coverage alone; the stable coverage gate case names (overall) move into unit.required_cases in a manifest-only qa-lead follow-up with a record (names of inactive scopes are not required, they change when a scope activates); G3 needs the gate transcript either way
- PR #33 R2-m1 AND PR33-SEC-09 (part 015-C, with PR17-SEC-07/-08; DUE before G3 and before any further pin): (a) gate-env also refuses a run step that writes a GATE_* or GATES_* name to GITHUB_ENV or GITHUB_PATH outside the two named gate-tooling steps (a head step that writes GATE_OPENAPI_BREAKING=./evil.mjs between the tooling step and the gate passes today), with a one-line mutation test, and until then the header comment and D-TASK015-17 say env entries only; (b) every pinned gate line uses the guard form ${GATE_X:?gate tooling not set} (node with an empty script path reads standard input and exits 0, so an unset variable is a silent success) and the run blocks of the two gate-tooling steps are pinned like the lane B step (exact ASCII command lines), or required-gates checks that every GATE_* used in a gate line is written by the pinned tooling step that precedes the gate step; cases: dropping one tool word from a loop, moving the openapi step above the tooling step and an unset variable each fail
- PR33-SEC-10 AND PR #33 CODE REVIEW R2-n1 (part 015-C, or the first oasdiff bump if that comes first; DUE before the first bump): the oasdiff image can be bumped through lane A: drop --image and the workflow OASDIFF_IMAGE value so the constant of the base-ref script is the single pin (an edit of it needs a record anyway), or accept the head constant when script and ci.yml agree and the record check is satisfied; a bump procedure note in the header of openapi-breaking.mjs; test: a PR that changes script and ci.yml together passes the workflow policy step on its own head
- PR33-SEC-05 AND PR33-SEC-07 (routed to 015-C by D-SEC-PR33-02, not on the sheet until D-ARCH-112; DUE before G3): CODEOWNERS and REQUIRED_CODEOWNED_PATHS gain /apps/*/react-router.config.ts, /apps/*/app/routes.ts and /tools/repo/ (the typegen-evaluated files and the new guard tests) with the usual mutation test; nonCanonicalNpmExec treats a dollar sign or a backtick among the words before the first -- as non-canonical (npm $x foo, npm ${V:-x} foo, npm $(echo x) foo) with fixtures
- REVIEW REQUIREMENT FOR PR #40 (PR #40 code review R1-m3; D-SEC-PR40-01; D-ARCH-115; in flight, merge check only): the diff-coverage gate runs in lane B quality:heavy --profile pr (D-TASK015-27) while TEST-STRATEGY 8 row 1 says lane A diff gate / ci-gate; before PR #40 merges, or in the qa-lead manifest PR that follows it, qa-lead changes row 1 to lane B pr evidence (the coverage diff: cases in unit.junit.xml) or records the deviation as a D-QA decision, and adds one sentence that merged branch counts are a lower bound, so a small changed-line denominator can fail where one combined Jest run passes, the remedy being one combined run (the PR40-SEC-06 re-check before G3 uses the same comparison); the PR #40 body links the strategy change
- 015-C CONSOLIDATED LIST (fold 8, D-ARCH-137; routed by D-ORCH-066/070/076/085/087/089/091/094/101/105 and the PR #40/#44/#45/#46/#47/#54 records; the 015-C dispatch brief is authoritative and this line is the backstop so that no routed item is lost; DUE before G3 unless stated): PR40-SEC-07/-08 (a source file name with a space or a git-quoted name is invisible to the diff gate: strip the TAB, refuse quoted targets, cross-check git diff --name-only -z; --glob-pathspecs or scrub GIT_LITERAL_PATHSPECS) with PR #40 R2-m1 (a)/(b) (coverage-merge header wording, counterexample fixtures, uncovered-count assertion) and R2-n1/n2; PR45-SEC-01 exact parsed-config pin of .gitleaks.toml with PR #45 R1-m1/m2/n2 (before the next .gitleaks.toml change); PR44-SEC-08 ratchet and parity tests plus start-api.ts, main.ts and app.ts under CODEOWNERS; PR46-SEC-04 (no-release and dispatch-only rules keyed on content, CKV_GHA_7 per workflow; before the release-pipeline task), PR46-SEC-05 (lane C static gains Semgrep, audit, osv, signatures, licence and lockfile gates; before the first release-candidate dispatch; it is also the PR46-SEC-11 post-merge backstop), PR46-SEC-07 remainder and PR46-SEC-02 item 3; PR47-SEC-02 (selection_base recorded in summary.json, a narrower --base refused by check-evidence) and PR #47 R1-n1/n2; the node-options-preload rule refusing a ${{ }} expression or --inspect as a NODE_OPTIONS value (D-ORCH-091); the Lint heap-line follow-ups (peak-memory warning near 80 %, one source or a policy pin once two workflow files carry it; D-ORCH-085); PR54-SEC-04 CODEOWNERS for tests/fixtures/sql/raw-statement-corpus.json and apps/api/src/start-api.ts; NOT 015-C: the CODEOWNERS lines for /apps/api/src/modules/identity/ and /packages/config/ (+ REQUIRED_CODEOWNED_PATHS) are a separate devops PR before the first identity-module code PR and at the latest at Wave-0 exit (D-SEC-PR46-02), and PR42-SEC-18, PR46-SEC-11/12/15/16/17 are TASK-286 (D-ORCH-101)
- 015-C ADDITIONS (fold 9, D-ARCH-145; D-SEC-PR55-02, D-SEC-PR59-01, D-SEC-PR54-02/-03; the 015-C dispatch brief stays authoritative; DUE with 015-C and before the first release-candidate dispatch): (1) PR55-SEC-11 item 2 and PR59-SEC-02 — lane-c.yml and nightly.yml are held only to the PRELOAD_ENV deny-list, so these names still pass there (probes L1-L7 and L10 of the PR #59 record): GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_DIR, GIT_EXEC_PATH, GIT_ALTERNATE_OBJECT_DIRECTORIES, DOCKER_HOST, DOCKER_CONFIG and ACTIONS_ALLOW_UNSECURE_COMMANDS, plus whatever of PR55-SEC-11 item 2 is still missing from PRELOAD_ENV on main at dispatch (DOCKER_CONTEXT; verify GIT_CONFIG_COUNT, the GIT_CONFIG_KEY_ and GIT_CONFIG_VALUE_ prefix pattern and NPM_CONFIG_SCRIPT_SHELL in any letter case); PREFERRED fix: both workflows get exact workflow-env and job-env key sets as ci.yml has (an allow-list cannot miss a name); otherwise the names join PRELOAD_ENV; the probes become findings and the live lane-c.yml and nightly.yml stay at 0 findings; optional in the same edit (PR #59 code review R1-n2): an LD_ prefix rule with a short allow-list; this closes the remaining names scope of PR17-SEC-08 item 1; (2) PR54-SEC-04 CODEOWNERS (tests/fixtures/sql/raw-statement-corpus.json and apps/api/src/start-api.ts) is already on the fold-8 list above and was re-confirmed by rounds 2 and 3 of the PR #54 record — same owner, no new text; (3) NOTE: D-SEC-PR59-01 section 5 names the nightly check-audit of PR46-SEC-05 (fold-8 list) as the scheduled audit backstop once the 24 h proof-age rule has ended for stage-2 runs; (4) ORDER: a 015-C PR changes .github/workflows/**, so it merges after TASK-287 parts 287-A and 287-B (PR59-SEC-01) or under the record-names-head rule of D-ORCH-116
- 015-C ADDITIONS (plan fold D-SD-002; D-SECPR287C1-01; D-ORCH-137): PR287C1-SEC-02 (INFO, CWE-829, A08:2021) - action commits in lane-c.yml and nightly.yml are pinned by format only; 015-C adds ONE repository-wide action-commit table that check-workflow-policy applies to every workflow (ci.yml, lane-c.yml, nightly.yml), each commit checked against its upstream tag, with refusal tests for a foreign 40-hex commit in lane-c.yml and nightly.yml; until then the security record of a PR that changes a uses: line in those two files checks the commit against the upstream tag; the 287-C3 Dependabot procedure applies to the same table
- CODEOWNERS ADDITIONS (D-SD-004; due with 015-C, or earlier in a CODEOWNERS-only PR with a security record): (1) PR075-SEC-02 (c), D-SECPR075-01 ruling 3 - /packages/carriers/src/egress.ts and /packages/carriers/src/adapters/*/egress.ts, before TASK-135 merges; (2) PR64-SEC-09 as grown by D-SECPR039-01 - /apps/worker/src/platform/jobs/, apps/worker/src/platform/queues/{open-queue,job-handler,retention,runtime}.ts and packages/shared/src/queues/{scheduled-job,payload-v2}.ts; (3) PR61-SEC-04 (D-ORCH-135) - packages/shared/src/logging/string-redaction.ts and the paths listed there; REQUIRED_CODEOWNED_PATHS follows; (4) D-SECPR043-01 C4-1 and D-SECPR043-02 (PR64-SEC-09) - /apps/worker/src/platform/outbox/ and /packages/shared/src/events/ (the events line is due before TASK-049 merges, D-SECPR043-03; if this part has not merged by then, TASK-049 adds that line itself with a security record); (5) D-SECPR040-01 P-1 (PR64-SEC-09) - /apps/worker/src/platform/idempotency/, before TASK-040 part 040-B merges
- PR295-SEC-01 (LOW, CWE-1395; PR #79 code review m2 (b); D-SECPR295-01), part 015-C: a tools/ci unit test pins the premise of the root override (@prisma/config declares effect 3.20.0), the single effect tuple at the overridden version and the set of root override keys (code and the 5-mutant replay in the record), so a Prisma bump cannot silently force effect back; DUE before the next PR that changes the @prisma/config or prisma tuple, at the latest G3; the ADR-0002 item 7 note is principal-architect (code review m2 (a))
- LATENT TEST DEFECT (D-ORCH-148; S4): packages/config/src/load-config.test.ts:136 asserts that the rendered error does not contain abc, and the rendered error includes a stack path, so it fails in any worktree whose path holds that substring; carried by whichever of TASK-284, TASK-041 part 041-B and TASK-015 part 015-C first changes a test under packages/config, the others drop it: strip stack paths before the check or use a sentinel that cannot be a path substring
- AT-US-006-01 … AT-US-006-03: all 3 scenarios of US-006, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`jest.config.ts`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-016 — Row-level security foundations: table-class manifest, RLS renderer, platform helper functions, catalog tests, withTenantTx

| Field | Value |
|---|---|
| Stories (completes) | US-074 **DC** (M0 Must) RLS enabled and forced on every tenant-owned table, separate DB roles<br>US-075 **DC** (M0 Must) Per-transaction tenant context with SET LOCAL and fail-closed default |
| REQs | REQ-RLS-001, REQ-RLS-002, REQ-RLS-005, REQ-RLS-003, REQ-RLS-004 |
| NFRs | NFR-AVAIL-003, NFR-DATA-003, NFR-DATA-004, NFR-TENANT-001 |
| Spikes / security / decisions | SPK-03, SEC-P3-12, SEC-P3-34, D-ARCH-045, D-ARCH-046, D-ARCH-049, D-ARCH-058, D-ARCH-063, D-ARCH-064, D-ARCH-065, D-ARCH-066, PR7-SEC-11, PR7-SEC-13, PR7-SEC-14, PR8-SEC-10, PR8-SEC-13, PR8-SEC-14, PR11-SEC-01, PR11-SEC-02, PR11-SEC-03, PR11-SEC-04, PR11-SEC-05, PR11-SEC-07, PR11-SEC-08, PR11-SEC-09, PR11-SEC-11, D-ORCH-014, D-ARCH-071, D-ARCH-073, D-ARCH-074 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-008, TASK-003 |
| Batch · locks | 0.5 · prisma-rls, prisma-core, pkg-config, lint, api-tenant-db |
| Branch | `feat/TASK-016-row-level-security-foundations-table` |
| Priority | Must · demo-critical |

**Files / modules**
- tools/db/{table-classes/<module>.json (one manifest per module), render-rls.ts}
- prisma/sql/{policy-templates/*.sql, grants.manifest}
- prisma/migrations/<ts>_platform_rls_helpers/
- apps/api/src/platform/db/with-tenant-tx.ts (set_config ... true, fail-closed)
- prisma/tests/catalog/c01-c12.int.test.ts (also C13/C14 as amended: pg_default_acl, pg_database.datdba, pg_db_role_setting)
- tools/db/lint-migrations.ts + tools/db/fixtures/lint/** (rules 3-9, 11 and 14 of data-model §8.3 with one negative fixture per rule; D-ARCH-049)
- tools/db/bootstrap.ts readSecret hardening parity (ADR-0018 am. 6, D-ARCH-052): _FILE path lexically under /run/secrets (root injectable for tests), realpath confinement, regular file, <= 64 KiB, trailing newline stripped, empty = unset, exactly one of NAME / NAME_FILE set, errors name the variable only
- prisma/bootstrap/02-role-backstops.sql (ALTER ROLE platform_app SET statement_timeout = 30s; new NN-name file because applied bootstrap files are immutable; shadow-DB rendering includes it; ADR-0005 am. 10 item 12, D-ARCH-064)
- packages/config/src/schema.ts + .env.example: DB_TX_STATEMENT_TIMEOUT_MS (5000), DB_TX_LOCK_TIMEOUT_MS (2000), DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS (15000) read by the withTenantTx factory (data-model §4.1 eight-setting statement)
- apps/api/src/platform/db/{expect-affected.ts (expectAffected(result, 1) -> NOT_FOUND | CONFLICT), map-db-error.ts}
- eslint.config.mjs: set_config/app.* token ban outside with-tenant-tx.ts with exact-file test exemptions; no repository imports platform/db/client.ts; ALTER ROLE/ALTER USER banned in application code; prisma/tests/** import policy limited to tools-db, tools/test-support/**, db-platform and prisma-generated (replaces the tree-wide import-x/no-relative-packages off; PR #5 code review R3-n1)
- tools/db/fixtures/lint/** rule 15 and rule 16 fixtures (data-model §8.3 as amended 2026-11-12)
- tools/ci/check-migration-immutability.mjs — FALLBACK only if TASK-007 has merged without it (PR8-SEC-13)

**Acceptance tests to write**
- All US-074 and US-075 scenarios
- Catalog tests C1-C12 green on the migrated schema (every tenant table ENABLE + FORCE RLS; no BYPASSRLS on runtime roles)
- Unset context -> 0 rows; context never leaks across pooled connections (from SPK-03)
- C5/C11/C13 as amended 2026-11-12 (batch 0.2, D-ARCH-045/046): exactly three global `pg_default_acl` function rows (migrator, definer, audit owner) and no table/sequence/type/schema default-privilege row; a migrator-created probe function in `platform` and in `public` is not EXECUTE-able by PUBLIC or platform_app; `pg_database.datdba` is not the migrator and the migrator has no CREATE on the database; `pg_db_role_setting` has no database-wide row and the bootstrap role's `search_path=pg_catalog, pg_temp` row
- [SEC-TC-33] migration-lint rules 7, 8, 9, 12 and 14 (data-model §8.3): `DROP TRIGGER`, `DISABLE ROW LEVEL SECURITY` / `NO FORCE ROW LEVEL SECURITY`, `DISABLE TRIGGER`, `BYPASSRLS` / `SUPERUSER` / ownership to platform_app, `DELETE` grant outside the allow-list, any privilege on a partition, `DROP POLICY` without re-creation in the same file, a new table without its RLS block / allow-list entry (cross-checked with C1), and `CREATE SCHEMA` / `CREATE EXTENSION` / `ALTER DATABASE` / role DDL in prisma/migrations each fail the linter; one negative fixture per statement class; the `migration-lint` required suite (required-suites.json) activates with US-074
- [NT-AVAIL-003-a] migration-lint rules 3, 4, 5, 6 and 11: `RENAME`, `ADD COLUMN ... NOT NULL` without a constant default, `ALTER COLUMN ... TYPE`, `SET NOT NULL` without a preceding validated CHECK, `CREATE INDEX` without `CONCURRENTLY` on a table created by an earlier migration, `CREATE INDEX CONCURRENTLY` in a multi-statement file, FK/CHECK on an existing table without `NOT VALID`, and a migration altering an existing table without `SET lock_timeout` each fail; negative fixtures per rule. Rule 5 prerequisite: a one-statement `CREATE INDEX CONCURRENTLY` migration is run through `migrate deploy` in the Testcontainers harness to record how Prisma 7.10 submits it (data-model §8.3 rule 5 "verify in P5 spike"); the result is written into the fixture and prisma/README.md
- readSecret parity (D-ARCH-052): unit tests prove a _FILE path outside /run/secrets, a symlink leaving the root, a non-regular file, a file > 64 KiB and both NAME and NAME_FILE set are each refused with an error that names the variable and neither the path nor the value; a valid Compose secret file is read with its trailing newline stripped
- ADR-0005 am. 10 (SPK-03 F-01..F-10, D-ARCH-058): `TenantDb` omits `$transaction`, `$queryRawUnsafe` and `$executeRawUnsafe`; the factory sets `transactionOptions` explicitly (maxWait <= pool checkout budget, timeout >= statement_timeout) and maps P2028 to a retryable 503; P2010/42501 maps to 403 AUTHZ_DENIED + security event `rls_write_rejected` without echoing the PostgreSQL message; 55P03 maps to a retryable 503; `current_setting(..., true) = ''` is treated as NULL (catalog test); lint forbids `SET LOCAL`, `$executeRawUnsafe` and `$queryRawUnsafe` in platform/db and repositories and no repository imports the root client module; definer migrations GRANT/REVOKE before `OWNER TO platform_definer` (data-model §4.5 order)
- C-1 (SPK-03 §6, ADR-0005 am. 10 W-1 and item 13 as corrected 2026-11-12; PR #7 code review R2-m2; D-ARCH-063): the spike file `prisma/tests/spikes/spk03-rls-tx.int.test.ts` runs in the hosted `security-integration` job of this PR on ubuntu-latest **with `SPK03_BENCH=1`** so the uploaded `SPK03_REPORT` artifact carries `d_overhead_ms` (without the flag the (d) block is skipped and C-1 would be "done" with no measurement); the end-to-end per-transaction delta is recorded in SPK-03 §4 and ADR-0005 am. 10 (recorded, never asserted); **C-1 is due before G3**; the ported permanent suite asserts the server-side set_config p95 <= 1 ms **without** the flag (EXPLAIN ANALYZE, deterministic), reports the client-observed figure, and the spike file is deleted once ported
- ADR-0005 am. 10 item 4 as reworded (PR #7 code review R2-m1, PR7-SEC-12 b; D-ARCH-063): the ported session-scope negative control proves that `set_config(app.*, …, false)` by platform_app LEAKS to the next checkout on the same backend (poolMax 1, pid asserted at every step, RESET in finally) and that a later withTenantTx masks it only for its own transaction — it does NOT try to prove PostgreSQL denies the session-level form (USERSET placeholders cannot be denied); the deliberate session-level call has an exact-file lint exemption; C13 proves what is deniable: no app.% row in pg_db_role_setting or pg_parameter_acl
- ADR-0005 am. 10 item 12 as corrected (PR7-SEC-06, PR7-SEC-12 c, R2-n2 ii/iii; D-ARCH-064): new bootstrap file 02-role-backstops.sql sets `ALTER ROLE platform_app SET statement_timeout = 30s` (role-level backstop for statements outside withTenantTx; 00-roles.sql sets none today) with a C13 row and the readiness expected-set constant extended; the context statement is the data-model §4.1 EIGHT-setting statement (four app.* keys, app.correlation_id, statement_timeout, lock_timeout, idle_in_transaction_session_timeout) with values from DB_TX_STATEMENT_TIMEOUT_MS / DB_TX_LOCK_TIMEOUT_MS / DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS (added to packages/config with .env.example parity); integration test: after `ALTER ROLE platform_app RESET lock_timeout` as the role itself, withTenantTx still shows lock_timeout = 2s and the readiness probe reports drift
- ADR-0005 am. 10 item 1 as corrected (PR7-SEC-11; D-ARCH-065) + data-model §8.3 rule 16: the pg_proc.prosrc scan is BY FORM across every non-system schema (public, platform and any later schema): no body contains `set_config(` with an app. key, `SET`/`SET SESSION`/`SET LOCAL` followed by `app.`, `RESET app.`/`RESET ALL` or `DISCARD`; a read of the four security keys via current_setting( appears only in the §4.2 helpers matched by regprocedure; reads of app.correlation_id stay allowed; the migration linter applies the same rule to prisma/migrations/** (rule 16); three negative fixtures (a platform function calling set_config(app.org_id, …, true); a public function running SET app.org_id = …; a non-helper reading current_setting(app.org_id, true)) each fail C-series and the linter; the current catalogue passes; rule 15 (GRANT/REVOKE after OWNER TO platform_definer fails; SECURITY DEFINER outside a SET ROLE platform_definer block flagged) ships with its four fixtures
- ADR-0005 am. 10 item 15 (PR7-SEC-13; D-ARCH-066): the ported F-02 text reads "INSERT: 42501; UPDATE/DELETE: 0 rows silently"; helper `expectAffected(result, 1)` in apps/api/src/platform/db throws NOT_FOUND on 0 rows and CONFLICT on > 1; a unit test shows 0 affected rows -> error; ESLint flags updateMany/deleteMany results in repositories not passed to the helper (warning until the first module, then error)
- ADR-0005 am. 10 item 16 (PR7-SEC-14; D-ARCH-066): the context statement reads the prior values of the four security keys in a MATERIALIZED CTE in the same round trip ($queryRaw, no extra round trip); any prior value other than NULL or empty string throws DB_SESSION_CONTEXT_LEAK before fn runs (non-retryable 500, PostgreSQL text never echoed), emits security event db_session_context_leak, increments a counter and marks the process not-ready until restart; the ported negative control asserts the detector fires after set_config(app.org_id, A, false) and that NULL and empty prior values pass
- PR8-SEC-10 (D-ARCH-069): permissions, roles and role_permissions are registered as GLOBAL in tools/db/table-classes/authz.json (C1 allow-list entry — never RLS without policies) and prisma/sql/grants.manifest carries their SELECT-only platform_app grant (C5 equality)
- PR8-SEC-14 (D-ARCH-069): the C-series port of the escalation backstop keys on the KEY RULE (`p.key ~ (^|:)any_org(:|$) OR p.key LIKE audit:% OR p.key IN (featureflag:manage, carrier:status:read)`), not on the operator_only column, asserts zero non-OPERATOR role links to such keys and zero links to webhook:% keys, and carries a planted-row control: inside BEGIN … ROLLBACK as the migrator, linking CUSTOMER_VIEWER to audit:read makes the query return exactly 1 row
- PR8-SEC-13 fallback (D-ARCH-069): if `tools/ci/check-migration-immutability.mjs` is not on main when this task starts (TASK-007 is the preferred owner), this task ships it as a lane A step run from the base ref — `git diff --name-status --no-renames <base>...HEAD -- prisma/migrations` must list A entries only (migration_lock.toml allow-listed) — with a negative fixture that modifies an existing migration.sql and a positive one that only adds a directory
- PR #5 code review R3-n1: prisma/tests/** may import only tools-db, tools/test-support/**, db-platform and prisma-generated (boundaries policy with a negative fixture importing packages/*/src); the tree-wide `import-x/no-relative-packages: off` is removed
- ADR-0005 am. 10 items 1, 2, 4, 6, 7, 9, 11, 12 (PR #7 security review §4a, PR7-SEC-01/02/03/05/06/07/09): run-time `TenantDb` Proxy (not only `Omit`), AsyncLocalStorage re-entrance guard throwing NESTED_TENANT_TX (AT-US-075-04 as a run-time throw), SYSTEM-table writers typed on TenantDb, `set_config`/`app.*` token ban outside with-tenant-tx.ts + `pg_proc.prosrc` scan, literal `true` and validated-string-only binding, factory refuses PGOPTIONS, fresh-connection NULL probe and session-scope negative control, `mapDbError` keyed on `driverAdapterError.cause.originalCode` with retryable 40001/40P01/57014/55P03/P2028, RLS renderer predicate allow-list + C3 forbidden-token scan, C13 no `app.%` in pg_db_role_setting/pg_parameter_acl and platform_app role-setting rows, per-transaction lock_timeout/statement_timeout/idle_in_transaction_session_timeout from configuration, GUEST_CAPABLE no-de-claim trigger template (TASK-051 ships the trigger), definer functions under SET ROLE platform_definer and linter rule 15 (mandatory)
- D-ORCH-014 RECONCILIATION + PR11-SEC-09 items 1-6 as MERGE CONDITIONS (PR #11 merges after PR #9; PR #11 code review §7 (a)-(f); D-ARCH-074): (1) one composition function in `apps/api/src/platform/db/runtime.ts` (db-platform-core) is the only importer of `client.ts`; it builds pool, client, runner and session-integrity guard and exports only the runner and the health checks; `platform/runtime/**` and `platform/health/*.int.test.ts` import it, never `client.ts` (no `db-root-client` carve-out; the `index.ts` comment matches); the worker uses the same function; (2) `deps.env` is omitted so `process.env` is checked and is never `{}`; a test proves the PGOPTIONS refusal through the composition function (PR9-SEC-03 factory half); (3) `probeFreshConnection()` runs as the FIRST query at start-up — before any other pool traffic, or on a dedicated pg.Client — and before readiness turns ready; a failure means not-ready / exit 78; (4) sinks: `onSecurityEvent` goes to the TASK-010 security logger with `{event, correlationId, sqlState}` only, the leak counter becomes a metric, and `markNotReady(db_session_context_leak)` LATCHES — the 5-minute re-check never clears it; (5) `EXPECTED_ROLE_SETTINGS` gains `statement_timeout=30s` (and `lc_messages=C`, below) and the PR #9 pin test parses EVERY `prisma/bootstrap/*.sql`; the lock_timeout-RESET integration test asserts the readiness probe reports `db_role_setting_drift`; (6) problem+json for a `DbError` carries `status`, the catalogue `code`, `Retry-After` from `retryAfterSeconds` and generic text — never `message`, `reason`, `sqlState` or `prismaCode` (log-only); plus (e) the tenant-context-ban hits in `session-integrity.int.test.ts` / `problem-handler.api.test.ts` are resolved without inline disables and (f) `.env.example` and `packages/config/src/{index,schema}.ts` are union-merged with the parity tests re-run
- PR #11 fix-cycle items (code review M1/m1/m2/m5 merge conditions; security review PR11-SEC-01/02/04/05/08 recommended here): deep deny-by-default `TenantDb` Proxy — blocks `$parent`, `constructor` and symbol keys, wraps model delegates in the same guard, hides blocked keys from ownKeys/getOwnPropertyDescriptor, tested on the REAL Prisma 7.10.1 interactive-transaction client shape with a recording adapter (no statement on a non-transaction connection between begin and commit); one KEY/WRITE_FORMS pattern list shared by `prisma/tests/catalog/scans.ts` and rule 16 covering concatenated keys, quoted function and GUC names, `format(%I)`, spaced `app . org_id` and dynamic `current_setting(k)` — every row of the PR11-SEC-02 table is an executed C-series fixture (proves validity and coverage) and a linter fixture; C5 renders `grantee = 0` as PUBLIC so any PUBLIC table/column grant fails against the manifest (planted `GRANT TRUNCATE ON public.permissions TO PUBLIC`), and rule 8 flags `TO PUBLIC` and `TRUNCATE`/`TRIGGER`/`REFERENCES` grants; `db-raw-sql` bans `Prisma.raw(` and `$parent`, runs on every `apps/*/src/**` file plus PLANNED_PRISMA_FILES minus tests, and the boundaries policy allows `pg`/`pg-pool` value imports only under `apps/*/src/platform/db/**`, prisma, tools/db and tests (PR2-SEC-05 addendum; negative fixtures for a repository, `packages/audit/src/store/prisma-store.ts` and a `repository/tests/helper.ts`); exemptions are exact files (`prisma/tests/catalog/{c01-c12.int.test.ts,scans.ts}` replace the folder glob) and the `tokens` form is split into `keys` and `setter` with `session-integrity.*` holding `keys` only
- REQUIRED BY THE ARCHITECTURE BEFORE MERGE (D-ARCH-071, D-ARCH-073; PR11-SEC-07, PR11-SEC-03 item 1, PR11-SEC-11 a/b/h; data-model §4.1/§4.2/§8.3 as amended 2026-11-13): rule 11 accepts the SESSION form only — `SET LOCAL lock_timeout` fails (outside a transaction block it is a warning-only no-op; fixture `set-local-lock-timeout`) and a file that raises lock_timeout above the migrator role default (3s) ends with `RESET lock_timeout`; rule 15 accepts ONLY the `SET ROLE platform_definer; … RESET ROLE;` block — the `handedOver` branch is removed, `ALTER FUNCTION … OWNER TO platform_definer` in prisma/migrations fails, a file whose last statement leaves the definer role set fails (fixture `definer-grants-before-owner-to` now FAILS, new fixture `definer-role-not-reset` fails, `definer-set-role-block` stays clean); rule 9 requires a `GRANT … TO platform_app` on an RLS-class table to come AFTER that table ENABLE + FORCE and its policies in the same file (fixture `grant-before-force`); rule 16 exempts exactly the normalised operator atom `current_setting('app.actor_scope', true) = 'OPERATOR'` and only inside a `CREATE POLICY` statement, so the rendered TENANT block lints clean while `policy-tautology` / `policy-unkeyed` fixtures still fail (required before the first CREATE POLICY migration, TASK-037); the UNMERGED helpers migration `20261112020000_platform_rls_helpers` adopts the qualified bodies of data-model §4.2 (`pg_catalog.current_setting`, `OPERATOR(pg_catalog.~*)`, `OPERATOR(pg_catalog.~)`, `pg_catalog.decode`, `::pg_catalog.uuid`) — doing it before merge avoids an immutable-migration follow-up; the UNMERGED `02-role-backstops.sql` adds `ALTER ROLE platform_app SET lc_messages = 'C'` so `mapDbError` reads English server text on any locale (C13 expects five platform_app rows; `EXPECTED_ROLE_SETTINGS` gains the row; fallback owner TASK-021 as a new `03-role-locale.sql`); C13 compares `lower(…) LIKE 'app.%'` on `pg_db_role_setting` and `pg_parameter_acl` and asserts no `pg_proc.proconfig` entry `ILIKE 'app.%'` in any non-system schema
- DEFERRED WITH OWNERS (code review m4/m6, security review §6; D-ARCH-074) — the catalog suite header names every deferral: C6/C7 (manifest flag `immutable`)/C14 remainder → TASK-021; C8/C9 → implement here if cheap (committed authz tables are the first subjects), otherwise TASK-024; C10 → TASK-028; PR11-SEC-03 items 2-3 (rule 9 renderer equality, C3 derived expected set + keyed-atom presence), PR11-SEC-06 (C11 converse ownership set), PR11-SEC-11 e/g, rule 17 and the §8.4 prefix-reversibility check → TASK-024; T-83 lint → TASK-020; rule 10 DO-body scan (PR #5 R2-m2) and the `U&` identifier decode (PR #5 R2-n1) → fix here or TASK-021; readSecret open-once/fstat hardening (PR11-SEC-11 d) → fix here or TASK-034; `onDbError` redacting hook → TASK-010
- AT-US-074-01 … AT-US-074-05: all 5 scenarios of US-074, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-075-01 … AT-US-075-04: all 4 scenarios of US-075, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Security-critical path (prisma/**, apps/api/src/platform/**): security-integration job
- Linter rules 3-9, 11 and 14 are the TASK-016 half of the migration-lint suite (D-ARCH-049); rules 1, 2, 10, 12, 13 and the contract-reversibility check came with TASK-003 and stay green
- Merge order D-ORCH-014: this PR merges after PR #9 (TASK-006) and PR #10 (TASK-007) and is the reconciler; the orchestrator re-runs the gates on the final head incl. integration (Docker) and confirms a lane A check rollup on that exact SHA (code review §7 item 4)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`, `prisma/**`, `apps/api/src/platform/**`, `tools/test-support/**`, `tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-017 — Contract-first OpenAPI pipeline: Redocly lint, generated types + drift check, response validation helper, Swagger UI

| Field | Value |
|---|---|
| Stories (completes) | US-034 **DC** (M0 Must) Contract-first OpenAPI 3.1 with CI cross-check and response validation<br>US-035 (M0 Should) API docs UI, generated client, deprecation headers and ApiMode seam |
| REQs | REQ-API-001, REQ-API-002, REQ-API-004, REQ-API-003, REQ-API-015, REQ-API-019, REQ-API-020 |
| NFRs | NFR-MAINT-004, NFR-QUAL-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-006 |
| Batch · locks | 0.5 · api-openapi, shared-api-types |
| Branch | `feat/TASK-017-contract-first-openapi-pipeline-redocly` |
| Priority | Must · demo-critical |

> Scheduling note: US-035 (M0 Should) pulled into Wave 0: Swagger UI is used by the M0 demo and generated types are needed by every frontend task (D-PLAN-004).

**Files / modules**
- redocly.yaml
- packages/shared/src/api/types.gen.ts (generated) + tools/openapi/drift.test.ts
- apps/api/src/platform/openapi/{serve.ts (Swagger UI /api/docs, config-gated), response-validator.ts (Ajv 8)}
- tests/api/helpers/expect-contract.ts
- tests/contract-stubs/ (request handlers generated from openapi.yaml examples so frontend tasks can start before their API task merges; tool choice and licence justified in the task report)

**Acceptance tests to write**
- All US-034 scenarios (lint, drift, response validation)
- All US-035 scenarios (docs UI gated by config, generated client fails CI when stale, Deprecation/Sunset contract test, ApiMode test|live seam)
- AT-US-034-01 … AT-US-034-05: all 5 scenarios of US-034, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-035-01 … AT-US-035-06: all 6 scenarios of US-035, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-018 — SPK-04 spike: audit write throughput micro-benchmark (300 rps mixed, audit on/off)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-AUDIT-005, NFR-PERF-001 |
| Spikes / security / decisions | SPK-04, R-ARCH-04 |
| Specialist · model | performance-engineer · opus |
| Complexity | S |
| Depends on | TASK-012, TASK-016 |
| Batch · locks | 0.6 · spike-04 |
| Branch | `feat/TASK-018-spk-04-spike-audit-write` |
| Priority | Enabler |

**Files / modules**
- tests/load/spikes/spk04-audit.js (k6) + SQL fixtures
- docs/04-plan/spikes/SPK-04.md

**Acceptance tests to write**
- Re-baseline the reference host (A-029) and write host-spec.json (TEST-STRATEGY §7.10)
- SPK-04 exit: delta p95 <= 15 ms with per-stream advisory lock + vault inserts on partitions at 300 rps; otherwise the multi-row vault insert fallback is specified for the chain task
- RESULT AND MERGE RULING (PR #27 @aa1cfb1; D-ORCH-031, D-ARCH-085, D-ARCH-089; rulings/wave-0-spk04-rulings.md): FALLBACK — the 300 rps exit is not met on the shared host (hot-tenant lock queueing, waiters draining the pool for every tenant; INCONCLUSIVE under TEST-STRATEGY §7.10 but structural), 150 rps passes, integrity held; ADR-0007 am. 10 specifies the FALLBACK for TASK-030. The harness MERGES as executable evidence under prisma/tests/spikes/spk04/** and tests/load/spikes/** ONLY (SPK-03 PR #7 m7 / SPK-08 §8.1 precedent) with the SPK-04 §8 lifecycle table naming the deleting PR per file: chain.ts, canonical.ts and their tests -> TASK-030 (after porting the pinned chain vector); server.ts, runner.ts, verdict.ts, fixtures/** and the k6 script -> TASK-280 (after porting the arm loop, CPU sampler, verdict and evidence writer to tests/load/lib and the script to tests/load/audit-ab.js). Reviewer-applicable conditions: no file under apps/** or packages/** imports from either tree (boundaries); neither tree counts toward coverage nor ships in any image; the SPK04_AUDIT runtime switch stays harness-only (ADR-0007 am. 4, no runtime audit-off in product code); the eslint k6 block stays (TASK-280 needs it); evidence stays under docs/05-quality/performance/spikes/SPK-04/ (not runs/)

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-019 — SPK-05 spike: S3-compatible storage adapter contract against RustFS (put, presign, get, head, versioning)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-006) | US-012 **DC** (M0 Must) Liveness and readiness endpoints |
| REQs | REQ-PLAT-018 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SPK-05, R-ARCH-05, D-TASK006-02, D-ARCH-074 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-003, TASK-006 |
| Batch · locks | 0.6 · api-storage |
| Branch | `feat/TASK-019-spk-05-spike-s3-compatible` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/storage/{object-storage.port.ts, s3-object-storage.ts}
- apps/api/src/platform/storage/object-storage.contract.int.test.ts (RustFS pinned tag; SeaweedFS fallback)
- apps/api/src/platform/health/checks/object-storage.ts (replaces the ok-stub)
- docs/04-plan/spikes/SPK-05.md

**Acceptance tests to write**
- SPK-05 exit: contract test green on RustFS (presigned GET <= 300 s, versioning, HEAD metadata, path-style) — or switch to SeaweedFS and request an ADR-0021 amendment
- PR #9 code review m2 / D-TASK006-02 (D-ARCH-074): the production S3 adapter replaces the `object_storage` readiness ok-stub in `platform/health` with a real check — `HeadBucket` on the configured bucket with a 2 s timeout, `unavailable` on failure, never the endpoint or a credential in the response or the log line; AT-US-012-02-object-storage runs against RustFS in the integration project (not a fake); the tripwire test that enforces stub replacement is deleted in the same commit; US-012 traceability stays partial until this and the TASK-021 audit readiness checks land
- Covers the scenarios of AT-US-012-01 … AT-US-012-05 that belong to its layer; US-012 closes in TASK-006

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-020 — Mandatory route metadata (defineRoute) with build-time route test and request-pipeline order skeleton

| Field | Value |
|---|---|
| Stories (completes) | US-067 **DC** (M0 Must) Mandatory route metadata with build-time route test |
| REQs | REQ-RBAC-005 |
| NFRs | NFR-AUDIT-004, NFR-MAINT-004 |
| Spikes / security / decisions | PR11-SEC-17, D-ARCH-079, PR8-SEC-05, D-ARCH-069, T-83, PR2-SEC-05, PR11-SEC-05, PR11-SEC-09, D-ARCH-074, D-ORCH-023, D-ORCH-024, D-ORCH-025, D-ORCH-026, PR21-SEC-01, PR21-SEC-06, PR21-SEC-07, PR21-SEC-08, PR21-SEC-09, PR20-SEC-12, PR20-SEC-13, PR20-SEC-16, PR19-SEC-01, D-ARCH-080, D-ARCH-084, D-TASK020-05, D-ARCH-102, D-ARCH-103, D-ARCH-104, D-ARCH-105, D-ARCH-106, D-ARCH-107, D-ARCH-108, PR32-SEC-01, PR32-SEC-02, PR32-SEC-09, D-ARCH-109, D-ARCH-110, D-ARCH-111, PR32-SEC-12, PR32-SEC-14, PR32-SEC-16, PR38-SEC-02, PR38-SEC-03, PR38-SEC-04, D-SEC-PR38-01, D-SEC-PR38-02, D-ARCH-113, D-ARCH-114, PR32-SEC-07, D-SEC-PR43-03, D-ARCH-124, D-SEC-PR54-01, D-ORCH-105, D-ARCH-131 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-013, TASK-017, TASK-006 |
| Batch · locks | 0.6 · api-routing, pkg-authz, lint, prisma-core |
| Branch | `feat/TASK-020-mandatory-route-metadata-build-time` |
| Priority | Must · demo-critical |

**Files / modules**
- tools/eslint-rules/no-external-calls-in-tenant-tx.mjs + eslint.config.mjs entry + negative fixtures (T-83)
- apps/api/src/platform/routing/{define-route.ts, pipeline.ts, route-registry.ts}
- packages/shared/src/audit/descriptor.ts (types only)
- tests/generated/route-metadata.test.ts (every route has permission + audit descriptor + validation schema; count = OpenAPI operations)
- pipeline slots wired to stub implementations (authn, mfa, authz, rate-limit, validate, idempotency, etag, tx, audit), each in its own platform/<slot>/ folder — later tasks replace only their slot folder (contract stubs)
- packages/authz/src/routes.ts (DeclaredRoute gains tenancy + auth; findRouteBindingViolations(routes, { production }))
- packages/authz/src/guard.ts + permissions/index.ts (SUB_RESOURCES middle-segment allow-list in checkKeyShape; Compliance Auditor rule = read ∪ {audit:export} ∪ selfService) — no grant change, so `npm run authz:generate -- --check` stays green and no seed v2
- PART 020-B (second PR of this task; branch feat/TASK-020-b-prisma-client-package from main after PR #32 merges; D-ARCH-102..105): prisma/client/tsconfig.json (composite project over prisma/generated/prisma), prisma/package.json (exports ./client; scripts build and typegen), prisma/schema/_base.prisma (pinned generator options), tools/db/check-prisma-client.mjs (presence and freshness, never generates), root package.json (db:generate), apps/api/package.json and tsconfig.json (dependency and project reference), tools/tsconfig.json (drop the generated include, add the reference and platform/db/generated.ts to files), apps/api/src/platform/db/{generated.ts, runtime.ts, index.ts} and apps/api/src/platform/runtime/{services.ts, index.ts}, eslint.config.mjs (value or type policy and the db-root-client pattern) with negative fixtures, .github/CODEOWNERS, prisma/README.md

**Acceptance tests to write**
- All US-067 scenarios
- Route count equals OpenAPI operation count for implemented operations; missing metadata fails the build
- PR8-SEC-05 (a)-(d) MERGE CONDITION (ADR-0008 am. 3 item 3, D-ARCH-069): `findRouteBindingViolations` over the mounted routes asserts (a) a selfService permission guards only `tenancy: user` routes, (b) `tenancy: operator-cross-tenant` requires an operator-only permission and an `:any_org` permission requires that tenancy, (c) a signatureOnly permission is satisfied only by `auth: signature` (never public or a session) and is never a route marker, (d) no route carries `webhook:mock_gateway:receive` when APP_ENV = production; the route-registry test runs it with one negative fixture per rule
- PR #8 code review R2-m1 (ADR-0008 am. 3 item 2): `SUB_RESOURCES = [member, status]` plus the webhook providers (stripe, mock_gateway) is the closed set of legitimate middle segments; `checkKeyShape` rejects a three-segment key whose qualifier is not a scope qualifier unless its middle segment is a declared sub-resource (PERMISSION_FORMAT); mutated-catalogue tests P3 (`shipment:void:read` granted to the Viewer) and P3b (`shipment:purge:read` granted to the Auditor) each report a violation
- PR #8 code review R2-n1 (ADR-0008 am. 3 item 1): `readOnlyViolations` allows the Compliance Auditor only verb `read`, exactly `audit:export`, or selfService — mutated-catalogue test P4 (`audit:purge` granted to the Auditor) reports AUDITOR_NOT_READ_ONLY; the shipped matrix is unchanged (0 violations)
- T-83 lint (threat-model T-83 "no external calls inside withTenantTx"; PR2-SEC-05 addendum, PR11-SEC-05 item 5; D-ARCH-074 — this task owns it because the `tx` pipeline slot is the only per-request withTenantTx entry and wave-1 modules are the first possible violators): ESLint rule `platform/no-external-calls-in-tenant-tx` reports, lexically inside the callback passed to `withTenantTx(` / `.withTenantTx(` (nested closures in the same file included), any call to global `fetch`, any call on a binding imported from `undici`, `node:http`, `node:https`, `bullmq`, `ioredis`, `@aws-sdk/*`, `stripe` or `nodemailer`, any member call on an identifier in a configurable name list (`outboundHttp`, `httpClient`, `queue`, `queues`, `redis`, `valkey`, `storage`, `mailer`), and `setTimeout`-based sleeps; one negative fixture per source; TASK-113 extends the list with the OutboundHttpClient member names; cross-file calls (a service method that performs I/O) remain a review item and may get a Semgrep twin in `.semgrep/`
- PR11-SEC-09 verification at the first withTenantTx consumer (the `tx` slot; D-ORCH-014, D-ARCH-074): the slot obtains the runner only from `apps/api/src/platform/db/runtime.ts` (never `client.ts`; boundaries fixture), and the route test proves a `DbError` surfaces as problem+json with `status`, the catalogue `code`, `Retry-After` for retryable codes and generic text — never `message`, `reason`, `sqlState` or `prismaCode`
- PR #11 code review R3-m1 (iii) + PR #11 security review R3.6 (D-ARCH-079) — RUNNER ACTIVATION (part 020-B, D-ARCH-104; no class is injected from main.ts): databaseRuntimeFromConfig builds the client from apps/api/src/platform/db/generated.ts, so createRuntimeServices hands the runner to BOTH apps/api and apps/worker from the one composition (never a second composition), keep startup() awaited before listen and before the worker takes work, assert tenantTx !== undefined at boot (boot test), and only then verify PR11-SEC-09 items 3-4 at the tx slot; R3-n6: AUTHZ_DENIED and CONFLICT already live in packages/shared/src/errors/catalogue/platform.ts — this task (authz denials) and TASK-036 (owner of platform.ts) must not redeclare them in a module catalogue, and DbProblemCode becomes Extract<ErrorCode, ...> (or a satisfies check) so a catalogue change is a compile error
- PR11-SEC-17 a/b (INFO; lint lock held here) + PR #11 R3-n2/R3-n4: isSqlFragment tests `strings in v && values in v` (not Array.isArray) and walks the whole prototype chain for a Sql/_Sql constructor — or uses instanceof against the Sql class of @prisma/client/runtime/client, the class Prisma itself checks — and states the limit in the JSDoc (a forge through an intermediate prototype with its own constructor passed before); the db-raw-sql binding analysis reports any other use of a tracked container (argument position, object/array literal, ?: or ??, `new (Prisma.sql.constructor)(...)`, an aliased or Reflect.apply $queryRaw, `db[k]`) and any read of $queryRaw/$executeRaw that is not a template tag; the TypeScript twin tenant-context-sql.mjs gains the U& write form (`/\bu&["']/i`) and strips block and line comments before matching, both in the drift corpus with WRITE[5] pinned; TenantDb either maps delegate return types to PromiseLike (fluent relation accessors are not exposed) or the guarded result throws TenantDbAccessError("fluent accessors are not exposed; use include/select") for any key other than then; R3-n3 (set_config of lock_timeout under rule 11) is owned by TASK-024 with PR11-SEC-17 c, not here
- PR #21 code review R1-m5 remainder (D-ORCH-023 (1); api/README §16; D-ARCH-084): (a) raw supertest ban — an ESLint restriction allows an import of supertest only under tests/api/helpers/** (negative fixture: a tests/api spec importing supertest directly fails; the existing direct importers — serve.api.test.ts, problem-handler.api.test.ts, runtime-seams.api.test.ts, health/router.test.ts, health.int.test.ts and the helper itself — are migrated to the helper or allow-listed one by one with a reason; api/README §16 names tests/api/helpers as the only allowed location); (b) the §16.6 `(operationId, status)` contract-coverage report — the response validator records every validated pair and the api lane prints the operations and documented statuses never exercised, as a report (not a gate) until qa-lead ratchets it
- PR21-SEC-06 remainder + PR21-SEC-01 step 5 + D-ORCH-024 (5) (D-ARCH-084): api/README §15 assertion 2 is implemented (`x-permission` equals route.permission; the value is in the packages/authz catalogue or is public/authenticated with a justification); the drift walk runs over the composed createApp(...) with the explicit exclusions only; the pipeline SLOT for the step-0 per-IP limiter (ADR-0016 am. 1; the limiter itself is TASK-041) and for the CORS preflight handler (TASK-048) sits BEFORE `routes`, hence before optionsResponder and the /api/docs mount, and is mounted PATH-LESS — a limiter or CORS mounted under a path fails drift by design and the walker is never widened to skip path-mounted middleware (`routePrefix` stays the first layer inside the `api` router per the PR #20 union, D-ORCH-024 (3)); no route-level router.options() handler exists (the responder pre-empts it); the pipeline-order test asserts the limiter slot precedes the /api/docs mount; the excluded /api/docs mount answers only GET and HEAD (and OPTIONS 204 with Allow: GET, HEAD, OPTIONS) on the allow-listed docs paths and 405/404 otherwise (`allowedMethods` assertion over the composed app — this pins the PR #21 N5 closure, so the STATUS item "OPTIONS /api/docs default 200 text/plain" needs no further code)
- D-TASK017-01 drift-walker residuals (D-ORCH-026; PR #21 code review R3-m1, R3-n1, R3-n2, R2-n1 and PR21-SEC-09; D-ARCH-084; MUST LAND BEFORE the route-metadata test of this task relies on the walker): R3-m1 — a resolved layer whose matcher yields non-empty `params` for the literal candidate is rejected (catches RegExp mounts with alternation, which today resolve as the literal and hide the extra paths) and/or a lint rule bans RegExp use() paths in app.ts, and the tools/openapi README item is corrected to "RegExp route paths" (mounts are not covered by inspection); R3-n2 — a path-less sub-app on a Router is duck-typed (handle.handle and handle.set are functions) next to the SUB_APP_HANDLER test; R3-n1 — mountShapes gains a leading-parameter mount (`/:tenant/v1`, optionally `/:tenant/docs`) so the substitution probe (kept; it is the only guard for leading parameters) is pinned by a test; R2-n1 / PR21-SEC-09 — the import-x/no-relative-packages ignore for tests/api/**/*.api.test.ts is anchored so that any `..` segment after apps/api/src/ is rejected (the verified R2-n1 negative-lookahead form) and a third REPO_PROBES case with the traversal form expects the rule
- PR21-SEC-08 (INFO; D-ARCH-084): the `$ref` guard tests discriminate — the http test points at the never-resolving host http://schema.example.invalid/schema.yaml and asserts that the rejection says "Unable to resolve $ref pointer" rather than "Error downloading" (or spies on the dereference options), and the "references nothing outside itself" test collects $ref values from the PARSED YAML (every object key equal to $ref, so quoted keys count) and asserts each starts with #/ — after which openapi-typescript and Redocly need no resolver change; mutants: dropping DEREFERENCE_OPTIONS fails the first test, a seeded quoted-key http $ref fails the second
- D-TASK017-01 (6) / PR #21 code review R1 item 2 (D-ARCH-084): tools/openapi/api-mounts.ts stops loading apps/api by file URL (TS6307) — the composition root is reached through TypeScript project references so boundaries lint sees the dependency; R1-m2 (re-stated composition) closes with it
- PR20-SEC-12 / PR #20 L-13 Joi messages + PR20-SEC-13 item 4 (D-ORCH-025 (2); D-ARCH-084): defineRoute validation uses Joi custom messages without `{#value}` for every schema (a test walks the mounted schemas and asserts no message template interpolates the value) and a Joi ValidationError reaches the problem body as { pointer, code } only; two lint rules (or .semgrep/ twins) with fixtures: (a) `.message` of a catch binding inside a template literal; (b) JSON.stringify, util.inspect, String() or a template literal applied to req, res, request, response, rawHeaders or rawTrailers inside a logger call argument
- PR20-SEC-16 / PR #20 code review R2-m1 FALLBACK (D-ARCH-084; applies only if PR #20 merged without it): boundaries policy — packages/shared files that are neither shared-logging nor test may not import the shared-logging layer or pino (negative fixture: packages/shared/src/index.ts re-exporting a logging file; positive control: a logging file importing ../correlation), plus a test that the root @platform/shared module graph imports no pino; TASK-022 adds the bundle assertion
- PR #20 code review n6 and R2.5 4(i) (D-ARCH-084): defineRoute sets res.locals.routeTemplate (mount prefix + full template, nested mounts included) for every route so the access line and the metrics label carry the template, never the leaf pattern or a raw path; the docs router gets routePrefix(DOCS_PATH) as its first layer so docs lines read /api/docs/<leaf>; OPTIONS 204 lines carry the matched template
- PR19-SEC-01 MECHANISM (INFO; PR #19 security review; data-model §1.5 as amended 2026-11-13; D-ARCH-080; lands here because the `tx` slot is the TenantDb hand-out point and this task holds the lint lock — due before TASK-040 idem, the first writable SYSTEM model): SYSTEM-class models (table-class manifests, class SYSTEM) are EXCLUDED from the top-level TenantDb delegate set at type level (the TenantDb type omits them) and at run time (the guarded proxy throws TenantDbAccessError naming the port); they are reachable only through systemDelegates(tx) exported from apps/api/src/platform/db/system-db.ts (worker twin under apps/worker/src/platform/db/), whose importers are restricted by a manifest-driven ESLint rule `platform/system-model-owner` to the owning module of the manifest that declares the table (platform/outbox for outbox_events, platform/idempotency for idempotency_keys, modules/identity for login_attempt_counters, the worker platform for job_context and processed_events, the payments webhook module for gateway_webhook_events); one negative fixture (a module repository touching the outbox delegate outside the allow-list fails lint) and a prisma/tests/rls test that referenceDatasetVersion is absent from TenantDb while systemDelegates(tx) reaches it inside the same transaction; GLOBAL catalogue delegates stay in TenantDb (read-only by grant)
- ESLINT BOUNDARY FOR THE S3 SDK (PR30-SEC-08 (e), PR #30 code review R1-m7; D-ARCH-097; this task holds the lint lock in its batch): eslint.config.mjs gains a no-restricted-imports entry that denies @aws-sdk/*, @smithy/signature-v4 and aws-sdk outside apps/api/src/platform/storage/**, with a negative fixture, so that the boundary unit test of PR #30 becomes a second control instead of the only one; the entry is an owned-path change and needs the security record of this PR
- PART 020-B GENERATED CLIENT PACKAGE (D-ARCH-102; data-model 7.2 amendment 2026-11-13; closes D-TASK020-05; DUE before batch 0.7 is dispatched, hard stop: merged before TASK-024 merges and before TASK-025, TASK-026 and TASK-040 start): (a) prisma/schema/_base.prisma pins runtime nodejs, moduleFormat esm, generatedFileExtension ts and importFileExtension js, and a unit test parses the generator block (the four keys, output ../generated/prisma, provider prisma-client); (b) prisma/client/tsconfig.json (composite, no references, rootDir ../generated/prisma, outDir ../dist/client, sourceMap and declarationMap off) is referenced by apps/api and tools and is NOT added to the root tsconfig.json, so tools/repo/root-scripts.test.ts AT-US-001-04 stays green unchanged; tools/tsconfig.json drops ../prisma/generated/**/*.ts from include and lists apps/api/src/platform/db/generated.ts in files (TS6307 otherwise); (c) prisma/package.json exports exactly ./client with the conditions @platform/source, types, default in that order, scripts build = tsc -b client and typegen = tools/db/check-prisma-client.mjs (fails with the text run npm run db:generate when prisma/generated is missing or older than prisma/schema, never generates; unit test with fixtures); the root package.json gains db:generate = node tools/deps/prisma-cli.mjs generate (the only generator entry besides deps:rebuild); apps/api declares @platform/prisma and apps/worker does not; package-lock.json changes only by the workspace link; (d) three resolution modes proven: tsc -b of apps/api, apps/worker, prisma, tools, tests/generated and tests/api is clean; a Jest unit test imports apps/api/src/platform/db/generated.ts under the @platform/source condition and constructs the client over a PrismaPg adapter without a database; after npm run build a spawned node with no conditions imports @platform/prisma/client from apps/api, which resolves to prisma/dist/client/client.js and reaches the driver (PrismaClientKnownRequestError for an unreachable host)
- PART 020-B IMPORT DISCIPLINE (D-ARCH-103; ADR-0003 amendment 2026-11-13): apps/api/src/platform/db/generated.ts is the only application module that imports the package as a value; it exports PrismaClient, type Prisma, type AppTransactionClient = Prisma.TransactionClient, type AppDb = TenantDb<AppTransactionClient> and a compile-time proof that every SYSTEM_MODELS name is a key of AppTransactionClient (a mutant with an unknown name fails tsc; a type-level test with ts-expect-error shows AppDb has neither referenceDatasetVersion nor $transaction); platform/db/index.ts and the @platform/api/runtime entry re-export AppDb, AppTransactionClient and Prisma as TYPES ONLY; eslint.config.mjs: the db-root-client category pattern gains apps/*/src/platform/db/generated.ts, and two boundaries policies after the DATABASE_CODE allow disallow a value import of the prisma-generated file category and allow it from db-platform-core, prisma, tools-db and test (select by file category, NOT by module source: a module-source selector matched nothing in the scratch run); no carve-out for platform/db/runtime.ts is needed; negative fixtures under tests/fixtures/lint/layering: repository value import fails, repository import type passes, service import type fails, platform/tx importing ../db/generated.js fails, platform/db value import passes, prisma/tests value import passes, the exact packages/audit/src/store/prisma-store.ts type import passes and another file of that package fails; CODEOWNERS gains /prisma/package.json, /prisma/schema/_base.prisma and /apps/api/src/platform/db/generated.ts (the PR needs a security record)
- PART 020-B RUNNER ACTIVATION (D-ARCH-104; closes the Partial row of the PR #32 table and R3-m1 (iii)): databaseRuntimeFromConfig(config, service, log) takes no Client argument, builds the client from ./generated.js and returns a runtime whose tenantTx is defined (TenantTxRunner<AppTransactionClient>); createDatabaseRuntime keeps the optional Client input as the unit-test seam only; RuntimeServices.tenantTx is non-optional; assertPipelineReady stays as defence in depth; boot tests: createRuntimeServices for api and for worker each return a defined runner (the runtime.test.ts case that expects undefined is replaced), startup() is awaited before listen in apps/api and before the worker takes work; integration test on Testcontainers PostgreSQL 18 as platform_app: the fresh-connection probe passes, a transaction tenant fixture route answers 200 through the composed createApp with the real runner and a DbError surfaces as problem+json (PR11-SEC-09 items 3 and 4 verified at the tx slot); exported repository and service functions are async or carry a return type (TS2883); the PR body records tsc -b and Jest unit wall time before and after (R-ARCH-28)
- PR #32 FIX CYCLE 1, T-83 (PR32-SEC-01 MEDIUM = security condition C1, code review m4; D-ARCH-106; ADR-0005 am. 11 items 17-21): NO descriptor phase fields in this PR (they are part 020-C). tools/eslint-rules/no-external-calls-in-tenant-tx.mjs treats as tenant-transaction roots (R1) a function passed to withTenantTx, (R2) the handler of the first argument of defineRoute in every function form (arrow, function expression, handler() and async handler()) unless the literal has transaction: none as a string literal (a non-literal transaction value or a spread element counts as tenant; fixtureRoute defaults to none and is a root only with transaction: tenant), (R3) handler: name resolved by scope analysis to a function declaration or a const function in the same file, and (R5) whole files by the txFiles option (default apps/api/src/platform/audit/**, apps/api/src/platform/outbox/writer.ts, packages/audit/src/store/**, non-test files), and (R6) any function in any file with a parameter whose type annotation names TenantDb, AppDb or AppTransactionClient (option txHandleTypes; type-name based, not name based: a readiness check taking db: DatabaseRuntime or an adapter taking ctx: CarrierContext is not a root; this reaches handler: controller.cancel with an injected controller and service methods create(db: AppDb, ...) across files); R4 (the load property) is added by part 020-C; call and afterCommit are never roots. Negative fixtures under tests/fixtures/lint/rules/no-external-calls-in-tenant-tx/: inline defineRoute handler with fetch plus a setTimeout sleep, named same-file handler, deps.queue.add in a handler, handler() method shorthand, spread literal without transaction none, a function under platform/audit, a function create(db: AppDb) calling fetch and a service method with db: TenantDb calling deps.queue.add (R6); positive controls: a transaction none handler, outbox.publish(db, event) in a handler (outbox is never added to names), the fixtureRoute default, a function with ctx: CarrierContext calling fetch; entries in tools/lint/negative-fixtures.test.ts. Ratchets: the route-metadata test pins the set of transaction none operationIds (today the health operations); a unit test fails on any eslint-disable directive naming the rule under apps/*/src or packages/*/src; defineRoute refuses transaction none with an audited action (PR32-SEC-05 d)
- PR #32 FIX CYCLE 1, ROUTE AUTHENTICATION SET (PR32-SEC-09 INFO and security condition C2 = PR32-SEC-02, code review m7; D-ARCH-107; ADR-0008 am. 4; api/README 8 and 15 row 12): (a) packages/authz/src/routes.ts: kinds anonymous, session, refresh-cookie, quote-token, signature; ROUTE_AUTH_SETS is the closed list [anonymous], [session], [refresh-cookie], [signature], [anonymous, session], [session, quote-token]; BoundRoute.auth is a readonly array and gains permissionAuthenticated and csrf; findRouteBindingViolations gains AUTH_SET, PERMISSION_AUTH, DUAL_MODE and CSRF_COOKIE (a non-GET refresh-cookie route needs csrf true) and adapts SIGNATURE_AUTH (D-TASK020-03 stands: a signature route declares a signature-only permission or public); one negative test per rule, 95 % coverage; (b) define-route.ts: auth accepts a kind or a set (scalar sugar, existing fixtures unchanged), normalised to a frozen array in RouteDescriptor.auth; permissionAuthenticated is required exactly on the dual-mode routes (permission public with [anonymous, session] or [session, quote-token]) and must be a catalogued permission that is neither selfService nor signatureOnly; (c) Principal.credential (a kind; ANONYMOUS carries anonymous; principalOf treats an unknown credential as anonymous); Principal.authenticated keeps meaning a user actor, so tenantContextOf is unchanged (guest and provider principals have authenticated false and no actor, code review n3); (d) authn stub: the anonymous principal when anonymous is in the set and no Authorization header, refresh cookie or X-Quote-Token is present, else 401 AUTH_REQUIRED with private, no-store; (e) authorise: credential gate first for every permission value, public included (route.auth must contain principal.credential, else 401), then the permission gate (public passes except that a session principal on a route with permissionAuthenticated must hold it, 403 AUTHZ_DENIED; authenticated needs the user actor; a catalogued permission must be held); tests: the leaky-authn seam (authn calls next without a principal) on public + signature, public + refresh-cookie, [session, quote-token] and [session], a principal whose credential is outside the set, both branches of a dual-mode route; (f) tests/generated/route-metadata.ts: contractAuth returns the set (empty object = anonymous, bearerAuth = session, refreshCookieWeb and refreshCookieAdmin = refresh-cookie, quoteToken = quote-token, *Signature = signature), parity is set equality, x-permission-authenticated equals permissionAuthenticated, seeded defects: a dropped quote-token alternative, a refresh route declared session, a missing permissionAuthenticated, one on a non-dual route, an unlisted combination; (g) SEC-TC-29 helper predicate (PR32-SEC-06 a): private, no-store when the operation security has no empty alternative or the request carried a credential. The real authenticators stay with TASK-052, 055, 091, 171 and 261
- PART 020-C ROUTE I/O PHASES (third PR of this task, no new ID; D-ARCH-106, D-ARCH-108; branch feat/TASK-020-c-route-io-phases from main after part 020-B; locks api-routing and lint; DUE merged before batch 1.3 is dispatched, hard stop before TASK-044 starts; security record required because the lint rule and eslint.config.mjs are owned paths; PRECONDITION part 020-B merged, real runner): (a) RouteSpec gains load, call and afterCommit and handler receives { loaded, called } (ADR-0003 am. 2026-11-13): load runs in one read-only tenant transaction (a write fails with SQLSTATE 25006, proven on Testcontainers), call has no transaction, no database handle and an AbortSignal for the request deadline and client disconnect, afterCommit runs after COMMIT and after the response, a throw is logged as api.after_commit_failed and never changes the response, and pending afterCommit work is drained at shutdown inside the 30 s window; load without call is refused and transaction none allows only handler and afterCommit; RouteContext.req is a frozen transport view in every phase (PR32-SEC-05 c); (b) the tx slot runs load, call, handler plus audit, then send, then afterCommit, releasing the D-ARCH-086 admission permit at each COMMIT and holding none across call; (c) unit tests with the fake runner: event order (begin, commit, call, begin, audit, commit, send, afterCommit); call throws (no handler transaction, problem response); handler throws (rollback, no afterCommit); audit failure (500, nothing sent, no afterCommit); afterCommit throws (response unaffected, log event); permit not held during call (two concurrent requests above the cap with a slow call both succeed); repeat safety (the handler transaction is rejected with TENANT_CONCURRENCY_LIMIT after call and the retry produces one external effect with the same key); (d) lint: load becomes root R4, with fixtures load-bad, call-ok and afterCommit-ok; (e) dynamic twin of T-83: the API test lanes set DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS=1000 and an integration test drives a Mock latency scenario through a route whose service in another file keeps the transaction open across the carrier call, which fails, while the same route written with call passes; (f) stream hook: the tx slot completes a stream result after COMMIT (result type and SSE framing belong to TASK-044); (g) api/README 15 and the ADR-0003 descriptor example are updated by the PR
- PART 020-B FOLLOW-UP, DECLARED CREDENTIAL KINDS AND THE SIGNATURE-ONLY GATE (PR32-SEC-16 = code review R2-m4, PR32-SEC-14; D-ARCH-109, D-ARCH-110; ADR-0008 am. 5; ADR-0006 am. 17; carried by part 020-B because it is the next TASK-020 PR and edits the files PR #32 leaves; it replaces clauses (d) and (g) of the PR #32 FIX CYCLE 1 ROUTE AUTHENTICATION SET line, which PR #32 meets as written; DUE merged before TASK-027 merges (batch 0.8, whose matrix generator reads these rules) and in any case before TASK-052 starts; the PR carries a security record, apps/api/src/platform is an owned path): (a) packages/shared/src/http/credentials.ts gains presentedKinds(headers), the kinds present among session (a non-blank Authorization header), refresh-cookie (a cookie named __Host-rt_web or __Host-rt_admin) and quote-token (a non-blank X-Quote-Token header); presentsCredential stays for the two generic cases of (c); the pending-ruling comments in credentials.ts and authenticate.ts are replaced by the ruling; (b) authn stub: the anonymous principal when anonymous is in route.auth and no DECLARED kind is present (presentedKinds intersected with route.auth), else 401 AUTH_REQUIRED with private, no-store (it verifies nothing, so a declared credential still fails closed); a credential of an undeclared kind is ignored and neither refuses nor marks the response; (c) problem handler: when the authn slot ran on a known route (it records that in the route state) the private mark alone decides; for a problem raised before a route is known (404/405 fallback, body parser) or before the slot ran, the generic presentsCredential test stays; (d) SEC-TC-29 helper and contract stubs: cacheRequirement uses the declared-credential test for a known operation (a foreign cookie or bearer on listCountries does not require private, no-store, and the public, max-age=3600 of the contract passes) and the generic test for the pre-route rows; the [SEC-TC-29] tests stay green and gain one foreign-credential case per kind; (e) authorise: the permission gate satisfies a catalogue signatureOnly permission from the signature principal (credential signature and the permission held, no actor, 403 AUTHZ_DENIED when it is missing); every other catalogued permission keeps the user-actor requirement (401) and then the held check (403); principal.authenticated is never set for a provider; tests through the real authorise: a signature principal with the permission 200, without it 403, a session principal on the signature route 401, a signature principal on a session route 401; (f) api tests with the stub: listCountries and createSession with only a refresh cookie, only an expired or malformed bearer, or only an X-Quote-Token give the no-credential result with the contract Cache-Control; a [session] route with only a cookie is 401 AUTH_REQUIRED; a [refresh-cookie] route with only a bearer is 401 AUTH_REQUIRED; an [anonymous, session] route with only a cookie takes the anonymous branch and with a bearer is 401 (the stub fails closed)
- PART 020-C T-83 RULE RESIDUALS (PR32-SEC-12 = code review R2-m3; D-ARCH-111; ADR-0005 am. 11 item 22; the rule file is reopened for R4 anyway; one negative fixture per form under tests/fixtures/lint/rules/no-external-calls-in-tenant-tx/ with one tools/lint/negative-fixtures.test.ts entry each, and the positive controls of PR #32 stay green): (a) const spec: defineRoute(spec) and fixtureRoute(spec) with an identifier that resolves to a same-file const object literal walk that literal as R2; any other first argument that is not an object literal (a parameter, an import, a call result) is reported with declare route specs as an inline literal or a same-file const literal; (b) wrapped and helper-passed handlers: a handler that is a call with a function expression or a same-file function name among its arguments (timed(async () => ...)) is walked through those arguments; a handler that is a function parameter, a let or var binding, or a call with no function argument (makeHandler(deps)) is reported with declare route handlers inline or as same-file const functions, so a route-building helper is reported at its defineRoute call; a member expression (controller.cancel) and an imported binding are NOT reported, they are the injected-controller and cross-file shapes that R6 reaches at the service (D-ARCH-106 (5)); (c) aliased factory: defineRoute and fixtureRoute are recognised through import aliases (import { defineRoute as route }); (d) holders: a member call whose receiver chain ends in a names entry matches at any depth (ctx.deps.queue.add(), services.queue.add()), and one same-function const alias of such a chain matches (const q = deps.queue; q.add()); (e) constructor-injected handle: the methods of a class whose constructor has a parameter property typed with a txHandleTypes name are roots; (f) waits: scheduler.wait from node:timers/promises (any local name) and Atomics.wait join the sleeps; (g) a literal import() of an EXTERNAL_MODULES entry (string or no-substitution template) inside a root is external I/O; (h) module-sources.mjs resolves createRequire through import aliases and namespace members (import { createRequire as mk }, import * as m from node:module) and the core rule no-eval is enabled for apps/*/src and packages/*/src, each with a fixture; limits that stay and are written in the rule header: a root calling an imported function without a handle parameter that does I/O, dynamic dispatch and generated handlers are review items covered by R6, the names option and the runtime twin of 020-C (e) above
- PART 020-C DEFINE-ROUTE HARDENING (PR38-SEC-03 LOW, PR38-SEC-04 INFO, PR #38 code review R2-n1; D-ARCH-113; ADR-0008 am. 6 items 1 and 3; carried by part 020-C because it is the next define-route.ts edit; DUE with 020-C: before batch 1.3 is dispatched, hard stop before TASK-044, and in any case before TASK-055 starts and before the first module route declares schema.headers; TASK-048 csrf and TASK-049 register are the first module routes and must not declare a refused name): (a) packages/shared/src/http/credentials.ts gains CREDENTIAL_HEADER_NAMES, a frozen lower-case list of every request header that carries a credential or a proof: authorization, cookie, x-csrf-token, x-reauth-proof, x-quote-token, stripe-signature, x-mock-signature, x-carrier-signature; the READERS of presentedKinds take their header names from it, and a parity test in tests/generated/route-metadata.test.ts derives the expected names from openapi.yaml securitySchemes (http bearer = authorization; apiKey in header = its name lower-cased; apiKey in cookie = cookie, and the cookie name must be in REFRESH_COOKIE_NAMES) and asserts every derived name is listed (x-reauth-proof and x-csrf-token are listed by hand with a comment where they are header parameters rather than schemes); (b) defineRoute refuses at module load, with a RouteDefinitionError naming D-ARCH-113, a schema.headers whose keys (describe().keys, compared case-insensitively) include a CREDENTIAL_HEADER_NAMES entry, with exactly one exception: x-quote-token is accepted when route.auth is exactly [session], the companion case of ADR-0008 am. 5 item 1 (claimQuote, saveQuote, createShipment, whose contract declares the QuoteToken header parameter; the handler compares hashes in constant time and never logs the value); tests/generated/route-metadata.ts drops x-quote-token from PIPELINE_HEADERS in favour of companion parity: on an operation whose security lists quoteToken the header is skipped, elsewhere schema.headers declares x-quote-token if and only if the contract declares the QuoteToken header parameter; unit tests: each listed name, mixed case included, refused; accept-language still accepted; x-quote-token accepted on [session] and refused on [anonymous], [anonymous, session], [session, quote-token], [refresh-cookie] and [signature]; the P3 probe of the PR #38 security review (three [anonymous] fixture routes declaring cookie, authorization and x-quote-token) now throws at defineRoute; (c) PR38-SEC-04: extensionProblems fails closed on the container shape too: a $_terms that is not a plain object (prototype Object.prototype) is reported as $_terms cannot be inspected (Joi internals changed) and is not walked (fixtures: null-prototype copy, Map, class instance, each holding a nested Joi.extend type that the untampered control reports), and a non-plain object met inside $_terms other than a RegExp or a Joi reference is reported rather than skipped; (d) R2-n1: the third arm of isAuthenticatedProblem in problem-handler.ts becomes (route === undefined || !credentialsReadOf(res)) && presentsCredential(req.headers), so an unbranded or forged descriptor local reads as no route and keeps the generic credential test even after the slot ran (fail closed: more private, never less); the routeDescriptorOf JSDoc sentence becomes unconditionally true; one handler test forges the local, calls markCredentialsRead, sends a bearer and asserts private, no-store; (e) api/README 8 and 15 state the schema.headers rule; the PR carries a security record (apps/api/src/platform and packages/shared/src/http are owned paths)
- PART 020-C GENERATED-CLIENT VALUE IMPORTER NARROWED (PR38-SEC-02 LOW; D-ARCH-114; ADR-0003 amendment 2026-11-14; eslint.config.mjs is an owned path and the lint lock is held by 020-C): the allow that follows the prisma-generated value disallow selects the exact file apps/api/src/platform/db/generated.ts (a file path selector, not the db-platform-core or db-root-client category) plus the prisma, tools-db and test categories, so apps/worker/src/platform/db/** and every other apps/api/src/platform/db file have no static value path to @platform/prisma/client (the worker takes the runner from createRuntimeServices and its types from @platform/api/runtime, D-ARCH-103 (4); client.ts imports the driver and the adapter only); PRISMA_GENERATED_VALUE_MESSAGE names the file and D-ARCH-114; fixtures under tests/fixtures/lint/layering: a value import from apps/worker/src/platform/db fails, a value import from a second apps/api/src/platform/db file fails, generated.ts passes, prisma/tests value import passes, and the D-ARCH-103 fixtures stay green; the dynamic forms (template-literal import(), createRequire) stay covered by CODEOWNERS (D-TASK020-43) and by platform/prisma-client-construction, recorded as the residual in the policy comment
- PART 020-C/020-D SYSTEM-TABLE RAW-SQL OWNERSHIP (PR32-SEC-07 (c); D-SEC-PR43-03; D-ARCH-124; the raw-SQL manifest was rejected by D-ARCH-091 (2)): platform/system-model-owner gains a second, manifest-driven check — in every tagged $queryRaw/$executeRaw template of a linted file, an identifier (optionally public.-qualified or quoted, outside SQL string literals and comments; audit_entries_YYYY_MM partition names map to audit_entries) equal to a SYSTEM table name of tools/db/table-classes/*.json is reported (rawSystemTable) unless the file lies within the owner globs of the module that declares the table; SYSTEM_MODEL_OWNERS gains audit: [packages/audit/src/**, apps/*/src/modules/audit/**] because the writer store names audit tables from the package; db-raw-sql already refuses non-literal SQL, so the static template text is the whole statement; negative fixtures: a quotes repository naming outbox_events and a module file naming audit_entries fail, the outbox writer and the audit store pass; carried by 020-C if still open (lint lock; eslint.config.mjs is owned), else a 020-D part; DUE before the first module repository raw statement on a SYSTEM table merges (TASK-073 audit viewer is the first known) and before G3
- PART 020-D SCOPE AND FIX CYCLE (PR #54; D-ORCH-067/076/085/087/096/105; D-TASK020-78..94; D-SEC-PR54-01; D-ARCH-131): the part carries D-ARCH-124 rawSystemTable (identifiers only; the partition rule generalised to <any SYSTEM table>_YYYY_MM; the audit owner entry with both globs; manifests read for every raw template and missing manifests fail closed), PR44-SEC-05 raw-statement forms in two twins over one JSON corpus (tools/eslint-rules/raw-sql-lexer.mjs and apps/api/src/platform/db/raw-statement.ts; first keyword of every statement plus the setter-without-literal-true and UPDATE pg_settings anywhere-forms; SET TRANSACTION READ ONLY admitted only through the exact-file allow on with-tenant-tx.ts; TenantDbAccessError names the form, never the text or values), PR #44 R2-m1 (pre-slot client-gone test), R2-m2/PR44-SEC-10 (template-literal createRequire key), R2-m3/PR44-SEC-11 (fail-closed lint crashes), the PR44-SEC-14 lint part (node:module and node:process refused repository-wide, tooling may import builtinModules only; getBuiltinModule and dlopen matched on any receiver), PR #42 R3-n3 (import x = require()), PR #39 R2-n2 for start-api.ts and config-exit.ts (the worker main.ts comment goes with the startWorker refactor, TASK-035 line, D-ARCH-136); FIX CYCLE 1 (D-ORCH-105): R1-M1 + PR54-SEC-01 (a)-(e) in both twins (ASCII whitespace class; a CR or LF comment end or a non-ASCII byte outside literals is unreadable and refused; E-string continuation across a newline; the Prisma $n rendering of template parts; standard_conforming_strings changes refused) with template-level corpus cases, a rawSystemTable fixture, PG integration cases for the CR and continuation forms and mutants incl. a restored backslash-s; PR54-SEC-02 C2 (DECLARE, FETCH, MOVE, CLOSE and session advisory locks refused; a runtime ALTER refused before TASK-073 ships its first raw statement); R1-m1/PR54-SEC-03 (dynamic node:module members, process respellings; D-TASK020-86 is not accepted as written until then); R1-m2 second-occurrence corpus rows; STATED RESIDUALS (D-TASK020-81, pinned in the corpus): SQL text inside a string that a function executes or concatenates, a function or procedure body that commits or sets (DDL lane only; runtime roles cannot create functions), CALL; PR54-SEC-05 (the leak detector covers the four carried keys, not a same-transaction re-scope or search_path) is an optional hardening at the next with-tenant-tx.ts edit; PR54-SEC-04: the D-ARCH-124 Why is corrected by D-ARCH-131 (db-raw-sql refuses non-literal template parts; only the TenantDb guard refuses fragments, at run time), and the raw-statement lint, which covers apps/*/src only, is widened to packages/*/src in this fix cycle if cheap, else by TASK-283 (next lint-lock holder) — until then packages/audit (the only raw-SQL package) relies on the TenantDb guard
- AT-US-067-01 … AT-US-067-04: all 4 scenarios of US-067, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/authz/**`, `prisma/**`, `apps/api/src/platform/**`, `tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-021 — Audit store SQL (bootstrap lane): partitioned audit_entries, immutability triggers, platform_audit_owner, DDL event trigger, ensure_audit_partitions, search_path hardening

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-033, TASK-090, TASK-006) | US-094 **DC** (M0 Must) Database-enforced immutability and its tests<br>US-095 **DC** (M0 Must) Monthly partitions, indexes and partition-creation job<br>US-012 **DC** (M0 Must) Liveness and readiness endpoints |
| REQs | REQ-AUDIT-014, REQ-AUDIT-015, REQ-AUDIT-016, REQ-AUDIT-017, REQ-PLAT-018 |
| NFRs | NFR-AUDIT-002, NFR-AUDIT-003 |
| Spikes / security / decisions | PR12-SEC-02, PR12-SEC-03, PR12-SEC-04, PR12-SEC-07, PR12-SEC-08, PR11-SEC-17, D-SEC-PR12-01, D-TASK012-02, D-ARCH-076, D-ARCH-077, D-ARCH-079, SPK-08, SEC-COND-03, SEC-COND-05, SEC-P3-27, PR11-SEC-11, D-TASK006-02, D-ARCH-073, D-ARCH-074, D-ARCH-081 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-012, TASK-016 |
| Batch · locks | 0.6 · prisma-bootstrap-audit |
| Branch | `feat/TASK-021-audit-store-sql-partitioned-audit` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/bootstrap/10-audit.sql (+ heads, checkpoints, anchors, partitions, verifications, pii_vault, data_subjects; NN-name per data-model §8.1)
- prisma/bootstrap/90-audit-ddl-guard.sql
- prisma/bootstrap/03-role-locale.sql ONLY if PR #11 merged without the lc_messages row (D-ARCH-073)
- tools/db/audit-ddl-reviewers.json
- prisma.config.ts tables.external list
- prisma/tests/catalog/c11-c14-audit.int.test.ts (C6, C7 via manifest flag immutable, C14)
- apps/api/src/platform/health/checks/{audit-partitions,audit-chain}.ts (replace the degraded stubs)
- tools/db/table-classes.ts: flag `immutable`

**Acceptance tests to write**
- US-094 DB scenarios (UPDATE/DELETE/TRUNCATE rejected for every role)
- US-095 partition + index scenarios (current + 3 months exist)
- SEC-TC-43 and SEC-TC-61 green; C11/C14 proconfig assertions pass
- Catalog C6/C7/C14 remainder (PR #11 code review m4; data-model §4.6 as amended 2026-11-13; D-ARCH-074): C6 asserts the UPDATE/DELETE row trigger and the TRUNCATE trigger on `audit_entries` and, via `tgparentid`, on every partition; C7 is manifest-driven — the new table-class flag `immutable: true` marks every append-only table carrying the immutability trigger (`audit_checkpoint_heads`, `audit_anchors`, `audit_pii_vault` here; later creating tasks flag `compliance_packs`, `compliance_pack_sections`, `shipment_price_snapshots`, `notification_templates` and the pricing child tables) and C7 asserts the trigger on every flagged table that exists; the C14 event triggers, the proconfig of the three audit functions and the OID rename probe land in the suite; the suite header names what is still pending
- PR #9 code review m2 / D-TASK006-02 (D-ARCH-074): the audit readiness checks replace the `degraded` stubs in `platform/health` — `audit_partitions` = at least 2 future monthly partitions exist (data-model §5.3; `unavailable` otherwise) and `audit_chain` = the latest `audit_chain_verifications` row is not failed (`degraded` while no verification has run yet); the tripwire tests are deleted in the same commit; together with TASK-019 this completes US-012
- PR11-SEC-11 c (ADR-0005 am. 10 item 6): trigger-raised 42501/23514 from `AUDIT_IMMUTABLE` map in `mapDbError` to a distinct security event derived from the message prefix, never from the text itself; PR11-SEC-11 h FALLBACK: if PR #11 merged without `ALTER ROLE platform_app SET lc_messages = 'C'` in `02-role-backstops.sql`, this task adds it as the new bootstrap file `03-role-locale.sql` with its C13 row and the `EXPECTED_ROLE_SETTINGS` row (D-ARCH-073); rule 10 DO-body scan and the `U&` identifier decode (PR #5 R2-m2/R2-n1) land here if PR #11 did not fix them
- PR12-SEC-02 (MEDIUM; data-model §5.2/§5.3 as amended 2026-11-13; D-SEC-PR12-01, D-ARCH-076): 90-audit-ddl-guard.sql matches the object OWN name for every pg_class kind (index, sequence, view, materialized view, composite type, foreign table) and pg_type kind (type, domain) in a protected schema before the relation branch; ensure_audit_partitions replaces the to_regclass name test with the identity test (relkind r, inhparent = public.audit_entries, owner platform_audit_owner, not inhdetachpending, bounds equal) raising AUDIT_PARTITION_NAME_TAKEN / AUDIT_PARTITION_BOUNDS_MISMATCH (42501) instead of skipping, and registers a verified partition; apps/api/src/platform/health/checks/audit-partitions.ts is CONTIGUITY from the catalogue (pg_inherits join pg_class) for months current..current+2, plus unavailable + security event audit_partition_squatted for any public relation, or non-relation type, matching ^audit_entries_[0-9]{4}_[0-9]{2}$ that is not such a partition (this REPLACES the "fewer than 2 future partitions in audit_partitions" rule of the line above)
- PR12-SEC-03 (LOW) + PR12-SEC-08 + PR12-SEC-04 item 3 (D-ARCH-076): the first-install guard file uses plain CREATE FUNCTION platform.audit_ddl_guard() (never CREATE OR REPLACE); C14 asserts the guard function owner and pg_event_trigger.evtowner = the bootstrap role, the audit-owner converse (platform_audit_owner owns exactly audit_forbid_mutation() f, audit_vault_guard() f, ensure_audit_partitions(integer) t; platform_schema_owner owns 0 pg_proc and 0 pg_class rows) and the pg_depend check (no audit-owned object depends on a non-catalog object owned by anyone but the audit owner or the bootstrap role); both event triggers and every audit trigger, incl. the per-partition TRUNCATE triggers, are ENABLE ALWAYS (C6/C14 expect tgenabled/evtenabled = A); the prototype RLS/placeholder policies on audit_entries and its approval-free header lines are NOT ported — the real files carry the rule-12 @audit-ddl security-approved marker with an entry in tools/db/audit-ddl-reviewers.json
- SPK-08 F-01/F-02/F-03 (PR12-SEC-07; data-model §7.3 as amended 2026-11-13; D-ARCH-077): root prisma.config.ts tables.external = the eight audit tables plus public.audit_entries_YYYY_MM for a generated window (2026-01 to current month + 24; pure function, no DB access); the shadow rendering emits DROP SCHEMA IF EXISTS <s> CASCADE before CREATE SCHEMA IF NOT EXISTS <s> for platform (or is fully idempotent), strips GRANT/REVOKE/ALTER DEFAULT PRIVILEGES as well as roles, SET ROLE, OWNER TO, AUTHORIZATION and event triggers, keeps the CREATE EXTENSION lines, and its FIRST statement refuses unless current_database() is owned by current_user; integration tests: the first migrate deploy after the bootstrap lane succeeds (no P3005), a second initShadowDb run succeeds, the rendering against a bootstrapped database fails closed with 42501
- PR11-SEC-17 c DO-body part (with PR11-SEC-15 a) and the DO half of PR #11 R3-n3: rules 11 and 16 scan DO bodies (a SET lock_timeout or set_config inside a DO body counts as a SET; a tenant-context write inside a DO body fails) with fixtures; the U& identifier decode in the bootstrap lane (PR #5 R2-n1 remainder) if PR #11 did not ship it
- POST-MERGE NOTE (D-ARCH-081; PR #24 is not reopened for it): readiness `audit_partitions` is RATIFIED as implemented — critical, three states: `unavailable` (503) when any month in [current, current+2] lacks a verified attached partition or any object squats a partition name, `degraded` (200) only when month current+3 is missing (AT-US-012-04 "the next audit partition" = current+3, the month the daily job creates ahead of the required window), `ok` otherwise; openapi.yaml HealthReady audit_partitions gains `unavailable` in PR #24, whose union with main regenerates packages/shared/src/api/types.gen.ts and routes audit_partition_squatted and audit_mutation_rejected through the PR #20 security sink as RUNTIME_SECURITY_EVENTS at error with the per-event field allow-list of api/README §13 (runtime table); `audit_chain` stays non-critical
- Covers the scenarios of AT-US-094-01 … AT-US-094-06 that belong to its layer; US-094 closes in TASK-033
- Covers the scenarios of AT-US-095-01 … AT-US-095-06 that belong to its layer; US-095 closes in TASK-090
- Covers the scenarios of AT-US-012-01 … AT-US-012-05 that belong to its layer; US-012 closes in TASK-006

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Bootstrap file = guardrail scope: backup/restore rehearsal tooling applies from the backup task onward (empty DB in Wave 0)
- SPK-08 §8.1 PORT-THEN-DELETE (PR #12 code review M3; D-TASK012-02 (1); due at this task merge, batch 0.6): this PR ports and deletes, IN THE SAME COMMIT, prisma/tests/spikes/spk08-audit-owner.int.test.ts (the SEC-TC-43 privilege list, the four planted-name guard cases F-05, the sql_drop cases incl. the audit-named index F-08, the SEC-TC-61 subset, the generated-window deploy F-01 and the shadow-rendering assertions incl. the F-02 negative control go into its C13/C14/SEC-TC-43 and shadow-init tests), prisma/tests/spikes/spk08/{10-audit,90-audit-ddl-guard}.sql (nothing ported: the real files are written from data-model §5.1-§5.3 as amended) and prisma/tests/spikes/spk08/prisma.config.ts (migrations.initShadowDb with the rendered lane and the generated tables.external window move into the root prisma.config.ts); the spk08 entry in TENANT_CONTEXT_EXEMPTIONS (eslint.config.mjs) is removed in the same commit and a unit tripwire asserts that every exempted file exists (PR #11 code review R3-n5); both spike suites bootstrap only the 0N-*.sql files, so the real audit files cannot turn them red before the port
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `apps/api/src/platform/**`, `tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-022 — SPK-06 spike: hash-based CSP with React Router pre-rendering behind Nginx; Trusted Types evaluation

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-SEC-006 |
| Spikes / security / decisions | PR2-SEC-03, PR2-SEC-09, PR4-SEC-10, D-ARCH-079, SPK-06, R-ARCH-06, SEC-P3-24, D-ARCH-054, D-ORCH-023, PR20-SEC-16, D-ARCH-084 |
| Specialist · model | frontend-developer · opus |
| Complexity | S |
| Depends on | TASK-014, TASK-004, TASK-005 |
| Batch · locks | 0.7 · web-build-csp, web-core, admin-core, pkg-config, lint |
| Branch | `feat/TASK-022-spk-06-spike-hash-based` |
| Priority | Enabler |

**Files / modules**
- tools/csp-hashes.ts (extract inline-script hashes per prerendered page)
- infra/nginx/web.conf.template (CSP header include)
- tests/e2e/csp.spec.ts (securitypolicyviolation listener)
- docs/04-plan/spikes/SPK-06.md
- apps/{web,admin}/vite.config.ts (loadWebBuildConfig(loadEnv(mode, <repo root>, '')) + define: webBuildDefine(config); envPrefix set to a prefix no variable carries; ADR-0018 am. 7, D-ARCH-054)
- apps/{web,admin}/app/env.d.ts (ImportMetaEnv augmentation; type-only import of WebBuildConfig from @platform/config/web)
- packages/config/src/web/web-schema.ts (+ .env.example, compose.env): VITE_PUBLIC_ORIGIN required absolute http(s) origin; loadWebBuildConfig rejects unknown VITE_* keys; web-subset isolation test (no node:*, joi, backend schema)
- apps/web/app/seo/public-origin.ts (static import.meta.env.VITE_PUBLIC_ORIGIN read, no localhost fail-open)
- eslint.config.mjs + tests/fixtures/lint/** (lint spec L1-L5 of rulings/batch-0.2-rulings.md Part 2: categories app-build-config and config-web; @platform/config/web allowed as a value from vite/react-router config files and type-only from app/**; apps/api and apps/worker never import @platform/ui)
- apps/web/tests/prerender.int.test.ts (canary VITE_CANARY / VITE_PUBLIC_CANARY absent from every asset, a defined key present, no *.map / sourceMappingURL)

**Acceptance tests to write**
- SPK-06 exit: 0 CSP violations on every public pre-rendered route on 3 engines; Trusted Types (require-trusted-types-for script) decision recorded
- Web build config wired (ADR-0018 am. 7, D-ARCH-054): both apps build only with a valid webConfigSchema environment (a missing or non-http(s) VITE_PUBLIC_ORIGIN and an unknown VITE_* key each fail the build naming the key); canary variables never reach an emitted asset while a defined key does; no source maps are emitted; PR3-SEC-08 and PR4-SEC-01 closed
- Lint spec L1-L5 encoded with probes/fixtures per arm: app/** value import, import() and export * of @platform/config/web reported, import type clean; vite.config.ts value import clean, root @platform/config and ./testing reported; apps/api importing @platform/ui reported; `npm run lint` green on the tree
- PR2-SEC-03 remainder + PR2-SEC-09 (carried from TASK-004 to this task by the PR #4 security review R2.8; lint lock held here): a TS-only block fails non-TypeScript sources under apps/*/{src,app} and packages/*/src (no-restricted-syntax on Program: "Application and package sources are TypeScript only (ADR-0001, CLAUDE.md §2)"; jsx added to the baseline files globs; config-coverage.test.ts asserts apps/web/app/routes/a.jsx reports the Program error, packages/shared/src/coverage/a.ts is not ignored and dist/x.js is ignored); TEST_FILES is anchored to workspace roots (**/*.test.{ts,tsx,js,jsx}, **/__tests__/**, {apps,packages}/*/{test,tests}/**, prisma/{test,tests}/**, tests/**) so apps/api/src/modules/orders/tests/bad-fetch.ts fails platform/outbound-http-via-client while packages/audit/test/a.ts stays category test; PR4-SEC-10 FALLBACK if PR #4 fix cycle 2 did not land it: the Playwright-output ignores in eslint.config.mjs globalIgnores and .stylelintignore are anchored to output locations with the deep-path rows in the lint and gitignore tests
- PR #3 code review R3-n1/n2/n3/n4 (+ R4-n1, optional) on the web config loader: a missing required key yields { code: missing } without rule on the web side too (empty and unset BRAND_NAME join the AT-US-002-04 whole-array test); the differential Verdict carries the rule id (Joi error.details[0].context.rule ?? type; Zod through the shared ruleOf); the backend import-graph check becomes an ALLOW-list of externals (joi, node:crypto, node:fs, node:fs/promises, node:inspector, node:path, node:timers/promises, node:util) so any @platform/*, # alias or new package fails; isBrandName refuses control, surrogate, zero-width and bidi characters (`/[\p{Cc}\p{Cs}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u`) and non-well-formed strings (BRAND_NAME reaches e-mail headers and document titles) and the lone-surrogate vector flips to rejected; compose-env.test.ts labels which key failed (it.each)
- PR #21 code review R1-m7 (D-ORCH-023 (1); D-ARCH-084): the CSP Playwright smoke also opens /api/docs against the compose api (page loads, `.swagger-ui .info .title` visible, zero securitypolicyviolation events) for BOTH initializer layouts — StandaloneLayout (APP_ENV local) and BaseLayout (any other APP_ENV with DOCS_ENABLED=true) — so AT-US-035-01 "renders" is proven in a browser; PR20-SEC-16 (D-ARCH-084): the bundle scan asserts that no pino (and no node:util) module is present in the web and admin client bundles

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-023 — Idempotent reference and demo seed framework (db:seed, db:seed:demo, production refusal of defaults)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-089) | US-049 **DC** (M0 Must) Idempotent reference and demo seed framework |
| REQs | REQ-DATA-001, REQ-DATA-002 |
| NFRs | NFR-OPS-001 |
| Spikes / security / decisions | D-061, PR13-SEC-04, PR13-SEC-10, D-ORCH-015, D-ORCH-017, D-SEC-PR13-02, D-ARCH-075, D-ARCH-079 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-003, TASK-005 |
| Batch · locks | 0.7 · prisma-seed |
| Branch | `feat/TASK-023-idempotent-reference-demo-seed-framework` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/seed/{index.ts, framework/**, reference/, demo/}
- root scripts db:seed, db:seed:demo

**Acceptance tests to write**
- D-061 (US-049 split; PR #13 code review M1): this task delivers the FRAMEWORK part only — AT-US-049-01, -03, -04 (x3), -06, -07, -08 (re-run is a no-op proven by xmin; demo seed refused when APP_ENV=production; SEED_* passwords from env only; AT-01/-08 on probe tables is accepted for a framework task, the first real dataset is the TASK-026 countries); AT-US-049-02 is owned by TASK-014 and AT-US-049-05/-09/-10-1/-10-2 by TASK-089 — US-049 reads as Implemented only when all three are merged; the test asserting created: 0, deferred: 14 is replaced by TASK-089, not kept alongside
- data-model §9.2 as amended 2026-11-12 (D-ARCH-060): the reference seed never writes permissions, roles or role_permissions (they come from the generated authz seed migration); the framework exposes the reference_dataset_versions hook the US-073 task uses for the authz parity check and CONFIG_CHANGE entry
- SUPERSEDING BRANCH (D-ORCH-015, D-ORCH-017, D-SEC-PR13-02; after PR #11 merges): a fresh branch from main carrying the reviewed tree e42e368 plus only the reconciliation changes (no e6ccf60 or 5fcf177 ancestor; .gitleaks.toml and .gitleaksignore untouched; lane A green; its own security record naming the new head); reconciliation = register reference_dataset_versions in tools/db/table-classes/platform.json (SYSTEM; fix the "SYSTEM tables get no grants" comment), align prisma/seed/** raw SQL with the PR #11 lint rules, and PR13-SEC-04 AS RULED (D-ARCH-075; data-model §3.5/§4.4): the unmerged migration 20261112030000_reference_dataset_versions and prisma/sql/grants.manifest grant platform_app SELECT ONLY (one manifest line; C5 equality; a platform_app INSERT/UPDATE probe -> 42501); the label column is dataset_version (D-TASK023-01 (01)); code review R2-m1: the drift branch tests inserted > 0 || updated > 0 (a hand-deleted row of an audited dataset re-inserted is a drift-restored ConfigChange and a warn seed.drift_restored with restoredRows = inserted + updated; runner unit test plus one integration step: DELETE one audited probe row -> restored, one change, version row unchanged); R2-n1 stray README bullet deleted; PR13-SEC-10 optional one-liner: the pin read-back predicate uses OPERATOR(pg_catalog.=)
- Covers the scenarios of AT-US-049-01 … AT-US-049-10 that belong to its layer; US-049 closes in TASK-089

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-024 — Generated cross-tenant isolation test suite (RLS generator)

| Field | Value |
|---|---|
| Stories (completes) | US-077 (M0 Must) Generated cross-tenant isolation tests |
| REQs | REQ-RLS-007 |
| NFRs | NFR-SEC-011, NFR-TENANT-001 |
| Spikes / security / decisions | PR11-SEC-16, PR11-SEC-17, PR11-SEC-14, SPK-08, D-ARCH-077, D-ARCH-078, D-ARCH-079, T-QA-04, PR7-SEC-04, PR7-SEC-07, DR-A14, PR11-SEC-03, PR11-SEC-06, PR11-SEC-07, PR11-SEC-10, PR11-SEC-11, D-ARCH-071, D-ARCH-072, D-ARCH-074, PR26-SEC-03, D-ARCH-091, D-ARCH-093, PR24-SEC-11, D-ARCH-099, D-SEC-TM-01, PR43-SEC-09, D-ARCH-123, D-067 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-016, TASK-020 |
| Batch · locks | 0.7 · tests-gen-rls, prisma-rls, prisma-core |
| Branch | `feat/TASK-024-generated-cross-tenant-isolation-test` |
| Priority | Must |

**Files / modules**
- tests/generated/rls/{generator.ts, cross-tenant.int.test.ts}
- tools/quality/required-suites.json entry rls-cross-tenant (security: true)
- prisma/sql/policy-templates/{dr-a14-users,dr-a14-memberships,dr-a14-organisations}.sql (DR-A14 named templates, D-ARCH-072)
- tools/db/table-classes.ts (field policySet; flag runtimeReadOnly) + tools/db/render-rls.ts (policySet blocks, exact special atoms)
- tools/db/lint-migrations.ts rule 9 renderer equality + rule 17 + fixtures policy-not-rendered, down-without-if-exists
- prisma/tests/catalog/{scans.ts, c01-c12.int.test.ts}: C3 derived set + keyed-atom presence + DR-A14 invariants, C11 converse ownership set, C1 scope, C8/C9 if PR #11 did not ship them
- tools/db/up-down-up.ts prefix-reversibility check (data-model §8.4)
- prisma/sql/function-templates/std-columns-guard.sql + manifest-driven rendering of trg_<table>__std_columns in tools/db/render-rls.ts (D-ARCH-091)
- prisma/tests/catalog/c15-std-columns-guard.int.test.ts

**Acceptance tests to write**
- All US-077 scenarios
- DR-A14 MECHANISM (data-model §4.3 as amended 2026-11-13; PR11-SEC-10 requirements 1-5; D-ARCH-072): the three special policy sets are renderer TEMPLATES, never hand-written policies — manifest field `policySet: dr-a14-users | dr-a14-memberships | dr-a14-organisations`, accepted by the loader only on the table of the same name and class (`users` USER_OWNED, `memberships` TENANT, `organisations` TENANT); `blocksFor` renders enable-force + the set (replacing user-owned for users and tenant for organisations; adding own_read to tenant for memberships) + operator (+ definer-read); `validateTemplate` admits for these templates only the exact atoms `id = platform.app_actor_id()` (users), `id = platform.app_org_id()` (organisations) and the two exact EXISTS atoms over `public.memberships` with POSITIVE status lists (`m.status IN ('ACTIVE','SUSPENDED')` for users — INVITED removed 2026-11-14 by D-ARCH-123, see the review requirement below — and `IN ('ACTIVE','SUSPENDED')` for organisations); every forbidden token (`<>`, `!=`, `NOT`, `OR`, `coalesce`, `IS DISTINCT FROM`) stays refused inside EXISTS; the rendered output equals the data-model §4.3 SQL byte for byte after whitespace normalisation (unit test)
- PR11-SEC-03 items 2-3 — rule 9 and C3 (ADR-0005 am. 10 item 7 as clarified 2026-11-13): every `CREATE POLICY` in prisma/migrations/** must equal, after normalisation, a statement of `renderRls(entry)` for its table (rule 9 message "policy not rendered from the templates"; fixtures `policy-tautology` and `policy-unkeyed` fail, a fixture holding the rendered TENANT, GUEST_CAPABLE, USER_OWNED and DR-A14 blocks lints clean; NO exemption file exists); C3 derives the expected policy set from the manifests + renderer by creating each rendered block on a rolled-back probe and comparing the deparsed `pg_policies` rows (the hand-edited `policies.snapshot.json` is retired), asserts a keyed atom (`platform.app_org_id()`, `app_actor_id()`, `app_guest_token_hash()` or `app_is_operator()`) in every `TO platform_app` qual/with_check (planted `p_bad_tautology` `org_id = org_id` and `p_bad_unkeyed` `org_id IS NULL` are reported), and asserts the DR-A14 invariants: `memberships` policy expressions contain no subquery (42P17 recursion), `users`/`organisations` subqueries reference `public.memberships` only, `IN (…)` lists appear only on `m.status`
- PR11-SEC-06 (P3 §15 deviation 7 converse; D-ORCH-005 (7)): C11 asserts `platform_definer` owns exactly the allow-listed definer functions and no other function, relation, type or schema (UNION ALL over `pg_proc.proowner`, `pg_class.relowner`, `pg_type.typowner`, `pg_namespace.nspowner`); planted, rolled-back `SET ROLE platform_definer; CREATE VIEW platform.v AS SELECT 1;` and an invoker function are both reported
- Rule 17 + prefix reversibility (data-model §8.3/§8.4 as amended 2026-11-13; PR11-SEC-07; D-ARCH-071): rule 17 requires every `DROP …` and `ALTER TABLE … DROP COLUMN|CONSTRAINT` in `down.sql` to carry `IF EXISTS` (fixture `down-without-if-exists`), and the up-down-up driver additionally applies, for every migration, each proper statement prefix on a template clone (statement by statement as the migrator, like deploy), runs `down.sql`, marks the row rolled back and asserts the schema equals the pre-migration snapshot — a down that cannot revert a partial deploy is named with its prefix length
- Catalog remainder routed here (PR #11 code review m4, PR11-SEC-11 e/g; D-ARCH-074): C8 (no `timestamp without time zone`; every `id` is uuid DEFAULT uuidv7(); every `*_minor` is bigint with a sibling currency column carrying the `^[A-Z]{3}$` CHECK) and C9 (every `ck_*` enum CHECK equals its packages/shared enum) if PR #11 did not ship them — the committed authz tables are the first subjects; C1 and rule 9 cover every non-system schema or assert that `platform` holds no table; a `runtimeReadOnly` manifest flag on GLOBAL entries makes `validateGrants` refuse any write line at parse time
- Every table in tools/db/table-classes/*.json and every tenant-resource route is enumerated; an unlisted tenant table fails the suite
- PR7-SEC-07 item 3 — C12 guest-row probes (ADR-0005 am. 10 item 7): for every GUEST_CAPABLE table the generator plants a guest row (org_id NULL, hash H) and probes it with (i) no settings, (ii) all four app.* keys set to the empty string, (iii) org A context without a hash, (iv) a different hash — all four return 0 rows; the positive control with hash H returns 1
- PR7-SEC-04 verification (ADR-0005 am. 10 item 11): for every GUEST_CAPABLE table, under the claim context (org A + hash H), the de-claim `UPDATE … SET org_id = NULL, guest_token_hash = <hash>` is rejected (GUEST_DECLAIM_FORBIDDEN) while the legitimate claim succeeds; a table in the manifest without the trigger fails the suite
- PR11-SEC-16 (LOW) + PR11-SEC-14 b + PR11-SEC-17 c + PR #11 R3-n3 (data-model §8.3 Limits as amended 2026-11-13; D-ARCH-078): E-prefixed escape strings are refused TOKEN-LEVEL in both SQL lanes — sqlText marks a string token carrying the E prefix (never a regex over the text: a bare e-quote pattern also matches a string ending in a lone e) and one write form in the shared list matches the sentinel in scans.ts and the linter (a C-series fixture with EXECUTE of an E-string spelling app.org_id through hex escapes, executed on PostgreSQL 18, fails the scan; linter fixture context-escape-string fails rule 16; the header sentence of tenant-key-forms.ts is corrected — escaped strings CAN hide a key until this lands); the dynamic-SQL allow-list for EXECUTE of non-literals (review-required marker) covers the same case; rule 11 folds quoted names (SET "lock_timeout") and set_config of lock_timeout into LOCK_TIMEOUT_VALUE and flags set_config of role / session_authorization literals (PR11-SEC-15 b); fixtures per form
- SPK-08 F-04 and F-11 linter rules (data-model §7.3 as amended 2026-11-13; PR #12 code review R2-m1; D-ARCH-077; due before TASK-026, the next migration-adding task, merges): a migration may not DROP INDEX a name on the covering-index tolerance list unless the same file re-creates it WITH INCLUDE (alternative: the catalog check compares pg_index.indnkeyatts < indnatts for the tolerated names); a migration may not DROP INDEX an index that an earlier migration created with WHERE unless the same file re-creates it WITH a WHERE clause, and a predicate change is flagged for review; negative fixtures: drop + plain re-create of ix_role_permissions__role_id without INCLUDE; drop + re-create of a partial index without WHERE
- STANDARD-COLUMNS GUARD MECHANISM (PR26-SEC-03 LOW; data-model §7.6 amendment of 2026-11-13 and catalog C15; ADR-0009 am. 1; D-ARCH-091; DUE before TASK-037 merges, which depends on this task): ship `prisma/sql/function-templates/std-columns-guard.sql` — platform.std_columns_guard(): plpgsql, SECURITY INVOKER, SET search_path = pg_catalog, pg_temp, owner platform_migrator, ASSERTION ONLY (it never assigns a column), reads the actor through platform.app_actor_id() and never through current_setting; INSERT requires created_by = updated_by = coalesce(actor, ANONYMOUS id) and version = 1; UPDATE requires id, created_at and created_by unchanged, updated_by = actor and version = OLD.version + 1; it raises P0001 with the message prefix STD_COLUMNS_VIOLATION naming column and table, never a value; the role platform_migrator is exempt — plus the renderer block `CREATE TRIGGER trg_<table>__std_columns BEFORE INSERT OR UPDATE ON public.<table> FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard()` for every manifest table that has the full STD set, is not runtimeReadOnly and is not audit-owned (rendered like the RLS blocks and pasted verbatim, never hand-written); catalog C15 = (a) exactly one enabled (tgenabled O) row-level BEFORE INSERT OR UPDATE guard trigger on every in-scope table and none elsewhere, exemptions only as an exact-name map with a stated reason looked up with Object.hasOwn or a Map, never the in operator (PR26-SEC-06), (b) function owner, prosecdef false, proconfig and no current_setting or set_config in the body, (c) best-effort prosrc scan that no other trigger function assigns NEW.id, created_at, created_by, updated_by or version, (d) the planted-forgery matrix on rolled-back probes as platform_app — forged created_by, updated_by and version on INSERT; version = 1, version + 2, forged updated_by, changed created_by and changed id on UPDATE; each raises STD_COLUMNS_VIOLATION — with positive controls (a correct raw statement, the ANONYMOUS and SYSTEM contexts, ON CONFLICT DO UPDATE, the migrator exemption); the PR report records the per-row cost on PostgreSQL 18 (10 000-row INSERT and UPDATE with and without the trigger; recorded, not asserted; more than 25 microseconds per row reopens the choice). The raw-DML lint half of the PR #26 security record section 5 (a db-raw-sql manifest of raw writers) is NOT built — D-ARCH-091 rejects it — so this task takes no ESLint lock for it
- PR #24 code review R2-n2 (data-model §5.2 amendment of 2026-11-13; D-ARCH-093): the audit DDL guard roughly doubles migrator DDL time (600 statements: 1.49 s with the r1 guard, 2.78 to 3.09 s with the head guard, PGlite/WASM) — the up-down-up driver report records the guard share of migrate deploy wall time on the full migration set; if it exceeds 25 percent, or migrate deploy exceeds 60 s in CI, open the guard replacement ceremony (data-model §5.2 Changing the guard later) and prefilter the invariant scans by relname/typname/proname prefix before the regex; no action otherwise
- RULE 11 TRANSACTION CONTROL (PR24-SEC-11 INFO, PR #24 security r2; data-model §8.3 rule 11 sub-clause (c) of 2026-11-13; D-ARCH-099; with the setter-key half of PR24-SEC-03 and PR11-SEC-17 c): the migration linter refuses a top-level transaction-control statement in migration.sql and in down.sql — BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE, ROLLBACK TO, PREPARE TRANSACTION, COMMIT PREPARED and ROLLBACK PREPARED — recognised as the first token of a statement by the existing statement splitter and tokenizer (never inside a dollar-quoted body, a CASE ... END or a BEGIN ATOMIC body), message rule 11c, because migrate deploy applies one statement at a time outside any transaction block (rule 5) and a BEGIN ... ROLLBACK would undo a RESET or a lowering SET that the lock_timeout tracker has already counted; fixtures: SET lock_timeout = 10s; BEGIN; RESET lock_timeout; ROLLBACK; fails rule 11c, a file without transaction control and a transaction-control word inside a dollar-quoted body lint clean, and the DO-body RESET asymmetry of PR24-SEC-03 is unchanged
- D-ARCH-102: prisma/tests keep their relative imports of ../../generated/prisma/client.js (a referenced project redirects them to its declarations, so there is no churn); this task shares tools/tsconfig.json and prisma/package.json with TASK-020 part 020-B (batch 0.6, same prisma-core lock) and rebases onto it if it has not merged when this task starts
- SEC-TC-73 and SEC-TC-74 (proposed IDs, D-SEC-TM-01; qa-lead adopts them through required_cases_pending with checkpoint Wave-0 exit, and SEC-TC-74 enters required_cases at the first activation PR after this task merges because it is a merge condition of TASK-037): the rule 11 (c) migration-lint fixtures carry [SEC-TC-73]; the standard-columns forged-stamp matrix and the catalog C15 cases carry [SEC-TC-74]
- REVIEW REQUIREMENT FOR PR #43 (D-ARCH-123; product-manager D-067; PR43-SEC-09 (a); data-model section 4.3 fence as amended 2026-11-14): prisma/sql/policy-templates/dr-a14-users.sql reads m.status IN ('ACTIVE','SUSPENDED') — INVITED removed — and the render-rls-dr-a14 unit test that compares the template with the data-model fence is green against the amended fence; a one-token change in the fix cycle; the memberships and organisations templates are unchanged
- AT-US-077-01 … AT-US-077-04: all 4 scenarios of US-077, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `tools/db/**`, `tests/generated/rls/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-025 — Audit writer core: action/actor types, complete entry fields, same-transaction write and outcome semantics

| Field | Value |
|---|---|
| Stories (completes) | US-088 **DC** (M0 Must) Same-transaction writes and outcome semantics |
| Stories (partial; completed by TASK-073) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| REQs | REQ-AUDIT-004, REQ-AUDIT-010, REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 |
| NFRs | NFR-AUDIT-001, NFR-AUDIT-006 |
| Spikes / security / decisions | PR2-SEC-05, PR11-SEC-05, D-ARCH-074, PR13-SEC-08, D-ARCH-075, SPK-04, D-ORCH-031, D-ARCH-085, D-ARCH-086, D-ARCH-087, PR40-SEC-05, D-ARCH-115, D-ARCH-122, D-ARCH-125 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-021, TASK-016, TASK-020 |
| Batch · locks | 0.7 · pkg-audit-core |
| Branch | `feat/TASK-025-audit-writer-core-action-actor` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/audit/src/{writer.ts, entry.ts, actions.ts, store/prisma-store.ts}
- packages/audit/test/**
- apps/api/src/platform/db/tenant-admission.ts (+ its wiring inside with-tenant-tx.ts; worker twin follows in TASK-047)
- packages/config: DB_TENANT_MAX_CONCURRENT_TX, DB_TENANT_ADMISSION_WAIT_MS, DB_AUDIT_LOCK_TIMEOUT_MS (+ .env.example placeholders; no pkg-config lock taken, D-ORCH-020 precedent — coordinate if a concurrent batch-0.7 PR edits packages/config)

**Acceptance tests to write**
- All US-087 and US-088 scenarios (audit insert failure rolls back the business row: 500 AUDIT_WRITE_FAILED)
- PR2-SEC-05 addendum / PR11-SEC-05 item 2 (ADR-0005 am. 10 item 2; D-ARCH-074): `packages/audit/src/store/prisma-store.ts` is typed on `TenantDb` and joins the business transaction it is handed; it constructs no PrismaClient and imports no `pg`/`pg-pool` (the boundaries policy allows the SQL driver only under `apps/*/src/platform/db/**`, prisma, tools/db and tests — a negative lint fixture for this exact file fails); a second pool would run without tenant context and commit audit rows outside the business transaction
- D-ARCH-075 (PR13-SEC-08 TASK-025 item; data-model §3.5): the seed-path ConfigChangeSink is NOT backed by this audit writer — the seed runs on the migrator connection and INSERT on audit_entries belongs to platform_app only; the migrator gains no privilege on any audit table (any such grant is a security-review item under §4.4 item 5); durable CONFIG_CHANGE entries for seed-originated changes are written by the TASK-221 reconciler (SYSTEM_JOB) through this writer; the writer API therefore takes a TenantDb / job context, never a raw migrator connection
- SPK-04 POOL PROTECTION (ADR-0007 am. 10 item 3; data-model §7.7 as amended 2026-11-13; D-ARCH-086): per-tenant ADMISSION BULKHEAD inside withTenantTx, acquired BEFORE pool checkout and released in finally — key = ctx.orgId, "anonymous" for "", "operator" for OPERATOR scope; cap DB_TENANT_MAX_CONCURRENT_TX (default max(2, floor(DB_POOL_MAX / 2))), FIFO wait DB_TENANT_ADMISSION_WAIT_MS (default 250, validated <= maxWait), queue depth 2 x cap; overflow or wait expiry = DbError 503 SERVICE_UNAVAILABLE reason TENANT_CONCURRENCY_LIMIT, retryable, Retry-After 1; metrics db_tenant_admission_rejected_total{reason=wait|depth} and gauge db_tenant_admission_inflight{key_kind}; tests: unit (FIFO order, wait expiry, depth rejection, release on throw and on commit) and integration (with poolMax = cap + 2, org A parks cap + 2 transactions inside their callbacks: org B is admitted and commits within 100 ms, the org A overflow gets 503 TENANT_CONCURRENCY_LIMIT after the wait, no connection or permit leaks after the rollbacks)
- SPK-04 WRITER API (ADR-0007 am. 10 items 1-2; data-model §5.4 as rewritten 2026-11-13; D-ARCH-085): the writer takes the COMPLETE entry with its full PII value list in ONE call (tokenise(values[]) is a batch port: one multi-row vault INSERT ... SELECT FROM unnest(...) ON CONFLICT DO NOTHING + one separate lateral token lookup per entry, never one statement per value) so TASK-030 can meet the round-trip budget without an interface change; error model reserved here and raised by TASK-030: 500 AUDIT_WRITE_FAILED non-retryable (expectAffected mismatch, missing partition, integrity) versus 503 AUDIT_LOCK_TIMEOUT retryable with Retry-After 1 — both roll back the business transaction (O4); the zero hash is a 32-zero-byte Buffer parameter or decode(repeat(00, 32), hex) in SQL, never the text expression of the old §5.4 step 3 (42804; D-ARCH-087)
- D-ARCH-103 (ADR-0003 amendment 2026-11-13 item 5): packages/audit/src/store/prisma-store.ts takes a structural port of the two tagged-template raw methods (preferred; no dependency on the Prisma packages); a type-only import of @platform/prisma/client is permitted and then needs the @platform/prisma dependency and the prisma/client project reference; a value import is refused by lint; precondition: TASK-020 part 020-B is merged
- REVIEW REQUIREMENT FOR THE TASK-025 PR (PR40-SEC-05 / PR #40 code review R1-m4 (a); D-ARCH-115; in flight, merge check only): this PR lands the first measured packages/audit source, which activates the 95/95 critical scope of tools/ci/coverage-gate.mjs; the PR body quotes the merged packages/audit lines and branches from the lane B evidence, and in the first activation checkpoint after it merges (at the latest the Wave-0-exit manifest PR) qa-lead adds the exact names coverage gate: packages/audit lines and coverage gate: packages/audit branches to unit.required_cases of tools/quality/required-suites.json (manifest-only PR with a security record; the names are the gate transcript cases of PR #40, classname unit)
- REVIEW REQUIREMENT FOR PR #42 (code review R1-m4; ADR-0007 am. 11 item 3; D-ARCH-122; in flight, merge check only): the writer JSDoc states one write() per transaction until TASK-029 lands record/flush; no caller in this PR writes twice in one transaction (the capture middleware and the state machine are TASK-029/TASK-030 code); satisfied as is if the head already says so
- TRACEABILITY (code review R1-m5; D-ARCH-125): this task completes US-088 and is PARTIAL for US-087 — AT-US-087-04 (forged X-Forwarded-For, trusted proxy chain) is TASK-041, AT-US-087-07 (MFA_RECOVERY_USED and SESSION_REVOKED) is the CHECK widening of TASK-285 with the emitters TASK-059 and TASK-061, AT-US-087-08 (viewer 403 without audit:read) is TASK-073, which completes US-087; the other five AT-US-087 scenarios stay here
- AT-US-088-01 … AT-US-088-08: all 8 scenarios of US-088, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-087-01 … AT-US-087-08 that belong to its layer; US-087 closes in TASK-073

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- 95 % coverage gate on packages/audit; security-integration job
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`, `packages/config/**`, `apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-026 — Walking-skeleton slice: seed countries/regions -> GET reference countries -> web page -> Playwright via Compose

| Field | Value |
|---|---|
| Stories (completes) | US-051 **DC** (M0 Must) Seed countries, regions and launch-country enablement |
| Stories (partial; completed by TASK-070, TASK-089) | US-053 **DC** (M0 Must) Public read-only reference endpoints<br>US-003 **DC** (M0 Must) One-command local environment |
| REQs | REQ-DATA-004, REQ-DATA-005, REQ-DATA-007, REQ-DATA-016, REQ-PLAT-005 |
| NFRs | NFR-COMPAT-002, NFR-OPS-001 |
| Spikes / security / decisions | PR13-SEC-05, D-061, D-ARCH-079 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-023, TASK-020, TASK-014, TASK-017, TASK-004, TASK-022 |
| Batch · locks | 0.8 · mod-admin-settings-reference, web-core, ui-api |
| Branch | `feat/TASK-026-walking-skeleton-slice-seed-countries` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/reference.prisma + migration (countries, regions, launch enablement)
- prisma/seed/reference/countries.ts
- apps/api/src/modules/admin-settings/reference/{routes,controller,service,repository,schemas}.ts
- packages/ui/src/api/client.ts (thin typed Axios client over @platform/shared api types; base URL from import.meta.env.VITE_API_BASE_URL; problem+json mapping seam; ADR-0026 am. 14, D-ARCH-056) + tools/repo toolchain assertion that packages/shared declares no axios/undici/node-fetch/got/ky
- apps/web/app/routes/$lang.dev-countries.tsx (removed once the quote widget lands; tracked by this task ID)
- tests/e2e/skeleton.spec.ts

**Acceptance tests to write**
- All US-051 scenarios
- US-053 countries endpoint scenarios (ETag + Cache-Control; remaining endpoints in the reference-data task)
- Thin slice: compose up -> migrate + seed -> API (OpenAPI-validated) -> web page -> Playwright green on Chromium; lane A + lane B pr evidence attached
- PR13-SEC-05 remainder (INFO; first real dataset): validateDataset accepts only tables whose table-class manifest class is GLOBAL (the PR #11 manifests are on main by then) — permissions, roles, role_permissions, reference_dataset_versions and audit_* are refused by class and by name — and sql.ts#table() requires exactly two name parts (renderUpsert throws for public.t.extra); tests for both
- D-061 evidence line: countries/regions is the first REAL dataset through the TASK-023 framework (AT-US-049-01/-08 were proven on probe tables) and this task re-proves the Compose chain migrate -> seed -> API on it; it owns no AT-US-049 scenario (AT-02 is TASK-014; AT-05/-09/-10 are TASK-089)
- PRECONDITION (D-ARCH-104): TASK-020 part 020-B is merged, so createRuntimeServices already returns a defined runner for api and worker; this task adds no client wiring and imports no generated-client module (repositories import types only, ADR-0003 amendment 2026-11-13); the first route with transaction tenant is proven through the composed app with the real runner
- AT-US-051-01 … AT-US-051-08: all 8 scenarios of US-051, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-053-01 … AT-US-053-08 that belong to its layer; US-053 closes in TASK-070
- Covers the scenarios of AT-US-003-01 … AT-US-003-04 that belong to its layer; US-003 closes in TASK-089

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-027 — RBAC matrix test generator (route x role allow/deny from metadata and seeded roles)

| Field | Value |
|---|---|
| Stories (completes) | US-071 **DC** (M0 Must) RBAC matrix test generator |
| REQs | REQ-RBAC-011 |
| NFRs | NFR-SEC-011, NFR-TENANT-002 |
| Spikes / security / decisions | T-QA-04, D-ARCH-109, D-ARCH-110, PR32-SEC-14, PR32-SEC-16, PR43-SEC-01, D-SEC-PR43-01, D-ARCH-125 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-013, TASK-020, TASK-024 |
| Batch · locks | 0.8 · tests-gen-rbac |
| Branch | `feat/TASK-027-rbac-matrix-test-generator` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/authz/src/generator/**
- tests/generated/rbac/rbac-matrix.api.test.ts
- required-suites.json entry rbac-matrix (security: true)

**Acceptance tests to write**
- All US-071 scenarios (100 % of route x role combinations generated; uncovered route fails CI)
- D-ARCH-107 (ADR-0008 am. 4): the generator reads route.auth (a set of credential kinds) and permissionAuthenticated from the descriptor: per route one row per accepted credential kind, for a dual-mode route both branches (the public branch allowed; the session branch allowed only when permissionAuthenticated is held in the active organisation, 403 AUTHZ_DENIED otherwise) and one row with a credential outside the set (401 AUTH_REQUIRED, never 403)
- D-ARCH-109 / D-ARCH-110 (ADR-0008 am. 5; PR32-SEC-16, PR32-SEC-14; the TASK-020 part 020-B follow-up has merged): per route and per credential kind OUTSIDE its auth set, one row whose request carries only that foreign credential (a refresh cookie, an expired bearer, an X-Quote-Token) and whose status, body code and Cache-Control equal the same request with no credential, whatever that result is (200, 401 or 404); the named rows are [anonymous] + refresh cookie (200 with the contract Cache-Control), [anonymous] + expired bearer (200), [session] + refresh cookie only (401, nothing consumed) and [refresh-cookie] + expired bearer only (401, the cookie is what is missing); per [signature] route one row with a signature principal holding the permission of the route (200) and one without it (403)
- PR43-SEC-01 C2 (MEDIUM; D-SEC-PR43-01; PR #43 code review R1-M2; D-ARCH-125): if PR #43 defers it, this task turns tests/generated/rls API_CASES into a ReadonlyMap<operationId, ApiCase {table, request(id), principal tenant | guest}> that cross-tenant.int.test.ts executes against the real module registry through createApp (the id of B -> 404 NOT_FOUND with no B data in the body; the id of A, or guest hash H, -> the positive status), reports a registered operationId with no route or no builder, and enumerates guest and dual-mode routes (getQuote) besides tenant and user ones; a bare operationId string never silences routeCaseFindings; DUE before the first tenant, user or guest route with a path parameter merges (TASK-051 claimQuote is the first known) and at the latest with the rls-cross-tenant activation PR
- AT-US-071-01 … AT-US-071-05: all 5 scenarios of US-071, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/authz/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-028 — Audit redaction and field classification registry

| Field | Value |
|---|---|
| Stories (completes) | US-091 (M0 Must) Redaction and field classification |
| REQs | REQ-AUDIT-008, REQ-AUDIT-009 |
| NFRs | NFR-PRIV-002, NFR-PRIV-003 |
| Spikes / security / decisions | PR8-SEC-10, D-ARCH-074, D-SEC-PR56-01, PR56-SEC-08, D-TASK029-21, D-ORCH-109, D-ARCH-141 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-025 |
| Batch · locks | 0.8 · pkg-audit-redaction, api-platform-core, api-routing |
| Branch | `feat/TASK-028-audit-redaction-field-classification-registry` |
| Priority | Must |

**Files / modules**
- packages/shared/src/classification/registry.ts
- packages/audit/src/redaction/**
- tests: classification completeness check over prisma/schema
- prisma/tests/catalog/c10-classification.int.test.ts (C10)
- packages/audit/src/redaction/user-agent.ts (in-house parser for ua_parsed; no dependency)
- apps/api/src/app.ts + apps/api/src/start-api.ts (AppDependencies carry the tokeniser, the IP index and the user-agent parser) and apps/api/src/platform/routing/pipeline.ts (defaultPipelineSlots passes them to createAuditCapture)

**Acceptance tests to write**
- All US-091 scenarios (SECRET removed, PERSONAL tokenised into the vault, 100 % PII columns classified)
- Catalog C10 (data-model §4.6; PR #11 code review m4 deferral; D-ARCH-074): every column of every table in `public` and `platform` (information_schema.columns) has a classification-registry entry; SYSTEM tables carry no PER/SPER column except `idempotency_keys.response_body` and the encrypted vault; every ciphertext/HMAC column of data-model §10.4 has its `<col>_key_id` sibling — asserted in the catalog suite against the live schema, not only in the prisma/schema completeness check
- PR8-SEC-10 (ADR-0008 am. 3 item 6, D-ARCH-069): the registry classifies every column of `permissions`, `roles` and `role_permissions` as INT except the four PUB text columns `permissions.description`, `permissions.category`, `roles.name_key`, `roles.description`; the completeness check over prisma/schema (authz.prisma included) fails on any unclassified column
- AUDIT CAPTURE COMPOSITION (D-SEC-PR56-01 condition 1; PR56-SEC-08; PR #56 code review R1-m1; D-TASK029-21; D-ORCH-109; D-ARCH-141; PRECONDITION: PR #56 of TASK-029 is on main): startApi builds the PII tokeniser (the vault under AUDIT_VAULT_KEY), the IP index (HMAC-SHA256 under AUDIT_INDEX_KEY, audit_entries.ip_hash) and the user-agent parser and passes them through AppDependencies and defaultPipelineSlots into createAuditCapture — pipeline.ts stays the single capture composition point (D-TASK029-20); DUE before or with the first PR that registers an audited or permission-gated route in moduleRegistry: in sheet order that is TASK-049 register, which now DEPENDS on this task (the listCountries route of TASK-026 is public with audit none and mounts without a tokeniser); the mount refusal of D-TASK029-21 (a capture without a tokeniser refuses audited routes and routes that can answer 403) stays as the backstop and keeps its tests; acceptance: an integration test builds the PRODUCTION composition (startApi, no test injection of the capture), sends one request that is refused with 403 and reads back exactly one PERMISSION_DENIED entry whose ip_token and user_agent_token resolve in the vault, whose ip_hash is set and whose ua_parsed is the parsed family; a second case mounts one audited fixture route and finds its entry; a composition without the tokeniser still refuses to mount
- USER-AGENT PARSER OWNER (D-TASK029-01..15 follow-up, where the owner was left to this task; D-ARCH-141): this task owns the parser, in packages/audit/src/redaction — in-house and dependency-free (ua-parser-js 2.x is AGPL-3.0-or-later, outside LICENSE_ALLOWLIST); output = browser family + major version / OS family only (data-model audit_entries.ua_parsed: INT, at most 120 characters, for example Firefox 146 / Windows), null for an unknown or empty value; the input is the raw header cut at 512 characters (the raw value is PERSONAL and is only tokenised); every pattern is linear-time (no nested quantifier) and a 512-character adversarial input is a unit case with an exact step bound, never a wall-clock bound (D-SEC-PR53-02); the output is assembled from a closed family table and digits only, so a crafted User-Agent cannot place free text into an INT column
- AT-US-091-01 … AT-US-091-06: all 6 scenarios of US-091, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`, `prisma/**`, `apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-029 — Automatic audit capture driven by route descriptors (middleware)

| Field | Value |
|---|---|
| Stories (completes) | US-086 **DC** (M0 Must) Automatic audit capture driven by route descriptors |
| REQs | REQ-AUDIT-001, REQ-AUDIT-006 |
| NFRs | NFR-AUDIT-001 |
| Spikes / security / decisions | D-062, D-ARCH-084, SPK-04, D-ARCH-085, D-ARCH-086, D-ARCH-122, D-ARCH-125, D-TASK029-01, D-ORCH-118, D-ARCH-143, D-ARCH-147 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-025, TASK-020 |
| Batch · locks | 0.8 · api-audit-mw, api-tenant-db, api-tx-execute, lint |
| Branch | `feat/TASK-029-automatic-audit-capture-driven-route` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/audit/{capture.ts, descriptor-runtime.ts} (capture.ts = createAuditCapture with mount and denied; the sheet named it audit-middleware.ts until fold 9: D-TASK029-01, PR #56 code review R1-n5)
- eslint.config.mjs (audit-writer allow-list entry; exact-file category api-pipeline-composition, D-TASK029-20)
- apps/api/src/platform/db/tenant-db.ts (statement tracking and the settle loop of PR42-SEC-17; the beforeCommit port of invariant I3) and apps/api/src/platform/tx/execute.ts (the audit hook as the last work of the handler transaction; the RouteReturnedError rollback; the committed flag) — shared hot files held through api-tenant-db and api-tx-execute (D-ORCH-118)

**Acceptance tests to write**
- All US-086 scenarios
- AT-US-008-03 audit hop (D-062): the descriptor-driven middleware writes the request correlation ID into every audit entry it creates — the entry FIELD is TASK-025 (US-087); the VALUE carried from the request is this task; test: a request with X-Correlation-Id creates entries whose correlation_id equals it, and a request without one carries the server-generated request id
- SPK-04 ORDERING AND OVERHEAD RULES (ADR-0007 am. 10; data-model §5.4 as rewritten 2026-11-13; D-ARCH-085/086): the middleware calls the writer ONCE per entry with the complete PII set, as the LAST database work of the business transaction (after the business statements, the outbox insert and the idempotency completion; nothing runs after the head-row lock but the CTE append and COMMIT; the T-83 lint forbids external calls in-tx); fail-closed VIEW/DOWNLOAD entries run in their own short withTenantTx after the result set is fixed and before the response is released, FAILED outcomes in a separate transaction; AUDIT_LOCK_TIMEOUT and TENANT_CONCURRENCY_LIMIT surface as problem+json 503 with Retry-After (never 500) and the business row is absent after the rollback — one integration test per class with a second session holding the head row FOR UPDATE
- D-ARCH-106 (ADR-0005 am. 11): the audit hook runs only at the end of the handler (write) transaction; the load phase of TASK-020 part 020-C is read-only and writes no audit entry; apps/api/src/platform/audit/** is a whole-file root of the T-83 lint (txFiles), so nothing in it may perform external I/O
- ONE FLUSH PER TRANSACTION (ADR-0007 am. 11 item 3; data-model section 5.4 as amended 2026-11-14; D-ARCH-122; PR #42 code review R1-m4): the writer gains record(tx, entry) (buffers per transaction; validation and PII marking at record time) and flush(tx): one multi-row vault INSERT + one lookup for ALL recorded entries, then the head locks in ascending stream_id byte order all before the first CTE, then ONE CTE per stream inserting the N entries of that stream with consecutive stream_seq and hashes chained in memory and advancing the head by N (WHERE entry_count = first_seq - 1, expectAffected(1)), then COMMIT; the audit hook of the tx slot calls flush as the last database work of the handler transaction (D-ARCH-106), so the capture middleware and the state machine both record; invariants: I1 exactly one flush per transaction, I2 a record after the flush or a second flush fails the transaction with 500 AUDIT_WRITE_FAILED kind WRITE_AFTER_FLUSH, I3 a recorded entry still unflushed when the callback returns fails the transaction (withTenantTx checks the per-transaction buffer through a small port; fail closed, O4), I4 write(db, entry) stays as record + flush for the FAILED-outcome and fail-closed VIEW transactions; tests: two entries on one stream commit with consecutive seq and chained hashes while a query spy shows one lock, one CTE and COMMIT; two streams lock in ascending order before the first CTE; I2 and I3 each have a test; the per-stream CTE lands in packages/audit/src/store HERE because this task merges before TASK-030 and the round-trip budget must hold at every merge (TASK-030 moves and proves it)
- STREAM EQUALS CONTEXT (PR #42 code review section 7 INFO; D-ARCH-122): before the flush the writer compares entry.orgId of every tenant entry with the app.org_id of the transaction (and requires the SYSTEM shard for an organisation-less transaction) and fails the transaction on a mismatch (500 AUDIT_WRITE_FAILED kind STREAM_MISMATCH) — audit_entries has no RLS, so this is the only guard against a capture bug writing the stream of org B from a transaction of org A; one test
- CONFIG CONSUMER (PR #42 code review R1-n5): the composition root passes DB_AUDIT_LOCK_TIMEOUT_MS from the validated config to createAuditWriter (or an auditWriterFromConfig helper) so that the guard validated below DB_TX_LOCK_TIMEOUT_MS has a runtime consumer; a test proves the configured value reaches the lock statement
- AT-US-087-04 VALUE HOP (D-ARCH-125): the entry IP is req.ip as computed by the TASK-041 trusted proxy chain (TRUST_PROXY_HOPS); this task copies it and never parses X-Forwarded-For itself; the forged-header api test is TASK-041 and US-087 stays partial there
- AT-US-086-01 … AT-US-086-07: all 7 scenarios of US-086, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-030 — Per-stream audit hash chain (JCS, head-row lock, stream heads) and SYSTEM shard key from a server-side id

| Field | Value |
|---|---|
| Stories (completes) | US-092 **DC** (M0 Must) Per-stream hash chain |
| REQs | REQ-AUDIT-012 |
| NFRs | NFR-AUDIT-003, NFR-AUDIT-005 |
| Spikes / security / decisions | SPK-04, SEC-P3-17, R-ARCH-04, D-ORCH-031, D-ARCH-085, D-ARCH-087, D-ARCH-089, D-TASK025-04, D-ARCH-122, PR56-SEC-06, PR54-SEC-02, D-SEC-PR54-03, D-SEC-PR56-01, D-ORCH-109, D-ARCH-143, D-ARCH-144 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-025, TASK-028, TASK-018 |
| Batch · locks | 0.9 · pkg-audit-chain, lint, api-tenant-db |
| Branch | `feat/TASK-030-per-stream-audit-hash-chain` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/audit/src/chain/{jcs.ts, hasher.ts, stream.ts, head-lock.ts}
- packages/audit/test/chain/** (incl. statement-sequence.int.test.ts, lock-timeout.int.test.ts, token-plan.int.test.ts)
- tools/eslint-rules/raw-sql-lexer.mjs + apps/api/src/platform/db/raw-statement.ts + tests/fixtures/sql/raw-statement-corpus.json (PR54-SEC-02 (b)(c): the reader family and run-time alter, in both lexer copies)

**Acceptance tests to write**
- All US-092 scenarios
- SEC-TC-57: 1,000 anonymous requests with crafted X-Correlation-Id spread over >= 12 of 16 SYSTEM shards
- SPK-04 FALLBACK SPEC (ADR-0007 am. 10 items 1, 2, 5, 7; data-model §5.4 as rewritten 2026-11-13; D-ARCH-085): statement sequence per entry = (1) ONE multi-row vault INSERT ... SELECT FROM unnest($arrays) ON CONFLICT DO NOTHING when the entry has PII, (2) ONE token lookup as a SEPARATE statement (unnest WITH ORDINALITY CROSS JOIN LATERAL index lookup per key), (3) head-row lock + head read + db clock in ONE statement — WITH lt AS MATERIALIZED (SELECT set_config(lock_timeout, $ms, true)) SELECT ... FROM audit_stream_heads h CROSS JOIN lt WHERE h.stream_id = $1 FOR UPDATE OF h — the advisory lock is REMOVED, (3b) only on an empty result: INSERT the head ON CONFLICT DO NOTHING then repeat (3), (4) ONE CTE statement WITH appended AS (INSERT INTO audit_entries ... no RETURNING) UPDATE audit_stream_heads ... WHERE stream_id = $1 AND entry_count = $seq - 1 with expectAffected(1), (5) COMMIT. EXIT E1 (statement-sequence test with a query spy): exactly these statements in this order, AT MOST 2 ROUND TRIPS FROM LOCK GRANT TO COMMIT INCLUSIVE, no statement between (3) and (4) but the in-process hash, no lock taken after the head lock; round trips per audited request create (3 PII) 8, update 9, fail-closed VIEW 9, SYSTEM 6 (+2 on the first entry of a stream)
- EXIT E2 LOCK FAIL-FAST (am. 10 item 2): DB_AUDIT_LOCK_TIMEOUT_MS (default 250, validated < DB_TX_LOCK_TIMEOUT_MS) applied by the set_config CTE of statement (3), PROVEN by a test holding the head row FOR UPDATE in a second session: the writer fails within timeout + 100 ms (not 2 s) with 55P03 mapped to DbError 503 AUDIT_LOCK_TIMEOUT (retryable, Retry-After 1; metric audit_lock_timeout_total{stream_kind=tenant|system}; histogram audit_lock_wait_ms{stream_kind} for TASK-280); FALLBACK if the CTE form does not bound the wait: a separate SET LOCAL lock_timeout round trip before (3), recorded in the PR report; after the rollback neither the business row nor the entry exists (O4)
- EXIT E3/E4 AND SQL RULES (am. 10 item 7): REQ-AUDIT-012 50 parallel writers on one stream -> 50 distinct predecessors, gap-free seq (kept); EXPLAIN (FORMAT JSON) of statement (2) against a >= 100k-row vault seeded in-test with generate_series shows an Index Scan or Index Only Scan on ux_audit_pii_vault__subject_field_value per key and no Seq Scan or Hash Join over the vault; multi-argument unnest and extract(epoch FROM ...) stay UNQUALIFIED (pg_catalog.unnest(a, b) = 42883; pg_catalog.extract(epoch FROM ...) = syntax error) and are the two recorded exceptions to the qualified-built-ins rule (data-model §8.3); arrays bound as typed parameters ($n::uuid[], $n::bytea[]) because TenantDb refuses Prisma.join / Prisma.sql; zero hash = 32-zero-byte parameter or decode(repeat(00, 32), hex), never text (42804, D-ARCH-087); microsecond timestamps read as ((extract(epoch FROM ts) * 1000000)::bigint)::text; informational micro-benchmark in the PR report (20 concurrent writers on one stream for 10 s on Testcontainers: lock-wait p50/p95 and round trips; no gate)
- SPK-04 LIFECYCLE (D-ARCH-089): port the pinned chain vector of prisma/tests/spikes/spk04/chain.test.ts into packages/audit/test/chain (the hasher reproduces it, or the PR documents the difference and its reason) and DELETE prisma/tests/spikes/spk04/{canonical.ts, canonical.test.ts, chain.ts, chain.test.ts} in the same commit; the rest of the spk04 tree is TASK-280's
- MOVE AND PROVE, NOT CREATE (D-TASK025-04 accepted by the PR #42 code review section 4; D-ARCH-122): statements 1/1b/2/2b/4, the per-stream multi-row CTE of TASK-029 and the hasher (SPK-04 pinned vector already reproduced in packages/audit/src/entry-hash.test.ts) exist in packages/audit/src/store/prisma-store.ts and entry-hash.ts; this task MOVES them into chain/** and PROVES them — E1 statement-sequence spy against the moved code for one entry, for N = 2 entries on one stream (one lock, one CTE, COMMIT) and for two streams (locks in ascending stream_id order before the first CTE); E2 held-row test incl. statement 2b (R1-n1: the create-head path waits under the 2 s transaction lock_timeout once per stream — covered or documented); E3; E4 EXPLAIN against the >= 100k-row vault for the shape the store actually binds (R1-n2: hex text[] decoded in SQL rather than $n::bytea[] — the PR #42 deviation to be recorded as D-TASK025-12 — the EXPLAIN tests that shape); the lifecycle step deletes the spike chain*/canonical* files; nothing already created is created again
- A TENANT TRANSACTION REFUSES AN ORGANISATION-LESS ENTRY (PR56-SEC-06, INFO; D-SEC-PR56-01; D-ORCH-109; D-ARCH-143): the stream check that this task moves becomes two-sided — an entry with no organisation recorded inside a transaction whose app.org_id is set fails the transaction with 500 AUDIT_WRITE_FAILED kind STREAM_MISMATCH, unless the entry names a targetOrgId equal to the organisation of that transaction (the operator cross-tenant case, TASK-060); the two existing refusals (a tenant entry of another organisation; an organisation entry in an organisation-less transaction) keep their tests; one new unit case and one PostgreSQL case; NOTE for the round-trip budget record (PR #56 code review R1-n3): every withTenantTx now pays one setImmediate turn before COMMIT (the PR42-SEC-17 settle loop) — measure it in the E1 statement-sequence run and report it; skipping the turn when the callback started no statement is an edit of tenant-db.ts that this task may make only because it holds api-tenant-db, and only if the measurement breaks the budget
- PR54-SEC-02 (b)(c) (LOW, CWE-488; D-SEC-PR54-02/-03; D-TASK020-96/-99; D-ARCH-144; DUE before the first raw statement of TASK-073, which depends on this task): in BOTH lexer copies (tools/eslint-rules/raw-sql-lexer.mjs and apps/api/src/platform/db/raw-statement.ts) the readers that build their own query — every function whose name starts with table_to_xml, schema_to_xml, database_to_xml or cursor_to_xml, the xmlschema and _and_xmlschema variants included — join DYNAMIC_SQL as an anywhere-form refused case-insensitively (a quoted upper-case spelling too, as D-TASK020-99), and alter becomes a refused first keyword at run time (ALTER ROLE CURRENT_USER SET reaches the guard today; the no-alter-role-sql lint and the session-integrity monitor stay); one corpus row per name in tests/fixtures/sql/raw-statement-corpus.json, one PostgreSQL 18 case showing table_to_xml over audit_entries refused before the server, and the template census of the PR #54 record repeated (expected: no real template changes verdict); a later SQL-text extension (dblink, crosstab, xpath_table) joins the same list (D-SEC-PR54-03); this part changes security-owned paths outside packages/audit and rides the one security record of this PR
- AT-US-092-01 … AT-US-092-06: all 6 scenarios of US-092, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`, `apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-031 — Audit field-level diffs and no-op update suppression

| Field | Value |
|---|---|
| Stories (completes) | US-090 (M0 Must) Field-level diffs and no-op updates |
| REQs | REQ-AUDIT-007 |
| NFRs | NFR-AUDIT-006 |
| Spikes / security / decisions | D-TASK029-19, D-ARCH-143, PR61-SEC-11, D-SEC-PR61-03, D-ORCH-135, D-SD-001 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-025 |
| Batch · locks | 0.9 · pkg-audit-diff, pkg-audit-redaction |
| Branch | `feat/TASK-031-audit-field-level-diffs-no` |
| Priority | Must |

**Files / modules**
- packages/audit/src/diff/**
- packages/shared/src/logging/string-redaction.ts (+ test) and packages/audit/src/redaction/denylist.ts: token68 credential shape and the key=value pair predicate (one predicate change; D-ORCH-135)

**Acceptance tests to write**
- All US-090 scenarios
- CAPTURE SEAM OPEN (D-TASK029-01..15 follow-up list; D-TASK029-19; found at fold 9, D-ARCH-143): the capture of TASK-029 writes no old and new values and no reason, and it refuses routes that declare x-audit additional entries; this task delivers the diff library of US-090 — the seam through which a handler hands the old and new values, the reason and the additional entries to the capture is NOT designed on this card: the orchestrator requests a principal-architect ruling on that seam before this task is dispatched, and the ruling names the task that wires it into apps/api/src/platform/audit
- ONE PREDICATE CHANGE (D-ORCH-135: PR #61 code review R2-m1 and PR61-SEC-11, LOW, CWE-212, D-SEC-PR61-03), due before the diff builder records free-form values: (1) R2-m1 - TOKEN68_CREDENTIAL in packages/shared/src/logging/string-redaction.ts (used by the audit denylist) requires the token68 part to look like a credential (a digit, an inner capital or one of + / = . _ ~ -, or at least 20 characters), so "DHL Express Basic shipping", "Basic Delivery service", "Token generation failed", "Apikey rotation scheduled", "Negotiate discounts quarterly" and a URL with a query stay readable while "Basic dXNlcjpwYXNz" stays redacted; the 19 credential value shapes of the PR #61 record stay a regression table; (2) PR61-SEC-11 - a narrow key=value pair predicate on the log KEY_SEPARATOR grammar with isSecretKey, skipping a bare scope:action pair, redacts credentials written as pairs inside a string (form bodies such as ...&client_secret=<v>, JSON bodies as strings, cookie, Set-Cookie and x-reauth-proof header text, password=<v> in prose), plus flat rawHeaders lists, { Name, Value } records with case-insensitive members and the key names kek and dek, while business values such as session:manage and reset_password stay readable; linear on 1 MiB adversarial input (child-process scaling test); the log path (redactString) changes only if the security record asks for it
- AT-US-090-01 … AT-US-090-06: all 6 scenarios of US-090, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-032 — Server-controlled standard columns, UTC time and on-behalf seam (Prisma client extension)

| Field | Value |
|---|---|
| Stories (completes) | US-064 (M0 Must) Server-controlled standard columns, UTC time and the on-behalf seam |
| REQs | REQ-RLS-009, REQ-RLS-012, REQ-ORG-007 |
| NFRs | NFR-DATA-002, NFR-DATA-003 |
| Spikes / security / decisions | — |
| Specialist · model | database-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-016 |
| Batch · locks | 0.9 · prisma-ext |
| Branch | `feat/TASK-032-server-controlled-standard-columns-utc` |
| Priority | Must |

**Files / modules**
- apps/api/src/platform/db/extensions/standard-columns.ts
- packages/shared/src/ids/uuidv7.ts
- tests for mass-assignment of server columns

**Acceptance tests to write**
- All US-064 scenarios (client-supplied id/org_id/created_* ignored or rejected; timestamps UTC timestamptz)
- AT-US-064-01 … AT-US-064-07: all 7 scenarios of US-064, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-276 — Test harness: generated Jest project, factories, fake-clock helpers, leakage scanner, sentinel set, Mock scenario helper, query counter

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-PERF-006, NFR-PRIV-001, NFR-QUAL-006 |
| Spikes / security / decisions | T-QA-03, D-QA-002 |
| Specialist · model | test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-003, TASK-008, TASK-017 |
| Batch · locks | 0.9 · tests-harness |
| Branch | `feat/TASK-276-test-harness-generated-jest-project` |
| Priority | Enabler |

**Files / modules**
- tests/factories/** (typed, seeded, <run>.test.invalid e-mail domains)
- tests/helpers/{fake-clock.ts, leakage-scanner.ts, sentinels.ts, mock-scenario.ts}
- apps/api/src/platform/db/query-counter.ts
- jest.config.ts generated project

**Acceptance tests to write**
- Factories are deterministic per seed; parallel workers never collide
- Leakage scanner fails a test whose logs contain a sentinel PII/secret value (NFR-PRIV-001)
- Query counter reports per-request query counts to the API suite

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`, `jest.config.ts`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-033 — Audit test generator and immutability-per-role suite

| Field | Value |
|---|---|
| Stories (completes) | US-096 **DC** (M0 Must) Audit test generator<br>US-094 **DC** (M0 Must) Database-enforced immutability and its tests |
| REQs | REQ-AUDIT-024, REQ-AUDIT-014, REQ-AUDIT-015 |
| NFRs | NFR-AUDIT-001, NFR-AUDIT-002 |
| Spikes / security / decisions | T-QA-04, SEC-TC-43, SEC-TC-61, PR12-SEC-01, PR12-SEC-02, D-SEC-PR12-01, D-ARCH-076, D-ARCH-079, D-ARCH-081, SPK-04, D-ARCH-085, D-ARCH-086, PR24-SEC-10, PR27-SEC-02, D-ARCH-099, D-ARCH-112, D-SEC-TM-01, D-ORCH-099, D-ARCH-135, PR42-SEC-17, PR56-SEC-13, PR56-SEC-01, PR56-SEC-04, D-TASK029-09, D-SEC-PR56-01, D-SEC-PR56-02, D-ARCH-143, D-PM-081, D-PM-084, D-SD-009 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-029, TASK-030, TASK-027, TASK-021 |
| Batch · locks | 0.10 · tests-gen-audit |
| Branch | `feat/TASK-033-audit-test-generator-immutability-per` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/audit/src/generator/**
- tests/generated/audit/{audit-generator.api.test.ts, immutability.int.test.ts}
- required-suites.json entries audit-generator, audit-immutability (security: true)

**Acceptance tests to write**
- All US-096 scenarios (every mutating route writes exactly one entry in-transaction)
- US-094 test scenarios: UPDATE/DELETE attempts fail for every DB role
- PR12-SEC-01 (LOW) escalation primitives in immutability.int.test.ts (qa-lead amends the SEC-TC-61 row text): as platform_migrator, each in attempt(), expect 42501 with the PRIVILEGE message for SET ROLE platform_audit_owner; CREATE FUNCTION public.spk() then ALTER FUNCTION public.spk() OWNER TO platform_audit_owner; REASSIGN OWNED BY in both directions; DROP OWNED BY platform_audit_owner; SET ROLE platform_definer then ALTER FUNCTION ... OWNER TO platform_audit_owner (the migrator does hold SET on platform_definer); as the test superuser expect the GUARD message for ALTER TABLE audit_entries DISABLE TRIGGER ALL, DETACH PARTITION <p>, TRUNCATE audit_entries (AUDIT_IMMUTABLE) and TRUNCATE <partition>; DETACH PARTITION <p> CONCURRENTLY through execute() then assert pg_inherits.inhdetachpending and document the residue; the CASCADE case (an audit-owner CHECK calling a migrator function, then DROP FUNCTION ... CASCADE as the migrator -> guard message via sql_drop); INHERIT drift (grant the migrator platform_audit_owner WITH INHERIT TRUE, SET FALSE inside a rolled-back transaction, then DISABLE TRIGGER ALL -> guard message); mutation check: temporarily granting SET turns the SET ROLE case green-to-red; SPK-08 §8 Q1: the guard raises "cannot resolve the protected schemas" when the audit owner owns nothing; F-05/F-07/F-10 ports and the AF-series writer pitfalls (alias ORDER BY, microsecond timestamps, uuidv7 under the lock)
- PR12-SEC-02 tests (D-ARCH-076; data-model §5.3 item 4): as the migrator CREATE INDEX audit_entries_<now+5 months> ON public.probe(id) -> guard message, repeated for CREATE VIEW, CREATE SEQUENCE, CREATE TYPE ... AS (a int) and CREATE TYPE ... AS ENUM; with the guard disabled in a rolled-back superuser variant: SELECT platform.ensure_audit_partitions(6) raises AUDIT_PARTITION_NAME_TAKEN and the readiness query returns unavailable plus audit_partition_squatted; unit test of the readiness arithmetic (one missing month at +1 or +2 -> unavailable; ONLY month current+3 missing -> degraded with HTTP 200, which is the AT-US-012-04 fixture "the next audit partition is missing", D-ARCH-081; current..+3 all present -> ok); C6/C14 expect ENABLE ALWAYS (A)
- SPK-04 CONTENTION SCENARIOS (ADR-0007 am. 10 items 2-3; data-model §5.4/§7.7; D-ARCH-085/086) on two representative routes (one CREATE with PII, one fail-closed VIEW): (a) a second session holds the head row FOR UPDATE -> the route answers 503 AUDIT_LOCK_TIMEOUT with Retry-After within DB_AUDIT_LOCK_TIMEOUT_MS + 100 ms and neither the business row nor an entry exists afterwards; (b) org A parks cap + 2 transactions -> org B is served within 100 ms and the org A overflow gets 503 TENANT_CONCURRENCY_LIMIT; catalog assertions: platform_app holds SELECT, INSERT, UPDATE and no DELETE on audit_stream_heads (the FOR UPDATE stream lock depends on the UPDATE grant) and no table references audit_stream_heads by foreign key (data-model §3.4 as amended)
- D-ARCH-093 (PR #24 code review R2-n1; data-model §5.2 amendment of 2026-11-13): one planted TABLE squat is dropped as platform_migrator and the sql_drop refusal (42501) is asserted, so the runbook claim of TASK-090 is tested; a rename-away probe (the squat renamed to a non-audit name, then dropped) is run and its outcome recorded in the data-model §5.2 removal table — either a migrator-reachable removal path for migrator-owned table squats, or a pinned refusal
- CIC LEFTOVER CASES (PR24-SEC-10; data-model §5.2 amendment of 2026-11-13, second block; D-ARCH-099; each case runs on a CLONE database made from a template, because CREATE INDEX CONCURRENTLY cannot run in a transaction block and so cannot be rolled back): (a) as platform_migrator CREATE INDEX CONCURRENTLY under a partition name on a scratch table is refused with the guard message (42501) and a migrator-owned index with indisvalid false remains; (b) the readiness evaluation is unavailable with that name and the audit_partition_squatted event is emitted; (c) an unrelated migrator DDL statement is refused by the invariant; (d) ALTER INDEX the leftover RENAME TO a non-audit name succeeds as the migrator, an unrelated DDL statement then succeeds, DROP INDEX of the renamed index succeeds and readiness returns to ok; (e) with two leftovers, renaming either is refused while the other remains, DROP INDEX a, b and DROP TABLE of the carrying table are refused, a superuser DROP INDEX is refused, and BEGIN; SET LOCAL event_triggers = off; DROP INDEX a, b; COMMIT succeeds; in every case evtenabled is A on both event triggers afterwards
- PR27-SEC-02 (D-SEC-PR27-01; the SPK-04 runner asserted SPK-08 prototype values, which must not become the expectation): C14 and the immutability suite assert the PRODUCT state — audit_entries has NO row-level-security row (C1 allow-list), every audit trigger and partition clone has tgenabled = A and both event triggers have evtenabled = A — and a planted ALTER TABLE ... ENABLE TRIGGER in origin mode on an audit trigger, and a planted ALTER EVENT TRIGGER ... ENABLE in origin mode, each FAIL C14; the four superuser legs plus TRUNCATE are exercised
- HEAVY.MJS ACCEPTS THE generated PROJECT (PR #34 code review R1-m4, PR34-SEC-04, PR34-SEC-05; D-ARCH-112; tools/quality is code-owned, so the PR carries a security record; DUE before the Wave-0-exit activation PR, the first time lane B runs a generated suite): this task is the last generated suite before that PR and the review named it as the owner, so it carries the edit unless an earlier PR already did: tools/quality/heavy.mjs adds generated to JEST_PROJECTS and to IN_BAND_PROJECTS (lane B passes -i and --testTimeout for the in-band projects, which is the working timeout lever because the project-level testTimeout of jest.config.ts is a no-op in Jest 30.5.2) with heavy.test.ts cases (a manifest suite with project generated validates, a misspelt project still fails); activation of the generated suites stays a manifest-only qa-lead PR after it; if this task merged without it, devops-engineer makes it in a small tools/quality PR before the activation PR
- SEC-TC-72 (proposed ID, D-SEC-TM-01; qa-lead adopts it through required_cases_pending with checkpoint G3 and keeps the clone-database family apart from SEC-TC-43): the CIC LEFTOVER CASES above carry [SEC-TC-72] in their titles; lane B only, because they need template clone databases
- PR #52 CODE REVIEW R1-m2 (D-ORCH-099; D-ARCH-135): the immutability suite proves the 91-audit-actions-v2.sql upgrade on a NON-EMPTY store — on a database that already applied 10-audit.sql and 90-audit-ddl-guard.sql one entry with a v1 action (LOGIN) exists for organisation X before the bootstrap lane applies 91; after it, that row is unchanged (action, entry_hash, prev_hash) and a SESSION_REVOKED entry for the same organisation gets stream_seq = 2 with prev_hash equal to the first entry hash (chain continuity across the DDL); lane B (template clone database); qa-lead assigns the SEC-TC id
- T0 TIMER RESIDUAL BACKSTOP (PR42-SEC-17 residual; D-TASK029-09; D-SEC-PR56-01/-02; D-ARCH-143; before G3): the capture settles deferred audit starts through statement tracking and the setImmediate loop, but a write first started from a timer after the handler returned escapes it — this generator is the backstop: for every mutating route that exists the generated case asserts exactly one entry committed in the same transaction as the business change (entry and row visible together, or neither), and one negative fixture route that starts its audited write from a timer must FAIL the generated case; this activates the audit-generator suite (qa-lead moves SEC-TC-74 to required_cases with it)
- HANDLER-RAISED 403 AND THE GENERATOR CASES OWED (PR56-SEC-13, INFO; PR56-SEC-01; PR56-SEC-04; D-SEC-PR56-01/-02; D-ARCH-143): (a) DR-A10 defines DENIED as rejected by authorisation or by a security control, but a 403 AUTHZ_DENIED thrown or returned by a handler after the authorisation slot writes no entry (a returned 403 rolls back silently): the generator gains a fixture route with an object-level 403 and a case titled [PR56-SEC-13 OPEN] that pins the current behaviour (no entry) — security suites carry no skipped case, so the capture change must flip it; the capture change itself (a DENIED path for AUTHZ_DENIED after authorisation) is TASK-060, not this task; (b) PR56-SEC-01: on a list route the filter values %00, empty and a 9 KiB value each answer 200 with exactly one VIEW entry (NORMAL and SENSITIVE variants); (c) PR56-SEC-04: a route declaring x-audit additional entries refuses to mount until the recording seam exists (TASK-031 line)
- IDEMPOTENCY REFUSALS IN THE GENERATED AUDIT SUITE (D-PM-081 as narrowed by D-PM-084; REQ-AUDIT-010 as amended; qa-lead report): for every mounted idempotent mutating route, no FAILED entry (and a log line with the code and the correlation id) for 409 IDEMPOTENCY_IN_PROGRESS refused before the handler or any external call, for 422 IDEMPOTENCY_KEY_REUSED, and for a stored response that cannot be read back (which also raises one ERROR event without key or body); exactly one FAILED entry for a 409 or 422 that the handler produced, for the 5xx of a claim that fails on a new request, and for a claim lost after call (409 IDEMPOTENCY_IN_PROGRESS plus WARN api.idempotency_claim_lost); the rows run on the routes that exist when the suite runs and grow with each task that mounts an idempotent operation (part 040-B of TASK-040 and the 33 cards of D-SD-007)
- AT-US-096-01 … AT-US-096-07: all 7 scenarios of US-096, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-094-01 … AT-US-094-06: all 6 scenarios of US-094, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Wave 0 exit: the M0 demo step "Generators pass" runs green on the routes that exist
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-034 — Backup/restore rehearsal and zero-downtime migration probe tooling (guardrail before data-changing migrations)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-AVAIL-003, NFR-DATA-004, NFR-REC-003 |
| Spikes / security / decisions | CLAUDE.md §5 Database, PR5-SEC-14, PR11-SEC-11, SPK-08, D-ARCH-079, PR293-SEC-04, D-SECPR293-02, D-ORCH-139, D-SD-002, D-ARCH-172, D-TASK293-10, D-SD-004 |
| Specialist · model | database-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-003, TASK-014 |
| Batch · locks | 0.10 · db-tools-backup, prisma-core |
| Branch | `feat/TASK-034-backup-restore-rehearsal-zero-downtime` |
| Priority | Enabler |

**Files / modules**
- tools/db/{backup.ts, verify-restore.ts, zero-downtime-probe.ts}
- docs/07-ops/runbooks/backup-restore.md
- tools/db/{lint-migrations.ts, sql-text.ts} (+ tests) (PR293-SEC-04; this task is the next holder of the tools/db linter after TASK-293, D-SD-002)

**Acceptance tests to write**
- Backup + restore into a scratch DB with row-count and checksum comparison green; a data-changing migration without a fresh verified backup is refused by the migration linter
- Zero-downtime probe runs continuous reads/writes across an expand migration with 0 errors
- PR #5 code review R3-n2 / PR5-SEC-14 (bundle with PR5-SEC-13): tools/db/reset.ts resetTarget returns the validated URL ({ database, maintenanceUrl, bootstrapUrl: string }) and main passes target.bootstrapUrl, so the db:reset guard is a type and pg can never fall back to PGHOST/PGDATABASE/PGUSER defaults; connectPrivileged refuses a config without a non-empty connectionString; unit test: DATABASE_BOOTSTRAP_URL unset -> main returns 1 and connectPrivileged is never called; SPK-08 F-01: the post-restore migrate status/deploy uses the root prisma.config.ts with the generated tables.external window; PR11-SEC-11 d FALLBACK: readSecret open-once/fstat hardening if PR #11 merged without it
- PR293-SEC-04 (INFO, CWE-184; D-SECPR293-02; routed by D-ORCH-139 to the next holder of the tools/db linter, which is this task by D-SD-002): (a) the fallback for a routine or DO body that does not lex has no ; statement start, so a quoted name holding ; hides a following data-changing statement from rule 10 - give the fallback the same code-; split as the lexed path, with the contrived shape of the record as a test; (b) string literals read as dynamic SQL make prose such as '... in update mode' a rule-10 hit - keep it fail-closed or narrow it to EXECUTE arguments, and pin the choice with a test; the 81 lint fixtures stay identical and every adversarial shape stays linear (the TASK-293 linearity tests); code review R2-n1 of PR #72 (non-ASCII routine names) is already CLOSED in PR #72 round 3 and needs nothing here; tools/db is security-owned, so the PR needs a delta security round on the linter change
- RULE 14 REFUSES CREATE CAST AND CREATE AGGREGATE (D-ARCH-172; D-TASK293-10; PR293-SEC-01 rows 4 and 5): add both statement starts to REFUSED_OBJECTS of tools/db/lint-migrations.ts with one failing fixture each; the two stated limits and their pin rows go; attribute notation stays a stated limit
- DATA-MODEL TEXT FOR RULE R (D-TASK034-01; D-SD-011): data-model 8.3 gains rule R (a data-changing: yes migration needs a fresh rehearsal.json: sha256 of migration.sql, backup head = the previous migration, a passed verification of the same manifest) and 8.6 step 6 names rehearsal.json; principal-architect writes both at the next architecture fold
- SUITE ACTIVATION AFTER MERGE (D-SD-011): after this task merges qa-lead activates restore-rehearsal in tools/quality/required-suites.json in a manifest-only pull request, never in this PR

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-277 — Test-ID traceability tooling: quality:trace (ac-trace.json), gen-gherkin-map and quality:flake-report

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-QUAL-006 |
| Spikes / security / decisions | T-QA-02, T-QA-08, D-QA-002 |
| Specialist · model | devops-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-011 |
| Batch · locks | 0.10 · quality-trace |
| Branch | `feat/TASK-277-test-id-traceability-tooling-quality` |
| Priority | Enabler |

**Files / modules**
- tools/quality/{trace.mjs, gen-gherkin-map.mjs, flake-report.mjs}
- root scripts quality:trace, quality:flake-report

**Acceptance tests to write**
- quality:trace extracts AT-/NT-/SEC-TC-/J- IDs from every JUnit file and writes ac-trace.json; an ID not in the maps fails (no orphan tests)
- gen-gherkin-map regenerates docs/05-quality/tests/gherkin-test-map.md identically from the story files (drift test)
- flake-report lists tests with mixed outcomes over stored runs

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-278 — Generated abuse suite (IDOR, mass assignment, privilege escalation) from route metadata

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-SEC-011 |
| Spikes / security / decisions | T-QA-04 |
| Specialist · model | test-engineer · opus |
| Complexity | M |
| Depends on | TASK-020, TASK-027 |
| Batch · locks | 0.10 · tests-gen-abuse |
| Branch | `feat/TASK-278-generated-abuse-suite-route-metadata` |
| Priority | Enabler |

**Files / modules**
- tests/generated/abuse/**
- required-suites.json suite abuse (security: true) activated

**Acceptance tests to write**
- Every route with a path id or body gets IDOR and mass-assignment cases; an uncovered route fails the suite
- Suite active and zero-skip by the end of Wave 0 (T-QA-04)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-283 — api/worker image headroom: targeted node_modules prunes with measured yields (worker <= 270 MiB, api <= 255 MiB)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-OPS-002 |
| Spikes / security / decisions | D-ARCH-118, D-ORCH-061, R-ARCH-31, D-ARCH-125, PR53-SEC-05, PR53-SEC-06, D-SEC-PR53-02, PR54-SEC-04, D-ORCH-087, D-ORCH-104, D-ARCH-136 |
| Specialist · model | devops-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-014 |
| Batch · locks | 0.11 · infra-compose, lint |
| Branch | `feat/TASK-283-api-worker-image-headroom-targeted` |
| Priority | Enabler |

**Files / modules**
- tools/docker/prune-dist.mjs (or a sibling prune-node-modules.mjs) with one entry per prune of rulings/wave-0-task-014-rulings.md section 4.3 (a)-(d)
- tools/docker/prune-dist.test.ts (one case per prune: the pruned path is absent and the kept entry still resolves)
- apps/{api,worker}/Dockerfile (prune step after the production install; no base-image change)
- tests/compose/images.stack.test.ts (budget and WARN threshold unchanged at 300 MiB / 90 %; the PR body quotes both images before and after)
- tools/docker/{image-exports.test.ts, preflight.test.ts} (SKIPPED_EXPORTS pin; scan of every root workspace incl. prisma; every condition key)
- tools/docker/prune-dist.mjs (removes the runtime target of every SKIPPED_EXPORTS subpath of every workspace)
- eslint.config.mjs (no-restricted-imports @platform/*/testing + boundaries test-category arm; raw-statement lint widened to packages/*/src if PR #54 did not) + tests/fixtures/lint/** (this task takes the lint lock)
- tests/compose/images.stack.test.ts (PR #39 R2-n1) and packages/config/src/entry-preflight.test.ts (PR #39 R2-n3)

**Acceptance tests to write**
- EXIT (D-ARCH-118): worker <= 270 MiB and api <= 255 MiB measured as the sum of docker history layer sizes (platform.md section 3.4), with the entrypoint preflight, the healthcheck and the stack suite green; the PR body lists the yield of each prune in MiB against the measured plan (pdfkit alternate bundles about 3, zod sources and unused entry trees about 3-4, stripe dual build about 2, foreign bcrypt prebuilds 0.9, Prisma CJS twins 0.4) and names any prune that was skipped and why
- SAFETY: every pruned entry is proven dead by the preflight (the kept entry loads in the image) and by a stack case per prune; node_modules test and tests folders stay (runtime code lives there in some packages); swagger-ui-dist is not pruned (by design, rulings section 4.3 (f)); no base image, Node binary or Debian layer change (that is the recorded R-ARCH-31 lever and needs a superseding ADR-0001 amendment)
- TELEMETRY PRUNE IS NOT HERE: the sdk-node to explicit-SDK change (about 8 MiB) belongs to TASK-214 (ADR-0017 amendment 2026-11-14); this task records the post-prune baseline the TASK-214 PR body compares against
- WARN THRESHOLD: after this task merges a [stack] WARN line (>= 90 %) in any lane B run reopens R-ARCH-31 (lever decision by principal-architect)
- IMAGE EXPORTS AND SKIPPED_EXPORTS (PR #53 code review R3-n1/R3-n2; PR53-SEC-06; D-SEC-PR53-02; D-ORCH-104; D-ARCH-136): tools/docker/image-exports.test.ts (or preflight.test.ts) pins expect(SKIPPED_EXPORTS).toEqual([./testing]) with a comment that widening it needs a security record; asserts that every ./testing export target of every workspace IS pruned; scans the root workspaces list incl. prisma/package.json (not only apps/* and packages/*); follows every condition key except types and @platform/source (or asserts that the condition-key set stays exactly {@platform/source, types, default}); the wildcard wording is corrected (placeholder substitution, not expansion)
- TEST HELPERS NEVER SHIP AND ARE LINT-CONFINED (PR #53 code review R3-n3; PR53-SEC-05; D-ARCH-136 — the ./testing convention): (a) prune-dist removes the runtime target of every SKIPPED_EXPORTS subpath (./testing) of every workspace whatever its path, so @platform/config/testing (dist/testing/) leaves both images without moving its source; the image preflight keeps skipping ./testing; the stack suite asserts the absence of packages/config/dist/testing in both images; (b) eslint.config.mjs: the repository-wide no-restricted-imports gains the patterns group @platform/*/testing and @platform/*/testing/* (message: test helpers, test files only), switched off for TEST_FILES and the test-support harnesses, and a boundaries policy arm refuses a non-test app or package file importing a file of category test (covers ../routing/tests/*.js and any spelling that resolves into a tests/ folder); the 17-case probe of the PR #53 security record R2.4.3 is the fixture set — A1-A4 and W5 refused, K1 and the real suites lint-clean; (c) PR54-SEC-04 second half if PR #54 did not take it: the raw-statement lint (db-raw-sql raw-statement forms) is widened from apps/*/src to packages/*/src with the audit store as the positive fixture; this task therefore holds the lint lock besides infra-compose
- PR #39 R2-n1 / R2-n3 (D-ORCH-087): tests/compose/images.stack.test.ts adds -path */dist/tests/* to the node_modules-excluded find group and asserts the absence of *.test.ts among the tooling image sources; packages/config/src/entry-preflight.test.ts gains the in-process negative case (argv without -- expects exit code 78, through jest.isolateModulesAsync or a query-string re-import)
- NOT HERE: the worker main.ts line-27 comment (D-TASK020-91; PR #54 R1-n6) — this task does not touch apps/worker/src/main.ts (images only; a changed comment line there fails the merged diff-coverage gate because no in-process test can load the entry point), so the comment goes with the startWorker refactor on TASK-035 (D-ARCH-136)

**DoD notes**
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Images only: no application code; Dockerfiles and tools/docker are owned paths, so a security record is required (PR #39 precedent)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-284 — Anonymous admission classes (auth reserve, per-guest keys, public) under one anonymous ceiling, and bounds that keep the tenant bulkhead on

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-SEC-005, NFR-TENANT-001 |
| Spikes / security / decisions | PR42-SEC-01, PR42-SEC-08, D-SEC-PR42-01, D-ORCH-064, D-ARCH-120, D-ARCH-121, R-ARCH-32, D-ORCH-118, D-ARCH-147 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-025, TASK-020 |
| Batch · locks | 0.11 · api-db-admission, api-tenant-db, api-tx-execute, api-routing |
| Branch | `feat/TASK-284-anonymous-admission-classes-under-one` |
| Priority | Enabler |

**Files / modules**
- apps/api/src/platform/db/tenant-admission.ts (classes, ceiling, reserves, key kinds anon_auth | anon_guest | anon_public)
- apps/api/src/platform/db/with-tenant-tx.ts (TenantContext.admissionClass; resolveAdmissionOptions takes the pool size)
- apps/api/src/platform/tx/execute.ts (the tx slot: tenantContextOf derives the admission class from route.rateLimit and the guest token hash; the slot lives in platform/tx, not platform/routing — corrected at fold 9)
- packages/config: DB_ANON_MAX_CONCURRENT_TX, DB_ANON_AUTH_RESERVE, DB_ANON_GUEST_RESERVE + databaseGuard bounds (+ .env.example placeholders; no pkg-config lock taken, D-ORCH-020 precedent)
- tests/generated/route-metadata.ts (derived admission class vs x-rate-limit-class)

**Acceptance tests to write**
- ADR-0007 am. 11 item 1 (D-ARCH-120; PR42-SEC-01 MEDIUM): organisation-less transactions are admitted by class — auth when route.rateLimit is auth or email-send, guest:<hash> when app.guest_token_hash is non-empty, public otherwise; tenant and operator keys unchanged; all anonymous classes together hold at most DB_ANON_MAX_CONCURRENT_TX permits (default = the tenant cap, validated <= it); reserves DB_ANON_AUTH_RESERVE (default max(1, floor(ceiling / 2))) and DB_ANON_GUEST_RESERVE (default 1 when ceiling >= 4, else 0; auth + guest <= ceiling - 1); a class is admitted while inflight(class) < ceiling - sum over the other classes of max(inflight, reserve); each guest key holds at most min(2, ceiling - auth reserve); FIFO wait, depth, 503 TENANT_CONCURRENCY_LIMIT and release in finally unchanged; gauge kinds anon_auth, anon_guest, anon_public; the worker passes no class (jobs carry an organisation or run as SYSTEM_JOB)
- TESTS (PR42-SEC-01 verification): unit test in the D3b shape of the PR #42 security review — 15 slow public loops leave >= 95 % of auth admissions granted and a second guest key is admitted while one guest key floods; the reserve formula is pinned for ceiling 2 and 5 (public can always run); api test — a public flood on listCountries while createSession answers non-503 at its normal rate; tests/generated/route-metadata.ts asserts the derived class of every mounted route against the x-rate-limit-class of the contract (auth and email-send -> auth; everything else -> public, or guest by token)
- ADR-0007 am. 11 item 2 (D-ARCH-121; PR42-SEC-08): databaseGuard refuses DB_TENANT_MAX_CONCURRENT_TX > max(2, floor(DB_POOL_MAX / 2)) (not only > pool), DB_AUDIT_LOCK_TIMEOUT_MS > min(2000, DB_TX_STATEMENT_TIMEOUT_MS - 1), DB_ANON_* outside the rules above, and DB_POOL_MAX < 4 when APP_ENV is neither local nor test; resolveAdmissionOptions takes the pool size and refuses a cap above half of it (unit test: the factory rejects cap 2^53 - 1 and cap = pool); values.test GUARDS.length updated
- DUE: a dependency of TASK-052 (first auth-class emitter; the orchestrator does not dispatch TASK-052 before this task merges); if PR #42 has not merged when this task starts it reports BLOCKED naming PR #42 (same files)
- LATENT TEST DEFECT (D-ORCH-148; S4): packages/config/src/load-config.test.ts:136 asserts that the rendered error does not contain abc, and the rendered error includes a stack path, so it fails in any worktree whose path holds that substring; carried by whichever of TASK-284, TASK-041 part 041-B and TASK-015 part 015-C first changes a test under packages/config, the others drop it: strip stack paths before the check or use a sentinel that cannot be a path substring

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Security-critical path (apps/api/src/platform/db/**): security record required; security-analyst adds the T-xx / SEC-TC text for the anonymous flood in the next threat-model round (the record names it)
- Shared hot files (D-ORCH-118; D-ARCH-147): with-tenant-tx.ts and platform/tx/execute.ts are held through api-tenant-db and api-tx-execute, and tests/generated/route-metadata.ts through api-routing — this task is not dispatched while another in-flight PR holds one of them (TASK-029 until PR #56 merges; later TASK-040 and TASK-030)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`, `apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-285 — Audit action vocabulary v2: bootstrap file widening ck_audit_entries__action with MFA_RECOVERY_USED and SESSION_REVOKED (REQ-AUDIT-002)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-073) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields |
| REQs | REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 |
| NFRs | NFR-AUDIT-001 |
| Spikes / security / decisions | D-TASK025-03, D-SEC-PR42-01, D-ORCH-061, D-ARCH-119, D-TASK285-01, D-TASK285-02, D-SEC-PR52-01, D-ARCH-135 |
| Specialist · model | database-engineer · opus |
| Complexity | S |
| Depends on | TASK-021, TASK-025 |
| Batch · locks | 0.11 · prisma-bootstrap-audit |
| Branch | `feat/TASK-285-audit-action-vocabulary-v2-bootstrap` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/bootstrap/91-audit-actions-v2.sql (D-TASK285-01, ratified by D-ARCH-135: 91 because the ledger and check-migration-immutability refuse a bootstrap file that sorts before the released 90-audit-ddl-guard.sql; SET ROLE platform_audit_owner; one ALTER TABLE public.audit_entries DROP CONSTRAINT ck_audit_entries__action, ADD CONSTRAINT ck_audit_entries__action CHECK (action IN (the 20 REQ-AUDIT-002 values in that order)); rule-12 marker)
- packages/audit/src/actions.ts (AUDIT_ENTRY_ACTIONS gains MFA_RECOVERY_USED and SESSION_REVOKED; the header paragraph about the missing values goes)
- packages/audit/src/actions.test.ts (parity against the EFFECTIVE constraint: the last ck_audit_entries__action definition across prisma/bootstrap/*.sql in file order)
- prisma/tests/catalog (C9 pins pg_get_constraintdef of ck_audit_entries__action against AUDIT_ENTRY_ACTIONS)

**Acceptance tests to write**
- AT-US-087-07 (CHECK half; D-TASK025-03; ADR-0007 am. 11 item 4): after the bootstrap lane runs on a fresh database and on a database that already applied 10-audit.sql and 90-audit-ddl-guard.sql, an entry with action MFA_RECOVERY_USED and one with SESSION_REVOKED are written through the writer and read back; the CHECK still rejects FOO (23514); the identity guard admits the ALTER because the file runs as platform_audit_owner; the ledger records the file once and a re-run is a no-op
- RULE 12 AND IMMUTABILITY: 10-audit.sql is not edited (check-migration-immutability refuses it); the new file carries -- @audit-ddl security-approved: <reviewer> <date>, approved by security-analyst on the final blob before merge; the migration linter and the bootstrap runner accept the file; the DDL is ONE statement so a partial run cannot leave the table without its CHECK; the CHECK propagates to every audit_entries_YYYY_MM partition (asserted in C9 or an integration test on one partition)
- PARITY: actions.test.ts parses the effective constraint (not only 10-audit.sql) and fails when the two files disagree with AUDIT_ENTRY_ACTIONS; the contract enums (openapi AuditEntry.action, AuditEntrySummary.action, filter[action]) list 18 values until TASK-073 lands the api-designer change request (D-TASK285-02; D-ARCH-135), so a compile-time pin states the exact gap and flips to equality then; the descriptor-action proof of TASK-025 stays green
- EMITTERS ARE NOT HERE: TASK-059 writes SESSION_REVOKED (REQ-AUTH-004) and TASK-061 writes MFA_RECOVERY_USED (REQ-AUTH-017), both depend on this task; the sessions-screen clause of AT-US-087-07 is the US-027 sessions task; US-087 completes with TASK-073 (AT-US-087-08)
- Covers the scenarios of AT-US-087-01 … AT-US-087-08 that belong to its layer; US-087 closes in TASK-073

**DoD notes**
- Bootstrap-lane DDL (owned path prisma/bootstrap/**): security record required; no down.sql (bootstrap files have none; local rollback is db:reset); additive CHECK widening, not data-changing
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`, `prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-286 — CI-minutes stage 2: scans folded into ci-gate, CODE-gated commitlint/actionlint/install, proof re-read in ci-gate, audit and signatures on every push, TOOLS_REF bootstrap (policy PR first)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-015) | US-006 (M0 Must) Coverage gate |
| REQs | REQ-PLAT-008 |
| NFRs | NFR-OPS-003 |
| Spikes / security / decisions | D-ARCH-128, D-ARCH-129, D-ORCH-078, D-ORCH-100, D-ORCH-101, D-ORCH-103, PR46-SEC-11, PR46-SEC-12, PR46-SEC-15, PR46-SEC-16, PR46-SEC-17, PR42-SEC-18, D-ARCH-132, D-ARCH-133, R-ARCH-15 |
| Specialist · model | devops-engineer · opus |
| Complexity | S |
| Depends on | TASK-015 |
| Batch · locks | 0.11 · ci-workflows |
| Branch | `feat/TASK-286-ci-minutes-stage-2-scans` |
| Priority | Must |

> Scheduling note: Late task (fold 8, D-ARCH-132) scheduled in batch 0.11 beside TASK-283/284/285 (distinct locks); already dispatched.

**Files / modules**
- tools/ci/check-workflow-policy.mjs (+ test) — the POLICY PR: the new topology is pinned (ci-gate holds the former scans steps, needs: [fast-lane, security-integration], !cancelled(); CODE-gated commitlint, actionlint, install; Vulnerability audit and Registry signatures unconditional; the ci-gate tooling step pinned like CI_GATE_TOOLING_SCRIPT)
- .github/workflows/ci.yml — the WORKFLOW PR after the policy PR merged
- tools/ci/lane-scope.mjs (+ test): ci-gate re-reads CODE_PROOF and SECURITY_PROOF through the jobs API with the PR #46 binding; a proof is bound to the base the run tested; a security proof is bound to the manifest suite list
- tools/ci/security-paths.mjs (+ test): devOptional entries count as production closure (D-ARCH-133)
- .github/dependabot.yml (open-pull-requests-limit: 1 for the npm group; D-ORCH-078 P3)
- docs/04-plan/spikes/SPK-07.md section 6 (billed minutes of the first stage-2 runs)

**Acceptance tests to write**
- ADR-0023 am. L item 3 (a) (D-ARCH-128): two PRs, policy first because the base-ref policy of main pins the topology; after both merged a docs push bills about 2 minutes and a code push about 5.9 (measured on the first runs and recorded in SPK-07 section 6); scans is gone — ci-gate runs gitleaks, Semgrep and openapi-breaking with base-ref tooling and no npm, needs: [fast-lane, security-integration] with !cancelled(); security-integration needs fast-lane and reads its base-ref lane-scope outputs (token on that step only); commitlint, actionlint and the install are CODE-gated; Semgrep and openapi-breaking run when code_changed or no code proof; wall-clock with security-integration stays <= 15 min median and <= 20 min (NFR-OPS-003)
- PR46-SEC-11 (D-SEC-PR46-02; replaces the 24 h proof-age interim rule of D-SEC-PR46-03): Vulnerability audit and Registry signatures run on every push, light mode included (their CI_REQUIRED_GATES ifs become [], after an npm ci that stays unconditional when the audit is); policy fixture: a workflow whose audit step is CODE-gated fails
- PR46-SEC-12 (D-SEC-PR46-02/-03): the ci-gate tooling step is pinned exactly (a constant through pinnedScriptProblems), no step may sit between it and the lane-scope step except the pinned Security-critical paths step, the run line reads node "${GATE_LANE_SCOPE:?}", and ci-gate re-reads CODE_PROOF and SECURITY_PROOF through the jobs API (the same fastLaneProblems, scansProblems and securityIntegrationPassed checks) and is red on a mismatch; the X3 and X4 mutants of the PR #46 record become required-gates findings
- PR46-SEC-15/-16/-17 (D-SEC-PR46-03/-04; D-ORCH-103; ADR-0023 am. M items 2 and 5): pull-requests: read is confined to the lookup steps like actions: read; a proof is accepted only when main has gained no non-docs commit since the proof run was created (or an equivalent signal that binds the proof to the base it tested), so P1 becomes mechanical; base-ref tooling for pull_request runs bootstraps from TOOLS_REF = the first parent of the merge ref (the tip of main at run time) instead of RANGE_BASE = the merge base, so a PR whose merge base predates a tooling change can still start lane A (PR #53 run 43736296983) and a gate added to main reaches every PR at its next run; RANGE_BASE keeps classifying the diff
- PR42-SEC-18 (D-SEC-PR42-03): the Lint step env (the NODE_OPTIONS heap line) is pinned by the workflow policy; D-ORCH-078 P3: Dependabot npm group open-pull-requests-limit: 1
- D-ARCH-133 (PR #46 code review R2-m2): the production-closure lockfile rule counts devOptional entries as production (the Prisma CLI, engines and config are optional dependencies of production packages and the integration harness applies migrations with the CLI); fixtures: a devOptional-only Prisma CLI bump selects security-integration, a dev-only bump still does not; the D-TASK015-59 refinement (ignore root devDependencies) may follow in the same PR once this holds
- DUE: must merge in November 2026 (D-ORCH-078; forecast 103 % on 2026-11-15, D-ORCH-100); dispatched 2026-11-15 on branch ci/TASK-286-cigatefold before this card existed (D-ORCH-101) — the STATUS row is authoritative for its state and branch
- Covers the scenarios of AT-US-006-01 … AT-US-006-03 that belong to its layer; US-006 closes in TASK-015

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Workflows and tools/ci are security-owned paths: a security record per PR; the policy PR merges before the workflow PR; the base-ref policy of main pins every topology change
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-287 — Incremental fast lane: jest --changedSince with the diff-coverage gate, ESLint cache, incremental tsc -b, affected-workspace builds (ADR-0023 am. A incremental mode)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-015) | US-006 (M0 Must) Coverage gate |
| REQs | REQ-PLAT-008 |
| NFRs | NFR-OPS-003 |
| Spikes / security / decisions | D-ARCH-128, D-ORCH-078, SPK-07, D-ARCH-132, R-ARCH-15, D-TASK286-01a, D-TASK286-06a, PR55-SEC-05, PR55-SEC-10, PR55-SEC-11, PR57-SEC-02, PR46-SEC-08, PR59-SEC-01, D-SEC-PR55-02, D-SEC-PR57-01, D-SEC-PR59-01, D-ORCH-109, D-ORCH-114, D-ORCH-116, D-ARCH-139, D-ARCH-140, D-SEC-PR57-02, D-ORCH-119, D-SEC-PR62-01, PR62-SEC-01, PR62-SEC-02, D-ORCH-135, D-SECPR287B-01, D-SECPR287C1-01, PR287B-SEC-01, PR287B-SEC-02, PR287C1-SEC-01, D-ORCH-136, D-ORCH-137, D-ORCH-138, D-SD-002 |
| Specialist · model | devops-engineer · opus |
| Complexity | M |
| Depends on | TASK-286 |
| Batch · locks | 0.12 · ci-workflows |
| Branch | `feat/TASK-287-incremental-fast-lane-jest-changedsince` |
| Priority | Must |

> Scheduling note: Late task (fold 8, D-ARCH-132) in the new batch 0.12 after TASK-286.

**Files / modules**
- .github/workflows/ci.yml (fast-lane incremental steps; cache keys for node_modules, ESLint and *.tsbuildinfo)
- tools/ci/check-workflow-policy.mjs (+ test): full-trigger paths and the incremental steps pinned
- tools/ci/lane-scope.mjs (+ test): full-trigger classification — package-lock.json, jest.config.*, tsconfig*.json, eslint.config.*, packages/shared/**, packages/config/**, docs/03-architecture/api/openapi.yaml, .github/** force the full run
- tools/ci/{coverage-run.mjs, diff-coverage.mjs}: the changedSince scope equals the diff-coverage denominator
- tools/ci/security-paths.mjs (+ test): SECURITY_INTEGRATION_PATHS widened per ADR-0023 am. N item 1
- tools/ci/check-workflow-policy.mjs (+ tests) and tools/ci/lane-scope.mjs: the with: maps pinned, TESTED_BASE_SCRIPT with the HEAD == GITHUB_SHA line, the stage-1 branches and tools/ci/fixtures/stage-1/ci.yml removed
- .github/dependabot.yml and docs/07-ops/CI-CD.md (part 287-C3: the Dependabot procedure for the pinned actions, 287-C1 code review R1-n4)

**Acceptance tests to write**
- ADR-0023 am. A incremental mode as re-stated by am. L item 3 (b) (D-ARCH-128): on a code push the unit project runs jest --changedSince=<range base> with the diff-coverage gate over the same changed set, ESLint runs with a restored cache, tsc -b reuses cached *.tsbuildinfo and only affected workspaces build; a full-trigger path forces the non-incremental run; full-mode fast-lane <= 3.5 billed minutes median, measured on the first ten runs and recorded in SPK-07 section 6
- SAFETY: the changed set is computed by base-ref tooling from the push range (lane-scope), never by head code; a restored cache cannot skip a step whose inputs changed (cache keys include the lockfile hash and the config files); the policy pins the incremental steps and refuses --changedSince without the diff-coverage gate; an empty or unknown range runs full (fail closed)
- MEASUREMENT: ci:minutes --forecast before and after; the steady-state target is about 64-72 % of the allowance with stage 2 and P1/P2 (ADR-0023 am. L item 4)
- PART ORDER (D-ARCH-140; D-SEC-PR59-01; D-ORCH-116; this task was dispatched on 2026-11-17 as O1 of D-ORCH-119, before fold 9 — the STATUS row and the dispatch brief are authoritative for its state, and the orchestrator relays this order): 287-A is a POLICY PR (tools/ci only, no workflow file): PR59-SEC-01 item 1 and the policy half of item 2, the stage-1 retirement, PR55-SEC-05 and the trigger list — all three lines below; 287-B is the WORKFLOW PR that adds the HEAD == GITHUB_SHA line to ci.yml, plus the PR #62 follow-ups of the 287-B line below (D-ORCH-135); 287-C is the incremental fast lane of this card (its own policy-then-workflow pair). 287-A and 287-B are due BEFORE ANY OTHER PR that changes .github/workflows/** merges — 015-C, a Dependabot actions bump and 287-C included; until 287-B is on main the orchestrator merges a workflow PR only when a security record on the branch names its code head (D-ORCH-116): ci-gate success alone is not enough
- PR59-SEC-01 (LOW, CWE-693 and CWE-345; D-SEC-PR59-01): (1) stage2Findings pins the with: maps exactly — every checkout { fetch-depth: 0, persist-credentials: false }; setup-node of fast-lane and security-integration { node-version-file: .node-version, cache: npm, cache-dependency-path: package-lock.json }; setup-node of ci-gate { node-version: 24 } — so ref:, repository:, path:, submodules:, persist-credentials: true and fetch-depth: 1 are required-gates findings (probes G1-G7 of the record); (2) two-step, policy first: TESTED_BASE_SCRIPT gains the check that git rev-parse HEAD equals GITHUB_SHA on pull_request runs, so a checkout that moves HEAD fails closed (the runner sets GITHUB_SHA and the policy refuses GITHUB_* in every env map); the live ci.yml stays at 0 findings after each step; (3) the merge checklist keeps the record-names-head rule for workflow PRs as a standing line
- STAGE-1 RETIREMENT (PR #55 code review R1-m2; PR55-SEC-10; D-TASK286-01a; due in the first ci-workflows change of this task after the TASK-286 workflow PR is on main = part 287-A): remove CI_REQUIRED_GATES (stage 1), laneScopeFindings, the stage-1 branches of topologyOf / requiredGatesFor / tokenFindings / gate() / proofSteps and tools/ci/fixtures/stage-1/ci.yml with its tests, so a ci.yml that restores a scans job is a required-gates finding; until then the PR46-SEC-11 24 h proof-age rule applies to any stage-1 ci.yml and to any merge whose final lane A run was a stage-1 run (D-SEC-PR59-01 section 5); the stage-1 scans masking of PR55-SEC-11 item 3 ends with it; ALSO PR55-SEC-05 (INFO): rule (g) compares the separate fast-lane outputs — mode, code_proof, security_integration_due and tools_ref are passed into the aggregation and must equal the classification the gate computes itself (a differing tools_ref gives BLOCKED), or security-integration recomputes TOOLS_REF with the pinned TESTED_BASE_SCRIPT; OPTIONAL (D-TASK286-06a): a docs push that has no valid code proof runs the full lane instead of ending BLOCKED: no code proof — taken only if the measured cost is lower than the re-push it saves; the choice is recorded with the devops re-forecast of D-ORCH-117 and decides no budget figure on this card
- SECURITY-INTEGRATION TRIGGER LIST (PR57-SEC-02, LOW, escalating PR46-SEC-08; D-SEC-PR57-01; D-ORCH-114; ADR-0023 am. N item 1; D-ARCH-139; in part 287-A): SECURITY_INTEGRATION_PATHS gains jest.config.ts, tools/test-support/**, tools/db/**, tools/deps/**, tests/generated/rls/** and tests/generated/api-mounts.ts with the exclusions !tools/test-support/**/*.test.ts, !tools/db/**/*.test.ts, !tools/db/fixtures/** and !tools/deps/**/*.test.ts (path-scoped negations: they cannot exclude a prisma/** or packages/** test); path corpus in security-paths.test.ts — selected: jest.config.ts, tools/test-support/fs-lock.ts, tools/db/table-classes/audit.json, tools/deps/prisma-engines.json, any path under tests/generated/rls, tests/generated/api-mounts.ts; not selected: tools/test-support/fs-lock.test.ts, a path under tools/db/fixtures/lint, tools/deps/ignore-scripts.test.ts, tools/ci/lane-scope.mjs; the parity test with the manifest copy stays green and the header comment (the left-out paths do not change what the suites exercise) is corrected; base-ref rule: the list takes effect for the PRs after it merges; the plan generator imports SECURITY_INTEGRATION_PATHS and globsMatch from this file to write the card DoD line (ADR-0023 am. N item 2) — keep both export names and the glob dialect, and after the merge the orchestrator re-runs gen.mjs --write so the cards follow the list; still open with PR46-SEC-08: .npmrc and apps/worker/src/platform/** (security-analyst to rule)
- CACHE HYGIENE (D-SEC-PR57-02 note; D-TASK288-09): the test locks of TASK-288 live under node_modules/.cache/shipqube-test-locks, so every CI cache that this task introduces or keys (node_modules, ESLint, *.tsbuildinfo) excludes that directory — a restored stale lock would make a suite wait or take over a lock it does not own; one policy or workflow-test case pins the exclusion
- 287-B ALSO CARRIES (D-ORCH-135; PR #62 code review r1; D-SEC-PR62-01): (1) R1-m1 - voidedByBase in tools/ci/lane-scope.mjs is set only when (i) no bound, non-voided completed run exists on the identical code set and (ii) at least one voided run would have been a proof (its jobs pass fastLaneProblems and scansProblems; one jobs call per voided run inside MAX_API_CALLS), with the two probe cases in the run(...) it.each of lane-scope-stage-2.test.ts; if (ii) is judged too expensive, take (i) and reword SPK-07 6.1, CI-CD.md 1 and the code comment to what the code does; (2) R1-m2 - the push-event gate case is ported to the stage-2 it.each (a push with security_paths true and securityIntegration skipped: mode full gives MERGE-READY, a light push gives code gates skipped on a code push); (3) NITs R1-n1 (stale stage-1 wording in check-workflow-policy.mjs, security-paths.mjs, lane-scope.mjs and the ci.yml CI_REQUIRED_GATES name), R1-n2 (CI-CD.md restates the ADR-0023 am. N item 3 residual instead of the overclaim), R1-n3 (the G-rows for path, submodules, fast-lane repository and security-integration repository in ci-policy-stage-2.test.ts), R1-n4 (CI-CD.md docs-push figure 3.5, measured 4) and R1-n5 (a D-TASK287A entry at merge); (4) PR62-SEC-02 (INFO, condition): the transitional acceptances end - the policy accepts V2 only and the four FAST_LANE_* aggregation entries become required - before any other ci.yml PR merges
- 287-C CONDITION (D-ORCH-135; PR62-SEC-01, LOW, CWE-829/CWE-693, A08:2021; D-SEC-PR62-01), policy first in the 287-C policy PR: the action steps of the three pinned jobs accept exactly the key set {name, uses, with}, so a step env: (NODE_EXTRA_CA_CERTS, HTTPS_PROXY, GIT_DIR, GIT_CONFIG_GLOBAL, GIT_TEMPLATE_DIR, ACTIONS_ALLOW_UNSECURE_COMMANDS and others) is a finding, and checkout, setup-node and cache each have one exact pinned commit (no other 40-hex commit, a fork-network commit included, passes); CI-CD.md 5 restates the residual; until then the security record of any PR that changes a ci.yml uses: line checks the new commit against the upstream tag and checks that no action step gained env:
- STATE AND 287-C SPLIT (D-SD-002; D-TASK287C-01 in the PR #70 body; D-ORCH-137/138): 287-A (PR #62, 7109563), 287-B (PR #68, 05de264) and 287-C1 (PR #70, 8084977) are MERGED. 287-C is split into 287-C1 policy (merged: PR62-SEC-01 action-step keys {name, uses, with} and exact action commits, PR287B-SEC-01 absent FAST_LANE_* entries reported, PR287B-SEC-02 exact job keys and runs-on ubuntu-24.04, the run-full refinements that close 287-B code review R1-m1 and R1-n1 to R1-n4, and the cache-hygiene tripwire), 287-C2 = the incremental-lane POLICY PR (tools/ci only: lane-scope changedSince scope, the coverage-run and diff-coverage pairing, the full-trigger list and the policy pins of the incremental steps), and 287-C3 = the WORKFLOW PR (ci.yml incremental steps and cache keys, dependabot.yml). Order: 287-C2 merges before 287-C3; no workflow caches node_modules or node_modules/.cache before 287-C2 is on main. The 287-C CONDITION line above is CLOSED by 287-C1; the 287-B ALSO CARRIES line is closed except as stated here
- PR287C1-SEC-01 FIRST IN 287-C2 (LOW, CWE-693/CWE-1023, A08:2021; D-SECPR287C1-01; 287-C1 code review R1-n2): the cache-hygiene rule fails closed - any actions/cache, cache/restore or cache/save path line that covers node_modules/.cache/shipqube-test-locks or an ancestor (the whole workspace ., ./, ${{ github.workspace }}, an absolute runner path, an expression-valued path, a ? or [...] or {a,b} glob, node_modules, node_modules/.cache) is a finding with NO exclusion escape, because @actions/cache 6.x archives each matched directory recursively; the finding message and CI-CD.md stop recommending the exclusion form; tests: the 29 forms of the security record (13 that restore the locks today) are findings and the exact-path caches the lane uses stay clean; a delta security round names the 287-C2 code head
- 287-C2/C3 RESIDUAL NITS (287-C1 code review PR-0070 section 3; optional, next touch of the same file): R1-n1 test pin that only CODE and scans step failures count (failedOnCode), R1-n3 / D-TASK287C-04 residual (a non-voided full run red at an every-push step), R1-n5 (ambiguous duplicated scans step; a voided run with a red scans step test row), R1-n6 (compare the whole uses: value, not the first two @ segments), R1-n7 (CI-CD.md wording of run-full and of the record location); 287-B code review R1-n3 residue: the ci.yml comment rewraps ride 287-C3; 287-B code review R1-n5 (a D-TASK287 entry in DECISIONS.md) is the orchestrator's
- 287-C3 DEPENDABOT PROCEDURE (287-C1 code review R1-n4): from 287-C1 on, a monthly Dependabot github-actions group PR that bumps checkout, setup-node or cache is red at the tested-base policy until a policy PR pins the new commits; 287-C3 records the procedure (policy PR first with the upstream tag check, then the bump) in CI-CD.md, and either splits the dependabot.yml github-actions group so the three pinned actions arrive as their own PR or states why the group stays; lane-c.yml and nightly.yml action commits follow the repository-wide table of TASK-015 part 015-C (PR287C1-SEC-02)
- Covers the scenarios of AT-US-006-01 … AT-US-006-03 that belong to its layer; US-006 closes in TASK-015

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Workflows and tools/ci are security-owned paths: a security record; the base-ref policy pins the change; no path of the full-trigger list is dropped without a principal-architect amendment
- Three parts (287-A policy, 287-B one-line workflow change, 287-C incremental lane): each PR changes security-owned paths and needs its own record; this card decides no CI-minutes budget figure (D-ORCH-117)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/config/**`, `package-lock.json`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-288 — TASK-W0-FLAKE-2: prisma/generated reader-side tree lock for static @platform/prisma/client importers in unit tests

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-MAINT-002 |
| Spikes / security / decisions | D-ORCH-083, D-ORCH-098, D-ORCH-099, D-SEC-PR53-01, D-SEC-PR53-02, PR53-SEC-01, PR53-SEC-02, PR53-SEC-03, D-ARCH-137 |
| Specialist · model | test-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-276, TASK-003 |
| Batch · locks | 0.12 · root, tests-harness |
| Branch | `feat/TASK-288-task-w0-flake-2-prisma` |
| Priority | Enabler |

> Scheduling note: Late task (fold 8, D-ARCH-137) in batch 0.12; the orchestrator tracks it under its alias TASK-W0-FLAKE-2.

**Files / modules**
- jest.config.ts (unit project setupFiles entry) or a shared test-support module (tools/test-support/prisma-tree-lock.ts) that every apps/api unit suite loads before @platform/prisma/client resolves
- prisma/tests/harness (the existing PRISMA_TREE_LOCK writer side; no behaviour change)
- a lock test: a suite started while deps:rebuild regenerates prisma/generated waits for the lock and never sees a half-written client

**Acceptance tests to write**
- D-ORCH-098 RESIDUAL (D-ORCH-083 race): apps/api unit tests that import @platform/prisma/client statically take the prisma/generated reader lock before the import resolves (a Jest setup file or a shared package, never per-suite boilerplate), so deps:rebuild or an engine test regenerating prisma/generated mid-run cannot break a parallel unit suite; measurement: 20/20 runs green under load with a regeneration started mid-run (the PR #53 method: heartbeat-based upper bounds, exact lower bounds; the D-SEC-PR53-02 standing rule — no CPU-bound, ReDoS, redaction-growth or scaling check uses timeOperation)
- PR53-SEC-01..03 RESIDUE (INFO; D-SEC-PR53-01): whatever PR #53 fix cycles 1-2 left of the timeOperation JSDoc and the two NITs is closed here, or recorded as closed with the PR #53 head commit in the PR body
- NOT HERE (single owner, D-ARCH-137): PR #48 code review R1-m4 (observe() per-request deadline and named transport errors in tests/generated/rbac/runner.ts) is TASK-289 (TASK-027-F), which owns that file — D-ORCH-099 routed it here and D-ORCH-094 there; the file owner wins

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Test infrastructure only, no production code; jest.config.ts is a full-trigger path (a non-incremental lane A run); the root lock is taken for jest.config.ts
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `jest.config.ts`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-289 — TASK-027-F: RBAC matrix follow-up — whole-response foreign-credential comparison and signature-header callers, oracle subpath, observe() deadline, seam truth in labelling

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-027) | US-071 **DC** (M0 Must) RBAC matrix test generator |
| REQs | REQ-RBAC-011 |
| NFRs | NFR-SEC-011, NFR-TENANT-002 |
| Spikes / security / decisions | PR48-SEC-01, PR48-SEC-03, PR48-SEC-05, PR48-SEC-06, D-SEC-PR48-01, D-ORCH-094, D-ORCH-099, D-ARCH-134, D-ARCH-137, PR48-SEC-06, D-SD-003 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-027 |
| Batch · locks | 0.12 · tests-gen-rbac, pkg-authz, lint |
| Branch | `feat/TASK-289-task-027-f-rbac-matrix` |
| Priority | Must · demo-critical |

> Scheduling note: Late task (fold 8, D-ARCH-137) in batch 0.12; the orchestrator tracks it under its alias TASK-027-F.

**Files / modules**
- tests/generated/rbac/{runner.ts, matrix-app.ts, rbac-matrix.api.test.ts}
- packages/authz/src/generator/matrix.ts (signature-header foreign callers)
- packages/authz/package.json exports ./matrix + packages/authz/src/index.ts (the oracle leaves the production entry point)
- eslint.config.mjs (no-restricted-imports @platform/authz/matrix for non-test files + boundaries arm) + tests/fixtures/lint/** (one negative and one positive fixture)
- docs/03-architecture/generated/rbac-route-matrix.md (regenerated)

**Acceptance tests to write**
- PR48-SEC-01 + PR #48 code review R1-m1 + R1-n2 (LOW; DUE before TASK-052 or TASK-055 merges — dependency edges on TASK-052 and TASK-060 added by D-ARCH-137): foreign cells compare the whole response minus volatile parts (status; sorted headers without date, x-correlation-id, connection, keep-alive, content-length; the problem body without instance and correlation_id) with the no-credential response, so a foreign credential that adds Set-Cookie or WWW-Authenticate or changes a refusal body fails; the generator adds one foreign caller per real signature header name (signature-header:<name> presenting <name>: t=0,v1=0) for every route without signature in its auth set; the admin refresh cookie is presented as a foreign credential too; a fake-server unit test for the RBAC runner with pinned problem strings (the RLS runner precedent) and the S1-S4 mutation controls of the record make every check load-bearing
- PR48-SEC-03 (LOW; DUE before TASK-060 merges): the oracle (expectCell, generateMatrix, cellProblems and the rest) moves to the @platform/authz/matrix subpath and @platform/authz (the production entry) no longer exports it; no-restricted-imports refuses @platform/authz/matrix from non-test files and a boundaries arm refuses the resolved file from the app and package categories; fixtures: a production authorise importing the oracle fails lint, the generated suite passes
- PR #48 R1-m4 (single owner, D-ARCH-137): observe() in runner.ts gets a per-request deadline (AbortSignal.timeout with its magnitude pinned per the D-SEC-PR53-02 rule) and a named transport error that identifies the cell (operation, caller) instead of aborting the 900 s contract layer anonymously
- PR #48 R1-m2 + R1-n1/n3 + PR48-SEC-05 items 1-3 (truth in labelling): the seams resolve only DECLARED kinds, so the test titles and JSDoc say the matrix proves presentedKinds, the stub and authorise — not the authenticators and not the credential and actor gates of authorise (those stay with authorise.test.ts until the seams retire, D-ARCH-134); SEC-TC-01 gains the route-reached positive control (the caller with its own organisation first, x-rbac-matrix: authorised); path parameters inside a segment (/x/:orgId.json) are enumerated or refused; the matrix app exports the list of still-stubbed credential kinds so the TASK-052 tripwire can compare it with the mounted authenticators
- NOTE FROM TASK-041 (D-SD-003): the matrix app passes no rateLimit option to createApp, so the step-0 and step-5 limiters are absent from the matrix runs (PR48-SEC-06 seam); the seam is retired when a matrix run needs real limits
- Covers the scenarios of AT-US-071-01 … AT-US-071-05 that belong to its layer; US-071 closes in TASK-027

**DoD notes**
- tests/generated/rbac is the O3 RBAC oracle and packages/authz a security-critical path: security record required; the regenerated matrix document is reviewed cell by cell (expected: only the signature-header foreign rows are new)
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/authz/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-290 — TASK-024-F: SQL splitter structural fix for BEGIN ATOMIC bodies, shadow-init KEEP balanced-parenthesis form, paren-gate fixture, stale describe title

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-024) | US-077 (M0 Must) Generated cross-tenant isolation tests |
| REQs | REQ-RLS-007 |
| NFRs | NFR-DATA-004 |
| Spikes / security / decisions | PR43-SEC-11, PR52-SEC-01, D-SEC-PR43-05, D-SEC-PR52-01, D-ORCH-074, D-ORCH-082, D-TASK024-13, D-ARCH-135, D-ARCH-137 |
| Specialist · model | database-engineer · opus |
| Complexity | S |
| Depends on | TASK-024, TASK-285 |
| Batch · locks | 0.12 · tests-gen-rls, prisma-core |
| Branch | `feat/TASK-290-task-024-f-sql-splitter` |
| Priority | Must |

> Scheduling note: Late task (fold 8, D-ARCH-137) in batch 0.12; the orchestrator tracks it under its alias TASK-024-F; TASK-027 already absorbed the API-case-runner half (D-ORCH-082).

**Files / modules**
- tools/db/sql-text.ts (+ test): splitStatements
- tools/db/shadow-init.ts (+ test): the KEEP form
- tools/db/lint-migrations.test.ts (rule L fixtures)
- tools/db/render-rls-dr-a14.test.ts (describe title)
- the repository .sql corpus (488 files split identically before and after; the PR body shows the count)

**Acceptance tests to write**
- PR43-SEC-11 (LOW; D-SEC-PR43-05; structural fix validated on a scratch copy by security-analyst): inside a BEGIN ATOMIC body, case and begin atomic are counted as openers only where PostgreSQL treats them as such — CASE depth is tracked per body statement and fails closed to rule L at the semicolon that leaves it open, a nested BEGIN ATOMIC counts only after a routine head (CREATE [OR REPLACE] FUNCTION | PROCEDURE), and a later top-level END never resynchronises a swallowed block; fixtures: SELECT 1 AS case, t.case, SELECT 1 case (bare label) and SELECT begin atomic FROM ... each followed by a hostile statement (GRANT TRUNCATE, DROP TABLE, SET lock_timeout) stay split and the hostile statement is reported; every .sql file of the repository splits identically to main
- PR #43 code review R2-n1 and R2-n3: the paren-depth gate is pinned by a fixture with a parenthesised AS case or t.end inside an atomic body followed by a hostile statement (mutant s2 dies); the render-rls-dr-a14 describe title names the 2026-11-14 amendment (D-ARCH-123)
- PR52-SEC-01 (LOW; D-SEC-PR52-01 (2); DUE before the next prisma/bootstrap/*.sql file merges — every task that adds one after PR #52 lists this task as a merge prerequisite, D-ARCH-135): the shadow-init KEEP form for a same-name CHECK replacement is a prefix match plus a balanced-parenthesis scan that skips quoted identifiers, so the closing parenthesis of the CHECK must be the last character and the dropped constraint must be the CHECK being replaced; the 7 controls of the record keep their outcome, the 6 bypass shapes (NOT VALID, NO INHERIT or NOT ENFORCED followed by another action; a second DROP CONSTRAINT; ADD COLUMN with a CHECK; a PK replacement) are refused with at least 5 refusal fixtures, and the real 91 statement still renders
- DATA-MODEL 8.3 (D-TASK024-13; fold 8 amendment, D-ARCH-135): rules 18, 19, 20 and L are listed in the data model as the code implements them; this task reconciles any wording difference it finds and says so in the PR body
- Covers the scenarios of AT-US-077-01 … AT-US-077-04 that belong to its layer; US-077 closes in TASK-024

**DoD notes**
- tools/db is a security-owned path (CODEOWNERS): security record required; no migration and no bootstrap file; the lint and splitter run in lane A, so a mutant that weakens them is a base-ref no-weakening finding
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-291 — TASK-W0-FLAKE-3: one-shot loopback transport for the generated suites and a pooled-fetch ratchet, PR #57 R1-n4 and R1-n6

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-MAINT-002 |
| Spikes / security / decisions | D-ORCH-113, D-TASK288-08, D-TASK020-100, D-TASK029-25, D-SEC-PR53-02, D-SEC-PR57-01, D-ARCH-146, D-TASK288-15, D-TASK289-06, D-ARCH-158 |
| Specialist · model | test-engineer · opus |
| Complexity | M |
| Depends on | TASK-288, TASK-289 |
| Batch · locks | 0.13 · tests-harness, api-routing, tests-gen-rls |
| Branch | `feat/TASK-291-task-w0-flake-3-one` |
| Priority | Enabler |

> Scheduling note: Late task (fold 9, D-ARCH-146) in the new batch 0.13; the orchestrator tracks it under its alias TASK-W0-FLAKE-3; narrowed on 2026-11-19 by D-ARCH-158 to what was built — the prerender item, the under-load tables and the later routings are TASK-294.

**Files / modules**
- tests/generated/route-metadata.test.ts (five pooled fetch call sites, assertion 10 included) and apps/api/src/platform/routing/tests/loopback.ts (fetchOnce and closeLoopbackServer: the one transport)
- tests/generated/rls/{api-cases.ts, api-cases.test.ts} (the runApiCase transport; the server close order)
- tests/generated/{loopback-scan.ts, loopback-ratchet.test.ts, loopback-fetch-allowlist.json} (the ratchet: a scan with a checked-in allow-list of the test files that still call the global fetch against a loopback server; a plain test of the unit project, so lane A runs it on every PR) and .github/CODEOWNERS (the three loopback ratchet files; code review r1 R1-m1)
- tools/db/prisma-client-locked.test.ts + tools/db/prisma-client-locked.cjs (PR #57 R1-n4) and the eleven withFileLock importers under prisma/tests (PR #57 R1-n6; test files only)

**Acceptance tests to write**
- ONE TRANSPORT FOR LOOPBACK SUITES (D-ORCH-113 (a) and (d); D-TASK288-08; D-TASK029-25/-26; D-ARCH-146): the global fetch keeps pooled keep-alive sockets, so under host load a suite either waits in server.close() or reuses a socket the server already closed (other side closed, ECONNRESET) — the W0-FLAKE class. Every loopback request of the files this task owns goes through fetchOnce and every loopback server is closed with closeLoopbackServer (apps/api/src/platform/routing/tests/loopback.ts: a fresh socket per request, Connection: close, a named per-request deadline): tests/generated/route-metadata.test.ts (all five call sites, assertion 10 included), tests/generated/rls/api-cases.ts (runApiCase, the runner of the rls-cross-tenant api cases — the whole-response comparison and its findings are unchanged, shown by the existing case set passing with identical counts) and api-cases.test.ts (closeAllConnections before the close is awaited); tests/generated/rbac/runner.ts is NOT touched here — TASK-289 (a dependency) already moved it to fetchOnce and closeLoopbackServer (D-TASK289-06); keepAliveTimeout tuning or a per-suite retry is not a substitute
- RATCHET (PR #56 code review R2-n3: 25 loopback tests in 7 api suites failed under host contention; D-ARCH-146): one scan case lists every test file under apps, packages, tests and tools that still calls the global fetch against a loopback server (built as a plain test of the unit project, so lane A runs it on every PR; accepted in code review r1 section 5); the list is a checked-in allow-list that may only shrink (a new entry fails; a converted file must be removed) and holds NO file of tests/generated when this task merges; the api and worker loopback suites of R2-n3 stay on it, each with its folder lock named, and are converted by the next task that holds that lock — this task edits a suite outside its own locks only when no in-flight PR holds that folder (D-ORCH-118) and says so in the PR body
- NOT HERE — WEB PRERENDER UNDER HOST LOAD (D-ORCH-113 (b); D-ARCH-158, a re-specification under CLAUDE.md section 7 after code review r1 R1-M1): the item is split out as TASK-294 part 294-A, because its measurement needs the shared host on its own and cannot be run by a developer agent since the serial lane B queue (D-ORCH-125); this task delivers nothing for it and its PR body says so; the developer choice of the procedural rule without the measurement (D-TASK291-04) does not stand as a card outcome — the rule applies as the INTERIM operator rule of docs/07-ops/CI-CD.md section 1 (ADR-0023 amendment O) until TASK-294 part 294-A closes; the product build stays ONE un-retried react-router build (D-ARCH-146, unchanged); tools/quality is not touched and the quality-tools lock is released
- PR #57 LEFTOVERS (D-ORCH-113 (c); fix cycle 1 of PR #57 took R1-m1..m4, R1-n1..n3 and PR57-SEC-01/-03/-04): R1-n4 — prisma-client-locked.test.ts (and optionally the shim) reads the @platform/source target of the ./client export from prisma/package.json instead of hard-coding prisma/generated/prisma/client.ts; R1-n6 — the eleven withFileLock(PRISMA_TREE_LOCK, import of the generated client) pseudo-readers under prisma/tests take withReadLock, so they no longer serialise against each other and against every shim load (the per-process re-entrancy rule stays documented); NOT HERE (D-ARCH-158): the later routings to W0-FLAKE-3 that this task did not build — PR #57 code review R3-n1, R3-n2 and R3-n3 (D-ORCH-124), the prisma-engines restore of D-TASK288-20 and the two lane B runner items of D-ORCH-127 — are TASK-294 part 294-B
- PROOF AT MERGE AND STANDING RULES (D-ARCH-158): the proof at merge is the lane B run of the final head through the serial queue — integration, catalog-c1-c14, rls-cross-tenant with the case count of the last main run, and unit, each with 0 failures, 0 errors and 0 skipped (code review r1 condition C2); the 20/20-under-load table for each converted suite and for the lock change is attached to the PR body when it was taken at that head, otherwise TASK-294 part 294-A owes it on the merged suites under its bounded load (the host saturation that the PR #53 tables used no longer exists under D-ORCH-125 and is not produced on purpose by a developer agent); standing rules unchanged: heartbeat-based upper bounds and exact lower bounds, no assertion on a wall-clock bound and no timeOperation in a CPU-bound, ReDoS, redaction-growth or scaling check (D-SEC-PR53-02); order-based and marker-based assertions with real child processes where a race is the subject
- INFRA NOTE (D-TASK288-15; D-TASK020-99/-100): Testcontainers start failures under host load — P1001, port not bound, a container lost mid-run — are host capacity and never a product finding; their rate is recorded by TASK-294 part 294-A with its under-load tables (D-ARCH-158); the optional readiness wait with a named error at the harness start (prisma/tests/harness: wait for the mapped port before the first connection) was not taken here and stays an option for the next holder of tests-harness; a retry of a failed suite or a changed verdict rule is not in scope

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Test infrastructure only, no production code; tests/generated/rls/** and the O3 and O4 runners are security-owned: a security record; the security-integration job is decided by the classifier on the PR diff (prisma/tests/** selects now; tests/generated/rls/** selects once TASK-287 part 287-A is on main) — if the classifier does not select while tests/generated/rls/** changed, the merge condition is the restricted lane B run of the PR #57 C1 precedent (integration, catalog-c1-c14 and rls-cross-tenant with 0 failures, 0 errors and 0 skipped)
- Locks: three since D-ARCH-158 (tests-harness, api-routing, tests-gen-rls; quality-tools is released because no tools/quality file is in scope any more), because the flake class crosses folders; dispatched only when TASK-288 and TASK-289 have merged (dependencies), TASK-290 is not in flight (tests-gen-rls) and no in-flight PR holds api-routing
- The 20-run figure of the generic test line above is supplied by the under-load table of the card (attached to the PR, or owed by TASK-294 part 294-A; D-ARCH-158); it is not a merge condition of this task
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `apps/api/src/platform/**`, `tools/db/**`, `tests/generated/rls/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-293 — TASK-290-F: tools/db tokenizer parity with the PostgreSQL lexer (lone CR, identifier-char dollar rule, non-ASCII dollar tags, ASCII white space) and the ck_-is-CHECK statement

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-024) | US-077 (M0 Must) Generated cross-tenant isolation tests |
| REQs | REQ-RLS-007 |
| NFRs | — |
| Spikes / security / decisions | PR66-SEC-01, PR66-SEC-02, D-SEC-PR66-01, D-SEC-PR66-02, D-ORCH-134, D-SD-001 |
| Specialist · model | database-engineer · opus |
| Complexity | S |
| Depends on | TASK-290 |
| Batch · locks | 0.13 · prisma-core |
| Branch | `feat/TASK-293-task-290-f-tools-db` |
| Priority | Must |

> Scheduling note: Late follow-up task (plan fold D-SD-001) in batch 0.13 beside TASK-291; the lock is prisma-core, the lock TASK-016, TASK-024 and TASK-290 held over tools/db (the tools/db lock of D-ORCH-134); TASK-290 is merged, so it can be dispatched now.

**Files / modules**
- tools/db/sql-text.ts (+ test): tokenize
- tools/db/shadow-init.ts: isCheckReplacement JSDoc
- tools/db/lint-migrations.ts (+ test): rule 10 call-site rule or the stated limit (PR66-SEC-02)
- prisma/tests/catalog/<new file>.int.test.ts (optional ck_ contype assertion; not c01-c12.int.test.ts, which TASK-037 edits)

**Acceptance tests to write**
- PR66-SEC-01 (LOW, CWE-436/CWE-693; D-SEC-PR66-01) and PR #66 code review R1-m1: tokenize in tools/db/sql-text.ts follows PostgreSQL scan.l: (a) a lone CR ends a -- comment like LF; (b) the dollar-quote rule uses isIdentifierChar for the previous character, so a non-ASCII letter before $ makes the $ part of an identifier (é$a$ is an identifier, not a dollar quote); (c) a dollar tag accepts the non-ASCII tag alphabet of scan.l (bytes 0x80 to 0xFF as letters), so $é$ opens a dollar quote; optionally the linter refuses a lone CR; one table row per shape carrying the hostile statement of the record (a GRANT ... TO platform_app hidden by (a) and (b), a fake RESET ROLE and ENABLE + FORCE by (c)), each linted so rules 8, 15 and 9 fire; every tracked .sql file tokenizes unchanged (corpus check, recorded in the PR body)
- PR #66 code review R1-n1: the white-space test uses the ASCII class (space, tab, LF, CR, FF, VT) in both places instead of the JS white-space class, so a lone U+00A0, U+FEFF or U+3000 piece no longer closes a BEGIN ATOMIC block
- PR #66 code review R1-n2 (D-SEC-PR66-02): the isCheckReplacement JSDoc in tools/db/shadow-init.ts states that "the dropped constraint is the CHECK" rests on the ck_ naming convention (P9); optionally a C-series catalog assertion in a NEW file under prisma/tests/catalog/ that every pg_constraint whose name starts with ck_ has contype c
- PR66-SEC-02 (INFO; D-ORCH-134): rule 10 does not see a routine created and called in the same file; add a call-site rule, or state the limit next to the rule 11 note of PR #24 R1-n7 in lint-migrations.ts; the data-model 8.3 wording is principal-architect
- DUE (D-ORCH-134; D-SEC-PR66-01): merged before the next PR after TASK-037 (PR #65) that adds or changes a migration or bootstrap file, and together with any earlier change to sql-text.ts; the Wave 1 cards that add migrations carry a MERGE PREREQUISITE TASK-293 line, and the orchestrator applies the same rule to any later migration PR while this task is open
- Covers the scenarios of AT-US-077-01 … AT-US-077-04 that belong to its layer; US-077 closes in TASK-024

**DoD notes**
- tools/db is a security-owned path (CODEOWNERS): security record required; no migration and no bootstrap file; the lint and splitter run in lane A from the base ref, so a mutant that weakens them is a no-weakening finding
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`, `tools/db/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
