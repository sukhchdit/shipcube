# ADR-0014: Booking saga, compensations and end-to-end idempotency keys

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.5, §4.8; REQ-BOOK-018..030, REQ-PAY-008/012/018, REQ-API-009..011, DR-A20, DR-B01..B04, DR-B20, DR-B21, DR-B33; D-030, D-031, D-034; A-052, A-070, A-075; NFR-RES-005; ADR-0004, ADR-0012, ADR-0013

## Context

Guarantees (DR-B04): G1 a captured payment never exists without a booked shipment; G2 a retry never buys a second label; G3 every saga step and gateway call carries an idempotency key; G4 every state change and its event are one transaction. `PAID` means authorised (D-030). M0 runs authorise → create carrier shipment → capture with Mock gateway/carrier; M1 adds documents → pickup → notify (D-031). Orders hold 1–10 shipments, one payment; capture covers booked shipments only (DR-B33).

## Decision

### HTTP idempotency (REQ-API-009..011, DR-A20)

`idempotency_keys(scope_hash PK, key, org_id|guest_hash, actor_id, method, path, fingerprint, status IN_PROGRESS|COMPLETED, response_status, response_headers, response_body, created_at, expires_at)`; scope = (org or guest token, actor, method, path, key). Flow: insert `IN_PROGRESS` (unique violation → existing row: same fingerprint + COMPLETED → replay with `Idempotent-Replayed: true`; different fingerprint → 422 `IDEMPOTENCY_KEY_REUSED`; IN_PROGRESS → 409 `IDEMPOTENCY_IN_PROGRESS`, `Retry-After: 1`); execute; store 2xx/4xx response; 5xx/429 delete the row so a retry re-executes. Required on `POST /orders`, `POST /orders/{id}/checkout`, `POST /shipments`, `POST /shipments/{id}/cancel`, `POST /shipments/{id}/pickup`; optional on other unsafe routes; not-applicable on auth routes. Rows expire after 24 h (hard delete allow-listed). Keys are excluded from the audit chain (they are not business state). *Amended 2026-11-20 by amendments 5 to 9 (TASK-040 code review round 1): the columns are those of data-model §6.2, with `scope_hash` as the only scope column and `id` as the primary key (5); "store 2xx/4xx response" covers a 4xx that a service throws, and the stored body is the response as sent (6); the claim is the first step of the tx slot, and the `If-Match` comparison and the re-authentication check follow it (7); expired rows are deleted by an hourly worker job (8); TASK-040 is delivered in two parts (9). The list of required operations is the one of api/README §5.*

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

1. **Idempotency store scoping and protection (R-05, T-79).** ~~`idempotency_keys` carries explicit `org_id`, `actor_id`, `guest_token_hash` and `client_ip_hash` columns and a `scope_hash` computed from them plus method, path and key; anonymous routes scope by `client_ip_hash + key`.~~ *(Corrected 2026-11-20 by amendment 5: the scope is the single column `scope_hash`; the guest-token hash and the client-network HMAC are inputs of that hash and are not columns.)* Stored response bodies are encrypted at rest with AES-256-GCM under the environment data key (same envelope scheme as the audit PII vault) and decrypted only for replay to a request matching the full scope. Operations whose response contains a **one-time secret** are `x-idempotency: not-applicable` and never stored: `POST /quotes` (returns `guest_token`), `POST /auth/mfa/totp/enrol`, `POST /auth/mfa/recovery-codes/regenerate`, `POST /quotes/{id}/share` (returns the share token), `POST /organisations/{id}/invitations` (token is e-mailed, response holds none — remains `optional`). Expired rows are purged hourly. *(2026-11-20, amendment 8: by the worker schedule `idempotency-purge`.)*
2. **Saga steps re-check state (R-19).** Every worker step re-reads the shipment under `withTenantTx` and proceeds only if the current state permits the step (DR-B01): a pickup is never scheduled, nor a document generated, for a shipment that moved to `CANCELLED`/`EXCEPTION` after the step was enqueued; the step records `SKIPPED` with the observed state.

