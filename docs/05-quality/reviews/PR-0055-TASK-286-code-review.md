# Code review: PR #55, TASK-286 `cigatefold` policy PR (stage-2 workflow policy, tested-base lane scope, devOptional rule), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `5645b9b` (full SHA `5645b9b0808c7983acb5cd1eaf9c08634a24a7ee`, branch `ci/TASK-286-cigatefold`); code head `71d2980` (`5645b9b` adds the lane B evidence directory only). Diff base: `git diff origin/main...5645b9b` (23 files; the workflow files are untouched, `.github/dependabot.yml` is the only `.github` change).

Specs checked against the code:
- TASK-286 card (`docs/04-plan/tasks/WAVE-00.md` §TASK-286: files, acceptance lines for D-ARCH-128, PR46-SEC-11, -12, -15, -16, -17, PR42-SEC-18, D-ARCH-133);
- D-ARCH-128, D-ARCH-132, D-ARCH-133, D-ORCH-078 (P1, P3), D-ORCH-100/101/102/103 in `docs/sdlc/DECISIONS.md`;
- `docs/03-architecture/rulings/wave-0-sheet-fold-8.md` items (4), (5), (7), (9) and §3 notes 3-5;
- the PR #46 security record (`PR-0046-TASK-015B-security-review.md`: X3, X4, PR46-SEC-12 deferral);
- the developer decisions D-TASK286-01..05 (DECISIONS.md on main, commit `369e38a`).

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The two-topology policy is careful work: stage 2 is pinned job by job (tooling, classify and aggregation steps
  exact, ci-gate made of exactly its steps, `${GATE_*:?}`, TOOLS_REF verified twice, rule (g)), the stage-1 X3/X4 pins
  land, devOptional is production closure, and 1142 tools/ci tests plus my mutants (see 1.2) back it. ONE MAJOR: the
  PR46-SEC-16 proof void set is narrower than the card ("no non-docs commit on main since the proof run, or an
  equivalent signal") and does not even cover P1 (b) (main changed a file the PR also changes); the deviation is not
  recorded. Four MINORs (two security flags: regex-pinned ci-gate scan steps; the token allowed on any fast-lane step
  that mentions lane-scope, including one after head code; plus the unpinned SEC-16 CLI wiring), six NITs.
```

## 1. What I verified myself (and what I did not)

### 1.1 Gates

| Check | Result |
|---|---|
| `npm run typecheck` in the PR worktree (Node 24.22.3) | exit 0 |
| `jest tools/ci --selectProjects unit` | 30 suites, **1142 / 1142** pass (53.7 s) |
| Prettier `--check` on the 18 changed non-evidence files | clean |
| Head `check-workflow-policy.mjs --root .` over the live `ci.yml`, `lane-c.yml`, `nightly.yml` | exit 0 (0 findings) |
| `tools/ci/fixtures/stage-2/ci.yml` vs `ci.yml` on `origin/ci/TASK-286-cigatefold-workflow` | byte-identical (the workflow PR installs exactly what this policy pins) |
| Lane A run 43805155599 on `5645b9b` (pull_request) | fast-lane **success** with every step executed (lint, format, typecheck, unit, build, evidence: success; no skips except the two LINT_CONTROLS steps); scans: every scan step success, only the record step fails; ci-gate fails on that; security-integration skipped (record missing) |
| Lane B evidence `20261116T0422Z_71d2980` | bound to the code head; base-ref `check-evidence` passed in that lane A run |
| Open PRs touching `.github/` or `tools/ci/` (`gh pr view <n> --json files` for #16, #49-#51, #54, #56) | none: no other PR's `ci.yml` meets the new stage-1 pins |

Not re-run: `npm run lint`, `npm run build`, the full unit suite and coverage. I rely on the fast-lane run above (exact head) and on the lane B evidence for those.

### 1.2 Mutation probes (scratch copy: `git archive HEAD` + `node_modules` junction + `git init`)

46 mutants of my own (`scratchpad/pr55/mut.mjs`; lane-scope rows run `lane-scope-stage-2.test.ts` + `lane-scope.test.ts`, security-paths rows `security-paths.test.ts` + `lane-scope-stage-2.test.ts`, policy rows `ci-policy-stage-2.test.ts` + `check-workflow-policy.test.ts` + `ci-policy.test.ts`). **36 killed, 10 survive** (3 equivalent or redundant: L27, P09, P14; 7 untested lines: L19, L20, L22, L24, L30, P10, P11).

| Area | Killed | Survivors |
|---|---|---|
| `lane-scope.mjs` SEC-16 (`<=` boundary, check dropped, unreadable history, root files, `tools/ci`, tooling inputs, window overflow) | L01-L07 all | - |
| `testedBase` (HEAD^1, HEAD^2, ancestor, push range base) | L08-L11 all | - |
| `gateVerdictStage2` rules (a), (b), (c), (e), (g); `parseClassification` coherence and proof format; `gate()` topology switch | L12-L18, L29 | - |
| CLI wiring: `--env` CODE, `manifestRef`, `scansJob` passed, `--tools-ref` needs `--lookup`, classification output | L21, L23, L25, L26, L28 | **L19** `main()` passes `baseChangedAt: undefined` (SEC-16 off in production; R1-m4); **L20** stage-2 proof steps read from the PR head instead of the test merge (NIT, R1-n6); **L22** `--env` always writes `LINT_CONTROLS=false`, **L24** `lintControls` always false, **L30** unknown range gives `lint_controls=false` (R1-n1) |
| `baseChangedAt` `--first-parent` dropped | - | L27: equivalent on a squash-only linear `main` |
| `security-paths.mjs` devOnly (devOptional dev-only again; nothing dev-only) | S01, S02 | - |
| `check-workflow-policy.mjs`: lint-env, NODE_OPTIONS expression, pull-requests job and top-level checks, stage2Findings wiring, ci-gate exact list, GITHUB_ENV writers, pre-tooling steps, stage-1 scans GITHUB_ENV, signatures CODE-gated | P01-P08, P12, P13 | **P09** classify-before-install and **P14** lane-scope-before-gitleaks: redundant (the `after`/pre-tooling pins and the exact ci-gate order already enforce them); **P10** security-integration added to the stage-2 token jobs and **P11** stage 2 accepting `"$GATE_LANE_SCOPE"`: no negative case for the stage-2 token rule (R1-m3) |

### 1.3 Policy probes on the stage-2 fixture (head `checkWorkflow(..., { requiredGates: true })`)

| Mutant of `tools/ci/fixtures/stage-2/ci.yml` | Findings |
|---|---|
| control (unchanged) | 0 |
| Semgrep run + `\|\| true` | **0** |
| Semgrep run as a block + `v=GITHUB_; v="${v}EN""V"; echo "GATE_LANE_SCOPE=…" >> "${!v}"` (re-points the aggregation's tool: X4's effect without an inserted step) | **0** |
| record run + `\|\| true`; record run with `--report-only` literal; `mode=(--report-only)` unconditionally; `true \|\| node …` | **0** each |
| gitleaks `--exit-code 0`; gitleaks `… --exit-code 1 \|\| true` | **0** each |
| `node "${GATE_CHECK_AUDIT:?}" … \|\| true` | **0** |
| Install `if: env.CODE == 'true'` | **0** |
| `npm audit signatures … \|\| true` | 1 (`audit-signatures-masked`) |
| Vulnerability audit `if: env.CODE == 'true'` | 1 (`required-gates`: must be unconditional) |
| An extra fast-lane step after Build with `GH_TOKEN` and `run: node "${GATE_LANE_SCOPE:?}" --help; npm run build` (`token-probe.mjs` T1, T2) | **0** (the same step without the lane-scope mention: 1 `gh-token`) |

The same Semgrep/record/gitleaks mutants of the live stage-1 `ci.yml` also give 0 findings under BOTH the head checker and `main`'s, so the class is pre-existing (PR #10 R2-m2); what is new is that stage 2 claims it is closed (R1-m1).

### 1.4 Lint-env probe (a `lane-c.yml`-shaped workflow, head checker)

`npm run lint` without env: `lint-env` (correct). `npm run -s lint`, `npm run lint -- --quiet`, `npm  run lint`, `npm run lint && true`: no finding. Job-level `BASH_ENV` next to a step with exactly the pinned env: no finding. Job-level `NODE_OPTIONS: ${{ … }}`: `node-options-preload` (correct). See R1-n2.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | **MAJOR** | `tools/ci/lane-scope.mjs:122` (`PROOF_BASE_DIRS`), `:441-445` (`proofBasePath`), `:717`; `tools/ci/lane-scope-stage-2.test.ts:330` (`['apps/api/src/a.ts', false]`); PR body "PR46-SEC-16 … (mechanical P1)"; `docs/07-ops/CI-CD.md` stage-2 bullet 2 | **The PR46-SEC-16 void set is narrower than the card and than P1, and the narrowing is not recorded.** The card and ruling (9) say a proof is accepted "only when `main` has gained no non-docs commit since the proof run was created (or an equivalent signal that binds the proof to the base it tested), so P1 becomes mechanical". The PR voids a proof only when the tested base touched `PROOF_BASE_DIRS` (`.github`, `prisma`, `tools/ci`, `tools/quality`, `.semgrep`), a root non-Markdown file or a manifest tooling input. That is P1 (c) of D-ORCH-078/102/103, but **not P1 (b)**: "main changed a file the PR also changes". Example: PR X and a merged PR Y both edit `apps/api/src/app.ts` in non-conflicting hunks; X's proof run tested X + old main; X's docs-only security-record push runs light, inherits the proof, ci-gate says MERGE-READY, and the squash lands a combined `app.ts` that no lane A run has linted, type-checked or unit-tested. The test pins the narrowing deliberately (`apps/api/src/a.ts -> false`), D-TASK286-01..05 do not mention it, and the PR body calls the result "mechanical P1". Once this merges the orchestrator will reasonably stop applying P1 by hand, so (b) is silently lost. | Either (preferred, small) add P1 (b): in `baseChangedAt`, a first-parent commit also dates the base when it touches a path of the PR range (`treeChanges(root, base, head, { mergeBase: true })`, already computed in `classify`), with a test (main edits `apps/api/src/a.ts` that the PR also edits: no proof; main edits another app file: proof kept), plus a D-TASK286-06 entry stating the void set and that a semantic conflict between non-overlapping files is left to the D-ORCH-042 post-merge gate, acknowledged by the security-analyst and the architect (ruling (9) "equivalent signal"); or implement the card literally (any non-docs first-parent commit voids). Correct the PR body and CI-CD.md wording either way. Design note for either option: in stage 2 the classify step already knows `code_proof`, so a docs push of a code PR whose proof is void could run full (`code_changed=true`) instead of ending BLOCKED "no code proof" and waiting for another push; that makes a wider void set cost minutes, not a round trip. |
| R1-m1 | MINOR (security flag) | `tools/ci/check-workflow-policy.mjs:1044, 1045, 1054` (ci-gate gitleaks, Semgrep and record gates matched by regex), `:2085` comment, `:2108-2123` (lexical `GITHUB_ENV` test); `docs/07-ops/CI-CD.md:135` | **Three ci-gate steps are not exact, so the stage-2 claims "ci-gate is exactly its pinned steps; no step can … re-point a gate location, mask a scan" and "`ci-gate` steps pinned to exact text" do not hold.** §1.3: `\|\| true`, `--exit-code 0`, a forced `--report-only` and an indirect `$GITHUB_ENV` write that re-points `GATE_LANE_SCOPE` before the aggregation all give 0 findings. The last one has X4's effect (the PR46-SEC-12 mutant this PR is meant to kill) without inserting a step, and the lexical `/GITHUB_ENV/` writer check is passed by `${!v}`. Pre-existing in stage 1 (same probes, both checkers), and it still needs an owned `ci.yml` edit; but stage 2 is where ci-gate becomes the only gate and everything around these three steps is already exact. | Pin the three `run:` texts exactly (`exactRunProblems` / `pinnedScriptProblems` with constants, as for openapi-breaking and the aggregation; the record step is a 7-line script), add one mutant row each to `ci-policy-stage-2.test.ts` (`\|\| true`, `--exit-code 0`, `mode=(--report-only)`, the `${!v}` write), and word the `GITHUB_ENV` rule as a tripwire for the non-exact fast-lane steps only. |
| R1-m2 | MINOR | `tools/ci/check-workflow-policy.mjs:552` ("the stage-1 pins stay until a follow-up retires them"), `requiredGatesFor`, `topologyOf`; D-TASK286-01 | **No owner retires the stage-1 topology, and while it is accepted a later `ci.yml` can switch back to it.** After the workflow PR merges, a PR that restores a `scans` job is held to the stage-1 pins, which allow `Registry signatures` and `Vulnerability audit` under `env.CODE` (`CI_REQUIRED_GATES`, lines 792-793). That undoes PR46-SEC-11 (audit on every push) at the moment the 24 h proof-age interim rule ends (ruling (7): "until TASK-286"). The edit needs a record, so this is a control gap, not an open door. No card names the retirement (grep of WAVE-00.md, DECISIONS.md: none). | Add a card line (TASK-287 holds the same `ci-workflows` lock and edits `ci.yml` next) to remove `CI_REQUIRED_GATES` stage 1, `laneScopeFindings` and the stage-1 branches of `gate()`/`proofSteps` once the workflow PR is on `main`; until then, record in D-TASK286-01 that the 24 h interim rule stays in force for any stage-1 `ci.yml`. |
| R1-m3 | MINOR (security flag) | `tools/ci/check-workflow-policy.mjs:577` (`TOKEN_JOBS_BY_TOPOLOGY` stage 2 = fast-lane, ci-gate), `:579-582` (`LANE_SCOPE_INVOCATION`), `tokenFindings` `allowed()` (`:2192-2200`) | **In stage 2 the token may sit on ANY fast-lane step whose `run:` mentions `"${GATE_LANE_SCOPE:?}"`, including one after head code.** Stage 1's rule ("a step of a token job that invokes lane-scope") was safe because `scans` and `ci-gate` are scans-isolated (no npm). Stage 2 makes fast-lane a token job, and fast-lane runs deps:rebuild, lint, tests and build. Probe (`scratchpad/pr55/token-probe.mjs`): an extra fast-lane step after Build with `env: GH_TOKEN: ${{ github.token }}` and `run: node "${GATE_LANE_SCOPE:?}" --help; npm run build` gives **0 findings**; the same step without the lane-scope mention gives `gh-token`. The head's build scripts then read `actions`, `pull-requests` and `contents` (read) from the environment. The fixture comment and PR46-SEC-15 ("confined to the lookup steps"; "the token reaches this step only, before any head code") are therefore not enforced. My mutants P10 (security-integration added to the stage-2 token jobs) and P11 (stage 2 accepting `"$GATE_LANE_SCOPE"`) survive the suite, which shows the stage-2 token rule has no negative case. Needs an owned `ci.yml` edit; the scopes are read-only on a repository the writer can read, hence MINOR. | In stage 2 allow the token only on the step found by the `lane scope` gate of each job (fast-lane: the step with id `classify` and exactly `CLASSIFY_RUN`; ci-gate: the pinned lane-scope and aggregation steps), not on any step mentioning the tool. Add the T1 probe as a negative fixture and a security-integration GH_TOKEN fixture (kills P10/P11). |
| R1-m4 | MINOR | `tools/ci/lane-scope.mjs:1174` (`main()`: `baseChangedAt: stage2 ? baseChangedAt(...) : undefined`) | **The PR46-SEC-16 wiring into the CLI is unpinned.** Mutant L19 (`baseChangedAt: undefined`, i.e. no base check in the real classify and ci-gate steps) passes all 134 tests: `baseChangedAt` and `lookupProofs` are tested directly, but no CLI test runs `main([... --tools-ref ... --lookup])` against a history where the tested base moved after a candidate run. Same class as PR #26 m1 and PR #32 R2-m2 (composition lines). | One CLI case: a git fixture whose `main` gains a `package.json` commit after the fake run's `created_at`, `main()` with an injected `api`; assert an empty `code_proof=` and the "tested an older base" note, with the docs-commit control keeping the proof. |
| R1-n1 | NIT | `tools/ci/lane-scope.mjs:421`, `:541-544` (`mayBeSkipped`), `:899-940` (`gateVerdictStage2`) | Mutants L22, L24 and L30 (the `--env` LINT_CONTROLS line, the PR-range `lintControls` computation and the unknown-range default) survive, so the stage-2 lint-controls value is untested end to end. Also, steps gated by `LINT_CONTROLS` may be `skipped` in this run and in a proof, even when the recomputed classification says `lint_controls=true`. Head code that rewrites `LINT_CONTROLS` through `$GITHUB_ENV` (deps:rebuild and lint run before the fixture step) skips the no-weakening control without a red gate. The step is self-described as an accident guard, hence NIT; the verified value is now available, so the fix is one argument. | Pass `own.lint_controls === 'true'` into `fastLaneProblems` (this run) and the proof check, and require `success` then. |
| R1-n2 | NIT | `tools/ci/check-workflow-policy.mjs:1547`; CI-CD.md "every `npm run lint` step" | `lint-env` matches only a `run:` that is exactly `npm run lint`; `npm run -s lint`, `npm run lint -- …`, `npm  run lint`, multi-command lines and a job-level `BASH_ENV` escape it in `lane-c.yml`/`nightly.yml` (§1.4). The `ci.yml` Lint step is pinned exactly through the required gate, and expression/preload `NODE_OPTIONS` are refused everywhere, so the residual is wording. | Match through `npm-command.mjs` (any `run-script` of `lint`) or reword the doc and rule to "a step whose run is exactly `npm run lint`". |
| R1-n3 | NIT (security flag) | `tools/ci/lane-scope.mjs:457-481` (`--format=%ct`), `:717` | The tested base is dated by committer time, compared with the proof run's `created_at`. For GitHub squash merges the committer time is the landing time, so this holds today; a commit created earlier and landed later (a direct push, a merge commit, a rebase merge; there is no branch protection) dates the change before a proof run that never saw it. GitHub's asynchronous test-merge refresh also leaves a seconds-wide window. | Record the residual in the D-TASK286 entry (squash-only, no direct non-docs pushes to main), or date by the push (the repository activity API gives the time `main` moved). |
| R1-n4 | NIT | `docs/sdlc/DECISIONS.md` D-TASK286-01 | Says the stage-1 workflow "is kept as `tools/ci/fixtures/stage-1/ci.yml`"; no such file exists on this branch or on the workflow branch. | Correct the entry or add the fixture with the workflow PR. |
| R1-n5 | NIT | `tools/ci/check-workflow-policy.mjs:967` (`install` `ifs: [CODE]`); `ci-policy-stage-2.test.ts:79` | The stage-2 policy allows a CODE-gated install, while the card ("after an npm ci that stays unconditional when the audit is") and D-TASK286-03 keep it unconditional, and the test pins the permissive value (`ifsOf('install')` equals `[CODE]`; §1.3: 0 findings). It fails closed in practice (a light run without `node_modules` cannot load the evidence verifier's Ajv or audit installed signatures), so the gap is the pin, not a bypass. | `ifs: []` for the stage-2 install (the fixture already complies) and a mutant row "Install CODE-gated fails". |
| R1-n6 | NIT | `tools/ci/lane-scope.mjs:1159` | Mutant L20 (stage 2 reads the proof step names from the PR head's `ci.yml` instead of the test merge's) survives: every fixture has the same `ci.yml` at both. It matters only when `main` changed `ci.yml` after the PR branched, which is exactly the stage-2 switch. | One case with a test merge whose `ci.yml` differs from the head's. |

## 3. Focus items

1. **Topology selection.** `topologyOf` keys on `jobs.scans`; a stage-2 `ci.yml` with any stage-1 element, or a stage-1 file without `scans`, fails (`[mixture]` test). `requiredGatesFor`, the read-scope tables, the token jobs and the `"${GATE_LANE_SCOPE:?}"` invocation follow the topology. Sound.
2. **PR46-SEC-17 (TOOLS_REF).** The shell lines (pinned in `TESTED_BASE_SCRIPT`, shared by both tooling steps) and `testedBase` both require `HEAD^2 == RANGE_HEAD` and `RANGE_BASE` an ancestor of `HEAD^1`, and the CLI exits 2 on a mismatch. The evidence verifier, the lint fixtures, the CODEOWNERS copy and the security-integration manifests come from `TOOLS_REF` through step env tied to the classify step's output, which later head code cannot rewrite. `DOCS_ONLY_PATHS` reads the tested base's tooling inputs. RANGE_BASE still classifies and scans the range. The bootstrap test reproduces the PR #53 `MODULE_NOT_FOUND` premise and shows the stage-2 step starts. Sound.
3. **PR46-SEC-12.** X3 and X4 are required-gates findings in both topologies (stage 1: `SCANS_TOOLING_SCRIPT` exact, security-paths and lane-scope directly after; stage 2: tooling steps exact, classify/lane-scope directly after, only checkout/setup-node before, ci-gate's step list exact). ci-gate recomputes the classification with the tested base's tool and re-reads both proofs under the PR #46 binding, and rule (g) is red on any difference; `parseClassification` refuses missing, extra, reordered or out-of-domain keys and an incoherent mode/code pair. Fast-lane and ci-gate check out the same `github.sha`, so the two lookups see the same tested base; the PR concurrency group (no cancel) keeps another run of the PR from completing between them. The remaining hole is in-step (R1-m1).
4. **PR46-SEC-11.** Signatures and audit are `ifs: []` and ordered after licences in stage 2; a CODE-gated audit is a finding (fixture and mutant). Install: R1-n5.
5. **PR46-SEC-15.** `pull-requests:` is refused at workflow level and outside the lookup jobs, per topology, with Y19/Y21 and a stage-1 ci-gate fixture. In stage 2 the lookup jobs are fast-lane and ci-gate; fast-lane also runs head code, so the per-step token rule matters more there (R1-m3).
6. **PR42-SEC-18.** The `ci.yml` Lint gate carries `env: LINT_ENV` in both topologies (exact), and `NODE_OPTIONS` with `${{` is refused in any env map. `lint-env` elsewhere: R1-n2.
7. **D-ARCH-133.** `devOnly` is `dev === true` only; the devOptional Prisma CLI bump, add, remove and dev -> devOptional cases select, the dev-only Jest control does not, and the `classifyRange` row selects. The optional D-TASK015-59 refinement is deferred (D-TASK286-04), which the card allows.
8. **Dependabot.** npm `open-pull-requests-limit: 1`, comment explains merge-or-ignore; `sec-static.test.ts` pins the value.

## 4. Deviation rulings (D-TASK286-01..05)

| Decision | Ruling |
|---|---|
| 01 two PRs, policy first; stage-1 pins kept | Accepted. The base-ref policy forces it, and the workflow branch's `ci.yml` equals the fixture. The retirement needs an owner (R1-m2); the fixture claim is wrong (R1-n4). |
| 02 TOOLS_REF = HEAD^1 on a PR, range base on a push | Accepted (§3 item 2). |
| 03 Install unconditional | Accepted for the workflow; the policy must pin it the same way (R1-n5). |
| 04 D-ARCH-133 done, D-TASK015-59 refinement deferred | Accepted (the card says "may follow"). |
| 05 superseded FAIL lane B runs not committed | Accepted: the committed PASS is bound to the code head and every superseded run predates it on a tree without #53. |
| (unrecorded) PR46-SEC-16 void set = lane A inputs only | **Not accepted as is** (R1-M1). |

## 5. Merge conditions

1. R1-M1 fixed (P1 (b) added, test, D-TASK286-06 with security and architect acknowledgement) or the card's literal rule implemented. R1-m1, R1-m3, R1-m4 and R1-n5 in the same cycle (small, same files; the other NITs are optional). R1-m2 as a card line plus the D-TASK286-01 note.
2. Fresh lane B evidence on the fix head (tools/ci is in the unit project), then a security record `docs/05-quality/security/PR-0055-*.md` naming the final head (tools/ci and .github are security-owned).
3. Policy PR merges before the workflow PR (`ci/TASK-286-cigatefold-workflow`); the workflow PR is a second, separate review.
4. Squash merge. Round 2 is a delta review: re-run `scratchpad/pr55/policy-probe.mjs` (§1.3) and the mutation table (§1.2) against the fix head.

## 6. Good patterns worth keeping

- Two topologies, each pinned in full, chosen by one structural predicate, with a mixture test: the two-step change cannot leave a half-pinned workflow.
- `TESTED_BASE_SCRIPT` shared by both tooling steps and re-verified inside `lane-scope.mjs`: the shell and the tool fail closed on the same three conditions.
- TOOLS_REF reaches later steps only through `steps.classify.outputs.tools_ref` in step env, so head code that rewrites `$GITHUB_ENV` cannot move the verifier, the fixtures or the manifests.
- Rule (g): fast-lane's outputs steer the cheap path, and the no-head-code job recomputes and compares them instead of trusting them.
- `baseChangedAt` fails closed on an unreadable history and is conservative beyond its window.
- A stage-1 proof cannot satisfy a stage-2 run (the scans job name differs), so the switch voids old proofs instead of mixing them.

## 7. Security flags for the security-analyst

1. R1-M1: the PR46-SEC-16 void set (lane A inputs only) needs an explicit security acknowledgement or the P1 (b) widening; "P1 becomes mechanical" does not hold yet.
2. R1-m1: in-step masking and an indirect `$GITHUB_ENV` write in ci-gate's regex-pinned gitleaks, Semgrep and record steps (X4's effect without an inserted step); pre-existing in stage 1.
3. R1-m3: GH_TOKEN allowed on any fast-lane step that mentions lane-scope (probe T1, 0 findings).
4. INFO: stage 2 grants `actions: read` and `pull-requests: read` at job level to fast-lane, which runs head code. The token is passed only to the classify step, but on hosted runners head code with sudo can read the runner worker's memory, so the job token's read scopes are reachable (fast-lane held `contents: read` only before). Read-only on a repository the writer can read; record as an accepted residual.
5. R1-n3: committer-date base dating (no branch protection; a direct or non-squash push to `main` dates a change before it landed).
6. R1-m2: the stage-1 topology (CODE-gated audit and signatures) stays accepted with no retirement owner; the 24 h proof-age interim rule should stay in force for any stage-1 `ci.yml` until then.

---

# Round 2 (delta review of fix cycle 1)

Head reviewed: `72dcf5b` (full SHA `72dcf5b8f8dcb4cdfe4fc71e0c75929f5bc72362`).
- `91d8070` is the fix-cycle-1 code commit.
- `764b75f` merges main `617f378`.
- `72dcf5b` adds lane B evidence `20261117T0212Z_764b75f` only.

Delta: `git diff 2fe721e 91d8070`, 7 files: `lane-scope.mjs`, `check-workflow-policy.mjs`, both stage-2 test files, the fixture comment, CI-CD.md and the PR #55 security record.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every r1 finding is closed, routed or withdrawn. The void set now covers P1 (b) and the lint controls
  (D-TASK286-06/06a). ci-gate's three scan steps and every pre-head-code fast-lane gate are exact, with no step env.
  The token is bound to three steps by gate position, and the CLI wiring is tested end to end. All 12 r1 policy probes
  and both token probes now give findings. 21 of my 27 r2 mutants are killed; the 6 survivors are equivalent,
  redundant or cosmetic. No BLOCKER, MAJOR or MINOR remains. Four NITs, on the new preload-env/env-expression rules
  and on the docs.
```

## R2.1 What I verified myself

| Check | Result |
|---|---|
| `git show --remerge-diff 764b75f` | Empty: a clean auto-merge with no hand resolution. `git diff --name-only 91d8070 764b75f` lists only `docs/sdlc/DECISIONS.md` and `docs/sdlc/STATUS.md`; `764b75f..72dcf5b` is the evidence directory only. `origin/main` has since gained `82dcba6` (DECISIONS.md only), so no union is needed |
| `jest tools/ci --selectProjects unit` on `72dcf5b` | 30 suites, **1198 / 1198** pass (r1: 1142) |
| Prettier on the changed non-evidence files | clean |
| Head `check-workflow-policy.mjs --root .` (ci.yml, lane-c.yml, nightly.yml) | exit 0: the new `preload-env` and `env-expression` rules give no false positive on the live workflows |
| Fixture vs `ci.yml` on `origin/ci/TASK-286-cigatefold-workflow` (`5f76ef3`) | byte-identical. `tools/ci/fixtures/stage-1/ci.yml` exists on that branch (also at `03a281a`) |
| Lane A run 44003648755 on `72dcf5b` | fast-lane **success**: every step ran except the two LINT_CONTROLS steps, which were correctly skipped. Every scan step succeeded. Only the record step fails, so that is the only reason ci-gate is red |
| r1 policy probes (`policy-probe.mjs`) M01-M12 | **Every mutant is now a finding** (`required-gates` "the run: must be exactly ..."; M07 "install gate step must be unconditional"). Control: 0 |
| r1 token probes (`token-probe.mjs`) T1, T2 | one `gh-token` finding each (r1: 0) |
| r1 lint-env probe | Unchanged (R1-n2 was ruled as wording). V5, a job-level `BASH_ENV`, is now refused by `preload-env` |
| New: `preload-probe.mjs` (27 cases, `lane-c.yml` shape) | see R2.3 |

**Mutants.** `mut2.mjs` ran in a fresh `git archive 72dcf5b` copy. Lane-scope rows run `lane-scope-stage-2.test.ts`; policy rows run the three policy suites.

| Rows | Result |
|---|---|
| r1 survivors: L19 (`main()` SEC-16 wiring), L20 (proof steps from the PR head), L22, L24, L30 (lint controls) | **All killed.** Closes R1-m4, R1-n6 and R1-n1 |
| N01 prPaths ignored; N02 unknown PR range accepted; N03 `main()` drops prPaths; N08 `tools/deps` out of the set | killed |
| N05-N07: a skipped lint-control step accepted in the gate rule, the proof lookup or the CLI | killed |
| N10 token step position unchecked; N13 `STAGE_2_USES` off; N14 workflow env keys off; N15 `env-expression` off; N17 `BASH_FUNC_` prefix off | killed |
| N18-N21: the gitleaks, record, Semgrep and audit exact pins off | killed |
| P10 (security-integration added to the stage-2 token jobs) | Survives, but is now **equivalent**: in stage 2, `allowed()` needs a step in `tokenSteps`, which has no security-integration entry. P11 is dead code in stage 2 for the same reason |
| N04 (the `LINT_CONTROL_PATHS` check in `proofBasePath`) | Survives, **redundant**: every alternative of that regex is either a root file or already under `PROOF_BASE_DIRS` |
| N11, N12 (the token step's exact-run and id checks) | Survive, **redundant** in the composed policy: `required-gates` already pins the same step's exact run and id |
| N09 (`tests/fixtures/**` out of the set) | Survives: only `tests/fixtures/{lint,semgrep}` rows exist, and LINT_CONTROL_PATHS still covers those (R2-n4) |
| N16 (`preload-env` made case-sensitive) | Survives: no lower-case row (R2-n4). Cosmetic on Linux runners, where `bash_env` is not `BASH_ENV` |

## R2.2 Round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** | The void set is now: lane A inputs; every path the PR range changes, docs included; `tools/{deps,eslint-rules,stylelint-rules,lint,test-support}/**`; `tests/fixtures/**`; LINT_CONTROL_PATHS. An unknown PR range gives no proof. D-TASK286-06 (security-acknowledged) and D-TASK286-06a record it; semantic conflicts are left to the D-ORCH-042 post-merge gate. Tests: the CLI rows V3, V4, V5, package, docs and none, and the P1 (b) `baseChangedAt` case; N01-N03 and N08 killed. Cost check: the open PR ranges (#54, #56 and this one) touch no `docs/sdlc` file, so the orchestrator's DECISIONS/STATUS commits on main do not void their proofs |
| R1-m1 | **Closed** | Exact `run:` and `env: {}` for gitleaks, Semgrep and the record step, and for every fast-lane gate from classify to the evidence step (a contiguous `after` chain). Workflow env pinned to exact keys; `STAGE_2_USES` added. The code comment and CI-CD.md now call the `GITHUB_ENV` check a tripwire for the head-code steps |
| R1-m2 | **Routed** | D-TASK286-01a adds a TASK-287 card line for the stage-1 retirement (PR55-SEC-10), and the 24 h proof-age rule applies to any stage-1 `ci.yml` until then. The orchestrator folds the line. Accepted |
| R1-m3 | **Closed** | `tokenSteps` allows the token only on fast-lane's classify step (matched by gate position, exact `CLASSIFY_RUN` and id `classify`) and on ci-gate's lane-scope and aggregation steps. T1 and T2 are findings; N10 killed |
| R1-m4 | **Closed** | The `[R1-m4] [R1-n6]` CLI describe; L19 killed |
| R1-n1 | **Closed** | `fastLaneProblems(..., lintControls)` is used in rule (b) and in the proof lookup; L22, L24, L30 and N05-N07 killed |
| R1-n2 | Ruled as wording | CI-CD.md now says "a step whose run is exactly `npm run lint`". One stale header line remains (R2-n3) |
| R1-n3 | Accepted residual | INFO-04 in D-TASK286-06. CI-CD.md tells anyone pushing to main to push right after committing |
| R1-n4 | **Withdrawn** | My r1 check was wrong: `tools/ci/fixtures/stage-1/ci.yml` is on the workflow branch (`03a281a`), and D-TASK286-01a says where |
| R1-n5 | **Closed** | Install has `ifs: []` and an exact run; M07 is a finding |
| R1-n6 | **Closed** | L20 killed |

## R2.3 New rules: `preload-env` and `env-expression` (false positives and negatives)

`preload-probe.mjs` against the head checker:
- **Correctly refused:**
  - `BASH_ENV` at step, job, workflow, `container.env` and `services.*.env` level, in lower case too;
  - `PATH`, `LD_PRELOAD`, `NODE_PATH` and `BASH_FUNC_npm%%`;
  - `env: ${{ fromJSON(...) }}` at step and job level;
  - `NODE_OPTIONS: ${{ inputs.o }}` (`node-options-preload`).
- **No false positive on:** `ENVIRONMENT`, `APP_ENV`, `PATH_PREFIX`, `NODE_ENV`, `TZ`, `LANG`, an expression-valued `DATABASE_URL`, or the three live workflows.
- **One false positive, failing closed:** an empty `env:` gives `env-expression` (R2-n2).
- **False negatives:** git and npm configuration variables that also run code before or inside a step:
  - `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` (they can set `core.fsmonitor` or `core.hooksPath`);
  - `GIT_EXTERNAL_DIFF`;
  - `HOME` and `XDG_CONFIG_HOME` (they redirect `.gitconfig` and `.npmrc`);
  - `NPM_CONFIG_SCRIPT_SHELL`, `NPM_CONFIG_USERCONFIG` and `npm_config_node_options`.

  None of them can be set anywhere that matters in the stage-2 `ci.yml`: the workflow env keys, the job env, and the step env of every pre-head-code and ci-gate step are all exact. The exposure is:
  - the live stage-1 `ci.yml` until TASK-287 retires it, because its workflow env is not key-pinned and reaches `scans` and `ci-gate`, which run git and the base tools;
  - `lane-c.yml` and `nightly.yml`, which run head code anyway.

  See R2-n1.

## R2.4 New findings (all NIT)

| ID | Severity | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| R2-n1 | NIT (security flag) | `tools/ci/check-workflow-policy.mjs:137-150` (`PRELOAD_ENV`) | The list misses the git and npm configuration variables in R2.3, which run code the same way the listed ones do. Only the stage-1 `ci.yml` and the dispatch workflows are exposed. | Add `GIT_CONFIG_PARAMETERS`, a pattern for `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>`, `GIT_EXTERNAL_DIFF`, `HOME`, `XDG_CONFIG_HOME`, and `NPM_CONFIG_SCRIPT_SHELL` / `USERCONFIG` / `GLOBALCONFIG` / `NODE_OPTIONS` in any case. The gitleaks `docker run -e GIT_CONFIG_*` arguments are not an env map, so this adds no false positive there. Alternatively, record them as a stage-1 residual for TASK-287. |
| R2-n2 | NIT | `check-workflow-policy.mjs:1603` | An empty `env:` (null in GitHub's parser) is refused as `env-expression`. It fails closed and is cosmetic. | Treat an empty scalar like an absent map. |
| R2-n3 | NIT | `docs/07-ops/CI-CD.md:65`, `:151`; `check-workflow-policy.mjs:32` | (a) After a void proof the doc says "push again or close and reopen the PR". Another docs push is still light and still BLOCKED; only a code push or a reopen runs the full lane. (b) "`LD_*`" overclaims: the code lists only `LD_PRELOAD`, `LD_LIBRARY_PATH` and `LD_AUDIT`. (c) The rule header still says "every `npm run lint` step, in any workflow". | Reword the three lines. |
| R2-n4 | NIT | `lane-scope-stage-2.test.ts` (`proofBasePath` table); the preload rows | N09 and N16 survive. There is no row for a non-lint `tests/fixtures/**` path (e.g. `tests/fixtures/sql/raw-statement-corpus.json`, which unit suites read), and none for a lower-case preload name. | Add one row each. |

## R2.5 Merge conditions

1. A security delta record `docs/05-quality/security/PR-0055-*.md` naming the final head. The existing record names an earlier head, so lane A's record step stays red until the new one lands.
2. Lane B evidence `20261117T0212Z_764b75f` is bound to the current code, and this review commit is docs-only. If any R2 NIT is fixed in code, take fresh evidence.
3. The orchestrator folds the TASK-287 card line (D-TASK286-01a).
4. The policy PR merges before the workflow PR. The workflow PR (`5f76ef3`, `ci.yml` == fixture) gets its own review.
5. Squash merge.
