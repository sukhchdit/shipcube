---
name: task041b-stacked-merge
description: Stacked-part merge after the base PR squash-merged (TASK-041B onto main, 2026-11-21) - explicit-base merge-tree recipe, merge --no-commit so a moving main costs only an abort, empty git add pathspec trap
metadata:
  type: feedback
---

When the base PR merges as a squash, the natural merge base of the stacked head and main is an OLD main commit, so
every file the base PR added shows up as an add/add conflict (17 here). The target is
`git merge-tree --write-tree --merge-base=<base-PR head the part was built on> <part head> <main>`.
Resolve: for each conflicted path, use the part-head blob if main did not change that path after the base head;
otherwise use main's blob or a hand union. Check that `git write-tree` equals the target tree and that
`cmp <(git diff --raw --abbrev=40 main W) <(git diff --raw --abbrev=40 base parthead)` matches byte for byte. The base
PR's own union (pipeline-guards imports) resolves to main's blob because the part did not change that file.

**Why:** the corrected D-ORCH-158 rule (D-SECPR040B1-01 s6). Taking the part-head blob blindly drops main's union.

**How to apply:**
- Run `git merge --no-commit --no-ff <full main SHA>` and finish the checks before you commit. main moved twice
  during the checks (docs only). Because nothing was committed yet, `git merge --abort` plus a rerun of the scripted
  resolution cost about 1 call. Check `git diff --name-only old new -- ':!*.md'` to show the code checks still hold.
- Trap: `git add -A -- $(empty list)` stages the WHOLE worktree. `git checkout <rev> -- f` already stages the file, so
  skip the add.
- Gitleaks needs Docker. When the brief says "no Docker", report gitleaks as not run.

Related: [[task041b-stacked]], [[pr80-unions]], [[supersede-branch]]