## Amendments after the P3 security review (2026-11-12, `docs/05-quality/security/P3-architecture-security-review.md` SEC-P3-02 item 4, SEC-P3-10; D-ARCH-018, D-ARCH-023)

3. **Local rejections are retryable and non-ambiguous (SEC-P3-02; amends the step 2 failure column and guard G2).** `CARRIER_BUSY` from the bulkhead and a daily-quota rejection (ADR-0010 amendments 1–4) are returned **before any network I/O** and form the outcome class `LOCAL_REJECT`. For saga step 2 (`createShipment`) and the cancellation/pickup steps they are **retryable and non-ambiguous**: the step records `attempts`, re-enqueues itself with backoff (5 s doubling, capped at 60 s, full jitter) and keeps the shipment in `BOOKING`; it never moves it to `DRAFT` or `EXCEPTION` because of a local rejection, and the authorisation is not released. G2 is untouched because no carrier request was sent (the client reference is reused on the next attempt). The 30-minute `deadline_at` rule still applies: if the deadline passes while the step is still being rejected locally, the authorisation is released and the shipment returns to **`DRAFT`**, not `EXCEPTION` — no carrier request was ever sent, so there is nothing ambiguous for staff to review and the customer simply retries the booking (notification "carrier busy, booking not placed"); this is REQ-BOOK-023's wording. *Corrected 2026-11-12 (SEC-P3-33 item 4; the earlier text said `EXCEPTION`).* The fault-injection matrix gains the cells Mock `busy=<n>` (first n calls rejected locally) × crash points, which must end `BOOKED`.
4. **Contract aligned with amendment 1 (SEC-P3-10).** `createQuote` and `createQuoteShare` are `x-idempotency: not-applicable` in `openapi.yaml`, with no `Idempotency-Key` parameter and no `Idempotent-Replayed` header. `createQuoteShare` **always mints a new share token and revokes the previous active share** (201); it never returns an existing token, because only `share_token_hash` is stored. Decided variant: mint-and-revoke rather than 409 `SHARE_EXISTS`, because a user who re-shares wants a working link and revoking an older, possibly leaked link is the safer default. `api/README.md` §5 "Scope" now reads: organisation, or guest-token hash, or (anonymous routes) client IP /64 HMAC, plus actor, method, path and key; bodies encrypted at rest with `key_id` and AAD (ADR-0018 amendment 1); one-time-secret routes never stored. The amendment 1 one-time-secret list gains **`POST /auth/mfa/totp/activate`** (`activateTotp` returns the ten recovery codes; it was already `not-applicable` as an authentication route). The drift test asserts that every route on the amendment 1 list is `not-applicable` (SEC-TC-53, SEC-TC-04).

## Amendments after the TASK-040 code review, round 1 (2026-11-20; `docs/05-quality/reviews/PR-pending-TASK-040-code-review.md` M2, m1, m2, m7, n5; developer decisions D-TASK040-01, -02, -03, -05, -10; product positions D-PM-081 and D-PM-082; D-ARCH-191..195)

Items continue at 5. Data-model §3.5 and §6.2 and api/README §5 carry the same rules.

