# PR-0062: TASK-287 part 287-A (policy PR: action-input pins, event-commit check, stage-1 retirement, PR55-SEC-05, trigger list), security review

| Field | Value |
|---|---|
| PR | #62, https://github.com/sukhchdit/shipcube/pull/62, branch `ci/TASK-287A-policy`. Merge base `d173d8f`. Pushed head `1c4dc00` (lane B evidence `20261117T1405Z_a85234a` on top of `c71c028`, `507df83`, `0e5323d`, `a85234a`). Two local commits are to be pushed as they are after both reviews: the code commit `5d86412` (test only: the bootstrap classify child of `lane-scope-stage-2.test.ts` gets `GITHUB_ACTIONS=true` and the fixture's merge as `GITHUB_SHA`) and the evidence commit `77ff897` (`docs/05-quality/tests/runs/20261118T1308Z_5d86412/` only). No `.github/workflows/**` file changes |
| Head | 5d86412917e1cc49a29f891352523df96e79fede |
| Tip to push | `77ff897` (evidence only, after the reviewed code commit; main's checker accepts it, section 6) |
| Lane A evidence | Run 44103020178 on `1c4dc00` (2026-11-17, `pull_request`). fast-lane: red only at "Unit tests", the runner-only gap that `5d86412` fixes (the runner's `GITHUB_ACTIONS`/`GITHUB_SHA` reached a spawned lane-scope CLI); workflow policy, install flags, lockfile, cooldown, licences, signatures, audit, lint, format, actionlint and type-check green. ci-gate: Gitleaks, Semgrep and oasdiff green; the record step red (no record). No run exists on `5d86412`/`77ff897` yet. Under the tested-base rule this PR's own `tools/ci` is not what lane A runs on this PR: its first live use is the first lane A run after the merge |
| Lane B evidence | `20261118T1308Z_5d86412`, profile `pr`, PASS: unit 6,681 (2 skipped), merged coverage 99.06 % lines / 97.17 % branches (the previous code head `a85234a`: `20261117T1405Z_a85234a` PASS) |
| Owned paths changed | 17, all under `tools/ci/`: `check-workflow-policy.mjs` (+ `.test.ts`), `lane-scope.mjs` (+ `lane-scope.test.ts`, `lane-scope-stage-2.test.ts`), `security-paths.mjs` (+ `.test.ts`), `ci-policy.test.ts`, `ci-policy-stage-2.test.ts`, the deleted `fixtures/stage-1/ci.yml`, and 7 files under `fixtures/workflow-policy/` (2 deleted, 5 edited) |
| Unowned paths changed | `docs/07-ops/CI-CD.md`, `docs/04-plan/spikes/SPK-07.md` and the 8 lane B evidence files of the two runs, all read |
| Binding items checked | The TASK-287 card (WAVE-00 batch 0.12): PART ORDER, PR59-SEC-01 (1)-(3), STAGE-1 RETIREMENT with PR55-SEC-05 and the OPTIONAL run-full line, SECURITY-INTEGRATION TRIGGER LIST, CACHE HYGIENE. ADR-0023 amendment L items 1-3 and 6, amendment M items 2 and 5, amendment N items 1-5. D-ARCH-126..128, D-ARCH-139, D-ARCH-140, D-SEC-PR59-01, D-ORCH-116, D-TASK286-01a/-06a, D-SEC-PR57-01/-02. There are no `D-TASK287A-*` entries on main (code review R1-n5). The code review r1 on main (`d76ac9e`, APPROVED_WITH_NITS) |
| Reviewer / date | security-analyst, 2026-11-18, round 1. Static review plus single-process Node probes on `git archive` extracts of `tools/ci`, `tools/quality` and `.github` at `5d86412`, at the merge base `d173d8f` and at `origin/main`. Host rule: no npm, Jest, type-check, build or Docker. Nothing ran in the PR's evidence worktree and nothing was written there; git object reads, `gh` and `curl` ran from the main checkout. How the runner passes action inputs comes from the `actions/runner` source (`ActionManifestManager.cs`, `Handlers/Handler.cs`): read, not executed. Line numbers come from single-file reads at `5d86412` |

## 1. Summary

The question of this round: does the policy PR close PR59-SEC-01's checkout and setup-node levers and retire stage 1 without weakening any gate, do the classifier and the proof lookups stay fail-closed, and is the widened trigger list right?

- **No gate is weakened.** A differential run of the merge-base policy and the head policy over 895 mutants of the live `ci.yml` (line deletions, `with:` additions and edits, step env, `uses:` changes, permissions, token placement, triggers, new jobs and steps) finds no mutant that the base refuses and the head accepts, apart from the 8 designed acceptances: the V2 tooling scripts (3 placements) and the four `FAST_LANE_*` aggregation entries with their exact values (5). `lane-c.yml` and `nightly.yml` give 0 findings under both.
- **PR59-SEC-01 item 1 is closed.** Every `with:` key that can move the tree or what the pinned steps read is now a `required-gates` finding on every action step of the three jobs: 136 of 136 key additions (`ref`, `repository`, `path`, `submodules`, `token`, `ssh-key`, `sparse-checkout`, `filter`, `clean`, `fetch-tags`, `set-safe-directory`, `lfs`, `github-server-url`, `restore-keys`, `check-latest`, `registry-url`, `always-auth`), 99 of 102 value edits (the 3 accepted are `persist-credentials: "false"`, the same value quoted), 8 of 8 dropped maps and 8 of 8 duplicate keys. The merge-base policy refused 2 of the 136.
- **PR59-SEC-01 item 2: the policy half is in place, the workflow half is 287-B.** The policy accepts the tooling scripts as V1 or exactly V2; 7 weakened V2 variants are refused (`exit 0`, `=` for `!=`, `$RANGE_HEAD` or `HEAD^2` for the event commit, a neutered line, a guard in front, a checkout after it). `lane-scope.mjs` itself now exits 2 on a runner when `HEAD` is not `GITHUB_SHA`, in classify and `--gate` mode, from the first run after the merge.
- **Stage 1 is retired (PR55-SEC-10 closed; PR55-SEC-11 item 3 ends with it).** The stage-1 fixture that the merge-base policy accepts with 0 findings gives 43 findings under the head, among them "ci.yml must not have a scans job". A stage-1 run cannot be a code proof, because its scans are not steps of `ci-gate` (fail closed). The classify call without `--tools-ref` exits 2.
- **PR55-SEC-05: the policy half is in place.** The aggregation step may carry the four `FAST_LANE_*` entries, each only with its exact `needs.fast-lane.outputs.*` value (14 wrong-value, wrong-step and extra-name mutants refused). The gate compares each one present with its own classification; a differing `tools_ref` or an empty `mode` gives BLOCKED.
- **PR57-SEC-02 is closed in tooling** (effective for the PRs after the merge, base-ref rule). The 17-entry list matches the card's corpus and an independent oracle (`tools/quality/lib/manifest.mjs` `globsMatch`) on 41 paths. Over the tree at `9874f6d`, 40 files newly select and none stops selecting, and every file the negations exclude under the new roots is a `*.test.ts` file or a `tools/db/fixtures/**` file.
- **The proof lookups stay fail-closed.** An unreadable tested-base history, a failed binding or an unbound run gives no proof and no run-full. Run-full fires more widely than documented (code review R1-m1), which costs minutes but never removes a gate: the full run is held by rule (b).
- **Residual of the PR59-SEC-01 class (PR62-SEC-01, LOW).** The `with:` pin does not cover the action steps' own `env:`, or which commit `uses:` names. Both are open for a PR that edits `ci.yml`, as the code review noted (R1-n2, section 6 n2). Ruling and fix in section 4.

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 2 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `d173d8f...5d86412` (23 paths) and both evidence commits; read at `5d86412` in full the new and changed parts of `check-workflow-policy.mjs` (constants, `stage2Findings`, `requiredGateFindings`, `tokenFindings`, `envEntryFindings`), `lane-scope.mjs` (`checkoutProblem`, `parseArgs`, `main`, `lookupProofs`, `proofBinding`, `gateVerdictStage2`, `gateInputStage2FromEnv`) and `security-paths.mjs`; the live `ci.yml` (unchanged since the merge base, identical at the head and on `main`); the code review on main.
2. **Policy differential** (`probes/diff-policy.mjs`, `probes/diff-add.mjs`): the merge-base and head copies of `check-workflow-policy.mjs` side by side, `checkWorkflow(text, 'ci.yml', { requiredGates: true })` over 895 mutants of the live `ci.yml`; every mutant classified as both refuse, tightened, weakened or both accept. Positive controls: the live file (0 and 0), the stage-1 fixture (0 and 43).
3. **Lane-scope behaviour** (`probes/lane-probe.mjs`): `lookupProofs` over a fake jobs API (bound and unbound runs, voided and non-voided, red jobs, an unreadable base history), `gateVerdictStage2` and `gateInputStage2FromEnv` with the separate outputs, `checkoutProblem` and `main()` on a scratch git repository with runner and non-runner environments, head against merge base.
4. **Trigger list** (`probes/paths-probe.mjs`): head, merge base and the manifest matcher over a 41-path corpus and over every tracked file at `9874f6d`. Imports of the two active security suites (`rls-cross-tenant`, `catalog-c1-c14`) read with `git grep`.
5. **Runner input semantics.** `ActionManifestManager.cs` gives every declared input without a default an empty-string default, and `Handler.AddInputsToEnvironment` writes `INPUT_<NAME>` for every input after the step env. So an `INPUT_REF` in a checkout step's `env:` is overwritten and cannot replace the pinned `with:` (read, not executed).
6. **Gitleaks hint** over the 24,138 added lines of `d173d8f..77ff897`: the full `generic-api-key` emulation of the pinned v8.30.1 config (entropy, allowlists, stopwords) gives 0 findings, with its runtime positive control firing. The over-approximating 220-rule scan (no entropy, no allowlists) flags 51 candidate lines, all of them removed by the full emulation. Lane A's Gitleaks decides.
7. **Record simulation** with main's checker (section 6).

## 3. What the PR closes, and how it was checked

| Item | Where (at `5d86412`) | Result |
|---|---|---|
| PR59-SEC-01 (1) `with:` pins | `check-workflow-policy.mjs:564` `STAGE_2_ACTION_INPUTS`; the loop in `stage2Findings` `:1928-1958` | **Closed.** 136/136 key additions, 99/102 edits (the 3 equivalent), 8/8 drops and 8/8 duplicates refused; `Actions/Checkout` and a subpath action refused |
| PR59-SEC-01 (2) policy half | `:442` `CHECKOUT_IS_EVENT_SHA`, `:541` `pinnedScriptAlternativesProblems`; `lane-scope.mjs:1074` `checkoutProblem`, called at `:1100` before classify and `--gate` | **In place.** V1 or exact V2 only; 7 weakened V2 variants refused. On a scratch repository with runner variables and `HEAD` not `GITHUB_SHA`, the head exits 2 in classify and in `--gate` mode before anything else is read; the merge base has no such check (its `--gate` exits 1 on the empty environment). Workflow half: 287-B |
| PR59-SEC-01 (3) record names the head | merge checklist | Standing (am. N item 3 (c)). This record names the code head |
| PR55-SEC-10 stage-1 retirement | `:1862` retired `scans` job; `lane-scope.mjs:1051` `--tools-ref` required | **Closed.** Stage-1 fixture: 0 findings at the merge base, 43 at the head |
| PR55-SEC-11 item 3 (stage-1 scans masking) | retirement | **Ends** with stage 1 |
| PR55-SEC-05 policy half | `:603` `CI_GATE_ENV_FAST_LANE_OUTPUTS`, `:1001` `envOptional`, `:1782` exact-value check; `lane-scope.mjs:919` rule (g), `:982` env read | **In place.** Present and equal: MERGE-READY; `tools_ref` differs or `mode` empty: BLOCKED. Absent (live `ci.yml`): no extra compare until 287-B |
| D-TASK286-06a run-full | `lane-scope.mjs:761`, `:786`, `:1182` | Takes effect, fail-safe direction. Fires more widely than the docs say (R1-m1, section 5) |
| PR57-SEC-02 trigger list | `security-paths.mjs:57-66` | **Closed** (effective after the merge). Corpus and tree checks above |
| PR46-SEC-08 | the `tests/generated` roots | The two `tests/generated` roots are added. `.npmrc` and `apps/worker/src/platform/**` stay open; not ruled in this round |
| D-SEC-PR57-02 cache hygiene | none | No cache is introduced or keyed here; stays a 287-C line |

## 4. Findings

### PR62-SEC-01 (LOW): the action steps of the three pinned jobs still take any step `env:` and any 40-hex `uses:` commit

| Field | Value |
|---|---|
| Severity | LOW (impact Medium: a gate verdict of the PR's choosing in `ci-gate`, read-only token; likelihood Low: needs a PR that edits `ci.yml`, a review miss and a record that names a head carrying the edit) |
| CWE | CWE-829 (inclusion of functionality from an untrusted control sphere), CWE-693 (protection mechanism failure) |
| OWASP | A08:2021 Software and Data Integrity Failures |
| Location | `tools/ci/check-workflow-policy.mjs:1928-1958` (the loop checks `uses` and `with` only); `:1034` `PINNED_USES` (any 40-hex commit); `docs/07-ops/CI-CD.md:162` ("so no input can choose the tree, and so the tested base") |

**Description.** PR59-SEC-01 asked for the inputs that let a `ci.yml` edit change what the pinned steps read. The `with:` map is now exact, but two neighbouring levers of the same class are not pinned. Under both the merge-base and the head policy, these pass on every checkout, setup-node and cache step of `fast-lane`, `security-integration` and `ci-gate`:

1. **A step `env:` map.** Names outside the deny-lists pass: `GIT_TEMPLATE_DIR`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_DIR`, `GIT_EXEC_PATH`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY`/`https_proxy`/`ALL_PROXY`, `SSL_CERT_FILE`, `GIT_SSL_NO_VERIFY`, `GIT_SSL_CAINFO`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, `ACTIONS_RUNNER_DEBUG` (`PATH`, `XDG_CONFIG_HOME`, `GIT_CONFIG_COUNT`, `GITHUB_*`, `RUNNER_*` and `NODE_TLS_REJECT_UNAUTHORIZED` are refused). `INPUT_*` names also pass the policy but are harmless: the runner overwrites every declared input (method item 5). `if:` on these steps also passes; skipping a checkout or setup-node fails closed.
2. **The action's commit.** `uses:` must be `owner/repo@<40 hex>`, but any 40-hex commit passes. A different genuine release of `actions/checkout` with the pinned inputs still checks out `GITHUB_SHA`. A commit in the action's fork network, which GitHub resolves under the upstream name, is arbitrary code under that name. GitHub's hardening guide warns about this ("verify it is from the action's repository and not a repository fork"); it was not re-verified on this host.

**Exploitability and impact.** Only a PR that edits `ci.yml` can use either lever, because it runs its own workflow. In `ci-gate`, the no-head-code job with `actions: read` and `pull-requests: read`, setup-node runs after the checkout, so a step `env:` can point at files the PR just checked out. Example: `NODE_EXTRA_CA_CERTS` on a PR file plus a proxy would swap the Node binary whenever setup-node downloads instead of using the tool cache (not verified). An action commit from the fork network can write `$GITHUB_ENV` and `$GITHUB_PATH`, and so steer every later `ci-gate` step: the gate verdict becomes the PR's choice, and the token step is reached. This is the residual that ADR-0023 am. N item 3 states ("a PR that edits `ci.yml` controls its own workflow; the record on the exact head is the control"). So this is not a new exposure. But the `with:` pin is now advertised as "no input can choose the tree" (`CI-CD.md:162`, the PR body), and these two levers remain cheap to pin in the same tested-base loop. The same holds for `checkoutProblem`: it fails closed for a checkout that lands on a genuine `main` commit carrying 287-A's tooling. A checkout that lands on a crafted merge, whose first parent is a pushed commit with older or edited `tools/ci` descending from the event base, runs that commit's tooling, policy included. No tested-base pin can stop that case (code review §6).

**Ruling (code review R1-n2 and §6 n2 asked for it).** The am. N item 3 residual plus the standing record-names-head line remains the control for crafted bases. The two levers above are pinned policy first, as follows.

**Remediation (devops-engineer, the 287-C policy PR, or 287-B if it carries a policy change; before any PR that changes a `uses:` line of `ci.yml` merges, Dependabot actions bumps included):**

```js
// check-workflow-policy.mjs, in the PR59-SEC-01 loop of stage2Findings, per action step of the three jobs:
const ACTION_STEP_KEYS = new Set(['name', 'uses', 'with']); // add 'id' only where a pinned step needs one
for (const key of Object.keys(step)) {
  if (!ACTION_STEP_KEYS.has(key)) add(`ci.yml ${jobId} ${action} step may not set ${key} (PR62-SEC-01)`, [...]);
}
// and the commit of each action, exact (a Dependabot bump becomes a one-line tested-base change first):
export const STAGE_2_ACTION_COMMITS = Object.freeze({
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1',   // v7.0.1
  'actions/setup-node': '949feb2413d6458794dcd2491c4babbbce0c15c1', // v7.1.0
  'actions/cache': '55cc8345863c7cc4c66a329aec7e433d2d1c52a9',      // v6.1.0
});
if (uses.split('@')[1]?.split(/\s/)[0] !== STAGE_2_ACTION_COMMITS[action]) add(`... must be ${action}@<pinned commit> (PR62-SEC-01)`, [...]);
```

Restate the residual in `CI-CD.md` section 5 and in the PR body wording. **Until the pin lands,** the record of any PR that changes a `uses:` line in `ci.yml` checks that the new commit is the upstream tag's commit (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, peeling an annotated tag), and that no action step gained `env:`.

**Verification test.** In `ci-policy-stage-2.test.ts`, as `required-gates` findings, with the live `ci.yml` still at 0:
- `env:` with `GIT_DIR`, `NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY` and `ACTIONS_ALLOW_UNSECURE_COMMANDS` on each action step of the three jobs;
- `if: false` on each of those steps;
- another 40-hex commit for each action.

Mutation: drop the key-set check, and drop the commit check.

### PR62-SEC-02 (INFO): the two transitional acceptances must end with 287-B

| Field | Value |
|---|---|
| Severity | INFO |
| CWE | CWE-693 |
| OWASP | A08:2021 |
| Location | `check-workflow-policy.mjs:541`, `:792` and `:950` (V1 or V2), `:1001` (`envOptional`) |

**Description.** Policy first, the head accepts the tooling scripts as V1 or V2 and the four `FAST_LANE_*` aggregation entries as present or absent. Once 287-B puts V2 and the four entries into `ci.yml`, both acceptances become a silent off switch. A later `ci.yml` PR could go back to V1 or drop the entries, and the tested-base policy would still pass it. The effect is small, because `checkoutProblem` stays in tested-base tooling and rule (g) already compares the whole classification string, which carries the same four values. Still, the bash check (independent of `GITHUB_ACTIONS`) and the separate-output compare would go unnoticed.

**Remediation.** Make this a condition on 287-B. The policy change that follows the workflow switch, in 287-B itself or the 287-C policy PR, before any other `ci.yml` PR merges:
- accepts only `FAST_LANE_TOOLING_SCRIPT_V2` and `CI_GATE_TOOLING_SCRIPT_TESTED_BASE_V2`;
- moves `CI_GATE_ENV_FAST_LANE_OUTPUTS` into the required `CI_GATE_ENV_TESTED_BASE`.

**Verification.** A V1 tooling script and an aggregation step without one of the four entries are `required-gates` findings.

### PR62-SEC-03 (INFO): the active security suites import code outside the trigger list

| Field | Value |
|---|---|
| Severity | INFO |
| CWE | CWE-1357 (reliance on insufficiently trustworthy component), as a coverage gap of a selection rule |
| OWASP | A04:2021 Insecure Design |
| Location | `tests/generated/api-mounts.ts:11-12, :20`; `tests/generated/rls/cross-tenant.int.test.ts:30, :34-35`; `prisma/tests/catalog/c01-c12.int.test.ts:26` |

**Description.** The list implements am. N item 1 exactly. Beyond the listed roots, `rls-cross-tenant` and `catalog-c1-c14` import and exercise:
- `apps/api/src/app.ts` (`createApp`, the mount order);
- `apps/api/src/modules/index.generated.ts` (the module registry, and through it every module's routes);
- `tools/openapi/contract.ts` (`OPENAPI_PATH`);
- `tools/authz/generate.ts` (`SEED_SOURCE`);
- `@platform/shared`.

A PR that changes only these paths changes what the suites prove, and the hosted job is not selected. Example: a new module route, or a mount outside the platform pipeline, that leaks across tenants. Lane B still runs both suites on its evidence, and the am. N (d) residual covers deliberate weakening.

**Remediation (principal-architect, next fold or the next suite activation).** Either extend the activation rule (a) to "roots plus their non-test imports outside the listed groups", or add `apps/api/src/app.ts`, `apps/api/src/modules/**`, `tools/authz/generate.ts` and `tools/openapi/contract.ts`. The minutes cost goes to the D-ORCH-117 re-forecast. No change to this PR.

## 5. GitHub Actions supply-chain checklist, and the code review's items

| Concern | Result |
|---|---|
| Action pins | Rule unchanged: `owner/repo@<40 hex>` plus a tag comment; tags, `Actions/` case and subpaths refused. The commit is not pinned (PR62-SEC-01) |
| Permissions, least privilege | `ACTIONS_READ_JOBS` and `PULL_REQUESTS_READ_JOBS` are now the stage-2 constants (`fast-lane`, `ci-gate`). 21 permission additions (`actions`, `pull-requests`, `contents: write`, `id-token: write`, `checks`, `statuses`, `packages`) on the three jobs, and a new job with `actions: read`: refused by both policies |
| Token scope per step | The stage-2 `tokenFindings` branch is unchanged. `GH_TOKEN` or `GITHUB_TOKEN` on 6 other steps: refused by both |
| `pull_request` vs `pull_request_target` | `pull_request_target`, `workflow_run`, `merge_group` and `workflow_dispatch` on `ci.yml`: refused by both |
| Untrusted input in `run:` | No new `${{ }}` in any pinned `run:`. The V2 lines read `$GITHUB_SHA` from the runner environment (`GITHUB_*` in any env map is `reserved-env`). The four new aggregation entries are env values produced by tested-base tooling. A `github.event.pull_request.title` expression in a `run:`: refused by both |
| Cache poisoning | `actions/cache` is now held to its exact `path` and `key`: no `restore-keys` prefix, no widened path. setup-node `cache: npm` is exact and keyed on the lockfile. Cache writes from PR runs stay in the PR's own scope. A new `ci.yml` job using `actions/cache` passes both policies (unchanged; PR scope only, and head code already runs in that PR's jobs). The test-lock exclusion stays with 287-C |
| Artifact trust | No artifact upload or download added; no gate consumes an artifact |
| `checkoutProblem` detection | It checks only when `GITHUB_ACTIONS` is exactly `true` (`TRUE` or absent: no check). The runner sets `true`, and no workflow env may set `GITHUB_*`. The 287-B bash line does not depend on it. No action |
| Code review R1-m1 (run-full wider than documented) | Agreed. Probe: voided-only gives `true`; voided plus a newer red run gives `true`; red-only gives `false`; unbound, no runs or an unreadable base history give `false`. It is a minutes defect, never a gate removal: rule (b) holds a full run, and (g) holds both instances. No security finding; the fix form there is fine from a security view |
| Code review R1-m2 (push-event gate case lost) | Agreed. The push-event rules are dormant while `CI_MAIN_FAST_LANE` is not `true`, and the surviving mutant (dropping `pr &&` from (e)) fails closed (BLOCKED). No security finding |
| Code review R1-n2, §6 | Ruled in PR62-SEC-01 |

## 6. P1 overlap with main, and the record simulation

**P1.** Since the merge base `d173d8f`, `main` merged #57 (`7db21b7`), #60 (`96c2c7a`), #67 (`591d0f5`), #66 (`9874f6d`), #64 (`b9bd6e3`) and #63 (`783522a`), plus docs. When this round was written, `main` was at `dbd2bb7`.
- `comm -12` of the two changed-file sets is empty, and `git merge-tree --write-tree origin/main 77ff897` is clean (tree `01a02e8`).
- On `main`, `tools/ci` changed only in #67's `advisory-watchlist.json` and `check-audit.test.ts`; `.github` did not change. The PR's pins therefore match the live `ci.yml` (0 findings under the head policy), and the picomatch waiver that the audit step needs reaches this PR through the tested base, `HEAD^1` = `main`.
- Main also changed lane A inputs (`eslint.config.mjs`, `jest.config.ts`, `tools/test-support`, `tools/lint`, `tests/fixtures/lint`, `package-lock.json`). The push `1c4dc00..77ff897` contains code (`5d86412`), so it runs the full lane on the merge ref against current `main`; no proof is inherited.
- `security-integration` is not selected for this PR: neither the merge-base list nor the new list holds `tools/ci/**`.

**Record simulation.** Main's `check-security-owned-paths.mjs` ran on simulated merge refs, built with plumbing in a shared scratch clone. In each scenario this record was committed on a copy of `main` at `dbd2bb7`, the merge was built with `git merge-tree` and `commit-tree -p`, and the checker ran with `--pr 62 --head <PR tip>`. Results are in the table below.

| Scenario | `--base` | `--head` | Expected | Result |
|---|---|---|---|---|
| S1 record on main, synchronize event (base = merge base) | `d173d8f` | `77ff897` | pass | pass (exit 0, 17 owned paths) |
| S2 record on main, opened or reopened event (base = main tip with the record) | main + record | `77ff897` | pass | pass (exit 0, 17 owned paths) |
| S3 base = main tip before the record commit | `dbd2bb7` | `77ff897` | pass | pass (exit 0, 17 owned paths) |
| C1 no record | `d173d8f` | `77ff897` | fail | fail (exit 1, `missing`) |
| C2 last Verdict row FAIL | `d173d8f` | `77ff897` | fail | fail (exit 1, `missing`) |
| C3 Head row names a `main` commit | `d173d8f` | `77ff897` | fail | fail (exit 1, `missing`) |
| C4 an owned path (`tools/ci/lane-scope.mjs`) changed after the reviewed commit | `d173d8f` | tip + 1 | fail | fail (exit 1, `missing`) |
| C5 the currently pushed head `1c4dc00` (the reviewed commit is not in its range) | `d173d8f` | `1c4dc00` | fail | fail (exit 1, `missing`) |
| C6 the same record filed under another PR number | `d173d8f` | `77ff897` | fail | fail (exit 1, `missing`) |

## 7. Merge conditions and routes

1. Push `5d86412` and `77ff897` as they are, as one code push (D-ORCH-119 O3). The full lane A run at `77ff897` must be green in every step, with `ci-gate` MERGE-READY reading this record through the merge ref. Any later commit that changes `tools/ci/**` needs a delta round (the checker enforces it, C4).
2. The first lane A run of any PR after the merge is the first live run of this tooling: the orchestrator watches it. A red classify or lane-scope step with "not the event commit" or "--tools-ref is required" blocks every PR (fail closed); revert, never bypass.
3. 287-B next, before any other `.github/workflows/**` PR (D-ARCH-140): the V2 lines and the four `FAST_LANE_*` entries, its own record naming its code head (D-ORCH-116), and PR62-SEC-02.
4. After the merge the orchestrator re-runs `gen.mjs --write` (D-ARCH-139; TASK-015, TASK-034, TASK-211 and TASK-290 gain the line).
5. Routes:
   - PR62-SEC-01 → devops-engineer, 287-C policy PR, and the interim record check before any `uses:` change;
   - PR62-SEC-02 → devops-engineer, with 287-B;
   - PR62-SEC-03 → principal-architect;
   - PR59-SEC-01 stays open until 287-B (item 1 closed, item 2 policy half in place);
   - PR55-SEC-05 → 287-B (workflow half);
   - code review R1-m1/m2 → devops-engineer, as the code review routes them.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium; PR62-SEC-01 LOW; PR62-SEC-02 and PR62-SEC-03 INFO. PR59-SEC-01 item 1, PR55-SEC-10 and PR57-SEC-02 closed |
