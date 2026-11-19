# SPK-07 — CI lanes on the free hosted allowance: measured minutes, wall-clock and exit criteria

| Field | Value |
|---|---|
| Task | TASK-015 part 015-B (Wave 0) · branch `feat/TASK-015-b-lane-c-nightly` |
| Risk | R-ARCH-15 (minutes exhaustion), R-ARCH-19 (`security-integration` minutes), R-PLAN-03; NFR-OPS-003 |
| Design under test | ADR-0023 amendments A, C, G items 5-6 and L (stage 1, D-ARCH-126..129; ruling `docs/03-architecture/rulings/wave-0-ci-minutes.md`); D-ORCH-001; D-ARCH-010 items 1-6; platform.md section 7.8; PLAN.md section 8 |
| Date / data | 2026-11-14. Hosted figures: `npm run ci:minutes` over every run of `sukhchdit/shipcube` created 2026-11-01..2026-11-14 (UTC) and every job attempt of those runs, read through `gh api` |
| Owner | devops-engineer |
| **Verdict** | **GO with a budget warning.** Lane A meets its exit targets with a wide margin (≤ 15 job-min, ≤ 20 min wall-clock). `security-integration` meets ≤ 12 job-min (section 3). The evidence verifier's negative fixtures are rejected (section 4). `npm run ci:minutes` prints the month (section 5). **But** the month's run rate reaches the ADR-0023 70 % guard around 2026-11-23 and ≈ 94 % by month end at the unchanged rate, ≈ 100 % with `security-integration` on every push (section 6). The CI-minutes ruling (ADR-0023 am. L) answers it; its stage 1 (push-scoped light mode, `security-integration` once per code tree, production-closure lockfile rule, forecast guards) lands in this PR, stage 2 in TASK-286. |

## 1. Method

`npm run ci:minutes` (tools/ci/ci-minutes.mjs) lists every workflow run created in the month and every job attempt of
each run (`filter=all`), and applies GitHub's private-repository billing rule: each job's duration rounded **up** to a
whole minute, times the runner multiplier (Linux 1). Skipped jobs count 0. The result is an estimate of the billed
figure; the authoritative number is the billing report, which this repository's token cannot read (the usage endpoint
needs the `user` scope; `--billing` says so and keeps the estimate). **Dependabot runs are not billed**: runs whose
path starts with `dynamic/dependabot/` run on standard GitHub-hosted runners, which GitHub does not bill for Dependabot,
so the tool lists them under "Not billed" and leaves them out of the total, the share and the forecast (ADR-0023 am. L
item 4, D-ARCH-129). Per-run figures: job-minutes of one `ci.yml`
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

**Trigger from this PR's fix cycle (ADR-0023 am. L item 2, D-ARCH-127):** the job runs **once per code tree, on
merge-candidate heads**. The base ref's `tools/ci/lane-scope.mjs` (job `scans`, token on that step only) sets
`security_integration_due` when (a) the PR range touches the item 5 paths, with `package-lock.json` counting only for a
production-closure change (an added, removed or changed `packages[*]` entry without `dev`/`devOptional`, or the root
entry; a new, deleted or unparseable lockfile selects; `security-paths.mjs` `classifyRange`), (b) the security record
check passes (`pass` or `not-required`), and (c) no `security-integration` success exists on a commit whose tree differs
from the head only in docs (a security proof, read from the jobs API). The job also needs `fast-lane` green with the
supply-chain gates passed on this code tree (PR46-SEC-01). Skipped is not waived: `ci-gate` is red with
`security-integration pending (record missing | not run)` until the job or a proof is green.

## 4. Evidence integrity — exit: check-evidence negative fixtures rejected

