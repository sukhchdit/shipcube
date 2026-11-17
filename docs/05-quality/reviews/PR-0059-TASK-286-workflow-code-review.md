# Code review: PR #59, TASK-286 `cigatefold` workflow PR (install the stage-2 ci.yml), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `055083b` (full SHA `055083bb480e00629dd3bb4468f7add4d52a34af`, branch `ci/TASK-286-cigatefold-workflow`). The branch has since gained `2d6818b`, the PR #59 security record (docs only, `git diff --name-only 055083b 2d6818b`). Diff base: `git diff origin/main...055083b`, with `origin/main` at `c2b74c1` (#55 = `11e2158`, #54 = `44637dd`). Commits in the delta:
- `daa9a7e`: the PR #55 follow-ups;
- `7abdb03`: the merge of main `a7e06fb`;
- the earlier `03a281a` (install), `ed3e58f`, `bd06337`, `5f76ef3` (policy-branch merges, now on main through the #55 squash);
- `055083b`: lane B evidence.

Specs: the TASK-286 card (WAVE-00.md §TASK-286), D-ARCH-128, D-TASK286-01a/03/06/06a, D-SEC-PR55-01, my PR #55 record (r2 NITs R2-n1..n4), SPK-07 §6 (Budget v2).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The installed ci.yml is the reviewed fixture byte for byte (blob 4597259), the stage-1 fixture is main's old
  ci.yml, the 7abdb03 hand resolutions are exactly the stated ones, and R2-n1..n4 plus PR55-SEC-11 are fixed and
  mutation-proven (29/33 killed, the 4 survivors are the redundant/equivalent rows ruled in PR #55 r2). Two live
  stage-2 runs behave as the tests assumed: same classification in both jobs, tooling from HEAD^1, and the docs-push
  run correctly BLOCKED because #54 voided the proof. One MINOR: the measured bill (code push 10, docs push 4) is far
  from the 5.9 / 2 the card, SPK-07 and the PR body use, and SPK-07 §6 is not updated. Two NITs.
```

## 1. What I verified myself

| Check | Result |
|---|---|
| `.github/workflows/ci.yml` at `055083b` | blob `4597259` = `tools/ci/fixtures/stage-2/ci.yml` on main at `11e2158` (the file reviewed in PR #55 r1/r2) |
| `tools/ci/fixtures/stage-1/ci.yml` | blob `84ba61b` = main's `ci.yml` before this PR (`a7e06fb`, still `c2b74c1`) |
| `git show --remerge-diff 7abdb03` | Six add/add or content conflicts, each resolved as the message says: the PR-0055 review and security records equal main's `a7e06fb` copies (`git diff --quiet`); CI-CD.md and both stage-2 test files take this branch's side, which differs from main's `11e2158` only in the fixture paths and past-tense wording (8+8, 2+2 and 8+7 lines); `tools/ci/fixtures/stage-2/ci.yml` deleted again. `check-workflow-policy.mjs` and `lane-scope.mjs` equal `11e2158` at the merge |
| Merge with current main | `git merge-tree --write-tree origin/main 055083b` is clean. Main's delta since the PR's last merge (#54 and docs) shares no path with this PR. #54 does touch lane A inputs (`eslint.config.mjs`, `tools/eslint-rules/**`, `tests/fixtures/lint/**`), which matters for proofs (§3) |
| `jest tools/ci --selectProjects unit` | 30 suites, **1215 / 1215** pass |
| Head `check-workflow-policy.mjs --root .`; main's (`c2b74c1`) copy over this tree | both exit 0 |
| Prettier on the changed non-evidence files | clean |
| Lane B evidence `20261117T0317Z_daa9a7e` | credited by the base-ref `check-evidence` in both lane A runs below |

**Probes** (`scratchpad/pr55/*.mjs`, now pointed at `.github/workflows/ci.yml`):

| Probe | Result |
|---|---|
| `policy-probe` M01-M12 | every mutant a finding; control 0 |
| `token-probe` T1, T2 | `gh-token` findings |
| `preload-probe` (27 cases) | All R2-n1 names (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, `GIT_EXTERNAL_DIFF`, `HOME`, `XDG_CONFIG_HOME`, `NPM_CONFIG_SCRIPT_SHELL`/`USERCONFIG`, `npm_config_node_options`) are now `preload-env`. The empty `env:` is no longer a finding (R2-n2). No false positives on `ENVIRONMENT`, `APP_ENV`, `PATH_PREFIX`, `NODE_ENV`, `TZ`, `LANG`, an expression `DATABASE_URL`, or the three live workflows |
| `policy-probe-s1` on the stage-1 fixture | S01-S04 still 0 findings: the known stage-1 residual, retired with stage 1 by TASK-287 (D-TASK286-01a) |
| `lint-env-probe` | unchanged (R1-n2 is wording, now in the rule header too) |

**Mutants** (`mut3.mjs`, fresh `git archive 055083b` copy): 33 rows, **29 killed**.
- Killed, from my PR #55 tables: L19, L20, L22, L24, L30; N01-N03, N05-N10, N13, N14, N16-N21. N09 and N16, the R2-n4 rows, are killed now.
- Killed, new rows for this PR: Q01 `HOME`, Q02 `GIT_CONFIG_COUNT`, Q03 the `KEY_n`/`VALUE_n` prefix, Q04 the empty `env:` refused again, Q05 the stage-1 workflow-env key check (PR55-SEC-11), Q06 `NPM_CONFIG_NODE_OPTIONS`, Q07 `XDG_CONFIG_HOME`.
- Survivors: P10, N04, N11 and N12, all equivalent or redundant as ruled in PR #55 R2.1.

## 2. Live stage-2 behaviour (the assumptions the fixture tests made)

| Assumption | Run 44011154025 (`055083b`, code push) | Run 44013660377 (`2d6818b`, docs push: the security record) |
|---|---|---|
| Jobs: fast-lane, security-integration, ci-gate; no `scans` | yes | yes |
| Tooling from the tested base `HEAD^1` | `TOOLS_REF` = `RANGE_BASE` = `083bd96` (main tip); every `GATE_*` under `$RUNNER_TEMP/base` or `gates/base`; `RECORD_MODE=enforce` | `TOOLS_REF` = `c2b74c1` (main tip, includes #54) |
| fast-lane `classification` output == ci-gate's own (rule (g)) | identical strings (`mode=full,…,tools_ref=083bd96…`); the aggregation step was skipped because the record step failed | identical strings (`mode=light,…,record_ok=true,…`); aggregation ran, no mismatch reason |
| Classify output drives the steps | `CODE: true`, `LINT_CONTROLS: false` in later step env; all code steps ran; the two lint-control steps skipped (the range touches no lint control) | `mode=light`: lockfile, cooldown, licences and every head-code step skipped; install, signatures, audit and evidence ran (PR46-SEC-11) |
| Proof lookup and PR46-SEC-16 | first run of the PR: no candidate, full lane | `code_proof=` empty: the only candidate (44011154025, created 03:34Z) predates #54 (`44637dd`, committer time 03:45Z), which changed lint controls on the tested base, so the proof is void. Semgrep and oasdiff therefore ran ("no code proof"), and the gate printed **`BLOCKED: no code proof for this tree`**, as CI-CD.md now documents |
| security-integration selection | `security_paths=false` (ci.yml and tools/ci are not am. G item 5 paths): skipped, correct | skipped, correct |

So the proof binding, the void-on-base-change rule and rule (g) have now run live, and they behave as the tests assume. The PR cannot become MERGE-READY without a new code proof: see the merge conditions.

## 3. CI minutes (SPK-07 §6)

| Run | fast-lane | ci-gate | security-integration | Billed (per-job rounding) | Card / SPK-07 / PR body |
|---|---|---|---|---|---|
| 44011154025, code push, full | 422 s (8) | 88 s (2) | skipped | **10** | 5.9 |
| 44013660377, docs push, light, no proof | 78 s (2) | 86 s (2) | skipped | **4** | 2 (3 if fast-lane passes a minute) |
| For comparison, stage-1 full code runs of the last day (#54, #56, #55, TASK-288) | 316-484 s (6-9) | scans 48-164 s (1-3) + ci-gate 8-20 s (1) | — | 8-11 | 6.6 (SPK-07, 2026-11-14) |

- The fold does what D-ARCH-128 says: it saves the per-job rounding of `scans` and `ci-gate`, about 1 billed minute per run.
- The Budget v2 premises are stale. A full fast-lane now bills 6-9 minutes on its own, against 6.6 for the whole run when SPK-07 measured it. ci-gate also takes 86-88 s, because it pulls the gitleaks image and runs Semgrep and oasdiff, so it rounds to 2.
- A light run with a valid proof skips Semgrep and oasdiff, so about 3 billed minutes is plausible, but nothing has measured it yet.
- With the measured figures, the stage-2 row is roughly 143 × 10 + 132 × 3-4 + 496 + 83 ≈ 2,400-2,550 minutes, not 1,687 (84 %). That is the orchestrator's and architect's forecast to redo (D-ARCH-129 guards), not a defect in this workflow.

## 4. Findings

| ID | Severity | File:line | Issue | Fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `docs/04-plan/spikes/SPK-07.md` §6; PR body "CI-minutes" | **The measured bill differs from the planned one, and it is not recorded.** The card says "a docs push bills about 2 minutes and a code push about 5.9 (measured on the first runs and recorded in SPK-07 section 6)". The first stage-2 runs measured 10 and 4 (§3). The PR body still states 5.9 / 2 and 84 %, and defers the record to "after merge". The measurements already exist on this PR's own runs. The forecast the orchestrator acts on (D-ORCH-100 guards) depends on them, and the "≈ 64-72 % steady state" expectation of D-ORCH-100 (4) does not hold at these figures without TASK-287. | Add the two measured runs (job seconds and billed minutes), the stage-1 comparison and a re-computed stage-2 Budget v2 row to SPK-07 §6 in this PR (docs only). Correct the PR body. Flag the forecast to the orchestrator for D-ARCH-129. Measure the first light run that has a valid proof when it happens. |
| R1-n1 | NIT | repository setting `squash_merge_commit_message: COMMIT_MESSAGES`; commit `03a281a` | The squash body concatenates the commit messages, so `03a281a`'s wrong "commitlint, actionlint and the install are CODE-gated" text would land on main. | Merge with `gh pr merge 59 --squash --subject "<linted>" --body "<PR summary>"` (or `--body ""`) so the corrected wording is what main keeps. |
| R1-n2 | NIT | `check-workflow-policy.mjs:142-164` | `preload-env` still passes `LD_DEBUG_OUTPUT`/`GLIBC_TUNABLES`-style loader variables that are not in the list. They are not code-execution vectors on their own, and the stage-2 `ci.yml` cannot set any env outside its exact maps, so this is listed for completeness only. | None needed. If the list is touched again, consider a `LD_` prefix with a short allow-list. |

## 5. Rulings

| Item | Ruling |
|---|---|
| R2-n1..n4 (PR #55 r2) | **Closed.** Probes and mutants Q01-Q07, N09 and N16 back each one. |
| PR55-SEC-11 (exact workflow-env keys in both topologies) | **Closed.** A shared `workflowEnvKeyFindings` (`:2368`) is called from both `laneScopeFindings` (`:2105`) and `stage2Findings` (`:2213`); Q05 and N14 killed. |
| D-TASK286-01a (stage 1 kept as a fixture until TASK-287) | Accepted. The stage-1 residual (S01-S04) stays with it. |
| `03a281a` message vs PR body | Accepted with R1-n1 (no history rewrite needed). |
| Live void of the first proof by #54 | Correct behaviour (PR46-SEC-16 / D-TASK286-06a): the docs push ran against a tested base whose lint controls changed after the proof run. |

## 6. Merge conditions

1. **A new code proof on a tree that includes #54.** The security record push (44013660377) is BLOCKED "no code proof", as designed. Either merge main into the branch (a code push, so a full run of about 10 billed minutes; it also tests #59 together with #54's lint changes), or close and reopen the PR (a full run on the same head). Pushing more docs alone stays BLOCKED.
2. ci-gate concluded `success` (MERGE-READY) on the exact final head, with the security record naming that head (`PR-0059-TASK-286-workflow-security-review.md` names `055083b`; a merge-main head needs a merge-only delta).
3. R1-m1 as a docs commit. It can ride the merge-main push, so the same full run proves it.
4. Squash with an explicit `--body` (R1-n1).
5. After merge: the D-ORCH-042 post-merge gate. The first push to main and the first runs of other open PRs use the stage-2 workflow. Their stage-1 proofs never count (the scans job name differs), so each of them runs full once.

## 7. Good patterns worth keeping

- Installing the reviewed fixture byte for byte and moving the old workflow to a fixture: the pin tests keep their subject, and the diff to review is a rename.
- The merge message lists every add/add resolution, and each one is checkable with `--remerge-diff` and `git diff --quiet`.
- The R2 NITs came with their own killing rows (Q01-Q07 equivalents in the PR's tests), and the stage-1 topology got the same workflow-env pin through a shared helper instead of a copy.
