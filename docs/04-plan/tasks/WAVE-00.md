# WAVE-00 — Walking skeleton, CI lanes, toolchain, generator frameworks, spikes

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0** · Priority band: **Foundation (DC enablers)**

Tasks: **37** (S 7 / M 30; opus 22 / sonnet 15; demo-critical 18) in **10** batches of ≤ 4 parallel tasks. Estimated effort ≈ 100.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Lane A green on main; lane B `wave` evidence; lane C `wave-end` run #1 green; SPK-01..08 findings recorded; generators (route metadata, RBAC matrix, RLS cross-tenant, audit + immutability) green on all existing routes; thin slice e2e green; dependency-auditor baseline (R-ARCH-12) requested.

**Stories completed in this wave (29):** US-001 (DC), US-002 (DC), US-004 (DC), US-005, US-006, US-007, US-008, US-012 (DC), US-034 (DC), US-035, US-048, US-049 (DC), US-051 (DC), US-064, US-065 (DC), US-066 (DC), US-067 (DC), US-071 (DC), US-074 (DC), US-075 (DC), US-077, US-086 (DC), US-087 (DC), US-088 (DC), US-090, US-091, US-092 (DC), US-094 (DC), US-096 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 0.1 | TASK-001 SPK-01 toolchain spike and workspace foundation | root |
| 0.2 | TASK-002 Lint, format and layering rules with negative fixtures<br>TASK-003 Prisma 7 + PostgreSQL 18 baseline<br>TASK-004 Web and admin app scaffolds<br>TASK-005 Typed, validated configuration and key/secret register | lint<br>prisma-core<br>web-core, admin-core, e2e-core<br>pkg-config |
| 0.3 | TASK-006 API and worker runtime skeleton<br>TASK-007 CI lane A fast-lane workflow and supply-chain install hardening<br>TASK-008 SPK-03 spike<br>TASK-009 SPK-02 spike | api-platform-core, worker-platform-core<br>ci-workflows<br>spike-03<br>carriers-docs |
| 0.4 | TASK-010 Structured, redacted logging with correlation IDs<br>TASK-011 Lane B local heavy lane and evidence integrity<br>TASK-012 SPK-08 spike<br>TASK-013 Typed permission catalogue, seeded roles via versioned migration, role-permission matrix document, privilege-escalation guard | logging<br>quality-tools<br>spike-08<br>pkg-authz |
| 0.5 | TASK-014 Hardened multi-stage images and Docker Compose skeleton<br>TASK-015 SPK-07 + lane C full lane, coverage and diff-coverage gates, security-integration job, ci:minutes<br>TASK-016 Row-level security foundations<br>TASK-017 Contract-first OpenAPI pipeline | infra-compose<br>ci-workflows<br>prisma-rls, prisma-core<br>api-openapi, shared-api-types |
| 0.6 | TASK-018 SPK-04 spike<br>TASK-019 SPK-05 spike<br>TASK-020 Mandatory route metadata<br>TASK-021 Audit store SQL | spike-04<br>api-storage<br>api-routing<br>prisma-bootstrap-audit |
| 0.7 | TASK-022 SPK-06 spike<br>TASK-023 Idempotent reference and demo seed framework<br>TASK-024 Generated cross-tenant isolation test suite<br>TASK-025 Audit writer core | web-build-csp, web-core, admin-core, pkg-config, lint<br>prisma-seed<br>tests-gen-rls<br>pkg-audit-core |
| 0.8 | TASK-026 Walking-skeleton slice<br>TASK-027 RBAC matrix test generator<br>TASK-028 Audit redaction and field classification registry<br>TASK-029 Automatic audit capture driven by route descriptors | mod-admin-settings-reference, web-core, ui-api<br>tests-gen-rbac<br>pkg-audit-redaction<br>api-audit-mw |
| 0.9 | TASK-030 Per-stream audit hash chain<br>TASK-031 Audit field-level diffs and no-op update suppression<br>TASK-032 Server-controlled standard columns, UTC time and on-behalf seam<br>TASK-276 Test harness | pkg-audit-chain<br>pkg-audit-diff<br>prisma-ext<br>tests-harness |
| 0.10 | TASK-033 Audit test generator and immutability-per-role suite<br>TASK-034 Backup/restore rehearsal and zero-downtime migration probe tooling<br>TASK-277 Test-ID traceability tooling<br>TASK-278 Generated abuse suite | tests-gen-audit<br>db-tools-backup<br>quality-trace<br>tests-gen-abuse |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

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
- .swcrc
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-006 — API and worker runtime skeleton: Express 5 bootstrap, RequestContext, AppError + problem+json handler, health endpoints, module registry

