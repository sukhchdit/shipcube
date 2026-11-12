# ADR-0010: Carrier adapter layer, resilience, rate-shopping fan-out and raw payload retention

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.3, §4.6, Appendix B; REQ-CARR-001..021, REQ-QUOTE-008, REQ-API-017/018, DR-B15, DR-B16, DR-B29, DR-B30, DR-B32; D-003, D-012, D-021; NFR-PERF-002/003, NFR-RES-001..003/006, NFR-QUAL-005; ADR-0011 (third-party account rules), ADR-0021 (object storage)

## Context

One interface, many adapters; nothing outside `packages/carriers` knows a wire format. Adapters: DHL Express (MyDHL API), FedEx REST, UPS REST (OAuth), deterministic Mock. Resilience: per-call timeout, retry with backoff + jitter on idempotent operations only, one circuit breaker per carrier account, bulkheads. Rate shopping fans out in parallel with per-carrier deadlines, returns partial results, streams via SSE, and caches identical requests briefly in Redis. Raw requests/responses (redacted) are kept in object storage. No credentials exist in this run (D-003): adapters are built from current docs with recorded/synthesised `nock` fixtures and the Mock carries e2e.

**Values:** REQ-CARR-017/DR-B32 (rates 4 s, tracking 10 s, cancel 10 s, pickup 15 s, create 20 s; ≤ 2 retries; breaker 50 % over the last 20 calls, min 10, or 5 consecutive failures; bulkhead 10 per account) are the defaults. NFR-RES-001..003 originally stated different numbers; product-manager aligned them to the REQ values in D-035(f) and D-ARCH-004 records the same choice. All are configuration keys.

## Decision

### Interface and context

`CarrierAdapter` exactly as brief §4.3 (`code`, `capabilities()`, `getRates`, `createShipment`, `cancelShipment`, `schedulePickup`, `cancelPickup`, `track`, optional `validateAddress`, `findServicePoints`, `uploadCustomsDocuments`, `estimateLandedCost`). `CarrierContext = { account: CarrierAccountRef, environment: 'sandbox' | 'production', correlationId, mockScenario?, locale, deadlineAt }`. `capabilities()` returns the REQ-CARR-002 declaration (per-service limits, divisors, cut-offs, label formats, push tracking, idempotent-create flag, max tracking numbers per call). Optional operations not declared → `CAPABILITY_NOT_SUPPORTED` without network I/O (REQ-CARR-003). All inputs/outputs are canonical Platform types (`packages/shared`): services (DR-B30 `EXPRESS|STANDARD|ECONOMY` tiers + `<CARRIER>_<code>`), surcharges, errors, tracking statuses (DR-B18). Unmapped services are dropped and logged; unmapped surcharges → `CARRIER_OTHER` with the original label in `raw`; unmapped errors → `CARRIER_UNKNOWN_ERROR`.

### Ports injected into adapters (no direct I/O)

`HttpClient` (the single SSRF-safe outbound client, ADR-0016/REQ-SEC-010: https only, host allow-list per environment, private-IP and redirect checks, timeout, size cap), `TokenCache` (Redis; OAuth tokens cached until 60 s before expiry; single in-flight refresh per account; 401 → drop + one retry, REQ-CARR-016), `SecretResolver` (resolves `secretRef` → value at call time from env/Secrets Manager; values never logged — Pino redaction keys), `Clock`, `Logger`.

### Resilience wrapper (`CarrierGateway`, one per carrier **account**)

Order: bulkhead → breaker → timeout → retry → adapter call.

