# ADR-0023: CI/CD on GitHub Actions, release artefacts (tag + GitHub Release + GHCR) and progressive delivery design

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect, platform-architect (devops-engineer implements in P5 Wave 0)
- **Related:** brief §10 (pipeline stages), §11; CLAUDE.md §3 (CI_PLATFORM, CANARY_STEPS, ROLLBACK_TRIGGERS), §5; REQ-PLAT-006/007, REQ-SEC-013; D-004, D-005, D-006; **D-ORCH-001, D-ORCH-002, D-ARCH-010 (amendment below)**; NFR-OPS-002/003/004, NFR-SEC-002, NFR-QUAL-*; platform.md §7; ADR-0024 amendment (where each test layer runs)

## Decision

1. **Workflows** in `.github/workflows/`:
   - `ci.yml` (pull requests and `main`): `setup` (checkout, Node from `.node-version`, `npm ci` with cache) → parallel `lint` (eslint, stylelint, prettier check, commitlint, actionlint), `typecheck`, `unit` (Jest unit + coverage gate 85/75, 95 on pricing/audit/authz), `contract` (Redocly lint, OpenAPI drift, generated types freshness, `.env.example` parity, repository structure test) → `integration` (Jest integration/api projects with Testcontainers on the runner's Docker; RLS, audit, migrations up→down→up, RBAC matrix, audit generator) → `build` (workspaces build, size-limit) → `security` (Semgrep, Gitleaks, `npm audit --omit=dev --audit-level=high`, licence check against LICENSE_ALLOWLIST + 18-month age script) → `images` (buildx multi-stage for api/worker/web/admin, Trivy image + config scan, hadolint, CycloneDX SBOM via `npm sbom`/syft, push to GHCR only on `main`/tags) → `iac` (`terraform fmt -check`, `validate -backend=false` per module/overlay, Checkov) → `e2e` (compose up from built images, Playwright 3 engines × 2 viewports with axe, k6 smoke, Lighthouse CI on public routes, security header tests, ZAP baseline on release candidates). Target ≤ 20 min wall-clock via job parallelism and caches (NFR-OPS-003).
   - `nightly.yml`: k6 soak (100 rps × 60 min), Stryker mutation on `packages/pricing`, ZAP baseline, live-sandbox carrier contract tests and Stripe test-live **only when the secrets exist** (`CARRIER_LIVE_SANDBOX=1`, `STRIPE_TEST_LIVE=1`; otherwise reported as skipped), restore rehearsal (NFR-REC-003), dependency freshness report.
   - `release.yml` (on tag `v*`, incl. `v0.1.0-m0` pre-release per D-006): rebuild or promote images by digest, tag `ghcr.io/sukhchdit/shipcube-{api,worker,web,admin}:<semver>` + `sha-<gitsha>`, attach SBOMs and provenance attestation (GitHub artifact attestations), generate changelog from Conventional Commits, create the GitHub Release (pre-release flag for `-m0`) with notes + SBOM + OpenAPI document (D-005).
   - `cd.yml`: `deploy-staging` and `deploy-production` jobs with environments and required reviewers **present but no-op** (log "no deploy target configured", D-002) until `DEPLOY_TARGET_STAGING`/`_PRODUCTION` variables and the OIDC role exist; when enabled: assume role via GitHub OIDC (no long-lived keys), `terraform plan` → Checkov/OPA on plan → `apply` (staging), ECS deploy via CodeDeploy with CANARY_STEPS and alarm-based automatic rollback (ROLLBACK_TRIGGERS), smoke + e2e against staging, production promotion by digest only.
2. **Policies**: pinned action SHAs; `permissions:` least privilege per job (`contents: read`, `packages: write` only for publish, `id-token: write` only for OIDC jobs); concurrency groups per ref; required checks on `main`: lint, typecheck, unit, contract, integration, build, security, images(scan), iac; merges only after code-reviewer APPROVED + security-analyst no Critical/High (D-004); no force pushes.
3. **Artefacts**: images (digest-pinned bases, non-root, `HEALTHCHECK`, labels `org.opencontainers.image.*`), SBOM per image, coverage report, Playwright traces, k6 summaries, Lighthouse reports, Terraform plan output (when enabled) — retained 30 days.
4. **Secrets in CI**: only `GITHUB_TOKEN` for GHCR; optional sandbox/Stripe test secrets as repository secrets consumed only by the nightly job; never echoed; Gitleaks on every PR diff and full history.
5. **Progressive delivery design** (exercised at M5): CodeDeploy ECS blue/green canary 5 % → 25 % → 50 % → 100 % with 10-minute bakes; rollback alarms = ROLLBACK_TRIGGERS; database migrations run as a pre-deploy ECS task using the migrator role, expand-only (contract steps ship in a later release per CLAUDE.md §5), preceded by an automated snapshot + restore check job.

## Alternatives considered

- **Self-hosted runners / other CI.** GitHub Actions is fixed (CLAUDE.md §3).
- **Publishing to ECR now.** Needs an AWS account; GHCR is free with the repo (D-005); ECR mirror at M5.
- **Monolithic single job.** Exceeds the 20-minute budget; parallel jobs with caches are required.

## Consequences

- Positive: every guardrail is a pipeline stage; releases are reproducible (digests, SBOM, attestations); deploy stages are ready to switch on.
- Negative: Docker-in-runner integration tests and Playwright across 3 engines are the long poles — mitigated by job parallelism and selective e2e on PRs (full matrix on `main`/nightly).

## Reversibility

High.

## Amendment (2026-11-12, D-ORCH-001): hosted PR fast lane, local heavy lane, dispatch-only full lane

**Supersedes** the self-hosted `heavy` runner default of D-ARCH-009 and platform.md PD-10 (options C + D). The human decided (Q-007 → D-ORCH-001): no self-hosted runner, no paid minutes, the repository stays private, and the heavy suites run locally with committed evidence. §1 (`ci.yml`, `nightly.yml`) is redefined below; §2–§5 stand. Local commands in this amendment run with the per-command PATH prefix from CLAUDE.md §2 (`export PATH="$APPDATA/fnm/aliases/default:$PATH";`, D-ORCH-002); containers and hosted jobs use `node:24` / `.node-version`.

### A. Lane model

| Lane | Trigger | Runs on | Content | Budget |
|---|---|---|---|---|
| **A — PR fast lane** | `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`) on **non-draft** PRs; concurrency group per PR with `cancel-in-progress: true` | GitHub-hosted `ubuntu-latest` (2 vCPU / 8 GB on a private repository) | One job `fast-lane` (single checkout, one `npm ci` with the `node_modules` cache): ESLint (incl. boundaries) + Stylelint, Prettier check, commitlint, actionlint, hadolint, `tsc -b` type-check (incremental, `.tsbuildinfo` cached), Jest **unit** + coverage gate, `npm run build` (all workspaces) + `size-limit`, Gitleaks on the PR diff (container), `npm audit --omit=dev --audit-level=high` + `osv-scanner` (container), Semgrep (container), licence + 18-month age check, `.env.example` parity, i18n key check, repository-structure test, OpenAPI lint + route drift + generated-types freshness, migration linter, `quality:check-evidence` (section C). `iac` steps (`terraform fmt -check`, `validate -backend=false`, Checkov, Trivy config) run **only when `infra/**` changed**. `ci-gate` aggregates and is the one required status check. | ≈ 8 job-min typical (incremental), ≤ 15 when a full-trigger path changed; wall-clock ≤ 15 min (NFR-OPS-003 ≤ 20) |
| **B — local heavy lane** | On demand by `test-runner` (dispatched by senior-developer or qa-lead) before a PR is marked ready, at every wave end and before each gate: `npm run quality:heavy -- --profile <pr\|wave\|gate>` | Developer host (Windows 11, Node 24 via fnm, Docker Desktop) | Integration (Jest + Testcontainers: PostgreSQL 18, Valkey, RustFS), API + generated suites (RBAC matrix, audit, RLS cross-tenant, abuse, saga fault matrix), compose-up timing (NFR-OPS-001), Playwright e2e (Chromium for `pr`; Chromium + Firefox + WebKit × mobile/desktop for `wave`/`gate`) with axe and CSP listeners, header tests, Lighthouse CI on pre-rendered routes, k6 smoke (`pr`) / ramp-steady-spike + scale-test (`wave`) / soak (`gate`), ZAP baseline (`wave`/`gate`), Trivy image + config scan (`wave`/`gate`, and whenever a Dockerfile or the lockfile changed), Stryker on `packages/pricing`, restore rehearsal and `valkey-compat` (`gate`). Writes evidence under `docs/05-quality/` (section B). | $0. Wall-clock: `pr` ≈ 15–25 min, `wave` ≈ 60 min, `gate` ≈ 2–3 h |
| **C — hosted full lane** | `workflow_dispatch` only (inputs `ref`, default `main`; `profile` = `wave-end` \| `release-candidate`), dispatched by the orchestrator or devops-engineer **at every wave end, before G3, before G4** and for each release candidate (the `release.yml` guard requires a green lane C run on the tagged SHA) | GitHub-hosted; heavy jobs use `runs-on: ${{ fromJSON(vars.HEAVY_RUNNER_LABELS \|\| '["ubuntu-latest"]') }}` | Everything in lane A (non-incremental, whole-repository coverage thresholds) **plus** `integration` (Testcontainers), `images` (buildx ×5, size budget, Trivy, layer-secret scan, Syft SBOM, push `sha-<sha>` to GHCR), `e2e-stack` sharded per browser (3 jobs: compose up from the built images, smoke, Playwright + axe, Lighthouse, k6 smoke, log-schema check), `iac`. | ≈ 85 job-min per run; wall-clock ≈ 20–25 min with sharding; ≤ 8 runs/month |
| **`push` to `main`** | `push`, path-filtered to code (`apps/**`, `packages/**`, `prisma/**`, `infra/**`, `compose*.yaml`, `**/Dockerfile*`, `package*.json`, `.github/**`) | GitHub-hosted | Lane A, incremental against the push's `before` SHA (+ `iac` for `infra/**`). **Enabled by repository variable `CI_MAIN_FAST_LANE`**, default `false` while the monthly estimate exceeds 80 % of the allowance (section D); the orchestrator sets it to `true` when headroom exists. | ≈ 4–5 job-min per merge when enabled |

