# ADR-0024: Testing toolchain and test architecture

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect (qa-lead owns the test strategy in P4)
- **Related:** brief §11, §3.2 testing additions; CLAUDE.md §3 COVERAGE_TARGET; REQ-PLAT-008, REQ-RBAC-011, REQ-AUDIT-024, REQ-CARR-011/019/020, REQ-RLS-007, REQ-API-004; NFR-QUAL-001..006, NFR-TENANT-*, NFR-AUDIT-*, NFR-A11Y-002, NFR-PERF-*, NFR-SEC-002

## Decision

| Layer | Tooling (versions verified 2026-11-12) | Where | Notes |
|---|---|---|---|
| Unit | Jest 30 + `@swc/jest`; `fast-check` 4 for properties; React Testing Library for components/hooks | `**/*.test.ts(x)` beside code; Jest projects `unit` | Pure logic: pricing, state machines, validators, authz, money/units, audit hashing/redaction |
| Integration | Jest project `integration` + Testcontainers 12 (`@testcontainers/postgresql` PG 18, `@testcontainers/redis` 7, `GenericContainer` RustFS) | `apps/api/src/**/*.int.test.ts`, `prisma/tests` | Repositories/services against real PG with the **runtime role**; RLS, partitions, triggers, migrations up→down→up (NFR-DATA-004), query-plan registry (NFR-PERF-006), BullMQ crash/restart (NFR-RES-004) |
| API | Jest project `api` + Supertest 7 + OpenAPI response validator (Ajv 8 + `@apidevtools/swagger-parser` dereference; problem+json included) | `apps/api/src/**/*.api.test.ts` | Per route: success, validation, 401, 403, 404, 409, idempotent replay, rate limit (NFR-QUAL-004; N/A needs justification in metadata) |
| Generated suites | `packages/authz` matrix generator (ADR-0008); `packages/audit` audit generator (ADR-0007); RLS cross-tenant generator (ADR-0005); saga fault matrix (ADR-0014); abuse suite (IDOR/mass assignment) from route metadata (NFR-SEC-011) | `tests/generated` (emitted at test time) | Fail CI on uncovered route/table |
| Contract (carriers) | Shared Jest suite parameterised over Mock + DHL/FedEx/UPS fixtures with `nock` 15; live sandbox opt-in `CARRIER_LIVE_SANDBOX=1` | `packages/carriers/test/contract` | Fixtures free of secrets/PII (Gitleaks + synthetic data) |
| E2E | Playwright 1.65 (Chromium, Firefox, WebKit × mobile 390/360 and desktop 1280), `@axe-core/playwright` after every navigation, keyboard-only specs, header/CSP violation listeners, `web-vitals` INP probe, layout-shift observer | `tests/e2e` | Critical journeys (PRD §6); Mailpit API for e-mails; ≤ 1 % flake over 20 runs |
| Performance | k6 (Docker `grafana/k6`) scripts: rate shopping SSE, booking, tracking, lists; profiles ramp/steady/spike/soak; audit on/off A/B | `tests/load` | Thresholds from NFR-PERF; host spec recorded |
| Web performance | Lighthouse CI (`@lhci/cli`) on pre-rendered routes (mobile emulation, slow 4G), `size-limit` budgets | `tests/web-perf`, CI | NFR-WEB-001..005 |
| Security | Semgrep (rules: raw SQL, outbound HTTP, innerHTML, country branches), Gitleaks, `npm audit`, licence/age check, Trivy, OWASP ZAP baseline (Docker) against compose | CI | NFR-SEC-002; ZAP on release candidates |
| Mutation | Stryker 10 on `packages/pricing` (≥ 80 %) nightly/P6 | CI nightly | NFR-QUAL-003 |
| Accessibility manual | WCAG 2.2 AA checklist + NVDA/VoiceOver spot checks by qa-lead | P6 | NFR-A11Y-001 |