5. **The scope is one column (corrects amendment 1 and the column list of §HTTP idempotency; review n5; D-TASK040-05 accepted; D-ARCH-194).** Amendment 1 said that the table "carries explicit `org_id`, `actor_id`, `guest_token_hash` and `client_ip_hash` columns". It does not. Data-model §6.2, which is later and more detailed, never had the last two.
   - **The scope of a key is `scope_hash` alone:** SHA-256 of the JCS of the array `[version, owner kind, owner, actor scope, actor, method, path, key]`. The owner is the active organisation; else the guest-token hash; else, for a signed-in caller without an organisation, the actor; else the HMAC-SHA256 of the client network, which is the address for IPv4 and the /64 prefix for IPv6.
   - **`scope_org_id` and `actor_id` are informational.** No decision reads them. The guest-token hash and the network HMAC are inputs of the hash and are stored nowhere else.
   - **Why one column.** The claim and the lookup need one unique value, and the AAD of the stored body binds that value. Two more columns would keep a guest pseudonym and a network pseudonym at rest for 24 h with no reader.
   - **Open, for the security record of TASK-040:** the key of the network HMAC and its derivation from `IDEMPOTENCY_BODY_KEY` (D-TASK040-04). If it stands, the ADR-0018 register row and data-model §10.4 gain the derived use at the next fold.
   - **Required operations.** §HTTP idempotency lists `POST /shipments` as required and omits `confirmPayment` and `reschedulePickup`. The contract decides (ADR-0016 §1): `createOrder`, `checkoutOrder`, `confirmPayment`, `schedulePickup`, `reschedulePickup` and `cancelShipment` are `required`, and `createShipment`, which creates a draft, is `optional` (api/README §5; pinned by `tests/contract/x-idempotency.test.ts` of part 040-A).

6. **What is stored, and when (clarifies "store 2xx/4xx response"; review M2 and M1; D-TASK040-03 not accepted; D-ARCH-195).** The decision does not change. D-TASK040-03 stored only a result that a handler returns and released the key when a service throws. Services here throw their 4xx, so that reading replays almost none of them and lets a retry run `call` again. Three points are now written down:
   - **Which responses.** Every response with a 2xx status, or with a 4xx status other than 429, that a request produces after its claim: returned or thrown, in `load`, in `call` or in the handler transaction. Released and not stored: a 5xx, a 429, the 503 of a deadline or of a client that went away, and the refusal of the re-authentication check (item 7).
   - **What.** The response as the first request received it: the status, the allow-listed headers (`ETag`, `Location`, `Content-Type`) and the body. For a failure the body is the problem document as the error handler rendered it for the first request, `correlation_id` included, and it is rendered once: the first response and the replay are the same document. A replay carries its own `X-Correlation-Id` header. The stored body names the request that executed, which is the one whose `FAILED` entry exists.
   - **When.** A key is never left completed by a request that then fails. A 2xx of a writing route completes inside the handler transaction, so a failed audit flush or commit rolls the completion back with the change. After a rollback the order is: the `FAILED` entry where REQ-AUDIT-010 asks for one, the completion, the response. On a VIEW or DOWNLOAD route the audit entry that fails closed is written before the completion, and an entry that cannot be written releases the key (review M1). A completion that cannot be written releases the key, and the original status is answered.
   - **Client rule (ADR-0026 §4).** A client reuses a key only for the automatic retry of one submission: after a network failure, a 5xx, a 429 or 409 `IDEMPOTENCY_IN_PROGRESS`, after a token refresh, or with a fresh re-authentication proof. A stored 4xx is replayed for 24 h, so a submission that the user makes again, corrected or not, takes a new key.

