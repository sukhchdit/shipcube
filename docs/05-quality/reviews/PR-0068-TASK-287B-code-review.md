# Code review: TASK-287 part 287-B (workflow PR: event-commit check and fast-lane outputs in ci.yml, V2 only, PR #62 follow-ups), round 1, pre-push

Reviewer: code-reviewer (principal engineer). Branch `ci/TASK-287B-workflow`, not yet pushed, no PR number (the orchestrator renames this file to `PR-<nnnn>-TASK-287B-code-review.md` once the PR exists). Reviewed head: `06f62acfa6a19a9235a7d743d1e3d5fe3376e43b`, one commit on `36bc841` (origin/main had moved to `c8353ed` by the time of this review: plan and review docs only, no overlap). Diff: `git diff 36bc841 06f62ac`, 8 files, +228/-119.

Specs: the TASK-287 card (287-B, as amended by D-ORCH-135 item 7); PR #62 code review r1 (`PR-0062-TASK-287A-code-review.md`: R1-m1, R1-m2, R1-n1..n5); D-SEC-PR62-01 (PR62-SEC-02 condition on 287-B; PR62-SEC-01 to 287-C); SPK-07 §6.1; `docs/07-ops/CI-CD.md`; ADR-0023 am. L and N; D-ORCH-119 (O3 push budget, R-CI-MIN); D-ORCH-135.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: PR62-SEC-02 is done exactly: V2 only, the four FAST_LANE_* entries required with exact values, and both transitional
  helpers deleted. The head policy is strictly stronger than main's (main policy over the head ci.yml: 0; head policy over
  main's ci.yml: 6 findings, the designed ones). R1-m1 and R1-m2 are fixed with killing tests (4 of 4 mutants killed).
  run-full is a strict subset of 287-A's, fail-closed and within MAX_API_CALLS, so CI minutes are not worse. One MINOR: a
  non-voided run that never ran the code (a cancelled, superseded run or a light run) also suppresses run-full. Five NITs.
