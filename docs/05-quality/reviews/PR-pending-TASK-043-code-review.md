# Code review: TASK-043 transactional outbox writer, at-least-once relay, 30-day purge (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-043 (US-011 DC, REQ-PLAT-016/017, NFR-RES-004, NFR-SCALE-002; AT-US-011-01..06, AT-US-008-03 outbox hop; PR #64 R2-n3/R2-n5, PR64-SEC-13; D-ARCH-167, D-ARCH-171, D-SECPR039-01) |
| Head | `5193fea4` (3 commits on main `efa6d1e0`: `7d6e4cb3` wip, `f38c193d` wip, `5193fea4`), branch `feat/TASK-043-transactional-outbox-writer-at-least`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-20 |
| Bindings read | CLAUDE.md; brief `docs/04-plan/briefs/TASK-043.md` and its card; US-011 Gherkin (EPIC-01) and the gherkin-test-map rows; ADR-0004 (items 1-7, token amendment); data-model §1.5, §3.5 (`outbox_events`, `processed_events`, `job_executions`), §4.4 grant row, §6.1 (relay, purge, SEC-P3-12 amendment); `with-tenant-tx.ts`, `std_columns_guard()`, `idempotent-processor.ts`, the `eslint.config.mjs` owner map and TENANT_TX_FILES on main; developer decisions D-TASK043-01..08 as named in the dispatch (they are NOT in the commit messages, see m7) |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The mechanism is sound and well tested at unit level: one bound INSERT on the business TenantDb with server-
         derived org/actor/correlation, a bounded SKIP LOCKED relay under an advisory lock that marks after accept, a
         predicate-bound idempotent purge, the tracestate drop and the AUTH-refusal test. Two MAJOR: per-aggregate order
         keys on created_at = transaction START, which inverts lock-serialised concurrent writers (M1), and the branch
         deletes the orchestrator's D-ORCH-141 from DECISIONS.md (M2). Seven MINOR, eight NIT.