7. **Order around the claim (review m7; D-TASK040-01 accepted as the design; amends api/README §5 "Replay and re-auth proof" and §8; D-ARCH-193).** The claim is the first step of the tx slot and stays there. The claim, the completion and the release are then one function with one error path, and no slot outside it can leave a claim behind. A request that carries a key is evaluated in this order:

   | # | Step | Refusals | A retry of a request that already succeeded |
   |---|---|---|---|
   | 1 | Authenticate, MFA gate, authorise, class limit, validate (pipeline steps 2 to 6) | 401, 403, 429, 400 | runs them again; a replay is never a way around them |
   | 2 | Step 7a: the syntax of the key, the `required` mode, the fingerprint | 400 | same result as the first time: the step reads the request only |
   | 3 | Step 7b: `If-Match` is present and well formed on a route that requires it (TASK-096) | 428, 400 | same result: the step reads the request only |
   | 4 | The claim | 422 `IDEMPOTENCY_KEY_REUSED`, 409 `IDEMPOTENCY_IN_PROGRESS` | the replay ends the request here |
   | 5 | The re-authentication check of a route with `reauth` metadata, consumption of the proof included (TASK-187) | 401 `REAUTH_REQUIRED` | not reached |
   | 6 | `load`, `call`, the handler transaction; the comparison of `If-Match` with the row version is the conditional write of the handler | 404, 409, 410, 412, 422, 5xx | not reached |
   | 7 | Completion (item 6), response | | |

   - **Rule for every step before the claim.** It may read the request and the standing of the caller: credentials, permissions, limits. It may not read state that the first execution of the same request changes, and it may not consume a single-use credential. Otherwise the retry of a request that succeeded would be refused before it reaches its replay.
   - **`If-Match` (TASK-096).** Step 7b never reads a row. A PATCH that committed, retried with its key and its original `If-Match`, is replayed and not answered 412. The 412 of a new execution is an outcome of that execution and is stored like any other 4xx; a request sent again with another `If-Match` is another submission and takes a new key (item 6).
   - **Re-authentication proof (TASK-187).** The tx slot calls the check after the claim and before `load`. It is not a pipeline slot of its own. A replay, a 422 and a 409 answer before it and neither check nor consume a proof, as api/README §5 says. Its refusal is not an outcome of the execution: the claim is released and nothing is stored, so the same key with a fresh proof executes. The proof is no part of the fingerprint. It is consumed before `load`, so that no `call` runs without it and two requests cannot share one proof. An execution that then ends in a 5xx has spent its proof, and its retry needs a fresh one ("any new execution needs a fresh, unconsumed proof"). security-analyst confirms the placement with TASK-187. The alternative on file is consumption inside the handler transaction: the proof would survive a rollback, but a `call` could run on a proof that a concurrent request then consumes.
   - **Not chosen: a lookup at step 7a with the claim later.** It costs a second transaction and admission per keyed request, and a first request that completes between the lookup and the claim would still be answered by the later checks instead of its replay. The claim is the only atomic point.
   - **State today.** Step 7b is a pass-through stub and no re-authentication check is built, so nothing on the TASK-040 branch contradicts api/README §5. Part 040-B writes this order into the headers of `pipeline.ts`, `idempotency.ts` and `etag.ts`. TASK-096 and TASK-187 carry it on their cards with one test each.

8. **Purge (review m2; D-TASK040-10; confirms "purged hourly" of amendment 1 and names the place; D-ARCH-192).**
   - **Where.** In the worker, as the scheduled job `idempotency-purge` on the `housekeeping` queue (ADR-0013 amendment 6), in `apps/worker/src/platform/idempotency/purge.ts`. The owner entry of the table in `platform/system-model-owner` becomes `apps/*/src/platform/idempotency/**`, as for the outbox: the writer is in the API, the relay and the purge are in the worker. The worker file holds the purge statement and nothing else. It never reads `response_body`, imports nothing from the API store and needs no key. `platform_app` already holds `DELETE` on the table, so there is no migration.
   - **How.** `DELETE FROM public.idempotency_keys WHERE id IN (SELECT id FROM public.idempotency_keys WHERE expires_at < pg_catalog.now() ORDER BY expires_at LIMIT 5000)`, repeated until fewer than 5,000 rows go, each batch in its own SYSTEM-scope transaction, at most 200 batches per occurrence. It is built like the `outbox-purge` of TASK-043 and under the same four schedule conditions (D-SECPR039-01): constants from code, the age predicate in the statement, a name of the closed list, occurrences only from the scheduler.
   - **How often.** Every hour, a code constant. A stored body is then deleted at most one hour after it expires, plus the run time of the purge. A daily run, as for the outbox, would keep a body up to 48 h. The 24 h of the replay window do not depend on the purge: the store never replays an expired row.
   - **Clocks.** `expires_at` is written with the application clock (D-TASK040-06), and the purge compares it with the database clock. The difference is the clock skew between an API instance and the database, seconds against 24 h.
   - **When it fails.** BullMQ retries the occurrence. An exhausted one is a dead-letter record of `housekeeping`, which `QueueDeadLetterNew` reports as a ticket (ADR-0013 amendment 3 item 14). No metric is added.
   - **Not chosen.** A timer in every API instance: N purgers, and scheduled work belongs to the worker (ADR-0013 §5). A definer function: the table has no RLS and the runtime role holds `DELETE`, so nothing needs a definer. Deleting a few expired rows on each claim: a write on the hot path, and no bound when traffic stops.
   - **When.** With part 040-B or before it, never after it. Before the wiring of item 9 no row can exist.

