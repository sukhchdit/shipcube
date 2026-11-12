---
name: scratch-copy-technique
description: How to run mutation experiments (inject type errors, etc.) on a PR without touching the read-only worktree, and the junction pitfalls
metadata:
  type: reference
---

To try changes without modifying the review worktree, run `git -C <worktree> archive HEAD | tar -x -C <scratchpad>/repo`, then `cmd //c "mklink /J <copy>\node_modules <worktree>\node_modules"`. Junctions need no admin rights.

Pitfalls:
- Projects whose `tsBuildInfoFile` sits under the ROOT `node_modules/.cache` (the `tools` project) would write through the junction into the worktree. Drop them from the copy's solution file.
- `@platform/*` links in node_modules point to the worktree's packages, not the copy's. For cross-package tests, add a local junction in `<copy>/apps/api/node_modules/@platform/<pkg>`.
- Cleanup: remove every junction with `cmd //c rmdir <path>` BEFORE `rm -rf` on the copy, or the delete may follow into the worktree's node_modules. Afterwards, check the worktree's node_modules count and `git status`.

**Why:** reviewers have no write access, yet claims like "typecheck catches errors in any workspace" need injection tests.
**How to apply:** whenever a PR's correctness claim needs mutation testing. See [[project-review-conventions]].
