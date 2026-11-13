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

**PR #20 fix cycle 1 (2026-11-13): 2 opus specialists (free-text redaction 36 calls; lint guard 85 calls) + me on the walker, serializer, logger, security events and apps; lane A fast-lane + gitleaks green on the single push.** Pitfalls:
- The Bash tool strips backslashes even inside `cat > f <<'EOF'` (a `\d` became `d`, a `\r?\n` became a literal CR). Every script or edit containing `\` goes through the Write tool, then `node <file>`. Chaining `cmd && \` before a heredoc is a syntax error; put each heredoc command on its own line.
- `commitlint --from <old PR sha>` after a merge of main also lints main's commits (sentence-case docs subjects); use `--from origin/main`. Never chain `git push` after a `grep` of commitlint output: grep's exit 0 let the push run.
- Run new fast-check property suites several times before committing: a random seed in the gate found a real bug (`apiKey :<v>`) that the specialist's runs missed.
- Main merged code (TASK-004) while my gate ran: the base-ref fixture step failed against the NEW base's lint-wiring test. Re-merge main, re-install, re-run the full gate; when main then moves docs-only, reset to the pre-merge fix commit and re-merge (keeps one merge per pass).
Related: [[lane-a-merge-pitfalls]]
