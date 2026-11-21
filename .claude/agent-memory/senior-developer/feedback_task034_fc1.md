---
name: task034-fc1
description: TASK-034 fix cycle 1 lessons - draft worktree while lane B holds the task worktree, PGlite SQL probes without Docker, COALESCE is syntax, loop-circular any, wait loops
metadata:
  type: feedback
---

- **Lane B holds the task worktree:** draft in a detached `git worktree add --detach ../Shipqube-TASK-xxx-draft <head>`
  (no node_modules, so no junctions), then `git -C draft diff --binary > p; git -C task apply p`, copy untracked
  files, `git worktree remove --force` the draft. Prettier and tsx probes can run from the TASK worktree's node_modules
  against draft paths (`node ../Shipqube-TASK-xxx/node_modules/prettier/bin/prettier.cjs`). Saved ~40 min of idle wait.
- **Generated SQL needs a real parser before lane B:** `@electric-sql/pglite` is in node_modules; a tsx script that
  imports `file:///<worktree>/node_modules/@electric-sql/pglite/dist/index.js` runs catalog/manifest SQL (PG 17) with
  no Docker. Lane B caught `pg_catalog.coalesce(...)` (42883): COALESCE, NULLIF, GREATEST, LEAST are syntax, never
  schema-qualify them even under a "qualify everything with pg_catalog" convention.
- **typescript-eslint `no-unsafe-assignment` "any" with tsc green:** a `const` in a loop that depends on a `let`
  later assigned from it (state machine flags) infers circularly; annotate `: boolean`.
- **Waiting:** foreground until-loops are moved to background after ~180 s; use loops capped at ~170 s, or one
  `run_in_background` until-loop with a deadline.
- **Unit-test related files fast:** `jest --selectProjects unit --runInBand --findRelatedTests <changed sources>`
  (23 suites in 24 s) covers dependents that a path pattern misses.

**Why:** each cost or saved a round trip on a loaded host in TASK-034 fc1 (2026-11-21).
**How to apply:** any fix cycle that must wait for the orchestrator's lane B, or that adds generated SQL.
Related: [[feedback_pr23_fc1]], [[feedback_lane_b_evidence_run]]