`tools/quality/check-evidence.test.ts`, block "SEC-TC-48 negative fixtures" (10 cases), runs in lane A's unit suite on
every PR and in this PR's lane B evidence: a PASS verdict contradicted by a failing JUnit, a missing required security
suite, `skipped > 0` in a security suite, an untracked file in a code path, a recorded `SKIP_*` variable, evidence older
than an `openapi.yaml` change, a missing `required_cases` ID, a JUnit file for a planned suite, a skipped SEC-TC case and
a gate profile with a planned suite: **all rejected (PASS)**. The lane C inventory cross-check adds the Linux side
(`missing-suite`, `lower-count`, `linux-fail`; tools/quality/inventory.test.ts).

## 5. `npm run ci:minutes` — exit: prints the month's usage

At the ruling's reading (2026-11-14 ≈ 08:30Z) the month stood at **771 billed minutes** (38.6 %): 803 job-minutes, of
which the 32 of the 8 `dynamic/dependabot/dependabot-updates` runs are not billed (section 1). The tool now prints that
split, the `fast-lane` mode split (full / light, from the `Unit tests` step: skipped in a run whose job succeeded or whose
install ran with the code steps skipped is light) and, with `--forecast [--planned <min>]`, the month forecast:

```
Hosted Actions minutes, sukhchdit/shipcube, 2026-11 (UTC); estimate = per-job duration rounded up x runner multiplier
Total: 851 of 2000 min (42.6 %), guard: guard-70 (tier-1 lane C only (<= 1 wave-end a month), process levers P1/P2 mandatory, CI_MAIN_FAST_LANE stays false)

By workflow:
  ci.yml             155 runs     851 min

Not billed (Dependabot on standard runners): 32 min in 8 run(s), excluded from the total
  dependabot-updates     8 runs      32 min

By job (billed minutes per run: median / p90 / max, n):
  ci.yml:fast-lane (full)                      5 /     6 /     8  n= 126  total 575 min
  ci.yml:scans                                 1 /     2 /     3  n= 122  total 141 min
  ci.yml:ci-gate                               1 /     1 /     1  n= 126  total 126 min
  ci.yml:changes                               1 /     1 /     1  n=   5  total 5 min
  ci.yml:security-integration                  2 /     2 /     2  n=   2  total 4 min

Lane A per pull-request run (ci.yml): job-min median 7, p90 9 (n=127); wall-clock min median 4.3, p90 6.1

Forecast (as of 2026-11-14T13:52:12.890Z): 1880 of 2000 min (94 %) = billed 851 + 62.7 min/day x 16.4 remaining day(s) + planned 0
  rate = billed to date / 13.6 elapsed UTC day(s); guard dates use the rate only (planned minutes have no date)
   70 % ( 1400 min, acts on the forecast): 2026-11-23
   90 % ( 1800 min, acts on actual usage): 2026-11-29
   95 % ( 1900 min, acts on actual usage): not this month
  100 % ( 2000 min, acts on actual usage): not this month
```

(`npm run ci:minutes -- --forecast`, 2026-11-14 ≈ 13:52Z; `--billing`: not readable with this token. Runtime ≈ 3 min: one
API call per run. No light run yet: stage 1 is not on any pushed head.)

## 6. Month forecast and guards (R-ARCH-15, R-ARCH-19)

| Item | Figure |
|---|---|
| Used 2026-11-01..14 (13.4 days) | 771 billed (38.6 %); the 32 Dependabot minutes are not billed |
| Run rate | ≈ 58 billed min/day (≈ 8.7 PR runs/day × ≈ 6.6 job-min) |
| Forecast lane A, 30 days | ≈ 1,815 min (≈ 91 %); the tool's live forecast at 13:52Z is 1,880 (94 %, section 5) |
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

**What the runs are (2026-11-01..14, ruling section 1).** Of the 123 pull-request runs of `ci.yml`, **83 were red and
40 green**; by head commit, **59 were docs-only pushes** (security records, lane B evidence, quality docs) and **64 code
pushes, 21 of them unions** of `main`. A docs-only push re-ran the whole 6.6-minute lane on a code tree an earlier run
had already proved, and `security-integration` ran on every push of a selected PR.