Reading of D-ORCH-001 "push to main, path-filtered": on `main` the hosted workflow re-runs the **fast lane** for code merges (toggle above). The heavy jobs run on hosted runners only through `workflow_dispatch`, because merge-triggered full runs (≈ 85 min × ≈ 100 merges) would exceed the free allowance on their own.

`nightly.yml` keeps its job definitions (they are the self-hosted alternative and the lane C `release-candidate` extras) but has **no `schedule`**; it is `workflow_dispatch`-only. Its scheduled content is lane B's `wave`/`gate` profiles, run locally.

**Incremental mode** (lane A on PRs and on `main`): `jest --changedSince=<base>` for the `unit` project, ESLint `--cache` with a restored cache, incremental `tsc -b`. **Full-trigger paths** force a non-incremental run: `package-lock.json`, `jest.config.*`, `tsconfig*.json`, `.swcrc`, `eslint.config.*`, `packages/shared/**`, `packages/config/**`, `docs/03-architecture/api/openapi.yaml`, `.github/**`. Coverage on PRs is a **diff gate**: changed and new source files must reach 85 % line / 75 % branch (95/95 under `packages/pricing`, `packages/audit`, `packages/authz`); the whole-repository thresholds are enforced by lane C and by lane B `wave`/`gate` profiles, whose `coverage-summary.json` is part of the evidence. SPK-07 (risks.md) validates the incremental mode in Wave 0; until it passes, lane A runs non-incrementally (≈ 14 min).

