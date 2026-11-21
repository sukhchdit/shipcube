---
name: project-p5-pr55-task286-policy
description: PR #55 (TASK-286 stage-2 policy PR) R1 @5645b9b PASS_W_COND (1c729d9) and delta R2 @72dcf5b PASS_W_F-U (fc31652); C1/C2 closed; new LOW 11 stage-1 workflow env deny-list (DOCKER_HOST etc.); open INFO 04-07,10; probe kit and facts
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0055-TASK-286-security-review.md` on `ci/TASK-286-cigatefold`.
- R1 was pushed as `1c729d9` with Head row `5645b9b`.
- Delta R2 was appended and pushed as `fc31652` with Head row `72dcf5b`, a second Verdict row last, and LF line endings.
- main's checker passes with base `617f378`: 18 owned paths, satisfied by `72dcf5b`.

**R1 (PASS_WITH_CONDITIONS):**
- C1 = 01 (env channel into ci-gate, root PR17-SEC-08), 02 (pattern-only pins = code review R1-m1), 09 (token on any lane-scope-mentioning step = R1-m3).
- C2 = 03, the void set (= R1-M1). I RULED that the void set must be widened, not merely acknowledged.

**R2 (PASS_WITH_FOLLOW-UPS):** C1 and C2 closed.
- C1 fixes:
  - `PRELOAD_ENV` with the `preload-env` rule, case-insensitive, at every level;
  - `env-expression`;
  - `env: {}` on the scan gates in both topologies;
  - exact stage-2 workflow env keys;
  - exact pre-head and ci-gate scan pins in an after-chain;
  - `STAGE_2_USES`;
  - the token rule bound to step position, exact run and id;
  - install pinned.
- C2 fix: `PROOF_BASE_DIRS` widened, plus the PR's own paths (docs included), plus `LINT_CONTROL_PATHS`; a null range gives no proof. D-TASK286-06a is a superset of my ruling.
- Differential: the round-1 head gave a proof or 0 findings on every mutant the fix now refuses.
- **New PR55-SEC-11 (LOW, follow-up):** stage 1 (live until the TASK-287 retirement) has a deny-list workflow env, so DOCKER_HOST, ACTIONS_ALLOW_UNSECURE_COMMANDS, GIT_CONFIG_* and NPM_CONFIG_SCRIPT_SHELL pass. Its scans steps stay pattern-pinned. Fix: an exact-keys line in `laneScopeFindings` (0 findings on the live ci.yml), and extend the lane-c/nightly deny-list (015-C).
- Open INFO: 04 and 06 accepted (D-TASK286-06); 05 and 10 routed to TASK-287; 07 is an orchestrator procedure.

**Merge facts:**
- The record push is predicted light, `code_proof=44003648755:72dcf5b`, no security-integration.
- 24 h rule: merge by 2026-11-18T02:31Z.
- The code review's R2 must also approve.
- The fixture blob is now `4597259`, so the workflow PR must install it; it was `a35e5a3` in R1.

**Facts verified:**
- Bash sources BASH_ENV under both GitHub invocations.
- languageservices: `step-env` accepts a whole-map expression; property keys are case-sensitive.
- The live stage-1 ci.yml workflow env has exactly the stage-2 key set.

**Kit** (session scratch `review/PR-55-sec/`, may vanish):
- `mut.mjs` .. `mut7.mjs`, run with `<dir>` holding `head/`, `main/` (the comparison checker) and `s2/`;
- `lsprobe2.mjs` (T1-T9, V0-V11), with `patchls.mjs` creating it;
- `recsim2.sh` (S0-S5, two checkers);
- `wfkeys.mjs`, `glshape.mjs`, `hostscan2.mjs`.

**Gotchas:**
- A heredoc turned `\\n` inside JS strings into raw newlines. Avoid escapes in patch scripts, or use the Write tool.
- `MSYS_NO_PATHCONV=1` needs a `C:/...` clone source.

Related: [[project-p5-pr46-mo]], [[project-p5-pr17-fixture-subset]], [[project-p5-pr42-r3]], [[project-security-review-conventions]]
