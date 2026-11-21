---
name: task045-merge-task298
description: Session C 2026-11-21 - TASK-045 merge-with-main + lane B, TASK-298 built solo (no Agent tool in a subagent), bootstrap FK outside a ruling's count, lane-B queue competition
metadata:
  type: feedback
---

- **A subagent session has no Agent/Task tool.** The orchestrator asked me to "dispatch a database-engineer"; there was
  no tool for it, so I built TASK-298 myself (S task, about 25 calls for code + unit + lint).
  **Why:** spawning is only possible from the top-level session. **How to apply:** when briefed to dispatch from a
  subagent, check the tool list first; write the brief anyway (it is a deliverable), build solo, say so in the handoff.
- **A ruling's "the N merged keys" may count migrations only.** D-ARCH-215 said 13 FKs, all RESTRICT; the bootstrap lane
  (`prisma/bootstrap/10-audit.sql`) has a 14th, `fk_audit_pii_vault__subject`, with no action (NO ACTION). Grep
  `prisma/bootstrap` too before writing a "committed: 0 findings" catalog assertion. I pinned exactly that one finding
  (D-TASK298-01) and routed it (D-SD-013) instead of adding an exception map the ruling forbade.
- **Merge message via `-m` paragraphs fails commitlint body-max-line-length (100).** Write the merge message to a file
  and `git merge -F`; redo an unpushed merge with `reset --keep <branch head>` and prove tree equality.
- **Lane-B queue competition:** other sessions' queue scripts poll every 30 s and grab `docker.lock` first; my run
  waited behind 040B, 051 and a chore run (about 1.5 h). Grep only the last lines of `queue.log`
  (`tail -3 | grep START ...`); a plain grep matches old runs of the same worktree.
- **Main-wide lane-B FAIL classes on 2026-11-21** (D-ORCH-170): gitleaks-full extra fingerprints (PR080-SEC-07, #85)
  and `compose-stack.test.ts` Valkey 9.1 (#49, fixed by #86). A merge of main made after `1a2b9d7d` adds no gitleaks
  fingerprint of its own (D-DEVOPS-001).

Related: [[pr80-unions]], [[task040b1-stacked-merge]], [[merge-main-pass]]
