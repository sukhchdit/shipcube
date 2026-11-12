# ADR-0014: Booking saga, compensations and end-to-end idempotency keys

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.5, §4.8; REQ-BOOK-018..030, REQ-PAY-008/012/018, REQ-API-009..011, DR-A20, DR-B01..B04, DR-B20, DR-B21, DR-B33; D-030, D-031, D-034; A-052, A-070, A-075; NFR-RES-005; ADR-0004, ADR-0012, ADR-0013

## Context

Guarantees (DR-B04): G1 a captured payment never exists without a booked shipment; G2 a retry never buys a second label; G3 every saga step and gateway call carries an idempotency key; G4 every state change and its event are one transaction. `PAID` means authorised (D-030). M0 runs authorise → create carrier shipment → capture with Mock gateway/carrier; M1 adds documents → pickup → notify (D-031). Orders hold 1–10 shipments, one payment; capture covers booked shipments only (DR-B33).

## Decision

### HTTP idempotency (REQ-API-009..011, DR-A20)

`idempotency_keys(scope_hash PK, key, org_id|guest_hash, actor_id, method, path, fingerprint, status IN_PROGRESS|COMPLETED, response_status, response_headers, response_body, created_at, expires_at)`; scope = (org or guest token, actor, method, path, key). Flow: insert `IN_PROGRESS` (unique violation → existing row: same fingerprint + COMPLETED → replay with `Idempotent-Replayed: true`; different fingerprint → 422 `IDEMPOTENCY_KEY_REUSED`; IN_PROGRESS → 409 `IDEMPOTENCY_IN_PROGRESS`, `Retry-After: 1`); execute; store 2xx/4xx response; 5xx/429 delete the row so a retry re-executes. Required on `POST /orders`, `POST /orders/{id}/checkout`, `POST /shipments`, `POST /shipments/{id}/cancel`, `POST /shipments/{id}/pickup`; optional on other unsafe routes; not-applicable on auth routes. Rows expire after 24 h (hard delete allow-listed). Keys are excluded from the audit chain (they are not business state).

### Saga model

`saga_executions(id, order_id, kind BOOKING | CANCELLATION, status RUNNING|COMPLETED|COMPENSATING|COMPENSATED|FAILED|EXCEPTION, current_step, deadline_at, correlation_id, …)` and `saga_steps(saga_id, step, status PENDING|RUNNING|DONE|FAILED|COMPENSATED|SKIPPED, attempts, idempotency_key, outcome jsonb, started_at, finished_at)`. The saga is **orchestrated** in the worker (`booking` queue), one job per step with deterministic `jobId = booking:<saga_id>:<step>`; each step runs in its own `withTenantTx`, records its outcome, writes the shipment `STATE_TRANSITION` audit entry and the outbox event for the next step in the same transaction (G4).

Steps for an order (DR-B03; D-031 for M0 scope):

| # | Step | Where | Idempotency key | Success → | Failure → compensation |
|---|---|---|---|---|---|
| 1 | **Authorise** payment for Σ gross totals | API `POST /orders/{id}/checkout` (sync intent creation) + webhook/confirm → `payment.authorised` | `auth:<order_id>:<attempt>` | shipments `PENDING_PAYMENT → PAID`; saga created | decline → shipments `→ QUOTED`, attempt counted (≤ 5/h) |
| 2 | **Create carrier shipment** per shipment (parallel across shipments, bounded by bulkhead) | worker | `create:<shipment_id>` = carrier client reference | `PAID → BOOKING → BOOKED`, label ref stored, raw payload stored | definitive carrier rejection → `→ DRAFT` (customer fixes inputs), authorisation stays for the remaining shipments or is released if none booked; **ambiguous** (timeout/5xx) → `→ EXCEPTION`, authorisation released (A-070), `needs_review`, void retry every 4 h for 24 h, no auto-retry of create (G2) |
| 3 | **Capture** Σ booked shipments (partial capture when some failed) | worker | `capture:<order_id>` | payment `CAPTURED` / `PARTIALLY_CAPTURED`; `payment.captured` | capture failure → `cancelShipment` for booked shipments (`BOOKED → CANCELLED → VOIDED`), void authorisation; if void fails → `EXCEPTION` with authorisation already voided |
| 4 | **Generate documents** (label persistence, commercial/pro-forma invoice) | worker (`documents` queue) | `docs:<shipment_id>:<doc_type>:<version>` | `BOOKED → LABEL_READY`; `shipment.label_ready` | retry only; shipment stays `BOOKED` with documents pending (no compensation) |
| 5 | **Schedule pickup** (if pickup requested) | worker (`pickups` queue) after `LABEL_READY` (A-075) | `pickup:<shipment_id>:<request_id>` | `LABEL_READY → PICKUP_SCHEDULED`; `pickup.scheduled` | `pickup.failed` → stays `LABEL_READY`, user action; no compensation |
| 6 | **Notify** | worker (`notifications`) | `notify:<event_id>:<template>` | email in mail catcher/SES | retry → DLQ only |

