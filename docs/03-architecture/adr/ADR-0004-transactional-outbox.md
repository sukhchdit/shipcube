# ADR-0004: Transactional outbox and inter-module eventing

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.1, §4.5; REQ-PLAT-011/013/014/016/017, DR-A25, DR-B04 G4; ADR-0013 (queues), ADR-0014 (saga)

## Context

State changes must emit events exactly when they commit (REQ-PLAT-016), consumers must receive them at least once in order per aggregate (REQ-PLAT-017), and the same correlation ID must flow API → outbox → worker → audit (REQ-PLAT-011). *Amendment 2 item 15 (2026-11-20): REQ-PLAT-017 is worded for the publish step, and the order guarantee ends at the enqueue. product-manager confirmed that reading for QG-043-C5 (D-PM-079, A-115).* BullMQ is the fixed job system but Redis is not transactional with PostgreSQL, so publishing directly from a request would create the dual-write problem.

## Decision

1. **Table** `outbox_events` (SYSTEM class, no RLS): `id uuid v7 PK`, `type` (catalogued dotted name), `aggregate_type`, `aggregate_id`, `org_id nullable`, `payload jsonb` (no secrets, no raw PII beyond IDs — consumers reload entities under RLS), `correlation_id`, `trace_context jsonb` (W3C traceparent), `actor_id`, `created_at`, `published_at nullable`, `attempts int`, `last_error`. Index `(published_at, created_at) WHERE published_at IS NULL`; index `(aggregate_type, aggregate_id, created_at)`. *As built (TASK-043; amendment 2): the row has the full standard columns, `trace_context` is `text` (the W3C `traceparent`) and the relay index is `(created_at, id) WHERE published_at IS NULL`. `created_at` is the insert time on the database clock, set by the writer; it is not the transaction start (item 13). The physical table is data-model §3.5 and §6.1.*
2. **Write path.** Services call `outbox.publish(tx, event)` inside the same `withTenantTx` transaction as the state change; the audit entry (ADR-0007) is written in that transaction too. A rolled-back transaction leaves no event (test REQ-PLAT-016).
3. **Relay.** A worker scheduler (`outbox-relay`, every 500 ms, single active instance via a Redis lock, plus a 30 s repeatable fallback) selects `WHERE published_at IS NULL ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`, enqueues each event to its target queue(s) with `jobId = event.id` (BullMQ dedupes same-ID jobs), then sets `published_at`. Ordering per aggregate is preserved by publishing in `created_at` order and by using BullMQ **groups/one-active-per-aggregate semantics in the consumer** (consumer serialises by `aggregate_id` using a Redis lock with the job retried on contention). Relay latency commit→enqueue is a histogram metric (REQ-PLAT-017). *Amended 2026-11-20 by amendment 2. The relay is an in-process loop in every worker, kept to one tick at a time by a PostgreSQL advisory lock; there is no Redis lock, no relay schedule and no 30 s fallback (items 8 to 11). Every event goes to the one queue `outbox-relay` (item 12). The order rule is items 13 to 15; the consumer lock sketched in this item is not built.*
4. **Consumers** are idempotent: `processed_events(consumer, event_id, processed_at)` is written in the consumer's own transaction; a duplicate delivery is discarded (REQ-PLAT-017 test: crash between enqueue and mark).
5. **Routing.** `packages/shared` holds the event catalogue (`DomainEventType` union) and a static `eventRouting` map `type → queue[]` (e.g. `payment.authorised → booking`; `shipment.booked → documents, notifications`; `tracking.* → notifications`; `shipment.label_ready → pickups`). Unmapped types are logged and counted (`outbox_unrouted_total`) and still marked published. *Superseded 2026-11-20 by amendment 2 item 12: there is no `eventRouting` map and no `outbox_unrouted_total`. The catalogue is `@platform/shared/events`, the relay enqueues every event on `outbox-relay`, and the consumer of that queue dispatches by type.*
6. **Retention.** Published events older than 30 days are hard-deleted by `housekeeping` (allow-listed hard delete, REQ-RLS-010); they are not the audit trail. *Confirmed 2026-11-19 (D-ARCH-167): 30 days stands. The data-model said 7 days in §3.5, §6.1, §10.1 and §10.5 without a decision and is corrected. The horizon is at least the life of a dead-letter record (14 days, ADR-0013 amendment 3), because redriving an `outbox_event` job needs its row, and at most the 30 days after which `processed_events` forgets a processed event.*
7. **Tracing.** `trace_context` is injected by the API and extracted by the worker so one trace spans API → queue → worker → carrier (NFR-OBS-003).

