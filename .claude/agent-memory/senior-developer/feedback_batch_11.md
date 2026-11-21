---
name: batch-11-lessons
description: Wave 1 batch 1.1 (TASK-035/036/037, 2026-11-17) - solo three-task run, diff-coverage fails type-only new files, BullMQ id/name rules, tenant-key models in the std-columns extension, mid-run lock handover
metadata:
  type: feedback
---

There was no Agent tool in this session, so I built all three batch 1.1 tasks myself (about 300 calls). Mid-run, the orchestrator took over every heavy run (session A owns docker.lock). I then pushed code-only PRs and handed over the detached task worktrees as the evidence worktrees.

**Why:** these traps cost one evidence run each, or will recur in later batches.

**How to apply:**
- **Type-only new files fail the diff-coverage gate.** A new `.ts` file that holds only `export type …` reported 0/11 changed lines. Put such types in an existing runtime module (e.g. `define-route.ts`). A re-export `index.ts` is fine as long as a test imports it.
- **BullMQ 6 limits:** a queue name may not contain `:`, and a custom job id may contain `:` only with exactly 3 parts. ADR-0013's `<queue>:dead` and `outbox:<id>` are impossible; I used `<queue>-dead` and `<kind>.<id>[.<step>]`.
- **The standard-columns extension stamps `id = uuidv7()`.** Under RLS `WITH CHECK id = app_org_id()` or `id = app_actor_id()`, no organisation or user could be created through Prisma. TASK-037 added tenant-key models: Organisation takes the context org, User takes the context actor.
- **Order for the first tenant migration:** `app_is_operator()` must exist BEFORE the RLS blocks, because the operator policies call it. Under FORCE RLS the migrator (and so the reference seed) cannot read or write those tables afterwards, so reserved rows go in before ENABLE + FORCE.
- **C15 (b):** a BEFORE ROW trigger whose name sorts after `trg_<t>__std_columns` is flagged. Make a raise-only check an AFTER trigger, or give it a name that sorts earlier.
- **Lock queue:** before launching a lock waiter, check the `owner` file. When the orchestrator claims the lock, kill your own waiters by PID, never theirs. Their trap releases only on an owner match.
- **Bash heredoc:** an apostrophe inside a `node -e '…'` body breaks quoting. A big multi-file `cat <<'EOF'` failed with "unexpected EOF". Use the Write tool.
- **Lane A on a code-only push:** expect only "Lane B evidence (check-evidence)" and the "security record" step to be red, as long as all other fast-lane steps are green.

Related: [[pr44-fc2]], [[lane-b-evidence-run]], [[task024-rls-generator]]
