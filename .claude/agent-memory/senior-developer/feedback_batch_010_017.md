---
name: batch-010-017-lessons
description: TASK-010/017 (2026-11-13) - lead contract + 3 opus specialists finished first time; pitfalls with commitlint body length, generated files vs repo meta-tests, docker.lock contention, main moving with code
metadata:
  type: feedback
---

Lead-written contract first, then one area per specialist, worked again: 3 opus specialists (58, 82, 67 tool uses) all reported; I did the apps-side wiring of both tasks myself in parallel (~150 own calls total incl. two full gate rounds).

**Why:** single-area briefs plus a committed types/loader contract avoid turn-limit stops ([[p5-dispatch]], [[batch-04-07-lessons]]).

**How to apply / pitfalls:**
- commitlint enforces `body-max-line-length` and `footer-max-line-length` 100. `git commit -m "<long paragraph>"` fails it; write bodies wrapped via heredoc. Unpushed fix: `git reset <recorded sha>` (never origin/main), re-add groups, check `HEAD^{tree}` unchanged.
- A generated file (openapi `types.gen.ts`) trips repo meta-tests: `tools/repo/gitignore.test.ts` wants ESLint's FIRST `globalIgnores` block to mirror `.stylelintignore` (put single generated files in a second `globalIgnores([...])`); `tools/repo/root-scripts.test.ts` NON_WORKSPACE_PROJECTS lists non-workspace tsconfig refs; v8 coverage counts type-only files as uncovered lines (exclude `!**/*.gen.ts` in jest.config.ts).
- New `apps/api/src/platform/**` files imported by `platform/db/runtime.ts` must be added to `tools/tsconfig.json` `files` (TS6307).
- supertest per-request servers flaked with ECONNRESET on a 1.6 MB body; use one `app.listen(0)` + `fetch` in that test.
- Another session held `docker.lock` >10 min; my gate script just waited. Kill a waiting gate script (not one holding the lock) before merging main into the worktree.
- Main merged a code PR (TASK-016) mid-task and a sheet fold added a routed item: fetch and re-read the task sheets on origin/main before the final gate round, then merge and run the full gate once on the merged head.

Related: [[merge-main-pass]], [[lane-a-merge-pitfalls]]
