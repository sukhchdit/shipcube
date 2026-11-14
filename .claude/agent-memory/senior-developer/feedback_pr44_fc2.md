---
name: pr44-fc2
description: PR #44 (020-C) fix cycle 2, 2026-11-14 - D-ORCH-073 entry-point testability pattern (startApi + thin main.ts) that passes the diff-coverage gate; detached evidence worktree; merge semantic conflict caught by unit
metadata:
  type: feedback
---

D-ORCH-073 made the API entry point testable instead of excluding it from the gate. Lane B passed (run 20261114T0902Z_035687c), and the diff-coverage cases for main.ts and start-api.ts passed. Mutation check: 17/17 killed.

**Why:** an entry point with top-level await cannot be loaded under the CommonJS Jest transform. The only route the gate and the safety classifier accept is real executed coverage.

**How to apply (entry points, e.g. the worker's main.ts when a PR touches it):**
- Composition goes in `apps/<app>/src/start-<app>.ts` (same depth as main.ts, so the `import.meta.url` relative URLs stay valid). The function is `start(overrides: Partial<Deps> = {})` with `{ ...PROCESS, ...overrides }`.
- Production defaults should be plain references (`loadConfig: loadRuntimeConfigOrExit`, `processEvents: process`). The one unavoidable arrow (`exitProcess: (code) => process.exit(code)`) is covered with `jest.spyOn(process, 'exit').mockImplementation(...)`.
- main.ts is just `start().catch(raiseStartupError)`. `raiseStartupError` takes `schedule = queueMicrotask` and re-throws, so the installed handlers still log `process.uncaught_exception`.
- main.test.ts uses `jest.mock('./start-api.js', factory using mock* consts)`, then `jest.resetModules()` and `await import('./main.js')`. This works once top-level await is gone.
- Use fake timers suite-wide, with `doNotFake: ['setImmediate','nextTick','queueMicrotask']`. Otherwise the 1 s fallback timer of exitAfterFlush triggers "worker failed to exit gracefully".
- To kill an "unflushed exit" mutant, the fake stdout must be able to hold its write callbacks.
- `git worktree add <path> <branch>` fails while the PR worktree has the branch checked out. Use `--detach <sha>`, commit the evidence there, then run `git merge --ff-only <sha>` in the PR worktree before pushing. You can re-point a clean evidence worktree with `checkout --detach` after a docs-only main merge.
- Always run the full unit suite after merging main with code. Here it caught a semantic conflict (this PR's lane-timeout guard against PR #43's new RLS suite) that typecheck, lint and git did not.
- `git show origin/main:.gitleaks.toml` needs `MSYS_NO_PATHCONV=1` in Git Bash.
- For the security delta, the scans log line "names <sha>, but ..." gives the authoritative list of owned paths changed since the record. It includes paths that came in through main merges.

Related: [[pr44-fc1]], [[lane-b-evidence-run]], [[p5-dispatch]]
