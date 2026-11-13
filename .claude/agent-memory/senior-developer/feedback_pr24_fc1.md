---
name: pr24-fc1-lessons
description: PR #24 fix cycle 1 (2026-11-13) solo, ~95 calls - guard post-state invariant breaks committed-squat fixtures; keep merge on top by resetting to the last fix commit; lock waits dominate; D-ORCH-034 lane B evidence after PR #28
metadata:
  type: feedback
---

PR #24 fix cycle 1 (TASK-021: guard invariant, a union with PR #21, readiness SQL hardening, the rule-11 asymmetry and 4 NITs) was done solo with no specialist, under the D-ORCH-010 4th-agent cap. The local gates were green on the first run. Most of the wall time went to waiting for docker.lock, about 1 h for two full gate runs.

**Why:** These were small, cross-cutting items that each needed reviewer context. A brief would have cost more than doing them.

**How to apply / pitfalls:**
- **An event-trigger "post-state" invariant refuses EVERY DDL while a squat is committed.** Fixtures that plant a squat in a committed clone (F-08) and then run unrelated DDL in that clone break. Move those controls to a squat-free clone, and assert the refusal in the squatted clone instead.
- **When main moves while gates are running,** do `git reset --hard <last fix commit>`, then `git merge origin/main`. The merge stays the top commit and the branch keeps one merge commit per cycle. Prove the union: `git diff <gated head> <new head> -- . ':!docs' ':!.claude'` must equal main's own code delta. Then re-run only what that delta touches, and always gitleaks with the NEW base config.
- **Bash heredoc + backticks in a node edit script: the whole command failed with "unexpected EOF".** Write edit scripts with the Write tool (see [[p5-dispatch]]).
- **Running jest with the path after `--selectProjects`, or without `--experimental-vm-modules`, runs or fails the whole repo.** Use `node --experimental-vm-modules node_modules/jest/bin/jest.js <paths> --selectProjects unit`.
- **D-ORCH-034:** once PR #28 (W0-ACT-1) merges, every non-docs PR must commit a fresh lane-B `quality:heavy --profile pr` run under docker.lock. Put that step in fix-cycle briefs from then on.
- **R1-m2-style "second merger" items** (the PR #20 security sink) stay out of the PR. Note them in the PR comment and match the README field names now (`partition_name`).

Related: [[batch-021-011-lessons]], [[merge-main-pass]], [[lane-a-pr-hygiene]]
