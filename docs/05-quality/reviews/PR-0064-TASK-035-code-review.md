# Code review: PR #64, TASK-035 named BullMQ queues, retries, dead-letter queues, payload v2 (round 1)

| Field | Value |
|---|---|
| PR | #64 `feat(worker): named BullMQ queues, retries, dead-letter queues and payload v2 (TASK-035)` |
| Branch / head | `feat/TASK-035-named-bullmq-queues-retries-dead` @ `90ef83f` (one commit) |
| Merge-base with current main | `80dce9e`; main is at `099b78b` (docs-only commits since). |
| Scope / records | TASK-035 card (WAVE-01 batch 1.1) · US-009 AT-US-009-01..05 · AT-US-008-03 job hop (D-062) · ADR-0013 + amendment 1 · D-ORCH-073 / D-ARCH-136 entry point · D-TASK035-01..06 (D-ORCH-COORD-03, accepted in D-ORCH-131 subject to review) |
| Reviewer | code-reviewer · 2026-11-18 · round 1 |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The structure is sound: per-module queue files with a merge guard, a closed no-conversion Joi payload v2,
         a deterministic job id, a jittered custom backoff, a dead-letter record written inside the final attempt (so
         a crash cannot lose it), metrics on /metrics, and the startWorker(deps) entry point with executed tests.
         One MAJOR: the dead-letter record re-uses the job's id as its BullMQ jobId. BullMQ refuses an integer custom
         id, so a job enqueued without a custom id (the forged or foreign job that PAYLOAD_INVALID exists for) gets
         NO dead-letter record. Five MINOR (a queue without kinds accepts a kindless payload; a plain
         UnrecoverableError skips the record; two int-test races; /metrics has no deadline; the Joi subpath has no
         browser boundary) and eight NITs.
