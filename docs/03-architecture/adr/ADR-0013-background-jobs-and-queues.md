# ADR-0013: Background jobs — BullMQ queues, retries, dead letters, schedulers, idempotent processors

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.13, §4.6; REQ-PLAT-013/014/015/022, REQ-RLS-008, REQ-TRACK-003/004, REQ-AUDIT-013/017, REQ-PAY-018, DR-A25, DR-B19; NFR-RES-004, NFR-AVAIL-002, NFR-OBS-002/003; ADR-0004 (outbox), ADR-0014 (saga)

## Decision

1. **Queues** (names are constants in `packages/shared/queues.ts`): `booking` (saga steps), `payments` (webhook processing, capture, refund, authorisation sweeper), `documents` (PDF generation, storage), `pickups` (schedule/cancel with carrier), `tracking-poll` (adaptive polling), `notifications` (render + send), `audit-maintenance` (partition pre-creation daily, chain verify hourly/nightly, nightly checkpoint), `outbox-relay` (500 ms scheduler + 30 s fallback), `housekeeping` (expired tokens, idempotency keys > 24 h, published outbox > 30 d, drafts > 30 d, MFA challenges). Each queue has a `<queue>:dead` dead-letter queue (BullMQ `removeOnFail: false` + a `failed` listener moving exhausted jobs with redacted data, reason and attempt count).
2. **Job options**: deterministic `jobId` from the business key (e.g. `booking:<saga_id>:<step>`, `tracking:<shipment_id>`, `outbox:<event_id>`), `attempts: 5`, `backoff: { type: 'exponential', delay: 2000 }` + custom jitter strategy, `removeOnComplete: { age: 86400, count: 10000 }`. Non-retryable errors (`NonRetryableError`: validation, missing tenant context `MISSING_TENANT_CONTEXT`, permission) skip retries and go straight to the DLQ (DR-A25).
3. **Payload contract**: `{ v: 1, org_id, actor_id, correlation_id, idempotency_key, trace_context, data }`; processors open `withTenantTx` with the payload's `org_id` (REQ-RLS-008); system-wide schedulers iterate organisations explicitly. *Superseded 2026-11-12 by amendment 1: payload v2 carries `kind` + `id` only and the processor resolves `org_id` from PostgreSQL (`platform.job_context`).*
4. **Idempotent processors**: `job_executions(job_key UNIQUE, status, result, completed_at)` written in the processor's transaction; a duplicate delivery of a completed job returns without side effects (REQ-PLAT-014). Outbox consumers additionally use `processed_events` (ADR-0004).
5. **Schedulers**: BullMQ **Job Schedulers** (`upsertJobScheduler`) registered idempotently at worker start, so N workers run each schedule once per interval (REQ-PLAT-015). Schedules (config): outbox relay 500 ms (lock-guarded loop) / 30 s fallback; audit partitions daily 02:00 UTC; chain verify hourly incremental + nightly full 03:00; checkpoint nightly 03:30; payment sweeper every 5 min; tracking poll planner every minute (enqueues due shipments per DR-B19 intervals with ±10 % jitter and failure backoff); housekeeping hourly.
6. **Concurrency and isolation**: worker concurrency per queue from config (defaults: booking 5, payments 5, documents 4, pickups 5, tracking-poll 10, notifications 10, maintenance 1); carrier calls remain bounded by the per-account bulkhead (ADR-0010).
7. **Graceful shutdown**: SIGTERM → `worker.close()` waits up to 30 s for active jobs, then exits 0; interrupted jobs are re-delivered (safe by idempotency) (REQ-PLAT-022, NFR-AVAIL-002). API: `server.close()` + drain ≤ 30 s.
8. **Observability**: `/metrics` on the worker exposes per-queue `waiting`, `active`, `completed`, `failed`, `delayed`, `dead` gauges, job duration histograms, relay lag; trace context propagated in payloads (NFR-OBS-002/003). Readiness reports Redis connectivity and scheduler liveness.
9. **Redis durability and policy**: Valkey 8 (Redis-compatible, ADR-0001) with AOF `everysec` in Compose; ElastiCache for Valkey Multi-AZ later; `maxmemory-policy noeviction` (required by BullMQ) asserted at worker start; caches use a separate key prefix/logical DB with explicit TTLs. A Redis restart loses no committed business state (outbox is the source of truth; unpublished events are re-relayed; in-flight jobs are re-queued by BullMQ stalled-job detection).

