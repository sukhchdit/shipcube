# SPK-07 — CI lanes on the free hosted allowance: measured minutes, wall-clock and exit criteria

| Field | Value |
|---|---|
| Task | TASK-015 part 015-B (Wave 0) · branch `feat/TASK-015-b-lane-c-nightly` |
| Risk | R-ARCH-15 (minutes exhaustion), R-ARCH-19 (`security-integration` minutes), R-PLAN-03; NFR-OPS-003 |
| Design under test | ADR-0023 amendments A, C and G items 5-6; D-ORCH-001; D-ARCH-010 items 1-6; platform.md section 7.8; PLAN.md section 8 |
| Date / data | 2026-11-14. Hosted figures: `npm run ci:minutes` over every run of `sukhchdit/shipcube` created 2026-11-01..2026-11-14 (UTC) and every job attempt of those runs, read through `gh api` |
| Owner | devops-engineer |
| **Verdict** | **GO with a budget warning.** Lane A meets its exit targets with a wide margin (≤ 15 job-min, ≤ 20 min wall-clock). `security-integration` meets ≤ 12 job-min (section 3). The evidence verifier's negative fixtures are rejected (section 4). `npm run ci:minutes` prints the month (section 5). **But** the month's run rate already reaches the ADR-0023 70 % guard around 2026-11-23 and ≈ 90 % by month end before any lane C run (section 6); the orchestrator applies the guard levers below. |

## 1. Method

`npm run ci:minutes` (tools/ci/ci-minutes.mjs) lists every workflow run created in the month and every job attempt of
each run (`filter=all`), and applies GitHub's private-repository billing rule: each job's duration rounded **up** to a
whole minute, times the runner multiplier (Linux 1). Skipped jobs count 0. The result is an estimate of the billed
figure; the authoritative number is the billing report, which this repository's token cannot read (the usage endpoint
needs the `user` scope; `--billing` says so and keeps the estimate). Per-run figures: job-minutes of one `ci.yml`
pull-request run (all its jobs), and wall-clock from the run's start to its last update (completed, not cancelled).

## 2. Lane A (fast lane) on a typical PR — exit: ≤ 15 job-min and ≤ 20 min wall-clock

Measured over 117 pull-request runs of `ci.yml` (2026-11-01..14):

| Figure | Median | p90 | Max | Target | Result |
|---|---|---|---|---|---|
| Job-minutes per PR run (`fast-lane` + `scans` + `ci-gate`) | 7 | 9 | 10 | ≤ 15 | **PASS** |
| Wall-clock per PR run (min) | 4.3 | 6.1 | – | ≤ 20 | **PASS** |
| `fast-lane` job (billed min) | 5 | 6 | 8 | – | – |
| `scans` job | 1 | 2 | 2 | – | – |
| `ci-gate` job | 1 | 1 | 1 | – | – |

The fast lane is not incremental yet (`npm run test:unit` runs every unit test; ADR-0023 am. A's `--changedSince` is
not wired), and still lands at ≈ 5 billed minutes, under the ADR's 8-minute assumption. Findings:

- **F-01 rounding dominates small jobs.** `ci-gate` runs for seconds and bills 1 minute on every run: 116 of the
  month's 803 minutes (14 %). `scans` bills 1–2 minutes for ≈ 40–70 s of work. A merge of `ci-gate` into another job is
  not possible (it must aggregate parallel jobs, and the procedural gate reads its conclusion), so this is accepted;
  every NEW job on the PR path costs at least 1 minute per run and must justify it.
- **F-02 docs-only PRs still run lane A** (commitlint needs the install); they bill ≈ 3–4 job-minutes.

## 3. `security-integration` — exit: ≤ 12 job-min

The job runs on this PR (it deletes the SPK-03 spike under `prisma/**`): checkout, `npm ci`, `deps:rebuild`, the active
`security_integration_suites` of the base manifest (today `catalog-c1-c14`; `rls-cross-tenant`, `rbac-matrix`,
`audit-generator`, `audit-immutability` and `csrf-cookie` are `planned` and join on activation) and, once, the C-1
SPK-03 benchmark.

| Run | Job duration | Billed | Of which C-1 benchmark | Target | Result |
|---|---|---|---|---|---|
| PR #46 run 43583093175 (head `9fd3b4d`) | 1 min 40 s (checkout 4 s, `npm ci` 25 s, `deps:rebuild` 3 s with the engine cache, `catalog-c1-c14` 102 tests in 37 s, C-1 20 tests in 19 s) | **2 job-min** | ≈ 0.4 min | ≤ 12 job-min | **PASS** |

