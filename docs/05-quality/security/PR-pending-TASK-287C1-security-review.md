# PR-pending: TASK-287 part 287-C1 (policy PR: stage-2 action steps and job shapes pinned, cache hygiene, run-full refinements), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-287C1-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control C1). This follows the D-ORCH-136 order: open as a draft, rename on main, confirm the rename, then mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `ci/TASK-287C1-policy`, one commit on `05de264` (merge base; PR #68, TASK-287B, merged). To be pushed as the code commit plus one evidence-only commit (lane B run files under `docs/05-quality/tests/runs/` only) |
| Head | e8b9414cfe2da80326f88326037641077140e00d |
| Tip to push | The code commit above plus one evidence-only commit. Main's checker accepts that tip through the merge ref (section 7) |
| Lane A evidence | None: the branch is not pushed. Under the tested-base rule, this PR's run is judged by main's `tools/ci` (287-B). Its own rules first apply to the PRs after the merge |
| Lane B evidence | None for `e8b9414` at review time. The evidence-only commit will carry it (merge condition 3) |
| Owned paths changed | 6, all under `/tools/ci/`: `check-workflow-policy.mjs` (+ `check-workflow-policy.test.ts`, `ci-policy-stage-2.test.ts`), `lane-scope.mjs` (+ `lane-scope.test.ts`, `lane-scope-stage-2.test.ts`). No `.github/**` file changes; `.github` is byte-identical at the merge base and the head |
| Unowned paths changed | `docs/07-ops/CI-CD.md`, `docs/04-plan/spikes/SPK-07.md`, both read |
| Binding items checked | The TASK-287 card (WAVE-00 batch 0.12, 287-C policy-then-workflow). D-SEC-PR62-01: PR62-SEC-01, with its ruling (action-step key set `{name, uses, with}`, exact commit per action) and its interim record checks. D-SECPR287B-01: PR287B-SEC-01, PR287B-SEC-02, the extended interim checks. D-SEC-PR57-02 (cache hygiene, `shipqube-test-locks`). The code review of #68 (R1-m1, R1-n1..n4). D-ORCH-136 (draft-rename-ready order). The code review on main (`370a66b`, `docs/05-quality/reviews/PR-pending-TASK-287C1-code-review.md`, APPROVED_WITH_NITS; read after the probes ran, section 6) |
| Reviewer / date | security-analyst, 2026-11-19, round 1, pre-push. Host rule (a lane-B run held the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node probes on `git archive` extracts of `.github` and `tools/ci` at `e8b9414` (head) and `05de264` (merge base). Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Upstream tags were read with `gh api`. `@actions/glob` 0.6.1, the version `@actions/cache` 6.1.0 depends on, and `minimatch` 3 were fetched with `npm pack` (no install, no scripts) into an isolated scratch directory to reproduce what `actions/cache` archives. Line numbers come from single-file reads at `e8b9414` |

## 1. Summary

The question of this round: does the 287-C1 policy PR close PR62-SEC-01, PR287B-SEC-01 and PR287B-SEC-02 without weakening any gate? Do the live workflows still pass? Do the run-full refinements stay fail-closed inside `MAX_API_CALLS`? Does the new cache-hygiene rule do what D-SEC-PR57-02 asked?

- **No gate is weakened.** I ran the merge-base and head policies side by side over 1,229 mutants of the live `ci.yml` (the PR #68 corpus) plus 268 mutants targeting the new rules: 1,497 in total.
  - No mutant is refused by the merge base and accepted by the head.
  - The live `ci.yml`, `lane-c.yml` and `nightly.yml` give 0 findings under both policies.
- **PR62-SEC-01 is closed.**
  - **Action-step keys.** Every action step of fast-lane, security-integration and ci-gate may carry only `name`, `uses` and `with` (`check-workflow-policy.mjs:567`). The one exception is fast-lane's engine cache, which carries exactly `if: env.CODE == 'true'` (`:568`, `:2006-2021`). 71 of 71 key additions are refused (67 of them accepted at the merge base): `id`, `env: {}`, `env:` with a value, `continue-on-error`, `timeout-minutes`, `shell`, `working-directory`, and an `if:` on any other action step. The 29 earlier PR #68 corpus cases (step `env:`, `if: false`, another 40-hex commit) are now refused too.
  - **Engine-cache `if:`.** 4 of 4 edits are refused: removed, `always()`, `|| true`, and the `${{ }}`-wrapped equivalent. The same string in double quotes is accepted.
  - **Action commits.** Each of the three actions must use its exact commit (`STAGE_2_ACTION_COMMITS`, `:557-561`; the check is at `:2022-2026`). 16 of 16 are refused: another 40-hex commit, or another pinned action's commit, on each of the 8 action steps. 80 further forms were already refused under both policies: a tag, an upper-case commit, a short commit, an `@` suffix, trailing text, `Actions/` or a fork owner, a sub-path, `docker://`, a local action. Accepted: a changed tag comment, or quoting the same `uses` text (the commit is still the pinned one).
  - **Upstream tags.** I resolved each pinned commit against its upstream tag myself (table in section 3); all three match.
- **PR287B-SEC-02 is closed.**
  - The three jobs have exact key sets and `runs-on: ubuntu-24.04` exactly (`:575-580`, check at `:1961-1972`).
  - 38 job-level mutants accepted at the merge base are refused at the head: `self-hosted`, `[self-hosted, linux]`, `[ubuntu-24.04]`, `ubuntu-latest`, `ubuntu-24.04-arm`, a runner-group map, an expression, `environment`, `concurrency`, `uses`, `secrets`, `with`, unknown keys, and `outputs` on the two jobs without them.
  - 19 more were already refused, including `container`, `services`, `strategy`, `defaults` and `continue-on-error`.
  - `runs-on: 'ubuntu-24.04'` (the same string quoted) is accepted.
- **PR287B-SEC-01 is closed.** `gateInputStage2FromEnv` now reports each absent `FAST_LANE_*` entry, and the gate adds `fast-lane outputs missing (<keys>)` (`lane-scope.mjs:1058-1062`, `:994-995`).
  - Probe: all four absent gives BLOCKED with all four keys; one absent gives that key. The merge base gives no reason in either case.
  - Equal, differing and empty values behave as before.
- **The run-full refinements stay fail-closed and bounded.**
  - **`failedOnCode`.** It is true only for a `failure` conclusion of a required fast-lane or scans step. It is false for green, cancelled, light, a missing job, or a malformed or null response.
  - **What changed.** A cancelled or light non-voided run no longer suppresses run-full. A step that the current workflow added since a voided run (`: missing`) no longer disqualifies that run. A missing *job* still disqualifies it.
  - **Gates only added.** Over 22 scenarios, the head never produces a different code proof from the merge base. `voidedByBase` is never true while a proof exists, and API calls never exceed `MAX_API_CALLS` = 40 (60 voided runs: 40 calls; 30 cancelled non-voided runs plus one voided green run: 35).
  - **Why widening is safe.** Run-full now fires in 6 more cases than at the merge base. That only turns a light `BLOCKED: no code proof` push into a full run, where rule (b) requires this run's own code steps. It never removes a gate.
- **New finding: the cache-hygiene rule accepts exclusions that `actions/cache` does not honour (PR287C1-SEC-01, LOW).**
  - `@actions/cache` resolves `path:` with `@actions/glob` and `implicitDescendants: false`. It then archives every resolved directory recursively (`tar --files-from`, no `--no-recursion`).
  - So `node_modules` or `node_modules/.cache` followed by `!node_modules/.cache/shipqube-test-locks` still restores the locks. The rule passes it, and its message and `CI-CD.md` both tell authors to fix a finding exactly that way.
  - With the real `@actions/glob` 0.6.1, 13 of 29 path forms restore the lock directory without a finding. 6 of them are exclusion forms the rule accepts. The other 7 are spellings the rule does not recognise; the code review lists most of those as its R1-n2.
  - No live cache covers the directory today, but 287-C2 (incremental lint, test and type-check caches) is the likely first user. Fix before that.
- **New finding: action commits outside the stage-2 jobs are still pinned by format only (PR287C1-SEC-02, INFO).** `lane-c.yml` and `nightly.yml` accept any 40-hex commit (and action-step `env:`, already PR59-SEC-02). Route to 015-C. Until then, the D-SEC-PR62-01 upstream-tag check continues for `uses:` changes in those two files.

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW (PR287C1-SEC-01), 1 INFO (PR287C1-SEC-02).

## 2. Method

1. **Read the diff.** I read the full diff `05de264..e8b9414` (8 files, +493/-44). At `e8b9414` I read in full:
   - the new constants, `cacheHygieneFindings` and its call in `checkWorkflow`, the job-shape loop and the action-step loop of `stage2Findings`, and `scansStepViolations` (texts only) in `check-workflow-policy.mjs`;
   - `failedOnCode`, `lookupProofs` (candidate and voided loops), `gateVerdictStage2` and `gateInputStage2FromEnv` in `lane-scope.mjs`;
   - both docs, and the test titles: 2 describes and 9 tests added, 1 assertion rewritten for the new message, none removed.
2. **Policy differential** (`s287c/probes/diff-policy.mjs`, the PR #68 corpus, 1,229 mutants of the live `ci.yml`). Baselines: both policies × all three live workflows 0. Results:
   - 0 weaker;
   - 37 stricter: 29 action-step `env`/`if`/`uses` cases, `runs-on: self-hosted` on ci-gate, and 7 line deletions (the three `runs-on` lines, the engine-cache `if:`, and three `- name:` lines whose deletion merges a `run:` into the preceding action step or leaves an action step without a name);
   - the rest unchanged: 932 refused by both, 260 accepted by both.
3. **New-rule families** (`s287c/probes/new-families.mjs`, 268 mutants, both policies):
   - H, job keys and `runs-on` on each job (60);
   - I, `uses` forms on each of the 8 action steps (120);
   - K, action-step keys and the engine-cache `if:` (76);
   - J, `cache-hygiene` wiring in `lane-c.yml` and `nightly.yml`, with `actions/cache`, `cache/restore` and `cache/save` (12).

   Every head result matches the expectation except two:
   - removing the tag comment is refused, by both, under the existing `pinned-action` rule;
   - the J "exclusion" rows: PR287C1-SEC-01.
4. **What `actions/cache` archives** (`s287c/probes/cache-hygiene.mjs`). In a scratch workspace holding `node_modules/.cache/shipqube-test-locks/lock-a`, `node_modules/.cache/other/x`, `node_modules/pkg` and `src`, for 29 `path:` forms I ran both:
   - the head's `cacheHygieneFindings`;
   - `@actions/glob` 0.6.1 `create(patterns, { implicitDescendants: false })`, made workspace-relative as `@actions/cache` `resolvePaths` does, then expanded recursively the way tar treats directory entries.

   The runner's `${{ github.workspace }}` substitution is applied before the glob.
5. **Lookup behaviour** (`s287c/probes/m1b.mjs`). Head and merge-base `lookupProofs` side by side over a fake runs/jobs/pulls/events API with a call log, in 22 scenarios. Steps can be green, red on a unit step or a scan, cancelled, light, missing a step, or missing the fast-lane job. The scenarios also cover failed jobs and list calls, an unbound branch, identical-set siblings, and two budget scenarios. Invariants checked:
   - the same code proof as the merge base;
   - never `voidedByBase` together with a proof;
   - at most 40 calls.

   `failedOnCode` was also called directly, on 9 responses.
6. **Rule (g)** (`s287c/probes/gate-env.mjs`): `gateInputStage2FromEnv` plus `gateVerdictStage2` with the four entries equal, differing, empty, absent and space-padded.
7. **Upstream tags.** For each action I resolved `gh api repos/actions/<a>/git/ref/tags/<tag>` (an annotated tag is dereferenced) and `repos/actions/<a>/commits/<tag>`.
8. **Gitleaks hint.** The over-approximating scan (pinned v8.30.1 config, 220 compiled rules, keyword prefilter plus rule regex, no entropy, no allowlists) over the 477 added lines finds 0 hits; its runtime controls fire.
9. **P1 and record simulation** (section 7). `git merge-tree --write-tree origin/main e8b9414` is clean. Since `05de264`, main changed `docs/`, `.claude/` and `tests/generated/error-catalogue.test.ts` (#69). None of them is a path of this PR.

## 3. What the PR closes, and how it was checked

| Item | Where (`e8b9414`) | Evidence | Status |
|---|---|---|---|
| PR62-SEC-01: action-step keys `{name, uses, with}` | `check-workflow-policy.mjs:567-568`, `:2006-2021` | 71 of 71 key additions refused (67 newly); the PR #68 corpus F-family now 29 of 29 refused | **Closed** |
| PR62-SEC-01: engine-cache `if:` exact | `:568`, `:2020-2021` | 4 of 4 edits refused; the same string double-quoted accepted | **Closed** |
| PR62-SEC-01: exact commit per action | `:557-561`, `:2022-2026` | 16 of 16 foreign 40-hex commits refused (8 action steps × 2); upstream tags below | **Closed** |
| PR287B-SEC-02: exact job keys, `runs-on: ubuntu-24.04` | `:575-580`, `:1961-1972` | 38 newly refused, 19 already refused, 3 accepted (`'ubuntu-24.04'` quoted) | **Closed** |
| PR287B-SEC-01: gate requires the four entries | `lane-scope.mjs:1058-1062`, `:994-995` | All absent: BLOCKED (4 keys); one absent: BLOCKED (that key); merge base: no reason | **Closed** |
| D-SEC-PR57-02: cache hygiene | `check-workflow-policy.mjs:585`, `:1174-1208`, `:1578-1580` | Wired in every workflow and on `cache`, `cache/restore`, `cache/save`; covers `node_modules`, `node_modules/.cache`, the directory, `*`, `**`, `node_*`, `${{ github.workspace }}/` forms. Exclusion escape and 4 spellings missed | **In place with a defect** (PR287C1-SEC-01) |
| #68 code review R1-m1 / R1-n1 / R1-n2 | `lane-scope.mjs:587-601`, `:817-822`, `:838-843` | 22-scenario lookup probe: same proofs, budget kept, run-full only added | Fail-closed; no security finding |

**Upstream tags** (resolved with `gh api`, 2026-11-19):

| Action | Tag | Tag object | Commit | `STAGE_2_ACTION_COMMITS` |
|---|---|---|---|---|
| `actions/checkout` | v7.0.1 | commit (lightweight) | `3d3c42e5aac5ba805825da76410c181273ba90b1` | equal |
| `actions/setup-node` | v7.1.0 | commit (lightweight) | `949feb2413d6458794dcd2491c4babbbce0c15c1` | equal |
| `actions/cache` | v6.1.0 | commit (lightweight) | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | equal |

For each, `commits/<tag>` resolves to the same SHA. These commits are named by tags in the upstream repositories themselves, so none is a fork-network commit. The `ci.yml` lines carry the same commits and tag comments.

**Run-full scenarios** (head against merge base; the tested base changed at 12:00):

| Scenario | head `voidedByBase` | merge base | Calls (head) |
|---|---|---|---|
| One voided green run | true | true | 5 |
| One voided run, red on unit / red on a scan / cancelled | false / false / false | false / false / false | 5 |
| Voided green + newer non-voided red on unit or scans | false | false | 5 |
| Voided green + newer non-voided **cancelled** | **true** | false | 6 |
| Voided green + newer non-voided **light** | **true** | false | 6 |
| Voided green + newer non-voided whose jobs call fails | **true** | false | 6 |
| Voided green + newer non-voided green | false (that run is the proof) | false | 5 |
| Voided green, its own jobs call fails | false (fail closed) | false | 5 |
| Voided run lacking a now-required step (R1-n1) | **true** | false | 5 |
| Voided run without a fast-lane job | false | false | 5 |
| Voided light + voided green older | true | true | 6 |
| Unbound run, no runs | false | false | 4 / 2 |
| Non-voided red on S1 / non-voided cancelled on S1, voided green on S2 | false / **true** | false / false | 5 / 6 |
| 60 voided runs, green at #5 / #36 / #59 | true / false / false | same | 10 / **40** / **40** |
| 30 non-voided cancelled + 1 voided green | **true** | false | 35 |

The bold rows are the intended widening (#68 code review R1-m1/R1-n1): more full runs, never fewer gates. Both lane-scope instances make the same calls on completed runs. A divergence between them (a re-run between classify and ci-gate, or a transient API error in one of them) is a rule (g) mismatch: red, never green.

## 4. Findings

### PR287C1-SEC-01 (LOW): the cache-hygiene rule accepts exclusions that `actions/cache` ignores, and misses four spellings

| Field | Value |
|---|---|
| Severity | LOW (Impact Low × Likelihood Medium: a protective rule that blesses an ineffective fix, and the next workflow PR is likely to add `node_modules/.cache` caches) |
| CWE / OWASP | CWE-693 Protection Mechanism Failure; CWE-1023 Incomplete Comparison with Missing Factors; A08:2021 Software and Data Integrity Failures |
| Location | `tools/ci/check-workflow-policy.mjs:1174-1208` (`cacheHygieneFindings`: `excluded` accepts any `!${TEST_LOCKS_DIR}` line; `normalise` handles only `./` and `${{ github.workspace }}/`; `toRegExp` treats `?` and `[...]` as literals); `docs/07-ops/CI-CD.md` (the new sentence "must exclude it with a `!node_modules/.cache/shipqube-test-locks` line") |
| Description | `@actions/cache` 6.x `resolvePaths` globs `path:` with `implicitDescendants: false` and passes the matched paths to `tar --files-from`, which archives every matched **directory** recursively. A `!` line removes only matched glob results, and the last matching pattern wins. So when an include line matches an ancestor directory (`node_modules`, `node_modules/.cache`, or `node_modules/**`, which also matches `node_modules` itself), the locks are archived and restored whatever the exclusion says. The same happens when the `!` line comes before the include. With the real `@actions/glob` 0.6.1, 13 of 29 forms restore the lock directory without a finding. The exclusion forms: `node_modules` + exclusion, + exclusion `/**`, `node_modules/*` + exclusion, `node_modules/**` + exclusion, `node_modules/.cache` + exclusion, and the exclusion placed before `node_modules/.cache/*`. The spellings: the whole workspace (`.`, `./`, `${{ github.workspace }}` alone), `${{ env.GITHUB_WORKSPACE }}/node_modules`, the absolute workspace path, `node_modules/.cache/shipqube-test-lock?` and `node_modules/.cache/[s]hipqube-test-locks`. Braces are not expanded by `@actions/glob`, so `{node_modules,x}` restores nothing. The only exclusion form that works is a sibling-level include, `node_modules/.cache/*`, followed by the exclusion, which the rule also accepts. `.` and `..` segments are refused by `@actions/glob` itself, so the step fails, which fails closed |
| Exploitability / impact | Not reachable today: no live cache path covers the directory (both engine caches are exact `with:` maps in ci.yml, and `lane-c.yml`/`nightly.yml` have no `actions/cache`). The risk is the next cache. 287-C2 adds incremental lint, test and type-check caches, which commonly live under `node_modules/.cache`. Following the rule's own message would pass the policy and still restore a stale TASK-288 lock, so a suite waits on, or takes over, a lock it does not own (D-SEC-PR57-02). That degrades evidence integrity, not production |
| Remediation | Make the rule fail closed and drop the exclusion escape. A non-`!` `path:` line is a finding when it matches `TEST_LOCKS_DIR` or any ancestor (`node_modules`, `node_modules/.cache`), whatever exclusions follow. A cache has to name specific subdirectories, for example `node_modules/.cache/eslint`. In `toRegExp`, treat `?` as `[^/]` and `[...]` as a class, or refuse any line containing `?`, `[` or `{`. Refuse any line that is absolute or contains `${{` other than a leading `${{ github.workspace }}/`, `$` or `~`, unless it provably points outside the workspace. Change the finding message and the `CI-CD.md` sentence to "must not cover it; cache named subdirectories instead". If keeping the sibling form (`node_modules/.cache/*` plus the exclusion) matters, allow exactly that pair and nothing else |
| Verification | `ci-policy-stage-2.test.ts` rows for the 13 missed forms (each a `cache-hygiene` finding) plus the live engine path and `node_modules/.cache/eslint` (no finding). Re-run `s287c/probes/cache-hygiene.mjs` against the fix: 0 MISSED over the 29 forms, with real `@actions/glob` |
| Owner / due | devops-engineer. Fix in this PR's cycle (preferred: it is a `tools/ci` change, so a delta security round) or in the policy PR that precedes 287-C2, and in any case before any workflow adds an `actions/cache` whose path covers `node_modules` or `node_modules/.cache` |

### PR287C1-SEC-02 (INFO): action commits outside the stage-2 jobs are pinned by format only

| Field | Value |
|---|---|
| Severity | INFO (pre-existing; outside PR62-SEC-01's stage-2 scope) |
| CWE / OWASP | CWE-829 Inclusion of Functionality from Untrusted Control Sphere; A08:2021 |
| Location | `tools/ci/check-workflow-policy.mjs` (`STAGE_2_ACTION_COMMITS` applies to the three ci.yml jobs only); `.github/workflows/lane-c.yml`, `nightly.yml` |
| Description | In `lane-c.yml` and `nightly.yml`, a `uses:` with any other 40-hex commit, including a fork-network commit that GitHub resolves under the upstream name, gives 0 findings. Action-step `env:` is accepted there as well (already PR59-SEC-02, 015-C) |
| Exploitability / impact | Both workflows are `workflow_dispatch` only, so they are not merge gates. They are what G3/G4 evidence runs execute, and a swapped commit under a plausible tag comment is easy to miss in review |
| Remediation | With 015-C (which already reshapes the policy for these two workflows): one repository-wide action-commit table applied to every workflow, with `STAGE_2_ACTION_COMMITS` as its ci.yml subset. Until then, the record of any PR that changes a `uses:` line in `lane-c.yml` or `nightly.yml` checks the commit against the upstream tag (the D-SEC-PR62-01 interim check stays for those two files) |
| Verification | A policy test row: `lane-c.yml` with a foreign 40-hex `actions/checkout` commit is a finding; the live file passes |
| Owner | devops-engineer, with 015-C |

No other finding. Items I looked at and did not raise:
- the quoted forms that both policies accept (`'ubuntu-24.04'`, a quoted `uses`, a double-quoted `if`): same strings;
- a changed tag comment: the commit stays pinned, and the comment itself is required by `pinned-action`;
- `STAGE_2_ACTION_STEP_IFS` keyed by job and action: a second fast-lane cache step would still need its own exact `with:` map, which `STAGE_2_ACTION_INPUTS` holds once per action;
- the reworded `scansStepViolations` texts: messages only, same regexes.

## 5. Interim rules and workflow checklist

| Check | Result |
|---|---|
| Workflow files changed | None (`.github` identical at the merge base and the head) |
| D-SEC-PR62-01 / D-SECPR287B-01 interim record checks for this PR | Trivially satisfied: no `uses:`, action-step `env:`, `runs-on` or `environment` change |
| After the merge | The policy pins action-step keys, commits, job keys and `runs-on` for the three ci.yml jobs. The interim record checks end for ci.yml, and stay for `lane-c.yml` and `nightly.yml` `uses:` changes (PR287C1-SEC-02) |
| Live workflows under the head policy | `ci.yml` 0, `lane-c.yml` 0, `nightly.yml` 0 |
| Permissions and the GitHub token | Unchanged. `failedOnCode` makes no API call; the voided-run check keeps its single counter |
| Secrets in the change | Gitleaks hint 0 of 477 added lines (controls fire) |

## 6. Docs and the code review twin

`CI-CD.md` now records the pins, the job shapes and the residual: a record naming the code head, on the branch or on main, both reaching the check through the merge ref. That also settles the wording point of the PR #68 record. One sentence is wrong (PR287C1-SEC-01): the `!node_modules/.cache/shipqube-test-locks` exclusion does not protect a cache whose path covers an ancestor directory. `SPK-07` §6.1 matches the code.

**Code review twin** (`370a66b`, APPROVED_WITH_NITS; its mutation matrix covers 1,866 mutants of the three live workflows, 0 accepted by the head but refused by main, which agrees with the 1,497 here):

- **R1-n2 (cache-hygiene tripwire gaps)** is part of PR287C1-SEC-01. The code review found the whole-workspace forms, absolute and expression-valued paths, and `?`/`[...]` globs; this round adds the exclusion escape. Measured with the real `@actions/glob` 0.6.1, `{a,b}` is not a gap: braces are not expanded, so such a path restores nothing. Its proposed fix ("fail toward a finding") is the right direction. It must also drop the exclusion escape for ancestor paths, so PR287C1-SEC-01 is LOW rather than a NIT: the rule's own message points authors at a fix that does not work.
- **R1-n7(b) is ratified.** The CI-CD.md sentence "the record may sit on the PR branch or already on `main`" is correct. The checker runs on ci-gate's checkout of the test merge, whose tree holds both main's and the branch's files. The record binds by its `PR-<NNNN>-` name and by a `Head` row naming a commit of `<base>..<head>`, so D-ORCH-116's intent (a security record naming the PR's code head, checked by lane A) is met either way. The simulations of PR #62, #68 and this round each pass with the record on main (S1-S3). Three conditions apply to a record on main:
  1. It counts only from the next `pull_request` event after it lands; a re-run of an older run keeps the old merge commit and still fails.
  2. Under a placeholder name it does not count (control C1); hence the D-ORCH-136 draft-rename-ready order.
  3. Forgery stays the procedural residual of PR10-SEC-04, as on the branch: records on main are committed only by the orchestrator or by security-analyst.
- **Lane-c and nightly commits** (the code review's out-of-scope question): yes, the same treatment, as PR287C1-SEC-02 (015-C).
- The other NITs (test pins, wording) carry no security content.

## 7. Record binding and simulation

The checker (main's `tools/ci/check-security-owned-paths.mjs`, unchanged by this PR) reads records from the checked-out test merge. The record therefore counts once two things hold: it is on main under its `PR-<NNNN>-` name, and a `pull_request` event after that rename builds the merge ref. It binds through the single `Head` row (the full `e8b9414` SHA, a commit in `<base>..<head>`). The evidence-only commit changes no owned path, so rule (d) holds for the tip.

Simulation (`s287c/probes/sim.mjs`). Setup:
- a `git clone --shared` of the main repository, sparse checkout of `/.github/ /docs/05-quality/security/ /tools/ci/`;
- scenario commits built with plumbing;
- main = `1d31ea8` plus a record commit;
- the test merge = `merge-tree` of that with the PR tip;
- the checker taken from the merge's tree, with `--pr 70` as a stand-in number.

| Scenario | Base given to the checker | Head | Result | Expected |
|---|---|---|---|---|
| S1 record on main under `PR-0070-…`, evidence tip | merge base `05de264` | evidence tip | exit 0, pass | pass |
| S2 same | main + record | evidence tip | exit 0, pass | pass |
| S3 same | main before the record | evidence tip | exit 0, pass | pass |
| S4 same, code commit pushed alone | merge base | `e8b9414` | exit 0, pass | pass |
| C1 record only under the placeholder name `PR-pending-…` | merge base | evidence tip | exit 1, missing | fail |
| C2 no record | merge base | evidence tip | exit 1, missing | fail |
| C3 a later `FAIL` verdict row appended | merge base | evidence tip | exit 1, missing | fail |
| C4 the `Head` row names the merge base instead | merge base | evidence tip | exit 1, missing | fail |
| C5 a `tools/ci/lane-scope.mjs` change after the reviewed head | merge base | that commit | exit 1, missing | fail |
| C6 a `ci.yml` change after the reviewed head | merge base | that commit | exit 1, missing | fail |
| C7 the record named for another PR number | merge base | evidence tip | exit 1, missing | fail |

11 of 11 as expected. The record has exactly one `Head` row, no `Branch / head` row and one `Verdict` row (the last table row of the file).

## 8. Merge conditions and routes

1. **Order (D-ORCH-136).** Push `e8b9414` and the evidence-only commit as they are, as one code push. Open the PR as a draft. Rename this record to `PR-<NNNN>-TASK-287C1-security-review.md` on main. Confirm the rename is on main, then mark the PR ready for review.
2. **Lane A.** The full lane A run must be green in every step, with ci-gate MERGE-READY. The run is judged by main's 287-B tooling. The first run after the merge is the first live use of these rules on every open PR. Any red result from the new rules on the live `ci.yml` is fail-closed: revert, never bypass.
3. **Lane B.** A passing lane-B `pr` run on `e8b9414` is the evidence-only commit. The first run failed only on network and timing tests during the 2026-11-19 outage and was re-queued; that failed run is not evidence.
4. **PR287C1-SEC-01, fix timing.** Fix it in this cycle (preferred), or in the policy PR that precedes 287-C2, and in any case before any workflow adds a cache whose path covers `node_modules` or `node_modules/.cache`. A fix in this cycle changes `tools/ci/**` after `e8b9414` and needs a delta security round with a new `Head` row.
5. **Routes.** PR287C1-SEC-02 goes to devops-engineer with 015-C. Until then, the `uses:` upstream-tag check stays in the records of PRs that change `lane-c.yml` or `nightly.yml`.
6. **After the merge.** PR62-SEC-01, PR287B-SEC-01 and PR287B-SEC-02 are closed. D-SEC-PR57-02 is in place, but not effective until PR287C1-SEC-01 is fixed.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium; PR287C1-SEC-01 LOW (fix before any cache covers `node_modules`), PR287C1-SEC-02 INFO (015-C). PR62-SEC-01, PR287B-SEC-01 and PR287B-SEC-02 closed |
