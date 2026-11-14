# CI/CD: lanes, workflows and the minutes budget

Operator view of the pipeline as built in Wave 0 (TASK-007, TASK-011, TASK-015). The design and its reasons are in
ADR-0023 (amendments A to K) and D-ORCH-001 / D-ARCH-010; the test-side rules are in
[TEST-STRATEGY section 4](../05-quality/TEST-STRATEGY.md). Every `node`/`npm` command below runs with the CLAUDE.md
section 2 PATH prefix on the Windows host. Nothing in this pipeline deploys, pushes images or applies infrastructure yet
(`DEPLOY_TARGET_*` blank, `CLOUD_BUDGET_MONTHLY_USD` = 0).

## 1. Lanes

| Lane | Where | Trigger | What | Verdict |
|---|---|---|---|---|
| A (fast lane) | `.github/workflows/ci.yml`, hosted | non-draft pull request; push to `main` only with `CI_MAIN_FAST_LANE=true` | `fast-lane` (base-ref gates, install, lint, format, typecheck, unit, build, lane B evidence check), `scans` (gitleaks range, Semgrep, oasdiff, security record), `security-integration` (only when a security-critical path changed) | `ci-gate` |
| B (heavy lane) | developer host, Docker Desktop | `npm run quality:heavy -- --profile pr\|wave\|gate` | integration, API, generated suites, merged coverage gate, and every other active suite of `tools/quality/required-suites.json` | committed `docs/05-quality/*/runs/<stamp>_<sha7>/summary.json`, checked by lane A |
| C (full lane) | `.github/workflows/lane-c.yml`, hosted | `workflow_dispatch` only | static, integration (merged coverage, US-006 gate), images, e2e-stack (one shard per engine), iac, scans-full, inventory | `lane-c-gate` |
| nightly | `.github/workflows/nightly.yml`, hosted | `workflow_dispatch` only (no schedule) | dependency freshness report, gitleaks over the full history | job conclusions |

### security-integration (lane A)

ADR-0023 amendment G item 5. Job `scans` classifies the PR's changed paths with the **base ref's** copy of
`tools/ci/security-paths.mjs`: `packages/authz/**`, `packages/audit/**`, `packages/config/**`, `prisma/**`,
`apps/api/src/platform/**`, `apps/api/src/modules/identity/**` and `package-lock.json` (unknown range = run). When it matches,
`security-integration` runs every `active` suite of the base manifest's `security_integration_suites` with its lane B
runner entry on ubuntu with Testcontainers (`tools/ci/security-integration.mjs`). `ci-gate` requires it green; it may
be skipped only when the classifier said `false`. Degraded mode never applies to these paths.

## 2. Dispatching lane C and nightly

Check the month first (section 4), then dispatch on the SHA to judge (the run's ref is both the code and the workflow
definition):

```bash
gh workflow run lane-c.yml --ref main -f profile=wave-end -f since=<SHA of the previous wave end>
gh workflow run lane-c.yml --ref main -f profile=release-candidate          # before G3, G4, per release candidate
gh workflow run nightly.yml --ref main -f job=gitleaks-full                  # or dependency-freshness, all
gh run watch "$(gh run list --workflow lane-c.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

- `wave-end` reports a missing Compose stack (`compose.yaml` / `npm run test:stack`, TASK-014) and continues;
  `release-candidate` fails on it.
- `webkit_repeat_each` (`5` or `1`): WebKit repetitions for COND-E2E-FF; keep `5` until qa-lead closes the condition.
- `since`: lane B runs added after that commit are cross-checked by `inventory`; empty = the newest lane B run.
- For a gate run, the orchestrator downloads the `lane-c-evidence` artifact (`inventory.json`, `coverage-summary.json`)
  and commits it with the gate evidence (TEST-STRATEGY section 15 item 3). Lane C has no write token.
- A workflow file that is not on `main` yet cannot be dispatched (GitHub rule): lane C and nightly changes are first
  exercised by the first dispatch after their PR merges.

## 3. Inventory cross-check (lane C)

`tools/quality/inventory.mjs` counts, per active Jest suite of the manifest, the tests lane C ran per file (through the
suite's `suite-runners.json` projects and paths) and compares them with the committed lane B JUnit:

- `missing-suite`: lane B ran tests in a suite, lane C none (any reference run);
- `lower-count`, `linux-fail`: a file with fewer tests, or failures only on Linux, against a lane B run of the same code
  (its commit is in the clone and differs only under `docs/` or `.claude/`).

A discrepancy fails the wave end; the orchestrator logs it in DECISIONS.md and reverts the offending PR
(ADR-0023 amendment G item 6). Playwright counts are recorded per engine and compared once lane B has e2e runners.

## 4. Minutes budget

```bash
npm run ci:minutes                    # this month (UTC), estimate per job, guard level, lane A per-run figures
npm run ci:minutes -- --month 2026-11 --json
npm run ci:minutes -- --billing       # also asks the billing report (needs a token with the `user` scope)
```

The estimate applies GitHub's private-repository rule (each job rounded up to a whole minute, Linux x1); the billing
page is authoritative. Guards (ADR-0023 amendment C): at 70 % `CI_MAIN_FAST_LANE=false` and no further `wave-end`
dispatch that month; at 90 % lane C for gates only; at 100 % degraded mode (`npm run quality:fastlane` locally). The
measured figures and the forecast are in [SPK-07](../04-plan/spikes/SPK-07.md).

## 5. Rules the workflow policy enforces

`tools/ci/check-workflow-policy.mjs` (lane A, from the base ref) checks every workflow: actions pinned by commit SHA,
container tools by digest, read-only top-level permissions, no privileged triggers, no secrets in pull-request jobs,
fail-closed jobs and steps. On top of that: `lane-c.yml` and `nightly.yml` are `workflow_dispatch` only; ci.yml,
lane-c.yml and nightly.yml never publish, push, apply or assume a cloud role; Playwright browsers (and apt through
`--with-deps`) are installed only in lane-c.yml, and only through `npm run deps:rebuild`, which refuses Playwright and
Prisma download redirects.
