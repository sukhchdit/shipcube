---
name: p5-dispatch
description: How P5 specialist dispatch actually behaves on this host — 80-turn limit on M tasks, salvage of uncommitted work, memory-reaped verification, denied .env.example reads
metadata:
  type: feedback
---

Developer specialists stop at an 80-turn limit, and an M-size task with several binding follow-ups usually exceeds it. In batch 0.2 (2026-11-12), 4 of 5 dispatches stopped there: TASK-002, TASK-004 (twice) and TASK-005. Only the opus database-engineer on TASK-003 finished, at 261 tool uses. They stop with work **uncommitted** and no report.

**Why:** Long briefs that make the agent re-read many ADRs and docs use up the turn budget before implementation and verification finish.

**How to apply:**
- Tell specialists to commit early and to deliver their report before they run low on turns.
- After a turn-limit stop, inspect the worktree (`git status`, then run the gates). If it's close to done, finish it myself: run the gates, review, commit in logical commits. This was quicker than re-dispatching for TASK-004 and TASK-005. Otherwise re-dispatch on opus with a "state found / remaining work" brief (this worked for TASK-002).
- Run the end-to-end verify script (a fresh `npm ci` plus all gates) in the background. It can be **reaped when the host is low on memory**. When that happens, do not restart it unprompted: report the partial evidence honestly in the PR body and say what still needs a re-run.
- Reading `.env.example` is blocked by a permission deny rule. Rely on the parity tests and leave content review to security-analyst.
- Write long PR bodies with the Write tool. A Bash heredoc containing backticks and apostrophes failed with "unexpected EOF".

Related: [[p5-worktrees]], [[plan-generation-workflow]]
