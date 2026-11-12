# SPK-02 — Carrier API documentation capture (DHL Express MyDHL, FedEx REST, UPS REST)

| Field | Value |
|---|---|
| Task | TASK-009 (Wave 0, batch 0.3) · branch `feat/TASK-009-spk-02-spike-carrier-api` |
| Risks | R-ARCH-02, R-PLAN-08 (carrier fixtures drift from real APIs; no sandbox access) |
| Requirements | REQ-CARR-019 (README with docs URL, API version, date checked, sandbox quirks), REQ-CARR-020 (live sandbox opt-in), brief §13 rule 6, Appendix B |
| Date / method | 2026-11-12 · public documentation only (WebFetch, WebSearch, `curl` of public GitHub raw files). **No carrier API host was called**; no credentials, accounts or personal data were used |
| Owner | backend-developer |
| Deliverables | `packages/carriers/src/adapters/{ups,dhl-express,fedex}/README.md`, this record |
| **Verdict** | **UPS: GO.** **FedEx: FALLBACK** for named operations (paths and field names of Ship, Cancel, Pickup, Address Validation, Locations; Rate and Track paths only secondarily confirmed). **DHL Express: FALLBACK** for named operations (official spec unreadable; paths confirmed only from a third-party SDK; `cancelShipment` not found). Overall: **FALLBACK for the named operations**, which triggers the ADR-0010 amendment request in §4 before TASK-135 (DHL), TASK-139 (FedEx) and TASK-140 (UPS) start; the adapter tasks can start from the READMEs with fixtures synthesised and flagged |

Verdict meaning (WAVE-00 DoD): GO = enough confirmed for fixture-backed adapters; FALLBACK = the PLAN.md §9 fallback applies to the named operations ("mark operations unverified and keep live sandbox opt-in, COND-SANDBOX-DEMO").

## 1. Evidence summary per carrier

| | UPS | FedEx | DHL Express |
|---|---|---|---|
| Version(s) confirmed | Rating, Ship, Void, Pickup `v2409`; Tracking `v1`; Address Validation `v2`; Locator `v3`; Paperless `v2`; Landed Cost `v1`; Label Recovery `v1`; OAuth `v1` | Catalog `v1` for Authorization, Rate, Ship, Pickup, Track, Address Validation, Close (page URLs). No version header | Spec line 3.3.x; `x-version: 3.3.1` per the SDK (unverified against DHL) |
| Source quality | Official OpenAPI YAML (GitHub `UPS-API/api-documentation`), read in full for 9 APIs | Official portal prose pages and guides (specs not machine-readable); search snippets of official PDFs | Third-party SDK source (MIT, spec 3.3.1); official portal blocked by a WAF |
| OAuth / auth | Confirmed: `POST /security/v1/oauth/token`, Basic client credentials, form body | Confirmed: `POST /oauth/token`, form body, `expires_in` 3600, 401 → refresh | Basic (key and secret) + account number; no token |
| Token lifetime | Spec silent; third party says 1 h from 2026-04-01 (unverified) | 3600 s, confirmed | none |
| Rate | Confirmed `POST /rating/v2409/{Rate\|Shop\|Ratetimeintransit\|Shoptimeintransit}` | Path confirmed (secondary) `POST /rate/v1/rates/quotes`; fields unverified | Confirmed (secondary) `GET /rates`, `POST /rates`, `GET /products` |
| Ship + labels | Confirmed `POST /shipments/v2409/ship`; labels GIF, ZPL, EPL, SPL (**no PDF**) | Path unverified `POST /ship/v1/shipments`; `URL_ONLY` seen | Confirmed (secondary) `POST /shipments`; `pdf`, `zpl`, `lp2`, `epl` |
| Cancel shipment | Confirmed `DELETE /shipments/v2409/void/cancel/{id}` | Path confirmed (secondary) `PUT /ship/v1/shipments/cancel` (method unverified) | **Not found** (probably unsupported) |
| Track | Confirmed `GET /track/v1/details/{n}`; 1 number per call | Path confirmed (secondary) `POST /track/v1/trackingnumbers`; 30 numbers per call (portal) | Confirmed (secondary) `GET /shipments/{n}/tracking`, `GET /tracking` (200 per batch) |
| Pickup create / cancel | Confirmed `POST /pickupcreation/v2409/pickup`, `DELETE /shipments/v2409/pickup/{CancelBy}` | Paths unverified; rules documented | Confirmed (secondary) `POST /pickups`, `DELETE /pickups/{n}` |
| Optional ops | Address validation, Locator, Paperless, Landed Cost: paths and versions confirmed | Address validation and Locations paths unverified; ETD upload path and hosts confirmed (secondary) | Address validate, service points, landed cost, upload-image (needs `WY`, ≥ 10 min after create): confirmed (secondary) |
| Rate limits | Not in specs | 1,400 per 10 s per project, daily quotas, token service 3/s burst; confirmed | Sandbox 500 per day per credential set (two sources) |
| Sources | 12 (S1–S11 plus S9b) | 11 | 5 |