Conventions: Testcontainers reuse (`TESTCONTAINERS_REUSE_ENABLE=true` locally) to keep integration runs fast; one database per Jest worker (template DB cloning); seeded fixtures via factories (no legacy data); fake clock (`@sinonjs/fake-timers` via Jest modern timers) for token lifetimes; deterministic RNG seeds for jitter tests; coverage merged across workspaces with `coverageThreshold` global 85/75 and per-path 95/95 for `packages/pricing`, `packages/audit`, `packages/authz` (ledger when it exists). Test data classification: synthetic only; sentinel PII strings used by the redaction e2e (NFR-PRIV-001).

## Alternatives considered

- **Vitest.** Faster and Vite-native, but Jest is the fixed stack.
- **Cypress.** Playwright is sanctioned and covers WebKit.
- **Service containers in GitHub Actions instead of Testcontainers.** Both work; Testcontainers keeps the same code path locally and in CI and supports RustFS/PG 18 pinning per test.

## Consequences

- Positive: generated suites make the brief's "every route × role", "every mutating route audited", "every tenant table isolated" obligations mechanical; the contract suite proves carrier onboarding.
- Negative: Docker is required for integration/API tests (documented in CLAUDE.md §2); 3-engine Playwright is slow — run selectively on PRs.

## Reversibility

High.

## Amendment (2026-11-12, D-ORCH-001 / ADR-0023 amendment): where each layer runs

The tooling above is unchanged. Execution moves to three lanes (ADR-0023 amendment A); "CI nightly" in the table is superseded by this mapping. Local runs use the per-command PATH prefix of CLAUDE.md §2 (D-ORCH-002).

| Layer | Lane A — hosted, every PR | Lane B — local, test-runner (`npm run quality:heavy -- --profile pr\|wave\|gate`) | Lane C — hosted `workflow_dispatch` at wave ends and gates |
|---|---|---|---|
| Unit, fast-check, React Testing Library | Yes (incremental on PRs; diff-coverage gate 85/75, 95 on pricing/audit/authz) | `pr` pre-flight (full suite, repository thresholds) | Yes (full, repository thresholds) |
| Integration (Testcontainers) | No | `pr` when backend paths changed; `wave`/`gate` always | Yes |
| API + generated suites (RBAC, audit, RLS, abuse, saga) | No | As integration | Yes |
| Carrier contract (nock fixtures, no Docker) | Yes, inside the Jest unit project | — | Yes |
| Carrier contract live sandbox (opt-in secrets) | No | `CARRIER_LIVE_SANDBOX=1` when credentials exist (D-003) | Only via `nightly.yml` dispatch with secrets |
| E2E Playwright + axe + CSP listener | No | Chromium `@critical` mobile + desktop (`pr`); 3 browsers × 2 viewports (`wave`/`gate`) | 3 browsers, one job per browser |
| Performance k6 | No | smoke (`pr`), ramp/steady/spike + scale-test (`wave`), soak (`gate`); **gated here**, host spec recorded (reference host = developer machine branch of NFR.md) | smoke only, reported not gated (2 vCPU) |
| Web performance: `size-limit`, Lighthouse CI | `size-limit` yes; LHCI no | LHCI (`pr` when `apps/web` public routes changed; `wave`/`gate`) | LHCI yes |
| Security: Semgrep, Gitleaks (diff), `npm audit` + osv, licence/age, header tests | Yes (header tests need the stack → lane B/C) | Header tests, ZAP baseline (`wave`/`gate`), Gitleaks full history (`gate`) | Yes, plus Gitleaks full history |
| Trivy image + config | Config scan only when `infra/**` changed | Dockerfile/lockfile changes and `wave`/`gate` | Yes |
| Mutation (Stryker, `packages/pricing` ≥ 80 %) | No | `gate` | No (dispatch `nightly.yml` only if minutes allow) |
| Restore rehearsal (NFR-REC-003) | No | `gate`, and for any PR adding a `-- @data-changing` migration | `release-candidate` |
| Accessibility manual (NVDA/VoiceOver) | — | P6, qa-lead | — |

Evidence from lane B is written under `docs/05-quality/` (ADR-0023 amendment B) and is part of the merge DoD (amendment C).
