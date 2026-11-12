---
name: p5-worktrees
description: P5 task work must happen in a dedicated git worktree (../Shipqube-TASK-xxx), never in the shared main checkout; plus Windows install/network quirks seen in TASK-001
metadata:
  type: feedback
---

Do P5 task implementation in a dedicated worktree (`git worktree add ../Shipqube-TASK-xxx <branch>`), not in the main checkout at `Shipqube/`.

**Why:** During TASK-001 (2026-11-12) other agents (security-analyst / qa-lead) edited `docs/05-quality/**` in the main checkout while I had switched it to my task branch; their uncommitted edits showed up in my `git status`. Committing from there risks sweeping their work into a task PR, and switching branches under them breaks their work.

**How to apply:**
- Create the worktree first, before writing any files. Leave the main checkout on `main`.
- Stage files explicitly (`git add <paths>`), never `git add -A`, even in the worktree.
- First `npm install` of the full baseline on this host took ~10+ min and once died with `ECONNRESET`; use `--fetch-retries=6 --fetch-retry-maxtimeout=120000` and run it in the background. Windows Defender causes `EPERM rmdir` cleanup warnings that are harmless.
- Foreground `sleep` is blocked in Bash; wait for background-task notifications instead of polling loops.

Related: [[plan-generation-workflow]]
