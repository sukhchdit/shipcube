# ADR-0013: Background jobs — BullMQ queues, retries, dead letters, schedulers, idempotent processors

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.13, §4.6; REQ-PLAT-013/014/015/022, REQ-RLS-008, REQ-TRACK-003/004, REQ-AUDIT-013/017, REQ-PAY-018, DR-A25, DR-B19; NFR-RES-004, NFR-AVAIL-002, NFR-OBS-002/003; ADR-0004 (outbox), ADR-0014 (saga)

## Decision

1. **Queues** (names are constants in `packages/shared/queues.ts`): `booking` (saga steps), `payments` (webhook processing, capture, refund, authorisation sweeper), `documents` (PDF generation, storage), `pickups` (schedule/cancel with carrier), `tracking-poll` (adaptive polling), `notifications` (render + send), `audit-maintenance` (partition pre-creation daily, chain verify hourly/nightly, nightly checkpoint), `outbox-relay` (500 ms scheduler + 30 s fallback), `housekeeping` (expired tokens, idempotency keys > 24 h, published outbox > 30 d, drafts > 30 d, MFA challenges). Each queue has a ~~`<queue>:dead`~~ `<queue>-dead` dead-letter queue (BullMQ `removeOnFail: false` + a `failed` listener moving exhausted jobs with redacted data, reason and attempt count). *Amended 2026-11-19 by amendment 3: the name is `<queue>-dead` (item 7); failed jobs and dead-letter records are bounded, so `removeOnFail: false` no longer holds (items 8–10); as built by TASK-035 the queue constants live in `packages/shared/src/queues/` (`@platform/shared/queues`) and the consumer writes the record before BullMQ marks the job failed, in place of a `failed` listener.* *Amended 2026-11-20 by amendment 5 item 24: `outbox-relay` is the queue of the `outbox_event` jobs; the relay itself is no job, so "(500 ms scheduler + 30 s fallback)" is withdrawn.*
2. **Job options**: deterministic `jobId` from the business key (e.g. ~~`booking:<saga_id>:<step>`, `tracking:<shipment_id>`, `outbox:<event_id>`~~ `saga.<saga_id>.<step>`, `tracking_poll.<schedule_id>.<occurrence>`, `outbox_event.<event_id>`), `attempts: 5`, `backoff: { type: 'exponential', delay: 2000 }` + custom jitter strategy, `removeOnComplete: { age: 86400, count: 10000 }`. Non-retryable errors (`NonRetryableError`: validation, missing tenant context `MISSING_TENANT_CONTEXT`, permission) skip retries and go straight to the DLQ (DR-A25). *Amended 2026-11-19 by amendment 3: a job id is `<kind>.<id>` or `<kind>.<id>.<step>` (item 7), a recurring key carries its occurrence (item 11), and `removeOnFail` is bounded (item 8).*
3. **Payload contract**: `{ v: 1, org_id, actor_id, correlation_id, idempotency_key, trace_context, data }`; processors open `withTenantTx` with the payload's `org_id` (REQ-RLS-008); system-wide schedulers iterate organisations explicitly. *Superseded 2026-11-12 by amendment 1: payload v2 carries `kind` + `id` only and the processor resolves `org_id` from PostgreSQL (`platform.job_context`).*
4. **Idempotent processors**: `job_executions(job_key UNIQUE, status, result, completed_at)` written in the processor's transaction; a duplicate delivery of a completed job returns without side effects (REQ-PLAT-014). Outbox consumers additionally use `processed_events` (ADR-0004). *Amended 2026-11-20 (TASK-039 code review R1-m1 and R1-n8; D-ARCH-171; data-model §3.5): the key is unique per queue, `(queue, job_key)`, because BullMQ scopes job ids per queue and one payload kind can be a job of two queues. A row is deleted 30 days after completion, so a job id is one-shot on its queue for that time.* *Amended 2026-11-20 (TASK-043 security review PR043-SEC-06; ADR-0004 amendment 4 item 26; D-ARCH-198): 45 days, from the task that moves the purge behind definer functions, so that a claim outlives a replayed delivery of its event.*
5. **Schedulers**: BullMQ **Job Schedulers** (`upsertJobScheduler`) registered idempotently at worker start, so N workers run each schedule once per interval (REQ-PLAT-015). Schedules (config): outbox relay 500 ms (lock-guarded loop) / 30 s fallback; audit partitions daily 02:00 UTC; chain verify hourly incremental + nightly full 03:00; checkpoint nightly 03:30; payment sweeper every 5 min; tracking poll planner every minute (enqueues due shipments per DR-B19 intervals with ±10 % jitter and failure backoff); housekeeping hourly. *Amended 2026-11-20 by amendment 5 item 24: the outbox relay is not a schedule; "outbox relay 500 ms (lock-guarded loop) / 30 s fallback" is withdrawn.* *Amended 2026-11-20 by amendment 6 item 27: "housekeeping hourly" is three schedules on the `housekeeping` queue, each with its own interval: `queue-retention` hourly, `outbox-purge` daily, `idempotency-purge` hourly.*
6. **Concurrency and isolation**: worker concurrency per queue from config (defaults: booking 5, payments 5, documents 4, pickups 5, tracking-poll 10, notifications 10, maintenance 1); carrier calls remain bounded by the per-account bulkhead (ADR-0010).
7. **Graceful shutdown**: SIGTERM → `worker.close()` waits up to 30 s for active jobs, then exits 0; interrupted jobs are re-delivered (safe by idempotency) (REQ-PLAT-022, NFR-AVAIL-002). API: `server.close()` + drain ≤ 30 s.
8. **Observability**: `/metrics` on the worker exposes per-queue `waiting`, `active`, `completed`, `failed`, `delayed`, `dead` gauges, job duration histograms, relay lag; trace context propagated in payloads (NFR-OBS-002/003). Readiness reports Redis connectivity and scheduler liveness. *Amended 2026-11-19 by amendment 3 item 12: the metric names.*
9. **Redis durability and policy**: Valkey 8 (Redis-compatible, ADR-0001) with AOF `everysec` in Compose; ElastiCache for Valkey Multi-AZ later; `maxmemory-policy noeviction` (required by BullMQ) asserted at worker start; caches use a separate key prefix/logical DB with explicit TTLs. A Redis restart loses no committed business state (outbox is the source of truth; unpublished events are re-relayed; in-flight jobs are re-queued by BullMQ stalled-job detection). *Amended 2026-11-19 by amendment 3 item 13: a memory ceiling in Compose, and the owner of the start-up check.*

