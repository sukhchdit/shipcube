# Code review: PR #62, TASK-287 part 287-A (policy PR: action-input pins, event-commit check, stage-1 retirement, PR55-SEC-05, trigger list), round 1

Reviewer: code-reviewer (principal engineer). Branch `ci/TASK-287A-policy`. Pushed head `1c4dc00`. Reviewed: the local, unpushed head `5d86412` (code) + `77ff897` (lane B evidence only), in the detached worktree `Shipqube-TASK-287A-evidence`. Diff: `git diff origin/main...5d86412`, with `origin/main` at `9874f6d` (#66) and merge base `d173d8f`. Commits: `c71c028` (pins, event commit, triggers), `507df83` (merge of fold 9), `0e5323d` (stage-1 retirement, PR55-SEC-05, run-full), `a85234a` (merge of #56), `1c4dc00` (evidence), `5d86412` (runner-env fix for the lane-scope child in one test).

Specs: the TASK-287 card (WAVE-00.md §TASK-287, PART ORDER, PR59-SEC-01, STAGE-1 RETIREMENT, TRIGGER LIST); ADR-0023 amendments L and N (items 1, 3, 4, 5); D-ARCH-126..128, D-ARCH-139/140; D-SEC-PR59-01; D-ORCH-116; D-ORCH-119 (O3 push budget). There are no `D-TASK287A-*` entries on main (n5).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: All five 287-A items match the card and ADR-0023 am. N. The with: pins catch G1-G7, the stage-1 topology is
  gone and a scans job is refused, V1/V2 are both accepted, PR55-SEC-05 is envOptional plus a compare, and the
  17-entry trigger list is right. Nothing weakens a gate, live ci.yml/lane-c/nightly are at 0 findings under both the
  head and main policy, and there is no file overlap with main or #61/#63/#64/#65. Two MINORs: run-full also fires when
  the identical-code run on the current base is red (minutes, contradicts SPK-07 §6.1), and the push-event gate rules
  lost their only test. Five NITs.
```

## 1. What I verified myself (host rule: static review plus single-process Node probes on `git archive` extracts; no npm, jest, typecheck, build or Docker)

| Check | Result |
|---|---|
| P1 vs main since the merge base | `comm -12` of `d173d8f..origin/main` and `d173d8f..5d86412` file sets is **empty**. Main's #66 (tools/db, lint fixtures) and #67 (`tools/ci/advisory-watchlist.json`, `check-audit.test.ts`) touch no file of this PR. `git merge-tree --write-tree origin/main 77ff897` is clean |
| Overlap with open PRs | `gh pr view` files of #61, #63, #64 and #65 vs this PR: **no shared path**, and none of them touches `tools/ci/**`, `.github/**` or CI docs. Semantic overlap only: #61 (`tools/db/classification.ts`) and #65 (`tools/db/lint-migrations.ts`, `tools/db/table-classes/*.json`) select security-integration once this list is on main (§5) |
| `5d86412` vs `1c4dc00` | `1c4dc00` is an ancestor. The only code delta is `tools/ci/lane-scope-stage-2.test.ts` (+10/-2): the spawned classify child gets `GITHUB_ACTIONS=true` and `GITHUB_SHA=<fixture merge>`. `merge` is destructured from `sharedPr()` and used elsewhere, so it type-checks by inspection. Prettier 3 on that file: clean |
| Other runner-env leaks | Every other `main()` call in the tools/ci tests passes `deps.env`. The one without it (`main(['--bogus'])`) exits in `parseArgs` before `checkoutProblem`. That bootstrap test is the only CLI spawn of `lane-scope.mjs`, so no other test inherits the runner's `GITHUB_SHA` |
| Lane A at `1c4dc00` (run 44103020178) | fast-lane red **only** at `Unit tests` (the runner gap `5d86412` fixes); lint, format, actionlint and type-check green. ci-gate red only at the record step (no security record yet) |
| Lane B `20261118T1308Z_5d86412` (`77ff897`) | profile pr, PASS: unit 6,681 / 0 failures / 2 skipped (platform skips in `file-secret-provider`); merged coverage 99.06 % / 97.17 % |
| Policy over the live workflows | `checkWorkflowPolicy` over ci.yml, lane-c.yml and nightly.yml gives 0 findings with the head tooling and with main's (`d173d8f`) tooling. `node tools/ci/check-workflow-policy.mjs --root .` on the extract exits 0 |
| Removed tests (deleted-describe check) | it/describe title diffs per file. Every removed title is stage-1-only (fixture, `gateVerdict`, `gateInputFromEnv`, scans job, mixture), or is replaced by a stage-2 version: required gates, lane B evidence `_TESTED_BASE`, the R2-m1 attempt test on `gateInputStage2FromEnv`, ci-gate scans steps, and F1-F10/E5 on the stage-2 file. Exception: the push-event gate case (m2) |
| Consumers of removed exports | `topologyOf`, `SCANS_JOB_BY_TOPOLOGY`, `GATE_OUTPUTS`, `gateVerdict`, `gateInputFromEnv`, `checkedOutTopology` and the stage-1 fixture are used nowhere outside `tools/ci` (searched apps, packages, prisma, tests, tools and the plan generator). `gen.mjs` passes the `!` globs as negatives (`globsMatch(p, [g, ...negatives])`), so the new exclusions reach the card DoD lines |

**Probes** (scratchpad `probes/p1-p6.mjs`; head extract vs main extract, live ci.yml mutated):

| Probe | Head | Main |
|---|---|---|
| checkout `ref:`, `repository:`, `path:`, `submodules:` (fast-lane); `fetch-depth: 00`; `persist-credentials: False` | `required-gates` each | 0 (the PR59-SEC-01 gap) |
| `fetch-depth: '0'` (quoted) | 0 (equivalent value) | 0 |
| a `scans` job restored | 1 `required-gates` (retired topology) | 41 findings (topology mismatch) |
| `actions/cache` added in ci-gate | `may not use actions/cache` + ordering | ordering only |
| `GIT_CONFIG_COUNT/KEY_0/VALUE_0` on a checkout step | `preload-env` | same |
| `INPUT_REF`, `GIT_DIR`, `GIT_CONFIG_GLOBAL`, `FOO` in the `env:` of a checkout step; `if: false` on a checkout step | **0** | 0 (n2) |
| checkout, setup-node or cache `uses:` with another 40-hex SHA | **0** | 0 (pre-existing; n2) |
| `lookupProofs`: only a voided run (its code red) / voided run + newer non-voided **red** run / only a non-voided red run | `voidedByBase` **true / true** / false | (no such flag) (m1) |

## 2. Requirements trace (card + ADR-0023 am. N)

| Item | Where | Status |
|---|---|---|
| PR59-SEC-01 (1): exact `with:` per action, per job; nothing outside the map | `check-workflow-policy.mjs` `STAGE_2_ACTION_INPUTS` + the loop in `stage2Findings` (around :1925-1960) | Met. `sameMap` checks the exact key set and string values |
| PR59-SEC-01 (2), policy half: V1 and V2 accepted, nothing else | `CHECKOUT_IS_EVENT_SHA`, `withEventShaCheck`, `pinnedScriptAlternativesProblems` | Met. The test also refuses an `exit 0` V2 and pins the insertion point |
| Extra: `lane-scope.mjs` refuses a checkout that is not `GITHUB_SHA` on a runner | `lane-scope.mjs:1074` `checkoutProblem`, called before `--gate` and classify | Met. It takes effect on merge, because the tested base is main. Defence in depth only (n2) |
| (3) record-names-head stays a standing merge-checklist line | orchestrator checklist | Not this PR's file; see n2 |
| Stage-1 retirement | constants, `topologyOf`, `gate()`, `proofSteps`, `parseArgs` (`--tools-ref` required), fixture deleted; `RETIRED_SCANS_JOB` finding | Met |
| PR55-SEC-05 | `CI_GATE_ENV_FAST_LANE_OUTPUTS` (envOptional, exact) + `FAST_LANE_OUTPUT_ENV` / `gateVerdictStage2` (g) | Met (policy first; 287-B adds the four lines) |
| D-TASK286-06a run-full option | `lookupProofs` `voidedByBase`; override at `lane-scope.mjs:1182` | Met for the intended case. Fires too widely (m1) |
| Trigger list (am. N item 1) | `security-paths.mjs` 17 entries, 4 path-scoped negations; corpus = the card's 10 paths + neighbours | Met. Header corrected except one stale line (n1) |
| G1-G7 verification (am. N "Verification") | `ci-policy-stage-2.test.ts:736` it.each | 4 of 7 shapes; the rest only by my probes (n3) |

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/ci/lane-scope.mjs:761`, `:786`, `:1182`; `docs/04-plan/spikes/SPK-07.md` §6.1 table; `docs/07-ops/CI-CD.md` §1 | `voidedByBase` is set when **any** bound run on the identical-code set was voided. It is still set when the voided run's code was red, and when a newer non-voided run on the same code is red (probe p4, cases 1 and 2). In both cases the docs push now runs the full lane (8-10 billed min). SPK-07's own table calls that case "usually wasted", and SPK-07, CI-CD.md and the PR body all say "proof candidates were **all** voided … with no candidate (pending or red code) it stays light". This is a cost defect under R-CI-MIN (D-ORCH-119 guard of 45 min/day), not a safety defect: the full run is gated by rule (b). | Set the flag only when (i) **no** bound, non-voided completed run exists on the identical set, and (ii) at least one voided run *would have been a proof*: its jobs pass `fastLaneProblems` + `scansProblems`, one jobs call per voided run inside `MAX_API_CALLS`. Then a red code run stays light/BLOCKED as documented. Add the two probe cases to the `run(...)` it.each in `lane-scope-stage-2.test.ts`. If (ii) is judged too expensive, take (i) and reword the three docs to say what the code does |
| R1-m2 | MINOR | `tools/ci/lane-scope.mjs:928`, `:939`; tests | The push-event branch of the gate (`!pr` → (b) only, (c)/(e) PR-only) had one test, `lane-scope.test.ts` "a push to main (CI_MAIN_FAST_LANE) needs (a), (b) and (d) only". It pinned the stage-1 `gateVerdict`, and the PR deletes it. `gateVerdictStage2` has no `event: 'push'` case (searched both stage-2 test files). Dropping `pr &&` from (e) survives the suite, and every main push with a security path would then be BLOCKED. The PR body says the stage-1 tests that pin rules still in force were ported; this one was not. | Port the case to the stage-2 `it.each` in `lane-scope-stage-2.test.ts`: a push with `security_paths=true`, `securityIntegration: 'skipped'`, mode full gives MERGE-READY; a light push gives `code gates skipped on a code push` |
| R1-n1 | NIT | `tools/ci/check-workflow-policy.mjs:56` (scans-isolation header "jobs `scans` and `ci-gate`"), `:777` ("see TOPOLOGIES", removed), `:1579` ("ci.yml job `scans`"); `tools/ci/security-paths.mjs:6-9` ("Job `scans` runs the BASE ref's copy", "no node_modules in job `scans`"; this header was edited for D-ARCH-139); `tools/ci/lane-scope.mjs:694-696` ("undefined (stage 1) does not check"); `.github/workflows/ci.yml:32` (`CI_REQUIRED_GATES`, now `_STAGE_2`; for 287-B) | Stale stage-1 wording after the retirement | Reword to the ci-gate/tested-base topology |
| R1-n2 | NIT | `docs/07-ops/CI-CD.md:162`; PR body "A HEAD-changing checkout input therefore fails closed from the first run" | Overclaim: "so no input can choose the tree, and so the tested base". The `uses:` SHA of checkout, setup-node and cache is not pinned (any 40-hex passes, probe p6, also on main). The `env:` and `if:` of those action steps are not pinned (`GIT_DIR`, `GIT_CONFIG_GLOBAL`, `INPUT_*` pass, probe p2). `checkoutProblem` runs from the `HEAD^1` that the checkout itself chose. ADR-0023 am. N item 3 already states the residual: a `ci.yml` PR controls its own workflow, so the record on the exact head is the control, and the rule stays in the merge checklist. | Restate that residual in CI-CD.md §5, with the standing record-names-head line (card PR59-SEC-01 (3)). Optionally, policy first: an exact `uses:` per action, and an exact step key set `{name, uses, with}` for the action steps of the three jobs. Security-analyst rules on it (§6) |
| R1-n3 | NIT | `tools/ci/ci-policy-stage-2.test.ts:736` | The ADR's verification names G1-G7. The it.each has 4 shapes (fast-lane `ref`, ci-gate `repository`, SI `persist-credentials`, fast-lane `fetch-depth`). `path:` (G6), `submodules:`, fast-lane `repository:` (G3) and SI `repository:` (G7) are covered only by my probes | Add the 3-4 rows; they are one line each |
| R1-n4 | NIT | `docs/07-ops/CI-CD.md:80` | "docs push with a proof about 3" contradicts SPK-07 §6.1 (measured 4; "use 3.5") | Say 3.5 (measured 4) |
| R1-n5 | NIT | `docs/sdlc/DECISIONS.md` | The dispatch names `D-TASK287A-*`, but none exist. The card says the run-full choice "is recorded with the devops re-forecast of D-ORCH-117"; it is only in SPK-07 §6.1 | Orchestrator logs a D-TASK287A entry (run-full narrowed to voided proofs; PR55-SEC-05 env lines ride 287-B; cache hygiene moved to 287-C) at merge |

No BLOCKER or MAJOR.

## 4. Design and correctness notes (no finding)

- **No gate is weakened.**
  - Retirement: the stage-1 rules went with the topology, and a `scans` job is now refused.
  - Stage-1 proofs: a stage-1 run has no scans in ci-gate, so it is no proof (fail closed).
  - Run-full: it turns BLOCKED into a full run. Rule (b) still needs this run's CODE steps, and (c) no longer applies.
  - Trigger list: only widens.
  - `checkoutProblem`: adds a refusal.
  - PR55-SEC-05: only compares the entries that are present, so the live ci.yml, which carries none, is unchanged until 287-B.
- **Rule (g) and run-full.** Both lane-scope instances apply the same override, so the classifications agree. A run that completes between the classify step and ci-gate can still produce a mismatch, which is BLOCKED (fail closed). That race class already existed when a proof appeared late; it is not new.
- **`checkoutProblem` on re-runs.** actions/checkout fetches `GITHUB_SHA` by commit on `pull_request`, so a re-run after main moved still has HEAD = GITHUB_SHA. Push events (`CI_MAIN_FAST_LANE`) check out GITHUB_SHA too.
- **Negations in the trigger list** are path-scoped (`tools/db/**/*.test.ts` cannot exclude a `prisma/**` test). As am. N item 1 says, they exclude `tools/deps/*.int.test.ts` as well, and those are not security-integration suites.
- **CI-minutes (R-CI-MIN, D-ORCH-119): not worse once m1 is fixed.**
  - Trigger widening: about +20-30 job-min a month, accepted in D-ARCH-139 / am. N 1 (e).
  - `checkoutProblem`: 0.
  - Run-full: saves 3-6 min per voided-proof docs push in the intended case, but costs 8-10 in the m1 cases.

## 5. Merge conditions

1. Push `5d86412` + `77ff897` together, as one code push (O3). A **full** lane A must be green at the pushed head: the only lane A run (44103020178 at `1c4dc00`) is red at Unit tests.
2. The security record (tools/ci is security-owned) must name code head `5d86412`, or the fix-cycle head if m1/m2 are taken. This PR changes no `.github/workflows/**` file, so D-ORCH-116 does not apply by its letter, but the record step gates it the same way.
3. Fix m1 and m2 in this cycle, or route them with an owner (287-B is a one-line workflow PR, so 287-C or a 287-A fix cycle). The NITs are optional.
4. After the merge, the orchestrator:
   - re-runs `gen.mjs --write`; TASK-015, TASK-034, TASK-211 and TASK-290 gain the DoD line (D-ORCH-121);
   - dispatches 287-B next, before any other workflow PR (D-ARCH-140).
5. Operability note for sequencing. Merging this moves main under `tools/ci/**`, which is both a P1 union trigger (D-ORCH-078) and a PR46-SEC-16 proof-void path. Each of #61, #63, #64 and #65 then needs one fresh full run, roughly 4 × 8-10 billed min. Their next docs push will run full under the new option rather than BLOCK. #61 and #65 will also newly select security-integration (non-test `tools/db/**` paths). Until this merges, am. N item 1 (c) applies to them: a restricted lane B run is the merge condition.

## 6. Security flags (for security-analyst)

- n2: the action `uses:` SHA, and the step `env:`/`if:` of the pinned action steps, are not pinned (probes p2/p6, also on main). Rule whether exact `uses:` and an exact action-step key set belong in 287-B or 287-C, or whether the am. N item 3 residual plus the standing record rule is the accepted control. `GIT_DIR` and `GIT_CONFIG_GLOBAL` are in the PR59-SEC-02 / 015-C name list for lane-c/nightly; they also pass on ci.yml action steps.
- `checkoutProblem` is defence in depth. A deliberately crafted `ref:` can choose a `HEAD^1` whose tooling lacks the check (it must descend from the event base and have `HEAD^2` = the PR head). The with: pins from an honest tested base and the record on the exact head are the controls.

## 7. Good patterns worth keeping

- Policy first with an explicit V1/V2 alternatives checker that refuses anything else, including an `exit 0` V2.
- The retired topology is refused by name, not merely unsupported.
- `envOptional` for a policy-first env addition, exact per value.
- Run-full is decided in base-ref tooling and recomputed identically by ci-gate, so rule (g) still binds it.
- The trigger list keeps its export names and glob dialect for `gen.mjs`.
- The `5d86412` test pins the event-commit check on the runner instead of masking it.