## Alternatives considered

- **Direct enqueue from the request after commit.** Loses events on crash between commit and enqueue; violates REQ-PLAT-016.
- **Logical decoding / Debezium CDC.** Exactly the right tool at scale but adds a connector to run and operate at $0 budget; polling with `SKIP LOCKED` is sufficient at ≤ 300 rps and can be replaced by CDC without changing producers or consumers.
- **PostgreSQL `LISTEN/NOTIFY` to wake the relay.** Kept as an optimisation seam (reduces the 500 ms latency); not needed for NFR-PERF-004 (queue wait p95 ≤ 2 s).

## Consequences

- Positive: atomic state + event + audit; replayable event history for 30 days; module extraction later reuses the same events.
- Negative: ~0.5 s median enqueue latency; one more table and scheduler to monitor (metrics exposed, REQ-PLAT-018 readiness reports relay lag > 60 s as degraded). *Amendment 2 item 11: relay lag is the gauge `platform_outbox_relay_oldest_pending_age_seconds`.*

## Amendment (2026-11-12, api-designer handback): one-time tokens in event payloads

The e-mail events `auth.email_verification`, `auth.password_reset` and `org.invitation_created` need the plaintext one-time token to build the link, while the database stores only its hash. Rule 2's "no secrets in payloads" is refined: payloads carry the token **only** as `token_enc` = AES-256-GCM(token) under the environment outbox key (KMS-wrapped in AWS; `OUTBOX_PAYLOAD_KEY` locally), with the token's `expires_at`; the notifications consumer decrypts in memory, renders the link with the token in the URL fragment (ADR-0016 amendment 2) and **overwrites `token_enc` with null in the outbox row after sending**; housekeeping also nulls `token_enc` on any row older than the token lifetime (24 h). Pino redaction covers `token_enc`. Alternative rejected: storing the plaintext token encrypted on the token table and having the worker read it — same cryptography, one more table to clean. *Amendment 2 item 14: the overwrite after sending carries `published_at IS NOT NULL`, and the 24 h housekeeping statement runs under the relay lock, because it can touch an unpublished row.* *Restated the same day by amendment 3 item 21 (QG-043-C3): the overwrite after sending carries no such predicate; it is unconditional by id and checks its row count. The housekeeping rule stands.*

## Amendment 2 (2026-11-20, TASK-043 code review round 1): the relay as built, dispatch by the consumer, the order contract, the correlation grammar (`docs/05-quality/reviews/PR-pending-TASK-043-code-review.md` M1, m3, m4, m7, n1, n7, n8; D-TASK043-04, -06 and -07; D-ARCH-183 to D-ARCH-187)

The token block of 2026-11-12 is amendment 1. This block is amendment 2, and its items continue at 8. It was written against branch head `5193fea4`. Where an item changes that code, D-ARCH-183 to D-ARCH-187 list the change.

**The relay (replaces the mechanism of item 3; D-TASK043-06; D-ARCH-183).**

8. **One loop per worker, one tick at a time.** Every worker process runs the relay as an in-process loop: a tick, then a wait of `OUTBOX_RELAY_POLL_INTERVAL_MS` (default 500), or no wait after a full batch that was published completely. The relay is not a BullMQ job: it has no Job Scheduler and no 30 s fallback. A tick is one SYSTEM-scope transaction on the worker's tenant-transaction runner:

    | Step | Statement or call |
    |---|---|
    | 1 | `pg_try_advisory_xact_lock(<relay key>)`. A tick that does not get the lock ends here |
    | 2 | The claim: unpublished rows in `(created_at, id)` order, `LIMIT OUTBOX_RELAY_BATCH_SIZE` (default 100), `FOR UPDATE SKIP LOCKED`. It reads `id`, `correlation_id`, `trace_context` and the aggregate, never the type, the payload or the organisation |
    | 3 | One enqueue per row, in claim order (item 12) |
    | 4 | The accepted rows are marked published and the failed attempts recorded; commit |