Selection (D-TASK015-36): the ADR-0023 am. G item 5 paths plus `package-lock.json`, from the base ref's copy of
`tools/ci/security-paths.mjs`. **Of the 45 PRs opened this month, 33 touch those paths** (36 with the manifest's broader
`security_critical_paths`), against the ≈ 15 a month that platform.md section 7.8 assumed, and each PR averages 2.6 lane A
runs (117 runs / 45 PRs: fix cycles and unions are pushed as new commits). With only `catalog-c1-c14` active the job
bills ≈ 2 min a run; with all six security suites active the estimate is ≈ 6–10 min a run (the generated RLS suite alone
runs ≈ 126 tests with a database per table class).

## 4. Evidence integrity — exit: check-evidence negative fixtures rejected

`tools/quality/check-evidence.test.ts`, block "SEC-TC-48 negative fixtures" (10 cases), runs in lane A's unit suite on
every PR and in this PR's lane B evidence: a PASS verdict contradicted by a failing JUnit, a missing required security
suite, `skipped > 0` in a security suite, an untracked file in a code path, a recorded `SKIP_*` variable, evidence older
than an `openapi.yaml` change, a missing `required_cases` ID, a JUnit file for a planned suite, a skipped SEC-TC case and
a gate profile with a planned suite: **all rejected (PASS)**. The lane C inventory cross-check adds the Linux side
(`missing-suite`, `lower-count`, `linux-fail`; tools/quality/inventory.test.ts).

## 5. `npm run ci:minutes` — exit: prints the month's usage

```
Hosted Actions minutes, sukhchdit/shipcube, 2026-11 (UTC); estimate = per-job duration rounded up x runner multiplier
Total: 803 of 2000 min (40.2 %), guard: ok (no guard reached)

By workflow:
  ci.yml             143 runs     771 min
  dependabot-updates     8 runs      32 min

By job (billed minutes per run: median / p90 / max, n):
  ci.yml:fast-lane                             5 /     6 /     8  n= 116  total 525 min
  ci.yml:scans                                 1 /     2 /     2  n= 112  total 125 min
  ci.yml:ci-gate                               1 /     1 /     1  n= 116  total 116 min
  dependabot-updates:Dependabot                5 /     8 /     8  n=   8  total 32 min
  ci.yml:changes                               1 /     1 /     1  n=   5  total 5 min

Lane A per pull-request run (ci.yml): job-min median 7, p90 9 (n=117); wall-clock min median 4.3, p90 6.1
```

(2026-11-14 ≈ 08:30Z; `--billing`: not readable with this token. Runtime ≈ 3 min: one API call per run.)

## 6. Month forecast and guards (R-ARCH-15, R-ARCH-19)

| Item | Figure |
|---|---|
| Used 2026-11-01..14 (13.4 days) | 803 min (40.2 %) |
| Run rate | ≈ 60 min/day (≈ 8.7 PR runs/day × ≈ 6.6 job-min + Dependabot) |
| Forecast lane A + Dependabot, 30 days | ≈ 1,800 min (≈ 90 %) |
| 70 % guard (1,400 min) reached | ≈ 2026-11-23 at the current rate |
| `security-integration` at the Wave-0 mix (≈ 73 PRs/month × 2.6 runs) | ≈ 380 min/month today (2 min a run); ≈ 1,100–1,900 once all six suites are active |
| Lane C (one `wave-end`, estimate) | ≈ 60–85 job-min per run (section 7) |

ADR-0023's ≈ 1,830-minute plan assumed 100 PRs a month, 1.3 runs each and ≈ 15 security-critical PRs; Wave 0 runs ≈ 260 lane A runs a month (agents push fix cycles
and unions as new commits). The orchestrator should, in the ADR's order: (1) keep `CI_MAIN_FAST_LANE=false` (it is);
(2) at 70 % stop `wave-end` dispatches for the month (lane B `wave` profile instead) and batch fix-cycle pushes (each
push of a PR is a full lane A run; a draft PR runs nothing and gets a red `ci-gate`); (3) at 90 % lane C for gates only;
(4) at 100 % degraded mode. Levers beyond the ADR (public repository, self-hosted label, paid minutes) are human
decisions (PLAN.md section 8). **`security-integration` is the largest new risk:** at the Wave-0 PR mix and with every
security suite active it alone would take most of the allowance. Options for principal-architect and the orchestrator
(not decided here; degraded mode never applies to these paths): (a) run it once per PR head that is ready to merge
(for example only on `ready_for_review` plus the final push, with the orchestrator re-running it before the merge)
rather than on every push; (b) keep it on every push but select suites by changed path within the job; (c) one of the
ADR-0023 levers above. The Wave-0 exit lane C `wave-end` run and the G3 `release-candidate` run should be
planned into the month in which they fall, ahead of PR churn.

