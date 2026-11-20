---
name: project-p5-task039
description: TASK-039 (job_executions ledger, queue-retention scheduler, retention bounds) r1 @64eefab, r2 @766ae52, r3 @f08948e (16274d79) PASS_W_F-U; PR64-SEC-11 closed on lane B; D-TASK039-01 accepted with conditions (i)-(iv); LOW 01 sync-throw deadline crash, 02 global job_key (D-ARCH-171 fixes) (all closed r2); BullMQ INFO/ACL facts; probe kit
metadata:
  type: project
---

TASK-039 pre-push round 1 at code head `64eefab` (base `7da0e50`), 2026-11-20. Verdict PASS_WITH_FOLLOW-UPS.
- Record: `docs/05-quality/security/PR-pending-TASK-039-security-review.md`, on main, with D-SECPR039-01. Rename it when the PR exists (D-ORCH-136/138).
- 9 owned paths (`prisma/**`, `tools/db/**`, `apps/api/src/platform/db/**`). Classifier `security_paths=true`.
- Code twin `e61d3f4`: CHANGES_REQUESTED, same items (R1-M1 = SEC-01, R1-m1 = SEC-02, R1-m2 ⊂ SEC-04, R1-m3 = PR64-SEC-11 gap, R1-n1 = ruling (iii)).
- The architect ruled in parallel (D-ARCH-171, `035299d`): unique `(queue, job_key)`, purge index, 30-day purge owned by TASK-043, `result` "reserved".

**Findings:**
- **01 LOW (CWE-755).** `runWithDeadline` arms its timer before `work()`. A synchronously throwing processor leaves an unhandled rejection at the deadline, so the worker exits 1. Fix validated: `const running = (async () => work(signal))()` before the timer.
- **02 LOW (CWE-694).** The global `job_key` vs per-queue BullMQ ids. `shipment` is a kind on both `documents` and `tracking-poll`. PGlite showed 0 rows on the second queue.
- **INFO:**
  - 03: a late commit after the deadline. Fix: `signal.throwIfAborted()` after the effect.
  - 04: signal gaps (`on_behalf_of_org_id`, `orgUuid`, `user_id`, depth > 4, key 257+).
  - 05: the unused writable `result` column; SELECT is not needed for the claim.

**Round 2 (2026-11-20).** Delta `64eefab..766ae52`: a clean main merge `9af4da9` plus the fix. Result: PASS_W_F-U, appended to the same record, D-SECPR039-02, commit `3529b239`.
- All of 01-05 are closed; each probe was run against `64eefab` as the control.
- PR64-SEC-11 closes on the lane B pass of its key-level case: raw ioredis as `api`, `SET rl:*` gives OK, `bull:*` gives `/NOPERM.*key/i`, and `INFO` is asserted separately. The Valkey 8.1 wording is "No permissions to access a key".
- The code twin's round 2 is `6ab40f28`, APPROVED_W_NITS.
- The new Head row names `766ae52`. The round-1 row stays and gives only a note.
- Residuals: 03 (b) goes to TASK-047 and the saga/carrier tasks; the 04 gaps `org_ids` and homoglyphs are INFO.
- No further round is due unless an owned path changes after `766ae52`.

**Round 3 (2026-11-20).** `f08948eb` changed only the C15 committed-scope literal (`prisma/tests/catalog/c15-std-columns-guard.int.test.ts`, adds `job_executions`; an owned `/prisma/` path, so the r2 binding was void). Result: PASS_W_F-U, no new finding, D-SECPR039-03, commit `16274d79`.
- The new Head row names `f08948eb`; the evidence commit `49941626` (docs/05-quality/tests/runs, unowned) keeps it valid. Owned set: 10.
- Lane B `20261120T0525Z_f08948e` passed the key-level NOPERM case, so PR64-SEC-11 is closed.
- Merge-ref sim: 3 of 3 (scratch `--shared` clone; a temp `GIT_INDEX_FILE` + `commit-tree` replaces `PR-pending` with `PR-9999`, then `merge-tree --write-tree`).
- Still owed: lane A and `security-integration` on the pushed head, then the rename (D-ORCH-136/138). No further round unless an owned path changes after `f08948eb`.

**D-TASK039-01 conditions for later schedules:**
- (i) parameters never come from the job;
- (ii) destructive handlers apply their own age predicate, and writers go through `idempotentProcessor` keyed by the occurrence;
- (iii) closed `SCHEDULE_NAMES`, names of at most 47 characters (correlation id ≤ 64);
- (iv) "run now" goes through the scheduler.

**Why:** forged occurrences are possible for any `bull:*` writer; the ACL is the control.

**How to apply (round 2 / later tasks):**
- In the delta round, re-run the P2 deadline probe (sync / async / hang, child process, exit code), the P4b PGlite composite-key test, the P1 dequeue matrix (34 rows) and the record sim. The migration change voids the binding (sim S8).
- PR64-SEC-11 closes only with a key-level NOPERM. BullMQ runs `INFO` at connection set-up (no `skipVersionCheck`). `INFO` is in `@dangerous`, and the api user lacks `+info`, so `NOPERM` arrives before any key access.
- At TASK-043 (purge) and the first audit/purge schedules, check ruling condition (ii).
- TASK-047 must bind the worker SYSTEM accessor; until then `systemJobExecutionLedger` throws (fail closed).

**Facts (bullmq 6.7.0):**
- Occurrence id `repeat:<schedulerId>:<millis>` (`job-scheduler.js:287`, `addJobScheduler-11.lua:144`, `updateJobScheduler-12.lua:79`).
- `Queue.clean`: `limit || Infinity`, at most 10,000 per call. For `wait` it does `LRANGE -limit -1` (oldest).
- A deferred failure (`defa`) is failed by the next worker via `getUnrecoverableErrorMessage` and emits `failed`.

**Kit** (session scratch `t039/probes/`, session-scoped):
- `hooks.mjs`: `@platform/*` → extract `src/*.ts`, bare imports from the main checkout, type-stripping.
- p1 dequeue; p2 deadline; p3 linter / render / grants (`lintRepository(EXT)`, `renderStdColumnsGuard`, `validateGrants`; C10 needs `{schema:'public', ...}` columns); p4/p4b PGlite migration; p5 idempotent+deadline fake-tx; p7 ESLint `Linter` with the `system-model-owner` rule (cwd = extract; the import path must resolve to the real accessor file, or the rule is silent).
- `gl-over.mjs`; `sim.sh` (merge-ref record sim, 10 scenarios).
- PGlite 0.4.3 = PostgreSQL 17.5: stub `uuidv7()`, roles, `platform.app_actor_id()`; import it through `pathToFileURL(require.resolve(...))`.

Related: [[project-p5-pr64-task035]], [[project-security-review-conventions]], [[project-p5-task293]]
