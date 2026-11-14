# WAVE-06 — M1 demo-critical III: checkout and payments, saga M1 steps, booking e-mail, tracking, account shipments

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M1** · Priority band: **Must DC**

Tasks: **20** (S 3 / M 17; opus 10 / sonnet 10; demo-critical 19) in **6** batches of ≤ 4 parallel tasks. Estimated effort ≈ 55.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** All 60 M1 DC stories merged; PRD §6.2 outline executable manually for each carrier; lane B `wave` evidence; lane C `wave-end` if within the monthly cap (tier 2).

**Stories completed in this wave (20):** US-150 (DC), US-195 (DC), US-207 (DC), US-208 (DC), US-209 (DC), US-210 (DC), US-211, US-212 (DC), US-213 (DC), US-214 (DC), US-235 (DC), US-241 (DC), US-242 (DC), US-247 (DC), US-248 (DC), US-251 (DC), US-254 (DC), US-255 (DC), US-277 (DC), US-283 (DC).

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 6.1 | TASK-166 Checkout gate<br>TASK-167 Stripe adapter<br>TASK-168 Map carrier tracking events to the canonical taxonomy<br>TASK-169 Map every domain event to exactly one template | mod-orders-checkout<br>mod-payments-stripe<br>mod-tracking<br>mod-notifications |
| 6.2 | TASK-170 Server-computed amount and authorise-then-capture<br>TASK-171 Payment webhook verification, deduplication and replay<br>TASK-172 Store tracking events once, order them and drive shipment state forward<br>TASK-173 Booking progress status and event stream | mod-payments-core<br>mod-payments-webhook<br>mod-tracking<br>mod-orders-saga |
| 6.3 | TASK-174 3-D Secure, declines, attempt limit and cvc_check = pass rule<br>TASK-175 Immutable price snapshot on the booked shipment<br>TASK-176 Public tracking lookup by tracking or order number<br>TASK-177 No card data on the Platform API; card-only payment methods | mod-payments-core<br>mod-shipments-price<br>mod-tracking-public<br>mod-payments-api |
| 6.4 | TASK-178 Saga M1 steps<br>TASK-179 Booking confirmation e-mail with documents<br>TASK-180 Public tracking page with city-level data only<br>TASK-181 Checkout screen | mod-orders-saga, mod-pickups<br>mod-notifications<br>web-track<br>web-checkout |
| 6.5 | TASK-182 Step 7 confirmation page with booking progress, documents and pickup reference<br>TASK-183 Account shipments list with search, filters and cursor pagination<br>TASK-184 Authenticated full tracking timeline API | web-confirm<br>mod-shipments-query, web-account-list<br>mod-tracking-auth |
| 6.6 | TASK-185 Shipment detail with timeline, charges, documents and tracking | web-account-detail, mod-shipments-query |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

## Task specifications

### TASK-166 — Checkout gate: verified e-mail, unexpired quotes, complete steps

| Field | Value |
|---|---|
| Stories (completes) | US-208 **DC** (M1 Must) Checkout gate: verified email, unexpired quotes, complete steps |
| REQs | REQ-BOOK-016, REQ-PAY-007 |
| NFRs | — |
| Spikes / security / decisions | D-009 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-153, TASK-059, TASK-149, TASK-154, TASK-151 |
| Batch · locks | 6.1 · mod-orders-checkout |
| Branch | `feat/TASK-166-checkout-gate-verified-e-mail` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/orders/checkout/gate.*

**Acceptance tests to write**
- All US-208 scenarios
- AT-US-208-01 … AT-US-208-09: all 9 scenarios of US-208, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-167 — Stripe adapter: test keys only, fixture-backed, via OutboundHttpClient