## Alternatives considered

- **pg-boss (Postgres-backed queue).** Attractive for transactional enqueue but the stack fixes BullMQ + Redis; the outbox gives the transactional guarantee instead.
- **Cron in the API process.** Rejected: schedulers belong in the worker; API stays stateless.
- **BullMQ Pro (groups, rate limiting per group).** Commercial licence — not in the allow-list; per-aggregate serialisation uses a Redis lock in the consumer instead. *Amended 2026-11-20 (ADR-0004 amendment 2 item 15; QG-043-C1 (b)): that lock is not built. A lock with retry gives mutual exclusion, not order. Handlers read the current state of the aggregate and do not depend on the order of events; a per-aggregate design is owed with the first handler that needs order (risks.md R-ARCH-37). The licence reason stands.*

## Consequences

- Positive: at-least-once with idempotent effects; visible DLQs (System health screen in M4); scheduled jobs are singletons by construction.
- Negative: Redis becomes a critical dependency for background work (not for committed state); BullMQ 6 API differences from older tutorials (job schedulers replace repeatable jobs) — follow the 6.x docs.
- Verification: kill -9 / Redis restart tests (NFR-RES-004), duplicate delivery tests (REQ-PLAT-014), scheduler singleton test with 2 workers (REQ-PLAT-015), drain test (NFR-AVAIL-002).

## Amendment after the P3 security review (2026-11-12, `docs/05-quality/security/P3-architecture-security-review.md` SEC-P3-12, SEC-P3-08 item 2; threat-model T-73, R-18; D-ARCH-025)

1. **The worker never trusts tenant context from Redis (SEC-P3-12, MEDIUM; supersedes §3 "Payload contract").** Payload contract **v2** (v1 is never implemented): `{ v: 2, kind, id, correlation_id, trace_context }` — identifiers only, no `org_id`, no `actor_id`, no business data. `kind ∈ {outbox_event, saga, shipment, order, pickup, document, payment, tracking_poll, notification, quote}` names the authoritative row; `id` is its UUID (for `outbox_event` jobs this is the `outbox_events.id`, for saga steps the `saga_id`; the step is part of the deterministic `jobId`, §2).
2. **Context is resolved from PostgreSQL.** The processor calls the allow-listed `SECURITY DEFINER` function `platform.job_context(kind, id) → (org_id, actor_type, actor_id)` (data-model.md §4.5, owner `platform_definer`, catalog test C11) **before** opening `withTenantTx`, and opens the tenant transaction with the resolved `org_id`. No row → `NonRetryableError('JOB_CONTEXT_NOT_FOUND')` → DLQ. A forged or edited job cannot make the worker act inside another tenant's RLS context, because the context never comes from the job. Any processor that receives a payload carrying `org_id` (schema violation) sends it to the DLQ as non-retryable with security event `job_context_mismatch`. *Amended 2026-11-20 by amendment 4: "no row" means that the identifiers name nothing. A soft-deleted row, or a row of a soft-deleted organisation, resolves and the job runs (items 17–19); the function returns a fourth column, `org_deleted`.*
3. **Payloads are Joi-validated at dequeue** against the per-queue schema in `packages/shared/queues.ts` (`allowUnknown: false`); invalid → DLQ non-retryable `PAYLOAD_INVALID`. The e2e suite asserts the schema on every job observed in Redis (SEC-TC-50).
4. **Valkey ACL users per service** (`api`, `worker`; no default user; key-prefix limits) locally and in AWS (platform.md §2.2; ADR-0010 amendment 7). Writing to the `bull:*` prefix requires the `worker` or `api` ACL user; the `requirepass`-only local setup is withdrawn.
5. **Schedulers** that iterate organisations (§3) read the organisation list from PostgreSQL and enqueue one `kind`/`id` job per aggregate; they never embed `org_id` either. Verification: SEC-TC-20 (now mandatory), SEC-TC-50.