- **Timeouts** via `AbortSignal.timeout`: rates 4 000 ms, track 10 000, cancel 10 000, pickup 15 000, create 20 000 (DR-B32). Token fetch 5 000.
- **Retries** (`p-retry`-style in-house, seeded RNG for tests): max 2, base 200 ms × 2, full jitter, on network error / 429 / 502 / 503 / 504, **only** for `getRates`, `track`, `findServicePoints`, `validateAddress`, `cancelShipment`, `cancelPickup`. Never for `createShipment`/`schedulePickup` (REQ-CARR-017); after an ambiguous `createShipment` (timeout/5xx) the saga marks the shipment `EXCEPTION` unless the adapter declares idempotent create by client reference (DR-B04 G2).
- **Circuit breaker** `opossum` 10 per account: opens at 50 % failures over the last 20 calls (min 10) or 5 consecutive failures; half-open after 30 s with one probe; open → fail fast ≤ 50 ms with `CARRIER_UNAVAILABLE`. Breaker state is a gauge metric and feeds `GET /carriers/status`.
- **Bulkhead** `p-limit(10)` per account (concurrent calls); queue wait beyond the operation deadline → `CARRIER_BUSY`.

### Rate shopping (`quotes` module → `RateShopper`)

Eligible accounts = enabled accounts whose declared services match direction/content type/weight/dimensions (DR-B34). Fan-out with `Promise.allSettled` under a per-carrier deadline 4 000 ms and overall 5 000 ms (DR-B16); late responses are discarded and not cached. Each carrier result is priced by `PricingService` (ADR-0015) and emitted as an SSE `carrier_result`; failures as `carrier_error {carrier, state: timeout|error, code}`; `complete {per-carrier status OK|NO_SERVICE|TIMEOUT|ERROR, elapsed_ms, cached}` by 5 s; stream closes ≤ 6 s; heartbeat comment every 15 s (for the 30 s cap); client disconnect aborts outstanding calls (REQ-API-018). Non-streaming `GET /quotes/{id}` returns what has completed. **Cache (DR-B15):** Redis key = SHA-256 of the normalised request (origin, destination, packages in g/mm, content type, residential, ship date, account set, Mock scenario), value = **carrier cost responses only**, TTL 300 s; pricing/discounts/tax run after the cache so customer-specific prices are never shared; partial/failed responses are not cached; `cached: true` flag on results.

### Mock carrier (REQ-CARR-004..006)

Code `MOCK`, services `MOCK_EXPRESS|MOCK_STANDARD|MOCK_ECONOMY`, deterministic prices from billable weight × lane zone × service, scenario directives (DR-B29: `latency`, `fail`, `error`, `rates=empty`, `track=…`) from `X-Mock-Scenario` or a `MOCK:` customer reference; registered only when `NODE_ENV !== 'production'`; absent from production fan-out and capability listings. Implements the full contract suite (REQ-CARR-011) — the proof that onboarding a carrier is adapter + capabilities + seed.

### Real adapters (fixture-backed in this run; verification notes dated 2026-11-12)