## Alternatives considered

- **pg-boss (Postgres-backed queue).** Attractive for transactional enqueue but the stack fixes BullMQ + Redis; the outbox gives the transactional guarantee instead.
- **Cron in the API process.** Rejected: schedulers belong in the worker; API stays stateless.
- **BullMQ Pro (groups, rate limiting per group).** Commercial licence — not in the allow-list; per-aggregate serialisation uses a Redis lock in the consumer instead.

## Consequences

- Positive: at-least-once with idempotent effects; visible DLQs (System health screen in M4); scheduled jobs are singletons by construction.
- Negative: Redis becomes a critical dependency for background work (not for committed state); BullMQ 6 API differences from older tutorials (job schedulers replace repeatable jobs) — follow the 6.x docs.
- Verification: kill -9 / Redis restart tests (NFR-RES-004), duplicate delivery tests (REQ-PLAT-014), scheduler singleton test with 2 workers (REQ-PLAT-015), drain test (NFR-AVAIL-002).

## Amendment after the P3 security review (2026-11-12, `docs/05-quality/security/P3-architecture-security-review.md` SEC-P3-12, SEC-P3-08 item 2; threat-model T-73, R-18; D-ARCH-025)

1. **The worker never trusts tenant context from Redis (SEC-P3-12, MEDIUM; supersedes §3 "Payload contract").** Payload contract **v2** (v1 is never implemented): `{ v: 2, kind, id, correlation_id, trace_context }` — identifiers only, no `org_id`, no `actor_id`, no business data. `kind ∈ {outbox_event, saga, shipment, order, pickup, document, payment, tracking_poll, notification, quote}` names the authoritative row; `id` is its UUID (for `outbox_event` jobs this is the `outbox_events.id`, for saga steps the `saga_id`; the step is part of the deterministic `jobId`, §2).
2. **Context is resolved from PostgreSQL.** The processor calls the allow-listed `SECURITY DEFINER` function `platform.job_context(kind, id) → (org_id, actor_type, actor_id)` (data-model.md §4.5, owner `platform_definer`, catalog test C11) **before** opening `withTenantTx`, and opens the tenant transaction with the resolved `org_id`. No row → `NonRetryableError('JOB_CONTEXT_NOT_FOUND')` → DLQ. A forged or edited job cannot make the worker act inside another tenant's RLS context, because the context never comes from the job. Any processor that receives a payload carrying `org_id` (schema violation) sends it to the DLQ as non-retryable with security event `job_context_mismatch`.
3. **Payloads are Joi-validated at dequeue** against the per-queue schema in `packages/shared/queues.ts` (`allowUnknown: false`); invalid → DLQ non-retryable `PAYLOAD_INVALID`. The e2e suite asserts the schema on every job observed in Redis (SEC-TC-50).
4. **Valkey ACL users per service** (`api`, `worker`; no default user; key-prefix limits) locally and in AWS (platform.md §2.2; ADR-0010 amendment 7). Writing to the `bull:*` prefix requires the `worker` or `api` ACL user; the `requirepass`-only local setup is withdrawn.
5. **Schedulers** that iterate organisations (§3) read the organisation list from PostgreSQL and enqueue one `kind`/`id` job per aggregate; they never embed `org_id` either. Verification: SEC-TC-20 (now mandatory), SEC-TC-50.

## Amendment (2026-11-12, PR1-SEC): BullMQ's deprecated polyfill transitive (`docs/05-quality/security/PR-0001-TASK-001-security-review.md` PR1-SEC-07; D-ARCH-043)

6. **`node-abort-controller` 3.1.1 stays as BullMQ's transitive, under a watch item.** BullMQ 6.7.x (`dist/cjs/classes/abort-controller.js`) `require`s the polyfill but uses `globalThis.AbortController` whenever it exists, so on Node 24 the module is loaded and never instantiated; the registry deprecation (2026-11-10) states obsolescence on supported Node, not a defect, and the package has no dependencies, no install script and no advisory. Recorded in `tools/ci/maintenance-exceptions.json` with the parent chain and a review at every BullMQ minor bump and by 2027-05-12 (ADR-0025 PR1-SEC amendment; ADR-0023 am. J item 4). No `override`, no fork; the entry is removed when BullMQ drops the dependency.

## Reversibility

High.