9. **Why the lock is in PostgreSQL and not in Valkey.**
    - **The lock is there for order.** Two relays that each claim a batch can enqueue two events of one aggregate in reverse. `SKIP LOCKED` does not make a second relay safe; it only stops it from waiting.
    - **It ends with the transaction that holds the claim.** Commit, rollback, a crash and a session ended by the server all release it together with the row locks. A Valkey lock has an expiry to choose and to renew, and a relay that is paused for longer than the expiry goes on enqueueing beside its successor without knowing.
    - **Takeover is bounded.** A relay that stops mid-tick keeps the lock until its transaction ends: at once when the process dies, and at the latest when the server ends the idle transaction (`idle_in_transaction_session_timeout`, 15 s by default).
    - **No session state.** The transaction-level form works behind a transaction pooler, and the `TenantDb` guard refuses the session forms.
    - **No added dependency.** A tick needs PostgreSQL for the claim in any case.
    - **The key** is the fixed `bigint` 478216878200, registered with the other advisory keys in data-model §6.1.
10. **The enqueue runs inside the claim transaction, under bounds.** It is the one network call allowed inside a tenant-transaction callback (T-83; D-ARCH-106), and nothing else gets this exception. The reason is that the row locks of the claim must cover the enqueue. A relay that committed the claim first would need a "claimed" state on the row and a job that takes back the rows of a dead relay. What limits the exception: the transaction is SYSTEM scope, takes no audit stream lock, writes no audit entry and holds one connection. With `W` = the smaller of the transaction timeout and `idle_in_transaction_session_timeout` (5,000 ms by default):

    | Bound | Value | At the default |
    |---|---|---|
    | No new row is started once the tick has run for | `W / 2` | 2,500 ms |
    | One enqueue may take | `min(2,000 ms, W / 4)`; past it the enqueue counts as a transport failure | 1,250 ms |
    | Left for the two mark statements | at least `W / 4` | 1,250 ms |

    - The first transport failure ends the tick.
    - Head `5193fea4` bounds one enqueue by `min(2,000 ms, W / 2)` and takes `W` from the transaction timeout alone. That leaves 500 ms at the default and nothing at 4,000 ms or below (code review n7), and a transaction timeout above the idle timeout would let the server end the session in the middle of a slow batch. The fix cycle changes the composition.
    - A tick that still runs out of time rolls back. Its rows stay pending, the next tick adds the same job ids again, and BullMQ ignores an add of a retained id. The bounds protect the pool and the lock; correctness does not depend on them.