| Carrier | Confirmed today | To re-verify at implementation (REQ-CARR-019 README) |
|---|---|---|
| **UPS** | Official OpenAPI specs at github.com/UPS-API/api-documentation (`Rating.yaml`, `Shipping.yaml`, `Tracking.yaml`, `Pickup.yaml`, `OAuthClientCredentials.yaml`, `OAuthAuthCode.yaml`, `AddressValidation.yaml`, `Locator.yaml`, `Paperless.yaml`, `LandedCost.yaml`); servers `https://wwwcie.ups.com/api` (CIE) / `https://onlinetools.ups.com/api`; Rating `POST /rating/{version}/{requestoption}` with `version = v2409` (v1…v2205 deprecated), `requestoption ∈ Rate|Shop|Ratetimeintransit|Shoptimeintransit`; Shipping `POST /shipments/v2409/ship`; Tracking `GET /track/v1/details/{inquiryNumber}` (+ `/reference/details/{ref}`, `/shipment/details/{n}`; headers `transId`, `transactionSrc` required); Pickup `POST /pickupcreation/v2409/pickup`, `DELETE /shipments/v2409/pickup/{CancelBy}`, `POST /shipments/v2409/pickup/{pickuptype}` (rate), `GET …/pickup/{pickuptype}` (pending status); OAuth client credentials `POST /security/v1/oauth/token`. | Void path (`/shipments/{version}/void/cancel/{id}`), label recovery, Address Validation and Locator versions; token lifetime. |
| **FedEx** | OAuth `POST /oauth/token` (form-encoded) with `grant_type ∈ client_credentials | csp_credentials | client_pc_credentials`, token `expires_in` 3600 (developer.fedex.com authorization docs); hosts per App. B `apis-sandbox.fedex.com` / `apis.fedex.com`; Rate API notes: estimates only, decimal dimensions truncated. | Exact paths (`/rate/v1/rates/quotes`, `/ship/v1/shipments`, `PUT /ship/v1/shipments/cancel`, `/track/v1/trackingnumbers`, `/pickup/v1/pickups`, `/pickup/v1/pickups/cancel`, `/address/v1/addresses/resolve`) — the catalog pages render client-side and could not be machine-read today. |
| **DHL Express** | MyDHL API REST; base URLs `https://express.api.dhl.com/mydhlapi/test` and `https://express.api.dhl.com/mydhlapi`; HTTP Basic (API key/secret) + DHL account number; spec line **3.3.x** (reference-data guides 3.3.0/3.3.2 dated 2026-05/2026-09 on developer.dhl.com); sandbox quota ~500 calls/day per credential set (unofficial SDK README; App. B says "daily quota"). developer.dhl.com rejected automated fetches (WAF) on 2026-11-12. | Resource paths (`/rates`, `/products`, `/shipments`, `/pickups`, `/tracking`, `/address-validate`, `/landed-cost`, `/shipments/{n}/upload-image`), required headers (`Message-Reference`, `Message-Reference-Date`, `x-version`), current version string. |

Each adapter README records docs URL, API version, date checked and sandbox quirks (REQ-CARR-019). Live sandbox contract runs only with `CARRIER_LIVE_SANDBOX=1` (REQ-CARR-020, COND-SANDBOX-DEMO).

### Raw payload retention (REQ-CARR-018)

For `createShipment`, `cancelShipment`, `schedulePickup`, `cancelPickup` and every tracking event: request + response redacted (credentials, names, street lines, phone, email, tax IDs → `[REDACTED]`), stored as JSON objects in the `raw-carrier-payloads` bucket (ADR-0021) under `carrier/<code>/<shipment_id>/<operation>/<uuid>.json`, SHA-256 recorded in `carrier_raw_payloads`; never exposed to customers; staff access is M2.

### Carrier accounts (D-012)

`carrier_accounts` rows for `MOCK`, `DHL_EXPRESS`, `FEDEX`, `UPS` with `environment = sandbox`, `owner_type = PLATFORM`, `credential_secret_ref` (name only), `enabled` from config; config validation fails start-up if an enabled account lacks its secret reference (names reported, never values). Partner-owned accounts (M3) reuse the same table with `owner_org_id` and envelope-encrypted credentials (ADR-0011 seam).

## Alternatives considered

- **Per-carrier breaker instead of per-account.** Brief requires per account (sandbox and production accounts of one carrier fail independently).
- **Polling instead of SSE for progressive results.** More requests, worse first-result latency; SSE is required by the brief; the non-streaming GET exists for fallback.
- **Caching priced results.** Would leak customer-specific discounts; cache carrier costs only (REQ-CARR-010).
- **Third-party aggregator SDKs.** Would hide wire formats but add a dependency outside the fixed stack and licence/maintenance risk.

## Consequences

- Positive: one contract, four adapters, one test suite; failures are isolated per account; partial results always flow; secrets never leave the resolver.
- Negative: fixture realism is the main risk until credentials exist (R-01); DHL docs must be read manually at implementation (portal blocks bots).
- Verification: contract suite ×4 (NFR-QUAL-005), timeout/retry/breaker tests with Mock profiles (NFR-RES-001..003), k6 SSE scenarios (NFR-PERF-002/003), degradation e2e (NFR-RES-006).

## Reversibility

High (adapters and wrapper are internal to `packages/carriers`).