```

## 1. What I verified myself

Host rule: a heavy lane-B run held the machine. So: no npm, jest, typecheck, build or Docker. I did static review plus single-process Node probes on `git archive` extracts of `36bc841` (main) and `06f62ac` (head), in the scratchpad. The worktree was not modified (`git status -s` clean after the checks).

**Not re-run:**
- `npm run typecheck` / `lint` / `test:unit`;
- the new jest cases themselves (I re-implemented their assertions as probes);
- lane A (the branch is not pushed) and lane B (no evidence for this head yet).

The type-level reading below is by inspection only.

| Check | Result |
|---|---|
| Prettier 3 (`node node_modules/prettier/bin/prettier.cjs --check`) on all 8 changed files, in the worktree | clean |
| Policy over `ci.yml`, `lane-c.yml`, `nightly.yml` (`checkWorkflowPolicy`, single-process import) | main policy × main workflows **0**; main policy × head workflows **0**, so this PR's own run passes its tested base; head policy × head workflows **0**; head policy × main workflows **6**: V1 in both tooling steps, plus the four missing `FAST_LANE_*` entries. Exactly the designed tightening, nothing else |
| No gate weakened (by construction) | (1) `pinnedScriptProblems(V2)` accepts a subset of what `pinnedScriptAlternativesProblems([V1, V2])` accepted. (2) The four entries moved from `envOptional` (checked only when present) into `env` (missing is a finding, a wrong value is a finding, an unlisted entry is a finding). (3) `voidedByBase` under the head implies `voidedByBase` under main: only `&&` conditions were added. It only turns light into full, so it can never relax a gate. Rule (b) still needs this run's CODE steps |
| ci.yml wiring | The fast-lane job declares outputs `mode`, `code_proof`, `security_integration_due` and `tools_ref` (`ci.yml:90-95`). All four are keys of `CLASSIFICATION_KEYS`, so rule (g)'s per-output compare (`lane-scope.mjs:956-962`) has a value on both sides. If fast-lane was skipped or red, the empty outputs mismatch, but (a) is red anyway. The check lines sit exactly where `withEventShaCheck` puts them: before `tools_ref=""`, after `set -euo pipefail` / `mkdir`. On `pull_request` (merge ref) and `push`, actions/checkout checks out `GITHUB_SHA`. No `uses:` line and no action-step `env:` changed, so the PR62-SEC-01 interim record check has nothing to compare |
| Removed exports | `pinnedScriptAlternativesProblems` and `envOptional` have no remaining reference (`git grep` at the head). V1 `FAST_LANE_TOOLING_SCRIPT` / `CI_GATE_TOOLING_SCRIPT_TESTED_BASE` stay exported as the base of `withEventShaCheck` and for the behavioural `runStep` tests. V2's bash check is executed by the existing 287-A test `lane-scope-stage-2.test.ts:983` |
| Deleted-describe check | Two tests were rewritten in place, and nothing else was removed. (1) "V1 and V2 both pass" became "V2 passes, V1 in either step refused, exit-0 V2 refused". (2) "may carry the outputs" became "carries all four; dropping each is a finding; wrong value; unlisted entry". The old positive V1/no-entries assertions are inverted, as PR62-SEC-02 requires |

**R1-m1 probes** (`lookupProofs` imported from each extract; fake runs API; tested base changed at 12:00; scratchpad `p287b/probes/p2-lookup.mjs`):

| Case | head `voidedByBase` | main (287-A) | API calls (head) |
|---|---|---|---|
| A only voided run, green | true | true | 5 |
| B only voided run, red (review probe 1) | **false** | true | 5 |
| C voided green + newer non-voided full run, red (review probe 2) | **false** | true | 5 |
| D voided green + newer non-voided run **cancelled** (superseded while pending; no jobs) | **false** | true | 5 (m1 below) |
| E voided green + newer non-voided **light** run | **false** | true | 5 (m1 below) |
| F voided red (newer) + voided green (older) | true | true | 6 |
| G voided green, its jobs API call fails | false (fail closed) | true | 5 |
| H voided green but lacking a step the base has since made required | **false** | true | 5 (n1 below) |
| I 60 voided red runs, then one green | false, stops at the cap | true | **40** = `MAX_API_CALLS` |
| J voided light run (older docs push) + voided green code run | true (the loop moves past the light run) | true | 6 |

**Mutants** (sed on a copy of the head file; each rerun against the assertions of the new tests):

| Mutant | Killed by |
|---|---|
| (e) without `pr &&` | R1-m2 test, `lane-scope-stage-2.test.ts:604`: "security-integration pending (record missing)" |
| (b) without `!pr \|\|` | the same test, light-push half: `[]` instead of `code gates skipped` |
| (c) without `pr &&` | the same test: an extra `no code proof` reason |
| `!nonVoidedSeen` dropped | probe 2, `:870`: case C becomes true |
| voided jobs check bypassed (`if (true)`) | probe 1, `:859`: case B becomes true |
| `lintControls` → `false` in the voided check | **survives**: no test combines a lint-control range with a voided run (n2) |

## 2. Follow-up closure (PR #62 r1, D-SEC-PR62-01, D-ORCH-135)

| Item | Where | Status |
|---|---|---|
| PR62-SEC-02: V2 only | `check-workflow-policy.mjs:778`, `:936` (`pinnedScriptProblems(..._V2)`); `ci.yml:123-126`, `:512-515` | **Closed.** Test `ci-policy-stage-2.test.ts:719`: V1 in either step and an `exit 0` V2 are refused |
| PR62-SEC-02: four `FAST_LANE_*` required | `check-workflow-policy.mjs:590-597` (`CI_GATE_ENV_TESTED_BASE` spreads `CI_GATE_ENV_FAST_LANE_OUTPUTS`); `ci.yml:628-631`; `envOptional` deleted (`:1767`) | **Closed.** `:814` it.each drops each entry and expects exactly one finding; `:821` covers a wrong value and an unlisted entry |
| PR59-SEC-01 item 2, workflow half | `ci.yml:123`, `:512` | **Closed** (both steps carry the check; the policy pins it) |
| PR55-SEC-05, workflow half | `ci.yml:628-631` | **Closed.** The aggregation now compares each output (main's `gateInputStage2FromEnv` already reads them, so it is live from this PR's own run) |
| R1-m1 | `lane-scope.mjs:722-726`, `:773`, `:779`, `:799-823`; SPK-07 §6.1; CI-CD.md §1 | **Closed as specified**, with tests `:859`/`:870` (+ green control). Code, JSDoc, SPK-07 and CI-CD.md now say the same thing. The specified rule (i) is slightly too broad; see m1 |
| R1-m2 | `lane-scope-stage-2.test.ts:604` | **Closed** (three mutants killed) |
| R1-n1 | `check-workflow-policy.mjs:56`, `:763`, `:1564`; `security-paths.mjs:7-9`; `lane-scope.mjs:697`; `ci.yml:32` | **Closed**, with small residue (n3) |
| R1-n2 | `CI-CD.md:164-172` | **Closed.** The residual is stated: `uses:` and action-step keys are unpinned until 287-C; `checkoutProblem` runs from the chosen `HEAD^1`; the record-names-head rule; the interim record checks (D-SEC-PR62-01). This matches the security ruling |
| R1-n3 | `ci-policy-stage-2.test.ts:751-755` | **Closed** (G3, G6, G7, submodules, plus ci-gate `path:`) |
| R1-n4 | `CI-CD.md:81-82` | **Closed** ("3.5 (the first one measured 4)") |
| R1-n5 | `docs/sdlc/DECISIONS.md` | **Open, orchestrator's** (no `D-TASK287*` entry; the commit message does not mention n5). Log it at merge (n5 below) |

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/ci/lane-scope.mjs:779` (`if (candidates.length > 0) nonVoidedSeen = true;`), `:801` | Any bound, completed, non-voided run on the identical set suppresses run-full, including runs that never ran the code on the new base. Two cases: (D) a docs-push run superseded while pending by the `concurrency` queue (`ci.yml:57-59`), which GitHub lists as completed/cancelled; (E) a light run, for example the BLOCKED light run that follows a transient jobs-API failure (case G), which then makes every later docs push BLOCKED as well. Such a run says nothing about the code on the current base, so the SPK-07 §6.1 reasoning ("the code must run on the new base anyway; full is cheaper") still applies. The result is a light 3.5 min run plus a close/reopen full run (8-10) instead of the full run alone, and a round trip. This is a cost and UX regression against 287-A for exactly those cases; it is not a safety defect, because BLOCKED fails closed. Rule (i) of my colleague's R1-m1 fix said "no bound, non-voided completed run", and the code follows that wording; the intent was "a non-voided run that is **red on code**". | Count a non-voided candidate as `nonVoidedSeen` only when its fast-lane actually ran the CODE steps and one concluded `failure` (or scans concluded `failure`). Its problems are already computed in the candidate loop, so this costs no extra API call. A cancelled or absent fast-lane, a `skipped` step or a jobs-API error leaves it false. Add case D (a cancelled newer run plus a voided green run gives full) to the `run(...)` tests. Reword the three docs from "a newer non-voided run" to "a newer non-voided run that failed on the code". Can ride 287-C if the orchestrator prefers not to spend another cycle (it does not block the merge) |
| R1-n1 | NIT | `tools/ci/lane-scope.mjs:806-818` | "Would have been a proof" is judged against the **current** test merge's required steps (`proofSteps(HEAD:ci.yml)`). When the base change that voided the run is a workflow or policy PR that adds or renames a required gate step, every voided run has that step `missing` and no longer counts, so run-full degrades to BLOCKED for every open PR (probe H). Workflow or policy changes are the most common voiding change. | In the voided check, ignore `missing` conclusions and disqualify only on `failure`/`cancelled`, or on a red or absent job. Fail-closed is unaffected, because voidedByBase only adds gates |
| R1-n2 | NIT | `tools/ci/lane-scope-stage-2.test.ts:859-882` | Not pinned by any test: newest-first ordering across voided runs (case F); the budget cap in the voided loop (case I); `lintControls` passed to the voided check (the surviving mutant above). | One `run(...)` row each, or a direct `lookupProofs` unit row like those at `:474`/`:507` |
| R1-n3 | NIT | `tools/ci/check-workflow-policy.mjs:1574-1578` (finding texts "job scans must not ..."), `:56` (line now over the comment width); `tools/ci/lane-scope.mjs:108` ("by CI_REQUIRED_GATES `gate`"); `.github/workflows/ci.yml:118`, `:473` (ragged rewraps: "Every GATE_* location below comes only" / "gitleaks and the" end short lines) | R1-n1 residue: the user-visible finding texts still name the retired job | Say "job ci-gate (the folded scans)", `CI_REQUIRED_GATES_STAGE_2`, and rewrap the two comment paragraphs |
| R1-n4 | NIT | `tools/ci/lane-scope.mjs:1213-1218` (run-full comment at the override) | It still says "whose only proof candidates were voided … Without any candidate (the code run is pending or red)", which is the pre-R1-m1 wording; the JSDoc and the docs were updated | Mirror the JSDoc at `:701-704` |
| R1-n5 | NIT | `docs/sdlc/DECISIONS.md` | PR #62 R1-n5 is still open: there is no D-TASK287 entry for "run-full narrowed to voided would-be proofs; PR55-SEC-05 lines in 287-B; V2 only". D-ORCH-135 routed n1..n5 to 287-B | Orchestrator or devops logs it at merge |

