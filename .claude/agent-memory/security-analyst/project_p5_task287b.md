---
name: project-p5-task287b
description: TASK-287 part 287-B (workflow PR, pre-push, no PR number) security r1 at code head 06f62ac PASS_W_F-U; record PR-pending-... on main d923f24 (rename to PR-<NNNN>- needed); PR62-SEC-02 / PR59-SEC-01 item 2 / PR55-SEC-05 closed; INFO 01 gate tolerates absent FAST_LANE_*, INFO 02 runs-on unpinned; interim rule extended; probe kit
metadata:
  type: project
---

Round 1, 2026-11-19, pre-push. Record `docs/05-quality/security/PR-pending-TASK-287B-security-review.md` and D-SECPR287B-01 are on **main** at `d923f24` (pushed). The decision ID is one segment, matching `^D-[A-Z0-9]+-\d+$`. The Head row is `06f62ac` (full SHA). The code twin is APPROVED_WITH_NITS (`3ad2495`): R1-m1 MINOR, a cancelled or light non-voided run suppresses run-full.

**The placeholder name does not count.** The checker requires `PR-<NNNN>-*.md`. The sim's C1 (pending name only) fails, so the orchestrator must `git mv` the record on main before the event that has to pass. Advised order: open the PR as a draft, rename, then mark it ready (`ready_for_review` is in `on.types`); otherwise close and reopen after the rename.

**Findings** (both INFO, owner devops, 287-C):
- **PR287B-SEC-01.** `lane-scope.mjs` `gateInputStage2FromEnv` still filters out absent `FAST_LANE_*` entries. Only the policy requires them.
- **PR287B-SEC-02.** The stage-2 job shape is a deny-list (`defaults`, `container`, `services`, `strategy`, `continue-on-error`). `runs-on` (including `self-hosted`) and `environment` are accepted under both policies.

The interim record rule now also covers `runs-on` and `environment:` changes until 287-C.

**Facts:**
- The `reserved-env` rule refuses every `GITHUB_*`/`RUNNER_*` name (except `GITHUB_TOKEN`) at every env level.
- lane-scope notes go only to the step summary, through `safe()`.
- `voidedByBase` under the head implies it under the base: only conjuncts were added.
- A crafted merge X (first parent = an attacker's commit) passes V1 with `TOOLS_REF`=attacker, and V2 refuses it.

**Kit** (session scratch `s287b/probes/`; the stalled first attempt left `r287b/`):
- `diff-policy.mjs`: 1,229 mutants, families A-G.
- `v2-bash.mjs`: needs a POSIX `RUNNER_TEMP` (`/c/...`), otherwise Git Bash `tar` treats `C:` as a remote host.
- `m1-probe.mjs`: 14 lookup scenarios.
- `gate-env.mjs`, `action-steps.mjs`, `run-expr.mjs`, `job-keys.mjs`, `job-keys2.mjs`.
- `sim.mjs`: merge-ref sim with a plumbing evidence tip, 4 pass and 7 controls; args `<clone> <record> <main> <pr>`.

**How to apply:**
- If R1-m1 is fixed in this cycle, or anything changes under `tools/ci/**` or `.github/workflows/**` after `06f62ac`, run a delta round. The fix must only add conjuncts.
- At 287-C, check PR62-SEC-01, PR287B-SEC-01 and PR287B-SEC-02, and the CI-CD.md wording "record on the branch" (the checker reads the merge ref).
- Watch the first post-merge lane A run: it is the first live run of the V2-only policy.

Related: [[project-p5-pr62-task287a]], [[project-p5-pr59-task286-workflow]], [[project-security-review-conventions]]
