# Code review: TASK-039 (idempotent job processing and singleton scheduled jobs), pre-push round 1

| Field | Value |
|---|---|
| PR | not pushed yet (pre-push review; the orchestrator renames this record once the PR exists) |
| Branch / head | detached worktree `Shipqube-TASK-039` @ `64eefab` (one commit), based on `origin/main` `7da0e50` (contains TASK-293, `f723fef` / #72) |
| Diff reviewed | `git diff 7da0e50 64eefab`: 35 files, +2268 / -131 (`packages/shared/src/queues/**`, `apps/worker/src/platform/{queues,jobs}/**`, `apps/worker/src/{processors,start-worker}.ts`, migration `20261119000000_job_executions`, Prisma model, grants manifest, `tools/db/table-classes/worker.json`, classification registry, SYSTEM_MODELS) |
| Card | `docs/04-plan/tasks/WAVE-01.md` TASK-039 (US-010 DC; REQ-PLAT-014/015; NFR-RES-004, NFR-SCALE-002; PR64-SEC-04/06/07/08/11/12; D-ORCH-139; D-ARCH-159/160) |
| Sources re-read | CLAUDE.md; ADR-0013 §1-§9, amendment 1 (items 1-5) and amendment 3 (items 7-16); the TASK-035 PR #64 records (code review r1/r2, security review); D-ORCH-139; D-PM-072 (held as a patch); data-model §1.5 and §3.5; gherkin map rows AT-US-010-01..07; BullMQ 6.7.0 sources (below) |
| Developer decisions | D-TASK039-01..06 (dispatch summary; not yet in DECISIONS.md) |
| Reviewer | code-reviewer, 2026-11-20 |

## 1. Verdict

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful PR, built against the BullMQ 6.7.0 source: the limit-0 guard of the trim, the deferred-failure
         path, the scheduler id and the single-flight metrics are right, and every card item has a test. One MAJOR:
         the per-job deadline turns a processor that throws synchronously into an unhandled rejection that exits the
         worker 5 minutes later (probe-proven; main caught it). Seven MINORs, ten NITs.
```

R1-M1 is a one-line fix. No processor that main registers throws synchronously today. But `runWithDeadline` wraps every processor that TASK-047 and later tasks register, and the failure mode is a crash with exit 1 and no drain, repeated on every retry of the poison job. On main the same throw was caught and recorded. That makes it a regression in a platform primitive, so it is MAJOR and not MINOR.

## 2. Verification performed (HOST RULE: static review and single-process Node probes on a `git archive` extract; no npm, no Jest, no Docker)

Set-up: `git archive 64eefab` (packages, apps/worker, apps/api, prisma, tools, configs) went into the reviewer scratchpad (`review/TASK-039-cr`), with a node_modules junction to the worktree. Nothing ran inside the PR worktree, and `git status` there stays clean.

- **Format:** `prettier --check` with the repository `.prettierrc` on every changed `.ts`/`.json` file: clean. Prettier has no SQL parser, so the two SQL files were not checked.
- **Migration linter:** `tools/db/lint-migrations.ts` over `prisma/migrations` + `prisma/bootstrap`: "no findings".
- **Prisma:** `tools/deps/prisma-cli.mjs validate`: "The schemas at prisma\schema are valid".
- **Not re-run (host rule):** ESLint, `tsc -b`, the build, the unit suites and coverage, and the three integration files (`consumer.int`, `retention.int`, `job-executions.int`). Lane A (lint, typecheck, unit, catalog, migration-lint) and lane B are the binding evidence. The integration files run for the first time in lane B.
- **BullMQ 6.7.0 read-through** (worktree `node_modules/bullmq/dist/cjs`):
  - `worker.js` `processJob` / `getUnrecoverableErrorMessage`: a job carrying `deferredFailure` is failed with `UnrecoverableError` without calling the processor, and `handleFailed` emits `failed`. `Job.fromJSON` copies `defa`, and nothing clears it on the JS object, so `isDeferredFailure` is a sound discriminator.
  - `moveStalledJobsToWait-9.lua`: `defa` is set only when `stalledCount > maxStalledJobCount` and the job is not a Job Scheduler job. A scheduled sweep that keeps stalling is therefore re-run, never failed. That is acceptable.
  - `cleanJobsInSet-3.lua` / `includes/cleanList.lua`: for `wait`, `LRANGE -limit .. -1` reads the old (tail) end, and `limit 0` means unlimited. Both the `surplus < 1` guard and the ADR item 10 reading are confirmed.
  - `job-scheduler.js` `getSchedulerNextJobId`: `repeat:${jobSchedulerId}:${nextMillis}`. `SCHEDULED_JOB_ID` matches.
  - `redis-connection.js` `getRedisVersionAndType`: every connection runs `INFO` before its first command, unless `skipVersionCheck` is set. This matters for R1-m3.
- **Behaviour probes** (tsx, imports from the extract):
  - **P1** (`p1-shared.mts`):
    - (a) A payload `{...valid, a: {300 keys}, org_id}` is refused with `PAYLOAD_INVALID` and `carriesTenantContext: false`, so no `job_context_mismatch` is emitted (R1-m2).
    - (b) A tenant key at depth 5 is not flagged. This is the declared bound.
    - (c) The scheduled id edges `0`, `01`, 17 digits and a missing id are refused; 16 digits is accepted.
    - (d) A 63-character schedule name gives an 80-character correlation id. The pattern allows at most 64 (R1-n1).
    - (e) A schedule payload on an aggregate queue is refused (`schedule: any.invalid`); an own `__proto__` on a schedule payload is refused and flagged; string and array data are refused.
  - **P2** (`p2-deadline.mts`), with a processor that throws synchronously:
    - `runWithDeadline` rejects with the throw. The handler then fails the attempt (`TRANSIENT`, 1 record written).
    - **50 ms later `unhandledRejection: JobDeadlineError` fires (twice: one per run).** In the worker, `installProcessErrorHandlers` (apps/api `process-errors.ts:96-99`) turns that into `process.unhandled_rejection` plus `exit(1)` (R1-M1).
  - **P3** (`p3-register.mts`), `createWorkerQueues({ schedules: {} })` against an unreachable Valkey (127.0.0.1:1):
    - `consuming` is `['housekeeping']`.
    - `registerSchedules()` neither resolves nor rejects within 1.2 s, because BullMQ waits for the connection to become ready. So the 30 s retry branch runs only for a failure *after* the connection is ready, for example `NOPERM`. That behaviour is benign, but the branch has no test (R1-n10).
    - `close()` with the consumer Worker still reconnecting did not finish within 5 s. This was already the case for any consumer before this PR, and the 30 s stop window of `createShutdown` bounds it.
- **Cross-checks:**
  - The api producer (`apps/api/src/platform/queues/producer.ts:81`) adds with `name = ref.kind` and `jobId = jobIdFor(ref)`, so the new identity check accepts every job the platform produces.
  - The shared `std_columns_guard` (`20261117000000_organisations_identity`) admits the stamped SYSTEM actor.
  - `users.acl`: the `api` user has no `~bull:*` and no `+info`.
  - `SYSTEM_MODEL_OWNERS.worker` already covers `apps/worker/src/platform/**`.
  - The kinds of `documents` and `tracking-poll` both include `shipment` (R1-m1).

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `apps/worker/src/platform/queues/job-handler.ts:119-136` (`runWithDeadline`) | `work(controller.signal)` is called **before** the `try` that clears the timer. A processor that throws synchronously makes the async function reject at once, so the handler records the failure. But `clearTimeout` never runs, and `deadlineMs` later the `expired` promise rejects with no handler attached. The `Promise.race` was never built. The worker's process-error handlers exit with 1 on `unhandledRejection`, with no drain, and every retry of the job repeats the crash (P2). `JobProcessor` is typed `Promise<void>`, but nothing makes it `async`: `promise-function-async` is not enabled, and the tests themselves use non-async arrows. On main the same throw was caught inside `try { await processor(...) }`. The test "a processor that rejects after its deadline is no unhandled rejection" covers the late-rejection case only. | Start the work inside the guarded region, for example `const running = Promise.resolve().then(() => work(controller.signal));` (or move the `work(...)` call and the `running.catch` inside the `try`). As a belt-and-braces measure also add `expired.catch(() => undefined)`, so an un-raced timer can never surface. Add a unit case: a non-async processor that throws synchronously, a short `deadlineMs`, an `unhandledRejection` spy on `process` (or fake timers), and the assertions that the attempt is recorded and no rejection fires after the deadline. |
| R1-m1 | MINOR | `apps/worker/src/platform/jobs/idempotent-processor.ts:59-63, 85-90`; `migration.sql:33` (`ux_job_executions__job_key`) | The ledger key is the BullMQ job id, and it is unique across **all** queues. BullMQ scopes ids per queue, and `shipment` is a payload kind of both `documents` and `tracking-poll`. A `shipment.<id>` job completed on one queue makes the other queue's `shipment.<id>` job a "duplicate", and its effect is skipped silently (only an info line) and forever (no purge). For an idempotency ledger that is the worst failure mode: a lost effect. ADR-0013 §4 says `job_key UNIQUE`, but the `processed_events` precedent (data-model §3.5) keys on `(consumer, event_id)`. | Before the migration merges, scope the key to the queue. Either (a) make the unique index `(queue, job_key)` (free now, an expand/contract later), with `createMany` unchanged, or (b) claim `job_key = <queue>/<job id>` (code only; recheck `MAX_JOB_KEY_LENGTH`). Add a test: the same job id claimed on two queues runs both effects. Note the scoping in ADR-0013 §4 through principal-architect, or in the hand-off if (b) keeps the ADR text literally true. |
| R1-m2 | MINOR | `packages/shared/src/queues/payload-v2.ts:168-181` (`carriesTenantContext`) | The walk is depth-first and shares one 256-key budget. When the budget runs out it answers `false`. A forger therefore hides a **root** `org_id` behind a nested filler object (P1a), or behind more than 256 root keys. The payload is still refused, but the `job_context_mismatch` security event, which is the point of PR64-SEC-06, is not emitted. | Examine every root key first, without budget, before descending (the root is small, or it is refused by `MAX_PAYLOAD_KEYS`). Then walk breadth-first. **Treat budget exhaustion and the `object.max` refusal as a signal (`true`)**: no producer writes such a payload, so it is a forgery by construction. Add the P1a payload and a 300-root-key payload as cases (the `huge` case then expects `carriesTenantContext: true`). |
| R1-m3 | MINOR | `apps/worker/src/platform/queues/retention.int.test.ts:327-331` (PR64-SEC-11 negative half) | `apiQueue.add(...)` is expected to reject with `/NOPERM/`. But BullMQ's connection set-up runs `INFO` first (`redis-connection.js:278, 559`), and `INFO` is `@dangerous`, which the `api` user lacks (`users.acl`: no `+info`). The NOPERM almost certainly comes from `INFO`, not from the `~bull:*` key restriction the case is meant to prove. Mutation: give `api` `~bull:*`, and the test still passes. (Static reasoning; I could not run it under the host rule.) | Prove the key restriction directly: open the api Queue with `skipVersionCheck: true`, or issue a raw ioredis `SET bull:probe x` / `EVALSHA` as `api`. Assert the key-permission message (`/NOPERM.*key/i`, Valkey: "No permissions to access a key"). Keep the INFO denial as a separate, named assertion if wanted. |
| R1-m4 | MINOR | `prisma/tests/worker/job-executions.int.test.ts:41-48, 77` | The case uses the **plain** client (`scopeClient: () => client`) and passes `createdBy`/`updatedBy` itself. The production ledger (`createJobExecutionLedger`) passes neither and relies on `withStandardColumns` stamping through `systemDelegates`, combined with `skipDuplicates`. That production path is therefore untested, and the claim in the file header ("as the standard-columns extension would stamp it") is an assumption. | Wire `scopeClient: (stamp) => withStandardColumns(client, stamp)` (apps/api `platform/db/extensions/standard-columns.ts`, importable from prisma/tests). Make `claim` send exactly the ledger's row `{ jobKey, queue, status }`. Keep the row assertion `created_by = updated_by = SYSTEM`. |
| R1-m5 | MINOR | `apps/worker/src/platform/queues/consumer.ts:65-68, 106-109`; no test | The stalled-out half of PR64-SEC-08 relies on `isDeferredFailure` and on the consumer's `failed` listener. Neither is pinned: the listener could be deleted, or `isDeferredFailure` could return `false`, and every test would still pass. The unit case tests only `createStalledFailureRecorder` in isolation. | Add a unit case for `isDeferredFailure` (non-empty string, `''`, absent, `undefined` job). Add one deterministic Valkey case: after `queue.add`, `HSET <prefix>:outbox-relay:<id> defa "job stalled more than allowable limit"` before the consumer starts. Expect a STALLED record, a `worker.job_failed` line with `reason: STALLED`, and a processor call count of 0. |
| R1-m6 | MINOR | card "Stories (completes) US-010"; `jobs.test.ts`, `retention.int.test.ts`, `consumer.int.test.ts` | AT-US-010-01 and -07 are deliberately not claimed. That fits the pre-agreed D-PM-072 default, but **no split is recorded on main**: DECISIONS.md has no D-PM entry and the gherkin map has no owner change. Until there is one, the card's "completes US-010" is not true. The AT-US-010-03/-04 titles also test the D-PM-072 wording that is still held as a patch. | Orchestrator / product-manager, before merge: record the US-010 split (the [[d062]] form: AT-US-010-07 to TASK-047, and an owner for -01, the M0 mock-booking duplicate) and land the D-PM-072 patch. Then the developer's claim set and the requirement text agree. |
| R1-m7 | MINOR | `migration.sql:6-11`, `platform.prisma:25`, `worker.json` `$comment`, `idempotent-processor.ts:36` | Four places cite "data-model §3.5 as added by TASK-039". The PR does not touch data-model.md: §3.5 has no `job_executions` entry, and the SYSTEM-class table list (§1.5) does not name it. The DoD asks for documented public interfaces, and the classification and grants documents point into a section that does not exist. | Add the §3.5 entry (columns, `ux_job_executions__job_key` or its R1-m1 replacement, insert-only grants, no purge yet), add `job_executions` to the §1.5 SYSTEM list, and set the §10 retention row to "none until purge owner" (route to principal-architect if the developer may not edit data-model). |
| R1-n1 | NIT | `packages/shared/src/queues/scheduled-job.ts:39, 103`; `queue-definition.ts:28` | `SCHEDULED_JOB_ID` admits 63-character schedule names, but the correlation id `<schedule>-<millis>` must fit `CORRELATION_ID_PATTERN` (8-64). With a name longer than 47 characters, `runWithJobContext` throws `JobContextError` outside the handler's `try`: an unsanitised failure with no record (P1d). The only name today is 15 characters. | Pin it with a test that every `SCHEDULE_NAMES` entry matches `^[a-z][a-z0-9-]{0,46}$`, or tighten the regex to `{0,46}`. |
| R1-n2 | NIT | `scheduled-job.ts:118` | The step check `/^[a-z0-9_-]{1,40}$/` duplicates `STEP` / `JOB_ID_PATTERN` of `payload-v2.ts:46`. Two regexes that must agree will drift. | Export `STEP` (or a `isJobIdOf(ref, id)` helper) from payload-v2 and reuse it. |
| R1-n3 | NIT | `jobs.test.ts:4`; `retention.test.ts:3`; `migration.sql:9`, `idempotent-processor.ts:6` | Stale references: `schedulers.int.test.ts` does not exist (the cases are in `retention.int.test.ts`); the retention unit header says `consumer.int.test.ts`; and Prisma's `skipDuplicates` emits a target-less `ON CONFLICT DO NOTHING`, not `ON CONFLICT (job_key)`. | Correct the three comments. |
| R1-n4 | NIT | `queues.test.ts` ("caps the issue list", `< 400` ms); `retention.int.test.ts` sweep case (age 3 s, `sleep(4_500)`) | Wall-clock assertions. The unit case asserts a 400 ms budget on a shared runner. The sweep case leaves at most 3 s, under lane-B load, for two fresh settles, the runtime construction and the sweep, before the "fresh" jobs age out too. The developer flagged these as risky. | Drop the timing assertion, or move it to a benchmark. Widen the sweep window (age 10 s, sleep 12 s) or derive the bound from the jobs' `finishedOn`. |
| R1-n5 | NIT | `retention.ts:114-133`; `runtime.ts:93-98` | The sweep ignores `job.signal`. A sweep that overruns the 5 min deadline keeps running while BullMQ retries it, so two sweeps overlap on a concurrency-1 queue. That is harmless (idempotent), but the signal exists for exactly this. | Pass the signal to `sweepRetention` and stop between queues when it is aborted. |
| R1-n6 | NIT | `job-handler.ts:155-163` (write-time trim) | Concurrent record writers compute their surplus from the same depth. A burst can therefore trim up to (writers - 1) records below the bound. That is acceptable and bounded, but undocumented. | Add one sentence in the JSDoc (or trim to `count` after re-reading the depth inside the loop). |
| R1-n7 | NIT | `job-handler.ts:253-269` (`createStalledFailureRecorder`) | The STALLED lines are written outside any job log context, so they carry no `correlation_id`, unlike every other failure line. The line also says `error: 'NonRetryableError'`, a class the job never threw. | Wrap the call in `runWithJobContext` with the payload's correlation id when it is valid. Consider `error: 'UnrecoverableError'` (what BullMQ persisted). |
| R1-n8 | NIT | migration / D-TASK039-03 | `job_executions` has no purge and no `completed_at` index. Once TASK-047 binds the accessor, it gains one row per completed job, forever. | Route an owner (the housekeeping purge, with the index and data-model §10 retention) before TASK-047 binds the ledger. |
| R1-n9 | NIT | `start-worker.test.ts:17` | The new `@platform/shared/queues` import sits after the relative imports. No lint rule enforces the order, but the file's grouping is broken. | Move it into the package import group. |
| R1-n10 | NIT | `runtime.ts:125-136, 92` | Two branches are untested: the registration retry branch (fail, log, retry, stop on close), and the refusal of a registered processor on a schedule-only queue. P3 shows that the retry branch is reached only for post-ready failures. | Add one fake-queue unit case for each. |

## 4. Deviation rulings (developer decisions)

- **D-TASK039-01** (the scheduled-job identity `repeat:<schedule>:<millis>`, the closed `{ v: 2, schedule }` payload, SYSTEM scope): **accepted** on code grounds. It matches BullMQ's own id (verified), refuses foreign ids, names, queues, extra keys and `__proto__`, and a forged occurrence can only trigger an idempotent sweep. The security review owns the threat ruling.
- **D-TASK039-02** (5 min per-job deadline as a constant): **accepted**. R1-M1 is about the mechanism, not the value.
- **D-TASK039-03** (`job_executions` SYSTEM, insert-only, no purge, accessor unbound until TASK-047): **accepted** with R1-m1 (key scope), R1-m4 (test fidelity) and R1-n8 (purge owner).
- **D-TASK039-04** (read-back duplicate detection on `failed_at`): **accepted**. A collision needs two final failures of one record id within the same millisecond.
- **D-TASK039-05** (the housekeeping processor inside the runtime, PR64-SEC-13): **accepted**. Refusing a registered processor on a schedule-only queue is the right guard (test it, R1-n10).
- **D-TASK039-06** (local key folding instead of importing logging into the queues subpath): **accepted**. It keeps the Joi-only subpath free of the logger.

## 5. Follow-up closure (card items)

| Item | Status |
|---|---|
| PR64-SEC-04 constants, `jobOptions` pin, scheduler template bounds, Worker defaults, write-time trim (limit 0 guarded), hourly sweep, production-composition pin | done (unit); Valkey half in lane B |
| PR64-SEC-04 integration (newest N failed kept + retry, sweep on a quiet queue, record trim, retained failed job has its record, ACL sweep) | written; lane B; R1-m3, R1-n4 |
| PR64-SEC-04 PR body `MEMORY USAGE` figures | merge condition: `reports/queue-memory-usage.json` from lane B, quoted in the PR body |
| D-ARCH-160 counter (9 series at 0, +1 final, +0 retried, +1 on write failure) | done |
| PR64-SEC-06 spellings, nested, `__proto__`, issue cap | done; R1-m2 budget evasion |
| PR64-SEC-07 identity check and per-job deadline | done; R1-M1 |
| PR64-SEC-08 duplicate logging; stalled-out record and line | done; R1-m5 wiring unpinned |
| PR64-SEC-11 ACL case | written; R1-m3 negative half vacuous |
| PR64-SEC-12 single-flight metrics | done (spy pins 18 calls for 25 scrapes) |
| D-ORCH-139 consumer.int race | done: failed state first, then the records with a reason; AT-US-009-04 assertions unchanged. PR body must state the re-run-once rule |
| AT-US-010-02..06 | claimed (02/04 in consumer.int, 03 unit, 04 unit + retention.int, 05/06 retention.int); 01/07 per R1-m6 |
| Merge prerequisite TASK-293 | satisfied (`f723fef` is in the base) |
| Watchlist #64 R2-n2 (connection-profile wiring) | closed by `productionQueuesOptions` and its pin |
| Watchlist #64 R2-n4 (control-flow errors undocumented) | closed by the `JobProcessor` JSDoc |

## 6. Merge conditions

1. R1-M1 is fixed, with its unit case.
2. R1-m1 to R1-m5 are fixed. R1-m6 (US-010 split recorded, D-PM-072 patch landed) and R1-m7 (data-model §3.5 / §1.5) are fixed or carry a recorded routing.
3. Lane A is green on the pushed head: lint, typecheck, unit, coverage thresholds, migration-lint, catalog/classification/grants tests.
4. Lane B PASS on `consumer.int`, `retention.int` (including the ACL case and AT-US-010-05/06) and `prisma/tests/worker/job-executions.int`. The PR body quotes the two `MEMORY USAGE` figures and the D-ORCH-139 recurrence note.
5. security-analyst record on the head (D-TASK039-01, PR64-SEC-06/07/08/11/12 closure, R1-m2, R1-m3).
6. A round-2 delta review of the fix commits.

## 7. Good patterns

- Every BullMQ assumption is cited to a 6.7.0 file and the code follows it: the `clean` limit-0 trap, the deferred-failure discriminator, the scheduler id and Worker default options.
- `productionQueuesOptions` turns the composition into a pinnable value. This closes #64 R2-n2 cleanly.
- The bounds are frozen constants, and BullMQ gets fresh copies, so a library mutation can never alter the ADR constants.
- The dead-letter writer is shared by the handler and the stalled recorder: one counter point and one trim point.
- The single-flight metrics use a `??=` promise with `finally` reset, pinned by a prototype spy rather than by timing.
- The D-ORCH-139 fix reads state, then records, each in its own bounded poll, and leaves the AT assertions untouched.
- The ACL case generates credentials at run time and rewrites only the hashes.

## 8. Security flags (for security-analyst)

- R1-M1: availability. A job whose processor throws synchronously crashes the worker 5 minutes later, on every retry.
- R1-m1: silent lost effects through cross-queue ledger key collision.
- R1-m2: the forgery signal can be evaded through the walk budget (the payload is still refused, but the event is lost).
- R1-m3: the ACL negative case does not prove the `~bull:*` key restriction.
- D-TASK039-01: the scheduled-job identity and payload contract (code-accepted; threat ruling is yours).
- `job_executions` grants are SELECT + INSERT only for platform_app, there is no DELETE, and the class is SYSTEM without RLS. This matches worker.json and the manifest.

---

# Round 2: delta review of the fix cycle (head `766ae52`)

| Field | Value |
|---|---|
| Head | `feat/TASK-039-idempotent-job-processing-singleton-scheduled` @ `766ae52` = merge `9af4da9` (64eefab + origin/main `2960391`) + fix commit `766ae52` |
| Diff reviewed | `git diff 9af4da9 766ae52`: 19 files, +394 / -88; the remerge diff of `9af4da9` |
| Developer decisions | D-TASK039-07..12 (commit message; deadline guard, per-queue key, rollback on abort, breadth-first walk, sweep signal, STALLED context) |
| Reviewer | code-reviewer, 2026-11-20 (read from the main checkout's object store; the busy evidence worktree was not used) |

## R2.1 Verdict

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every round-1 finding is closed or routed: R1-M1 by a promise-job start with both promises handled and the
         timer inside the try (probe: no unhandled rejection), R1-m1 by ux_job_executions__queue_job_key (D-ARCH-171),
         R1-m2 to R1-m5 by code and tests that would fail against the round-1 code, R1-m6/m7 on main. Three new NITs.
```

## R2.2 Verification performed (same host rule: static review and single-process Node probes on a `git archive` extract)

Set-up: `git archive 766ae52` from the main checkout into `review/TASK-039-cr2`. node_modules is a junction to the main checkout, with `apps|packages/node_modules/@platform/{shared,api,config}` junctions to the copy's own packages, so imports resolve to the head.

- **Merge `9af4da9` is a pure union.** `git merge-tree --write-tree 64eefab 2960391` gives tree `573ae11`, and `git diff --stat 573ae11 9af4da9` is empty. No file changed on both sides since the merge base `7da0e50`. The main side changed docs and agent memory only (no migration, no code).
- **Format:** `prettier --check` on every changed `.ts`/`.json`: clean.
- **Migration linter:** "no findings". **`prisma validate`:** valid (the `@@unique([queue, jobKey])` and `@@index([completedAt])` names match the SQL).
- **P2 re-run** (the round-1 sync-throw probe) on `766ae52`: the attempt fails `TRANSIENT` with one record, and **no `unhandledRejection` fires** 200 ms past a 50 ms deadline. R1-M1 is closed.
- **P4** (`carriesTenantContext` on `766ae52`):
  - true for the round-1 P1a payload (root `org_id` behind 300 filler keys), for a 40-element root array, for a 300-element nested array, and for `[{ userId }]`;
  - false for a valid payload, a traced payload with `tracestate`, and `{ v: 2, schedule }`;
  - `validateDequeuedJob` still accepts a valid outbox job;
  - 100,000 nested keys take 32 ms.
- **Not re-run:** ESLint, `tsc -b`, Jest, coverage and the integration files. **The lane-B run now in progress is on the round-1 head `64eefab`.** The migration, `retention.int` and `job-executions.int` all changed in `766ae52`, so that run is not evidence for this head (merge condition 2).
- **Mutation reasoning on the new pins** (each would fail against the round-1 code):
  - The R1-M1 unit case asserts `signal.aborted === false` 80 ms after a 20 ms deadline. An armed timer aborts the signal, so this does not depend on Jest delivering `unhandledRejection` to the listener.
  - The ACL case now needs `SET rl:acl-probe` to succeed and `SET` / `HSET bull:…` to fail with `/NOPERM.*key/i`. Granting `~bull:*` to `api` now fails the case; the INFO denial is asserted separately.
  - The `defa` case writes exactly the hash field `moveStalledJobsToWait-9.lua` writes, before the consumer starts. It asserts 0 processor calls, a `failed` state, a STALLED record and a `worker.job_failed` line with the payload's `correlation_id`. The record is written after `moveToFailed` and after the log line, so the polls cannot race.
  - The two-queue claim is pinned in the fake ledger (`jobs.test.ts`) and on PostgreSQL (`job-executions.int`, which now runs through `withStandardColumns` and `serverStamped`, exactly the production row).

## R2.3 Round-1 closure

| R1 item | Status | Evidence |
|---|---|---|
| R1-M1 sync throw, unhandled deadline rejection | **closed** | `job-handler.ts` `runWithDeadline`: `Promise.resolve().then(() => work(signal))`, `.catch` on both promises, timer inside `try`, cleared in `finally`; unit case; P2 |
| R1-m1 ledger key across queues | **closed** | `ux_job_executions__queue_job_key ON (queue, job_key)`; data-model §3.5 AP-PLAT-10 amends ADR-0013 §4 "`job_key UNIQUE`" (D-ARCH-171); fake and PostgreSQL two-queue cases |
| R1-m2 signal budget evasion | **closed** | breadth-first, root first; past depth, keys or `MAX_PAYLOAD_KEYS` counts as flagged; compound spellings (`on_behalf_of_org_id`, `orgUuid`, `user_id`, `targetTenantId`, `orgRefId`); P4 |
| R1-m3 ACL negative vacuous | **closed** | raw ioredis `api` client, control write on `rl:`, key-level NOPERM on `bull:`, INFO denial named separately |
| R1-m4 int test bypassed stamping | **closed** | `scopeClient: (stamp) => withStandardColumns(client, stamp)`, claim row `{ jobKey, queue, status }` via `serverStamped` |
| R1-m5 stalled wiring unpinned | **closed** | `isDeferredFailure` unit table; deterministic `defa` Valkey case |
| R1-m6 US-010 split | **closed on main** | DECISIONS.md: TASK-039 partial (AT-US-010-02..06), TASK-047 -07, TASK-092 completes with -01 |
| R1-m7 data-model §3.5 / §1.5 | **closed on main** | data-model §3.5 entry, §1.5, §4.4, §10.1/§10.5 (D-ARCH-171, A33) |
| R1-n1 correlation id length | closed | `SCHEDULED_JOB_ID` `{0,46}`, exported `SCHEDULE_NAME_PATTERN`, test over `SCHEDULE_NAMES` with a 16-digit suffix |
| R1-n2 duplicated step regex | closed | `isJobIdOf` reuses `STEP`; test against `jobIdFor` |
| R1-n3 stale references | closed (one left, R2-n1) | |
| R1-n4 timing assertions | closed | the 400 ms assertion removed; sweep window 10 s age / 12 s sleep |
| R1-n5 sweep ignores signal | closed | `sweepRetention({ signal })` stops between queues, logs `worker.queue_retention_aborted`; unit case |
| R1-n6 over-trim undocumented | closed | JSDoc |
| R1-n7 STALLED lines without context | closed | `runWithJobContext` when the payload's correlation id is valid; `error: 'UnrecoverableError'` (see R2-n3) |
| R1-n8 purge owner | closed on main | TASK-043 owns the 30-day purge (D-ARCH-171); `ix_job_executions__completed_at` added now |
| R1-n9 import grouping | closed | |
| R1-n10 untested branches | **partly** | processor refusal on a schedule-only queue: now refused before any connection opens, with a unit case. The registration retry branch stays untested; a NIT carried as R2-n4 |

Security items in the same commit, checked on code grounds:
- **PR039-SEC-03:** `job.signal.throwIfAborted()` inside the transaction after the effect, so an attempt past its deadline rolls back. Its rejection lands on the abandoned `running` promise, which has a handler. A deadline that fires during COMMIT still commits, but the retry then finds the key and skips, so the effect stays at most once. That residual is acceptable.
- **PR039-SEC-05:** `ck_job_executions__result_unset CHECK (result IS NULL)`.
- **D-SECPR039-01 conditions (i)-(iv):** stated on `SCHEDULE_NAMES`.

## R2.4 New findings

| ID | Severity | File:line | Issue | Fix |
|---|---|---|---|---|
| R2-n1 | NIT | `tools/db/table-classes/worker.json` `$comment` | It still reads "data-model §3.5 as added by TASK-039". The entry now exists, under D-ARCH-171. | "data-model §3.5 (D-ARCH-171)". |
| R2-n2 | NIT | `apps/worker/src/platform/jobs/schedulers.ts:45-48` | The JSDoc sentence was spliced into one line of about 170 characters. Prettier does not reflow comments. | Re-wrap at 120. |
| R2-n3 | NIT | `job-handler.ts` (`createStalledFailureRecorder`); `retention.int.test.ts` STALLED case | For the same STALLED failure, the log line says `error: 'UnrecoverableError'` and the dead-letter record says `error: 'NonRetryableError'` (both pinned). An operator correlating the two sees two classes. | Pick one. Either pass an `UnrecoverableError`-named error to the writer, or log `NonRetryableError`, and align both pins. |
| R2-n4 | NIT | `runtime.ts` `registerUntilDone` | Carried from R1-n10: the fail, log, retry and stop-on-close path has no test. Round-1 P3 showed it is reached only after the connection is ready (e.g. NOPERM). | One fake-timer unit case, when convenient. |

## R2.5 Deviation rulings (D-TASK039-07..12)

All six are accepted:
- **-07** (promise-job start): it closes R1-M1.
- **-08** (per-queue key, completed_at index, result reserved): it matches D-ARCH-171.
- **-09** (`throwIfAborted` before commit): accepted with the commit-window residual noted above.
- **-10** (breadth-first walk with "unexamined = flagged"): no valid payload can trip it, because the payload keys are fixed and the depth is at most 1, as P4 shows.
- **-11** (sweep signal).
- **-12** (STALLED context).

## R2.6 Merge conditions (replace §6)

1. Lane A green on the pushed head `766ae52` (or its successor): lint, typecheck, unit, coverage, migration-lint, catalog, classification and grants.
2. **Lane B PASS on `766ae52`**, not on `64eefab`: `consumer.int`, `retention.int` (including the new STALLED and key-level ACL cases and AT-US-010-05/06) and `prisma/tests/worker/job-executions.int` (the migration changed). The PR body quotes the two `MEMORY USAGE` figures and the D-ORCH-139 recurrence note.
3. The security-analyst round-2 record on the head.
4. Carried from round 1 (orchestrator): the D-PM-072 patch lands with or before this PR.
5. R2-n1 to R2-n4 are optional.