No BLOCKER or MAJOR.

## 4. Design and correctness notes (no finding)

**R1-m1 stays fail-closed:**
- An unreadable base history gives `null`, and so false.
- A binding problem breaks out before anything is voided.
- A jobs-API error on a voided run gives false.
- Hitting the cap breaks the loop and gives false.

Each of these leaves the push light and BLOCKED. The extra cost is at most one jobs call per voided run, newest first, stopping at the first would-be proof. All calls go through the same `call` counter, so the total stays at or below `MAX_API_CALLS` (40; probe I).

**Rule (g) with the new calls.** Both lane-scope instances repeat the same deterministic calls on completed runs, so their classifications agree. The pre-existing race (a run completing between classify and ci-gate) stays fail-closed, and the PR queue (`cancel-in-progress: false`) keeps it rare.

**CI minutes (R-CI-MIN, D-ORCH-119): not worse.**
- run-full under the head fires on a strict subset of the cases where it fired under main (table §1): it saves 8-10 billed min in each of B, C, G, H and I compared with 287-A.
- m1/n1 lose the 287-A saving only in cases D, E and H.
- The two `git rev-parse` lines and the four env entries cost nothing measurable.

**Merging voids proofs on every open PR.** The merge changes `tools/ci/**` and `.github/workflows/ci.yml`, both PR46-SEC-16 inputs. Every open PR's runs are then voided, and their next docs push runs full when the voided run was green (by design).