## Amendment (2026-11-12, PR1-SEC): BullMQ's deprecated polyfill transitive (`docs/05-quality/security/PR-0001-TASK-001-security-review.md` PR1-SEC-07; D-ARCH-043)

6. **`node-abort-controller` 3.1.1 stays as BullMQ's transitive, under a watch item.** BullMQ 6.7.x (`dist/cjs/classes/abort-controller.js`) `require`s the polyfill but uses `globalThis.AbortController` whenever it exists, so on Node 24 the module is loaded and never instantiated; the registry deprecation (2026-11-10) states obsolescence on supported Node, not a defect, and the package has no dependencies, no install script and no advisory. Recorded in `tools/ci/maintenance-exceptions.json` with the parent chain and a review at every BullMQ minor bump and by 2027-05-12 (ADR-0025 PR1-SEC amendment; ADR-0023 am. J item 4). No `override`, no fork; the entry is removed when BullMQ drops the dependency.

## Amendment 3 (2026-11-19, PR #64 follow-ups): bounded retention under `noeviction`, dead-letter trimming, queue and Valkey alarms, the `-dead` and `.` spellings (`docs/05-quality/security/PR-0064-TASK-035-security-review.md` PR64-SEC-04, threat-model T-77; PR #64 code review R1-n5, §3 row 01 and §5; D-ORCH-132; D-ARCH-159, D-ARCH-160, D-ARCH-161)

The 2026-11-12 security block above is amendment 1 (items 1–5) and the PR1-SEC block is amendment 2 (item 6). This block is amendment 3, and its items continue at 7.

**Problem.** Under `maxmemory-policy noeviction` (§9) Valkey removes nothing by itself. TASK-035 kept every failed job (`removeOnFail: false`) and every dead-letter record without limit, on the instance that also holds the api's `auth:*`, `rl:*` and `sse:*` keys. A long outage or a poison flood (T-77) would grow memory until Valkey refuses writes, and then the queues, refresh-token rotation and the rate limits stop together.

**The bounds.**

| Set (one per named queue) | Age | Count (newest kept) | Enforced by |
|---|---|---|---|
| Completed jobs (§2, unchanged) | 24 hours | 10,000 | BullMQ at each completion; the hourly sweep (item 10) |
| Failed jobs | **7 days** | **1,000** | BullMQ at each failure; the hourly sweep |
| Dead-letter records in `<queue>-dead` | **14 days** | **2,000** | the consumer at each record write (item 9); the hourly sweep |

The bounds are three constants exported from `@platform/shared/queues` (ages in seconds, as BullMQ takes them): `COMPLETED_RETENTION = { age: 86400, count: 10000 }`, `FAILED_RETENTION = { age: 604800, count: 1000 }` and `DEAD_LETTER_RETENTION = { age: 1209600, count: 2000 }`. They are constants, not environment configuration: the memory budget of item 13 and the alarm threshold of item 14 are derived from them, so a change is an amendment of this ADR.

7. **Spellings (§1, §2; D-TASK035-01, -02 and -07).** BullMQ 6 refuses `:` in a queue name, and in a custom job id unless the id has exactly three parts. Therefore:
   - the dead-letter queue of a queue is `<queue>-dead`, and no named queue may end in `-dead`;
   - a job id is `<kind>.<id>` or `<kind>.<id>.<step>`: `<kind>` is a payload kind of amendment 1, `<id>` the lower-case UUID of the authoritative row, and `<step>` 1 to 40 characters of `[a-z0-9_-]`. Examples: `outbox_event.<event_id>`, `saga.<saga_id>.<step>`, `tracking_poll.<schedule_id>.<occurrence>` (item 11);
   - the id of a dead-letter record is `<job id>.dead.<attempts>`.

   §1 and §2 are corrected in place. Other documents that still show a `:` form (ADR-0014 "Saga model", ARCHITECTURE.md §7.5, data-model §6.3, api/README §12) read as the forms above, and each is corrected at its next edit.
8. **Failed jobs: `removeOnFail: FAILED_RETENTION` (supersedes `removeOnFail: false` in §1).** The failed job is the handle for `job.retry()` and the backstop when the record cannot be written. It is now bounded like the record.
   - **Where it is set.** In `jobOptions` (every produced job), in the job template of every Job Scheduler, and as the `removeOnComplete` and `removeOnFail` defaults of every consumer's BullMQ `Worker`. BullMQ 6.7.0 applies the `Worker` default only to a job that carries no option of its own, so the default covers a job that was enqueued without `jobOptions`.
   - **The count holds at every moment.** BullMQ trims the failed set in the same script that marks a job failed.
   - **Why 7 days.** A week covers a weekend and the triage of an incident. It is also no longer than the purge horizon of a published outbox event, the shortest-lived authoritative row a job can name, so a retry inside the window finds its row. (That horizon is 7 days in data-model §10.5 and 30 days in ADR-0004 §6. The two disagree; this amendment does not settle it, and 7 days fits both. *Settled 2026-11-19, D-ARCH-167: 30 days, and the data-model is corrected. A dead-letter record of an outbox job can therefore be redriven for its whole 14 days.*)
   - **Why 1,000.** An incident that dead-letters more jobs than that is replayed from PostgreSQL (the outbox, the saga sweeper, the tracking planner), not job by job.