```

## 1. Verification I performed myself

Host rule (D-ORCH-131, after D-ORCH-130): static review only. I ran no test, typecheck, lint, build or container. Lane-B evidence for `consumer.int.test.ts`, which has never run, is being produced by the orchestrator. The verdict does not rely on it.

| # | Check | Result |
|---|---|---|
| V1 | `git log` / `git diff --stat origin/main...90ef83f` | 34 files, +2212/-72. New `packages/shared/src/queues/*` (8 module files, definition, job options, payload v2, test), `apps/worker/src/platform/queues/*` (consumer, dead-letter, errors, metrics, runtime, connection, unit and int tests), `start-worker.ts` + tests, `processors.ts`, the `/metrics` route, and the api producer exported through `@platform/api/runtime`. |
| V2 | Lane A run 44105548507 (`gh run view`) | `fast-lane` is red only on `quality:check-evidence`. `ci-gate` is red only on the missing security record. So lint, format, typecheck, unit and build were green on the head. The classifier says `security_paths=true`, but `security_integration_due=false` (`record_ok=false`), so `security-integration` was SKIPPED. It is due once the security record exists. |
| V3 | BullMQ 6.7.0 source (`node_modules/bullmq/dist/esm/classes/{job,backoffs,queue-base}.js`) | `Queue name cannot contain :` (queue-base:24) confirms D-TASK035-01. `Custom Id cannot be integers` and `cannot contain :` unless 3 parts (job:907-916) confirm D-TASK035-02, and they are the basis of R1-M1. `shouldRetryJob` (job:445) treats `instanceof UnrecoverableError \|\| name == 'UnrecoverableError'` as final. It passes `attemptsMade + 1` to the custom strategy (job:455), so `retryDelayMs(1)` = 2 s, 4 s, 8 s, 16 s, as the card requires. `lookupStrategy` uses the custom strategy for an unknown type. |
| V4 | Joi probe (scratchpad, worktree `node_modules/joi`) | `kind: Joi.any().forbidden()` accepts `{v:2,id,correlation_id,trace_context:null}` (no `kind`): **VALID**. It refuses the same payload with `kind: 'saga'`. This is R1-m1. |
| V5 | Lockfile delta (`git diff --text`) | Exactly one line: `"joi": "^18.3.2"` added to `packages/shared`'s dependencies. No package added or changed. `joi@18.3.2` is already in the tree (BSD-3-Clause, on the LICENSE_ALLOWLIST; used by `apps/api` and `packages/config` at the same range; Joi is the fixed backend validator). The new-dependency justification holds: no new code enters the closure. |
| V6 | P1 overlap: file sets of `origin/main...` for #61 `14cdeed`, #62 `1c4dc00`, #63 `fcdb7ac`, #65 `d3c2c16`, TASK-290 `ba921da` vs this PR | **No common file.** Only dependabot #58 overlaps (`package-lock.json`), and it bumps `bullmq` 6.7.0 → 6.7.2. #63 adds `packages/shared/src/errors/catalogue/*`. None of its codes collide with `NON_RETRYABLE_REASONS`, and it does not touch `packages/shared/package.json` or the root barrel. No locked hot file is edited (`eslint.config.mjs` is untouched, which is why R1-m5 is routed rather than fixed here). |
| V7 | Card AC walk (§4) | All AT-US-009 IDs are in the int-test titles (`-03-1`/`-03-2` per the outline rule of the gherkin map). The worker entry-point clause is met: start-worker.ts, a main.ts body pin, entry-points pins moved, and the stale comment fixed at start-worker.ts:109-110. |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| **R1-M1** | **MAJOR** | `apps/worker/src/platform/queues/consumer.ts:103-107` | The dead-letter record is added with `jobId: job.id`. A job enqueued without a custom id gets a BullMQ auto-increment id (`"7"`). `Job.validateOptions` then throws `Custom Id cannot be integers` on the dead-letter add. The catch logs `worker.dead_letter_write_failed`, and no record is written. Only the producer sets deterministic ids, so the jobs that reach PAYLOAD_INVALID are exactly the forged, edited or foreign ones (ADR-0013 am. 1 item 2). Those are the most likely to have auto ids. The card AC "invalid payload -> DLQ without processing" and the `platform_queue_dead_letter_jobs` gauge therefore miss them. The failed set is still a backstop, but the operator view and the AT-US-009-05 gauge do not show them. Every int case passes an explicit `jobId`, so nothing pins this. | Derive a dead-letter id that BullMQ always accepts, for example `${job.id}.dead`. That is never an integer, and a 3-part `a:b:c` id stays 3-part. Alternatively, omit `jobId` when `job.id` is integer-like. Keep it deterministic so a redelivered final attempt stays one record. Add an int case: `queue.add('outbox_event', payload({ org_id }))` with **no** `jobId` → exactly one dead-letter record plus the security event. |
| R1-m1 | MINOR | `packages/shared/src/queues/payload-v2.ts:62-63`; comments at `audit.ts:2-3`, `platform.ts:2-3`, `payload-v2.ts:59` | On a queue with `kinds: []` (`audit-maintenance`, `housekeeping`), `kind: Joi.any().forbidden()` only forbids the key. A payload **without** `kind` validates (V4) and would reach the processor with `kind` undefined, typed as `JobKind`. Three comments and D-TASK035-05 say every job on these queues is refused. It is latent only because `PROCESSORS` is empty. TASK-039 registers these processors. | When `kinds` is empty, refuse every value, for example by returning a schema whose `kind` is `.required()` with no valid value, or a top-level `Joi.any().forbidden()`. Add the kindless payload to the `housekeeping` case in `queues.test.ts`. |
| R1-m2 | MINOR | `apps/worker/src/platform/queues/consumer.ts:91` (and `errors.ts:260`) | `final` recognises only `NonRetryableError`. A processor that throws BullMQ's own `UnrecoverableError`, or any error named `UnrecoverableError`, is final for BullMQ (V3). Here it counts as `final: false`, so no dead-letter record is written, and the log says it will retry. | Mirror BullMQ's predicate: `error instanceof UnrecoverableError \|\| (error as Error)?.name === 'UnrecoverableError'`, with reason `NonRetryableError`'s reason when present, else a fixed reason such as `UNRECOVERABLE`. Add a unit/int case. |
| R1-m3 | MINOR | `apps/worker/src/platform/queues/consumer.int.test.ts:188-191`, `:256-260` | Two races against the design itself. The record is written **before** BullMQ moves the job to failed. AT-US-009-02 polls until the record appears, then reads `getState()` once and expects `failed`. AT-US-009-05 stops polling on the dead-letter gauge alone, then expects `state="failed"} 1` in the **same** snapshot. In both, the window between the record write and `moveToFailed` (a few ms, set against a 50 ms poll) can show `active`. That flake would turn the first lane-B run red. | Poll both conditions: `until(state === 'failed')` in -02, and an `until` predicate requiring both the dead-letter `1` and `failed"} 1` in -05. Ideally fix this before the orchestrator's lane-B run, since the file has never run. |
| R1-m4 | MINOR | `apps/worker/src/platform/health/server.ts:68`; `apps/worker/src/platform/queues/connection.ts:146-150` | `/metrics` awaits `queues.metrics()` with no deadline. Every `Queue` shares the worker connection options, which have `maxRetriesPerRequest: null`, no `commandTimeout` and ioredis' offline queue. During a Valkey outage each scrape hangs. It adds 18 `getJobCounts` to the offline queue, and it keeps an HTTP connection open that only `forceClose` ends at shutdown. CLAUDE.md §9 requires a timeout on every external call. Only the Worker's blocking connection needs the "no retry cap / no command timeout" options. | Bound `metrics()` (for example 2 s, the readiness budget, and a value-free 503 on expiry) and pin it with a never-resolving source. Prefer a second builder for non-blocking `Queue` instances (metrics, dead-letter, and the TASK-043 producer) that keeps `commandTimeout` and sets `enableOfflineQueue: false`. |
| R1-m5 | MINOR | `packages/shared/package.json:19-23` | D-TASK035-03 says Joi is "exposed only through the queues subpath", but nothing enforces it. Unlike `@platform/shared/logging` (`eslint.config.mjs:408-420`, both arms plus the root-barrel transitive rule), web, admin, ui and pricing can import `@platform/shared/queues`. The root barrel could also re-export it and pull Joi into the browser bundle. The stack says Zod on the frontend and Joi on the backend. | `eslint.config.mjs` is a locked hot file and this card does not hold the `lint` lock, so do not edit it here. **Route:** add `@platform/shared/queues` to the server-only boundary in the next PR that holds the `lint` lock (orchestrator to name the owner). Optionally, add a cheap pin in `queues.test.ts` now: `packages/shared/src/index.ts` does not reference `./queues`. |
| R1-n1 | NIT | `payload-v2.ts:60`, `consumer.ts:116` | `payloadSchemaFor` builds a new Joi schema for every dequeued job. | Memoise per `QueueDefinition` (WeakMap) or build once in `createQueueConsumer`. |
| R1-n2 | NIT | `consumer.ts:153` | A `worker.run()` rejection is only logged. The process stays ready with a dead consumer. Today this happens only on a programmer error. | Route it to the process error handler (rethrow on a later task), or flip readiness. |
| R1-n3 | NIT | `start-worker.ts:143-144` | After the 25 s drain bound, `forceClose` closes only HTTP sockets. `queues.close()` re-awaits the pending memoised drain and always hits its 3 s close timeout, so the queue connections are never closed, although exit 1 still happens. | Let `forceClose` also call `worker.close(true)` on the consumers. |
| R1-n4 | NIT | `apps/api/src/platform/queues/producer.ts:80-81` | A bad `step` throws `TypeError` from `jobIdFor`, not `JobProducerError`. `add` has no deadline (same root cause as R1-m4). | Validate `step` before building the payload, or wrap it. TASK-043 bounds the add. |
| R1-n5 | NIT | `job-options.ts:41`, `producer.ts:81` | `removeOnFail: false` combined with a deterministic id means re-enqueueing a dead-lettered business key is a silent BullMQ no-op, and the producer still returns it as enqueued. This is by design, but the TASK-043 relay must not read "enqueued" as "will run". | Say so in the producer JSDoc. Replay goes through `job.retry()`. |
| R1-n6 | NIT | `consumer.ts:144` | D-TASK035-06 (a stalled job goes to failed with no dead-letter record) leaves no log line. The only signal is the failed gauge exceeding the dead-letter gauge. | Add a `worker.on('failed')` listener that logs `worker.job_failed_unrecorded` when the failure did not pass through `recordFailure`. |
| R1-n7 | NIT | `consumer.int.test.ts:297-341` | The NFR-RES-004 case is an in-process `close(true)`. For Valkey that is equivalent to a kill (the lock expires and the job stalls), but it is not the `kill -9` / Valkey-restart pair of ADR-0013 Verification and TEST-STRATEGY §349. | Route the Valkey-restart case to the `jobs-resilience` activation (see §5). |
| R1-n8 | NIT | `runtime.ts:41-45` | Each `Queue` and `Worker` opens its own connections: 18 for the queues plus 2 per consumer, about 36 per process with every consumer. | Share one ioredis client for the non-blocking `Queue` instances when the R1-m4 builder lands. |

## 3. Deviation rulings (D-TASK035-01..06)

| Decision | Ruling |
|---|---|
| 01 `<queue>-dead` | **Accepted.** BullMQ 6.7 refuses `:` in a queue name (V3). `mergeQueues` refuses a module queue that ends in `-dead`, so there is no collision. ADR-0013 §1 still says `<queue>:dead`, so the architect should note the spelling at the next ADR-0013 touch. |
| 02 `<kind>.<id>[.<step>]` | **Accepted.** The ADR's `booking:<id>:<step>` would trip the 3-part `:` rule for 2-part ids (V3). R1-M1 is the knock-on effect on the dead-letter id. |
| 03 Joi in `@platform/shared` via the queues subpath | **Accepted** for the dependency (V5). The "only through the subpath" half is unenforced (R1-m5). |
| 04 constant concurrency | **Accepted for M0.** ADR-0013 §6 says "from config". That is unowned, so it goes in the follow-up list. |
| 05 no kinds for `audit-maintenance` / `housekeeping` | **Accepted, conditional on R1-m1.** As written, a kindless payload is accepted. |
| 06 stalled → failed without a dead-letter record | **Accepted.** Writing the record inside the final attempt is strictly safer than the ADR's `failed`-listener design (a crash between the two cannot lose it, and a redelivered final attempt is deduplicated by the deterministic dead-letter id). The ADR text should be aligned. Logging is R1-n6. |

Also accepted: the custom `jittered-exponential` type in place of `exponential` plus a strategy. ±20 % jitter centred on the nominal delay matches AT-US-009-01 "about 2 s and 4 s with jitter". BullMQ's built-in `jitter` only shortens the delay.

## 4. AC walk

| AC | Where | Status |
|---|---|---|
| AT-US-009-01 | `consumer.int.test.ts:151` (2 s base, draw 0.5, bounds ≥1.95 s / ≥3.95 s) + `queues.test.ts` band pins | Met (int pending lane B) |
| AT-US-009-02 | `:175` | Met, with the R1-m3 race |
| AT-US-009-03 (-1, -2) | `:194` | Met |
| AT-US-009-04 | `:213` + unit `queues.test.ts:37` | Met for custom-id jobs (R1-M1) |
| AT-US-009-05 | `:239`, server.test, start-worker.test | Met, with the R1-m3 race |
| Payload v2 identifiers only; invalid → DLQ without processing | `queues.test.ts`, `:213`, `:229` | Partial (R1-M1, R1-m1) |
| Crash/restart, 0 lost jobs (NFR-RES-004) | `:297` | Met (R1-n7) |
| AT-US-008-03 job hop | `producer.test.ts:117/133`, `:281` | Met: copied, never generated, refused without one, bound for the whole job |
| Deterministic ids / duplicate enqueue is one job | `:266` | Met |
| Worker entry point (D-ORCH-073, D-ARCH-136) | `start-worker.ts`, `main.test.ts`, `entry-points.test.ts:46-69` | Met, with no coverage exclusion or threshold change |

## 5. Follow-ups routed (not merge conditions for this PR)

- `jobs-resilience` in `tools/quality/required-suites.json` is still `planned` with `activate_with: US-009`. This PR completes US-009, but nothing activates the suite, and `activate_with` is not enforced by any tool. The AT-US-009 cases run under `integration`. Orchestrator / qa-lead: name the owner of the activation, plus SEC-TC-20 (TASK-047) and the Valkey-restart case (R1-n7).
- Unowned ADR-0013 items: §9 `maxmemory-policy noeviction` asserted at worker start; §6 concurrency from config (D-TASK035-04); §8 duration histograms and relay lag; §1/§2 spelling (`-dead`, `.`-separated ids).
- R1-m5 boundary rule goes to the next `lint`-lock holder.

## 6. Merge conditions

1. R1-M1 fixed with the auto-id int case. Fold R1-m1 and R1-m3 into the same fix cycle, ideally before the lane-B run of this head, because `consumer.int.test.ts` has never run.
2. Lane-B evidence on the final head is green, including `consumer.int.test.ts` (all 10 cases) and merged coverage over `consumer.ts` and `runtime.ts`.
3. Security record on the head, then a green hosted `security-integration` run (`security_paths=true`, due once `record_ok`).
4. Lock order: dependabot #58 bumps `bullmq` to 6.7.2 and touches `package-lock.json`. The second of #58 and #64 to merge regenerates the lock, and the int suite must re-run on the result, because the R1-M1, R1-m2 and V3 behaviour is version-pinned BullMQ source.
5. Round 2 is a delta review of the fix commits.

---

# Round 2: delta review of fix cycle 1 (`90ef83f..266abb6`)

| Field | Value |
|---|---|
| Delta | `266abb6` `fix(worker): dead-letter id, queue error listener, sanitised failures, fail-fast queue profile (TASK-035)`, 17 files, +1027/-130. The local head `4eab6c2` adds only the lane-B evidence (`docs/05-quality/tests/runs/20261118T1229Z_266abb6/`). |
| Push state | Not pushed: origin is still at `90ef83f`. |
| Reviewer | code-reviewer · 2026-11-18 · round 2 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every in-scope r1 finding is fixed and pinned by a test: the namespaced dead-letter id (R1-M1, with the
         auto-id int case), the kindless/undefined payload (R1-m1), UnrecoverableError as final/UNRECOVERABLE (R1-m2),
         settledFailure polling (R1-m3), two connection profiles plus a 2 s /metrics deadline (R1-m4) and the memoised
         schema (R1-n1). The job-handler/open-queue split is a clear improvement. No BLOCKER, MAJOR or MINOR; five NITs.
```

## R2.1 Verification I performed myself

Host rule (heavy lane-B run on this machine): static review only. I ran no npm, Jest, typecheck, lint, build or Docker. I read `git diff 90ef83f 266abb6` in full, plus the touched files in context, BullMQ 6.7.0 source in the worktree's `node_modules`, and the lane-B evidence committed in `4eab6c2`.

| # | Check | Result |
|---|---|---|
| R2-V1 | Lane-B `summary.md` / JUnit at `266abb6` | PASS. integration 345/345, including all **14** `consumer.int.test.ts` cases with 0 failures and 0 skips. That covers the new R1-M1 auto-id case, PR64-SEC-02, R1-m2 and the corrected `job_context_mismatch` shape. unit 6847 (2 skipped, both pre-existing), including `job-handler.test.ts`, `open-queue.test.ts` (3 cases) and the new `/metrics` deadline case. Merged coverage is 99.38 % lines / 96.42 % branches. `consumer.ts`, `job-handler.ts`, `open-queue.ts`, `runtime.ts`, `connection.ts`, `dead-letter.ts` and `errors.ts` are all 100 %. |
| R2-V2 | BullMQ `worker.js:647-670` (`handleFailed`), `job.js:445-455` (`shouldRetryJob`), `job.js:941-954` (`updateStacktrace`), `job.js:830-842` (`retry`) | `failedReason` is `err.message`, and `stacktrace` is emptied when `stackTraceLimit === 0`. The retry decision reads `instanceof UnrecoverableError \|\| name == 'UnrecoverableError'`, and `persistedFailure` keeps that. Control-flow errors are recognised by class/name (`DelayedError`, `WaitingError`, `WaitingChildrenError`) or by `message === RATE_LIMIT_ERROR`, so sanitising turns them into TRANSIENT (D-TASK035-10). `retry()` resets `attemptsMade` only with `resetAttemptsMade`, which matches the `deadLetterJobId` JSDoc. |
| R2-V3 | `buildValkeyOptions` (`apps/api/src/platform/valkey/options.ts:94-125`) | The `queue` profile inherits `commandTimeout` 2 000, `maxRetriesPerRequest` 1, the jittered reconnect and `enableReadyCheck: false`, and adds `enableOfflineQueue: false`. The `worker` profile drops `commandTimeout` and sets `maxRetriesPerRequest: null`, as before. Both are pinned in `queues.test.ts`. |
| R2-V4 | `origin/main` for `UNRECOVERABLE` | No collision with the #63 error catalogue or any other code. |

## R2.2 Closure of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** | `deadLetterJobId` (`dead-letter.ts:24-26`) returns `<id>.dead.<attempts>`, or `undefined` for a missing or empty id. It is never an integer, and a 3-part `:` id stays 3-part. Unit: `queues.test.ts` (`'7' -> '7.dead.1'`, `a:b:c`, determinism) and `job-handler.test.ts` `[R1-M1]`. Int: `[R1-M1] a forged job enqueued WITHOUT a custom id`. That case asserts an integer `job.id`, exactly one record readable at `<id>.dead.1`, the security event, and no `dead_letter_write_failed`. Green in lane B. |
| R1-m1 | **Closed** | An empty `kinds` gives `Joi.any().required().custom(-> any.invalid)`, and the object itself is `.required()`. `queues.test.ts` `[R1-m1]` covers the kindless, kinded and `undefined` payloads on both kindless queues. `job-handler.test.ts` covers the kindless payload end to end. |
| R1-m2 | **Closed** | `isUnrecoverable` mirrors BullMQ's predicate. `nonRetryableReason` maps it to `UNRECOVERABLE`, and the record keeps the class `UnrecoverableError`. Covered by unit tests (`errors`, `deadLetterRecord`, `job-handler`) and the int case (one call, a `failed` state, `failedReason` `UNRECOVERABLE`). |
| R1-m3 | **Closed** | `settledFailure` polls the record(s) and the `failed` state in one predicate. It is used in -02, -04, the PR64-SEC-02 case, the R1-m2 case and the R1-M1 case. -05 now requires both gauges in one snapshot. Residual: R2-n1. |
| R1-m4 | **Closed** | `/metrics` races `metrics()` against `METRICS_DEADLINE_MS` (2 s). The late rejection is consumed, the timer is cleared, and the response is a value-free 503. `server.test.ts` pins this with a never-settling source, a 100 ms deadline, a bounded `workMs` and a live server afterwards. Every `Queue` now uses the fail-fast `queue` profile, and only `Worker`s keep the blocking one. Residual: R2-n2. |
| R1-n1 | **Closed** | A `WeakMap` memo per `QueueDefinition`, pinned by `builds the schema of a queue once`. |
| R1-m5, R1-n2..n8 | Out of scope by decision, unchanged | R1-m5 is still routed to the next `lint`-lock holder. R1-n6 and R1-n8 remain open (see §R2.5). |

## R2.3 New structure and the log-shape fix

- **`job-handler.ts` extracted from `consumer.ts`: good.** The per-job logic now runs under unit test with fakes (`HandledJob`, `DeadLetterSink`), and `consumer.ts` is only `Worker` wiring. Behaviour is preserved: `recordFailure` still runs before the rethrow, and a failed record write is still logged by class only and never masks the error. The order record -> `redactStoredData` -> throw is crash-safe. A crash between the two steps redelivers the same attempt number, so the record add deduplicates on the same id and the redaction happens on the redelivery. A failed `updateData` cannot turn the refusal into a retry, and that is pinned.
- **`persistedFailure`: correct.** It keeps the reason code only and sets `stack` to `name: message`. A non-retryable failure stays a `NonRetryableError` (name `UnrecoverableError`), so BullMQ's decision is unchanged. That is pinned at unit level (`instanceof UnrecoverableError`, no sentinel) and end to end (`failedReason` `TRANSIENT` / `PAYLOAD_INVALID` / `UNRECOVERABLE`, `stacktrace` `[]`, no sentinel in `JSON.stringify(job)`). The job-level `stackTraceLimit: 0` covers errors raised outside the wrapper.
- **`openQueue` factory: good.** It attaches a listener that logs the class only. Test (a) is not vacuous: it asserts that the password did cross the wire to the refusing fake server. It also covers the consumer's `Worker` listener, because the consumer meets the same refusal. The source scan is a useful speed bump with limited reach (R2-n5).
- **`isTracestate`: correct and linear.** Its patterns are anchored with bounded repetition, it has one `^` start, the trim is a loop and there is a member cap. The key and value classes match W3C level 1 (`chr`/`nblk-chr`, `tenant@system`). The scaling test uses best-of-7 against a 64x quadratic signal, which is robust. It is stricter than the spec on empty members (R2-n3).
- **The `job_context_mismatch` assertion fix is correct.** `securityEvent` emits `event: '<name>'` with `event_type: 'security'` (`security-event.ts:4, 174`). The r1 int assertion on `'security.job_context_mismatch'` could never have matched, and it was latent only because the file had never run. Both the int test and the new unit test now assert the real shape, and lane B is green.

## R2.4 Findings (round 2)

| ID | Severity | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| R2-n1 | NIT | `apps/worker/src/platform/queues/consumer.int.test.ts:255-272` | AT-US-009-03 still asserts `calls === 1` right after the record appears. A wrongful retry would come after `moveToFailed` plus the 10 ms backoff, so the assertion passes before that retry could happen. The test is not flaky; it is weak in the vacuous direction. The R1-m2 int case shows the stronger pattern. | Use `settledFailure` here too: the `failed` state is reached only when the failure was final, so `calls === 1` is then conclusive. |
| R2-n2 | NIT | `runtime.ts:47-48, 58`; `consumer.ts:59, 66`; `start-worker.ts:82-83` | Which profile each client gets is unpinned. Swapping `connection` and `queueConnection` at any of these call sites passes every test: behaviour is identical while Valkey is up, and in `open-queue.test` (a) both profiles meet the same refusal. The profiles themselves are pinned; their wiring is not. | Add one cheap unit assertion on the built objects, for example that every `Queue` from `openQueue` in the runtime has `opts.connection.enableOfflineQueue === false` and the consumer's `worker.opts.connection.maxRetriesPerRequest === null`. A `createProductionQueues` variant can check the connection names `worker-consumers` / `worker-queues`. |
| R2-n3 | NIT | `packages/shared/src/queues/payload-v2.ts:65-77` | `isTracestate` refuses empty and blank list members (`'a=b,,c=d'`, `'a=b,'`; pinned as refused in `queues.test.ts`). W3C Trace Context §3.3.1.1 allows them, yet the JSDoc says the check "follows the W3C grammar". The producer refuses the whole enqueue on an invalid payload (`producer.ts:79`). If TASK-043 copied a raw inbound `tracestate` (spec-valid with empty members) into `traceContext`, business work would fail on a telemetry field. Latent: no caller passes a trace context today. | Either skip blank members in `isTracestate` (still counting at most 32 non-empty members) and pin `'a=b,,c=d'` as accepted, or have the TASK-043 producer drop an invalid `tracestate` rather than refuse the job (W3C: discard on parse failure). Route to TASK-043 if not done here. |
| R2-n4 | NIT | `apps/worker/src/platform/queues/job-handler.ts:37-38` (the `JobProcessor` JSDoc) | D-TASK035-10 makes BullMQ's control-flow errors unsupported. `persistedFailure` turns `DelayedError`, `WaitingError`, `WaitingChildrenError` and `RateLimitError` (recognised by message) into a TRANSIENT retry. The processor contract does not say so. The list should also include `WaitingError`, which BullMQ 6.7 checks too (R2-V2). | Add one sentence to the `JobProcessor` JSDoc: BullMQ control-flow errors are not supported and count as transient failures. |
| R2-n5 | NIT | `apps/worker/src/platform/queues/open-queue.test.ts` (source scan) | The scan is lexical. It misses `import { Queue as Q }` / `new Q(`, `import * as bullmq` / `new bullmq.Queue(`, and `Reflect.construct`. Its `//.*$` comment strip also removes code after a `'redis://...'` string on the same line. Separately, the api-side producer queue (TASK-043) is outside the worker scan and has no `error` listener of its own, so the PR64-SEC-01 leak would recur there. | Acceptable as a speed bump. At the next `lint`-lock holder, a `no-restricted-imports`/`no-restricted-syntax` rule on `bullmq` `Queue` outside `open-queue.ts` reaches further. Route "api producer `Queue` gets a class-only `error` listener" to TASK-043. |

## R2.5 Rulings on D-TASK035-07..13

| Decision | Ruling |
|---|---|
| 07 dead-letter id `<job id>.dead.<attempts>` | **Accepted, preferred over the r1 suggestion `<id>.dead`.** It stays deterministic for a redelivered final attempt, because a stall does not increment `attemptsMade`. It also gives a later final failure after an operator `retry()` its own record, which closes the record-reuse half of PR64-SEC-08. The JSDoc correctly describes the `resetAttemptsMade` exception (R2-V2). An empty or missing id lets BullMQ assign the id. |
| 08 `openQueue` factory + source scan | **Accepted.** It is the single construction point and has a non-vacuous AUTH-refusal test. The scan's reach and the api producer are covered in R2-n5. |
| 09 sanitised persisted failures | **Accepted.** It is what PR64-SEC-02 asked for, and it is verified against BullMQ source (R2-V2) and end to end. Redacting stored data only for refused payloads is right: a validated payload is identifiers-only. The original error text survives only in the redacted, bounded dead-letter record and as a class name in the log. |
| 10 `DelayedError` / `RateLimitError` / `WaitingChildrenError` unsupported | **Accepted.** Processors receive the payload and a `ProcessorJob` without a token or worker handle, so they cannot use these legitimately. Document it and include `WaitingError` (R2-n4). |
| 11 two connection profiles | **Accepted.** The `queue` profile follows BullMQ's own guidance for non-blocking `Queue`s (fail fast, no offline queue), and only `Worker`s keep the blocking options. A dead-letter write during an outage now fails at once. It is logged, and the failed set remains the backstop, as designed in r1. Wiring is unpinned (R2-n2). R1-n8 (one connection per `Queue`) is still open, out of scope. |
| 12 reason `UNRECOVERABLE` | **Accepted.** It is in `NON_RETRYABLE_REASONS` and does not collide with any code on main (R2-V4). |
| 13 `tracestate` kept and W3C-validated; payload object `.required()` | **Accepted.** Security offered dropping `tracestate` or validating it; validating is within that remit. Linear time is shown. Strictness on empty members is R2-n3. The root `.required()` also closes a latent hole: a Joi object schema accepts `undefined` unless required, so `validateJobPayload(def, undefined)` used to return `ok: true` with an undefined payload. |

## R2.6 Merge conditions

1. Push `4eab6c2` (the code head is `266abb6`, and the evidence binds to it). Hosted lane A must be green on the pushed head, including `security-integration`, which is due once the security record exists (r1 V2).
2. Security delta round on `266abb6` verifying C1 (PR64-SEC-01) and PR64-SEC-02/-03/-05. This review does not replace it.
3. Lock order with dependabot #58 (bullmq 6.7.2, still open) is unchanged from r1 §6.4. The second of the two to merge regenerates the lock and re-runs the int suite, because R2-V2 is pinned to BullMQ 6.7.0 source.
4. NITs R2-n1..n5 are optional. R2-n3 and the api half of R2-n5 are routed to TASK-043 if not taken here.