Steps 1–3 decide success; 4–6 never undo it. The order is `BOOKED` (`order.booked`) when every shipment is `BOOKED` or later or definitively failed; a mixed outcome leaves the order `PARTIALLY_BOOKED` with the failed shipments back in `DRAFT`.

### Guards

- **G1**: capture only after carrier confirmation; the 5-min sweeper (REQ-PAY-018) releases authorisations > 30 min without a booked shipment and repairs CAPTURED-without-BOOKED after 10 min (completes the transition if the carrier shipment exists, refunds otherwise).
- **G2**: the carrier client reference (= shipment id) is persisted before the first carrier call; `createShipment` is never retried after an ambiguous result unless `capabilities().idempotentCreateByReference` is true, in which case one retry with the same reference is allowed.
- **Deadline**: `deadline_at = authorised_at + 30 min`; passing it with steps 2–3 incomplete → compensate (release) and `EXCEPTION`.
- **Concurrency**: shipment `version` conditional updates make a concurrent cancel vs first-scan race deterministic (DR-B20): whichever commits first wins; the loser returns `SHIPMENT_NOT_CANCELLABLE`.

### Cancellation saga (D-017, DR-B20/B21)

`POST /shipments/{id}/cancel` (reason code + text, Idempotency-Key): allowed in `BOOKED | LABEL_READY | PICKUP_SCHEDULED` with no PICKED_UP/DROPPED_OFF+ event → `→ CANCELLED`; worker: `cancelPickup` (if any) → `cancelShipment` → `→ VOIDED` → refund full captured amount of that shipment (key `refund:<cancellation_id>`) → `→ REFUNDED`; void failure → `EXCEPTION` (no refund); refund failure → retry ×5 → `REFUND_FAILED` + notification.

### Fault-injection matrix (NFR-RES-005)

Mock carrier `fail=booking|void|pickup`, `latency=…` (timeout) × Mock gateway `mock_capture_fail|mock_refund_fail` × worker crash points (after carrier call before commit, after capture before commit) → every cell must end in a consistent state with 0 captured-without-shipment and 0 duplicate labels; the matrix is a generated Jest suite.

## Alternatives considered

- **Choreography (each module reacts to events without a coordinator).** Harder to reason about compensations and deadlines; the orchestrated saga table gives an inspectable state for the M4 exception queue.
- **Capture per shipment instead of per order.** Stripe allows one capture per PaymentIntent (multicapture is limited); one authorisation per order + one capture for the booked subset matches DR-B33; multi-shipment partial failures are handled by partial capture.
- **Synchronous booking in the API request.** Violates NFR-PERF-004 (ack ≤ 300 ms) and the queue/worker demo requirement.

## Consequences

- Positive: guarantees are testable; state is inspectable; replay-safe.
- Negative: multi-shipment orders with partial failures need careful UX (PARTIALLY_BOOKED); ambiguous carrier outcomes require staff follow-up (M2) — in M1 they are visible in the customer's timeline as EXCEPTION with the authorisation released.
- Verification: idempotency concurrency tests, saga matrix, sweeper tests, cancel/scan race test.

## Amendments after the threat model (2026-11-12, threat-model.md R-05, R-19, T-79)

1. **Idempotency store scoping and protection (R-05, T-79).** `idempotency_keys` carries explicit `org_id`, `actor_id`, `guest_token_hash` and `client_ip_hash` columns and a `scope_hash` computed from them plus method, path and key; anonymous routes scope by `client_ip_hash + key`. Stored response bodies are encrypted at rest with AES-256-GCM under the environment data key (same envelope scheme as the audit PII vault) and decrypted only for replay to a request matching the full scope. Operations whose response contains a **one-time secret** are `x-idempotency: not-applicable` and never stored: `POST /quotes` (returns `guest_token`), `POST /auth/mfa/totp/enrol`, `POST /auth/mfa/recovery-codes/regenerate`, `POST /quotes/{id}/share` (returns the share token), `POST /organisations/{id}/invitations` (token is e-mailed, response holds none — remains `optional`). Expired rows are purged hourly.
2. **Saga steps re-check state (R-19).** Every worker step re-reads the shipment under `withTenantTx` and proceeds only if the current state permits the step (DR-B01): a pickup is never scheduled, nor a document generated, for a shipment that moved to `CANCELLED`/`EXCEPTION` after the step was enqueued; the step records `SKIPPED` with the observed state.

## Reversibility

Medium (saga tables and keys are internal; order/shipment states are in the API contract).