9. **Dead-letter records: 14 days, the newest 2,000 per dead-letter queue.** Nothing consumes a dead-letter queue, so BullMQ never trims it. TASK-039 trims it in two places:
   - **At each record write.** After the consumer has added a record, it reads the number of records waiting in that dead-letter queue. Above 2,000 it removes the oldest surplus with `clean(0, surplus, 'wait')`. The depth is therefore bounded between sweeps as well: a bad deploy that fails a relayed backlog can dead-letter 100,000 jobs within minutes. The call is made only for a surplus of 1 or more, because BullMQ reads a limit of 0 as "no limit" and would remove every record. A trim that removed records logs `worker.dead_letter_trimmed` (queue, count). A failed trim logs `worker.dead_letter_trim_failed` (error class only) and never changes the outcome of the job.
   - **Hourly**, by the sweep of item 10 (age, and the count again).
   - **Why 14 days.** The record is the operator's evidence, so it outlives the retry handle by a week, for the review after an incident. It stays shorter than the log retention (30 days, ADR-0017 §8). With the 7-day snapshot retention of the AWS design (platform.md §4.3) a record and its last backup copy are gone within 21 days, so nothing in Valkey outlives the month in which an erasure request must be answered, and Valkey needs no erasure job (the concern of PR64-SEC-02).
   - **Why 2,000.** Twice the failed bound for twice the age: at a steady rate both sets reach their count bound together (about 143 dead letters a day on one queue).
   - **Rule between the two bounds.** The age and the count of the records are never set below those of the failed jobs, so a retained failed job normally still has its record. Two exceptions: the record write failed, or operators retried many jobs that failed again (each final failure writes a record of its own).
10. **Hourly sweep `queue-retention` (the first housekeeping job; TASK-039).** BullMQ evaluates an age bound only when another job of the same queue finishes, so on a quiet queue an aged job would stay. The sweep makes the ages true. It runs hourly on the `housekeeping` queue as a singleton through its Job Scheduler (§5), and calls one method of the worker's queue runtime, which owns the `Queue` instances built by `openQueue`. The sweep constructs no `Queue` of its own (PR64-SEC-13). For every named queue:

    | Set | Call | Removes |
    |---|---|---|
    | Failed | `queue.clean(604_800_000, 1000, 'failed')` | failed jobs older than 7 days |
    | Completed | `queue.clean(86_400_000, 1000, 'completed')` | completed jobs older than 24 hours |
    | Dead-letter records, by age | `deadLetter.clean(1_209_600_000, 1000, 'wait')` | records older than 14 days |
    | Dead-letter records, by count | `deadLetter.clean(0, depth - 2000, 'wait')`, only when the depth is above 2,000 | the oldest surplus |

    A call removes at most its limit. It is repeated while it removed exactly its limit, at most 10 times per queue and set in one run. Each run writes one log line with the numbers removed. A failure on one queue is logged and the sweep goes on with the next queue; the job then fails, so BullMQ retries it. The sweep is idempotent. The calls were read against BullMQ 6.7.0: for a list, `clean` examines the `limit` entries at the old end, and new jobs are pushed at the other end.
11. **Retention is also the duplicate window (code review R1-n5).** While a job is retained, BullMQ ignores an add with the same id. A completed key is therefore not enqueued again for up to 24 hours, and a failed key for up to 7 days.
    - **One-shot keys** (an outbox event, a saga step, a document version, a notification) want exactly this. A producer never reads "accepted by `add`" as "will run".
    - **Redrive.** While the failed job is retained, redrive is `job.retry()`. After its removal the id is free, and redrive is a new enqueue of the same `kind` and `id`, which the dead-letter record still names.
    - **A recurring key carries its occurrence as `<step>`.** The tracking poll of one shipment repeats every 15 minutes to 4 hours (DR-B19). The id `tracking_poll.<schedule_id>` alone would be dropped for 24 hours after each completed poll. The id is `tracking_poll.<schedule_id>.<occurrence>`, where the occurrence is derived from the due time of that poll; TASK-204 chooses the form. The §2 example `tracking:<shipment_id>` is withdrawn. Jobs produced by a Job Scheduler have BullMQ's own id per occurrence and are not affected.
