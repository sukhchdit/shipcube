# docs/05-quality: quality evidence

Index of the quality records and of the lane B (local heavy lane) evidence. Rules: [TEST-STRATEGY.md](TEST-STRATEGY.md) sections 4 and 9; ADR-0023 amendments B, C, G and I item 4 (`docs/03-architecture/adr/ADR-0023-ci-cd-and-release.md`); D-QA-001, D-ARCH-010, D-ARCH-021; risks R-ARCH-16 and R-ARCH-21.

| Path | Content | Owner |
|---|---|---|
| `TEST-STRATEGY.md` | Lanes, suites, profiles, evidence rules | qa-lead |
| `tests/` | Security test cases, journeys, Gherkin map, defects, quarantine; lane B `runs/` | qa-lead; `runs/` machine-generated |
| `security/` | Security reviews; lane B `runs/` (ZAP, Trivy, Gitleaks, osv, npm audit) | security-analyst; `runs/` machine-generated |
| `performance/` | Lane B `runs/` (k6, Lighthouse, Stryker, host spec) | performance-engineer; `runs/` machine-generated |
| `reviews/` | code-reviewer and security-analyst verdicts | reviewers |
| `../../tools/quality/required-suites.json` | Required-suite manifest (moved from `tests/` by T-QA-01) | qa-lead content, code-owned |
| `../../tools/quality/summary.schema.json` | JSON Schema of `summary.json` | devops-engineer |

## Evidence layout

```
docs/05-quality/{tests,security,performance}/runs/<stamp>_<sha7>/
  summary.json            written by quality:heavy; schema tools/quality/summary.schema.json
  summary.md              rendering of summary.json
  <suite>.junit.xml       one per manifest suite ID that ran
  ...                     attachments listed with their SHA-256 in summary.json
```

- **Naming.** `<stamp>` is the UTC run start as `YYYYMMDDTHHMMZ`; `<sha7>` is the first 7 hex digits of the commit the suites ran against (`summary.json` `git_sha`). Example: `runs/20261120T1432Z_a1b2c3d/`. One run uses the same directory name in each of the three areas.
- **Allowed file names** (anything else is rejected): `summary.json`, `summary.md`, `<suite>.junit.xml` for a suite ID of the manifest, `coverage-summary.json`, `compose-up.json`, `axe-summary.json`, `csp-violations.json`, `headers.json`, `restore-report.json`, `flake-report.json`, `ac-trace.json`, `inventory.json`, `zap-baseline.json`, `trivy-<image>.json`, `trivy-config.json`, `gitleaks-full.json`, `osv.json`, `npm-audit.json`, `semgrep.json`, `host-spec.json`, `stryker-summary.json`, `k6-<scenario>.summary.json`, `lighthouse/<route>-<locale>.json`. The list lives in `tools/quality/check-evidence.mjs` (`FIXED_RUN_FILES`, `allowedRunFile`).
- **Content.** JUnit XML and JSON summaries only. No HTML reports, traces, videos, screenshots, raw lcov or image tarballs; Playwright failure output stays in the git-ignored `tests/e2e/output/`. Every file other than `summary.json`/`summary.md` is either a suite report or an attachment, each with its SHA-256 in `summary.json`.
- **Size cap.** 5 MB per run directory.
- **Commit.** Evidence is committed by senior-developer or devops-engineer after test-runner's run (test-runner does not modify the repository), in its own commit: `test(evidence): heavy lane <profile> <sha7> <verdict>`, for example `test(evidence): heavy lane pr a1b2c3d PASS`.
- **Retention.** The run directories of the current and the previous wave plus every gate run are kept. `npm run quality:prune` removes older ones in a dedicated commit; git history keeps them.

## Producing evidence

```
npm run quality:heavy -- --profile pr     # before a PR is marked ready, when its paths select lane B suites
npm run quality:heavy -- --profile wave   # wave end, on main HEAD
npm run quality:heavy -- --profile gate   # G3/G4, on the gate SHA
```