| Field | Value |
|---|---|
| Stories (completes) | US-210 **DC** (M1 Must) Stripe adapter: test keys only, fixture-backed |
| REQs | REQ-PAY-004, REQ-PAY-017 |
| NFRs | NFR-SEC-010, NFR-SEC-013 |
| Spikes / security / decisions | SEC-P3-21, SEC-P3-08, COND-SANDBOX-DEMO |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-085, TASK-113 |
| Batch · locks | 6.1 · mod-payments-stripe |
| Branch | `feat/TASK-167-stripe-adapter-test-keys-only` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/payments/gateway/stripe/**
- fixtures signed with a test secret

**Acceptance tests to write**
- All US-210 scenarios
- SEC-TC-60: livemode:true fixture rejected and audited; unknown event stored not processed; non-allow-listed host blocked
- AT-US-210-01 … AT-US-210-06: all 6 scenarios of US-210, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-168 — Map carrier tracking events to the canonical taxonomy

| Field | Value |
|---|---|
| Stories (completes) | US-241 **DC** (M1 Must) Map carrier tracking events to the canonical taxonomy |
| REQs | REQ-TRACK-001 |
| NFRs | NFR-OBS-001 |
| Spikes / security / decisions | D-016 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-075, TASK-079 |
| Batch · locks | 6.1 · mod-tracking |
| Branch | `feat/TASK-168-map-carrier-tracking-events-canonical` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/carriers/src/tracking/taxonomy.ts
- apps/api/src/modules/tracking/mapping/**

**Acceptance tests to write**
- All US-241 scenarios
- AT-US-241-01 … AT-US-241-06: all 6 scenarios of US-241, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-169 — Map every domain event to exactly one template

| Field | Value |
|---|---|
| Stories (completes) | US-277 **DC** (M1 Must) Map every domain event to exactly one template |
| REQs | REQ-NOTIF-004 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-082, TASK-086 |
| Batch · locks | 6.1 · mod-notifications |
| Branch | `feat/TASK-169-map-every-domain-event-exactly` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/notifications/event-map/**

**Acceptance tests to write**
- All US-277 scenarios (completes the registry started by the auth-mail task)
- AT-US-277-01 … AT-US-277-06: all 6 scenarios of US-277, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-170 — Server-computed amount and authorise-then-capture

| Field | Value |
|---|---|
| Stories (completes) | US-209 **DC** (M1 Must) Server-computed amount and authorise-then-capture |
| REQs | REQ-PAY-006, REQ-PAY-008 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-011 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-166, TASK-085 |
| Batch · locks | 6.2 · mod-payments-core |
| Branch | `feat/TASK-170-server-computed-amount-authorise-then` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/payments/checkout/**

**Acceptance tests to write**
- All US-209 scenarios
- D-ARCH-106 (ADR-0003 am. 2026-11-13): checkoutOrder is load (order, price snapshots, attempt count) then call (gateway authorise with the idempotency key auth:<order_id>:<attempt>, never random) then handler (payment row with the gateway reference, audit, number allocation, outbox order.checkout_started); the client secret goes into the response only; ARCHITECTURE 7.2 is read in that order; confirmPayment has the same shape (load, call to retrieve, derive the state and void when required, handler); a fault test shows that a handler failure after call and the retry give one gateway effect
- AT-US-209-01 … AT-US-209-08: all 8 scenarios of US-209, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-171 — Payment webhook verification, deduplication and replay

| Field | Value |
|---|---|
| Stories (completes) | US-213 **DC** (M1 Must) Webhook verification, deduplication and replay |
| REQs | REQ-PAY-011, REQ-PAY-012 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | D-ARCH-110, PR32-SEC-14, D-TASK020-41, D-SEC-PR38-02, D-ARCH-113, PR38-SEC-03 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-167, TASK-040 |
| Batch · locks | 6.2 · mod-payments-webhook |
| Branch | `feat/TASK-171-payment-webhook-verification-deduplication-replay` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/payments.prisma (gateway_webhook_events) + migration
- apps/api/src/modules/payments/webhooks/**

**Acceptance tests to write**
- All US-213 scenarios
- PR32-SEC-14 / D-ARCH-110 (ADR-0008 am. 5 items 1 and 5): the Stripe and Mock-gateway signature authenticators read their signature header only on routes whose auth set contains signature (an Authorization header or a cookie on a webhook route is ignored) and build the provider principal only after the signature over the raw body verified: credential signature, authenticated false, no actor, a read-only permission view holding exactly the signature-only permission of the route; the permission gate change itself is TASK-020 part 020-B, this task adds api tests through the real authorise: a valid signature 200, an invalid signature or a stale timestamp 401 before the body is parsed, a session bearer on the webhook route 401 (credential outside the set), and a route whose principal lacks its permission 403
- D-TASK020-41 / D-SEC-PR38-02 AUTHENTICATOR CONTRACT (ADR-0008 am. 6 item 2; D-ARCH-113): the Stripe and Mock-gateway signature authenticators read Stripe-Signature or X-Mock-Signature themselves (signature is not a presentable kind) and only on routes whose auth set is [signature]; they never read authorization, cookie or x-quote-token (presentedKinds(req.headers, route.auth) is empty on a [signature] route and the authenticator does not consult those headers); the provider principal permissions are built with readonlySet holding exactly the signature-only permission of the route; markCredentialsRead(res) is called together with the decision (valid, invalid, stale timestamp, missing header alike) and private, no-store on every 401 comes from the descriptor test ([signature] has no anonymous member); stripe-signature and x-mock-signature are in CREDENTIAL_HEADER_NAMES, so no webhook route can declare them in schema.headers (020-C PR38-SEC-03) and the handler reads the verified event from the body only; api tests: markCredentialsRead called once per request, a valid signature plus a bearer is 200 with the bearer never parsed (spy), the permissions view throws on mutation
- AT-US-213-01 … AT-US-213-11: all 11 scenarios of US-213, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-172 — Store tracking events once, order them and drive shipment state forward

| Field | Value |
|---|---|
| Stories (completes) | US-242 **DC** (M1 Must) Store events once, order them, and drive shipment state forward |
| REQs | REQ-TRACK-002, REQ-TRACK-005 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-ORCH-039 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-168, TASK-084 |
| Batch · locks | 6.2 · mod-tracking |
| Branch | `feat/TASK-172-store-tracking-events-once-order` |
| Priority | Must · demo-critical |

**Files / modules**
- prisma/schema/tracking.prisma + migration
- apps/api/src/modules/tracking/{service,repository}.ts

**Acceptance tests to write**
- All US-242 scenarios
- SEC-TC-22 (D-ORCH-039; threat model T-72, AC-36; ADR-0010 am. 9; named on this sheet because the manifest parks it in required_cases_pending with this task as owner, checkpoint G3): an integration test whose title carries [SEC-TC-22]: an event that reaches the store without a confirming track() result (the shape a carrier push has) is stored as a hint, does not advance the shipment to PICKED_UP or to a terminal state, and cancellation and refund of that shipment still succeed; conditional (security-test-cases.md rule 4): the push route belongs to US-252 (TASK-261, Should), so while it is absent the same test also asserts that no mounted route accepts a carrier push and that no code path advances state from an unconfirmed event, and TASK-261 adds the signed-push half; after this task merges qa-lead moves the ID back to integration.required_cases at the next activation checkpoint
- AT-US-242-01 … AT-US-242-09: all 9 scenarios of US-242, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Touches a security-critical path: the hosted `security-integration` job runs on the PR and degraded mode never waives it (D-ARCH-021).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-173 — Booking progress status and event stream

| Field | Value |
|---|---|
| Stories (completes) | US-207 **DC** (M1 Must) Booking progress status and event stream |
| REQs | REQ-BOOK-025 |
| NFRs | NFR-PERF-004 |
| Spikes / security / decisions | D-UX-007 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-092, TASK-044 |
| Batch · locks | 6.2 · mod-orders-saga |
| Branch | `feat/TASK-173-booking-progress-status-event-stream` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/orders/progress/**

**Acceptance tests to write**
- All US-207 scenarios
- AT-US-207-01 … AT-US-207-05: all 5 scenarios of US-207, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-174 — 3-D Secure, declines, attempt limit and cvc_check = pass rule (SEC-COND-06)

| Field | Value |
|---|---|
| Stories (completes) | US-212 **DC** (M1 Must) 3-D Secure, declines and attempt limit |
| REQs | REQ-PAY-009, REQ-PAY-010 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SEC-COND-06, SEC-P3-28 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-170, TASK-167 |
| Batch · locks | 6.3 · mod-payments-core |
| Branch | `feat/TASK-174-3-d-secure-declines-attempt` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/payments/checkout/three-ds.*
- Mock CVC outcomes

**Acceptance tests to write**
- All US-212 scenarios
- SEC-TC-37 (amended, gateway part): Mock CVC fail/unavailable -> FAILED/AUTHENTICATION_FAILED, authorisation voided, no saga
- AT-US-212-01 … AT-US-212-07: all 7 scenarios of US-212, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-175 — Immutable price snapshot on the booked shipment

| Field | Value |
|---|---|
| Stories (completes) | US-150 **DC** (M1 Must) Immutable price snapshot on booked shipment |
| REQs | REQ-PRICE-017 |
| NFRs | NFR-AUDIT-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-138, TASK-092, TASK-149 |
| Batch · locks | 6.3 · mod-shipments-price |
| Branch | `feat/TASK-175-immutable-price-snapshot-booked-shipment` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/shipments/price-snapshot.*

**Acceptance tests to write**
- All US-150 scenarios (UPDATE denied + audited)
- AT-US-150-01 … AT-US-150-07: all 7 scenarios of US-150, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-176 — Public tracking lookup by tracking or order number

| Field | Value |
|---|---|
| Stories (completes) | US-247 **DC** (M1 Must) Public tracking lookup by tracking or order number |
| REQs | REQ-TRACK-008, REQ-TRACK-012 |
| NFRs | NFR-PERF-005 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-172, TASK-041 |
| Batch · locks | 6.3 · mod-tracking-public |
| Branch | `feat/TASK-176-public-tracking-lookup-tracking-or` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/tracking/public/**

**Acceptance tests to write**
- All US-247 scenarios
- AT-US-247-01 … AT-US-247-09: all 9 scenarios of US-247, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-177 — No card data on the Platform API; card-only payment methods

| Field | Value |
|---|---|
| Stories (completes) | US-211 (M1 Must) No card data on the Platform API, card-only methods |
| REQs | REQ-PAY-005, REQ-PAY-019 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-170 |
| Batch · locks | 6.3 · mod-payments-api |
| Branch | `feat/TASK-177-no-card-data-platform-api` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-214 (DC).

**Files / modules**
- apps/api/src/modules/payments/schemas.ts
- tests: PAN sentinel rejected everywhere

**Acceptance tests to write**
- All US-211 scenarios
- AT-US-211-01 … AT-US-211-06: all 6 scenarios of US-211, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-178 — Saga M1 steps: documents (LABEL_READY), schedule pickup in the booking saga, notify

| Field | Value |
|---|---|
| Stories (completes) | US-235 **DC** (M1 Must) Schedule pickup in the booking saga |
| REQs | REQ-PICK-005, REQ-PICK-006 |
| NFRs | NFR-PERF-004, NFR-RES-005 |
| Spikes / security / decisions | D-031 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-151, TASK-158, TASK-092, TASK-105 |
| Batch · locks | 6.4 · mod-orders-saga, mod-pickups |
| Branch | `feat/TASK-178-saga-m1-steps-documents-schedule` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/orders/booking-saga/{documents-step,pickup-step,notify-step}.*

**Acceptance tests to write**
- All US-235 scenarios
- Saga fault matrix extended with the M1 steps
- AT-US-235-01 … AT-US-235-07: all 7 scenarios of US-235, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-179 — Booking confirmation e-mail with documents (links for SENSITIVE documents)

| Field | Value |
|---|---|
| Stories (completes) | US-283 **DC** (M1 Must) Booking confirmation email with documents |
| REQs | REQ-NOTIF-008 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | D-051 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-169, TASK-078, TASK-158, TASK-162 |
| Batch · locks | 6.4 · mod-notifications |
| Branch | `feat/TASK-179-booking-confirmation-e-mail-documents` |
| Priority | Must · demo-critical |

**Files / modules**
- templates booking.confirmation (en/es/fr)
- apps/worker/src/processors/notifications/attachments.*

**Acceptance tests to write**
- All US-283 scenarios
- SEC-TC-52 (e-mail part): FULL-reference document sent as link, never attachment
- AT-US-283-01 … AT-US-283-15: all 15 scenarios of US-283, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-180 — Public tracking page with city-level data only (pre-rendered shell, query parameter)

| Field | Value |
|---|---|
| Stories (completes) | US-248 **DC** (M1 Must) Public tracking page exposes city-level data only |
| REQs | REQ-TRACK-011 |
| NFRs | NFR-PRIV-004, NFR-WEB-001 |
| Spikes / security / decisions | D-UX-029 |
| Specialist · model | frontend-developer · opus |
| Complexity | M |
| Depends on | TASK-176, TASK-068 |
| Batch · locks | 6.4 · web-track |
| Branch | `feat/TASK-180-public-tracking-page-city-level` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/routes/$lang.track.tsx
- public field allow-list in apps/api/src/modules/tracking/public/serialiser.ts

**Acceptance tests to write**
- All US-248 scenarios (S-W03; no name/street/postcode in response or DOM)
- AT-US-248-01 … AT-US-248-08: all 8 scenarios of US-248, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-181 — Checkout screen (step 6) with Stripe Payment Element and test-mode indicator

| Field | Value |
|---|---|
| Stories (completes) | US-214 **DC** (M1 Must) Checkout screen (step 6) with test-mode indicator |
| REQs | REQ-PAY-016, REQ-PAY-017 |
| NFRs | NFR-A11Y-001, NFR-SEC-006 |
| Spikes / security / decisions | D-UX-020 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-170, TASK-177, TASK-174 |
| Batch · locks | 6.4 · web-checkout |
| Branch | `feat/TASK-181-checkout-screen-stripe-payment-element` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/checkout/**

**Acceptance tests to write**
- All US-214 scenarios (S-B06; 3DS challenge with Stripe test card in fixture mode)
- Mock gateway hosted-field test double with mock_3ds challenge for APP_ENV local/test, used by the default e2e lane (D-QA-006, OI-QA-01)
- AT-US-214-01 … AT-US-214-09: all 9 scenarios of US-214, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-182 — Step 7 confirmation page with booking progress, documents and pickup reference

| Field | Value |
|---|---|
| Stories (completes) | US-195 **DC** (M1 Must) Step 7: confirmation page |
| REQs | REQ-BOOK-017 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | D-UX-007 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-164, TASK-173, TASK-165, TASK-178, TASK-181 |
| Batch · locks | 6.5 · web-confirm |
| Branch | `feat/TASK-182-step-7-confirmation-page-booking` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/features/confirmation/**

**Acceptance tests to write**
- All US-195 scenarios (S-B07)
- AT-US-195-01 … AT-US-195-08: all 8 scenarios of US-195, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-183 — Account shipments list with search, filters and cursor pagination (API + UI)

| Field | Value |
|---|---|
| Stories (completes) | US-254 **DC** (M1 Must) Shipments list with search, filters and cursor pagination |
| REQs | REQ-ACCT-002 |
| NFRs | NFR-PERF-002, NFR-PERF-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-149, TASK-054, TASK-045, TASK-118 |
| Batch · locks | 6.5 · mod-shipments-query, web-account-list |
| Branch | `feat/TASK-183-account-shipments-list-search-filters` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/shipments/query/**
- apps/web/app/routes/account/shipments/_index.tsx

**Acceptance tests to write**
- All US-254 scenarios (S-C02)
- AT-US-254-01 … AT-US-254-12: all 12 scenarios of US-254, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-184 — Authenticated full tracking timeline API

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-185) | US-251 **DC** (M1 Must) Authenticated full tracking timeline |
| REQs | REQ-TRACK-013 |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-172, TASK-060 |
| Batch · locks | 6.5 · mod-tracking-auth |
| Branch | `feat/TASK-184-authenticated-full-tracking-timeline-api` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/modules/tracking/timeline/**

**Acceptance tests to write**
- API scenarios of US-251
- Covers the scenarios of AT-US-251-01 … AT-US-251-10 that belong to its layer; US-251 closes in TASK-185

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-185 — Shipment detail with timeline, charges, documents and tracking (UI + detail API)

| Field | Value |
|---|---|
| Stories (completes) | US-255 **DC** (M1 Must) Shipment detail with timeline, charges, documents and tracking<br>US-251 **DC** (M1 Must) Authenticated full tracking timeline |
| REQs | REQ-ACCT-003, REQ-TRACK-013 |
| NFRs | NFR-A11Y-002 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-183, TASK-184, TASK-165, TASK-175 |
| Batch · locks | 6.6 · web-account-detail, mod-shipments-query |
| Branch | `feat/TASK-185-shipment-detail-timeline-charges-documents` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/web/app/routes/account/shipments/$id.tsx
- apps/api/src/modules/shipments/query/detail.*

**Acceptance tests to write**
- All US-255 and US-251 scenarios (S-C03)
- AT-US-255-01 … AT-US-255-13: all 13 scenarios of US-255, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-251-01 … AT-US-251-10: all 10 scenarios of US-251, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