| Field | Value |
|---|---|
| Stories (completes) | US-007 (M0 Must) Central error handler and framework error mapping<br>US-012 **DC** (M0 Must) Liveness and readiness endpoints |
| REQs | REQ-PLAT-009, REQ-PLAT-010, REQ-PLAT-018 |
| NFRs | NFR-AVAIL-002, NFR-SEC-009 |
| Spikes / security / decisions | — |
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
- AT-US-007-01 … AT-US-007-05: all 5 scenarios of US-007, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-012-01 … AT-US-012-05: all 5 scenarios of US-012, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Establishes the discovery-based module registry and per-module error catalogue (PLAN.md §5 rule 2)
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-007 — CI lane A fast-lane workflow and supply-chain install hardening (SPK-01 ubuntu half)

| Field | Value |
|---|---|
| Stories (completes) | US-005 (M0 Must) CI pipeline skeleton<br>US-048 (M0 Must) Secrets hygiene and CI security scanning |
| REQs | REQ-PLAT-007, REQ-SEC-011, REQ-SEC-013 |
| NFRs | NFR-OPS-003, NFR-SEC-002, NFR-SEC-012 |
| Spikes / security / decisions | SPK-01, SEC-COND-04, SEC-P3-04, SEC-P3-22, SEC-P3-31, SEC-P3-08, D-ARCH-010, D-ARCH-020, R-ARCH-12, D-ARCH-040, D-ARCH-041, D-ARCH-044, PR1-SEC-12, PR1-SEC-13 |
| Specialist · model | devops-engineer · opus |
| Complexity | M |
| Depends on | TASK-001, TASK-002, TASK-005 |
| Batch · locks | 0.3 · ci-workflows |
| Branch | `feat/TASK-007-ci-lane-fast-lane-workflow` |
| Priority | Must |

**Files / modules**
- .github/workflows/ci.yml (pull_request fast lane: changes, fast-lane job, ci-gate; incremental)
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
| Stories (completes) | US-008 (M0 Must) Correlation ID and structured, redacted logging |
| REQs | REQ-PLAT-011, REQ-PLAT-012 |
| NFRs | NFR-OBS-001, NFR-PRIV-001 |
| Spikes / security / decisions | SEC-P3-23 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-006, TASK-005 |
| Batch · locks | 0.4 · logging |
| Branch | `feat/TASK-010-structured-redacted-logging-correlation-ids` |
| Priority | Must |