**Forecast with `security-integration` (code review PR #46 m7).** The lane A + Dependabot row above leaves out the job
this PR enables. At its measured 2 min a run on every push of a selected PR (≈ 12.7 min/day for the remaining
16.6 days ≈ 210 min) November reaches ≈ 2,010 min (≈ 100 %), ≈ 104 % with the Wave-0 exit `wave-end`; the 70 % line
moves to ≈ 2026-11-22, 90 % to ≈ 2026-11-27 and 100 % to ≈ 2026-11-30. In degraded mode security-path PRs cannot
merge, because degraded mode never applies to them. `npm run ci:minutes -- --forecast` (section 5) prints the same
arithmetic from live data (billed to date + daily rate × remaining UTC days + planned lane C) with the date of each guard.

**Budget v2 (ruling section 7; per month at the Wave-0 rate: 100 PRs, 73 % security-critical, 143 code pushes incl. 47
unions, 132 docs pushes; six security suites ≈ 8 min a run; one `wave-end` ≈ 75 + nightly ≈ 8).**

| Scenario | Lane A code pushes | Lane A docs pushes | `security-integration` | Lane C + nightly | Total |
|---|---|---|---|---|---|
| Today's workflow, suites active on every push | 143 × 6.6 = 944 | 132 × 6.6 = 871 | 190 × 8 = 1,520 | 83 | 3,418 (171 %) |
| **Stage 1 (this fix cycle: light mode, once-per-tree job, lockfile rule)** | 944 | 132 × 3.7 = 488 | 62 × 8 = 496 | 83 | **2,011 (101 %)** |
| Stage 2 (TASK-286: fold, CODE-gated commitlint/actionlint/install, conditional Semgrep/oasdiff) | 143 × 5.9 = 844 | 132 × 2 = 264 | 496 | 83 | 1,687 (84 %) |
| Stage 2 + TASK-287 (incremental) | 143 × 4.7 = 672 | 264 | 496 | 83 | 1,515 (76 %) |
| Stage 2 + P1/P2 (no incremental) | 120 × 5.9 = 708 | 102 × 2 = 204 | 54 × 8 = 432 | 83 | 1,427 (71 %) |
| Stage 2 + TASK-287 + P1/P2 | 120 × 4.7 = 564 | 204 | 432 | 83 | 1,283 (64 %) |

**Acceptance:** under 70 % with all six suites at the current PR rate holds with stage 2 + TASK-287 + the process
levers P1/P2; stage 2 + P1/P2 alone is at the line (71 %), and the mechanisms without the levers land at 76–84 %. Stage
1 alone does not fit a month, so TASK-286 is due in November. Guards act on the forecast (ADR-0023 am. L item 4): ≥ 70 %
forecast → tier-1 lane C only (≤ 1 `wave-end` a month), P1/P2 mandatory, `CI_MAIN_FAST_LANE` stays `false`; actual ≥ 90 %
→ lane C for gates only, except a tier-1 `wave-end` already planned, up to a hard stop at 95 %; 100 % → degraded mode.

**First light run (stage 1).** This fix cycle's own push carries code, so it runs in full mode. The first light run is
the next docs-only push of this PR (the security delta record), which inherits the code proof of the fix-cycle run; its
billed minutes are recorded here when it has run (ruling estimate ≈ 60–70 s of `fast-lane` work, 1–2 billed minutes,
≈ 3.7 billed minutes for the whole run with `scans` and `ci-gate`).

### 6.1 Stage 2 measured (TASK-286 workflow PR #59, 2026-11-17; PR #59 code review R1-m1)

The first stage-2 runs bill far more than this section planned (5.9 per code push, 2 per docs push). Per-job billed
minutes = job duration rounded up (jobs API, `started_at` to `completed_at`).

| Run | Kind | `fast-lane` | `ci-gate` | Billed | Plan |
|---|---|---|---|---|---|
| 44011154025 (`055083b`) | code push, full | 422 s → 8 (unit 165 s, audit 64 s, lint 58 s, signatures 34 s, type-check 25 s, install 23 s, format 17 s) | 88 s → 2 (gitleaks 42 s, Semgrep 35 s) | **10** | 5.9 |
| 44013660377 (`2d6818b`) | docs push, proof void (main gained a lint-control change, PR #54) | 78 s → 2 (signatures 23 s, audit 16 s, install 15 s, setup-node 9 s) | 86 s → 2 (Semgrep 38 s ran: no proof) | **4** | 2 |
| docs push with a proof (derived from 44013660377) | docs push, light | 78 s → 2 | ≈ 46 s → 1 (Semgrep and oasdiff skipped) | **≈ 3** | 2 |
| Stage 1, 40 pull-request runs since 2026-11-14 | full (unit ran), n = 16 | | | 8–12, **median 10** | 6.6 |
| | light or failed early (unit skipped), n = 24 | | | 3–7, mostly 3–4 | 3.7 |

**Why the plan missed.**
- The 5.9 rested on the 2026-11-01..14 median of 6.6 per full run. Since then the unit suite has grown to 6,100+ tests (165 s on the runner), and the per-push audit and signatures that PR46-SEC-11 made unconditional cost about 100 s in a full run. So a stage-1 full run now also bills about 10.
- Folding `scans` into `ci-gate` saves the separate scans job (1–2 billed). But `ci-gate` now carries gitleaks and Semgrep: about 88 s, so 2 billed. On a code push the fold is roughly neutral.
- On a docs push, the light `fast-lane` runs install, signatures and audit on every push (PR46-SEC-11, D-TASK286-03) and lands just above the 60-second round-up (78 s → 2).
- The widened PR46-SEC-16 void set (D-TASK286-06) turns more docs pushes into proof-less ones. Those cost 4 instead of 3, and need a further code push or a reopen.

**Live month (`npm run ci:minutes -- --forecast`, 2026-11-17T04:38Z).**
- Billed: 1,230 of 2,000 (61.5 %) after 16.2 days, 76 min/day. Forecast 2,279 (114 %).
- Guard dates at this rate: 70 % on 11-19; 90 % on 11-24; 95 % on 11-26; **100 % on 11-27**.
- At 100 % a private repository with a $0 spending limit (CLOUD_BUDGET_MONTHLY_USD 0) gets no further hosted runs. Lane A then stops and degraded mode (ADR-0023 am. C) applies, except for security-critical paths, which cannot merge.
- To end November under 100 % the remaining 13.8 days must average **≤ 55 billed min/day** (≤ 48 for 95 %, ≤ 41 for 90 %): a 27–46 % cut from 76.

**Budget v2 re-forecast (steady month; 143 code pushes, 132 docs pushes, 62 `security-integration` runs, lane C + nightly 83).**
- Docs pushes are taken as half with a proof (3) and half without (4): 3.5.
- The "suites now" column uses the `security-integration` cost measured today: 2 min a run, with only `catalog-c1-c14` and C-1 active.

| Scenario | Code pushes | Docs pushes | `security-integration` (8 / now 2) | Lane C + nightly | Total, six suites | Total, suites now |
|---|---|---|---|---|---|---|
| Plan (this section, stage 2) | 143 × 5.9 = 844 | 132 × 2 = 264 | 496 / 124 | 83 | 1,687 (84 %) | 1,315 (66 %) |
| **Stage 2 measured** | 143 × 10 = 1,430 | 132 × 3.5 = 462 | 496 / 124 | 83 | **2,471 (124 %)** | **2,099 (105 %)** |
| Stage 1 at today's durations (comparison) | 143 × 10 = 1,430 | 132 × 3.7 = 488 | 496 / 124 | 83 | 2,497 (125 %) | 2,125 (106 %) |

#### Options, costed against the "stage 2 measured" row

| # | Option | Mechanism | Saves / month | Total (six suites / now) | When it acts | Ruling needed |
|---|---|---|---|---|---|---|
| O1 | TASK-287 incremental fast lane | Jest `--changedSince`/related tests, restored ESLint and `tsbuildinfo` caches: unit 165 → ≈ 45 s, lint 58 → ≈ 25 s, type-check 25 → ≈ 12 s; fast-lane 422 → ≈ 270 s = 5 billed; code push 10 → 7 | 143 × 3 = **429** | 2,042 (102 %) / 1,670 (84 %) | M task in batch 0.12, after #59: earliest about 11-24..28, so about 3 days of November (≈ 40 min); full effect in December | No (TASK-287 is planned; cache scope needs a security review) |
| O2a | Light fast-lane under 60 s | Trim install, signatures and audit (78 → < 60 s; 54 s of it is the three PR46-SEC-11 steps): npm cache, a lighter signatures call | ≤ 132 × 1 = 132, uncertain (p90 would still round to 2) | 2,339 (117 %) / 1,967 (98 %) | Days, but it changes D-TASK286-03 / PR46-SEC-11 steps | Yes (security) |
| O2b | Full fast-lane under 420 s | 422 s is 2 s over the 8-minute boundary; without O1 the margin is noise | 143 × 1 = 143, fragile | 2,328 (116 %) | — | — |
| O2c | `ci-gate` under 60 s on code pushes | gitleaks 42 s is mostly the image pull, Semgrep 35 s; under 60 s together is not reachable on hosted runners without image caching | ≈ 0 | — | — | — |
| O3 | Fewer pushes per PR | (a) both review records in one docs push per round (−40 docs pushes); (b) local `lint`/`typecheck`/`test:unit` before every code push, so red code pushes are not repeated (−28 code pushes; 83 of 123 runs were red on 11-01..14); (c) P1 unions only when needed (already mandatory) | (a) 140 + (b) 280 = **420** (plus ≈ 28 × 8 `security-integration` on selected PRs) | 2,051 (103 %) / 1,679 (84 %) | **Immediately** (process; also cuts November) | No (orchestrator procedure; extends D-ORCH-078 P1/P2 and D-ORCH-117) |
| O4a | Docs pushes run no job | `paths-ignore` for docs on `pull_request`: no `ci-gate` on the record head, so the merge relies on the previous head's MERGE-READY plus a local base-ref record check; gitleaks of the record commit is lost | 132 × 3.5 = 462 | 2,009 (100 %) / 1,637 (82 %) | Days | Yes (breaks the exact-head merge rule D-ORCH-012/013 and PR59-SEC-01's record-names-head control) |
| O4b | A single "docs gate" job for docs pushes with a valid proof | One job, no npm: tested-base tooling, proof lookup, gitleaks, record, aggregate (≈ 60–80 s → 2 billed); fast-lane skipped; a void proof still runs full | 132 × 1.5 = 198 | 2,273 (114 %) / 1,901 (95 %) | 1–2 weeks (topology change, policy PR first again) | Yes (D-ARCH-128 topology) |
| O5 | D-ARCH-129 guard thresholds | Guards change no per-push cost; they can drop the reserved Wave-0-exit `wave-end` (−75) and nightly (−8). Lowering a threshold only brings degraded mode earlier | ≤ 83 | 2,388 (121 %) | Immediately | Architect (D-ARCH-129) |
| — | Human levers (not agent decisions) | Public repository (unlimited hosted minutes), a spending limit above $0, or a self-hosted runner | all / partial | — | Immediately | Human (PLAN.md §8; CLOUD_BUDGET_MONTHLY_USD) |

**Combined steady state.** O1 + O3:
- Code: 115 × 7 = 805. Docs: 92 × 3.5 = 322. `security-integration`: 54 × 8 = 432. Lane C + nightly: 83.
- Total **1,642 (82 %)** with six suites, **1,318 (66 %)** with today's suites.
- This is the only combination that returns to the D-ARCH-129 band (64–72 %) without a ruling, and only once `security-integration` stays near today's cost.
- With all six suites at 8 min, even O4b on top (92 docs pushes × 1.5 = another −138) only reaches 1,504 (75 %). That month also needs `security-integration` itself cheaper than the 8-minute estimate (suite selection within the job, option (b) of section 6).

**Recommendation: O3, a push budget, adopted now; O1 (TASK-287) dispatched the day #59 merges.**
- O3 is the only option that changes November and needs no ruling. Neither #59 (stage 2 is roughly cost-neutral at today's durations) nor O1 (earliest effect ≈ 11-25) can bring the remaining 13.8 days from 76 to ≤ 55 min/day.
- Concrete budget for the rest of November:
  - per PR review round, at most one code push and one combined record push (D-ORCH-117 already caps fix pushes at two);
  - every code push follows a local `npm run lint && npm run typecheck && npm run test:unit` on the developer host;
  - no unions without a P1 cause, and no re-runs;
  - the orchestrator checks `npm run ci:minutes -- --forecast` daily against a **45 billed min/day** target, which ends November near 92 %.
- If the forecast still crosses 100 %:
  - O5 drops the reserved `wave-end` from November (−75);
  - the human levers are offered, as D-ORCH-100 already does.
- O1 is the structural fix for December onward. O4b and a cheaper `security-integration` go to principal-architect only if O1 + O3 measure above 72 % once the six suites are active.

**First stage-2 docs pushes after #59 (post-merge check of D-ORCH-119; jobs API, 2026-11-17).**

| Run | Kind | `fast-lane` | `ci-gate` | Billed |
|---|---|---|---|---|
| 44040977441 (TASK-029) | docs push **with** a proof (Semgrep and oasdiff skipped) | 131 s → 3 | 58 s → 1 | **4** |
| 44037427119, 44037524886 (TASK-288), 44041197675 (TASK-289) | docs push, no proof (Semgrep ran) | 80–94 s → 2 | 52–65 s → 1–2 | 3–4 |

The first real docs push with a proof billed 4, not the derived 3. Its light fast-lane took 131 s (install,
signatures and audit vary with the registry), and ci-gate without Semgrep billed 1, as derived. Use 3.5 per docs push,
as in the re-forecast above, until more runs are in.

**Run-full instead of BLOCKED (D-TASK286-06a option; TASK-287 part 287-A).** The decision is narrowed by these figures.

| Case | BLOCKED (old) | Run full at once |
|---|---|---|
| Every proof candidate was **voided by the tested base** (PR46-SEC-16): the code must run on the new base before the merge | light 3–4 + the re-push or reopen 8–10 = 11–14, plus a round trip | **8–10** |
| No candidate: the code run is pending, or its fast-lane or scans were red | 3–4 (the next code push is needed anyway) | 8–10, usually wasted |

TASK-287 takes the option only for the first case. `lookupProofs` reports `voidedByBase` only when no bound run on the
code survived the tested-base check and at least one voided run would have been a proof (its fast-lane and scans steps
passed; one jobs call per voided run, PR #62 code review R1-m1, TASK-287 part 287-B); only then does the classify step
set `code_changed=true` / `mode=full`. A red voided run, or a newer non-voided run that failed on the code, keeps the
push light and BLOCKED; a cancelled, superseded or light newer run does not count, and a step the current workflow
added since the voided run is ignored (287-B code review R1-m1/R1-n1, TASK-287 part 287-C1).
`push_scope` stays `docs`, so the summary still shows a docs push.

**Live forecast** (`ci:minutes --forecast`, 2026-11-17T07:31Z): 1,269 billed (63.5 %), 77.8 min/day, forecast
2,334 (116.7 %).

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
