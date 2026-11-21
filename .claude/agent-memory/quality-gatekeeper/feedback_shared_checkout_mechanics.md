---
name: shared-main-checkout-mechanics
description: Other agents commit to the same main checkout while a verification runs; re-read HEAD before reporting something missing, and commit only through guarded one-shot commands
metadata:
  type: feedback
---

Main moves during a session: several agents commit docs to the same working directory. Re-run `git log --oneline -5` before writing any "not done yet" finding, and again right before committing.

**Why:** During D-QG-001 (2026-11-20) main gained five commits in one session. The plan fold D-SD-004 landed after I started, and I nearly reported "TASK-052 dispatch gate not folded" as a condition. Later another agent had `docs/sdlc/DECISIONS.md` staged mid-commit when I was about to append.
**How to apply:**
- Before appending to DECISIONS.md: require `git status -s docs/sdlc` empty AND `git diff --cached --name-only` empty; if not, wait for the other commit to land rather than touching the index. Then append + `git add <one file>` + assert the staged list + commit in one command.
- Write the entry and the commit message to scratchpad files and `cat >>` / `git commit -F`; a bash heredoc holding apostrophes failed here with "unexpected EOF".
- Use the Grep tool for repo-wide searches and ignore `.claude/worktrees/**` hits (a dozen stale copies of every doc); a recursive Bash `grep -r .` times out after 120 s.
- Local main is kept equal to origin/main: after the commit, fetch, check behind = 0, then a plain push (never force). A dispatch may say "do not push"; then leave it and say so in the report.

Running a branch head without touching its worktree (D-QG-008, about 15 s per Jest selection):
- Compiled code: import `apps/api/dist/**` of the task worktree by file URL from a scratchpad script (`createRequire` on its `apps/api/package.json` for express). Check first that the worktree is clean, at the head, and that `dist` is newer than the head commit.
- Jest: `git archive <sha> -- . ':(exclude)docs' ':(exclude)infra' ':(exclude)reports' | tar -x` into the scratchpad, plus `docs/03-architecture/api` (createApp reads `openapi.yaml`); copy `prisma/generated`; junction `node_modules` and `packages/carriers/node_modules` with `cmd //c "mklink /J <dst> <src>"`. The reporter prints totals only, so write a probe's numbers to stderr.
- **Remove the junctions with `cmd //c "rmdir <dst>"` when done and never `rm -rf` the extract while they exist**: a recursive delete through a junction would empty the worktree's `node_modules`.
- 300 loopback connections opened at once are refused on Windows (ECONNREFUSED); open the sockets one by one, then write all requests.
