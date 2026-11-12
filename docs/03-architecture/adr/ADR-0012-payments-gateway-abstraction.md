# ADR-0012: Payments gateway abstraction — Stripe test mode, Payment Element, manual capture, webhooks, Mock gateway

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.7, §4.11 (PCI SAQ A); REQ-PAY-001..019, DR-B27, DR-B03, DR-B04; D-011, D-017, D-030; NFR-SEC-013; ADR-0014 (saga)

## Context

Card data must never touch Platform servers (hosted fields; SAQ A). Stripe first (test mode only in this run; a live key refuses to start), PayPal and other gateways later via the same abstraction. The saga needs authorise → carrier booking → capture. Webhooks must be verified, idempotent and replayable. A deterministic Mock gateway drives M0 and failure paths. Verified today (docs.stripe.com, 2026-11-12): PaymentIntents with `capture_method=manual` authorise now and capture later (`POST /v1/payment_intents/{id}/capture`, optional `amount_to_capture` for partial capture; `POST …/cancel` releases); online card authorisations are valid **7 days** (Visa MIT 5 days); webhooks are signed in `Stripe-Signature` (`t=` timestamp, `v1=` HMAC-SHA256 over `t.rawBody`), the SDK's default tolerance is **300 s**, the raw body is required, duplicates must be de-duplicated by event ID, and ordering is not guaranteed.

## Decision

1. **Interface** `PaymentGateway` (REQ-PAY-001): `authorise({ orderId, amount: Money, customerRef?, paymentMethodToken?, idempotencyKey, returnUrl }) → { gatewayRef, status: AUTHORISED | REQUIRES_ACTION | FAILED, clientSecret?, declineCode? }`, `capture({ gatewayRef, amount?, idempotencyKey })`, `voidAuthorisation({ gatewayRef, idempotencyKey })`, `refund({ gatewayRef, amount, idempotencyKey, reason })`, `retrieve(gatewayRef)`, `verifyWebhook(rawBody, headers) → GatewayEvent`, optional `attachPaymentMethod`, `listPaymentMethods`, `detachPaymentMethod`, `createSetupSession`. Every state-changing call carries an idempotency key (Stripe `Idempotency-Key` header). Amounts are `Money` (minor units) computed **server-side** from stored price snapshots (REQ-PAY-006).
2. **Stripe adapter** (`stripe` 23, API version pinned by the SDK): PaymentIntent with `capture_method: 'manual'`, `automatic_payment_methods` restricted to card (REQ-PAY-019), `metadata { order_id, org_id }`; **Payment Element** in the web app (hosted iframe fields; `connect-src`/`frame-src` allow `js.stripe.com`, `api.stripe.com`, `hooks.stripe.com` exact hosts, REQ-SEC-002). 3-D Secure → `REQUIRES_ACTION` with `client_secret` → client `confirmPayment` → outcome via webhook and `POST /payments/{id}/confirm` reconciliation (REQ-PAY-009). Capture after carrier confirmation for the booked shipments' amount (partial capture releases the rest, DR-B33). Refund = full captured amount of the cancelled shipment after `VOIDED` (DR-B21). Start-up guard: key prefix must be `sk_test_`/`rk_test_` else `PAYMENT_LIVE_KEY_FORBIDDEN` (REQ-PAY-004). Without a key the adapter runs **fixture-backed** (recorded Stripe responses incl. 3DS test cards) and `STRIPE_TEST_LIVE=1` enables real test-mode calls (REQ-PAY-017, D-003).
3. **Webhooks** `POST /api/v1/webhooks/stripe`: raw body parser on this route only, `stripe.webhooks.constructEvent(raw, sig, secret, 300)`; invalid → 400 + audit `DENIED` + security event `webhook_signature_invalid`; valid → insert `gateway_webhook_events(gateway, event_id UNIQUE, type, received_at, payload_ref, processed_at)` **before** processing (duplicate → 200 immediately), enqueue to `payments` queue, respond 200 fast. The processor **retrieves the current PaymentIntent** and derives state (never from event order), applies DR-B27 transitions, and is replayable by event ID (worker command). Unknown event types stored + acknowledged (REQ-PAY-012). Local dev: Stripe CLI `stripe listen --forward-to` is documented; fixtures sign payloads with a test secret.
4. **Mock gateway** (REQ-PAY-002): outcome by reserved tokens `mock_ok | mock_decline | mock_3ds | mock_3ds_fail | mock_capture_fail | mock_refund_fail`; emits synthetic webhooks to `POST /webhooks/mock-gateway` (non-production only) so the same async path is exercised; rejected in production.
5. **Payment records** (REQ-PAY-003): `payments(order_id, gateway, gateway_ref, amount, currency, status, livemode=false, …)` + `payment_status_history` (append-only), `payment_attempts` (≤ 5/hour/order → 429 `PAYMENT_ATTEMPTS_EXCEEDED`), `refunds`, `saved_payment_methods` (token, brand, last4, exp month/year only; ≤ 10/user), redacted raw payloads in object storage (ADR-0021). Status machine DR-B27 enforced in the service. Decline mapping → `CARD_DECLINED | INSUFFICIENT_FUNDS | AUTHENTICATION_FAILED | EXPIRED_CARD | GATEWAY_UNAVAILABLE` (REQ-PAY-010).
6. **Authorisation lifecycle guards**: saga releases on abort or at its 30-min deadline; sweeper every 5 min cancels authorisations > 30 min without a booked shipment and repairs CAPTURED-without-BOOKED after 10 min (REQ-PAY-008/018). The 7-day Stripe validity is far above these windows; it is still asserted in config (`PAYMENT_AUTH_MAX_AGE_MINUTES ≤ 7 d`).
7. **Test-mode indicator**: `livemode: false` on payment responses and a visible, non-colour-only indicator in checkout/confirmation (REQ-PAY-016).
8. **Seams**: `payment_methods.type` enum includes `CARD | PAYPAL | WALLET | CREDIT_ACCOUNT | PAYMENT_LINK | OFFLINE | COD` (only `CARD` accepted now → 400 `PAYMENT_METHOD_NOT_AVAILABLE`); `ledger` is M4 (payments carry `ledger_posting_ref NULL`).

## Alternatives considered

- **Stripe Checkout (hosted page).** Also SAQ A, but a redirect breaks the "sticky price summary, one step per screen" wizard; Payment Element keeps the flow in-app with equal PCI scope.
- **Capture immediately.** Violates G1 (captured payment without shipment, DR-B04); manual capture is mandated by D-011/D-030.
- **Synchronous webhook processing.** Risk of timeouts and duplicate side effects; store-then-queue is Stripe's recommended pattern.
- **Processing from event payload instead of retrieving the object.** Out-of-order events would corrupt state; REQ-PAY-012 requires retrieval.

## Consequences

- Positive: SAQ A scope; saga guarantees implementable; gateway swap = new adapter + config; M0 runs without Stripe.
- Negative: webhooks need a public URL in staging (Stripe CLI locally); fixture realism until `STRIPE_TEST_LIVE=1` runs (COND-SANDBOX-DEMO).
- Verification: PAN scanner on bodies/logs, signature/tolerance/replay tests, saga fault matrix (NFR-SEC-013, NFR-RES-005).

## Reversibility

High (adapter boundary).