## 5. Merge conditions

1. Push `06f62ac` as one code push (O3). A full lane A must be green at the pushed head, with ci-gate MERGE-READY. This is the first live run of the V2 check and the `FAST_LANE_*` compare, which main's tooling evaluates. A red result from either is fail-closed: revert, never bypass (D-SEC-PR62-01 condition 2).
2. Workflow PR: a security record on the branch must name the code head (D-ORCH-116, PR59-SEC-01 (3)). The PR62-SEC-01 interim check is trivially satisfied: no `uses:` line changed and no action step gained `env:`.
3. A lane-B `pr` run on the head (the jest suites were not run in this review), or the orchestrator's accepted equivalent.
4. m1 is fixed in this cycle or routed with an owner (287-C, devops). n1-n5 are optional; n5 goes to the orchestrator.
5. After the merge, run `gen.mjs --write` if the card DoD lines depend on `tools/ci` (D-ARCH-139). 287-C (PR62-SEC-01, policy first) is next among the workflow PRs.

## 6. Security flags (for security-analyst)

- None new. The change only tightens: V2 only, the env entries required, run-full narrowed.
- The PR62-SEC-01 residual is restated correctly in CI-CD.md §5. Pinning stays with 287-C.

## 7. Good patterns worth keeping

- The policy-first switch was completed exactly as ruled. Each transitional acceptance was deleted together with its helper, and the tests were inverted: V1 and a missing entry now fail.
- The new test rows are derived from the exported constants (`CHECKOUT_IS_EVENT_SHA`, `CI_GATE_ENV_FAST_LANE_OUTPUTS`), so they cannot drift from the policy.
- The voided-run check reuses the proof predicates (`fastLaneProblems` + `scansProblems`). It counts every call against the same budget.
- probe 2 carries a green control, so the test proves that the newer run is what decides the result.