**Self-hosted runner — documented alternative, not the default.** Setting the repository variable `HEAVY_RUNNER_LABELS='["self-hosted","heavy"]'` moves lane C's heavy jobs and `nightly.yml` to a self-hosted runner with no other workflow change (the reversibility D-ORCH-001 names). Prerequisites if ever chosen: ephemeral runner, private repository only, no `pull_request_target`, Docker Desktop/WSL2 (platform.md §7.8 option C).

### B. Evidence layout for the local heavy lane (`docs/05-quality/`)

The directories `reviews/`, `tests/`, `security/` and `performance/` already exist. The heavy-lane script writes machine-generated files only; no agent hand-edits them.

```
docs/05-quality/
  README.md                        index, regeneration commands, the suite-selection table (section C)
  tests/
    schema/heavy-run.schema.json   JSON Schema for summary.json
    runs/<stamp>_<sha7>/           one directory per run, e.g. runs/20261120T1432Z_a1b2c3d/
      summary.json                 git_sha, git_dirty, generated_at, profile, host {os, cpu_model, cores, ram_gb,
                                   docker_version, node_version}, suites[{name, status, tests, failures, skipped,
                                   duration_s, report, report_sha256}], coverage {line, branch, per_package}, verdict
      summary.md                   rendering of summary.json; first line "sha <sha7> · <stamp> · profile <p> · verdict <v>"
      integration.junit.xml · api.junit.xml · generated-suites.junit.xml · e2e-<browser>.junit.xml
      coverage-summary.json        merged Jest coverage summary (never the raw lcov)
      compose-up.json              NFR-OPS-001 timing
      axe-summary.json · csp-violations.json · headers.json
    LATEST.md                      generated pointer: latest run per branch and per profile
  security/
    runs/<stamp>_<sha7>/           zap-baseline.json, trivy-<image>.json, trivy-config.json, gitleaks-full.json (when run),
                                   osv.json, npm-audit.json, semgrep.json (optional locally), summary.json
  performance/
    runs/<stamp>_<sha7>/           k6-<profile>.summary.json, host-spec.json, lighthouse/<route>-<locale>.json
                                   (LHCI assertion results), stryker-summary.json (gate), summary.json
  reviews/                         code-reviewer and security-analyst verdicts (unchanged owners)
```

