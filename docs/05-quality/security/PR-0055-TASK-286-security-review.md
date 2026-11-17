# PR-0055: TASK-286 stage-2 workflow policy and tested-base lane scope (policy PR), security review

| Field | Value |
|---|---|
| PR | #55 `ci(lane-a): stage-2 workflow policy and tested-base lane scope (TASK-286 policy PR)`, https://github.com/sukhchdit/shipcube/pull/55, branch `ci/TASK-286-cigatefold`. Six commits on the merge base `04bb7a2`: `caa5119` (stage-2 policy, lane scope, fixtures, tests), `2fdf365` (comment), `72babba` (shared test fixtures), `02f438b` (merge of `main`), `71d2980` (D-ARCH-133 `devOptional`), `5645b9b` (lane B evidence only); then `2fe721e` (the code-review record only, docs). `main` was `ba60aa7` when this round was written; since the merge base it moved by `docs/sdlc/DECISIONS.md` and `docs/sdlc/STATUS.md` only (`369e38a`, `8984b16`, `ba60aa7`) |
| Head | 5645b9b0808c7983acb5cd1eaf9c08634a24a7ee |
| Lane A evidence | Run 43805155599 on `5645b9b` (stage 1, `main`'s workflow and base-ref tooling). **fast-lane `success`**, every step including workflow policy, lockfile, licences, signatures, audit, "Lane B evidence", lint, format, actionlint, type-check, unit (246 suites, 6,042 tests; `ci-policy-stage-2`, `lane-scope-stage-2`, `check-workflow-policy`, `lane-scope`, `security-paths`, `sec-static` PASS), build. **scans**: gitleaks, Semgrep and oasdiff `success`; the only red step is "Security-owned paths need a review record". Classification: `mode=full`, `security_paths=false`, `record_ok=false`, `security_integration_due=false` (security-integration skipped). `ci-gate` is red only as the aggregate. Run 43834997942 on `2fe721e` (the code-review push) is red for the same missing record. This file is the missing record |
| Owned paths changed | 18 (checker `owned[]`): `.github/dependabot.yml`, and under `tools/ci/`: `check-workflow-policy.mjs`, `check-workflow-policy.test.ts`, `ci-policy-stage-2.test.ts` (new), `fixtures/stage-2/ci.yml` (new), eight `fixtures/workflow-policy/*.yml` (seven new, `ci-actions-read-fast-lane.yml` changed), `lane-scope-stage-2.test.ts` (new), `lane-scope.mjs`, `sec-static.test.ts`, `security-paths.mjs`, `security-paths.test.ts` |
| Unowned paths changed | `docs/07-ops/CI-CD.md`; the run directory `docs/05-quality/tests/runs/20261116T0422Z_71d2980/` (4 files); `docs/05-quality/reviews/PR-0055-TASK-286-code-review.md` (`2fe721e`) |
| Binding items checked | ADR-0023 amendment L items 1-3 and amendment M items 1-5; D-ARCH-128, D-ARCH-132, D-ARCH-133; D-ORCH-078 (P1, P3), D-ORCH-100, D-ORCH-101, D-ORCH-102/103 (P1); D-TASK286-01..05; ruling `rulings/wave-0-sheet-fold-8.md` §(4)-(9); the routed items PR46-SEC-11, -12, -15, -16, -17 and PR42-SEC-18; PR17-SEC-08 (open, root of PR55-SEC-01) |
| Reviewer / date | security-analyst, 2026-11-16, round 1. Read-only apart from this record. Every probe ran in the session scratchpad on `git archive` extracts of `tools/ci` and `.github` (head `5645b9b` and merge base `04bb7a2`) and on plumbing commits in a `git clone --shared --no-checkout`; no install, no Jest, no Docker, nothing started on GitHub. The stage-2 `ci.yml` is reviewed as the future live workflow: the workflow PR's `.github/workflows/ci.yml` at `ed3e58f` is the same blob (`a35e5a3`) as the fixture. In the PR worktree I only wrote this file and ran the commit and push. Line numbers come from single-file reads at `5645b9b`. The code-review twin `docs/05-quality/reviews/PR-0055-TASK-286-code-review.md` (CHANGES_REQUESTED) landed on the branch at `2fe721e` while this round was being written. I read it and re-ran its security probes before finalising; §6 rules on its security flags |

## 1. Summary

The policy PR teaches the base-ref tooling the stage-2 job topology (D-ARCH-128) next to stage 1, without changing the live `ci.yml`. A `ci.yml` with a `scans` job is held to the stage-1 pins, one without it to the stage-2 pins. Stage 1 also gains the routed pins now: the scans tooling step pinned line by line, `pull-requests:` confined, the lint env pinned. The PR also implements `devOptional` as production closure (D-ARCH-133) and the Dependabot npm limit of 1.

The core of each claim holds under probe:
- **PR46-SEC-17.** `TOOLS_REF` is `HEAD^1` of the test merge, verified twice: in the pinned bash of both tooling steps and again in `lane-scope.mjs` (`testedBase`). Every wrong-ref case exits 2 (T2-T6, T9).
- **PR46-SEC-16.** A proof is void when the tested base changed `.github/**`, `prisma/**`, `tools/ci/**`, `tools/quality/**`, `.semgrep/**`, a root file or a tooling input after the proof run (V1, V6).
- **PR46-SEC-12.** `ci-gate` recomputes the classification and is red on any difference (G1-G8). Its step list is exact.
- **PR46-SEC-11.** Signatures and the audit must be unconditional and must sit directly after the licences step (A1, A2, A5, A6 refused).
- **PR46-SEC-15.** `pull-requests:` is confined like `actions:` (P1-P9).
- **PR42-SEC-18.** The lint env is exact and an expression in `NODE_OPTIONS` is refused (N1-N7, N9).
- **D-ARCH-133.** A `devOptional`-only Prisma bump now selects `security-integration`; `main`'s classifier does not (D1-D6).

The gaps fall into two groups. The first group is policy-pin gaps. Each needs an owned `ci.yml` edit to exploit, and together they keep PR46-SEC-11, -12 and -15 from being fully closed:
- **PR55-SEC-01 (LOW):** `ci-gate`'s gitleaks, Semgrep and record steps have no env pin, and `BASH_ENV`, `ENV`, `PATH` and expression-valued `env:` maps are refused nowhere (PR17-SEC-08 is still open). Two lines of `ci.yml` run a workspace file inside the isolated, token-holding decision job.
- **PR55-SEC-02 (LOW, = code review R1-m1 widened):** the scan steps of `ci-gate` and the gates that run before head code in fast-lane are pinned by a `run:` pattern only. `|| true`, `--exit-code 0`, a forced `--report-only`, `; exit 0`, an indirect `$GITHUB_ENV` write and a `uses:` step all pass.
- **PR55-SEC-09 (LOW, = code review R1-m3):** in stage 2, `GH_TOKEN` is allowed on any fast-lane step that mentions the lane-scope tool, including one after head code.

The second group is the PR46-SEC-16 void set:
- **PR55-SEC-03 (LOW, = code review R1-M1 widened):** the void set omits P1 (b) (a file the PR also changes), the lint-control directories and `tools/deps/**`. **I require the widening rather than acknowledge the narrower rule** (§6).

These are condition **C1** (pins: 01, 02, 09) and **C2** (void set: 03). Both are due in the fix cycle that the code review's R1-M1 already opens, and are verified by the delta round on the fix head.

INFO:
- 04: committer-time dating (= R1-n3);
- 05: `security-integration` reads outputs that rule (g) does not compare;
- 06: fast-lane read scopes (= the code review's INFO);
- 07: P1 stays procedural at merge time;
- 08: minor residuals (= R1-n2, R1-n5);
- 10: the stage-1 topology stays accepted after the switch (= R1-m2).

Most closures take effect only when the workflow PR installs stage 2 (§5). So the PR46-SEC-11 24-hour proof-age rule and P1, including D-ORCH-103 (c), stay in force until that PR merges, not this one.

Findings: 0 Critical, 0 High, 0 Medium, 4 LOW, 6 INFO.

**Verdict: PASS_WITH_CONDITIONS** (C1, C2; §7).

## 2. Method

1. Read the full diff `04bb7a2...5645b9b`, the stage-2 fixture in full as the future live workflow, `main`'s `ci.yml`, `lane-scope.mjs` (head, 1,233 lines), the policy diff and its unchanged helpers (`requiredGateFindings`, `gateStepIndex`, `pinnedScriptProblems`, `envEntryFindings`, `tokenFindings`, the permission rules), `security-paths.mjs` and `check-security-owned-paths.mjs`. Also read the decisions and rulings listed above, ADR-0023 amendment M and the code-review record at `2fe721e`.
2. **Topology controls.** The head checker on the head tree (live stage-1 `ci.yml`, `lane-c.yml`, `nightly.yml`) gives 0 findings, so the new stage-1 pins do not turn every PR red after the merge. The head checker on the stage-2 fixture gives 0 findings. `main`'s checker on the stage-2 fixture gives the expected 7 stage-1 findings (D-TASK286-01).
3. **Workflow-policy mutant matrix** (`mut.mjs`, `mut2.mjs` to `mut6.mjs`): 75 edits of the stage-2 fixture, the live stage-1 `ci.yml`, `lane-c.yml` and `nightly.yml`, run through the head `checkWorkflow(…, { requiredGates })`. `main`'s checker ran beside it where it matters. `mut6.mjs` re-runs the code review's R1-m1 and R1-m3 probes. §8.1 lists every case except three uninformative ones: one malformed edit and two benign ones.
4. **Lane-scope probe** (`lsprobe.mjs`): the head `main()` CLI over plumbing commits (merge base with the stage-2 `ci.yml`, a PR code commit, a docs push, seven `main` variants with set committer times, test merges with parents `[main, PR head]`) and a fake API seeded with one completed proof run whose required steps all concluded success. Covers 9 tested-base cases and 8 voiding cases (§8.2). This also exercises the `baseChangedAt` CLI wiring end to end, which the code review's surviving mutant L19 (R1-m4) shows the suite does not.
5. **Gate probe** (`gate.mjs`): `gateVerdictStage2` over 10 classification pairs (§8.3).
6. **`devOptional` probe** (`sp.mjs`): `classifyRange` of head and `main` over 6 lockfile edits committed with plumbing (§8.4).
7. **Shell probe:** `BASH_ENV` with `bash -e` and with `bash --noprofile --norc -eo pipefail` on the host, with a control (§4, PR55-SEC-01).
8. **History scans:** proof-base paths over the last 380 first-parent `main` commits; lane A inputs outside the voiding set (§4, PR55-SEC-03 and -04).
9. **Parser checks:** the workflow schema of `actions/languageservices` (`step-env` accepts an expression; property lookup is case-sensitive), read with `curl`.
10. **Evidence checks:** the lane A run's step list and log; a count-only host-fragment scan of the 23 changed files (0 for every needle; a positive control found every needle). Gitleaks over the range is the lane A step that passed.
11. Record simulation (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR55-SEC-01 | `ci-gate`'s gitleaks, Semgrep and record steps carry no env pin, and no workflow refuses `BASH_ENV`, `ENV`, `PATH`, `LD_PRELOAD` or an expression-valued `env:` map: two lines of `ci.yml` run a workspace file inside the isolated, token-holding decision job before its scans and aggregation, with 0 findings | LOW | CWE-693, CWE-15 | A08 | `tools/ci/check-workflow-policy.mjs:117` (`FORBIDDEN_ENV`), `:1044-1045`, `:1054` (gates without `env`), `:1162-1190` (`envEntryFindings` sees map entries only); fixture `ci.yml:61-71`, `:567-604` | devops-engineer, TASK-286: **C1**, this PR's fix cycle. Closes PR17-SEC-08 item 1 with it |
| PR55-SEC-02 | `run:` pattern pins only: `ci-gate`'s gitleaks, Semgrep and record steps, and fast-lane's pre-head-code gates (workflow policy, install flags, migration immutability, lockfile, dependency age, licences, signatures, audit). `\|\| true`, `--exit-code 0`, a forced `--report-only`, `; exit 0`, an indirect `$GITHUB_ENV` write that re-points `GATE_LANE_SCOPE` (X4's effect without an inserted step) and a `uses:` step that exports a variable all pass | LOW | CWE-693, CWE-184 | A08 | `tools/ci/check-workflow-policy.mjs:962-972`, `:1044-1045`, `:1054`, `:1982`, `:2108-2121`; fixture `ci.yml:180-226`, `:567-604` | devops-engineer, TASK-286: **C1** (= code review R1-m1, widened to fast-lane) |
| PR55-SEC-03 | The PR46-SEC-16 void set omits lane A inputs of this PR's result: paths the PR itself changes (P1 (b)), `tools/eslint-rules`, `tools/stylelint-rules`, `tools/lint`, `tools/test-support`, `tests/fixtures/{lint,semgrep}` (the file's own lint controls) and `tools/deps/**`; the narrowing is unrecorded and ADR-0023 am. M item 5 says "no non-docs commit" | LOW | CWE-1023, CWE-693 | A08 | `tools/ci/lane-scope.mjs:122`, `:126`, `:441-445`, `:457-481`; `tools/ci/lane-scope-stage-2.test.ts:330` | devops-engineer, TASK-286: **C2**, this PR's fix cycle (= code review R1-M1); principal-architect for the item 5 wording (D-TASK286-06) |
| PR55-SEC-04 | The voiding dates a base change by its committer time (`%ct`), not by when it landed on `main`: a commit created before the proof run and pushed after it voids nothing | INFO | CWE-345 | A08 | `tools/ci/lane-scope.mjs:464`, `:717-720` | devops-engineer: record the residual in D-TASK286-06; push-time dating with TASK-287 or the next `lane-scope.mjs` edit (= R1-n3) |
| PR55-SEC-05 | `security-integration` reads fast-lane's separate `tools_ref`, `security_integration_due`, `mode` and `code_proof` outputs; rule (g) compares only the `classification` string | INFO | CWE-345 | A08 | fixture `ci.yml:90-95`, `:403`, `:449`; `tools/ci/lane-scope.mjs:913-915` | devops-engineer, this fix cycle if cheap, else TASK-287 |
| PR55-SEC-06 | Stage 2 gives the head-code job fast-lane `actions: read` and `pull-requests: read` for its whole run; "the token reaches the classify step only" is true of the step env, not of the job token | INFO | CWE-250 | A05 | fixture `ci.yml:83-86`; `tools/ci/check-workflow-policy.mjs:760`; `docs/07-ops/CI-CD.md` stage-2 bullets | principal-architect (accept as a D-ARCH-128 trade-off and record it); CI-CD.md wording |
| PR55-SEC-07 | `TOOLS_REF` is fixed at the event: a re-run, or the last run of an idle PR, judges with `main` as it was then, so P1 at merge time stays procedural | INFO | CWE-367 | A08 | fixture `ci.yml:119-162`; ADR-0023 am. M item 5 | sdlc-orchestrator (merge procedure) |
| PR55-SEC-08 | Minor residuals: (a) the unconditional install (D-TASK286-03) is not pinned (= R1-n5); (b) the lint-env rule keys on the exact `npm run lint` text (= R1-n2); (c) the npm Dependabot slot is held by two open PRs | INFO | CWE-184 | A08 / A06 | `tools/ci/check-workflow-policy.mjs:967`, `:1547`; `.github/dependabot.yml:21` | devops-engineer (a, b with C1); orchestrator (c, D-ORCH-100 (3)) |
| PR55-SEC-09 | In stage 2, `GH_TOKEN` is allowed on ANY step of fast-lane or `ci-gate` whose `run:` mentions `"${GATE_LANE_SCOPE:?}"`, including a fast-lane step after head code; the claim "the token reaches the classify step only, before any head code" is not enforced | LOW | CWE-668 | A05 | `tools/ci/check-workflow-policy.mjs:577-582` (`TOKEN_JOBS_BY_TOPOLOGY`, `LANE_SCOPE_INVOCATION`), `:2192-2199` (`tokenFindings` `allowed`) | devops-engineer, TASK-286: **C1** (= code review R1-m3) |
| PR55-SEC-10 | After the switch, a `ci.yml` that restores a `scans` job is held to the stage-1 pins, which allow signatures and the audit under `env.CODE`; no owner retires stage 1 and nothing refuses a downgrade | INFO | CWE-693 | A08 | `tools/ci/check-workflow-policy.mjs:552`, `:564`, `:1072` | devops-engineer: TASK-287 card line (retire stage 1) or a "no downgrade" rule; orchestrator: the 24-hour rule applies to any stage-1 `ci.yml` until then (= R1-m2) |

## 4. Finding details

### PR55-SEC-01: environment into `ci-gate` (LOW, C1)

**Description.**
- Stage 2 makes `ci-gate` the only isolated job that holds the token and decides. `stage2Findings` pins its step list exactly. The tooling, lane-scope, oasdiff and aggregation gates carry exact env maps.
- The gitleaks, Semgrep and record gates (`:1044-1045`, `:1054`) have no `env` key. `envEntryFindings` does not refuse `BASH_ENV`, `ENV`, `PATH`, `LD_PRELOAD` or `BASH_FUNC_*`. `checkEnvMap` skips an `env:` that is an expression string. The workflow-level env is checked only for its three required keys.

Probes against the head checker, all with 0 findings:
- F1-F3: `BASH_ENV: /home/runner/work/shipcube/shipcube/docs/x.sh` on the gitleaks, Semgrep or record step;
- F4: `env: ${{ fromJSON(github.event.pull_request.title) }}` on the record step;
- F8: `PATH` into the workspace;
- F10: workflow-level `BASH_ENV`;
- F11: workflow-level `LD_PRELOAD`;
- F12: `ENV`;
- F9: the same on the live stage-1 `scans` record step (`main`'s checker agrees).

The hosted runner's workspace path is predictable, and the test-merge checkout holds every head file, a docs file included.

Bash sources `BASH_ENV` before the step script under both GitHub default invocations. On the host, the sourced file ran, appended a gate location to the `$GITHUB_ENV` file and ended the step with `exit 0` before the pinned command ran. The control without `BASH_ENV` ran the command, which exited 1.

So the head file can:
- replace gitleaks with a green step;
- append `GATE_LANE_SCOPE=<its own script>` to `$GITHUB_ENV`, so the pinned aggregation prints MERGE-READY;
- at workflow level, also run inside the aggregation step, whose env holds `GH_TOKEN`.

PR42-SEC-18's new expression rule is keyed on a literal `NODE_OPTIONS` entry. A map-level expression (E1, E2, E4, E5) carries `NODE_OPTIONS` or `BASH_ENV` from a PR title or body past it.

This is PR17-SEC-08 (LOW, open, routed to 015-C). It now undermines PR46-SEC-12's "no step can … mask a scan or rewrite an output" in the stage-2 decision job.

**Exploitability and impact.**
- It needs an owned `ci.yml` edit (a record is required) that review misses. Two lines are enough. Once a map-level expression is merged, anyone who can edit a PR title reaches `ci-gate`.
- If exploited, it forges merge-readiness and skips the secret scan.
- The repository has no branch protection (D-ORCH-012/013), and a writer can push `main` directly. The pins therefore guard the procedural merge path against mistakes and review misses, not against a determined writer.
- H × L, rated LOW like PR17-SEC-08, PR46-SEC-03 and PR46-SEC-12, which are the same class of policy-pin gap.

**Remediation (code level).**
1. Add `BASH_ENV`, `ENV`, `PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `NODE_PATH`, `SHELLOPTS`, `BASHOPTS`, `PS4`, `IFS` and `^BASH_FUNC_` to `FORBIDDEN_ENV`, or to a preload list that `envEntryFindings` applies at every level in every workflow (PR17-SEC-08 item 1).
2. Report an `env:` that is not a mapping, at every level in every workflow (rule `env-expression`).
3. Give the gitleaks, Semgrep and record gates `env: {}` in both topologies. In `stage2Findings`, require every `ci-gate` step's env to equal its gate's (default `{}`), and the workflow env to be exactly `REQUIRED_WORKFLOW_ENV` plus the four image pins.

**Verification.** F1-F4, F8-F12 and E1, E2, E4, E5 each give a finding; C0, C1 and C2 stay at 0. Add one case per mutant to `ci-policy-stage-2.test.ts`.

### PR55-SEC-02: pattern-only pins (LOW, C1; = R1-m1 widened)

**Description.** Probes against the head checker, all with 0 findings.

In `ci-gate`, the gates at `:1044-1045` and `:1054`:
- R1: `|| true` after Semgrep;
- R2: gitleaks `--exit-code 0`;
- R3: the record step's `mode=(--report-only)` forced;
- R4: Semgrep as a block with `v=GITHUB_; v="${v}EN""V"; echo "GATE_LANE_SCOPE=…" >> "${!v}"`. This re-points the aggregation's tool, X4's effect without an inserted step.

In fast-lane, the gates at `:962-972`, which run before head code:
- A4: `|| true` after `check-audit`;
- A7: `check-audit` replaced by `--version; exit 0`;
- A8: `; true` after signatures (`audit-signatures-masked` matches `||` only);
- B4: an indirect `${!x}` write to `$GITHUB_ENV` in install flags;
- B10: a `github-script` step after classify calling `core.exportVariable`;
- F6, F7: `BASH_ENV` on the policy or audit step (with 01).

The `$GITHUB_ENV` writer rule (`:2108-2121`) is lexical over `run:` text, and `PRE_TOOLING_USES` applies only before the tooling step. In a light run, signatures and the audit are the only supply-chain gates (PR46-SEC-11).

The pre-existing class is the same in stage 1 under both checkers (code review §1.3). The positive pins work: A1, A2, A5, A6, B1-B3 and B5-B15 are refused.

**Exploitability and impact.** It needs an owned `ci.yml` edit. If it lands, the scans or the audit backstop are silently off. M × L = LOW.

**Remediation (code level).**
1. Make the gitleaks, Semgrep and record steps exact (`pinnedScriptProblems` or `exactRunProblems` with constants, as for oasdiff and the aggregation).
2. Make the single-line fast-lane gates exact: workflow policy, install flags, migration immutability, lockfile, licences, and signatures (`npm audit signatures --@platform:registry=https://registry.npmjs.org/`).
3. Pin the dependency-age and 9-line audit scripts.
4. In `stage2Findings`, allow only the pinned gate steps, in a fixed order, between the classify step and the install.
5. Refuse `uses:` in fast-lane and security-integration except `actions/checkout`, `actions/setup-node` and `actions/cache`.
6. Word the lexical `$GITHUB_ENV` rule as a tripwire.

**Verification.** R1-R4, A4, A7, A8, B4 and B10 give findings; C0 and C1 stay at 0.

### PR55-SEC-03: the PR46-SEC-16 void set (LOW, C2; = R1-M1 widened)

**Description.**
- `proofBasePath` covers `PROOF_BASE_DIRS` (`.github`, `prisma`, `tools/ci`, `tools/quality`, `.semgrep`), every root file that is not Markdown, and the manifest's `tooling_inputs`. That is P1 (c), widened.
- It does not cover the paths this PR itself changes, which is P1 (b): "`main` changed a file the PR also changes". So a combined file that no lane A run has linted, type-checked or tested merges behind an inherited proof (code review R1-M1).
- It does not cover `LINT_CONTROL_PATHS`, which the same file (`:126`) names: `tools/eslint-rules`, `tools/stylelint-rules`, `tools/lint`, `tools/test-support`, `tests/fixtures/{lint,semgrep}`.
- It does not cover `tools/deps/**` (the schema-engine pin, the npm CLI).

Probe results:
- V3 (`main` changed only `tools/eslint-rules/**` after the proof run), V4 (only `tools/deps/prisma-engines.json`) and V5 (only `apps/**`): proof accepted.
- Controls: V1 and V6 void the proof; V0 and V2 keep it.
- The test pins the narrowing (`lane-scope-stage-2.test.ts:330`), and D-TASK286-01..05 do not record it.

**Exploitability and impact.**
- Every PR's last push is a docs-only record push that inherits its proof.
- An overlapping edit, possibly to a security-owned file, or a widened security lint rule that lands on `main` in between, never runs on the merged result before the squash. The record check's rule (d) also ignores main-side changes.
- Over the last 380 first-parent `main` commits, the 22 that touched an ignored lint control or `tools/deps/**` all also touched a voiding path. So the likelihood is low today. M × L = LOW.
- Once this rule is live, the orchestrator will stop applying P1 by hand, so an unrecorded narrowing silently loses P1 (b).

**Remediation (code level).**
1. In `lane-scope.mjs`, pass the PR range's changed paths (`classify` already computes `treeChanges(root, base, head, { mergeBase: true })`) into `baseChangedAt`. A first-parent commit dates the base when it touches one of them.
2. Add `tools/eslint-rules/**`, `tools/stylelint-rules/**`, `tools/lint/**`, `tools/test-support/**`, `tools/deps/**` and `tests/fixtures/**` to `PROOF_BASE_DIRS`.
3. Record D-TASK286-06: the void set is the lane A inputs plus the PR's own paths; a semantic conflict between disjoint files stays with the D-ORCH-042 post-merge gate, as P1 (D-ORCH-102) already accepts. The security side acknowledges that set here. principal-architect aligns am. M item 5 ("equivalent signal").
4. Correct the PR body and `CI-CD.md` wording.

The code review's design note is fail-closed either way and acceptable on the security side: a docs push whose proof is void could run full instead of ending BLOCKED. Both lane-scope instances must compute it identically, and rule (g) catches any divergence.

**Verification.** No proof when `main` edits a file the PR also edits; proof kept when `main` edits another app file; V3 and V4 give no proof; V0 and V2 keep it. Also add a CLI case that kills mutant L19 (R1-m4).

### PR55-SEC-04: committer time instead of landing time (INFO; = R1-n3)

**Description.** `baseChangedAt` reads `%ct` (`:464`) and compares it with the run's `created_at` (`:717`).
- A GitHub squash merge carries its landing time.
- A commit created locally and pushed later carries its creation time.

V7: a `.github/**` change committed 60 s before the proof run and landing after it leaves the proof accepted. On `main`, 24 of the 61 proof-base-touching first-parent commits in the last 380 were direct pushes, all docs tooling inputs (`api/README.md`, `openapi.yaml`, stories, design system). There is also a race of a few seconds between GitHub computing the test merge and creating the run.

**Remediation.**
- Date a base change by its push: `GET repos/{repo}/activity?ref=refs/heads/main&activity_type=push` gives push times with `before` and `after` SHAs.
- Or add a margin for commits whose committer is not GitHub.
- Record the residual in D-TASK286-06, and push `main` commits that touch proof-base paths straight after creating them.

**Verification.** V7 gives no proof.

### PR55-SEC-05: outputs that rule (g) does not compare (INFO)

**Description.**
- Stage 1 took `security-integration`'s selection from the isolated `scans` job and its manifest ref from the event.
- Stage 2 takes both from fast-lane, through four separate outputs (`ci.yml:403`, `:449`). Rule (g) compares only `classification` (G1, G2 refused).
- The outputs come from the classify step before any head code, and a later step cannot change a finished step's outputs through workflow commands.
- Forging them would mean tampering with the runner worker, which already controls `security-integration`'s own head-code steps. Nothing new is exposed.

**Remediation.** Pass `needs.fast-lane.outputs.{mode,code_proof,security_integration_due,tools_ref}` into the aggregation env and require them to equal the parsed own classification. Alternatively, recompute `TOOLS_REF` in `security-integration` with the pinned `TESTED_BASE_SCRIPT`.

**Verification.** A gate case with a differing fast-lane `tools_ref` gives BLOCKED.

### PR55-SEC-06: read scopes on a head-code job (INFO; = the code review's INFO)

**Description.**
- RR-8 (ii) kept `actions:` on jobs that run no head code. Stage 2 gives fast-lane `actions: read` and `pull-requests: read` for the whole job.
- The token appears only in the classify step's env, but head code later in the job can read the job token from the runner worker's memory. The hosted runner user has passwordless sudo (the March 2025 tj-actions/changed-files technique).
- The scopes are read-only and the token expires with the job.
- Head code already reads the source tree. The new exposure is PR conversations, run logs and artifacts of this private repository. On a Dependabot PR, third-party package code runs in lint, unit and build.

**Remediation.**
- Accept this as a D-ARCH-128 trade-off and record it.
- `CI-CD.md`: "the only step with the token" should read "the only step whose env holds the token".
- The alternative, a lookup job with no head code, costs about one billed minute per run.

### PR55-SEC-07: P1 stays procedural at merge time (INFO)

**Description.**
- `TOOLS_REF` is the first parent of the run's fixed `GITHUB_SHA`. A re-run reuses the original test merge, and the last run of an idle PR keeps the `main` it saw.
- So "the tip of `main` at run time" (am. M item 5) and "P1 becomes mechanical" (fold-8 ruling) hold for proofs that a newer run inherits. They do not hold for the run the orchestrator merges on.

**Remediation (procedure).**
1. At merge time, compare the tested base in the `ci-gate` summary with `origin/main`: `git diff --name-only <tested base> origin/main`, filtered by `proofBasePath` and the PR's own paths.
2. If that diff is not empty, push again or reopen the PR.
3. Never use a re-run as merge evidence after `main` changed a lane A input.

### PR55-SEC-08: minor residuals (INFO)

- **(a) = R1-n5.** D-TASK286-03 keeps the install unconditional, but the stage-2 gate allows `if: env.CODE == 'true'` (`:967`; A3 gives 0 findings). Gating it fails closed in a light run, because signatures and the evidence verifier need `node_modules`. Pin it `ifs: []`.
- **(b) = R1-n2.** `lint-env` applies to a `run:` that is exactly `npm run lint` (`:1547`). Respellings in `lane-c.yml` carry `BASH_ENV` (N8, N11). Lane C is dispatch-only, so merges are not affected; `ci.yml`'s lint gate is pinned.
- **(c)** The npm `open-pull-requests-limit: 1` is already used up by #51 (the group) and #16 (a major), so no npm version-update PR opens until both are merged or ignored. Dependabot security updates are a repository setting (a human decision). Once stage 2 is live, the per-push audit turns every PR red on a known-vulnerable version, but no fix PR is proposed while the slot is taken. Process the D-ORCH-100 (3) batch promptly.

### PR55-SEC-09: the stage-2 token rule (LOW, C1; = R1-m3)

**Description.**
- `tokenFindings` allows the token on a step of a token job whose `run:` matches `LANE_SCOPE_INVOCATION`. In stage 2 the token jobs are fast-lane and `ci-gate` (`:577-582`, `:2192-2199`).
- Stage 1's rule was safe because both token jobs were scans-isolated. Fast-lane runs `deps:rebuild`, lint, tests and build.
- T1 (code review `token-probe.mjs`, re-run here): a fast-lane step after Build with `env: GH_TOKEN: ${{ github.token }}` and `run: node "${GATE_LANE_SCOPE:?}" --help; npm run build` gives no `gh-token` finding. Its only finding is `required-gates`, because the probe sits between Build and its porcelain step; the code review's position after the porcelain step gives 0.
- T2, the control without the lane-scope mention, gives `gh-token`.
- The head's build scripts would then read the token from the environment, with no memory access needed (compare 06).
- The code review's mutants P10 and P11 survive, so the stage-2 token rule has no negative test.

**Exploitability and impact.** It needs an owned `ci.yml` edit. The scopes are read-only on a repository the writer can read. L × M = LOW.

**Remediation (code level).** In stage 2, allow the token only on:
- the fast-lane step with id `classify` whose `run:` is exactly `CLASSIFY_RUN`;
- `ci-gate`'s pinned lane-scope and aggregation steps.

Match by gate position, not by a mention. Add T1 and a `security-integration` `GH_TOKEN` case as negative fixtures.

**Verification.** T1 at any position gives `gh-token`; mutants P10 and P11 are killed.

### PR55-SEC-10: the stage-1 topology stays accepted (INFO; = R1-m2)

**Description.**
- `topologyOf` accepts a `ci.yml` with a `scans` job as stage 1 for as long as the stage-1 pins exist ("until a follow-up retires them", `:552`), and no card owns that follow-up.
- After the workflow PR, a `ci.yml` that restores `scans` gets CODE-gated signatures and audit back. That undoes PR46-SEC-11 at the moment the 24-hour interim rule ends.
- It needs an owned `ci.yml` edit, and it would be a conspicuous one (a whole job).

**Remediation.**
- A TASK-287 card line to remove `CI_REQUIRED_GATES` stage 1, `laneScopeFindings` and the stage-1 branches of `gate()` and `proofSteps` once stage 2 is on `main`.
- Or a no-downgrade rule now: when the tested base's `ci.yml` is stage 2, a stage-1 head is a finding.
- Until then, the orchestrator applies the 24-hour rule to any stage-1 `ci.yml`.

## 5. Claimed closures

| Item | What this PR does | Status | Live when #55 merges? |
|---|---|---|---|
| PR46-SEC-11 | Stage-2 gates for signatures and audit with `ifs: []`, directly after licences; the fixture keeps the install unconditional | **Closed in the stage-2 policy**; residuals 02, 08 (a), 10 | **No.** Live stage 1 still gates the audit on `env.CODE`. The 24-hour proof-age rule stays until the workflow PR merges |
| PR46-SEC-12 | Tooling steps pinned line by line (stage-1 `SCANS_TOOLING_SCRIPT`, stage-2 fast-lane and `ci-gate`); only checkout and setup-node before them; classify directly after tooling; `ci-gate`'s step list exact; `"${GATE_*:?}"`; classification recomputed and compared (rule (g)) | **Partly closed**; residuals 01, 02 (in-step X4 equivalent, R4), 05 | Stage-1 part yes; stage-2 part with the workflow PR |
| PR46-SEC-15 | `pull-requests:` refused at top level, in other workflows and on other jobs (stage 1: `scans` only; stage 2: fast-lane and `ci-gate`); string forms refused; a capitalised key fails GitHub's own parser | **Closed** for job scopes; residual 09 (step-level token rule), INFO 06 | Yes (stage 1) |
| PR46-SEC-16 | Proof void when the tested base changed a proof-base path after the run (V1, V6; unreadable history gives no proof) | **Not closed yet:** C2 widens the void set (03); residuals 04, 07 | **No.** The stage-1 lookup has no base check; P1 stays procedural |
| PR46-SEC-17 | `TOOLS_REF` = `HEAD^1` of the test merge, checked against `HEAD^2` and the event base in bash and in `testedBase` (T1-T9) | **Closed** | **No.** Takes effect with the workflow PR; D-ORCH-103 P1 (c) stays until then |
| PR42-SEC-18 | Exact lint env in every workflow; `${{` refused in any `NODE_OPTIONS` | **Closed** (N1-N4, N6, N7, N9 refused; N5 refused by the YAML subset); map-level expression residual in 01 | Yes |
| D-ARCH-133 | `devOnly` = `dev: true` only | **Closed** (D1, D2, D5 select on head, not on `main`; controls D3, D4 hold) | Yes |
| Dependabot limit | npm `open-pull-requests-limit: 1`, pinned by `sec-static.test.ts` | **Done**; 08 (c) | Yes |

## 6. Rulings on the code review's security flags (`2fe721e`)

| Code review item | Ruling |
|---|---|
| R1-M1 (void set narrower than the card and P1 (b)) | **Widening required, not acknowledged as is.** P1 (b) is the case most likely to hide a semantic conflict, and the record check ignores main-side changes to an owned file. Add the PR's own paths and the lint-control and `tools/deps` directories (PR55-SEC-03, C2). The security side acknowledges, in D-TASK286-06, a void set of "lane A inputs plus the PR's own paths", with disjoint non-docs moves of `main` left to the D-ORCH-042 post-merge gate. The literal "any non-docs commit" is not required. |
| R1-m1 (regex-pinned gitleaks, Semgrep, record; `\|\| true`) | **Agreed** (R1-R4 re-run: 0 findings each). Severity LOW as PR55-SEC-02, widened to fast-lane's pre-head-code gates; C1. |
| R1-m3 (token on any step mentioning lane-scope) | **Agreed** (T1/T2 re-run). Severity LOW as PR55-SEC-09; C1. |
| INFO (fast-lane read scopes) | **Agreed**: PR55-SEC-06, accepted residual to record (principal-architect, D-ARCH-128). |
| R1-n3 (committer-time dating) | **Agreed**: PR55-SEC-04 (INFO). Record the residual in D-TASK286-06; push-time dating later. |
| R1-m2 (stage 1 never retired) | **Agreed**: PR55-SEC-10 (INFO). TASK-287 card line or a no-downgrade rule; the 24-hour rule applies to any stage-1 `ci.yml` until then. |
| R1-m4, R1-n1, R1-n5, R1-n2 | Concurred as code items. R1-m4 is covered by the C2 verification; R1-n1 (`LINT_CONTROLS` rewritten by head code skips the accident guard) is not a security finding; R1-n5 = 08 (a); R1-n2 = 08 (b). |

## 7. Conditions, interim rules and merge prerequisites

**C1 (PR55-SEC-01, -02, -09; owner devops-engineer, TASK-286).** In `check-workflow-policy.mjs`:
- PR55-SEC-01, remediation 1-3: env pins and preload refusals;
- PR55-SEC-02, remediation 1-5: exact pins and the pre-install allow-list;
- PR55-SEC-09: the step-bound token rule;
- 08 (a): install `ifs: []`;
- a test per mutant.

**C2 (PR55-SEC-03; owner devops-engineer, TASK-286; architect wording).** The widened void set with its tests, D-TASK286-06, and the PR body and `CI-CD.md` wording.

**When.** Both are due in the fix cycle that code review R1-M1 opens. They change owned paths, so this record voids for the fix head and a delta round re-runs §8.1 and §8.2 against it. They are due at the latest before the stage-2 workflow PR merges.

**Interim rules that do not end with this PR.**
- The PR46-SEC-11 24-hour proof-age rule, P1, and D-ORCH-103's widening of P1 (c) stay until the stage-2 workflow PR is merged.
- After that, the 24-hour rule ends for a stage-2 `ci.yml` only (PR55-SEC-10).
- The merge-time check of PR55-SEC-07 remains procedural.

**Merge prerequisites for #55.**
- The code review is CHANGES_REQUESTED, so #55 merges only after the fix cycle, on a head that both reviewers' delta rounds name.
- The 24-hour rule applies to that head's proof run.
- P1 must be re-checked at merge time. At this writing, `main` had moved docs-only since the merge base.
- After #55 merges, the workflow PR (`ed3e58f`, whose `ci.yml` blob equals this fixture) merges `main` in. Its security round reviews the union delta.

## 8. Probe results

### 8.1 Workflow-policy mutants (head checker; C* are controls)

| ID | Edit | Findings |
|---|---|---|
| C0 | Stage-2 fixture unchanged | 0 |
| C1 | Live stage-1 `ci.yml` unchanged | 0 |
| C2 | `lane-c.yml` unchanged | 0 |
| A1 | `if: env.CODE == 'true'` on signatures | required-gates |
| A2 | Same on the audit | required-gates |
| A3 | Install gated on CODE | **0** (08 a) |
| A4 | `\|\| true` after check-audit | **0** (02) |
| A5 | `continue-on-error: true` on the audit | continue-on-error |
| A6 | A step between signatures and audit | required-gates |
| A7 | Check-audit replaced by `--version; exit 0` | **0** (02) |
| A8 | `; true` after signatures | **0** (02) |
| B1 | A `run:` step before the fast-lane tooling step | required-gates |
| B2 | A step between tooling and classify | required-gates |
| B3 | Literal `$GITHUB_ENV` write in a later fast-lane step | required-gates, gate-env |
| B4 | Indirect `${!x}` write in install flags | **0** (02) |
| B5 | An extra step in `ci-gate` | required-gates |
| B6 | Output `tools_ref` from another step | required-gates |
| B7 | `HEAD^1` changed to `HEAD^2` in the fast-lane tooling step | required-gates |
| B7b | Same in the `ci-gate` tooling step | required-gates |
| B8 | `security-integration` `TOOLS_REF` set to the PR head | required-gates |
| B9 | Evidence step without the classify-output `TOOLS_REF` | required-gates |
| B10 | `github-script` step exporting a variable after classify | **0** (02) |
| B11 | Classify id renamed | required-gates |
| B12 | `$GITHUB_ENV` write in `security-integration` | required-gates, gate-env |
| B13 | Aggregation without `FAST_LANE_CLASSIFICATION` | required-gates |
| B14 | Gate tool without `:?` | required-gates |
| B15 | `security-integration` needs a second job | required-gates |
| R1 | `ci-gate` Semgrep `\|\| true` | **0** (02) |
| R2 | `ci-gate` gitleaks `--exit-code 0` | **0** (02) |
| R3 | `ci-gate` record `mode=(--report-only)` forced | **0** (02) |
| R4 | `ci-gate` Semgrep block plus indirect write re-pointing `GATE_LANE_SCOPE` | **0** (02) |
| T1 | Fast-lane step after Build with `GH_TOKEN` and a lane-scope mention | no gh-token; required-gates only, from the position (09) |
| T2 | Same without the mention (control) | gh-token, required-gates |
| P1 | `pull-requests: read` on `security-integration` | permissions, required-gates |
| P2 | `pull-requests: read` at top level | permissions |
| P3 | `pull-requests: write` on fast-lane | permissions, required-gates |
| P4b | Lane C job `read-all` | permissions |
| P4c | Lane C job `write-all` | permissions |
| P5 | Top-level `read-all` | permissions |
| P6 | Token on a later fast-lane step without a lane-scope mention | gh-token |
| P7 | Token on the suites step | gh-token, required-gates |
| P8 | `nightly.yml` job `pull-requests: read` | permissions |
| P9 | Lane C job `actions: read` | permissions |
| P10 | Lane C `Pull-Requests: read` | 0 here; GitHub's parser refuses the key (case-sensitive property lookup), so it fails closed |
| N1 | Lint `NODE_OPTIONS` from the PR title | node-options-preload, lint-env, required-gates |
| N2 | Lint env plus `BASH_ENV` | lint-env, required-gates |
| N3 | Expression `NODE_OPTIONS` on the unit step | node-options-preload |
| N4 | Same at job level | node-options-preload, required-gates |
| N5 | `"\x24{{ … }}"` | yaml-subset |
| N6 | `"${{ … }}"` | node-options-preload, lint-env, required-gates |
| N7 | Lane C lint without env | lint-env |
| N8 | Lane C `npm run-script lint` plus `BASH_ENV` | **0** (08 b) |
| N9 | Workflow-level expression `NODE_OPTIONS` | node-options-preload |
| N11 | Lane C lint block with a second line plus `BASH_ENV` | **0** (08 b) |
| E1 | `env: ${{ fromJSON(title) }}` on the unit step | **0** (01) |
| E2 | Same with the PR body on type-check | **0** (01) |
| E3 | Same on lint | lint-env, required-gates |
| E4 | Same on the live stage-1 unit step | **0**, also on `main` (01) |
| E5 | Same in lane C | **0** (01) |
| E6 | `format()` expression in `NODE_OPTIONS` | node-options-preload |
| F1 | `BASH_ENV` on the `ci-gate` gitleaks step | **0** (01) |
| F2 | Same on Semgrep | **0** (01) |
| F3 | Same on the record step | **0** (01) |
| F4 | Map-level expression on the record step | **0** (01) |
| F5 | `NODE_OPTIONS --require` on gitleaks (control) | node-options-preload |
| F6 | `BASH_ENV` on workflow policy | **0** (01, 02) |
| F7 | `BASH_ENV` on the audit | **0** (01, 02) |
| F8 | `PATH` into the workspace on Semgrep | **0** (01) |
| F9 | `BASH_ENV` on the live stage-1 record step | **0**, also on `main` (01) |
| F10 | Workflow-level `BASH_ENV` | **0** (01) |
| F11 | Workflow-level `LD_PRELOAD` | **0** (01) |
| F12 | `ENV` on gitleaks | **0** (01) |

### 8.2 Lane scope, stage 2 (head `main()` CLI, plumbing commits, fake API)

| ID | Case | Result |
|---|---|---|
| T1 | `--tools-ref` = `HEAD^1` of the test merge | exit 0, light, proof |
| T2 | `--tools-ref` = the PR head | exit 2 |
| T3 | `--tools-ref` = the merge base | exit 2 |
| T4 | `--head` is not `HEAD^2` | exit 2 |
| T5 | `--base` not an ancestor of the tested base | exit 2 |
| T6 | Single-parent checkout | exit 2 |
| T7 | Abbreviated `HEAD^1` | exit 0 (resolved to the full SHA) |
| T8 | Push event, tested base = range base | exit 0, full, no lookup |
| T9 | Push event, another commit | exit 2 |
| V0 | No base change (control) | proof |
| V1 | `.github/**` changed after the run | no proof (no jobs read) |
| V2 | `.github/**` changed before the run | proof |
| V3 | Only `tools/eslint-rules/**` after the run | **proof** (03) |
| V4 | Only `tools/deps/prisma-engines.json` after the run | **proof** (03) |
| V5 | Only `apps/**` after the run (a file the PR does not change) | proof (accepted by the C2 ruling) |
| V6 | API contract (a tooling input) after the run | no proof |
| V7 | `.github/**` committed 60 s before the run, landed after | **proof** (04) |

The T IDs of §8.2 are lane-scope cases, distinct from T1/T2 of §8.1.

### 8.3 Gate (`gateVerdictStage2`)

| ID | Case | Result |
|---|---|---|
| G0 | Equal light classifications with a proof | MERGE-READY |
| G1 | Classifications differ only in `tools_ref` | BLOCKED: mismatch |
| G2 | Fast-lane `due=false`, `ci-gate` `due=true` | BLOCKED: mismatch; pending |
| G3 | Both due, job skipped, no security proof | BLOCKED: pending (not run) |
| G4 | Fast-lane classification empty, fast-lane failed | BLOCKED |
| G5 | Mode and `code_changed` disagree | BLOCKED: classification missing |
| G6 | Code push with a skipped CODE step | BLOCKED: code gates skipped |
| G7 | Extra key | BLOCKED: classification missing |
| G8 | Short `tools_ref` | BLOCKED: classification missing |
| G9 | Light with no code proof on a code PR | BLOCKED: no code proof |

### 8.4 `devOptional` (`classifyRange`, head beside `main`)

| ID | Lockfile edit | Head | `main` |
|---|---|---|---|
| D1 | `devOptional` Prisma CLI version | selects | does not |
| D2 | `devOptional` engines integrity | selects | does not |
| D3 | Dev-only Jest bump (control) | does not | does not |
| D4 | Production `pg` bump (control) | selects | selects |
| D5 | Jest moved from `dev` to `devOptional` | selects | does not |
| D6 | Prisma gains `dev: true` beside `devOptional` | selects | does not |

## 9. Record simulation

Before the commit, both the merge-base checker (`04bb7a2`) and the head checker (`5645b9b`) ran on this record with `--base 04bb7a2 --pr 55 --json`, in a sparse shared clone. Scenario commits were built with plumbing. The two checkers agree on every scenario:

| ID | Scenario | Result (both checkers) |
|---|---|---|
| S1 | This record committed on `5645b9b` | pass, owned 18, satisfied by `5645b9b` |
| S0 | No record (control) | missing |
| S2 | Record without its Verdict row | missing |
| S3 | `Head` row naming the merge base | missing |
| S4 | An owned path (`tools/ci/lane-scope.mjs`) edited after the record | missing |
| S5 | A docs-only commit after the record | pass |
| S6 | This record committed on `2fe721e`, the branch tip | pass, satisfied by `5645b9b` |

Row counts in this file: one `Head` row and one `Verdict` row.

## 10. Proposed decision text (for the orchestrator to log)

**D-SEC-PR55-01 · 2026-11-16 · security-analyst · PR #55 (TASK-286 policy PR) round 1.**

- **Decision:**
  - Round 1 at `5645b9b` (record pushed on `2fe721e`) = **PASS_WITH_CONDITIONS** (0 C/H/M, 4 LOW, 6 INFO).
  - **Closed:** PR46-SEC-17, PR42-SEC-18, D-ARCH-133, the Dependabot limit.
  - **Closed in the stage-2 policy:** PR46-SEC-11.
  - **Closed for job scopes:** PR46-SEC-15.
  - **Partly closed:** PR46-SEC-12.
  - **Not closed yet:** PR46-SEC-16.
  - **C1** (PR55-SEC-01 env channel into `ci-gate`, root PR17-SEC-08; PR55-SEC-02 pattern-only pins = code review R1-m1 widened; PR55-SEC-09 step-unbound token rule = R1-m3) and **C2** (PR55-SEC-03 void set: add the PR's own paths, P1 (b) = R1-M1, plus the lint controls and `tools/deps`) are due in the fix cycle R1-M1 opens.
  - The security side acknowledges the void set "lane A inputs plus the PR's own paths" (D-TASK286-06), not the literal "any non-docs commit".
  - INFO 04-08 and 10 are routed as in the record.
  - The 24-hour proof-age rule, P1 and the D-ORCH-103 P1 (c) widening stay until the workflow PR merges, and the 24-hour rule applies to any stage-1 `ci.yml` after that.
  - The fix head needs a security delta round.
- **Reversibility:** High.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_CONDITIONS.** No Critical, High or Medium finding. C1 (PR55-SEC-01, -02, -09) and C2 (PR55-SEC-03) are due in the code review's R1-M1 fix cycle, verified by a delta round on the fix head. |

---

## Delta round 2 (fix cycle 1, head `72dcf5b`)

| Field | Value |
|---|---|
| Round | 2: the delta round over fix cycle 1 (D-ORCH-108), verifying conditions C1 and C2 of round 1 |
| Head | 72dcf5b8f8dcb4cdfe4fc71e0c75929f5bc72362 |
| Commits since round 1 | `1c729d9` (the round-1 record), `91d8070` (`fix(ci): PR #55 fix cycle 1`: `check-workflow-policy.mjs`, `lane-scope.mjs`, the stage-2 fixture comment, both stage-2 test files, `CI-CD.md`), `764b75f` (merge of `main` at `617f378`), `72dcf5b` (lane B evidence `20261117T0212Z_764b75f` only). The merge is pure: its tree `70cfcfa` equals `git merge-tree 91d8070 617f378`, and `main`'s side brought `docs/sdlc/DECISIONS.md` and `docs/sdlc/STATUS.md` only. New merge base `617f378`; `main` was `82dcba6` (docs only since) when this round was written |
| Lane A evidence | Run 44003648755 on `72dcf5b`, created 2026-11-17T02:31:42Z (stage 1, `main`'s workflow and tooling). **fast-lane `success`**; the only skipped steps are the two LINT_CONTROLS-gated ones (no lint control in the PR range). **scans**: every scan step `success`; the only red step is the record step. `ci-gate` is red only as the aggregate. Lane B `20261117T0212Z_764b75f` PASS, accepted by the base-ref verifier in that run |
| Owned paths changed since round 1 | 5 (all in `91d8070`): `tools/ci/check-workflow-policy.mjs`, `tools/ci/lane-scope.mjs`, `tools/ci/fixtures/stage-2/ci.yml` (one comment line; blob `a35e5a3` became `4597259`), `tools/ci/ci-policy-stage-2.test.ts`, `tools/ci/lane-scope-stage-2.test.ts`. The PR's owned set is still 18 paths |
| Reviewer / date | security-analyst, 2026-11-17, delta round 2. Read-only apart from this section. Probes ran in the session scratchpad on `git archive` extracts of `72dcf5b` (fix head) and `5645b9b` (round-1 head, the differential control), and on plumbing commits in a shared clone. No install, Jest, Docker or GitHub run. In the PR worktree I only appended this section and ran the commit and push. Line numbers come from single-file reads at `72dcf5b`. Decisions read: D-SEC-PR55-01, D-TASK286-06, D-TASK286-06a, D-TASK286-01a, D-ORCH-108 |

### R2.1 Summary

Fix cycle 1 closes both conditions.
- **C1 is closed:**
  - **PR55-SEC-01.** `preload-env` (`BASH_ENV`, `ENV`, `PATH`, `NODE_PATH`, `LD_*`, `SHELLOPTS`, `BASHOPTS`, `PS4`, `IFS`, `BASH_FUNC_*`, case-insensitive) and `env-expression` apply at every level of every workflow. `env: {}` is pinned on the gitleaks, Semgrep and record gates in both topologies, and the stage-2 workflow env is an exact key set.
  - **PR55-SEC-02.** Every stage-2 step from the classify step to the lane B evidence step is exact, carries no env and directly follows the previous one. So are `ci-gate`'s three scan steps, and `uses:` in fast-lane and security-integration is limited to checkout, setup-node and cache.
  - **PR55-SEC-09.** `GH_TOKEN` is bound to the classify step and to `ci-gate`'s lane-scope and aggregation steps, by gate position, exact run and id.
  - **08 (a).** The install is pinned unconditional.
- **C2 is closed (PR55-SEC-03).** The void set covers every path the PR changes (docs included), the lint controls, `tools/deps/**` and `tests/fixtures/**`, and an unknown range gives no proof. This is a superset of my round-1 ruling (D-TASK286-06a).

Every mutant that passed in round 1 is now refused, and the same mutants pass the round-1 checker, which is the differential control. The live stage-1 `ci.yml`, `lane-c.yml`, `nightly.yml` and the stage-2 fixture each give 0 findings under the fix head.

**Stage 1 (live today) is covered for PR55-SEC-01 as filed.** F9 (step `BASH_ENV` on the scans record step), F10 and F11 (workflow `BASH_ENV`, `LD_PRELOAD`) and E4 (a map-level expression on the live unit step) are refused.

Stage 1 is not covered in two respects (R2.4):
- Its workflow env is a deny-list, not an exact key set. Workflow-level `DOCKER_HOST`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, `GIT_CONFIG_*` and `NPM_CONFIG_SCRIPT_SHELL` still reach every scans step; `DOCKER_HOST` moves the gitleaks and Semgrep containers to another daemon, which is a masked scan.
- The stage-1 scans steps are still pattern-pinned, so `|| true` and `--exit-code 0` pass.

Both need an owned `ci.yml` edit, exist only while stage 1 is live, and the first is fixed by one line, because the live `ci.yml` already has exactly the stage-2 key set. New **PR55-SEC-11 (LOW)**, a follow-up and not a condition.

Findings now open: 0 Critical, 0 High, 0 Medium, 1 LOW (PR55-SEC-11), 5 INFO (04, 05, 06, 07, 10). 01, 02, 03, 08 and 09 are closed.

**Verdict round 2: PASS_WITH_FOLLOW-UPS.**

### R2.2 Method

1. Read `git diff 1c729d9 91d8070` in full: the policy (410-line diff), `lane-scope.mjs`, the fixture and the two test files. Checked the merge purity (above) and the new decisions.
2. **Topology controls.** The head checker on the live stage-1 `ci.yml`, `lane-c.yml` and `nightly.yml` gives 0 findings; on the stage-2 fixture, 0.
3. **Round-1 mutant matrix re-run** (`mut.mjs` to `mut6.mjs`, unchanged) on the fix head, with the round-1 head `5645b9b` beside it where the script runs both.
4. **New residual probes** (`mut7.mjs`, Y1-Y13): workflow-level env names outside the deny-list in both topologies, stage-1 in-step masking, token-rule variants, container and job env, flow mappings.
5. **Lane-scope probe** (`lsprobe2.mjs`): the round-1 T1-T9 and V0-V7, plus V8 (main edits a file the PR also changes), V9 (the same for a docs file), V10 (`tests/fixtures/semgrep/**` only) and V11 (`tools/stylelint-rules/**` only). Run on the fix head and on `5645b9b`.
6. **Shell re-check.** The `BASH_ENV` mechanism still masks a step (exit 0, gate never ran, one `$GITHUB_ENV` line written); the control exits 1. So refusing it in policy is what matters.
7. Read the unit-test coverage of the new null-range rule (`lane-scope-stage-2.test.ts:469-476`), the lane A step list, and the workflow-env key sets of every workflow (`wfkeys.mjs`).
8. Record simulation (R2.8).

### R2.3 Conditions and findings after round 2

| ID | Round 1 | Fix (`72dcf5b`) | Round 2 status | Evidence |
|---|---|---|---|---|
| C1: PR55-SEC-01 | LOW, condition | `PRELOAD_ENV` and `preload-env` (`check-workflow-policy.mjs:137`, `:1349`), `env-expression` (`:1605`), `env: {}` on the scan gates of both topologies (`:854-857` and stage 2), exact stage-2 workflow env keys (`:2201`) | **Closed** for stage 2; stage-1 residual in PR55-SEC-11 | F1-F12, E1-E5, N2, N8, N11, Y4, Y5, Y11, Y12 refused; `5645b9b` gave 0 for E1-E5 and F1-F4, F6-F9 |
| C1: PR55-SEC-02 | LOW, condition | Exact `run:` constants for workflow policy, install flags, migration immutability, lockfile, dependency age, install, licences, signatures, audit, gitleaks, Semgrep and record, each with `env: {}`; an `after` chain from the classify step to the evidence step; `STAGE_2_USES` (`:1003`) | **Closed** for stage 2; stage-1 scans masking in PR55-SEC-11 | A3, A4, A7, A8, B4, B10, R1-R4 refused |
| C1: PR55-SEC-09 | LOW, condition | `tokenSteps` (`:2400`): the classify step, and `ci-gate`'s lane scope and aggregate, each matched by gate index, exact run and id | **Closed** | T1, Y9 (the code review's position), Y10 (a classify duplicate after head code) and P6, P7 give `gh-token` |
| C1: 08 (a) | INFO | Install `ifs: []` and exact | **Closed** | A3 refused |
| C2: PR55-SEC-03 | LOW, condition | `PROOF_BASE_DIRS` widened (`lane-scope.mjs:127`), `LINT_CONTROL_PATHS`, the PR's own paths (`:468`), null range gives no proof (`:488`), CLI wiring passes `result.prPaths` | **Closed** | V3, V4, V8-V11 give no proof on the fix head and a proof on `5645b9b`; controls V0, V2 keep the proof, V1, V6 void it; V5 keeps it as ruled |
| PR55-SEC-04 | INFO | Accepted residual (D-TASK286-06) | Open, accepted | V7 still gives a proof |
| PR55-SEC-05 | INFO | Routed to TASK-287 (D-TASK286-01a card line) | Open, routed | - |
| PR55-SEC-06 | INFO | Accepted residual (D-TASK286-06); `CI-CD.md` now says "the only fast-lane step whose env holds the token" | Open, accepted | - |
| PR55-SEC-07 | INFO | Procedure | Open (orchestrator) | - |
| PR55-SEC-08 | INFO | (a) closed. (b) superseded: `preload-env` now refuses `BASH_ENV` beside any lint spelling (N8, N11), and the exact-text lint rule only affects lane C wording. (c) is the Dependabot backlog | **Closed** as a finding; (c) stays an orchestrator item | - |
| PR55-SEC-10 | INFO | TASK-287 retirement card line; the 24-hour rule applies to any stage-1 `ci.yml` (D-TASK286-01a) | Open, routed | - |

The round-1 note that the workflow PR's `ci.yml` is blob `a35e5a3` no longer holds: the fixture is now `4597259` (one comment line). The workflow PR must install the new blob, and its review checks that.

### R2.4 Ruling: is stage 1 (live today) fully covered?

**Yes for PR55-SEC-01 as filed. No for two neighbouring channels, which become PR55-SEC-11 (LOW, follow-up).**

Covered in the live stage-1 `ci.yml`:
- `preload-env` and `env-expression` run on every workflow at every level, whatever the topology.
- The stage-1 gitleaks, Semgrep and record gates now carry `env: {}`.
- F9 (`BASH_ENV` on the scans record step), E4 (a map-level expression on the live unit step), F10 and F11 (workflow-level `BASH_ENV`, `LD_PRELOAD`), Y4 (lower-case `path`) and Y5 (`BASH_FUNC_node%%`) are each refused under the stage-1 topology.

Not covered in stage 1, all with 0 findings:
- Y1-s1: workflow-level `DOCKER_HOST: tcp://<host>:2375`;
- Y2-s1: `ACTIONS_ALLOW_UNSECURE_COMMANDS: 'true'`;
- Y3-s1: `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`;
- Y6-s1: `NPM_CONFIG_SCRIPT_SHELL`;
- Y7-s1: `|| true` after the scans Semgrep step;
- Y8-s1: gitleaks `--exit-code 0`.

The same names give a finding in stage 2, because its workflow env is an exact key set (Y1-s2 to Y6-s2).

### PR55-SEC-11: stage-1 workflow env and scans steps (LOW, follow-up)

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR55-SEC-11 | While stage 1 is live, its workflow env is held only to the deny-list (no exact key set), so `DOCKER_HOST`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, `GIT_CONFIG_*` and `NPM_CONFIG_SCRIPT_SHELL` reach every scans step; the stage-1 scans gates remain pattern-pinned (`\|\| true`, `--exit-code 0` pass) | LOW | CWE-693, CWE-184 | A08 | `tools/ci/check-workflow-policy.mjs:2201` (exact keys in `stage2Findings` only; `laneScopeFindings` at `:2082` has none), `:855-857` (stage-1 scan gates, `run:` patterns); the live `.github/workflows/ci.yml` workflow env | devops-engineer: the exact-keys line in the TASK-286 workflow PR if cheap, else with the TASK-287 stage-1 retirement; the deny-list extension for `lane-c.yml`/`nightly.yml` with 015-C |

**Description.**
- `DOCKER_HOST` points the docker CLI of the gitleaks and Semgrep steps at another daemon, which returns whatever exit code it likes. That masks the scan without touching the pinned command.
- `ACTIONS_ALLOW_UNSECURE_COMMANDS` re-enables the `::set-env` and `::add-path` log commands, so tool output that echoes head content could set env or `PATH` for later scans steps.
- `GIT_CONFIG_*` injects git configuration into every git command of the scans job.
- The in-step masking of the scans gates is the pre-existing PR #10 R2-m2 class that the code review also noted.

None of this applies to stage 2: its workflow env, job env and every `ci-gate` step env are exact.

**Exploitability and impact.**
- It needs an owned `ci.yml` edit and a review miss, and only while stage 1 is live, which is until the workflow PR merges and TASK-287 retires stage 1.
- The impact is a masked scan in the merge-deciding job. H × L, rated LOW like PR17-SEC-08 and PR46-SEC-03.

**Remediation (code level).**
1. In `laneScopeFindings`, apply the same workflow-env exact-key check as `stage2Findings:2197-2201`. The live `ci.yml` already has exactly those 7 keys (`wfkeys.mjs`), so the change produces 0 findings today.
2. For `lane-c.yml` and `nightly.yml`, which run docker and git too, add `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, `GIT_CONFIG_COUNT` plus the `^GIT_CONFIG_(KEY|VALUE)_` pattern, `GIT_EXEC_PATH`, and `^NPM_CONFIG_SCRIPT_SHELL$` (any case) to `PRELOAD_ENV`, or give those workflows exact key sets.
3. The stage-1 in-step masking ends with the stage-1 retirement (D-TASK286-01a); no separate fix.

**Verification.** Y1-s1, Y2-s1, Y3-s1 and Y6-s1 give findings; C1 stays at 0.

### R2.5 Probe results (fix head `72dcf5b`; the second column is the round-1 head `5645b9b` where it was run)

| Set | Cases | Fix head | Round-1 head |
|---|---|---|---|
| Controls | C0 (stage-2 fixture), C1 (live stage-1 `ci.yml`), C2 (`lane-c.yml`) | 0 each | 0 each |
| Round-1 bypasses (all 0 in round 1) | A3, A4, A7, A8, B4, B10, R1-R4 | refused (`required-gates`) | 0 |
| Env channels | E1, E2, E4, E5 (map-level expression), F4 | `env-expression` | 0 |
| Env channels | F1-F3, F6-F12 (`BASH_ENV`, `PATH`, `ENV`, `LD_PRELOAD` at step and workflow level, `ci-gate` and fast-lane) | `preload-env` (plus `required-gates` on pinned steps) | 0 |
| Lane C | N8, N11 (`BASH_ENV` beside a respelled lint) | `preload-env` | 0 |
| Token | T1, Y9, Y10 | `gh-token` | T1 0 |
| Token | T2, P6, P7 (controls) | `gh-token` | `gh-token` |
| Unchanged pins | A1, A2, A5, A6, B1-B3, B5-B9, B11-B15, P1-P5, P8, P9, N1-N7, N9, E3, E6, F5 | refused as in round 1 | refused |
| Fail-closed parses | P4 (malformed), P10 (`Pull-Requests:`, GitHub refuses the key), Y13 (flow mapping: `yaml-subset`) | as in round 1 / refused | - |
| Stage-1 residual | Y1-s1, Y2-s1, Y3-s1, Y6-s1, Y7-s1, Y8-s1 | **0** (PR55-SEC-11) | - |
| Stage-2 counterpart | Y1-s2 to Y6-s2 | `required-gates` (exact keys), plus `preload-env` for Y4, Y5 | - |
| Container and job env | Y11 (container `BASH_ENV`), Y12 (job env expression) | `preload-env`, `env-expression` | - |

Lane scope (`lsprobe2.mjs`). T1-T9 are identical to round 1 (wrong tested base exits 2, the right one gives a proof).

| ID | `main` change after the proof run | Fix head | Round-1 head |
|---|---|---|---|
| V0 | none (control) | proof | proof |
| V1 | `.github/**` | no proof | no proof |
| V2 | `.github/**`, before the run | proof | proof |
| V3 | `tools/eslint-rules/**` only | **no proof** | proof |
| V4 | `tools/deps/prisma-engines.json` only | **no proof** | proof |
| V5 | `apps/**` file the PR does not change | proof (as ruled) | proof |
| V6 | API contract | no proof | no proof |
| V7 | `.github/**` committed before, landed after | proof (accepted residual 04) | proof |
| V8 | a file the PR also changes (P1 (b)) | **no proof** | proof |
| V9 | a docs file the PR also changes | **no proof** | proof |
| V10 | `tests/fixtures/semgrep/**` only | **no proof** | proof |
| V11 | `tools/stylelint-rules/**` only | **no proof** | proof |

### R2.6 Claimed closures after round 2

| Item | Status | Live when #55 merges? |
|---|---|---|
| PR46-SEC-11 | **Closed in the stage-2 policy** (audit and signatures exact, unconditional, in the after-chain) | No: the 24-hour proof-age rule stays until the workflow PR merges, and then applies to any stage-1 `ci.yml` (D-TASK286-01a) |
| PR46-SEC-12 | **Closed for stage 2**; stage-1 residual in PR55-SEC-11 | Stage-1 part yes; stage-2 part with the workflow PR |
| PR46-SEC-15 | **Closed** (job scopes and the step-bound token rule); INFO 06 accepted | Yes (stage 1) |
| PR46-SEC-16 | **Closed** (void set as D-TASK286-06a); INFO 04 accepted, 07 procedural | No: P1 stays procedural until the workflow PR merges |
| PR46-SEC-17 | **Closed** | No: with the workflow PR; D-ORCH-103 P1 (c) stays until then |
| PR42-SEC-18, D-ARCH-133, Dependabot limit | **Closed / done** (unchanged) | Yes |
| PR17-SEC-08 | **Item 1 closed** (`preload-env` everywhere). Its remaining scope: the names in PR55-SEC-11 item 2 (015-C), and the `$GITHUB_ENV`/`$GITHUB_PATH` writer allow-list (item 2) for non-exact steps (accepted tripwire) | Yes |

### R2.7 Merge prerequisites for #55

- **Record push.** The next push (this record) is docs-only, giving a light stage-1 run. Predicted outcome:
  - identical = the record commit, `72dcf5b`, `764b75f`;
  - `code_proof=44003648755:72dcf5b…`;
  - `security_paths=false`, so no security-integration;
  - MERGE-READY if the record check passes.
- **Code review.** The code reviewer's round 2 must approve as well.
- **24-hour rule.** Proof run 44003648755 was created at 2026-11-17T02:31:42Z, so merge by 2026-11-18T02:31Z, or after a fresh full run.
- **P1.** `main` moved docs-only since the merge base `617f378` (`82dcba6`). Re-check at merge time.
- **Workflow PR.** After the merge, the workflow PR merges `main` in and installs fixture blob `4597259`. Its review covers the union and PR55-SEC-11 item 1 if it rides there.

### R2.8 Record simulation

Both the merge-base checker (`617f378`) and the head checker ran on this file, appended and committed on `72dcf5b`, with `--base 617f378 --pr 55 --json`, in a sparse shared clone. The two checkers agree on every scenario (R2.8 table).

### R2.9 Proposed decision text (for the orchestrator to log)

**D-SEC-PR55-02 · 2026-11-17 · security-analyst · PR #55 security delta round 2 at `72dcf5b`.**

- **Decision:**
  - **PASS_WITH_FOLLOW-UPS.**
  - **C1 closed:** PR55-SEC-01 (`preload-env`, `env-expression`, `env: {}`, exact stage-2 workflow env), PR55-SEC-02 (exact pre-head and `ci-gate` scan pins, `STAGE_2_USES`), PR55-SEC-09 (step-bound token), 08 (a) (install pinned).
  - **C2 closed:** PR55-SEC-03 (void set per D-TASK286-06a; differential V3, V4, V8-V11).
  - **Stage 1 live today:** covered for PR55-SEC-01 as filed (F9, E4, F10, F11 refused). New **PR55-SEC-11 (LOW, follow-up):** stage 1's workflow env is a deny-list, so `DOCKER_HOST`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, `GIT_CONFIG_*` and `NPM_CONFIG_SCRIPT_SHELL` pass, and its scans steps stay pattern-pinned. Fix: apply the exact workflow-env key check to stage 1 (0 findings on the live file) in the workflow PR if cheap, else with the TASK-287 retirement; extend the deny-list for `lane-c`/`nightly` with 015-C.
  - **Open INFO:** 04, 06 (accepted), 05, 10 (TASK-287), 07 (orchestrator).
  - **Merge:** on MERGE-READY for the exact final head, with the code review's approval, by 2026-11-18T02:31Z (24-hour rule from run 44003648755), with P1 re-checked.
- **Reversibility:** High.

R2.8 table (simulation scenarios; one row per scenario):

| ID | Scenario | Result (both checkers) |
|---|---|---|
| S1 | This file (round 1 plus this section) committed on `72dcf5b` | pass, owned 18, satisfied by `72dcf5b`; a note that the round-1 row `5645b9b` has owned changes after it |
| S0 | The round-1 record alone on `72dcf5b` (control) | missing (`5645b9b` has owned changes after it) |
| S2 | This section without its Verdict row | pass: the round-1 Verdict row is then the last one, so every round must append its own (procedural, PR10-SEC-04) |
| S3 | This section's `Head` row naming `1c729d9` (before the fix) | missing |
| S4 | An owned path (`tools/ci/lane-scope.mjs`) edited after this record | missing |
| S5 | A docs-only commit after this record | pass |

`Head` rows in the file: two (round 1, round 2); `Verdict` rows: two, the last one below.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 2 at `72dcf5b`: conditions C1 and C2 are closed; no Critical, High or Medium finding is open. Open: PR55-SEC-11 (LOW, follow-up) and INFO 04, 05, 06, 07, 10. |
