---
name: project-p5-pr59-task286-workflow
description: PR #59 (TASK-286 workflow PR installing stage-2 ci.yml) R1 @055083b PASS_W_F-U (record 2d6818b); LOW 01 unpinned checkout/setup-node inputs (ci.yml PRs choose their own tested base); INFO 02 deny-list gaps lane-c; interim-rule ruling; event base.sha facts
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0059-TASK-286-workflow-security-review.md`, pushed as `2d6818b` on `ci/TASK-286-cigatefold-workflow` (2026-11-17). Head row `055083b`. main's checker passes (11 owned paths).

**Verified:**
- live ci.yml = PR #55 fixture blob `4597259`;
- stage-1 fixture = main's ci.yml `84ba61b`;
- the `--remerge-diff` of `7abdb03` is clean, taking the workflow side for tests and main's copy of the records;
- PR55-SEC-11 item 1 is closed (shared `workflowEnvKeyFindings`);
- R2-n1 names and R2-n2 empty env both work.

**PR59-SEC-01 (LOW, TASK-287 before any other workflows PR):** checkout and setup-node `with:` inputs are unpinned (G1-G7: 0 findings).
- HEAD-preserving edits (`persist-credentials`, `submodules`, `path`) escape a policy that could catch them.
- HEAD-changing edits (`ref:`/`repository:` to a crafted merge, second parent = PR head) pick their own tested base. This is circular for ci.yml PRs, as in stage 1.
- Fix: pin the `with:` maps, plus a two-step `HEAD == $GITHUB_SHA` check in `TESTED_BASE_SCRIPT`.
- **Control for any ci.yml PR:** the orchestrator checks that the record exists and names the head.

**PR59-SEC-02 (INFO, 015-C):** in lane-c/nightly, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_DIR`, `GIT_EXEC_PATH`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `DOCKER_HOST`, `DOCKER_CONFIG` and `ACTIONS_ALLOW_UNSECURE_COMMANDS` pass.

**Interim-rule ruling** (applies to stage-2 final runs; all of these still apply to stage-1 runs):
- the 24 h rule ends;
- the D-ORCH-103 P1 (c) widening ends;
- P1 is mechanical for inherited proofs and stays procedural at merge time.

**Merge facts:**
- The record push will be BLOCKED: proof run 44011154025 (03:34:23Z) was voided by PR #54 `44637dd` (03:45:24Z, `eslint.config.mjs`, `tools/eslint-rules`, `tests/fixtures`). A union with main plus a full run is needed.
- The record survives the union only if the run's event base is the new merge base (sim S5 pass, owned 11). With the stale base `a7e06fb`, the PR #54 owned paths join the set (S5', owned 74), and a round-2 record would be needed.

**Fact correction:** event `pull_request.base.sha` is NOT always the merge base.
- Run 44011154025 (PR just opened) had base.sha = main tip `083bd96`, with merge base `a7e06fb`.
- PR #46's synchronize run had base.sha = the merge base.

**Kit:** `mut8.mjs` (checkout inputs), `mut9.mjs` (lane-c env names), `recsim3.sh` / `recsim3b.sh`, and the `r3/` extract layout (`live/`, `head/` with the stage-1 fixture as ci.yml, `main/`, `s2/`).

Related: [[project-p5-pr55-task286-policy]], [[project-p5-pr46-mo]], [[project-security-review-conventions]]
