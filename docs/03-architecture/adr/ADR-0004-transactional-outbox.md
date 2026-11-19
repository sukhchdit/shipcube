# ADR-0004: Transactional outbox and inter-module eventing

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.1, §4.5; REQ-PLAT-011/013/014/016/017, DR-A25, DR-B04 G4; ADR-0013 (queues), ADR-0014 (saga)

## Context

State changes must emit events exactly when they commit (REQ-PLAT-016), consumers must receive them at least once in order per aggregate (REQ-PLAT-017), and the same correlation ID must flow API → outbox → worker → audit (REQ-PLAT-011). BullMQ is the fixed job system but Redis is not transactional with PostgreSQL, so publishing directly from a request would create the dual-write problem.

## Decision

1. **Table** `outbox_events` (SYSTEM class, no RLS): `id uuid v7 PK`, `type` (catalogued dotted name), `aggregate_type`, `aggregate_id`, `org_id nullable`, `payload jsonb` (no secrets, no raw PII beyond IDs — consumers reload entities under RLS), `correlation_id`, `trace_context jsonb` (W3C traceparent), `actor_id`, `created_at`, `published_at nullable`, `attempts int`, `last_error`. Index `(published_at, created_at) WHERE published_at IS NULL`; index `(aggregate_type, aggregate_id, created_at)`.
2. **Write path.** Services call `outbox.publish(tx, event)` inside the same `withTenantTx` transaction as the state change; the audit entry (ADR-0007) is written in that transaction too. A rolled-back transaction leaves no event (test REQ-PLAT-016).
3. **Relay.** A worker scheduler (`outbox-relay`, every 500 ms, single active instance via a Redis lock, plus a 30 s repeatable fallback) selects `WHERE published_at IS NULL ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`, enqueues each event to its target queue(s) with `jobId = event.id` (BullMQ dedupes same-ID jobs), then sets `published_at`. Ordering per aggregate is preserved by publishing in `created_at` order and by using BullMQ **groups/one-active-per-aggregate semantics in the consumer** (consumer serialises by `aggregate_id` using a Redis lock with the job retried on contention). Relay latency commit→enqueue is a histogram metric (REQ-PLAT-017).
4. **Consumers** are idempotent: `processed_events(consumer, event_id, processed_at)` is written in the consumer's own transaction; a duplicate delivery is discarded (REQ-PLAT-017 test: crash between enqueue and mark).
5. **Routing.** `packages/shared` holds the event catalogue (`DomainEventType` union) and a static `eventRouting` map `type → queue[]` (e.g. `payment.authorised → booking`; `shipment.booked → documents, notifications`; `tracking.* → notifications`; `shipment.label_ready → pickups`). Unmapped types are logged and counted (`outbox_unrouted_total`) and still marked published.
6. **Retention.** Published events older than 30 days are hard-deleted by `housekeeping` (allow-listed hard delete, REQ-RLS-010); they are not the audit trail. *Confirmed 2026-11-19 (D-ARCH-167): 30 days stands. The data-model said 7 days in §3.5, §6.1, §10.1 and §10.5 without a decision and is corrected. The horizon is at least the life of a dead-letter record (14 days, ADR-0013 amendment 3), because redriving an `outbox_event` job needs its row, and at most the 30 days after which `processed_events` forgets a processed event.*
7. **Tracing.** `trace_context` is injected by the API and extracted by the worker so one trace spans API → queue → worker → carrier (NFR-OBS-003).

## Alternatives considered

- **Direct enqueue from the request after commit.** Loses events on crash between commit and enqueue; violates REQ-PLAT-016.
- **Logical decoding / Debezium CDC.** Exactly the right tool at scale but adds a connector to run and operate at $0 budget; polling with `SKIP LOCKED` is sufficient at ≤ 300 rps and can be replaced by CDC without changing producers or consumers.
- **PostgreSQL `LISTEN/NOTIFY` to wake the relay.** Kept as an optimisation seam (reduces the 500 ms latency); not needed for NFR-PERF-004 (queue wait p95 ≤ 2 s).

## Consequences

- Positive: atomic state + event + audit; replayable event history for 30 days; module extraction later reuses the same events.
- Negative: ~0.5 s median enqueue latency; one more table and scheduler to monitor (metrics exposed, REQ-PLAT-018 readiness reports relay lag > 60 s as degraded).

## Amendment (2026-11-12, api-designer handback): one-time tokens in event payloads

The e-mail events `auth.email_verification`, `auth.password_reset` and `org.invitation_created` need the plaintext one-time token to build the link, while the database stores only its hash. Rule 2's "no secrets in payloads" is refined: payloads carry the token **only** as `token_enc` = AES-256-GCM(token) under the environment outbox key (KMS-wrapped in AWS; `OUTBOX_PAYLOAD_KEY` locally), with the token's `expires_at`; the notifications consumer decrypts in memory, renders the link with the token in the URL fragment (ADR-0016 amendment 2) and **overwrites `token_enc` with null in the outbox row after sending**; housekeeping also nulls `token_enc` on any row older than the token lifetime (24 h). Pino redaction covers `token_enc`. Alternative rejected: storing the plaintext token encrypted on the token table and having the worker read it — same cryptography, one more table to clean.

## Reversibility

High: producers and consumers are unchanged if the relay is replaced by CDC.
