---
name: project-p5-pr62-task287a
description: PR #62 (TASK-287 part 287-A policy PR) security r1 at code head 5d86412 PASS_W_F-U, record + D-SEC-PR62-01 on MAIN (8966dd0); PR59-SEC-01 item 1, PR55-SEC-10, PR57-SEC-02 closed; new LOW 01 action-step env + uses commit unpinned, INFO 02 end V1/envOptional with 287-B, INFO 03 suite imports outside trigger list; runner INPUT_* fact; 895-mutant policy differential kit
metadata:
  type: project
---

Round 1, 2026-11-18. Record `docs/05-quality/security/PR-0062-TASK-287A-security-review.md` and D-SEC-PR62-01 committed **on main** `8966dd0` (pushed), read by ci-gate through the merge ref. The Head row is `5d86412` (full SHA). The evidence-only tip `77ff897` passes main's checker (sim 9/9; 17 owned paths, all `tools/ci/**`). The code twin `d76ac9e` was APPROVED_WITH_NITS: R1-m1 run-full too wide, R1-m2 push-gate test lost, and n2 asked me to rule on the `uses`/env levers.

**Findings:**
- **PR62-SEC-01 (LOW, CWE-829/693).** The action steps of fast-lane, security-integration and ci-gate still accept:
  - any step `env:`, including `NODE_EXTRA_CA_CERTS`, `HTTPS_PROXY`, `GIT_DIR`, `GIT_CONFIG_GLOBAL`, `GIT_TEMPLATE_DIR`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`;
  - `if:`;
  - any 40-hex `uses:` commit, including fork-network "imposter" commits.

  Ruling: pin the action-step key set `{name, uses, with}` and the exact commit per action in the 287-C policy PR. Until then, the record of any PR that changes a `uses:` line in ci.yml verifies the upstream tag commit.
- **PR62-SEC-02 (INFO).** The V1|V2 tooling scripts and the optional `FAST_LANE_*` entries must end with 287-B: V2 only, and the four entries required.
- **PR62-SEC-03 (INFO).** `rls-cross-tenant` and `catalog-c1-c14` import `apps/api/src/app.ts`, `modules/index.generated.ts`, `tools/openapi/contract.ts`, `tools/authz/generate.ts` and `@platform/shared`, none of them on the trigger list. Routed to principal-architect.

**Facts:**
- The actions runner gives every declared input with no default an empty-string default (`ActionManifestManager.cs`). `Handler.AddInputsToEnvironment` then writes `INPUT_*` after the step env. So an `INPUT_REF` in a step's `env:` cannot override the pinned `with:`.
- `checkoutProblem` checks only when `GITHUB_ACTIONS === 'true'`.
- A crafted first parent (a pushed commit with old or edited `tools/ci`) defeats every tested-base pin. That is the am. N item 3 residual, and the record-names-head rule stays as the control.
- Run-full `voidedByBase` is true whenever any bound run was voided, even when a newer run is red.

**How to apply:**
- At 287-B: check that the V2 lines and the four entries are in, PR62-SEC-02, and that its record names the code head.
- At 287-C: check PR62-SEC-01, cache hygiene (`shipqube-test-locks`), and R1-m1/m2.
- Watch the first post-merge lane A run of any PR: it is the first live run of this tooling.
- Any later `tools/ci/**` commit on #62 needs a delta round.

**Kit** (session scratch `pr62/probes/`):
- `diff-policy.mjs`: base vs head `checkWorkflow` over about 850 ci.yml mutants (with-add/edit/drop/dup, step-env, uses-sha/case/sub, V2 and weakened V2, envOptional, line deletions).
- `diff-add.mjs`: permissions, token, triggers, jobs.
- `env-names.mjs`, `lane-probe.mjs` (fake jobs API for `lookupProofs`, gate (g), `checkoutProblem` on a scratch repo), `paths-probe.mjs` (corpus plus the manifest oracle plus the whole tree).
- `sim.mjs`: merge-ref record sim, 9 scenarios, on a `clone --shared` with sparse `/.github/ /docs/05-quality/security/ /tools/ci/`.
- `gl-generic.mjs`, `gl-over.mjs`.

Related: [[project-p5-pr59-task286-workflow]], [[project-p5-pr55-task286-policy]], [[project-p5-pr64-task035]], [[project-p5-pr66-task290]], [[project-security-review-conventions]]