The run is valid only on a clean tree (`git status --porcelain --untracked-files=all` empty over the manifest's `rules.clean_tree_paths`), after a build that did not change the tree (`build_clean: true`), and with no `SKIP_*` variable set. Otherwise `summary.json` says `INVALID`.

Old run directories go with `npm run quality:prune` (keeps the current and previous `wave` runs and every `gate` run; commit the deletion on its own). Degraded mode (ADR-0023 amendment C, hosted minutes exhausted): `npm run quality:fastlane` runs the lane A steps locally and writes `tests/fastlane/<stamp>_<sha7>.json`. That record is outside `runs/`, is not lane B evidence and never waives the hosted `security-integration` job.

## How `quality:check-evidence` decides

```
npm run quality:check-evidence -- --root . --base <base-sha> --head <head-sha> [--profile pr|wave|gate] [--event pull_request|push] [--summary <file>] [--report-only]
```

Exit 0 is PASS, 1 is FAIL, 2 is a usage or internal error. `--report-only` always exits 0. `--event push` skips the check (exit 0, "skipped"), like `check-security-owned-paths --event push`: it is a pull-request control, and on a push to `main` the range is a squash commit whose evidence SHAs are branch commits and so are never ancestors. Lane A passes `--event "$GITHUB_EVENT_NAME"`. Lane A (`.github/workflows/ci.yml`, step "Lane B evidence (quality:check-evidence)") runs the **base-ref** copy of `tools/quality` (script, lib, schema and manifest; SEC-P3-31). When the base ref has no `check-evidence.mjs` yet (bootstrap), it runs the head commit's copy with `--report-only` and says so in the step summary.

1. **Selection.** The changed paths of `base...head` select suites from the manifest:
   - At profile `pr`, a change made only of lane-A-only paths selects nothing. A lane-A-only path matches the `docs-or-ci-only` rule: `docs/**` minus its `exclude` list (the API contract and the tooling inputs) or `.github/**`. Any other change selects `profiles.pr.always` (`unit`) plus the suites of every path rule with a matching glob (`!` globs and `exclude` respected).
   - Profiles `wave` and `gate` select their profile's suite set.
   - **Required** = the selected suites whose manifest `status` is `active`. Selected suites that are still `planned` are listed in the output but not required. When nothing is required, the result is PASS with a note naming the planned suites.
2. **Candidates.** Every `runs/<stamp>_<sha7>/` of the three areas in the head commit, read from git objects (not the working tree). The newest 30 run IDs are evaluated, plus every run the range adds or changes.
3. **A run is accepted** only when all of these hold:
   - Each `summary.json` is schema-valid, and its stamp and SHA match the directory name.
   - Only allowed file names are present, and the directory is within 5 MB.
   - Every report and attachment hash matches, and no file is unlisted.
   - Every JUnit parses (strict reader: no DOCTYPE or entities). Its counts equal `summary.json`, and declared JUnit totals equal its test cases.
   - The verdict recomputed from the JUnit equals the declared verdict. The recomputed verdict is INVALID when `git_dirty`, `!build_clean`, a `SKIP_*` override or any `invalid_reasons` is present. It is FAIL on failures or errors, a non-passed suite status, skips in a zero-skip or security suite, a SEC-TC test case skipped or failed in any suite, `tests < max(min_tests, 1)`, a missing `required_cases` ID, or a JUnit for a suite that is `planned` in the base manifest. That last case (rule 4) only **rejects the run**: it is not credited, and the check fails only if that run was needed. The PR that activates a suite therefore passes with its own run uncredited, from the next PR on the suite is required, and a later activation whose run also carries the newly activated suite is rejected as a whole (so the activation belongs in a manifest-only PR).
   - `git_sha` is an ancestor of the head, and every path changed between `git_sha` and the head is staleness-allowed: `docs/**` minus `docs/03-architecture/api/**` minus the manifest's `tooling_inputs`. Evidence is therefore stale after an `openapi.yaml` change.
   - The run's profile is at least the requested one. Every required suite is present with `tests >= max(min_tests, 1)`, `failures + errors = 0`, and `skipped = 0` if it is zero-skip.
4. **FAIL regardless of the evidence** in any of these cases:
   - An untracked or modified file sits on a clean-tree path of the checkout (SEC-TC-48). In lane A the checkout is clean by construction, so this signal matters when the checker runs locally; in CI the evidence is the self-reported `git_dirty`. `git status` does not list git-ignored files, so a source file hidden by `.git/info/exclude` or a global ignore evades both the heavy run and this check (residual, security-analyst PR23-SEC-05).
   - At profile `gate`, a gate suite is neither `active` nor listed in `deferred_at_gate` (with a `D-...` decision ID).
   - A run directory that the range adds or changes fails integrity: hash, count, schema, name or size checks, or a declared PASS that its own reports contradict.
   - Something is required and no run is accepted.

The verdict and a per-run table (declared and recomputed verdicts, acceptance, reasons) go to stdout and to `--summary`.

## Path rules (profile `pr`; the manifest is authoritative)

| Rule | Changed paths | Suites (plus `unit` whenever any lane B path changed) |
|---|---|---|
| backend | `apps/api/**`, `apps/worker/**`, `packages/**` except `packages/ui/**`, `prisma/**` | integration, api, rbac-matrix, audit-generator, audit-immutability, rls-cross-tenant, catalog-c1-c14, abuse, csrf-cookie, idempotency, ssrf, identity-session, rate-limit, redaction, secrets-keys |
| money-and-carriers | `apps/api/src/modules/{orders,payments,shipments,pickups,quotes,carriers}/**`, `packages/carriers/**` | saga-fault-matrix, payments-webhooks, carrier-resilience |
| jobs-and-platform | `apps/worker/**`, `apps/api/src/platform/**`, `packages/shared/src/queues/**` | jobs-resilience, resilience-deps, observability |
| audit-package | `packages/audit/**`, `apps/api/src/modules/audit/**` | audit-chain, k6-smoke |
| migrations | `prisma/migrations/**`, `prisma/bootstrap/**`, `prisma/schema.prisma` | migrations, query-plan (+ restore-rehearsal for a `-- @data-changing` migration; not yet automated by the checker) |
| repositories | `apps/api/src/modules/*/repository/**` | query-plan |
| frontend | `apps/web/**`, `apps/admin/**`, `packages/ui/**` | e2e-chromium, log-scan |
| public-web | `apps/web/app/routes/**`, `apps/web/react-router.config.ts`, `apps/web/public/**`, `infra/compose/web/**` | lighthouse, headers |
| locales | `**/locales/**`, `**/i18n/**`, `apps/api/src/modules/notifications/templates/**` | e2e-i18n |
| edge-and-headers | `infra/compose/edge/**`, `**/nginx*.conf`, `apps/api/src/platform/http/**` | headers, e2e-security |
| images-and-deps | `**/Dockerfile*`, `compose*.yaml`, `infra/compose/**`, `package-lock.json`, `.npmrc` | compose-up, image-assertions, trivy |
| perf-sensitive | `packages/pricing/**`, `packages/audit/**`, `packages/authz/**`, `tests/load/**` | k6-smoke |
| docs-or-ci-only | `docs/**` (except the API contract and the tooling inputs), `.github/**` | none (lane A only) |

On 2026-11-13 every suite in the manifest is still `planned`, so `quality:check-evidence` currently requires nothing and reports the planned selection. Enforcement starts per suite when qa-lead marks it `active` (TEST-STRATEGY section 9.3).