12. **Metric names (§8; replaces the names in platform.md §8.2).** The names TASK-035 implemented are canonical. The `bullmq_queue_*` and `bullmq_dlq_depth` names of platform.md are withdrawn, because they name the library and no code or infrastructure uses them yet.

    | Metric | Type | Labels | Value | Owner |
    |---|---|---|---|---|
    | `platform_queue_jobs` | gauge | `queue`, `state` (`waiting`, `active`, `delayed`, `prioritized`, `completed`, `failed`) | BullMQ job counts | exists (TASK-035) |
    | `platform_queue_dead_letter_jobs` | gauge | `queue` | records in `<queue>-dead` | exists (TASK-035) |
    | `platform_queue_dead_lettered_total` | counter | `queue` | +1 for each final failure of a job, at the point where the consumer writes the record or fails to write it | TASK-039 |
    | `platform_queue_oldest_waiting_age_seconds` | gauge | `queue` | age of the oldest waiting job | TASK-214 |
    | `platform_valkey_memory_used_bytes`, `platform_valkey_memory_max_bytes` | gauge | none | `used_memory` and `maxmemory` of `INFO memory` | TASK-214 |

    - **Why a counter.** The depth is now bounded and trimmed, so it cannot show new dead letters: one dead letter and one trimmed record in the same window cancel out. Every queue's counter series exists at 0 from worker start, because a series that first appears at 1 shows no increase.
    - **Why the worker reads the memory.** Its ACL user has `+info`; the api user has not (platform.md §2.2). No exporter image and no new credential are needed. The memory gauges are collected with the queue gauges, under the same 2 s deadline and single-flight (PR64-SEC-03, PR64-SEC-12).
    - **The renderer.** The in-house text renderer of TASK-035 stays until TASK-214 brings `@prometheus-io/client` to the worker (ADR-0017 amendment 1). The names and label sets above are the contract and do not change with that move.
13. **Memory ceiling and the §9 start-up check (TASK-214).** Compose adds `--maxmemory ${REDIS_MAXMEMORY:-512mb}` to the `redis` command, next to `noeviction`. Without a ceiling there is no percentage to alarm on, and the failure is the host's memory, not a refused write. 512 MiB is the memory of the smallest planned node (cache.t4g.micro, the minimal staging node of platform.md §11.2; launch production plans cache.t4g.medium), so a local run meets the ceiling no later than an AWS environment would. In AWS the node type sets the ceiling.
    - **Start-up check.** At worker start `maxmemory_policy` of `INFO memory` must be `noeviction`, or the worker refuses to start (§9 asked for this check and no task owned it). A `maxmemory` of 0 logs WARN `worker.valkey_maxmemory_unset` when `APP_ENV` is not `test`.
    - **Worst-case budget of the retained sets** (an estimate: about 2 KiB of Valkey memory per retained job or record with an identifiers-only payload; not measured, TASK-039 reports the real figure):

      | Set | Items at the bound (9 queues) | Estimate |
      |---|---|---|
      | Completed jobs (unchanged) | 90,000 | 176 MiB |
      | Failed jobs | 9,000 | 18 MiB |
      | Dead-letter records | 18,000 | 35 MiB |
      | Total | 117,000 | 229 MiB, 45 % of the ceiling |

      The two sets this amendment bounds add at most about 53 MiB, 10 % of the ceiling; before it they had no bound. The total stays below the first alarm (70 %, 358 MiB) even when every queue is at every bound. BullMQ's event streams (each trimmed by BullMQ to about 10,000 entries) and live keys are not in the table. The completed set is the largest term; lowering its count is the lever if a node proves too small.
14. **Alarms (TASK-214; they replace the "DLQ depth growth" and "Redis memory > 70 %" rows of platform.md §8.5).** Prometheus alert rules in the Compose `observability` profile, each with the labels `severity` and `runbook`:

    | Alarm | Expression | For | Severity | Runbook |
    |---|---|---|---|---|
    | `QueueDeadLetterNew` | `sum by (queue) (increase(platform_queue_dead_lettered_total[15m])) > 0` | none | page for `booking` and `payments`; ticket for the other queues (*amended 2026-11-20, amendment 5 item 26: `outbox-relay` pages too*) | RB-07 |
    | `QueueDeadLetterDepthHigh` | `max by (queue) (platform_queue_dead_letter_jobs) >= 1600` (80 % of the count bound) | 5 min | page | RB-07 |
    | `ValkeyMemoryHigh` | `max(platform_valkey_memory_used_bytes) / (max(platform_valkey_memory_max_bytes) > 0) >= 0.70` | 10 min | ticket | RB-06 |
    | `ValkeyMemoryCritical` | the same ratio `>= 0.85` | 5 min | page | RB-06 |

    - `QueueDeadLetterDepthHigh` means that the oldest records are about to be trimmed by count: triage or export them now.
    - `ValkeyMemoryCritical` leaves 15 % before writes are refused. The design does not rely on any trim running at the ceiling: BullMQ trims through scripts, and whether Valkey still runs them there is not verified. RB-06 states how an administrator frees memory at the ceiling, checked on Valkey 8 when the runbook is written.
    - At M5 (not built in this run) the same four alarms exist in CloudWatch: the two dead-letter alarms on the EMF queue metrics, and the two memory alarms on the ElastiCache metric `DatabaseMemoryUsagePercentage` at the same 70 % and 85 %. The worker deployment alarm `dlq-growth` of platform.md §5.5 is `QueueDeadLetterNew` for `booking` and `payments`.