## 2. Corrections to ADR-0010 ("confirmed today" table)

1. **UPS void is `DELETE`**, not an unspecified method; `trackingnumber` is a query parameter; `v3` applies to Roadie only.
2. **UPS label recovery exists**: `POST /labels/{version}/recovery` (default `v1`).
3. **UPS Address Validation is `v2`, Locator `v3`** (the earlier `v1` of each is deprecated), Paperless `v2`, Landed Cost `v1`.
4. **UPS labels cannot be requested as PDF** (GIF, ZPL, EPL, SPL only). The Platform's PDF label (REQ-CARR-002 `labelFormats`) needs an adapter-side conversion or must be declared unsupported for UPS.
5. **UPS token response values are strings** (`expires_in`, `issued_at`). The token host path is `/security/v1/oauth/token` **without** the `/api` prefix that applies to all other operations.
6. **UPS token lifetime**: ADR-0010 left it open. The spec is silent; a third-party notice reports 4 h reduced to 1 h from 2026-04-01. Read `expires_in` per response.
7. **DHL has no confirmed cancel-shipment operation.** ADR-0010's interface lists `cancelShipment` as mandatory.
8. **DHL tracking has two forms** (`GET /shipments/{n}/tracking` single with GMT offsets; `GET /tracking` batch ≤ 200 without per-event GMT offsets). `maxTrackingNumbersPerCall`: UPS 1, FedEx 30, DHL 200.
9. **FedEx paths** `/rate/v1/rates/quotes`, `/track/v1/trackingnumbers` (POST) are secondarily confirmed; `/ship/v1/shipments`, `/pickup/v1/pickups`, `/pickup/v1/pickups/cancel`, `/address/v1/addresses/resolve` remain unverified; `PUT /ship/v1/shipments/cancel` path confirmed (secondary).
10. **FedEx ETD upload uses different hosts** (`documentapitest.prod.fedex.com/sandbox`, `documentapi.prod.fedex.com`); the SSRF host allow-list (ADR-0016) needs them per environment when the operation is implemented.
11. **FedEx rate limit** 1,400 transactions per 10 s per project, 429 with "Retry after 10 seconds", and token-service limits per public IP with a 10-minute `403` penalty (single in-flight refresh is mandatory).
12. **FedEx can return 200 with `errors[]`** (third-party SDK); the adapter must check the body on success.
13. **Capability declarations** to seed: DHL `pushTracking=false`, FedEx `pushTracking=false` (e-mail notifications only), UPS `pushTracking=false` (no webhook in the specs read; `UPSTrackAlert` exists in the repository but was not read).

## 3. What could not be confirmed, and why