```

## 1. What I verified myself

Host rule of the dispatch: no install, Jest or Docker in the evidence worktree (an early lane B run is queued there). I ran everything in a `git archive 5193fea4` extract in the scratchpad, `node_modules` junctioned to the evidence worktree's (same SHA, so the `@platform/*` links resolve to identical sources), git-ignored `prisma/generated` copied in, and removed the extract afterwards (worktree `node_modules` count 748 before and after, `git status` clean, HEAD still `5193fea4`).

| Check | How | Result |
|---|---|---|
| Lint | `eslint --max-warnings 0` on every changed `.ts` outside fixtures (45 files, repository config, type-aware) | Clean |
| Format | `prettier --check --ignore-unknown` on every changed file | Clean |
| Types | `tsc -b packages/shared packages/config apps/api apps/worker prisma tools` (outputs into the extract's own `dist/`) | Clean |
| Targeted unit tests | writer, relay, relay-queues, purge, producer, events, start-worker, jobs, system-db, grants-manifest, queues (`--maxWorkers=2`) | 13 suites, 142 tests pass. Jest reports "a worker process has failed to exit gracefully"; isolated to `relay-queues.test.ts` (n2) |
| Lint fixtures | `negative-fixtures -t 'TASK-043\|ok-handler-outbox'` | 5/5 pass (pg driver, PrismaClient construction, whole-file T-83 root, positive writer control, handler `outbox.publish`) |
| tools/db, classification, config | `--testPathPatterns 'tools/db/\|packages/shared/src/classification\|tools/config'` | 22 suites: 20 pass. 2 expected failures: `env-example-parity` (the two `OUTBOX_RELAY_*` lines are user-only, working rule 6) and `prisma-client-package` (extract artefact: needs `prisma/dist`) |
| Migrations lint | `tsx tools/db/lint-migrations.ts` | No findings; `prisma validate` passes |
| Coverage of changed files | the targeted suites with `--coverage` scoped to the changed sources | writer, producer, events, schedulers 100 %; relay 100 % lines / 96 % branches; purge 99 % / 90 %; relay-metrics 100 % / 87 %; `start-worker.ts` lines 123-125 (`createProductionOutboxPurge`) not executed by any unit test (m6) |
| Static checks | `std_columns_guard()` body (INSERT checks created_by/updated_by/version only, so the purge test's back-dated `created_at` is legal); helper env names against `tools/db/bootstrap.ts` and `prisma.config.ts`; `REPO_ROOT` depth; `ux_job_executions__queue_job_key` vs the raw `ON CONFLICT (queue, job_key)`; job-key length (54 of 200) | All consistent |
| Not re-run | all `*.int.test.ts` (AT-US-011-01..06, the purge on PostgreSQL 18, C15, job-executions grants), full `test:unit`, coverage merge, lane A gates | Lane B on `5193fea4` (queued) is the evidence; the `migrated-postgres.ts` helper is unproven until it runs |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | MAJOR | `apps/api/src/platform/outbox/writer.ts:94-101`; `apps/worker/src/platform/outbox/relay.ts:171-178`; migration `created_at DEFAULT CURRENT_TIMESTAMP` | The relay orders by `(created_at, id)`, and the writer leaves `created_at` at its default, which is the **transaction start time**. Two transactions that change the same aggregate are serialised by its row lock, but they commit in lock order, not start order. Example: T1 begins at t0. T2 begins at t1, locks aggregate A, publishes E2 (`created_at` = t1) and commits. T1 then waits for A, publishes E1 (`created_at` = t0) and commits. If one tick sees both rows, it enqueues E1 before E2, which reverses the order of the business changes. That breaks REQ-PLAT-017 and AT-US-011-03 ("in creation order") for the very case ordering exists to protect. The data-model sentence "order holds because the relay publishes in (created_at, id) order" has the same flaw. `uuidv7()` does not help: its tie-break is not commit order either. | Have the writer set `created_at` and `updated_at` to `pg_catalog.clock_timestamp()` explicitly in the INSERT. The guard allows it: it never checks `created_at` on INSERT. A writer that publishes after it changes the aggregate (document this rule in the writer JSDoc) then gets insert-time order equal to commit order under the row lock. Add a lane B test: T1 begins, T2 locks the aggregate, publishes and commits, T1 publishes and commits, one tick runs, and the job order must be E2 then E1. Route the data-model §3.5/§6.1 sentence and the relay-metrics "transaction's start" wording to principal-architect. |
| M2 | MAJOR | `docs/sdlc/DECISIONS.md` (commit `7d6e4cb3`, lines 5689-5697 of main) | The branch deletes the orchestrator's whole **D-ORCH-141** entry, which main has at `efa6d1e0`. The task has no reason to touch this file. A squash merge would silently remove a recorded decision from the log. | In a new commit (no history rewrite), run `git checkout origin/main -- docs/sdlc/DECISIONS.md`. The PR diff must then not list the file. |
| m1 | MINOR | `apps/worker/src/platform/outbox/relay.int.test.ts:6-8` | The header says "`apps/api/src/platform/outbox/writer.int.test.ts` proves that first hop through createApp". That file does not exist: it was removed. So the card's AT-US-008-03 test, "row value equals job payload value equals the originating X-Correlation-Id", is not shown in one test. Today the chain holds only by composition: request-context tests (header to context), `runner-activation.int.test.ts` `sameCorrelation` (context to `app.correlation_id`), and this file (GUC to row to job). AT-US-011-01/-02 do NOT need a route-level test, because transaction atomicity is the point and the worker test covers it. | Make the comment true. Then restore the header hop with an api-side lane B test, `apps/api/src/platform/outbox/writer.int.test.ts`: a `transaction: 'tenant'` fixture route (the `runner-activation.int.test.ts` pattern) that calls `createOutbox(testCatalogue).publish`, sent with `X-Correlation-Id: Client-Corr-…`, then asserts the row's `correlation_id`. For the database, keep a copy of the migration helper under `apps/api/src/platform/outbox/tests/`, because apps cannot import each other's test layers. The worker test already asserts row == job, and the two tests together pin the hop with the same literal. |
| m2 | MINOR | `relay.int.test.ts` AT-US-011-01/-02 | Neither case writes a business change. The Gherkin says "When an order status change commits, then one outbox row exists with … created_at and published_at null". 01 shows that an event commits and 02 shows that a throw removes it, but "with the change" is not observable, and `created_at`, `type`, `aggregate_type`, `aggregate_id` and `payload` are not asserted. | In the same `withTenantTx`, also write a business row. A `rawJobExecutionLedger().claim` row, or any table `platform_app` may write, will do. Assert that both exist in 01 and that neither exists in 02. Add the missing columns to the 01 expectation. |
| m3 | MINOR | `relay.ts:183-205`, `240-253` | Failure behaviour has no bound. (a) A row that fails deterministically is claimed again on every tick, with `attempts + 1` and one UPDATE every 500 ms. That covers a `JobProducerError`, and also any deterministic `add` rejection, which the relay classes as transport and breaks on. Once `batchSize` such rows sit at the head of `(created_at, id)`, the relay makes no progress for anyone. (b) While Valkey is down, `worker.outbox_relay_enqueue_failed` is logged on every tick, about 7,200 lines per hour. `runOnce` does not throw, so the "once per streak" logic in `loop` never applies. (c) There is no backoff, and nothing shows the oldest pending age. ADR-0004 Consequences mentions readiness "relay lag > 60 s". | Back off exponentially in `loop` when a tick failed and published nothing. Log enqueue failures once per streak, as `loop` does. Export an oldest-pending-age gauge. Ask principal-architect whether an attempts cap with park plus an alert is wanted. Pin (b) with a unit test. |
| m4 | MINOR | `migration.sql` `ck_outbox_events__correlation_id`; `with-tenant-tx.ts:166` | The row CHECK is `^[A-Za-z0-9-]{8,64}$`. `withTenantTx` accepts `^[A-Za-z0-9._:-]{1,128}$`, and a scheduled occurrence's correlation id is `repeat:<schedule>:<millis>` (queues.test). The first scheduled or system handler that calls `outbox.publish` will therefore fail with SQLSTATE 23514 and roll back its business transaction. The writer cannot see the value, so the failure has no message. | Pin the contract with a test and pick one fix: normalise in the INSERT (fall back to a v2-grammar id when the setting does not match), give scheduled-job contexts a v2-grammar correlation, or refuse early in SQL with a clear error. At minimum, state the restriction in the writer JSDoc. |
| m5 | MINOR | `apps/api/src/platform/outbox/index.ts:3`; `apps/api/src/platform/runtime/index.ts:77-86`; `packages/shared/src/events/event-definition.ts:36-50` | `createOutbox` ("a test seam") is on both public barrels. Any module can build an outbox over a catalogue of its own and publish an uncatalogued type with an unreviewed payload schema, which bypasses the "identifiers only, never PER" review that the closed catalogue enforces. The database CHECK tests the grammar only. Separately, `mergeEvents` accepts a payload schema declared `.unknown(true)`, and that overrides the `allowUnknown: false` preference. | Export only `outbox` from `outbox/index.ts`. Give the seam to tests under a test-only name or path; the worker int test can take it from a dedicated `@platform/api/runtime` test export named as such. Make `mergeEvents` refuse a payload schema that is not a closed object (`describe().flags?.unknown === true`). Flagged for security-analyst. |
| m6 | MINOR | `apps/worker/src/start-worker.ts:123-125`, `131-143`; `relay.test.ts` composition case | No unit test executes `createProductionOutboxPurge`, so the lane A diff-coverage gate may flag 2 lines (brief rule 9). The composition test's title claims "a budget of half the transaction timeout", but it asserts only the batch size, so mutants `budgetMs = timeout` and `enqueueTimeoutMs = ENQUEUE_TIMEOUT_MS` survive. | Add a unit row for `WORKER_PROCESS.createOutboxPurge`. Pin the budget (2,500) and the enqueue bound (2,000) for timeout 5,000: inject `createOutboxRelay` or observe through a fake clock and a hanging producer. |
| m7 | MINOR | commit messages; `docs/sdlc/DECISIONS.md`; ADR-0004 items 3, 5 | The dispatch says D-TASK043-01..08 are "in the commit messages", but they are not. Only -04, -05 and -06 appear, in code comments. Three of them contradict Accepted text. D-TASK043-06 uses a PostgreSQL advisory lock and an in-process loop, where ADR-0004 item 3 says a Redis lock plus a 30 s repeatable fallback. D-TASK043-07 sends every event to one queue and routes by consumer, where item 5 says a static `eventRouting` map to target queues and an `outbox_unrouted_total` counter. D-TASK043-04 grants less on `processed_events` than data-model §4.4. CLAUDE.md §5 requires architect action for an Accepted-ADR contradiction. | Before merge, the orchestrator records D-TASK043-01..08 in DECISIONS.md, and principal-architect amends ADR-0004 items 3 and 5 (and notes the §4.4 narrowing). This is a ruling, not code; the rulings are in §3. |
| n1 | NIT | `relay.ts:38` | `RELAY_LOCK_KEY` is described as "outbox" in ASCII. 478216878200 is `0x6f57f27878`; "outbox" is `0x6f7574626f78`. | Fix the comment, or use the real value. |
| n2 | NIT | `relay-queues.test.ts` | The test leaves an open handle: Jest force-exits a worker. `open-queue.test.ts` shows the same thing intermittently, so it is pre-existing in class. | Close the queue runtime's connections deterministically, or `unref` the reconnect timer. |
| n3 | NIT | `tests/migrated-postgres.ts:15` | This is the third hand-copied `postgres:18@sha256:…` digest, a drift risk on the next image bump. | Import it from one constant. |
| n4 | NIT | commits `7d6e4cb3`, `f38c193d` | The `wip` type fails `@commitlint/config-conventional`. CI lints only the PR title, so a squash merge is unaffected, but the commit-msg hook was evidently not installed. | Run `npm run hooks:install` in the worktree. |
| n5 | NIT | `relay.int.test.ts` | Two relays at once (advisory lock plus SKIP LOCKED) and a blocked aggregate's ordering are proven with fakes only. | Optional lane B row: two relays tick concurrently, and the union of their jobs is the events exactly once. |
| n6 | NIT | `purge.ts:69-80` | `rawJobExecutionLedger` duplicates `createJobExecutionLedger` and works around the fail-closed accessor that is unbound until TASK-047 (D-TASK043-05). | Record its retirement as a TASK-047 item. |
| n7 | NIT | `start-worker.ts:132-141` | In the worst case, budget 2,500 plus enqueue 2,000 leaves 500 ms for the mark statements inside the 5 s Prisma timeout. A timeout rolls back safely (re-enqueue, then dedupe), but the margin is thin. | Consider budget = `timeout - enqueueTimeout - margin`. |
| n8 | NIT | `packages/shared/src/events/index.ts` | `outbox-relay` has no consumer until TASK-078, so jobs would pile up in Valkey once any event type is catalogued. | Record the dependency: no event type is catalogued before the `outbox-relay` consumer exists. |

## 3. Deviation rulings

| Decision | Ruling |
|---|---|
| D-TASK043-01 `outbox_events` in `outbox.json`, `processed_events` in `worker.json` (brief said `platform.json`) | Accepted. `eslint.config.mjs` on main already maps owner `outbox` to `apps/*/src/platform/outbox/**`, and the worker module owns its bookkeeping. Note for TASK-078/047: module consumers outside `apps/worker/src/platform/**` will need a platform port to write `processed_events`. |
| D-TASK043-02 relay and purge under `apps/worker/src/platform/outbox/` (card: `processors/outbox-relay/**`) | Accepted. It follows the owner map. |
| D-TASK043-03 raw tagged INSERT with server-derived org, actor and correlation | Accepted and endorsed: the caller cannot forge tenant context. M1 adds `created_at`. |
| D-TASK043-04 no UPDATE on `processed_events` | Accepted (least privilege, and the integration test pins 42501). It needs a data-model §4.4 note (m7). |
| D-TASK043-05 raw `job_executions` ledger until TASK-047 | Accepted, with retirement owned by TASK-047 (n6). |
| D-TASK043-06 enqueue inside the claim transaction, bounded; PostgreSQL advisory lock; in-process poll loop | Accepted as code. Enqueue under the claim lock is ADR-0004 item 3. The bounds are real (fail-fast profile, `within`, budget). The loop catches every error and reschedules, so it does not need the 30 s fallback. The ADR text must follow (m7). |
| D-TASK043-07 always `outbox-relay`, routing by consumer | Accepted. It matches the ADR-0013 queue catalogue (`outbox-relay`, kind `outbox_event`) and the data-model SEC-P3-12 amendment. ADR-0004 item 5 (and its unrouted counter) must be amended (m7). |
| D-TASK043-08 invalid stored `traceparent` dropped | Accepted. The writer already stores only valid values, so this is defence in depth. |
| Route-level `writer.int.test.ts` removed | Not required for AT-US-011-01/-02. Required for the single-chain AT-US-008-03 outbox hop, or at least a truthful comment (m1). |
| api README §11/§13 rows | None needed. The diff adds no problem code and no security event, only `worker.outbox_*` log events. |
| `tests/migrated-postgres.ts` | It mirrors `composition.int.test.ts` (bootstrap CLI) plus `tools/deps/prisma-cli.mjs migrate deploy`, and the env names match the tools. Accepted subject to lane B. |

## 4. Merge conditions

1. Fix M1 (with its lane B ordering test) and M2.
2. Fix m1 (at least the comment), m2, m5 and m6. m3 and m4 may be routed to owners with tracked tasks.
3. Record m7: D-TASK043-01..08 in DECISIONS.md and a principal-architect amendment of ADR-0004 items 3 and 5.
4. Lane B PASS on the fixed head: AT-US-011-01..06, the purge on PostgreSQL 18, C15, job-executions grants, and the helper booting.
5. A security record on the head (owned paths: `prisma/**`, `tools/db/**`, `apps/api/src/platform/**`, `packages/shared/package.json`, `tests/fixtures/lint/**`).

## 5. Good

- The writer has exactly one bound statement. Nothing the caller passes reaches `org_id`, `actor_id` or `correlation_id`. Validation runs before any statement, its issues name paths and rule names only, and the catalogue merge refuses duplicates and bad grammar.
- The relay reads identifiers only (pinned: no `payload`, `org_id` or `actor_id` in the claim SQL). It marks after accept, the guard columns are correct (`updated_by` = SYSTEM, `version + 1`), `last_error` is an error class name only, metrics are counted after commit, and the enqueue is honestly bounded.
- The purge is predicate-bound in its own SQL, batched, capped and resumable through the ledger, with a redelivery test.
- The AUTH-refusal test comes with a live mutant that prints the password, the tracestate-drop rows are present, and the grant pins and the C15 literal were extended beside the manifests.

---

# Round 2 (verdict bound to head `da996002`)

| Field | Value |
|---|---|
| Head | `da996002`. Path: `5193fea4`, then `94393c9e` (docs: DECISIONS.md restored), `c60959bd` (fix), `da996002` (F3 `lock_timeout` 10 s, F7 lag gauge at the claim, DECISIONS.md re-synced). I reviewed `c60959bd` in full (R2.1 to R2.4) and the `da996002` delta in R2.6. The evidence worktree is detached at `da996002`; lane B is queued |
| Reviewer | code-reviewer, 2026-11-20 |
| Bindings added | ADR-0004 amendment 2 (items 8-18) and amendment 3 (items 19-22, `57eb12e1` on main); D-ARCH-183..190; D-QG-002 (QG-043-C1..C7); the TASK-043 card FIX CYCLE LINES F1-F12 (D-SD-006); the D-ARCH-188 change list (F13, F3 lock_timeout, F7 gauge at the claim); D-TASK043-01..10 as given in the `c60959bd` commit body |

```
VERDICT: APPROVED_WITH_NITS at da996002 (merge conditions R2-C2, R2-C4, R2-C5 in R2.6)
SUMMARY: M1 is fixed properly: one clock_timestamp() read, the publish-under-lock contract, and a lane B interleaving
         with a control arm that proves the old default inverts. Every round-1 MAJOR and MINOR is closed or closed by
         ruling. The two D-ARCH-188 card lines found at c60959bd (R2-m1 lag gauge at the claim, R2-m2 lock_timeout
         10 s) and the DECISIONS.md merge conflict (R2-n1) are fixed at da996002. Open: R2-m3, the test seam is
         importable by production code (routed to the lint-lock holder), and NITs.
```

## R2.1 What I verified myself

Same host rule. I worked in a `git archive c60959bd` extract, with `node_modules` junctioned to the evidence worktree (HEAD `c60959bd`, so the `@platform/*` links resolve to the same sources) and `prisma/generated` copied in. I removed the extract afterwards: worktree `git status` clean, `node_modules` count 748.

| Check | Result |
|---|---|
| ESLint `--max-warnings 0`, every changed `.ts` outside fixtures (`efa6d1e0..c60959bd`) | Clean |
| Prettier on every changed file | Clean |
| `tsc -b` shared, config, api, worker, prisma, tools | Clean |
| Targeted unit tests (writer, relay, relay-queues, purge, producer, events, start-worker, jobs, system-db, grants-manifest, queues, worker `processors.test.ts`), `--maxWorkers=2` | 14 suites, 154 tests pass |
| `negative-fixtures -t 'TASK-043\|ok-handler-outbox'` | 5/5 pass |
| `lint-migrations` | No findings |
| Coverage of changed sources | writer, purge, events 100 %; relay 100 % lines / 95.5 % branches; relay-metrics 100 % / 87.5 %; `start-worker.ts` 99.1 % (only the pre-existing `createProductionQueues`, lines 119-120, is unexecuted by units) |
| Lint probe (m5) | I put three probe files in the extract, each importing the seam: `apps/worker/src/zz-probe.ts` and an `apps/worker/src/processors/` file through `@platform/api/testing/outbox`, and `apps/api/src/modules/orders/zz-probe.ts` through `../../platform/outbox/tests/test-outbox.js`. All three are lint-clean (R2-m3) |
| Open handle (n2) | `relay-queues.test.ts` paired with one other suite: "worker failed to exit gracefully" in 3 of 3 runs. Still open |
| Merge with current main | `git merge-tree --write-tree origin/main c60959bd` conflicts in `docs/sdlc/DECISIONS.md` only (R2-n1). Every other path merges clean |
| Not re-run | All `*.int.test.ts`, including the new api `writer.int.test.ts`, the interleaving, the two-relay rows and the 23514 rows. Lane B on the final head is the evidence |

## R2.2 Round-1 closure

| R1 ID | Status | Evidence |
|---|---|---|
| M1 | Closed (lane B pending) | `writer.ts`: `created_at, updated_at` = one `pg_catalog.clock_timestamp()` read (`ctx.at`). The unit pin checks both columns, a single clock read and no `now()`. The JSDoc states the publish-after-lock contract. The lane B `interleave()` gates T1/T2 through `pg_stat_activity` with no sleep: the writer arm enqueues E2 then E1, and the control arm (column default) enqueues E1 then E2. The control arm shows the test can detect the inversion |
| M2 | Closed in substance; see R2-n1 | No line of base `efa6d1e0` is removed. The branch file equals main at `3b93b342` |
| m1 | Closed (lane B pending) | `apps/api/src/platform/outbox/writer.int.test.ts`: `createApp` with a `transaction: 'tenant'` fixture route, `X-Correlation-Id: Client-Corr-0103` in, the row's `correlation_id` asserted. The worker test asserts row == job with the same literal. A route that fails after the publish leaves no event. The relay.int header is now true. The api helper is a byte copy apart from its header (`REPO_ROOT` depth checked) |
| m2 | Closed | 01 and 02 write a `job_executions` row in the same transaction. 01 asserts both rows exist and checks `type`, `aggregate_*`, `payload`, `created_at` set and `created_at = updated_at`. 02 asserts neither row exists |
| m3 | Closed by ruling (am. 2 item 11, am. 3 item 19: nothing is parked) | Backoff doubles from the poll interval to 5 s, with one WARN per streak and `recovered` at the end (unit: waits 1000, 2000, 4000, 5000, 5000, then 500). The per-row WARN is gone. Two gauges were added. Residual R2-n2 |
| m4 | Closed; I retract its scheduled-job premise | A scheduled occurrence's correlation id is `<schedule>-<millis>` (`scheduled-job.ts:121`), which is inside ADR-0016 §15. My r1 premise (`repeat:<schedule>:<ms>`) was a misreading. F11 JSDoc, F12 lane B 23514 rows, and unit rows for the relay and purge contexts |
| m5 | Partly closed | `createOutbox` is off both barrels; the barrel key set is pinned. `mergeEvents` refuses `.unknown(true)` and non-object schemas (tested). The seam is importable from production code: R2-m3 |
| m6 | Closed | `WORKER_PROCESS.createOutboxPurge` unit row (statement sequence, SYSTEM scope). `relayBounds` rows: 2,500/1,250 at the defaults, an idle-smaller case, a cap case, and the floor case. The composition exposes the bounds |
| m7 | Closed | D-TASK043-01..10 are in the commit body for the orchestrator. ADR-0004 amendments 2 and 3 cover items 3 and 5 (D-ARCH-183, -184) and §4.4 (D-ARCH-186) |
| n1 | Closed | The lock-key comment now names the registered value |
| n2 | Open | Every queue is now disconnected, but the leak persists (R2.1). It is pre-existing in class (`open-queue.test.ts`) |
| n3 | Deferred, accepted | D-TASK043-10: the lint lock blocks a shared constant |
| n4 | Closed | Hooks installed. Side effect: R2-n4 |
| n5 | Closed (lane B pending) | Two concurrent `runOnce` publish 3 in total, each exactly once. QG-043-C7 (a)/F13: a tick held inside an enqueue makes the second relay return `locked: false`, after which order is kept and attempts are 1 |
| n6 | Closed | The retirement is recorded in D-TASK043-05 (TASK-047) |
| n7 | Closed | F5: budget W/2, enqueue min(2 s, W/4), so at least W/4 is left for the marks; W includes the idle-in-transaction timeout |
| n8 | Closed | F10 `processors.test.ts` fails once a type is catalogued while `PROCESSORS['outbox-relay']` is missing |

## R2.3 New findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `apps/worker/src/platform/outbox/relay.ts:206, 249`; `relay-metrics.ts` `tickEnded` | The card's F7 line ("set the lag gauge at the claim, so a long tick cannot read 0"; D-QG-002 observation; D-ARCH-188 change list; ADR-0004 am. 3 item 22) is not met. The claimed age is kept in a local and published to the gauge only by `tickEnded`, after the commit. While a tick runs, for up to 3W/4, the lock holder still shows the previous tick's value. That value is often 0, while the other workers show 0 too, so the `max` over workers misses the lag exactly when a tick is slow. After a tick that claimed rows and then threw (a failed commit, a mark that timed out), the lag gauge stays stale. These card lines landed on main (`182520b4`, `57eb12e1`) after the branch's base. | Set the lag gauge right after the claim, before the first enqueue, for example with `metrics.lag(age)`. Keep `last_tick_timestamp` at the end of a tick that did not throw. Add a unit row: with the enqueue held open, `render()` already shows the claimed age. Required before merge (card). |
| R2-m2 | MINOR | `apps/worker/src/platform/outbox/relay.int.test.ts:68` | The D-ARCH-188 change list adds to F3: "its runner has a `lock_timeout` of at least 10 s". The lane B runner uses `DB_TX_LOCK_TIMEOUT_MS: 2_000`. In `interleave()`, T1 waits from the moment it blocks until `untilLockWaiter()` sees it and T2 commits. On a loaded lane B host that can exceed 2 s and fail with 55P03, a flake in the one test that proves M1. | Set `DB_TX_LOCK_TIMEOUT_MS: 10_000` in `configFor`; `DB_TX_STATEMENT_TIMEOUT_MS` (10,000) already allows it. Required before merge (card). |
| R2-m3 | MINOR (routed; security flag) | `apps/api/package.json` `./testing/outbox`; `tests/test-outbox.ts` | The seam is off the barrels but stays importable by production code. My probe files in the worker's `src/` and in an api module both lint clean. A module can still publish an uncatalogued type with an unreviewed schema through `createTestOutbox`. The existing `@platform/api/testing` export (timing) has the same gap. | The next holder of the lint lock adds a rule: a non-test file may not import `@platform/api/testing*` or any `**/tests/**` path, with a negative fixture per form. `eslint.config.mjs` is TASK-041's lock, so this is not a TASK-043 merge condition; record it as a card line (TASK-047 already holds the T-83 lint lines). |
| R2-n1 | NIT | `docs/sdlc/DECISIONS.md` | The branch copies main at `3b93b342`. Main has since appended D-SD-006 and D-ARCH-188..190, so merging main conflicts at the end of the file. | At merge-main, take `origin/main`'s file whole. Cleaner: restore the base (`efa6d1e0`) version so the PR carries no DECISIONS delta at all. |
| R2-n2 | NIT | `relay.ts:226-231`, `isFailedTick` | A `JobProducerError` in a tick that also published other rows is not logged anywhere; only `failed_total` rises. Item 16 says a writer-written row cannot cause one, so this is accepted. | Optional: a DEBUG line with the error class. |
| R2-n3 | NIT | `apps/worker/src/processors.test.ts:13-17` | The object-shaped assertion is hard to read. | `expect(types.length === 0 \|\| registered).toBe(true)`, with a message naming the types. |
| R2-n4 | NIT (process, for the orchestrator) | shared `.git/config` | `npm run hooks:install` set `core.hooksPath=tools/hooks` for the shared repository. That covers every worktree and every agent. Each commit now runs `npm exec` Prettier, ESLint and commitlint on the staged files, so a commit without the Node 24 PATH prefix, or in a checkout without `node_modules`, fails. | The orchestrator decides whether to keep it or `git config --unset core.hooksPath`. I left it unchanged. |

## R2.4 Rulings on the new decisions

- **D-TASK043-09** (a test-only export as the seam): accepted, with R2-m3.
- **D-TASK043-10** (no shared digest constant): accepted.
- **F1 to F13:** met as listed in R2.2. The exceptions are F7 "at the claim" (R2-m1) and the F3 `lock_timeout` (R2-m2).

## R2.5 Merge conditions

1. **R2-C1:** fix R2-m1 and R2-m2, plus their unit and lane B rows.
2. **R2-C2:** lane B PASS on the final head. This covers the api `writer.int.test.ts`, AT-US-011-01..06, the interleaving (both arms), the two-relay and held-lock rows, the 23514 rows, the purge, C15 and job-executions. The `migrated-postgres.ts` helper boots in both apps.
3. **R2-C3:** merge main, with DECISIONS.md taken from `origin/main` (R2-n1). The PR diff then carries no DECISIONS change. The orchestrator appends D-TASK043-01..10.
4. **R2-C4:** a security record on the head (owned paths unchanged, plus `apps/api/package.json`). It includes R2-m3 and the D-ARCH-190 confirmation that is due before TASK-078.
5. **R2-C5:** R2-m3 recorded as a card line for the next lint-lock holder.

## R2.6 Delta `c60959bd..da996002` (the bound head)

Checks on a `git archive da996002` extract, set up as in R2.1 and removed afterwards (worktree clean, 748 entries in `node_modules`):

- ESLint and Prettier on `apps/worker/src/platform/outbox/`: clean.
- `tsc -b apps/worker`: clean.
- relay, purge and start-worker unit suites: 43 tests pass.
- `git merge-tree --write-tree origin/main da996002`: clean, with no conflicted path.
- DECISIONS.md is byte-identical to `origin/main`.

| ID | Status | Evidence |
|---|---|---|
| R2-m1 | Closed | `metrics.pendingAge(...)` runs right after the claim, before the first enqueue, and `pendingAge(0)` runs when the lock is not taken. `tickEnded` now sets only the timestamp. New unit row: with the enqueue held open, the gauges read `[33, 0]`, and `[33, 9000]` after the tick ends. A tick that throws after its claim keeps the claimed lag (12) and the timestamp stops |
| R2-m2 | Closed (lane B pending) | `orderRuntime` uses `lock_timeout` 10 s, statement timeout 20 s and idle timeout 30 s. T1 asserts `current_setting('lock_timeout') = '10s'` inside the interleaving. The runtime is closed in `afterAll` |
| R2-n1 | Closed | The merge with main is clean. The PR diff against main carries no DECISIONS.md change once main is merged |
| R2-m3 | Open, routed (R2-C5) | Unchanged |
| n2, R2-n2, R2-n3, R2-n4 | Open NITs | Unchanged |

Merge conditions at `da996002`, replacing R2.5:

- **R2-C2:** lane B PASS on `da996002`.
- **R2-C3:** reduced to "merge main if it moves again; take `origin/main`'s DECISIONS.md".
- **R2-C4:** a security record on `da996002`.
- **R2-C5:** R2-m3 recorded as a card line for the next lint-lock holder.
- **R2-C1:** met.
