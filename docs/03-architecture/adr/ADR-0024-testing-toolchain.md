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

## Amendment (2026-11-12, SPK-01): Jest execution conventions, isolated Stryker, Lighthouse CI as a container, `size-limit` scope (SPK-01 §2 items 2–5, §3 F-06/F-07; D-ARCH-036, D-ARCH-037)

The layer/tool table and the lane mapping above are unchanged except for the two rows noted in item 5. These conventions join the "Conventions" paragraph.

1. **Jest invocation.** Every Jest script runs as `node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js --selectProjects <project>` (ADR-0002 amendment item 4). Under the `@swc/jest` CommonJS transform, the ESM-only packages `jose` 6, `uuid` 14, `canonicalize` 5, `otplib` 13 (via `@scure/base`), `cookie` 2 and `nock` 15 fail with "Must use import to load ES Module"; Jest 30.5 implements `require(esm)` inside its sandbox only when `vm.SourceTextModule` exists, which Node 24 provides behind that flag. With it, all 23 probed baseline packages load in the main process and in worker processes (ES256 sign/verify, UUIDv7, RFC 8785, nock interception). `jest.mock` hoisting is preserved because the transform output stays CommonJS; full native-ESM Jest was rejected for that reason. The flag is test-only (never in an image or compose command; ADR-0002 amendment item 3 guard).
2. **Workspace source resolution in tests.** `testEnvironmentOptions.customExportConditions` includes `@platform/source` in every Jest project, so tests exercise `packages/*/src` directly (no `dist/` build needed before `test:unit`), matching `tsconfig.base.json` `customConditions`. Tests that must prove the built artefact (the runtime preflight, image tests) run outside Jest against the image.
3. **Test discovery and coverage.** Jest uses explicit `roots` plus root-relative `testMatch` (the `<rootDir>/{a,b}/**` brace glob matched 0 files on Windows, R-ARCH-17) — this also shrinks the haste map. Coverage uses the v8 provider; pure re-export barrels (`packages/*/src/index.ts`) are excluded from `collectCoverageFrom` because v8 reports never-imported files as uncovered (TASK-002's lint keeps entry files re-export-only). Only the global 85/75 threshold is configured until **TASK-015** adds the per-path 95/95 thresholds for `packages/{pricing,audit,authz}` once they contain code, because Jest fails a per-path threshold that matches no files. The "per-path 95/95" convention above therefore becomes effective at TASK-015, not at TASK-001.
4. **Stryker in an isolated install (Mutation row).** Stryker 10 depends on Babel 8 and hoists `@babel/core@8`, which leaves Jest 30's `babel-preset-current-node-syntax` plugins with an invalid `^7` peer and makes the root `npm ls` exit non-zero. Stryker is therefore **not** in the root lockfile. It lives in `tools/isolated/stryker/` (`package.json` marked `private`, its own `package-lock.json`, a byte-identical copy of the root `.npmrc` asserted by a repository test), installed with `npm ci --ignore-scripts --prefix tools/isolated/stryker` only by the `gate` profile of `quality:heavy`, and run as `npm exec --no --prefix tools/isolated/stryker -- stryker run` with `stryker.config.mjs` targeting `packages/pricing`. `@stryker-mutator/jest-runner` resolves `jest` by walking up to the root `node_modules`, so Jest is not duplicated. The `npm ls` validity of the isolated tree is not gated; lane A's `check-lockfile`, licence/age checks and `npm audit --audit-level=high` cover every `package-lock.json` in the repository (root and `tools/isolated/*`). Registry check 2026-11-12: `@stryker-mutator/core` 10.1.1, Apache-2.0, released 2026-10-23; lockfile-only resolution with the Jest runner = 177 packages, 0 High/Critical (5 moderate, upstream tooling chains).
5. **Lighthouse CI as a repository-built container (Web performance row; T-QA-09).** `@lhci/cli` is **not** an npm dependency of the root: its puppeteer/lighthouse chain carries 9 High advisories (`@puppeteer/browsers`, `basic-ftp`, `get-uri`, `pac-proxy-agent`, `proxy-agent`, `puppeteer-core`, `lighthouse`, `@lhci/cli`, `@lhci/utils`; `npm audit` on a lockfile-only resolution, 341 packages, 2026-11-12), which would block the lane A audit gate, and running it with the Windows host's Chrome (lane B) versus Linux Chromium (lane C) would make the two lanes measure different browsers. LHCI runs instead from `tools/isolated/lhci/Dockerfile`: `FROM node:24-trixie-slim@sha256:<digest>`, Debian `chromium` from the pinned distribution, `@lhci/cli` at an exact version from `tools/isolated/lhci/package-lock.json` installed with `npm ci --ignore-scripts`, non-root user, `ENTRYPOINT ["npm","exec","--no","--","lhci"]`; the image is built locally by lane B (cached) and in lane C from the same Dockerfile, joins the compose network and targets the pre-rendered routes of the running stack (mobile emulation, slow 4G; `lighthouserc` assertions = NFR-WEB-001/003/005 thresholds). Policy: the LHCI image is a **tool container** in the D-ARCH-003 rev 2 item 4 register (Apache-2.0); its lockfile is a container build input covered by `check-lockfile`, the licence check (dev-closure rules) and the 7-day cooldown, but **not** by the root `npm audit` gate — the built image is Trivy-scanned and its findings are *reported* with the register entry, where the 9 High advisories are accepted on 2026-11-12 with reasons (proxy/FTP/URI handling in puppeteer's download path is unreachable: the container has no proxy configuration, fetches nothing from the internet at run time, and talks only to the compose stack); security-analyst confirms the acceptance and its 90-day review date. Rejected: `patrickhulce/lhci-client` from Docker Hub (personal namespace, release cadence not digest-published per LHCI version, runs as root); `@lhci/cli` in the root lockfile (above). Cooldown note: `@lhci/cli` 0.16.1 was published 2026-11-11, so the first pin is 0.16.0 (2026-11-02) until the cooldown admits 0.16.1.
6. **`size-limit` scope (Web performance row, lane A).** `size-limit` 14.3 + `@size-limit/file` 14.3 only (MIT; 5 packages; 0 advisories). Budgets are byte budgets on built files (gzip), which is what NFR-WEB-004 and ADR-0026 §10 specify. `@size-limit/preset-app` was rejected (14 High advisories in its puppeteer/estimo chain; JS execution-time estimates are Lighthouse's job).
7. **Cooldown-deferred test tooling (F-05).** `@playwright/test` 1.65.0 (2026-11-05) and `@axe-core/playwright` 4.14 are installed by TASK-004 once the 7-day cooldown admits them (after 2026-11-12T18:30Z); `i18next` 27 / `react-i18next` 18 (2026-11-07) by TASK-042 after 2026-11-14. No version pin changes; `test:e2e` exists but fails until TASK-004 adds `tests/e2e/playwright.config.ts`.
