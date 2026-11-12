---
name: scratch-copy-technique
description: How to run mutation experiments (inject type errors, etc.) on a PR without touching the read-only worktree, and the junction and shared-scratchpad pitfalls
metadata:
  type: reference
---

To experiment without touching the review worktree:
1. Run `git -C <worktree> archive <sha> | tar -x -C <scratchpad>/<unique-dir>`.
2. Run `cmd //c "mklink /J <copy>\node_modules <worktree>\node_modules"` (junctions need no admin rights).
3. Run Jest directly as `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --testPathPatterns <name>`.

Pitfalls:
- **The scratchpad is shared with other agents in the same session.** Generic names like `r2` collide: in PR #1 round 2 I extracted over the security-analyst's working copy. Use a reviewer-specific name (e.g. `code-reviewer-pr<N>-r<round>`) and run `test -e` before extracting.
- Projects whose `tsBuildInfoFile` sits under the ROOT `node_modules/.cache` (the `tools` project) would write through the junction into the worktree. Drop them from the copy's solution file before running `tsc -b`.
- `@platform/*` links in node_modules point to the worktree's packages, not the copy's. For cross-package tests, add a local junction in `<copy>/apps/api/node_modules/@platform/<pkg>`.
- Cleanup: remove every junction with `cmd //c rmdir <path>` BEFORE `rm -rf` on the copy, or the delete may follow into the worktree's node_modules. Afterwards, check the worktree's node_modules count (693 at PR #1 r2) and `git status`.

**Why:** reviewers have no write access, but claims such as "typecheck catches errors in any workspace" need injection tests.
**How to apply:** use this whenever a PR's correctness claim needs mutation testing. See [[project-review-conventions]].