15. **What this does not bound.**
    - **Live jobs.** Waiting and delayed jobs are work, not retention; the backlog alarm of platform.md §8.5 covers them.
    - **A Redis writer.** Whoever can write `bull:*` can fill memory directly, and a forged job can carry data of any size. The budget assumes payloads the producer validated. The per-service ACL users are the control against a writer (threat-model T-73, T-92), and the memory alarms are the detection.
    - **Business state.** Removing a failed job or a record loses no committed state. PostgreSQL stays the source of truth (the outbox row without a `processed_events` row, the saga step, the notification log status), and nothing in Valkey is a system of record (data-model §1.4).
16. **Verification.** TASK-039: the `jobOptions` pin; integration cases on Valkey 8 for the failed count, the sweep by age on a quiet queue, the record trim at write time and the rule of item 9 (a retained failed job has its record); the ACL case of PR64-SEC-11 also runs one sweep as the `worker` user; unit cases for the counter; the PR body quotes `MEMORY USAGE` of one failed job key and one record key. TASK-214: a lane A test pins the four alarm names, expressions, durations and labels and derives 1,600 from `DEAD_LETTER_RETENTION`; a unit case for the start-up check. TASK-204: two consecutive due polls of one shipment both run.

## Amendment 4 (2026-11-20, TASK-047 dispatch gate): a soft-deleted row or organisation is still a tenant context (D-SD-003 item 6, D-SD-004 item 8, D-PM-072 "Not applied here"; D-ARCH-180)

Items continue at 17.

**Question.** Item 2 says "No row → `JOB_CONTEXT_NOT_FOUND`". It does not say what `platform.job_context` answers when the row exists and its organisation is soft-deleted (`organisations.deleted_at` set), or when the row itself is soft-deleted. US-078 scenario 4, written for payload v1, expects a job of a deleted organisation to fail without retry and to leave an audit entry with outcome `FAILED`. An organisation has no other "not live" state: the table has no status column.

17. **`platform.job_context` resolves ownership, not liveness.** It filters `deleted_at` on neither the row the job names nor that row's organisation.

    | The identifiers name | `job_context` returns | The job |
    |---|---|---|
    | nothing: the row never existed, the id is forged, or a purge removed the row | no row | is refused: non-retryable `JOB_CONTEXT_NOT_FOUND`, security event `job_context_mismatch` (item 2, unchanged) |
    | a row without an organisation (a guest quote, an auth e-mail event) | `org_id` NULL, `org_deleted` NULL | is refused with `MISSING_TENANT_CONTEXT` on a queue that requires a tenant (item 20); runs without an organisation on the two queues that do not |
    | a soft-deleted row of a live organisation | the row's context, `org_deleted` false | runs; its processor finds the subject deleted (item 19) |
    | a row of a soft-deleted organisation | the row's context, `org_deleted` true | **runs, in that organisation's own tenant scope** (item 18) |

    - **The fourth column.** `org_deleted boolean` (data-model §4.5): true when the organisation's row has `deleted_at` set or is missing, false when it is live, NULL when the row has no organisation. The runner hands it to the processor with the resolved context, as `orgDeleted`.
    - **No refusal reason is added.** There is no `ORGANISATION_DELETED` and no `ORGANISATION_INACTIVE`, and the non-retryable reasons of TASK-035 stay as they are.
18. **Why a job of a deleted organisation runs, and in which scope.**
    - **Work in flight settles what already exists.** Deleting the organisation does not end what it owes or is owed:

      | Queue | What a job still has to finish |
      |---|---|
      | `booking` | a started saga ends booked or compensated; a refused step would leave a captured payment without a booked shipment, a guardrail held at 0 |
      | `payments` | capture, void and refund of money already authorised or taken, and the gateway's webhooks for it |
      | `documents` | the label and the customs documents of a paid shipment |
      | `pickups` | a pickup already scheduled with the carrier is confirmed or cancelled there |
      | `tracking-poll` | the recipient follows the shipment on the public page, and the recipient is not a member of the organisation |
      | `notifications` | the notices of the rows above (a refund, a delivery) |
      | `outbox-relay` | events are facts already committed, including those written by the transaction that deleted the organisation |

    - **The one deletion path of this run needs it.** The expiry of an unverified account soft-deletes the personal organisation (REQ-AUTH-026, US-292) and keeps its drafts, quotes and addresses "for the audit chain". The 30-day draft expiry (REQ-ACCT-004) still has to cancel those drafts, and the later erasure jobs still have to remove them. A refusal would dead-letter a job for every draft that an expired sign-up left behind.
    - **Deletion is one-way** (US-079: no restore), so a refused job could never be redriven. It would be a dead letter that no operator can fix, on an alarm that pages for `booking` and `payments` (item 14).
    - **Isolation does not depend on liveness.** The tenant policies compare `org_id` only, and `p_organisations__active` compares `id`. A forged job that names a row of a deleted organisation gets that organisation's context and nothing more, exactly as with a live one, so a refusal would add no control against T-73.
    - **Tenant scope, never SYSTEM scope.** The worker has no cross-tenant scope (data-model §4.1) and needs none here: the policies above admit the deleted organisation's own context as before. A wider scope for these jobs would turn one forged job into access to every tenant.
