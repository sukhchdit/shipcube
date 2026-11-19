# PR-pending: TASK-287 part 287-B (workflow PR: event-commit check and fast-lane outputs in ci.yml, V2 only, PR #62 follow-ups), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-287B-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control C1).

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `ci/TASK-287B-workflow`, one commit on `36bc841` (merge base, origin/main at the time of the commit). To be pushed as the code commit plus one evidence-only commit (lane B run files under `docs/05-quality/tests/runs/` only) |
| Head | 06f62acfa6a19a9235a7d743d1e3d5fe3376e43b |
| Tip to push | The code commit above plus one evidence-only commit. Main's checker accepts that tip through the merge ref (section 7) |
| Lane A evidence | None: the branch is not pushed. Under the tested-base rule, this PR's run is judged by main's `tools/ci` (287-A policy, which accepts this `ci.yml`: 0 findings, section 2). The first run after the merge is the first live run of the V2-only policy and the required `FAST_LANE_*` entries |
| Lane B evidence | None for `06f62ac` at review time. The evidence-only commit will carry it (merge condition 3) |
| Owned paths changed | 6, all security-owned (CODEOWNERS `/.github/`, `/tools/ci/`): `.github/workflows/ci.yml`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/lane-scope.mjs`, `tools/ci/security-paths.mjs` (comment only), `tools/ci/ci-policy-stage-2.test.ts`, `tools/ci/lane-scope-stage-2.test.ts` |
| Unowned paths changed | `docs/04-plan/spikes/SPK-07.md`, `docs/07-ops/CI-CD.md`, both read |
| Binding items checked | The TASK-287 card (WAVE-00 batch 0.12): PART ORDER and "287-B ALSO CARRIES" (1)-(4). D-SEC-PR62-01: PR62-SEC-02 is a condition on 287-B; the PR62-SEC-01 interim record checks apply. D-ORCH-135 routings. PR59-SEC-01 item 2 and PR55-SEC-05, workflow halves. ADR-0023 am. N item 3 residual. The code review r1 on main (`3ad2495`, `docs/05-quality/reviews/PR-pending-TASK-287B-code-review.md`, APPROVED_WITH_NITS) |
| Reviewer / date | security-analyst, 2026-11-19, round 1, pre-push. Host rule (a lane-B run held the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node probes on `git archive` extracts of `.github` and `tools/ci` at `06f62ac` (head) and `36bc841` (merge base; `tools/ci` and `.github` on origin/main `3ad2495` are identical to it). Disclosure: at the start of the round I ran three read-only git commands in the PR worktree (`git log --oneline`, `git diff --stat`, `git status -s`). `git status` can refresh the worktree's index stat cache; no tracked or untracked file there was written. Everything after that ran from the main checkout or the session scratch. Line numbers come from single-file reads at `06f62ac` |

## 1. Summary

The question of this round: does the workflow PR finish what 287-A prepared without weakening any gate? Concretely:

- is PR62-SEC-02 closed exactly;
- are the `ci.yml` halves of PR59-SEC-01 item 2 and PR55-SEC-05 in place;
- does the narrowed run-full stay fail-closed and bounded;
- does the PR keep D-SEC-PR62-01's interim rule;
- does it add any script-injection or token-scope exposure?

Answers:

- **PR62-SEC-02 is closed.**
  - The policy now accepts only V2 in both tooling steps (`check-workflow-policy.mjs:778`, `:936`, `pinnedScriptProblems(..._V2)`).
  - The four `FAST_LANE_*` entries are part of the aggregation step's exact env, each with its exact value (`:590-597`, spreading `CI_GATE_ENV_FAST_LANE_OUTPUTS`).
  - `pinnedScriptAlternativesProblems` and `envOptional` are deleted, and nothing references them any more.
  - A differential of the merge-base policy and the head policy over **1,229 mutants** of the head `ci.yml` finds **0 weaker** results and **10 stricter** ones. The 10 are exactly the designed ones: V1 in either tooling step (2), each of the four entries dropped as a line (4) and as an entry (4).
- **PR59-SEC-01 item 2 (workflow half) is closed.** Both tooling steps start with `if [ "$(git rev-parse HEAD)" != "$GITHUB_SHA" ]; then … exit 1` (`ci.yml:123`, `:512`), before the tested-base lines.
  - In real bash on a scratch repository, V2 passes only when the checkout is the event commit. It fails closed, writing nothing to `$GITHUB_ENV`, when:
    - the checkout is a crafted merge whose first parent is an attacker's commit;
    - `GITHUB_SHA` names another commit;
    - `GITHUB_SHA` is unset, empty, abbreviated or upper-case.
  - V1 as the control accepts the crafted merge and hands the attacker's commit on as `TOOLS_REF`.
  - Every `GITHUB_*` name is refused by the `reserved-env` rule at every env level (`check-workflow-policy.mjs:1101`), so a workflow cannot feed the check its own `GITHUB_SHA`.
  - 28 other edits of the V2 lines per step are refused by both policies: `=` for `!=`, `$RANGE_HEAD`, `HEAD^2`, a default expansion, `trap`, `set +e`, an `exit` or `git` function, an alias, an NBSP pseudo-comment, the check moved after the tested-base lines, and others.
- **PR55-SEC-05 (workflow half) is closed.** `ci.yml:628-631` passes `mode`, `code_proof`, `security_integration_due` and `tools_ref` into the aggregation. Main's `gateInputStage2FromEnv` already compares each value it is given with ci-gate's own classification: a differing `tools_ref`, a differing `security_integration_due` or an empty `mode` (fast-lane red or skipped) gives `fast-lane outputs mismatch`. So the compare is live from this PR's own run.
- **The narrowed run-full stays fail-closed and bounded.** `voidedByBase` under the head implies `voidedByBase` under the merge base: only conjuncts were added. A full run only adds gates (rule (b) needs this run's code steps).
  - Over 14 scenarios on a fake runs/jobs API, the head gives `false` whenever any of these holds: the voided run is red, a newer non-voided run exists, the jobs call fails, or the run is unbound.
  - Under 60 voided runs it stops at `MAX_API_CALLS` = 40 (`lane-scope.mjs:107`). The new jobs calls share the lookup's single counter.
  - Notes reach the step summary only through `safe()`. Problem texts carry the expected step names and API conclusion values, so the new note line adds no workflow-command or markdown channel.
- **D-SEC-PR62-01 interim rule: satisfied.**
  - All 8 action steps of `ci.yml` (and the 18 of `lane-c.yml` and the 4 of `nightly.yml`) are byte-identical in `uses:`, key set and `with:` between `36bc841` and `06f62ac`. No `uses:` commit changed and no action step gained `env:`.
  - The only step-env change in any workflow is the four entries on the aggregation `run:` step.
  - Workflow and job `permissions`, `on`, workflow env and every job's env, `if`, `needs` and `outputs` are unchanged.
- **Script injection and token scope: no new exposure.**
  - No `run:` block in `ci.yml` contains a `${{ }}` expression, at the merge base or at the head; a planted one is detected by the probe.
  - The new values arrive only as env and are read by Node, never by a shell.
  - `GH_TOKEN` placement and job permissions are unchanged. The extra jobs calls use the classify step's existing read token (`actions: read`, `pull-requests: read`, `contents: read`), within the same 40-call cap.

Findings: 0 Critical, 0 High, 0 Medium, 0 Low, 2 INFO (PR287B-SEC-01, PR287B-SEC-02). Both are defence in depth for 287-C, the next policy PR. Neither is introduced by this PR.

## 2. Method

1. **Read the diff.** I read the full diff `36bc841..06f62ac` (8 files, +228/-119). At `06f62ac` I read in full:
   - the changed parts of `check-workflow-policy.mjs` (V2 constants, `CI_GATE_ENV_TESTED_BASE`, `requiredGateFindings`, the `reserved-env` rule, the job-shape rule);
   - in `lane-scope.mjs`: `lookupProofs` (old and new voided handling), `gateVerdictStage2`, `gateInputStage2FromEnv`, `checkoutProblem`, the run-full override in `main`, and the summary writer;
   - the comment-only change to `security-paths.mjs`;
   - both docs, and the test diffs (test titles: two tests rewritten in place and inverted, four tests added, none removed).
2. **Policy differential** (`s287b/probes/diff-policy.mjs`). I ran the merge-base and head `checkWorkflow(text, 'ci.yml', { requiredGates: true })` side by side over 1,229 mutants of the head `ci.yml`:
   - A: every non-blank line deleted (584);
   - B: every non-comment line duplicated (431);
   - C: 62 V2 edits in both tooling steps;
   - D: 75 aggregation-env edits;
   - E: 15 edits to the fast-lane `outputs:` map;
   - F: 54 action-step `env`/`if`/`uses` edits;
   - G: 8 workflow and job shape edits.

   Baselines: merge-base policy × head workflows 0 / 0 / 0 (`ci.yml`, `lane-c.yml`, `nightly.yml`); head policy × head workflows 0 / 0 / 0; head policy × merge-base `ci.yml` 6 (V1 twice, four missing entries), merge-base policy × merge-base `ci.yml` 0.

   Results by family (both refuse / both accept / stricter / weaker):

   | Family | Both refuse | Both accept | Stricter | Weaker |
   |---|---|---|---|---|
   | A | 367 | 213 | 4 | 0 |
   | B | 395 | 36 | 0 | 0 |
   | C | 56 | 4 | 2 | 0 |
   | D | 57 | 14 | 4 | 0 |
   | E | 15 | 0 | 0 | 0 |
   | F | 25 | 29 | 0 | 0 |
   | G | 7 | 1 | 0 | 0 |

   The both-accept rows of C and D are equivalent texts:
   - trailing blanks or a CR at the end of the `if` line;
   - the same value single- or double-quoted;
   - a key followed by a space before the colon;
   - the four entries reordered or moved.

   The both-accept rows of F are the PR62-SEC-01 levers (action-step `env:`, `if:`, another 40-hex `uses:` commit). The both-accept row of G is `runs-on: self-hosted` (PR287B-SEC-02).
3. **V2 in real bash** (`s287b/probes/v2-bash.mjs`). I ran the four pinned script constants of the head module (V1 and V2 for each tooling step) in a scratch repository. The repository has a base commit, a PR commit, a main commit, the test merge M, and a crafted merge X whose first parent is an attacker's commit D. There were 7 checkout/`GITHUB_SHA` cases per script; for each I recorded the exit code, the `$GITHUB_ENV` lines and `TOOLS_REF`. Results are in section 3.
4. **Lookup behaviour** (`s287b/probes/m1-probe.mjs`). I ran head and merge-base `lookupProofs` side by side over a fake runs/jobs/pulls/events API with a call log, in 14 scenarios: voided green/red/red-scans; voided green plus a newer non-voided red or green run; a jobs-call failure; voided red newer plus voided green older; identical-set siblings; an unbound branch; no runs; a failed runs listing; 60 voided runs with the green one at #5, #36 or #59. All 14 matched expectations.
5. **Rule (g) with the four entries** (`s287b/probes/gate-env.mjs`). `gateInputStage2FromEnv` plus `gateVerdictStage2`, head and merge base, with the entries equal, one differing, empty, absent and space-padded.
6. **Interim rule, injection and shape** (`s287b/probes/action-steps.mjs`, `run-expr.mjs`, `job-keys.mjs`, `job-keys2.mjs`):
   - every action step and step env of all three workflows, merge base against head, with a planted `env:` as the positive control;
   - `${{ }}` inside `run:`, with a planted expression as the positive control;
   - job-level keys of the three stage-2 jobs (`runs-on`, `container`, `services`, `environment`, `defaults`, `timeout-minutes`).
7. **Gitleaks hint.** The over-approximating scan (pinned v8.30.1 `config/gitleaks.toml`, 220 compiled rules, keyword prefilter plus rule regex, no entropy, no allowlists) over the 224 added lines of `36bc841..06f62ac` finds 0 hits; its runtime controls (`generic-api-key`, `github-pat`) fire. Lane A's Gitleaks decides.
8. **Record simulation** with main's checker on the simulated test merge (section 7). Before that, a `git merge-tree --write-tree origin/main 06f62ac` check is clean. Since `36bc841`, main changed only `docs/` and `.claude/agent-memory/` paths, none of them a path this PR changes.

## 3. What the PR closes, and how it was checked

| Item | Where | Evidence | Status |
|---|---|---|---|
| PR62-SEC-02: V2 only | `check-workflow-policy.mjs:778`, `:936`; `ci.yml:123-126`, `:512-515` | Mutants "check removed (V1)" are refused by the head and accepted by the merge base, in both steps. The 56 other V2 edits (28 per step) are refused by both policies | **Closed** |
| PR62-SEC-02: four entries required, exact | `check-workflow-policy.mjs:590-597`; `ci.yml:628-631`; `envOptional` gone from `requiredGateFindings` | Each entry dropped (as a line or as an entry): head refuses, merge base accepts. Wrong value, another output, own `steps.lane-scope` output, the classification, an `\|\|` default, an empty string or literal, a lower-case key, duplicates, extra `FAST_LANE_EXTRA`/`BASH_ENV`/`GITHUB_SHA`, the same names at job or workflow level: refused by both | **Closed** |
| PR62-SEC-02: transitional helpers removed | `pinnedScriptAlternativesProblems`, `envOptional` | Gone from the module and its typedef. V1 constants stay as the base of `withEventShaCheck` and for the behavioural tests (code review §1) | **Closed** |
| PR59-SEC-01 item 2, workflow half | `ci.yml:123`, `:512` | V2 bash probe, table below; `lane-scope.mjs:1111` `checkoutProblem` stays as the second line of defence on the runner | **Closed** |
| PR55-SEC-05, workflow half | `ci.yml:628-631`; main `lane-scope.mjs` `gateInputStage2FromEnv` | Rule (g) probe: equal values give no reason; a differing `tools_ref`, a differing `security_integration_due` or an empty `mode` give `fast-lane outputs mismatch (...)`, identical under the merge base and the head | **Closed** (absent entries are still tolerated by the tool: PR287B-SEC-01) |
| Run-full narrowed (code review R1-m1 of PR #62) | `lane-scope.mjs:722-726`, `:779`, `:799-823` | Lookup probe; see "Run-full" below | Fail-closed, bounded; no security finding |

**V2 in real bash** (head module constants; repository with base A, PR commit B, main commit C, attacker commit D; M = merge of B into C, X = merge of B into D):

| Script | Checkout M, `GITHUB_SHA`=M | Checkout X, `GITHUB_SHA`=M | `GITHUB_SHA`=C | unset | empty | abbreviated | upper-case |
|---|---|---|---|---|---|---|---|
| fast-lane V2 | exit 0, 10 env lines, `TOOLS_REF`=C | **exit 1**, 0 lines | exit 1, 0 | exit 1, 0 | exit 1, 0 | exit 1, 0 | exit 1, 0 |
| fast-lane V1 (control) | exit 0, `TOOLS_REF`=C | exit 0, **`TOOLS_REF`=D** | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 |
| ci-gate V2 | exit 0, 7 env lines, `TOOLS_REF`=C | **exit 1**, 0 lines | exit 1, 0 | exit 1, 0 | exit 1, 0 | exit 1, 0 | exit 1, 0 |
| ci-gate V1 (control) | exit 0, `TOOLS_REF`=C | exit 0, **`TOOLS_REF`=D** | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 |

What V2 does and does not cover:
- **It removes the crafted-checkout path.** A checkout that is not GitHub's event commit can no longer reach the tested-base lines, and so cannot choose the tested base. This holds as long as the steps that run before the check (checkout and setup-node, pinned commits with exact `with:` maps) are what they claim to be.
- **It does not narrow PR62-SEC-01.** An action step whose `uses:` commit is swapped, or which gains `env:`, runs before the check. It can move `HEAD` and rewrite `.git` as easily as it can write files. That stays with the record-names-head rule and with 287-C.

**Run-full** (head against merge base; `T` = the tested base changed at 12:00; the head's API calls are shown, merge base in brackets):

| Scenario | head `voidedByBase` | merge base | Calls |
|---|---|---|---|
| One voided green run | true | true | 5 (4) |
| One voided run, red on a unit step / red on a scan | false / false | true / true | 5 (4) |
| Voided green + newer non-voided red | false | true | 5 (5) |
| Voided green + newer non-voided green | false (that run is the proof) | false | 5 (5) |
| Voided green, its jobs call fails | false (fail closed) | true | 5 (4) |
| Voided red (newer) + voided green (older) | true (newest first, moves on) | true | 6 (4) |
| Voided green of another head branch (unbound) | false | false | 4 (4) |
| No runs | false | false | 2 (2) |
| Runs listing of one identical SHA fails, voided green on the other | true | true | 5 (4) |
| 60 voided runs, green at #5 / #36 / #59 | true / false / false | true / true / true | 10 / **40** / **40** (4) |

- **Run-full cannot relax a gate.** `voidedByBase` only turns a light docs push into a full run, and `voidedByBase` under the head implies it under the merge base. A wrong `true` (for example after a failed runs listing) costs minutes only. A wrong `false` (a jobs-API error, or the cap) leaves the push light and `BLOCKED: no code proof`.
- **The two lane-scope instances stay consistent.** Both repeat the same calls on completed runs. A divergence between them, such as a re-run of a voided run between classify and ci-gate, or a transient API error in one of them, is a rule (g) mismatch: red, never green.
- **Re-runs cannot clear a voiding.** A re-run keeps the run's `created_at` and its old merge `GITHUB_SHA`, so re-running an old run never turns it into a fresh proof.
- **Cost items stay with the code review.** The code review's MINOR R1-m1 (a cancelled or light non-voided run suppresses run-full) and NIT R1-n1 (required-step renames make every voided run fail the check) are minutes and UX items. Both fail closed, so neither is a security finding.

## 4. Findings

### PR287B-SEC-01 (INFO): the gate tool still tolerates absent `FAST_LANE_*` entries

| Field | Value |
|---|---|
| Severity | INFO (defence in depth; not introduced by this PR) |
| CWE / OWASP | CWE-693 Protection Mechanism Failure; A08:2021 Software and Data Integrity Failures |
| Location | `tools/ci/lane-scope.mjs:1019-1023` (`gateInputStage2FromEnv`: `.filter(([, name]) => env[name] !== undefined)`), unchanged since 287-A |
| Description | PR62-SEC-02 asked for the four entries to be required. This PR makes them required in the **policy**, but the **gate** keeps 287-A's transitional tolerance: an entry absent from the env is not compared, and all four absent gives no reason at all (probe: "all four absent", "one absent", identical at merge base and head) |
| Exploitability / impact | Not reachable through a policy-conforming `ci.yml`. A `ci.yml` that drops an entry is a `required-gates` finding under the tested-base policy after this merge, so fast-lane is red and rule (a) blocks. Removing the entries and the policy step together needs a `ci.yml` PR, which is the ADR-0023 am. N item 3 residual held by the record-names-head rule. The value of the hardening is that the tool no longer depends on a different file's policy to require its own inputs |
| Remediation | In 287-C, or any later `tools/ci` PR after this one is on main (the tested base then carries the entries for every PR): in `gateInputStage2FromEnv`, map each `FAST_LANE_OUTPUT_ENV` name to `get(name)` without the `!== undefined` filter, and in `gateVerdictStage2` add the reason `fast-lane outputs missing (<keys>)` when a key is absent from the input |
| Verification | A `lane-scope-stage-2.test.ts` row: an env without `FAST_LANE_CODE_PROOF` gives BLOCKED with `fast-lane outputs missing (code_proof)`; the committed `ci.yml` stays MERGE-READY in the existing end-to-end rows |
| Owner | devops-engineer, with 287-C |

### PR287B-SEC-02 (INFO): the stage-2 job shape is a deny-list; `runs-on` is not pinned

| Field | Value |
|---|---|
| Severity | INFO (pre-existing; same residual class as PR62-SEC-01) |
| CWE / OWASP | CWE-693; A08:2021 |
| Location | `tools/ci/check-workflow-policy.mjs:1877-1883` (the "pinned job shape" loop refuses `defaults`, `container`, `services`, `strategy` and `continue-on-error` on fast-lane, security-integration and ci-gate) |
| Description | `runs-on` and `environment` of the three stage-2 jobs are not checked. Under both the merge-base and the head policy, `runs-on: self-hosted`, `[self-hosted, linux]`, `ubuntu-22.04` or an expression is accepted for each job (12 of 12 mutants). Job containers and services are refused, including digest-pinned ones (9 of 9) |
| Exploitability / impact | Only a PR that edits `ci.yml` can use it. Today it fails closed: the repository has no self-hosted runner, so a job routed to one stays queued and ci-gate never succeeds. It becomes a real lever the day a persistent self-hosted runner is registered: head code of one job could leave tool-cache, git or `PATH` state for a later ci-gate on the same machine. An allow-list is cheap and removes the dependency on that fact |
| Remediation | In 287-C, together with PR62-SEC-01's exact action-step key set: an exact job key set for the three jobs, and `runs-on: ubuntu-24.04` exactly. Until then, the record of any PR that changes a stage-2 job's `runs-on` or adds `environment:` says why (extends D-SEC-PR62-01's interim checks; this PR changes neither) |
| Verification | `ci-policy-stage-2.test.ts` rows: `runs-on: self-hosted` on each of the three jobs is a `required-gates` finding; the committed `ci.yml` passes |
| Owner | devops-engineer, with 287-C |

No other finding. Items I looked at and did not raise:
- the CR or trailing-blank variants of the V2 line: YAML line breaks, or a bash syntax error that fails closed;
- the 213 deletions and 36 duplications accepted by both policies: comments, blank-equivalent lines and pre-existing acceptances, none weaker at the head;
- the extra jobs calls: same read token, same cap;
- the note texts: escaped into the summary, never printed as workflow commands.

## 5. Interim rule, injection and token checklist

| Check | Result |
|---|---|
| D-SEC-PR62-01: any `uses:` commit changed in any workflow | No. 8/18/4 action steps in `ci.yml`/`lane-c.yml`/`nightly.yml`, identical `uses`, key set and `with:` |
| D-SEC-PR62-01: any action step gained `env:` | No. Positive control: a planted `env:` on a checkout step is detected. The only action step with an extra key at both base and head is the pre-existing Prisma engine cache step with `if:` |
| Step env changes | One: the aggregation `run:` step gains the four `FAST_LANE_*` entries |
| Permissions, triggers, workflow env, job env/`if`/`needs`/`outputs` | Unchanged in all three workflows |
| `${{ }}` inside `run:` | 0 at base, 0 at head (36 `run:` steps); a planted one is counted |
| Values reaching a shell | None new. The four values are env of `node "${GATE_LANE_SCOPE:?}" --gate`; the V2 lines read only `git rev-parse HEAD` and the runner's `GITHUB_SHA` |
| Token | `GH_TOKEN` still only on the classify, lane-scope and aggregation steps. Job permissions unchanged. The new jobs calls run within `MAX_API_CALLS` (40) per lookup |
| Secrets in the change | Gitleaks hint 0 of 224 added lines (controls fire) |

## 6. Code review twin (on main, `3ad2495`)

APPROVED_WITH_NITS. My differential reproduces its policy result (head strictly stronger, 6 designed findings on the merge-base `ci.yml`) and its lookup table. My scenarios match its cases A, B, C, F, G and I, plus a failed runs listing, an unbound run and the 60-run cap. Security view of its items:

- **R1-m1 (MINOR) and R1-n1 (NIT):** cost and UX, fail closed; no security finding. If R1-m1's fix lands in this cycle, it must keep "only adds conjuncts" (a candidate counts as `nonVoidedSeen` only on a code-step or scan failure), and any change to `tools/ci/**` after `06f62ac` needs a delta security round.
- **R1-n2 (untested `lintControls` in the voided check; surviving mutant):** `lintControls → false` there can only turn `false` into `true`, that is light into full. Not a gate removal; the test is a good addition.
- **R1-n3..n5:** documentation and decision-log items, no security content.
- **Docs.** `CI-CD.md` §5 now states the PR62-SEC-01 residual and the interim record checks correctly. One wording point: it says "a security record **on the branch**". ci-gate's checker reads the test merge, so a record committed on main counts too, as here (D-ORCH-133/134 practice). Fix the wording at the next `CI-CD.md` edit (287-C); no finding.

## 7. Record binding and simulation

The checker (main's `tools/ci/check-security-owned-paths.mjs`, unchanged by this PR) reads records from the checked-out test merge. The record therefore counts once two things hold: it is on main under its `PR-<NNNN>-` name, and a `pull_request` event after that rename builds the merge ref. It binds through the single `Head` row (the full `06f62ac` SHA, a commit in `<base>..<head>`). The evidence-only commit changes no owned path (lane B runs under `docs/05-quality/tests/runs/` are not in CODEOWNERS), so rule (d) holds for the tip.

Simulation (`s287b/probes/sim.mjs`; `git clone --shared` of the main repository, sparse `/.github/ /docs/05-quality/security/ /tools/ci/`; scenario commits by plumbing; main = `3ad2495` plus a record commit; test merge = `merge-tree` of that with the PR tip; the checker taken from the merge's tree, `--pr 68` as a stand-in number): see the table below.

| Scenario | Base given to the checker | Head | Result | Expected |
|---|---|---|---|---|
| S1 record on main under `PR-0068-…`, evidence tip | merge base `36bc841` | evidence tip | exit 0, pass | pass |
| S2 same | main + record | evidence tip | exit 0, pass | pass |
| S3 same | main before the record | evidence tip | exit 0, pass | pass |
| S4 same, code commit pushed alone | merge base | `06f62ac` | exit 0, pass | pass |
| C1 record only under the placeholder name `PR-pending-…` | merge base | evidence tip | exit 1, missing | fail |
| C2 no record | merge base | evidence tip | exit 1, missing | fail |
| C3 a later `FAIL` verdict row appended | merge base | evidence tip | exit 1, missing | fail |
| C4 the `Head` row names the merge base instead | merge base | evidence tip | exit 1, missing | fail |
| C5 a `tools/ci/lane-scope.mjs` change after the reviewed head | merge base | that commit | exit 1, missing | fail |
| C6 a `ci.yml` change after the reviewed head | merge base | that commit | exit 1, missing | fail |
| C7 the record named for another PR number | merge base | evidence tip | exit 1, missing | fail |

11 of 11 as expected. The record has exactly one `Head` row, no `Branch / head` row and one `Verdict` row (the last table row of the file).

## 8. Merge conditions and routes

1. **Rename, then the event.** Push `06f62ac` and the evidence-only commit as they are, as one code push (O3). Rename this record to `PR-<NNNN>-TASK-287B-security-review.md` on main before the `pull_request` event whose ci-gate must pass. Cheapest order: open the PR as a draft (fast-lane is skipped for drafts), commit the rename on main, then mark the PR ready for review; the `ready_for_review` event runs the full lane once with the renamed record in the merge ref. If the PR is opened ready, the first run's record step is red, and a close/reopen after the rename gives the passing run (D-ORCH-135).
2. **Lane A.** The full lane A run must be green in every step, with ci-gate MERGE-READY. That run is judged by main's 287-A tooling. The first run after the merge is the first live run of the V2-only policy and the required entries for every open PR. A red result from either the V2 check or the `FAST_LANE_*` compare is fail-closed: revert, never bypass (D-SEC-PR62-01).
3. **Lane B.** A lane-B `pr` run on `06f62ac` is the evidence-only commit (the new Jest rows were not run in either review).
4. **Delta round.** Any change to `.github/workflows/**` or `tools/ci/**` after `06f62ac`, including an R1-m1 fix in this cycle, needs a delta security round and a new `Head` row (rule (d) voids this record otherwise).
5. **Routes.** PR287B-SEC-01 and PR287B-SEC-02 go to devops-engineer with 287-C, policy first, next to PR62-SEC-01. Until 287-C, the interim record checks of D-SEC-PR62-01 also cover `runs-on`/`environment` changes of the three stage-2 jobs (D-SECPR287B-01).
6. **After the merge:** PR59-SEC-01 (all three items), PR55-SEC-05 and PR62-SEC-02 are closed. PR62-SEC-01 stays open (LOW, 287-C).

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium, 0 Low; PR287B-SEC-01 and PR287B-SEC-02 INFO (287-C). PR62-SEC-02, PR59-SEC-01 item 2 (workflow half) and PR55-SEC-05 (workflow half) closed |
