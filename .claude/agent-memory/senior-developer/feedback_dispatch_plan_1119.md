---
name: dispatch-plan-1119
description: Dispatch-planning lessons 2026-11-19 (push freeze during PR CI start-up, slot reservation for gated critical-path tasks, Wave 2 pure packages as light-lane fillers, card staleness check by grepping routed IDs)
metadata:
  type: feedback
---

Do not push to main while a PR's lane-A run is starting: a main push during start-up makes the tested-base check fail closed. The coordinator may call a freeze. In that case leave the docs edit uncommitted and put the commit message in the handoff, or wait for "go".

**Why:** this happened to PR #72's run on 2026-11-19 and was called out mid-task.

**How to apply:**
- When planning dispatch with MAX_PARALLEL 4, the binding constraint is developer slots, not the serial lane-B queue (one run takes 15-20 min). A critical-path task with short gates (an ADR amendment, a security confirmation, a PR about to merge) gets a held slot, not "first slot that frees", because filler tasks hold a slot for hours.
- Wave 2 pure packages (TASK-075 carriers-core, TASK-076 pricing) depend only on TASK-001/002. They are on the TASK-089 demo-users closure (D-ORCH-126) and run unit-only lane B, so they are the best fillers.
- To find stale cards, grep `docs/04-plan/tasks/WAVE-*.md` and `generator/plan-data.mjs` for the finding and decision IDs routed since the last fold (D-ORCH-1xx, D-SEC-PRxx, PRxx-SEC-yy). A zero count means the fold is owed.

- **Locks do not show every overlap** (2026-11-20, D-SD-005). DB tasks with different locks still share `prisma/schema/platform.prisma`, `tools/db/table-classes/*.json`, `prisma/sql/grants.manifest`, the `grants-manifest.test.ts` count pin and the C15 committed literal. Before calling a batch "no overlap", diff the `f` items of the candidates and the in-flight branch (`git diff --stat main...<head>`), not just their `lk`. The api pipeline slots exist as stubs, for example `platform/idempotency/idempotency.ts`, so a slot-filling task does not need `pipeline.ts`.

Related: [[plan-fold-dsd001]]