## 7. Lane C and nightly (built; first run after merge)

`lane-c.yml` (dispatch-only): `static`, `integration` (merged coverage across unit, unit-dom, integration, api and the
US-006 gate), `images` (`npm run test:stack` once TASK-014's Compose stack is on the SHA; `release-candidate` fails
without it), `e2e-stack` (one shard per engine: mobile + desktop projects; WebKit `--repeat-each=5`; COND-E2E-FF),
`iac` (terraform fmt/validate when `*.tf` exists, Checkov), `scans-full` (gitleaks over the full history),
`inventory` (ADR-0023 am. G item 6) and `lane-c-gate`. `nightly.yml` (dispatch-only): `dependency-freshness`,
`gitleaks-full`.

**Not measurable before merge:** GitHub dispatches only workflows that exist on the default branch, so the first
`lane-c` and `nightly` runs (their wall-clock, job-minutes, the Linux Firefox and WebKit results of COND-E2E-FF, the
inventory against real lane B evidence) happen on the first dispatch after this PR merges. Estimate per `wave-end` run
from the parts measured locally and in lane A: static ≈ 8, integration ≈ 15–20, images ≈ 0 today (≈ 15 once the stack
exists), e2e-stack 3 × ≈ 6–8, iac ≈ 2, scans-full ≈ 2, inventory ≈ 2, gate 1 → **≈ 50–75 job-min**, wall-clock
≈ 20–25 min (the integration job is the long pole). The orchestrator records the measured figures here after the first
dispatch (Wave-0 exit).

**Proven locally before merge** (the same commands, on the committed tree, under the host docker lock):

| Lane C part | Local equivalent | Result |
|---|---|---|
| `e2e-stack` (COND-E2E-FF) | `git archive HEAD` into `node:24-bookworm` (digest-pinned), `npm ci --ignore-scripts`, `npm run deps:rebuild -- --playwright=firefox,webkit` (apt `--with-deps` on Linux), `npm run build`, `CI=1` (retries 1, `globalTimeout`, JUnit) | **Firefox** mobile + desktop **26/26 passed**; **WebKit** mobile + desktop `--repeat-each=5` **130/130 passed** (26 tests × 5; 10 runs of each test across the two projects); 0 flaky, 0 skipped. The SPA-fallback `lang` assertion of PR #4 R4-m1 did not reproduce. Linux in Docker, not the hosted runner: the hosted proof is the first lane C dispatch |
| `iac` | Checkov 3.4.3 (pinned digest) with the job's flags over the repository | 0 failed, 449 `github_actions` checks passed (no Terraform or real Dockerfile on `main` yet; the fixture folders are skipped, they are deliberately bad) |
| `iac` | Terraform 1.17.1 (pinned digest) `fmt -check`, `init -backend=false -lockfile=readonly`, `validate` on a throw-away module | all exit 0 |
| `scans-full` / nightly `gitleaks-full` | `node tools/quality/gitleaks-full.mjs` with the pinned gitleaks image over the full first-parent history (309 commits) | 0 findings with the 17-line baseline; `gitleaks-full.int.test.ts`: 17 lines → 0 findings, 16 lines → exactly the dropped fingerprint |
| `static` | `npm run lint`, `format:check`, `typecheck`, actionlint (pinned image) over all three workflows | all exit 0 |
| `integration` (merged coverage) | lane B `pr` profile run 20261114T1017Z_8d83468 (same merged-coverage code path) | PASS, lines 98.24 %, branches 96.31 % |
| Dispatch | `gh workflow run lane-c.yml --ref <branch>` before merge | refused by GitHub (the workflow is not on the default branch); first run after merge |

## 8. Exit summary

| Exit criterion (PLAN.md section 9) | Result |
|---|---|
| Fast lane ≤ 15 job-min on a typical PR, ≤ 20 min wall-clock | **PASS** (7 / 4.3 min median; 9 / 6.1 min p90) |
| `security-integration` ≤ 12 job-min | **PASS** (2 job-min with `catalog-c1-c14` + C-1; ≈ 6–10 estimated with all six suites) |
| check-evidence negative fixtures rejected | **PASS** (10/10) |
| `npm run ci:minutes` prints month usage | **PASS** |
| Lane C wall-clock and job-minutes | measured on the first dispatch after merge (section 7) |