19. **A soft-deleted subject row.** Of the ten source tables only `quotes` is soft-deletable. The other nine are `SD: no` in data-model §3: shipments, orders, pickups, documents and payments end in a status, and a draft is deleted by its transition to `CANCELLED`.
    - `job_context` returns the context of a soft-deleted quote, because the row still belongs to its organisation.
    - The processor reads its subject inside the tenant transaction through the default client, which hides soft-deleted rows (data-model §7.6). A processor that finds its quote deleted completes without effect. `withDeleted()` stays limited to audit and erasure code.
    - For every other kind, a row that `job_context` resolved and the tenant transaction cannot see is a defect (a missing policy, for example the invitee rows of `notification_log`, data-model §12). The processor fails the job. It never reads "not visible" as "nothing to do".
20. **"A queue that requires a tenant"** (item 17; REQ-RLS-008, EC-A38; data-model §4.5). A queue with payload kinds requires a tenant unless its definition in `@platform/shared/queues` marks the organisation optional.
    - **Optional: `outbox-relay` and `notifications`.** Auth e-mail events and their notification rows have no organisation.
    - **Required: `booking`, `payments`, `documents`, `pickups` and `tracking-poll`.** Their kinds come from TENANT tables, where `org_id` is `NOT NULL`, so a refusal there means a data defect or a guest quote on the wrong queue.
    - On a queue that requires a tenant the runner refuses a context without an organisation before the processor is called, so no tenant data is read.
    - The schedule-only queues (`housekeeping`, `audit-maintenance`) carry no payload kind and resolve no context (TASK-039).
21. **Work for a deleted organisation is stopped where it starts, not in the runner.**
    - **Discovery and producers.** A discovery function or producer that starts new business for an organisation (a new charge, a new carrier booking, a new series of notices) selects live organisations only (`organisations.deleted_at IS NULL`). One that settles, cancels, expires, backfills, retains or erases does not filter: `payment_sweeper_candidates`, `saga_due_candidates`, `void_retry_candidates`, `draft_expiry_candidates` and `org_ids_page`. A backfill that skipped deleted organisations would leave rows on which the contract step then fails.
    - **Processors.** A processor that would start new business reads `orgDeleted` and completes without effect when it is true. It does not dead-letter the job, for the reason given in item 18 (one-way). Run 1 has no such processor.
    - **Owed by later designs.** The first organisation-closure path (M2 or later) states what it does with the organisation's pending work. The erasure and retention jobs of M4/M5 (data-model §10.4 and §10.5) act on deleted organisations by design, and their role and scope are that design's to state. Nothing in this amendment stands in their way.
22. **Evidence.**
    - A refused job opens no tenant transaction and writes no audit entry, as `api/README.md` §13 already says for `job_context_mismatch`. Its evidence is the dead-letter record with the reason, the log line, and the security event where items 2 and 3 define one. An entry in the SYSTEM stream for every refused job would let a writer to `bull:*` grow an audit chain without bound, where the dead-letter records are bounded (item 9).
    - A job of a deleted organisation writes its audit entries to that organisation's stream, like any other job.
    - The step "fails non-retryably with an audit entry outcome `FAILED`" of US-078 scenario 4 is withdrawn with its premise (product-manager rewords the story).
23. **Verification (TASK-047).**
    - **The function**, in the integration suite against the migrated schema: a row of a live organisation gives `org_deleted` false; a row of a soft-deleted organisation gives the same `org_id` with `org_deleted` true; a row without an organisation gives NULL and NULL; an unknown id gives no row; an unknown kind raises. The cases use `outbox_events`, the one source table that exists at batch 1.4. The task that creates a later source table adds the case of its kind, and the `quotes` task adds the soft-deleted quote.
    - **The runner** (AT-US-078-04): an `outbox_event` job whose organisation is soft-deleted completes with `app.org_id` set to that organisation and `orgDeleted` true. It leaves no dead-letter record, and it reads and writes no row of a second organisation.
    - **The reasons.** The pin of the non-retryable reasons is unchanged: no reason was added.
    - **Item 20.** A row without an organisation on a queue that requires a tenant is refused with `MISSING_TENANT_CONTEXT` before the processor is called, and the same row on `outbox-relay` runs.
    - The function sketch of data-model §4.5 was run on PGlite with stub tables (15 cases, no roles and no row-level security); nothing else was run for this amendment.

## Amendment 5 (2026-11-20, TASK-043 code review round 1): the outbox relay is a loop, not a job; `outbox-relay` is the queue of the dispatcher (ADR-0004 amendment 2; D-TASK043-06 and -07; D-ARCH-183, D-ARCH-184)

Items continue at 24.

24. **`outbox-relay` (§1, §5, §6).**
    - **The queue** carries one kind, `outbox_event`. Its processor is the dispatcher of ADR-0004 amendment 2 item 12, and its concurrency is 5, as TASK-035 built it. §6 did not list it.
    - **The relay** is an in-process loop in every worker, kept to one tick at a time by a PostgreSQL advisory lock (ADR-0004 amendment 2 items 8 to 11). It is not a BullMQ job. It has no Job Scheduler and no 30 s fallback, and the list of schedules in §5 no longer contains it.
    - **REQ-PLAT-015** is not touched: every schedule that exists is still registered once. Its note names "the outbox relay fallback" as a user of scheduled jobs; product-manager drops those words at the next edit of the requirement.
