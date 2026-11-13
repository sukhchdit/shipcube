---
name: batch-276-277
description: TASK-276/277 (2026-11-13) - disk-full/Docker-hang blocker, drift in gherkin map vs stories, jest generated project merge traps, process-listing denied by auto mode
metadata:
  type: feedback
---

PR #34 (TASK-276) and PR #35 (TASK-277) were pushed without lane-B evidence because the host disk filled (npm ci ENOSPC in a new worktree) and Docker Desktop then stopped answering (`docker ps` times out, `docker info` prints nothing).

**Why:** about 30 merged-task worktrees each hold a full node_modules; the orchestrator recorded D-ORCH-048 for it.

**How to apply:**
- Before `npm ci` in a new worktree run `df -k /c`; a failed install leaves a partial node_modules (remove it with `fs.rmSync`, not `rm -rf`).
- Test `docker ps` with `timeout 20` BEFORE starting an evidence script: a hung daemon makes every Testcontainers hook wait its full 300 s and holds `docker.lock` for an hour. Auto mode refused process enumeration (PowerShell `Get-CimInstance`), so a wedged `quality:heavy` cannot be killed from here; the orchestrator must stop it.
- `Edit` needs a fresh `Read` per worktree path; `ed*.mjs` scratch scripts lose backslashes in heredocs (use the Edit tool for strings with `\\`).
- The platform logger redacts token/secret/e-mail values but not name, tax id or PAN values; use a name sentinel for a "dirty log" test.
- The committed `gherkin-test-map.md` (v1.0) drifted from the story files (US-066/121/129/137/222, 13 scenarios); the drift test pins them as KNOWN_DRIFT.
- Merging main into a harness branch conflicts in `jest.config.ts` (constants block, `common`): keep both sides, then re-apply `GENERATED_PATH` in `testPathIgnorePatterns`.

Related: [[lane-b-evidence-run]], [[p5-dispatch]]
