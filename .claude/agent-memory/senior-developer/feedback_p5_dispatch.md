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
- **Fix cycles worked better (batch 0.2 cycle 1, 2026-11-12):** all 4 specialists finished and reported. The briefs listed finding IDs plus exact review-file line ranges, said "do not read ADRs", set an explicit priority order and "past ~65 calls, write the report", and said "do NOT commit". I ran one gate script per PR serially in the background and made one commit per PR. A finding-heavy PR (PR #3, 9 findings) split cleanly across two agents in the **same worktree** with disjoint file ownership and one shared file (index.ts: "re-read before Edit, retry on conflict"). Their mid-run test failures were each other's in-flight edits and went green on re-run.
- Appending to `.env.example` without reading it works (`printf … >>` by the agent); the parity tests prove the content.
- Before writing `Refs:` trailers, check the task's story links in `docs/04-plan/task-map.csv`. Enablers like TASK-004 have none, and a wrong pushed trailer can only be corrected in a PR comment.
- Write long PR bodies with the Write tool. A Bash heredoc containing backticks and apostrophes failed with "unexpected EOF".

Related: [[p5-worktrees]], [[plan-generation-workflow]]

**Small fix cycles: do them solo (PR #3 cycle 2, 2026-11-12).** Four findings plus four NITs, all in one package, took about 60 tool calls including the serial background gate, with no dispatch. That was faster than briefing a specialist. Write scratch scripts that contain backslashes (regex, Windows paths) with the Write tool: a quoted Bash heredoc lost a `\` in `/\/g`.
