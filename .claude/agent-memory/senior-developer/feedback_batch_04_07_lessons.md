---
name: batch-04-07-lessons
description: TASK-012/023 (2026-11-12) dispatch pattern that finished first time, plus git/commitlint/shell/jest-realm pitfalls hit while landing them
metadata:
  type: feedback
---

**Lead writes and commits the contract, specialists split by side. All 4 specialists finished (27–67 tool uses).** On TASK-023, I committed `prisma/seed/framework/contracts.ts` first. That commit also covered the workspace deps and the lock refresh. The briefs then named the exact exports each side needed from the other. One specialist owned the DB/runner/CLI side and one owned the pure policy side. On TASK-012, two opus database-engineers owned disjoint test files. A general-purpose agent did the RDS desk research, because database-engineer has no web tools. Non-owners wrote findings to scratch files, and I merged those into the record with a script.

**Why:** In earlier batches a single specialist on an M task hit the turn limit. A fixed contract removes the cross-agent guessing.

**How to apply / pitfalls:**
- Never `git reset --soft origin/main` to rewrite unpushed commits after any `git fetch`. The fetch is shared by every worktree, so the reset silently re-bases onto the new main, and the working tree then shows main's doc changes as reverts. Reset to the recorded base SHA instead, or run `git checkout -- <paths>` if it already happened.
- commitlint `subject-case` rejects subjects that start with an upper-case ID, for example `test(db): SPK-08 …`. Start the subject with a lower-case word and run commitlint before the first push.
- `node -e "…"` with backticks inside double quotes gets shell command substitution, which silently eats text. Use a script file written with the Write tool.
- `gates.sh` custom steps can't contain spaces: the step name becomes the log filename. `wave0/gates2.sh` adds a `coverage` step that takes docker.lock.
- Under Jest's VM modules, `instanceof Error` is false for pg/socket errors from another realm. Use `util.types.isNativeError` in catch paths.
- The repo had no CI checks on PRs at that point (the TASK-007 workflow was not yet merged), so `gh pr checks` reports none.

Related: [[p5-dispatch]], [[merge-main-pass]]