25. **Relay metrics and alarms (joins the table of item 12 and the alarms of item 14).**

    | Metric | Type | Value | Owner |
    |---|---|---|---|
    | `platform_outbox_relay_latency_seconds` | histogram | from the event's insert to its accepted enqueue | exists (TASK-043) |
    | `platform_outbox_relay_published_total`, `platform_outbox_relay_failed_total` | counter | rows marked published; enqueue attempts that failed | exists (TASK-043) |
    | `platform_outbox_relay_oldest_pending_age_seconds` | gauge | ADR-0004 amendment 2 item 11 | TASK-043 |
    | `platform_outbox_relay_last_tick_timestamp_seconds` | gauge | ADR-0004 amendment 2 item 11 (*corrected 2026-11-20 by ADR-0004 amendment 4 item 24, PR043-SEC-04: only a tick that held the relay lock counts*) | TASK-043 |
    | `platform_outbox_unhandled_total` | counter | events whose type has no handler | the task that builds the dispatcher (proposed: TASK-047) |

    | Alarm (TASK-214) | Expression | For | Severity | Runbook |
    |---|---|---|---|---|
    | `OutboxRelayLag` | `max(platform_outbox_relay_oldest_pending_age_seconds) > 30` | 5 min | page | RB-06 |
    | `OutboxRelayStalled` | `time() - max(platform_outbox_relay_last_tick_timestamp_seconds) > 60` (*item 26 adds an `absent()` arm*) | 2 min | page | RB-06 |

    - `OutboxRelayLag` is the "Outbox relay lag" row of platform.md §8.5, now with its metric. Both page, because the booking saga starts from an outbox event.
    - `OutboxRelayStalled` takes the place of the 30 s fallback. A fallback job would restart a dead loop without telling anyone, and it depends on the Valkey that a stalled relay may be waiting for. *2026-11-20 (PR043-SEC-04; D-ARCH-196): the alarm also fires when something else holds the relay key, because only a tick that held the lock moves the gauge.*
    - The worker's readiness reports the relay as degraded when the first gauge is above 60 s (ADR-0017 §5). TASK-214 adds the component and extends its lane A test of the alarm rules to these two.
26. **Additions after the verification D-QG-002 (2026-11-20; observations of that entry; D-ARCH-188, D-ARCH-189).**
    - **`OutboxRelayStalled`** is `time() - max(platform_outbox_relay_last_tick_timestamp_seconds) > 60 or absent(platform_outbox_relay_last_tick_timestamp_seconds)`, for 2 min. With every worker down no series exists and the first arm returns nothing; the second arm covers that case.
    - **`QueueDeadLetterNew` pages for `outbox-relay`** as it does for `booking` and `payments` (amends item 14). Every saga and payment event passes that queue, and a dead-lettered event job leaves rows without their follow-up jobs (ADR-0004 amendment 3 item 20). The deployment alarm `dlq-growth` of platform.md §5.5 follows the same three queues.
    - **The lag gauge** is set at the claim, before the enqueues (ADR-0004 amendment 3 item 22). A value written only at the end of a long tick would let the maximum over the workers read 0 and reset the 5 minutes of `OutboxRelayLag`.
    - **The readiness component** for relay lag is the worker's alone; the api runs no relay.
    - **`OutboxRelayLag` during a replay.** RB-06 makes published rows unpublished again, so the alarm fires for the length of the replay. The runbook says so and takes the relay lock for that statement (ADR-0004 amendment 3 item 22).

## Amendment 6 (2026-11-20, TASK-040 code review round 1, m2): the hourly schedule `idempotency-purge` (ADR-0014 amendment 8; D-ARCH-192)

Items continue at 27.

27. **`idempotency-purge` (§1, §5).** The `housekeeping` queue gains a third schedule. Part 040-B of TASK-040 builds it.
    - **What it does.** Every hour it deletes the `idempotency_keys` rows whose `expires_at` has passed, in batches of 5,000. The statement, the batch bound and the clock note are in ADR-0014 amendment 8 and data-model §6.2.
    - **Why it is a schedule of its own** and not a fourth table of the daily `outbox-purge`: a stored response may hold personal data and is kept for 24 hours. A daily purge would let it live for up to 48.
    - **§5 said "housekeeping hourly"** as if housekeeping were one schedule. As built, each purge is a schedule with its own interval: `queue-retention` hourly (TASK-039), `outbox-purge` daily (TASK-043), `idempotency-purge` hourly. A later purge (expired tokens, MFA challenges, drafts) names its own interval in the same way.
    - **Conditions.** The four conditions of D-SECPR039-01 bind it, as they bind every schedule: parameters from code, the age predicate in the statement, a name of the closed list, occurrences only from the scheduler.
    - **Failure.** A dead-lettered occurrence is reported by `QueueDeadLetterNew` as a ticket (item 14). No metric and no alarm are added.

## Reversibility

High.
