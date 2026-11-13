---
name: batch-021-011-lessons
description: TASK-021/011 (2026-11-13) - 5 opus specialists in 2 rounds all reported; never background with `&` in Bash (collided npm ci); port suites find real gaps; lane B checker activation caveat
metadata:
  type: feedback
---

All 5 opus specialists reported, with 50–107 tool uses each, in two rounds of up to 3 at a time. TASK-011 was split into runner and verifier, and the verifier wrote the shared lib (manifest/junit) first, with a status file the runner waited on. TASK-021 was split into SQL+catalog, shadow+linter and the spike port. I wrote the contracts first (`tools/db/audit-external-tables.ts`, `tools/quality/summary.schema.json`) and did the apps-side readiness and mapDbError work myself.

**Why:** a single-area brief, a committed contract and status-file hand-offs between specialists ([[batch-04-07-lessons]], [[p5-dispatch]]).

**How to apply / pitfalls:**
- **Never start a background job with `cmd &` in the Bash tool.** `ps`/`sleep` checks said it had died, but it kept running. A rerun via `run_in_background` then raced it: two `npm ci` runs on the same node_modules, and deps:rebuild failed. Use `run_in_background: true` only.
- **Ask a port task to report what it found.** The SPK-08 port found a real guard gap: ADD CONSTRAINT / RENAME CONSTRAINT can squat a partition name through the backing index. The specialist pinned it as a known gap. Because the bootstrap file was not yet applied anywhere shared, I fixed it in place in the same PR and flipped the pin to `[]`.
- **A guard fix can break test fixtures.** A stricter guard broke a fixture that relied on the old behaviour; the fix was to suspend the event trigger only for that setup statement.
- **Root `prisma.config.ts` changes reach the fixture configs.** `tables.external` changes must also go into `prisma/tests/fixtures/*/prisma.config.ts`, otherwise P3005 in up-down-up.
- **`quality:check-evidence` reads the BASE manifest.** Every suite is still `planned`, so it requires nothing yet. A PR that activates a suite and commits its first JUnit will fail rule 4: activate in a manifest-only PR first.
- **Main moved with code mid-batch (TASK-004).** Merge, run `npm ci` and re-gate each branch. TASK-004 added the `unit-dom` Jest project, so any tool that hard-codes `--selectProjects unit` must change.
- **Expected lane A result for a security-owned-path PR:** fast-lane green and only "Security-owned paths need a review record" red.

Related: [[merge-main-pass]], [[lane-a-pr-hygiene]]
