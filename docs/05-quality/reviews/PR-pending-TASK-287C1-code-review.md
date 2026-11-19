# Code review: TASK-287 part 287-C1 (policy PR: stage-2 action-step and job allow-lists, action commit pins, cache hygiene, run-full refinements), round 1, pre-push

Reviewer: code-reviewer (principal engineer). Branch `ci/TASK-287C1-policy`. It is not pushed yet and has no PR number; the orchestrator renames this file to `PR-<nnnn>-TASK-287C1-code-review.md` once the PR exists.

Reviewed head: `e8b9414cfe2da80326f88326037641077140e00d`, one commit on `05de264` (#68, 287-B). Diff: `git diff 05de264 e8b9414`, 8 files, +493/-44. No workflow file changes.

Specs:
- the TASK-287 card (287-C, split C1/C2/C3);
- D-SEC-PR62-01: PR62-SEC-01;
- the 287-B security record: PR287B-SEC-01 and -02;
- my 287-B review `PR-pending-TASK-287B-code-review.md`: R1-m1 and R1-n1 to n4;
- D-SEC-PR57-02 / D-TASK287A-03 (cache hygiene);
- SPK-07 §6.1, CI-CD.md, ADR-0023 am. N, D-ORCH-119.

The proposed D-TASK287C-01..06 exist only in the devops handoff and are not on disk.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: PR62-SEC-01, PR287B-SEC-01/-02, the cache-hygiene rule and my 287-B R1-m1/n1/n2/n4 are implemented and
  tested. No gate is weakened: 1,866 mutants of the three live workflows, 0 accepted by the head but refused by main,
  96 newly refused. The live workflows pass the head policy (0 findings, CLI exit 0), and the three pinned commits match
  their upstream tags. Run-full now fires only where the code must run on the new base, with no extra API call. Seven
  NITs, mostly test pins and tripwire gaps. No MINOR or above.
```

## 1. What I verified myself

**Host rule.** Static review plus single-process Node probes on `git archive` extracts of `05de264` (main) and `e8b9414` (head), in the scratchpad (`p287c/probes`). I did not modify the worktree; `git status -s` was clean after the checks.

**Not re-run:** jest, ESLint, typecheck and build. The devops agent did not re-run all 30 tools/ci suites after the two late lint fixes, so the lane B run on `e8b9414` is the evidence for those. I emulated the new lookup and `failedOnCode` assertions against the head module: 15 of 15 pass.

| Check | Result |
|---|---|
| Prettier 3 `--check` on all 8 changed files | clean |
| Policy matrix over the live `ci.yml`, `lane-c.yml` and `nightly.yml` (`checkWorkflowPolicy`) | main×main 0; main×head 0; head×main 0; head×head **0**. `node tools/ci/check-workflow-policy.mjs --root .` on the head extract exits 0, so main's live workflows pass the new policy and no PR breaks after the merge |
| Mutant matrix (scratchpad `p2-mutants.mjs`), main vs head over the three live workflows. Mutants: every line deleted; 8 step-key inserts after every `- name:`; 7 job-key inserts after every job header; 4 `runs-on` values; 5 `uses:` commit edits (zero, one-digit, `#x`, `@y`, tag); 8 cache `path:` values | 1,866 mutants. **0 weakened** (refused by main, accepted by head). 96 newly refused, 904 refused by both. Every action-step key insert on the 8 action steps of the three stage-2 jobs is refused. Every ci.yml `uses:` edit is refused, including `@<pin>#x` and `@<pin>@y` |
| Mutants that neither policy refuses | `id:`/`timeout-minutes:`/`env:` on stage-2 **run** steps (out of scope: PR62-SEC-01 covers action steps); lane-c/nightly `uses:` commits and job keys (out of scope: stage-2 jobs only; TASK-015-C's area) |
| Upstream tags (`gh api …/git/ref/tags/<tag>`, annotated tags dereferenced) | checkout v7.0.1 = `3d3c42e5…`, setup-node v7.1.0 = `949feb24…`, cache v6.1.0 = `55cc8345…`: all three match `STAGE_2_ACTION_COMMITS` |
| Policy fixtures (`tools/ci/fixtures/workflow-policy/*.yml`, `checkedAs` as in the test) | rule sets identical under main and head for every fixture, so the positive controls stay green |
| Gate callers needing the four `FAST_LANE_*` entries (PR287B-SEC-01 now BLOCKS on an absent entry) | Every `gate()`/`main(['--gate'])`/`gateInputStage2FromEnv` caller in tools/ci tests now passes all four, and the values match each test's classification (`lane-scope.test.ts:657-664`, `:697-700`; `lane-scope-stage-2.test.ts:648-651`). Direct `gateVerdictStage2` callers default `fastLaneOutputsMissing` to `[]`. The live ci.yml carries all four, and this PR's own run is judged by main's 287-B tooling, so the rule is not live until the merge |
| Open PRs (#65, #58, #50, #49, #16) | none touches `.github/**` or `tools/ci/**` |

**Run-full probes** (`lookupProofs`, base changed 12:00, newer runs 12:30):

| Case | head | main (287-B) |
|---|---|---|
| A voided green only | full | full |
| B voided red only | light | light |
| C voided green + newer non-voided full run red on Unit tests | light | light |
| D voided green + newer run cancelled (superseded while pending) | **full** | light |
| E voided green + newer light run | **full** | light |
| F voided red (newer) + voided green (older) | full | full |
| G voided green, its jobs API fails | light | light |
| H voided green lacking a step the base added | **full** | light |
| I 50+ voided red runs | light, 40 calls | light, 40 calls |
| K voided green + newer full run red at **install** (CODE steps skipped) | **full** (n3) | light |
| L voided green + newer run cancelled after a CODE failure | light | light |
| M voided green + newer run red at a scans step | light | light |
| N only a voided run with a duplicated, failed scans step | **full** (n5) | light |

**Mutants of the lane-scope change** (sed on a copy; assertions of the new tests):

| Mutant | Result |
|---|---|
| `failedOnCode` counts `cancelled` | killed (`failedOnCode` unit row) |
| scans half of `failedOnCode` dropped | killed (`scans-red` row) |
| `: missing` filter removed | killed (R1-n1 row) |
| `nonVoidedSeen` always true | killed (CLI rows D/E, `lane-scope-stage-2.test.ts:898`) |
| `nonVoidedSeen` never set | killed (287-B probe 2, `:870`) |
| `failedOnCode` counts **any** failed step of fast-lane/ci-gate (name filter dropped) | **survives** (n1) |
| voided-check filter widened to `: failure` | **survives** (n5) |

## 2. Follow-up closure

| Item | Where | Status |
|---|---|---|
| PR62-SEC-01 (action-step keys `{name, uses, with}`, one pinned `if:`, exact commits) | `check-workflow-policy.mjs:551-569`, `:2003-2026` | **Closed in policy** (effective from the merge, for every later ci.yml PR). Tests `ci-policy-stage-2.test.ts:836-896` |
| PR287B-SEC-02 (job key allow-list, `runs-on: ubuntu-24.04`) | `check-workflow-policy.mjs:570-581`, `:1961-1972` | **Closed.** Every deny-listed key of main (`defaults`, `container`, `services`, `strategy`, `continue-on-error`) is still refused. `environment`, `concurrency` and unknown keys are now refused too. Tests `:898-917` |
| PR287B-SEC-01 (absent `FAST_LANE_*` entry reported) | `lane-scope.mjs:994-995`, `:1058-1062` | **Closed.** Absent gives `fast-lane outputs missing (…)`; empty gives `mismatch` (proposed D-TASK287C-06; agreed) |
| D-SEC-PR57-02 / D-TASK287A-03 cache hygiene | `check-workflow-policy.mjs:1166-1208`, `:1577-1580` | **Closed as a tripwire** in every workflow, for `actions/cache`, `cache/restore` and `cache/save`. Gaps in n2 |
| 287-B R1-m1 (only a run red on code blocks run-full) | `lane-scope.mjs:579-601`, `:817-822` | **Closed.** No extra API call. The residual "cancelled after a failed step still counts" (case L) is right; see n3 for the opposite residual |
| 287-B R1-n1 (steps missing from a voided run are ignored) | `lane-scope.mjs:838-843` | **Closed** (case H) |
| 287-B R1-n2 (tests for order, budget, lintControls) | `lane-scope-stage-2.test.ts:1025-1150` | **Closed** |
| 287-B R1-n3 (stale wording) | `check-workflow-policy.mjs:1657-1664`, `lane-scope.mjs:108` | **Closed**. The ci.yml rewraps wait for C2, which is a workflow PR |
| 287-B R1-n4 (override comment) | `lane-scope.mjs:1252-1256` | **Closed** |

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-n1 | NIT | `tools/ci/lane-scope.mjs:589-593`; `tools/ci/lane-scope-stage-2.test.ts:1110-1119` | `failedOnCode` counts only failures of the **named** CODE and scans steps. That restriction is load-bearing: the typical BLOCKED light run has the ci-gate record step red (no record yet), and if that counted, the light run would block run-full again (287-B case E). The mutant that counts any failed step survives every test, because no fixture has a failed non-gate step. | Add a `failedOnCode` row: a light run whose ci-gate record step (or the fast-lane install step) is `failure` gives `false` |
| R1-n2 | NIT | `tools/ci/check-workflow-policy.mjs:1183-1199` | The cache-hygiene matcher misses paths that do restore the lock directory: the whole workspace (`.`, `./`, `${{ github.workspace }}`, `${{github.workspace}}`), absolute runner paths (`/home/runner/work/<repo>/<repo>/node_modules`), `?`/`[...]`/`{a,b}` globs, and expression-valued paths (`${{ env.X }}`). Probe `p3-cache.mjs`: all of these give 0 findings. No live workflow has a cache outside the pinned stage-2 engine cache, so this is a tripwire gap, not exposure. | Normalise the workspace-root forms to the empty path and count it as covering every target. Treat any path containing `${{`, a leading `/` or `~`, or `?[{` as covered unless excluded (fail toward a finding). Add the rows |
| R1-n3 | NIT | `tools/ci/lane-scope.mjs:587-601` (proposed D-TASK287C-04) | A non-voided **full** run that failed at a step run on every push (install, registry signatures, advisory audit, lockfile) has its CODE steps `skipped`, so it does not count (case K). Run-full then repeats a run that fails at the same early step. The cost is close to a light run's, because the job stops at that step, so this is acceptable. | Record it as the second half of the D-TASK287C-04 residual ("a pre-CODE failure does not count; the repeat fails early") so the next reader does not "fix" it the expensive way |
| R1-n4 | NIT | `.github/dependabot.yml:32-43` (github-actions group `['*']`); `docs/07-ops/CI-CD.md:170` ("An action bump is a policy change first") | From the merge on, every monthly Dependabot github-actions group PR that bumps checkout, setup-node or cache will be red at the tested-base policy until a policy PR lands. The group also bumps lane-c/nightly, which share the same SHAs. Nothing breaks, but it is a recurring red PR with no documented procedure. | Add the procedure to CI-CD.md and the dependabot.yml header (policy PR bumping `STAGE_2_ACTION_COMMITS` first, then `@dependabot rebase`), or ignore these three actions in Dependabot and bump them by task PR. Owner: devops (C2 can carry it) |
| R1-n5 | NIT | `tools/ci/lane-scope.mjs:620` (scansProblems reports more than one match as `missing`), `:843` | (a) The `: missing` filter also drops the *ambiguous* (duplicate step name) scans case, so a voided run with a duplicated, failed scans step counts as a would-be proof (case N). This is safe, because it only adds gates. (b) No test row has a voided run with a red **scans** step, so widening the filter to `failure` survives. | Report `ambiguous` in `scansProblems` as `fastLaneProblems` does; add a voided `scans-red` row to the R1-n1 test |
| R1-n6 | NIT | `tools/ci/check-workflow-policy.mjs:2003` | `uses.split('#')[0]?.trim().split('@')` keeps only the first two `@` segments, so `actions/checkout@<pin>@x` passes the commit comparison. Other rules refuse it (matrix: refused under both policies), so it is not exploitable, but the pin should not depend on them. | Compare the whole value: `uses.split('#')[0].trim() === \`${action}@${pinned}\`` |
| R1-n7 | NIT | `docs/07-ops/CI-CD.md:67-69`; `:175-177` | (a) "only when no bound run on its code that failed on the code survived the tested-base check" is hard to parse. (b) "The record may sit on the PR branch or already on `main`" restates the D-ORCH-116 merge rule, whose letter says "on the branch". The security simulation (D-SEC-PR62-01 S2) shows main's copy reaches the check through the merge ref, but the rule text belongs to the orchestrator and security. | (a) "only when no run of this PR on the same code since the tested base changed has failed on the code, and …". (b) Have the orchestrator or security-analyst ratify it in the D-TASK287C entries, or cite the ruling |

No BLOCKER, MAJOR or MINOR.

## 4. Design and correctness notes (no finding)

**No gate is weakened, by construction.**
- The job deny-list became an allow-list that is a strict superset of the refusals.
- The action steps gained a key allow-list, an exact `if:` and an exact commit.
- Cache hygiene only adds findings.
- The gate gains a `missing` reason.
- `voidedByBase` widens (cases D, E, H, K, N). That only turns light into full: rule (b) still needs this run's CODE steps and (c) no longer applies.

**Rule (g).** `failedOnCode` is a pure function of the jobs response that the candidate loop already fetched, so both lane-scope instances decide the same way. A transient jobs-API error on a non-voided candidate now leaves `nonVoidedSeen` false; under 287-B it counted. Either instance may then run full, and if the two disagree, rule (g) is BLOCKED (fail closed).

**CI minutes (R-CI-MIN, D-ORCH-119): not worse.**
- D, E and H replace the BLOCKED light run (3.5) plus close/reopen (8-10) with the full run alone (8-10).
- K repeats an early failure, at about light-run cost.
- N is pathological.
- No extra API call, and the policy checks are offline.
- The merge changes `tools/ci/**`, a PR46-SEC-16 input, so it voids every open PR's proofs once. Their next docs push runs full when the voided run was green.

**`STAGE_2_ACTION_STEP_IFS` is keyed `job:action`.** A second `actions/cache` step in fast-lane would also accept that `if:`. The exact `with:` map and the commit pin still bind it, and the ordering rules bound it too, so this is acceptable.

**Proposed decisions.**
- D-TASK287C-01..03 and -06: agreed.
- D-TASK287C-04: add n3.
- D-TASK287C-05: add the n2 gaps as its residual.

## 5. Merge conditions

1. Lane B `pr` on `e8b9414` PASS, covering every tools/ci suite, because the late lint fixes were not followed by a suite run. ESLint and typecheck must be green.
2. Push as one code push. A full lane A must be green at the pushed head with ci-gate MERGE-READY. tools/ci is security-owned, so a security record must name `e8b9414`, or the fix head.
3. After the merge, the orchestrator watches the first lane A run of any PR (first live run of the allow-lists and the `missing` reason). Red means revert, never bypass. Then run `gen.mjs --write` if card DoD lines depend on `tools/ci`, and dispatch 287-C2 (the workflow half). C2 can carry the n4 Dependabot note and the ci.yml comment rewraps.
4. The NITs are optional. The orchestrator owns n7(b); n3 and n2 go into the D-TASK287C entries.

## 6. Security flags (for security-analyst)

- n7(b): the restated record rule (branch **or** main) needs your ratification.
- n2: the cache-hygiene tripwire gaps (workspace root, absolute and expression paths). They are not exploitable today, because there is no such cache in any workflow.
- Out of scope but visible in the matrix: lane-c/nightly `uses:` commits and job keys are not pinned. Any 40-hex commit with a tag comment passes, as on main. That is TASK-015-C's area; say whether it should get the same `STAGE_2_ACTION_COMMITS` treatment.

## 7. Good patterns worth keeping

- Allow-lists replaced deny-lists in both places: job keys and action-step keys. The pins are exported constants that the tests read.
- `failedOnCode` reuses the candidate loop's jobs response: the fix is precise and costs nothing.
- The R1-n2 tests assert the exact `jobs` call order and the budget note, not just the flag.
- The cache rule is tested through `checkWorkflow` on a real workflow (lane-c.yml) for all three cache actions, not only through the helper.
- The action commits were verified against the upstream tags and the date is recorded beside the table.
