---
name: project-host-resource-limits
description: The Windows dev host runs out of RAM and disk under parallel agents; caps and cleanup rules that keep the pipeline running
metadata:
  type: project
---

The single Windows host is the bottleneck for this run: memory (agents reaped under load → D-ORCH-010: ≤ 3 build agents, heavy commands serialized via a docker.lock directory) and disk (hit 100 % on 2026-11-13 with ~33 git worktrees each holding a ~0.66 GB node_modules → D-ORCH-048).

**Why:** every task gets its own worktree + `npm ci`; Testcontainers/Docker images accumulate; nothing cleans up automatically. Worktree removal via git was denied by the auto-mode classifier as destructive, but deleting a merged worktree's `node_modules` (regenerable) is allowed.

**How to apply:**
- After each PR merge, delete that worktree's `node_modules`.
- Check `df -h /c` before dispatching heavy runs; keep ≥ 20 GB free.
- Keep build agents ≤ 3 and route all Docker/heavy runs through the lock directory (owner file, re-verify — the scratchpad was once wiped by another process, D-ORCH-038).
- Docker Desktop's VHDX does not shrink by itself; image/volume pruning or VHDX compaction needs the user.
- Keep orchestrator helper scripts (poll-lane.sh, trace-status.mjs) in `../.orch` next to the repo — both the system temp dir and the session scratchpad got wiped mid-run by other agents' cleanups.
