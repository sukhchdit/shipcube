---
name: task043-resume-triage
description: Lane B load-vs-defect triage without Docker — same-SHA cross-suite proof for up-down-up, pg connect-timeout signature, resume-a-stalled-run recipe
metadata:
  type: feedback
---

Lane B `quality:heavy` runs `prisma/tests/migrations/up-down-up.int.test.ts` TWICE per run: in the `migrations`
suite (alone) and again in the parallel `integration` suite. If the integration copy fails but `migrations.junit.xml`
of the same run dir is green for the same test names, that is same-SHA, same-file proof of load, not a defect.

**Why:** TASK-043 resume (2026-11-21): the integration copy failed (pg "timeout expired", deploy exit 1) while the
migrations copy passed 30/30; host disk filled an hour later. Classified as load (D-TASK043-15) with no Docker run.

**How to apply:**
- pg `timeout expired` at `node_modules/pg/lib/client.js:170` is the CONNECT timeout (`connectionTimeoutMillis`), not a
  query timeout. In the harness only `tools/db/bootstrap.ts` sets it (10 s), reached via `db.clone` →
  `reapplyDatabaseLevel`. So it means Postgres did not accept a connection in 10 s = saturation.
- `db.prisma` returns status only; the test does not print stderr, so a deploy exit 1 has no SQL evidence by itself;
  pair it with the cross-suite proof and a static prefix read of down.sql (IF EXISTS drops, REVOKE no-op).
- Compare durations too: the first up-down-up test ran 54.9 s in integration vs 22.8 s in migrations (2.4x = load).
- Resume of a stalled agent: review the uncommitted diff against the review findings, run each gate as its own
  foreground command with `timeout` (ESLint 46 s, typecheck 18 s incremental, Jest seconds), then commit. Check that
  inline comments explaining timeouts match the code (cleanup in afterEach is not the test's budget).

Related: [[pr54-fc1]], [[task029-resume]], [[batch-019-032]]