Naming: `<stamp>` = UTC `YYYYMMDDTHHMMZ`; `<sha7>` = first 7 hex digits of the commit the suites ran against; `verdict` ∈ `PASS | FAIL | INVALID`. Content rules: JUnit XML and JSON summaries only; **no HTML reports, traces, videos, screenshots, raw lcov or image tarballs** (failure traces stay in the git-ignored `tests/e2e/output/`). A repository test caps a run directory at 5 MB and rejects file names outside the allow-list. Retention: run directories for the current and previous wave plus every gate run are kept; `npm run quality:prune` removes older ones in a dedicated commit (history keeps them).

**Integrity (risks.md R-ARCH-16).** `summary.json` is written only when `git status --porcelain` is empty for tracked code paths (`git_dirty: false`; a dirty tree yields `verdict: INVALID`, which lane A rejects); it records the SHA, timestamp, host spec and the SHA-256 of every attached report. Lane A's `quality:check-evidence` validates the schema, that `git_sha` is an ancestor of the PR head, that every attachment hash matches, and that the diff between `git_sha` and the PR head touches only `docs/**` (otherwise the evidence is stale). Evidence is committed as `test(evidence): heavy lane <profile> <sha7> <verdict>` by senior-developer or devops-engineer after test-runner's run (test-runner does not modify the repository). Lane C re-runs the integration and e2e subsets on Linux at wave ends, which cross-checks the local results.

### C. What "passing CI" means for the merge DoD (CLAUDE.md §2, §8; D-004)

A PR merges to `main` only when **all** of the following hold:

1. **Lane A green** on the PR's current head (`ci-gate`; path-filter skips count as success).
2. **Lane B evidence present with `verdict: PASS`** for the change, selected by changed paths (the same table lives in `docs/05-quality/README.md` and is what `quality:check-evidence` enforces):

   | Changed paths | Required local suites (profile `pr` minimum) |
   |---|---|
   | `apps/api/**`, `apps/worker/**`, `packages/**` (except `packages/ui`), `prisma/**` | integration + api (incl. generated RBAC / audit / RLS / abuse suites) |
   | `prisma/migrations/**` | + migrations up → down → up and the migration linter; a data-changing migration also needs the restore-rehearsal report (CLAUDE.md §5) |
   | `apps/web/**`, `apps/admin/**`, `packages/ui/**` | e2e `@critical` on Chromium (mobile + desktop) with axe and CSP listeners; Lighthouse on pre-rendered routes when public routes of `apps/web` changed |
   | `**/Dockerfile*`, `compose*.yaml`, `package-lock.json` | compose-up timing + Trivy image and config scan |
   | `packages/pricing/**`, `packages/audit/**`, `packages/authz/**`, or a task tagged `perf` | + k6 smoke with the NFR-PERF thresholds |
   | `docs/**` only, `.github/**` only | none (lane A suffices; actionlint is in lane A) |

   The evidence references the PR head or an ancestor whose diff to the head is docs-only. Stories whose Gherkin needs Firefox or WebKit are accepted at wave end on the `wave` profile, not per PR.
3. code-reviewer APPROVED and security-analyst no Critical/High (D-004), and the CLAUDE.md §8 DoD items.
4. **Wave end:** a lane C `wave-end` run green on `main` after the wave's last merge, plus a lane B `wave` profile run on the same SHA. **G3 / G4:** a lane C `release-candidate` run green on the gate SHA and lane B `gate` evidence for the same SHA. `release.yml` step 1 now checks "a lane C run concluded `success` for the tagged SHA" instead of "`ci.yml` for that SHA concluded `success`".

