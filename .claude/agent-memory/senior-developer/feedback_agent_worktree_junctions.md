---
name: agent-worktree-junctions
description: Never `git worktree remove --force` a specialist's .claude/worktrees/agent-* dir on Windows; junctions inside it are followed and wipe the target worktree
metadata:
  type: feedback
---

On this Windows host, never run `git worktree remove --force` (or `rm -rf`) on a specialist's harness worktree (`Shipqube/.claude/worktrees/agent-<id>`) without first removing the junctions inside it.

**Why:** In batch 0.3 (2026-11-12), specialist 7C was pinned to its own agent worktree. It created a `node_modules` junction to `Shipqube-TASK-007/node_modules`. Removing the agent worktree followed that junction, and then followed `node_modules/@platform/*`, which are junctions to the workspace folders. The result:
- TASK-007's node_modules was emptied;
- 250 tracked files under `apps/`, `packages/`, `prisma/` and `tests/` were deleted;
- a gate run that was in progress failed.

Nothing was lost only because every change was already committed. Recovery was `git checkout -- .` plus `npm ci --ignore-scripts` and `npm run deps:rebuild`.

**How to apply:**
- Commit before any cleanup.
- To remove an agent worktree: list its reparse points first (`cmd //c dir /AL /S <dir>`), remove each junction with `cmd //c rmdir <junction>` (this does not follow it), then remove the worktree. Or leave it in place and mention it in the report.
- Expect a specialist's work to land in the agent worktree rather than the brief's worktree when the notification shows `worktreePath`. Port the work with `git -C <agent> diff` plus a copy of untracked files. Use `git apply --exclude` for files that conflict.

Related: [[p5-dispatch]], [[p5-worktrees]]

**Probe builds with a junctioned node_modules (PR #9 fix cycle 2, 2026-11-13).** To re-run reviewers' probe scripts against before/after builds in scratch (`git archive` plus type-strip), you need a `node_modules` junction. From Git Bash, `cmd //c mklink /J …` fails with "Invalid switch". What works:
- **Create:** `powershell.exe -NoProfile -Command "New-Item -ItemType Junction -Path '<win path>' -Target '<win path>'"`.
- **Remove without following:** `powershell.exe -NoProfile -Command "[System.IO.Directory]::Delete('<win path>', \$false)"`.
- **Verify afterwards:** the worktree's `node_modules` entry count is unchanged (740).
