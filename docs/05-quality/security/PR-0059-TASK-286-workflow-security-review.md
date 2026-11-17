# PR-0059: TASK-286 workflow PR (installs the stage-2 `ci.yml`), security review

| Field | Value |
|---|---|
| PR | #59, https://github.com/sukhchdit/shipcube/pull/59, branch `ci/TASK-286-cigatefold-workflow`. Merge base with `main` `a7e06fb` (after PR #55's squash `11e2158`). Own commits on top of the PR #55 history: `03a281a` (installs the stage-2 `ci.yml`), the merges `ed3e58f`, `bd06337`, `5f76ef3` (PR #55 branch) and `7abdb03` (`main` at `a7e06fb`), `daa9a7e` (PR55-SEC-11 and code review R2-n1..n4 follow-ups), `055083b` (lane B evidence only). `main` was `c2b74c1` when this round was written; since the merge base it gained PR #54 (`44637dd`, code) and docs commits |
| Head | 055083bb480e00629dd3bb4468f7add4d52a34af |
| Lane A evidence | Run 44011154025 on `055083b`, created 2026-11-17T03:34:23Z: **the first stage-2 run** (the PR's own `ci.yml`, judged by `main`'s base-ref policy). **fast-lane `success`**; only the two LINT_CONTROLS-gated steps are skipped. Every gate tool came from the tested base (`$RUNNER_TEMP/base/tools/ci/*`), with `TOOLS_REF=083bd96` (then `main`'s tip), `CODE=true`, `LINT_CONTROLS=false`. **ci-gate**: gitleaks, Semgrep and oasdiff `success`; the record step failed (this record is missing), so the aggregation step was skipped. Fast-lane's and `ci-gate`'s classifications are byte-identical (`mode=full`, `security_paths=false`, `record_ok=false`, no proof, `tools_ref=083bd96…`), so rule (g) holds even though the aggregation did not run. `RANGE_BASE` (event `pull_request.base.sha`) was `083bd96` in this run, not the merge base `a7e06fb`. security-integration was skipped (not selected). Lane B `20261117T0317Z_daa9a7e` PASS, accepted by the tested-base verifier |
| Owned paths changed | 11 (checker `owned[]`): `.github/workflows/ci.yml`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/fixtures/stage-1/ci.yml` (new), `tools/ci/fixtures/stage-2/ci.yml` (deleted), and the tests `check-workflow-policy.test.ts`, `ci-policy-stage-2.test.ts`, `ci-policy.test.ts`, `lane-scope-stage-2.test.ts`, `lane-scope.test.ts`, `openapi-breaking.test.ts`, `sec-static.test.ts` |
| Unowned paths changed | `docs/07-ops/CI-CD.md`; the run directory `docs/05-quality/tests/runs/20261117T0317Z_daa9a7e/` (4 files) |
| Binding items checked | The PR #55 security record (rounds 1 and 2: PR55-SEC-01..11, D-SEC-PR55-01/02); ADR-0023 amendment M items 3 and 5; D-TASK286-01a, -06, -06a; D-ORCH-078/102/103 (P1); PR #55 code review R2-n1..n4 |
| Reviewer / date | security-analyst, 2026-11-17, round 1. Read-only apart from this record. Probes ran in the session scratchpad on `git archive` extracts of `055083b` and of `main` (`c2b74c1`) and on a sparse shared clone; no install, Jest, Docker or GitHub run. The lane A run was read through `gh run view --log`. In the PR worktree I only wrote this file and ran the commit and push. Line numbers come from single-file reads at `055083b` |

## 1. Summary

The PR installs the stage-2 `ci.yml` that PR #55 pinned. The live workflow is **byte-identical** to the fixture reviewed in PR #55 round 2: both are blob `4597259`. The PR also does the following:
- deletes the stage-2 fixture;
- keeps the old stage-1 workflow as `tools/ci/fixtures/stage-1/ci.yml`, which is `main`'s current `ci.yml` (blob `84ba61b`);
- moves the tests onto the live file;
- closes PR55-SEC-11 item 1: the exact workflow-env key check now runs in both topologies, through one shared helper;
- widens `PRELOAD_ENV` with the git and npm configuration channels of code review R2-n1;
- treats an empty `env:` as absent (R2-n2).

Every claim holds:
- **Blob equality.** Head `ci.yml` = `main`'s fixture = `4597259`; the stage-1 fixture = `main`'s `ci.yml` = `84ba61b`.
- **Merge `7abdb03`.** `git show --remerge-diff` shows add/add and content conflicts in two tests, `CI-CD.md` and the two PR #55 review records. Each was resolved to the workflow-PR side, which reads the live `ci.yml` and the stage-1 fixture. The records are byte-identical to `main`'s, the fixture is deleted, and no conflict marker remains in the tree.
- **PR55-SEC-11 item 1.** Workflow-level `DOCKER_HOST`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, `GIT_CONFIG_*` and `NPM_CONFIG_SCRIPT_SHELL` are now refused under the stage-1 topology too (Y1-s1, Y2-s1, Y3-s1, Y6-s1), and stay refused under stage 2.
- **R2-n1.** `GIT_CONFIG_PARAMETERS`, `git_config_key_0` (case-insensitive), `HOME` and `NPM_CONFIG_NODE_OPTIONS` give `preload-env` in `lane-c.yml`; `npm_config_userconfig` does too. `GIT_CONFIG_NOSYSTEM` and a literal heap `NODE_OPTIONS` stay allowed.
- **R2-n2.** An empty step `env:` gives 0 findings, as GitHub reads it as null.
- **No regression.** The head checker gives 0 findings on the live stage-2 `ci.yml`, `lane-c.yml`, `nightly.yml` and the stage-1 fixture; `main`'s checker also gives 0 on the head tree. Every mutant of both PR #55 rounds (`mut.mjs` to `mut7.mjs`) still gives a finding, and the controls give 0. The only zero rows are P4d and P10 (harmless or refused by GitHub's parser) and the stage-1-only Y7-s1/Y8-s1 (see 3.2).

Two residuals and one trust-model statement:
- **PR59-SEC-01 (LOW, follow-up):** the `with:` inputs of the checkout and setup-node steps are not pinned in any stage-2 job (G1-G7: 0 findings).
  - Edits that keep the checked-out `HEAD` honest pass the tested-base policy that could have caught them: `persist-credentials: true`, `submodules:`, `path:`.
  - Edits that change `HEAD` (`ref:`, `repository:`) choose their own tested base, because stage 2 derives `TOOLS_REF` from the checkout.
  - That is circular for any PR that edits `ci.yml`, exactly as in stage 1, where such a PR could re-point the tooling step itself. The controls for such a PR remain the security review and the orchestrator's check that the record exists and names the merge head (D-ORCH-012/013), never `ci-gate` alone.
- **PR59-SEC-02 (INFO):** names outside the R2-n1 list still pass in `lane-c.yml` and `nightly.yml`. `ci.yml` is not affected, because it is an exact allow-list at every level that reaches a gate.

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 1 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read `git diff a7e06fb...055083b` in full (policy, tests, `CI-CD.md`), compared blob ids for the three workflow claims, and read the merge with `git show --remerge-diff 7abdb03`. Scanned the head tree for conflict markers.
2. **Policy controls** (four topology runs): the head checker and `main`'s checker on the head tree; the head checker with the stage-1 fixture installed as `ci.yml`; `main`'s checker on `main`.
3. **Mutant matrices** (`mut.mjs` to `mut7.mjs` from the PR #55 rounds, unchanged): the stage-2 role is played by the live `ci.yml`, the stage-1 role by the fixture, with `main`'s checker beside it. New probes: `mut8.mjs` (checkout and setup-node inputs, G1-G7) and `mut9.mjs` (14 env names in `lane-c.yml`, L1-L14).
4. **First stage-2 run** (44011154025): step conclusions, the classify and lane-scope outputs, the gate-tool locations and `TOOLS_REF` from the step env in the log; the three "bootstrap" log lines are the echoed script, not a fallback.
5. **Void-rule prediction for the record push:** the `main` history since the proof run (`44637dd` landing time from `%ct`), against `proofBasePath`.
6. Record simulation (§7), a secret-shape scan of this file with a positive control.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR59-SEC-01 | The checkout and setup-node `with:` inputs of fast-lane, security-integration and `ci-gate` are not pinned. HEAD-preserving edits (`persist-credentials: true`, `submodules:`, `path:`, `fetch-depth: 1`) pass the tested-base policy; HEAD-changing edits (`ref:`, `repository:`) let a `ci.yml` PR pick the tested base that judges it | LOW | CWE-693, CWE-345 | A08 | `tools/ci/check-workflow-policy.mjs` `stage2Findings` (only `uses:` is checked for steps 0-1 of `ci-gate`, `PRE_TOOLING_USES` before the tooling steps); `.github/workflows/ci.yml:102-113`, `:411-422`, `:490-499` | devops-engineer: TASK-287 (next `ci-workflows` change), due before any other PR that changes `.github/workflows/**` merges |
| PR59-SEC-02 | `PRELOAD_ENV` still misses `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` (config-file paths, the same capability as `GIT_CONFIG_PARAMETERS`), `GIT_DIR`, `GIT_EXEC_PATH`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `DOCKER_HOST`, `DOCKER_CONFIG` and `ACTIONS_ALLOW_UNSECURE_COMMANDS`; they pass in `lane-c.yml` and `nightly.yml` (L1-L7, L10). `ci.yml` is unaffected (exact workflow, job and gate-step env) | INFO | CWE-184 | A08 | `tools/ci/check-workflow-policy.mjs` `PRELOAD_ENV` | devops-engineer, 015-C (PR55-SEC-11 item 2) |

### 3.1 PR59-SEC-01: checkout and setup-node inputs (LOW, follow-up)

**Description.** `stage2Findings` checks that `ci-gate`'s first two steps use `actions/checkout@` and `actions/setup-node@`, and that only those actions run before the tooling steps. It does not check their `with:` inputs. Probes, all with 0 findings:
- G1: `ci-gate` checkout `repository: someone/fork` with a fixed `ref:`;
- G2: `ci-gate` checkout `ref: ${{ github.event.pull_request.head.sha }}`;
- G3: fast-lane checkout `repository:`;
- G4: `ci-gate` `persist-credentials: true`;
- G5: fast-lane `fetch-depth: 1`;
- G6: `ci-gate` `path: other`;
- G7: security-integration checkout `repository:`.

Two classes follow.
- **HEAD-preserving edits.** These include `persist-credentials: true` (the job token is written into `.git/config`), `submodules: true` (attacker-chosen URLs fetched into the workspace, where the record checker and the evidence verifier read files) and `path:`. The checked-out `HEAD` stays GitHub's test merge, so the tested base is still `main` and its policy runs. A pin on the inputs would catch them; today nothing does.
- **HEAD-changing edits.** The PR pushes a crafted merge commit (second parent the PR head, first parent a descendant of `RANGE_BASE` carrying weakened `tools/ci`) to another ref in the same atomic push, and the checkout names that ref. `TESTED_BASE_SCRIPT` and `testedBase` both accept it, because they check `HEAD^2` and ancestry, not that `HEAD` is the event's merge commit. Every gate, the policy and the record check then come from the crafted base.

This is circular for a PR that edits `ci.yml`: such a PR controls its own workflow, as it did in stage 1, where it could re-point the tooling step itself. No pin in a tested-base policy can stop it, because the edit chooses the policy. The difference from stage 1 is that the tested base is now taken from the checkout, not from the event payload. G2-style edits fail closed (`HEAD^2` no longer matches) and G5 fails closed (`HEAD^1` missing).

**Exploitability and impact.**
- It needs an owned `ci.yml` edit and a review miss.
- For the HEAD-changing class, the orchestrator's merge rule (merge only when the security record names the exact head) is the control, as for every `ci.yml` PR.
- Impact High in the HEAD-changing case (a self-approved run), Low for HEAD-preserving edits. L × H, rated LOW like PR55-SEC-01 and -11, the same policy-pin class.

**Remediation (code level).**
1. In `stage2Findings`, pin the `with:` maps exactly:
   - every checkout: `{ fetch-depth: '0', persist-credentials: 'false' }`;
   - fast-lane and security-integration setup-node: `{ node-version-file: .node-version, cache: npm, cache-dependency-path: package-lock.json }`;
   - `ci-gate` setup-node: `{ node-version: '24' }`.
2. Two-step, policy first: add `[ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]` to `TESTED_BASE_SCRIPT` for `pull_request`, so a HEAD-changing edit that keeps the pinned bash fails closed. `GITHUB_SHA` is set by the runner, and the policy refuses `GITHUB_*` in any env map.
3. Keep the procedural rule explicit in the merge checklist: for a PR that changes `.github/workflows/**`, `ci-gate` success is necessary but not sufficient; the record must exist and name the head.

**Verification.** G1-G7 give `required-gates`; the live `ci.yml` stays at 0 findings.

### 3.2 Residuals carried over

- **PR55-SEC-11 item 3** (stage-1 scans steps pattern-pinned, Y7-s1/Y8-s1 still 0): after this PR merges, stage 1 is no longer live. It survives only as the fixture and as a possible downgrade, which PR55-SEC-10 / TASK-287 retires (D-TASK286-01a).
- **P4d** (a lane C job without a `permissions:` key inherits the read-only top level) and **P10** (a capitalised `Pull-Requests:` key, which GitHub's parser refuses) are unchanged and fail closed.
- **INFO 04, 05, 06, 07, 10 of PR #55:** unchanged and routed as in D-SEC-PR55-02.

## 4. Closures that go live when this PR merges

| Item | Live behaviour after the merge | Evidence |
|---|---|---|
| PR46-SEC-11 | Signatures and the advisory audit run on every push, a light one too, before any head code, as exact unconditional steps | Live `ci.yml` = reviewed fixture; A1, A2, A4, A7, A8 refused |
| PR46-SEC-12 (stage-2 part) | One tooling step per job, pinned; classify straight after it; `ci-gate` exact; rule (g) | Run 44011154025: identical classifications, every tool from the tested base |
| PR46-SEC-15 (stage-2 part) | `actions:` / `pull-requests:` read on fast-lane and `ci-gate` only; token on the classify, lane-scope and aggregation steps only | P1-P10, T1, Y9, Y10 |
| PR46-SEC-16 | A docs push inherits a proof only when the tested base gained no lane A input and no PR path since the proof run | PR #55 R2 V0-V11 |
| PR46-SEC-17 | `TOOLS_REF` = `HEAD^1` of the test merge | Run 44011154025: merge base `a7e06fb`, tools from `083bd96` |
| PR55-SEC-01, -02, -09 | `preload-env`, `env-expression`, exact env and run pins, `STAGE_2_USES`, step-bound token | Mutant matrix (§2 item 3) |
| PR55-SEC-11 item 1 | Exact workflow-env keys, both topologies | Y1-s1 to Y6-s1 refused |

## 5. Ruling: which interim rules end at the merge

1. **PR46-SEC-11 24-hour proof-age rule: ends** for a merge whose final lane A run was executed by the stage-2 workflow, because that run audited the exact head. It **stays** for a merge whose final run was a stage-1 run: a branch whose last push predates this merge, or a PR that carries a stage-1 `ci.yml` (D-TASK286-01a). The generic window between the last run and the merge remains, as for any run. The scheduled backstop is the 015-C nightly audit.
2. **P1 (D-ORCH-078/102): the inherited-proof part becomes mechanical.** No union is needed merely because `main` moved: the void rule decides, and a voided proof makes `ci-gate` BLOCKED ("no code proof"), which a code push or union then clears.
   - **P1 at merge time stays procedural** (PR55-SEC-07). Before `gh pr merge`, compare the `ci-gate` summary's tested base with `origin/main` (`git diff --name-only <tested base> origin/main`, filtered by `proofBasePath` and the PR's own paths). If it is not empty, run lane A again with a push.
   - Never merge on a re-run after `main` changed a lane A input.
   - P1 (a) (GitHub reports the PR not mergeable) is unchanged.
3. **D-ORCH-103 P1 (c) widening** (union required when `main` changed lane A's bootstrap tooling since the merge base): **ends** for stage-2 runs, because the tooling now comes from `main`'s tip at the event (shown live: merge base `a7e06fb`, every gate from `083bd96`). It **stays** for any run executed by a stage-1 `ci.yml`.
4. **The record check for `ci.yml` PRs** (PR59-SEC-01): unchanged and now explicit. The orchestrator verifies that the security record exists and names the head; `ci-gate` alone is not sufficient for a PR that changes `.github/workflows/**`.

## 6. Merge prerequisites for #59

- **The record push will not be MERGE-READY.**
  - The proof run 44011154025 was created at 2026-11-17T03:34:23Z.
  - PR #54's squash `44637dd` landed on `main` at 03:45:24Z and touches `eslint.config.mjs`, `tools/eslint-rules/**`, `tools/lint/**` and `tests/fixtures/**`, all proof-base paths.
  - So the record push (light, docs-only) will find the proof void and `ci-gate` will print `BLOCKED: no code proof for this tree`. This is PR46-SEC-16 working as designed.
- **What is needed: a full run.** Merge `main` (`c2b74c1` or later) into the branch and push.
  - The record survives the merge. Check (d) counts only the PR's own owned paths, and PR #54 changed none of the 11.
  - This holds while the union run's event base is the new merge base, as observed on PR #46 (§7 S5). If the run shows the stale base `a7e06fb` instead, the record step turns red (S5'), and a short round-2 record naming the union head fixes it.
  - Expected after the union push: mode full, `security_paths=false`, MERGE-READY if green.
- **The code review of #59 must approve.**
- **No 24-hour rule** applies to that stage-2 run (§5). P1 at merge time: compare the final run's tested base with `main`.
- **After the merge:** the first `main` push runs stage 2 only if `CI_MAIN_FAST_LANE` is `true`. Otherwise the D-ORCH-042 post-merge gate covers it.

## 7. Record simulation

Both `main`'s checker and the head checker ran on this file committed on `055083b`, with `--base a7e06fb --pr 59 --json`, in a sparse shared clone. The two checkers agree on every scenario:

| ID | Scenario | Result (both checkers) |
|---|---|---|
| S1 | This record on `055083b` | pass, owned 11, satisfied by `055083b` |
| S0 | No record (control) | missing |
| S2 | Record without its Verdict row | missing |
| S3 | `Head` row naming the merge base | missing |
| S4 | An owned path (`.github/workflows/ci.yml`) edited after the record | missing |
| S5 | A merge of `main` (`c2b74c1`) after the record (the union this PR needs), with `--base c2b74c1`: the event base after a union push is the new merge base, as observed on PR #46 | pass, owned 11, satisfied by `055083b` |
| S5' | The same union, but with the stale base `a7e06fb` | missing (owned 74: PR #54's owned paths join the set). The record step would then be red, and a round-2 record naming the union head would be needed |

Row counts in this file: one `Head` row and one `Verdict` row.

## 8. Proposed decision text (for the orchestrator to log)

**D-SEC-PR59-01 · 2026-11-17 · security-analyst · PR #59 (TASK-286 workflow PR) round 1 at `055083b`.**

- **Decision:**
  - **PASS_WITH_FOLLOW-UPS** (0 C/H/M, 1 LOW, 1 INFO).
  - The live `ci.yml` is the reviewed fixture (blob `4597259`); the stage-1 fixture is `main`'s `ci.yml` (`84ba61b`); merge `7abdb03` is clean.
  - PR55-SEC-11 item 1 is closed (exact workflow-env keys in both topologies); R2-n1 and R2-n2 are verified.
  - **PR59-SEC-01 (LOW):** checkout and setup-node `with:` inputs are unpinned; a HEAD-changing edit chooses its own tested base. Fix with TASK-287 before any other `.github/workflows/**` PR merges. Until then the orchestrator's record-names-head check is the control for every `ci.yml` PR.
  - **PR59-SEC-02 (INFO):** deny-list names for `lane-c`/`nightly` go to 015-C.
  - **Interim rules:** the 24-hour rule ends for stage-2 final runs; the D-ORCH-103 P1 (c) widening ends for stage-2 runs; P1 becomes mechanical for inherited proofs and stays procedural at merge time; all three stay for stage-1 runs.
  - **Merge:** the record push will be BLOCKED (proof voided by PR #54's lane A changes). Union `main` and merge on MERGE-READY with the code review's approval.
- **Reversibility:** High.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding. PR59-SEC-01 (LOW) is due with TASK-287 before any other `.github/workflows/**` PR merges; PR59-SEC-02 (INFO) goes to 015-C. |