**Degraded mode** (allowance exhausted before the monthly reset; GitHub blocks hosted runs without a payment method): test-runner executes lane A locally (`npm run quality:fastlane`, identical steps) and its `fastlane.json` is committed as evidence; the orchestrator logs each degraded merge in DECISIONS.md and dispatches lane C for them after the reset. Degraded mode never waives the code-reviewer or security-analyst verdicts.

### D. Monthly minutes against the free allowance (≈ 2,000 Linux 2-core minutes = $12 included compute; platform.md Appendix A)

| Hosted workload | Job-min per run | Runs per month (P5 estimate: 100 PRs, 100 merges, 5 wave ends, 2 gates) | Minutes |
|---|---|---|---|
| Lane A on PRs (incremental, single job; the local pre-flight makes most PRs pass first time) | ≈ 8 typical / 14 full-trigger → blended ≈ 9 | 100 × 1.3 | ≈ 1,170 |
| Lane A `iac` steps (infra PRs) | 3 | 10 | 30 |
| Lane C `wave-end` | ≈ 85 | 5 | ≈ 425 |
| Lane C `release-candidate` (pre-G3, pre-G4) | ≈ 85 | 2 | ≈ 170 |
| `release.yml` (`v0.1.0-m0`, `v0.1.0`: promote, rescan, SBOM, pull from GHCR + compose smoke) | ≈ 15 | 2 | 30 |
| `cd.yml` no-op notice | 0.2 | 2 | 1 |
| **Subtotal, default configuration** | | | **≈ 1,830 (≈ 92 %)** |
| Optional `push`-to-`main` fast lane (`CI_MAIN_FAST_LANE=true`) | ≈ 4.5 | 85 code merges | + ≈ 380 → ≈ 2,210 (over; hence off by default) |

**Guards.** The orchestrator checks usage weekly (GitHub → Settings → Billing → Usage; devops-engineer confirms the `gh api` usage endpoint in Wave 0 and adds `npm run ci:minutes` that prints it). At **≥ 70 %** before the 21st of the month: `CI_MAIN_FAST_LANE=false` (if on) and no further `wave-end` dispatches that month (lane B `wave` profile only). At **≥ 90 %**: lane C for gates only. At **100 %**: degraded mode (section C). Artifacts: 1-day retention, summaries only (500 MB storage pool). Caches (`node_modules`, `.tsbuildinfo`, ESLint) ≤ 1 GB of the 10 GB.

Assumptions (medium confidence; measured in P5 and re-estimated at the first wave end): 100 PRs/month; 1.3 lane-A runs per PR; 8 min per incremental run; 85 min per full run on 2 vCPU. If measurements exceed the estimate, the levers in order are: fewer `wave-end` dispatches (lane B covers the wave), making the repository public (option A), a self-hosted runner (option C, label switch), paid minutes (option B, needs a budget change).

### E. Consequences of the amendment

- Positive: $0, private repository, objective DoD (evidence files with SHA and hashes), Linux cross-check at wave ends.
- Negative: the heavy suites depend on one machine's availability; results are produced on Windows + Docker Desktop while production is Linux (R-ARCH-17; mitigated by lane C and `.gitattributes` `* text=auto eol=lf`); PR coverage is a diff gate until the next lane B/C run; evidence commits add `test(evidence)` noise to the log.
- **NFR-OPS-003:** the ≤ 20-minute wall-clock target applies to lane A (≈ 8–15 min) and, through per-browser sharding, to lane C (≈ 20–25 min, measured and reported). Every brief §10 stage exists in the workflows; some execute on dispatch only. The stage-presence test is unchanged.
- **NFR-PERF-001/007 reference host:** k6 gates run on the developer host (spec recorded in every `k6-*.summary.json`), the "developer machine ≥ 8 cores / 16 GB" branch of NFR.md's reference-host clause; the hosted 2-vCPU k6 smoke in lane C is reported, not gated. performance-engineer re-baselines A-029 in P4.
- Wave 0 tasks implied: `quality:heavy`, `quality:fastlane`, `quality:check-evidence`, `quality:prune`, `ci:minutes` scripts (Node/TypeScript), `docs/05-quality/README.md` and the JSON Schema; `ci.yml` with the lane conditions; `nightly.yml` without `schedule`; SPK-07.