11. **Failure: nothing is parked** (code review m3).
    - **Transport failure** (Valkey down, AUTH refused, the memory ceiling). The tick ends and every row stays pending, in order. The loop then backs off: the wait doubles from the poll interval up to 5 s after each tick that threw, or that failed an enqueue and published nothing. It returns to the poll interval after the first tick that publishes a row or finds none to claim. One WARN is logged per failure streak and one INFO at recovery, not a line per tick.
    - **A refused payload** (the producer's own check). A row written by the writer cannot cause one, because the row constraints make every row relayable (item 16). If it happens, it is a defect. The row stays pending and holds back the later events of its aggregate; other aggregates go on. *Amendment 3 item 19 states the limit of "go on".*
    - **No attempts cap and no parked state.** Parking drops one event and reorders its aggregate without a trace in the stream. A refusal that hits every row, such as a bad deploy, would park the whole stream, and each event would then need a manual replay. A pending row with an alarm keeps at-least-once and order, and the repair is a deploy.
    - **Liveness replaces the 30 s fallback.** Each worker runs a loop, so the other workers cover one dead loop. Two gauges show the rest:

      | Metric | Value |
      |---|---|
      | `platform_outbox_relay_oldest_pending_age_seconds` | the age of the first row of the claim in a tick that held the lock; 0 when that tick claimed nothing, and 0 after a tick that did not get the lock. It is read as the maximum over the workers. This is "relay lag" in the Consequences, in ADR-0017 §5 and in platform.md §8.5. *Amendment 3 item 22: it is set at the claim, before the enqueues* |
      | `platform_outbox_relay_last_tick_timestamp_seconds` | the wall-clock time of the last tick that ended without an error, with or without the lock. A dead loop or an unreachable database shows as a value that stops |

      The alert rules and the readiness component are TASK-214's (ADR-0013 amendment 5 item 25).

**Dispatch (replaces item 5; D-TASK043-07; D-ARCH-184).**

12. **One queue; the consumer dispatches by type.**
    - **Catalogue.** `@platform/shared/events` holds one file per module. Each type has its aggregate type and a closed payload schema, and the writer accepts nothing else.
    - **Relay.** Every event becomes one `outbox_event` job on `outbox-relay` (payload v2, job id `outbox_event.<event id>`). There is no `eventRouting` map.
    - **Dispatcher.** The processor of `outbox-relay` resolves the job's context (ADR-0013 amendments 1 and 4), reads the event row inside the tenant transaction and calls the handlers registered for its type. The registry is worker code: a module registers the handlers for the types it consumes. The plan names the task that builds the dispatcher (proposed: TASK-047, which already runs an `outbox_event` job for its own tests); the first handlers are TASK-078's.
    - **A handler is one named consumer of item 4.** It claims `processed_events (consumer, event_id)` in the transaction of its effect. When one handler of an event fails, the job fails and is retried; the handlers that already committed find their claim and do nothing.
    - **A handler does database work only.** Work that is slow or leaves the process (an e-mail, a PDF, a carrier call) is a job on the module's own queue. The handler writes the row that job names, so the enqueue can be repeated from the row and never depends on the handler's memory. *Amendment 3 item 20 says who enqueues, when, and what a second delivery does.*
    - **A type without a handler** completes without effect and counts in `platform_outbox_unhandled_total`, which replaces `outbox_unrouted_total`.
    - **Sequencing** (code review n8). No event type is added to the catalogue before `outbox-relay` has its processor. The jobs would wait in Valkey without a bound, and a consumer that arrives later would act on stale events. A worker test fails when the catalogue has a type and no `outbox-relay` processor is registered.

    Why the relay does not route:
    - A tick stays one enqueue per row. A fan-out to several queues inside the claim transaction would need per-target accept state on the row to keep "published only after accept" true.
    - The queue catalogue as built already says so: `outbox_event` is a kind of `outbox-relay` alone (ADR-0013 amendments 1 and 4; data-model §4.5).
    - A static map in `packages/shared` ties the shared package to every module's queues, and "unmapped, still marked published" hides a missing consumer either way. The registry sits beside the code that handles the event.
    - One dispatcher is the single place for the job context, the dedupe claim and the order rule of item 15.

    The cost: every event passes one queue (concurrency 5 as built by TASK-035), so one slow handler would delay all events. That is why a handler does database work only.

**Order per aggregate (replaces the order sentence of item 3; code review M1; D-ARCH-185).**

13. **The order key is the insert time.** The writer sets `created_at` and `updated_at` to one `pg_catalog.clock_timestamp()` value in its `INSERT`. The column default is the transaction start and is never used for this table. The relay orders by `(created_at, id)`; `id` is the `uuidv7()` of the same statement and breaks ties.
    - Why not the default: two transactions that change one aggregate commit in the order in which they got its row lock, not in the order in which they began. T1 begins. T2 begins, changes the aggregate, publishes E2 and commits. T1 changes it, publishes E1 and commits. Under the default E1 sorts first, and a tick that sees both enqueues the later change first.
14. **The contract and its precondition.** Events of one aggregate are enqueued in the order in which their transactions changed it, **when the transaction holds the row lock of the aggregate at the moment it publishes.** A handler therefore publishes after its write of the aggregate row: the `UPDATE … WHERE id AND version` of a state transition (data-model §6.5 T4), or the `INSERT` of a new aggregate. A transaction that only adds child rows takes `SELECT … FOR UPDATE` on the aggregate row first.
    - **Why this is enough.** The periods in which two transactions hold one row lock do not overlap, and each insert time lies inside its own period, so the insert times are ordered as the commits are. The earlier transaction has committed before the later event is inserted, so no tick can see the later event without the earlier one. Inside a tick the rows are tried in order and a failed row holds back the later rows of its aggregate. In the next tick the earlier row is still first.
    - **Without the lock** nothing orders two concurrent transactions, and the relay may enqueue their events either way. This covers a handler that publishes before its write and one that never locks the row. Such events have no order at the source, and the relay cannot give them one.
    - **The rule binds the caller.** The writer cannot check it. It is stated in the writer's JSDoc, it is a line on the card of every task that adds an event type, and R-ARCH-37 records the residual.
    - **Only a transaction that holds the relay lock writes an unpublished row.** A foreign row lock on an unpublished row would make `SKIP LOCKED` pass over it and enqueue a later event of its aggregate first. The purge and the `token_enc` overwrite after sending carry `published_at IS NOT NULL`. The 24 h `token_enc` housekeeping of amendment 1 takes the relay lock, in its waiting form, before its statement. *Restated by amendment 3 item 21: the consumer of a row's own event may also write it, and the `token_enc` overwrite carries no `published_at` predicate.*
    - **One clock.** `clock_timestamp()` is the wall clock of the primary. A step backwards larger than the time between two commits on one aggregate would invert them. This is not mitigated: after a failover that time is tens of seconds.
    - **The latency histogram** runs from the insert to the accepted enqueue. It includes the rest of the business transaction, so it is an upper bound of commit to enqueue.
15. **What a consumer may assume.** REQ-PLAT-017 is about the publish step, and the guarantee of item 14 ends at the enqueue. BullMQ does not keep it through processing: `outbox-relay` runs 5 jobs at a time and a failed job is retried after a delay, so two events of one aggregate can be handled at the same time or in reverse.
    - A handler never derives state from the order of events. An event says that something changed. The handler reads the current state of the aggregate in its own transaction (item 1: payloads carry identifiers) and is idempotent (item 4).
    - A handler whose effect depends on order needs per-aggregate serialisation in the dispatcher. The Redis lock with retry that item 3 sketched gives mutual exclusion, not order, and it is not built. That design is owed with the first handler that needs it (R-ARCH-37).

    Alternatives for the order key, all rejected for this task:
    - **A per-aggregate sequence number on the event.** It is an exact key only for a consumer that buffers and reorders by it; the relay needs one order over all aggregates and cannot sort by it. It needs the same row lock, a new column and state in every consumer. It is the design item 15 points to if an order-dependent handler appears.
    - **A claim in commit order** (`track_commit_timestamp` and `pg_xact_commit_timestamp(xmin)`). It would also order a transaction that publishes before its write. It needs a server setting in every environment, and its sort cannot use an index, so every tick sorts the whole backlog, which is largest right after an outage.
    - **A per-aggregate advisory lock taken by the writer** before it reads the clock. It would make the precondition true for every publisher. It adds a second lock to every business transaction, in an order the writer does not control: a handler that writes and then publishes and one that publishes and then writes would deadlock against each other, and so could two transactions that publish for two aggregates in opposite order. It turns a silent inversion into a retryable error, and it is the first fallback if R-ARCH-37 shows up.
    - **A buffered publish**, flushed by the transaction runner as the last statement before the audit entry. The insert time would then be close to the commit for every transaction that locks the aggregate at any point. `publish` would have to return the event id before the insert, and the flush belongs to the commit path of the runner, which is the audit writer's (ADR-0007 amendment 10). Producers would not change, so it stays open as the next step.

**Row rules.**

16. **One correlation grammar** (code review m4; D-ARCH-187). `outbox_events.correlation_id` has the check `^[A-Za-z0-9-]{8,64}$`: ADR-0016 §15, the grammar of `audit_entries.correlation_id` and of payload v2. It stays.
    - The relay copies the value into the job unchanged (D-062), and the producer refuses a payload outside the grammar. A row outside it could never be relayed.
    - A scheduled job is inside the grammar. Its correlation id is `<schedule>-<occurrence millis>` (D-SECPR039-01 condition (iii); at most 64 characters), not its BullMQ id `repeat:<schedule>:<millis>`. The contexts of the relay tick and of the purge are inside it too.
    - The writer does not normalise. Replacing a value would break "never changes between the row and the job" and hide a defect of the caller.
    - The gap is at the entry: `withTenantTx` accepts `^[A-Za-z0-9._:-]{1,128}$`, wider than any audit entry or outbox row can store. TASK-047 narrows it to `CORRELATION_ID_PATTERN`, so a context outside the grammar is refused as `INVALID_TENANT_CONTEXT` before any statement. Until then such a context fails closed at the check (SQLSTATE 23514) and its transaction rolls back. No production caller produces one.
17. **Grants on `processed_events`** (D-TASK043-04; D-ARCH-186): `SELECT, INSERT, DELETE` for `platform_app` and no `UPDATE`. A claim is written once, and `DELETE` is the purge's. data-model §4.4 is corrected.
18. **Verification.**
    - **Order (TASK-043, lane B).** One test with two arms over the same interleaving. T1 begins. T2 begins, locks a row with `SELECT … FOR UPDATE`, inserts E2 and waits. T1 asks for the same row lock, and the test waits until `pg_stat_activity` shows it waiting on a lock. T2 commits; T1 gets the lock, inserts E1 and commits; one tick runs. Writer arm (`outbox.publish`): the jobs are E2, then E1. Control arm (a raw insert that leaves `created_at` to the column default): the jobs are E1, then E2, which shows that the interleaving tells the two keys apart.
    - **Bounds and loop (TASK-043, unit).** The composition gives 2,500 ms and 1,250 ms at the defaults and follows `idle_in_transaction_session_timeout` when that is the smaller value. A run of failing ticks logs one WARN and its wait reaches 5 s. The two gauges of item 11.
    - **Grammar (TASK-043).** The check refuses `repeat:outbox-purge:1763550000000` and a 7-character id on a direct insert. The contexts of the tick and of the purge match `CORRELATION_ID_PATTERN`.
    - **Sequencing (TASK-043, unit).** The worker test of item 12.
    - **Dispatcher (TASK-047, TASK-078).** A second delivery of an event runs no handler twice. A type without a handler completes and counts.
    - **What was run for this amendment.** The writer statement, the check and the tick statements on PGlite (PostgreSQL 17.5, one connection): a defaulted `created_at` is the transaction start; the writer form gives `created_at = updated_at` at the insert time; the check answers 23514 for the two refused values; the advisory lock is gone after commit. Behaviour between two sessions (the row-lock wait, `SKIP LOCKED`, takeover) was not run. It rests on the documented semantics of PostgreSQL until the lane B test above runs on PostgreSQL 18.
    - *Amendment 3 item 23 adds the test of "one tick at a time" and the tests of its items 20 and 21.*

## Amendment 3 (2026-11-20, conditions of the verification D-QG-002): the limit of a held-back aggregate, follow-up jobs, who may lock an unpublished row, liveness details (QG-043-C1 (d), QG-043-C2, QG-043-C3, QG-043-C7 (a) and the observations of D-QG-002; D-ARCH-188 to D-ARCH-190)

quality-gatekeeper verified amendment 2 at commit `d7925b70`, with conditions. This block answers those addressed to principal-architect. The text of amendment 2 is kept, and dated pointers mark the places this block changes. Items continue at 19.

19. **The limit of "other aggregates go on" (item 11; QG-043-C1 (d)).** A refused row and the later events of its aggregate stay at the head of the order and take places in every claim. Other aggregates go on only while those rows fill less than one batch (`OUTBOX_RELAY_BATCH_SIZE`, 100 by default). Once they fill it, every tick claims the same rows and nothing moves. It does not take 100 refused rows: one busy aggregate behind one refused row is enough.
    - **The signal comes long before that.** The refused row is the oldest pending row from the moment it is refused. `OutboxRelayLag` pages about five and a half minutes later (30 s, held for 5 min), and `platform_outbox_relay_failed_total` rises on every tick.
    - **The repair** is a deploy that removes the defect. RB-06 also names the last resort: an operator marks the defective row published under the relay lock, which drops that one event knowingly (the runbook is written in P7).
    - This is the price of "nothing is parked". It is accepted because a refusal cannot come from a row the writer wrote (item 16).
20. **Follow-up jobs: the dispatcher enqueues them after the commit, on every delivery (item 12; QG-043-C2).**
    - **The gap.** Item 12 said that a handler writes the row its follow-up job names, and that a handler which already committed "finds its claim and does nothing". Read together, a crash between the commit and the enqueue left a claim, a row and no job, and the retry skipped the handler. The booking saga chains its steps through outbox events (ADR-0014), so this hop carries the saga.
    - **The rule.** A handler has two parts, and it never enqueues by itself:

      | Part | Runs | Does |
      |---|---|---|
      | `apply` | inside the handler's tenant transaction, only when the claim on `processed_events` was inserted | the effect; database work only |
      | `followUps` | inside the same transaction, after the claim attempt, **on every delivery**, whether the claim was new or not | reads from the database the job references (`queue`, `kind`, `id`, optional `step`) that this event requires: the rows `apply` wrote, found by the event id or by their state. It writes nothing, and nothing is kept in memory between deliveries |

      After the commit, with no transaction open, the dispatcher enqueues every reference through the job producer. Each job has the deterministic id of ADR-0013 and the correlation id and trace context of the event job (D-062). The event job completes only when every handler has committed and every reference was accepted. If an enqueue fails, the event job fails and BullMQ retries it.
    - **A second delivery when the claim exists:** `apply` is skipped, `followUps` runs, and the references are enqueued again. BullMQ ignores an add of a retained id, and a follow-up job that runs twice is absorbed by its own `job_executions` claim (ADR-0013 §4). This is "published only after accept", one hop later.
    - **A reference is for a row that still needs its job.** `followUps` may also return a row whose job is done: the add is ignored, or the job finds nothing to do. It must never miss a row that still needs one.
    - **When the event job is dead-lettered** (five failed deliveries), rows exist without their jobs. The dead-letter record is the handle (ADR-0013 amendment 3 item 11), and `QueueDeadLetterNew` pages for `outbox-relay` (ADR-0013 amendment 5 item 26). A module whose rows must not wait for an operator has a sweep of its own; the saga has one (`saga_due_candidates`, REQ-BOOK-023).
    - **No handler holds the producer.** The enqueue is the dispatcher's and runs outside any transaction, so ADR-0005 amendment 11 item 17 holds for it without an exception. The lint learns the producer's name with the dispatcher's task (ADR-0005 amendment 11 item 20, note of 2026-11-20).
    - **Alternative rejected: a transactional job row.** The handler would insert "enqueue this job" into the outbox, and the relay would enqueue it on the module's queue under the claim lock. That gives the same guarantee with one mechanism. But the relay would again route to several queues and read more than identifiers, which item 12 removed, and the table and the relay of TASK-043 would change after their review. It stays the fallback if the dispatcher's enqueue proves fragile.
    - **Alternative rejected: a sweep in every module as the only mechanism.** It turns the normal path into polling. A sweep is a backstop.
21. **Who may lock an unpublished row (restates the fourth condition of item 14; QG-043-C3).**
    - **The condition.** A row that is not yet published is locked only by (i) a transaction that holds the relay lock, or (ii) the consumer of that row's own event. Case (ii) is safe because that consumer runs only after the queue accepted the row's job, so the place of the event in the queue is already fixed. If a tick passes over the row, the events it enqueues come after that job; the next tick adds the row's job id again, and BullMQ ignores it.
    - **The `token_enc` overwrite is case (ii) and carries no `published_at` predicate.** This withdraws that half of item 14 and of the note at amendment 1. After the notification is sent, its consumer removes the token with one `UPDATE … WHERE id = $event_id`, through a port of the outbox module, and checks that exactly one row was updated. No row means the event row is missing; that is a defect, and the job fails.
      - While the relay's tick still holds the row (the enqueue runs before the mark commits, item 10), the statement waits for the tick to end and then applies.
      - After a tick that rolled back, the statement applies to the unpublished row at once.
      - In both cases the token is gone when the statement returns. A wait longer than `lock_timeout` (2 s; a tick may hold the row for up to `3W / 4`) fails the step, and the job's retry runs it again.
      - The overwrite is a step of its own after the send is recorded, so a retry never sends twice.
    - **Why not the two options of QG-043-C3.** With the predicate and a retry, the statement matches no row for the rest of a slow tick and after a rolled-back tick, so the promise of amendment 1 would hold only after a retry. Accepting the 24 h backstop for these cases would weaken SEC-P3-08 for no gain. Without the predicate there is no such window. The 24 h housekeeping stays what amendment 1 made it: the backstop for a consumer that failed for good.
    - **Unchanged:** the purge carries `published_at IS NOT NULL`. The 24 h housekeeping takes the relay lock, because it can touch a row whose job was never enqueued.
    - **No foreign key references `outbox_events`.** A referential check locks the referenced row and would be a third locker. A column that names an event is a plain `uuid`, as `processed_events.event_id` is.
    - security-analyst confirms this rule before TASK-078 is dispatched (SEC-P3-08 item 1 is its finding).
22. **Liveness and time details (items 11 and 14; observations of D-QG-002).**
    - **The lag gauge is set at the claim**, before the enqueues, not at the end of the tick. During a long tick the holder then shows the true age while the other workers show 0.
    - **`OutboxRelayStalled` has an arm for "no worker at all".** With every worker down there is no series, and a comparison returns nothing. The expression is in ADR-0013 amendment 5 item 26.
    - **A replay runs under the relay lock.** RB-06 replays events by making published rows unpublished again. That statement creates unpublished rows, so it takes the relay lock first (item 21, case (i)). The rows keep their `created_at`, so they are enqueued in their original order, and `OutboxRelayLag` fires during a replay because they are old.
    - **`published_at` can lie a few milliseconds before `created_at`.** The marks use `now()`, the start of the tick, and a row inserted between that start and the claim has a later insert time. Nothing reads the difference: the histogram uses the age at the claim.
    - **The readiness component is the worker's.** ADR-0017 §5 says "api and worker"; only a worker runs a relay.
23. **Verification, added to item 18.**
    - **One tick at a time (TASK-043, lane B; QG-043-C7 (a)).** While one relay's tick is held open inside an enqueue, a second relay's tick returns `locked: false` and claims nothing. After the first commits, every event was enqueued exactly once and in order.
    - **The order test of item 18** runs with a `lock_timeout` of at least 10 s on its runner, so that a loaded lane B host does not time out the wait of T1.
    - **Follow-up jobs (the dispatcher's task).** A failure between the handler's commit and the follow-up enqueue ends with the job enqueued once the event job is delivered again, and `apply` ran once. A second delivery after a success adds no second job. The lint reports a handler that calls the producer inside its transaction.
    - **`token_enc` overwrite (TASK-078).** The overwrite removes the token (a) while an open tick still holds the event row and (b) after a tick that rolled back. In both cases the relay then publishes the row once, and two events of the aggregate keep their order in the queue. An overwrite that updates no row fails the job.
    - **What was run for this block.** Nothing between two sessions. The lock keys of data-model §6.1 were computed: the two `hashtext` values on PGlite (PostgreSQL 17.5) and the bootstrap key in Node.

## Reversibility

High: producers and consumers are unchanged if the relay is replaced by CDC.