| Gap | Reason |
|---|---|
| DHL official spec, headers' limits, error model, tracking schema, rate limits | `developer.dhl.com` returns "Request Rejected" (WAF) to automated fetches (confirmed again on 2026-11-12); the official PDF read had unreadable text streams |
| FedEx OpenAPI paths and field names | Portal pages render prose only; the OpenAPI definitions load client-side; fedex.com PDFs return "access denied" to the fetcher |
| UPS portal pages (token lifetime, CIE test numbers, quotas) | `developer.ups.com` returns HTTP 403 to automated fetches; the GitHub OpenAPI repository was fully readable and covers all the required operations |
| Numeric rate limits for UPS and DHL production, sandbox test tracking numbers (UPS, FedEx) | Not in the specifications or prose pages |
| Anything requiring a call to a carrier host | Forbidden (D-003, CLAUDE.md §5); no credentials exist |

## 4. ADR-0010 amendment request to principal-architect (FALLBACK)

Because the verdict is FALLBACK for named operations, principal-architect is asked to amend ADR-0010 (§Real adapters) before TASK-135, TASK-139 and TASK-140 start:

1. **Record the table in §1 as the authoritative "confirmed today / unverified" status** and replace the UPS and DHL "to re-verify" lists with the results in each README §6.
2. **`cancelShipment` for DHL**: decide between (a) `CAPABILITY_NOT_SUPPORTED` for DHL (the saga then voids the Platform shipment, cancels the carrier pickup where one exists, and lets the carrier shipment lapse) or (b) keep the operation and prove it in the first live run. Recommended: (a). If cancellation of DHL bookings is promised to users, product-manager must be told.
3. **UPS PDF labels**: decide whether the adapter converts GIF to PDF (recommended, deterministic, no new network dependency; `pdfkit` is already in the baseline, ADR-0001) or declares UPS labels as `GIF` and `ZPL` only.
4. **Fixtures labelled `synthesised`** for FedEx and DHL; the contract suite (REQ-CARR-011) must pass against the Mock first, then against the fixtures. TASK-191 (docs-check) should require a "Diffed against official spec by a person: yes/no" line in the FedEx and DHL READMEs; COND-SANDBOX-DEMO remains the closing proof.
5. **Token lifetime configuration**: no hard-coded lifetime; the adapter reads `expires_in` (string in UPS responses).
6. **Host allow-list entries per environment** (ADR-0016): `wwwcie.ups.com` / `onlinetools.ups.com`; `apis-sandbox.fedex.com` / `apis.fedex.com` (+ `documentapitest.prod.fedex.com` / `documentapi.prod.fedex.com` for ETD); `express.api.dhl.com`.
7. **Quota seeds**: DHL sandbox `CARRIER_DAILY_QUOTA=500` stays (two sources). FedEx and UPS seeds remain `0` (guard off, metered), because only FedEx per-10-second limits are documented and they are far above the platform's per-account bulkhead.

Reversibility: high (documentation and capability declarations only).

## 5. Impact on dependent tasks

| Task | Impact |
|---|---|
| TASK-135 (DHL adapter) | Start from the DHL README fixture plan; resolve the `cancelShipment` decision (§4 item 2) first |
| TASK-139 (FedEx) / TASK-140 (UPS) | Start from the READMEs' fixture plans; the FedEx and DHL READMEs' "unverified" items must be diffed against the official specs by a person with portal access before closing, or left as COND-SANDBOX-DEMO items |
| TASK-191 (docs check) | READMEs contain `Docs URL`, `API version`, `Date checked`, `Sandbox quirks` and a Sources table |
| Security (SEC-TC fixture scan) | No credentials or PII in any file; placeholders only (`<DHL_API_KEY>`, `<FEDEX_API_KEY>`, `<UPS_CLIENT_ID>`, `<TRACKING_NUMBER_1Z>`) |

## 6. Verification of the acceptance test

| Check | Result |
|---|---|
| Three READMEs complete with version + date checked (brief §13 rule 6) | Yes: each has "Docs URL", "API version", "Date checked" (2026-11-12), "Sandbox quirks", Sources, Open questions |
| Fixture plan per operation listed | Yes: README §9 (DHL), §8 (FedEx, UPS) |
| No credentials or PII in any file | Yes: only placeholders; example identifiers are public specification examples or placeholders; Gitleaks run is by CI (not run locally) |
| No carrier API host contacted | Yes |
