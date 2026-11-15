---
name: task020d-resume
description: TASK-020 020-D resume after the D-ORCH-091 outage (2026-11-15) - leftover mutant in the tree, full integration finds guard-vs-test unions, host overload blocks evidence, entry-point comment rule
metadata:
  type: feedback
---

Resuming 020-D took about 150 calls and roughly 5 h wall. Code was finished and gated, but no push was made: lane-B evidence was blocked by host overload.

**Why:** these traps apply to any resumed task, and to any PR that adds a runtime guard.

**How to apply:**
- **An uncommitted edit left by an interrupted agent can be a live MUTANT.** Here it was `; else` in raw-sql-lexer.mjs, from a lead-mutants.mjs run. Check the scratch mutant logs to see where the run stopped, then `git checkout` the file. Write mutants so they stay syntactically valid (`if (false && ...)`); a syntax error "kills" a mutant vacuously.
- **A new runtime guard can break EXISTING integration tests that use the refused form on purpose.** Here `session-scope-leak.int` planted a leak through TenantDb. Unit runs and targeted int files did not show it; only the first full lane-B run did. Run the full integration project, or grep `prisma/tests` for the refused forms, before the evidence run. The fix shape: assert the refusal, then plant through the guard's documented residual (a migrator-created plpgsql function).
- **Comments in `apps/*/src/main.ts` count for the diff-coverage gate,** because the file is measured only in a child process. Comment-only fixes are fine in in-process files (start-api.ts, config-exit.ts). Defer main.ts comment fixes to the PR that makes the entry point testable.
- **Host overload, not code:** with about 18 agent node processes running, the unit pre-gate took 1046-1568 s instead of 170-210 s, and even in-band re-runs timed out (deadline checks hit 10-31 s against 1-2.5 s bounds). Cheap load probe: a node loop of 2e8 additions. At about 1.3-3.8 s, evidence will not pass. When the brief says one push, hand back rather than push code without evidence.
- `taskkill //T //F //PID <win pid>` (the Windows PID comes from `ps -W`) stopped my own runaway heavy run and its jest children. The run script then released the lock via its owner check, and no run dir was written.
- Kill your own lock-waiting background jobs before handing off (`ps -ef | grep lock.sh`, then `kill`).
- When a main merge lands mid-run, re-check the brief's "not on main" deferrals: config-exit.ts became fixable after PR #39 merged.

Related: [[task020c-lessons]], [[pr39-push]], [[lane-b-evidence-run]], [[p5-dispatch]]