9. **Two parts (review §2 and m1; D-TASK040-02 accepted; D-PM-082; D-ARCH-191).** The split follows TASK-041: two parts of one task, no new task ID.
   - **Part 040-A** is the pull request under review: the table, the store, step 7a, the claim, the completion and the release in the tx slot, and the mount refusals. A route in the `required` or `optional` mode is refused at mount when the composition has no store (`IdempotencyNotWiredError`), so nothing runs unprotected between the parts.
   - **Part 040-B** puts the store into the production composition and adds the purge:

     | Scope | Files |
     |---|---|
     | The store in the composition: `AppDependencies.idempotency`, handed to `defaultPipelineSlots`. `startApi` builds it once with `idempotencyStoreFrom`, before anything listens. A live composition without a store is refused, as one without the rate limiters is. `bootFailureOf` maps the two mount errors to a boot line that names the operation | `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/platform/routing/pipeline.ts` |
     | The RBAC matrix app mounts idempotent routes: its tx slot gets a store that fits its inert runner, and an allowed case on a `required` route sends a key | `tests/generated/rbac/matrix-app.ts` |
     | The purge of item 8, its schedule and the owner entry with a negative lint fixture | `apps/worker/src/platform/idempotency/purge.ts`, `packages/shared/src/queues/`, `apps/worker/src/platform/jobs/schedulers.ts`, `apps/worker/src/start-worker.ts`, `eslint.config.mjs` |
     | The order of item 7 in the file headers | `pipeline.ts`, `idempotency.ts`, `etag.ts` |

   - **Proofs of part 040-B.**
     - (a) Under `createApp` with its default slots and the store from `idempotencyStoreFrom`, on PostgreSQL 18: a fixture module with one `required` and one `optional` route whose handler writes a row and publishes an event. The same key twice gives the first response again with `Idempotent-Replayed: true`, and leaves one row, one audit entry and one outbox event (AT-US-038-01 as D-PM-082 splits it).
     - (b) `startApi` hands the store to `createApp`, and a malformed key ends the start before the listener opens.
     - (c) A live composition without a store, and an idempotent route without one, each end the start with their boot line.
     - (d) The matrix app mounts a `required` and an `optional` fixture route.
     - (e) The purge: an expired row that is never sent again is gone after a run, a row that expires later stays, and the lint fixture refuses the table name in a worker file outside the folder.
     - (f) The 429 half of AT-US-038-06 against the real limiter, if part 040-A used a stand-in.
   - **On main before it starts:** part 040-A; TASK-041 part 041-A, which releases `app.ts`, `start-api.ts`, `pipeline.ts`, `matrix-app.ts` and `eslint.config.mjs`; TASK-043, for the outbox writer of proof (a) and for the schedule handlers and `system-tx.ts` of the purge. If part 041-B is dispatched first, part 040-B follows it: 041-B is on the path to TASK-052, and 040-B is not.
   - **What waits for it.** Every task that mounts an operation whose `x-idempotency` is `required` or `optional`: 47 operations of the contract, 6 and 41. The refusal at mount is the control, in the task's own tests and in the matrix app. The plan dispatches such a task only after part 040-B has merged.
   - **What does not wait.** TASK-049 mounts `registerUser` only, and every authentication operation is `not-applicable`, as are `createQuote` and `createQuoteShare`. The review and D-PM-082 name TASK-049 as the first task that waits. By the contract it does not, and its gate stays part 040-A. Part 040-B is still a Wave 1 part, so US-038 completes in M0, as D-PM-082 requires.

## Reversibility

Medium (saga tables and keys are internal; order/shipment states are in the API contract).