**Files / modules**
- packages/shared/src/logging/{logger.ts, redaction.ts, security-event.ts}
- apps/api/src/platform/logging/{request-logger.ts, correlation.ts}
- apps/worker/src/platform/logging/**
- wiring in apps/api/src/app.ts

**Acceptance tests to write**
- All US-008 scenarios
- SEC-TC-31 (extended, app part): Cookie/Set-Cookie/Authorization sentinels never appear in API log output
- securityEvent(name, attrs) helper emits the catalogue name and never raw PII
- AT-US-008-01 … AT-US-008-06: all 6 scenarios of US-008, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-011 — Lane B local heavy lane and evidence integrity (quality:heavy, summary.json schema, check-evidence, required-suites manifest, prune)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-OPS-003, NFR-QUAL-006 |
| Spikes / security / decisions | T-QA-01, D-QA-001, D-ARCH-010, D-ARCH-021, SEC-P3-07, SEC-P3-31, R-ARCH-16 |
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
- AT-US-066-01 … AT-US-066-10: all 10 scenarios of US-066, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- 95 % coverage gate on packages/authz
- Security-critical path: security-integration job
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-014 — Hardened multi-stage images and Docker Compose skeleton (bootstrap + migrate one-shots, Valkey ACL, RustFS, Mailpit, local edge)

| Field | Value |
|---|---|
| Stories (completes) | US-004 **DC** (M0 Must) Hardened multi-stage container images |
| Stories (partial; completed by TASK-089) | US-003 **DC** (M0 Must) One-command local environment |
| REQs | REQ-PLAT-006, REQ-PLAT-005 |
| NFRs | NFR-OPS-001, NFR-OPS-002, NFR-SEC-007 |
| Spikes / security / decisions | SEC-P3-20, SEC-P3-21, SEC-P3-23, SEC-P3-08, SEC-P3-04, D-ARCH-040, D-ARCH-041, D-ARCH-044 |
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

**Acceptance tests to write**
- All US-004 scenarios (non-root, size budgets, no secrets in layers)
- US-003 scenarios for stack start and idempotent second up (seed content completed by the seed tasks)
- SEC-TC-34 (extended): edge bound to 127.0.0.1 by default
- SEC-TC-45 (Dockerfile part): marker absent after image install
- Valkey default user off; api/worker/healthcheck ACL users only
- ADR-0023 am. J item 2 (e) and ADR-0022 am. 14 b (D-ARCH-041): the `migrate` image fetches and verifies the schema engine in its build stage through `deps:rebuild`. It sets `ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x CHECKPOINT_DISABLE=1`, and its entrypoint runs `node tools/deps/prisma-cli.mjs` in `--verify-only` mode before `migrate deploy`. SEC-TC-64 (vi): `docker run --network none <migrate> prisma --version` exits 0, and `api`/`worker` hold no `node_modules/@prisma/engines` and no `schema-engine*`
- am. J items 1 (c), 5 and 6 and ADR-0022 am. 14 a, c–f (D-ARCH-040, D-ARCH-044): image installs run from the repository root with the root `package-lock.json` and `.npmrc` (`--workspace=apps/<app>`). `web`/`admin` build stages run with `NPM_CONFIG_OFFLINE=true` and compare the SHA-256 of `package.json` and `package-lock.json` before and after the build. Images set `ENV CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false`. No `npm rebuild` appears in any Dockerfile: a bcrypt prebuild that fails to load is a build failure
- Entrypoint preflight (D-ORCH-007 item 2; PR3-SEC-13, PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8, D-ARCH-061): with APP_ENV staging or production the api/worker entrypoint refuses NODE_OPTIONS outside the option-name allow-list, any PG* variable (at least PGOPTIONS) and NODE_ENV != production, exits 78 within 5 s before any application code runs, and `--disable-sigusr1` is set; container test: `docker run -e APP_ENV=staging -e NODE_OPTIONS=--inspect-wait=0.0.0.0:9229 <image>` and `-e NODE_ENV=development` each exit 78 and nothing listens on 9229
- AT-US-004-01 … AT-US-004-04: all 4 scenarios of US-004, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-003-01 … AT-US-003-04 that belong to its layer; US-003 closes in TASK-089

**DoD notes**
- No secrets or real credentials; `--ignore-scripts` installs; digest-pinned images; hadolint/actionlint clean.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-015 — SPK-07 + lane C full lane, coverage and diff-coverage gates, security-integration job, ci:minutes

| Field | Value |
|---|---|
| Stories (completes) | US-006 (M0 Must) Coverage gate |
| REQs | REQ-PLAT-008 |
| NFRs | NFR-OPS-003, NFR-QUAL-001, NFR-QUAL-002 |
| Spikes / security / decisions | SPK-07, D-ARCH-010, D-ARCH-021, R-ARCH-15, R-ARCH-19 |
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

**Acceptance tests to write**
- All US-006 scenarios
- SPK-07 exit: fast lane <= 15 job-min on a typical PR and <= 20 min wall-clock; security-integration <= 12 job-min; check-evidence negative fixtures rejected; `npm run ci:minutes` prints month usage
- Diff-coverage gate fails a PR whose changed files are below 85/75 (95 in pricing/audit/authz)
- AT-US-006-01 … AT-US-006-03: all 3 scenarios of US-006, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Workflow and tooling changes verified on their own PR; tooling invoked from the base ref; minute usage measured and recorded.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-016 — Row-level security foundations: table-class manifest, RLS renderer, platform helper functions, catalog tests, withTenantTx

| Field | Value |
|---|---|
| Stories (completes) | US-074 **DC** (M0 Must) RLS enabled and forced on every tenant-owned table, separate DB roles<br>US-075 **DC** (M0 Must) Per-transaction tenant context with SET LOCAL and fail-closed default |
| REQs | REQ-RLS-001, REQ-RLS-002, REQ-RLS-005, REQ-RLS-003, REQ-RLS-004 |
| NFRs | NFR-AVAIL-003, NFR-DATA-003, NFR-DATA-004, NFR-TENANT-001 |
| Spikes / security / decisions | SPK-03, SEC-P3-12, SEC-P3-34, D-ARCH-045, D-ARCH-046, D-ARCH-049, D-ARCH-058 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-008, TASK-003 |
| Batch · locks | 0.5 · prisma-rls, prisma-core |
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

**Acceptance tests to write**
- All US-074 and US-075 scenarios
- Catalog tests C1-C12 green on the migrated schema (every tenant table ENABLE + FORCE RLS; no BYPASSRLS on runtime roles)
- Unset context -> 0 rows; context never leaks across pooled connections (from SPK-03)
- C5/C11/C13 as amended 2026-11-12 (batch 0.2, D-ARCH-045/046): exactly three global `pg_default_acl` function rows (migrator, definer, audit owner) and no table/sequence/type/schema default-privilege row; a migrator-created probe function in `platform` and in `public` is not EXECUTE-able by PUBLIC or platform_app; `pg_database.datdba` is not the migrator and the migrator has no CREATE on the database; `pg_db_role_setting` has no database-wide row and the bootstrap role's `search_path=pg_catalog, pg_temp` row
- [SEC-TC-33] migration-lint rules 7, 8, 9, 12 and 14 (data-model §8.3): `DROP TRIGGER`, `DISABLE ROW LEVEL SECURITY` / `NO FORCE ROW LEVEL SECURITY`, `DISABLE TRIGGER`, `BYPASSRLS` / `SUPERUSER` / ownership to platform_app, `DELETE` grant outside the allow-list, any privilege on a partition, `DROP POLICY` without re-creation in the same file, a new table without its RLS block / allow-list entry (cross-checked with C1), and `CREATE SCHEMA` / `CREATE EXTENSION` / `ALTER DATABASE` / role DDL in prisma/migrations each fail the linter; one negative fixture per statement class; the `migration-lint` required suite (required-suites.json) activates with US-074
- [NT-AVAIL-003-a] migration-lint rules 3, 4, 5, 6 and 11: `RENAME`, `ADD COLUMN ... NOT NULL` without a constant default, `ALTER COLUMN ... TYPE`, `SET NOT NULL` without a preceding validated CHECK, `CREATE INDEX` without `CONCURRENTLY` on a table created by an earlier migration, `CREATE INDEX CONCURRENTLY` in a multi-statement file, FK/CHECK on an existing table without `NOT VALID`, and a migration altering an existing table without `SET lock_timeout` each fail; negative fixtures per rule. Rule 5 prerequisite: a one-statement `CREATE INDEX CONCURRENTLY` migration is run through `migrate deploy` in the Testcontainers harness to record how Prisma 7.10 submits it (data-model §8.3 rule 5 "verify in P5 spike"); the result is written into the fixture and prisma/README.md
- readSecret parity (D-ARCH-052): unit tests prove a _FILE path outside /run/secrets, a symlink leaving the root, a non-regular file, a file > 64 KiB and both NAME and NAME_FILE set are each refused with an error that names the variable and neither the path nor the value; a valid Compose secret file is read with its trailing newline stripped
- ADR-0005 am. 10 (SPK-03 F-01..F-10, D-ARCH-058): `TenantDb` omits `$transaction`, `$queryRawUnsafe` and `$executeRawUnsafe`; the factory sets `transactionOptions` explicitly (maxWait <= pool checkout budget, timeout >= statement_timeout) and maps P2028 to a retryable 503; P2010/42501 maps to 403 AUTHZ_DENIED + security event `rls_write_rejected` without echoing the PostgreSQL message; 55P03 maps to a retryable 503; `current_setting(..., true) = ''` is treated as NULL (catalog test); lint forbids `SET LOCAL`, `$executeRawUnsafe` and `$queryRawUnsafe` in platform/db and repositories and no repository imports the root client module; definer migrations GRANT/REVOKE before `OWNER TO platform_definer` (data-model §4.5 order)
- C-1 (SPK-03 §6, ADR-0005 am. 10): the spike file `prisma/tests/spikes/spk03-rls-tx.int.test.ts` runs in the hosted `security-integration` job of this PR on ubuntu-latest with `SPK03_REPORT` uploaded as a job artifact; the end-to-end per-transaction delta is recorded in SPK-03 §4 (not asserted); the permanent suite then asserts only the server-side set_config cost (<= 1 ms p95) and the spike file is deleted once ported
- ADR-0005 am. 10 items 1, 2, 4, 6, 7, 9, 11, 12 (PR #7 security review §4a, PR7-SEC-01/02/03/05/06/07/09): run-time `TenantDb` Proxy (not only `Omit`), AsyncLocalStorage re-entrance guard throwing NESTED_TENANT_TX (AT-US-075-04 as a run-time throw), SYSTEM-table writers typed on TenantDb, `set_config`/`app.*` token ban outside with-tenant-tx.ts + `pg_proc.prosrc` scan, literal `true` and validated-string-only binding, factory refuses PGOPTIONS, fresh-connection NULL probe and session-scope negative control, `mapDbError` keyed on `driverAdapterError.cause.originalCode` with retryable 40001/40P01/57014/55P03/P2028, RLS renderer predicate allow-list + C3 forbidden-token scan, C13 no `app.%` in pg_db_role_setting/pg_parameter_acl and platform_app role-setting rows, per-transaction lock_timeout/statement_timeout/idle_in_transaction_session_timeout from configuration, GUEST_CAPABLE no-de-claim trigger template (TASK-051 ships the trigger), definer functions under SET ROLE platform_definer and linter rule 15 (mandatory)
- AT-US-074-01 … AT-US-074-05: all 5 scenarios of US-074, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-075-01 … AT-US-075-04: all 4 scenarios of US-075, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Security-critical path (prisma/**, apps/api/src/platform/**): security-integration job
- Linter rules 3-9, 11 and 14 are the TASK-016 half of the migration-lint suite (D-ARCH-049); rules 1, 2, 10, 12, 13 and the contract-reversibility check came with TASK-003 and stay green
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- k6/Lighthouse scripts committed; host spec and results as machine-generated evidence under `docs/05-quality/performance/runs/`; thresholds taken from NFR.md.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-019 — SPK-05 spike: S3-compatible storage adapter contract against RustFS (put, presign, get, head, versioning)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SPK-05, R-ARCH-05 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-003, TASK-006 |
| Batch · locks | 0.6 · api-storage |
| Branch | `feat/TASK-019-spk-05-spike-s3-compatible` |
| Priority | Enabler |

**Files / modules**
- apps/api/src/platform/storage/{object-storage.port.ts, s3-object-storage.ts}
- apps/api/src/platform/storage/object-storage.contract.int.test.ts (RustFS pinned tag; SeaweedFS fallback)
- docs/04-plan/spikes/SPK-05.md

**Acceptance tests to write**
- SPK-05 exit: contract test green on RustFS (presigned GET <= 300 s, versioning, HEAD metadata, path-style) — or switch to SeaweedFS and request an ADR-0021 amendment

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-020 — Mandatory route metadata (defineRoute) with build-time route test and request-pipeline order skeleton

| Field | Value |
|---|---|
| Stories (completes) | US-067 **DC** (M0 Must) Mandatory route metadata with build-time route test |
| REQs | REQ-RBAC-005 |
| NFRs | NFR-AUDIT-004, NFR-MAINT-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-013, TASK-017, TASK-006 |
| Batch · locks | 0.6 · api-routing |
| Branch | `feat/TASK-020-mandatory-route-metadata-build-time` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/routing/{define-route.ts, pipeline.ts, route-registry.ts}
- packages/shared/src/audit/descriptor.ts (types only)
- tests/generated/route-metadata.test.ts (every route has permission + audit descriptor + validation schema; count = OpenAPI operations)
- pipeline slots wired to stub implementations (authn, mfa, authz, rate-limit, validate, idempotency, etag, tx, audit), each in its own platform/<slot>/ folder — later tasks replace only their slot folder (contract stubs)

**Acceptance tests to write**
- All US-067 scenarios
- Route count equals OpenAPI operation count for implemented operations; missing metadata fails the build
- AT-US-067-01 … AT-US-067-04: all 4 scenarios of US-067, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-021 — Audit store SQL (bootstrap lane): partitioned audit_entries, immutability triggers, platform_audit_owner, DDL event trigger, ensure_audit_partitions, search_path hardening

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-033, TASK-090) | US-094 **DC** (M0 Must) Database-enforced immutability and its tests<br>US-095 **DC** (M0 Must) Monthly partitions, indexes and partition-creation job |
| REQs | REQ-AUDIT-014, REQ-AUDIT-015, REQ-AUDIT-016, REQ-AUDIT-017 |
| NFRs | NFR-AUDIT-002, NFR-AUDIT-003 |
| Spikes / security / decisions | SPK-08, SEC-COND-03, SEC-COND-05, SEC-P3-27 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-012, TASK-016 |
| Batch · locks | 0.6 · prisma-bootstrap-audit |
| Branch | `feat/TASK-021-audit-store-sql-partitioned-audit` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/bootstrap/0010_audit_store.sql (+ heads, checkpoints, anchors, partitions, verifications, pii_vault, data_subjects)
- prisma/bootstrap/0011_audit_guard_event_trigger.sql
- tools/db/audit-ddl-reviewers.json
- prisma.config.ts tables.external list
- prisma/tests/catalog/c11-c14-audit.int.test.ts

**Acceptance tests to write**
- US-094 DB scenarios (UPDATE/DELETE/TRUNCATE rejected for every role)
- US-095 partition + index scenarios (current + 3 months exist)
- SEC-TC-43 and SEC-TC-61 green; C11/C14 proconfig assertions pass
- Covers the scenarios of AT-US-094-01 … AT-US-094-06 that belong to its layer; US-094 closes in TASK-033
- Covers the scenarios of AT-US-095-01 … AT-US-095-06 that belong to its layer; US-095 closes in TASK-090

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Bootstrap file = guardrail scope: backup/restore rehearsal tooling applies from the backup task onward (empty DB in Wave 0)
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-022 — SPK-06 spike: hash-based CSP with React Router pre-rendering behind Nginx; Trusted Types evaluation

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-SEC-006 |
| Spikes / security / decisions | SPK-06, R-ARCH-06, SEC-P3-24, D-ARCH-054 |
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

**DoD notes**
- Time-boxed (S ≤ 0.5 day, M ≤ 1 day); findings in `docs/04-plan/spikes/SPK-0x.md` with GO or FALLBACK; a FALLBACK triggers a principal-architect ADR amendment request before dependent tasks start; throwaway code is not merged.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-023 — Idempotent reference and demo seed framework (db:seed, db:seed:demo, production refusal of defaults)

| Field | Value |
|---|---|
| Stories (completes) | US-049 **DC** (M0 Must) Idempotent reference and demo seed framework |
| REQs | REQ-DATA-001, REQ-DATA-002 |
| NFRs | NFR-OPS-001 |
| Spikes / security / decisions | — |
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
- All US-049 scenarios (re-run is a no-op; demo seed refused when APP_ENV=production; SEED_* passwords from env only)
- data-model §9.2 as amended 2026-11-12 (D-ARCH-060): the reference seed never writes permissions, roles or role_permissions (they come from the generated authz seed migration); the framework exposes the reference_dataset_versions hook the US-073 task uses for the authz parity check and CONFIG_CHANGE entry
- AT-US-049-01 … AT-US-049-10: all 10 scenarios of US-049, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-024 — Generated cross-tenant isolation test suite (RLS generator)

| Field | Value |
|---|---|
| Stories (completes) | US-077 (M0 Must) Generated cross-tenant isolation tests |
| REQs | REQ-RLS-007 |
| NFRs | NFR-SEC-011, NFR-TENANT-001 |
| Spikes / security / decisions | T-QA-04 |
| Specialist · model | database-engineer · opus |
| Complexity | M |
| Depends on | TASK-016, TASK-020 |
| Batch · locks | 0.7 · tests-gen-rls |
| Branch | `feat/TASK-024-generated-cross-tenant-isolation-test` |
| Priority | Must |

**Files / modules**
- tests/generated/rls/{generator.ts, cross-tenant.int.test.ts}
- tools/quality/required-suites.json entry rls-cross-tenant (security: true)

**Acceptance tests to write**
- All US-077 scenarios
- Every table in tools/db/table-classes/*.json and every tenant-resource route is enumerated; an unlisted tenant table fails the suite
- AT-US-077-01 … AT-US-077-04: all 4 scenarios of US-077, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-025 — Audit writer core: action/actor types, complete entry fields, same-transaction write and outcome semantics

| Field | Value |
|---|---|
| Stories (completes) | US-087 **DC** (M0 Must) Action types, actor types and complete entry fields<br>US-088 **DC** (M0 Must) Same-transaction writes and outcome semantics |
| REQs | REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011, REQ-AUDIT-004, REQ-AUDIT-010 |
| NFRs | NFR-AUDIT-001, NFR-AUDIT-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-021, TASK-016, TASK-020 |
| Batch · locks | 0.7 · pkg-audit-core |
| Branch | `feat/TASK-025-audit-writer-core-action-actor` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/audit/src/{writer.ts, entry.ts, actions.ts, store/prisma-store.ts}
- packages/audit/test/**

**Acceptance tests to write**
- All US-087 and US-088 scenarios (audit insert failure rolls back the business row: 500 AUDIT_WRITE_FAILED)
- AT-US-087-01 … AT-US-087-08: all 8 scenarios of US-087, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-088-01 … AT-US-088-08: all 8 scenarios of US-088, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- 95 % coverage gate on packages/audit; security-integration job
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-026 — Walking-skeleton slice: seed countries/regions -> GET reference countries -> web page -> Playwright via Compose

| Field | Value |
|---|---|
| Stories (completes) | US-051 **DC** (M0 Must) Seed countries, regions and launch-country enablement |
| Stories (partial; completed by TASK-070, TASK-089) | US-053 **DC** (M0 Must) Public read-only reference endpoints<br>US-003 **DC** (M0 Must) One-command local environment |
| REQs | REQ-DATA-004, REQ-DATA-005, REQ-DATA-007, REQ-DATA-016, REQ-PLAT-005 |
| NFRs | NFR-COMPAT-002, NFR-OPS-001 |
| Spikes / security / decisions | — |
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
- AT-US-051-01 … AT-US-051-08: all 8 scenarios of US-051, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- Covers the scenarios of AT-US-053-01 … AT-US-053-08 that belong to its layer; US-053 closes in TASK-070
- Covers the scenarios of AT-US-003-01 … AT-US-003-04 that belong to its layer; US-003 closes in TASK-089

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-027 — RBAC matrix test generator (route x role allow/deny from metadata and seeded roles)

| Field | Value |
|---|---|
| Stories (completes) | US-071 **DC** (M0 Must) RBAC matrix test generator |
| REQs | REQ-RBAC-011 |
| NFRs | NFR-SEC-011, NFR-TENANT-002 |
| Spikes / security / decisions | T-QA-04 |
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
- AT-US-071-01 … AT-US-071-05: all 5 scenarios of US-071, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-028 — Audit redaction and field classification registry

| Field | Value |
|---|---|
| Stories (completes) | US-091 (M0 Must) Redaction and field classification |
| REQs | REQ-AUDIT-008, REQ-AUDIT-009 |
| NFRs | NFR-PRIV-002, NFR-PRIV-003 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-025 |
| Batch · locks | 0.8 · pkg-audit-redaction |
| Branch | `feat/TASK-028-audit-redaction-field-classification-registry` |
| Priority | Must |

**Files / modules**
- packages/shared/src/classification/registry.ts
- packages/audit/src/redaction/**
- tests: classification completeness check over prisma/schema

**Acceptance tests to write**
- All US-091 scenarios (SECRET removed, PERSONAL tokenised into the vault, 100 % PII columns classified)
- AT-US-091-01 … AT-US-091-06: all 6 scenarios of US-091, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-029 — Automatic audit capture driven by route descriptors (middleware)

| Field | Value |
|---|---|
| Stories (completes) | US-086 **DC** (M0 Must) Automatic audit capture driven by route descriptors |
| REQs | REQ-AUDIT-001, REQ-AUDIT-006 |
| NFRs | NFR-AUDIT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-025, TASK-020 |
| Batch · locks | 0.8 · api-audit-mw |
| Branch | `feat/TASK-029-automatic-audit-capture-driven-route` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/audit/{audit-middleware.ts, descriptor-runtime.ts}
- eslint audit-writer allow-list entry

**Acceptance tests to write**
- All US-086 scenarios
- AT-US-086-01 … AT-US-086-07: all 7 scenarios of US-086, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-030 — Per-stream audit hash chain (JCS, advisory lock, stream heads) and SYSTEM shard key from a server-side id

| Field | Value |
|---|---|
| Stories (completes) | US-092 **DC** (M0 Must) Per-stream hash chain |
| REQs | REQ-AUDIT-012 |
| NFRs | NFR-AUDIT-003, NFR-AUDIT-005 |
| Spikes / security / decisions | SPK-04, SEC-P3-17 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-025, TASK-028, TASK-018 |
| Batch · locks | 0.9 · pkg-audit-chain |
| Branch | `feat/TASK-030-per-stream-audit-hash-chain` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/audit/src/chain/{jcs.ts, hasher.ts, stream.ts}
- packages/audit/test/chain/**

**Acceptance tests to write**
- All US-092 scenarios
- SEC-TC-57: 1,000 anonymous requests with crafted X-Correlation-Id spread over >= 12 of 16 SYSTEM shards
- SPK-04 outcome applied (multi-row vault insert if required)
- AT-US-092-01 … AT-US-092-06: all 6 scenarios of US-092, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-031 — Audit field-level diffs and no-op update suppression

| Field | Value |
|---|---|
| Stories (completes) | US-090 (M0 Must) Field-level diffs and no-op updates |
| REQs | REQ-AUDIT-007 |
| NFRs | NFR-AUDIT-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-025 |
| Batch · locks | 0.9 · pkg-audit-diff |
| Branch | `feat/TASK-031-audit-field-level-diffs-no` |
| Priority | Must |

**Files / modules**
- packages/audit/src/diff/**

**Acceptance tests to write**
- All US-090 scenarios
- AT-US-090-01 … AT-US-090-06: all 6 scenarios of US-090, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
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
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-033 — Audit test generator and immutability-per-role suite

| Field | Value |
|---|---|
| Stories (completes) | US-096 **DC** (M0 Must) Audit test generator<br>US-094 **DC** (M0 Must) Database-enforced immutability and its tests |
| REQs | REQ-AUDIT-024, REQ-AUDIT-014, REQ-AUDIT-015 |
| NFRs | NFR-AUDIT-001, NFR-AUDIT-002 |
| Spikes / security / decisions | T-QA-04, SEC-TC-43, SEC-TC-61 |
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
- AT-US-096-01 … AT-US-096-07: all 7 scenarios of US-096, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-094-01 … AT-US-094-06: all 6 scenarios of US-094, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- Wave 0 exit: the M0 demo step "Generators pass" runs green on the routes that exist
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-034 — Backup/restore rehearsal and zero-downtime migration probe tooling (guardrail before data-changing migrations)

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-AVAIL-003, NFR-DATA-004, NFR-REC-003 |
| Spikes / security / decisions | CLAUDE.md §5 Database |
| Specialist · model | database-engineer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-003, TASK-014 |
| Batch · locks | 0.10 · db-tools-backup |
| Branch | `feat/TASK-034-backup-restore-rehearsal-zero-downtime` |
| Priority | Enabler |

**Files / modules**
- tools/db/{backup.ts, verify-restore.ts, zero-downtime-probe.ts}
- docs/07-ops/runbooks/backup-restore.md

**Acceptance tests to write**
- Backup + restore into a scratch DB with row-count and checksum comparison green; a data-changing migration without a fresh verified backup is refused by the migration linter
- Zero-downtime probe runs continuous reads/writes across an expand migration with 0 errors

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
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
