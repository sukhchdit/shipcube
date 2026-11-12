# ADR-0013: Background jobs — BullMQ queues, retries, dead letters, schedulers, idempotent processors

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.13, §4.6; REQ-PLAT-013/014/015/022, REQ-RLS-008, REQ-TRACK-003/004, REQ-AUDIT-013/017, REQ-PAY-018, DR-A25, DR-B19; NFR-RES-004, NFR-AVAIL-002, NFR-OBS-002/003; ADR-0004 (outbox), ADR-0014 (saga)

## Decision

1. **Queues** (names are constants in `packages/shared/queues.ts`): `booking` (saga steps), `payments` (webhook processing, capture, refund, authorisation sweeper), `documents` (PDF generation, storage), `pickups` (schedule/cancel with carrier), `tracking-poll` (adaptive polling), `notifications` (render + send), `audit-maintenance` (partition pre-creation daily, chain verify hourly/nightly, nightly checkpoint), `outbox-relay` (500 ms scheduler + 30 s fallback), `housekeeping` (expired tokens, idempotency keys > 24 h, published outbox > 30 d, drafts > 30 d, MFA challenges). Each queue has a `<queue>:dead` dead-letter queue (BullMQ `removeOnFail: false` + a `failed` listener moving exhausted jobs with redacted data, reason and attempt count).
2. **Job options**: deterministic `jobId` from the business key (e.g. `booking:<saga_id>:<step>`, `tracking:<shipment_id>`, `outbox:<event_id>`), `attempts: 5`, `backoff: { type: 'exponential', delay: 2000 }` + custom jitter strategy, `removeOnComplete: { age: 86400, count: 10000 }`. Non-retryable errors (`NonRetryableError`: validation, missing tenant context `MISSING_TENANT_CONTEXT`, permission) skip retries and go straight to the DLQ (DR-A25).
3. **Payload contract**: `{ v: 1, org_id, actor_id, correlation_id, idempotency_key, trace_context, data }`; processors open `withTenantTx` with the payload's `org_id` (REQ-RLS-008); system-wide schedulers iterate organisations explicitly.
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

## Reversibility

High.
