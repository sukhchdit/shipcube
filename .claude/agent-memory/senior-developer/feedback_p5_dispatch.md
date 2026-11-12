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

**Batch 0.3/0.4 pull-forward (TASK-008/009/013, 2026-11-12):** all 3 specialists finished and reported (59, 67, 107 tool uses). What worked:
- A host-wide Docker lock (`mkdir <scratch>/wave0/docker.lock` = atomic, `rmdir` after). Specialists and my gate script (`until mkdir …; do sleep 15; done`) used it. Remove it yourself if a reaped run leaves it behind.
- Specialists do not get `npm ci` themselves. I ran one serial background install for all worktrees, and briefs said "wait for `== NNN exit 0` in <bg output file>".
- Docs or web-research tasks go to `general-purpose`. `backend-developer` has no WebFetch/WebSearch.
- Specialist sandboxes are pinned to `.claude/worktrees/agent-<id>`, which blocks Bash heredoc writes and compound `cd X && git …`. Tell them to use the Write tool and `git -C <worktree>`.
- `jest --selectProjects integration <path>` treats the path as a project name and runs every integration suite. Put the path first: `jest <path> --selectProjects integration`.
- The full gate run was reaped again during `test:integration`. Once free memory recovered (check with `Get-CimInstance Win32_OperatingSystem`), I ran only the affected integration files serially (`-i`) in the foreground and reported that honestly in the PR.

**Batch 0.3/0.4 fix cycle 1 (PRs #6-#8, 2026-11-12): about 75 of my own tool calls, all three specialists reported (61-82 tool uses each).** Setup: general-purpose for the docs PR (it needs WebFetch to pin source SHAs), opus database-engineer for the spike test, and opus backend-developer for authz Part A, while I did Part B in the same worktree with disjoint file ownership. What worked:
- Merge `origin/main` into every worktree before dispatching, so specialists edit the final base.
- One background gate script per PR, run serially, with the Docker steps behind `docker.lock`. Full integration plus coverage finished this time, in about 4.5 min for PR #8.
- The architect published rulings that touched these PRs while the cycle ran. Re-fetch before pushing. If main's delta is docs-only, the evidence is: a normal merge, `git diff <gated> HEAD -- . ':!docs' ':!.claude'` is empty, and a re-run of lint, format and unit only.
- A specialist's sandbox may refuse the one-line `bash -c` lock loop. A scratchpad script that runs the same protocol works.
- To pin a generated file by SHA: drop the pin, run the generator, hash the output, then add the pin back.
